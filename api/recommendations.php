<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
$action = (string)($data['action'] ?? '');
$userId = current_user_id();

if ($action === 'load') {
    respond(['ok' => true, 'recommendations' => load_recommendations($userId)]);
}

require_csrf($data);

if ($action === 'generate') {
    $taskIds = parse_task_ids($data['taskIds'] ?? []);
    if (!$taskIds) {
        fail('参考動画・書籍を探したいタスクを選択してください。');
    }

    $tasks = load_tasks_by_ids($userId, $taskIds);
    if (!$tasks) {
        fail('選択されたタスクが見つかりません。');
    }

    db()->prepare('DELETE FROM recommendations WHERE user_id = ?')->execute([$userId]);

    foreach (array_slice($tasks, 0, 12) as $task) {
        $keywords = build_keywords((string)$task['title'], (string)($task['description'] ?? ''));
        save_youtube_recommendations($userId, (int)$task['id'], $keywords);
        save_book_recommendations($userId, (int)$task['id'], $keywords);
    }

    respond(['ok' => true, 'recommendations' => load_recommendations($userId)]);
}

if ($action === 'clear') {
    db()->prepare('DELETE FROM recommendations WHERE user_id = ?')->execute([$userId]);
    respond(['ok' => true, 'recommendations' => []]);
}

fail('未対応の操作です。', 404);

function load_tasks_by_ids(int $userId, array $taskIds): array
{
    $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
    $stmt = db()->prepare(
        'SELECT id, title, description
         FROM action_tasks
         WHERE user_id = ?
         AND id IN (' . $placeholders . ')
         ORDER BY due_date IS NULL, due_date, sort_order, id'
    );
    $stmt->execute(array_merge([$userId], $taskIds));
    return $stmt->fetchAll();
}

function parse_task_ids(mixed $ids): array
{
    if (!is_array($ids)) {
        return [];
    }

    return array_values(array_unique(array_filter(
        array_map('intval', $ids),
        fn (int $id): bool => $id > 0
    )));
}

function load_recommendations(int $userId): array
{
    $stmt = db()->prepare(
        'SELECT r.id, r.task_id AS taskId, r.type, r.title, r.url, r.description,
                r.thumbnail_url AS thumbnailUrl, r.source, t.title AS taskTitle
         FROM recommendations r
         LEFT JOIN action_tasks t ON t.id = r.task_id
         WHERE r.user_id = ?
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 80'
    );
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function build_keywords(string $title, string $description): string
{
    $base = trim($title . ' ' . $description);
    $base = preg_replace('/\s+/u', ' ', $base);
    return mb_substr((string)$base, 0, 80);
}

function save_youtube_recommendations(int $userId, int $taskId, string $keywords): void
{
    $items = [];

    if (defined('YOUTUBE_API_KEY') && YOUTUBE_API_KEY !== '') {
        $url = 'https://www.googleapis.com/youtube/v3/search?' . http_build_query([
            'part' => 'snippet',
            'type' => 'video',
            'maxResults' => 2,
            'q' => $keywords,
            'key' => YOUTUBE_API_KEY,
            'relevanceLanguage' => 'ja',
        ]);
        $json = http_get_json($url);
        foreach (($json['items'] ?? []) as $item) {
            $videoId = $item['id']['videoId'] ?? '';
            if ($videoId === '') {
                continue;
            }
            $items[] = [
                'title' => (string)($item['snippet']['title'] ?? 'YouTube動画'),
                'url' => 'https://www.youtube.com/watch?v=' . rawurlencode((string)$videoId),
                'description' => (string)($item['snippet']['description'] ?? ''),
                'thumbnail' => (string)($item['snippet']['thumbnails']['medium']['url'] ?? ''),
                'source' => (string)($item['snippet']['channelTitle'] ?? 'YouTube'),
            ];
        }
    }

    if (!$items) {
        $items[] = [
            'title' => 'YouTubeで参考動画を検索: ' . $keywords,
            'url' => 'https://www.youtube.com/results?search_query=' . rawurlencode($keywords),
            'description' => 'YouTube APIキー未設定時の検索リンクです。',
            'thumbnail' => '',
            'source' => 'YouTube Search',
        ];
    }

    foreach ($items as $item) {
        insert_recommendation($userId, $taskId, 'youtube', $item);
    }
}

function save_book_recommendations(int $userId, int $taskId, string $keywords): void
{
    $url = 'https://www.googleapis.com/books/v1/volumes?' . http_build_query([
        'q' => $keywords,
        'maxResults' => 2,
        'langRestrict' => 'ja',
        'printType' => 'books',
    ]);
    $json = http_get_json($url);
    $items = [];

    foreach (($json['items'] ?? []) as $item) {
        $info = $item['volumeInfo'] ?? [];
        $title = (string)($info['title'] ?? '');
        if ($title === '') {
            continue;
        }
        $authors = implode(', ', $info['authors'] ?? []);
        $items[] = [
            'title' => $title,
            'url' => (string)($info['infoLink'] ?? 'https://books.google.com/'),
            'description' => mb_substr((string)($info['description'] ?? $authors), 0, 240),
            'thumbnail' => (string)($info['imageLinks']['thumbnail'] ?? ''),
            'source' => $authors !== '' ? $authors : 'Google Books',
        ];
    }

    if (!$items) {
        $items[] = [
            'title' => 'Google Booksで参考書籍を検索: ' . $keywords,
            'url' => 'https://www.google.com/search?tbm=bks&q=' . rawurlencode($keywords),
            'description' => '該当書籍が見つからない場合の検索リンクです。',
            'thumbnail' => '',
            'source' => 'Google Books Search',
        ];
    }

    foreach ($items as $item) {
        insert_recommendation($userId, $taskId, 'book', $item);
    }
}

function insert_recommendation(int $userId, int $taskId, string $type, array $item): void
{
    $stmt = db()->prepare(
        'INSERT INTO recommendations
         (user_id, task_id, type, title, url, description, thumbnail_url, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        $taskId,
        $type,
        mb_substr((string)$item['title'], 0, 255),
        (string)$item['url'],
        (string)$item['description'],
        (string)$item['thumbnail'],
        (string)$item['source'],
    ]);
}

function http_get_json(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $status >= 400) {
        return [];
    }

    $json = json_decode((string)$body, true);
    return is_array($json) ? $json : [];
}

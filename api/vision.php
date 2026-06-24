<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
$action = (string)($data['action'] ?? '');
$userId = current_user_id();

if ($action === 'load') {
    respond(['ok' => true, 'images' => load_vision_images($userId)]);
}

require_csrf($data);

if ($action === 'generate') {
    $aiResult = trim((string)($data['aiResult'] ?? ''));
    $cells = $data['cells'] ?? [];
    $taskIds = parse_task_ids($data['taskIds'] ?? []);

    if ($aiResult === '') {
        fail('先に30/60/90日プランを生成してください。');
    }

    if (!$taskIds) {
        fail('ビジョン画像に反映したいタスクを選択してください。');
    }

    $tasks = load_tasks_by_ids($userId, $taskIds);
    if (!$tasks) {
        fail('選択されたタスクが見つかりません。');
    }

    $cells = is_array($cells) ? $cells : [];
    $visionPrompt = build_vision_prompt($aiResult, $cells, $tasks);
    $visionPath = generate_background_image($visionPrompt, $userId, 'vision');
    $posterPath = create_svg_poster($visionPath, $userId, $cells, $tasks);
    $visionDiskPath = public_image_path_to_disk_path($visionPath);
    if ($visionDiskPath !== '' && is_file($visionDiskPath)) {
        @unlink($visionDiskPath);
    }

    $stmt = db()->prepare('INSERT INTO vision_images (user_id, prompt, image_path) VALUES (?, ?, ?)');
    $stmt->execute([$userId, '[統合ビジョン画像] ' . $visionPrompt, $posterPath]);

    respond(['ok' => true, 'images' => load_vision_images($userId)]);
}

if ($action === 'clear') {
    clear_vision_images($userId);
    respond(['ok' => true, 'images' => []]);
}

fail('未対応の操作です。', 404);

function clear_vision_images(int $userId): void
{
    $stmt = db()->prepare('SELECT image_path AS imagePath FROM vision_images WHERE user_id = ?');
    $stmt->execute([$userId]);

    foreach ($stmt->fetchAll() as $image) {
        $diskPath = public_image_path_to_disk_path((string)$image['imagePath']);
        if ($diskPath !== '' && is_file($diskPath)) {
            @unlink($diskPath);
        }
    }

    db()->prepare('DELETE FROM vision_images WHERE user_id = ?')->execute([$userId]);
}

function load_vision_images(int $userId): array
{
    $stmt = db()->prepare(
        'SELECT id, prompt, image_path AS imagePath, created_at AS createdAt
         FROM vision_images
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 12'
    );
    $stmt->execute([$userId]);

    $images = [];
    foreach ($stmt->fetchAll() as $image) {
        $diskPath = public_image_path_to_disk_path((string)$image['imagePath']);
        if (is_file($diskPath) && is_supported_vision_file($diskPath)) {
            $image['imagePath'] = normalize_public_image_path((string)$image['imagePath']);
            $images[] = $image;
        }
    }

    return $images;
}

function build_vision_prompt(string $aiResult, array $cells, array $tasks): string
{
    $goal = trim((string)($cells[40] ?? '90日目標達成'));
    $plan = mb_substr($aiResult, 0, 1600);
    $taskLines = array_map(
        fn (array $task): string => '- ' . (string)$task['title'] . ' / ' . (string)($task['description'] ?? ''),
        $tasks
    );

    return "Create an inspiring, emotionally vivid vision-board image for a 90-day action plan.\n"
        . "Important: do not include any text, letters, numbers, typography, captions, labels, signs, or writing. Use visual storytelling only.\n"
        . "Aspect ratio: landscape desktop wallpaper. Style: cinematic but clean, premium, energetic, practical, optimistic, not childish.\n"
        . "Use concrete visual metaphors for progress, focus, wealth-building, health, learning, execution, and habit formation.\n"
        . "Make it feel motivating enough to use as a room wallpaper or desktop wallpaper.\n"
        . "Do not use logos or copyrighted characters.\n\n"
        . "Main goal: {$goal}\n"
        . "Selected tasks:\n" . implode("\n", $taskLines) . "\n\n"
        . "Plan summary:\n{$plan}";
}

function load_tasks_by_ids(int $userId, array $taskIds): array
{
    $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
    $stmt = db()->prepare(
        'SELECT id, title, description, due_date AS dueDate, estimated_minutes AS estimatedMinutes,
                priority, status, source_phase AS sourcePhase
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

function generate_background_image(string $prompt, int $userId, string $prefix = 'vision'): string
{
    if (OPENAI_API_KEY === '' || str_starts_with(OPENAI_API_KEY, 'sk-proj-xxxxxxxx')) {
        fail('OpenAI APIキーを config/config.php に設定してください。');
    }

    $payload = [
        'model' => defined('OPENAI_IMAGE_MODEL') ? OPENAI_IMAGE_MODEL : 'gpt-image-1',
        'prompt' => $prompt,
        'size' => '1536x1024',
    ];

    $ch = curl_init('https://api.openai.com/v1/images/generations');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . OPENAI_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_TIMEOUT => 180,
    ]);

    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($body === false || $curlError !== '') {
        fail('画像生成APIとの通信に失敗しました: ' . $curlError, 502);
    }

    $json = json_decode((string)$body, true);
    if ($status >= 400 || !is_array($json)) {
        fail((string)($json['error']['message'] ?? '画像生成に失敗しました。'), 502);
    }

    $b64 = (string)($json['data'][0]['b64_json'] ?? '');
    if ($b64 === '' && !empty($json['data'][0]['url'])) {
        $image = download_image((string)$json['data'][0]['url']);
    } else {
        $image = base64_decode($b64, true);
    }

    if ($image === false || $image === '') {
        fail('画像データを取得できませんでした。', 502);
    }

    $imageInfo = @getimagesizefromstring($image);
    if ($imageInfo === false) {
        fail('生成結果を画像として読み込めませんでした。もう一度お試しください。', 502);
    }

    $extension = match ($imageInfo['mime'] ?? 'image/png') {
        'image/jpeg' => 'jpg',
        'image/webp' => 'webp',
        default => 'png',
    };

    $dir = __DIR__ . '/../uploads/visions';
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
        fail('画像保存フォルダを作成できませんでした。', 500);
    }

    if (!is_writable($dir)) {
        fail('画像保存フォルダに書き込み権限がありません: uploads/visions', 500);
    }

    $filename = $prefix . '-' . $userId . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $extension;
    $fullPath = $dir . '/' . $filename;
    if (file_put_contents($fullPath, $image) === false) {
        fail('画像ファイルの保存に失敗しました。', 500);
    }

    return 'uploads/visions/' . $filename;
}

function create_svg_poster(string $backgroundPath, int $userId, array $cells, array $tasks): string
{
    $dir = __DIR__ . '/../uploads/visions';
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
        fail('画像保存フォルダを作成できませんでした。', 500);
    }

    if (!is_writable($dir)) {
        fail('画像保存フォルダに書き込み権限がありません: uploads/visions', 500);
    }

    $goal = trim((string)($cells[40] ?? '90日目標達成'));
    $subtitle = '選んだ一手を積み上げる';
    $filename = 'vision-poster-' . $userId . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.svg';
    $fullPath = $dir . '/' . $filename;
    $backgroundDataUri = image_path_to_data_uri($backgroundPath);
    $cards = array_slice($tasks, 0, 6);
    $goalLines = wrap_japanese_text($goal, 18, 2);
    $goalFontSize = count($goalLines) > 1 ? 48 : 62;
    $titleStartY = count($goalLines) > 1 ? 82 : 104;
    $subtitleY = count($goalLines) > 1 ? 185 : 162;

    $svg = [];
    $svg[] = '<?xml version="1.0" encoding="UTF-8"?>';
    $svg[] = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">';
    $svg[] = '<defs>';
    $svg[] = '<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fffaf0"/><stop offset="100%" stop-color="#eef6ff"/></linearGradient>';
    $svg[] = '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#111827" flood-opacity="0.16"/></filter>';
    $svg[] = '</defs>';
    $svg[] = '<rect width="1536" height="1024" fill="url(#paper)"/>';
    $svg[] = '<image href="' . svg_escape($backgroundDataUri) . '" x="0" y="0" width="1536" height="1024" preserveAspectRatio="xMidYMid slice" opacity="0.48"/>';
    $svg[] = '<rect x="0" y="0" width="1536" height="1024" fill="#ffffff" opacity="0.46"/>';
    foreach ($goalLines as $index => $line) {
        $svg[] = '<text x="768" y="' . ($titleStartY + ($index * 58)) . '" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="' . $goalFontSize . '" font-weight="800" fill="#111827">' . svg_escape($line) . '</text>';
    }
    $svg[] = '<text x="768" y="' . $subtitleY . '" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="32" font-weight="700" fill="#334155">' . svg_escape($subtitle) . '</text>';

    $positions = [
        [64, 250],
        [558, 250],
        [1052, 250],
        [64, 602],
        [558, 602],
        [1052, 602],
    ];

    foreach ($cards as $index => $task) {
        [$x, $y] = $positions[$index];
        $titleLines = wrap_japanese_text((string)$task['title'], 11, 2);
        $descriptionLines = wrap_japanese_text((string)($task['description'] ?? ''), 18, 2);
        $phase = (string)($task['sourcePhase'] ?? 'ACTION');
        $dueDate = (string)($task['dueDate'] ?? '');
        $cardWidth = 420;
        $cardHeight = 262;
        $clipId = 'cardClip' . $index;

        $svg[] = '<clipPath id="' . $clipId . '"><rect x="' . ($x + 22) . '" y="' . ($y + 74) . '" width="' . ($cardWidth - 44) . '" height="' . ($cardHeight - 96) . '" rx="4"/></clipPath>';
        $svg[] = '<g filter="url(#shadow)">';
        $svg[] = '<rect x="' . $x . '" y="' . $y . '" width="' . $cardWidth . '" height="' . $cardHeight . '" rx="28" fill="#ffffff" opacity="0.94"/>';
        $svg[] = '</g>';
        $svg[] = '<rect x="' . ($x + 26) . '" y="' . ($y + 26) . '" width="96" height="32" rx="16" fill="#dbeafe"/>';
        $svg[] = '<text x="' . ($x + 74) . '" y="' . ($y + 49) . '" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="16" font-weight="800" fill="#1d4ed8">' . svg_escape($phase) . '</text>';

        if ($dueDate !== '') {
            $svg[] = '<text x="' . ($x + 394) . '" y="' . ($y + 49) . '" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="18" font-weight="700" fill="#64748b">' . svg_escape($dueDate) . '</text>';
        }

        $textY = $y + 105;
        $svg[] = '<g clip-path="url(#' . $clipId . ')">';
        foreach ($titleLines as $line) {
            $svg[] = '<text x="' . ($x + 34) . '" y="' . $textY . '" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="26" font-weight="800" fill="#111827">' . svg_escape($line) . '</text>';
            $textY += 35;
        }

        $textY += 12;
        foreach ($descriptionLines as $line) {
            $svg[] = '<text x="' . ($x + 34) . '" y="' . $textY . '" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="17" font-weight="600" fill="#475569">' . svg_escape($line) . '</text>';
            $textY += 26;
        }
        $svg[] = '</g>';
    }

    $svg[] = '<text x="768" y="970" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,&quot;Hiragino Sans&quot;,&quot;Yu Gothic&quot;,&quot;Noto Sans JP&quot;,sans-serif" font-size="24" font-weight="800" fill="#0f172a">今日の一手を、未来の標準にする。</text>';
    $svg[] = '</svg>';

    if (file_put_contents($fullPath, implode("\n", $svg)) === false) {
        fail('ビジョンポスターの保存に失敗しました。', 500);
    }

    return 'uploads/visions/' . $filename;
}

function download_image(string $url): string|false
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false || $status >= 400) {
        return false;
    }

    return (string)$body;
}

function image_path_to_data_uri(string $path): string
{
    $diskPath = public_image_path_to_disk_path($path);
    if ($diskPath === '' || !is_file($diskPath)) {
        fail('ビジョン画像の背景ファイルを読み込めませんでした。', 500);
    }

    $imageInfo = @getimagesize($diskPath);
    $mime = is_array($imageInfo) ? (string)($imageInfo['mime'] ?? 'image/png') : 'image/png';
    $data = file_get_contents($diskPath);
    if ($data === false || $data === '') {
        fail('ビジョン画像の背景データを読み込めませんでした。', 500);
    }

    return 'data:' . $mime . ';base64,' . base64_encode($data);
}

function normalize_public_image_path(string $path): string
{
    return ltrim($path, './');
}

function is_supported_vision_file(string $diskPath): bool
{
    if (strtolower(pathinfo($diskPath, PATHINFO_EXTENSION)) === 'svg') {
        return true;
    }

    return @getimagesize($diskPath) !== false;
}

function wrap_japanese_text(string $text, int $maxChars, int $maxLines): array
{
    $text = preg_replace('/\s+/u', ' ', trim($text));
    if ($text === '') {
        return [];
    }

    $lines = [];
    while (mb_strlen($text) > 0 && count($lines) < $maxLines) {
        $line = mb_substr($text, 0, $maxChars);
        $text = mb_substr($text, $maxChars);
        if (count($lines) === $maxLines - 1 && mb_strlen($text) > 0) {
            $line = rtrim(mb_substr($line, 0, max(1, $maxChars - 1))) . '…';
            $text = '';
        }
        $lines[] = $line;
    }

    return $lines;
}

function svg_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

function public_image_path_to_disk_path(string $path): string
{
    $path = normalize_public_image_path($path);
    if (!str_starts_with($path, 'uploads/visions/')) {
        return '';
    }

    return __DIR__ . '/../' . $path;
}

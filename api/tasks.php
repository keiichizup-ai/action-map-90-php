<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'ics') {
    output_ics(current_user_id(), parse_task_ids((string)($_GET['ids'] ?? '')));
}

$data = json_input();
$action = (string)($data['action'] ?? '');
$userId = current_user_id();

if ($action === 'load') {
    respond(['ok' => true, 'tasks' => load_tasks($userId)]);
}

require_csrf($data);

if ($action === 'decompose') {
    $aiResult = trim((string)($data['aiResult'] ?? ''));
    $cells = $data['cells'] ?? [];

    if ($aiResult === '') {
        fail('先に30/60/90日プランを生成してください。');
    }

    $tasks = generate_tasks_from_plan($aiResult, is_array($cells) ? $cells : []);
    save_tasks($userId, $tasks);
    respond(['ok' => true, 'tasks' => load_tasks($userId)]);
}

if ($action === 'update') {
    $taskId = (int)($data['taskId'] ?? 0);
    $status = (string)($data['status'] ?? 'todo');
    if (!in_array($status, ['todo', 'doing', 'done'], true)) {
        fail('ステータスが正しくありません。');
    }

    $stmt = db()->prepare('UPDATE action_tasks SET status = ? WHERE id = ? AND user_id = ?');
    $stmt->execute([$status, $taskId, $userId]);
    respond(['ok' => true, 'tasks' => load_tasks($userId)]);
}

if ($action === 'update_date') {
    $taskId = (int)($data['taskId'] ?? 0);
    $startDate = normalize_date($data['startDate'] ?? null);
    $dueDate = normalize_date($data['dueDate'] ?? null);
    if ($taskId <= 0) {
        fail('タスクが正しくありません。', 400);
    }
    if (!$startDate || !$dueDate) {
        fail('開始日と終了日を設定してください。', 400);
    }

    [$startDate, $dueDate] = normalize_date_range($startDate, $dueDate);

    $stmt = db()->prepare('UPDATE action_tasks SET start_date = ?, due_date = ? WHERE id = ? AND user_id = ?');
    $stmt->execute([$startDate, $dueDate, $taskId, $userId]);
    respond(['ok' => true, 'tasks' => load_tasks($userId)]);
}

if ($action === 'clear') {
    $stmt = db()->prepare('DELETE FROM action_tasks WHERE user_id = ?');
    $stmt->execute([$userId]);
    respond(['ok' => true, 'tasks' => []]);
}

fail('未対応の操作です。', 404);

function load_tasks(int $userId): array
{
    $stmt = db()->prepare(
        'SELECT id, title, description, start_date AS startDate, due_date AS dueDate, estimated_minutes AS estimatedMinutes,
                priority, status, source_phase AS sourcePhase, created_at AS createdAt
         FROM action_tasks
         WHERE user_id = ?
         ORDER BY status = "done", start_date IS NULL, start_date, due_date, sort_order, id'
    );
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function save_tasks(int $userId, array $tasks): void
{
    db()->beginTransaction();
    try {
        $delete = db()->prepare('DELETE FROM action_tasks WHERE user_id = ?');
        $delete->execute([$userId]);

        $insert = db()->prepare(
            'INSERT INTO action_tasks
             (user_id, title, description, start_date, due_date, estimated_minutes, priority, source_phase, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        foreach (array_slice($tasks, 0, 30) as $index => $task) {
            $startDate = default_task_start_date($index);
            $insert->execute([
                $userId,
                mb_substr((string)($task['title'] ?? '無題のタスク'), 0, 255),
                (string)($task['description'] ?? ''),
                $startDate,
                default_task_end_date($startDate),
                max(15, min(480, (int)($task['estimatedMinutes'] ?? 60))),
                normalize_priority((string)($task['priority'] ?? 'medium')),
                mb_substr((string)($task['sourcePhase'] ?? ''), 0, 32),
                $index + 1,
            ]);
        }

        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        fail('タスク保存に失敗しました。', 500);
    }
}

function generate_tasks_from_plan(string $aiResult, array $cells): array
{
    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $goal = trim((string)($cells[40] ?? ''));
    $prompt = "以下の30/60/90日プランを、実行可能なタスクに分解してください。\n"
        . "今日の日付は {$today} です。\n"
        . "大目標: {$goal}\n\n"
        . "条件:\n"
        . "- 12〜24個のタスクにする\n"
        . "- 各タスクは1〜3時間で着手できる粒度にする\n"
        . "- dueDateはYYYY-MM-DD\n"
        . "- priorityはhigh/medium/low\n"
        . "- sourcePhaseは30日/60日/90日のいずれか\n"
        . "- JSONだけを返す\n\n"
        . "返却形式:\n"
        . "{\"tasks\":[{\"title\":\"...\",\"description\":\"...\",\"dueDate\":\"YYYY-MM-DD\",\"estimatedMinutes\":60,\"priority\":\"high\",\"sourcePhase\":\"30日\"}]}\n\n"
        . "プラン:\n{$aiResult}";

    $json = call_openai_json($prompt, 3500);
    return is_array($json['tasks'] ?? null) ? $json['tasks'] : [];
}

function call_openai_json(string $prompt, int $maxTokens): array
{
    $text = call_openai_text($prompt, $maxTokens);
    $start = strpos($text, '{');
    $end = strrpos($text, '}');
    if ($start === false || $end === false || $end <= $start) {
        fail('AIからJSON形式の結果を取得できませんでした。');
    }

    $json = json_decode(substr($text, $start, $end - $start + 1), true);
    if (!is_array($json)) {
        fail('AIのJSON解析に失敗しました。');
    }

    return $json;
}

function call_openai_text(string $prompt, int $maxTokens): string
{
    if (OPENAI_API_KEY === '' || str_starts_with(OPENAI_API_KEY, 'sk-proj-xxxxxxxx')) {
        fail('OpenAI APIキーを config/config.php に設定してください。');
    }

    $payload = [
        'model' => OPENAI_MODEL,
        'input' => [[
            'role' => 'user',
            'content' => [['type' => 'input_text', 'text' => $prompt]],
        ]],
        'max_output_tokens' => $maxTokens,
    ];

    $ch = curl_init('https://api.openai.com/v1/responses');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . OPENAI_API_KEY,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_TIMEOUT => 90,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $json = json_decode((string)$body, true);
    if ($status >= 400 || !is_array($json)) {
        fail((string)($json['error']['message'] ?? 'OpenAI APIでエラーが発生しました。'), 502);
    }

    $texts = [];
    foreach (($json['output'] ?? []) as $item) {
        foreach (($item['content'] ?? []) as $content) {
            if (($content['type'] ?? '') === 'output_text') {
                $texts[] = (string)$content['text'];
            }
        }
    }

    return trim(implode("\n", $texts));
}

function normalize_date(mixed $value): ?string
{
    $date = DateTimeImmutable::createFromFormat('Y-m-d', (string)$value);
    return $date ? $date->format('Y-m-d') : null;
}

function normalize_date_range(string $startDate, string $dueDate): array
{
    if ($dueDate < $startDate) {
        $dueDate = $startDate;
    }

    return [$startDate, $dueDate];
}

function default_task_start_date(int $index): string
{
    $daysToAdd = $index % 7;
    return (new DateTimeImmutable('today'))
        ->modify('+' . $daysToAdd . ' days')
        ->format('Y-m-d');
}

function default_task_end_date(string $startDate): string
{
    return (new DateTimeImmutable($startDate))
        ->modify('+6 days')
        ->format('Y-m-d');
}

function normalize_priority(string $priority): string
{
    return in_array($priority, ['high', 'medium', 'low'], true) ? $priority : 'medium';
}

function output_ics(int $userId, array $taskIds): never
{
    if (!$taskIds) {
        fail('カレンダーに入れるタスクを選択してください。', 400);
    }

    $tasks = load_tasks_by_ids($userId, $taskIds);
    if (!$tasks) {
        fail('選択されたタスクが見つかりません。', 404);
    }

    $missingDateTitles = array_values(array_map(
        fn ($task) => (string)$task['title'],
        array_filter($tasks, fn ($task) => empty($task['startDate']) || empty($task['dueDate']))
    ));
    if ($missingDateTitles) {
        fail('ICSを作成するには、選択したタスクすべてに開始日と終了日を設定してください。未設定: ' . implode('、', array_slice($missingDateTitles, 0, 5)), 400);
    }

    $lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//ACTION MAP 90//Action Tasks//JA',
        'CALSCALE:GREGORIAN',
    ];

    foreach ($tasks as $task) {
        [$startDate, $dueDate] = normalize_date_range((string)$task['startDate'], (string)$task['dueDate']);
        $icsStartDate = str_replace('-', '', $startDate);
        $icsEndDate = (new DateTimeImmutable($dueDate))->modify('+1 day')->format('Ymd');
        $uid = 'action-map-90-' . $task['id'] . '@local';
        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:' . $uid;
        $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z');
        $lines[] = 'DTSTART;VALUE=DATE:' . $icsStartDate;
        $lines[] = 'DTEND;VALUE=DATE:' . $icsEndDate;
        $lines[] = 'SUMMARY:' . ics_escape((string)$task['title']);
        $lines[] = 'DESCRIPTION:' . ics_escape("期間: {$startDate} 〜 {$dueDate}\n" . (string)($task['description'] ?? ''));
        $lines[] = 'END:VEVENT';
    }

    $lines[] = 'END:VCALENDAR';

    header_remove('Content-Type');
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: attachment; filename="action-map-90-tasks.ics"');
    echo implode("\r\n", $lines) . "\r\n";
    exit;
}

function load_tasks_by_ids(int $userId, array $taskIds): array
{
    $taskIds = array_values(array_unique(array_filter($taskIds, fn ($id) => $id > 0)));
    if (!$taskIds) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
    $stmt = db()->prepare(
        "SELECT id, title, description, start_date AS startDate, due_date AS dueDate, estimated_minutes AS estimatedMinutes,
                priority, status, source_phase AS sourcePhase, created_at AS createdAt
         FROM action_tasks
         WHERE user_id = ?
         AND id IN ({$placeholders})
         ORDER BY start_date IS NULL, start_date, due_date, sort_order, id"
    );
    $stmt->execute(array_merge([$userId], $taskIds));
    return $stmt->fetchAll();
}

function parse_task_ids(string $ids): array
{
    return array_values(array_filter(
        array_map('intval', explode(',', $ids)),
        fn (int $id): bool => $id > 0
    ));
}

function ics_escape(string $value): string
{
    return str_replace(["\\", "\n", "\r", ",", ";"], ["\\\\", "\\n", '', "\\,", "\\;"], $value);
}

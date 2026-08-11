<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $downloadAction = (string)($_GET['action'] ?? '');
    if ($downloadAction === 'ics') {
        output_ics(current_user_id(), parse_task_ids((string)($_GET['ids'] ?? '')));
    }
    if ($downloadAction === 'csv') {
        output_tasks_csv(current_user_id(), parse_task_ids((string)($_GET['ids'] ?? '')));
    }
    if ($downloadAction === 'xls') {
        output_tasks_xls(current_user_id(), parse_task_ids((string)($_GET['ids'] ?? '')));
    }
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
    log_usage_event($userId, 'task_decompose', [
        'taskCount' => count($tasks),
    ]);
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

if ($action === 'update_details') {
    $taskId = (int)($data['taskId'] ?? 0);
    $title = trim((string)($data['title'] ?? ''));
    $status = (string)($data['status'] ?? 'todo');
    $startDate = normalize_date($data['startDate'] ?? null);
    $dueDate = normalize_date($data['dueDate'] ?? null);

    if ($taskId <= 0) {
        fail('タスクが正しくありません。', 400);
    }
    if ($title === '') {
        fail('タスク名を入力してください。', 400);
    }
    if (!in_array($status, ['todo', 'doing', 'done'], true)) {
        fail('ステータスが正しくありません。');
    }

    if ($startDate && !$dueDate) {
        $dueDate = $startDate;
    }
    if (!$startDate && $dueDate) {
        $startDate = $dueDate;
    }
    if ($startDate && $dueDate) {
        [$startDate, $dueDate] = normalize_date_range($startDate, $dueDate);
    }

    $stmt = db()->prepare(
        'UPDATE action_tasks
         SET title = ?, start_date = ?, due_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?'
    );
    $stmt->execute([mb_substr($title, 0, 255), $startDate, $dueDate, $status, $taskId, $userId]);
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
            $sourcePhase = normalize_source_phase((string)($task['sourcePhase'] ?? ''));
            $week = normalize_task_week($task['week'] ?? null, $sourcePhase, $index);
            $startDate = default_task_start_date_for_week($week);
            $insert->execute([
                $userId,
                mb_substr((string)($task['title'] ?? '無題のタスク'), 0, 255),
                (string)($task['description'] ?? ''),
                $startDate,
                default_task_end_date($startDate),
                max(15, min(480, (int)($task['estimatedMinutes'] ?? 60))),
                normalize_priority((string)($task['priority'] ?? 'medium')),
                mb_substr($sourcePhase, 0, 32),
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
        . "- titleは短く具体的にする\n"
        . "- descriptionはそのタスクでやることが分かる1〜2文にする\n"
        . "- weekは1〜12の整数にする。30日プランはWeek1〜4、60日プランはWeek5〜8、90日プランはWeek9〜12に割り当てる\n"
        . "- dueDateはYYYY-MM-DD形式にする。weekに対応する週の中で自然な日付にする\n"
        . "- estimatedMinutesは15〜480の整数にする\n"
        . "- priorityはhigh/medium/lowのいずれかにする\n"
        . "- sourcePhaseは30日/60日/90日のいずれかにする\n"
        . "- タスクは計画の流れに沿って、Week1からWeek12へ分散させる。一律で今日開始にしない\n\n"
        . "プラン:\n{$aiResult}";

    $json = call_openai_task_json($prompt, 5000);
    $tasks = normalize_ai_tasks($json);

    if (!$tasks) {
        fail('AIからタスクを取得できませんでした。もう一度「実行タスク化」をお試しください。');
    }

    return $tasks;
}

function task_decomposition_schema(): array
{
    return [
        'type' => 'object',
        'additionalProperties' => false,
        'properties' => [
            'tasks' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'additionalProperties' => false,
                    'properties' => [
                        'title' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'week' => [
                            'type' => 'integer',
                            'minimum' => 1,
                            'maximum' => 12,
                        ],
                        'dueDate' => ['type' => 'string'],
                        'estimatedMinutes' => ['type' => 'integer'],
                        'priority' => [
                            'type' => 'string',
                            'enum' => ['high', 'medium', 'low'],
                        ],
                        'sourcePhase' => [
                            'type' => 'string',
                            'enum' => ['30日', '60日', '90日'],
                        ],
                    ],
                    'required' => ['title', 'description', 'week', 'dueDate', 'estimatedMinutes', 'priority', 'sourcePhase'],
                ],
            ],
        ],
        'required' => ['tasks'],
    ];
}

function call_openai_task_json(string $prompt, int $maxTokens): array
{
    $schemaPayload = [
        'model' => OPENAI_MODEL,
        'input' => [[
            'role' => 'system',
            'content' => 'あなたはACTION MAP 90のタスク分解APIです。必ず指定されたJSONスキーマに合うデータだけを返してください。',
        ], [
            'role' => 'user',
            'content' => [['type' => 'input_text', 'text' => $prompt]],
        ]],
        'text' => [
            'format' => [
                'type' => 'json_schema',
                'name' => 'task_decomposition',
                'strict' => true,
                'schema' => task_decomposition_schema(),
            ],
        ],
        'max_output_tokens' => $maxTokens,
    ];

    $structured = openai_responses_request($schemaPayload);
    if ($structured['ok']) {
        $decoded = decode_json_from_ai_text(extract_openai_output_text($structured['json']));
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    // json_schemaを利用できないモデルや一時的なAPIエラーに備えたJSON形式フォールバックです。
    $fallbackPrompt = $prompt . "\n\n返却形式は必ず次のJSONオブジェクトだけにしてください。Markdown、説明文、コードブロックは禁止です。\n"
        . '{"tasks":[{"title":"...","description":"...","week":1,"dueDate":"YYYY-MM-DD","estimatedMinutes":60,"priority":"high","sourcePhase":"30日"}]}';

    $fallbackPayload = [
        'model' => OPENAI_MODEL,
        'input' => [[
            'role' => 'system',
            'content' => 'あなたはJSONだけを返すAPIです。説明文やMarkdownは返しません。',
        ], [
            'role' => 'user',
            'content' => [['type' => 'input_text', 'text' => $fallbackPrompt]],
        ]],
        'text' => [
            'format' => ['type' => 'json_object'],
        ],
        'max_output_tokens' => $maxTokens,
    ];

    $fallback = openai_responses_request($fallbackPayload);
    if ($fallback['ok']) {
        $decoded = decode_json_from_ai_text(extract_openai_output_text($fallback['json']));
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    $message = (string)($fallback['message'] ?: $structured['message'] ?: 'AIのJSON解析に失敗しました。');
    fail('AIのJSON解析に失敗しました。少し待って再実行してください。詳細: ' . mb_substr($message, 0, 240), 502);
}

function openai_responses_request(array $payload): array
{
    if (OPENAI_API_KEY === '' || str_starts_with(OPENAI_API_KEY, 'sk-proj-xxxxxxxx')) {
        fail('OpenAI APIキーを config/config.php に設定してください。');
    }

    $lastMessage = 'OpenAI APIでエラーが発生しました。';

    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $ch = curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . OPENAI_API_KEY,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_TIMEOUT => 120,
        ]);

        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($body === false || $curlError !== '') {
            $lastMessage = $curlError !== '' ? $curlError : $lastMessage;
            if ($attempt < 3) {
                usleep(600000 * $attempt);
                continue;
            }
            return ['ok' => false, 'json' => null, 'message' => $lastMessage, 'status' => $status];
        }

        $json = json_decode((string)$body, true);
        if ($status < 400 && is_array($json)) {
            return ['ok' => true, 'json' => $json, 'message' => '', 'status' => $status];
        }

        $lastMessage = is_array($json)
            ? (string)($json['error']['message'] ?? $lastMessage)
            : $lastMessage;

        if ($attempt < 3 && ($status === 429 || $status >= 500 || str_contains($lastMessage, 'An error occurred'))) {
            usleep(700000 * $attempt);
            continue;
        }

        return ['ok' => false, 'json' => $json, 'message' => $lastMessage, 'status' => $status];
    }

    return ['ok' => false, 'json' => null, 'message' => $lastMessage, 'status' => 0];
}

function extract_openai_output_text(?array $json): string
{
    if (!is_array($json)) {
        return '';
    }

    $texts = [];
    foreach (($json['output'] ?? []) as $item) {
        foreach (($item['content'] ?? []) as $content) {
            if (($content['type'] ?? '') === 'output_text' && isset($content['text'])) {
                $texts[] = (string)$content['text'];
            }
        }
    }

    if (!$texts && isset($json['output_text'])) {
        $texts[] = (string)$json['output_text'];
    }

    return trim(implode("\n", $texts));
}

function decode_json_from_ai_text(string $text): ?array
{
    $text = trim(preg_replace('/^\xEF\xBB\xBF/', '', $text) ?? $text);

    if (preg_match('/```(?:json)?\s*(.*?)\s*```/is', $text, $matches)) {
        $text = trim($matches[1]);
    }

    $decoded = json_decode($text, true);
    if (is_array($decoded)) {
        return $decoded;
    }

    $start = strpos($text, '{');
    $end = strrpos($text, '}');
    if ($start !== false && $end !== false && $end > $start) {
        $candidate = substr($text, $start, $end - $start + 1);
        $decoded = json_decode($candidate, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    return null;
}

function normalize_ai_tasks(array $json): array
{
    $items = $json['tasks'] ?? [];
    if (!is_array($items)) {
        return [];
    }

    $tasks = [];
    foreach (array_slice($items, 0, 30) as $task) {
        if (!is_array($task)) {
            continue;
        }

        $title = trim((string)($task['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $description = trim((string)($task['description'] ?? ''));
        $estimatedMinutes = max(15, min(480, (int)($task['estimatedMinutes'] ?? 60)));
        $priority = normalize_priority((string)($task['priority'] ?? 'medium'));
        $sourcePhase = normalize_source_phase((string)($task['sourcePhase'] ?? ''));
        $week = normalize_task_week($task['week'] ?? null, $sourcePhase, count($tasks));
        $dueDate = normalize_date($task['dueDate'] ?? null)
            ?: default_task_end_date(default_task_start_date_for_week($week));

        $tasks[] = [
            'title' => $title,
            'description' => $description,
            'week' => $week,
            'dueDate' => $dueDate,
            'estimatedMinutes' => $estimatedMinutes,
            'priority' => $priority,
            'sourcePhase' => $sourcePhase,
        ];
    }

    return $tasks;
}

function normalize_source_phase(string $sourcePhase): string
{
    if (str_contains($sourcePhase, '30')) {
        return '30日';
    }
    if (str_contains($sourcePhase, '60')) {
        return '60日';
    }
    if (str_contains($sourcePhase, '90')) {
        return '90日';
    }
    return '30日';
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

function normalize_task_week(mixed $week, string $sourcePhase, int $index): int
{
    $weekNumber = (int)$week;
    if ($weekNumber >= 1 && $weekNumber <= 12) {
        return $weekNumber;
    }

    if (str_contains($sourcePhase, '60')) {
        return 5 + ($index % 4);
    }

    if (str_contains($sourcePhase, '90')) {
        return 9 + ($index % 4);
    }

    return 1 + ($index % 4);
}

function default_task_start_date_for_week(int $week): string
{
    $week = max(1, min(12, $week));
    $daysToAdd = ($week - 1) * 7;
    return (new DateTimeImmutable('today'))
        ->modify('+' . $daysToAdd . ' days')
        ->format('Y-m-d');
}

function default_task_start_date(int $index): string
{
    return default_task_start_date_for_week(1 + ($index % 12));
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

function output_tasks_csv(int $userId, array $taskIds): never
{
    $tasks = load_tasks_for_export($userId, $taskIds);
    if (!$tasks) {
        fail('ダウンロードするタスクがありません。', 404);
    }

    header_remove('Content-Type');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="action-map-90-gantt.csv"');

    $out = fopen('php://output', 'w');
    if ($out === false) {
        fail('CSVの作成に失敗しました。', 500);
    }

    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['タスク名', '説明', '開始日', '終了日', 'ステータス', '優先度', 'フェーズ', '見積分']);
    foreach ($tasks as $task) {
        fputcsv($out, [
            (string)$task['title'],
            (string)($task['description'] ?? ''),
            (string)($task['startDate'] ?? ''),
            (string)($task['dueDate'] ?? ''),
            status_label((string)($task['status'] ?? 'todo')),
            priority_label((string)($task['priority'] ?? 'medium')),
            (string)($task['sourcePhase'] ?? ''),
            (string)($task['estimatedMinutes'] ?? ''),
        ]);
    }

    fclose($out);
    exit;
}

function output_tasks_xls(int $userId, array $taskIds): never
{
    $tasks = load_tasks_for_export($userId, $taskIds);
    if (!$tasks) {
        fail('ダウンロードするタスクがありません。', 404);
    }

    $datedTasks = array_values(array_filter($tasks, fn ($task) => !empty($task['startDate']) || !empty($task['dueDate'])));
    $minDate = null;
    $maxDate = null;
    foreach ($datedTasks as $task) {
        $start = normalize_date($task['startDate'] ?? null) ?: normalize_date($task['dueDate'] ?? null);
        $end = normalize_date($task['dueDate'] ?? null) ?: $start;
        if (!$start || !$end) {
            continue;
        }
        if ($end < $start) {
            $end = $start;
        }
        $minDate = $minDate === null || $start < $minDate ? $start : $minDate;
        $maxDate = $maxDate === null || $end > $maxDate ? $end : $maxDate;
    }

    $dates = [];
    if ($minDate && $maxDate) {
        $startObj = new DateTimeImmutable($minDate);
        $endObj = new DateTimeImmutable($maxDate);
        $maxDays = 120;
        for ($cursor = $startObj, $i = 0; $cursor <= $endObj && $i < $maxDays; $cursor = $cursor->modify('+1 day'), $i++) {
            $dates[] = $cursor->format('Y-m-d');
        }
    }

    header_remove('Content-Type');
    header('Content-Type: application/vnd.ms-excel; charset=utf-8');
    header('Content-Disposition: attachment; filename="action-map-90-gantt.xls"');

    echo "\xEF\xBB\xBF";
    echo '<!doctype html><html><head><meta charset="utf-8"><style>';
    echo 'body{font-family:Arial,"Yu Gothic",sans-serif}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;font-size:12px}th{background:#dbeafe}.bar{background:#93c5fd}.done{background:#bbf7d0}.doing{background:#fde68a}.todo{background:#bfdbfe}.note{color:#555}';
    echo '</style></head><body>';
    echo '<h1>ACTION MAP 90 ガントチャート</h1>';
    echo '<p class="note">Excel互換HTML形式です。必要に応じてExcelで開いて編集・保存してください。</p>';
    echo '<table>';
    echo '<tr><th>タスク名</th><th>開始日</th><th>終了日</th><th>ステータス</th><th>優先度</th><th>フェーズ</th><th>説明</th>';
    foreach ($dates as $date) {
        echo '<th>' . h_excel(substr($date, 5)) . '</th>';
    }
    echo '</tr>';

    foreach ($tasks as $task) {
        $start = normalize_date($task['startDate'] ?? null) ?: normalize_date($task['dueDate'] ?? null);
        $end = normalize_date($task['dueDate'] ?? null) ?: $start;
        if ($start && $end && $end < $start) {
            $end = $start;
        }
        $status = (string)($task['status'] ?? 'todo');

        echo '<tr>';
        echo '<td>' . h_excel((string)$task['title']) . '</td>';
        echo '<td>' . h_excel((string)($task['startDate'] ?? '')) . '</td>';
        echo '<td>' . h_excel((string)($task['dueDate'] ?? '')) . '</td>';
        echo '<td>' . h_excel(status_label($status)) . '</td>';
        echo '<td>' . h_excel(priority_label((string)($task['priority'] ?? 'medium'))) . '</td>';
        echo '<td>' . h_excel((string)($task['sourcePhase'] ?? '')) . '</td>';
        echo '<td>' . h_excel((string)($task['description'] ?? '')) . '</td>';

        foreach ($dates as $date) {
            $isActive = $start && $end && $date >= $start && $date <= $end;
            echo $isActive
                ? '<td class="' . h_excel($status) . '">■</td>'
                : '<td></td>';
        }
        echo '</tr>';
    }

    echo '</table></body></html>';
    exit;
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

function load_tasks_for_export(int $userId, array $taskIds): array
{
    if ($taskIds) {
        return load_tasks_by_ids($userId, $taskIds);
    }

    return load_tasks($userId);
}

function status_label(string $status): string
{
    return [
        'todo' => '未着手',
        'doing' => '進行中',
        'done' => '完了',
    ][$status] ?? '未着手';
}

function priority_label(string $priority): string
{
    return [
        'high' => '高',
        'medium' => '中',
        'low' => '低',
    ][$priority] ?? '中';
}

function h_excel(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
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

<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/task_activity.php';

$data = json_input();
$userId = current_user_id();
$action = (string)($data['action'] ?? 'load');

if ($action === 'load') {
    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $checkin = load_checkin($userId, $today);
    respond([
        'ok' => true,
        'today' => $today,
        'todayTaskIds' => load_today_task_ids($userId, $today),
        'checkin' => $checkin,
        'journal' => load_journal($userId, $today),
        'history' => load_history($userId),
    ]);
}

require_csrf($data);

if ($action === 'save_checkin') {
    $date = normalize_date((string)($data['date'] ?? ''));
    $mood = normalize_mood($data['mood'] ?? 3);
    $focusMinutes = max(5, min(480, (int)($data['focusMinutes'] ?? 30)));
    $concern = mb_substr(trim((string)($data['concern'] ?? '')), 0, 2000);
    $taskIds = normalize_ids($data['taskIds'] ?? []);
    $taskIds = allowed_today_task_ids($userId, $date, $taskIds);
    $goal = load_main_goal($userId);
    $taskTitles = load_task_titles($userId, $taskIds);
    $aiMessage = coach_message('morning', $goal, $mood, $focusMinutes, $concern, $taskTitles, []);

    $stmt = db()->prepare(
        'INSERT INTO daily_checkins (user_id, checkin_date, mood, focus_minutes, concern, selected_task_ids, ai_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mood=VALUES(mood), focus_minutes=VALUES(focus_minutes), concern=VALUES(concern), selected_task_ids=VALUES(selected_task_ids), ai_message=VALUES(ai_message), updated_at=CURRENT_TIMESTAMP'
    );
    $stmt->execute([$userId, $date, $mood, $focusMinutes, $concern, json_encode($taskIds), $aiMessage]);
    log_usage_event($userId, 'daily_checkin', ['date' => $date, 'taskCount' => count($taskIds)]);
    respond(['ok' => true, 'checkin' => load_checkin($userId, $date)]);
}

if ($action === 'save_journal') {
    $date = normalize_date((string)($data['date'] ?? ''));
    $mood = normalize_mood($data['mood'] ?? 3);
    $completedText = mb_substr(trim((string)($data['completedText'] ?? '')), 0, 3000);
    $problemText = mb_substr(trim((string)($data['problemText'] ?? '')), 0, 3000);
    $reasonCode = normalize_option((string)($data['reasonCode'] ?? ''), ['none','time','motivation','difficulty','interrupt','priority','other']);
    $freeText = mb_substr(trim((string)($data['freeText'] ?? '')), 0, 5000);
    $tomorrowAction = normalize_option((string)($data['tomorrowAction'] ?? ''), ['continue','smaller','reschedule','consult']);
    $completedTaskIds = normalize_ids($data['completedTaskIds'] ?? []);
    $completedTaskIds = allowed_checkin_task_ids($userId, $date, $completedTaskIds);
    $goal = load_main_goal($userId);
    $taskTitles = load_task_titles($userId, $completedTaskIds);
    $recent = load_history($userId, 5);
    $aiFeedback = coach_message('evening', $goal, $mood, 0, $problemText, $taskTitles, [
        'completedText' => $completedText,
        'reasonCode' => $reasonCode,
        'freeText' => $freeText,
        'tomorrowAction' => $tomorrowAction,
        'recent' => $recent,
    ]);

    $stmt = db()->prepare(
        'INSERT INTO daily_journals (user_id, journal_date, mood, completed_text, problem_text, reason_code, free_text, tomorrow_action, completed_task_ids, ai_feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mood=VALUES(mood), completed_text=VALUES(completed_text), problem_text=VALUES(problem_text), reason_code=VALUES(reason_code), free_text=VALUES(free_text), tomorrow_action=VALUES(tomorrow_action), completed_task_ids=VALUES(completed_task_ids), ai_feedback=VALUES(ai_feedback), updated_at=CURRENT_TIMESTAMP'
    );
    $stmt->execute([$userId, $date, $mood, $completedText, $problemText, $reasonCode, $freeText, $tomorrowAction, json_encode($completedTaskIds), $aiFeedback]);

    foreach ($completedTaskIds as $completedTaskId) {
        update_owned_task_with_activity($userId, $completedTaskId, ['status' => 'done']);
    }

    log_usage_event($userId, 'daily_journal', ['date' => $date, 'completedTaskCount' => count($completedTaskIds)]);
    respond(['ok' => true, 'journal' => load_journal($userId, $date), 'history' => load_history($userId)]);
}

fail('未対応の操作です。', 404);

function normalize_date(string $date): string {
    $candidate = DateTimeImmutable::createFromFormat('Y-m-d', $date);
    return $candidate && $candidate->format('Y-m-d') === $date ? $date : (new DateTimeImmutable('today'))->format('Y-m-d');
}
function normalize_mood(mixed $value): int { return max(1, min(5, (int)$value)); }
function normalize_ids(mixed $ids): array {
    if (!is_array($ids)) return [];
    return array_values(array_unique(array_filter(array_map('intval', $ids), fn($id) => $id > 0)));
}
function normalize_option(string $value, array $allowed): string { return in_array($value, $allowed, true) ? $value : $allowed[0]; }
function decode_ids(mixed $json): array {
    $ids = is_string($json) ? json_decode($json, true) : $json;
    return normalize_ids($ids);
}
function load_today_task_ids(int $userId, string $date): array {
    $stmt = db()->prepare(
        "SELECT id
         FROM action_tasks
         WHERE user_id = ?
           AND status <> 'done'
           AND start_date IS NOT NULL
           AND due_date IS NOT NULL
           AND start_date <= ?
           AND due_date >= ?
         ORDER BY priority = 'high' DESC, start_date, due_date, sort_order, id"
    );
    $stmt->execute([$userId, $date, $date]);
    return array_map('intval', array_column($stmt->fetchAll(), 'id'));
}

function allowed_today_task_ids(int $userId, string $date, array $requestedIds): array {
    if (!$requestedIds) {
        return [];
    }
    $allowed = array_flip(load_today_task_ids($userId, $date));
    return array_values(array_filter($requestedIds, fn(int $id): bool => isset($allowed[$id])));
}

function allowed_checkin_task_ids(int $userId, string $date, array $requestedIds): array {
    if (!$requestedIds) {
        return [];
    }
    $checkin = load_checkin($userId, $date);
    $allowed = array_flip($checkin['taskIds'] ?? []);
    return array_values(array_filter($requestedIds, fn(int $id): bool => isset($allowed[$id])));
}

function load_checkin(int $userId, ?string $date = null): ?array {
    $date ??= (new DateTimeImmutable('today'))->format('Y-m-d');
    $stmt = db()->prepare('SELECT checkin_date AS date, mood, focus_minutes AS focusMinutes, concern, selected_task_ids AS taskIds, ai_message AS aiMessage FROM daily_checkins WHERE user_id=? AND checkin_date=?');
    $stmt->execute([$userId, $date]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['mood'] = (int)$row['mood']; $row['focusMinutes'] = (int)$row['focusMinutes']; $row['taskIds'] = decode_ids($row['taskIds']);
    return $row;
}
function load_journal(int $userId, ?string $date = null): ?array {
    $date ??= (new DateTimeImmutable('today'))->format('Y-m-d');
    $stmt = db()->prepare('SELECT journal_date AS date, mood, completed_text AS completedText, problem_text AS problemText, reason_code AS reasonCode, free_text AS freeText, tomorrow_action AS tomorrowAction, completed_task_ids AS completedTaskIds, ai_feedback AS aiFeedback FROM daily_journals WHERE user_id=? AND journal_date=?');
    $stmt->execute([$userId, $date]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['mood'] = (int)$row['mood']; $row['completedTaskIds'] = decode_ids($row['completedTaskIds']);
    return $row;
}
function load_history(int $userId, int $limit = 14): array {
    $limit = max(1, min(30, $limit));
    $stmt = db()->prepare("SELECT journal_date AS date, mood, completed_text AS completedText, problem_text AS problemText, ai_feedback AS aiFeedback FROM daily_journals WHERE user_id=? ORDER BY journal_date DESC LIMIT {$limit}");
    $stmt->execute([$userId]);
    return array_map(function($row){ $row['mood']=(int)$row['mood']; return $row; }, $stmt->fetchAll());
}
function load_main_goal(int $userId): string {
    $stmt = db()->prepare("SELECT cells FROM mandala_charts WHERE user_id=? AND chart_key='default' LIMIT 1");
    $stmt->execute([$userId]);
    $cells = json_decode((string)($stmt->fetchColumn() ?: '[]'), true);
    return trim((string)($cells[40] ?? '未設定'));
}
function load_task_titles(int $userId, array $ids): array {
    if (!$ids) return [];
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare("SELECT title FROM action_tasks WHERE user_id=? AND id IN ($marks)");
    $stmt->execute(array_merge([$userId], $ids));
    return array_column($stmt->fetchAll(), 'title');
}
function coach_message(string $mode, string $goal, int $mood, int $focusMinutes, string $concern, array $tasks, array $extra): string {
    $taskText = $tasks ? implode('、', $tasks) : '未選択';
    if ($mode === 'morning') {
        $prompt = "あなたはACTION MAP 90の専属AIコーチです。日本語で、押し付けず温かく、2〜3文だけ返してください。具体的な最初の一歩を1つ含めます。\n大目標: {$goal}\n気分(1〜5): {$mood}\n集中予定: {$focusMinutes}分\n今日のタスク: {$taskText}\n相談: {$concern}";
    } else {
        $prompt = "あなたはACTION MAP 90の専属AIコーチです。日本語で、1)具体的に承認、2)障害を責めずに整理、3)明日の15分以内の一歩、の順で3〜4文だけ返してください。質問で終わらないでください。\n大目標: {$goal}\n気分(1〜5): {$mood}\n完了タスク: {$taskText}\nできたこと: ".($extra['completedText']??'')."\n困ったこと: {$concern}\n未完理由: ".($extra['reasonCode']??'')."\n日記: ".($extra['freeText']??'')."\n明日の方針: ".($extra['tomorrowAction']??'');
    }
    return call_coach_openai($prompt);
}
function call_coach_openai(string $prompt): string {
    if (OPENAI_API_KEY === '' || str_starts_with(OPENAI_API_KEY, 'sk-proj-xxxxxxxx')) return '記録できました。今日は小さな一歩を積み重ねられています。明日は最優先タスクを15分だけ始めましょう。';
    $payload = ['model'=>OPENAI_MODEL,'input'=>[['role'=>'user','content'=>[['type'=>'input_text','text'=>$prompt]]]],'max_output_tokens'=>350];
    $ch = curl_init('https://api.openai.com/v1/responses');
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_HTTPHEADER=>['Authorization: Bearer '.OPENAI_API_KEY,'Content-Type: application/json'],CURLOPT_POSTFIELDS=>json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),CURLOPT_TIMEOUT=>60]);
    $body=curl_exec($ch); $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    if (!$body || $status<200 || $status>=300) return '記録できました。完璧でなくても、振り返ったこと自体が前進です。明日は最初の15分だけ取り組みましょう。';
    $json=json_decode($body,true); $parts=[];
    foreach (($json['output']??[]) as $item) foreach (($item['content']??[]) as $content) if (($content['type']??'')==='output_text') $parts[]=$content['text']??'';
    return trim(implode("\n",$parts)) ?: '記録できました。今日の前進を明日につなげましょう。';
}

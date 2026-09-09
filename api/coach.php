<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/task_activity.php';
require_once __DIR__ . '/coach_context.php';
require_once __DIR__ . '/coach_response.php';

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
    $relevantTasks = load_owned_task_details($userId, $taskIds);
    $context = buildCoachContext($userId, coach_context_date($date));
    $aiResponse = generateCoachResponse($userId, 'morning', $context, [
        'date' => $date,
        'mood' => $mood,
        'focus_minutes' => $focusMinutes,
        'concern' => $concern,
        'relevant_tasks' => $relevantTasks,
    ]);
    $aiMessage = (string)$aiResponse['coach_message'];
    $aiResponseJson = json_encode($aiResponse, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

    $stmt = db()->prepare(
        'INSERT INTO daily_checkins (user_id, checkin_date, mood, focus_minutes, concern, selected_task_ids, ai_message, ai_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mood=VALUES(mood), focus_minutes=VALUES(focus_minutes), concern=VALUES(concern), selected_task_ids=VALUES(selected_task_ids), ai_message=VALUES(ai_message), ai_response=VALUES(ai_response), updated_at=CURRENT_TIMESTAMP'
    );
    $stmt->execute([$userId, $date, $mood, $focusMinutes, $concern, json_encode($taskIds), $aiMessage, $aiResponseJson]);
    log_usage_event($userId, 'daily_checkin', [
        'date' => $date,
        'taskCount' => count($taskIds),
        'questionType' => $aiResponse['question_type'],
    ]);
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
    $checkin = load_checkin($userId, $date);
    $plannedTaskIds = $checkin['taskIds'] ?? [];
    $relevantTasks = load_owned_task_details($userId, $plannedTaskIds);
    $plannedCount = count($plannedTaskIds);
    $completedCount = count($completedTaskIds);
    $completionRate = $plannedCount > 0 ? (int)round(($completedCount / $plannedCount) * 100) : 0;
    $reflection = implode(' / ', array_values(array_unique(array_filter(
        [$completedText, $problemText, $freeText],
        static fn(string $value): bool => $value !== ''
    ))));
    $context = buildCoachContext($userId, coach_context_date($date));
    $aiResponse = generateCoachResponse($userId, 'evening', $context, [
        'date' => $date,
        'mood' => $mood,
        'problem_text' => $problemText,
        'reason_code' => $reasonCode,
        'reflection' => mb_substr($reflection, 0, 500),
        'tomorrow_action' => $tomorrowAction,
        'planned_task_ids' => $plannedTaskIds,
        'completed_task_ids' => $completedTaskIds,
        'planned_count' => $plannedCount,
        'completed_count' => $completedCount,
        'completion_rate' => $completionRate,
        'relevant_tasks' => $relevantTasks,
    ]);
    $aiFeedback = (string)$aiResponse['coach_message'];
    $aiResponseJson = json_encode($aiResponse, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

    $stmt = db()->prepare(
        'INSERT INTO daily_journals (user_id, journal_date, mood, completed_text, problem_text, reason_code, free_text, tomorrow_action, completed_task_ids, ai_feedback, ai_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mood=VALUES(mood), completed_text=VALUES(completed_text), problem_text=VALUES(problem_text), reason_code=VALUES(reason_code), free_text=VALUES(free_text), tomorrow_action=VALUES(tomorrow_action), completed_task_ids=VALUES(completed_task_ids), ai_feedback=VALUES(ai_feedback), ai_response=VALUES(ai_response), updated_at=CURRENT_TIMESTAMP'
    );
    $stmt->execute([$userId, $date, $mood, $completedText, $problemText, $reasonCode, $freeText, $tomorrowAction, json_encode($completedTaskIds), $aiFeedback, $aiResponseJson]);

    foreach ($completedTaskIds as $completedTaskId) {
        update_owned_task_with_activity($userId, $completedTaskId, ['status' => 'done']);
    }

    log_usage_event($userId, 'daily_journal', [
        'date' => $date,
        'completedTaskCount' => $completedCount,
        'plannedTaskCount' => $plannedCount,
        'questionType' => $aiResponse['question_type'],
    ]);
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
    $stmt = db()->prepare('SELECT checkin_date AS date, mood, focus_minutes AS focusMinutes, concern, selected_task_ids AS taskIds, ai_message AS aiMessage, ai_response AS aiResponse FROM daily_checkins WHERE user_id=? AND checkin_date=?');
    $stmt->execute([$userId, $date]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['mood'] = (int)$row['mood']; $row['focusMinutes'] = (int)$row['focusMinutes']; $row['taskIds'] = decode_ids($row['taskIds']); $row['aiResponse'] = decode_ai_response($row['aiResponse'] ?? null);
    return $row;
}
function load_journal(int $userId, ?string $date = null): ?array {
    $date ??= (new DateTimeImmutable('today'))->format('Y-m-d');
    $stmt = db()->prepare('SELECT journal_date AS date, mood, completed_text AS completedText, problem_text AS problemText, reason_code AS reasonCode, free_text AS freeText, tomorrow_action AS tomorrowAction, completed_task_ids AS completedTaskIds, ai_feedback AS aiFeedback, ai_response AS aiResponse FROM daily_journals WHERE user_id=? AND journal_date=?');
    $stmt->execute([$userId, $date]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['mood'] = (int)$row['mood']; $row['completedTaskIds'] = decode_ids($row['completedTaskIds']); $row['aiResponse'] = decode_ai_response($row['aiResponse'] ?? null);
    return $row;
}
function load_history(int $userId, int $limit = 14): array {
    $limit = max(1, min(30, $limit));
    $stmt = db()->prepare("SELECT journal_date AS date, mood, completed_text AS completedText, problem_text AS problemText, ai_feedback AS aiFeedback, ai_response AS aiResponse FROM daily_journals WHERE user_id=? ORDER BY journal_date DESC LIMIT {$limit}");
    $stmt->execute([$userId]);
    return array_map(function($row){ $row['mood']=(int)$row['mood']; $row['aiResponse']=decode_ai_response($row['aiResponse']??null); return $row; }, $stmt->fetchAll());
}
function decode_ai_response(mixed $json): ?array {
    if (is_array($json)) return $json;
    $decoded = is_string($json) && $json !== '' ? json_decode($json, true) : null;
    return is_array($decoded) ? $decoded : null;
}
function coach_context_date(string $date): DateTimeImmutable {
    return DateTimeImmutable::createFromFormat('!Y-m-d', $date) ?: new DateTimeImmutable('today');
}
function load_owned_task_details(int $userId, array $ids): array {
    $ids = normalize_ids($ids);
    if (!$ids) return [];
    $marks = implode(',', array_fill(0, count($ids), '?'));
    $stmt = db()->prepare("SELECT id, title, start_date, due_date, priority, status FROM action_tasks WHERE user_id=? AND id IN ($marks)");
    $stmt->execute(array_merge([$userId], $ids));
    $byId = [];
    foreach ($stmt->fetchAll() as $row) {
        $row['id'] = (int)$row['id'];
        $byId[$row['id']] = $row;
    }
    return array_values(array_filter(array_map(
        static fn(int $id): ?array => $byId[$id] ?? null,
        $ids
    )));
}

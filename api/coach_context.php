<?php
declare(strict_types=1);

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

if (!defined('COACH_CONTEXT_SKIP_BOOTSTRAP')) {
    require_once __DIR__ . '/bootstrap.php';
}

const COACH_BEHAVIOR_THRESHOLDS = [
    'repeated_postponement_count' => 3,
    'low_completion_rate' => 40,
    'good_momentum_rate' => 80,
    'possible_overload_target_count' => 8,
    'postponement_lookback_days' => 30,
];

const COACH_QUESTION_TYPES = ['WHY', 'OBSTACLE', 'NEXT_STEP', 'START_SMALL', 'SUCCESS'];

function buildCoachContext(int $userId, ?DateTimeImmutable $now = null): array
{
    if ($userId <= 0) {
        throw new InvalidArgumentException('userId must be positive.');
    }

    return (new CoachContextBuilder(db()))->build($userId, $now);
}

function validateCoachTargetTaskId(int $userId, mixed $targetTaskId): ?array
{
    $taskId = filter_var($targetTaskId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($userId <= 0 || $taskId === false) {
        return null;
    }

    return (new CoachContextBuilder(db()))->findOwnedTask($userId, (int)$taskId);
}

final class CoachContextBuilder
{
    public function __construct(private PDO $pdo)
    {
    }

    public function build(int $userId, ?DateTimeImmutable $now = null): array
    {
        if ($userId <= 0) {
            throw new InvalidArgumentException('userId must be positive.');
        }

        $now ??= new DateTimeImmutable('now');
        $today = $now->setTime(0, 0);
        $todayString = $today->format('Y-m-d');
        $windowStart = $today->modify('-6 days')->format('Y-m-d');
        $behaviorWindowStart = $today
            ->modify('-' . (COACH_BEHAVIOR_THRESHOLDS['postponement_lookback_days'] - 1) . ' days')
            ->format('Y-m-d');
        $behaviorWindowEnd = $today->modify('+1 day')->format('Y-m-d');

        $goal = $this->loadGoal($userId, $today);
        $todayTasks = $this->loadTodayTasks($userId, $todayString);
        $incompleteTasks = $this->loadIncompleteTasks($userId);
        $progress = $this->loadProgress($userId, $windowStart, $todayString);
        $repeatedTasks = $this->loadRepeatedlyPostponedTasks($userId, $behaviorWindowStart, $behaviorWindowEnd);
        $postponedCount = $this->loadPostponedCount($userId, $behaviorWindowStart, $behaviorWindowEnd);
        $signals = buildCoachBehaviorSignals($progress, $repeatedTasks);

        return [
            'goal' => $goal,
            'today' => [
                'date' => $todayString,
                'tasks' => $todayTasks,
                'incomplete_tasks' => $incompleteTasks,
            ],
            'progress' => $progress,
            'behavior' => [
                'window_start' => $behaviorWindowStart,
                'window_end' => $todayString,
                'postponed_count' => $postponedCount,
                'repeatedly_postponed_tasks' => $repeatedTasks,
                'signals' => $signals,
            ],
            'reflection' => $this->loadRecentJournals($userId, $todayString),
            'coaching' => $this->loadRecentCoachResponses($userId, $todayString),
        ];
    }

    public function findOwnedTask(int $userId, int $taskId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, title, start_date, due_date, priority, status
             FROM action_tasks
             WHERE user_id = ? AND id = ?
             LIMIT 1'
        );
        $stmt->execute([$userId, $taskId]);
        $task = $stmt->fetch(PDO::FETCH_ASSOC);
        return $task ? $this->normalizeTask($task) : null;
    }

    private function loadGoal(int $userId, DateTimeImmutable $today): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT cells, goal_why, goal_deadline
             FROM mandala_charts
             WHERE user_id = ? AND chart_key = 'default'
             LIMIT 1"
        );
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $cells = json_decode((string)($row['cells'] ?? '[]'), true);
        $cells = is_array($cells) ? $cells : [];
        $deadline = ($row['goal_deadline'] ?? null) ?: null;
        $daysRemaining = null;

        if ($deadline) {
            $deadlineDate = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$deadline, $today->getTimezone());
            if ($deadlineDate) {
                $daysRemaining = (int)$today->diff($deadlineDate)->format('%r%a');
            }
        }

        $subGoals = [];
        foreach ([36, 37, 38, 39, 41, 42, 43, 44] as $index) {
            $value = trim((string)($cells[$index] ?? ''));
            if ($value !== '') {
                $subGoals[] = $value;
            }
        }

        return [
            'title' => trim((string)($cells[40] ?? '')),
            'why' => trim((string)($row['goal_why'] ?? '')),
            'deadline' => $deadline,
            'days_remaining' => $daysRemaining,
            'sub_goals' => $subGoals,
        ];
    }

    private function loadTodayTasks(int $userId, string $today): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT id, title, start_date, due_date, priority, status
             FROM action_tasks
             WHERE user_id = ?
               AND status <> 'done'
               AND start_date IS NOT NULL
               AND due_date IS NOT NULL
               AND start_date <= ?
               AND due_date >= ?
             ORDER BY CASE WHEN priority = 'high' THEN 0 WHEN priority = 'medium' THEN 1 ELSE 2 END,
                      due_date, sort_order, id"
        );
        $stmt->execute([$userId, $today, $today]);
        return array_map(fn(array $row): array => $this->normalizeTask($row), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function loadIncompleteTasks(int $userId): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT id, title, start_date, due_date, priority, status
             FROM action_tasks
             WHERE user_id = ? AND status <> 'done'
             ORDER BY due_date IS NULL, due_date,
                      CASE WHEN priority = 'high' THEN 0 WHEN priority = 'medium' THEN 1 ELSE 2 END,
                      sort_order, id
             LIMIT 20"
        );
        $stmt->execute([$userId]);
        return array_map(fn(array $row): array => $this->normalizeTask($row), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function loadProgress(int $userId, string $windowStart, string $today): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT COUNT(*) AS target_count,
                    SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_count
             FROM action_tasks
             WHERE user_id = ?
               AND start_date IS NOT NULL
               AND due_date IS NOT NULL
               AND start_date <= ?
               AND due_date >= ?"
        );
        $stmt->execute([$userId, $today, $windowStart]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $targetCount = (int)($row['target_count'] ?? 0);
        $completedCount = (int)($row['completed_count'] ?? 0);

        return [
            'window_start' => $windowStart,
            'window_end' => $today,
            'target_task_count' => $targetCount,
            'completed_target_task_count' => $completedCount,
            'completion_rate' => $targetCount > 0 ? (int)round(($completedCount / $targetCount) * 100) : 0,
            'checkin_streak' => $this->loadCheckinStreak($userId, $today),
        ];
    }

    private function loadCheckinStreak(int $userId, string $today): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT checkin_date
             FROM daily_checkins
             WHERE user_id = ? AND checkin_date <= ?
             ORDER BY checkin_date DESC
             LIMIT 366'
        );
        $stmt->execute([$userId, $today]);
        $dates = array_fill_keys(array_column($stmt->fetchAll(PDO::FETCH_ASSOC), 'checkin_date'), true);
        $cursor = new DateTimeImmutable($today);
        $streak = 0;

        while (isset($dates[$cursor->format('Y-m-d')])) {
            $streak++;
            $cursor = $cursor->modify('-1 day');
        }

        return $streak;
    }

    private function loadPostponedCount(int $userId, string $windowStart, string $windowEnd): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*)
             FROM task_activity_log
             WHERE user_id = ?
               AND is_postponement = 1
               AND created_at >= ?
               AND created_at < ?'
        );
        $stmt->execute([$userId, $windowStart, $windowEnd]);
        return (int)$stmt->fetchColumn();
    }

    private function loadRepeatedlyPostponedTasks(
        int $userId,
        string $windowStart,
        string $windowEnd
    ): array
    {
        $threshold = COACH_BEHAVIOR_THRESHOLDS['repeated_postponement_count'];
        $stmt = $this->pdo->prepare(
            "SELECT activity.task_id, MAX(activity.task_title_snapshot) AS title,
                    COUNT(*) AS postponement_count
             FROM task_activity_log activity
             INNER JOIN action_tasks task
               ON task.id = activity.task_id AND task.user_id = activity.user_id
             WHERE activity.user_id = ?
               AND activity.task_id IS NOT NULL
               AND activity.is_postponement = 1
               AND activity.created_at >= ?
               AND activity.created_at < ?
               AND task.status <> 'done'
             GROUP BY activity.task_id
             HAVING COUNT(*) >= {$threshold}
             ORDER BY postponement_count DESC, activity.task_id
             LIMIT 10"
        );
        $stmt->execute([$userId, $windowStart, $windowEnd]);

        return array_map(static fn(array $row): array => [
            'task_id' => (int)$row['task_id'],
            'title' => (string)$row['title'],
            'postponement_count' => (int)$row['postponement_count'],
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function loadRecentJournals(int $userId, string $throughDate): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT journal_date, mood, completed_text, problem_text, reason_code, free_text, tomorrow_action
             FROM daily_journals
             WHERE user_id = ? AND journal_date <= ?
             ORDER BY journal_date DESC, id DESC
             LIMIT 3'
        );
        $stmt->execute([$userId, $throughDate]);

        return array_map(static fn(array $row): array => [
            'date' => (string)$row['journal_date'],
            'mood' => (int)$row['mood'],
            'completed_text' => (string)($row['completed_text'] ?? ''),
            'problem_text' => (string)($row['problem_text'] ?? ''),
            'reason_code' => (string)($row['reason_code'] ?? ''),
            'free_text' => (string)($row['free_text'] ?? ''),
            'tomorrow_action' => (string)($row['tomorrow_action'] ?? ''),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function loadRecentCoachResponses(int $userId, string $throughDate): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT response_date, coach_type, ai_response, legacy_message
             FROM (
               SELECT checkin_date AS response_date, 'morning' AS coach_type,
                      ai_response, ai_message AS legacy_message, created_at
               FROM daily_checkins
               WHERE user_id = ? AND checkin_date <= ?
                 AND (ai_response IS NOT NULL OR COALESCE(ai_message, '') <> '')
               UNION ALL
               SELECT journal_date AS response_date, 'evening' AS coach_type,
                      ai_response, ai_feedback AS legacy_message, created_at
               FROM daily_journals
               WHERE user_id = ? AND journal_date <= ?
                 AND (ai_response IS NOT NULL OR COALESCE(ai_feedback, '') <> '')
             ) responses
             ORDER BY response_date DESC, created_at DESC
             LIMIT 3"
        );
        $stmt->execute([$userId, $throughDate, $userId, $throughDate]);

        return array_map(static function (array $row): array {
            $structured = json_decode((string)($row['ai_response'] ?? ''), true);
            if (!is_array($structured)) {
                $structured = ['coach_message' => (string)($row['legacy_message'] ?? '')];
            }
            return [
                'date' => (string)$row['response_date'],
                'type' => (string)$row['coach_type'],
                'response' => $structured,
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    private function normalizeTask(array $row): array
    {
        return [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'start_date' => $row['start_date'] ?: null,
            'due_date' => $row['due_date'] ?: null,
            'priority' => (string)$row['priority'],
            'status' => (string)$row['status'],
        ];
    }
}

function buildCoachBehaviorSignals(array $progress, array $repeatedTasks): array
{
    $targetCount = (int)($progress['target_task_count'] ?? 0);
    $completionRate = (int)($progress['completion_rate'] ?? 0);
    $signals = [];

    if ($repeatedTasks) {
        $signals[] = 'REPEATED_POSTPONEMENT';
    }
    if ($targetCount > 0 && $completionRate < COACH_BEHAVIOR_THRESHOLDS['low_completion_rate']) {
        $signals[] = 'LOW_COMPLETION';
    }
    if ($targetCount > 0 && $completionRate >= COACH_BEHAVIOR_THRESHOLDS['good_momentum_rate']) {
        $signals[] = 'GOOD_MOMENTUM';
    }
    if (
        $targetCount >= COACH_BEHAVIOR_THRESHOLDS['possible_overload_target_count']
        && $completionRate < COACH_BEHAVIOR_THRESHOLDS['low_completion_rate']
    ) {
        $signals[] = 'POSSIBLE_OVERLOAD';
    }

    return $signals;
}

function buildCoachDecision(array $context): array
{
    $signals = $context['behavior']['signals'] ?? [];
    $repeated = $context['behavior']['repeatedly_postponed_tasks'] ?? [];
    $progress = $context['progress'] ?? [];
    $todayTasks = $context['today']['tasks'] ?? [];
    $incompleteTasks = $context['today']['incomplete_tasks'] ?? [];
    $targetTask = null;

    if (in_array('REPEATED_POSTPONEMENT', $signals, true) && $repeated) {
        $candidate = $repeated[0];
        $targetTask = [
            'id' => (int)$candidate['task_id'],
            'title' => (string)$candidate['title'],
        ];
        return [
            'observation' => sprintf('「%s」は%d回延期されています。', $targetTask['title'], (int)$candidate['postponement_count']),
            'intervention_type' => 'REDUCE_FRICTION',
            'target_task' => $targetTask,
            'recommended_action' => sprintf('「%s」を15分で着手できる最初の一手に小さくする。', $targetTask['title']),
        ];
    }

    $targetTask = firstCoachTargetTask($todayTasks, $incompleteTasks);
    $targetCount = (int)($progress['target_task_count'] ?? 0);
    $completedCount = (int)($progress['completed_target_task_count'] ?? 0);
    $completionRate = (int)($progress['completion_rate'] ?? 0);

    if (in_array('POSSIBLE_OVERLOAD', $signals, true)) {
        return [
            'observation' => sprintf('直近7日の対象Taskは%d件中%d件完了（%d%%）です。', $targetCount, $completedCount, $completionRate),
            'intervention_type' => 'NARROW_FOCUS',
            'target_task' => $targetTask,
            'recommended_action' => coachRecommendedAction($targetTask, '今日の優先Taskを1件に絞る。'),
        ];
    }

    if (in_array('LOW_COMPLETION', $signals, true)) {
        return [
            'observation' => sprintf('直近7日の対象Taskは%d件中%d件完了（%d%%）です。', $targetCount, $completedCount, $completionRate),
            'intervention_type' => 'REPLAN',
            'target_task' => $targetTask,
            'recommended_action' => coachRecommendedAction($targetTask, '未完了Taskを1件選び、15分の行動へ分ける。'),
        ];
    }

    if (in_array('GOOD_MOMENTUM', $signals, true)) {
        return [
            'observation' => sprintf('直近7日の対象Taskは%d件中%d件完了（%d%%）です。', $targetCount, $completedCount, $completionRate),
            'intervention_type' => 'REINFORCE',
            'target_task' => $targetTask,
            'recommended_action' => coachRecommendedAction($targetTask, '今の進め方を保ち、次の1件に着手する。'),
        ];
    }

    return [
        'observation' => $targetCount > 0
            ? sprintf('直近7日の対象Taskは%d件中%d件完了です。', $targetCount, $completedCount)
            : '直近7日の対象Taskはまだありません。',
        'intervention_type' => 'START_NEXT',
        'target_task' => $targetTask,
        'recommended_action' => coachRecommendedAction($targetTask, '今日の最初の一歩を1件決める。'),
    ];
}

function firstCoachTargetTask(array $todayTasks, array $incompleteTasks): ?array
{
    $task = $todayTasks[0] ?? $incompleteTasks[0] ?? null;
    if (!is_array($task) || empty($task['id'])) {
        return null;
    }

    return [
        'id' => (int)$task['id'],
        'title' => (string)($task['title'] ?? ''),
    ];
}

function coachRecommendedAction(?array $targetTask, string $fallback): string
{
    if (!$targetTask) {
        return $fallback;
    }

    return sprintf('「%s」を15分だけ始める。', (string)$targetTask['title']);
}

function selectCoachQuestionType(array $context, array $currentInput = []): string
{
    $signals = is_array($context['behavior']['signals'] ?? null)
        ? $context['behavior']['signals']
        : [];
    $recentTypes = recentCoachQuestionTypes($context, 3);
    $hasExplicitConcern = trim((string)($currentInput['concern'] ?? '')) !== ''
        || trim((string)($currentInput['problem_text'] ?? '')) !== ''
        || !in_array(trim((string)($currentInput['reason_code'] ?? '')), ['', 'none'], true);

    if (in_array('REPEATED_POSTPONEMENT', $signals, true)) {
        return firstNonRecentQuestionType(['START_SMALL', 'OBSTACLE'], $recentTypes);
    }

    if (in_array('POSSIBLE_OVERLOAD', $signals, true)) {
        return firstNonRecentQuestionType(['NEXT_STEP', 'START_SMALL'], $recentTypes);
    }

    if (in_array('LOW_COMPLETION', $signals, true)) {
        $candidates = $hasExplicitConcern
            ? ['OBSTACLE', 'NEXT_STEP']
            : ['NEXT_STEP'];
        return firstNonRecentQuestionType($candidates, $recentTypes);
    }

    if (in_array('GOOD_MOMENTUM', $signals, true)) {
        return 'SUCCESS';
    }

    if (trim((string)($context['goal']['why'] ?? '')) === '') {
        return 'WHY';
    }

    return 'NEXT_STEP';
}

function recentCoachQuestionTypes(array $context, int $limit = 3): array
{
    $types = [];
    foreach (($context['coaching'] ?? []) as $entry) {
        $type = (string)($entry['response']['question_type'] ?? '');
        if (in_array($type, COACH_QUESTION_TYPES, true)) {
            $types[] = $type;
        }
        if (count($types) >= max(1, $limit)) {
            break;
        }
    }
    return $types;
}

function firstNonRecentQuestionType(array $candidates, array $recentTypes): string
{
    foreach ($candidates as $candidate) {
        if (in_array($candidate, COACH_QUESTION_TYPES, true) && !in_array($candidate, $recentTypes, true)) {
            return $candidate;
        }
    }

    $fallback = (string)($candidates[0] ?? 'NEXT_STEP');
    return in_array($fallback, COACH_QUESTION_TYPES, true) ? $fallback : 'NEXT_STEP';
}

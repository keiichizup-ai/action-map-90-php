<?php
declare(strict_types=1);

define('COACH_CONTEXT_SKIP_BOOTSTRAP', true);
define('TASK_ACTIVITY_SKIP_BOOTSTRAP', true);

function db(): PDO
{
    return $GLOBALS['testPdo'];
}

function fail(string $message, int $status = 400): never
{
    throw new RuntimeException("HTTP {$status}: {$message}");
}

require_once __DIR__ . '/../api/coach_context.php';
require_once __DIR__ . '/../api/task_activity.php';

function assertSameValue(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

function assertTrueValue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec('PRAGMA foreign_keys = ON');
$GLOBALS['testPdo'] = $pdo;
$pdo->exec(<<<'SQL'
CREATE TABLE mandala_charts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  chart_key TEXT NOT NULL,
  cells TEXT NOT NULL,
  goal_why TEXT,
  goal_deadline TEXT
);
CREATE TABLE action_tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT,
  due_date TEXT,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE daily_checkins (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  ai_message TEXT,
  ai_response TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE daily_journals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  journal_date TEXT NOT NULL,
  mood INTEGER NOT NULL,
  completed_text TEXT,
  problem_text TEXT,
  reason_code TEXT,
  free_text TEXT,
  tomorrow_action TEXT,
  ai_feedback TEXT,
  ai_response TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE task_activity_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  task_id INTEGER,
  task_title_snapshot TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_start_date TEXT,
  old_due_date TEXT,
  new_start_date TEXT,
  new_due_date TEXT,
  old_status TEXT,
  new_status TEXT,
  is_postponement INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES action_tasks(id) ON DELETE SET NULL
);
SQL);

function cellsFor(string $goal, string $subGoal): string
{
    $cells = array_fill(0, 81, '');
    $cells[40] = $goal;
    $cells[36] = $subGoal;
    return json_encode($cells, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

$insertChart = $pdo->prepare('INSERT INTO mandala_charts VALUES (?, ?, ?, ?, ?, ?)');
$insertChart->execute([1, 1, 'default', cellsFor('USER_A_GOAL', 'USER_A_SUBGOAL'), 'USER_A_WHY', '2026-09-12']);
$insertChart->execute([2, 2, 'default', cellsFor('USER_B_SECRET_GOAL', 'USER_B_SECRET_SUBGOAL'), 'USER_B_SECRET_WHY', '2027-01-01']);

$insertTask = $pdo->prepare('INSERT INTO action_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
$insertTask->execute([101, 1, 'USER_A_TASK', '2026-09-01', '2026-09-05', 'high', 'todo', 1, '2026-09-01 00:00:00']);
$insertTask->execute([102, 1, 'USER_A_DONE_TASK', '2026-08-30', '2026-09-02', 'medium', 'done', 2, '2026-09-01 00:00:00']);
$insertTask->execute([201, 2, 'USER_B_SECRET_TASK', '2026-09-01', '2026-09-05', 'high', 'todo', 1, '2026-09-01 00:00:00']);

$insertCheckin = $pdo->prepare('INSERT INTO daily_checkins VALUES (?, ?, ?, ?, ?, ?)');
$insertCheckin->execute([1, 1, '2026-09-02', 'USER_A_COACH', null, '2026-09-02 07:00:00']);
$insertCheckin->execute([2, 1, '2026-09-01', null, null, '2026-09-01 07:00:00']);
$insertCheckin->execute([3, 2, '2026-09-02', 'USER_B_SECRET_COACH', null, '2026-09-02 07:30:00']);

$insertJournal = $pdo->prepare('INSERT INTO daily_journals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
$insertJournal->execute([1, 1, '2026-09-01', 4, 'USER_A_REFLECTION', '', 'none', '', 'continue', 'USER_A_EVENING_COACH', null, '2026-09-01 22:00:00']);
$insertJournal->execute([2, 2, '2026-09-01', 2, 'USER_B_SECRET_REFLECTION', '', 'time', '', 'smaller', 'USER_B_SECRET_EVENING', null, '2026-09-01 22:30:00']);

$insertActivity = $pdo->prepare(
    "INSERT INTO task_activity_log
     (id, user_id, task_id, task_title_snapshot, event_type, is_postponement, created_at)
     VALUES (?, ?, ?, ?, 'DATE_CHANGED', ?, ?)"
);
for ($i = 1; $i <= 3; $i++) {
    $insertActivity->execute([$i, 1, 101, 'USER_A_TASK', 1, "2026-08-2{$i} 10:00:00"]);
}
for ($i = 4; $i <= 8; $i++) {
    $insertActivity->execute([$i, 2, 201, 'USER_B_SECRET_TASK', 1, "2026-08-2{$i} 10:00:00"]);
}
$insertActivity->execute([9, 1, 101, 'USER_A_OLD_TASK', 1, '2026-07-01 10:00:00']);
for ($i = 10; $i <= 12; $i++) {
    $day = $i + 14;
    $insertActivity->execute([$i, 1, 102, 'USER_A_DONE_TASK', 1, "2026-08-{$day} 10:00:00"]);
}

$builder = new CoachContextBuilder($pdo);
$now = new DateTimeImmutable('2026-09-02 09:00:00', new DateTimeZone('Asia/Tokyo'));
$contextA = $builder->build(1, $now);
$contextB = $builder->build(2, $now);
$jsonA = json_encode($contextA, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
$jsonB = json_encode($contextB, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

assertSameValue('USER_A_GOAL', $contextA['goal']['title'], 'User A goal must be loaded.');
assertSameValue(10, $contextA['goal']['days_remaining'], 'Goal days_remaining must use the supplied date.');
assertSameValue(2, $contextA['progress']['checkin_streak'], 'Check-in streak must be user-scoped.');
assertSameValue(6, $contextA['behavior']['postponed_count'], 'Postponement count must be user-scoped and exclude events older than 30 days.');
assertSameValue(101, $contextA['behavior']['repeatedly_postponed_tasks'][0]['task_id'], 'Repeated task must belong to User A.');
assertSameValue(1, count($contextA['behavior']['repeatedly_postponed_tasks']), 'Completed tasks must not be coaching targets.');
assertTrueValue(!str_contains($jsonA, 'USER_B_SECRET'), 'User A context leaked User B data.');
assertTrueValue(!str_contains($jsonB, 'USER_A_'), 'User B context leaked User A data.');
assertSameValue(null, $builder->findOwnedTask(1, 201), 'User A must not validate User B target_task_id.');
assertSameValue(101, $builder->findOwnedTask(1, 101)['id'], 'User A must validate their own target_task_id.');

$decision = buildCoachDecision($contextA);
assertSameValue(101, $decision['target_task']['id'], 'Rule engine target_task must be sourced from User A context.');
assertSameValue('REDUCE_FRICTION', $decision['intervention_type'], 'Repeated postponement must take deterministic priority.');
assertTrueValue(!preg_match('/怠け|意志が弱|ADHD/u', $decision['observation']), 'Observation must not diagnose personality or illness.');
assertSameValue('START_SMALL', selectCoachQuestionType($contextA), 'Repeated postponement must select START_SMALL first.');

$contextA['coaching'] = [[
    'response' => ['question_type' => 'START_SMALL'],
]];
assertSameValue('OBSTACLE', selectCoachQuestionType($contextA), 'Repeated postponement may use OBSTACLE only to avoid a recent duplicate.');

$whyContext = [
    'goal' => ['why' => ''],
    'behavior' => ['signals' => []],
    'coaching' => [],
];
assertSameValue('WHY', selectCoachQuestionType($whyContext), 'A missing WHY must select the WHY question type.');
assertSameValue(
    'OBSTACLE',
    selectCoachQuestionType([
        'goal' => ['why' => '理由'],
        'behavior' => ['signals' => ['LOW_COMPLETION']],
        'coaching' => [],
    ], ['reason_code' => 'time']),
    'An explicit low-completion obstacle must select OBSTACLE.'
);
assertSameValue(
    'NEXT_STEP',
    selectCoachQuestionType([
        'goal' => ['why' => '理由'],
        'behavior' => ['signals' => ['LOW_COMPLETION']],
        'coaching' => [],
    ]),
    'Low completion without an explicit obstacle must select NEXT_STEP.'
);
assertSameValue(
    'NEXT_STEP',
    selectCoachQuestionType([
        'goal' => ['why' => '理由'],
        'behavior' => ['signals' => ['POSSIBLE_OVERLOAD', 'LOW_COMPLETION']],
        'coaching' => [],
    ]),
    'Possible overload must take priority over low completion.'
);
assertSameValue(
    'START_SMALL',
    selectCoachQuestionType([
        'goal' => ['why' => '理由'],
        'behavior' => ['signals' => ['POSSIBLE_OVERLOAD', 'LOW_COMPLETION']],
        'coaching' => [['response' => ['question_type' => 'NEXT_STEP']]],
    ]),
    'Possible overload may use START_SMALL to avoid a recent NEXT_STEP duplicate.'
);
assertSameValue(
    'SUCCESS',
    selectCoachQuestionType([
        'goal' => ['why' => '理由'],
        'behavior' => ['signals' => ['GOOD_MOMENTUM']],
        'coaching' => [],
    ]),
    'Good momentum must select SUCCESS.'
);

assertSameValue(
    ['LOW_COMPLETION', 'POSSIBLE_OVERLOAD'],
    buildCoachBehaviorSignals(['target_task_count' => 8, 'completion_rate' => 39], []),
    'Overload thresholds must be centralized and deterministic.'
);
assertSameValue(
    ['GOOD_MOMENTUM'],
    buildCoachBehaviorSignals(['target_task_count' => 5, 'completion_rate' => 80], []),
    '80 percent must trigger GOOD_MOMENTUM.'
);
assertTrueValue(
    is_task_postponement(['start_date' => '2026-09-01', 'due_date' => '2026-09-02'], ['start_date' => '2026-09-02', 'due_date' => '2026-09-03']),
    'Moving an existing date later must be a postponement.'
);
assertTrueValue(
    !is_task_postponement(['start_date' => null, 'due_date' => null], ['start_date' => '2026-09-02', 'due_date' => '2026-09-03']),
    'Initial scheduling must not be a postponement.'
);

update_owned_task_with_activity(1, 101, [
    'startDate' => '2026-09-02',
    'dueDate' => '2026-09-06',
]);
assertSameValue(8, (int)$pdo->query('SELECT COUNT(*) FROM task_activity_log WHERE user_id = 1 AND is_postponement = 1')->fetchColumn(), 'Owned date update must append a postponement event without deleting history.');

try {
    update_owned_task_with_activity(1, 201, ['status' => 'done']);
    throw new RuntimeException('Cross-user task update unexpectedly succeeded.');
} catch (RuntimeException $error) {
    assertTrueValue(str_contains($error->getMessage(), 'HTTP 404'), 'Cross-user task update must fail as not found.');
}
assertSameValue('todo', $pdo->query('SELECT status FROM action_tasks WHERE id = 201')->fetchColumn(), 'Cross-user task status must remain unchanged.');

$pdo->exec('DELETE FROM action_tasks WHERE id = 101');
assertSameValue(5, (int)$pdo->query('SELECT COUNT(*) FROM task_activity_log WHERE user_id = 1 AND task_id IS NULL')->fetchColumn(), 'Activity history must remain after task deletion with task_id set to NULL.');

echo "PASS coach_context_isolation_test\n";

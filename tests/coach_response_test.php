<?php
declare(strict_types=1);

define('COACH_CONTEXT_SKIP_BOOTSTRAP', true);
define('COACH_RESPONSE_SKIP_BOOTSTRAP', true);

function db(): PDO
{
    return $GLOBALS['testPdo'];
}

require_once __DIR__ . '/../api/coach_response.php';

function assertCoachSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

function assertCoachTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->exec(<<<'SQL'
CREATE TABLE action_tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT,
  due_date TEXT,
  priority TEXT NOT NULL,
  status TEXT NOT NULL
);
INSERT INTO action_tasks VALUES (101, 1, 'USER_A_TASK', '2026-09-01', '2026-09-12', 'high', 'todo');
INSERT INTO action_tasks VALUES (102, 1, 'USER_A_DONE_TASK', '2026-09-01', '2026-09-12', 'medium', 'done');
INSERT INTO action_tasks VALUES (103, 1, 'THIRD_TASK', '2026-09-01', '2026-09-12', 'low', 'todo');
INSERT INTO action_tasks VALUES (104, 1, 'FOURTH_TASK_MUST_NOT_BE_SENT', '2026-09-01', '2026-09-12', 'low', 'todo');
INSERT INTO action_tasks VALUES (201, 2, 'USER_B_SECRET_TASK', '2026-09-01', '2026-09-12', 'high', 'todo');
SQL);
$GLOBALS['testPdo'] = $pdo;

$context = [
    'goal' => [
        'title' => 'Alpha公開',
        'why' => str_repeat('W', 600),
        'deadline' => '2026-09-12',
        'days_remaining' => 4,
        'sub_goals' => ['品質確認', '利用者確認', '公開準備', 'PROMPT_FORBIDDEN_SUBGOAL'],
        'ai_result' => 'FULL_90_DAY_PLAN_MUST_NOT_BE_SENT',
    ],
    'today' => [
        'date' => '2026-09-08',
        'tasks' => [['id' => 101, 'title' => 'USER_A_TASK', 'status' => 'todo']],
        'incomplete_tasks' => [['id' => 101, 'title' => 'USER_A_TASK', 'status' => 'todo']],
    ],
    'progress' => [
        'target_task_count' => 5,
        'completed_target_task_count' => 1,
        'completion_rate' => 20,
    ],
    'behavior' => [
        'signals' => ['REPEATED_POSTPONEMENT', 'LOW_COMPLETION'],
        'postponed_count' => 3,
        'repeatedly_postponed_tasks' => [[
            'task_id' => 101,
            'title' => 'USER_A_TASK',
            'postponement_count' => 3,
        ]],
    ],
    'reflection' => [[
        'date' => '2026-09-07',
        'mood' => 3,
        'completed_text' => '小さく着手できた',
        'problem_text' => '時間配分',
        'reason_code' => 'time',
        'free_text' => 'RAW_HISTORY_SECRET_MUST_NOT_BE_SENT',
        'tomorrow_action' => 'smaller',
    ]],
    'coaching' => [],
    'email' => 'private@example.com',
    'user_id' => 1,
];

$input = [
    'date' => '2026-09-08',
    'mood' => 3,
    'focus_minutes' => 30,
    'concern' => 'どこから始めるか迷う',
    'relevant_tasks' => [
        ['id' => 101, 'title' => 'USER_A_TASK', 'due_date' => '2026-09-12', 'priority' => 'high', 'status' => 'todo'],
        ['id' => 102, 'title' => 'USER_A_DONE_TASK', 'due_date' => '2026-09-12', 'priority' => 'medium', 'status' => 'done'],
        ['id' => 103, 'title' => 'THIRD_TASK', 'due_date' => null, 'priority' => 'low', 'status' => 'todo'],
        ['id' => 104, 'title' => 'FOURTH_TASK_MUST_NOT_BE_SENT', 'due_date' => null, 'priority' => 'low', 'status' => 'todo'],
    ],
];

$payload = buildCoachOpenAiPayload(
    'morning',
    $context,
    $input,
    buildCoachSessionDecision($context, 'morning', $input),
    'START_SMALL'
);
$serializedPayload = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
assertCoachSame(false, $payload['store'] ?? null, 'Responses API storage must be disabled.');
assertCoachTrue(!str_contains($serializedPayload, 'private@example.com'), 'Email must not be sent to the LLM.');
assertCoachTrue(!str_contains($serializedPayload, 'FULL_90_DAY_PLAN_MUST_NOT_BE_SENT'), 'The full 90-day plan must not be sent to the LLM.');
assertCoachTrue(!str_contains($serializedPayload, 'RAW_HISTORY_SECRET_MUST_NOT_BE_SENT'), 'Raw reflection history must not be sent to the LLM.');
assertCoachTrue(!str_contains($serializedPayload, 'FOURTH_TASK_MUST_NOT_BE_SENT'), 'Only three relevant tasks may be sent to the LLM.');
$promptData = json_decode($payload['input'][1]['content'][0]['text'], true, 512, JSON_THROW_ON_ERROR);
assertCoachSame(500, mb_strlen($promptData['goal']['why']), 'WHY must be capped at 500 characters.');
assertCoachSame(3, count($promptData['goal']['sub_goals']), 'Only three subgoals may be sent.');
assertCoachSame('START_SMALL', $promptData['server_decision']['question_type'], 'The server question type must be fixed in the prompt.');

$validWording = [
    'observation' => '最近の記録を見ると、同じTaskの日程を調整する場面が続いています。',
    'suggestion' => '完了を目指す前に、10分でできる単位へ小さくしてみましょう。',
    'question' => 'このTaskを着手だけにするなら、最初に何をしますか？',
];
$response = generateCoachResponse(1, 'morning', $context, $input, static fn(array $request): array => $validWording);
assertCoachSame('START_SMALL', $response['question_type'], 'The LLM must not choose the question type.');
assertCoachSame('REDUCE_FRICTION', $response['intervention_type'], 'The LLM must not choose the intervention.');
assertCoachSame(101, $response['target_task_id'], 'The owned active target task must be retained.');
assertCoachSame(1, preg_match_all('/[？?]/u', $response['coach_message']), 'A response must contain exactly one question mark.');
assertCoachTrue(mb_strlen($response['coach_message']) <= 250, 'A response must fit the UI length limit.');

assertCoachSame(null, validateCoachLlmOutput([
    'observation' => '<strong>断定</strong>',
    'suggestion' => '',
    'question' => '何をしますか？',
]), 'HTML output must be rejected.');
assertCoachSame(null, validateCoachLlmOutput([
    'observation' => 'あなたは意志が弱い人です。',
    'suggestion' => '',
    'question' => '最初に何をしますか？',
]), 'Personality judgments must be rejected.');
assertCoachSame(null, validateCoachLlmOutput([
    'observation' => '最近の記録を確認しました。',
    'suggestion' => '',
    'question' => '一つ決めます。何をしますか？',
]), 'A multi-sentence question field must be rejected even with one question mark.');
assertCoachSame(null, validateCoachLlmOutput([
    'observation' => '最近の記録を確認しました。',
    'suggestion' => '',
    'question' => '何をしますか？いつしますか？',
]), 'Multiple questions must be rejected.');
assertCoachSame(null, validateCoachLlmOutput([
    'observation' => str_repeat('長', 101),
    'suggestion' => '',
    'question' => '最初に何をしますか？',
]), 'Overlong AI fields must be rejected.');
assertCoachSame(null, validateCoachLlmOutput([
    'observation' => '最近の記録を確認しました。',
    'suggestion' => '',
    'question' => '最初に何をしますか？',
    'question_type' => 'WHY',
]), 'Unexpected LLM metadata must be rejected.');
$decodedWording = decodeCoachOpenAiResult([
    'output' => [[
        'content' => [[
            'type' => 'output_text',
            'text' => json_encode($validWording, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]],
    ]],
]);
assertCoachSame($validWording, $decodedWording, 'A valid Responses API structured result must be decoded.');

$fallback = generateCoachResponse(1, 'morning', $context, $input, static function (): array {
    throw new RuntimeException('Simulated API failure');
});
assertCoachSame('START_SMALL', $fallback['question_type'], 'API failure must preserve the server question type.');
assertCoachSame(1, preg_match_all('/[？?]/u', $fallback['coach_message']), 'Fallback must contain exactly one question.');

$foreignContext = $context;
$foreignContext['behavior']['repeatedly_postponed_tasks'][0] = [
    'task_id' => 201,
    'title' => 'USER_B_SECRET_TASK',
    'postponement_count' => 4,
];
$foreign = generateCoachResponse(1, 'morning', $foreignContext, $input, static fn(array $request): array => $validWording);
assertCoachSame(null, $foreign['target_task_id'], 'Another user\'s target task must be rejected.');
assertCoachTrue(!str_contains(json_encode($foreign, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'USER_B_SECRET'), 'Another user\'s task must not leak through the fallback response.');

$capturedPayload = [];
$foreignInput = $input;
$foreignInput['relevant_tasks'] = [['id' => 201, 'title' => 'USER_B_SECRET_TASK', 'status' => 'todo']];
generateCoachResponse(1, 'morning', $context, $foreignInput, static function (array $request) use (&$capturedPayload, $validWording): array {
    $capturedPayload = $request;
    return $validWording;
});
assertCoachTrue(!str_contains(json_encode($capturedPayload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'USER_B_SECRET'), 'Another user\'s relevant task must not be sent to the LLM.');

$completedContext = $context;
$completedContext['behavior']['repeatedly_postponed_tasks'][0] = [
    'task_id' => 102,
    'title' => 'USER_A_DONE_TASK',
    'postponement_count' => 4,
];
$completed = generateCoachResponse(1, 'morning', $completedContext, $input, static fn(array $request): array => $validWording);
assertCoachSame(null, $completed['target_task_id'], 'A completed target task must be rejected.');

$eveningDecision = buildCoachSessionDecision($context, 'evening', [
    'planned_count' => 3,
    'completed_count' => 2,
    'completed_task_ids' => [101, 102],
    'relevant_tasks' => $input['relevant_tasks'],
]);
assertCoachSame('今日の計画Taskは3件中2件完了です。', $eveningDecision['observation'], 'Evening must use the authorized completion overlay.');
assertCoachSame(null, $eveningDecision['target_task'], 'A task completed in the current Evening overlay must not remain the coaching target.');

$eveningResponse = generateCoachResponse(1, 'evening', $context, [
    'date' => '2026-09-08',
    'mood' => 4,
    'problem_text' => '',
    'reason_code' => 'none',
    'reflection' => '3件中2件を進められた',
    'tomorrow_action' => 'continue',
    'planned_count' => 3,
    'completed_count' => 2,
    'completion_rate' => 67,
    'completed_task_ids' => [102],
    'relevant_tasks' => $input['relevant_tasks'],
], static function (): array {
    throw new RuntimeException('Simulated API failure');
});
assertCoachSame('evening', $eveningResponse['coach_type'], 'Evening must persist its coach type.');
assertCoachTrue(str_contains($eveningResponse['observation'], '3件中2件完了'), 'Evening fallback must reflect the submitted completion result.');
assertCoachSame(1, preg_match_all('/[？?]/u', $eveningResponse['coach_message']), 'Evening fallback must contain exactly one question.');

echo "PASS coach_response_test\n";

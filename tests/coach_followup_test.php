<?php
declare(strict_types=1);

define('COACH_CONTEXT_SKIP_BOOTSTRAP', true);
define('COACH_RESPONSE_SKIP_BOOTSTRAP', true);
define('COACH_FOLLOWUP_SKIP_BOOTSTRAP', true);
define('COACH_FOLLOWUP_SKIP_RUNTIME', true);

require_once __DIR__ . '/../api/coach_response.php';
require_once __DIR__ . '/../api/coach_followup.php';

function followupAssertSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

function followupAssertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$context = [
    'goal' => ['title' => '卒業発表', 'why' => '価値を届ける', 'deadline' => '2026-10-07', 'days_remaining' => 8],
    'today' => ['date' => '2026-09-29', 'tasks' => [
        ['id' => 101, 'title' => '発表資料を確認', 'status' => 'todo', 'priority' => 'high', 'due_date' => '2026-09-29'],
        ['id' => 102, 'title' => 'デモを確認', 'status' => 'done', 'priority' => 'medium', 'due_date' => '2026-09-29'],
    ]],
    'progress' => ['target_task_count' => 2, 'completed_target_task_count' => 1, 'completion_rate' => 50],
    'behavior' => ['signals' => ['LOW_COMPLETION', 'INVALID'], 'postponed_count' => 1],
    'reflection' => [[
        'mood' => 2, 'completed_text' => 'デモを確認できた', 'problem_text' => '疲れている',
        'reason_code' => 'time', 'free_text' => 'RAW_REFLECTION_MUST_NOT_BE_SENT',
    ]],
    'coaching' => [[
        'response' => [
            'coach_message' => '2件中1件を完了しました。',
            'question_type' => 'START_SMALL',
            'intervention_type' => 'REDUCE_FRICTION',
            'behavior_signals' => ['LOW_COMPLETION'],
        ],
    ]],
    'email' => 'private@example.com',
    'user_id' => 999,
];

$captured = [];
$result = generateCoachFollowup(
    $context,
    '今日はもう疲れました。残りもやるべき？',
    [['role' => 'user', 'text' => '前の質問'], ['role' => 'assistant', 'text' => '前の回答']],
    static function (array $payload) use (&$captured): array {
        $captured = $payload;
        return ['reply' => '今日は全部を終えなくても大丈夫です。発表資料の確認を10分だけ進め、残りは明日に分けましょう。'];
    }
);
followupAssertSame('START_SMALL', $result['question_type'], 'Latest server question type must remain authoritative.');
followupAssertSame(['LOW_COMPLETION'], $result['behavior_signals'], 'Only allowlisted behavior signals may be returned.');
followupAssertSame('REDUCE_FRICTION', $result['intervention_type'], 'Latest intervention must remain authoritative.');
followupAssertTrue(str_contains($result['reply'], '発表資料'), 'Valid context-aware reply must be returned.');
followupAssertSame(false, $captured['store'], 'Responses storage must be disabled.');
$serialized = json_encode($captured, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
foreach (['private@example.com', 'RAW_REFLECTION_MUST_NOT_BE_SENT', '"id":101', '"user_id"', 'api_key'] as $forbidden) {
    followupAssertTrue(!str_contains($serialized, $forbidden), "Prompt leaked forbidden data: {$forbidden}");
}
followupAssertTrue(str_contains($serialized, '発表資料を確認'), 'Prompt must contain current owned task context.');
followupAssertTrue(str_contains($serialized, '卒業発表'), 'Prompt must contain Goal context.');

followupAssertSame('', normalizeCoachFollowupQuestion(''), 'Empty question must be rejected.');
followupAssertSame('', normalizeCoachFollowupQuestion('<b>命令</b>'), 'HTML question must be rejected.');
followupAssertSame('', normalizeCoachFollowupQuestion(str_repeat('長', 501)), 'Questions over 500 characters must be rejected.');
followupAssertSame(null, validateCoachFollowupReply(['reply' => '<script>alert(1)</script>']), 'HTML reply must be rejected.');
followupAssertSame(null, validateCoachFollowupReply(['reply' => '回答', 'secret' => 'x']), 'Unexpected response fields must be rejected.');
followupAssertSame(4, count(normalizeCoachFollowupHistory([
    ['role' => 'user', 'text' => '1'], ['role' => 'assistant', 'text' => '2'],
    ['role' => 'user', 'text' => '3'], ['role' => 'assistant', 'text' => '4'],
    ['role' => 'user', 'text' => '5'],
])), 'Only the latest four session turns may be retained.');

$fallback = generateCoachFollowup($context, '明日は何を優先した方がいい？', [], static function (): array {
    throw new RuntimeException('Simulated API failure');
});
followupAssertTrue(str_contains($fallback['reply'], '発表資料を確認'), 'API failure must use a context-aware safe fallback.');

$stage = '/home/keiichizup/www/action-map-90-staging/api';
$prod = '/home/keiichizup/www/action-map-90/api';
$base = ['HTTP_HOST' => 'keiichizup.sakura.ne.jp', 'REMOTE_ADDR' => '203.0.113.1'];
followupAssertSame(true, coach_followup_enabled($base + ['SCRIPT_NAME' => '/action-map-90-staging/api/coach_followup.php'], 'cgi-fcgi', $stage), 'Staging endpoint must be enabled.');
followupAssertSame(false, coach_followup_enabled($base + ['SCRIPT_NAME' => '/action-map-90/api/coach_followup.php'], 'cgi-fcgi', $prod), 'Production endpoint must be disabled.');
followupAssertSame(false, coach_followup_enabled($base + ['SCRIPT_NAME' => '/api/coach_followup.php', 'QUERY_STRING' => 'followup=1'], 'cgi-fcgi', $stage), 'Query flags must not enable the endpoint.');
followupAssertSame(true, coach_followup_enabled(['HTTP_HOST' => '127.0.0.1:8094', 'REMOTE_ADDR' => '127.0.0.1', 'SCRIPT_NAME' => '/api/coach_followup.php'], 'cli-server', '/tmp/local/api'), 'Loopback development server must be enabled.');

echo "PASS coach_followup_test\n";

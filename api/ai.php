<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
require_csrf($data);
current_user_id();

$mode = (string)($data['mode'] ?? '');
$cells = $data['cells'] ?? [];

if (!is_array($cells)) {
    fail('マンダラチャートの内容が正しくありません。');
}

$mainGoal = trim((string)($cells[40] ?? ''));
if ($mainGoal === '') {
    fail('中央の大目標を入力してください。');
}

if ($mode === 'expand') {
    $expanded = expand_actions($cells);
    respond([
        'ok' => true,
        'result' => $expanded['result'],
        'cells' => $expanded['cells'],
    ]);
}

$prompt = build_prompt($mode, $cells);
$result = call_openai($prompt);

respond(['ok' => true, 'result' => $result]);

function build_prompt(string $mode, array $cells): string
{
    $labels = goal_labels();

    $summary = [];
    foreach ($labels as $index => $label) {
        $value = trim((string)($cells[$index] ?? ''));
        if ($value !== '') {
            $summary[] = $label . ': ' . $value;
        }
    }

    $nonActionIndexes = array_flip(array_merge(array_keys($labels), [4, 13, 22, 31, 49, 58, 67, 76]));
    $filledActions = [];
    foreach ($cells as $index => $value) {
        $value = trim((string)$value);
        if ($value !== '' && !isset($nonActionIndexes[(int)$index])) {
            $filledActions[] = 'セル' . ((int)$index + 1) . ': ' . $value;
        }
    }

    if ($mode === 'plan') {
        return "あなたは事業戦略と実行計画に強いコンサルタントです。\n"
            . "以下のAI戦略マンダラチャートをもとに、30日/60日/90日の実行計画を日本語で作成してください。\n"
            . "出力はMarkdownで、優先順位、週次アクション、KPI、注意点を含めてください。\n\n"
            . implode("\n", $summary) . "\n\n"
            . "既に入力済みの具体アクション:\n" . implode("\n", $filledActions);
    }

    return "あなたは事業戦略と実行計画に強いコンサルタントです。\n"
        . "以下の大目標と8つの中目標をもとに、それぞれの中目標を達成するための具体アクションを8個ずつ提案してください。\n"
        . "出力はMarkdownで、中目標ごとに見出しを作り、各8項目を短く具体的にしてください。\n\n"
        . implode("\n", $summary);
}

function goal_labels(): array
{
    return [
        36 => '左上の中目標',
        37 => '上の中目標',
        38 => '右上の中目標',
        39 => '左の中目標',
        40 => '大目標',
        41 => '右の中目標',
        42 => '左下の中目標',
        43 => '下の中目標',
        44 => '右下の中目標',
    ];
}

function goal_to_block_map(): array
{
    return [
        36 => ['block' => 0, 'center' => 4],
        37 => ['block' => 1, 'center' => 13],
        38 => ['block' => 2, 'center' => 22],
        39 => ['block' => 3, 'center' => 31],
        41 => ['block' => 5, 'center' => 49],
        42 => ['block' => 6, 'center' => 58],
        43 => ['block' => 7, 'center' => 67],
        44 => ['block' => 8, 'center' => 76],
    ];
}

function action_slots_for_block(int $block): array
{
    $base = $block * 9;
    return [
        $base,
        $base + 1,
        $base + 2,
        $base + 3,
        $base + 5,
        $base + 6,
        $base + 7,
        $base + 8,
    ];
}

function expand_actions(array $cells): array
{
    $mainGoal = trim((string)($cells[40] ?? ''));
    $map = goal_to_block_map();
    $goals = [];

    foreach ($map as $goalIndex => $blockInfo) {
        $goal = trim((string)($cells[$goalIndex] ?? ''));
        if ($goal === '') {
            continue;
        }

        $goals[] = [
            'block' => $blockInfo['block'],
            'goalIndex' => $goalIndex,
            'goal' => $goal,
        ];
        $cells[$blockInfo['center']] = $goal;
    }

    if (!$goals) {
        fail('中央ブロックの周囲8マスに中目標を入力してください。');
    }

    $goalLines = array_map(
        fn (array $item): string => 'Block ' . $item['block'] . ': ' . $item['goal'],
        $goals
    );

    $prompt = "あなたは事業戦略と実行計画に強いコンサルタントです。\n"
        . "大目標と8つの中目標から、各中目標ごとに具体アクションを8個ずつ作ってください。\n"
        . "必ずJSONだけを返してください。説明文やMarkdownは不要です。\n\n"
        . "条件:\n"
        . "- 各アクションは20文字以内を目安に短く具体的にする\n"
        . "- 今日から着手できる行動にする\n"
        . "- block番号は入力された番号をそのまま使う\n"
        . "- 各blockにつきactionsを必ず8個にする\n\n"
        . "返却形式:\n"
        . "{\"blocks\":[{\"block\":0,\"goal\":\"中目標\",\"actions\":[\"行動1\",\"行動2\",\"行動3\",\"行動4\",\"行動5\",\"行動6\",\"行動7\",\"行動8\"]}]}\n\n"
        . "大目標: {$mainGoal}\n"
        . "中目標:\n" . implode("\n", $goalLines);

    $json = call_openai_json($prompt);
    $blocks = is_array($json['blocks'] ?? null) ? $json['blocks'] : [];
    $markdown = [];

    foreach ($blocks as $block) {
        $blockNumber = (int)($block['block'] ?? -1);
        if (!in_array($blockNumber, [0, 1, 2, 3, 5, 6, 7, 8], true)) {
            continue;
        }

        $actions = $block['actions'] ?? [];
        if (!is_array($actions)) {
            continue;
        }

        $goal = trim((string)($block['goal'] ?? $cells[$blockNumber * 9 + 4] ?? ''));
        $slots = action_slots_for_block($blockNumber);
        $markdown[] = "## Block {$blockNumber}: {$goal}";

        foreach ($slots as $slot) {
            $cells[$slot] = '';
        }

        foreach (array_slice($actions, 0, 8) as $actionIndex => $action) {
            $actionText = trim((string)$action);
            $cells[$slots[$actionIndex]] = $actionText;
            $markdown[] = '- ' . $actionText;
        }
    }

    return [
        'cells' => array_values(array_slice($cells, 0, 81)),
        'result' => $markdown ? implode("\n", $markdown) : 'アクションを生成しました。',
    ];
}

function call_openai_json(string $prompt): array
{
    $text = call_openai($prompt);
    $start = strpos($text, '{');
    $end = strrpos($text, '}');

    if ($start === false || $end === false || $end <= $start) {
        fail('AIからJSON形式の結果を取得できませんでした。もう一度お試しください。', 502);
    }

    $json = json_decode(substr($text, $start, $end - $start + 1), true);
    if (!is_array($json)) {
        fail('AIのJSON解析に失敗しました。もう一度お試しください。', 502);
    }

    return $json;
}

function call_openai(string $prompt): string
{
    if (OPENAI_API_KEY === '' || str_starts_with(OPENAI_API_KEY, 'sk-proj-xxxxxxxx')) {
        fail('OpenAI APIキーを config/config.php に設定してください。');
    }

    $payload = [
        'model' => OPENAI_MODEL,
        'input' => [
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'input_text',
                        'text' => $prompt,
                    ],
                ],
            ],
        ],
        'max_output_tokens' => 3500,
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
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false || $error !== '') {
        fail('OpenAI APIとの通信に失敗しました: ' . $error, 502);
    }

    $json = json_decode((string)$body, true);
    if ($status >= 400) {
        $message = $json['error']['message'] ?? 'OpenAI APIでエラーが発生しました。';
        fail((string)$message, 502);
    }

    $texts = [];
    foreach (($json['output'] ?? []) as $item) {
        foreach (($item['content'] ?? []) as $content) {
            if (($content['type'] ?? '') === 'output_text' && isset($content['text'])) {
                $texts[] = (string)$content['text'];
            }
        }
    }

    $text = trim(implode("\n", $texts));
    return $text !== '' ? $text : 'AIから空のレスポンスが返されました。';
}

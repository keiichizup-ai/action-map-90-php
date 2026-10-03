<?php
declare(strict_types=1);
// LOCAL TEST FIXTURES ONLY. Never deploy. No application config, DB or LLM.
if (PHP_SAPI !== 'cli-server' || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($path === '/mobile-coach.php') {
    ob_start();
    require $root . '/mobile-coach.php';
    $html = ob_get_clean();
    echo str_replace('<head>', '<head><script src="/tests/dummy-avatar-probe.js"></script>', $html);
    return true;
}
$files = [
    '/tests/dummy-avatar-probe.js' => ['tests/dummy-avatar-probe.js', 'text/javascript'],
    '/tests/mobile-avatar-browser.html' => ['tests/mobile-avatar-browser.html', 'text/html; charset=UTF-8'],
    '/tests/mobile-avatar-browser.js' => ['tests/mobile-avatar-browser.js', 'text/javascript'],
    '/assets/mobile-coach.js' => ['assets/mobile-coach.js', 'text/javascript'],
    '/assets/mobile-coach.css' => ['assets/mobile-coach.css', 'text/css'],
    '/assets/avatar/avatar-bridge.js' => ['assets/avatar/avatar-bridge.js', 'text/javascript'],
    '/assets/avatar/mobile-avatar-bridge.js' => ['assets/avatar/mobile-avatar-bridge.js', 'text/javascript'],
    '/assets/avatar/mira-presentation-controller.js' => ['assets/avatar/mira-presentation-controller.js', 'text/javascript'],
    '/assets/avatar/mira-presentation.css' => ['assets/avatar/mira-presentation.css', 'text/css'],
    '/assets/avatar/mira/mira-neutral.webp' => ['assets/avatar/mira/mira-neutral.webp', 'image/webp'],
    '/assets/avatar/mira/mira-thinking.webp' => ['assets/avatar/mira/mira-thinking.webp', 'image/webp'],
    '/assets/avatar/mira/mira-encourage.webp' => ['assets/avatar/mira/mira-encourage.webp', 'image/webp'],
    '/assets/avatar/mira/mira-empathy.webp' => ['assets/avatar/mira/mira-empathy.webp', 'image/webp'],
    '/assets/avatar/mira/mira-smile.webp' => ['assets/avatar/mira/mira-smile.webp', 'image/webp'],
    '/assets/avatar/mira/mira-celebrate.webp' => ['assets/avatar/mira/mira-celebrate.webp', 'image/webp'],
    '/service-worker.js' => ['service-worker.js', 'text/javascript'],
    '/manifest.webmanifest' => ['manifest.webmanifest', 'application/manifest+json'],
    '/assets/icons/icon-192.svg' => ['assets/icons/icon-192.svg', 'image/svg+xml'],
    '/assets/icons/icon-512.svg' => ['assets/icons/icon-512.svg', 'image/svg+xml'],
];
if (isset($files[$path])) {
    [$file, $mime] = $files[$path];
    header('Content-Type: ' . $mime);
    readfile($root . '/' . $file);
    return true;
}
if (!in_array($path, ['/api/auth.php', '/api/tasks.php', '/api/coach.php', '/api/coach_followup.php', '/api/coach_speech.php', '/fixture/reset'], true)
    || $_SERVER['REQUEST_METHOD'] !== 'POST') {
    // In particular, no Live2D release/vendor/config/Production path is served.
    http_response_code(404);
    exit('Local fixture route not found');
}
session_name('am90_dummy_fixture');
session_save_path(sys_get_temp_dir()); // Test-only files in writable OS temp, not XAMPP config.
if (!session_start()) { http_response_code(500); exit('Fixture session unavailable'); }
if ($path === '/fixture/reset') $_SESSION['dummy'] = [];
$state = &$_SESSION['dummy'];
$state ??= [];
$data = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $data['action'] ?? '';
$response = ['ok' => true];
$tasks = [
    ['id' => 501, 'title' => 'Fixture: 最初の15分', 'status' => in_array(501, $state['completed'] ?? [], true) ? 'done' : 'todo'],
    ['id' => 502, 'title' => 'Fixture: 次の一歩', 'status' => in_array(502, $state['completed'] ?? [], true) ? 'done' : 'todo'],
];
if ($path === '/api/auth.php') $response += ['csrfToken' => 'fixture-csrf', 'user' => ['id' => 1, 'email' => 'fixture@example.invalid']];
if ($path === '/api/tasks.php') $response['tasks'] = $tasks;
if ($path === '/api/coach_speech.php') {
    if (($data['csrfToken'] ?? '') !== 'fixture-csrf' || trim((string)($data['text'] ?? '')) === '') {
        http_response_code(422);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false], JSON_THROW_ON_ERROR);
        return true;
    }
    // Deterministic 100 ms silent PCM WAV for local browser playback only.
    $sampleRate = 8000;
    $samples = 800;
    $pcm = str_repeat("\0\0", $samples);
    $wav = 'RIFF' . pack('V', 36 + strlen($pcm)) . 'WAVEfmt ' . pack('VvvVVvv', 16, 1, 1, $sampleRate, $sampleRate * 2, 2, 16)
        . 'data' . pack('V', strlen($pcm)) . $pcm;
    header('Content-Type: audio/wav');
    header('Content-Length: ' . strlen($wav));
    echo $wav;
    return true;
}
if ($path === '/api/coach_followup.php') {
    if (($data['csrfToken'] ?? '') !== 'fixture-csrf') {
        http_response_code(403);
        $response = ['ok' => false, 'message' => 'Fixture CSRF failure'];
    } elseif (trim((string)($data['question'] ?? '')) === '') {
        http_response_code(422);
        $response = ['ok' => false, 'message' => '質問を入力してください。'];
    } elseif (($data['question'] ?? '') === 'FIXTURE_FAIL') {
        http_response_code(503);
        $response = ['ok' => false, 'message' => 'Fixture follow-up failure'];
    } else {
        $response += [
            'reply' => '今日は全部を終えなくても大丈夫です。「Fixture: 次の一歩」を10分だけ進め、残りは明日に分けましょう。',
            'question_type' => 'START_SMALL',
            'behavior_signals' => ['LOW_COMPLETION'],
            'intervention_type' => 'REDUCE_FRICTION',
        ];
    }
}
if ($path === '/api/coach.php') {
    if (in_array($action, ['save_checkin', 'save_journal'], true) && ($data['csrfToken'] ?? '') !== 'fixture-csrf') {
        http_response_code(403);
        $response = ['ok' => false, 'message' => 'Fixture CSRF failure'];
    } elseif ($action === 'save_checkin') {
        $state['checkin'] = ['mood' => (int)$data['mood'], 'focusMinutes' => (int)$data['focusMinutes'],
            'concern' => $data['concern'], 'taskIds' => $data['taskIds'], 'aiMessage' => 'Fixture: 小さな一歩から始めましょう。最初の15分で何をしますか？',
            'aiResponse' => ['question_type' => 'START_SMALL', 'behavior_signals' => ['REPEATED_POSTPONEMENT'], 'intervention_type' => 'REDUCE_FRICTION',
                'coach_message' => 'Fixture: 小さな一歩から始めましょう。最初の15分で何をしますか？']];
        $response['checkin'] = $state['checkin'];
    } elseif ($action === 'save_journal') {
        $state['completed'] = $data['completedTaskIds'];
        $state['journal'] = ['date' => '2026-09-18', 'mood' => (int)$data['mood'], 'reasonCode' => $data['reasonCode'],
            'freeText' => $data['freeText'], 'completedText' => $data['completedText'], 'completedTaskIds' => $data['completedTaskIds'],
            'aiFeedback' => 'Fixture: 2件中1件を完了しました。うまくいった方法は何ですか？',
            'aiResponse' => ['question_type' => 'SUCCESS', 'behavior_signals' => ['GOOD_MOMENTUM'], 'intervention_type' => 'REINFORCE',
                'coach_message' => 'Fixture: 2件中1件を完了しました。うまくいった方法は何ですか？']];
        $response += ['journal' => $state['journal'], 'history' => [$state['journal']]];
    } else $response += ['today' => '2026-09-18', 'todayTaskIds' => [501, 502], 'checkin' => $state['checkin'] ?? null,
        'journal' => $state['journal'] ?? null, 'history' => isset($state['journal']) ? [$state['journal']] : []];
}
header('Content-Type: application/json');
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
return true;

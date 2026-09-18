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
    '/assets/avatar/dummy-avatar-controller.js' => ['assets/avatar/dummy-avatar-controller.js', 'text/javascript'],
    '/assets/avatar/dummy-avatar.css' => ['assets/avatar/dummy-avatar.css', 'text/css'],
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
if (!in_array($path, ['/api/auth.php', '/api/tasks.php', '/api/coach.php', '/fixture/reset'], true)
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
if ($path === '/api/coach.php') {
    if (in_array($action, ['save_checkin', 'save_journal'], true) && ($data['csrfToken'] ?? '') !== 'fixture-csrf') {
        http_response_code(403);
        $response = ['ok' => false, 'message' => 'Fixture CSRF failure'];
    } elseif ($action === 'save_checkin') {
        $state['checkin'] = ['mood' => (int)$data['mood'], 'focusMinutes' => (int)$data['focusMinutes'],
            'concern' => $data['concern'], 'taskIds' => $data['taskIds'], 'aiMessage' => 'Fixture: 小さな一歩から始めましょう。最初の15分で何をしますか？',
            'aiResponse' => ['question_type' => 'START_SMALL', 'behavior_signals' => ['REPEATED_POSTPONEMENT'], 'intervention_type' => 'REDUCE_FRICTION']];
        $response['checkin'] = $state['checkin'];
    } elseif ($action === 'save_journal') {
        $state['completed'] = $data['completedTaskIds'];
        $state['journal'] = ['date' => '2026-09-18', 'mood' => (int)$data['mood'], 'reasonCode' => $data['reasonCode'],
            'freeText' => $data['freeText'], 'completedText' => $data['completedText'], 'completedTaskIds' => $data['completedTaskIds'],
            'aiFeedback' => 'Fixture: 2件中1件を完了しました。うまくいった方法は何ですか？',
            'aiResponse' => ['question_type' => 'SUCCESS', 'behavior_signals' => ['GOOD_MOMENTUM'], 'intervention_type' => 'REINFORCE']];
        $response += ['journal' => $state['journal'], 'history' => [$state['journal']]];
    } else $response += ['today' => '2026-09-18', 'todayTaskIds' => [501, 502], 'checkin' => $state['checkin'] ?? null,
        'journal' => $state['journal'] ?? null, 'history' => isset($state['journal']) ? [$state['journal']] : []];
}
header('Content-Type: application/json');
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
return true;

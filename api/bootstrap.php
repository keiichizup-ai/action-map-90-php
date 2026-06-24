<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';

ini_set('display_errors', APP_ENV === 'production' ? '0' : '1');
ini_set('session.use_strict_mode', '1');

set_exception_handler(function (Throwable $error): void {
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }

    $message = APP_ENV === 'production'
        ? 'サーバー側でエラーが発生しました。config.php、DB接続、テーブル作成を確認してください。'
        : $error->getMessage();

    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => $message,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
});

session_name('action_map_90');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        DB_HOST,
        DB_NAME,
        DB_CHARSET
    );

    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true);

    if (!is_array($data)) {
        fail('リクエスト形式が正しくありません。', 400);
    }

    return $data;
}

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): never
{
    respond(['ok' => false, 'message' => $message], $status);
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function require_csrf(array $data): void
{
    $token = (string)($data['csrfToken'] ?? '');

    if ($token === '' || !hash_equals(csrf_token(), $token)) {
        fail('セッションの確認に失敗しました。ページを再読み込みしてください。', 403);
    }
}

function current_user_id(): int
{
    $userId = (int)($_SESSION['user_id'] ?? 0);

    if ($userId <= 0) {
        fail('ログインしてください。', 401);
    }

    return $userId;
}

function user_payload(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    return [
        'id' => (int)$_SESSION['user_id'],
        'email' => (string)($_SESSION['email'] ?? ''),
    ];
}

function validate_email_password(string $email, string $password): void
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('メールアドレスの形式が正しくありません。');
    }

    if (mb_strlen($password) < 8) {
        fail('パスワードは8文字以上で入力してください。');
    }
}

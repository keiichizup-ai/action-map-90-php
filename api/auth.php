<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
$action = (string)($data['action'] ?? '');

if ($action === 'status') {
    respond([
        'ok' => true,
        'csrfToken' => csrf_token(),
        'user' => user_payload(),
    ]);
}

if ($action === 'logout') {
    require_csrf($data);
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    respond([
        'ok' => true,
        'csrfToken' => csrf_token(),
        'user' => null,
    ]);
}

require_csrf($data);

$email = trim((string)($data['email'] ?? ''));
$password = (string)($data['password'] ?? '');

if ($action === 'register') {
    validate_email_password($email, $password);
    register_user($email, $password);
}

if ($action === 'login') {
    login_user($email, $password);
}

fail('未対応の操作です。', 404);

function register_user(string $email, string $password): never
{
    $hash = password_hash($password, PASSWORD_DEFAULT);

    try {
        $stmt = db()->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
        $stmt->execute([$email, $hash]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            fail('このメールアドレスは既に登録されています。ログインをお試しください。', 409);
        }
        throw $e;
    }

    $userId = (int)db()->lastInsertId();
    set_user_session($userId, $email);

    respond([
        'ok' => true,
        'csrfToken' => csrf_token(),
        'user' => user_payload(),
    ]);
}

function login_user(string $email, string $password): never
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
        fail('メールアドレスとパスワードを入力してください。', 400);
    }

    $stmt = db()->prepare('SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        fail('メールアドレスまたはパスワードが違います。', 401);
    }

    set_user_session((int)$user['id'], (string)$user['email']);

    respond([
        'ok' => true,
        'csrfToken' => csrf_token(),
        'user' => user_payload(),
    ]);
}

function set_user_session(int $userId, string $email): void
{
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['email'] = $email;
    csrf_token();
}

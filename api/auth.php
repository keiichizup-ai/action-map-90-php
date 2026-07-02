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

require_csrf($data);

if ($action === 'register') {
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');
    validate_email_password($email, $password);

    $stmt = db()->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);

    if ($stmt->fetch()) {
        fail('このメールアドレスはすでに登録されています。');
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = db()->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
    $stmt->execute([$email, $hash]);

    $_SESSION['user_id'] = (int)db()->lastInsertId();
    $_SESSION['email'] = $email;

    respond(['ok' => true, 'user' => user_payload()]);
}

if ($action === 'login') {
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $password = (string)($data['password'] ?? '');

    $stmt = db()->prepare('SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, (string)$user['password_hash'])) {
        fail('メールアドレスまたはパスワードが違います。', 401);
    }

    session_regenerate_id(true);
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['email'] = (string)$user['email'];

    respond([
        'ok' => true,
        'csrfToken' => csrf_token(),
        'user' => user_payload(),
    ]);
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    respond(['ok' => true]);
}

fail('未対応の操作です。', 404);

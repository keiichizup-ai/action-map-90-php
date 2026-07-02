<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';

ini_set('display_errors', APP_ENV === 'production' ? '0' : '1');
ini_set('session.use_strict_mode', '1');
session_name('action_map_90_admin');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']),
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function admin_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function h(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function admin_email(): string
{
    return defined('ADMIN_EMAIL') ? (string)ADMIN_EMAIL : '';
}

function admin_password_hash_value(): string
{
    return defined('ADMIN_PASSWORD_HASH') ? (string)ADMIN_PASSWORD_HASH : '';
}

function admin_plain_password(): string
{
    return defined('ADMIN_PASSWORD') ? (string)ADMIN_PASSWORD : '';
}

function is_admin_logged_in(): bool
{
    return !empty($_SESSION['admin_logged_in']);
}

function verify_admin_login(string $email, string $password): bool
{
    if ($email === '' || $password === '' || !hash_equals(admin_email(), $email)) {
        return false;
    }

    $hash = admin_password_hash_value();
    if ($hash !== '') {
        return password_verify($password, $hash);
    }

    $plain = admin_plain_password();
    return $plain !== '' && hash_equals($plain, $password);
}

function admin_csrf_token(): string
{
    if (empty($_SESSION['admin_csrf_token'])) {
        $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string)$_SESSION['admin_csrf_token'];
}

function verify_admin_csrf(): void
{
    $token = (string)($_POST['csrf_token'] ?? '');
    if ($token === '' || !hash_equals(admin_csrf_token(), $token)) {
        http_response_code(403);
        echo 'CSRF token error. ページを再読み込みしてください。';
        exit;
    }
}

function monthly_start(): string
{
    return (new DateTimeImmutable('first day of this month 00:00:00'))->format('Y-m-d H:i:s');
}

function feature_definitions(): array
{
    return [
        'action_expand' => ['label' => 'アクション展開', 'short' => 'アクション'],
        'plan_generate' => ['label' => '30/60/90日プラン作成', 'short' => '30/60/90'],
        'task_decompose' => ['label' => '実行タスク化', 'short' => 'タスク化'],
        'recommendations_generate' => ['label' => '参考動画・書籍', 'short' => '参考'],
        'vision_generate' => ['label' => '90日ビジョン画像', 'short' => '画像'],
    ];
}

function empty_feature_stats(): array
{
    $stats = [];
    foreach (feature_definitions() as $code => $meta) {
        $stats[$code] = [
            'code' => $code,
            'label' => $meta['label'],
            'short' => $meta['short'],
            'count' => 0,
            'lastUsedAt' => null,
        ];
    }
    return $stats;
}

function feature_label(string $feature): string
{
    $defs = feature_definitions();
    return $defs[$feature]['label'] ?? $feature;
}

function to_int(mixed $value): int
{
    return (int)($value ?? 0);
}

function selected_user_ids(): array
{
    $ids = $_POST['user_ids'] ?? [];
    if (!is_array($ids)) {
        return [];
    }
    return array_values(array_unique(array_filter(array_map('intval', $ids), fn (int $id): bool => $id > 0)));
}

function placeholders(array $values): string
{
    return implode(',', array_fill(0, count($values), '?'));
}

function public_vision_path_to_disk_path(string $publicPath): string
{
    if ($publicPath === '') {
        return '';
    }
    $path = (string)(parse_url($publicPath, PHP_URL_PATH) ?: $publicPath);
    $path = str_replace('\\', '/', $path);
    $pos = strpos($path, 'uploads/visions/');
    if ($pos === false) {
        return '';
    }
    $relative = substr($path, $pos);
    if (str_contains($relative, '..')) {
        return '';
    }
    return dirname(__DIR__) . '/' . $relative;
}

function delete_users_with_related_data(PDO $pdo, array $userIds): int
{
    if (!$userIds) {
        return 0;
    }

    $in = placeholders($userIds);

    $stmt = $pdo->prepare('SELECT image_path FROM vision_images WHERE user_id IN (' . $in . ')');
    $stmt->execute($userIds);
    foreach ($stmt->fetchAll() as $image) {
        $diskPath = public_vision_path_to_disk_path((string)($image['image_path'] ?? ''));
        if ($diskPath !== '' && is_file($diskPath)) {
            @unlink($diskPath);
        }
    }

    $pdo->beginTransaction();
    try {
        foreach ([
            'recommendations',
            'vision_images',
            'action_tasks',
            'mandala_charts',
            'usage_events',
        ] as $table) {
            try {
                $stmt = $pdo->prepare('DELETE FROM ' . $table . ' WHERE user_id IN (' . $in . ')');
                $stmt->execute($userIds);
            } catch (Throwable $e) {
                // 古いDBでusage_eventsが未作成の場合などは、削除処理全体を止めない
                if ($table !== 'usage_events') {
                    throw $e;
                }
            }
        }

        $stmt = $pdo->prepare('DELETE FROM users WHERE id IN (' . $in . ')');
        $stmt->execute($userIds);
        $deleted = $stmt->rowCount();
        $pdo->commit();
        return $deleted;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function render_login(string $error = ''): never
{
    ?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACTION MAP 90 管理ログイン</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top left,#4c1d95,transparent 38%),#060914;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif}.card{width:min(440px,calc(100% - 32px));padding:30px;border:1px solid rgba(255,255,255,.14);border-radius:26px;background:rgba(255,255,255,.08);box-shadow:0 24px 80px rgba(0,0,0,.45)}.eyebrow{color:#c4b5fd;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}h1{margin:8px 0 8px;font-size:30px}.muted{color:#a7b0c3;line-height:1.7}.label{display:block;margin:16px 0 6px;font-weight:900}.input{width:100%;box-sizing:border-box;min-height:46px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(255,255,255,.08);color:#fff;padding:10px 12px}.btn{width:100%;min-height:48px;margin-top:20px;border:0;border-radius:999px;background:linear-gradient(135deg,#a78bfa,#22d3ee);color:#08111f;font-weight:950;cursor:pointer}.error{margin-top:14px;color:#fecaca;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.34);padding:10px;border-radius:12px}
  </style>
</head>
<body>
  <form class="card" method="post">
    <div class="eyebrow">Admin Dashboard</div>
    <h1>ACTION MAP 90</h1>
    <p class="muted">管理者としてログインしてください。</p>
    <input type="hidden" name="action" value="login">
    <label class="label">管理者メールアドレス</label>
    <input class="input" type="email" name="email" required autocomplete="username">
    <label class="label">管理者パスワード</label>
    <input class="input" type="password" name="password" required autocomplete="current-password">
    <button class="btn" type="submit">ログイン</button>
    <?php if ($error !== ''): ?><div class="error"><?= h($error) ?></div><?php endif; ?>
  </form>
</body>
</html>
    <?php
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = (string)($_POST['action'] ?? '');

    if ($action === 'login') {
        $email = trim((string)($_POST['email'] ?? ''));
        $password = (string)($_POST['password'] ?? '');
        if (verify_admin_login($email, $password)) {
            session_regenerate_id(true);
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_email'] = $email;
            admin_csrf_token();
            header('Location: ./');
            exit;
        }
        render_login('メールアドレスまたはパスワードが違います。');
    }

    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        header('Location: ./');
        exit;
    }
}

if (!is_admin_logged_in()) {
    render_login();
}

$notice = '';
$error = '';

try {
    $pdo = admin_db();

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && (string)($_POST['action'] ?? '') === 'delete_users') {
        verify_admin_csrf();
        $ids = selected_user_ids();
        if (!$ids) {
            $error = '削除するユーザーを選択してください。';
        } else {
            $deleted = delete_users_with_related_data($pdo, $ids);
            $notice = $deleted . '件のユーザーと関連データを削除しました。';
        }
    }

    $summary = [
        'users' => (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn(),
        'charts' => (int)$pdo->query('SELECT COUNT(*) FROM mandala_charts')->fetchColumn(),
        'tasks' => (int)$pdo->query('SELECT COUNT(*) FROM action_tasks')->fetchColumn(),
        'doneTasks' => (int)$pdo->query("SELECT COUNT(*) FROM action_tasks WHERE status = 'done'")->fetchColumn(),
        'usageThisMonth' => 0,
    ];

    $featureStats = empty_feature_stats();
    $usageTableReady = true;

    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM usage_events WHERE created_at >= ?');
        $stmt->execute([monthly_start()]);
        $summary['usageThisMonth'] = (int)$stmt->fetchColumn();

        $stmt = $pdo->query('SELECT feature, COUNT(*) AS count, MAX(created_at) AS lastUsedAt FROM usage_events GROUP BY feature');
        foreach ($stmt->fetchAll() as $row) {
            $code = (string)$row['feature'];
            if (!isset($featureStats[$code])) {
                continue;
            }
            $featureStats[$code]['count'] = (int)$row['count'];
            $featureStats[$code]['lastUsedAt'] = $row['lastUsedAt'] ?: null;
        }
    } catch (Throwable $e) {
        $usageTableReady = false;
        $summary['usageThisMonth'] = 0;
    }

    if ($usageTableReady) {
        $usersSql =
            'SELECT
                u.id,
                u.email,
                u.created_at AS createdAt,
                CASE WHEN u.password_hash IS NULL OR u.password_hash = "" THEN 0 ELSE 1 END AS hasPassword,
                (SELECT MAX(m.updated_at) FROM mandala_charts m WHERE m.user_id = u.id) AS chartUpdatedAt,
                (SELECT COUNT(*) FROM action_tasks t WHERE t.user_id = u.id) AS taskCount,
                (SELECT COUNT(*) FROM action_tasks t WHERE t.user_id = u.id AND t.status = "done") AS doneTaskCount,
                (SELECT COUNT(*) FROM recommendations r WHERE r.user_id = u.id) AS recommendationCount,
                (SELECT COUNT(*) FROM vision_images v WHERE v.user_id = u.id) AS visionImageCount,
                (SELECT COUNT(*) FROM usage_events ue WHERE ue.user_id = u.id AND ue.feature = "action_expand") AS actionExpandCount,
                (SELECT COUNT(*) FROM usage_events ue WHERE ue.user_id = u.id AND ue.feature = "plan_generate") AS planGenerateCount,
                (SELECT COUNT(*) FROM usage_events ue WHERE ue.user_id = u.id AND ue.feature = "task_decompose") AS taskDecomposeCount,
                (SELECT COUNT(*) FROM usage_events ue WHERE ue.user_id = u.id AND ue.feature = "recommendations_generate") AS recommendationsGenerateCount,
                (SELECT COUNT(*) FROM usage_events ue WHERE ue.user_id = u.id AND ue.feature = "vision_generate") AS visionGenerateCount,
                (SELECT MAX(ue.created_at) FROM usage_events ue WHERE ue.user_id = u.id) AS lastUsedAt
             FROM users u
             ORDER BY u.created_at DESC';
    } else {
        $usersSql =
            'SELECT
                u.id,
                u.email,
                u.created_at AS createdAt,
                CASE WHEN u.password_hash IS NULL OR u.password_hash = "" THEN 0 ELSE 1 END AS hasPassword,
                (SELECT MAX(m.updated_at) FROM mandala_charts m WHERE m.user_id = u.id) AS chartUpdatedAt,
                (SELECT COUNT(*) FROM action_tasks t WHERE t.user_id = u.id) AS taskCount,
                (SELECT COUNT(*) FROM action_tasks t WHERE t.user_id = u.id AND t.status = "done") AS doneTaskCount,
                (SELECT COUNT(*) FROM recommendations r WHERE r.user_id = u.id) AS recommendationCount,
                (SELECT COUNT(*) FROM vision_images v WHERE v.user_id = u.id) AS visionImageCount,
                0 AS actionExpandCount,
                0 AS planGenerateCount,
                0 AS taskDecomposeCount,
                0 AS recommendationsGenerateCount,
                0 AS visionGenerateCount,
                NULL AS lastUsedAt
             FROM users u
             ORDER BY u.created_at DESC';
    }

    $users = $pdo->query($usersSql)->fetchAll();
} catch (Throwable $e) {
    http_response_code(500);
    echo '<pre>管理画面の読み込みに失敗しました: ' . h(APP_ENV === 'production' ? 'DB接続またはテーブルを確認してください。' : $e->getMessage()) . '</pre>';
    exit;
}
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACTION MAP 90 管理画面</title>
  <style>
    :root{--bg:#070b16;--panel:#111827;--panel2:#172033;--line:rgba(255,255,255,.12);--text:#f8fafc;--muted:#94a3b8;--primary:#a78bfa;--cyan:#22d3ee;--green:#86efac;--red:#fca5a5;--amber:#fde68a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 0 0,rgba(124,58,237,.38),transparent 32%),radial-gradient(circle at 100% 10%,rgba(34,211,238,.16),transparent 28%),var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif}.shell{width:min(1380px,calc(100% - 32px));margin:0 auto;padding:26px 0 56px}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:22px}.eyebrow{margin:0 0 8px;color:#c4b5fd;font-size:12px;font-weight:950;letter-spacing:.18em;text-transform:uppercase}.title{margin:0;font-size:clamp(30px,4vw,52px);letter-spacing:-.07em;line-height:1}.subtitle{margin:18px 0 0;color:#cbd5e1;line-height:1.7}.badge{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:8px 12px;border:1px solid rgba(34,211,238,.28);border-radius:999px;background:rgba(34,211,238,.1);color:#cffafe;font-weight:900;font-size:12px}.btn{border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.08);color:var(--text);font-weight:900;padding:10px 15px;cursor:pointer;text-decoration:none}.btn:hover{background:rgba(255,255,255,.14)}.btn-danger{background:rgba(239,68,68,.18);border-color:rgba(252,165,165,.42);color:#fecaca}.btn-danger:hover{background:rgba(239,68,68,.28)}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0}.metric-card,.panel{border:1px solid var(--line);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.045));box-shadow:0 18px 60px rgba(0,0,0,.22)}.metric-card{padding:17px}.label{color:#b6c2d8;font-size:13px;font-weight:800}.num{margin-top:6px;font-size:34px;font-weight:950;letter-spacing:-.04em}.panel{padding:18px;margin-top:18px}.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}h2{margin:0;font-size:26px;letter-spacing:-.04em}.muted{color:var(--muted);font-size:13px;line-height:1.65}.overview-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:0 0 18px}.overview-card{padding:15px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.055)}.overview-card .num{font-size:30px}.feature-title{margin:18px 0 12px;font-size:18px;letter-spacing:-.02em}.feature-grid{display:grid;grid-template-columns:repeat(5,minmax(160px,1fr));gap:12px}.feature-card{position:relative;overflow:hidden;padding:16px;border:1px solid rgba(167,139,250,.22);border-radius:18px;background:linear-gradient(135deg,rgba(167,139,250,.16),rgba(34,211,238,.06))}.feature-card:before{content:"";position:absolute;inset:0 0 auto auto;width:72px;height:72px;border-radius:50%;background:rgba(34,211,238,.18);transform:translate(28px,-28px)}.feature-name{position:relative;font-weight:950;font-size:14px}.feature-count{position:relative;margin-top:10px;font-size:32px;font-weight:950}.feature-last{position:relative;margin-top:4px;color:#a7b0c3;font-size:12px}.notice,.error{margin:14px 0;padding:12px 14px;border-radius:16px;font-weight:800}.notice{background:rgba(34,197,94,.14);border:1px solid rgba(134,239,172,.32);color:#dcfce7}.error{background:rgba(239,68,68,.14);border:1px solid rgba(252,165,165,.32);color:#fecaca}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.045)}table{width:100%;border-collapse:collapse;min-width:1220px}th,td{padding:13px 12px;border-bottom:1px solid rgba(255,255,255,.09);text-align:left;vertical-align:top;font-size:13px}th{position:sticky;top:0;background:#111827;color:#dbeafe;white-space:nowrap;z-index:1}tr:last-child td{border-bottom:0}.user-email{font-weight:950}.small{font-size:12px}.status-ok{color:var(--green);font-weight:900}.pill{display:inline-flex;align-items:center;justify-content:center;min-width:34px;margin:2px 4px 2px 0;padding:5px 8px;border-radius:999px;background:rgba(167,139,250,.18);border:1px solid rgba(167,139,250,.25);font-size:12px;font-weight:900}.usage-num{font-size:20px;font-weight:950}.usage-zero{color:#64748b}.check{width:18px;height:18px}.danger-zone{border-color:rgba(252,165,165,.26);background:rgba(127,29,29,.16)}@media(max-width:1000px){.top{display:block}.metrics,.overview-grid,.feature-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.metrics,.overview-grid,.feature-grid{grid-template-columns:1fr}.shell{width:min(100% - 20px,1380px)}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top">
      <div>
        <p class="eyebrow">Admin Dashboard</p>
        <h1 class="title">ACTION MAP 90 管理画面</h1>
        <p class="subtitle">β評価用に、ユーザー登録状況・機能別利用回数・最終利用日・関連データ削除を確認できます。</p>
        <div class="badge">管理画面 v2.1 / 全体ダッシュボード統合版</div>
      </div>
      <form method="post">
        <input type="hidden" name="action" value="logout">
        <button class="btn" type="submit">ログアウト</button>
      </form>
    </header>

    <?php if ($notice !== ''): ?><div class="notice"><?= h($notice) ?></div><?php endif; ?>
    <?php if ($error !== ''): ?><div class="error"><?= h($error) ?></div><?php endif; ?>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Dashboard</p>
          <h2>全体ダッシュボード</h2>
        </div>
        <?php if (!$usageTableReady): ?>
          <div class="error">usage_events テーブルがありません。migration_004を実行してください。</div>
        <?php endif; ?>
      </div>

      <div class="overview-grid" aria-label="全体サマリー">
        <div class="overview-card"><div class="label">ユーザー数</div><div class="num"><?= h($summary['users']) ?></div></div>
        <div class="overview-card"><div class="label">チャート数</div><div class="num"><?= h($summary['charts']) ?></div></div>
        <div class="overview-card"><div class="label">全タスク</div><div class="num"><?= h($summary['tasks']) ?></div></div>
        <div class="overview-card"><div class="label">完了タスク</div><div class="num"><?= h($summary['doneTasks']) ?></div></div>
        <div class="overview-card"><div class="label">今月の機能利用</div><div class="num"><?= h($summary['usageThisMonth']) ?></div></div>
      </div>

      <h3 class="feature-title">機能別利用回数</h3>
      <div class="feature-grid">
        <?php foreach ($featureStats as $feature): ?>
          <article class="feature-card">
            <div class="feature-name"><?= h($feature['label']) ?></div>
            <div class="feature-count"><?= h($feature['count']) ?><span class="small"> 回</span></div>
            <div class="feature-last">最終実行: <?= h($feature['lastUsedAt'] ?: '-') ?></div>
          </article>
        <?php endforeach; ?>
      </div>
      <p class="muted">※この回数は、更新版APIを反映した後の実行から記録されます。過去分は自動では加算されません。</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Users</p>
          <h2>ユーザー一覧</h2>
        </div>
        <div class="muted">表示ユーザー数: <?= h(count($users)) ?></div>
      </div>

      <form method="post" onsubmit="return confirm('選択したユーザーと関連データを完全に削除します。よろしいですか？');">
        <input type="hidden" name="action" value="delete_users">
        <input type="hidden" name="csrf_token" value="<?= h(admin_csrf_token()) ?>">
        <div class="toolbar">
          <div class="muted">チェックしたユーザーは、関連データごと削除できます。</div>
          <button class="btn btn-danger" type="submit">選択ユーザーを削除</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>削除</th>
                <th>ID</th>
                <th>ユーザー情報</th>
                <th>パスワード</th>
                <th>アクション展開</th>
                <th>30/60/90日プラン作成</th>
                <th>実行タスク化</th>
                <th>参考動画・書籍</th>
                <th>90日ビジョン画像</th>
                <th>最終利用日</th>
                <th>タスク</th>
                <th>生成物</th>
              </tr>
            </thead>
            <tbody>
              <?php if (!$users): ?>
                <tr><td colspan="12" class="muted">ユーザーがまだ登録されていません。</td></tr>
              <?php endif; ?>
              <?php foreach ($users as $user): ?>
                <?php
                  $taskCount = to_int($user['taskCount']);
                  $doneCount = to_int($user['doneTaskCount']);
                  $doneRate = $taskCount > 0 ? round($doneCount / $taskCount * 100) : 0;
                  $counts = [
                      'actionExpandCount' => to_int($user['actionExpandCount']),
                      'planGenerateCount' => to_int($user['planGenerateCount']),
                      'taskDecomposeCount' => to_int($user['taskDecomposeCount']),
                      'recommendationsGenerateCount' => to_int($user['recommendationsGenerateCount']),
                      'visionGenerateCount' => to_int($user['visionGenerateCount']),
                  ];
                ?>
                <tr>
                  <td><input class="check" type="checkbox" name="user_ids[]" value="<?= h($user['id']) ?>" aria-label="ユーザー<?= h($user['id']) ?>を削除"></td>
                  <td><?= h($user['id']) ?></td>
                  <td>
                    <div class="user-email"><?= h($user['email']) ?></div>
                    <div class="muted small">登録日: <?= h($user['createdAt']) ?></div>
                    <div class="muted small">チャート更新: <?= h($user['chartUpdatedAt'] ?: '-') ?></div>
                  </td>
                  <td>
                    <?php if ((int)$user['hasPassword'] === 1): ?>
                      <span class="status-ok">登録済み</span><br>
                      <span class="muted small">本文は安全のため非表示</span>
                    <?php else: ?>
                      <span class="usage-zero">未設定</span>
                    <?php endif; ?>
                  </td>
                  <td><span class="usage-num <?= $counts['actionExpandCount'] === 0 ? 'usage-zero' : '' ?>"><?= h($counts['actionExpandCount']) ?></span> 回</td>
                  <td><span class="usage-num <?= $counts['planGenerateCount'] === 0 ? 'usage-zero' : '' ?>"><?= h($counts['planGenerateCount']) ?></span> 回</td>
                  <td><span class="usage-num <?= $counts['taskDecomposeCount'] === 0 ? 'usage-zero' : '' ?>"><?= h($counts['taskDecomposeCount']) ?></span> 回</td>
                  <td><span class="usage-num <?= $counts['recommendationsGenerateCount'] === 0 ? 'usage-zero' : '' ?>"><?= h($counts['recommendationsGenerateCount']) ?></span> 回</td>
                  <td><span class="usage-num <?= $counts['visionGenerateCount'] === 0 ? 'usage-zero' : '' ?>"><?= h($counts['visionGenerateCount']) ?></span> 回</td>
                  <td><?= h($user['lastUsedAt'] ?: '-') ?></td>
                  <td>
                    <span class="pill">全体 <?= h($taskCount) ?></span>
                    <span class="pill">完了 <?= h($doneCount) ?></span>
                    <span class="pill">完了率 <?= h($doneRate) ?>%</span>
                  </td>
                  <td>
                    <span class="pill">参考 <?= h($user['recommendationCount']) ?></span>
                    <span class="pill">画像 <?= h($user['visionImageCount']) ?></span>
                  </td>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </form>
    </section>
  </main>
</body>
</html>

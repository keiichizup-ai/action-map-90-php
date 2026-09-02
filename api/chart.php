<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
$action = (string)($data['action'] ?? '');
$userId = current_user_id();

if ($action === 'load') {
    respond([
        'ok' => true,
        'chart' => load_chart($userId),
    ]);
}

require_csrf($data);

if ($action === 'save') {
    $cells = normalize_cells($data['cells'] ?? []);
    $aiResult = (string)($data['aiResult'] ?? '');
    $goalWhy = mb_substr(trim((string)($data['goalWhy'] ?? '')), 0, 5000);
    $goalDeadline = normalize_goal_deadline($data['goalDeadline'] ?? null);

    save_chart($userId, $cells, $aiResult, $goalWhy, $goalDeadline);

    respond([
        'ok' => true,
        'chart' => load_chart($userId),
    ]);
}

if ($action === 'delete') {
    delete_user_work_data($userId);
    respond([
        'ok' => true,
        'chart' => empty_chart(),
    ]);
}

fail('未対応の操作です。', 404);

function empty_chart(): array
{
    return [
        'cells' => array_fill(0, 81, ''),
        'aiResult' => '',
        'goalWhy' => '',
        'goalDeadline' => null,
    ];
}

function load_chart(int $userId): array
{
    $stmt = db()->prepare(
        'SELECT cells, ai_result AS aiResult, goal_why AS goalWhy, goal_deadline AS goalDeadline
         FROM mandala_charts
         WHERE user_id = ? AND chart_key = "default"
         LIMIT 1'
    );
    $stmt->execute([$userId]);
    $chart = $stmt->fetch();

    if (!$chart) {
        return empty_chart();
    }

    $cells = json_decode((string)$chart['cells'], true);
    if (!is_array($cells)) {
        $cells = array_fill(0, 81, '');
    }

    return [
        'cells' => normalize_cells($cells),
        'aiResult' => (string)($chart['aiResult'] ?? ''),
        'goalWhy' => (string)($chart['goalWhy'] ?? ''),
        'goalDeadline' => $chart['goalDeadline'] ?: null,
    ];
}

function save_chart(int $userId, array $cells, string $aiResult, string $goalWhy, ?string $goalDeadline): void
{
    $stmt = db()->prepare(
        'INSERT INTO mandala_charts (user_id, chart_key, cells, ai_result, goal_why, goal_deadline)
         VALUES (?, "default", ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cells = VALUES(cells),
           ai_result = VALUES(ai_result),
           goal_why = VALUES(goal_why),
           goal_deadline = VALUES(goal_deadline),
           updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        $userId,
        json_encode($cells, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        $aiResult,
        $goalWhy !== '' ? $goalWhy : null,
        $goalDeadline,
    ]);
}

function normalize_goal_deadline(mixed $value): ?string
{
    $date = trim((string)$value);
    if ($date === '') {
        return null;
    }

    $candidate = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$candidate || $candidate->format('Y-m-d') !== $date) {
        fail('目標期限の日付が正しくありません。', 400);
    }

    return $date;
}

function normalize_cells(mixed $cells): array
{
    if (!is_array($cells)) {
        $cells = [];
    }

    $normalized = array_fill(0, 81, '');
    for ($i = 0; $i < 81; $i += 1) {
        $normalized[$i] = mb_substr(trim((string)($cells[$i] ?? '')), 0, 1000);
    }

    return $normalized;
}

function delete_user_work_data(int $userId): void
{
    $visionPaths = [];
    try {
        $stmt = db()->prepare('SELECT image_path AS imagePath FROM vision_images WHERE user_id = ?');
        $stmt->execute([$userId]);
        foreach ($stmt->fetchAll() as $image) {
            $visionPaths[] = (string)($image['imagePath'] ?? '');
        }
    } catch (Throwable $e) {
        $visionPaths = [];
    }

    db()->beginTransaction();
    try {
        delete_optional_user_rows('daily_journals', $userId);
        delete_optional_user_rows('daily_checkins', $userId);
        delete_optional_user_rows('task_activity_log', $userId);
        db()->prepare('DELETE FROM recommendations WHERE user_id = ?')->execute([$userId]);
        db()->prepare('DELETE FROM vision_images WHERE user_id = ?')->execute([$userId]);
        db()->prepare('DELETE FROM action_tasks WHERE user_id = ?')->execute([$userId]);
        db()->prepare('DELETE FROM mandala_charts WHERE user_id = ?')->execute([$userId]);
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }

    foreach ($visionPaths as $publicPath) {
        $diskPath = public_upload_path_to_disk_path($publicPath);
        if ($diskPath !== '' && is_file($diskPath)) {
            @unlink($diskPath);
        }
    }
}

function delete_optional_user_rows(string $table, int $userId): void
{
    $allowedTables = ['daily_journals', 'daily_checkins', 'task_activity_log'];
    if (!in_array($table, $allowedTables, true)) {
        throw new InvalidArgumentException('削除対象テーブルが正しくありません。');
    }

    try {
        db()->prepare("DELETE FROM {$table} WHERE user_id = ?")->execute([$userId]);
    } catch (PDOException $error) {
        if ((string)$error->getCode() !== '42S02') {
            throw $error;
        }
    }
}

function public_upload_path_to_disk_path(string $publicPath): string
{
    $path = trim($publicPath);
    if ($path === '') {
        return '';
    }

    if (str_starts_with($path, './')) {
        $path = substr($path, 2);
    }

    $path = ltrim($path, '/');
    if (!str_starts_with($path, 'uploads/visions/')) {
        return '';
    }

    $diskPath = realpath(__DIR__ . '/../' . $path);
    if ($diskPath === false) {
        return '';
    }

    $uploadsRoot = realpath(__DIR__ . '/../uploads/visions');
    if ($uploadsRoot === false || !str_starts_with($diskPath, $uploadsRoot)) {
        return '';
    }

    return $diskPath;
}

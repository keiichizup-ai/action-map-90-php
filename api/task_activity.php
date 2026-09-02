<?php
declare(strict_types=1);

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

if (!defined('TASK_ACTIVITY_SKIP_BOOTSTRAP')) {
    require_once __DIR__ . '/bootstrap.php';
}

function update_owned_task_with_activity(int $userId, int $taskId, array $changes): array
{
    $columnMap = [
        'title' => 'title',
        'startDate' => 'start_date',
        'dueDate' => 'due_date',
        'status' => 'status',
    ];
    $updates = [];
    $params = [];

    foreach ($columnMap as $key => $column) {
        if (array_key_exists($key, $changes)) {
            $updates[] = "{$column} = ?";
            $params[] = $changes[$key];
        }
    }

    if (!$updates) {
        throw new InvalidArgumentException('更新対象がありません。');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $lockClause = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $select = $pdo->prepare(
            'SELECT id, user_id, title, start_date, due_date, status
             FROM action_tasks
             WHERE id = ? AND user_id = ?
             LIMIT 1' . $lockClause
        );
        $select->execute([$taskId, $userId]);
        $before = $select->fetch();
        if (!$before) {
            throw new OutOfBoundsException('TASK_NOT_FOUND');
        }

        $params[] = $taskId;
        $params[] = $userId;
        $update = $pdo->prepare(
            'UPDATE action_tasks
             SET ' . implode(', ', $updates) . ', updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?'
        );
        $update->execute($params);

        $after = $before;
        foreach ($columnMap as $key => $column) {
            if (array_key_exists($key, $changes)) {
                $after[$column] = $changes[$key];
            }
        }

        record_task_activity_changes($pdo, $userId, $taskId, $before, $after);
        $pdo->commit();
        return $after;
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($error instanceof OutOfBoundsException && $error->getMessage() === 'TASK_NOT_FOUND') {
            fail('タスクが見つかりません。', 404);
        }
        throw $error;
    }
}

function record_task_activity_changes(PDO $pdo, int $userId, int $taskId, array $before, array $after): void
{
    $dateChanged = ($before['start_date'] ?? null) !== ($after['start_date'] ?? null)
        || ($before['due_date'] ?? null) !== ($after['due_date'] ?? null);
    $statusChanged = ($before['status'] ?? null) !== ($after['status'] ?? null);

    if ($dateChanged) {
        insert_task_activity($pdo, $userId, $taskId, $before, $after, 'DATE_CHANGED');
    }
    if ($statusChanged) {
        insert_task_activity($pdo, $userId, $taskId, $before, $after, 'STATUS_CHANGED');
    }
}

function insert_task_activity(PDO $pdo, int $userId, int $taskId, array $before, array $after, string $eventType): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO task_activity_log
         (user_id, task_id, task_title_snapshot, event_type,
          old_start_date, old_due_date, new_start_date, new_due_date,
          old_status, new_status, is_postponement)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        $taskId,
        mb_substr((string)($after['title'] ?? $before['title'] ?? ''), 0, 255),
        $eventType,
        $before['start_date'] ?? null,
        $before['due_date'] ?? null,
        $after['start_date'] ?? null,
        $after['due_date'] ?? null,
        $before['status'] ?? null,
        $after['status'] ?? null,
        $eventType === 'DATE_CHANGED' && is_task_postponement($before, $after) ? 1 : 0,
    ]);
}

function is_task_postponement(array $before, array $after): bool
{
    $oldDue = $before['due_date'] ?? null;
    $newDue = $after['due_date'] ?? null;
    if ($oldDue && $newDue && $newDue > $oldDue) {
        return true;
    }

    $oldStart = $before['start_date'] ?? null;
    $newStart = $after['start_date'] ?? null;
    return (bool)($oldStart && $newStart && $newStart > $oldStart);
}

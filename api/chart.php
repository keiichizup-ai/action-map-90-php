<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$data = json_input();
$action = (string)($data['action'] ?? '');
$userId = current_user_id();

if ($action === 'load') {
    $stmt = db()->prepare('SELECT cells, ai_result, updated_at FROM mandala_charts WHERE user_id = ? AND chart_key = ? LIMIT 1');
    $stmt->execute([$userId, 'default']);
    $chart = $stmt->fetch();

    respond([
        'ok' => true,
        'chart' => $chart ? [
            'cells' => json_decode((string)$chart['cells'], true) ?: [],
            'aiResult' => (string)($chart['ai_result'] ?? ''),
            'updatedAt' => (string)$chart['updated_at'],
        ] : [
            'cells' => [],
            'aiResult' => '',
            'updatedAt' => null,
        ],
    ]);
}

require_csrf($data);

if ($action === 'save') {
    $cells = $data['cells'] ?? [];
    $aiResult = (string)($data['aiResult'] ?? '');

    if (!is_array($cells)) {
        fail('保存データが正しくありません。');
    }

    $jsonCells = json_encode(array_slice($cells, 0, 81), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $stmt = db()->prepare(
        'INSERT INTO mandala_charts (user_id, chart_key, cells, ai_result)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cells = VALUES(cells), ai_result = VALUES(ai_result)'
    );
    $stmt->execute([$userId, 'default', $jsonCells, $aiResult]);

    respond(['ok' => true]);
}

if ($action === 'delete') {
    $stmt = db()->prepare('DELETE FROM mandala_charts WHERE user_id = ? AND chart_key = ?');
    $stmt->execute([$userId, 'default']);
    db()->prepare('DELETE FROM recommendations WHERE user_id = ?')->execute([$userId]);
    db()->prepare('DELETE FROM action_tasks WHERE user_id = ?')->execute([$userId]);
    db()->prepare('DELETE FROM vision_images WHERE user_id = ?')->execute([$userId]);
    respond(['ok' => true]);
}

fail('未対応の操作です。', 404);

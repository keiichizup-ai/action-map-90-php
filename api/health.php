<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$checks = [
    'phpVersion' => PHP_VERSION,
    'configLoaded' => defined('DB_HOST') && defined('DB_NAME') && defined('DB_USER'),
    'pdoMysqlLoaded' => extension_loaded('pdo_mysql'),
    'curlLoaded' => extension_loaded('curl'),
    'dbHost' => defined('DB_HOST') ? DB_HOST : null,
    'dbName' => defined('DB_NAME') ? DB_NAME : null,
    'dbUser' => defined('DB_USER') ? DB_USER : null,
    'dbConnected' => false,
    'tables' => [],
];

try {
    $pdo = db();
    $checks['dbConnected'] = true;

    $requiredTables = [
        'users',
        'mandala_charts',
        'action_tasks',
        'recommendations',
        'vision_images',
    ];

    foreach ($requiredTables as $table) {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS count
             FROM information_schema.tables
             WHERE table_schema = ?
             AND table_name = ?'
        );
        $stmt->execute([DB_NAME, $table]);
        $checks['tables'][$table] = ((int)$stmt->fetchColumn()) > 0;
    }
} catch (Throwable $error) {
    $checks['dbError'] = $error->getMessage();
}

respond([
    'ok' => true,
    'checks' => $checks,
]);

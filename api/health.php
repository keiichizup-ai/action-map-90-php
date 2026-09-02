<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    db()->query('SELECT 1');
} catch (Throwable $error) {
    error_log('ACTION MAP 90 health check failed: ' . $error->getMessage());
    respond(['ok' => false], 503);
}

respond(['ok' => true]);

<?php
declare(strict_types=1);

if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

function send_no_store_html_headers(): void
{
    if (headers_sent()) {
        return;
    }

    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
}

function versioned_asset_url(string $relativePath): string
{
    $normalizedPath = preg_replace('#^\./#', '', $relativePath);
    if (!is_string($normalizedPath) || $normalizedPath === '' || str_contains($normalizedPath, '..')) {
        throw new InvalidArgumentException('Invalid asset path.');
    }

    $rootPath = realpath(__DIR__);
    $assetPath = realpath(__DIR__ . DIRECTORY_SEPARATOR . $normalizedPath);
    if (
        $rootPath === false
        || $assetPath === false
        || !str_starts_with($assetPath, $rootPath . DIRECTORY_SEPARATOR)
        || !is_file($assetPath)
    ) {
        throw new RuntimeException('Asset not found: ' . $relativePath);
    }

    $assetHash = hash_file('sha256', $assetPath);
    if ($assetHash === false) {
        throw new RuntimeException('Unable to version asset: ' . $relativePath);
    }

    return './' . $normalizedPath . '?v=' . substr($assetHash, 0, 12);
}

function html_attribute(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

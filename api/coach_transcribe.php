<?php
declare(strict_types=1);

if (!defined('COACH_TRANSCRIBE_SKIP_BOOTSTRAP')) {
    require_once __DIR__ . '/bootstrap.php';
}

const COACH_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const COACH_TRANSCRIBE_MAX_BYTES = 5_000_000;
const COACH_TRANSCRIBE_MAX_DURATION_MS = 30_500;
const COACH_TRANSCRIBE_MAX_TEXT = 500;
const COACH_TRANSCRIBE_MIME_TYPES = [
    'audio/ogg' => 'ogg',
    'audio/mp4' => 'm4a',
    'video/mp4' => 'm4a',
    'audio/mpeg' => 'mp3',
    'audio/wav' => 'wav',
    'audio/x-wav' => 'wav',
];
const COACH_TRANSCRIBE_WEBM_MIME_TYPES = [
    'audio/webm',
    'video/webm',
];
const COACH_TRANSCRIBE_MP4_MIME_TYPES = [
    'audio/mp4',
    'video/mp4',
    'audio/x-m4a',
    'application/mp4',
    'video/quicktime',
    'application/octet-stream',
];

function coach_transcribe_enabled(array $server, string $sapi, string $directory): bool
{
    $script = (string)($server['SCRIPT_NAME'] ?? '');
    $host = parse_url('http://' . ($server['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    $normalizedDirectory = rtrim($directory, '/');
    if (str_starts_with($script, '/action-map-90/')
        || str_contains($normalizedDirectory . '/', '/action-map-90/')) {
        return false;
    }
    $local = $sapi === 'cli-server'
        && in_array($server['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)
        && in_array($host, ['localhost', '127.0.0.1', '[::1]'], true)
        && $script === '/api/coach_transcribe.php';
    $staging = ($server['HTTP_HOST'] ?? '') === 'keiichizup.sakura.ne.jp'
        && $script === '/action-map-90-staging/api/coach_transcribe.php'
        && $normalizedDirectory === '/home/keiichizup/www/action-map-90-staging/api';
    return $local || $staging;
}

function normalizeCoachTranscript(mixed $value): string
{
    if (!is_string($value) || preg_match('/<[^>]*>|```|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value) === 1) {
        return '';
    }
    $normalized = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    return $normalized !== '' && mb_strlen($normalized) <= COACH_TRANSCRIBE_MAX_TEXT ? $normalized : '';
}

function normalizeCoachAudioMime(string $value): string
{
    return strtolower(trim(explode(';', $value, 2)[0]));
}

function isCoachIsoBaseMediaFile(string $path): bool
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        return false;
    }
    try {
        $header = fread($handle, 16);
    } finally {
        fclose($handle);
    }
    return is_string($header) && strlen($header) >= 12 && substr($header, 4, 4) === 'ftyp';
}

function isCoachWebmFile(string $path): bool
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        return false;
    }
    try {
        $header = fread($handle, 4);
    } finally {
        fclose($handle);
    }
    return $header === "\x1A\x45\xDF\xA3";
}

function resolveCoachAudioMime(string $path, string $detectedMime, string $declaredMime): ?array
{
    $detected = normalizeCoachAudioMime($detectedMime);
    $declared = normalizeCoachAudioMime($declaredMime);
    if (isset(COACH_TRANSCRIBE_MIME_TYPES[$detected])
        && !in_array($detected, ['audio/mp4', 'video/mp4'], true)) {
        return ['mime' => $detected, 'extension' => COACH_TRANSCRIBE_MIME_TYPES[$detected]];
    }

    $declaredIsWebm = in_array($declared, COACH_TRANSCRIBE_WEBM_MIME_TYPES, true);
    $detectedIsWebm = in_array($detected, COACH_TRANSCRIBE_WEBM_MIME_TYPES, true);
    if (($declaredIsWebm || $detectedIsWebm) && isCoachWebmFile($path)) {
        return ['mime' => 'audio/webm', 'extension' => 'webm'];
    }

    $declaredIsMp4 = in_array($declared, COACH_TRANSCRIBE_MP4_MIME_TYPES, true);
    $detectedIsMp4 = in_array($detected, COACH_TRANSCRIBE_MP4_MIME_TYPES, true);
    if (($declaredIsMp4 || $detectedIsMp4) && isCoachIsoBaseMediaFile($path)) {
        return ['mime' => 'audio/mp4', 'extension' => 'm4a'];
    }
    return null;
}

function validateCoachAudioUpload(array $file, mixed $durationMs, ?callable $mimeDetector = null): array
{
    $duration = filter_var($durationMs, FILTER_VALIDATE_INT);
    if ($duration === false || $duration <= 0 || $duration > COACH_TRANSCRIBE_MAX_DURATION_MS) {
        throw new InvalidArgumentException('録音時間が正しくありません。');
    }
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new InvalidArgumentException('音声ファイルを受信できませんでした。');
    }
    $size = (int)($file['size'] ?? 0);
    $temporaryPath = (string)($file['tmp_name'] ?? '');
    if ($size <= 0 || $size > COACH_TRANSCRIBE_MAX_BYTES || $temporaryPath === '' || !is_file($temporaryPath)) {
        throw new InvalidArgumentException('音声ファイルのサイズが正しくありません。');
    }
    $detectedMime = $mimeDetector !== null
        ? (string)$mimeDetector($temporaryPath)
        : (string)(new finfo(FILEINFO_MIME_TYPE))->file($temporaryPath);
    $resolvedMime = resolveCoachAudioMime($temporaryPath, $detectedMime, (string)($file['type'] ?? ''));
    if ($resolvedMime === null) {
        throw new InvalidArgumentException('この音声形式には対応していません。');
    }
    return [
        'path' => $temporaryPath,
        'size' => $size,
        'mime' => $resolvedMime['mime'],
        'extension' => $resolvedMime['extension'],
        'duration_ms' => $duration,
    ];
}

function coachTranscribeValidationErrorCode(InvalidArgumentException $error): string
{
    return $error->getMessage() === 'この音声形式には対応していません。'
        ? 'unsupported_audio_format'
        : 'invalid_audio';
}

function requestCoachTranscription(array $audio, string $apiKey, ?callable $transport = null): ?string
{
    if ($apiKey === '') {
        return null;
    }
    if ($transport !== null) {
        $result = $transport($audio, $apiKey);
        return normalizeCoachTranscript($result['text'] ?? '');
    }
    $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
    if ($ch === false) {
        return null;
    }
    $upload = new CURLFile(
        $audio['path'],
        $audio['mime'],
        'mira-recording.' . $audio['extension']
    );
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_POSTFIELDS => [
            'file' => $upload,
            'model' => COACH_TRANSCRIBE_MODEL,
            'language' => 'ja',
            'response_format' => 'json',
        ],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if (!is_string($body) || $status < 200 || $status >= 300) {
        return null;
    }
    $decoded = json_decode($body, true);
    return normalizeCoachTranscript(is_array($decoded) ? ($decoded['text'] ?? '') : '');
}

function deleteCoachAudioUpload(string $temporaryPath): void
{
    if ($temporaryPath !== '' && is_file($temporaryPath)) {
        @unlink($temporaryPath);
    }
}

function runCoachTranscribeEndpoint(): never
{
    if (!coach_transcribe_enabled($_SERVER, PHP_SAPI, __DIR__)) {
        fail('見つかりません。', 404);
    }
    current_user_id();
    require_csrf($_POST);
    $temporaryPath = (string)($_FILES['audio']['tmp_name'] ?? '');
    $transcript = '';
    $failure = null;
    try {
        $audio = validateCoachAudioUpload($_FILES['audio'] ?? [], $_POST['durationMs'] ?? null);
        $apiKey = defined('OPENAI_API_KEY') ? trim((string)OPENAI_API_KEY) : '';
        $transcript = requestCoachTranscription($audio, $apiKey);
        if ($transcript === '') {
            $failure = ['音声を文字に変換できませんでした。', 502, 'transcription_failed'];
        }
    } catch (InvalidArgumentException $error) {
        $failure = [$error->getMessage(), 422, coachTranscribeValidationErrorCode($error)];
    } finally {
        deleteCoachAudioUpload($temporaryPath);
    }
    if ($failure !== null) {
        respond(['ok' => false, 'message' => $failure[0], 'error_code' => $failure[2]], $failure[1]);
    }
    respond(['ok' => true, 'transcript' => $transcript]);
}

if (!defined('COACH_TRANSCRIBE_SKIP_RUNTIME')) {
    runCoachTranscribeEndpoint();
}

<?php
declare(strict_types=1);

define('COACH_TRANSCRIBE_SKIP_BOOTSTRAP', true);
define('COACH_TRANSCRIBE_SKIP_RUNTIME', true);
require_once __DIR__ . '/../api/coach_transcribe.php';

function transcribeAssertSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

function transcribeAssertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function transcribeThrows(callable $callback, string $message): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }
    throw new RuntimeException($message);
}

$stage = '/home/keiichizup/www/action-map-90-staging/api';
$prod = '/home/keiichizup/www/action-map-90/api';
$server = ['HTTP_HOST' => 'keiichizup.sakura.ne.jp', 'REMOTE_ADDR' => '203.0.113.1'];
transcribeAssertSame(true, coach_transcribe_enabled($server + ['SCRIPT_NAME' => '/action-map-90-staging/api/coach_transcribe.php'], 'cgi-fcgi', $stage), 'Staging transcription endpoint must be enabled.');
transcribeAssertSame(false, coach_transcribe_enabled($server + ['SCRIPT_NAME' => '/action-map-90/api/coach_transcribe.php'], 'cgi-fcgi', $prod), 'Production transcription endpoint must be disabled.');
transcribeAssertSame(true, coach_transcribe_enabled(['HTTP_HOST' => 'localhost:8094', 'REMOTE_ADDR' => '::1', 'SCRIPT_NAME' => '/api/coach_transcribe.php'], 'cli-server', '/tmp/local/api'), 'Loopback transcription endpoint must be enabled.');

$temporaryPath = tempnam(sys_get_temp_dir(), 'am90-audio-');
$webmBytes = "\x1A\x45\xDF\xA3" . str_repeat('w', 1020);
file_put_contents($temporaryPath, $webmBytes);
$file = [
    'error' => UPLOAD_ERR_OK,
    'size' => strlen($webmBytes),
    'tmp_name' => $temporaryPath,
    'type' => 'audio/webm;codecs=opus',
];
$audio = validateCoachAudioUpload($file, '12000', static fn(): string => 'audio/webm');
transcribeAssertSame('audio/webm', $audio['mime'], 'Supported browser audio must be accepted.');
transcribeAssertSame(12000, $audio['duration_ms'], 'Duration must be validated as an integer.');
$iosWebmAudio = validateCoachAudioUpload($file, '4200', static fn(): string => 'video/webm');
transcribeAssertSame('audio/webm', $iosWebmAudio['mime'], 'Audio-only iPhone WebM detected as video/webm must be normalized safely.');
transcribeAssertSame('webm', $iosWebmAudio['extension'], 'Normalized iPhone WebM must retain the WebM extension.');
$octetStreamWebmAudio = validateCoachAudioUpload($file, '4200', static fn(): string => 'application/octet-stream');
transcribeAssertSame('audio/webm', $octetStreamWebmAudio['mime'], 'A declared WebM with a verified EBML signature may be accepted when finfo returns octet-stream.');
transcribeAssertSame(true, isCoachWebmFile($temporaryPath), 'WebM acceptance must require an EBML signature.');
transcribeThrows(fn() => validateCoachAudioUpload($file, '31000', static fn(): string => 'audio/webm'), 'Recording over 30 seconds must be rejected.');
transcribeThrows(fn() => validateCoachAudioUpload(['error' => UPLOAD_ERR_OK, 'size' => COACH_TRANSCRIBE_MAX_BYTES + 1, 'tmp_name' => $temporaryPath], '12000', static fn(): string => 'audio/webm'), 'Oversized audio must be rejected.');

$fakeWebmPath = tempnam(sys_get_temp_dir(), 'am90-fake-webm-');
$fakeWebmBytes = str_repeat('x', 1024);
file_put_contents($fakeWebmPath, $fakeWebmBytes);
$fakeWebmFile = [
    'error' => UPLOAD_ERR_OK,
    'size' => strlen($fakeWebmBytes),
    'tmp_name' => $fakeWebmPath,
    'type' => 'audio/webm',
];
transcribeThrows(
    fn() => validateCoachAudioUpload($fakeWebmFile, '4200', static fn(): string => 'video/webm'),
    'A declared WebM without an EBML signature must be rejected.'
);

$mp4Path = tempnam(sys_get_temp_dir(), 'am90-mp4-');
$mp4Bytes = pack('N', 24) . 'ftypM4A ' . str_repeat("\0", 12) . str_repeat('m', 512);
file_put_contents($mp4Path, $mp4Bytes);
$safariFile = [
    'error' => UPLOAD_ERR_OK,
    'size' => strlen($mp4Bytes),
    'tmp_name' => $mp4Path,
    'type' => 'audio/mp4;codecs=mp4a.40.2',
];
$safariAudio = validateCoachAudioUpload($safariFile, '4200', static fn(): string => 'audio/x-m4a');
transcribeAssertSame('audio/mp4', $safariAudio['mime'], 'Safari M4A must be normalized to browser-safe MP4 audio.');
transcribeAssertSame('m4a', $safariAudio['extension'], 'Safari MP4 audio must use the M4A upload extension.');
$finfoSafariAudio = validateCoachAudioUpload($safariFile, '4200');
transcribeAssertSame('audio/mp4', $finfoSafariAudio['mime'], 'The installed finfo MIME result for an M4A container must be normalized safely.');
$octetStreamAudio = validateCoachAudioUpload($safariFile, '4200', static fn(): string => 'application/octet-stream');
transcribeAssertSame('audio/mp4', $octetStreamAudio['mime'], 'A verified ISO-BMFF recording may be accepted when finfo returns octet-stream.');
transcribeAssertSame(true, isCoachIsoBaseMediaFile($mp4Path), 'Safari MP4 acceptance must require an ftyp signature.');
transcribeThrows(
    fn() => validateCoachAudioUpload(array_replace($fakeWebmFile, ['type' => 'audio/mp4']), '4200', static fn(): string => 'application/octet-stream'),
    'A declared MP4 without an ISO-BMFF signature must be rejected.'
);
transcribeAssertSame('unsupported_audio_format', coachTranscribeValidationErrorCode(new InvalidArgumentException('この音声形式には対応していません。')), 'Unsupported Safari formats need a safe error code.');
transcribeAssertSame('invalid_audio', coachTranscribeValidationErrorCode(new InvalidArgumentException('録音データが正しくありません。')), 'Other validation failures need a non-sensitive error code.');

$captured = [];
$transcript = requestCoachTranscription($audio, 'test-openai-key', static function (array $actualAudio, string $key) use (&$captured): array {
    $captured = ['audio' => $actualAudio, 'key' => $key];
    return ['text' => " 明日は\n最初のTaskを進めます。 "];
});
transcribeAssertSame('明日は 最初のTaskを進めます。', $transcript, 'A plain transcript must be normalized.');
transcribeAssertSame('test-openai-key', $captured['key'], 'The OpenAI key must stay in the server transport.');
transcribeAssertSame('', requestCoachTranscription($audio, 'test-key', static fn(): array => ['text' => '<script>']), 'Markup transcription must be rejected.');
transcribeAssertSame('', normalizeCoachTranscript(''), 'Empty transcription must be rejected.');
transcribeAssertSame('', normalizeCoachTranscript(str_repeat('長', 501)), 'Oversized transcription must be rejected.');

$deletionPath = tempnam(sys_get_temp_dir(), 'am90-delete-');
file_put_contents($deletionPath, 'temporary recording');
deleteCoachAudioUpload($deletionPath);
transcribeAssertSame(false, is_file($deletionPath), 'Uploaded temporary audio must be explicitly deleted.');
$source = file_get_contents(__DIR__ . '/../api/coach_transcribe.php');
transcribeAssertTrue(str_contains($source, 'deleteCoachAudioUpload($temporaryPath)'), 'Endpoint cleanup must run through the tested deletion helper.');
transcribeAssertTrue(!str_contains($source, 'log_usage_event') && !str_contains($source, 'error_log'), 'Raw audio and transcript must not be logged.');
unlink($temporaryPath);
unlink($mp4Path);
unlink($fakeWebmPath);

echo "PASS coach_transcribe_test\n";

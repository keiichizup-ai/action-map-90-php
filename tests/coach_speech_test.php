<?php
declare(strict_types=1);

define('COACH_SPEECH_SKIP_BOOTSTRAP', true);
define('COACH_SPEECH_SKIP_RUNTIME', true);
require_once __DIR__ . '/../api/coach_speech.php';

function speechAssertSame(mixed $expected, mixed $actual, string $message): void
{
    if ($expected !== $actual) {
        throw new RuntimeException($message . '\nExpected: ' . var_export($expected, true) . '\nActual: ' . var_export($actual, true));
    }
}

function speechAssertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$stage = '/home/keiichizup/www/action-map-90-staging/api';
$prod = '/home/keiichizup/www/action-map-90/api';
$server = ['HTTP_HOST' => 'keiichizup.sakura.ne.jp', 'REMOTE_ADDR' => '203.0.113.1'];
speechAssertSame(true, coach_speech_enabled($server + ['SCRIPT_NAME' => '/action-map-90-staging/api/coach_speech.php'], 'cgi-fcgi', $stage), 'Staging speech endpoint must be enabled.');
speechAssertSame(false, coach_speech_enabled($server + ['SCRIPT_NAME' => '/action-map-90/api/coach_speech.php'], 'cgi-fcgi', $prod), 'Production speech endpoint must be disabled.');
speechAssertSame(false, coach_speech_enabled($server + ['SCRIPT_NAME' => '/api/coach_speech.php', 'QUERY_STRING' => 'voice=1'], 'cgi-fcgi', $stage), 'A query parameter cannot enable speech.');
speechAssertSame(true, coach_speech_enabled(['HTTP_HOST' => '127.0.0.1:8094', 'REMOTE_ADDR' => '127.0.0.1', 'SCRIPT_NAME' => '/api/coach_speech.php'], 'cli-server', '/tmp/local/api'), 'Loopback speech endpoint must be enabled.');

speechAssertSame('', normalizeCoachSpeechText(''), 'Empty speech text must be rejected.');
speechAssertSame('', normalizeCoachSpeechText('<b>秘密</b>'), 'HTML must be rejected.');
speechAssertSame('', normalizeCoachSpeechText('[秘密](https://example.test)'), 'Markdown links must be rejected.');
speechAssertSame('', normalizeCoachSpeechText(str_repeat('長', 501)), 'Oversized speech text must be rejected.');
speechAssertSame('今日も 一歩ずつ', normalizeCoachSpeechText(" 今日も\n一歩ずつ "), 'Whitespace must be normalized.');

$request = buildCoachSpeechRequest('今日の一歩を進めましょう。', 'test-mira-voice-id');
speechAssertTrue(str_contains($request['url'], rawurlencode('test-mira-voice-id')), 'The selected Mira voice ID must be server-side in the ElevenLabs URL.');
speechAssertSame([
    'text' => '今日の一歩を進めましょう。',
    'model_id' => 'eleven_multilingual_v2',
], $request['payload'], 'Only final display text and the selected model may be sent to ElevenLabs.');

$capturedKey = '';
$audio = generateCoachSpeech('今日の一歩を進めましょう。', 'test-eleven-key', 'test-mira-voice-id', static function (array $actualRequest, string $key) use (&$capturedKey): array {
    $capturedKey = $key;
    return ['status' => 200, 'content_type' => 'audio/mpeg', 'body' => 'ID3' . str_repeat('a', 64)];
});
speechAssertTrue(is_string($audio) && str_starts_with($audio, 'ID3'), 'Valid ElevenLabs MP3 must be returned.');
speechAssertSame('test-eleven-key', $capturedKey, 'The API key must be supplied only to the server transport.');
speechAssertSame(null, generateCoachSpeech('回答', 'test-key', 'test-mira-voice-id', static fn(): array => ['status' => 401, 'content_type' => 'application/json', 'body' => '{}']), 'ElevenLabs API failure must be isolated.');
speechAssertSame(null, generateCoachSpeech('回答', 'test-key', 'test-mira-voice-id', static fn(): array => ['status' => 200, 'content_type' => 'audio/mpeg', 'body' => 'not-mp3']), 'Invalid audio must be rejected.');
speechAssertSame(null, generateCoachSpeech('回答', '', 'test-mira-voice-id', static fn(): array => []), 'Missing server API key must fail closed.');
speechAssertSame(null, generateCoachSpeech('回答', 'test-key', '', static fn(): array => []), 'Missing server voice ID must fail closed.');

$source = file_get_contents(__DIR__ . '/../api/coach_speech.php');
speechAssertTrue(!str_contains(strtolower($source), 'openai'), 'OpenAI TTS must not be used.');
speechAssertTrue(!str_contains($source, 'file_put_contents') && !str_contains($source, 'tempnam'), 'Generated speech must not be persisted.');

echo "PASS coach_speech_test\n";

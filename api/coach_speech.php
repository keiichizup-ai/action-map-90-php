<?php
declare(strict_types=1);

if (!defined('COACH_SPEECH_SKIP_BOOTSTRAP')) {
    require_once __DIR__ . '/bootstrap.php';
}

const COACH_SPEECH_MAX_TEXT = 500;
const COACH_SPEECH_MAX_AUDIO_BYTES = 5_000_000;
const COACH_SPEECH_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
const COACH_SPEECH_OUTPUT_FORMAT = 'mp3_44100_128';

function coach_speech_enabled(array $server, string $sapi, string $directory): bool
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
        && $script === '/api/coach_speech.php';
    $staging = ($server['HTTP_HOST'] ?? '') === 'keiichizup.sakura.ne.jp'
        && $script === '/action-map-90-staging/api/coach_speech.php'
        && $normalizedDirectory === '/home/keiichizup/www/action-map-90-staging/api';
    return $local || $staging;
}

function containsCoachSpeechMarkup(string $value): bool
{
    return preg_match('/<[^>]*>|```|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)/u', $value) === 1;
}

function normalizeCoachSpeechText(mixed $value): string
{
    if (!is_string($value) || containsCoachSpeechMarkup($value)
        || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value) === 1) {
        return '';
    }
    $normalized = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    return $normalized !== '' && mb_strlen($normalized) <= COACH_SPEECH_MAX_TEXT ? $normalized : '';
}

function coachSpeechApiKey(): string
{
    if (defined('ELEVENLABS_API_KEY')) {
        return trim((string)constant('ELEVENLABS_API_KEY'));
    }
    $environmentValue = getenv('ELEVENLABS_API_KEY');
    return is_string($environmentValue) ? trim($environmentValue) : '';
}

function coachSpeechVoiceId(): string
{
    if (defined('MIRA_ELEVENLABS_VOICE_ID')) {
        return trim((string)constant('MIRA_ELEVENLABS_VOICE_ID'));
    }
    $environmentValue = getenv('MIRA_ELEVENLABS_VOICE_ID');
    return is_string($environmentValue) ? trim($environmentValue) : '';
}

function buildCoachSpeechRequest(string $text, string $voiceId): array
{
    $text = normalizeCoachSpeechText($text);
    $voiceId = trim($voiceId);
    if ($text === '' || $voiceId === '' || preg_match('/^[A-Za-z0-9_-]{10,64}$/D', $voiceId) !== 1) {
        throw new InvalidArgumentException('読み上げる文章が正しくありません。');
    }
    return [
        'url' => 'https://api.elevenlabs.io/v1/text-to-speech/'
            . rawurlencode($voiceId)
            . '?output_format=' . rawurlencode(COACH_SPEECH_OUTPUT_FORMAT),
        'payload' => [
            'text' => $text,
            'model_id' => COACH_SPEECH_ELEVENLABS_MODEL_ID,
        ],
    ];
}

function isCoachSpeechMp3(string $audio): bool
{
    if (strlen($audio) < 3) {
        return false;
    }
    return substr($audio, 0, 3) === 'ID3'
        || (ord($audio[0]) === 0xff && (ord($audio[1]) & 0xe0) === 0xe0);
}

function requestCoachSpeech(array $request, string $apiKey, ?callable $transport = null): ?string
{
    if ($apiKey === '') {
        return null;
    }
    if ($transport !== null) {
        $result = $transport($request, $apiKey);
        $status = (int)($result['status'] ?? 0);
        $contentType = strtolower((string)($result['content_type'] ?? ''));
        $audio = is_string($result['body'] ?? null) ? $result['body'] : '';
    } else {
        $responseHeaders = [];
        $ch = curl_init((string)$request['url']);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'xi-api-key: ' . $apiKey,
                'Content-Type: application/json',
                'Accept: audio/mpeg',
            ],
            CURLOPT_POSTFIELDS => json_encode($request['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HEADERFUNCTION => static function ($handle, string $header) use (&$responseHeaders): int {
                $length = strlen($header);
                $parts = explode(':', $header, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return $length;
            },
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = strtolower((string)($responseHeaders['content-type'] ?? ''));
        $audio = is_string($body) ? $body : '';
    }

    if ($status < 200 || $status >= 300
        || !str_starts_with($contentType, 'audio/')
        || strlen($audio) > COACH_SPEECH_MAX_AUDIO_BYTES
        || !isCoachSpeechMp3($audio)) {
        return null;
    }
    return $audio;
}

function generateCoachSpeech(string $text, string $apiKey, string $voiceId, ?callable $transport = null): ?string
{
    try {
        return requestCoachSpeech(buildCoachSpeechRequest($text, $voiceId), $apiKey, $transport);
    } catch (Throwable) {
        return null;
    }
}

function runCoachSpeechEndpoint(): never
{
    if (!coach_speech_enabled($_SERVER, PHP_SAPI, __DIR__)) {
        fail('見つかりません。', 404);
    }
    $data = json_input();
    current_user_id();
    require_csrf($data);
    $text = normalizeCoachSpeechText($data['text'] ?? '');
    if ($text === '') {
        fail('読み上げる文章が正しくありません。', 422);
    }
    $audio = generateCoachSpeech($text, coachSpeechApiKey(), coachSpeechVoiceId());
    if ($audio === null) {
        fail('音声を生成できませんでした。', 502);
    }

    header_remove('Content-Type');
    header('Content-Type: audio/mpeg');
    header('Cache-Control: no-store, private');
    header('Content-Disposition: inline; filename="mira-coach.mp3"');
    header('Content-Length: ' . strlen($audio));
    echo $audio;
    exit;
}

if (!defined('COACH_SPEECH_SKIP_RUNTIME')) {
    runCoachSpeechEndpoint();
}

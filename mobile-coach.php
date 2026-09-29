<?php
declare(strict_types=1);

require_once __DIR__ . '/asset_version.php';

send_no_store_html_headers();
$manifestUrl = versioned_asset_url('manifest.webmanifest');
$appleTouchIconUrl = versioned_asset_url('assets/icons/icon-192.svg');
$mobileStyleUrl = versioned_asset_url('assets/mobile-coach.css');
$mobileScriptUrl = versioned_asset_url('assets/mobile-coach.js');
$serviceWorkerUrl = versioned_asset_url('service-worker.js');
// Pure environment guard. A Host header or query flag alone cannot enable staging.
function dummy_avatar_enabled(array $server, string $sapi, string $directory): bool
{
    $script = $server['SCRIPT_NAME'] ?? '';
    if (str_starts_with($script, '/action-map-90/')
        || str_contains(rtrim($directory, '/') . '/', '/action-map-90/')) {
        return false;
    }
    $host = parse_url('http://' . ($server['HTTP_HOST'] ?? ''), PHP_URL_HOST);
    $local = $sapi === 'cli-server'
        && in_array($server['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)
        && in_array($host, ['localhost', '127.0.0.1', '[::1]'], true);
    $staging = ($server['HTTP_HOST'] ?? '') === 'keiichizup.sakura.ne.jp'
        && $script === '/action-map-90-staging/mobile-coach.php'
        && $directory === '/home/keiichizup/www/action-map-90-staging';
    return $local || $staging;
}
$presentationMiraEnabled = dummy_avatar_enabled($_SERVER, PHP_SAPI, __DIR__);
?>
<!doctype html>
<html lang="ja" data-service-worker-url="<?= html_attribute($serviceWorkerUrl) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#18233f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="AM90 Coach">
  <title>ACTION MAP 90 AIコーチ</title>
  <link rel="manifest" href="<?= html_attribute($manifestUrl) ?>">
  <link rel="apple-touch-icon" href="<?= html_attribute($appleTouchIconUrl) ?>">
  <link rel="stylesheet" href="<?= html_attribute($mobileStyleUrl) ?>">
  <script defer src="<?= html_attribute($mobileScriptUrl) ?>"></script>
<?php if ($presentationMiraEnabled): ?>
  <link rel="stylesheet" href="<?= html_attribute(versioned_asset_url('assets/avatar/mira-presentation.css')) ?>">
  <script type="module" src="<?= html_attribute(versioned_asset_url('assets/avatar/mobile-avatar-bridge.js')) ?>"></script>
<?php endif; ?>
</head>
<body>
  <main class="mobile-app">
    <section id="mobileAuth" class="mobile-auth hidden">
      <div class="brand-block">
        <span class="brand-mark">90</span>
        <p class="eyebrow">ACTION MAP 90</p>
        <h1>AIコーチ</h1>
        <p>今日の一歩を、30秒で決める。</p>
      </div>
      <form id="mobileAuthForm" class="mobile-card auth-form">
        <label>メールアドレス<input id="mobileEmail" type="email" autocomplete="email" inputmode="email" required></label>
        <label>パスワード<input id="mobilePassword" type="password" autocomplete="current-password" minlength="8" required></label>
        <button class="mobile-primary" type="submit">ログイン</button>
        <p id="mobileAuthMessage" class="inline-message" role="alert"></p>
        <a class="text-link" href="./?view=desktop">新規登録・計画作成はPC版へ</a>
      </form>
    </section>

    <section id="mobileAppView" class="hidden">
      <header class="mobile-header">
        <button id="homeLogoBtn" class="home-brand" type="button" aria-label="ホームへ戻る">
          <span>90</span>
          <strong>ACTION MAP 90</strong>
        </button>
        <button id="mobileMenuBtn" class="icon-button" type="button" aria-label="メニュー">⋯</button>
      </header>

      <div id="mobileMenu" class="mobile-menu hidden">
        <button id="installAppBtn" type="button" class="menu-item hidden">ホーム画面に追加</button>
        <a class="menu-item" href="./?view=desktop">PC版を開く</a>
        <button id="mobileLogoutBtn" type="button" class="menu-item danger">ログアウト</button>
      </div>

<?php if ($presentationMiraEnabled): ?>
      <div id="mobileMiraPresentation" class="mira-presentation-host" hidden
           data-avatar-bridge-url="<?= html_attribute(versioned_asset_url('assets/avatar/avatar-bridge.js')) ?>"
           data-avatar-controller-url="<?= html_attribute(versioned_asset_url('assets/avatar/mira-presentation-controller.js')) ?>"></div>
<?php endif; ?>

      <section id="homeScreen" class="mobile-screen">
        <div class="home-hero">
          <p id="mobileToday" class="date-copy"></p>
          <h1 id="mobileGreeting">今日も一歩ずつ</h1>
          <p>90日後の理想の自分へ、今日できることから。</p>
        </div>

        <article class="ai-coach-card">
          <div class="coach-avatar">AI</div>
          <div class="coach-card-copy">
            <p class="eyebrow">TODAY'S COACH</p>
            <h2>今日の一歩</h2>
            <p id="homeCoachMessage">今日の予定を確認しています…</p>
          </div>
        </article>

        <section class="today-summary">
          <div>
            <strong id="homeTaskCount">0</strong>
            <span>今日の予定</span>
          </div>
          <div>
            <strong id="homeCompletedCount">0</strong>
            <span>完了</span>
          </div>
          <div>
            <strong id="homeProgressRate">0%</strong>
            <span>達成率</span>
          </div>
        </section>

        <div class="home-menu-grid">
          <button type="button" class="home-menu-card morning" data-mobile-screen="morning">
            <span class="home-menu-icon">☀️</span>
            <span class="home-menu-copy">
              <small>STEP 1</small>
              <strong>チェックイン</strong>
              <em id="homeMorningLabel">今日の予定を確認</em>
            </span>
            <span class="home-menu-arrow">›</span>
          </button>

          <button type="button" class="home-menu-card evening" data-mobile-screen="evening">
            <span class="home-menu-icon">🌙</span>
            <span class="home-menu-copy">
              <small>STEP 2</small>
              <strong>振り返り</strong>
              <em id="homeEveningLabel">今日の結果を記録</em>
            </span>
            <span class="home-menu-arrow">›</span>
          </button>

          <button type="button" class="home-menu-card history" data-mobile-screen="history">
            <span class="home-menu-icon">📖</span>
            <span class="home-menu-copy">
              <small>RECORD</small>
              <strong>日記・履歴</strong>
              <em>これまでの成長を見る</em>
            </span>
            <span class="home-menu-arrow">›</span>
          </button>
        </div>

        <a class="pc-link-card" href="./?view=desktop">
          <span>🖥️</span>
          <span><strong>計画全体を見る・編集する</strong><small>マンダラ、ロードマップ、タスク、参考資料はPC版へ</small></span>
          <b>›</b>
        </a>
      </section>

      <section id="morningScreen" class="mobile-screen hidden">
        <div class="subpage-header">
          <button type="button" class="back-home" data-mobile-screen="home">‹</button>
          <div><p class="eyebrow">STEP 1</p><h1>今日のチェックイン</h1></div>
        </div>
        <form id="mobileCheckinForm" class="mobile-card stacked-form">
          <fieldset>
            <legend>今の気分</legend>
            <div class="mood-row">
              <label><input type="radio" name="mobileCheckinMood" value="1"><span>😫</span></label>
              <label><input type="radio" name="mobileCheckinMood" value="2"><span>😞</span></label>
              <label><input type="radio" name="mobileCheckinMood" value="3" checked><span>😐</span></label>
              <label><input type="radio" name="mobileCheckinMood" value="4"><span>🙂</span></label>
              <label><input type="radio" name="mobileCheckinMood" value="5"><span>😊</span></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>今日の集中時間</legend>
            <div class="choice-pills">
              <label><input type="radio" name="mobileFocus" value="15"><span>15分</span></label>
              <label><input type="radio" name="mobileFocus" value="30" checked><span>30分</span></label>
              <label><input type="radio" name="mobileFocus" value="60"><span>60分</span></label>
              <label><input type="radio" name="mobileFocus" value="90"><span>90分</span></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>今日の予定タスク <small>実行するものを確認</small></legend>
            <div id="mobileCheckinTasks" class="tap-task-list"></div>
          </fieldset>

          <details class="optional-input">
            <summary>AIコーチに相談する（任意）</summary>
            <textarea id="mobileConcern" rows="3" placeholder="例：やる気が出ない、どれから始めるか迷う"></textarea>
          </details>

          <button id="checkinSubmitBtn" class="mobile-primary sticky-action" type="submit">今日を始める</button>
          <div id="mobileCheckinMessage" class="coach-response hidden" aria-live="polite"></div>
        </form>
      </section>

      <section id="eveningScreen" class="mobile-screen hidden">
        <div class="subpage-header">
          <button type="button" class="back-home" data-mobile-screen="home">‹</button>
          <div><p class="eyebrow">STEP 2</p><h1>今日の振り返り</h1></div>
        </div>
        <form id="mobileJournalForm" class="mobile-card stacked-form">
          <fieldset>
            <legend>朝に決めたタスク <small>できたものをチェック</small></legend>
            <div id="mobileJournalTasks" class="tap-task-list"></div>
          </fieldset>

          <fieldset>
            <legend>今日の気分</legend>
            <div class="mood-row">
              <label><input type="radio" name="mobileJournalMood" value="1"><span>😫</span></label>
              <label><input type="radio" name="mobileJournalMood" value="2"><span>😞</span></label>
              <label><input type="radio" name="mobileJournalMood" value="3" checked><span>😐</span></label>
              <label><input type="radio" name="mobileJournalMood" value="4"><span>🙂</span></label>
              <label><input type="radio" name="mobileJournalMood" value="5"><span>😊</span></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>進まなかった理由 <small>任意</small></legend>
            <div class="reason-grid">
              <label><input type="radio" name="mobileReason" value="none" checked><span>特になし</span></label>
              <label><input type="radio" name="mobileReason" value="time"><span>時間不足</span></label>
              <label><input type="radio" name="mobileReason" value="motivation"><span>やる気</span></label>
              <label><input type="radio" name="mobileReason" value="difficulty"><span>難しかった</span></label>
              <label><input type="radio" name="mobileReason" value="interrupt"><span>予定変更</span></label>
              <label><input type="radio" name="mobileReason" value="priority"><span>優先変更</span></label>
            </div>
          </fieldset>

          <details class="optional-input">
            <summary>今日のひとこと（任意）</summary>
            <textarea id="mobileJournalText" rows="3" placeholder="できたこと、困ったこと、気づきなど"></textarea>
          </details>

          <button id="journalSubmitBtn" class="mobile-primary sticky-action" type="submit">AIコーチに報告する</button>
          <div id="mobileJournalMessage" class="coach-response hidden" aria-live="polite"></div>
        </form>
      </section>

      <section id="historyScreen" class="mobile-screen hidden">
        <div class="subpage-header">
          <button type="button" class="back-home" data-mobile-screen="home">‹</button>
          <div><p class="eyebrow">RECORD</p><h1>日記・履歴</h1></div>
        </div>
        <div id="mobileHistory" class="history-list"></div>
      </section>

      <nav class="bottom-nav" aria-label="AIコーチ画面">
        <button type="button" data-mobile-screen="home"><span>⌂</span><small>ホーム</small></button>
        <button type="button" data-mobile-screen="morning"><span>☀️</span><small>チェックイン</small></button>
        <button type="button" data-mobile-screen="evening"><span>🌙</span><small>振り返り</small></button>
        <button type="button" data-mobile-screen="history"><span>📖</span><small>履歴</small></button>
      </nav>
    </section>
  </main>
</body>
</html>

<?php
declare(strict_types=1);
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ACTION MAP 90</title>
  <link rel="stylesheet" href="./assets/style.css">
  <script defer src="./assets/app.js"></script>
</head>
<body>
  <main class="app-shell">
    <section id="authView" class="auth-shell hidden">
      <div class="auth-intro">
        <p class="eyebrow">AI Strategy Mandala Chart</p>
        <h1>ACTION MAP 90</h1>
        <p>目標を、90日で動く戦略に変えるAIマンダラチャート。</p>
      </div>

      <form id="authForm" class="auth-card">
        <h2>ログイン</h2>
        <label>
          <span>メールアドレス</span>
          <input id="email" type="email" autocomplete="email" required>
        </label>
        <label>
          <span>パスワード</span>
          <input id="password" type="password" autocomplete="current-password" minlength="8" required>
        </label>
        <div class="auth-actions">
          <button class="btn btn-primary" type="submit" data-auth-action="login">ログイン</button>
          <button class="btn btn-secondary" type="submit" data-auth-action="register">新規登録</button>
        </div>
        <p id="authMessage" class="message"></p>
      </form>
    </section>

    <section id="appView" class="hidden">
      <header class="app-header">
        <div>
          <p class="eyebrow">AI Strategy Mandala Chart</p>
          <h1>ACTION MAP 90</h1>
          <p>中央に大目標、周囲に8つの中目標、外側に具体アクションを入力します。</p>
        </div>
        <div class="header-actions">
          <span id="saveStatus" class="save-status">読み込み中</span>
          <span id="userEmail" class="user-email"></span>
          <button id="logoutBtn" class="btn btn-secondary" type="button">ログアウト</button>
        </div>
      </header>

      <div class="toolbar">
        <button id="expandActionsBtn" class="btn btn-primary" type="button">アクション展開</button>
        <button id="generatePlanBtn" class="btn btn-accent" type="button">30/60/90日プラン生成</button>
        <button id="createTasksBtn" class="btn btn-primary" type="button">実行タスク化</button>
        <a id="exportIcsLink" class="btn btn-secondary" href="./api/tasks.php?action=ics">カレンダー用ICS</a>
        <button id="generateRecommendationsBtn" class="btn btn-secondary" type="button">参考動画・書籍</button>
        <button id="generateVisionBtn" class="btn btn-accent" type="button">90日ビジョン画像</button>
        <button id="clearDataBtn" class="btn btn-danger" type="button">クラウドデータ削除</button>
      </div>

      <div class="main-content">
        <div class="workspace-column">
          <div class="mandala-wrapper">
            <div id="mandalaChart" class="mandala-chart" aria-label="AI戦略マンダラチャート"></div>
          </div>

          <section class="execution-panel">
            <div class="section-header">
              <div>
                <p class="eyebrow">Execution</p>
                <h2>行動に落とす</h2>
              </div>
              <button id="clearTasksBtn" class="btn btn-danger" type="button">タスク削除</button>
            </div>
            <div id="taskDashboard" class="task-dashboard hidden" aria-live="polite"></div>
            <div id="taskList" class="task-list"></div>
          </section>

          <section class="execution-panel">
            <div class="section-header">
              <div>
                <p class="eyebrow">Resources</p>
                <h2>参考動画・書籍</h2>
              </div>
              <button id="clearRecommendationsBtn" class="btn btn-danger" type="button">参考リンク削除</button>
            </div>
            <div id="recommendationList" class="recommendation-list"></div>
          </section>

          <section class="execution-panel">
            <div class="section-header">
              <div>
                <p class="eyebrow">Vision Board</p>
                <h2>90日ビジョン画像</h2>
              </div>
              <button id="clearVisionBtn" class="btn btn-danger" type="button">画像削除</button>
            </div>
            <div id="visionList" class="vision-list"></div>
          </section>
        </div>

        <aside class="ai-panel">
          <div class="ai-panel-header">
            <div>
              <p class="eyebrow">AI Output</p>
              <h2>AI生成結果</h2>
            </div>
            <button id="clearAiBtn" class="icon-btn" type="button" aria-label="AI結果を閉じる">×</button>
          </div>
          <div id="loadingArea" class="loading-area hidden">
            <div class="loading-card">
              <div class="spinner"></div>
              <p class="loading-title">AIが作業中です</p>
              <button id="jazzToggle" class="jazz-toggle" type="button">BGM ON</button>
              <p id="loadingStep" class="loading-step">STEP 1 / 4</p>
              <p id="loadingText" class="loading-text">AIが考えています...</p>
              <div class="loading-tip">
                <span>今日のヒント:</span>
                <p id="loadingTip">タスクは「15分で着手できる形」まで小さくすると動き出せます。</p>
              </div>
            </div>
          </div>
          <div id="aiResult" class="ai-result">
            <p class="empty-message">ここにAIの提案が表示されます。</p>
          </div>
        </aside>
      </div>
    </section>
  </main>
</body>
</html>

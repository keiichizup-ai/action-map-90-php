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
          <a class="btn btn-accent" href="./mobile-coach.php">AI Coachと話す</a>
          <button id="logoutBtn" class="btn btn-secondary" type="button">ログアウト</button>
        </div>
      </header>

      <section class="view-switcher" aria-label="画面表示切り替え">
        <div class="view-switcher-header">
          <div>
            <p class="eyebrow">Workspace Tabs</p>
            <h2>表示する画面を選択</h2>
            <p>作成した内容を確認・編集する場所です。タブを切り替えてもデータは消えません。</p>
          </div>
          <span class="mode-badge mode-badge-tab">表示タブ</span>
        </div>
        <nav class="view-tabs" aria-label="表示切り替え">
          <button class="tab-btn active" type="button" data-tab-target="mandala" aria-controls="tabMandala" aria-selected="true" data-tab-index="1">
            <span>マンダラチャート</span>
            <small>9×9の目標マップ</small>
          </button>
          <button class="tab-btn" type="button" data-tab-target="execution" aria-controls="tabExecution" aria-selected="false" data-tab-index="2">
            <span>計画と実行</span>
            <small>進捗・ロードマップ・タスク</small>
          </button>
          <button class="tab-btn" type="button" data-tab-target="resources" aria-controls="tabResources" aria-selected="false" data-tab-index="3">
            <span>参考動画・書籍</span>
            <small>学習材料一覧</small>
          </button>
          <button class="tab-btn" type="button" data-tab-target="vision" aria-controls="tabVision" aria-selected="false" data-tab-index="4">
            <span>ビジョン画像</span>
            <small>90日後のイメージ</small>
          </button>
        </nav>
      </section>

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
          <section id="tabMandala" class="tab-panel active" data-tab-panel="mandala" aria-label="マンダラチャート">
            <div class="mandala-wrapper">
              <div id="mandalaChart" class="mandala-chart" aria-label="AI戦略マンダラチャート"></div>
            </div>
          </section>

          <section id="tabExecution" class="execution-panel tab-panel" data-tab-panel="execution" aria-label="計画と実行" hidden>
            <div class="section-header">
              <div>
                <p class="eyebrow">Execution</p>
                <h2>行動に落とす</h2>
              </div>
              <button id="clearTasksBtn" class="btn btn-danger" type="button">タスク削除</button>
            </div>
            <div id="taskDashboard" class="task-dashboard hidden" aria-live="polite"></div>

            <section id="ganttSection" class="roadmap-panel hidden" aria-label="90日ロードマップ">
              <div class="section-header roadmap-header">
                <div>
                  <p class="eyebrow">Roadmap</p>
                  <h3>90日ロードマップ</h3>
                </div>
              </div>
              <div class="roadmap-scroll">
                <div id="ganttChart" class="roadmap-chart"></div>
              </div>
            </section>

            <div class="task-list-header">
              <h3>タスク一覧</h3>
              <div class="task-export-actions">
                <a id="exportCsvLink" class="btn btn-secondary" href="./api/tasks.php?action=csv">CSVダウンロード</a>
                <a id="exportXlsLink" class="btn btn-secondary" href="./api/tasks.php?action=xls">Excel用xls</a>
              </div>
            </div>
            <div id="taskList" class="task-list"></div>
          </section>

          <section id="tabResources" class="execution-panel tab-panel" data-tab-panel="resources" aria-label="参考動画・書籍" hidden>
            <div class="section-header">
              <div>
                <p class="eyebrow">Resources</p>
                <h2>参考動画・書籍</h2>
              </div>
              <button id="clearRecommendationsBtn" class="btn btn-danger" type="button">参考リンク削除</button>
            </div>
            <div id="recommendationList" class="recommendation-list"></div>
          </section>

          <section id="tabVision" class="execution-panel tab-panel" data-tab-panel="vision" aria-label="ビジョン画像" hidden>
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

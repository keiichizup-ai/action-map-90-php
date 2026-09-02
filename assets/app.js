const state = {
  csrfToken: "",
  user: null,
  cells: Array(81).fill(""),
  aiResult: "",
  goalWhy: "",
  goalDeadline: "",
  tasks: [],
  selectedTaskIds: new Set(),
  recommendations: [],
  visionImages: [],
  saveTimer: null,
  loadingTimer: null,
  loadingStepIndex: 0,
  loadingMode: "",
  jazzEnabled: true,
  audioContext: null,
  jazzMasterGain: null,
  jazzTimer: null,
  jazzBar: 0,
  activeAuthAction: "login",
  activeTab: "mandala",
};

const LOADING_SCENARIOS = {
  expand: [
    { text: "中目標を読み込んでいます...", tip: "中目標は、行動に変換できるくらい具体的だと強くなります。" },
    { text: "行動に変わる言葉を磨いています...", tip: "タスクは「15分で着手できる形」まで小さくすると動き出せます。" },
    { text: "8つのブロックへ具体アクションを配置しています...", tip: "最初の一歩は、完璧さよりも摩擦の少なさが大事です。" },
    { text: "マンダラに反映する準備をしています...", tip: "行動が見える場所にあるだけで、実行率は上がります。" },
  ],
  plan: [
    { text: "マンダラ全体の流れを読んでいます...", tip: "90日計画は、遠い未来より次の7日を動かすためにあります。" },
    { text: "30日・60日・90日の節目を整理しています...", tip: "成果は、大きな決意より小さな反復から生まれます。" },
    { text: "優先順位とKPIを組み立てています...", tip: "測れる行動は改善できます。まず1つだけ数字にしましょう。" },
    { text: "実行しやすい計画に仕上げています...", tip: "予定に入っていないタスクは、願望のまま残りがちです。" },
  ],
  tasks: [
    { text: "プランから実行タスクを抜き出しています...", tip: "選ぶタスクは、少なすぎるくらいがちょうどいいです。" },
    { text: "期限と優先度を整えています...", tip: "期限は自分を縛るものではなく、未来の自分への案内板です。" },
    { text: "今日取り組める粒度に分解しています...", tip: "迷ったら「次の15分で何をするか」まで落としましょう。" },
    { text: "選択できるタスクリストにまとめています...", tip: "全部やるより、まず選んだ一手を終える方が前に進みます。" },
  ],
  recommendations: [
    { text: "選択タスクのキーワードを整理しています...", tip: "参考情報は、今やるタスクに関係するものだけで十分です。" },
    { text: "参考になりそうな動画を探しています...", tip: "動画は見終えることより、1つ試すことが大事です。" },
    { text: "関連する書籍情報を探しています...", tip: "本は全部読む前に、今の課題に効く章から使いましょう。" },
    { text: "行動に使える参考リンクへまとめています...", tip: "学びは、次の行動に変えた瞬間から資産になります。" },
  ],
  vision: [
    { text: "選択タスクから重要ポイントを抜き出しています...", tip: "毎日見る画像は、意志よりも環境で行動を助けます。" },
    { text: "AIビジョン画像の雰囲気を描いています...", tip: "理想の景色が見えると、今日の一手に意味が生まれます。" },
    { text: "AI画像の上に行動目標を重ねています...", tip: "壁に貼る言葉は、短く、具体的で、目に入るものが効きます。" },
    { text: "統合ビジョン画像を保存しています...", tip: "未来は大きな一撃より、選んだ一手の積み上げで近づきます。" },
  ],
};

const DEFAULT_LOADING_SCENARIO = [
  { text: "目標を読み込んでいます...", tip: "行動は、見える形にした瞬間から少し軽くなります。" },
  { text: "行動に変わる言葉を磨いています...", tip: "タスクは「15分で着手できる形」まで小さくすると動き出せます。" },
  { text: "結果を整えています...", tip: "完璧な計画より、今日1つ終える方が強いです。" },
  { text: "あと少しで完了です...", tip: "小さな前進も、記録すればちゃんと資産になります。" },
];

const MAIN_GOAL_INDEX = 40;
const CENTER_GOAL_INDEXES = [36, 37, 38, 39, 40, 41, 42, 43, 44];
const MIRROR_PAIRS = new Map([
  [36, 4],
  [37, 13],
  [38, 22],
  [39, 31],
  [41, 49],
  [42, 58],
  [43, 67],
  [44, 76],
]);
const MIRRORED_CENTER_INDEXES = Array.from(MIRROR_PAIRS.values());

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  buildMandala();
  bindEvents();
  await refreshStatus();
});

function bindElements() {
  [
    "authView",
    "appView",
    "authForm",
    "email",
    "password",
    "authMessage",
    "mandalaChart",
    "goalWhy",
    "goalDeadline",
    "saveStatus",
    "userEmail",
    "logoutBtn",
    "expandActionsBtn",
    "generatePlanBtn",
    "createTasksBtn",
    "exportIcsLink",
    "exportCsvLink",
    "exportXlsLink",
    "ganttSection",
    "ganttChart",
    "generateRecommendationsBtn",
    "generateVisionBtn",
    "clearDataBtn",
    "clearTasksBtn",
    "clearRecommendationsBtn",
    "clearVisionBtn",
    "clearAiBtn",
    "loadingArea",
    "jazzToggle",
    "loadingStep",
    "loadingText",
    "loadingTip",
    "aiResult",
    "taskDashboard",
    "taskList",
    "recommendationList",
    "visionList",
    "tabMandala",
    "tabExecution",
    "tabResources",
    "tabVision",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.authForm.addEventListener("submit", handleAuthSubmit);

  elements.authForm.querySelectorAll("[data-auth-action]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeAuthAction = button.dataset.authAction;
    });
  });

  elements.logoutBtn.addEventListener("click", handleLogout);
  elements.goalWhy.addEventListener("input", handleGoalMetadataInput);
  elements.goalDeadline.addEventListener("input", handleGoalMetadataInput);
  elements.expandActionsBtn.addEventListener("click", () => handleAi("expand"));
  elements.generatePlanBtn.addEventListener("click", () => handleAi("plan"));
  elements.createTasksBtn.addEventListener("click", handleCreateTasks);
  elements.exportIcsLink.addEventListener("click", (event) => {
    const tasks = selectedTasksForExport();
    if (!tasks.length) {
      event.preventDefault();
      alert("カレンダーに入れたいタスクを選択してください。");
      return;
    }

    if (tasks.some((task) => !task.startDate || !task.dueDate)) {
      event.preventDefault();
      alert("ICSを作成するには、選択したタスクすべてに開始日と終了日を設定してください。");
    }
  });

  [elements.exportCsvLink, elements.exportXlsLink].forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!state.tasks.length) {
        event.preventDefault();
        alert("ダウンロードするタスクがありません。先に実行タスク化を行ってください。");
      }
    });
  });

  elements.generateRecommendationsBtn.addEventListener("click", handleGenerateRecommendations);
  elements.generateVisionBtn.addEventListener("click", handleGenerateVision);
  elements.clearTasksBtn.addEventListener("click", handleClearTasks);
  elements.clearRecommendationsBtn.addEventListener("click", handleClearRecommendations);
  elements.clearVisionBtn.addEventListener("click", handleClearVision);
  elements.clearDataBtn.addEventListener("click", handleDeleteCloudData);
  elements.clearAiBtn.addEventListener("click", () => {
    state.aiResult = "";
    renderAiResult("");
    scheduleSave();
  });
  elements.jazzToggle.addEventListener("click", toggleJazz);

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tabTarget || "mandala"));
  });
}

function switchTab(tabName) {
  const validTabs = ["mandala", "execution", "resources", "vision"];
  const nextTab = validTabs.includes(tabName) ? tabName : "mandala";
  state.activeTab = nextTab;

  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    const isActive = panel.dataset.tabPanel === nextTab;
    panel.hidden = !isActive;
    panel.classList.toggle("active", isActive);
  });

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const isActive = button.dataset.tabTarget === nextTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

async function refreshStatus() {
  const result = await postJson("./api/auth.php", { action: "status" }, false);
  state.csrfToken = result.csrfToken;
  state.user = result.user;

  if (state.user) {
    showApp();
    await loadChart();
    await loadExecutionAssets();
  } else {
    showAuth();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthMessage("");

  try {
    const result = await postJson("./api/auth.php", {
      action: state.activeAuthAction,
      csrfToken: state.csrfToken,
      email: elements.email.value,
      password: elements.password.value,
    });

    state.csrfToken = result.csrfToken || state.csrfToken;
    state.user = result.user;
    showApp();
    await loadChart();
    await loadExecutionAssets();
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function handleLogout() {
  await postJson("./api/auth.php", {
    action: "logout",
    csrfToken: state.csrfToken,
  });

  location.reload();
}

async function loadChart() {
  setSaveStatus("読み込み中");

  try {
    const result = await postJson("./api/chart.php", { action: "load" }, false);
    state.cells = normalizeCells(result.chart.cells);
    state.aiResult = result.chart.aiResult || "";
    state.goalWhy = result.chart.goalWhy || "";
    state.goalDeadline = result.chart.goalDeadline || "";
    elements.goalWhy.value = state.goalWhy;
    elements.goalDeadline.value = state.goalDeadline;
    renderCells();
    renderAiResult(state.aiResult);
    setSaveStatus("クラウド保存済み");
  } catch (error) {
    setSaveStatus("読込エラー");
    renderAiResult(`**エラー**\n${error.message}`);
  }
}

async function loadExecutionAssets() {
  await Promise.all([
    loadTasks(),
    loadRecommendations(),
    loadVisionImages(),
  ]);
}

function buildMandala() {
  for (let block = 0; block < 9; block += 1) {
    const blockEl = document.createElement("section");
    blockEl.className = `big-block ${block === 4 ? "center-block" : ""}`;
    blockEl.dataset.label = block === 4 ? "大目標・中目標" : `アクション${block + 1}`;

    for (let inner = 0; inner < 9; inner += 1) {
      const index = block * 9 + inner;
      const textarea = document.createElement("textarea");
      textarea.className = cellClass(index);
      textarea.dataset.index = String(index);
      textarea.rows = 3;
      textarea.placeholder = placeholderFor(index);
      textarea.readOnly = MIRRORED_CENTER_INDEXES.includes(index);
      textarea.addEventListener("input", handleCellInput);
      blockEl.appendChild(textarea);
    }

    elements.mandalaChart.appendChild(blockEl);
  }
}

function handleCellInput(event) {
  const index = Number(event.target.dataset.index);
  state.cells[index] = event.target.value;

  if (MIRROR_PAIRS.has(index)) {
    state.cells[MIRROR_PAIRS.get(index)] = event.target.value;
    renderCells();
  }

  scheduleSave();
}

function handleGoalMetadataInput() {
  state.goalWhy = elements.goalWhy.value;
  state.goalDeadline = elements.goalDeadline.value;
  scheduleSave();
}

function renderCells() {
  document.querySelectorAll(".cell").forEach((cell) => {
    const index = Number(cell.dataset.index);
    if (cell.value !== state.cells[index]) {
      cell.value = state.cells[index] || "";
    }
  });
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  setSaveStatus("保存準備中");
  state.saveTimer = setTimeout(saveChart, 700);
}

async function saveChart() {
  setSaveStatus("保存中");

  try {
    await postJson("./api/chart.php", {
      action: "save",
      csrfToken: state.csrfToken,
      cells: state.cells,
      aiResult: state.aiResult,
      goalWhy: state.goalWhy,
      goalDeadline: state.goalDeadline,
    });
    setSaveStatus("クラウド保存済み");
  } catch (error) {
    setSaveStatus("保存エラー");
    console.error(error);
  }
}

async function handleAi(mode) {
  setLoading(true, mode);

  try {
    const result = await postJson("./api/ai.php", {
      csrfToken: state.csrfToken,
      mode,
      cells: state.cells,
    });

    state.aiResult = result.result;
    if (Array.isArray(result.cells)) {
      state.cells = normalizeCells(result.cells);
      syncMiddleGoals();
      renderCells();
    }
    renderAiResult(state.aiResult);
    if (mode === "expand") {
      switchTab("mandala");
    }
    await saveChart();
  } catch (error) {
    renderAiResult(`**AI生成エラー**\n${error.message}`);
  } finally {
    setLoading(false, mode);
  }
}

async function loadTasks() {
  try {
    const result = await postJson("./api/tasks.php", { action: "load" }, false);
    state.tasks = result.tasks || [];
    syncSelectedTaskIds();
    renderTasks();
  } catch (error) {
    elements.taskList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  }
}

async function handleCreateTasks() {
  setLoading(true, "tasks");

  try {
    const result = await postJson("./api/tasks.php", {
      action: "decompose",
      csrfToken: state.csrfToken,
      cells: state.cells,
      aiResult: state.aiResult,
    });
    state.tasks = result.tasks || [];
    state.selectedTaskIds = new Set();
    renderTasks();
    switchTab("execution");
  } catch (error) {
    elements.taskList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  } finally {
    setLoading(false, "tasks");
  }
}

async function handleTaskStatus(taskId, status) {
  const result = await postJson("./api/tasks.php", {
    action: "update",
    csrfToken: state.csrfToken,
    taskId,
    status,
  });
  state.tasks = result.tasks || [];
  syncSelectedTaskIds();
  renderTasks();
}

async function handleTaskDate(taskId, startDate, dueDate) {
  const result = await postJson("./api/tasks.php", {
    action: "update_date",
    csrfToken: state.csrfToken,
    taskId,
    startDate,
    dueDate,
  });
  state.tasks = result.tasks || [];
  syncSelectedTaskIds();
  renderTasks();
}

async function handleTaskDetails(taskId, updates) {
  const result = await postJson("./api/tasks.php", {
    action: "update_details",
    csrfToken: state.csrfToken,
    taskId,
    ...updates,
  });
  state.tasks = result.tasks || [];
  syncSelectedTaskIds();
  renderTasks();
}

async function handleClearTasks() {
  if (!confirm("生成済みタスクを削除します。よろしいですか？")) {
    return;
  }

  const result = await postJson("./api/tasks.php", {
    action: "clear",
    csrfToken: state.csrfToken,
  });
  state.tasks = result.tasks || [];
  state.selectedTaskIds = new Set();
  renderTasks();
}

async function loadRecommendations() {
  try {
    const result = await postJson("./api/recommendations.php", { action: "load" }, false);
    state.recommendations = result.recommendations || [];
    renderRecommendations();
  } catch (error) {
    elements.recommendationList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  }
}

async function handleGenerateRecommendations() {
  setLoading(true, "recommendations");

  try {
    const result = await postJson("./api/recommendations.php", {
      action: "generate",
      csrfToken: state.csrfToken,
      taskIds: selectedTaskIds(),
    });
    state.recommendations = result.recommendations || [];
    renderRecommendations();
    switchTab("resources");
  } catch (error) {
    elements.recommendationList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  } finally {
    setLoading(false, "recommendations");
  }
}

async function handleClearRecommendations() {
  if (!confirm("参考動画・書籍の一覧だけを削除します。よろしいですか？")) {
    return;
  }

  const result = await postJson("./api/recommendations.php", {
    action: "clear",
    csrfToken: state.csrfToken,
  });
  state.recommendations = result.recommendations || [];
  renderRecommendations();
}

async function loadVisionImages() {
  try {
    const result = await postJson("./api/vision.php", { action: "load" }, false);
    state.visionImages = result.images || [];
    renderVisionImages();
  } catch (error) {
    elements.visionList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  }
}

async function handleGenerateVision() {
  setLoading(true, "vision");

  try {
    const result = await postJson("./api/vision.php", {
      action: "generate",
      csrfToken: state.csrfToken,
      cells: state.cells,
      aiResult: state.aiResult,
      taskIds: selectedTaskIds(),
    });
    state.visionImages = result.images || [];
    renderVisionImages();
    switchTab("vision");
  } catch (error) {
    elements.visionList.innerHTML = `<p class="empty-message">${escapeHtml(error.message)}</p>`;
  } finally {
    setLoading(false, "vision");
  }
}

async function handleClearVision() {
  if (!confirm("90日ビジョン画像だけを削除します。よろしいですか？")) {
    return;
  }

  const result = await postJson("./api/vision.php", {
    action: "clear",
    csrfToken: state.csrfToken,
  });
  state.visionImages = result.images || [];
  renderVisionImages();
}

async function handleDeleteCloudData() {
  if (!confirm("クラウド上の作成データ（マンダラ、プラン、タスク、参考動画・書籍、ビジョン画像）を削除します。よろしいですか？")) {
    return;
  }

  await postJson("./api/chart.php", {
    action: "delete",
    csrfToken: state.csrfToken,
  });

  state.cells = Array(81).fill("");
  state.aiResult = "";
  state.goalWhy = "";
  state.goalDeadline = "";
  state.tasks = [];
  state.selectedTaskIds = new Set();
  state.recommendations = [];
  state.visionImages = [];
  renderCells();
  elements.goalWhy.value = "";
  elements.goalDeadline.value = "";
  renderAiResult("");
  renderTasks();
  renderRecommendations();
  renderVisionImages();
  setSaveStatus("削除済み");
}

async function postJson(url, payload, withError = true) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      message: text
        ? `サーバーからJSON以外の応答が返りました。${text.slice(0, 180)}`
        : "通信に失敗しました。",
    };
  });
  if (!response.ok || result.ok === false) {
    const message = result.message || "通信に失敗しました。";
    if (withError) {
      throw new Error(message);
    }
    throw new Error(message);
  }

  return result;
}

function showAuth() {
  elements.authView.classList.remove("hidden");
  elements.appView.classList.add("hidden");
}

function showApp() {
  elements.authView.classList.add("hidden");
  elements.appView.classList.remove("hidden");
  elements.userEmail.textContent = state.user?.email || "";
}

function setAuthMessage(message) {
  elements.authMessage.textContent = message;
  elements.authMessage.classList.toggle("visible", Boolean(message));
}

function setSaveStatus(text) {
  elements.saveStatus.textContent = text;
}

function setLoading(isLoading, mode) {
  elements.loadingArea.classList.toggle("hidden", !isLoading);
  elements.expandActionsBtn.disabled = isLoading;
  elements.generatePlanBtn.disabled = isLoading;
  elements.createTasksBtn.disabled = isLoading;
  elements.generateRecommendationsBtn.disabled = isLoading;
  elements.generateVisionBtn.disabled = isLoading;
  elements.clearDataBtn.disabled = isLoading;
  if (isLoading) {
    startLoadingCoach(mode);
    startJazzLoop();
  } else {
    stopLoadingCoach();
    stopJazzLoop();
  }
}

function startLoadingCoach(mode) {
  stopLoadingCoach();
  state.loadingMode = mode;
  state.loadingStepIndex = 0;
  renderLoadingCoach();
  state.loadingTimer = setInterval(() => {
    const scenario = currentLoadingScenario();
    state.loadingStepIndex = Math.min(state.loadingStepIndex + 1, scenario.length - 1);
    renderLoadingCoach();
  }, 4500);
}

function stopLoadingCoach() {
  if (state.loadingTimer) {
    clearInterval(state.loadingTimer);
    state.loadingTimer = null;
  }
}

function currentLoadingScenario() {
  return LOADING_SCENARIOS[state.loadingMode] || DEFAULT_LOADING_SCENARIO;
}

function renderLoadingCoach() {
  const scenario = currentLoadingScenario();
  const stepIndex = Math.min(state.loadingStepIndex, scenario.length - 1);
  const step = scenario[stepIndex];
  elements.loadingStep.textContent = `STEP ${stepIndex + 1} / ${scenario.length}`;
  elements.loadingText.textContent = step.text;
  elements.loadingTip.textContent = step.tip;
}

function toggleJazz() {
  state.jazzEnabled = !state.jazzEnabled;
  updateJazzToggle();

  if (!state.jazzEnabled) {
    stopJazzLoop();
    return;
  }

  if (!elements.loadingArea.classList.contains("hidden")) {
    startJazzLoop();
  }
}

function updateJazzToggle() {
  elements.jazzToggle.textContent = state.jazzEnabled ? "BGM ON" : "BGM OFF";
  elements.jazzToggle.classList.toggle("muted", !state.jazzEnabled);
}

function startJazzLoop() {
  updateJazzToggle();
  if (!state.jazzEnabled || state.jazzTimer) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    state.jazzEnabled = false;
    updateJazzToggle();
    return;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }

  state.jazzMasterGain = state.audioContext.createGain();
  state.jazzMasterGain.gain.value = 0.18;
  state.jazzMasterGain.connect(state.audioContext.destination);
  state.jazzBar = 0;
  scheduleJazzBar();
  state.jazzTimer = setInterval(scheduleJazzBar, 2100);
}

function stopJazzLoop() {
  if (state.jazzTimer) {
    clearInterval(state.jazzTimer);
    state.jazzTimer = null;
  }

  if (state.jazzMasterGain) {
    const now = state.audioContext.currentTime;
    state.jazzMasterGain.gain.cancelScheduledValues(now);
    state.jazzMasterGain.gain.setValueAtTime(state.jazzMasterGain.gain.value, now);
    state.jazzMasterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    setTimeout(() => {
      if (state.jazzMasterGain) {
        state.jazzMasterGain.disconnect();
        state.jazzMasterGain = null;
      }
    }, 300);
  }
}

function scheduleJazzBar() {
  if (!state.audioContext || !state.jazzMasterGain) {
    return;
  }

  const now = state.audioContext.currentTime + 0.05;
  const progression = [
    { chord: [146.83, 220.0, 261.63, 329.63, 440.0], bass: [146.83, 174.61, 196.0, 220.0] },
    { chord: [196.0, 246.94, 293.66, 349.23, 440.0], bass: [196.0, 220.0, 246.94, 293.66] },
    { chord: [130.81, 196.0, 246.94, 293.66, 392.0], bass: [130.81, 164.81, 196.0, 246.94] },
    { chord: [164.81, 207.65, 261.63, 311.13, 392.0], bass: [164.81, 196.0, 220.0, 246.94] },
  ];
  const bar = progression[state.jazzBar % progression.length];

  playChord(bar.chord, now, 1.65);
  playChord(bar.chord.map((freq) => freq * 1.005), now + 1.05, 0.55);
  bar.bass.forEach((freq, index) => playBass(freq, now + index * 0.5));
  [0, 0.5, 1.0, 1.5].forEach((offset) => playBrush(now + offset));
  state.jazzBar += 1;
}

function playChord(frequencies, startTime, duration) {
  frequencies.forEach((frequency, index) => {
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.035 / (index + 1), startTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(state.jazzMasterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
  });
}

function playBass(frequency, startTime) {
  const oscillator = state.audioContext.createOscillator();
  const gain = state.audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.055, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.42);
  oscillator.connect(gain);
  gain.connect(state.jazzMasterGain);
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.48);
}

function playBrush(startTime) {
  const bufferSize = Math.floor(state.audioContext.sampleRate * 0.08);
  const buffer = state.audioContext.createBuffer(1, bufferSize, state.audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = state.audioContext.createBufferSource();
  const filter = state.audioContext.createBiquadFilter();
  const gain = state.audioContext.createGain();
  noise.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = 4200;
  gain.gain.setValueAtTime(0.018, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.08);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(state.jazzMasterGain);
  noise.start(startTime);
  noise.stop(startTime + 0.09);
}

function renderTasks() {
  if (!state.tasks.length) {
    renderTaskDashboard();
    elements.taskList.innerHTML = `<p class="empty-message">30/60/90日プラン生成後、「実行タスク化」を押すと、ここに今日やることが並びます。</p>`;
    renderGanttChart();
    updateIcsLink();
    return;
  }

  renderTaskDashboard();
  elements.taskList.innerHTML = state.tasks.map((task) => {
    const taskId = Number(task.id);
    const isSelected = state.selectedTaskIds.has(taskId);
    const isDone = task.status === "done";
    const statusOptions = ["todo", "doing", "done"].map((status) => {
      const label = { todo: "未着手", doing: "進行中", done: "完了" }[status];
      return `<option value="${status}" ${task.status === status ? "selected" : ""}>${label}</option>`;
    }).join("");

    return `
      <article class="task-card priority-${escapeHtml(task.priority)} ${isSelected ? "selected-task" : ""} ${isDone ? "task-done" : ""}">
        <label class="task-select">
          <input type="checkbox" data-task-select="${task.id}" ${isSelected ? "checked" : ""}>
          <span>選択</span>
        </label>
        <div>
          <div class="task-meta">
            <span>${escapeHtml(task.sourcePhase || "計画")}</span>
            <span>${escapeHtml(taskDateRangeLabel(task))}</span>
            <span>${escapeHtml(String(task.estimatedMinutes || 60))}分</span>
          </div>
          <label class="task-title-edit">
            <span>タスク名</span>
            <input type="text" data-task-title="${task.id}" value="${escapeAttribute(task.title || "")}" maxlength="255">
          </label>
          <p>${escapeHtml(task.description || "")}</p>
        </div>
        <div class="task-controls">
          <label class="task-date">
            <span>いつから</span>
            <input type="date" data-task-start-date="${task.id}" value="${escapeAttribute(task.startDate || "")}">
          </label>
          <label class="task-date">
            <span>いつまで</span>
            <input type="date" data-task-end-date="${task.id}" value="${escapeAttribute(task.dueDate || "")}">
          </label>
          <select data-task-status="${task.id}" aria-label="タスク状態">
            ${statusOptions}
          </select>
        </div>
      </article>
    `;
  }).join("");

  elements.taskList.querySelectorAll("[data-task-title]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("change", () => {
      const taskId = Number(input.dataset.taskTitle);
      const currentTask = state.tasks.find((task) => Number(task.id) === taskId);
      const title = input.value.trim();
      if (!title) {
        input.value = currentTask?.title || "";
        alert("タスク名を入力してください。");
        return;
      }
      handleTaskDetails(taskId, {
        title,
        startDate: currentTask?.startDate || "",
        dueDate: currentTask?.dueDate || "",
        status: currentTask?.status || "todo",
      });
    });
  });

  elements.taskList.querySelectorAll("[data-task-start-date], [data-task-end-date]").forEach((input) => {
    input.addEventListener("change", () => {
      const taskId = Number(input.dataset.taskStartDate || input.dataset.taskEndDate);
      const card = input.closest(".task-card");
      const startInput = card.querySelector("[data-task-start-date]");
      const endInput = card.querySelector("[data-task-end-date]");
      const statusInput = card.querySelector("[data-task-status]");
      const titleInput = card.querySelector("[data-task-title]");
      if (startInput.value && endInput.value && endInput.value < startInput.value) {
        endInput.value = startInput.value;
      }
      handleTaskDetails(taskId, {
        title: titleInput.value,
        startDate: startInput.value,
        dueDate: endInput.value,
        status: statusInput.value,
      });
    });
  });

  elements.taskList.querySelectorAll("[data-task-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const taskId = Number(select.dataset.taskStatus);
      const card = select.closest(".task-card");
      handleTaskDetails(taskId, {
        title: card.querySelector("[data-task-title]").value,
        startDate: card.querySelector("[data-task-start-date]").value,
        dueDate: card.querySelector("[data-task-end-date]").value,
        status: select.value,
      });
    });
  });

  elements.taskList.querySelectorAll("[data-task-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const taskId = Number(checkbox.dataset.taskSelect);
      if (checkbox.checked) {
        state.selectedTaskIds.add(taskId);
      } else {
        state.selectedTaskIds.delete(taskId);
      }
      renderTasks();
    });
  });

  renderGanttChart();
  updateIcsLink();
}

function renderGanttChart() {
  if (!elements.ganttSection || !elements.ganttChart) {
    return;
  }

  const rows = buildRoadmapGanttRows(state.aiResult, state.tasks);
  updateTaskDownloadLinks();

  if (!rows.length) {
    elements.ganttSection.classList.add("hidden");
    elements.ganttChart.innerHTML = "";
    return;
  }

  elements.ganttSection.classList.remove("hidden");

  const weekHeaders = Array.from({ length: 12 }, (_, index) => {
    const week = index + 1;
    return `<span class="roadmap-week-label">W${week}</span>`;
  }).join("");

  const rowsHtml = rows.map((row) => {
    const startWeek = clamp(Number(row.startWeek) || 1, 1, 12);
    const endWeek = clamp(Number(row.endWeek) || startWeek, startWeek, 12);
    const duration = endWeek - startWeek + 1;
    const weekCells = Array.from({ length: 12 }, () => `<span class="roadmap-grid-cell"></span>`).join("");
    const durationLabel = duration > 1 ? `W${startWeek}〜W${endWeek}` : `W${startWeek}`;
    const title = row.label || roadmapFallback(startWeek);
    const summary = row.summary && normalizeRoadmapKey(row.summary) !== normalizeRoadmapKey(title)
      ? `<span class="roadmap-row-summary">${escapeHtml(row.summary)}</span>`
      : "";
    const barText = duration > 1 ? `${durationLabel} ${title}` : durationLabel;

    return `
      <div class="roadmap-gantt-row">
        <div class="roadmap-row-info">
          <div class="roadmap-row-meta">
            <span class="roadmap-row-week">${escapeHtml(durationLabel)}</span>
            <span class="roadmap-row-phase phase-${row.phase}">${escapeHtml(row.phaseLabel)}</span>
          </div>
          <strong>${escapeHtml(title)}</strong>
          ${summary}
        </div>
        <div class="roadmap-track" aria-label="${escapeAttribute(title)} ${durationLabel}">
          ${weekCells}
          <span class="roadmap-bar phase-${row.phase}" style="grid-column: ${startWeek} / ${endWeek + 1};" title="${escapeAttribute(`${durationLabel} ${title}`)}">
            <span>${escapeHtml(barText)}</span>
          </span>
        </div>
      </div>
    `;
  }).join("");

  elements.ganttChart.innerHTML = `
    <div class="roadmap-gantt-board roadmap-gantt-board-compact" aria-label="90日ロードマップガント">
      <div class="roadmap-summary-strip">
        <span class="phase-block phase-early">Day 1-30 / 立ち上げ</span>
        <span class="phase-block phase-middle">Day 31-60 / 実行・検証</span>
        <span class="phase-block phase-late">Day 61-90 / 仕上げ</span>
      </div>

      <div class="roadmap-gantt-table">
        <div class="roadmap-gantt-header">
          <div class="roadmap-left-header">週ごとのやること</div>
          <div class="roadmap-week-header">${weekHeaders}</div>
        </div>
        <div class="roadmap-gantt-body">
          ${rowsHtml}
        </div>
      </div>
    </div>
  `;
}

function buildRoadmapGanttRows(markdown, tasks = []) {
  // 90日ロードマップは、実行タスクか30/60/90日プランがある時だけ表示します。
  // クラウドデータ削除後に空の状態でもデフォルト行を出すと「消えていない」ように見えるため、
  // 何も材料がない場合は必ず非表示にします。
  const taskRows = buildWeeklyRoadmapRowsFromTasks(tasks);
  if (taskRows.length) {
    return taskRows;
  }

  const hasPlanText = String(markdown || "").trim() !== "";
  if (!hasPlanText) {
    return [];
  }

  const explicitWeeks = extractExplicitWeekItems(markdown);
  const explicitRows = explicitWeeks
    .filter((week) => week.items.length > 0)
    .map((week) => {
      const item = pickRoadmapAction(week.items, week.week);
      return {
        label: makeRoadmapTitle(item, week.week),
        summary: summarizeRoadmapItems(week.items),
        startWeek: week.week,
        endWeek: week.week,
        phase: roadmapPhaseByWeek(week.week),
        phaseLabel: roadmapPhaseLabelByWeek(week.week),
      };
    })
    .filter((row) => isUsefulRoadmapAction(row.label));

  if (explicitRows.length >= 4) {
    return fillMissingWeeklyRows(explicitRows).slice(0, 12);
  }

  return explicitRows.slice(0, 12);
}

function phaseItemsToRows(items, phase, phaseLabel, startWeek, endWeek) {
  const normalized = normalizeRoadmapItems(items).slice(0, 4);
  if (!normalized.length) {
    return [];
  }

  const spanLength = endWeek - startWeek + 1;
  const slotWidth = Math.max(1, Math.ceil(spanLength / normalized.length));

  return normalized.map((item, index) => {
    const rowStart = Math.min(endWeek, startWeek + index * slotWidth);
    const rowEnd = index === normalized.length - 1
      ? endWeek
      : Math.min(endWeek, rowStart + slotWidth - 1);

    return {
      label: makeRoadmapTitle(item, rowStart),
      summary: item,
      startWeek: rowStart,
      endWeek: rowEnd,
      phase,
      phaseLabel,
    };
  });
}

function buildWeeklyRoadmapRowsFromTasks(tasks = []) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return [];
  }

  const buckets = Array.from({ length: 12 }, () => []);
  const baseDate = taskStartDate();

  tasks.forEach((task, index) => {
    const title = roadmapActionFromLine(task.title || task.description || "");
    if (!isUsefulRoadmapAction(title)) {
      return;
    }

    const week = roadmapWeekForTask(task, index, baseDate);
    buckets[week - 1].push(title);
  });

  if (!buckets.some((items) => items.length > 0)) {
    return [];
  }

  return buckets.map((items, index) => {
    const week = index + 1;
    const normalizedItems = normalizeRoadmapItems(items)
      .filter(isUsefulRoadmapAction)
      .slice(0, 3);
    const label = normalizedItems.length
      ? makeWeeklyRoadmapTitle(normalizedItems, week)
      : weeklyRoadmapFallback(week);
    const summary = normalizedItems.length
      ? normalizedItems.join(" / ")
      : weeklyRoadmapFallbackSummary(week);

    return {
      label,
      summary,
      startWeek: week,
      endWeek: week,
      phase: roadmapPhaseByWeek(week),
      phaseLabel: roadmapPhaseLabelByWeek(week),
    };
  });
}

function roadmapWeekForTask(task, index, baseDate) {
  const date = parseLocalDate(String(task.startDate || task.dueDate || ""));
  if (date) {
    return clamp(Math.floor(daysBetween(baseDate, date) / 7) + 1, 1, 12);
  }

  const sourcePhase = String(task.sourcePhase || "");
  if (sourcePhase.includes("60")) {
    return clamp(5 + (index % 4), 5, 8);
  }
  if (sourcePhase.includes("90")) {
    return clamp(9 + (index % 4), 9, 12);
  }
  return clamp(1 + (index % 4), 1, 4);
}

function makeWeeklyRoadmapTitle(items, week) {
  const cleanItems = items
    .map((item) => simplifyRoadmapTaskTitle(item))
    .filter(isUsefulRoadmapAction);

  if (!cleanItems.length) {
    return weeklyRoadmapFallback(week);
  }

  return truncateRoadmapText(cleanItems[0], 22);
}

function simplifyRoadmapTaskTitle(value) {
  return String(value || "")
    .replace(/^(?:まず|次に|最後に|具体的に|必要に応じて)[、,\s]*/u, "")
    .replace(/^(?:タスク|作業|施策)\s*\d*[\s:：.)、-]*/u, "")
    .replace(/すること$/u, "する")
    .replace(/を行う$/u, "を行う")
    .trim();
}

function fillMissingWeeklyRows(rows) {
  const byWeek = new Map();
  rows.forEach((row) => {
    const week = clamp(Number(row.startWeek) || 1, 1, 12);
    if (!byWeek.has(week) && isUsefulRoadmapAction(row.label)) {
      byWeek.set(week, { ...row, startWeek: week, endWeek: week });
    }
  });

  return Array.from({ length: 12 }, (_, index) => {
    const week = index + 1;
    return byWeek.get(week) || {
      label: weeklyRoadmapFallback(week),
      summary: weeklyRoadmapFallbackSummary(week),
      startWeek: week,
      endWeek: week,
      phase: roadmapPhaseByWeek(week),
      phaseLabel: roadmapPhaseLabelByWeek(week),
    };
  });
}

function buildDefaultWeeklyRoadmapRows() {
  return Array.from({ length: 12 }, (_, index) => {
    const week = index + 1;
    return {
      label: weeklyRoadmapFallback(week),
      summary: weeklyRoadmapFallbackSummary(week),
      startWeek: week,
      endWeek: week,
      phase: roadmapPhaseByWeek(week),
      phaseLabel: roadmapPhaseLabelByWeek(week),
    };
  });
}

function weeklyRoadmapFallback(week) {
  const defaults = [
    "目標と現状を整理",
    "必要情報を集める",
    "小さく実行開始",
    "初回結果を確認",
    "改善点を反映",
    "実行量を増やす",
    "成果行動に集中",
    "習慣化・仕組み化",
    "残課題を洗い出す",
    "仕上げに向け調整",
    "成果をまとめる",
    "次の90日に接続",
  ];
  return defaults[week - 1] || "実行を進める";
}

function weeklyRoadmapFallbackSummary(week) {
  if (week <= 4) {
    return "立ち上げと初期実行";
  }
  if (week <= 8) {
    return "検証と改善";
  }
  return "仕上げと定着";
}

function isUsefulRoadmapAction(value) {
  const line = String(value || "").trim();
  if (isGenericRoadmapLine(line)) {
    return false;
  }

  if (/^(?:計画|週次アクション|月次アクション|KPI|注意点|補足|まとめ|優先順位|概要|目的|フェーズ|ロードマップ|実行計画|具体アクション|進捗確認|週次レビュー|タスク一覧)$/u.test(line)) {
    return false;
  }

  // 中目標や夢の文言だけをロードマップに出さないための除外。
  // 具体タスクがない場合は weeklyRoadmapFallback を表示します。
  if (/^(?:\/?(?:30|60|90)\s*日\/?(?:30|60|90)?\s*日?|[0-9０-９]+年後に.*|.*(?:力|スキル)を身につける|.*を築く|.*を達成する)$/u.test(line)) {
    return false;
  }

  return line.length >= 4;
}

function pickRoadmapAction(items, weekNumber) {
  const normalized = normalizeRoadmapItems(items);
  return normalized[0] || roadmapFallback(weekNumber);
}

function normalizeRoadmapKey(value) {
  return String(value || "")
    .replace(/[、。,.，．\s]/g, "")
    .slice(0, 24);
}

function summarizeRoadmapItems(items) {
  return normalizeRoadmapItems(items)
    .slice(0, 2)
    .join(" / ");
}

function roadmapPhaseByWeek(week) {
  if (week <= 4) return "early";
  if (week <= 8) return "middle";
  return "late";
}

function roadmapPhaseLabelByWeek(week) {
  if (week <= 4) return "30日";
  if (week <= 8) return "60日";
  return "90日";
}

function extractExplicitWeekItems(markdown) {
  const weeks = Array.from({ length: 12 }, (_, index) => ({
    week: index + 1,
    items: [],
  }));

  const lines = String(markdown || "").split(/\r?\n/);
  let currentWeeks = [];

  lines.forEach((rawLine) => {
    const tableAssigned = assignRoadmapTableLine(rawLine, weeks);
    if (tableAssigned) {
      currentWeeks = [];
      return;
    }

    const line = cleanRoadmapLine(rawLine);
    if (!line) {
      return;
    }

    const weekRange = extractWeekRange(line);
    if (weekRange) {
      currentWeeks = rangeNumbers(weekRange.start, weekRange.end);
      const rest = roadmapActionFromLine(line.slice(weekRange.endIndex));
      if (rest) {
        addActionToWeekSet(weeks, currentWeeks, rest);
      }
      return;
    }

    const action = roadmapActionFromLine(line);
    if (currentWeeks.length && action) {
      addActionToWeekSet(weeks, currentWeeks, action);
    }
  });

  return weeks;
}

function assignRoadmapTableLine(rawLine, weeks) {
  if (!String(rawLine || "").includes("|")) {
    return false;
  }

  const cells = String(rawLine)
    .split("|")
    .map((cell) => cleanRoadmapLine(cell))
    .filter(Boolean);

  if (cells.length < 2 || cells.every((cell) => /^[-:]+$/.test(cell))) {
    return false;
  }

  const weekCell = cells.find((cell) => extractWeekRange(cell));
  const range = weekCell ? extractWeekRange(weekCell) : null;
  if (!range) {
    return false;
  }

  const actionCell = cells.find((cell) => cell !== weekCell && roadmapActionFromLine(cell));
  const action = actionCell ? roadmapActionFromLine(actionCell) : "";
  if (!action) {
    return false;
  }

  addActionToWeekSet(weeks, rangeNumbers(range.start, range.end), action);
  return true;
}

function extractWeekRange(line) {
  const patterns = [
    /(?:Week|W)\s*0?([1-9]|1[0-2])(?:\s*(?:[-〜~–—]|to)\s*(?:Week|W)?\s*0?([1-9]|1[0-2]))?/iu,
    /(?:第\s*)?([1-9]|1[0-2])\s*週(?:目)?(?:\s*(?:[-〜~–—])\s*(?:第\s*)?([1-9]|1[0-2])\s*週(?:目)?)?/u,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start >= 1 && start <= 12 && end >= 1 && end <= 12) {
        return {
          start: Math.min(start, end),
          end: Math.max(start, end),
          endIndex: match.index + match[0].length,
        };
      }
    }
  }

  return null;
}

function rangeNumbers(start, end) {
  const numbers = [];
  for (let week = start; week <= end; week += 1) {
    numbers.push(week);
  }
  return numbers;
}

function addActionToWeekSet(weeks, weekNumbers, action) {
  const cleaned = roadmapActionFromLine(action);
  if (!cleaned) {
    return;
  }

  const targetWeek = weekNumbers
    .map((weekNumber) => weeks[weekNumber - 1])
    .filter(Boolean)
    .sort((a, b) => a.items.length - b.items.length)[0];

  if (targetWeek) {
    targetWeek.items.push(cleaned);
  }
}

function extractPhaseItems(markdown) {
  const phases = {
    early: [],
    middle: [],
    late: [],
  };
  const lines = String(markdown || "").split(/\r?\n/);
  let currentPhase = "";

  lines.forEach((rawLine) => {
    const line = cleanRoadmapLine(rawLine);
    if (!line) {
      return;
    }

    if (/30\s*日|1\s*ヶ月|初月|Day\s*1\s*[-〜~]\s*30/i.test(line)) {
      currentPhase = "early";
      const rest = roadmapActionFromLine(line.replace(/^.*?(30\s*日|1\s*ヶ月|初月|Day\s*1\s*[-〜~]\s*30)[\s:：\-–—|｜]*/i, ""));
      if (rest) {
        phases[currentPhase].push(rest);
      }
      return;
    }

    if (/60\s*日|2\s*ヶ月|中盤|Day\s*31\s*[-〜~]\s*60/i.test(line)) {
      currentPhase = "middle";
      const rest = roadmapActionFromLine(line.replace(/^.*?(60\s*日|2\s*ヶ月|中盤|Day\s*31\s*[-〜~]\s*60)[\s:：\-–—|｜]*/i, ""));
      if (rest) {
        phases[currentPhase].push(rest);
      }
      return;
    }

    if (/90\s*日|3\s*ヶ月|終盤|Day\s*61\s*[-〜~]\s*90/i.test(line)) {
      currentPhase = "late";
      const rest = roadmapActionFromLine(line.replace(/^.*?(90\s*日|3\s*ヶ月|終盤|Day\s*61\s*[-〜~]\s*90)[\s:：\-–—|｜]*/i, ""));
      if (rest) {
        phases[currentPhase].push(rest);
      }
      return;
    }

    const action = roadmapActionFromLine(line);
    if (currentPhase && action) {
      phases[currentPhase].push(action);
    }
  });

  return {
    early: normalizeRoadmapItems(phases.early),
    middle: normalizeRoadmapItems(phases.middle),
    late: normalizeRoadmapItems(phases.late),
  };
}

function normalizeRoadmapItems(items) {
  const seen = new Set();
  return items
    .map((item) => roadmapActionFromLine(item))
    .filter(Boolean)
    .filter((item) => {
      const normalized = item.replace(/\s+/g, "");
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    })
    .map((item) => truncateRoadmapText(item, 46))
    .slice(0, 18);
}

function cleanRoadmapLine(value) {
  return String(value || "")
    .replace(/```.*$/g, "")
    .replace(/^#{1,6}\s*/g, "")
    .replace(/^[-*・●]\s*/g, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/^\d+[.)．]\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roadmapActionFromLine(value) {
  let line = cleanRoadmapLine(value)
    .replace(/^[\s:：\-–—|｜]+/u, "")
    .replace(/[。.]$/u, "")
    .trim();

  if (!line) {
    return "";
  }

  line = line
    .replace(/^(?:Week|W)\s*0?([1-9]|1[0-2])(?:\s*(?:[-〜~–—]|to)\s*(?:Week|W)?\s*0?([1-9]|1[0-2]))?[\s:：.)、\-–—|｜]*/iu, "")
    .replace(/^(?:第\s*)?([1-9]|1[0-2])\s*週(?:目)?(?:\s*(?:[-〜~–—])\s*(?:第\s*)?([1-9]|1[0-2])\s*週(?:目)?)?[\s:：.)、\-–—|｜]*/u, "")
    .replace(/^[【\[(（]?(?:30|60|90)\s*日(?:目|間)?(?:プラン|計画|目標|フェーズ)?[】\])）]?[\s:：\-–—|｜]*/u, "")
    .trim();

  if (isGenericRoadmapLine(line)) {
    return "";
  }

  const colonMatch = line.match(/^(.{1,18})[：:]\s*(.+)$/u);
  if (colonMatch) {
    const left = colonMatch[1].trim();
    const right = colonMatch[2].trim();
    if (isGenericRoadmapLine(left) && !isGenericRoadmapLine(right)) {
      line = right;
    } else if (!isGenericRoadmapLine(left) && left.length <= 16) {
      line = left;
    } else {
      line = right || left;
    }
  }

  line = line
    .replace(/^「(.+)」$/u, "$1")
    .replace(/^[・\-–—\s]+/u, "")
    .trim();

  if (isGenericRoadmapLine(line)) {
    return "";
  }

  return truncateRoadmapText(line, 64);
}

function isGenericRoadmapLine(line) {
  const value = String(line || "").trim();
  if (!value || value.length < 4) {
    return true;
  }
  if (/^(?:[()（）\s]*\/?(?:30|60|90)\s*日(?:\/?(?:30|60|90)\s*日?)*[()）\s]*|30\/60\/90\s*日(?:プラン|計画)?|(?:30|60|90)\s*日(?:プラン|計画|目標|フェーズ)?)(?:[:：])?$/iu.test(value)) {
    return true;
  }
  if (/^(?:計画|週次アクション|月次アクション|KPI|注意点|補足|まとめ|優先順位|概要|目的|目標|フェーズ|戦略|ロードマップ|具体アクション|実行計画|短期|中期|長期|タスク|施策)(?:（.*?）|\(.*?\))?[:：]?$/iu.test(value)) {
    return true;
  }
  if (/^(?:Week|W)\s*([1-9]|1[0-2])(?:\s*[-〜~–—]\s*(?:Week|W)?\s*([1-9]|1[0-2]))?$/iu.test(value)) {
    return true;
  }
  if (/^[-|:：\s]+$/.test(value)) {
    return true;
  }
  return false;
}

function makeRoadmapTitle(text, weekNumber) {
  const cleaned = roadmapActionFromLine(text);
  if (!cleaned) {
    return roadmapFallback(weekNumber);
  }
  return truncateRoadmapText(cleaned, 20);
}

function truncateRoadmapText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function roadmapFallback(weekNumber) {
  const defaults = [
    "目標と前提を整理する",
    "必要な準備を進める",
    "小さく実行を始める",
    "初回の結果を確認する",
    "改善点を反映する",
    "実行量を増やす",
    "成果につながる行動に集中する",
    "仕組み化・習慣化する",
    "残課題を洗い出す",
    "仕上げに向けて調整する",
    "成果をまとめる",
    "次の90日に接続する",
  ];
  return defaults[weekNumber - 1] || "実行を進める";
}

function renderTaskDashboard() {
  if (!state.tasks.length) {
    elements.taskDashboard.classList.add("hidden");
    elements.taskDashboard.innerHTML = "";
    return;
  }

  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.status === "done").length;
  const percent = Math.round((done / total) * 100);
  const startDate = taskStartDate();
  const targetDate = addDays(startDate, 90);
  const today = startOfDay(new Date());
  const remainingDays = Math.max(0, Math.ceil((targetDate - today) / 86400000));
  const elapsedDays = Math.min(90, Math.max(1, 90 - remainingDays));
  const expectedPercent = Math.round((elapsedDays / 90) * 100);
  const message = progressMessage(percent, expectedPercent, done, total, remainingDays);

  elements.taskDashboard.classList.remove("hidden");
  elements.taskDashboard.innerHTML = `
    <div class="dashboard-card">
      <span class="dashboard-label">タスク進捗</span>
      <strong>${done} / ${total}</strong>
      <span>${percent}% 完了</span>
    </div>
    <div class="dashboard-card">
      <span class="dashboard-label">90日チャレンジ</span>
      <strong>残り${remainingDays}日</strong>
      <span>${formatDate(startDate)} → ${formatDate(targetDate)}</span>
    </div>
    <div class="dashboard-card dashboard-message">
      <span class="dashboard-label">今日の一言</span>
      <strong>${escapeHtml(message)}</strong>
    </div>
    <div class="dashboard-progress" aria-label="タスク完了率">
      <span style="width: ${percent}%"></span>
    </div>
  `;
}

function taskStartDate() {
  const dates = state.tasks
    .map((task) => parseLocalDate(String(task.createdAt || task.dueDate || "")))
    .filter(Boolean)
    .sort((a, b) => a - b);
  return dates[0] || startOfDay(new Date());
}

function parseLocalDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(startDate, endDate) {
  return Math.round((startOfDay(endDate) - startOfDay(startDate)) / 86400000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function statusLabel(status) {
  return { todo: "未着手", doing: "進行中", done: "完了" }[status] || "未着手";
}

function progressMessage(percent, expectedPercent, done, total, remainingDays) {
  if (done === total) {
    return "完了です。90日計画が行動に変わりました。";
  }
  if (remainingDays === 0) {
    return "今日が区切りです。最後に1つだけ完了に寄せましょう。";
  }
  if (percent >= expectedPercent + 10) {
    return "かなり良いペースです。この勢いで次の一手を片付けましょう。";
  }
  if (percent >= expectedPercent) {
    return "順調です。今日も1つ終えると流れが続きます。";
  }
  if (percent >= Math.max(0, expectedPercent - 15)) {
    return "まだ十分巻き返せます。まず一番軽いタスクを1つ完了にしましょう。";
  }
  return "ここから立て直せます。15分で終わるタスクを選んで再始動しましょう。";
}

function syncSelectedTaskIds() {
  const existingIds = new Set(state.tasks.map((task) => Number(task.id)));
  state.selectedTaskIds = new Set(
    Array.from(state.selectedTaskIds).filter((id) => existingIds.has(id))
  );
}

function selectedTaskIds() {
  const selected = Array.from(state.selectedTaskIds);
  if (selected.length > 0) {
    return selected;
  }

  // ページ再読み込み後などで選択状態が消えていても、
  // 参考動画・書籍 / 90日ビジョン画像が止まらないよう、未選択時は全タスクを対象にします。
  return state.tasks.map((task) => Number(task.id)).filter((id) => Number.isFinite(id) && id > 0);
}

function selectedTasksForExport() {
  const ids = new Set(selectedTaskIds());
  return state.tasks.filter((task) => ids.has(Number(task.id)));
}

function taskDateRangeLabel(task) {
  if (task.startDate && task.dueDate) {
    return `${task.startDate}〜${task.dueDate}`;
  }
  if (task.startDate) {
    return `${task.startDate}〜未設定`;
  }
  if (task.dueDate) {
    return `〜${task.dueDate}`;
  }
  return "期間未設定";
}

function updateIcsLink() {
  const ids = selectedTaskIds();
  const hasMissingDate = selectedTasksForExport().some((task) => !task.startDate || !task.dueDate);
  elements.exportIcsLink.href = ids.length
    ? `./api/tasks.php?action=ics&ids=${encodeURIComponent(ids.join(","))}`
    : "./api/tasks.php?action=ics";
  elements.exportIcsLink.classList.toggle("disabled-link", ids.length === 0 || hasMissingDate);
  elements.exportIcsLink.textContent = ids.length
    ? `カレンダー用ICS (${ids.length}件${hasMissingDate ? "・日付未設定あり" : ""})`
    : "カレンダー用ICS";
  updateTaskDownloadLinks();
}

function updateTaskDownloadLinks() {
  if (!elements.exportCsvLink || !elements.exportXlsLink) {
    return;
  }

  const ids = selectedTaskIds();
  const suffix = ids.length ? `&ids=${encodeURIComponent(ids.join(","))}` : "";
  elements.exportCsvLink.href = `./api/tasks.php?action=csv${suffix}`;
  elements.exportXlsLink.href = `./api/tasks.php?action=xls${suffix}`;
  elements.exportCsvLink.classList.toggle("disabled-link", !state.tasks.length);
  elements.exportXlsLink.classList.toggle("disabled-link", !state.tasks.length);
  const labelCount = ids.length || state.tasks.length;
  elements.exportCsvLink.textContent = `CSVダウンロード${labelCount ? ` (${labelCount}件)` : ""}`;
  elements.exportXlsLink.textContent = `Excel用xls${labelCount ? ` (${labelCount}件)` : ""}`;
}

function renderRecommendations() {
  if (!state.recommendations.length) {
    elements.recommendationList.innerHTML = `<p class="empty-message">タスク生成後、「参考動画・書籍」を押すと、行動に役立つリンクが表示されます。</p>`;
    return;
  }

  elements.recommendationList.innerHTML = state.recommendations.map((item) => `
    <a class="recommendation-card" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">
      ${item.thumbnailUrl ? `<img src="${escapeAttribute(item.thumbnailUrl)}" alt="">` : `<div class="recommendation-icon">${item.type === "book" ? "BOOK" : "VIDEO"}</div>`}
      <div>
        <div class="task-meta">
          <span>${item.type === "book" ? "書籍" : "動画"}</span>
          <span>${escapeHtml(item.taskTitle || "")}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description || item.source || "")}</p>
      </div>
    </a>
  `).join("");
}

function renderVisionImages() {
  if (!state.visionImages.length) {
    elements.visionList.innerHTML = `<p class="empty-message">「90日ビジョン画像」で、壁紙や印刷に使える行動促進ポスターを生成します。</p>`;
    return;
  }

  elements.visionList.innerHTML = state.visionImages.map((image) => `
    <article class="vision-card">
      <div class="vision-label">${escapeHtml(visionLabel(image))}</div>
      <img
        src="${escapeAttribute(imageSrc(image))}"
        alt="90日ビジョン画像"
        onerror="this.closest('.vision-card').classList.add('image-error')"
      >
      <p class="vision-error-message">画像ファイルを読み込めません。保存先: ${escapeHtml(image.imagePath || "")}</p>
      <div class="vision-actions">
        <a class="btn btn-secondary" href="${escapeAttribute(image.imagePath)}" download>ダウンロード</a>
        <a class="btn btn-secondary" href="${escapeAttribute(image.imagePath)}" target="_blank" rel="noopener noreferrer">開く</a>
      </div>
    </article>
  `).join("");
}

function imageSrc(image) {
  const path = String(image.imagePath || "").replace(/^\.?\//, "");
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(image.id || image.createdAt || Date.now())}`;
}

function visionLabel(image) {
  const prompt = String(image.prompt || "");
  if (prompt.includes("[統合ビジョン画像]")) return "統合ビジョン画像";
  if (prompt.includes("[行動ポスター]")) return "行動ポスター";
  if (prompt.includes("[AIビジョン画像]")) return "AIビジョン画像";
  return String(image.imagePath || "").endsWith(".svg") ? "統合ビジョン画像" : "AIビジョン画像";
}

function normalizeCells(cells) {
  const normalized = Array(81).fill("");
  if (Array.isArray(cells)) {
    cells.slice(0, 81).forEach((value, index) => {
      normalized[index] = String(value || "");
    });
  }
  MIRROR_PAIRS.forEach((targetIndex, sourceIndex) => {
    normalized[targetIndex] = normalized[sourceIndex] || "";
  });
  return normalized;
}

function syncMiddleGoals() {
  MIRROR_PAIRS.forEach((targetIndex, sourceIndex) => {
    state.cells[targetIndex] = state.cells[sourceIndex] || "";
  });
}

function cellClass(index) {
  const classes = ["cell"];

  if (index === MAIN_GOAL_INDEX) {
    classes.push("main-goal");
  } else if (CENTER_GOAL_INDEXES.includes(index)) {
    classes.push("middle-goal");
  } else if (MIRRORED_CENTER_INDEXES.includes(index)) {
    classes.push("synced-goal");
  } else {
    classes.push("action-cell");
  }

  return classes.join(" ");
}

function placeholderFor(index) {
  if (index === MAIN_GOAL_INDEX) return "大目標";
  if (CENTER_GOAL_INDEXES.includes(index)) return "中目標";
  if (MIRRORED_CENTER_INDEXES.includes(index)) return "中目標が自動反映";
  return "具体アクション";
}

function renderAiResult(markdown) {
  elements.aiResult.innerHTML = markdownToHtml(markdown || "ここにAIの提案が表示されます。");
}

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split(/\r?\n/);
  let html = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }

    if (trimmed.startsWith("### ")) {
      closeList();
      html += `<h3>${formatInline(trimmed.slice(4))}</h3>`;
      return;
    }

    if (trimmed.startsWith("## ")) {
      closeList();
      html += `<h2>${formatInline(trimmed.slice(3))}</h2>`;
      return;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${formatInline(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))}</li>`;
      return;
    }

    closeList();
    html += `<p>${formatInline(trimmed)}</p>`;
  });

  closeList();
  return html;
}

function formatInline(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

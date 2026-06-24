const state = {
  csrfToken: "",
  user: null,
  cells: Array(81).fill(""),
  aiResult: "",
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
    "saveStatus",
    "userEmail",
    "logoutBtn",
    "expandActionsBtn",
    "generatePlanBtn",
    "createTasksBtn",
    "exportIcsLink",
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
  if (!confirm("クラウド上のマンダラチャートを削除します。よろしいですか？")) {
    return;
  }

  await postJson("./api/chart.php", {
    action: "delete",
    csrfToken: state.csrfToken,
  });

  state.cells = Array(81).fill("");
  state.aiResult = "";
  state.tasks = [];
  state.selectedTaskIds = new Set();
  state.recommendations = [];
  state.visionImages = [];
  renderCells();
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
          <h3>${escapeHtml(task.title)}</h3>
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

  elements.taskList.querySelectorAll("[data-task-start-date], [data-task-end-date]").forEach((input) => {
    input.addEventListener("change", () => {
      const taskId = Number(input.dataset.taskStartDate || input.dataset.taskEndDate);
      const card = input.closest(".task-card");
      const startInput = card.querySelector("[data-task-start-date]");
      const endInput = card.querySelector("[data-task-end-date]");
      if (startInput.value && endInput.value && endInput.value < startInput.value) {
        endInput.value = startInput.value;
      }
      handleTaskDate(taskId, startInput.value, endInput.value);
    });
  });

  elements.taskList.querySelectorAll("[data-task-status]").forEach((select) => {
    select.addEventListener("change", () => {
      handleTaskStatus(Number(select.dataset.taskStatus), select.value);
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

  updateIcsLink();
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
  return Array.from(state.selectedTaskIds);
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

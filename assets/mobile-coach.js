const mobileState = {
  csrfToken: '',
  user: null,
  today: '',
  tasks: [],
  todayTaskIds: [],
  checkin: null,
  journal: null,
  history: [],
  followupHistory: [],
  followupResponse: null,
  deferredPrompt: null,
  currentScreen: 'home'
};
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  bindMobileEvents();
  registerPwa();
  bindAutomaticRefresh();
  await refreshMobileStatus();
});

function bindMobileEvents() {
  $('mobileAuthForm').addEventListener('submit', loginMobile);
  $('mobileLogoutBtn').addEventListener('click', logoutMobile);
  $('mobileMenuBtn').addEventListener('click', () => $('mobileMenu').classList.toggle('hidden'));
  $('homeLogoBtn').addEventListener('click', () => switchMobileScreen('home'));
  $('mobileCheckinForm').addEventListener('submit', saveMobileCheckin);
  $('mobileJournalForm').addEventListener('submit', saveMobileJournal);
  $('installAppBtn').addEventListener('click', installPwa);
  document.addEventListener('mobile-coach-followup-submit', submitMobileCoachFollowup);
  document.addEventListener('mobile-coach-voice-toggle', toggleMobileVoiceRecording);
  document.addEventListener('mobile-coach-voice-replay', replayMobileCoachVoice);
  document.addEventListener('mobile-coach-voice-stop', () => stopMobileVoicePlayback({ keepReplay: true }));
  window.addEventListener('pagehide', () => disposeMobileVoice());

  document.querySelectorAll('[data-mobile-screen]').forEach((button) => {
    button.addEventListener('click', () => switchMobileScreen(button.dataset.mobileScreen));
  });

  document.addEventListener('click', (event) => {
    if (!$('mobileMenu').contains(event.target) && event.target !== $('mobileMenuBtn')) {
      $('mobileMenu').classList.add('hidden');
    }
  });
}

let mobileFollowupRunning = false;
const MOBILE_VOICE_MAX_DURATION_MS = 30000;
const MOBILE_VOICE_MAX_AUDIO_BYTES = 5000000;
const MOBILE_VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const mobileVoice = {
  state: 'IDLE',
  requestingMic: false,
  recorder: null,
  stream: null,
  chunks: [],
  startedAt: 0,
  timer: null,
  discardRecording: false,
  audio: null,
  objectUrl: '',
  speechAbort: null,
  speechRequestId: 0
};

async function submitMobileCoachFollowup(event) {
  const question = typeof event.detail?.question === 'string'
    ? event.detail.question.replace(/\s+/gu, ' ').trim().slice(0, 500)
    : '';
  if (!question || mobileFollowupRunning || !mobileState.user) return;
  mobileFollowupRunning = true;
  notifyMobileAvatarUi({ busy: true, error: '' });
  notifyMobileAvatar('followup-start');
  try {
    const result = await postMobile('./api/coach_followup.php', {
      csrfToken: mobileState.csrfToken,
      question,
      history: mobileState.followupHistory.slice(-4)
    });
    const response = {
      question_type: result.question_type,
      behavior_signals: result.behavior_signals,
      intervention_type: result.intervention_type,
      coach_message: result.reply
    };
    mobileState.followupHistory = [...mobileState.followupHistory,
      { role: 'user', text: question },
      { role: 'assistant', text: result.reply }
    ].slice(-4);
    mobileState.followupResponse = response;
    notifyMobileAvatar('response', response, mobileState.currentScreen, false);
    notifyMobileAvatarUi({ busy: false, error: '', clear: true });
    void requestMobileCoachSpeech(result.reply);
  } catch (_) {
    notifyMobileAvatar('followup-restore');
    notifyMobileAvatarUi({
      busy: false,
      error: 'うまく回答できませんでした。もう一度試してください。'
    });
  } finally {
    mobileFollowupRunning = false;
  }
}

function notifyMobileAvatarUi(detail) {
  if (!$('mobileMiraPresentation')) return;
  try {
    document.dispatchEvent(new CustomEvent('mobile-coach-avatar', {
      detail: { type: 'followup-ui', ...detail }
    }));
  } catch (_) { /* Presentation UI failure must not affect Mobile Coach. */ }
}

function notifyMobileVoiceUi(detail) {
  if (!$('mobileMiraPresentation')) return;
  try {
    document.dispatchEvent(new CustomEvent('mobile-coach-avatar', {
      detail: { type: 'voice-ui', ...detail }
    }));
  } catch (_) { /* Voice UI failure must not affect Text Coach. */ }
}

function notifyMobileVoiceState(type) {
  try {
    notifyMobileAvatar(type);
  } catch (_) { /* Voice presentation is optional. */ }
}

function supportedMobileVoiceMimeType() {
  const Recorder = globalThis.MediaRecorder;
  if (typeof Recorder !== 'function') return '';
  if (typeof Recorder.isTypeSupported !== 'function') return '';
  return MOBILE_VOICE_MIME_TYPES.find(type => Recorder.isTypeSupported(type)) || '';
}

function mobileVoiceFilename(mimeType) {
  if (isMobileVoiceMp4Mime(mimeType)) return 'mira-recording.m4a';
  if (mimeType.startsWith('audio/ogg')) return 'mira-recording.ogg';
  return 'mira-recording.webm';
}

function isMobileVoiceMp4Mime(mimeType) {
  return ['audio/mp4', 'video/mp4', 'audio/x-m4a', 'application/mp4']
    .includes(String(mimeType || '').toLowerCase().split(';', 1)[0].trim());
}

function mobileVoiceRecorderTimeslice(mimeType) {
  return !mimeType || isMobileVoiceMp4Mime(mimeType) ? null : 250;
}

function mobileTranscriptionErrorMessage(errorCode) {
  if (errorCode === 'unsupported_audio_format') {
    return 'この端末の録音形式を処理できませんでした。Safariを最新にするか、テキストで質問してください。';
  }
  if (errorCode === 'invalid_audio') {
    return '録音データが正しくありません。もう一度お試しください。';
  }
  return '音声を文字にできませんでした。テキストで質問してください。';
}

function stopMobileVoiceTracks() {
  for (const track of mobileVoice.stream?.getTracks?.() || []) {
    try { track.stop(); } catch (_) { /* Best-effort privacy cleanup. */ }
  }
  mobileVoice.stream = null;
}

async function toggleMobileVoiceRecording() {
  if (mobileVoice.state === 'RECORDING') {
    stopMobileVoiceRecording();
    return;
  }
  if (mobileVoice.requestingMic || mobileVoice.state === 'TRANSCRIBING' || !mobileState.user) return;
  await startMobileVoiceRecording();
}

async function startMobileVoiceRecording() {
  const Recorder = globalThis.MediaRecorder;
  if (typeof Recorder !== 'function' || !navigator.mediaDevices?.getUserMedia) {
    notifyMobileVoiceUi({ state: 'IDLE', error: 'このブラウザでは音声入力を利用できません。テキストで質問してください。', canReplay: Boolean(mobileVoice.audio) });
    return;
  }
  mobileVoice.requestingMic = true;
  stopMobileVoicePlayback({ keepReplay: true });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = supportedMobileVoiceMimeType();
    const recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
    mobileVoice.stream = stream;
    mobileVoice.recorder = recorder;
    mobileVoice.chunks = [];
    mobileVoice.startedAt = Date.now();
    mobileVoice.discardRecording = false;
    recorder.addEventListener('dataavailable', event => {
      if (event.data?.size > 0) mobileVoice.chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => void finishMobileVoiceRecording(recorder));
    recorder.addEventListener('error', () => cancelMobileVoiceRecording('録音に失敗しました。テキストで質問してください。'));
    const timeslice = mobileVoiceRecorderTimeslice(mimeType);
    if (timeslice === null) recorder.start();
    else recorder.start(timeslice);
    mobileVoice.state = 'RECORDING';
    mobileVoice.timer = setTimeout(() => stopMobileVoiceRecording(), MOBILE_VOICE_MAX_DURATION_MS);
    notifyMobileVoiceUi({ state: 'RECORDING', error: '', canReplay: Boolean(mobileVoice.audio) });
    notifyMobileVoiceState('voice-recording');
  } catch (_) {
    stopMobileVoiceTracks();
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: 'マイクを利用できません。許可を確認するか、テキストで質問してください。', canReplay: Boolean(mobileVoice.audio) });
    notifyMobileVoiceState('voice-idle');
  } finally {
    mobileVoice.requestingMic = false;
  }
}

function stopMobileVoiceRecording({ discard = false } = {}) {
  if (mobileVoice.timer) clearTimeout(mobileVoice.timer);
  mobileVoice.timer = null;
  mobileVoice.discardRecording = discard;
  const recorder = mobileVoice.recorder;
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (_) { cancelMobileVoiceRecording('録音を停止できませんでした。'); }
  } else {
    stopMobileVoiceTracks();
  }
}

function cancelMobileVoiceRecording(message = '') {
  mobileVoice.discardRecording = true;
  if (mobileVoice.timer) clearTimeout(mobileVoice.timer);
  mobileVoice.timer = null;
  const recorder = mobileVoice.recorder;
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (_) { /* Tracks are stopped below. */ }
  }
  mobileVoice.recorder = null;
  mobileVoice.chunks = [];
  stopMobileVoiceTracks();
  mobileVoice.state = 'IDLE';
  notifyMobileVoiceUi({ state: 'IDLE', error: message, canReplay: Boolean(mobileVoice.audio) });
  notifyMobileVoiceState('voice-idle');
}

async function finishMobileVoiceRecording(recorder) {
  if (recorder !== mobileVoice.recorder) return;
  const durationMs = Math.max(1, Math.min(MOBILE_VOICE_MAX_DURATION_MS, Date.now() - mobileVoice.startedAt));
  const discarded = mobileVoice.discardRecording;
  const chunks = mobileVoice.chunks;
  const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
  mobileVoice.recorder = null;
  mobileVoice.chunks = [];
  stopMobileVoiceTracks();
  if (discarded) {
    mobileVoice.state = 'IDLE';
    return;
  }
  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size <= 0 || blob.size > MOBILE_VOICE_MAX_AUDIO_BYTES) {
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: '録音データが正しくありません。もう一度お試しください。', canReplay: Boolean(mobileVoice.audio) });
    notifyMobileVoiceState('voice-idle');
    return;
  }
  await transcribeMobileVoice(blob, durationMs, mimeType);
}

async function transcribeMobileVoice(blob, durationMs, mimeType) {
  mobileVoice.state = 'TRANSCRIBING';
  notifyMobileVoiceUi({ state: 'TRANSCRIBING', error: '', canReplay: Boolean(mobileVoice.audio) });
  notifyMobileVoiceState('voice-transcribing');
  let failureCode = '';
  try {
    const data = new FormData();
    data.append('csrfToken', mobileState.csrfToken);
    data.append('durationMs', String(durationMs));
    data.append('audio', blob, mobileVoiceFilename(mimeType));
    const response = await fetch('./api/coach_transcribe.php', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: data
    });
    const result = await response.json().catch(() => ({ ok: false }));
    failureCode = typeof result.error_code === 'string' ? result.error_code : '';
    const transcript = presentationCoachText(result.transcript);
    if (!response.ok || result.ok === false || !transcript) throw new Error('transcription failed');
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: '', canReplay: Boolean(mobileVoice.audio), transcript });
    notifyMobileVoiceState('voice-idle');
  } catch (_) {
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: mobileTranscriptionErrorMessage(failureCode), canReplay: Boolean(mobileVoice.audio) });
    notifyMobileVoiceState('voice-idle');
  }
}

async function requestMobileCoachSpeech(text) {
  const speechText = presentationCoachText(text);
  if (!speechText) return;
  const requestId = ++mobileVoice.speechRequestId;
  mobileVoice.speechAbort?.abort?.();
  stopMobileVoicePlayback({ keepReplay: false });
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  mobileVoice.speechAbort = controller;
  mobileVoice.state = 'THINKING';
  notifyMobileVoiceUi({ state: 'THINKING', error: '', canReplay: false });
  try {
    const response = await fetch('./api/coach_speech.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      credentials: 'same-origin',
      body: JSON.stringify({ csrfToken: mobileState.csrfToken, text: speechText }),
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('audio/')) {
      throw new Error('speech failed');
    }
    const blob = await response.blob();
    if (requestId !== mobileVoice.speechRequestId || blob.size <= 0 || blob.size > MOBILE_VOICE_MAX_AUDIO_BYTES) return;
    mobileVoice.objectUrl = URL.createObjectURL(blob);
    mobileVoice.audio = new Audio(mobileVoice.objectUrl);
    mobileVoice.audio.preload = 'auto';
    mobileVoice.audio.addEventListener('ended', finishMobileVoicePlayback);
    mobileVoice.audio.addEventListener('error', failMobileVoicePlayback);
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: '', canReplay: true });
    await playMobileCoachVoice();
  } catch (error) {
    if (error?.name === 'AbortError' || requestId !== mobileVoice.speechRequestId) return;
    mobileVoice.state = 'IDLE';
    notifyMobileVoiceUi({ state: 'IDLE', error: '音声を再生できませんでした。テキスト回答はそのまま確認できます。', canReplay: Boolean(mobileVoice.audio) });
    notifyMobileVoiceState('speech-end');
  } finally {
    if (requestId === mobileVoice.speechRequestId) mobileVoice.speechAbort = null;
  }
}

async function playMobileCoachVoice() {
  const audio = mobileVoice.audio;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    mobileVoice.state = 'SPEAKING';
    notifyMobileVoiceUi({ state: 'SPEAKING', error: '', canReplay: true });
    notifyMobileVoiceState('speech-start');
    await audio.play();
  } catch (_) {
    failMobileVoicePlayback();
  }
}

function replayMobileCoachVoice() {
  void playMobileCoachVoice();
}

function finishMobileVoicePlayback() {
  mobileVoice.state = 'IDLE';
  notifyMobileVoiceUi({ state: 'IDLE', error: '', canReplay: Boolean(mobileVoice.audio) });
  notifyMobileVoiceState('speech-end');
}

function failMobileVoicePlayback() {
  mobileVoice.audio?.pause?.();
  mobileVoice.state = 'IDLE';
  notifyMobileVoiceUi({ state: 'IDLE', error: '音声を再生できませんでした。再生ボタンをお試しください。', canReplay: Boolean(mobileVoice.audio) });
  notifyMobileVoiceState('speech-end');
}

function stopMobileVoicePlayback({ keepReplay = true } = {}) {
  if (mobileVoice.audio) {
    try {
      mobileVoice.audio.pause();
      mobileVoice.audio.currentTime = 0;
    } catch (_) { /* Playback stop is best effort. */ }
  }
  if (mobileVoice.state === 'SPEAKING') notifyMobileVoiceState('speech-end');
  mobileVoice.state = 'IDLE';
  if (!keepReplay) releaseMobileVoiceAudio();
  notifyMobileVoiceUi({ state: 'IDLE', error: '', canReplay: keepReplay && Boolean(mobileVoice.audio) });
}

function releaseMobileVoiceAudio() {
  if (mobileVoice.audio) {
    try {
      mobileVoice.audio.pause();
      mobileVoice.audio.removeAttribute?.('src');
      mobileVoice.audio.load?.();
    } catch (_) { /* Object URL cleanup continues. */ }
  }
  if (mobileVoice.objectUrl) URL.revokeObjectURL(mobileVoice.objectUrl);
  mobileVoice.audio = null;
  mobileVoice.objectUrl = '';
}

function disposeMobileVoice() {
  mobileVoice.speechRequestId++;
  mobileVoice.speechAbort?.abort?.();
  mobileVoice.speechAbort = null;
  stopMobileVoiceRecording({ discard: true });
  stopMobileVoiceTracks();
  releaseMobileVoiceAudio();
  mobileVoice.state = 'IDLE';
}

let mobileRefreshRunning = false;

function bindAutomaticRefresh() {
  window.addEventListener('pageshow', () => void refreshMobileCoachContext());
  window.addEventListener('focus', () => void refreshMobileCoachContext());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshMobileCoachContext();
  });
}

async function refreshMobileCoachContext() {
  if (!mobileState.user || mobileRefreshRunning) return;
  mobileRefreshRunning = true;
  try {
    await Promise.all([loadMobileTasks(), loadMobileCoach()]);
    renderMobileData();
  } catch (error) {
    console.error('AIコーチの最新情報を取得できませんでした。', error);
  } finally {
    mobileRefreshRunning = false;
  }
}

async function refreshMobileStatus() {
  try {
    const result = await postMobile('./api/auth.php', { action: 'status' }, false);
    mobileState.csrfToken = result.csrfToken || '';
    mobileState.user = result.user || null;

    if (!mobileState.user) {
      showMobileAuth();
      return;
    }

    showMobileApp();
    await Promise.all([loadMobileTasks(), loadMobileCoach()]);
    renderMobile();
  } catch (error) {
    showMobileAuth();
    $('mobileAuthMessage').textContent = error.message;
  }
}

async function loginMobile(event) {
  event.preventDefault();
  setButtonBusy(event.submitter, true, 'ログイン中…');
  try {
    const result = await postMobile('./api/auth.php', {
      action: 'login',
      csrfToken: mobileState.csrfToken,
      email: $('mobileEmail').value,
      password: $('mobilePassword').value
    });
    mobileState.csrfToken = result.csrfToken || mobileState.csrfToken;
    mobileState.user = result.user;
    showMobileApp();
    await Promise.all([loadMobileTasks(), loadMobileCoach()]);
    renderMobile();
  } catch (error) {
    $('mobileAuthMessage').textContent = error.message;
  } finally {
    setButtonBusy(event.submitter, false);
  }
}

async function logoutMobile() {
  disposeMobileVoice();
  await postMobile('./api/auth.php', { action: 'logout', csrfToken: mobileState.csrfToken });
  location.reload();
}

async function loadMobileTasks() {
  const result = await postMobile('./api/tasks.php', { action: 'load' }, false);
  mobileState.tasks = result.tasks || [];
}

async function loadMobileCoach() {
  const result = await postMobile('./api/coach.php', { action: 'load' }, false);
  mobileState.today = result.today;
  mobileState.todayTaskIds = (result.todayTaskIds || []).map(Number);
  mobileState.checkin = result.checkin;
  mobileState.journal = result.journal;
  mobileState.history = result.history || [];
}

function renderMobile() {
  const now = new Date();
  $('mobileToday').textContent = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(now);

  $('mobileGreeting').textContent = now.getHours() < 11
    ? 'おはようございます'
    : now.getHours() < 17
      ? '今日も一歩ずつ'
      : '今日もお疲れさまです';

  renderMobileData();
  switchMobileScreen('home', false);
}

function renderMobileData() {
  renderTaskChoices();
  fillSavedValues();
  renderHistory();
  renderHome();
  notifyMobileAvatar('restore');
}

function renderHome() {
  const plannedIds = (mobileState.checkin?.taskIds?.length
    ? mobileState.checkin.taskIds
    : mobileState.todayTaskIds || []).map(Number);
  const completedIds = new Set((mobileState.journal?.completedTaskIds || []).map(Number));
  const plannedCount = plannedIds.length;
  const completedCount = plannedIds.filter((id) => completedIds.has(id)).length;
  const rate = plannedCount ? Math.round((completedCount / plannedCount) * 100) : 0;

  $('homeTaskCount').textContent = String(plannedCount);
  $('homeCompletedCount').textContent = String(completedCount);
  $('homeProgressRate').textContent = `${rate}%`;

  $('homeMorningLabel').textContent = mobileState.checkin
    ? 'チェックイン済み'
    : plannedCount
      ? `${plannedCount}件の予定を確認`
      : '今日の予定を確認';

  $('homeEveningLabel').textContent = mobileState.journal
    ? '振り返り済み'
    : mobileState.checkin
      ? '朝に決めたことを確認'
      : 'チェックイン後に利用';

  $('homeCoachMessage').textContent = buildHomeCoachMessage(plannedIds, completedIds);
}

function buildHomeCoachMessage(plannedIds, completedIds) {
  if (mobileState.journal?.aiFeedback) {
    return shortenText(mobileState.journal.aiFeedback, 110);
  }

  if (mobileState.checkin?.aiMessage) {
    return shortenText(mobileState.checkin.aiMessage, 110);
  }

  const taskById = new Map(mobileState.tasks.map((task) => [Number(task.id), task]));
  const firstIncomplete = plannedIds
    .filter((id) => !completedIds.has(id))
    .map((id) => taskById.get(id))
    .find(Boolean);

  if (firstIncomplete) {
    return `まずは「${firstIncomplete.title}」から始めましょう。全部ではなく、最初の15分だけで十分です。`;
  }

  if (plannedIds.length) {
    return '今日の予定は確認できています。チェックインして、最初の一歩を決めましょう。';
  }

  return '今日は予定されたタスクがありません。PC版のタスク一覧で日付を調整して、今日の一歩を設定しましょう。';
}

function renderTaskChoices() {
  const taskById = new Map(mobileState.tasks.map((task) => [Number(task.id), task]));
  const scheduledTasks = (mobileState.todayTaskIds || [])
    .map(Number)
    .map((id) => taskById.get(id))
    .filter(Boolean);

  const savedMorningIds = new Set((mobileState.checkin?.taskIds || []).map(Number));
  const selectedMorningIds = mobileState.checkin
    ? savedMorningIds
    : new Set(scheduledTasks.map((task) => Number(task.id)));

  $('mobileCheckinTasks').innerHTML = scheduledTasks.length
    ? scheduledTasks.map((task) =>
        taskChoiceHtml(task, selectedMorningIds.has(Number(task.id)), 'morningTask', 'planned')
      ).join('')
    : emptyTodayTaskHtml();

  const journalTasks = [...savedMorningIds]
    .map((id) => taskById.get(id))
    .filter(Boolean);
  const completedIds = new Set((mobileState.journal?.completedTaskIds || []).map(Number));

  $('mobileJournalTasks').innerHTML = journalTasks.length
    ? journalTasks.map((task) =>
        taskChoiceHtml(task, completedIds.has(Number(task.id)), 'journalTask', 'review')
      ).join('')
    : emptyJournalTaskHtml();
}

function taskChoiceHtml(task, checked, name, mode = '') {
  const dateText = task.startDate && task.dueDate
    ? `${formatShortDate(task.startDate)}〜${formatShortDate(task.dueDate)}`
    : '';
  const meta = [
    dateText,
    task.estimatedMinutes ? `目安 ${Number(task.estimatedMinutes)}分` : ''
  ].filter(Boolean).join(' · ');

  return `<label class="tap-task ${mode}">
    <input type="checkbox" name="${name}" value="${Number(task.id)}" ${checked ? 'checked' : ''}>
    <span class="task-check" aria-hidden="true">✓</span>
    <span class="task-copy">
      <strong>${escapeHtml(task.title)}</strong>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
    </span>
  </label>`;
}

function emptyTodayTaskHtml() {
  return '<div class="empty-state">今日の期間に設定されたタスクはありません。<a href="./#execution">PC版で開始日・終了日を調整</a></div>';
}

function emptyJournalTaskHtml() {
  return '<div class="empty-state">朝のチェックインで選んだタスクがありません。先にチェックインを保存してください。</div>';
}

function formatShortDate(value) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(value || '');
}

function fillSavedValues() {
  const c = mobileState.checkin;
  const j = mobileState.journal;

  if (c) {
    setRadio('mobileCheckinMood', c.mood);
    setRadio('mobileFocus', c.focusMinutes);
  }
  showFormStatus('mobileCheckinStatus', '');

  if (j) {
    setRadio('mobileJournalMood', j.mood);
    setRadio('mobileReason', j.reasonCode || 'none');
    $('mobileJournalText').value = j.freeText || j.completedText || '';
  }
  showFormStatus('mobileJournalStatus', '');
}

async function saveMobileCheckin(event) {
  event.preventDefault();
  const button = $('checkinSubmitBtn');
  setButtonBusy(button, true, 'AIコーチが考えています…');
  showFormStatus('mobileCheckinStatus', '');
  notifyMobileAvatar('thinking');

  try {
    const result = await postMobile('./api/coach.php', {
      action: 'save_checkin',
      csrfToken: mobileState.csrfToken,
      date: mobileState.today,
      mood: selectedValue('mobileCheckinMood', 3),
      focusMinutes: selectedValue('mobileFocus', 30),
      concern: '',
      taskIds: checkedValues('morningTask')
    });

    mobileState.checkin = result.checkin;
    renderMobileData();
    notifyMobileAvatar('response', result.checkin.aiResponse, 'morning');
    toast('今日のチェックインを保存しました');
  } catch (error) {
    showFormStatus('mobileCheckinStatus', error.message);
    notifyMobileAvatar('idle');
  } finally {
    setButtonBusy(button, false);
  }
}

async function saveMobileJournal(event) {
  event.preventDefault();
  const button = $('journalSubmitBtn');
  setButtonBusy(button, true, 'AIコーチが振り返っています…');
  showFormStatus('mobileJournalStatus', '');
  notifyMobileAvatar('thinking');
  const text = $('mobileJournalText').value.trim();

  try {
    const result = await postMobile('./api/coach.php', {
      action: 'save_journal',
      csrfToken: mobileState.csrfToken,
      date: mobileState.today,
      mood: selectedValue('mobileJournalMood', 3),
      completedTaskIds: checkedValues('journalTask'),
      completedText: text,
      problemText: '',
      reasonCode: selectedValue('mobileReason', 'none'),
      freeText: text,
      tomorrowAction: 'continue'
    });

    mobileState.journal = result.journal;
    mobileState.history = result.history || [];
    await loadMobileTasks();
    renderMobileData();
    notifyMobileAvatar('response', result.journal.aiResponse, 'evening');
    toast('今日の振り返りを保存しました');
  } catch (error) {
    showFormStatus('mobileJournalStatus', error.message);
    notifyMobileAvatar('idle');
  } finally {
    setButtonBusy(button, false);
  }
}

function renderHistory() {
  const mood = { 1: '😫', 2: '😞', 3: '😐', 4: '🙂', 5: '😊' };

  $('mobileHistory').innerHTML = mobileState.history.length
    ? mobileState.history.map((item) => `
      <article class="history-card">
        <header>
          <strong>${escapeHtml(item.date)}</strong>
          <span>${mood[item.mood] || '😐'}</span>
        </header>
        ${item.completedText ? `<p>${escapeHtml(item.completedText)}</p>` : ''}
        ${item.aiFeedback ? `<div class="mini-coach">${escapeHtml(item.aiFeedback)}</div>` : ''}
      </article>
    `).join('')
    : '<div class="mobile-card empty-state">まだ記録がありません。今日の一歩から始めましょう。</div>';
}

function switchMobileScreen(name, scroll = true) {
  const screens = ['home', 'morning', 'evening', 'history'];
  mobileState.currentScreen = screens.includes(name) ? name : 'home';
  if (mobileState.currentScreen === 'history') disposeMobileVoice();

  screens.forEach((screen) => {
    $(`${screen}Screen`).classList.toggle('hidden', screen !== mobileState.currentScreen);
  });

  document.querySelectorAll('[data-mobile-screen]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mobileScreen === mobileState.currentScreen);
  });

  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  notifyMobileAvatar(mobileState.currentScreen === 'history' ? 'history' : 'screen');
}

function showMobileAuth() {
  disposeMobileVoice();
  $('mobileAuth').classList.remove('hidden');
  $('mobileAppView').classList.add('hidden');
  notifyMobileAvatar('disable');
}

function showMobileApp() {
  $('mobileAuth').classList.add('hidden');
  $('mobileAppView').classList.remove('hidden');
  notifyMobileAvatar('enable');
}

// Optional, one-way notifications. Only presentation-safe text and allowlisted metadata are sent.
function notifyMobileAvatar(type, response, coachType = '', animateOverride = null) {
  if (!$('mobileMiraPresentation')) return;
  try {
    const screen = mobileState.currentScreen;
    const saved = mobileState.followupResponse ? { aiResponse: mobileState.followupResponse }
      : screen === 'morning' ? mobileState.checkin
      : screen === 'evening' ? mobileState.journal
      : screen === 'home' ? mobileState.journal || mobileState.checkin : null;
    const source = response === undefined ? saved?.aiResponse : response;
    const questionTypes = ['WHY', 'OBSTACLE', 'NEXT_STEP', 'START_SMALL', 'SUCCESS'];
    const signals = ['GOOD_MOMENTUM', 'REPEATED_POSTPONEMENT', 'LOW_COMPLETION', 'POSSIBLE_OVERLOAD'];
    const metadata = {
      question_type: questionTypes.includes(source?.question_type) ? source.question_type : null,
      behavior_signals: Array.isArray(source?.behavior_signals)
        ? [...new Set(source.behavior_signals.filter(value => signals.includes(value)))].slice(0, 4) : [],
      intervention_type: ['REDUCE_FRICTION', 'NARROW_FOCUS', 'REPLAN', 'REINFORCE', 'START_NEXT'].includes(source?.intervention_type)
        ? source.intervention_type : null,
      display_text: presentationCoachText(source?.coach_message || saved?.aiFeedback || saved?.aiMessage)
    };
    document.dispatchEvent(new CustomEvent('mobile-coach-avatar', {
      detail: {
        type,
        response: metadata,
        animate: typeof animateOverride === 'boolean'
          ? animateOverride
          : type === 'response' && (screen === 'home' || screen === coachType)
      }
    }));
  } catch (_) { /* Avatar must never affect save/load/text rendering. */ }
}

function presentationCoachText(value) {
  if (typeof value !== 'string' || /<[^>]*>|```/u.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function selectedValue(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map((el) => Number(el.value));
}

function setRadio(name, value) {
  const input = document.querySelector(
    `input[name="${name}"][value="${CSS.escape(String(value))}"]`
  );
  if (input) input.checked = true;
}

function showFormStatus(id, text) {
  const element = $(id);
  element.textContent = text || '';
  element.classList.toggle('hidden', !text);
}

function shortenText(text, maxLength) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}

function setButtonBusy(button, busy, busyText = '') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'mobile-toast';
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 2200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;'
  }[char]));
}

async function postMobile(url, payload, includeCsrf = true) {
  const body = { ...payload };
  if (includeCsrf && !body.csrfToken) body.csrfToken = mobileState.csrfToken;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });

  const result = await response.json().catch(() => ({
    ok: false,
    message: 'サーバーから正しい応答がありません。'
  }));

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || '通信に失敗しました。');
  }

  if (result.csrfToken) mobileState.csrfToken = result.csrfToken;
  return result;
}

function registerPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      const serviceWorkerUrl = document.documentElement.dataset.serviceWorkerUrl || './service-worker.js';
      try {
        const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
          scope: './',
          updateViaCache: 'none'
        });
        await registration.update();
      } catch (_) {
        // PWA installation is optional; keep the online Mobile Coach usable if registration fails.
      }
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    mobileState.deferredPrompt = event;
    $('installAppBtn').classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    mobileState.deferredPrompt = null;
    $('installAppBtn').classList.add('hidden');
  });
}

async function installPwa() {
  if (!mobileState.deferredPrompt) {
    toast('iPhoneは共有メニューから「ホーム画面に追加」を選んでください');
    return;
  }
  mobileState.deferredPrompt.prompt();
  await mobileState.deferredPrompt.userChoice;
  mobileState.deferredPrompt = null;
  $('installAppBtn').classList.add('hidden');
}

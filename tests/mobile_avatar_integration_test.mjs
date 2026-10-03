import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/mobile-coach.js', import.meta.url), 'utf8');
const mobilePage = fs.readFileSync(new URL('../mobile-coach.php', import.meta.url), 'utf8');
const ai = { question_type: 'START_SMALL', behavior_signals: ['REPEATED_POSTPONEMENT', 'private'], intervention_type: 'REDUCE_FRICTION',
  coach_message: '実際のAIコーチ回答です。次の一歩は何ですか？', email: 'private', user_id: 999, reflection: 'private', tasks: ['private'], api_key: 'private' };

function fixture(mode = 'enabled') {
  const elements = new Map(); const events = []; const requests = []; const listeners = new Map();
  const audioInstances = []; const revokedUrls = []; let speechMode = 'success'; let objectUrlSequence = 0;
  class FakeAudio extends EventTarget {
    constructor(src) { super(); this.src = src; this.currentTime = 0; this.playCount = 0; this.pauseCount = 0; audioInstances.push(this); }
    async play() { this.playCount++; }
    pause() { this.pauseCount++; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  }
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { id, value: '', textContent: '', innerHTML: '', dataset: {}, checked: false, disabled: false,
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
          toggle(value, force) { if (force ?? !classes.has(value)) classes.add(value); else classes.delete(value); } },
        addEventListener() {}, contains() { return false; }, remove() {}, classes });
    }
    return elements.get(id);
  }
  const radios = { mobileCheckinMood: '3', mobileFocus: '30', mobileJournalMood: '4', mobileReason: 'time' };
  const document = {
    getElementById(id) { return id === 'mobileMiraPresentation' && mode === 'disabled' ? null : element(id); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchEvent(event) { if (mode === 'throw') throw new Error('Avatar notification failure'); events.push(event.detail); },
    querySelector(selector) {
      const name = /name="([^"]+)"/.exec(selector)?.[1];
      if (!name) return null;
      const value = /value="([^"]+)"/.exec(selector)?.[1] || radios[name];
      return { value, set checked(checked) { if (checked) radios[name] = value; } };
    },
    querySelectorAll(selector) {
      if (selector.includes('name="morningTask"')) return [{ value: '501' }, { value: '502' }];
      if (selector.includes('name="journalTask"')) return [{ value: '501' }];
      return [];
    },
    createElement: () => element('toast'), body: { appendChild() {} }
  };
  const tasks = [{ id: 501, title: '<script>task</script>', status: 'todo' }, { id: 502, title: 'Second task', status: 'todo' }];
  const checkin = { mood: 3, focusMinutes: 30, taskIds: [501, 502], aiMessage: '<b>Morning text</b>', aiResponse: ai, concern: 'Saved concern' };
  const journal = { mood: 4, completedTaskIds: [501], aiFeedback: '<b>Evening text</b>', aiResponse: { ...ai, question_type: 'SUCCESS' },
    reasonCode: 'time', completedText: '<img>Reflection', freeText: '<img>Reflection', date: '2026-09-18' };
  let savedCheckin = null; let savedJournal = null; let taskLoads = 0;
  const context = vm.createContext({ document, navigator: {}, window: { addEventListener() {}, scrollTo() {} }, location: { reload() {} },
    CSS: { escape: String }, Intl, Date, Set, Map, console, Blob, FormData, AbortController, Audio: FakeAudio,
    URL: { createObjectURL() { return `blob:fixture-${++objectUrlSequence}`; }, revokeObjectURL(value) { revokedUrls.push(value); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, setTimeout() {}, clearTimeout() {},
    fetch: async (url, options) => {
      const payload = options.body instanceof FormData ? '[FormData]' : JSON.parse(options.body);
      requests.push({ url, payload, method: options.method, credentials: options.credentials });
      if (url.includes('coach_speech')) {
        if (speechMode === 'failure') {
          return { ok: false, status: 502, headers: { get: () => 'application/json' }, blob: async () => new Blob() };
        }
        return { ok: true, status: 200, headers: { get: () => 'audio/mpeg' }, blob: async () => new Blob(['ID3fixture'], { type: 'audio/mpeg' }) };
      }
      let result;
      if (url.includes('coach_followup')) result = { ok: true, reply: '今日は最初の10分だけ進め、残りは明日に分けましょう。', question_type: 'START_SMALL', behavior_signals: ['LOW_COMPLETION'], intervention_type: 'REDUCE_FRICTION' };
      else if (url.includes('auth')) result = { ok: true, csrfToken: 'csrf-fixture', user: { id: 999, email: 'private' } };
      else if (url.includes('tasks')) { taskLoads++; result = { ok: true, tasks: tasks.map(task => ({ ...task, status: savedJournal && task.id === 501 ? 'done' : task.status })) }; }
      else if (payload.action === 'save_checkin') { savedCheckin = checkin; result = { ok: true, checkin }; }
      else if (payload.action === 'save_journal') { savedJournal = journal; result = { ok: true, journal, history: [journal] }; }
      else result = { ok: true, today: '2026-09-18', todayTaskIds: [501, 502], checkin: savedCheckin, journal: savedJournal, history: savedJournal ? [journal] : [] };
      return { ok: true, json: async () => result };
    }
  });
  vm.runInContext(source, context);
  const run = expression => vm.runInContext(expression, context);
  return { run, elements, events, requests, element, tasks, audioInstances, revokedUrls,
    setSpeechMode(value) { speechMode = value; }, taskLoads: () => taskLoads, context };
}
async function flow(mode) {
  const f = fixture(mode); await f.run('refreshMobileStatus()');
  await f.run('saveMobileCheckin({ preventDefault() {} })');
  f.element('mobileJournalText').value = ' Current reflection ';
  await f.run('saveMobileJournal({ preventDefault() {} })');
  return f;
}
function uiSnapshot(f) {
  return Object.fromEntries(['mobileCheckinStatus', 'mobileJournalStatus', 'mobileHistory', 'mobileCheckinTasks', 'mobileJournalTasks',
    'homeTaskCount', 'homeCompletedCount', 'homeProgressRate', 'homeCoachMessage', 'checkinSubmitBtn', 'journalSubmitBtn'].map(id => {
    const e = f.element(id); return [id, { text: e.textContent, html: e.innerHTML, disabled: e.disabled, hidden: e.classes.has('hidden') }];
  }));
}

test('Morning/Evening HTTP payloads, CSRF, task reload, text/history match disabled Avatar even when dispatch fails', async () => {
  const baseline = await flow('disabled');
  for (const mode of ['enabled', 'throw']) {
    const f = await flow(mode); assert.deepEqual(f.requests, baseline.requests); assert.deepEqual(uiSnapshot(f), uiSnapshot(baseline));
    assert.equal(f.taskLoads(), 2); assert.equal(f.run('mobileState.tasks[0].status'), 'done');
  }
  const morning = baseline.requests.find(request => request.payload.action === 'save_checkin');
  assert.deepEqual(morning.payload, { action: 'save_checkin', csrfToken: 'csrf-fixture', date: '2026-09-18', mood: '3', focusMinutes: '30', concern: '', taskIds: [501, 502] });
  const evening = baseline.requests.find(request => request.payload.action === 'save_journal');
  assert.deepEqual(evening.payload.completedTaskIds, [501]); assert.equal(evening.payload.completedText, 'Current reflection');
  assert.equal(evening.credentials, 'same-origin'); assert.equal(evening.method, 'POST'); assert.equal(evening.payload.csrfToken, 'csrf-fixture');
});
test('lower Coach input/answers are absent; History and task escaping and 2/1/50% remain', async () => {
  const f = await flow('enabled');
  assert.equal(mobilePage.includes('id="mobileConcern"'), false);
  assert.equal(mobilePage.includes('id="mobileCheckinMessage"'), false);
  assert.equal(mobilePage.includes('id="mobileJournalMessage"'), false);
  assert.equal(mobilePage.includes('AIコーチに相談する（任意）'), false);
  assert.equal(f.element('mobileCheckinStatus').textContent, '');
  assert.equal(f.element('mobileJournalStatus').textContent, '');
  assert.ok(f.element('mobileHistory').innerHTML.includes('&lt;b&gt;Evening text&lt;/b&gt;'));
  assert.ok(f.element('mobileCheckinTasks').innerHTML.includes('&lt;script&gt;task&lt;/script&gt;'));
  assert.equal(f.element('homeTaskCount').textContent, '2'); assert.equal(f.element('homeCompletedCount').textContent, '1'); assert.equal(f.element('homeProgressRate').textContent, '50%');
});
test('notifications contain only presentation-safe text, allowlisted metadata and no identity/context data', async () => {
  const f = await flow('enabled'); const serialized = JSON.stringify(f.events);
  for (const key of ['email', 'user_id', 'coach_message', 'reflection', 'tasks', 'api_key', 'csrfToken', 'private', 'Morning text']) assert.equal(serialized.includes(key), false, key);
  const response = f.events.find(event => event.type === 'response');
  assert.deepEqual(JSON.parse(JSON.stringify(response.response)), { question_type: 'START_SMALL', behavior_signals: ['REPEATED_POSTPONEMENT'], intervention_type: 'REDUCE_FRICTION', display_text: '実際のAIコーチ回答です。次の一歩は何ですか？' });
  assert.equal(response.animate, true);
});
test('reload/context refresh uses restore only; History suspends motion and no save replay', async () => {
  const f = await flow('enabled'); f.events.length = 0; await f.run('refreshMobileCoachContext()');
  assert.equal(f.events.every(event => !event.animate && event.type !== 'response'), true);
  assert.equal(f.events.at(-1).response.question_type, 'SUCCESS');
  f.run("switchMobileScreen('history', false)"); assert.equal(f.events.at(-1).type, 'history'); assert.equal(f.events.at(-1).response.question_type, null);
});
test('missing aiResponse and unknown question do not create a lower Coach result', async () => {
  const f = await flow('enabled');
  f.run("mobileState.checkin.aiResponse = null; switchMobileScreen('morning', false)");
  assert.equal(f.events.at(-1).response.question_type, null); assert.equal(f.element('mobileCheckinStatus').textContent, '');
  f.run("mobileState.checkin.aiResponse = {question_type: '<svg>'}; notifyMobileAvatar('restore')");
  assert.equal(f.events.at(-1).response.question_type, null);
});
test('save errors still display error and release busy buttons even when Avatar notifications fail', async () => {
  const f = fixture('throw'); await f.run('refreshMobileStatus()'); f.run("postMobile = async () => { throw new Error('fixture API error'); }");
  await f.run('saveMobileCheckin({ preventDefault() {} })'); await f.run('saveMobileJournal({ preventDefault() {} })');
  assert.equal(f.element('mobileCheckinStatus').textContent, 'fixture API error'); assert.equal(f.element('mobileJournalStatus').textContent, 'fixture API error');
  assert.equal(f.element('checkinSubmitBtn').disabled, false); assert.equal(f.element('journalSubmitBtn').disabled, false);
});
test('follow-up sends only question/recent session turns, displays reply, blocks empty and duplicate submits', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()');
  const beforeEmpty = f.requests.length;
  await f.run("submitMobileCoachFollowup({detail:{question:'   '}})");
  assert.equal(f.requests.length, beforeEmpty);
  await f.run("submitMobileCoachFollowup({detail:{question:'今日はもう疲れました。残りもやるべき？'}})");
  const request = f.requests.find(item => item.url.includes('coach_followup'));
  assert.deepEqual(request.payload, { csrfToken: 'csrf-fixture', question: '今日はもう疲れました。残りもやるべき？', history: [] });
  const response = f.events.find(event => event.type === 'response' && event.response?.display_text?.includes('最初の10分'));
  assert.equal(response.response.question_type, 'START_SMALL');
  assert.equal(f.run('mobileState.followupHistory.length'), 2);

  f.run("let followupResolve; let followupCallCount=0; postMobile=()=>{followupCallCount++; return new Promise(resolve=>followupResolve=resolve)}; var pendingFollowup=submitMobileCoachFollowup({detail:{question:'A'}}); submitMobileCoachFollowup({detail:{question:'B'}})");
  assert.equal(f.run('followupCallCount'), 1);
  f.run("followupResolve({reply:'回答',question_type:'NEXT_STEP',behavior_signals:[],intervention_type:'START_NEXT'})");
  await f.run('pendingFollowup');
});
test('follow-up API failure keeps prior response and exposes friendly presentation error', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()');
  f.run("mobileState.followupResponse={question_type:'WHY',behavior_signals:[],intervention_type:'START_NEXT',coach_message:'保持する回答'}; postMobile=async()=>{throw new Error('private failure')}");
  await f.run("submitMobileCoachFollowup({detail:{question:'追加の質問'}})");
  const status = f.events.filter(event => event.type === 'followup-ui').at(-1);
  assert.equal(status.error, 'うまく回答できませんでした。もう一度試してください。');
  assert.equal(status.busy, false);
  assert.equal(f.events.some(event => JSON.stringify(event).includes('private failure')), false);
  assert.equal(f.events.some(event => event.type === 'followup-start'), true);
  assert.equal(f.events.some(event => event.type === 'followup-restore'), true);
  assert.equal(f.run('mobileFollowupRunning'), false);
  assert.equal(f.run('mobileState.followupResponse.coach_message'), '保持する回答');
});

test('ElevenLabs speech receives only final text, plays once, ends at IDLE, and reload does not autoplay', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()');
  const beforeReload = f.requests.filter(item => item.url.includes('coach_speech')).length;
  await f.run('refreshMobileCoachContext()');
  assert.equal(f.requests.filter(item => item.url.includes('coach_speech')).length, beforeReload);

  await f.run("requestMobileCoachSpeech('最終回答だけを読み上げます。')");
  const request = f.requests.find(item => item.url.includes('coach_speech'));
  assert.deepEqual(request.payload, { csrfToken: 'csrf-fixture', text: '最終回答だけを読み上げます。' });
  assert.equal(f.audioInstances.length, 1);
  assert.equal(f.audioInstances[0].playCount, 1);
  assert.equal(f.run('mobileVoice.state'), 'SPEAKING');
  assert.equal(f.events.some(event => event.type === 'speech-start'), true);
  f.run('finishMobileVoicePlayback()');
  assert.equal(f.run('mobileVoice.state'), 'IDLE');
  assert.equal(f.events.at(-1).type, 'speech-end');
});

test('replay, stop, replacement playback and recording-start cleanup are deterministic', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()');
  await f.run("requestMobileCoachSpeech('一つ目の回答です。')");
  f.run('replayMobileCoachVoice()');
  assert.equal(f.audioInstances[0].playCount, 2);
  f.run('stopMobileVoicePlayback({keepReplay:true})');
  assert.equal(f.run('mobileVoice.state'), 'IDLE');
  assert.ok(f.audioInstances[0].pauseCount >= 2);

  await f.run("requestMobileCoachSpeech('二つ目の回答です。')");
  assert.equal(f.audioInstances.length, 2);
  assert.equal(f.revokedUrls.includes('blob:fixture-1'), true);

  class FakeRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor(stream, options = {}) { super(); this.stream = stream; this.mimeType = options.mimeType || 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  let trackStopped = false;
  f.context.MediaRecorder = FakeRecorder;
  f.context.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { trackStopped = true; } }] }) };
  const pausesBeforeMic = f.audioInstances[1].pauseCount;
  await f.run('startMobileVoiceRecording()');
  assert.equal(f.run('mobileVoice.state'), 'RECORDING');
  assert.ok(f.audioInstances[1].pauseCount > pausesBeforeMic);
  f.run("cancelMobileVoiceRecording('')");
  assert.equal(trackStopped, true);
});

test('Safari MP4 recording avoids fragmented timeslices and exposes only safe STT errors', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()');
  let safariStartArgument = 'not-started';
  class SafariRecorder extends EventTarget {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(stream, options = {}) { super(); this.stream = stream; this.mimeType = options.mimeType || 'audio/mp4'; this.state = 'inactive'; }
    start(...args) { safariStartArgument = args.length ? args[0] : null; this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  let trackStopped = false;
  f.context.MediaRecorder = SafariRecorder;
  f.context.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { trackStopped = true; } }] }) };
  await f.run('startMobileVoiceRecording()');
  assert.equal(f.run('supportedMobileVoiceMimeType()'), 'audio/mp4');
  assert.equal(safariStartArgument, null);
  assert.equal(f.run("mobileVoiceRecorderTimeslice('')"), null);
  assert.equal(f.run("mobileVoiceRecorderTimeslice('audio/webm;codecs=opus')"), 250);
  assert.equal(f.run("mobileVoiceFilename('video/mp4;codecs=mp4a.40.2')"), 'mira-recording.m4a');
  f.run("cancelMobileVoiceRecording('')");
  assert.equal(trackStopped, true);
  assert.equal(f.run("mobileTranscriptionErrorMessage('unsupported_audio_format')"), 'この端末の録音形式を処理できませんでした。Safariを最新にするか、テキストで質問してください。');
  assert.equal(f.run("mobileTranscriptionErrorMessage('invalid_audio')"), '録音データが正しくありません。もう一度お試しください。');
  assert.equal(f.run("mobileTranscriptionErrorMessage('transcription_failed')"), '音声を文字にできませんでした。テキストで質問してください。');
});

test('TTS failure preserves the successful text response and exposes only a voice error', async () => {
  const f = fixture('enabled'); await f.run('refreshMobileStatus()'); f.setSpeechMode('failure');
  await f.run("submitMobileCoachFollowup({detail:{question:'今日の一歩は？'}})");
  await new Promise(resolve => setImmediate(resolve));
  const response = f.events.find(event => event.type === 'response' && event.response?.display_text?.includes('最初の10分'));
  assert.ok(response);
  const voice = f.events.filter(event => event.type === 'voice-ui').at(-1);
  assert.equal(voice.state, 'IDLE');
  assert.equal(voice.error, '音声を再生できませんでした。テキスト回答はそのまま確認できます。');
  assert.equal(f.run('mobileState.followupResponse.coach_message').includes('最初の10分'), true);
  assert.equal(f.run('mobileFollowupRunning'), false);
});

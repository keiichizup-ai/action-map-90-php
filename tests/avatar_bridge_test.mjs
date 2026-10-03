import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AvatarBridge, projectAvatarResponse, resolveAvatarExpression } from '../assets/avatar/avatar-bridge.js';
import { MiraPresentationController, MIRA_PRESENTATION_MESSAGES } from '../assets/avatar/mira-presentation-controller.js';
import { bindMobileAvatar } from '../assets/avatar/mobile-avatar-bridge.js';

class Clock {
  next = 0; timers = new Map();
  setTimeout(callback) { const id = ++this.next; this.timers.set(id, callback); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  tick() { const pending = [...this.timers.entries()]; for (const [id, callback] of pending) { if (this.timers.delete(id)) callback(); } }
}
class Element extends EventTarget {
  constructor(document) { super(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.hidden = false; this.src = ''; this.textContent = ''; this.value = ''; }
  setAttribute(name, value) { this[name] = value; }
  append(...elements) { for (const child of elements) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() {}
  requestSubmit() { this.dispatchEvent(new Event('submit', { cancelable: true })); }
}
class Document extends EventTarget {
  hidden = false;
  createElement() { return new Element(this); }
}
class Controller {
  calls = [];
  async init(host) { this.host = host; }
  setState(value) { this.calls.push(['state', value]); }
  setExpression(value) { this.calls.push(['expression', value]); }
  setMessage(value) { this.message = value; this.calls.push(['message', value]); }
  suspend() { this.calls.push(['suspend']); }
  resume() { this.calls.push(['resume']); }
  dispose() { this.calls.push(['dispose']); }
}
async function fixture(options = {}) {
  const document = new Document(); const window = new EventTarget();
  const host = new Element(document); const controller = new Controller(); const clock = new Clock(); let warnings = 0;
  const bridge = new AvatarBridge({ createController: () => controller, clock, reducedMotion: () => false, warn: () => warnings++, ...options });
  await bridge.init(host);
  return { host, controller, clock, bridge, document, window, warnings: () => warnings };
}
function emit(target, type, properties = {}) {
  const event = new Event(type); for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}

test('all six approved lossless WebP assets use exact names and 1086x1448 framing', () => {
  for (const expression of ['neutral', 'thinking', 'encourage', 'empathy', 'smile', 'celebrate']) {
    const data = fs.readFileSync(new URL(`../assets/avatar/mira/mira-${expression}.webp`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString(), 'RIFF');
    assert.equal(data.subarray(8, 12).toString(), 'WEBP');
    assert.equal(data.subarray(12, 16).toString(), 'VP8L');
    assert.equal(data[20], 0x2f);
    const dimensions = data.readUInt32LE(21);
    assert.equal((dimensions & 0x3fff) + 1, 1086);
    assert.equal(((dimensions >>> 14) & 0x3fff) + 1, 1448);
  }
});

test('init READY, IDLE, neutral; all five states and unknown state', async () => {
  const f = await fixture(); assert.equal(f.bridge.lifecycle, 'READY'); assert.equal(f.host.hidden, false);
  for (const state of ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING']) { f.bridge.setState(state); assert.equal(f.bridge.state, state); }
  f.bridge.setState('<script>'); assert.equal(f.bridge.state, 'IDLE'); f.bridge.dispose();
});
test('question mapping and behavior priority follow Presentation MVP rules', async () => {
  const f = await fixture();
  for (const [type, expression] of Object.entries({ WHY: 'thinking', OBSTACLE: 'empathy', NEXT_STEP: 'neutral', START_SMALL: 'encourage', SUCCESS: 'celebrate' })) {
    f.bridge.applyCoachResponse({ question_type: type });
    assert.equal(f.bridge.expression, expression); assert.equal(f.bridge.state, 'IDLE');
  }
  assert.equal(resolveAvatarExpression({ question_type: 'SUCCESS', behavior_signals: ['POSSIBLE_OVERLOAD'] }), 'celebrate');
  assert.equal(resolveAvatarExpression({ question_type: 'START_SMALL', behavior_signals: ['REPEATED_POSTPONEMENT'] }), 'empathy');
  assert.equal(resolveAvatarExpression({ question_type: 'WHY', behavior_signals: ['GOOD_MOMENTUM'] }), 'smile');
  assert.equal(resolveAvatarExpression({ question_type: 'NEXT_STEP', behavior_signals: ['LOW_COMPLETION'] }), 'encourage');
  f.bridge.dispose();
});
test('state mapping is deterministic while restored response may remain visible at IDLE', async () => {
  const f = await fixture();
  f.bridge.setState('LISTENING'); assert.equal(f.bridge.expression, 'neutral');
  f.bridge.setState('THINKING'); assert.equal(f.bridge.expression, 'thinking');
  f.bridge.setState('IDLE');
  f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'restore' });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'celebrate');
  f.bridge.dispose();
});
test('unknown/prototype key/null => neutral, never replay', async () => {
  const f = await fixture();
  for (const response of [null, {}, { question_type: 'COMMITMENT' }, { question_type: '__proto__' }, { question_type: '<img>' }]) {
    f.bridge.applyCoachResponse(response); assert.equal(f.bridge.expression, 'neutral'); assert.equal(f.clock.timers.size, 0);
  }
  f.bridge.setExpression('unknown'); assert.equal(f.bridge.expression, 'neutral'); f.bridge.dispose();
});
test('restore/reload has no transient speaking states or timers', async () => {
  const f = await fixture(); f.controller.calls = [];
  f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'restore' });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.clock.timers.size, 0);
  assert.equal(f.controller.calls.some(call => call[1] === 'SPEAKING'), false); f.bridge.dispose();
});
test('follow-up failure snapshot restores exact stable presentation without replay', async () => {
  const f = await fixture();
  f.bridge.applyCoachResponse({ question_type: 'SUCCESS', display_text: '達成した回答' }, { source: 'restore' });
  const snapshot = f.bridge.capturePresentationSnapshot();
  f.bridge.setState('THINKING');
  assert.equal(f.bridge.state, 'THINKING'); assert.equal(f.bridge.expression, 'thinking');
  f.controller.calls = [];
  assert.equal(f.bridge.restorePresentationSnapshot(snapshot), true);
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'celebrate');
  assert.equal(f.bridge.message, '達成した回答'); assert.equal(f.controller.message, '達成した回答');
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.controller.calls.some(call => ['SPEAKING', 'ENCOURAGING'].includes(call[1])), false);

  f.bridge.applyCoachResponse({ question_type: 'START_SMALL', display_text: '小さく始める回答' }, { source: 'restore' });
  const encourage = f.bridge.capturePresentationSnapshot();
  f.bridge.setState('THINKING'); f.bridge.restorePresentationSnapshot(encourage);
  assert.equal(f.bridge.expression, 'encourage'); assert.equal(f.controller.message, '小さく始める回答');
  f.bridge.dispose();
});
test('new response SPEAKING => ENCOURAGING => IDLE; next step skips encouraging', async () => {
  const f = await fixture();
  for (const type of ['START_SMALL', 'SUCCESS', 'NEXT_STEP']) {
    f.bridge.applyCoachResponse({ question_type: type }, { source: 'new' }); assert.equal(f.bridge.state, 'SPEAKING');
    f.clock.tick(); assert.equal(f.bridge.state, type === 'NEXT_STEP' ? 'IDLE' : 'ENCOURAGING');
    f.clock.tick(); assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.clock.timers.size, 0);
  }
  f.bridge.dispose();
});
test('passive refresh cannot interrupt save/new response; explicit screen resets', async () => {
  const f = await fixture(); f.bridge.setState('THINKING');
  f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }); assert.equal(f.bridge.state, 'THINKING');
  f.bridge.applyCoachResponse({ question_type: 'WHY' }, { source: 'new' });
  f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }); assert.equal(f.bridge.expression, 'thinking');
  f.bridge.setState('IDLE'); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }); assert.equal(f.bridge.expression, 'celebrate'); f.bridge.dispose();
});
test('newer response cancels old timer', async () => {
  const f = await fixture(); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' });
  f.bridge.applyCoachResponse({ question_type: 'WHY' }, { source: 'new' }); assert.equal(f.clock.timers.size, 1);
  f.clock.tick(); assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'thinking'); f.bridge.dispose();
});
test('reduced motion suppresses transient animation', async () => {
  const f = await fixture({ reducedMotion: () => true }); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.clock.timers.size, 0); assert.equal(f.bridge.expression, 'celebrate'); f.bridge.dispose();
});
test('privacy projection strips full response, HTML, identity and unknown metadata', async () => {
  const raw = { question_type: 'OBSTACLE', behavior_signals: ['LOW_COMPLETION', 'LOW_COMPLETION', '<svg>', { email: 'secret' }], intervention_type: 'REPLAN',
    email: 'private', user_id: 123, coach_message: '<img src=x>', tasks: ['private'], reflection: 'private', api_key: 'private' };
  assert.deepEqual(projectAvatarResponse(raw), { question_type: 'OBSTACLE', behavior_signals: ['LOW_COMPLETION'], intervention_type: 'REPLAN', display_text: '' });
  const f = await fixture(); f.bridge.applyCoachResponse(raw); assert.equal(JSON.stringify(f.controller.calls).includes('private'), false); f.bridge.dispose();
});
test('controller init failure hides only host, sanitized warning', async () => {
  let warning = 0; const host = new Element(new Document());
  const bridge = new AvatarBridge({ createController: () => ({ init() { throw new Error('private'); }, dispose() {} }), warn: () => warning++ });
  assert.equal(await bridge.init(host), false); assert.equal(bridge.lifecycle, 'FAILED'); assert.equal(host.hidden, true); assert.equal(warning, 1); bridge.dispose();
});
test('controller method/cleanup exceptions do not escape, clear timers', async () => {
  const f = await fixture(); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' });
  f.controller.setExpression = () => { throw new Error('failure'); }; f.controller.dispose = () => { throw new Error('cleanup'); };
  assert.doesNotThrow(() => f.bridge.setExpression('smile')); assert.equal(f.bridge.lifecycle, 'FAILED'); assert.equal(f.host.hidden, true);
  assert.equal(f.clock.timers.size, 0); assert.equal(f.warnings(), 1); assert.doesNotThrow(() => f.bridge.dispose());
});
test('double init does not duplicate or hide an existing initialized host', async () => {
  const f = await fixture(); assert.equal(await f.bridge.init(f.host), false);
  const other = new AvatarBridge({ createController: () => new Controller() }); assert.equal(await other.init(f.host), false); assert.equal(f.host.hidden, false);
  f.bridge.dispose(); assert.equal(await other.init(f.host), true); other.dispose();
});
test('dispose releases timers/ownership and is terminal; pending init cannot resurrect', async () => {
  const f = await fixture(); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' }); f.bridge.dispose(); f.bridge.dispose();
  f.clock.tick(); assert.equal(f.host.hidden, true); assert.equal(f.clock.timers.size, 0); assert.equal(await f.bridge.init(f.host), false);
  let resolve; const controller = new Controller(); controller.init = () => new Promise(done => resolve = done);
  const late = new AvatarBridge({ createController: () => controller }); const pending = late.init(new Element(new Document())); late.dispose(); resolve();
  assert.equal(await pending, false); assert.equal(late.host.hidden, true);
});
test('Presentation controller uses safe DOM/copy and falls back to neutral then hides only missing artwork', async () => {
  const host = new Element(new Document()); const mira = new MiraPresentationController(); await mira.init(host);
  assert.equal(host.children.length, 2);
  for (const expression of ['neutral', 'thinking', 'encourage', 'empathy', 'smile', 'celebrate']) {
    mira.setExpression(expression); assert.equal(mira.expression, expression); assert.equal(mira.bubble.textContent, MIRA_PRESENTATION_MESSAGES[expression]);
  }
  mira.setExpression('<script>'); assert.equal(mira.expression, 'neutral');
  mira.setMessage('実際のAIコーチ回答です。'); assert.equal(mira.bubble.textContent, '実際のAIコーチ回答です。');
  mira.setState('THINKING'); assert.equal(mira.bubble.textContent, MIRA_PRESENTATION_MESSAGES.thinking);
  let question = '';
  host.addEventListener('mobile-coach-followup-submit', event => question = event.detail.question);
  mira.followupToggle.dispatchEvent(new Event('click'));
  assert.equal(mira.followupPanel.hidden, false);
  mira.followupInput.value = '今日はどこまで進める？';
  mira.followupForm.requestSubmit();
  assert.equal(question, '今日はどこまで進める？');
  assert.equal(mira.followupSend.disabled, true);
  mira.setFollowupStatus({ busy: false, error: '', clear: true });
  assert.equal(mira.followupInput.value, '');
  mira.setExpression('empathy'); const empathyUrl = mira.image.src; mira.image.onerror();
  assert.notEqual(mira.image.src, empathyUrl); assert.ok(mira.image.src.includes('mira-neutral.webp'));
  mira.image.onerror(); assert.equal(mira.visual.hidden, true); assert.equal(mira.card.dataset.imageStatus, 'missing');
  mira.suspend(); assert.equal(mira.lifecycle, 'SUSPENDED'); mira.resume();
  await assert.rejects(mira.init(host)); mira.dispose(); mira.dispose(); assert.equal(host.children.length, 0);
});
test('Presentation voice controls expose record, replay, stop, transcript and isolated errors', async () => {
  const host = new Element(new Document()); const mira = new MiraPresentationController(); await mira.init(host);
  const actions = [];
  for (const type of ['mobile-coach-voice-toggle', 'mobile-coach-voice-replay', 'mobile-coach-voice-stop']) {
    host.addEventListener(type, () => actions.push(type));
  }
  mira.voiceRecord.dispatchEvent(new Event('click'));
  mira.setVoiceStatus({ state: 'RECORDING' });
  assert.equal(mira.voiceRecord.textContent, '⏹ 録音を停止');
  mira.voiceRecord.dispatchEvent(new Event('click'));
  mira.setVoiceStatus({ state: 'IDLE', canReplay: true, transcript: '明日は最初のタスクを進めます。' });
  assert.equal(mira.followupInput.value, '明日は最初のタスクを進めます。');
  assert.equal(mira.voiceControls.hidden, false);
  mira.voiceReplay.dispatchEvent(new Event('click')); mira.voiceStop.dispatchEvent(new Event('click'));
  assert.deepEqual(actions, ['mobile-coach-voice-toggle', 'mobile-coach-voice-toggle', 'mobile-coach-voice-replay', 'mobile-coach-voice-stop']);
  mira.setVoiceStatus({ state: 'SPEAKING', error: '' });
  assert.equal(mira.voiceStop.disabled, false); assert.equal(mira.voiceReplay.disabled, true);
  mira.setVoiceStatus({ state: 'IDLE', error: '音声だけ失敗しました。', canReplay: true });
  assert.equal(mira.voiceError.textContent, '音声だけ失敗しました。');
  mira.setFollowupStatus({ busy: true }); assert.equal(mira.voiceRecord.disabled, true);
  mira.setFollowupStatus({ busy: false }); assert.equal(mira.voiceRecord.disabled, false);
  mira.dispose();
});
test('Mobile adapter focus/save/visibility/BFCache no replay; disable hides', async () => {
  const f = await fixture(); const adapter = bindMobileAvatar(f);
  const notify = (type, response = null, animate = false) => emit(f.document, 'mobile-coach-avatar', { detail: { type, response, animate } });
  notify('enable'); emit(f.document, 'focusin', { target: { closest: () => true } }); assert.equal(f.bridge.state, 'LISTENING');
  notify('thinking'); emit(f.document, 'focusout', { target: { closest: () => true } }); assert.equal(f.bridge.state, 'THINKING');
  notify('response', { question_type: 'START_SMALL' }, true); assert.equal(f.bridge.state, 'SPEAKING');
  notify('history', { question_type: 'START_SMALL' }); assert.equal(f.bridge.lifecycle, 'SUSPENDED'); assert.equal(f.clock.timers.size, 0);
  notify('screen', { question_type: 'START_SMALL' }); assert.equal(f.bridge.lifecycle, 'READY'); assert.equal(f.bridge.state, 'IDLE');
  f.document.hidden = true; emit(f.document, 'visibilitychange'); assert.equal(f.bridge.lifecycle, 'SUSPENDED'); assert.equal(f.clock.timers.size, 0);
  f.document.hidden = false; emit(f.document, 'visibilitychange'); assert.equal(f.bridge.lifecycle, 'READY'); assert.equal(f.bridge.state, 'IDLE');
  emit(f.window, 'pagehide', { persisted: true }); emit(f.window, 'pageshow'); assert.equal(f.clock.timers.size, 0);
  notify('disable'); assert.equal(f.host.hidden, true); notify('enable'); assert.equal(f.host.hidden, false);
  emit(f.window, 'pagehide', { persisted: false }); notify('response', { question_type: 'SUCCESS' }, true); assert.equal(f.bridge.disposed, true); adapter.dispose();
});
test('Mobile adapter restores pre-follow-up bubble, state and expression after failure', async () => {
  const f = await fixture(); const adapter = bindMobileAvatar(f);
  const notify = (type, response = null, animate = false) => emit(f.document, 'mobile-coach-avatar', { detail: { type, response, animate } });
  notify('enable');
  notify('restore', { question_type: 'START_SMALL', display_text: '前の有効な回答' });
  notify('followup-start');
  assert.equal(f.bridge.state, 'THINKING'); assert.equal(f.controller.message, '前の有効な回答');
  notify('followup-restore');
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'encourage');
  assert.equal(f.controller.message, '前の有効な回答'); assert.equal(f.clock.timers.size, 0);
  f.bridge.setState('THINKING'); notify('followup-restore');
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'encourage');
  assert.equal(f.controller.message, '前の有効な回答');
  adapter.dispose();
});
test('Mobile adapter maps recording/transcribing/speech without replaying Coach animations', async () => {
  const f = await fixture(); const adapter = bindMobileAvatar(f);
  const notify = type => emit(f.document, 'mobile-coach-avatar', { detail: { type } });
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'enable' } });
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'restore', response: { question_type: 'START_SMALL', display_text: '前の回答' } } });
  notify('voice-recording'); assert.equal(f.bridge.state, 'LISTENING');
  notify('voice-transcribing'); assert.equal(f.bridge.state, 'THINKING');
  notify('voice-idle'); assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'encourage');
  notify('speech-start'); assert.equal(f.bridge.state, 'SPEAKING'); assert.equal(f.bridge.expression, 'encourage');
  notify('speech-end'); assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'encourage');
  assert.equal(f.clock.timers.size, 0);
  adapter.dispose();
});
test('follow-up text exits THINKING before audio and SPEAKING belongs only to playback', async () => {
  const f = await fixture(); const adapter = bindMobileAvatar(f);
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'enable' } });
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'followup-start' } });
  assert.equal(f.bridge.state, 'THINKING');
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'response', animate: false,
    response: { question_type: 'START_SMALL', display_text: 'まず10分だけ始めましょう。' } } });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'encourage');
  assert.equal(f.controller.message, 'まず10分だけ始めましょう。'); assert.equal(f.clock.timers.size, 0);
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'speech-start' } });
  assert.equal(f.bridge.state, 'SPEAKING');
  emit(f.document, 'mobile-coach-avatar', { detail: { type: 'speech-end' } });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.controller.message, 'まず10分だけ始めましょう。');
  adapter.dispose();
});
test('adapter isolates a deliberately throwing bridge from notifications', () => {
  const document = new Document(); const window = new EventTarget(); const host = new Element(document); let cleanup = 0;
  const bridge = { resume() { throw new Error('failure'); }, dispose() { cleanup++; } };
  const adapter = bindMobileAvatar({ bridge, host, document, window });
  assert.doesNotThrow(() => emit(document, 'mobile-coach-avatar', { detail: { type: 'enable' } })); assert.equal(host.hidden, true); assert.equal(cleanup, 1); adapter.dispose();
});

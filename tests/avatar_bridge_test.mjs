import test from 'node:test';
import assert from 'node:assert/strict';
import { AvatarBridge, projectAvatarResponse } from '../assets/avatar/avatar-bridge.js';
import { DummyAvatarController } from '../assets/avatar/dummy-avatar-controller.js';
import { bindMobileAvatar } from '../assets/avatar/mobile-avatar-bridge.js';

class Clock {
  next = 0; timers = new Map();
  setTimeout(callback) { const id = ++this.next; this.timers.set(id, callback); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  tick() { const pending = [...this.timers.entries()]; for (const [id, callback] of pending) { if (this.timers.delete(id)) callback(); } }
}
class Element {
  constructor(document) { this.ownerDocument = document; this.children = []; this.dataset = {}; this.hidden = true; }
  setAttribute() {}
  append(...elements) { for (const child of elements) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
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

test('init READY, IDLE, neutral; all five states and unknown state', async () => {
  const f = await fixture(); assert.equal(f.bridge.lifecycle, 'READY'); assert.equal(f.host.hidden, false);
  for (const state of ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING']) { f.bridge.setState(state); assert.equal(f.bridge.state, state); }
  f.bridge.setState('<script>'); assert.equal(f.bridge.state, 'IDLE'); f.bridge.dispose();
});
test('all question mappings; signal cannot contradict question', async () => {
  const f = await fixture();
  for (const [type, expression] of Object.entries({ WHY: 'thinking', OBSTACLE: 'empathy', NEXT_STEP: 'neutral', START_SMALL: 'encourage', SUCCESS: 'smile' })) {
    f.bridge.applyCoachResponse({ question_type: type, behavior_signals: ['POSSIBLE_OVERLOAD', 'REPEATED_POSTPONEMENT'] });
    assert.equal(f.bridge.expression, expression); assert.equal(f.bridge.state, 'IDLE');
  }
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
  f.bridge.setState('IDLE'); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }); assert.equal(f.bridge.expression, 'smile'); f.bridge.dispose();
});
test('newer response cancels old timer', async () => {
  const f = await fixture(); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' });
  f.bridge.applyCoachResponse({ question_type: 'WHY' }, { source: 'new' }); assert.equal(f.clock.timers.size, 1);
  f.clock.tick(); assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.bridge.expression, 'thinking'); f.bridge.dispose();
});
test('reduced motion suppresses transient animation', async () => {
  const f = await fixture({ reducedMotion: () => true }); f.bridge.applyCoachResponse({ question_type: 'SUCCESS' }, { source: 'new' });
  assert.equal(f.bridge.state, 'IDLE'); assert.equal(f.clock.timers.size, 0); assert.equal(f.bridge.expression, 'smile'); f.bridge.dispose();
});
test('privacy projection strips full response, HTML, identity and unknown metadata', async () => {
  const raw = { question_type: 'OBSTACLE', behavior_signals: ['LOW_COMPLETION', 'LOW_COMPLETION', '<svg>', { email: 'secret' }], intervention_type: 'REPLAN',
    email: 'private', user_id: 123, coach_message: '<img src=x>', tasks: ['private'], reflection: 'private', api_key: 'private' };
  assert.deepEqual(projectAvatarResponse(raw), { question_type: 'OBSTACLE', behavior_signals: ['LOW_COMPLETION'], intervention_type: 'REPLAN' });
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
test('Dummy uses safe DOM, one panel, five expressions and idempotent disposal', async () => {
  const host = new Element(new Document()); const dummy = new DummyAvatarController(); await dummy.init(host);
  assert.equal(host.children.length, 1); for (const expression of ['neutral', 'smile', 'thinking', 'empathy', 'encourage']) { dummy.setExpression(expression); assert.equal(dummy.expression, expression); }
  dummy.setExpression('<script>'); assert.equal(dummy.expression, 'neutral'); dummy.suspend(); assert.equal(dummy.lifecycle, 'SUSPENDED'); dummy.resume();
  await assert.rejects(dummy.init(host)); dummy.dispose(); dummy.dispose(); assert.equal(host.children.length, 0);
});
test('Mobile adapter focus/save/visibility/BFCache no replay; disable hides', async () => {
  const f = await fixture(); const adapter = bindMobileAvatar(f);
  const notify = (type, response = null, animate = false) => emit(f.document, 'mobile-coach-avatar', { detail: { type, response, animate } });
  notify('enable'); emit(f.document, 'focusin', { target: { closest: () => true } }); assert.equal(f.bridge.state, 'LISTENING');
  notify('thinking'); emit(f.document, 'focusout', { target: { closest: () => true } }); assert.equal(f.bridge.state, 'THINKING');
  notify('response', { question_type: 'START_SMALL' }, true); assert.equal(f.bridge.state, 'SPEAKING');
  f.document.hidden = true; emit(f.document, 'visibilitychange'); assert.equal(f.bridge.lifecycle, 'SUSPENDED'); assert.equal(f.clock.timers.size, 0);
  f.document.hidden = false; emit(f.document, 'visibilitychange'); assert.equal(f.bridge.lifecycle, 'READY'); assert.equal(f.bridge.state, 'IDLE');
  emit(f.window, 'pagehide', { persisted: true }); emit(f.window, 'pageshow'); assert.equal(f.clock.timers.size, 0);
  notify('disable'); assert.equal(f.host.hidden, true); notify('enable'); assert.equal(f.host.hidden, false);
  emit(f.window, 'pagehide', { persisted: false }); notify('response', { question_type: 'SUCCESS' }, true); assert.equal(f.bridge.disposed, true); adapter.dispose();
});
test('adapter isolates a deliberately throwing bridge from notifications', () => {
  const document = new Document(); const window = new EventTarget(); const host = new Element(document); let cleanup = 0;
  const bridge = { resume() { throw new Error('failure'); }, dispose() { cleanup++; } };
  const adapter = bindMobileAvatar({ bridge, host, document, window });
  assert.doesNotThrow(() => emit(document, 'mobile-coach-avatar', { detail: { type: 'enable' } })); assert.equal(host.hidden, true); assert.equal(cleanup, 1); adapter.dispose();
});

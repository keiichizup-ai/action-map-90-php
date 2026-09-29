export const AVATAR_STATES = Object.freeze(['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING']);
export const AVATAR_EXPRESSIONS = Object.freeze(['neutral', 'thinking', 'encourage', 'empathy', 'smile', 'celebrate']);

const QUESTIONS = Object.freeze({
  WHY: 'thinking',
  OBSTACLE: 'empathy',
  NEXT_STEP: 'neutral',
  START_SMALL: 'encourage',
  SUCCESS: 'celebrate'
});
const SIGNALS = Object.freeze(['GOOD_MOMENTUM', 'REPEATED_POSTPONEMENT', 'LOW_COMPLETION', 'POSSIBLE_OVERLOAD']);
const INTERVENTIONS = Object.freeze(['REDUCE_FRICTION', 'NARROW_FOCUS', 'REPLAN', 'REINFORCE', 'START_NEXT']);
const hosts = new WeakMap();

function presentationText(value) {
  if (typeof value !== 'string' || /<[^>]*>|```/u.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

export function projectAvatarResponse(response) {
  return {
    question_type: Object.hasOwn(QUESTIONS, response?.question_type) ? response.question_type : null,
    behavior_signals: Array.isArray(response?.behavior_signals)
      ? [...new Set(response.behavior_signals.filter(signal => SIGNALS.includes(signal)))].slice(0, 4) : [],
    intervention_type: INTERVENTIONS.includes(response?.intervention_type) ? response.intervention_type : null,
    display_text: presentationText(response?.display_text)
  };
}

// The server owns coaching decisions; this is only the deterministic visual projection.
export function resolveAvatarExpression(response) {
  const metadata = projectAvatarResponse(response);
  const signals = new Set(metadata.behavior_signals);
  if (metadata.question_type === 'SUCCESS') return 'celebrate';
  if (signals.has('REPEATED_POSTPONEMENT') || signals.has('POSSIBLE_OVERLOAD')) return 'empathy';
  if (metadata.question_type === 'OBSTACLE') return 'empathy';
  if (metadata.question_type === 'START_SMALL') return 'encourage';
  if (signals.has('LOW_COMPLETION')) return 'encourage';
  if (signals.has('GOOD_MOMENTUM')) return 'smile';
  return QUESTIONS[metadata.question_type] || 'neutral';
}

function encouragingExpression(expression) {
  return ['celebrate', 'smile'].includes(expression) ? expression : 'encourage';
}

// Controller injection keeps this layer independent of Presentation Mira and Cubism.
export class AvatarBridge {
  constructor({ createController, clock = globalThis, reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
    warn = () => console.warn('Avatar unavailable; Text Coach continues.') } = {}) {
    this.createController = createController;
    this.clock = clock;
    this.reducedMotion = reducedMotion;
    this.warn = warn;
    this.lifecycle = 'LOADING';
    this.state = 'IDLE';
    this.expression = 'neutral';
    this.responseExpression = 'neutral';
    this.message = '';
    this.timers = new Set();
    this.disposed = false;
    this.busy = false;
  }

  async init(host) {
    if (this.host || this.disposed || !host || hosts.has(host)) return false;
    this.host = host;
    hosts.set(host, this);
    host.hidden = true;
    try {
      this.controller = this.createController();
      await this.controller.init(host);
      if (this.disposed) { this.controller.dispose(); return false; }
      this.lifecycle = 'READY';
      this.setExpression('neutral');
      this.setState('IDLE', { preserveExpression: true });
      if (this.lifecycle === 'FAILED') return false;
      host.hidden = false;
      return true;
    } catch (_) { this.fail(); return false; }
  }

  invoke(method, ...args) {
    if (this.disposed || !['READY', 'SUSPENDED'].includes(this.lifecycle)) return false;
    try { this.controller[method](...args); return true; }
    catch (_) { this.fail(); return false; }
  }

  fail() {
    this.clearTimers();
    this.busy = false;
    this.lifecycle = 'FAILED';
    if (this.host) this.host.hidden = true;
    try { this.controller?.dispose(); } catch (_) { /* Isolate cleanup failure. */ }
    try { this.warn(); } catch (_) { /* Logging is optional. */ }
  }

  clearTimers() {
    for (const timer of this.timers) this.clock.clearTimeout(timer);
    this.timers.clear();
  }

  later(callback, milliseconds) {
    const timer = this.clock.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed && this.lifecycle === 'READY') callback();
    }, milliseconds);
    this.timers.add(timer);
  }

  setState(state, { preserveExpression = false } = {}) {
    this.clearTimers();
    const next = AVATAR_STATES.includes(state) ? state : 'IDLE';
    this.busy = next === 'THINKING';
    if (!preserveExpression) {
      if (next === 'THINKING') this.setExpression('thinking');
      else if (['IDLE', 'LISTENING'].includes(next)) this.setExpression('neutral');
      else if (next === 'ENCOURAGING') this.setExpression(encouragingExpression(this.responseExpression));
    }
    if (this.invoke('setState', next)) this.state = next;
  }

  setExpression(expression) {
    const next = AVATAR_EXPRESSIONS.includes(expression) ? expression : 'neutral';
    if (this.invoke('setExpression', next)) this.expression = next;
  }

  setMessage(message) {
    this.message = presentationText(message);
    if (typeof this.controller?.setMessage === 'function') this.invoke('setMessage', this.message);
  }

  capturePresentationSnapshot() {
    return {
      lifecycle: this.lifecycle,
      state: this.state,
      expression: this.expression,
      responseExpression: this.responseExpression,
      message: this.message
    };
  }

  restorePresentationSnapshot(snapshot) {
    if (!snapshot || this.disposed || !['READY', 'SUSPENDED'].includes(this.lifecycle)) return false;
    this.clearTimers();
    this.busy = false;
    if (snapshot.lifecycle === 'READY' && this.lifecycle === 'SUSPENDED') this.resume();
    this.responseExpression = AVATAR_EXPRESSIONS.includes(snapshot.responseExpression)
      ? snapshot.responseExpression : 'neutral';
    this.setState(AVATAR_STATES.includes(snapshot.state) ? snapshot.state : 'IDLE', { preserveExpression: true });
    this.setExpression(AVATAR_EXPRESSIONS.includes(snapshot.expression) ? snapshot.expression : 'neutral');
    this.setMessage(snapshot.message);
    if (snapshot.lifecycle === 'SUSPENDED' && this.lifecycle === 'READY') this.suspend();
    return this.lifecycle !== 'FAILED';
  }

  applyCoachResponse(response, { source = 'restore' } = {}) {
    if (source === 'restore' && (this.busy || this.timers.size)) return;
    this.clearTimers();
    this.busy = false;
    const metadata = projectAvatarResponse(response);
    this.responseExpression = resolveAvatarExpression(response);
    this.shouldEncourage = ['START_SMALL', 'SUCCESS'].includes(metadata.question_type)
      || metadata.behavior_signals.some(signal => ['GOOD_MOMENTUM', 'LOW_COMPLETION'].includes(signal));
    this.setExpression(this.responseExpression);
    // Message presentation is an optional controller capability so a future
    // Live2D controller can adopt it without breaking older controllers.
    this.setMessage(metadata.display_text);
    if (source !== 'new' || this.lifecycle !== 'READY' || this.reducedMotion()) {
      this.setState('IDLE', { preserveExpression: true });
      return;
    }
    this.setState('SPEAKING', { preserveExpression: true });
    this.later(() => {
      if (this.shouldEncourage) {
        this.setState('ENCOURAGING');
        this.later(() => this.setState('IDLE', { preserveExpression: true }), 1000);
      } else this.setState('IDLE', { preserveExpression: true });
    }, 1500);
  }

  suspend() {
    this.clearTimers();
    this.busy = false;
    this.setState('IDLE', { preserveExpression: true });
    if (this.invoke('suspend')) this.lifecycle = 'SUSPENDED';
  }

  resume() {
    if (this.invoke('resume')) this.lifecycle = 'READY';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    try { this.controller?.dispose(); } catch (_) { /* Optional resource cleanup. */ }
    if (this.host) { this.host.hidden = true; hosts.delete(this.host); }
    this.lifecycle = 'SUSPENDED';
    this.busy = false;
  }
}

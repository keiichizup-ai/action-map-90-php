export const AVATAR_STATES = Object.freeze(['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING']);
export const AVATAR_EXPRESSIONS = Object.freeze(['neutral', 'smile', 'thinking', 'empathy', 'encourage']);
const QUESTIONS = Object.freeze({ WHY: 'thinking', OBSTACLE: 'empathy', NEXT_STEP: 'neutral', START_SMALL: 'encourage', SUCCESS: 'smile' });
const SIGNALS = ['GOOD_MOMENTUM', 'REPEATED_POSTPONEMENT', 'LOW_COMPLETION', 'POSSIBLE_OVERLOAD'];
const INTERVENTIONS = ['REDUCE_FRICTION', 'NARROW_FOCUS', 'REPLAN', 'REINFORCE', 'START_NEXT'];
const hosts = new WeakMap();

export function projectAvatarResponse(response) {
  return {
    question_type: Object.hasOwn(QUESTIONS, response?.question_type) ? response.question_type : null,
    behavior_signals: Array.isArray(response?.behavior_signals)
      ? [...new Set(response.behavior_signals.filter(signal => SIGNALS.includes(signal)))].slice(0, 4) : [],
    intervention_type: INTERVENTIONS.includes(response?.intervention_type) ? response.intervention_type : null
  };
}

// Controller injection keeps this layer independent of Dummy and Cubism.
// Controllers implement async init; all other methods are synchronous.
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
      this.setState('IDLE');
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
    try { this.controller?.dispose(); } catch (_) { /* Isolate controller cleanup failure. */ }
    try { this.warn(); } catch (_) { /* Even logging is optional. */ }
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

  setState(state) {
    this.clearTimers();
    this.busy = state === 'THINKING';
    const next = AVATAR_STATES.includes(state) ? state : 'IDLE';
    if (this.invoke('setState', next)) this.state = next;
  }

  setExpression(expression) {
    const next = AVATAR_EXPRESSIONS.includes(expression) ? expression : 'neutral';
    if (this.invoke('setExpression', next)) this.expression = next;
  }

  applyCoachResponse(response, { source = 'restore' } = {}) {
    // A passive refresh must not interrupt an in-flight save or a fresh response.
    if (source === 'restore' && (this.busy || this.timers.size)) return;
    this.clearTimers();
    this.busy = false;
    const metadata = projectAvatarResponse(response);
    this.setExpression(QUESTIONS[metadata.question_type] || 'neutral');
    // Signals are deliberately not expression overrides in this MVP.
    if (source !== 'new' || this.lifecycle !== 'READY' || this.reducedMotion()) {
      this.setState('IDLE');
      return;
    }
    this.setState('SPEAKING'); // Visual-only timer, not speech or audio.
    this.later(() => {
      if (['START_SMALL', 'SUCCESS'].includes(metadata.question_type)) {
        this.setState('ENCOURAGING');
        this.later(() => this.setState('IDLE'), 1000);
      } else this.setState('IDLE');
    }, 1500);
  }

  suspend() {
    this.clearTimers();
    this.busy = false;
    this.setState('IDLE');
    if (this.invoke('suspend')) this.lifecycle = 'SUSPENDED';
  }

  resume() {
    if (this.invoke('resume')) this.lifecycle = 'READY';
    // Never replay an interrupted response after returning to the page.
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

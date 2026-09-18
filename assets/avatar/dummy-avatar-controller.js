const hosts = new WeakMap();
const states = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING'];
const expressions = ['neutral', 'smile', 'thinking', 'empathy', 'encourage'];
const faces = { neutral: '◉', smile: '☺', thinking: '…', empathy: '◡', encourage: '✦' };

export class DummyAvatarController {
  async init(host) {
    if (this.host || this.disposed || hosts.has(host)) throw new Error('Dummy already initialized');
    this.host = host;
    hosts.set(host, this);
    const document = host.ownerDocument;
    this.panel = document.createElement('section');
    this.panel.className = 'dummy-avatar';
    this.panel.setAttribute('aria-label', 'Mira Dummy Avatar — local development only');
    this.title = document.createElement('strong');
    this.title.textContent = 'MIRA / Dummy — Local only';
    this.face = document.createElement('span');
    this.face.className = 'dummy-avatar-face';
    this.face.setAttribute('aria-hidden', 'true');
    this.status = document.createElement('output');
    this.panel.append(this.title, this.face, this.status);
    host.append(this.panel);
    this.lifecycle = 'READY';
    this.state = 'IDLE';
    this.expression = 'neutral';
    this.render();
  }
  render() {
    if (this.disposed || !this.panel) return;
    this.panel.dataset.state = this.state;
    this.panel.dataset.expression = this.expression;
    this.face.textContent = faces[this.expression];
    this.status.textContent = `Lifecycle: ${this.lifecycle} / State: ${this.state} / Expr: ${this.expression}`;
  }
  setState(state) { this.state = states.includes(state) ? state : 'IDLE'; this.render(); }
  setExpression(expression) { this.expression = expressions.includes(expression) ? expression : 'neutral'; this.render(); }
  suspend() { this.lifecycle = 'SUSPENDED'; this.render(); }
  resume() { this.lifecycle = 'READY'; this.render(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.panel?.remove();
    if (this.host) hosts.delete(this.host);
    this.panel = this.face = this.status = this.title = this.host = null;
  }
}

const hosts = new WeakMap();
const STATES = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ENCOURAGING'];
const EXPRESSIONS = ['neutral', 'thinking', 'encourage', 'empathy', 'smile', 'celebrate'];
const MESSAGES = Object.freeze({
  neutral: '今日も一緒に進めていきましょう。',
  thinking: 'あなたの目標と行動を整理しています…',
  encourage: 'まず10分だけ始めてみませんか？',
  empathy: '少し進みにくくなっていますね。一緒に整理しましょう。',
  smile: 'いい流れです。この調子で続けていきましょう。',
  celebrate: '達成しましたね！ここまでの積み重ねの成果です。'
});
const STATE_LABELS = Object.freeze({
  IDLE: 'そばで見守っています',
  LISTENING: 'お話を聞いています',
  THINKING: '考えています',
  SPEAKING: 'コーチング中',
  ENCOURAGING: '応援しています'
});
const VOICE_STATES = ['IDLE', 'RECORDING', 'TRANSCRIBING', 'THINKING', 'SPEAKING'];
const VOICE_LABELS = Object.freeze({
  IDLE: '',
  RECORDING: '録音中です。もう一度押すと停止します。',
  TRANSCRIBING: '音声を文字にしています…',
  THINKING: 'Miraが回答を考えています…',
  SPEAKING: 'Miraの音声を再生しています。'
});

function imageUrls() {
  const moduleUrl = new URL(import.meta.url);
  const version = /^\?v=[a-f0-9]{12}$/.test(moduleUrl.search) ? moduleUrl.search : '';
  return Object.fromEntries(EXPRESSIONS.map(expression => {
    const url = new URL(`./mira/mira-${expression}.webp`, moduleUrl);
    url.search = version;
    return [expression, url.href];
  }));
}

export class MiraPresentationController {
  async init(host) {
    if (this.host || this.disposed || !host || hosts.has(host)) throw new Error('Mira Presentation already initialized');
    this.host = host;
    hosts.set(host, this);
    const document = host.ownerDocument;

    this.card = document.createElement('section');
    this.card.className = 'mira-presentation-card';
    this.card.setAttribute('aria-label', 'AI Coach Mira');
    this.visual = document.createElement('figure');
    this.visual.className = 'mira-presentation-visual';
    this.image = document.createElement('img');
    this.image.className = 'mira-presentation-image';
    this.image.alt = 'AI Coach Mira';
    this.image.decoding = 'async';
    this.visual.append(this.image);

    this.copy = document.createElement('div');
    this.copy.className = 'mira-presentation-copy';
    this.eyebrow = document.createElement('p');
    this.eyebrow.className = 'mira-presentation-eyebrow';
    this.eyebrow.textContent = 'AI COACH';
    this.title = document.createElement('strong');
    this.title.className = 'mira-presentation-title';
    this.title.textContent = 'AI Coach Mira';
    this.bubble = document.createElement('p');
    this.bubble.className = 'mira-presentation-bubble';
    this.status = document.createElement('output');
    this.status.className = 'mira-presentation-status';
    this.status.setAttribute('aria-live', 'polite');
    this.dots = document.createElement('span');
    this.dots.className = 'mira-thinking-dots';
    this.dots.setAttribute('aria-hidden', 'true');
    this.dots.textContent = '•••';
    this.followupToggle = document.createElement('button');
    this.followupToggle.type = 'button';
    this.followupToggle.className = 'mira-followup-toggle';
    this.followupToggle.textContent = '💬 Miraに聞いてみる';
    this.followupToggle.setAttribute('aria-expanded', 'false');
    this.followupToggle.setAttribute('aria-controls', 'miraFollowupPanel');
    this.copy.append(this.eyebrow, this.title, this.bubble, this.status, this.dots, this.followupToggle);
    this.card.append(this.visual, this.copy);

    this.followupPanel = document.createElement('div');
    this.followupPanel.id = 'miraFollowupPanel';
    this.followupPanel.className = 'mira-followup-panel';
    this.followupPanel.hidden = true;
    this.followupForm = document.createElement('form');
    this.followupForm.className = 'mira-followup-form';
    this.followupLabel = document.createElement('label');
    this.followupLabel.setAttribute('for', 'miraFollowupQuestion');
    this.followupLabel.textContent = 'Miraへの追加質問';
    this.followupInput = document.createElement('textarea');
    this.followupInput.id = 'miraFollowupQuestion';
    this.followupInput.name = 'question';
    this.followupInput.rows = 2;
    this.followupInput.maxLength = 500;
    this.followupInput.placeholder = 'Miraに追加で聞きたいことを入力してください';
    this.followupInput.setAttribute('aria-label', 'Miraに追加で聞きたいこと');
    this.followupSend = document.createElement('button');
    this.followupSend.type = 'submit';
    this.followupSend.className = 'mira-followup-send';
    this.followupSend.textContent = '送信';
    this.voiceRecord = document.createElement('button');
    this.voiceRecord.type = 'button';
    this.voiceRecord.className = 'mira-voice-record';
    this.voiceRecord.textContent = '🎤 Miraに話す';
    this.voiceRecord.setAttribute('aria-pressed', 'false');
    this.followupError = document.createElement('p');
    this.followupError.className = 'mira-followup-error';
    this.followupError.setAttribute('role', 'alert');
    this.followupForm.append(this.followupLabel, this.followupInput, this.voiceRecord, this.followupSend, this.followupError);
    this.voiceControls = document.createElement('div');
    this.voiceControls.className = 'mira-voice-controls';
    this.voiceReplay = document.createElement('button');
    this.voiceReplay.type = 'button';
    this.voiceReplay.className = 'mira-voice-replay';
    this.voiceReplay.textContent = '🔊 もう一度聞く';
    this.voiceStop = document.createElement('button');
    this.voiceStop.type = 'button';
    this.voiceStop.className = 'mira-voice-stop';
    this.voiceStop.textContent = '⏹ 停止';
    this.voiceControls.append(this.voiceReplay, this.voiceStop);
    this.voiceControls.hidden = true;
    this.voiceStatus = document.createElement('p');
    this.voiceStatus.className = 'mira-voice-status';
    this.voiceStatus.setAttribute('aria-live', 'polite');
    this.voiceError = document.createElement('p');
    this.voiceError.className = 'mira-voice-error';
    this.voiceError.setAttribute('role', 'alert');
    this.followupPanel.append(this.followupForm, this.voiceControls, this.voiceStatus, this.voiceError);
    host.append(this.card, this.followupPanel);

    this.onFollowupToggle = () => {
      const open = this.followupPanel.hidden;
      this.followupPanel.hidden = !open;
      this.followupToggle.setAttribute('aria-expanded', String(open));
      if (open) this.followupInput.focus();
    };
    this.onFollowupSubmit = event => {
      event.preventDefault();
      if (this.followupBusy) return;
      const question = this.followupInput.value.trim();
      if (!question) return;
      this.setFollowupStatus({ busy: true, error: '' });
      host.dispatchEvent(new CustomEvent('mobile-coach-followup-submit', {
        bubbles: true,
        detail: { question: question.slice(0, 500) }
      }));
    };
    this.onFollowupKeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.followupForm.requestSubmit();
      }
    };
    this.onVoiceRecord = () => {
      if (this.voiceRecord.disabled) return;
      host.dispatchEvent(new CustomEvent('mobile-coach-voice-toggle', { bubbles: true }));
    };
    this.onVoiceReplay = () => host.dispatchEvent(new CustomEvent('mobile-coach-voice-replay', { bubbles: true }));
    this.onVoiceStop = () => host.dispatchEvent(new CustomEvent('mobile-coach-voice-stop', { bubbles: true }));
    this.followupToggle.addEventListener('click', this.onFollowupToggle);
    this.followupForm.addEventListener('submit', this.onFollowupSubmit);
    this.followupInput.addEventListener('keydown', this.onFollowupKeydown);
    this.voiceRecord.addEventListener('click', this.onVoiceRecord);
    this.voiceReplay.addEventListener('click', this.onVoiceReplay);
    this.voiceStop.addEventListener('click', this.onVoiceStop);

    this.urls = imageUrls();
    this.image.onload = () => this.handleImageLoad();
    this.image.onerror = () => this.handleImageError();
    this.lifecycle = 'READY';
    this.state = 'IDLE';
    this.expression = 'neutral';
    this.voiceState = 'IDLE';
    this.renderState();
    this.renderExpression(true);
  }

  renderState() {
    if (!this.card || this.disposed) return;
    this.card.dataset.lifecycle = this.lifecycle;
    this.card.dataset.state = this.state;
    this.status.textContent = STATE_LABELS[this.state];
    this.status.dataset.diagnostic = `Lifecycle: ${this.lifecycle} / State: ${this.state} / Expr: ${this.expression}`;
  }

  renderExpression(force = false) {
    if (!this.card || this.disposed) return;
    this.card.dataset.expression = this.expression;
    this.renderMessage();
    this.status.dataset.diagnostic = `Lifecycle: ${this.lifecycle} / State: ${this.state} / Expr: ${this.expression}`;
    const next = this.urls[this.expression];
    if (!force && this.image.src === next && !this.image.hidden) return;
    this.requestedExpression = this.expression;
    this.fallbackAttempted = false;
    this.visual.hidden = false;
    this.image.hidden = false;
    this.card.dataset.imageStatus = 'loading';
    this.image.src = next;
  }

  renderMessage() {
    if (!this.bubble || this.disposed) return;
    this.bubble.textContent = this.state === 'THINKING'
      ? MESSAGES.thinking
      : this.message || MESSAGES[this.expression];
  }

  handleImageLoad() {
    if (this.disposed) return;
    this.visual.hidden = false;
    this.image.hidden = false;
    this.card.dataset.imageStatus = this.fallbackAttempted ? 'fallback' : 'ready';
  }

  handleImageError() {
    if (this.disposed) return;
    if (this.requestedExpression !== 'neutral' && !this.fallbackAttempted) {
      this.fallbackAttempted = true;
      this.card.dataset.imageStatus = 'fallback-loading';
      this.image.src = this.urls.neutral;
      return;
    }
    this.card.dataset.imageStatus = 'missing';
    this.image.hidden = true;
    this.visual.hidden = true;
  }

  setState(state) {
    this.state = STATES.includes(state) ? state : 'IDLE';
    if (this.state === 'THINKING') this.message = '';
    this.renderMessage();
    this.renderState();
  }

  setExpression(expression) {
    this.expression = EXPRESSIONS.includes(expression) ? expression : 'neutral';
    this.renderExpression();
  }

  setMessage(message) {
    this.message = typeof message === 'string' ? message.trim().slice(0, 500) : '';
    this.renderMessage();
  }

  setFollowupStatus({ busy = false, error = '', clear = false } = {}) {
    if (!this.followupForm || this.disposed) return;
    this.followupBusy = Boolean(busy);
    this.followupInput.disabled = this.followupBusy;
    this.followupSend.disabled = this.followupBusy;
    this.followupSend.textContent = this.followupBusy ? '考えています…' : '送信';
    this.followupError.textContent = typeof error === 'string' ? error.slice(0, 120) : '';
    if (this.voiceRecord) {
      this.voiceRecord.disabled = this.followupBusy || ['TRANSCRIBING', 'THINKING'].includes(this.voiceState);
    }
    if (clear) this.followupInput.value = '';
  }

  setVoiceStatus({ state = 'IDLE', error = '', canReplay = false, transcript = '' } = {}) {
    if (!this.voiceRecord || this.disposed) return;
    this.voiceState = VOICE_STATES.includes(state) ? state : 'IDLE';
    const unavailable = ['TRANSCRIBING', 'THINKING'].includes(this.voiceState) || this.followupBusy;
    this.voiceRecord.disabled = unavailable;
    this.voiceRecord.textContent = this.voiceState === 'RECORDING' ? '⏹ 録音を停止' : '🎤 Miraに話す';
    this.voiceRecord.setAttribute('aria-pressed', String(this.voiceState === 'RECORDING'));
    this.voiceReplay.disabled = !canReplay || this.voiceState === 'SPEAKING';
    this.voiceStop.disabled = this.voiceState !== 'SPEAKING';
    this.voiceControls.hidden = !canReplay && this.voiceState !== 'SPEAKING';
    this.voiceStatus.textContent = VOICE_LABELS[this.voiceState];
    this.voiceError.textContent = typeof error === 'string' ? error.slice(0, 120) : '';
    if (typeof transcript === 'string' && transcript.trim() !== '') {
      this.followupInput.value = transcript.trim().slice(0, 500);
      this.followupInput.focus();
    }
  }

  suspend() {
    this.lifecycle = 'SUSPENDED';
    if (this.followupPanel) this.followupPanel.hidden = true;
    if (this.followupToggle) {
      this.followupToggle.disabled = true;
      this.followupToggle.setAttribute('aria-expanded', 'false');
    }
    this.renderState();
  }
  resume() {
    this.lifecycle = 'READY';
    if (this.followupToggle) this.followupToggle.disabled = false;
    this.renderState();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.image) this.image.onload = this.image.onerror = null;
    this.followupToggle?.removeEventListener('click', this.onFollowupToggle);
    this.followupForm?.removeEventListener('submit', this.onFollowupSubmit);
    this.followupInput?.removeEventListener('keydown', this.onFollowupKeydown);
    this.voiceRecord?.removeEventListener('click', this.onVoiceRecord);
    this.voiceReplay?.removeEventListener('click', this.onVoiceReplay);
    this.voiceStop?.removeEventListener('click', this.onVoiceStop);
    this.card?.remove();
    this.followupPanel?.remove();
    if (this.host) hosts.delete(this.host);
    this.message = '';
    this.card = this.visual = this.image = this.copy = this.eyebrow = this.title = this.bubble = this.status = this.dots = this.followupToggle = this.followupPanel = this.followupForm = this.followupLabel = this.followupInput = this.followupSend = this.followupError = this.voiceRecord = this.voiceControls = this.voiceReplay = this.voiceStop = this.voiceStatus = this.voiceError = this.host = null;
  }
}

export { MESSAGES as MIRA_PRESENTATION_MESSAGES };

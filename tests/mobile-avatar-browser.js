let frame = document.getElementById('coach');
const results = document.getElementById('results');
const button = document.getElementById('run');
let generation = 0;
let runs = 0;
async function waitFor(condition) {
  const deadline = performance.now() + 5000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('Fixture condition timed out');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}
async function mountCoach() {
  await frame.contentWindow?.__dummyProbe?.whenIdle();
  const oldDocument = frame.contentDocument;
  const next = document.createElement('iframe');
  next.id = 'coach'; next.title = 'Mobile Coach fixture'; next.width = '390'; next.height = '844';
  const marker = String(++generation);
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('New fixture document did not load')), 5000);
    next.addEventListener('load', () => {
      if (next.contentDocument === oldDocument || next.contentWindow.location.search !== '?fixtureGeneration=' + marker) return;
      clearTimeout(timeout); resolve();
    });
  });
  next.src = '/mobile-coach.php?fixtureGeneration=' + marker;
  frame.replaceWith(next); frame = next;
  await loaded;
  const doc = frame.contentDocument;
  await waitFor(() => doc.querySelector('.mira-presentation-status')?.dataset.diagnostic?.includes('READY')
    && doc.querySelector('.mira-presentation-card')?.dataset.imageStatus === 'ready'
    && !doc.getElementById('mobileAppView').classList.contains('hidden')
    && doc.querySelectorAll('[name="morningTask"]').length === 2);
  await frame.contentWindow.__dummyProbe.whenIdle();
  return { doc, win: frame.contentWindow };
}
button.addEventListener('click', async () => {
  button.disabled = true; results.textContent = ''; results.dataset.status = 'running';
  let count = 0;
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    results.textContent += 'PASS ' + (++count) + ': ' + label + '\n';
  };
  const probes = [];
  let adapter; let bridge;
  try {
    await frame.contentWindow?.__dummyProbe?.whenIdle();
    assert(!frame.contentWindow?.__dummyProbe?.errors.length, 'previous fixture drained without console errors');
    await fetch('/fixture/reset', { method: 'POST' });
    const { doc, win } = await mountCoach(); probes.push(win.__dummyProbe);
    const output = () => doc.querySelector('.mira-presentation-status')?.dataset.diagnostic || '';
    const card = () => doc.querySelector('.mira-presentation-card');
    const image = () => doc.querySelector('.mira-presentation-image');
    const imageName = () => new URL(image().currentSrc || image().src).pathname.split('/').pop();
    const waitForImage = async expression => {
      await waitFor(() => card()?.dataset.imageStatus === 'ready' && imageName() === `mira-${expression}.webp`
        && image().complete && image().naturalWidth === 1086 && image().naturalHeight === 1448);
    };
    const events = [];
    doc.addEventListener('mobile-coach-avatar', event => events.push(event.detail));
    const notify = (type, response, animate = false) => doc.dispatchEvent(new win.CustomEvent('mobile-coach-avatar', { detail: { type, response, animate } }));
    assert(doc.querySelectorAll('.mira-presentation-card').length === 1 && doc.querySelectorAll('canvas').length === 0, 'one Mira card, zero Canvas');
    assert(getComputedStyle(doc.getElementById('mobileMiraPresentation')).position === 'sticky', 'Mira host uses sticky positioning');
    await waitForImage('neutral');
    assert(getComputedStyle(image()).objectFit === 'contain', 'Neutral asset loaded with aspect-ratio-preserving fit');
    const expressionHeights = [card().getBoundingClientRect().height];
    assert(output().includes('State: IDLE'), 'fresh document: IDLE');
    assert(!doc.getElementById('mobileConcern') && !doc.getElementById('mobileCheckinMessage')
      && !doc.getElementById('mobileJournalMessage') && !doc.body.textContent.includes('AIコーチに相談する（任意）'),
    'lower optional Coach input and duplicate response boxes are absent');
    doc.querySelector('[data-mobile-screen="morning"]').click();
    const moodInput = doc.querySelector('[name="mobileCheckinMood"][value="3"]'); moodInput.focus();
    assert(output().includes('LISTENING'), 'input focus => LISTENING');
    doc.getElementById('mobileCheckinForm').requestSubmit();
    assert(output().includes('THINKING'), 'Morning send => THINKING');
    await waitFor(() => events.some(event => event.type === 'response'));
    await waitForImage('empathy');
    assert(output().includes('SPEAKING') && output().includes('empathy'), 'new Morning response => SPEAKING / empathy (postponement priority)');
    assert(card().querySelector('.mira-presentation-bubble').textContent.includes('小さな一歩'), 'Morning real AI response appears in Mira bubble');
    await waitFor(() => output().includes('ENCOURAGING')); await waitForImage('encourage'); assert(true, 'START_SMALL => ENCOURAGING / encourage image');
    await waitFor(() => output().includes('IDLE')); assert(true, 'response ends => IDLE');
    doc.querySelector('[data-mobile-screen="evening"]').click();
    assert(doc.querySelectorAll('[name="journalTask"]').length === 2, 'Morning tasks appear in Evening');
    doc.querySelector('[name="journalTask"][value="501"]').checked = true;
    const beforeEvening = events.filter(event => event.type === 'response').length;
    doc.getElementById('mobileJournalForm').requestSubmit();
    await waitFor(() => events.filter(event => event.type === 'response').length > beforeEvening);
    await waitForImage('celebrate');
    assert(output().includes('SPEAKING') && output().includes('celebrate'), 'new Evening response => SPEAKING / celebrate');
    assert(card().querySelector('.mira-presentation-bubble').textContent.includes('2件中1件'), 'Evening real AI response replaces Mira bubble');
    assert(doc.getElementById('homeCompletedCount').textContent === '1' && doc.getElementById('homeProgressRate').textContent === '50%', 'Evening task/count reflection');
    const followupToggle = card().querySelector('.mira-followup-toggle');
    followupToggle.click();
    const followupPanel = doc.querySelector('.mira-followup-panel');
    const followupInput = doc.querySelector('.mira-followup-form textarea');
    assert(!followupPanel.hidden && followupInput === doc.activeElement, 'follow-up opens compact input and focuses it');
    followupInput.value = '今日はもう疲れました。残りもやるべき？';
    const beforeFollowup = events.filter(event => event.type === 'response').length;
    doc.querySelector('.mira-followup-form').requestSubmit();
    assert(output().includes('THINKING'), 'follow-up send => THINKING');
    await waitFor(() => events.filter(event => event.type === 'response').length > beforeFollowup);
    await waitFor(() => card().querySelector('.mira-presentation-bubble').textContent.includes('全部を終えなくても'));
    assert(!doc.querySelector('.mira-followup-send').disabled && followupInput.value === '', 'follow-up reply restores form and clears submitted input');
    await waitFor(() => !doc.querySelector('.mira-voice-controls').hidden);
    assert(doc.querySelector('.mira-voice-replay') && doc.querySelector('.mira-voice-stop'), 'successful reply exposes replay and stop controls');
    await waitFor(() => output().includes('State: IDLE') && output().includes('Expr: encourage'));
    const encourageText = card().querySelector('.mira-presentation-bubble').textContent;
    followupInput.value = 'FIXTURE_FAIL';
    doc.querySelector('.mira-followup-form').requestSubmit();
    assert(output().includes('THINKING'), 'failed follow-up enters THINKING');
    await waitFor(() => doc.querySelector('.mira-followup-error').textContent.includes('うまく回答できませんでした'));
    assert(output().includes('State: IDLE') && output().includes('Expr: encourage')
      && card().querySelector('.mira-presentation-bubble').textContent === encourageText,
    'failed follow-up restores previous Encourage presentation immediately');
    assert(!doc.querySelector('.mira-followup-send').disabled && !followupInput.disabled,
      'failed follow-up re-enables input and send button');

    notify('restore', { question_type: 'SUCCESS', display_text: '前回の達成メッセージ' });
    await waitForImage('celebrate');
    const celebrateEventStart = events.length;
    followupInput.value = 'FIXTURE_FAIL';
    doc.querySelector('.mira-followup-form').requestSubmit();
    await waitFor(() => doc.querySelector('.mira-followup-error').textContent.includes('うまく回答できませんでした')
      && output().includes('State: IDLE') && output().includes('Expr: celebrate'));
    assert(card().querySelector('.mira-presentation-bubble').textContent === '前回の達成メッセージ'
      && events.slice(celebrateEventStart).every(event => event.type !== 'response'),
    'failed follow-up restores Celebrate without replaying response animation');
    doc.querySelector('[data-mobile-screen="history"]').click();
    assert(doc.getElementById('mobileHistory').textContent.includes('2件中1件'), 'History retains Text Coach');
    assert(output().includes('State: IDLE') && output().includes('SUSPENDED'), 'History suspends Avatar animation');
    assert(events.every(event => !('concern' in (event.response || {})) && !('coach_message' in (event.response || {}))), 'Avatar metadata excludes concern and private response fields');
    for (const [label, response, expression] of [
      ['OBSTACLE', { question_type: 'OBSTACLE' }, 'empathy'],
      ['REPEATED_POSTPONEMENT', { question_type: 'NEXT_STEP', behavior_signals: ['REPEATED_POSTPONEMENT'] }, 'empathy'],
      ['POSSIBLE_OVERLOAD', { question_type: 'NEXT_STEP', behavior_signals: ['POSSIBLE_OVERLOAD'] }, 'empathy'],
      ['START_SMALL', { question_type: 'START_SMALL' }, 'encourage'],
      ['GOOD_MOMENTUM', { question_type: 'NEXT_STEP', behavior_signals: ['GOOD_MOMENTUM'] }, 'smile'],
      ['WHY', { question_type: 'WHY' }, 'thinking'],
      ['NEXT_STEP', { question_type: 'NEXT_STEP' }, 'neutral'],
      ['unknown', { question_type: 'unknown' }, 'neutral'],
      ['aiResponse null', null, 'neutral']
    ]) {
      notify('restore', response);
      await waitForImage(expression);
      expressionHeights.push(card().getBoundingClientRect().height);
      assert(output().includes('Expr: ' + expression) && output().includes('IDLE'), label + ' => ' + expression);
    }
    assert(Math.max(...expressionHeights) - Math.min(...expressionHeights) <= 1, 'expression changes keep Mira card height stable');
    let eventStart = events.length;
    win.dispatchEvent(new win.PageTransitionEvent('pageshow', { persisted: true }));
    await win.__dummyProbe.whenIdle();
    assert(output().includes('IDLE') && events.slice(eventStart).every(event => event.type !== 'response'), 'pageshow refresh has no response replay');
    eventStart = events.length;
    win.dispatchEvent(new win.Event('focus'));
    await win.__dummyProbe.whenIdle();
    assert(output().includes('IDLE') && events.slice(eventStart).every(event => event.type !== 'response'), 'focus refresh has no response replay');
    win.dispatchEvent(new win.PageTransitionEvent('pagehide', { persisted: false }));
    assert(doc.querySelectorAll('.mira-presentation-card').length === 0, 'dispose removes Mira DOM');
    const host = doc.getElementById('mobileMiraPresentation');
    const [{ AvatarBridge }, { MiraPresentationController }, { bindMobileAvatar }] = await Promise.all([
      import(new URL(host.dataset.avatarBridgeUrl, doc.baseURI).href),
      import(new URL(host.dataset.avatarControllerUrl, doc.baseURI).href),
      import('../assets/avatar/mobile-avatar-bridge.js')
    ]);
    let fail = false;
    class FailingController extends MiraPresentationController {
      setExpression(value) { if (fail) throw new Error('Fixture controller failure'); super.setExpression(value); }
    }
    bridge = new AvatarBridge({ createController: () => new FailingController(), reducedMotion: () => false });
    assert(await bridge.init(host), 'new instance re-init succeeds after dispose');
    adapter = bindMobileAvatar({ bridge, host, document: doc, window: win }); notify('enable');
    assert(!await bridge.init(host) && doc.querySelectorAll('.mira-presentation-card').length === 1, 'double init cannot duplicate Mira DOM');
    const originalEmpathyUrl = bridge.controller.urls.empathy;
    const textBeforeMissingImage = doc.getElementById('homeCoachMessage').textContent;
    bridge.controller.urls.empathy = new URL('/assets/avatar/mira/missing-empathy.webp', doc.baseURI).href;
    notify('restore', { question_type: 'OBSTACLE' });
    await waitFor(() => imageName() === 'mira-neutral.webp' && card().dataset.imageStatus === 'fallback');
    assert(doc.getElementById('homeCoachMessage').textContent === textBeforeMissingImage && !host.hidden,
      'missing non-neutral image falls back to neutral; Text Coach unaffected');
    bridge.controller.urls.empathy = originalEmpathyUrl;
    fail = true;
    doc.querySelector('[data-mobile-screen="morning"]').click();
    const beforeFailure = events.filter(event => event.type === 'response').length;
    doc.getElementById('mobileCheckinForm').requestSubmit();
    await waitFor(() => events.filter(event => event.type === 'response').length > beforeFailure);
    await win.__dummyProbe.whenIdle();
    assert(bridge.lifecycle === 'FAILED' && host.hidden && doc.getElementById('homeCoachMessage').textContent.includes('Fixture:')
      && !doc.getElementById('checkinSubmitBtn').disabled, 'Controller failure: Text Coach/save continues');
    adapter.dispose(); adapter = null;
    assert(doc.querySelectorAll('.mira-presentation-card').length === 0 && bridge.timers.size === 0, 'failure disposal releases DOM and timers');
    const restored = await mountCoach(); probes.push(restored.win.__dummyProbe);
    const saved = restored.doc.querySelector('.mira-presentation-status').dataset.diagnostic;
    assert(saved.includes('celebrate') && saved.includes('IDLE') && !saved.includes('SPEAKING'), 'saved response restore has no speaking animation');
    for (const [width, height] of [[320, 844], [390, 844], [1024, 900], [390, 480]]) {
      frame.width = String(width); frame.height = String(height);
      await waitFor(() => restored.win.innerWidth === width && restored.win.innerHeight === height);
      for (const screen of ['home', 'morning', 'evening', 'history']) {
        restored.doc.querySelector('[data-mobile-screen="' + screen + '"]').click();
        assert(restored.doc.documentElement.scrollWidth <= width, width + 'x' + height + ' ' + screen + ': no overflow');
      }
      if (height === 480) {
        restored.doc.querySelector('[data-mobile-screen="home"]').click();
        restored.doc.querySelector('.mira-followup-toggle').click();
        const input = restored.doc.querySelector('.mira-followup-form textarea'); input.focus();
        assert(getComputedStyle(restored.doc.getElementById('mobileMiraPresentation')).position === 'relative', width + 'x' + height + ': sticky suspends while keyboard-like input is focused');
        input.blur();
      }
      for (const [screen, id] of [['morning', 'checkinSubmitBtn'], ['evening', 'journalSubmitBtn']]) {
        restored.doc.querySelector('[data-mobile-screen="' + screen + '"]').click();
        const submit = restored.doc.getElementById(id); submit.scrollIntoView({ block: 'center' });
        const r = submit.getBoundingClientRect(); const hit = restored.doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        assert(submit === hit || submit.contains(hit), width + 'x' + height + ' ' + screen + ': save button unobstructed');
      }
    }
    await restored.win.__dummyProbe.whenIdle();
    assert(probes.every(probe => probe.errors.length === 0) && window.__dummyProbe.errors.length === 0, 'zero console errors / window errors / unhandled rejections');
    results.dataset.status = 'pass'; results.dataset.runs = String(++runs);
    results.textContent += 'DONE: ' + count + ' PASS; consecutive runs=' + runs + '\n';
  } catch (error) { results.dataset.status = 'fail'; results.textContent += 'FAIL: ' + error.message + '\n'; }
  finally { adapter?.dispose(); bridge?.dispose(); button.disabled = false; }
});

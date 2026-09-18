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
  await waitFor(() => doc.querySelector('.dummy-avatar output')?.textContent.includes('READY')
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
    const output = () => doc.querySelector('.dummy-avatar output')?.textContent || '';
    const events = [];
    doc.addEventListener('mobile-coach-avatar', event => events.push(event.detail));
    const notify = (type, response, animate = false) => doc.dispatchEvent(new win.CustomEvent('mobile-coach-avatar', { detail: { type, response, animate } }));
    assert(doc.querySelectorAll('.dummy-avatar').length === 1 && doc.querySelectorAll('canvas').length === 0, 'one Dummy panel, zero Canvas');
    assert(output().includes('State: IDLE') && !doc.getElementById('mobileCheckinMessage').textContent, 'fresh document: IDLE, no stale response');
    doc.querySelector('[data-mobile-screen="morning"]').click();
    doc.querySelector('#mobileCheckinForm details').open = true;
    const concern = doc.getElementById('mobileConcern'); concern.focus();
    assert(output().includes('LISTENING'), 'input focus => LISTENING');
    concern.value = 'Fixture concern';
    doc.getElementById('mobileCheckinForm').requestSubmit();
    assert(output().includes('THINKING'), 'Morning send => THINKING');
    await waitFor(() => events.some(event => event.type === 'response'));
    assert(output().includes('SPEAKING') && output().includes('encourage'), 'new Morning response => SPEAKING / encourage');
    await waitFor(() => output().includes('ENCOURAGING')); assert(true, 'START_SMALL => ENCOURAGING');
    await waitFor(() => output().includes('IDLE')); assert(true, 'response ends => IDLE');
    doc.querySelector('[data-mobile-screen="evening"]').click();
    assert(doc.querySelectorAll('[name="journalTask"]').length === 2, 'Morning tasks appear in Evening');
    doc.querySelector('[name="journalTask"][value="501"]').checked = true;
    const beforeEvening = events.filter(event => event.type === 'response').length;
    doc.getElementById('mobileJournalForm').requestSubmit();
    await waitFor(() => events.filter(event => event.type === 'response').length > beforeEvening);
    assert(output().includes('SPEAKING') && output().includes('smile'), 'new Evening response => SPEAKING / smile');
    assert(doc.getElementById('homeCompletedCount').textContent === '1' && doc.getElementById('homeProgressRate').textContent === '50%', 'Evening task/count reflection');
    doc.querySelector('[data-mobile-screen="history"]').click();
    assert(doc.getElementById('mobileHistory').textContent.includes('2件中1件'), 'History retains Text Coach');
    assert(output().includes('neutral') && output().includes('IDLE'), 'History stops Avatar animation');
    assert(!JSON.stringify(events).includes('Fixture concern') && events.every(event => !('coach_message' in (event.response || {}))), 'Avatar metadata excludes text and identity');
    for (const [type, expression] of [['OBSTACLE', 'empathy'], ['WHY', 'thinking'], ['NEXT_STEP', 'neutral'], ['unknown', 'neutral'], [null, 'neutral']]) {
      notify('restore', type === null ? null : { question_type: type });
      assert(output().includes('Expr: ' + expression) && output().includes('IDLE'), (type ?? 'aiResponse null') + ' => ' + expression);
    }
    let eventStart = events.length;
    win.dispatchEvent(new win.PageTransitionEvent('pageshow', { persisted: true }));
    await win.__dummyProbe.whenIdle();
    assert(output().includes('IDLE') && events.slice(eventStart).every(event => event.type !== 'response'), 'pageshow refresh has no response replay');
    eventStart = events.length;
    win.dispatchEvent(new win.Event('focus'));
    await win.__dummyProbe.whenIdle();
    assert(output().includes('IDLE') && events.slice(eventStart).every(event => event.type !== 'response'), 'focus refresh has no response replay');
    win.dispatchEvent(new win.PageTransitionEvent('pagehide', { persisted: false }));
    assert(doc.querySelectorAll('.dummy-avatar').length === 0, 'dispose removes Dummy DOM');
    const host = doc.getElementById('mobileDummyAvatar');
    const [{ AvatarBridge }, { DummyAvatarController }, { bindMobileAvatar }] = await Promise.all([
      import(new URL(host.dataset.avatarBridgeUrl, doc.baseURI).href),
      import(new URL(host.dataset.avatarControllerUrl, doc.baseURI).href),
      import('../assets/avatar/mobile-avatar-bridge.js')
    ]);
    let fail = false;
    class FailingController extends DummyAvatarController {
      setExpression(value) { if (fail) throw new Error('Fixture controller failure'); super.setExpression(value); }
    }
    bridge = new AvatarBridge({ createController: () => new FailingController(), reducedMotion: () => false });
    assert(await bridge.init(host), 'new instance re-init succeeds after dispose');
    adapter = bindMobileAvatar({ bridge, host, document: doc, window: win }); notify('enable');
    assert(!await bridge.init(host) && doc.querySelectorAll('.dummy-avatar').length === 1, 'double init cannot duplicate Dummy DOM');
    fail = true;
    doc.querySelector('[data-mobile-screen="morning"]').click();
    const beforeFailure = events.filter(event => event.type === 'response').length;
    doc.getElementById('mobileCheckinForm').requestSubmit();
    await waitFor(() => events.filter(event => event.type === 'response').length > beforeFailure);
    await win.__dummyProbe.whenIdle();
    assert(bridge.lifecycle === 'FAILED' && host.hidden && doc.getElementById('mobileCheckinMessage').textContent.includes('Fixture:')
      && !doc.getElementById('checkinSubmitBtn').disabled, 'Controller failure: Text Coach/save continues');
    adapter.dispose(); adapter = null;
    assert(doc.querySelectorAll('.dummy-avatar').length === 0 && bridge.timers.size === 0, 'failure disposal releases DOM and timers');
    const restored = await mountCoach(); probes.push(restored.win.__dummyProbe);
    const saved = restored.doc.querySelector('.dummy-avatar output').textContent;
    assert(saved.includes('smile') && saved.includes('IDLE') && !saved.includes('SPEAKING'), 'saved response restore has no speaking animation');
    for (const [width, height] of [[320, 844], [390, 844], [1024, 900], [390, 480]]) {
      frame.width = String(width); frame.height = String(height);
      await waitFor(() => restored.win.innerWidth === width && restored.win.innerHeight === height);
      for (const screen of ['home', 'morning', 'evening', 'history']) {
        restored.doc.querySelector('[data-mobile-screen="' + screen + '"]').click();
        assert(restored.doc.documentElement.scrollWidth <= width, width + 'x' + height + ' ' + screen + ': no overflow');
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

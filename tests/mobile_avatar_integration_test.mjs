import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/mobile-coach.js', import.meta.url), 'utf8');
const ai = { question_type: 'START_SMALL', behavior_signals: ['REPEATED_POSTPONEMENT', 'private'], intervention_type: 'REDUCE_FRICTION',
  coach_message: 'private', email: 'private', user_id: 999, reflection: 'private', tasks: ['private'], api_key: 'private' };

function fixture(mode = 'enabled') {
  const elements = new Map(); const events = []; const requests = []; const listeners = new Map();
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
    getElementById(id) { return id === 'mobileDummyAvatar' && mode === 'disabled' ? null : element(id); },
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
    CSS: { escape: String }, Intl, Date, Set, Map, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, setTimeout() {},
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body); requests.push({ url, payload, method: options.method, credentials: options.credentials });
      let result;
      if (url.includes('auth')) result = { ok: true, csrfToken: 'csrf-fixture', user: { id: 999, email: 'private' } };
      else if (url.includes('tasks')) { taskLoads++; result = { ok: true, tasks: tasks.map(task => ({ ...task, status: savedJournal && task.id === 501 ? 'done' : task.status })) }; }
      else if (payload.action === 'save_checkin') { savedCheckin = checkin; result = { ok: true, checkin }; }
      else if (payload.action === 'save_journal') { savedJournal = journal; result = { ok: true, journal, history: [journal] }; }
      else result = { ok: true, today: '2026-09-18', todayTaskIds: [501, 502], checkin: savedCheckin, journal: savedJournal, history: savedJournal ? [journal] : [] };
      return { ok: true, json: async () => result };
    }
  });
  vm.runInContext(source, context);
  const run = expression => vm.runInContext(expression, context);
  return { run, elements, events, requests, element, tasks, taskLoads: () => taskLoads };
}
async function flow(mode) {
  const f = fixture(mode); await f.run('refreshMobileStatus()');
  f.element('mobileConcern').value = 'Current concern';
  await f.run('saveMobileCheckin({ preventDefault() {} })');
  f.element('mobileJournalText').value = ' Current reflection ';
  await f.run('saveMobileJournal({ preventDefault() {} })');
  return f;
}
function uiSnapshot(f) {
  return Object.fromEntries(['mobileCheckinMessage', 'mobileJournalMessage', 'mobileHistory', 'mobileCheckinTasks', 'mobileJournalTasks',
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
  assert.deepEqual(morning.payload, { action: 'save_checkin', csrfToken: 'csrf-fixture', date: '2026-09-18', mood: '3', focusMinutes: '30', concern: 'Current concern', taskIds: [501, 502] });
  const evening = baseline.requests.find(request => request.payload.action === 'save_journal');
  assert.deepEqual(evening.payload.completedTaskIds, [501]); assert.equal(evening.payload.completedText, 'Current reflection');
  assert.equal(evening.credentials, 'same-origin'); assert.equal(evening.method, 'POST'); assert.equal(evening.payload.csrfToken, 'csrf-fixture');
});
test('Text uses textContent, History and task HTML escaping maintained; completion counts remain 2/1/50%', async () => {
  const f = await flow('enabled'); assert.equal(f.element('mobileCheckinMessage').textContent, '<b>Morning text</b>');
  assert.equal(f.element('mobileJournalMessage').textContent, '<b>Evening text</b>');
  assert.ok(f.element('mobileHistory').innerHTML.includes('&lt;b&gt;Evening text&lt;/b&gt;'));
  assert.ok(f.element('mobileCheckinTasks').innerHTML.includes('&lt;script&gt;task&lt;/script&gt;'));
  assert.equal(f.element('homeTaskCount').textContent, '2'); assert.equal(f.element('homeCompletedCount').textContent, '1'); assert.equal(f.element('homeProgressRate').textContent, '50%');
});
test('notifications contain only allowlisted metadata and no full coach response or user data', async () => {
  const f = await flow('enabled'); const serialized = JSON.stringify(f.events);
  for (const key of ['email', 'user_id', 'coach_message', 'reflection', 'tasks', 'api_key', 'csrfToken', 'private', 'Morning text']) assert.equal(serialized.includes(key), false, key);
  const response = f.events.find(event => event.type === 'response');
  assert.deepEqual(JSON.parse(JSON.stringify(response.response)), { question_type: 'START_SMALL', behavior_signals: ['REPEATED_POSTPONEMENT'], intervention_type: 'REDUCE_FRICTION' });
  assert.equal(response.animate, true);
});
test('reload/context refresh uses restore only; History screen is neutral and no save replay', async () => {
  const f = await flow('enabled'); f.events.length = 0; await f.run('refreshMobileCoachContext()');
  assert.equal(f.events.every(event => !event.animate && event.type !== 'response'), true);
  assert.equal(f.events.at(-1).response.question_type, 'SUCCESS');
  f.run("switchMobileScreen('history', false)"); assert.equal(f.events.at(-1).response.question_type, null);
});
test('missing aiResponse and unknown question do not change text display', async () => {
  const f = await flow('enabled');
  f.run("mobileState.checkin.aiResponse = null; switchMobileScreen('morning', false)");
  assert.equal(f.events.at(-1).response.question_type, null); assert.equal(f.element('mobileCheckinMessage').textContent, '<b>Morning text</b>');
  f.run("mobileState.checkin.aiResponse = {question_type: '<svg>'}; notifyMobileAvatar('restore')");
  assert.equal(f.events.at(-1).response.question_type, null);
});
test('save errors still display error and release busy buttons even when Avatar notifications fail', async () => {
  const f = fixture('throw'); await f.run('refreshMobileStatus()'); f.run("postMobile = async () => { throw new Error('fixture API error'); }");
  await f.run('saveMobileCheckin({ preventDefault() {} })'); await f.run('saveMobileJournal({ preventDefault() {} })');
  assert.equal(f.element('mobileCheckinMessage').textContent, 'fixture API error'); assert.equal(f.element('mobileJournalMessage').textContent, 'fixture API error');
  assert.equal(f.element('checkinSubmitBtn').disabled, false); assert.equal(f.element('journalSubmitBtn').disabled, false);
});

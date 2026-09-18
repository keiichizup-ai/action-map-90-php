// Mobile-side adapter: no API calls, no access to text/identity/task state.
export function bindMobileAvatar({ bridge, host, document, window }) {
  let enabled = false;
  let saved = null;
  let detached = false;
  function safely(callback) {
    try { callback(); } catch (_) {
      host.hidden = true;
      try { bridge.dispose(); } catch (_) {}
      console.warn('Avatar bridge unavailable; Text Coach continues.');
    }
  }
  function onNotification(event) {
    safely(() => {
      const { type, response, animate } = event.detail || {};
      if (type === 'disable') { enabled = false; saved = null; bridge.suspend(); host.hidden = true; return; }
      if (type === 'enable') { enabled = true; if (!document.hidden) bridge.resume(); host.hidden = bridge.lifecycle === 'FAILED'; return; }
      if (!enabled) return;
      if (type === 'restore') { saved = response; bridge.applyCoachResponse(response, { source: 'restore' }); }
      if (type === 'screen' || type === 'idle') {
        saved = response;
        bridge.setState('IDLE');
        bridge.applyCoachResponse(response, { source: 'restore' });
      }
      if (type === 'thinking') bridge.setState('THINKING');
      if (type === 'response') { saved = response; bridge.applyCoachResponse(response, { source: animate ? 'new' : 'restore' }); }
    });
  }
  function onInputFocus(event) {
    if (!enabled || bridge.busy || bridge.timers?.size || !event.target.closest?.('#mobileCheckinForm, #mobileJournalForm')) return;
    safely(() => bridge.setState('LISTENING'));
  }
  function onInputBlur(event) {
    if (bridge.state !== 'LISTENING' || !event.target.closest?.('#mobileCheckinForm, #mobileJournalForm')) return;
    safely(() => { bridge.setState('IDLE'); bridge.applyCoachResponse(saved, { source: 'restore' }); });
  }
  function onVisibility() { safely(() => { if (document.hidden) bridge.suspend(); else if (enabled) bridge.resume(); }); }
  function onPageHide(event) {
    if (event.persisted) safely(() => bridge.suspend());
    else dispose();
  }
  function onPageShow() { if (enabled && !document.hidden) safely(() => bridge.resume()); }
  const listeners = [[document, 'mobile-coach-avatar', onNotification], [document, 'focusin', onInputFocus],
    [document, 'focusout', onInputBlur], [document, 'visibilitychange', onVisibility],
    [window, 'pagehide', onPageHide], [window, 'pageshow', onPageShow]];
  for (const [target, type, callback] of listeners) target.addEventListener(type, callback);
  function dispose() {
    if (detached) return;
    detached = true;
    for (const [target, type, callback] of listeners) target.removeEventListener(type, callback);
    safely(() => bridge.dispose());
  }
  return { dispose };
}

// PHP supplies content-versioned URLs. Accept only these two exact local files.
function moduleUrl(value, filename) {
  const url = new URL(value, document.baseURI);
  const expected = new URL(filename, import.meta.url);
  if (url.origin !== location.origin || url.pathname !== expected.pathname || url.hash
      || !/^\?v=[a-f0-9]{12}$/.test(url.search)) throw new Error('Invalid Avatar module URL');
  return url.href;
}

const host = typeof document === 'undefined' ? null : document.getElementById('mobileDummyAvatar');
if (host) {
  // Capture only sanitized metadata while optional modules initialize.
  let latest;
  let enabled = false;
  const capture = event => {
    if (event.detail?.type === 'enable') enabled = true;
    if (event.detail?.type === 'disable') { enabled = false; latest = null; }
    if (['restore', 'screen', 'response', 'idle'].includes(event.detail?.type)) latest = event.detail.response;
  };
  document.addEventListener('mobile-coach-avatar', capture);
  void (async () => {
    let bridge;
    try {
      const [{ AvatarBridge }, { DummyAvatarController }] = await Promise.all([
        import(moduleUrl(host.dataset.avatarBridgeUrl, './avatar-bridge.js')),
        import(moduleUrl(host.dataset.avatarControllerUrl, './dummy-avatar-controller.js'))
      ]);
      bridge = new AvatarBridge({ createController: () => new DummyAvatarController() });
      if (!await bridge.init(host)) return;
      bindMobileAvatar({ bridge, host, document, window });
      document.dispatchEvent(new CustomEvent('mobile-coach-avatar', { detail: { type: enabled ? 'enable' : 'disable' } }));
      document.dispatchEvent(new CustomEvent('mobile-coach-avatar', { detail: { type: 'restore', response: latest } }));
      if (document.hidden) bridge.suspend();
    } catch (_) {
      host.hidden = true;
      bridge?.dispose();
      console.warn('Dummy Avatar initialization failed; Text Coach continues.');
    } finally { document.removeEventListener('mobile-coach-avatar', capture); }
  })();
}

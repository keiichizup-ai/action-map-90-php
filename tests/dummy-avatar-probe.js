// Test-only instrumentation, injected before the unmodified application scripts.
(() => {
  const probe = window.__dummyProbe = { active: 0, errors: [], requests: 0 };
  const track = async callback => {
    probe.active++;
    try { return await callback(); } finally { probe.active--; }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (...args) => track(async () => {
    probe.requests++;
    const response = await nativeFetch(...args);
    const json = response.json.bind(response);
    response.json = () => track(json);
    return response;
  });
  const error = console.error.bind(console);
  console.error = (...args) => { probe.errors.push(args.map(String).join(' ')); error(...args); };
  window.addEventListener('error', event => probe.errors.push(event.message));
  window.addEventListener('unhandledrejection', event => probe.errors.push(String(event.reason)));
  probe.whenIdle = async () => {
    // Quiescence, not a guessed delay: two frames without requests or response bodies.
    let stable = 0;
    while (stable < 2) {
      const before = probe.requests;
      await new Promise(resolve => requestAnimationFrame(resolve));
      stable = probe.active === 0 && probe.requests === before ? stable + 1 : 0;
    }
  };
})();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const scope = 'https://example.test/action-map-90-staging/';
const productionScope = 'https://example.test/action-map-90/';
const scopePath = new URL(scope).pathname;
const cachePrefix = `action-map-90:${encodeURIComponent(scopePath)}:`;
const currentCacheName = `${cachePrefix}shell-v5`;

class MockCache {
  constructor() {
    this.entries = new Map();
  }

  async put(request, response) {
    const normalizedRequest = new Request(request);
    this.entries.set(normalizedRequest.url, {
      request: normalizedRequest,
      response: response.clone()
    });
  }

  async match(request, options = {}) {
    const requestUrl = new URL(new Request(request).url);
    for (const entry of this.entries.values()) {
      const cachedUrl = new URL(entry.request.url);
      const matches = options.ignoreSearch
        ? cachedUrl.origin === requestUrl.origin && cachedUrl.pathname === requestUrl.pathname
        : cachedUrl.href === requestUrl.href;
      if (matches) {
        return entry.response.clone();
      }
    }
    return undefined;
  }

  async keys() {
    return [...this.entries.values()].map(({ request }) => new Request(request));
  }

  async delete(request) {
    return this.entries.delete(new Request(request).url);
  }
}

class MockCacheStorage {
  constructor() {
    this.stores = new Map();
  }

  async open(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new MockCache());
    }
    return this.stores.get(name);
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name) {
    return this.stores.delete(name);
  }
}

const listeners = new Map();
const caches = new MockCacheStorage();
const networkBodies = new Map();
let online = true;
let skipWaitingCalls = 0;
let claimCalls = 0;

networkBodies.set(`${scope}mobile-coach.php`, '<html data-shell="mobile-v5">mobile shell</html>');

const self = {
  registration: { scope },
  location: new URL(`${scope}service-worker.js`),
  clients: {
    async claim() {
      claimCalls += 1;
    }
  },
  async skipWaiting() {
    skipWaitingCalls += 1;
  },
  addEventListener(type, listener) {
    listeners.set(type, listener);
  }
};

async function mockFetch(request) {
  if (!online) {
    throw new TypeError('offline');
  }
  const url = new Request(request).url;
  return new Response(networkBodies.get(url) ?? `network:${url}`, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

vm.runInNewContext(serviceWorkerSource, {
  URL,
  Request,
  Response,
  caches,
  fetch: mockFetch,
  self,
  Promise,
  Error
}, { filename: 'service-worker.js' });

async function dispatchLifecycle(type) {
  let pending;
  listeners.get(type)({
    waitUntil(promise) {
      pending = Promise.resolve(promise);
    }
  });
  assert.ok(pending, `${type} must register waitUntil work`);
  await pending;
}

async function dispatchFetch(request) {
  let responsePromise;
  listeners.get('fetch')({
    request,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    }
  });
  return responsePromise ? responsePromise : null;
}

function navigationRequest(url) {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}

await dispatchLifecycle('install');
assert.equal(skipWaitingCalls, 1, 'install activates the new worker without requiring repeated reloads');
assert.ok((await caches.keys()).includes(currentCacheName), 'install creates the scope-specific v5 cache');

for (const legacyName of ['action-map-90-mobile-home-v3', 'action-map-90-mobile-home-v4']) {
  const legacyCache = await caches.open(legacyName);
  await legacyCache.put(`${scope}index.php`, new Response('stale staging HTML'));
  await legacyCache.put(`${scope}assets/app.js?v=old`, new Response('stale staging JS'));
  await legacyCache.put(`${productionScope}index.php`, new Response('production HTML'));
}

const oldStagingScopedCache = `${cachePrefix}shell-v4`;
const productionScopedCache = `action-map-90:${encodeURIComponent(new URL(productionScope).pathname)}:shell-v4`;
await (await caches.open(oldStagingScopedCache)).put(`${scope}mobile-coach.php`, new Response('old staging shell'));
await (await caches.open(productionScopedCache)).put(`${productionScope}mobile-coach.php`, new Response('production shell'));
await (await caches.open('another-app-cache')).put('https://example.test/another-app/', new Response('other app'));

await dispatchLifecycle('activate');
assert.equal(claimCalls, 1, 'activate claims existing clients');
assert.ok(!(await caches.keys()).includes(oldStagingScopedCache), 'old cache for the current staging scope is deleted');
assert.ok((await caches.keys()).includes(productionScopedCache), 'production scope cache is preserved');
assert.ok((await caches.keys()).includes('another-app-cache'), 'other application cache is preserved');

for (const legacyName of ['action-map-90-mobile-home-v3', 'action-map-90-mobile-home-v4']) {
  const legacyCache = await caches.open(legacyName);
  assert.equal(await legacyCache.match(`${scope}index.php`), undefined, `${legacyName} staging HTML entry is deleted`);
  assert.equal(await legacyCache.match(`${scope}assets/app.js?v=old`), undefined, `${legacyName} staging JS entry is deleted`);
  assert.equal(await (await legacyCache.match(`${productionScope}index.php`)).text(), 'production HTML', `${legacyName} production entry is preserved`);
}

networkBodies.set(`${scope}index.php`, '<html><script src="./assets/app.js?v=new"></script><span>done</span></html>');
const desktopResponse = await dispatchFetch(navigationRequest(`${scope}index.php`));
const desktopHtml = await desktopResponse.text();
assert.match(desktopHtml, /app\.js\?v=new/, 'normal reload returns the newest HTML from the network');
assert.match(desktopHtml, />done</, 'normal reload reflects the latest task state rendered from server data');

networkBodies.set(`${scope}index.php`, '<html data-release="html-v2">updated HTML</html>');
const updatedDesktopResponse = await dispatchFetch(navigationRequest(`${scope}index.php`));
assert.match(await updatedDesktopResponse.text(), /html-v2/, 'a later HTML update is visible on the next normal reload');

const currentCache = await caches.open(currentCacheName);
await currentCache.put(`${scope}assets/app.js?v=old`, new Response('old-js'));
networkBodies.set(`${scope}assets/app.js?v=new`, 'new-js');
const scriptResponse = await dispatchFetch(new Request(`${scope}assets/app.js?v=new`));
assert.equal(await scriptResponse.text(), 'new-js', 'versioned JS is served network-first');
assert.equal(await currentCache.match(`${scope}assets/app.js?v=old`), undefined, 'older query version of the same asset path is removed');
assert.equal(await (await currentCache.match(`${scope}assets/app.js?v=new`)).text(), 'new-js', 'new query version is cached under its exact key');

await currentCache.put(`${scope}assets/style.css?v=old`, new Response('old-css'));
networkBodies.set(`${scope}assets/style.css?v=new`, 'new-css');
const styleResponse = await dispatchFetch(new Request(`${scope}assets/style.css?v=new`));
assert.equal(await styleResponse.text(), 'new-css', 'versioned CSS is served network-first');
assert.equal(await currentCache.match(`${scope}assets/style.css?v=old`), undefined, 'older CSS query version is removed');

networkBodies.set(`${scope}mobile-coach.php`, '<html data-shell="mobile-online">fresh mobile</html>');
const mobileResponse = await dispatchFetch(navigationRequest(`${scope}mobile-coach.php`));
assert.match(await mobileResponse.text(), /mobile-online/, 'Mobile Coach normal reload is network-first');

networkBodies.set(`${scope}api/tasks.php`, '{"status":"done"}');
const taskApiRequest = new Request(`${scope}api/tasks.php`, { method: 'POST' });
assert.equal(await dispatchFetch(new Request(`${scope}api/tasks.php`)), null, 'API GET requests bypass the Service Worker');
assert.equal(await dispatchFetch(taskApiRequest), null, 'POST requests bypass the Service Worker');
assert.equal(await (await mockFetch(taskApiRequest)).text(), '{"status":"done"}', 'a task done response comes directly from the network, not Cache Storage');
assert.equal(await dispatchFetch(navigationRequest(`${productionScope}index.php`)), null, 'production navigation is outside the staging worker scope');

online = false;
const offlineDesktopResponse = await dispatchFetch(navigationRequest(`${scope}index.php`));
assert.match(await offlineDesktopResponse.text(), /mobile-online/, 'offline desktop navigation falls back only to the Mobile shell');
const offlineVersionFallback = await dispatchFetch(new Request(`${scope}assets/mobile-coach.js?v=offline-request`));
assert.match(await offlineVersionFallback.text(), /network:/, 'offline asset lookup can match the installed unversioned shell key');

console.log('PASS Service Worker scope isolation, migration, network-first, versioning, and offline fallback tests.');

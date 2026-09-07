const CACHE_SCHEMA = 'shell-v5';
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const CACHE_PREFIX = `action-map-90:${encodeURIComponent(SCOPE_PATH)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_SCHEMA}`;
const LEGACY_CACHE_NAMES = ['action-map-90-mobile-home-v3', 'action-map-90-mobile-home-v4'];
const OFFLINE_PAGE = './mobile-coach.php';
const INSTALL_SHELL = [
  OFFLINE_PAGE,
  './assets/mobile-coach.css',
  './assets/mobile-coach.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg'
];

function scopedUrl(relativePath) {
  return new URL(relativePath, self.registration.scope);
}

function isWithinCurrentScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH);
}

function isApiRequest(url) {
  return url.pathname.startsWith(`${SCOPE_PATH}api/`);
}

function isMobilePage(url) {
  return url.pathname === scopedUrl(OFFLINE_PAGE).pathname;
}

function isCacheableAsset(url) {
  if (url.pathname === scopedUrl('./service-worker.js').pathname) {
    return false;
  }

  return /\.(?:js|css|webmanifest|svg)$/i.test(url.pathname);
}

function freshRequest(request) {
  return new Request(request, { cache: 'no-store' });
}

async function cacheLatestPathVersion(cache, request, response) {
  const requestUrl = new URL(request.url);
  const cacheKeys = await cache.keys();

  await Promise.all(cacheKeys.map((cacheKey) => {
    const cacheUrl = new URL(cacheKey.url);
    if (cacheUrl.pathname === requestUrl.pathname && cacheKey.url !== request.url) {
      return cache.delete(cacheKey);
    }
    return Promise.resolve(false);
  }));

  await cache.put(request, response);
}

async function installShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(INSTALL_SHELL.map(async (relativePath) => {
    const request = new Request(scopedUrl(relativePath), { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(`Unable to cache PWA shell: ${relativePath}`);
    }
    await cache.put(request, response);
  }));

  await self.skipWaiting();
}

async function removeCurrentScopeFromLegacyCache(cacheName) {
  const cache = await caches.open(cacheName);
  const cacheKeys = await cache.keys();
  const scopedKeys = cacheKeys.filter((cacheKey) => isWithinCurrentScope(new URL(cacheKey.url)));

  await Promise.all(scopedKeys.map((cacheKey) => cache.delete(cacheKey)));

  if ((await cache.keys()).length === 0) {
    await caches.delete(cacheName);
  }
}

async function activateCurrentCache() {
  const cacheNames = await caches.keys();

  await Promise.all(cacheNames.map((cacheName) => {
    if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
      return caches.delete(cacheName);
    }
    if (LEGACY_CACHE_NAMES.includes(cacheName)) {
      return removeCurrentScopeFromLegacyCache(cacheName);
    }
    return Promise.resolve(false);
  }));

  await self.clients.claim();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const requestUrl = new URL(request.url);

  try {
    const response = await fetch(freshRequest(request));
    if (response.ok && isMobilePage(requestUrl)) {
      await cache.put(new Request(scopedUrl(OFFLINE_PAGE)), response.clone());
    }
    return response;
  } catch (_) {
    const fallback = await cache.match(new Request(scopedUrl(OFFLINE_PAGE)));
    return fallback || new Response('オフラインです。接続後にもう一度お試しください。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(freshRequest(request));
    if (response.ok) {
      await cacheLatestPathVersion(cache, request, response.clone());
    }
    return response;
  } catch (_) {
    const exactMatch = await cache.match(request);
    const fallbackMatch = exactMatch || await cache.match(request, { ignoreSearch: true });
    return fallbackMatch || new Response('', { status: 503 });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateCurrentCache());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (!isWithinCurrentScope(requestUrl) || isApiRequest(requestUrl)) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isCacheableAsset(requestUrl)) {
    event.respondWith(networkFirstAsset(event.request));
  }
});

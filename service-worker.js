const CACHE = 'action-map-90-mobile-home-v4';
const SHELL = ['./mobile-coach.php','./assets/mobile-coach.css','./assets/mobile-coach.js','./manifest.webmanifest','./assets/icons/icon-192.svg','./assets/icons/icon-512.svg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.includes('/api/')) return;

  const isShellAsset = SHELL.some((path) => requestUrl.pathname.endsWith(path.replace('./', '/')));
  if (!isShellAsset) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

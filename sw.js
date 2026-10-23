const CACHE_VERSION = 'qp-quiz-v15';
const CACHE_PREFIX = 'qp-quiz-';
const ESSENTIAL = [
  './',
  './index.html',
  './sw.js',
  './manifest.webmanifest',
  './assets/css/style.css',
  './assets/js/app.js',
  './assets/js/quiz.js',
  './assets/js/storage.js',
  './data/quocphong1.json',
  './data/quocphong2.json',
  './assets/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ESSENTIAL))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  const isJSON = url.pathname.endsWith('.json');
  const isEssentialAsset = /\.(css|js|json|webmanifest|svg|png|ico)$/i.test(url.pathname);
  if (!isHTML && !isEssentialAsset) return;

  if (isHTML || isJSON) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request, event));
  }
});

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    event.waitUntil(fetch(request).then((response) => {
      if (response.ok) return cache.put(request, response.clone());
    }).catch(() => {}));
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Chưa có tài nguyên này trong bộ nhớ offline. Hãy kết nối mạng để tải ứng dụng và bộ đề.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isHTML) {
      const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
      if (fallback) return fallback;
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isHTML) {
      const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
      if (fallback) return fallback;
    }
    return new Response(
      isHTML
        ? 'Cần kết nối mạng ít nhất một lần để tải website và hai bộ đề.'
        : 'Chưa có dữ liệu này trong bộ nhớ offline. Hãy kết nối mạng để tải bộ đề.',
      {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      }
    );
  }
}

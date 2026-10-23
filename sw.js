const CACHE_VERSION = 'quocphonganninh-v28';
const CACHE_PREFIX = 'quocphonganninh-';
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
  './assets/icons/icon.svg',
  './assets/icons/tabler/sun.svg',
  './assets/icons/tabler/moon.svg',
  './assets/icons/tabler/search.svg',
  './assets/icons/tabler/bookmark.svg',
  './assets/icons/tabler/check.svg',
  './assets/icons/tabler/chevron-left.svg',
  './assets/icons/tabler/chevron-right.svg',
  './assets/icons/tabler/player-play.svg',
  './assets/icons/tabler/refresh.svg',
  './assets/icons/tabler/download.svg',
  './assets/icons/tabler/upload.svg',
  './assets/icons/tabler/trash.svg',
  './assets/icons/tabler/alert-circle.svg',
  './assets/icons/tabler/wifi.svg',
  './assets/icons/tabler/wifi-off.svg',
  './assets/icons/tabler/book-2.svg',
  './assets/icons/tabler/list-check.svg',
  './assets/icons/tabler/arrow-right.svg',
  './assets/icons/tabler/arrow-left.svg',
  './assets/icons/tabler/rotate-clockwise.svg',
  './assets/icons/tabler/x.svg',
];

const INTER_FONT_URL = 'https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2';
const INTER_FONT_CACHE_KEY = () => new URL('./assets/fonts/InterVariable.woff2', self.registration.scope).href;

self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE_VERSION);
  await cache.addAll(ESSENTIAL);
  await cacheInterFont(cache);
})()));

async function fetchInterFont() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(INTER_FONT_URL, { mode: 'cors', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  };
}

async function cacheInterFont(cache) {
  try {
    const response = await fetchInterFont();
    if (response.ok && response.type !== 'opaque') {
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'font/woff2');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      const font = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      await cache.put(INTER_FONT_CACHE_KEY(), font);
    };
  } catch {
    // Font is optional during installation; the system font remains available as fallback.
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  const interFontUrl = new URL('./assets/fonts/InterVariable.woff2', self.registration.scope);
  if (url.href === interFontUrl.href) {
    event.respondWith(serveInterFont(request));
    return;
  }

  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  const isJSON = url.pathname.endsWith('.json');
  const isEssentialAsset = /\.(css|js|json|webmanifest|svg|png|ico|woff2)$/i.test(url.pathname);
  if (!isHTML && !isEssentialAsset) return;

  if (isHTML || isJSON) event.respondWith(networkFirst(request));
  else event.respondWith(cacheFirst(request, event));
});


async function serveInterFont(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetchInterFont();
    if (!response.ok || response.type === 'opaque') {
      return new Response('Không tải được font Inter.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    };
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'font/woff2');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const font = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    await cache.put(request, font.clone());
    return font;
  } catch {
    return new Response('Font Inter chưa được tải. Hãy kết nối mạng rồi tải lại trang.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    event.waitUntil(fetch(request).then((response) => {
      if (response.ok) return cache.put(request, response.clone());
    }).catch(() => {}));
    return cached;
  };

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Chưa có tài nguyên này trong bộ nhớ ngoại tuyến. Hãy kết nối mạng để tải ứng dụng và bộ đề.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  };
};

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    };
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isHTML) {
      const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
      if (fallback) return fallback;
    };
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isHTML) {
      const fallback = await cache.match(new URL('index.html', self.registration.scope).href);
      if (fallback) return fallback;
    };
    return new Response(isHTML ? 'Cần kết nối mạng ít nhất một lần để tải trang và hai bộ đề.' : 'Chưa có dữ liệu này trong bộ nhớ ngoại tuyến. Hãy kết nối mạng để tải bộ đề.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  };
};
const NAME = 'quocphonganninh';
const VERSION = '1.2.2';
const ASSETS = [
  './',
  './index.html',
  './sw.js',
  './manifest.webmanifest',
  './data/quocphong1.json',
  './data/quocphong2.json',
  './assets/fonts/Inter.woff2',
  './assets/css/style.css',
  './assets/javascript/app.js',
  './assets/javascript/enhance.js',
  './assets/javascript/quiz.js',
  './assets/javascript/storage.js',
  './assets/sounds/correct.mp3',
  './assets/sounds/incorrect.mp3',
  './assets/icons/icon.svg',
  './assets/icons/tabler/bookmark.svg',
  './assets/icons/tabler/bookmark-off.svg',
  './assets/icons/tabler/pencil.svg',
  './assets/icons/tabler/pinned-off.svg',
  './assets/icons/tabler/pin.svg',
  './assets/icons/tabler/eye-off.svg',
  './assets/icons/tabler/eye.svg',
  './assets/icons/tabler/check.svg',
  './assets/icons/tabler/chevron-left.svg',
  './assets/icons/tabler/chevron-right.svg',
  './assets/icons/tabler/player-play.svg',
  './assets/icons/tabler/refresh.svg',
  './assets/icons/tabler/download.svg',
  './assets/icons/tabler/upload.svg',
  './assets/icons/tabler/trash.svg',
  './assets/icons/tabler/alert-circle.svg',
  './assets/icons/tabler/book-2.svg',
  './assets/icons/tabler/list-check.svg',
  './assets/icons/tabler/arrow-right.svg',
  './assets/icons/tabler/arrow-left.svg',
  './assets/icons/tabler/rotate-clockwise.svg',
  './assets/icons/tabler/player-pause.svg',
  './assets/icons/tabler/highlight.svg',
  './assets/icons/tabler/note.svg',
  './assets/icons/tabler/device-floppy.svg',
  './assets/icons/tabler/volume.svg',
  './assets/icons/tabler/volume-off.svg',
  './assets/icons/tabler/toggle-right.svg',
  './assets/icons/tabler/toggle-left.svg',
  './assets/icons/tabler/x.svg',
  './assets/icons/tabler/select-all.svg',
  './assets/icons/tabler/deselect.svg',
  './assets/icons/tabler/infinity.svg',
  './assets/icons/tabler/infinity-off.svg'
];

self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(NAME + ':' + VERSION);
  await cache.addAll(ASSETS);
})()));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(NAME) && key !== NAME + ':' + VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const isHTML = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
  const isJSON = url.pathname.endsWith('.json');
  const isAssets = /\.(html|css|js|json|webmanifest|svg|woff2|mp3)$/i.test(url.pathname);
  if (!isHTML && !isAssets) return;
  if (isHTML || isJSON) event.respondWith(networkFirst(request));
  else event.respondWith(cacheFirst(request, event));
});

async function cacheFirst(request, event) {
  const cache = await caches.open(NAME + ':' + VERSION);
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
    return new Response('Chưa có tài nguyên này trong bộ nhớ ngoại tuyến. Hãy kết nối mạng để tải trang và bộ đề.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };
};

async function networkFirst(request) {
  const cache = await caches.open(NAME + ':' + VERSION);
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
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };
};
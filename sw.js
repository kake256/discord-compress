// オフラインでも開けるようにアプリのファイルをキャッシュし，
// Androidの共有メニュー（Web Share Target）から届いた動画を受け取る．
const VERSION = 'v1';
const APP_FILES = [
  './', './index.html', './style.css', './app.js', './compress.js', './plan.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/mediabunny.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('app-' + VERSION).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('app-') && k !== 'app-' + VERSION) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('video');
      if (file) {
        const cache = await caches.open('shared-files');
        await cache.put('shared-file', new Response(file, {
          headers: { 'content-type': file.type || 'video/mp4', 'x-file-name': encodeURIComponent(file.name || 'shared.mp4') },
        }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 新しい版を優先し，通信できないときだけキャッシュを使う
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open('app-' + VERSION)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});

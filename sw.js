/* BCI – keeps the app's own files on the phone so it opens at once (the data always comes fresh from the server). */
const V = 'bci-v5', FILES = ['./', './index.html', './grow.html', './photos.html', './fert.html', './batch.html', './prop.html', './app.js', './fert.js', './style.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // the server data is never cached here
  // network first (new versions show up at once), the kept copy when there is no connection
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

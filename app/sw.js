/* Caché para que la app abra sin conexión. El plan se pide siempre a la red primero. */
const C = 'estudio-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const network = () => fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; });
  if (u.pathname.endsWith('plan.json') || u.pathname.endsWith('app.js') || u.pathname.endsWith('index.html') || u.pathname.endsWith('/')) {
    e.respondWith(network().catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || network()));
  }
});

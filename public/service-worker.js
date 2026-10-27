const CACHE = "contactgraph-shell-v1";
const root = new URL(self.registration.scope);
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch(root.href);
    if (!shell.ok) throw new Error("App shell unavailable.");
    const html = await shell.clone().text();
    await cache.put(root.href, shell);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => new URL(match[1], root).href);
    await cache.addAll([new URL("manifest.webmanifest", root).href, ...assets]);
  })());
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("contactgraph-shell-") && key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== root.origin || !url.href.startsWith(root.href) || url.pathname.includes("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((result) => { const copy = result.clone(); void caches.open(CACHE).then((cache) => cache.put(root.href, copy)); return result; }).catch(() => caches.match(root.href)));
    return;
  }
  if (/\.(?:js|css|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((result) => { if (result.ok) { const copy = result.clone(); void caches.open(CACHE).then((cache) => cache.put(request, copy)); } return result; })));
  }
});

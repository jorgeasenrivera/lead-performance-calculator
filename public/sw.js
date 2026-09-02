/* Sage's service worker.
   -------------------------------------------------------------------------
   It exists so the app can be put on a home screen and open full screen; it
   is not an offline copy of the store. The rules are deliberately small:

   - A page load goes to the network first and falls back to the last copy of
     the shell only when there is no network at all, so a new deploy is what
     opens next time, not last week's build.
   - The hashed build files under /assets/ never change once published, so
     those are kept and served from the cache after the first fetch.
   - Everything else (the database, the API, fonts) passes straight through.
     Nothing that could be a person's data is ever written to this cache. */
const VERSION = "sage-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put("/", copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("/")));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })));
  }
});

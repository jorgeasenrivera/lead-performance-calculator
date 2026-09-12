/* Sage starts from the phone.
   -------------------------------------------------------------------------
   A dealership lot is not a place with signal, and every deploy used to be a
   fresh download of the whole app over it. This keeps the app's own files on
   the phone: the page and the chunks it starts with are put away when a
   build is installed, the rest are kept as they are first used, and a start
   with no network is served from here. Data is never touched: the API and
   the database go straight to the network, and the app's own memory of its
   data lives in the page (see "the phone's memory" there).

   Updating is the part that has to be right. A new build is a new worker,
   which the browser notices on its own; it puts the new files away beside
   the old ones and WAITS. Nothing on screen changes mid-shift. The page
   tells it to take over when the app goes to the background, or at the next
   open, and the reload that follows lands on the new build with everything
   it needs already on the phone. The old files are dropped only then, so a
   page that is still running never asks for a chunk that has gone.

   This file is a template: the build writes the file list and the version
   in (vite.config.js, sageWorker). */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = "sage-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* One at a time and each allowed to fail on its own: a phone that gets
       most of a build over a thin connection keeps most of it, and the file
       that did not arrive is fetched when it is first needed. */
    for (const url of PRECACHE) {
      try { await c.add(new Request(url, { cache: "reload" })); } catch (err) { /* next open */ }
    }
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("sage-") && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* The page says when: it holds an installed build until the app is in the
   background or opening fresh. */
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

const sameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!sameOrigin(url)) return;                       // the database, the fonts, anything else: straight through
  if (url.pathname.startsWith("/api/")) return;       // never the API

  /* Opening the app: the page from this build, from the phone. The network
     only when the phone has nothing, which is the first open ever. */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match("/");
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) c.put("/", res.clone());
        return res;
      } catch (err) {
        return new Response("<!doctype html><title>Sage</title><p style=\"font-family:sans-serif;padding:40px\">Sage can't load without a connection yet. Try again when you have signal.</p>",
          { status: 503, headers: { "content-type": "text/html" } });
      }
    })());
    return;
  }

  /* The app's files carry their content in their names, so a file on the
     phone is never stale: cache first, and anything fetched is kept. */
  if (url.pathname.startsWith("/assets/") || /\.(svg|png|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
  }
});

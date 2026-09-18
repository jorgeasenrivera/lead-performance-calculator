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
    /* All at once, and each allowed to fail on its own: a phone that gets most
       of a build over a thin connection keeps most of it, and the file that did
       not arrive is fetched when it is first needed.

       One at a time was the first version. Installing is what the page waits
       for before it can take a new build, and every open that follows a deploy
       spends that wait booting the build it is about to throw away, so five
       round trips where one will do is five round trips of waste. */
    await Promise.all(PRECACHE.map(async (url) => {
      try { await c.add(new Request(url, { cache: "reload" })); } catch (err) { /* next open */ }
    }));
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
      const hit = await c.match("/", { ignoreVary: true });
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
     phone is never stale: cache first, and anything fetched is kept.

     ignoreVary, and this one was a silent disaster. The responses come back
     with Vary: Origin, and the page's own module script is fetched with the
     crossorigin attribute, so it carries an Origin header; the worker
     precached the same file WITHOUT one. By the letter of Vary those are
     different entries, so every asset lookup missed and fell through to the
     network.

     Which looked fine, every day, because the network had the file. It only
     bites in the one moment that matters: straight after a deploy, when the
     phone reopens on its cached page, asks for the build it has, and the
     server no longer has it. Then the asset comes back as the fallback HTML,
     the module refuses to run on the wrong MIME type, and the app is a white
     screen with no JavaScript alive to let the new build in. Measured on the
     built app: body empty, root empty, "Expected a JavaScript-or-Wasm module
     script but the server responded with a MIME type of text/html".

     It also means the offline promise above was never kept for assets. */
  if (url.pathname.startsWith("/assets/") || /\.(svg|png|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
  }
});

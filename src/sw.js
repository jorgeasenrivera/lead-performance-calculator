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

/* The last TWO builds stay on the phone, not one. This build's files and the
   build before it; anything older goes.

   Deleting the previous build's cache the moment this one took over was fine
   when taking over happened on the way to the background, with every page
   long since loaded. Since #369 it happens about ten milliseconds into a page
   that was served FROM that cache and may still be fetching from it. Delete it
   then and whatever is still in flight misses, goes to the network, and on a
   lot with no signal hangs until the phone gives up, and location.reload() is
   held until the page finishes loading, so the person waits with it. Keeping
   the previous build costs about the size of the app, once, and means a page
   from the old build can always finish being a page from the old build.

   Names sort: the build stamps its moment into the version, so the two
   newest are the two highest. Claim comes last and is not waited on by the
   deletes, so a delete that stalls cannot hold the takeover. */
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try {
      const names = (await caches.keys()).filter((n) => n.startsWith("sage-")).sort();
      const keep = new Set([CACHE, ...names.filter((n) => n !== CACHE).slice(-1)]);
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n).catch(() => {})));
    } catch (err) { /* a cache that cannot be listed is not worth the takeover */ }
    await self.clients.claim();
  })());
});

/* The cache, or nothing after a moment. WebKit's cache storage can take a long
   time to open after the app's process has been killed, and every open of the
   app waits on it: the page cannot even start until this handler answers.
   Nothing bounded that. Now a cache that has not answered in a second and a
   half is treated as empty and the page comes from the network instead, which
   is slower than the cache and enormously faster than waiting. */
/* This build's cache first, then any cache still kept. The last two builds
   stay on the phone (activate, above) so that a page still running the
   previous build can finish being that page, but the lookup only ever read
   THIS build's cache, so that page's own chunk, fetched an hour ago and put
   away, missed here and went to a server that no longer had it. The Board's
   wall hit that eleven times on 18 September, once per deploy, and went
   white each time. */
const cached = (key, opts) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(undefined), 1500);
  caches.open(CACHE).then((c) => c.match(key, opts)).then((hit) => hit || caches.match(key, opts))
    .then((hit) => { clearTimeout(t); resolve(hit); }, () => { clearTimeout(t); resolve(undefined); });
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
      const hit = await cached("/", { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        /* Cloned NOW, before the response is handed back, because a body can
           only be read once and the browser starts reading the moment it has
           it. A clone taken a tick later is a clone of a body already in use. */
        const copy = res.ok ? res.clone() : null;
        if (copy) caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
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
      const hit = await cached(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      const copy = res.ok ? res.clone() : null;
      if (copy) caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    })());
  }
});

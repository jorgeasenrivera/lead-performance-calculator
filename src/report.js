/* The page's reporter: what went wrong on this phone, sent to /api/client-error.
   -------------------------------------------------------------------------
   Installed once before React starts. It listens for uncaught errors and
   unhandled rejections, and the app calls report() itself for a screen that
   failed to render, a write the server refused, or a server answer of 500.

   It is deliberately small and careful: the same fault is sent once a minute
   at most, a page sends at most twenty reports in its life, nothing is sent
   in development (it goes to the console instead), and a failure to send is
   swallowed. A reporter that can itself throw would be the loudest bug in the
   app. The build stamp, the store, the person and the screen ride along so a
   row can be placed without asking anybody. */
/* global __APP_VERSION__ */
const ENDPOINT = "/api/client-error";
const MAX_PER_PAGE = 20;
const REPEAT_MS = 60000;
let ctx = {};
let sent = 0;
const lastAt = new Map();

/* Who and where, as the app learns it: { store, person, screen }. */
export function setReportContext(patch) { ctx = { ...ctx, ...patch }; }

function deviceId() {
  try { if (window.__lpcNative && window.__lpcNative.deviceId) return String(window.__lpcNative.deviceId); } catch (e) {}
  try {
    let id = localStorage.getItem("lpc:rid");
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); localStorage.setItem("lpc:rid", id); }
    return id;
  } catch (e) { return null; }
}
function token() {
  try { const s = JSON.parse(localStorage.getItem("lpc-auth") || "null"); return s && s.access_token ? s.access_token : null; } catch (e) { return null; }
}
const build = () => { try { return typeof __APP_VERSION__ !== "undefined" ? String(__APP_VERSION__) : null; } catch (e) { return null; } };

/* Noise that is not a fault of ours: a script from another origin the browser
   will not describe, and the layout observer's "loop completed" notice. */
function ignorable(message) {
  const m = String(message || "");
  return m === "Script error." || /ResizeObserver loop/.test(m) || m === "";
}

export function report(kind, err, extra) {
  try {
    const message = err && err.message ? String(err.message) : String(err == null ? "unknown" : err);
    if (ignorable(message)) return;
    const key = kind + "|" + message.slice(0, 120);
    const now = Date.now();
    if (lastAt.has(key) && now - lastAt.get(key) < REPEAT_MS) return;
    if (sent >= MAX_PER_PAGE) return;
    lastAt.set(key, now); sent++;
    const body = {
      kind, message: message.slice(0, 500), stack: err && err.stack ? String(err.stack).slice(0, 4000) : null,
      url: (location.pathname + location.search).slice(0, 300), build: build(),
      store: ctx.store || null, person_id: ctx.person || null, device_id: deviceId(),
      ua: navigator.userAgent.slice(0, 300), screen: ctx.screen || null,
      extra: extra || null,
    };
    if (import.meta.env && import.meta.env.DEV) { console.warn("[report]", kind, message, extra || ""); return; }
    const t = token();
    const headers = { "Content-Type": "application/json" };
    if (t) headers.Authorization = "Bearer " + t;
    try { if (window.ReactNativeWebView) headers["x-sage-source"] = "shell"; } catch (e) {}
    fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch (e) { /* never a second fault */ }
}

export function installReporter() {
  if (typeof window === "undefined" || window.__sageReporter) return;
  window.__sageReporter = true;
  window.addEventListener("error", (e) => {
    if (e && e.target && e.target !== window && !(e.error)) return;   // a resource that failed to load, not code
    report("error", (e && e.error) || (e && e.message) || "error", e && e.filename ? { at: e.filename + ":" + e.lineno } : null);
  });
  window.addEventListener("unhandledrejection", (e) => { report("rejection", (e && e.reason) || "rejected"); });
}

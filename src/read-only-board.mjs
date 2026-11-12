import { boardKey } from "../api/_store-keys.mjs";
import { renderLeaderboard } from "./board-loader.mjs";
import { BOARD_GLYPHS } from "./board-glyphs.mjs";

const storeId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const invalidLink = "This board link needs one valid store.";

export function boardRequest(search) {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()].filter((key) => key.toLowerCase() === "board");
  if (keys.length === 0) return null;
  const values = params.getAll("board");
  return keys.length === 1 && values.length === 1 && storeId(values[0])
    ? { storeId: values[0] } : { error: invalidLink };
}

// A single deadline covers headers and the body. Abort also invalidates late
// responses from transports that do not themselves reject on cancellation.
async function boardResponse(url, options, body, { fetchFn = globalThis.fetch, timeoutMs = 12000,
  signal, later = setTimeout, clearLater = clearTimeout } = {}) {
  if (signal?.aborted) throw new Error("Board read cancelled.");
  const controller = new AbortController();
  let timedOut = false, rejectAbort;
  const interrupted = new Promise((_, reject) => {
    rejectAbort = () => reject(new Error(timedOut ? "Board read timed out." : "Board read cancelled."));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = later(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted) throw new Error("Board read cancelled.");
        const response = await fetchFn(url, { ...options, signal: controller.signal });
        if (controller.signal.aborted) throw new Error("Board read cancelled.");
        if (!response.ok) throw new Error("Board read failed.");
        const value = await response[body]();
        if (controller.signal.aborted) throw new Error("Board read cancelled.");
        return value;
      })(),
      interrupted,
    ]);
  } finally {
    clearLater(timer); signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort); abort();
  }
}

export async function readPublicBoard(id, db, options = {}) {
  if (!storeId(id)) throw new Error(invalidLink);
  if (!db || typeof db.anonKey !== "string" || !db.anonKey || typeof db.url !== "string") {
    throw new Error("This board has no public database details.");
  }
  const base = new URL(db.url);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid board database URL.");
  const url = new URL("/rest/v1/app_data", base);
  url.searchParams.set("key", "eq." + boardKey(id));
  url.searchParams.set("select", "value");
  const rows = await boardResponse(url.href, {
    method: "GET", credentials: "omit", cache: "no-store",
    headers: { apikey: db.anonKey, Authorization: "Bearer " + db.anonKey },
  }, "json", options);
  if (options.signal?.aborted) throw new Error("Board read cancelled.");
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid board response.");
  if (rows.length === 0) return null;
  const value = rows[0]?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid board data.");
  return value;
}

// Only published display fields travel to the renderer. In particular a row
// cannot select its own database, session, sibling list, or opener callback.
export function readOnlyPayload(row, id, db, nonce) {
  const result = {};
  for (const key of ["storeName", "icon", "brand", "thresholds", "roles", "departed", "ticker", "boardDisplay"]) {
    if (Object.hasOwn(row, key)) result[key] = row[key];
  }
  return { ...result, storeId: id, storeKey: boardKey(id), storesKey: boardKey("stores"),
    db: { url: db.url, anonKey: db.anonKey }, tokens: null, readOnly: true, readOnlyNonce: nonce };
}

function nonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function mountReadOnlyBoard({ request, root, db, read = readPublicBoard, render = renderLeaderboard,
  schedule = setTimeout, cancel = clearTimeout, document = globalThis.document }) {
  let stopped = false, pending = false, done = false, retry;
  const controller = new AbortController();
  Object.assign(root.style, { position: "fixed", inset: "0", background: "#0B1622", color: "#CFE0F0", overflow: "hidden" });
  const message = (text, alert = false) => {
    const node = document.createElement("div");
    node.setAttribute("role", alert ? "alert" : "status");
    Object.assign(node.style, { height: "100%", display: "grid", placeItems: "center", padding: "32px", boxSizing: "border-box", font: "500 20px system-ui" });
    node.textContent = text; root.replaceChildren(node);
  };
  if (!request || !storeId(request.storeId)) { message(invalidLink, true); return () => {}; }
  const boot = async () => {
    if (stopped || pending || done) return;
    pending = true;
    message("Loading the board...");
    try {
      const row = await read(request.storeId, db, { signal: controller.signal });
      if (stopped) return;
      if (!row) { message("No published board yet. This screen keeps trying."); }
      else {
        const html = await render(readOnlyPayload(row, request.storeId, db, nonce()), BOARD_GLYPHS);
        if (stopped) return;
        const frame = document.createElement("iframe");
        frame.title = "TV Board"; frame.referrerPolicy = "no-referrer";
        Object.assign(frame.style, { border: "0", width: "100%", height: "100%", display: "block" });
        frame.srcdoc = html; root.replaceChildren(frame); done = true;
        return; // The actual board renderer owns polling from here.
      }
    } catch (_) { if (stopped) return; message("Could not read this board. This screen keeps trying."); }
    finally { pending = false; }
    if (!stopped) retry = schedule(boot, 60000);
  };
  void boot();
  return () => {
    if (stopped) return;
    stopped = true; controller.abort(); cancel(retry); root.replaceChildren();
  };
}

// A board may reload itself, but never adopts a worker shared with app tabs.
export function watchBoardBuild({ window = globalThis.window, document = globalThis.document,
  fetchFn = globalThis.fetch, schedule = setInterval, cancel = clearInterval,
  parse = (html) => new DOMParser().parseFromString(html, "text/html"), now = () => new Date(),
  later = setTimeout, clearLater = clearTimeout, timeoutMs = 12000, onUpdateBlocked = () => {} } = {}) {
  const names = (doc) => [...doc.querySelectorAll('script[src],link[rel="stylesheet"]')]
    .map((node) => node.getAttribute("src") || node.getAttribute("href"))
    .filter(Boolean).map((name) => name.split("/").pop());
  const mine = names(document);
  let stopped = false, pending = false, active, notified = false;
  const reload = (changed = false) => {
    if (stopped || !boardRequest(window.location.search)?.storeId) return;
    // A legacy worker may keep serving cached HTML. Keep this view rather than
    // update/activate a shared registration and restart unrelated app tabs.
    if (window.navigator?.serviceWorker?.controller) {
      if (changed && !notified) { notified = true; onUpdateBlocked(); }
      return;
    }
    window.location.reload();
  };
  const build = schedule(async () => {
    if (stopped || pending || !mine.length) return;
    pending = true;
    const controller = new AbortController(); active = controller;
    try {
      const html = await boardResponse(window.location.pathname + "?_build=" + now().getTime(), {
        method: "GET", credentials: "omit", cache: "no-store",
      }, "text", { fetchFn, timeoutMs, signal: controller.signal, later, clearLater });
      if (stopped || controller.signal.aborted) return;
      const theirs = names(parse(html));
      if (!stopped && !controller.signal.aborted && theirs.length && theirs.some((name) => !mine.includes(name))) reload(true);
    } catch (_) { /* Offline screens check again on the next pass. */ }
    finally { if (active === controller) { active = undefined; pending = false; } }
  }, 10 * 60 * 1000);
  const nightly = schedule(() => {
    if (stopped) return;
    const date = now();
    if (date.getHours() === 4 && date.getMinutes() < 6) reload();
  }, 5 * 60 * 1000);
  return () => {
    if (stopped) return;
    stopped = true; active?.abort(); cancel(build); cancel(nightly);
  };
}

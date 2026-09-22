/**
 * The probe kit: the pieces every phone check starts from.
 * -------------------------------------------------------------------------
 * Every check of a salesperson screen begins the same way: the mock up in
 * SALESPERSON mode, the demo store's floor put into a known shape, a browser
 * at phone size, the demo associate signed in. On 18 September that was
 * written six times into a scratchpad and thrown away six times. It lives
 * here now, for scripts/shots.mjs and for the next probe anybody writes.
 *
 * It does not replace scripts/feel.mjs, which keeps its own copy of the
 * floor prep on purpose: the feel is the measured thing and its guards pin
 * its text, so it is not refactored to lean on a file that will change.
 *
 *   import { ensureMock, prepFloor, launch, phone, signIn, touch, swipe } from "./probe-kit.mjs";
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MOCK = "http://127.0.0.1:5433";
export const STORE = "sage-demo";
export const STORE_TZ = "America/New_York";          // the app's dealership day
export const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(new Date());

const up = async (u, ms = 1000) => { try { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); const r = await fetch(u, { signal: c.signal }); clearTimeout(t); return r.ok; } catch (e) { return false; } };

/* The mock on 5433, started here if nobody has. */
export async function ensureMock() {
  if (await up(MOCK + "/rest/v1/")) return null;
  const proc = spawn(process.execPath, [path.join(HERE, "mock-supabase.mjs")], { env: { ...process.env, SALESPERSON: "1" }, stdio: "ignore" });
  for (let i = 0; i < 30; i++) { await new Promise((z) => setTimeout(z, 200)); if (await up(MOCK + "/rest/v1/")) return proc; }
  throw new Error("the mock did not come up on 5433");
}

const j = async (u) => (await fetch(u)).json();
const post = (table, rows) => fetch(`${MOCK}/rest/v1/${table}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) });

/* The floor as a check needs it: both rooms on for the store, three on the
   line, this account third with two ahead. Returns { me, id } where id is
   the day row's id. */
export async function prepFloor() {
  const all = await j(MOCK + "/rest/v1/app_data?select=key,value");
  const doc = all.find((r) => r.key === `lpc:store:${STORE}:v2`);
  const cfg = all.find((r) => r.key === "lpc:config:v2");
  if (cfg && cfg.value && Array.isArray(cfg.value.stores)) {
    cfg.value.stores = cfg.value.stores.map((st) => ({ ...st, rooms: { ...(st.rooms || {}), floor: true, line: true } }));
    await post("app_data", [{ key: cfg.key, value: cfg.value, updated_at: new Date().toISOString() }]);
  }
  const link = (await j(MOCK + "/rest/v1/floor_people?select=*"))[0];
  if (!doc || !link) throw new Error("the mock is not in SALESPERSON=1 mode, or has no demo store");
  const short = (n) => { const [a, ...r] = String(n).trim().split(/\s+/); return r.length ? `${a} ${r[r.length - 1][0]}.` : a; };
  const R = (doc.value.roster || []).map((a) => ({ id: a.id, name: a.name, label: short(a.name) }));
  const me = R.find((r) => r.id === link.person_id);
  const rest = R.filter((r) => r.id !== me.id);
  const rows = await j(MOCK + "/rest/v1/floor_public?select=*");
  const id = `${STORE}:${day()}`;
  const cur = rows.find((r) => r.id === id) || rows[0] || { store: STORE, data: {} };
  const d = { ...(cur.data || {}) };
  const mins = (m) => new Date(Date.now() - m * 60000).toISOString();
  const at = (p, m) => ({ id: p.id, label: p.label, name: p.label, status: "waiting", statusAt: mins(m), joinedAt: mins(m + 40), movedAt: mins(Math.max(1, m - 3)), awayReason: null, table: null });
  d.roster = [...R, { id: "__lpc_test__", label: "Test", role: "Test", test: true }];
  d.line = [at(rest[0], 52), at(rest[1], 31), at(me, 18)];
  d.assists = []; d.checkouts = d.checkouts || []; d.history = d.history || [];
  await post("floor_public", [{ ...cur, id, store: STORE, fdate: day(), data: d, updated_at: new Date().toISOString() }]);
  return { me, id };
}

/* My own status on the day's row, written straight to the mock. */
export async function setMine(floor, status, table = null) {
  const rows = await j(MOCK + "/rest/v1/floor_public?select=*");
  const cur = rows.find((r) => r.id === floor.id);
  const d = { ...(cur.data || {}) };
  d.line = (d.line || []).map((x) => (x.id === floor.me.id ? { ...x, status, statusAt: new Date().toISOString(), table } : x));
  await post("floor_public", [{ ...cur, data: d, updated_at: new Date().toISOString() }]);
}

/* Me at the head of the line, which is You're up. */
export async function setUp(floor) {
  const rows = await j(MOCK + "/rest/v1/floor_public?select=*");
  const cur = rows.find((r) => r.id === floor.id);
  const d = { ...(cur.data || {}) };
  const mine = (d.line || []).find((x) => x.id === floor.me.id);
  d.line = [mine, ...(d.line || []).filter((x) => x.id !== floor.me.id)];
  await post("floor_public", [{ ...cur, data: d, updated_at: new Date().toISOString() }]);
}

/* Playwright from this project or from FEEL_PLAYWRIGHT; WebKit when
   FEEL_BROWSER=webkit, because WebKit is what the app's WebView is. */
export async function launch() {
  let pw;
  try {
    const at = process.env.FEEL_PLAYWRIGHT;
    if (at) { const entry = fs.existsSync(path.join(at, "index.mjs")) ? path.join(at, "index.mjs") : at; pw = await import(pathToFileURL(entry).href); }
    else pw = await import("playwright");
  } catch (e) { throw new Error("playwright is not installed: npm i -D playwright && npx playwright install chromium webkit, or set FEEL_PLAYWRIGHT to its package directory"); }
  const webkit = String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit";
  if (webkit) return pw.webkit.launch();
  const executablePath = process.env.FEEL_CHROME || undefined;
  return pw.chromium.launch({ executablePath });
}

/* A phone-sized context. `prefs` are localStorage keys set before the app
   runs: the text size is lpcf:pref:text ("1", "1.15", "1.3"), the theme
   lpcf:pref:theme ("auto", "light", "dark"). */
export async function phone(browser, { width = 393, height = 852, dark = true, open = "home", prefs = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  /* Where the app opens: "home" (the default a salesperson has), "floor" or
     "line". The first version of this copied the feel harness's "floor" and
     every "Home" picture was the floor. */
  await page.addInitScript(([s, p, o]) => {
    try {
      localStorage.setItem(`lpcf:room:${s}`, o === "line" ? "line" : "floor"); localStorage.setItem(`lpcf:pref:open:${s}`, o);
      for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
    } catch (e) {}
    window.__vib = []; navigator.vibrate = (v) => { window.__vib.push(v); return true; };
  }, [STORE, prefs, open]);
  return { ctx, page, errors };
}

/* Signed in as the demo associate and standing in the rooms, the welcome
   dismissed. */
export async function signIn(page, url = process.env.FEEL_URL || "http://127.0.0.1:5178/", stage = () => {}) {
  stage("open sign-in");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  stage("fill demo sign-in");
  await page.fill('input[type="email"], input[autocomplete="username"]', "demo@sageonline.app").catch(() => {});
  await page.fill('input[type="password"]', "x");
  stage("submit sign-in");
  await page.click('button:has-text("Sign in")');
  stage("wait for room bar");
  await page.waitForSelector(".ar-bar.up", { timeout: 40000 });
  stage("settle arrival");
  await page.waitForTimeout(3500);
  stage("dismiss welcome");
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Back to work/.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(1000);
}

/* One finger, as the rooms' gesture reads it. A plain Event carrying
   touches and changedTouches is a touch to the app in WebKit as well as in
   Chromium, which do not agree on the Touch constructor. */
export const touch = (page, type, x, y) => page.evaluate(([type, x, y]) => {
  const el = document.elementFromPoint(x, y) || document.body;
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const tp = { clientX: x, clientY: y, identifier: 1, target: el };
  Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [tp] });
  Object.defineProperty(ev, "changedTouches", { value: [tp] });
  el.dispatchEvent(ev);
}, [type, x, y]);

/* A thumb from x0 to x1 at height y. `hold` is how long it rests before
   lifting: longer than a flick, so the distance decides; pass `lift: false`
   to leave it down for a look at the mid-swipe frame. */
export async function swipe(page, { x0, x1, y = 420, hold = 400, lift = true }) {
  const step = x1 > x0 ? 20 : -20;
  await touch(page, "touchstart", x0, y);
  await touch(page, "touchmove", x0 + step, y);
  await touch(page, "touchmove", x1, y);
  if (!lift) return;
  await page.waitForTimeout(hold);
  await touch(page, "touchend", x1, y);
}

/* The next two frames, so a style the app just set has been painted. */
export const settled = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/* ---- a lost browser is not a missed bar ----
   Twice on 21 September, inside twenty minutes, a run died with "Target page,
   context or browser has been closed" during sign-in, before a single row was
   measured: the shots job on #406 and feel-webkit on #408. Both went red
   exactly the way a missed bar goes red, exit 1 with a Playwright stack and no
   number in it, which told nobody whether the phone had got worse. It had not
   been measured at all.

   So the two are told apart here. The browser's own events are the evidence,
   because the fact belongs to the browser and the message belongs to
   Playwright; the message is only the fallback, for a throw that beats its
   event. Ask `why` BEFORE closing the browser: closing it fires the same
   disconnect, and a watch read afterwards calls every failure a lost browser.

   This does not make anything advisory. A run that could not measure still
   fails, and it now says which of the two it was. */
const LOST = /Target (?:page, context or browser has been closed|closed|crashed)|[Bb]rowser has been closed|Browser closed|Target crashed/;
export function lostBrowserWatch(browser) {
  let why = null;
  const note = (w) => { if (!why) why = w; };
  browser.on("disconnected", () => note("it went away mid-run"));
  return {
    watchPage(page) { page.on("crash", () => note("the page crashed under it; the cause is not established")); },
    why(err) {
      if (why) return why;
      if (browser.isConnected && !browser.isConnected()) return "it went away mid-run";
      return LOST.test(String((err && err.message) || err || "")) ? "it was closed under the run" : null;
    },
  };
}

/* ---- what the machine looked like ----
   C83's second half. Knowing the browser was lost is not knowing why, and the
   standing suspicion is that the container runs out of memory under a screen
   carrying two canvases, a lot of gradients and a backdrop filter. That is a
   guess until something measures it, so this reads the few facts the kernel
   will hand over and the harnesses print them.

   The one that settles it is the OOM counter. If the container killed the
   browser, that number goes up, and no amount of reading a Playwright stack
   would ever have said so. Everything else is context for it: how close the
   run got to the limit, and how much the box had left.

   Both cgroup layouts, because the runner image decides which one and neither
   is worth a failed harness: every read is best effort and a fact we cannot
   have comes back null rather than throwing. A number that might be wrong is
   worse than no number, so an unreadable one is simply not printed. */
const readNum = (f) => { try { const n = Number(String(fs.readFileSync(f, "utf8")).trim()); return Number.isFinite(n) ? n : null; } catch (e) { return null; } };
const readKey = (f, key) => {
  try {
    for (const line of String(fs.readFileSync(f, "utf8")).split("\n")) {
      const [k, v] = line.trim().split(/\s+/);
      /* /proc/meminfo writes "MemAvailable:" and the cgroup files write a bare
         key, so the colon comes off before the compare. */
      if (k && k.replace(/:$/, "") === key) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    }
  } catch (e) {}
  return null;
};
/* A cgroup with no limit set reports a sentinel rather than a number, and the
   two layouts spell it differently. Either way it means "the box is the
   limit", which is what the free figure is for. */
const CG_NOLIMIT = 9223372036854771712;
export function machineNow() {
  const v2 = readNum("/sys/fs/cgroup/memory.current") != null;
  const limit = v2 ? readNum("/sys/fs/cgroup/memory.max") : readNum("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  return {
    used: v2 ? readNum("/sys/fs/cgroup/memory.current") : readNum("/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    limit: limit === CG_NOLIMIT || limit === Infinity ? null : limit,
    /* v2 counts them in memory.events, v1 in oom_control. oom_kill is the
       processes the kernel actually killed; v1's failcnt is only allocations
       that had to wait, so it is kept apart and named apart. */
    oomKill: v2 ? readKey("/sys/fs/cgroup/memory.events", "oom_kill") : readKey("/sys/fs/cgroup/memory/memory.oom_control", "oom_kill"),
    failcnt: v2 ? null : readNum("/sys/fs/cgroup/memory/memory.failcnt"),
    free: (readKey("/proc/meminfo", "MemAvailable") || 0) * 1024 || null,
  };
}
const gb = (n) => (n == null ? null : (n / 1073741824).toFixed(2));
/* One line, and only the parts that were readable. `peak` is the highest
   reading a run took while it ran, which is the number a green run exists to
   give us: without it there is nothing to compare a crash against. */
export function machineLine(now, peak = null, before = null) {
  const bits = [];
  if (now.used != null) bits.push(`${gb(peak != null && peak > now.used ? peak : now.used)} GB used at its highest` + (now.limit ? ` of ${gb(now.limit)} allowed` : ""));
  if (now.free != null) bits.push(`${gb(now.free)} GB free on the box`);
  if (now.oomKill != null) {
    const was = before && before.oomKill != null ? before.oomKill : null;
    bits.push(was != null && now.oomKill > was
      ? `the kernel killed ${now.oomKill - was} process(es) for memory during this run`
      : `no process was killed for memory (oom_kill ${now.oomKill})`);
  }
  if (now.failcnt != null && before && before.failcnt != null && now.failcnt > before.failcnt) bits.push(`${now.failcnt - before.failcnt} allocation(s) hit the limit and had to wait`);
  return bits.length ? bits.join(", ") : null;
}
/* Sampled rather than read once at the end, because the reading that matters
   is the one just before the browser went, and by the time anybody asks, the
   dead browser has already given its memory back. */
export function watchMachine(everyMs = 1000) {
  const before = machineNow();
  let peak = before.used || 0;
  const t = setInterval(() => { const m = machineNow(); if (m.used != null && m.used > peak) peak = m.used; }, everyMs);
  if (t.unref) t.unref();
  return { before, peak: () => peak, stop: () => clearInterval(t), line: () => machineLine(machineNow(), peak, before) };
}

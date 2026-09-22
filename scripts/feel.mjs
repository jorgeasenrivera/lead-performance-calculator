#!/usr/bin/env node
/**
 * The feel check: how the phone answers a finger, measured.
 * -------------------------------------------------------------------------
 * "Apple smooth" is not a taste, it is a few numbers. A tap has to be drawn
 * in the same frame it lands in; a tab has to be the screen the phone already
 * had; the second tap inside a slow lot's round trip has to win, on the screen
 * and on the server; a control has to give under the finger and tick once; a
 * return sign-in has to land in about a second. Every one of those was
 * something a person had already felt go wrong on the floor before it was
 * measured here, so this keeps the numbers from drifting back.
 *
 * It drives the real app in a real browser against the local mock, with a
 * dealership's 400 ms added to every data request, and fails over the bar.
 *
 * Run it:
 *   .env.local          VITE_SUPABASE_URL=http://127.0.0.1:5433
 *                       VITE_SUPABASE_ANON_KEY=mock-anon-key
 *   npm run dev         the app, on http://127.0.0.1:5178 (or set FEEL_URL)
 *   npm run feel        starts the mock if port 5433 is quiet, signs in as the
 *                       demo associate, measures, prints the table, exits 1
 *                       if anything is over its bar
 *
 * Needs Playwright:  npm i -D playwright && npx playwright install chromium
 * or point FEEL_CHROME at a Chromium binary and FEEL_PLAYWRIGHT at a playwright
 * package directory. FEEL_LAG sets the added delay; FEEL_CPU=4 slows the page's
 * processor four times over, the shape of an old phone or a shared runner.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lostBrowserWatch, watchMachine } from "./probe-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_APP = process.env.FEEL_URL || "http://127.0.0.1:5178/";
const MOCK = "http://127.0.0.1:5433";
const LAG = Number(process.env.FEEL_LAG || 400);
/* ---- which room is being measured ----
   Both rooms stay mounted once they have been opened, so after the phone line
   has been visited once there are two sets of these controls in the page and
   the hidden one comes FIRST in the markup. Unscoped, the taps below landed on
   a display:none button: nothing happened, the screen never moved, and the
   harness reported the app had lost a tap. It had not; the measurement had.
   Every room-level selector says which room it means. */
const ROOM = '.ar-room[data-room="floor"]';
/* And a room switch is not over when the tab has been tapped. Both rooms stay
   un-hidden for the whole of the wipe, 428 ms measured, so for that window
   ":not([hidden])" is two rooms rather than one and the line comes first in the
   markup. This is why the burst once traced as "Here at 25 ms": the recorder
   read the phone line's segment, which said Here, while the floor said Lunch.
   Naming the room fixed the selector; this waits for the room to be alone
   again before anything is measured in it. */
const roomSettled = (p) => p.waitForFunction(
  () => document.querySelectorAll(".ar-room:not([hidden])").length === 1
     && !document.querySelector(".ar-room.ar-in, .ar-room.ar-out"),
  null, { timeout: 15000 });
const STORE = "sage-demo";
const STORE_TZ = "America/New_York";                 // the app's dealership day
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(new Date());

/* ---- the bar ---- */
/* Which engine, once, because the two engines get different bars below. */
const WEBKIT = String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit";
/* The bars were first set on 21 September from one day of runs, at "roughly
   four times the slower engine's median", with a note to re-set them once
   there were a few dozen runs to set them from. That table was wrong for
   WebKit by two to three times, and the re-set never happened, so for two days
   two WebKit bars sat inside WebKit's own normal range and failed on runs whose
   code could not have moved them (C85).

   Read back from 21 CI runs of the WebKit job, 21 and 22 September, each row
   the median of three on the page's own clock:

                      first table   median   75th   highest seen
     tap Lunch          11 ms         31      40       54
     tap Here           12 ms         14      16       33
     Floor to Phone     30 ms         57      62      128
     Phone to Floor     24 ms         39      42       44

   Chromium's first table was right, 9 to 21 ms, and its bars are left alone.

   The "four times the median" rule does not survive these numbers: it would
   put WebKit's tap bar at 124 ms and its tab bar at 228, loose enough to wave
   through a tap four times slower than it is now. So WebKit's bars are set just
   above the highest reading in that history instead, which is what "loose
   enough that the runner cannot turn it red for nothing" meant all along.

   What that costs, said plainly. For taps it costs little: 60 is still under
   double WebKit's median, so a tap that got twice as slow fails. For tabs it
   costs more: the runner's slow patches reach 128 on Floor to Phone, about
   twice its median, so at 140 a room cross that doubled in WebKit alone could
   hide in the same place. A regression that reaches both engines still fails
   in Chromium, whose bar is five times its median. The rows now print all
   three samples, which is what will let a later change tell a slow patch from
   a slow cross and tighten this, rather than guess. */
const BAR = {
  tab: WEBKIT ? 140 : 110,  // a tab is the screen the phone already had
  tap: WEBKIT ? 60 : 50,    // a tap is drawn in the frame it lands in
  chip: 100,         // a FlyBy sent is a chip at once
  returnSignIn: 900 + 3 * LAG, // signing in again the same day lands the short way: a few round trips, no jump
  press: 120,        // a control has given under the finger by then
  groundStep: 24,    // the ground blends a few points a frame and never steps
  follow: 2,         // the page moves what the thumb moves, frame for frame
  dropped: 1,        // and no frame is dropped while it does: one the person
                     // would feel, meaning long AND the page lost ground (C82)
};

/* ---- the mock, started here if nobody has ---- */
const up = async (u, ms = 1000) => { try { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); const r = await fetch(u, { signal: c.signal }); clearTimeout(t); return r.ok; } catch (e) { return false; } };
let mockProc = null;
async function ensureMock() {
  if (await up(MOCK + "/rest/v1/")) return;
  mockProc = spawn(process.execPath, [path.join(HERE, "mock-supabase.mjs")], { env: { ...process.env, SALESPERSON: "1" }, stdio: "ignore" });
  for (let i = 0; i < 30; i++) { await new Promise((z) => setTimeout(z, 200)); if (await up(MOCK + "/rest/v1/")) return; }
  throw new Error("the mock did not come up on 5433");
}

/* ---- the floor as the check needs it: this account on the line, two ahead ---- */
/* My own status on the day's row, written straight to the mock, so a step
   can stand where the screen it tests is drawn. */
async function setMine(status, table) {
  const j = async (u) => (await fetch(u)).json();
  const rows = await j(MOCK + "/rest/v1/floor_public?select=*");
  const cur = rows.find((r) => r.id === floor.id);
  const d = { ...(cur.data || {}) };
  d.line = (d.line || []).map((x) => (x.id === floor.me.id ? { ...x, status, statusAt: new Date().toISOString(), table } : x));
  await fetch(MOCK + "/rest/v1/floor_public", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ ...cur, data: d, updated_at: new Date().toISOString() }]) });
}
async function prepFloor() {
  const j = async (u) => (await fetch(u)).json();
  const all = await j(MOCK + "/rest/v1/app_data?select=key,value");
  const doc = all.find((r) => r.key === `lpc:store:${STORE}:v2`);
  /* Both rooms on for the store, so the phone line is a tab the check can
     open. A fresh mock (the one CI starts) has the line off. */
  const cfg = all.find((r) => r.key === "lpc:config:v2");
  if (cfg && cfg.value && Array.isArray(cfg.value.stores)) {
    cfg.value.stores = cfg.value.stores.map((st) => ({ ...st, rooms: { ...(st.rooms || {}), floor: true, line: true } }));
    await fetch(MOCK + "/rest/v1/app_data", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify([{ key: cfg.key, value: cfg.value, updated_at: new Date().toISOString() }]) });
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
  await fetch(MOCK + "/rest/v1/floor_public", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ ...cur, id, store: STORE, fdate: day(), data: d, updated_at: new Date().toISOString() }]) });
  return { me, id };
}

/* ---- the browser ---- */
async function launch() {
  /* Playwright from this project, or from wherever FEEL_PLAYWRIGHT points (a
     package directory), so a machine with it installed elsewhere can run this. */
  let pw;
  try {
    const at = process.env.FEEL_PLAYWRIGHT;
    if (at) { const entry = fs.existsSync(path.join(at, "index.mjs")) ? path.join(at, "index.mjs") : at; pw = await import(pathToFileURL(entry).href); }
    else pw = await import("playwright");
  } catch (e) { console.error("feel: playwright is not installed. npm i -D playwright && npx playwright install chromium, or set FEEL_PLAYWRIGHT to its package directory"); process.exit(2); }
  /* WebKit when asked (FEEL_BROWSER=webkit), because WebKit is what the app's
     WebView is and Chromium at phone width is not the phone: the 18 September
     glitches that reached Jorge were the kind only a phone shows. CI runs both.
     WebKit has no executable fallback; Playwright's own is the only one. */
  if (WEBKIT) return pw.webkit.launch();
  const tries = [process.env.FEEL_CHROME, undefined];
  try { const root = process.env.PLAYWRIGHT_BROWSERS_PATH; if (root) for (const d of fs.readdirSync(root)) if (/^chromium-\d+$/.test(d)) tries.push(path.join(root, d, "chrome-linux", "chrome")); } catch (e) {}
  let last = null;
  for (const executablePath of tries.filter((t, i, a) => a.indexOf(t) === i)) {
    try { return await pw.chromium.launch(executablePath ? { executablePath } : {}); } catch (e) { last = e; }
  }
  throw last;
}

const ms = (t0) => Date.now() - t0;
let floor = null;
/* How many rows got measured before anything went wrong, so a run that died
   halfway can say so instead of leaving the reader to count the table. */
let measured = 0;
let lost = null;
let machine = null;
const say = (m) => { if (process.env.FEEL_DEBUG) process.stderr.write("feel: " + m + "\n"); };
async function main() {
  await ensureMock(); say("mock up");
  floor = await prepFloor(); say("floor prepared for " + floor.id);
  const b = await launch(); say("browser up");
  lost = lostBrowserWatch(b);
  /* Sampled from here, because the reading that matters is the one just
     before the browser goes, and a dead browser has already given its
     memory back by the time anybody asks. */
  machine = watchMachine();
  try { await run(b); }
  /* Asked here, not in the handler below: the close in the finally fires the
     same disconnect, so a watch read after it calls every failure a lost
     browser. */
  catch (e) { if (e && typeof e === "object") e.lostBrowser = lost.why(e); throw e; }
  finally { await b.close().catch(() => {}); }
}
async function run(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (LAG) await ctx.route(/127\.0\.0\.1:5433/, async (r) => { await new Promise((z) => setTimeout(z, LAG)); r.continue(); });
  const p = await ctx.newPage();
  /* FEEL_CPU=4 slows the page's processor four times over, which is roughly a
     three-year-old phone on a hot afternoon, and the shape of a shared CI
     runner. The bars are meant to hold there too. */
  const cpu = Number(process.env.FEEL_CPU || 1);
  if (cpu > 1) { try { const c = await ctx.newCDPSession(p); await c.send("Emulation.setCPUThrottlingRate", { rate: cpu }); } catch (e) { say("no CPU throttle: " + e.message); } }
  if (lost) lost.watchPage(p);
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addInitScript(([s]) => {
    try { localStorage.setItem(`lpcf:room:${s}`, "floor"); localStorage.setItem(`lpcf:pref:open:${s}`, "floor"); } catch (e) {}
    window.__vib = []; navigator.vibrate = (v) => { window.__vib.push(v); return true; };
  }, [STORE]);
  const rows = [];
  /* Most rows are a time. The swipe's are pixels and a count of frames, the
     ground's a colour step, and a unit that lies is worse than none. */
  const unit = (name) => /px off/.test(name) ? "px" : /frames dropped|change between/.test(name) ? "  " : "ms";
  /* A median of three hides the three. When one goes over, the question is
     whether all three were slow, which is the app, or one or two were, which
     is the runner, and only the samples answer it (C85). */
  const line = (r) => `  ${r.ok ? "ok  " : "OVER"} ${r.name.padEnd(46)} ${r.bar ? String(r.value).padStart(5) + " " + unit(r.name) + "  bar " + r.bar : ""}${r.xs ? "   [" + r.xs.join(", ") + "]" : ""}`;
  const row = (name, value, bar, ok = value <= bar, xs = null) => {
    if (value === -1) { const r = { name, value: null, bar: null, ok: true }; rows.push(r); console.log(`  --   ${name}: the screen already looked like this, so nothing was timed`); return; } const r = { name, value, bar, ok, xs }; rows.push(r); measured++; console.log(line(r)); };
  const row3 = (name, xs, bar) => row(name, mid(xs), bar, mid(xs) <= bar, xs);
  console.log(`feel · ${WEBKIT ? "webkit" : "chromium"} · ${LAG} ms on every data request · ${URL_APP}`);

  const signIn = async () => {
    await p.fill('input[type="email"], input[autocomplete="username"]', "demo@sageonline.app").catch(() => {});
    await p.fill('input[type="password"]', "x");
    const t0 = Date.now(); await p.click('button:has-text("Sign in")');
    await p.waitForSelector(".ar-bar", { timeout: 40000 }); return ms(t0);
  };
  await p.goto(URL_APP, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2400); say("page loaded");
  const first = await signIn();
  console.log(`  first sign-in of the day to the floor  ${first} ms  (the jump; by design)`);
  await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector(".mc-flash-b")?.click()); await p.waitForTimeout(600);

  /* tabs: the other room is already mounted. Home and the floor are two panes
     of one page since C29, both built, so the tap is measured to the floor's
     pane taking the frame rather than to its content appearing, which is
     already there. */

  /* ---- timed on the page's own clock ----------------------------------------
     A tap used to be timed with a stopwatch out here: start, ask Playwright to
     click, wait for the screen to change, stop. Two of those steps are the
     driver's, not the phone's. Playwright's click first waits for the element
     to be STABLE, meaning unmoved across consecutive animation frames, and on
     a screen whose frames run long that check costs two frames before the
     click is even sent. Measured in WebKit on the CI runner, 19 September:
     the same tap read 116 to 196 ms through the driver and 15 to 38 ms
     dispatched in the page, on the same build, because WebKit was taking 80
     to 110 ms a frame and the stability check was paying for two of them.
     That is what made the WebKit job unable to block: its tap row was
     measuring the harness.
     So the clock starts inside the page, on the click event, and stops on the
     first frame at which the screen has changed. That is the thing a person
     actually feels, and it is the same measurement in both engines.
     `force` skips the actionability checks; the click itself is still a real
     one, sent through the browser. */
  let t;                              // the stopwatch the rows below still use
  const clickFelt = async (sel, ready) => {
    await p.evaluate(([s, r]) => {
      const el = r.idx == null ? document.querySelector(s) : document.querySelectorAll(s)[r.idx];
      window.__felt = { t0: null, done: null };
      const seen = () => {
        if (r.kind === "classOn") { const b = document.querySelectorAll(r.sel)[r.idx]; return !!b && /(^| )on( |$)/.test(b.className); }
        const q = document.querySelector(r.sel);
        if (!q) return false;
        if (r.kind === "exists") return true;
        const box = q.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && q.closest("[hidden]") == null;
      };
      /* If the screen already looks the way the row is waiting for, the row
         is measuring nothing and a small number would be a lie. Say so
         instead. */
      window.__felt.pre = seen();
      el.addEventListener("click", () => {
        window.__felt.t0 = performance.now();
        const tick = () => { if (seen()) { window.__felt.done = performance.now(); return; } requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }, { once: true, capture: true });
    }, [sel, ready]);
    if (ready.idx == null) await p.locator(sel).click({ force: true });
    else await p.locator(sel).nth(ready.idx).click({ force: true });
    await p.waitForFunction(() => window.__felt && window.__felt.done != null, null, { timeout: 30000 });
    return p.evaluate(() => (window.__felt.pre ? -1 : Math.round(window.__felt.done - window.__felt.t0)));
  };
  /* Which of the segment's buttons carries a word, so the click and the
     waiting both name the same one. */
  /* Three of each, and the middle one is the row. A row that waits for a
     paint is quantised to the length of a frame, and WebKit's frames after a
     tap run 50 to 140 ms on a shared runner, so one sample is a coin toss: the
     cross back to the floor read 210 ms on its first run here and 61 to 68 on
     the same build an hour earlier. The median of three costs four seconds and
     makes the bar mean something. */
  const mid = (xs) => xs.slice().sort((a, c) => a - c)[1];
  const segIdx = (label) => p.evaluate(([s, l]) => [...document.querySelectorAll(s)].findIndex((x) => x.textContent.includes(l)), [ROOM + " .sf-seg-btn", label]);

  const paneOn = (which) => p.waitForFunction((w) => !!document.querySelector(`.ar-room[data-room="floor"] .sf-pane-${w}.on`), which, { timeout: 30000 });
  /* The Home to Floor row is gone, and it is worth saying why rather than
     quietly dropping it. Since C29 those two are panes of ONE page on one
     scroller, and the harness opens the app already on the floor's pane, so
     the floor pane was on before the tap: the row's own wait was satisfied
     the moment it started. On the page's clock it reads nothing at all, which
     means its old 31 to 51 ms was the driver's click machinery from end to
     end. Measuring it honestly means driving the panes' scroller from out
     here, and that hung WebKit for a full 30 second timeout on the first
     attempt, because a smooth scroll started by a synthetic tap does not
     settle there. The pair already has a row that measures it properly: the
     swipe, thumb on the glass, which is skipped in WebKit for want of an
     input channel and says so. */
  await p.locator('.ar-tab[aria-label="Live Floor"]').click({ force: true });
  await paneOn("floor");
  await roomSettled(p);
  await p.waitForTimeout(800);
  const segOn = (label) => p.waitForFunction((l) => { const b = [...document.querySelectorAll('.ar-room[data-room="floor"] .sf-seg-btn')].find((x) => x.textContent.includes(l)); return b && /\bon\b/.test(b.className); }, label, { timeout: 15000 });
  const lunchI = await segIdx("Lunch"), hereI = await segIdx("Here");
  const lunch = [], here = [];
  for (let k = 0; k < 3; k++) {
    lunch.push(await clickFelt(ROOM + " .sf-seg-btn", { kind: "classOn", sel: ROOM + " .sf-seg-btn", idx: lunchI }));
    await segOn("Lunch"); await p.waitForTimeout(700);
    here.push(await clickFelt(ROOM + " .sf-seg-btn", { kind: "classOn", sel: ROOM + " .sf-seg-btn", idx: hereI }));
    await segOn("Here"); await p.waitForTimeout(700);
  }
  row3("tap Lunch to shown", lunch, BAR.tap);
  row3("tap Here to shown", here, BAR.tap);

  /* the swipe: the page under the thumb, and no frame dropped. Home and Live
     Floor are two pages of the floor page's own scroller (C74), so the thumb
     has to be a real one: Chromium's input pipeline through the debugging
     channel, which makes the browser scroll as a phone would. WebKit has no
     such channel, so there the row is not run and says so. A thumb from Home
     toward the floor, 260 px in steps of 10, a frame or so apart; on every
     frame the thumb's travel and the page's are read together. Native
     scrolling eats the first few pixels (the slop, 15 in Chromium) and then
     follows one to one, so once the page is moving the gap between thumb and
     page should be the slop and nothing else. The gap is read on the last
     frame before each step of the thumb, because the step itself reaches the
     browser a frame after this script wrote it down, and reading mid-step
     charged that lag to the page: a first draft of this row said 10 for a
     scroller that was following exactly. The row is the spread of that gap. */
  let cdp = null;
  try { cdp = await ctx.newCDPSession(p); } catch (e) { cdp = null; }
  if (cdp) {
    await p.locator('.ar-tab[aria-label="Home"]').click(); await paneOn("home"); await p.waitForTimeout(900);
    const tp = (x) => ({ x, y: 420, radiusX: 4, radiusY: 4, force: 1, id: 1 });
    await p.evaluate(() => { window.__sw = { frames: [], track: [] }; const el = document.querySelector('.ar-room[data-room="floor"] .q-page.sf'); let last = 0;
      const tick = (t) => { if (last) window.__sw.frames.push(t - last); last = t; window.__sw.track.push([window.__thumb || 0, el.scrollLeft]); if (window.__swipeOn !== false) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(300)] });
    for (let k = 1; k <= 26; k++) {
      const x = 300 - k * 10;
      await p.evaluate(([x]) => { window.__thumb = 300 - x; }, [x]);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp(x)] });
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    await p.waitForTimeout(120);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(600);
    const sw = await p.evaluate(() => { window.__swipeOn = false; return window.__sw; });
    const gaps = [];
    let first = -1, lastMove = -1;
    for (let i = 1; i < sw.track.length; i++) { const [t0, s0] = sw.track[i - 1], [t1, s1] = sw.track[i]; if (first < 0 && s0 > 0) first = i - 1; if (t1 !== t0) { lastMove = i; if (first >= 0) gaps.push(t0 - s0); } }
    const follow = gaps.length ? Math.max(...gaps) - Math.min(...gaps) : 999;
    row("swipe: the page under the thumb, px off between frames", Math.round(follow), BAR.follow);
    /* Where it ended: 260 less the slop is past the middle of 393, so the
       snap lands on the floor. Any other answer is the scroller not
       following. The frames counted are the ones while the thumb moved: the
       snap after it is the browser's own animation and is not this row.

       A dropped frame is one the PERSON would feel, which is not the same as
       a long one. This row used to count every frame over 25 ms, and on a
       shared CI runner that is the runner: it failed on main again and again,
       on commits that changed no JavaScript at all, and every time the frames
       it named were exactly 33 ms, one skipped vsync, with the page exactly
       the slop behind the thumb. The page had not lost an inch. The scroller
       is driven by the compositor, so a long frame on the main thread still
       arrives with the page where the thumb is, and nothing was felt.
       So a frame counts only when it is long AND the page fell behind while
       it lasted: the gap to the thumb opened more than a pixel beyond the
       slop. That is C82, 21 September, and it is the same measurement the
       follow row makes, applied per frame rather than over the whole swipe. */
    const from = first < 0 ? 0 : first;
    const moved = sw.frames.slice(from, lastMove < 0 ? undefined : lastMove);
    /* The gap for each of those frames, read the way the follow row reads it:
       on the settled frame BEFORE the thumb steps. Reading it at the end of
       the frame instead charges the harness's own lag to the page, which is
       the fault the comment above this block already records, and which this
       row walked straight back into on its first draft: it counted two frames
       on a scroller whose follow spread was 0. */
    const gapAt = moved.map((g, i) => { const t = sw.track[from + i] || []; return (t[0] || 0) - (t[1] || 0); });
    /* And only the frames the thumb moved through, which is the same subset
       the follow row uses. A frame where the thumb held still is the page
       catching up, its gap is smaller, and letting it set the floor makes
       every other frame look behind: that is the second way this row found to
       count a scroller that was following exactly. */
    const stepped = moved.map((g, i) => { const a = sw.track[from + i] || [], b = sw.track[from + i + 1] || []; return b[0] !== a[0]; });
    const walk = gapAt.filter((g, i) => stepped[i]);
    const slop = walk.length ? Math.min(...walk) : 0;
    const felt = moved.map((g, i) => [g, i]).filter(([g, i]) => g > 25 && stepped[i] && gapAt[i] - slop > 1);
    row("swipe: frames dropped while the thumb moved", felt.length, BAR.dropped);
    /* Which frames, and how long: a runner that drops the same three every
       run is saying where the cost is, and the number alone cannot. And the
       long frames that cost the page nothing are worth a line too, because
       "none of them lost ground" is the sentence that stops somebody
       re-running a green check looking for a fault. */
    if (felt.length) console.log("       dropped: " + felt.map(([g, i]) => { const t = sw.track[from + i + 1] || []; return `frame ${i} (${Math.round(g)} ms, thumb ${t[0]}, page ${Math.round(t[1] || 0)}, ${Math.round(gapAt[i] - slop)} px behind)`; }).join(", "));
    const longOnes = moved.filter((g) => g > 25).length;
    if (longOnes > felt.length) console.log(`       ${longOnes - felt.length} long frame(s) the page rode out at the slop, ${slop} px, which is the runner and not the phone`);
    await paneOn("floor"); await p.waitForTimeout(800);
    await p.locator('.ar-tab[aria-label="Home"]').click(); await paneOn("home"); await p.waitForTimeout(800);
  } else {
    console.log("  --   swipe: not run in WebKit (no input channel to move a real thumb)");
  }
  /* the ground through a tap: no step. The canvas behind the rooms is read at
     one point on every frame for 700 ms after the tap, and the biggest change
     between two frames after the first 80 ms is the row. A blend moves a few
     points a frame; the step Jorge recorded on 19 September was 30 in one. */
  await p.evaluate(() => { window.__gnd = []; const c = document.querySelector(".ar-gnd"); const g = c.getContext("2d"); const t0 = performance.now();
    const tick = () => { const d = g.getImageData(Math.round(c.width * 0.95), Math.round(c.height * 0.84), 1, 1).data; window.__gnd.push([performance.now() - t0, d[0], d[1], d[2]]); if (performance.now() - t0 < 700) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await p.locator('.ar-tab[aria-label="Live Floor"]').click(); await paneOn("floor"); await p.waitForTimeout(900);
  const gnd = await p.evaluate(() => window.__gnd || []);
  /* Per frame-time, not per sample: a loaded runner drops frames, and two
     samples 150 ms apart then span a fifth of the blend, which read as a
     step on WebKit's first run of this row (46 against 24, on a runner that
     had every tap three times over). A real step is a big change in one
     frame however long the frame took. */
  let stepMax = 0;
  for (let i = 1; i < gnd.length; i++) { if (gnd[i][0] < 80) continue; const d = Math.abs(gnd[i][1] - gnd[i - 1][1]) + Math.abs(gnd[i][2] - gnd[i - 1][2]) + Math.abs(gnd[i][3] - gnd[i - 1][3]); const frames = Math.max(1, (gnd[i][0] - gnd[i - 1][0]) / 16.7); const r = Math.round(d / frames); if (r > stepMax) stepMax = r; }
  row("ground: biggest change between two frames of the blend", stepMax, BAR.groundStep);
  const toPhone = [], toFloor = [];
  for (let k = 0; k < 3; k++) {
    toPhone.push(await clickFelt('.ar-tab[aria-label*="Phone"]', { kind: "visible", sel: ".sfl-title" }));
    await p.waitForSelector(".sfl-title, .mcf-home", { timeout: 30000 }); await p.waitForTimeout(900);
    toFloor.push(await clickFelt('.ar-tab[aria-label="Live Floor"]', { kind: "visible", sel: ROOM + " .sf-seg-btn" }));
    await p.waitForSelector(ROOM + " .sf-seg-btn", { timeout: 30000 }); await p.waitForTimeout(900);
  }
  row3("Floor to Phone tab", toPhone, BAR.tab);
  row3("Phone to Floor tab", toFloor, BAR.tab);
  await roomSettled(p);
  await p.waitForTimeout(800);

  /* two taps inside one round trip: the screen shows the second and stays, the
     server ends on it.

     Both halves used to be measured from out here, and both were wrong on a
     busy machine. The screen was sampled by asking the page forty times a
     second over the debugging channel — the one thing under load that cannot
     answer forty times a second — so on a loaded runner it returned two
     samples in three seconds and reported a tap it had simply not looked for.
     And the server was read on a fixed clock, 3.2 s after the taps, while a
     write here is a read AND a save: at a dealership's lag that is 1.8 s each
     and the second one had not landed yet. The check then called a slow
     server a lost tap. Twice in an afternoon it failed one runner and passed
     another on the same commit, which is the most expensive kind of check
     there is.

     Now the screen records itself, in the page, on its own frames, and the
     server is read until it stops moving. Neither change softens the bar:
     the trace must still show the second tap arriving and staying, and the
     server must still end on it. */
  const t0 = Date.now();
  await p.evaluate(() => {
    const on = () => { const b = [...document.querySelectorAll('.ar-room[data-room="floor"] .sf-seg-btn')].find((x) => /\bon\b/.test(x.className)); return b ? b.textContent.trim() : null; };
    window.__seg = [{ t: 0, v: on() }];
    const t = performance.now();
    const tick = () => {
      const v = on();
      if (v !== window.__seg[window.__seg.length - 1].v) window.__seg.push({ t: Math.round(performance.now() - t), v });
      window.__segRaf = requestAnimationFrame(tick);
    };
    window.__segRaf = requestAnimationFrame(tick);
  });
  await p.locator(ROOM + ' .sf-seg-btn:has-text("Lunch")').click({ force: true }); await p.waitForTimeout(120);
  await p.locator(ROOM + ' .sf-seg-btn:has-text("Here")').click({ force: true });
  await p.waitForTimeout(1600);
  await p.evaluate(() => cancelAnimationFrame(window.__segRaf));
  const frames = await p.evaluate(() => window.__seg);
  const trace = frames.map((x) => x.v);
  /* Read until the row has been STILL for longer than one write takes.
     "Two reads the same" was not enough and it cost a day of chasing a bug
     that was never there. A write is a read and then a save, so at a
     dealership's lag each link of the chain is about 2 x LAG, and between two
     chained writes the row sits unchanged for that whole time. Two polls half
     a second apart both land in that gap, agree with each other, and the check
     calls a server mid-chain a finished one. At 900 ms of lag that happened on
     every single run: the screen was right, both taps were written in the
     right order, the row ended on the right status, and the check still said
     the floor had lost a tap.

     So stillness is measured against what a write actually costs. Nothing is
     settled until the row has not moved for 2 x LAG plus a margin. */
  const readMine = async () => {
    const d = (await (await fetch(`${MOCK}/rest/v1/floor_public?id=eq.${floor.id}&select=data`)).json())[0]?.data;
    return { d, st: ((d && d.line) || []).find((x) => x.id === floor.me.id)?.status || null };
  };
  const STILL = 2 * LAG + 600;                 // longer than one read-and-save
  let last = await readMine(), unchangedSince = Date.now();
  while (Date.now() - unchangedSince < STILL && Date.now() - t0 < 25000) {
    await p.waitForTimeout(300);
    const now = await readMine();
    if (now.st !== last.st) unchangedSince = Date.now();
    last = now;
  }
  const server = last.d;
  const mine = ((server && server.line) || []).find((x) => x.id === floor.me.id);
  const burstOk = trace[trace.length - 1] === "Here" && trace.indexOf("Lunch") >= 0 && trace.indexOf("Lunch") < trace.lastIndexOf("Here") && mine && mine.status === "waiting";
  row("two taps in one round trip: " + trace.join(" > ") + ", server " + (mine ? mine.status : "?"), burstOk ? 0 : 1, 0, burstOk);
  if (!burstOk) {
    /* Which side lost the tap: the row's history says what the server was
       asked, in order; the samples say what the screen showed, with times. */
    const hist = ((server && server.history) || []).slice(-4).map((h) => `${h.action}@${String(h.t).slice(11, 23)}`).join(", ");
    console.log("       server history: " + (hist || "(none)"));
    console.log("       screen frames:  " + frames.map((x) => `${x.v}@${x.t}ms`).join(", "));
    console.log("       burst took:     " + (Date.now() - t0) + " ms to settle");
    const errsNow = await p.evaluate(() => (window.__lpcErrs || []).slice(-3));
    if (errsNow.length) console.log("       page errors: " + errsNow.join(" | "));
  }

  /* FlyBy and T.O. are drawn only with a customer (18 September, B4), so the
     row puts me with one first, and back in line after, because the press
     below taps the segment, which is drawn only in line (B1). */
  await setMine("customer", 3); await p.waitForSelector(".fba-btn.fly", { timeout: 15000 });
  /* a FlyBy sent is a chip at once, and taken back at once */
  await p.locator(".fba-btn.fly").click(); await p.waitForSelector(".fba-sheet.ask");
  await p.locator('.fba-go:has-text("Send the FlyBy")').click(); t = Date.now(); await p.waitForSelector(".fba-chip", { timeout: 5000 }); row("FlyBy sent to chip", ms(t), BAR.chip);
  await p.waitForTimeout(300); await p.locator(".fba-x").click(); t = Date.now(); await p.waitForSelector(".fba-chip", { state: "detached", timeout: 5000 }); row("Never mind to chip gone", ms(t), BAR.chip);
  await setMine("waiting", null); await p.waitForSelector(".fba-btn.fly", { state: "detached", timeout: 15000 });
  await p.waitForTimeout(600);

  /* the press: held, the segment has given by the bar; let go, it is back; one
     tick at touch-down and nothing on the click. The segment already chosen,
     so the click changes nothing and no pattern plays for a change of state. */
  /* The burst's own echo buzzes when the server's answer lands, and at a
     dealership's lag that can be seconds after the taps. Zeroing the log
     before the phone has finished feeling the last tap put somebody else's
     buzz in this measurement. Wait for quiet first. */
  await p.evaluate(() => new Promise((done) => {
    let n = (window.__vib || []).length, still = 0;
    const t = setInterval(() => {
      const m = window.__vib.length;
      if (m === n) { if (++still >= 3) { clearInterval(t); done(); } } else { n = m; still = 0; }
    }, 200);
    setTimeout(() => { clearInterval(t); done(); }, 6000);
  }));
  /* The press is driven as pointer events dispatched in the page, with the
     pointer type a finger has, rather than through Chromium's debugging
     channel: that channel does not exist in WebKit, and the first WebKit run
     (18 September) died here. The app's press lives on window-level pointer
     listeners, so this reaches exactly the code a finger reaches; what it
     does not exercise is the browser's own hit-testing, which is not what
     the two rows below measure. */
  const seg = (label) => `[...document.querySelectorAll('.ar-room[data-room="floor"] .sf-seg-btn')].find((b) => b.textContent.includes("${label}"))`;
  const box = await p.evaluate(`(() => { const r = ${seg("Here")}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const finger = (type) => p.evaluate(([type, at]) => {
    const el = document.elementFromPoint(at.x, at.y) || document.body;
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: "touch", pointerId: 1, isPrimary: true, button: 0, clientX: at.x, clientY: at.y }));
    return true;
  }, [type, box]);
  await p.evaluate(() => { window.__vib.length = 0; });
  await finger("pointerdown");
  await p.waitForTimeout(BAR.press);
  const held = await p.evaluate(`getComputedStyle(${seg("Here")}).scale`);
  await finger("pointerup");
  await p.waitForTimeout(500);
  const back = await p.evaluate(`getComputedStyle(${seg("Here")}).scale`);
  const vib = await p.evaluate(() => window.__vib);
  const heldOk = held !== "none" && Number(held) <= 0.97, backOk = back === "none" || Number(back) === 1;
  row(`press: held scale ${held}, released ${back}`, heldOk && backOk ? 0 : 1, 0, heldOk && backOk);
  const tickOk = vib.length === 1 && vib[0] === 6;
  row(`press: one tick at touch-down (${JSON.stringify(vib)})`, tickOk ? 0 : 1, 0, tickOk);

  /* signing in again the same day lands the short way */
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k === "lpc-auth" || /^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k); });
  await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(2400);
  row("return sign-in to floor", await signIn(), BAR.returnSignIn);

  const bad = rows.filter((r) => !r.ok);
  if (errs.length) console.log("  page errors: " + errs.join(" | "));
  if (bad.length || errs.length) { console.log(`feel: ${bad.length} over the bar${errs.length ? ", and page errors" : ""}`); process.exitCode = 1; }
  else console.log("feel: all under the bar");
  /* Printed on every run, not only a bad one. A crash is only readable
     against what a run normally costs, and the only place that number can
     come from is the runs that did not crash. C83. */
  const m = machine && machine.line();
  if (m) console.log("feel: the machine: " + m);
}
main().catch((e) => {
  const why = e && e.lostBrowser;
  if (!why) { console.error("feel:", e && e.message ? e.message : e); process.exitCode = 1; return; }
  /* Exit 3 rather than 1, and the job stays red either way. The number is for
     the workflow, which says which of the two happened on the pull request;
     the sentences are for whoever opens the log at seven in the morning. */
  console.log(`  --   ${measured} row(s) measured before the browser went; the rest never ran`);
  console.log(`feel: the browser was lost, ${why}. Nothing here says the phone got worse, because nothing here measured it.`);
  /* After the sentence, not before it: what happened first, then what the
     machine looked like when it did. */
  const m = machine && machine.line();
  if (m) console.log("feel: the machine when it went: " + m);
  console.log("feel: that is C83. Run it again, and if it keeps happening say so with the evidence rather than loosening the check.");
  process.exitCode = 3;
}).finally(() => { if (mockProc) mockProc.kill(); });

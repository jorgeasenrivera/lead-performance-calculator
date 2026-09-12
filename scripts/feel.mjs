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
 * package directory. FEEL_LAG sets the added delay.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_APP = process.env.FEEL_URL || "http://127.0.0.1:5178/";
const MOCK = "http://127.0.0.1:5433";
const LAG = Number(process.env.FEEL_LAG || 400);
const STORE = "sage-demo";
const STORE_TZ = "America/New_York";                 // the app's dealership day
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(new Date());

/* ---- the bar ---- */
const BAR = {
  tab: 150,          // a tab is the screen the phone already had
  tap: 100,          // a tap is drawn in the frame it lands in
  chip: 100,         // a FlyBy sent is a chip at once
  returnSignIn: 900 + 3 * LAG, // signing in again the same day lands the short way: a few round trips, no jump
  press: 120,        // a control has given under the finger by then
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
async function prepFloor() {
  const j = async (u) => (await fetch(u)).json();
  const doc = (await j(MOCK + "/rest/v1/app_data?select=key,value")).find((r) => r.key === `lpc:store:${STORE}:v2`);
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
const say = (m) => { if (process.env.FEEL_DEBUG) process.stderr.write("feel: " + m + "\n"); };
async function main() {
  await ensureMock(); say("mock up");
  floor = await prepFloor(); say("floor prepared for " + floor.id);
  const b = await launch(); say("browser up");
  try { await run(b); } finally { await b.close().catch(() => {}); }
}
async function run(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (LAG) await ctx.route(/127\.0\.0\.1:5433/, async (r) => { await new Promise((z) => setTimeout(z, LAG)); r.continue(); });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await p.addInitScript(([s]) => {
    try { localStorage.setItem(`lpcf:room:${s}`, "floor"); localStorage.setItem(`lpcf:pref:open:${s}`, "floor"); } catch (e) {}
    window.__vib = []; navigator.vibrate = (v) => { window.__vib.push(v); return true; };
  }, [STORE]);
  const rows = [];
  const line = (r) => `  ${r.ok ? "ok  " : "OVER"} ${r.name.padEnd(46)} ${r.bar ? String(r.value).padStart(5) + " ms  bar " + r.bar : ""}`;
  const row = (name, value, bar, ok = value <= bar) => { const r = { name, value, bar, ok }; rows.push(r); console.log(line(r)); };
  console.log(`feel · ${LAG} ms on every data request · ${URL_APP}`);

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

  /* tabs: the other room is already mounted */
  let t = Date.now(); await p.locator('.ar-tab[aria-label="Live Floor"]').click(); await p.waitForSelector(".sf-seg-btn", { timeout: 30000 }); row("Home to Floor tab", ms(t), BAR.tab);
  await p.waitForTimeout(800);
  const segOn = (label) => p.waitForFunction((l) => { const b = [...document.querySelectorAll(".sf-seg-btn")].find((x) => x.textContent.includes(l)); return b && /\bon\b/.test(b.className); }, label, { timeout: 15000 });
  t = Date.now(); await p.locator('.sf-seg-btn:has-text("Lunch")').click(); await segOn("Lunch"); row("tap Lunch to shown", ms(t), BAR.tap);
  await p.waitForTimeout(700);
  t = Date.now(); await p.locator('.sf-seg-btn:has-text("Here")').click(); await segOn("Here"); row("tap Here to shown", ms(t), BAR.tap);
  await p.waitForTimeout(700);
  t = Date.now(); await p.locator('.ar-tab[aria-label*="Phone"]').click(); await p.waitForSelector(".sfl-title, .mcf-home", { timeout: 30000 }); row("Floor to Phone tab", ms(t), BAR.tab);
  await p.waitForTimeout(600);
  t = Date.now(); await p.locator('.ar-tab[aria-label="Live Floor"]').click(); await p.waitForSelector(".sf-seg-btn", { timeout: 30000 }); row("Phone to Floor tab", ms(t), BAR.tab);
  await p.waitForTimeout(800);

  /* two taps inside one round trip: the screen shows the second and stays, the server ends on it */
  const onSeg = () => p.evaluate(() => { const b = [...document.querySelectorAll(".sf-seg-btn")].find((x) => /\bon\b/.test(x.className)); return b ? b.textContent.trim() : null; });
  const seen = []; const t0 = Date.now();
  const sampler = (async () => { while (Date.now() - t0 < 3200) { seen.push(await onSeg()); await p.waitForTimeout(40); } })();
  await p.locator('.sf-seg-btn:has-text("Lunch")').click({ force: true }); await p.waitForTimeout(120);
  await p.locator('.sf-seg-btn:has-text("Here")').click({ force: true });
  await sampler;
  const trace = seen.filter((v, i) => i === 0 || v !== seen[i - 1]);
  const server = (await (await fetch(`${MOCK}/rest/v1/floor_public?id=eq.${floor.id}&select=data`)).json())[0]?.data;
  const mine = ((server && server.line) || []).find((x) => x.id === floor.me.id);
  const burstOk = trace[trace.length - 1] === "Here" && trace.indexOf("Lunch") >= 0 && trace.indexOf("Lunch") < trace.lastIndexOf("Here") && mine && mine.status === "waiting";
  row("two taps in one round trip: " + trace.join(" > ") + ", server " + (mine ? mine.status : "?"), burstOk ? 0 : 1, 0, burstOk);

  /* a FlyBy sent is a chip at once, and taken back at once */
  await p.locator(".fba-btn.fly").click(); await p.waitForSelector(".fba-sheet.ask");
  await p.locator('.fba-go:has-text("Send the FlyBy")').click(); t = Date.now(); await p.waitForSelector(".fba-chip", { timeout: 5000 }); row("FlyBy sent to chip", ms(t), BAR.chip);
  await p.waitForTimeout(300); await p.locator(".fba-x").click(); t = Date.now(); await p.waitForSelector(".fba-chip", { state: "detached", timeout: 5000 }); row("Never mind to chip gone", ms(t), BAR.chip);
  await p.waitForTimeout(600);

  /* the press: held, the segment has given by the bar; let go, it is back; one
     tick at touch-down and nothing on the click. The segment already chosen,
     so the click changes nothing and no pattern plays for a change of state. */
  const cdp = await ctx.newCDPSession(p);
  const seg = (label) => `[...document.querySelectorAll(".sf-seg-btn")].find((b) => b.textContent.includes("${label}"))`;
  const box = await p.evaluate(`(() => { const r = ${seg("Here")}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await p.evaluate(() => { window.__vib.length = 0; });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
  await p.waitForTimeout(BAR.press);
  const held = await p.evaluate(`getComputedStyle(${seg("Here")}).scale`);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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
}
main().catch((e) => { console.error("feel:", e && e.message ? e.message : e); process.exitCode = 1; }).finally(() => { if (mockProc) mockProc.kill(); });

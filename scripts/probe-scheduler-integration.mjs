/**
 * Probe: the scheduler, wired into the real dashboard, in a real browser.
 * -------------------------------------------------------------------------
 * Builds the actual app with the scheduler flag on against the local mock backend (scripts/mock-supabase.mjs),
 * signs in as the demo manager and drives both entries (the desktop dialog and the phone's compact calendar)
 * through the real loader and the real reader, with synthetic delivery rows served from this script. What it
 * checks, each with a way to fail:
 *
 *   - the reader asks only when the calendar is opened, with the sign-in's token, and shows what it is given;
 *   - an unavailable answer offers a retry, and the retry works;
 *   - a new sign-in masks the records and the numbers at once and starts no request of its own;
 *   - a token that only rotated (same session) changes nothing;
 *   - a new sign-in while the store is still loading is not accepted, and the dashboard says so;
 *   - a refresh answered after the sign-in changed is not adopted;
 *   - the planner opens, closes without a question when clean, and asks before it discards changes by every way
 *     out (Close, the scrim, Escape on the page, Escape inside the planner, leaving the page); the page behind it
 *     is out of reach; a change of sign-in removes it with no question at all;
 *   - repeated opens leave nothing behind; no sideways scroll; focus lands in the dialog.
 *
 * Nothing leaves the machine: every request to anywhere but the local servers is blocked in the browser, counted,
 * and fails the run. Nothing is saved to any backend by this probe except the mock's own rows.
 *
 *   node scripts/probe-scheduler-integration.mjs
 *   FEEL_BROWSER=webkit node scripts/probe-scheduler-integration.mjs
 *   PROBE_EVIDENCE_DIR=dir ...      keeps result JSON, blocked requests, and screenshots on failure
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = "http://127.0.0.1:5433";
const STORE = "sage-demo";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const evidenceDir = process.env.PROBE_EVIDENCE_DIR || null;

/* ------------------------------------------------------------------ the pieces */
async function up(url) { try { const r = await fetch(url); return r.status > 0; } catch { return false; } }

async function startMock() {
  if (await up(`${MOCK}/auth/v1/user`)) throw new Error("something is already listening on 5433; stop it so the probe has the mock to itself");
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/mock-supabase.mjs")], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50 && !(await up(`${MOCK}/auth/v1/user`)); i++) await new Promise((r) => setTimeout(r, 100));
  return child;
}

async function buildApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "si-probe-"));
  Object.assign(process.env, { VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: "mock-anon-key", VITE_SCHEDULER_CALENDAR: "1" });
  const { build } = await import(pathToFileURL(path.join(ROOT, "node_modules/vite/dist/node/index.js")).href);
  await build({ root: ROOT, logLevel: "error", build: { outDir: dir, emptyOutDir: true } });
  // A build that was pointed anywhere but the local mock stops here, before a browser opens: the bundle must name the
  // mock and must not name the production project or any hosted backend.
  const bundle = fs.readdirSync(path.join(dir, "assets")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dir, "assets", f), "utf8")).join("\n");
  assert.ok(bundle.includes(MOCK), "the build names the local mock as its backend");
  assert.ok(!bundle.includes("dydfevdnpppvxgdptiwv"), "the build does not name the production project");
  assert.ok(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(bundle.replace(/https:\/\/supabase\.com[^"']*/g, "")), "the build names no hosted backend");
  return dir;
}

function serve(dist, seen) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(dist, pathname);
    const missing = !file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory();
    // A route with no file extension is the app; a file that is not there is not found, never the app's page.
    if (missing && path.extname(pathname)) { res.writeHead(404).end(); return; }
    if (missing) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

async function launch() {
  let pw;
  const at = process.env.FEEL_PLAYWRIGHT;
  if (at) { const entry = fs.existsSync(path.join(at, "index.mjs")) ? path.join(at, "index.mjs") : at; pw = await import(pathToFileURL(entry).href); }
  else pw = await import("playwright");
  if (String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit") return { name: "webkit", browser: await pw.webkit.launch() };
  return { name: "chromium", browser: await pw.chromium.launch({ executablePath: process.env.FEEL_CHROME || undefined, args: process.env.FEEL_CHROME ? ["--no-sandbox"] : [] }) };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// An unsigned token with the two claims the reported-auth adapter reads: who, and which session.
const jwt = (sid, jti = "first") => `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: USER_ID, session_id: sid, jti, exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const SID_A = "11111111-1111-4111-8111-111111111111", SID_B = "22222222-2222-4222-8222-222222222222";
const sessionOf = (sid, extra = {}, jti = "first") => ({
  access_token: jwt(sid, jti), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh",
  user: { id: USER_ID, email: "demo@sageonline.app", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }, ...extra,
});

const monthRows = (store, month) => {
  const [y, m] = month.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { storeId: store, month, days: Array.from({ length: n }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return i < 5
      ? { date, status: "provisional", count: i + 2, vehicles: { new: i + 2, used: 0 }, asOf: { timestamp: `${month}-14T22:05:00.000Z`, basis: "report_sent" } }
      : { date, status: "missing", count: null, vehicles: { new: null, used: null }, asOf: null };
  }) };
};
const DELIVERED = /20 delivered on 5 recorded days/;

// What the dashboard itself lists, read from its own People tab: the core's copy, not the scheduler's view of it.
async function dashboardPeople(page) {
  await page.getByRole("button", { name: "People", exact: true }).first().click();
  await page.waitForTimeout(600);
  const text = await page.locator("body").innerText();
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  return text;
}
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

/* ------------------------------------------------------------------ a signed-in dashboard */
async function openApp(browser, base, { width = 1280, height = 900, touch = false, blocked, errors, name }) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const state = { deliveries: [], answer: "ok", holdStore: null, storeHeld: null, failStore: false, storeReads: 0, dialogs: [] };
  await ctx.route("**/*", async (route) => {
    const target = route.request().url();
    const origin = new URL(target).origin;
    if (origin === new URL(base).origin || origin === MOCK) {
      if (origin === MOCK && /\/auth\/v1\/token/.test(target)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessionOf(SID_A)) });
      const storeRow = origin === MOCK && /\/rest\/v1\/app_data/.test(target) && /lpc(%3A|:)store(%3A|:)sage-demo/.test(target) && !/day/.test(target) && !/select=updated_at/.test(target);
      if (storeRow && route.request().method() === "GET") state.storeReads += 1;
      if (storeRow && state.failStore && route.request().method() === "GET") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      if (storeRow && state.holdStore) {
        state.storeHeld = true;
        await state.holdStore.promise;
        state.holdStore = null;
        // The answer that was in flight when the sign-in changed carries somebody who must never be shown.
        const real = await route.fetch();
        const body = await real.json();
        const doc = Array.isArray(body) ? body[0] : body;
        if (doc && doc.value && Array.isArray(doc.value.roster)) doc.value.roster = [...doc.value.roster, { id: "stale-sam", name: "Stale Sam", roleId: "sales" }];
        return route.fulfill({ response: real, body: JSON.stringify(body) });
      }
      return route.continue();
    }
    blocked.push(`${name}: ${route.request().method()} ${target}`);
    return route.abort("blockedbyclient");
  });
  await ctx.routeWebSocket(/.*/, (socket) => {
    // The mock has no realtime; a socket to it is refused the way it always was. Anything else is blocked and counted.
    const target = socket.url();
    if (new URL(target).host === new URL(MOCK).host) { socket.close(); return; }
    blocked.push(`${name}: WEBSOCKET ${target}`);
    socket.close();
  });
  const page = await ctx.newPage();
  states.push({ name, state });
  page.on("console", (m) => { if (consoleLog.length < 40) consoleLog.push(`${name}: ${m.type()} ${m.text().slice(0, 240)}`); });
  page.on("pageerror", (e) => errors.push(`${name}: ${String(e).slice(0, 300)}`));
  page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
  await page.route("**/api/daily-deliveries**", (route) => {
    const u = new URL(route.request().url());
    state.deliveries.push({ store: u.searchParams.get("store"), month: u.searchParams.get("month"), auth: route.request().headers().authorization || "" });
    if (state.answer === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(monthRows(u.searchParams.get("store"), u.searchParams.get("month"))) });
  });
  return { ctx, page, state };
}

async function signIn(page, entry) {
  await page.goto(entry.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.fill('input[type="email"], input[autocomplete="username"]', "demo@sageonline.app");
  await page.fill('input[type="password"]', "x");
  await page.click('button:has-text("Sign in")');
}
async function settle(page, selector) {
  await page.waitForSelector(selector, { timeout: 45000 });
  // The daily round-up covers the dashboard once, and belongs to another check; close it as a person would.
  for (let i = 0; i < 25; i++) {
    const close = page.getByRole("button", { name: "Close the round-up", exact: true });
    if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); break; }
    await page.waitForTimeout(400);
  }
}
// Another tab of the same browser tells this one that the sign-in changed, as a real second tab would.
async function announce(ctx, base, event, sid, jti = "first") {
  const other = await ctx.newPage();
  await other.goto(new URL("/robots.txt", base).href);
  // The browser's stored session changes first, as it does when another tab signs in, then the tab is told.
  await other.evaluate(([event, session]) => {
    localStorage.setItem("lpc-auth", JSON.stringify(session));
    const c = new BroadcastChannel("lpc-auth"); c.postMessage({ event, session }); c.close();
  }, [event, sessionOf(sid, {}, jti)]);
  await other.close();
}

/* ------------------------------------------------------------------ the run */
const results = {}, blocked = [], errors = [], seen = [], consoleLog = [], states = [];
let failure = null;
const mock = await startMock();
const dist = await buildApp();
const entry = await serve(dist, seen);
const { name: engine, browser } = await launch();
const step = async (label, fn) => { await fn(); results[label] = "ok"; };

try {
  /* ---- desktop: the reader, the retry, a new sign-in, a rotated token */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "desktop" });
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    const wide = page.locator(".sc-entry .sc-toggle");

    await step("desktop reader asks only when opened", async () => {
      assert.equal(state.deliveries.length, 0, "no request before the calendar is opened");
      await wide.click();
      await page.waitForSelector(".sc-dialog");
      await page.getByText(DELIVERED).waitFor();
      assert.equal(state.deliveries.length, 1);
      assert.deepEqual([state.deliveries[0].store, state.deliveries[0].auth.startsWith("Bearer ey")], [STORE, true], "the sign-in's own token, for this store");
    });

    await step("desktop repeated opens leave nothing behind", async () => {
      for (let i = 0; i < 3; i++) {
        await page.click(".sc-dialog .sc-close");
        await page.waitForSelector(".sc-dialog", { state: "detached" });
        assert.equal(await page.evaluate(() => document.body.style.overflow), "", "page scroll given back");
        await wide.click();
        await page.waitForSelector(".sc-dialog");
        await page.getByText(DELIVERED).waitFor();
      }
      assert.ok(state.deliveries.length <= 4, `one request per open at most, saw ${state.deliveries.length}`);
    });

    await step("desktop focus and overflow", async () => {
      assert.equal(await page.evaluate(() => document.activeElement?.className), "sc-close", "focus lands in the dialog");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    });

    await step("desktop token rotation changes nothing", async () => {
      await announce(ctx, entry.url, "TOKEN_REFRESHED", SID_A, "rotated");
      await page.waitForTimeout(600);
      await page.getByText(DELIVERED).waitFor({ timeout: 2000 });
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 1, "still allowed to plan");
      // Closed and opened again, the reader asks with the rotated token, and the records are still this person's.
      await page.click(".sc-dialog .sc-close");
      await page.waitForSelector(".sc-dialog", { state: "detached" });
      await wide.click();
      await page.getByText(DELIVERED).waitFor();
      const used = JSON.parse(Buffer.from(state.deliveries.at(-1).auth.split(" ")[1].split(".")[1], "base64url").toString());
      assert.equal(used.jti, "rotated", "the next request carries the rotated token");
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 1);
    });

    await step("desktop a new sign-in masks at once and asks for nothing", async () => {
      const before = state.deliveries.length;
      await announce(ctx, entry.url, "SIGNED_IN", SID_B);
      await page.waitForFunction((re) => !new RegExp(re).test(document.querySelector(".sc-dialog")?.innerText || ""), DELIVERED.source, { timeout: 3000 });
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 0, "no planner from another sign-in's records");
      await page.waitForTimeout(800);
      assert.equal(state.deliveries.length, before, "and no request made on the strength of them");
      assert.equal(state.dialogs.length, 0, "no question asked about it");
    });
    await ctx.close();
  }

  /* ---- desktop: unavailable answer and retry */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "retry" });
    state.answer = "fail";
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    await step("retry after an unavailable answer", async () => {
      await page.click(".sc-entry .sc-toggle");
      await page.waitForSelector(".sc-retry:has-text('Try again')");
      assert.equal(await page.getByText(DELIVERED).count(), 0, "nothing invented in its place");
      state.answer = "ok";
      await page.click(".sc-retry:has-text('Try again')");
      await page.getByText(DELIVERED).waitFor();
      assert.ok(state.deliveries.length >= 2);
    });
    await ctx.close();
  }

  /* ---- desktop: a new sign-in while the store is loading */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "loading" });
    state.holdStore = defer();
    await signIn(page, entry);
    await page.waitForFunction(() => true);
    for (let i = 0; i < 100 && !state.storeHeld; i++) await page.waitForTimeout(150);
    await step("a sign-in change during the load is not accepted", async () => {
      assert.ok(state.storeHeld, "the store request was held in flight");
      await announce(ctx, entry.url, "SIGNED_IN", SID_B);
      state.holdStore.resolve();
      // Either the dashboard reads the store again under the sign-in that is current, or it says it could not open and
      // offers its own way to try again. Both end the same way; neither may show what was in flight.
      const t0 = Date.now();
      for (let i = 0; i < 120; i++) {
        if (await page.locator(".sc-entry .sc-toggle").count()) break;
        const again = page.getByRole("button", { name: "Try again" });
        if (await again.isVisible().catch(() => false)) { results["loading-needed-try-again"] = true; await again.click(); }
        await page.waitForTimeout(500);
      }
      await settle(page, ".sc-entry .sc-toggle");
      results["loading-recovery-seconds"] = Math.round((Date.now() - t0) / 1000);
      assert.doesNotMatch(await dashboardPeople(page), /Stale Sam/, "the dashboard itself did not take the answer that was in flight");
      await page.click(".sc-entry .sc-toggle");
      await page.click("button:has-text('Plan the month')");
      const f = page.frameLocator("iframe");
      await f.locator("#app [data-day]").first().waitFor({ timeout: 20000 });
      await f.locator("#workspace").click();
      await f.locator("summary", { hasText: "Schedule tools" }).click();
      await f.locator("#setup").click();
      await f.locator("#people").click();
      const people = await f.locator("#settings-sheet #person").innerText();
      assert.doesNotMatch(people, /Stale Sam/, "the answer that was in flight is not on the roster");
      assert.match(people, /\S/, "and the roster is the real one");
    });
    await ctx.close();
  }

  /* ---- desktop: a copy of a store kept from before the sign-in changed is read again, not shown */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "switch" });
    const demoRow = (await (await fetch(`${MOCK}/rest/v1/app_data?key=eq.lpc%3Astore%3A${STORE}%3Av2&select=*`)).json())[0];
    let secondReads = 0;
    await page.route("**/rest/v1/app_data**", async (route) => {
      const url = route.request().url();
      if (route.request().method() !== "GET") return route.fallback();
      if (/lpc(%3A|:)config(%3A|:)v2/.test(url)) {
        const real = await route.fetch();
        const body = await real.json();
        const row = Array.isArray(body) ? body[0] : body;
        row.value.stores = [...row.value.stores, { ...row.value.stores[0], id: "sage-two", name: "Second Motors" }];
        row.value.standards["sage-two"] = row.value.standards[STORE];
        return route.fulfill({ response: real, body: JSON.stringify(Array.isArray(body) ? [row] : row) });
      }
      if (/lpc(%3A|:)store(%3A|:)sage-two/.test(url) && !/day/.test(url) && !/select=updated_at/.test(url)) {
        secondReads += 1;
        const who = secondReads === 1 ? "Cached Cal" : "Fresh Fran";
        const row = { ...demoRow, key: "lpc:store:sage-two:v2", value: { ...demoRow.value, __storeId: "sage-two", roster: [{ id: "two-1", name: who, roleId: "sales" }] } };
        const single = (route.request().headers().accept || "").includes("pgrst.object");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? row : [row]) });
      }
      return route.fallback();
    });
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    await step("a store's copy from before a sign-in change is read again, not shown", async () => {
      assert.equal(secondReads, 1, "the second store was read once, with the first load");
      await announce(ctx, entry.url, "SIGNED_IN", SID_B);
      await page.waitForTimeout(500);
      await page.selectOption(".view-select", "sage-two");
      for (let i = 0; i < 60 && secondReads < 2; i++) await page.waitForTimeout(250);
      assert.ok(secondReads >= 2, "it was read again, not taken from the copy in hand");
      await page.waitForTimeout(800);
      const text = await dashboardPeople(page);
      assert.match(text, /Fresh Fran/, "what is shown is what was read again");
      assert.doesNotMatch(text, /Cached Cal/, "and not the copy from before the sign-in changed");
    });
    await ctx.close();
  }

  /* ---- desktop: a refresh, a refresh answered after the sign-in changed, and a copy the device kept */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "refresh" });
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    await page.click(".sc-entry .sc-toggle");
    await page.getByText(DELIVERED).waitFor();
    const moveStoreRow = () => fetch(`${MOCK}/rest/v1/app_data`, { method: "POST", headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates" }, body: JSON.stringify([{ key: `lpc:store:${STORE}`, updated_at: new Date().toISOString() }]) });
    const refreshNow = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await step("a refresh under the same sign-in keeps the planner available", async () => {
      const reads = state.storeReads;
      await moveStoreRow();
      await refreshNow();
      for (let i = 0; i < 40 && state.storeReads === reads; i++) await page.waitForTimeout(150);
      assert.ok(state.storeReads > reads, "the store was read again");
      await page.waitForTimeout(600);
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 1, "the refreshed copy is stamped like the first");
      await page.getByText(DELIVERED).waitFor({ timeout: 2000 });
    });

    await step("a refresh answered after the sign-in changed is not adopted", async () => {
      state.holdStore = defer();
      state.storeHeld = null;
      await moveStoreRow();
      await refreshNow();
      for (let i = 0; i < 60 && !state.storeHeld; i++) await page.waitForTimeout(150);
      assert.ok(state.storeHeld, "the refresh was in flight");
      await announce(ctx, entry.url, "SIGNED_IN", SID_B);
      state.holdStore.resolve();
      await page.waitForTimeout(1500);
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 0, "nothing from the late answer is allowed to plan");
      assert.equal(await page.getByText(DELIVERED).count(), 0, "or to show numbers");
      await page.click(".sc-dialog .sc-close");
      await page.waitForSelector(".sc-dialog", { state: "detached" });
      assert.doesNotMatch(await dashboardPeople(page), /Stale Sam/, "and the dashboard itself did not adopt the late answer");
    });
    await ctx.close();
  }
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "device-copy" });
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    await page.waitForTimeout(1500);   // the copy the phone remembers is written once a load has finished
    state.failStore = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await step("a copy the device kept is shown without being trusted", async () => {
      await settle(page, ".sc-entry .sc-toggle");
      // The remembered copy stands in, as it always did: the dashboard opens, with nothing about a failed load.
      assert.equal(await page.getByText(/Connection interrupted/i).count(), 0);
      assert.equal(await page.getByText(/didn.t load fully|load reported/i).count(), 0, "no failure notice: the remembered copy is shown");
      assert.match(await page.locator("body").innerText(), /Sage Demo Motors/);
      await page.click(".sc-entry .sc-toggle");
      await page.waitForSelector(".sc-dialog");
      assert.equal(await page.locator("button:has-text('Plan the month')").count(), 0, "unknown provenance: no planner");
      assert.equal(state.deliveries.length, 0, "and no request made for it");
    });
    await step("and once the store is read again it is trusted", async () => {
      state.failStore = false;
      await page.evaluate(() => { try { localStorage.removeItem("never"); } catch (e) {} });
      await fetch(`${MOCK}/rest/v1/app_data`, { method: "POST", headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates" }, body: JSON.stringify([{ key: `lpc:store:${STORE}`, updated_at: new Date().toISOString() }]) });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.locator("button:has-text('Plan the month')").waitFor({ timeout: 15000 });
    });
    await ctx.close();
  }

  /* ---- desktop: the planner and every way out of it */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { blocked, errors, name: "planner" });
    await signIn(page, entry);
    await settle(page, ".sc-entry .sc-toggle");
    const frame = page.frameLocator("iframe");
    const openPlanner = async () => {
      if (!(await page.locator(".sc-dialog:has-text('Deliveries calendar')").count())) await page.click(".sc-entry .sc-toggle");
      await page.click("button:has-text('Plan the month')");
      await frame.locator("#app [data-day]").first().waitFor({ timeout: 20000 });
    };
    const makeDraft = async () => {
      await frame.locator("#workspace").click();
      await frame.locator("summary", { hasText: "Schedule tools" }).click();
      await frame.locator("#setup").click();
      await frame.locator("#people").click();
      await frame.locator("#settings-sheet [name=start]").fill("9");
      await frame.locator("#settings-sheet [name=end]").fill("17");
      await frame.locator("#settings-sheet [name=maxHours]").fill("20");
      await frame.locator("#settings-sheet button", { hasText: "Apply changes" }).click();
      await frame.locator("#message").waitFor({ state: "attached" });
    };
    const planner = () => page.locator("iframe");
    const asks = () => state.dialogs.filter((d) => d.type === "confirm").length;

    await step("planner shows this store's people and says nothing is saved", async () => {
      await openPlanner();
      await frame.locator("#workspace").click();   // the statement sits with the editing tools
      const text = await frame.locator("#app").evaluate((el) => el.textContent);
      assert.match(text, /Nothing here is saved to the schedule/);
      assert.doesNotMatch(text, /synthetic|fictional|\bOak\b|\bPine\b/i);
    });

    await step("planner closes without a question when clean, and focus goes back", async () => {
      await page.click(".sc-dialog:has(iframe) .sc-close");
      await planner().waitFor({ state: "detached" });
      assert.equal(asks(), 0);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Plan the month", "focus is on the button that opened the planner");
    });

    await step("the page behind the planner is out of reach", async () => {
      await openPlanner();
      assert.equal(await page.evaluate(() => [...document.body.children].some((n) => n.hasAttribute("inert"))), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest("[inert]")), false, "focus never reaches the dashboard behind");
      await page.click(".sc-dialog:has(iframe) .sc-close");
      await planner().waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => [...document.body.children].some((n) => n.hasAttribute("inert"))), false, "given back on close");
    });

    // Each way out: the first answer is no (the planner stays), the second is yes (it goes).
    const asked = async (label, attempt) => {
      await step(`planner asks before discarding: ${label}`, async () => {
        await openPlanner();
        await makeDraft();
        const before = asks();
        page.removeAllListeners("dialog");
        let answer = false;
        page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); if (answer) await d.accept(); else await d.dismiss(); });
        await attempt(false);
        await page.waitForTimeout(500);
        assert.equal(asks(), before + 1, "asked once");
        assert.equal(await planner().count(), 1, "and with no it stays");
        answer = true;
        await attempt(true);
        await planner().waitFor({ state: "detached", timeout: 5000 });
        assert.equal(asks(), before + 2);
        page.removeAllListeners("dialog");
        page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
      });
    };
    await asked("the Close button", () => page.click(".sc-dialog:has(iframe) .sc-close"));
    await asked("the scrim", () => page.mouse.click(4, 4));
    await asked("Escape on the page", async (again) => {
      await page.locator(".sc-dialog:has(iframe) .sc-close").focus();
      await page.keyboard.press("Escape");
      if (!again) assert.equal(await page.locator(".sc-dialog:has-text('Deliveries calendar')").count(), 1, "the calendar behind it is not closed by the same key");
    });
    await asked("Escape inside the planner", async (again) => {
      if (!again) await frame.locator("#app").press("Escape");   // the first steps back from editing
      await frame.locator("#app").press("Escape");               // the next asks before leaving
    });

    await step("leaving the page with changes asks", async () => {
      await openPlanner();
      await makeDraft();
      let kind = null;
      page.removeAllListeners("dialog");
      page.on("dialog", async (d) => { kind = d.type(); await d.dismiss(); });
      await page.reload().catch(() => {});
      await page.waitForTimeout(500);
      assert.equal(kind, "beforeunload");
      assert.equal(await planner().count(), 1, "still there");
      page.removeAllListeners("dialog");
      page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
    });

    /* The app's own navigation, driven the way a native action or any code does it: a click dispatched on a control
       that the inert backdrop keeps a person from reaching. Each asks, no keeps the planner and the page, yes goes. */
    const routes = [
      ["a tab", () => page.locator(".seg-wrap button", { hasText: /^Summary$/ }).first(), async () => (await page.locator(".seg-wrap button.on, .seg-wrap button[aria-pressed=true], .seg-wrap [aria-selected=true]").first().innerText().catch(() => "")).trim()],
      ["the import button", () => page.locator(".manager-context-action").first(), null],
    ];
    for (const [label, target, current] of routes) {
      await step(`the app's own navigation asks before discarding: ${label}`, async () => {
        const live = await planner().count();
        if (!live) { await openPlanner(); await makeDraft(); }
        const before = asks();
        const was = current ? await current() : null;
        page.removeAllListeners("dialog");
        let answer = false;
        page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); if (answer) await d.accept(); else await d.dismiss(); });
        await target().evaluate((el) => el.click());
        await page.waitForTimeout(500);
        assert.equal(asks(), before + 1, "asked once");
        assert.equal(await planner().count(), 1, "and with no the planner stays");
        if (current) assert.equal(await current(), was, "and so does the page");
        answer = true;
        await target().evaluate((el) => el.click());
        await planner().waitFor({ state: "detached", timeout: 5000 });
        assert.equal(asks(), before + 2, "asked again, and with yes it goes");
        page.removeAllListeners("dialog");
        // Back to where the next step expects to start: the page as it opens, which a reload gives.
        await page.reload();
        await settle(page, ".sc-entry .sc-toggle");
        page.on("dialog", async (d) => { state.dialogs.push({ type: d.type(), message: d.message() }); await d.dismiss(); });
      });
    }
    await step("a change of sign-in removes the planner with no question", async () => {
      const before = state.dialogs.length;
      await announce(ctx, entry.url, "SIGNED_IN", SID_B);
      await planner().waitFor({ state: "detached", timeout: 3000 });
      assert.equal(state.dialogs.length, before, "no veto on records that are no longer this person's");
      assert.equal(await page.evaluate(() => [...document.body.children].some((n) => n.hasAttribute("inert"))), false);
    });
    await ctx.close();
  }

  /* ---- phone: the compact calendar and the planner */
  {
    const { ctx, page, state } = await openApp(browser, entry.url, { width: 393, height: 852, touch: true, blocked, errors, name: "phone" });
    await signIn(page, entry);
    await settle(page, ".sc-calendar .sc-toggle, .sc-toggle");
    const toggle = page.locator(".sc-toggle").first();
    await step("phone reader asks only when opened", async () => {
      assert.equal(state.deliveries.length, 0);
      await toggle.tap();
      await page.getByText(DELIVERED).first().waitFor();
      assert.equal(state.deliveries.length, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    });
    await step("phone planner opens and a dirty close asks", async () => {
      await page.getByRole("button", { name: "Plan the month" }).first().tap();
      const frame = page.frameLocator("iframe");
      await frame.locator("#app [data-day]").first().waitFor({ timeout: 20000 });
      await frame.locator("#workspace").tap();
      await frame.locator("summary", { hasText: "Schedule tools" }).tap();
      await frame.locator("#setup").tap();
      await frame.locator("#people").tap();
      await frame.locator("#settings-sheet [name=start]").fill("9");
      await frame.locator("#settings-sheet [name=end]").fill("17");
      await frame.locator("#settings-sheet [name=maxHours]").fill("20");
      await frame.locator("#settings-sheet button", { hasText: "Apply changes" }).tap();
      const before = state.dialogs.filter((d) => d.type === "confirm").length;
      await page.locator(".sc-dialog:has(iframe) .sc-close").tap();
      await page.waitForTimeout(500);
      assert.equal(state.dialogs.filter((d) => d.type === "confirm").length, before + 1);
      assert.equal(await page.locator("iframe").count(), 1, "kept on no");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await ctx.close();
  }

  assert.deepEqual(blocked, [], "no request left the probe's own servers");
  assert.deepEqual(errors, [], "no page errors");
  results.requests = `${seen.length} local`;
  results.blocked = `${blocked.length} external`;
  console.log(JSON.stringify({ engine, results }, null, 2));
} catch (e) {
  failure = e;
  throw e;
} finally {
  if (evidenceDir) {
    try {
      fs.mkdirSync(evidenceDir, { recursive: true });
      let shot = 0;
      if (failure) for (const context of browser.contexts()) for (const open of context.pages()) {
        try { await open.screenshot({ path: path.join(evidenceDir, `failure-${engine}-${++shot}.png`), timeout: 5000 }); } catch { /* the page may be gone */ }
      }
      // What the reader's own request does in this engine, asked the same way it asks, so a failure says why.
      const diagnosis = [];
      if (failure) for (const context of browser.contexts()) for (const open of context.pages()) {
        try {
          diagnosis.push(await open.evaluate(async () => {
            try {
              const r = await fetch("/api/daily-deliveries?store=sage-demo&month=2026-10", { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Authorization: "Bearer a.b.c" } });
              return { status: r.status, redirected: r.redirected, json: typeof r.json, body: (await r.text()).slice(0, 80) };
            } catch (e) { return { error: String(e) }; }
          }));
        } catch (e) { diagnosis.push({ evaluate: String(e).slice(0, 120) }); }
      }
      fs.writeFileSync(path.join(evidenceDir, `result-${engine}.json`), JSON.stringify({
        engine, passed: !failure, results, blocked, errors, console: consoleLog, deliveriesSeen: states.map((x) => [x.name, x.state.deliveries.length]), diagnosis,
        failure: failure ? { message: String(failure.message || failure).slice(0, 2000), stack: String(failure.stack || "").slice(0, 4000) } : null,
      }, null, 2));
    } catch { /* evidence is best effort */ }
  }
  await browser.close();
  entry.server.close();
  mock.kill();
  fs.rmSync(dist, { recursive: true, force: true });
}

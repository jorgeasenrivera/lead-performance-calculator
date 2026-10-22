/**
 * Probe: the hosted scheduler editor, in a real browser.
 * -------------------------------------------------------------------------
 * Builds src/scheduler-editor.jsx on its own (nothing in the app imports it yet), mounts it with
 * synthetic records, and checks what a person would meet: the store's own people and no fixture
 * ones, the injected store date, the masked and switched store, callbacks, and a clean unmount
 * (no listener, frame or page class left behind) across repeated mounts. It opens no connection
 * but the local page server: every HTTP request and WebSocket to anywhere else is blocked in the browser, counted, and
 * fails the run (counting what the local server saw could not show an attempt that never reached it).
 *
 * PROBE_EVIDENCE_DIR keeps a machine-readable result, the blocked and page-error lists and, on a
 * failure, a screenshot of every open page, whether the run passed or not.
 *
 *   node scripts/probe-scheduler-editor.mjs
 *   FEEL_BROWSER=webkit node scripts/probe-scheduler-editor.mjs
 *
 * Needs Playwright (FEEL_PLAYWRIGHT or the project's own).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const NOW = "2026-10-14T16:00:00.000Z";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "se-probe-"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>probe</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(dir, "main.jsx"), `import { createRoot } from "react-dom/client";
import SchedulerEditor from ${JSON.stringify(path.join(ROOT, "src/scheduler-editor.jsx"))};
import { mountMonthApp } from ${JSON.stringify(path.join(ROOT, "scripts/scheduler-performance/month-app-core.mjs"))};
import { editorProps } from ${JSON.stringify(path.join(ROOT, "src/scheduler-editor-adapter.mjs"))};
const root = createRoot(document.getElementById("root"));
window.__events = [];
window.__haptics = 0;
document.addEventListener("sage-preview-haptic", () => { window.__haptics += 1; });
window.__render = (props) => root.render(<SchedulerEditor {...props} now={new Date(props.now)} onClose={() => window.__events.push("close")} onSummary={(d) => window.__events.push("summary:" + d.store + ":" + d.month)} onError={(e) => window.__events.push("error:" + e.message)} />);
window.__unmount = () => root.unmount();
// The core mounted straight into this page, to see exactly what it attaches here and what dispose takes back.
window.__direct = (id) => {
  const el = document.createElement("main");
  el.id = "direct"; el.className = "keep-me";
  document.body.append(el);
  const p = editorProps({ store: { id }, data: { __storeId: id, roster: [{ id: "x", name: "Xan", roleId: "r" }], daysOff: { x: ["2026-10-05"] } }, timezone: "America/New_York", principalEpoch: 1, dataEpoch: 1, now: new Date("${NOW}") });
  window.__handle = mountMonthApp({ root: el, stores: p.stores, assignmentForDay: p.assignmentForDay, peopleForMonth: p.peopleForMonth, today: p.today, embedded: true, onSummary: () => {}, onClose: () => {} });
};
window.__undirect = () => { window.__handle.dispose(); window.__handle.dispose(); document.getElementById("direct").remove(); };
`);
  const { build: viteBuild } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  await viteBuild({ root: dir, configFile: false, logLevel: "error", plugins: [react()], build: { outDir: path.join(dir, "dist"), emptyOutDir: true, minify: false } });
  return path.join(dir, "dist");
}
function serve(dist, seen) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const file = path.join(dist, new URL(req.url, "http://x").pathname.replace(/^\/+/, "") || "index.html");
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
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
  return { name: "chromium", browser: await pw.chromium.launch({ executablePath: process.env.FEEL_CHROME || undefined }) };
}

const data = (id, names) => ({
  __storeId: id,
  roster: names.map((n, i) => ({ id: `${id}-${i}`, name: n, roleId: "sales" })),
  departed: [], daysOff: { [`${id}-0`]: ["2026-10-05"] }, forcedOff: {}, presentAnyway: {}, scheduleSource: {},
});
const props = (id, names, extra = {}) => ({ store: { id, name: id }, data: data(id, names), timezone: "America/New_York", now: NOW, principalEpoch: 1, dataEpoch: 1, ...extra });
const FIXTURE_WORDS = /Oak|Pine|Person \d|fictional/i;
const PLACEHOLDER = /synthetic|fictional|fixture|illustrative|\bpreview\b|in-memory|\bOak\b|\bPine\b/i;

const dist = await build();
const requests = [];
const { server, url } = await serve(dist, requests);
const { name: engine, browser } = await launch();
const results = {};
const blocked = [], pageErrors = [], evidenceDir = process.env.PROBE_EVIDENCE_DIR || null;
let failure = null;
try {
  for (const vp of [{ name: "phone", width: 393, height: 852, touch: true }, { name: "desktop", width: 1280, height: 900, touch: false }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
    // Only the probe's own page server may be reached. Anything else is refused here, before it leaves the browser.
    await ctx.route("**/*", (route) => {
      const target = route.request().url();
      if (new URL(target).origin === new URL(url).origin) return route.continue();
      blocked.push(`${vp.name}: ${route.request().method()} ${target}`);
      return route.abort("blockedbyclient");
    });
    // A WebSocket is not an HTTP route: it needs its own guard.
    await ctx.routeWebSocket(/.*/, (socket) => {
      const target = socket.url();
      if (new URL(target).host === new URL(url).host) { socket.connectToServer(); return; }
      blocked.push(`${vp.name}: WEBSOCKET ${target}`);
      socket.close();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => { errors.push(String(e)); pageErrors.push(`${vp.name}: ${String(e)}`); });
    page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()); });
    // Count what the editor leaves attached to the page it sits in.
    await page.addInitScript(() => {
      const live = new Map();
      const track = (target, label) => {
        const add = target.addEventListener, remove = target.removeEventListener;
        target.addEventListener = function (type, fn, opts) { const k = `${label}:${type}`; live.set(k, (live.get(k) || 0) + 1); return add.call(this, type, fn, opts); };
        target.removeEventListener = function (type, fn, opts) { const k = `${label}:${type}`; live.set(k, (live.get(k) || 0) - 1); return remove.call(this, type, fn, opts); };
      };
      track(window, "window"); track(document, "document");
      window.__live = () => Object.fromEntries([...live].filter(([, n]) => n !== 0));
    });
    await page.goto(url);
    await page.waitForFunction(() => typeof window.__render === "function");
    const frameText = async () => (await page.frameLocator("iframe").locator("#app").innerText());

    /* ---- dispose takes back everything the core attached to the page it was mounted in */
    const base = await page.evaluate(() => window.__live());
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__direct("store-d"));
      await page.locator("#direct [data-day]").first().waitFor();
      if (i === 0) assert.notDeepEqual(await page.evaluate(() => window.__live()), base, `${vp.name}: the core does attach listeners here`);
      await page.locator("#direct #day-2026-10-14").click();
      await page.evaluate(() => window.__undirect());
      assert.deepEqual(await page.evaluate(() => window.__live()), base, `${vp.name}: dispose took back every listener (round ${i})`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("day-modal-open")), false);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--month-bar-height")), "");
    results[`${vp.name}-dispose`] = "ok";

    await page.evaluate(() => { window.__haptics = 0; }); // the direct mounts above sit in this very document
    /* ---- the store's own people and date */
    const before = await page.evaluate(() => window.__live());
    await page.evaluate((p) => window.__render(p), props("store-a", ["Rae Alder", "Sam Birch"]));
    await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    const text = await frameText();
    assert.doesNotMatch(text, FIXTURE_WORDS, `${vp.name}: no fixture words in the editor`);
    const todayId = await page.frameLocator("iframe").locator("[aria-current=date]").getAttribute("id");
    assert.equal(todayId, "day-2026-10-14", `${vp.name}: the injected store date is today`);
    const marked = await page.frameLocator("iframe").locator("#app").evaluate((el) => el.dataset.hapticMonth);
    assert.equal(marked, "2026-10");
    results[`${vp.name}-date`] = "ok";

    /* ---- nothing fictional in the markup, closed disclosures included, and no haptic event on the outer page */
    const all = await page.frameLocator("iframe").locator("#app").evaluate((el) => el.textContent);
    assert.doesNotMatch(all, /synthetic|fictional|\bOak\b|\bPine\b/i, `${vp.name}: no placeholder wording anywhere in the editor`);
    await page.frameLocator("iframe").locator("#workspace").click();
    const editing = await page.frameLocator("iframe").locator("#app").evaluate((el) => el.textContent);
    assert.doesNotMatch(editing, PLACEHOLDER, `${vp.name}: none while editing either`);
    assert.match(editing, /Nothing here is saved to the schedule/, `${vp.name}: the editor says plainly that nothing is saved`);
    // Making a monthly draft rests on invented eligibility and demand, so it says it is not available.
    await page.frameLocator("iframe").locator("summary", { hasText: "Schedule tools" }).click();
    await page.frameLocator("iframe").locator("#generate-month").click();
    assert.match(await page.frameLocator("iframe").locator("#message").textContent(), /not available yet/, `${vp.name}: generation says it is not available`);
    assert.equal(await page.frameLocator("iframe").locator("#generation-sheet").getAttribute("hidden") !== null || (await page.frameLocator("iframe").locator("#generation-sheet").innerHTML()) === "", true, `${vp.name}: no generation sheet opened`);
    // A day opened and the tools used: the wording that appears there is checked too.
    await page.frameLocator("iframe").locator("#day-2026-10-15").click();
    const dayText = await page.frameLocator("iframe").locator("#app").evaluate((el) => el.textContent);
    assert.doesNotMatch(dayText, PLACEHOLDER, `${vp.name}: none on a day sheet`);
    assert.match(editing, /Monday–Sunday · America\/New_York/, `${vp.name}: the store's own zone is named`);
    assert.equal(await page.evaluate(() => window.__haptics), 0, `${vp.name}: no haptic event reached the outer page`);

    /* ---- People opens for real ids */
    if (await page.frameLocator("iframe").locator("#mobile-day-dialog").isVisible()) await page.frameLocator("iframe").getByRole("button", { name: /back to calendar|back/i }).first().click();
    await page.frameLocator("iframe").locator("details.schedule-tools").evaluate((d) => { d.open = true; });
    await page.frameLocator("iframe").locator("#setup").click();
    await page.frameLocator("iframe").locator("#people").click();
    await page.frameLocator("iframe").locator("#settings-sheet #person").waitFor();
    assert.match(await page.frameLocator("iframe").locator("#settings-sheet #person").innerText(), /Rae Alder/);
    assert.deepEqual(errors, [], `${vp.name}: People opened without an error`);
    await page.keyboard.press("Escape");
    await page.frameLocator("iframe").locator("#workspace").waitFor();

    /* ---- no sideways scroll in the host or the frame */
    const widths = await page.evaluate(() => ({ host: document.documentElement.scrollWidth <= innerWidth, frame: (() => { const d = document.querySelector("iframe").contentDocument.documentElement; return d.scrollWidth <= d.clientWidth + 1; })() }));
    assert.deepEqual(widths, { host: true, frame: true }, `${vp.name}: no sideways scroll`);

    /* ---- Escape closes through the host's callback */
    await page.frameLocator("iframe").locator("#day-2026-10-14").focus();
    // Editing steps back to the roster first; the next Escape leaves.
    for (let i = 0; i < 3 && !(await page.evaluate(() => window.__events)).includes("close"); i++) { await page.frameLocator("iframe").locator("#app").press("Escape"); }
    assert.ok((await page.evaluate(() => window.__events)).includes("close"), `${vp.name}: Escape reaches onClose`);
    assert.ok((await page.evaluate(() => window.__events)).some((e) => e.startsWith("summary:store-a:")), `${vp.name}: summary names the real store`);

    /* ---- an empty roster opens, and People says so instead of failing */
    await page.evaluate((p) => window.__render(p), props("store-e", []));
    await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    await page.frameLocator("iframe").locator("#workspace").click();
    await page.frameLocator("iframe").locator("summary", { hasText: "Schedule tools" }).click();
    await page.frameLocator("iframe").locator("#setup").click();
    await page.frameLocator("iframe").locator("#people").click();
    assert.match(await page.frameLocator("iframe").locator("#message").textContent(), /No people are on this store/);
    assert.deepEqual(errors, [], `${vp.name}: empty roster, no error`);
    results[`${vp.name}-empty-roster`] = "ok";

    /* ---- moving between months gives the roster that opening there would */
    const moving = { ...props("store-m", ["Al Park"]), data: { ...data("store-m", []), roster: [
      { id: "m-al", name: "Al Park", roleId: "sales" },
      { id: "m-leaver", name: "Lee Leaver", roleId: "sales" },
      { id: "m-newbie", name: "Nia Newbie", roleId: "sales", hiredAt: "2026-11-05" },
    ], departed: [{ id: "m-leaver", at: "2026-10-20" }], daysOff: { "m-newbie": ["2026-11-10"] } } };
    await page.evaluate((p) => window.__render(p), moving);
    const f = page.frameLocator("iframe");
    await f.locator("#day-2026-10-12").click();
    let roster = await f.locator("#app").evaluate((el) => el.textContent);
    assert.match(roster, /Lee Leaver/, `${vp.name}: October has the person who left on the 20th`);
    assert.doesNotMatch(roster, /Nia Newbie/, `${vp.name}: October does not have the person who starts in November`);
    if (await f.locator("#mobile-day-dialog").isVisible()) await f.getByRole("button", { name: /back to calendar|back/i }).first().click();
    await f.locator("#next").click();
    await f.locator("#day-2026-11-10").click();
    roster = await f.locator("#app").evaluate((el) => el.textContent);
    assert.match(roster, /Nia Newbie/, `${vp.name}: November has the new person, after moving there from October`);
    assert.doesNotMatch(roster, /Lee Leaver/, `${vp.name}: November does not have the person who left`);
    assert.match(roster, /Nia Newbie[^]{0,200}(Off|off)|(Off|off)[^]{0,200}Nia Newbie/, `${vp.name}: her recorded day off on the 10th is kept`);
    results[`${vp.name}-month-roster`] = "ok";

    /* ---- a new sign-in with the old sign-in's records fails closed */
    await page.evaluate((p) => window.__render(p), props("store-p", ["Pat Dune"]));
    await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    await page.evaluate((p) => window.__render(p), { ...props("store-p", ["Pat Dune"]), principalEpoch: 2 });
    await page.waitForFunction(() => !document.querySelector("iframe"));
    assert.match(await page.locator("#root").innerText(), /Signing in again/);
    assert.doesNotMatch(await page.locator("#root").innerText(), /Pat Dune/, `${vp.name}: the old sign-in's people are not shown`);
    await page.evaluate((p) => window.__render(p), { ...props("store-p", ["Pat Dune"]), principalEpoch: 2, dataEpoch: 2 });
    await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    await page.evaluate((p) => window.__render(p), { ...props("store-p", ["Pat Dune"]), dataEpoch: undefined });
    await page.waitForFunction(() => !document.querySelector("iframe"));
    results[`${vp.name}-principal`] = "ok";

    /* ---- a masked store shows nothing of the last one */
    await page.evaluate((p) => window.__render(p), { ...props("store-b", ["Zed Cole"]), data: data("store-a", ["Rae Alder"]) });
    await page.waitForFunction(() => !document.querySelector("iframe"));
    assert.match(await page.locator("#root").innerText(), /still loading/);
    results[`${vp.name}-masked`] = "ok";

    /* ---- a switch gives a fresh editor for the new store */
    await page.evaluate((p) => window.__render(p), props("store-b", ["Zed Cole"]));
    await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    assert.equal(await page.locator("iframe").count(), 1);
    results[`${vp.name}-switch`] = "ok";

    /* ---- repeated mounts leave nothing behind */
    for (let i = 0; i < 3; i++) {
      await page.evaluate((p) => window.__render(p), props(`store-${i}`, ["Pat Dune"]));
      await page.frameLocator("iframe").locator("#app [data-day]").first().waitFor();
    }
    await page.evaluate(() => window.__unmount());
    await page.waitForFunction(() => !document.querySelector("iframe"));
    const after = await page.evaluate(() => window.__live());
    const leaked = Object.entries(after).filter(([k, n]) => (before[k] || 0) !== n);
    assert.deepEqual(leaked, [], `${vp.name}: listeners left on the host window or document`);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("day-modal-open")), false);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--month-bar-height")), "");
    results[`${vp.name}-unmount`] = "ok";

    assert.deepEqual(errors, [], `${vp.name}: page errors`);
    await ctx.close();
  }
  assert.deepEqual(blocked, [], "no request left the probe's own page server");
  const outside = requests.filter((r) => !/^\/(assets\/|fonts\/|index\.html|$|favicon)/.test(r));
  assert.deepEqual(outside, [], "nothing was requested but the probe's own page");
  results.requests = `${requests.length} local`;
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
        try { await open.screenshot({ path: path.join(evidenceDir, `failure-${engine}-${++shot}.png`), timeout: 5000 }); } catch { /* the page may already be gone */ }
      }
      fs.writeFileSync(path.join(evidenceDir, `result-${engine}.json`), JSON.stringify({
        engine, passed: !failure, results, requests, blocked, pageErrors,
        failure: failure ? { message: String(failure.message || failure).slice(0, 2000), stack: String(failure.stack || "").slice(0, 4000) } : null,
      }, null, 2));
    } catch { /* evidence is best effort; the run's own result stands */ }
  }
  await browser.close();
  server.close();
}

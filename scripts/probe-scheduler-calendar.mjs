/**
 * Probe: the scheduler calendar, in a real browser.
 * -------------------------------------------------------------------------
 * Builds src/scheduler-calendar.jsx on its own (nothing in the app imports it
 * yet), mounts it with synthetic props, and checks what a person would see:
 * every date's colour and spoken label against the raw rows, the day sheet
 * against the grid, the honest states (unavailable, stale, no schedule), uniform
 * cells, no sideways scroll, keyboard, and the compact phone toggle. It reads no
 * store and opens no network connection.
 *
 *   node scripts/probe-scheduler-calendar.mjs
 *   FEEL_BROWSER=webkit node scripts/probe-scheduler-calendar.mjs
 *   SC_SHOTS=some/dir node scripts/probe-scheduler-calendar.mjs     (also saves a picture per width)
 *
 * Needs Playwright (see probe-kit.mjs: FEEL_PLAYWRIGHT or the project's own).
 * axe-core runs when AXE_CORE points at its package directory or it resolves;
 * otherwise the probe says axe was not run rather than pretending it passed.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MONTH = "2026-10", TODAY = "2026-10-14", STORE = "store-a", EPOCH = 3;

/* ------------------------------------------------------------------ the build */
async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-probe-"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>probe</title></head><body style="margin:0;background:#f5f5ee"><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
  fs.writeFileSync(path.join(dir, "main.jsx"), `import { createRoot } from "react-dom/client";
import SchedulerCalendar, { SchedulerCalendarEntry } from ${JSON.stringify(path.join(ROOT, "src/scheduler-calendar.jsx"))};
window.__retries = 0;
const props = { ...window.__props, onRetry: () => { window.__retries += 1; } };
window.__isOffCalls = 0;
const entry = window.__entry && { ...window.__entry, isOff: (data, id, date) => { window.__isOffCalls += 1; return window.__entry.offRule ? data.daysOff?.[id]?.includes(date) && id !== window.__entry.workedId : false; } };
createRoot(document.getElementById("root")).render(entry ? <SchedulerCalendarEntry {...entry} /> : <SchedulerCalendar {...props} />);
`);
  const { build: viteBuild } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  await viteBuild({ root: dir, configFile: false, logLevel: "error", plugins: [react()],
    build: { outDir: path.join(dir, "dist"), emptyOutDir: true, minify: false } });
  return path.join(dir, "dist");
}

function serve(dist) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const file = path.join(dist, new URL(req.url, "http://x").pathname.replace(/^\/+/, "") || "index.html");
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

/* ------------------------------------------------------------ synthetic input */
const dates = Array.from({ length: 31 }, (_, i) => `${MONTH}-${String(i + 1).padStart(2, "0")}`);
const stamp = { timestamp: "2026-10-13T22:05:00.000Z", basis: "report_sent" };
// 1 Oct 4, 2 Oct a reported zero, 3 Oct 8 (best), 5 Oct incomplete, 6 Oct conflict, 7 Oct 2; the rest unknown or future.
const COUNTS = { "2026-10-01": 4, "2026-10-02": 0, "2026-10-03": 8, "2026-10-05": "incomplete", "2026-10-06": "conflict", "2026-10-07": 2 };
const snapshot = (counts, extra = {}) => ({
  status: "ready", storeId: STORE, month: MONTH, principalEpoch: EPOCH,
  days: dates.map((date) => {
    const v = counts[date];
    return typeof v === "number"
      ? { date, status: "provisional", count: v, vehicles: { new: v, used: 0 }, asOf: stamp }
      : { date, status: typeof v === "string" ? v : "missing", count: null, vehicles: { new: null, used: null }, asOf: null };
  }),
  ...extra,
});
const roster = [
  { id: "p2", name: "Blair Quinn", roleId: "sales" }, { id: "p1", name: "Alex Moss", roleId: "sales" },
  { id: "p3", name: "Casey Lane", roleId: "sales" },
  { id: "p5", name: "Hired Late", roleId: "sales", hiredAt: "2026-10-15" },
];
const scheduleSource = { [MONTH]: { file: "october.pdf", at: "2026-10-01T13:00:00.000Z", kind: "a team grid", off: { p1: ["2026-10-03"] }, unmatched: ["Dana"] } };
const base = { storeId: STORE, month: MONTH, today: TODAY, principalEpoch: EPOCH, roster, daysOff: { p1: ["2026-10-03"], p5: ["2026-10-01"] }, forcedOff: { p2: ["2026-10-03"] }, scheduleSource };
// The dashboard's own records, as the app holds them: store, and data with roster, days off and the applied schedule.
const NOW = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date());
const ENTRY = { store: { id: STORE, name: "Cedar Motors" },
  data: { __storeId: STORE, roster: [...roster, { id: "p4", name: "Drew Park", roleId: "sales" }], departed: [], daysOff: { p1: [`${NOW}-03`, `${NOW}-20`], p4: [`${NOW}-20`] }, forcedOff: {}, presentAnyway: {},
    scheduleSource: { [NOW]: { file: "store-a-schedule.pdf", at: "2026-10-01T13:00:00.000Z", kind: "a team grid", off: { p1: [`${NOW}-20`] }, unmatched: [] } } },
  offRule: true, workedId: "p4" };
// entry-switched: store B is selected while the app still holds store A's document.
const entryFor = (scenario) => scenario === "entry-switched"
  ? { ...ENTRY, store: { id: "store-b", name: "Other Motors" }, layout: "panel" }
  : { ...ENTRY, layout: scenario === "entry-compact" ? "compact" : "panel" };
const SCENARIOS = {
  ready: { ...base, reported: snapshot(COUNTS) },
  zeros: { ...base, reported: snapshot({ "2026-10-01": 0, "2026-10-02": 0 }) },
  none: { ...base, reported: snapshot({}) },
  unavailable: { ...base, reported: { status: "unavailable", days: [], storeId: STORE, month: MONTH } },
  denied: { ...base, reported: { status: "denied", days: [], storeId: STORE, month: MONTH } },
  stale: { ...base, reported: snapshot(COUNTS, { month: "2026-09" }) },
  otherStore: { ...base, reported: snapshot(COUNTS, { storeId: "store-b" }) },
  noschedule: { storeId: STORE, month: MONTH, today: TODAY, principalEpoch: EPOCH, roster, reported: snapshot(COUNTS) },
  // A reader row with a count and no timestamp or basis is not a report.
  forged: { ...base, reported: (() => { const r = snapshot(COUNTS); r.days[0] = { ...r.days[0], count: 7, vehicles: { new: 7, used: 0 }, asOf: null }; return r; })() },
  staleEpoch: { ...base, reported: snapshot(COUNTS, { principalEpoch: EPOCH - 1 }) },
  compact: { ...base, reported: snapshot(COUNTS), layout: "compact" },
};

// The expected class and spoken label for a date, from the raw rows alone.
function expected(date, counts) {
  const v = counts[date];
  const reportedDays = Object.entries(counts).filter(([d, n]) => typeof n === "number" && d <= TODAY);
  const max = Math.max(...reportedDays.map(([, n]) => n));
  const tied = reportedDays.filter(([, n]) => n === max).length > 1;
  const day = Number(date.slice(8));
  const text = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  if (date > TODAY) return { cls: "sales-future", label: `${text}, sales not yet available`, day };
  if (typeof v === "number") {
    const best = max > 0 && v === max;
    return { cls: `heat-${max > 0 ? Math.round(v / max * 4) : 0}${best ? " best" : ""}${date === TODAY ? " today" : ""}`,
      label: `${text}, ${v} delivered${best ? (tied ? ", best recorded · tied" : ", best recorded") : ""}`, day };
  }
  const state = v === "incomplete" || v === "conflict" ? v : "missing";
  return { cls: `sales-${state}${date === TODAY ? " today" : ""}`, label: `${text}, ${{ missing: "delivered unknown", incomplete: "report incomplete", conflict: "reports disagree" }[state]}`, day };
}
const VALUE = (date, v) => date > TODAY ? "Pending" : typeof v === "number" ? String(v) : { incomplete: "Incomplete", conflict: "Conflict" }[v] || "Unknown";

/* ------------------------------------------------------------------- browser */
async function launch() {
  let pw;
  const at = process.env.FEEL_PLAYWRIGHT;
  if (at) { const entry = fs.existsSync(path.join(at, "index.mjs")) ? path.join(at, "index.mjs") : at; pw = await import(pathToFileURL(entry).href); }
  else pw = await import("playwright");
  if (String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit") return { name: "webkit", browser: await pw.webkit.launch() };
  return { name: "chromium", browser: await pw.chromium.launch({ executablePath: process.env.FEEL_CHROME || undefined }) };
}
function axeSource() {
  const hit = (dir) => { const f = path.join(dir, "axe.min.js"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; };
  if (process.env.AXE_CORE) return hit(process.env.AXE_CORE);
  try { return hit(path.dirname(createRequire(import.meta.url).resolve("axe-core/package.json"))); } catch { return null; }
}

const VIEWPORTS = [
  { name: "320", width: 320, height: 640, touch: true },
  { name: "390", width: 390, height: 844, touch: true },
  { name: "1440", width: 1440, height: 900, touch: false },
];

async function open(browser, base, vp, scenario, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.setDefaultTimeout(8000);
  await page.addInitScript(([props, entry]) => { window.__props = props; window.__entry = entry; }, [SCENARIOS[scenario] || {}, scenario.startsWith("entry") ? entryFor(scenario) : null]);
  await page.goto(base);
  await page.locator(".sc-calendar, .sc-entry").first().waitFor();
  return { ctx, page, errors };
}

const results = {};
const { server, url } = await serve(await build());
const { name: engine, browser } = await launch();
const axe = axeSource();
try {
  for (const vp of VIEWPORTS) {
    /* ---- the ready month: every date against the raw rows */
    {
      const { ctx, page, errors } = await open(browser, url, vp, "ready");
      const cells = await page.$$eval(".sc-day", (els) => els.map((e) => ({ day: Number(e.textContent), cls: e.className.replace("sc-day", "").trim().split(/\s+/).sort().join(" "),
        label: e.getAttribute("aria-label"), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, current: e.getAttribute("aria-current") })));
      assert.equal(cells.length, 31, `${vp.name}: every date is a button`);
      for (const date of dates) {
        const want = expected(date, COUNTS), got = cells[Number(date.slice(8)) - 1];
        assert.equal(got.cls, want.cls.split(" ").sort().join(" "), `${vp.name} ${date} class`);
        assert.equal(got.label, want.label, `${vp.name} ${date} label`);
        assert.equal(got.current, date === TODAY ? "date" : null, `${vp.name} ${date} current`);
      }
      const w0 = cells[0].w, h0 = cells[0].h;
      assert.ok(cells.every((c) => Math.abs(c.w - w0) < 0.6 && Math.abs(c.h - h0) < 0.6), `${vp.name}: every date is the same size`);
      assert.ok(cells.every((c) => c.h >= 44), `${vp.name}: tap height ${Math.min(...cells.map((c) => c.h))}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${vp.name}: no sideways scroll`);
      assert.equal(await page.locator(".sc-summary").innerText(), "14 delivered on 4 recorded days so far.", `${vp.name}: summary`);
      assert.equal(await page.locator(".sc-note").innerText(), "Delivered this month");

      /* ---- the day sheet reconciles with the grid for every state */
      for (const date of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-20"]) {
        await page.locator(`.sc-day[data-date="${date}"]`).click();
        assert.equal(await page.locator(".sc-delivered-value").innerText(), VALUE(date, COUNTS[date]), `${vp.name} ${date} sheet`);
        assert.equal(await page.locator(`.sc-day[data-date="${date}"]`).getAttribute("aria-pressed"), "true");
      }
      // Off: named, with where it came from. Everyone else is not listed off, never working.
      await page.locator('.sc-day[data-date="2026-10-03"]').click();
      const sheet = await page.locator(".sc-sheet").innerText();
      assert.match(sheet, /Alex Moss[\s\S]*From the schedule, october\.pdf/, `${vp.name}: schedule off`);
      assert.match(sheet, /Blair Quinn[\s\S]*Marked off by a manager/, `${vp.name}: manager off`);
      assert.match(sheet, /Not listed off \(1\)/, `${vp.name}: the rest`);
      assert.doesNotMatch(sheet.replace("does not say a person is working", ""), /\bworking\b/i, `${vp.name}: nobody is called working`);
      assert.equal(await page.locator(".sc-sheet details").evaluate((d) => d.open), false, `${vp.name}: not-listed-off starts closed`);
      assert.match(await page.locator(".sc-schedule").innerText(), /1 name did not match anyone on the roster\. Review before relying on it\./);
      if (process.env.SC_SHOTS) { fs.mkdirSync(process.env.SC_SHOTS, { recursive: true }); await page.locator(".sc-calendar").screenshot({ path: path.join(process.env.SC_SHOTS, `${engine}-${vp.name}-day-3-oct.png`) }); }
      // Somebody hired on the 15th is not on the board before then, Off or otherwise, even with a day listed.
      await page.locator('.sc-day[data-date="2026-10-01"]').click();
      assert.doesNotMatch(await page.locator(".sc-sheet").textContent(), /Hired Late/, `${vp.name}: not before they started`);
      await page.locator('.sc-day[data-date="2026-10-20"]').click();
      assert.match(await page.locator(".sc-sheet").textContent(), /Hired Late/, `${vp.name}: counted once they have started`);
      // A reported day also shows the report's own time and basis.
      await page.locator('.sc-day[data-date="2026-10-01"]').click();
      assert.match(await page.locator(".sc-sheet").innerText(), /New 4 · Used 0/);
      assert.match(await page.locator(".sc-sheet").innerText(), /As of Oct 13, 6:05 PM, report sent\. Not final\./);
      // Choosing the same date again closes the sheet.
      await page.locator('.sc-day[data-date="2026-10-01"]').click();
      assert.equal(await page.locator(".sc-sheet").count(), 0);
      assert.deepEqual(errors, [], `${vp.name}: page errors`);
      results[`ready-${vp.name}`] = "ok";
      await ctx.close();
    }
    /* ---- the honest states */
    for (const [scenario, summary] of [
      ["unavailable", "Deliveries are unavailable right now."], ["denied", "You do not have access to deliveries for this store."],
      ["stale", "Deliveries are unavailable right now."], ["otherStore", "Deliveries are unavailable right now."],
      ["forged", "Deliveries are unavailable right now."], ["staleEpoch", "Deliveries are unavailable right now."],
      ["none", "No recorded deliveries yet this month."],
    ]) {
      const { ctx, page, errors } = await open(browser, url, vp, scenario);
      assert.equal(await page.locator(".sc-summary").innerText(), summary, `${vp.name} ${scenario}`);
      const classes = await page.$$eval(".sc-day", (els) => els.map((e) => e.className));
      assert.ok(classes.every((c) => !/heat-/.test(c)), `${vp.name} ${scenario}: nothing is coloured as a sale`);
      const labels = await page.$$eval(".sc-day", (els) => els.map((e) => e.getAttribute("aria-label")));
      assert.ok(labels.every((l) => !/\b\d+ delivered/.test(l)), `${vp.name} ${scenario}: no number in any label`);
      if (scenario === "unavailable") {
        await page.getByRole("button", { name: "Try again" }).click();
        assert.equal(await page.evaluate(() => window.__retries), 1, "retry is offered and calls back");
      } else assert.equal(await page.getByRole("button", { name: "Try again" }).count(), 0, `${scenario}: no retry offered`);
      assert.deepEqual(errors, []);
      results[`${scenario}-${vp.name}`] = "ok";
      await ctx.close();
    }
    /* ---- a reported zero is not a missing day; a month of zeros crowns nobody */
    {
      const { ctx, page } = await open(browser, url, vp, "zeros");
      assert.equal(await page.locator(".sc-summary").innerText(), "0 delivered on 2 recorded days so far.");
      assert.equal(await page.locator(".sc-day.best").count(), 0);
      assert.equal(await page.locator('.sc-day[data-date="2026-10-01"]').getAttribute("aria-label"), "Thursday, October 1, 0 delivered");
      assert.equal(await page.locator('.sc-day[data-date="2026-10-03"]').getAttribute("aria-label"), "Saturday, October 3, delivered unknown");
      results[`zeros-${vp.name}`] = "ok";
      await ctx.close();
    }
    /* ---- no schedule on file */
    {
      const { ctx, page } = await open(browser, url, vp, "noschedule");
      await page.locator('.sc-day[data-date="2026-10-03"]').click();
      assert.match(await page.locator(".sc-sheet").innerText(), /No schedule is on file for this month\./);
      assert.equal(await page.locator(".sc-schedule").count(), 0);
      results[`noschedule-${vp.name}`] = "ok";
      await ctx.close();
    }
    /* ---- keyboard: tab to a date, Enter opens its sheet, focus stays put */
    {
      const { ctx, page } = await open(browser, url, vp, "ready");
      await page.locator('.sc-day[data-date="2026-10-01"]').focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.date), "2026-10-02");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(".sc-delivered-value").innerText(), "0");
      assert.equal(await page.evaluate(() => document.activeElement.dataset.date), "2026-10-02", "focus stays on the date");
      results[`keyboard-${vp.name}`] = "ok";
      await ctx.close();
    }
  }

  /* ---- the compact phone card: closed until asked, and says so */
  for (const vp of VIEWPORTS.filter((v) => v.touch)) {
    const { ctx, page } = await open(browser, url, vp, "compact");
    const toggle = page.locator(".sc-toggle");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".sc-panel").isHidden(), true);
    assert.match(await toggle.getAttribute("aria-label"), /^October 2026, calendar\. 14 delivered on 4 recorded days so far\.$/);
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator(".sc-day").count(), 31);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    results[`compact-${vp.name}`] = "ok";
    await ctx.close();
  }

  /* ---- the dashboard entry binds the app's own records: nothing is fetched, deliveries say not loaded */
  for (const vp of VIEWPORTS) {
    const layout = vp.touch ? "entry-compact" : "entry-panel";
    const { ctx, page, errors } = await open(browser, url, vp, layout);
    // The month is the real Eastern one, so the grid is today's month; pick a date from it.
    const month = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date()));
    if (layout === "entry-panel") {
      const toggle = page.getByRole("button", { name: /Deliveries calendar/ });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator(".sc-calendar").count(), 0, "closed until asked");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await toggle.click();
      assert.equal(await page.locator(".sc-calendar").count(), 0, "closes again");
      await toggle.click();
    } else {
      await page.locator(".sc-toggle").click();
    }
    assert.equal(await page.locator(".sc-summary").innerText(), "Deliveries are not loaded.", `${vp.name}: no reader, no numbers`);
    assert.equal(await page.locator(".sc-day").count(), new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate());
    assert.ok((await page.$$eval(".sc-day", (els) => els.map((e) => e.className))).every((c) => !/heat-/.test(c)));
    // p1 is listed off on the 20th. p4 is listed too, but the app's own rule says they worked.
    await page.locator(`.sc-day[data-date="${month}-20"]`).click();
    const sheet = await page.locator(".sc-sheet").innerText();
    assert.match(sheet, /Off\s+Alex Moss · From the schedule, store-a-schedule\.pdf/, `${vp.name}: bound by roster id from the app's days off`);
    assert.match(sheet, /Listed off but worked: Drew Park\./, `${vp.name}: the app's own off rule is used`);
    assert.match(sheet, /Delivered\s+Unavailable|Delivered\s+Pending|Delivered\s+Unknown/, `${vp.name}: never a number`);
    assert.match(await page.locator(".sc-schedule").innerText(), /store-a-schedule\.pdf/, "the schedule file on record is shown back");
    assert.deepEqual(errors, []);
    results[`entry-${vp.name}`] = "ok";
    await ctx.close();
  }

  /* ---- store B selected while store A's document is still loaded: nothing of A's shows */
  for (const vp of VIEWPORTS.filter((v) => !v.touch)) {
    const { ctx, page, errors } = await open(browser, url, vp, "entry-switched");
    await page.getByRole("button", { name: /Deliveries calendar/ }).click();
    const month = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date()));
    await page.locator(`.sc-day[data-date="${month}-20"]`).click();
    const text = await page.locator(".sc-calendar").textContent();
    assert.match(text, /This store's schedule is not loaded yet\./);
    assert.doesNotMatch(text, /store-a-schedule\.pdf|Alex Moss|Blair Quinn|Casey Lane|Drew Park|Schedule from/, "no person or file from the other store");
    assert.equal(await page.locator(".sc-schedule").count(), 0);
    assert.deepEqual(errors, []);
    results[`switched-${vp.name}`] = "ok";
    await ctx.close();
  }
  // The same data for the store it belongs to does show its schedule file and people.
  {
    const { ctx, page } = await open(browser, url, VIEWPORTS[2], "entry-panel");
    await page.getByRole("button", { name: /Deliveries calendar/ }).click();
    assert.match(await page.locator(".sc-schedule").innerText(), /store-a-schedule\.pdf/);
    results["matched-1440"] = "ok";
    await ctx.close();
  }

  /* ---- accessibility, when axe is there to run */
  if (axe) {
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await open(browser, url, vp, "ready");
      await page.locator('.sc-day[data-date="2026-10-03"]').click();
      await page.evaluate(() => { document.querySelector(".sc-sheet details").open = true; });
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => (await axe.run(".sc-calendar", { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`));
      assert.deepEqual(violations, [], `${vp.name}: axe`);
      results[`axe-${vp.name}`] = "ok";
      await ctx.close();
    }
  } else results.axe = "not run: axe-core was not found (set AXE_CORE to its package directory)";
} finally {
  await browser.close();
  server.close();
}
console.log(engine, "scheduler calendar passed", JSON.stringify(results));

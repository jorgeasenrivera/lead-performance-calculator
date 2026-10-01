import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BEFORE = process.env.DAILY_BEFORE_URL || "http://127.0.0.1:49216/";
const AFTER = process.env.DAILY_AFTER_URL || "http://127.0.0.1:49215/";
const OUT = "daily-integrity-evidence";
const UNAVAILABLE = "Daily totals unavailable";
const mockRows = (store) => [20, 21].map((day, i) => ({
  key: `lpc:store:${store}:digest:2026-09-${day}`,
  value: { d: `2026-09-${day}`, ev: 7, v: { cleared: i + 1 }, u: 10 + 11 * i,
    nu: 6 + 7 * i, uu: 4 + 4 * i,
    ch: { internet: { u: 4 + i, l: 20 }, phone: { u: 2 + i, l: 12 }, showroom: { u: 4 + i, l: 15 } } },
}));
const closeRecap = async (page) => {
  const close = page.getByRole("button", { name: "Close the round-up", exact: true });
  if (await close.isVisible()) await close.click();
};
const waitForReads = async (reads, count) => {
  const deadline = Date.now() + 15000;
  while (reads.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(reads.length >= count, "the actual component must retry its failed digest request");
};
const monthly = (page, phone) => page.locator(phone ? ".bp-num .dotnum" : ".s2-big .dotnum").first().getAttribute("aria-label");
const noFalseClaims = async (page) => {
  const text = await page.locator("body").innerText();
  assert.ok(!/New sold yesterday|Used sold yesterday|Best day so far|PRIVATE_DIAGNOSTIC/.test(text), "no unsupported count or private flag is visible");
  assert.equal(await page.locator(".ru2-chart, .bp-lg svg, .bp-up, .bp-down").count(), 0, "no legacy trend chart or delta remains");
};

async function fixture(browser, url, mode = "legacy", { holdA = false } = {}) {
  assert.equal(new URL(url).hostname, "127.0.0.1", "probe is restricted to the local fictional build");
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  let releaseA;
  const held = new Promise((resolve) => { releaseA = resolve; });
  const reads = [], mutations = [], errors = [];
  let failures = 0;
  await context.route("http://127.0.0.1:5433/**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    const key = url.searchParams.get("key") || "";
    if (request.method() !== "GET") {
      const body = request.postData() || "";
      if (body.includes(":digest:")) mutations.push(body);
      // Even the before build cannot mutate a database in this probe.
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (key.includes(":digest:")) {
      const store = key.includes("store-b") ? "store-b" : "store-a";
      reads.push(store);
      if (holdA && store === "store-a") await held;
      if (mode === "failure" && failures++ === 0)
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "PRIVATE_DIAGNOSTIC" }) });
      const rows = mode === "empty" ? [] : mode === "rejected" ? mockRows("other-store") : mockRows(store);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-22T16:00:00Z"));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".s2-big .dotnum").first().waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("dialog", { name: "Your round-up", exact: true }).waitFor({ state: "visible" });
  return { context, page, reads, mutations, errors, releaseA };
}

export async function verifyDailySalesIntegrity(browser) {
  await mkdir(OUT, { recursive: true });
  let active;
  const result = { screens: [], preservation: {}, reads: {}, mutations: 0 };
  try {
    const before = active = await fixture(browser, BEFORE);
    await before.page.getByText("New sold yesterday", { exact: true }).waitFor({ state: "visible" });
    result.beforeDigestMutations = before.mutations.length;
    assert.ok(result.beforeDigestMutations > 0, "the unmodified before build must exercise the obsolete writer");
    await before.page.screenshot({ path: `${OUT}/before-recap.png`, fullPage: true, animations: "disabled" });
    await closeRecap(before.page);
    result.preservation.beforeMonth = await monthly(before.page, false);
    await before.page.locator(".s2-mcal").hover();
    await before.page.screenshot({ path: `${OUT}/before-calendar-desktop.png`, fullPage: true, animations: "disabled" });
    await before.page.setViewportSize({ width: 390, height: 844 });
    await before.page.locator(".bp-l2").click();
    await before.page.locator(".bp-swg").waitFor({ state: "visible" });
    assert.ok((await before.page.locator(".bp-swg b").allTextContents()).some((n) => /^\d/.test(n)), "before fixture must reproduce a daily claim");
    await before.page.screenshot({ path: `${OUT}/before-calendar-phone.png`, fullPage: true, animations: "disabled" });
    await before.page.getByRole("button", { name: "Close", exact: true }).click();
    await before.page.locator("#activity").click();
    result.preservation.beforeActivity = await before.page.locator("main").innerText();
    result.preservation.beforeDailyNumbers = await before.page.locator(".co-unum .dotnum").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    assert.ok(result.preservation.beforeDailyNumbers.length >= 2 && result.preservation.beforeDailyNumbers.some((n) => Number(n) > 0), "Daily Activity fixture must contain real nonzero calls and videos");
    await before.context.close();

    const after = active = await fixture(browser, AFTER);
    await after.page.locator('[data-daily-unavailable="recap"]').waitFor({ state: "visible" });
    await noFalseClaims(after.page);
    await after.page.screenshot({ path: `${OUT}/after-recap.png`, fullPage: true, animations: "disabled" });
    await closeRecap(after.page);
    result.preservation.afterMonth = await monthly(after.page, false);
    assert.equal(result.preservation.afterMonth, "61");
    assert.equal(result.preservation.afterMonth, result.preservation.beforeMonth);

    for (const width of [390, 700, 701, 1280]) {
      await after.page.setViewportSize({ width, height: width <= 700 ? 844 : 1000 });
      await closeRecap(after.page);
      if (width <= 700) {
        await after.page.locator(".bp-l2").click();
        await after.page.locator('[data-daily-unavailable="phone-calendar"]').waitFor({ state: "visible" });
        assert.ok((await after.page.locator(".bp-swg b").allTextContents()).every((n) => n === "·"), "unknown days cannot display zeroes or inferred counts");
        await after.page.screenshot({ path: `${OUT}/after-calendar-${width}.png`, fullPage: true, animations: "disabled" });
        await after.page.keyboard.press("Escape");
        await after.page.locator(".fr-pop").waitFor({ state: "hidden" });
        await after.page.locator(".bp-r1").click();
        await after.page.locator('[data-daily-unavailable="phone-best-day"]').waitFor({ state: "visible" });
        await noFalseClaims(after.page);
        await after.page.getByRole("button", { name: "Close", exact: true }).click();
        await after.page.locator(".bp-t5").first().click();
        await after.page.getByText(/Daily history unavailable/).waitFor({ state: "visible" });
        await noFalseClaims(after.page);
        await after.page.getByRole("button", { name: "Close", exact: true }).click();
        assert.equal(await monthly(after.page, true), "61");
      } else {
        // The existing compact desktop layout hides the right-hand calendar
        // at 860px. Verify that boundary, then exercise its stock/day popup.
        if (width > 860) {
          await after.page.locator(".s2-mcal").hover();
          await after.page.locator('[data-daily-unavailable="desktop-best-day"]').waitFor({ state: "visible" });
          await after.page.locator(".s2-mc-grid i:not(.e)").first().click();
          await after.page.locator(".s2-calwin .s2-detail").filter({ hasText: UNAVAILABLE }).waitFor({ state: "visible" });
          await after.page.screenshot({ path: `${OUT}/after-calendar-${width}.png`, fullPage: true, animations: "disabled" });
        } else assert.equal(await after.page.locator(".s2-mcal").isVisible(), false, "the existing compact calendar rule is preserved");
        await after.page.locator(".s2-splitwrap").hover();
        await after.page.locator(".s2-salewin:visible").first().waitFor({ state: "visible" });
        assert.ok((await after.page.locator(".s2-salewin:visible .s2-sw-grid b").allTextContents()).every((n) => n === "·"));
        await after.page.screenshot({ path: `${OUT}/after-stock-days-${width}.png`, fullPage: true, animations: "disabled" });
        await noFalseClaims(after.page);
        await after.page.locator(".s2-ru").click();
        await after.page.locator('[data-daily-unavailable="recap"]').waitFor({ state: "visible" });
        await noFalseClaims(after.page);
        await after.page.keyboard.press("Escape");
      }
      result.screens.push(width);
    }
    for (const role of ["manager", "admin"]) {
      await after.page.getByLabel("Fictional viewer role").selectOption(role);
      await after.page.locator(".s2-ru").click();
      await after.page.locator('[data-daily-unavailable="recap"]').waitFor({ state: "visible" });
      await noFalseClaims(after.page);
      await closeRecap(after.page);
    }
    await after.page.setViewportSize({ width: 390, height: 844 });
    await after.page.locator("#activity").click();
    result.preservation.afterActivity = await after.page.locator("main").innerText();
    result.preservation.afterDailyNumbers = await after.page.locator(".co-unum .dotnum").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    assert.deepEqual(result.preservation.afterDailyNumbers, result.preservation.beforeDailyNumbers, "working daily calls and video counts remain exact");
    assert.equal(result.preservation.afterActivity, result.preservation.beforeActivity, "existing Daily Activity display is unchanged");
    assert.deepEqual(after.mutations, [], "opening, resizing and reopening do not write digests");
    assert.deepEqual(after.errors, []);
    await after.context.close();

    for (const mode of ["empty", "rejected", "failure"]) {
      const f = active = await fixture(browser, AFTER, mode);
      await f.page.locator('[data-daily-unavailable="recap"]').waitFor({ state: "visible" });
      // Routed responses are not guaranteed to enter the browser's Resource
      // Timing buffer. Count the real intercepted requests instead.
      if (mode === "failure") await waitForReads(f.reads, 2);
      await noFalseClaims(f.page);
      assert.deepEqual(f.mutations, []); assert.deepEqual(f.errors, []);
      result.reads[mode] = f.reads.length;
      if (mode === "failure") assert.ok(f.reads.length >= 2, "failed reads are retried in the actual component");
      await f.context.close();
    }

    const race = active = await fixture(browser, AFTER, "legacy", { holdA: true });
    await closeRecap(race.page);
    await race.page.locator("#store-b").click();
    await race.page.locator('main[data-fixture-store="store-b"]').waitFor({ state: "visible" });
    assert.equal(await monthly(race.page, false), "83");
    race.releaseA();
    await race.page.locator(".s2-ru").click();
    await race.page.locator('[data-daily-unavailable="recap"]').waitFor({ state: "visible" });
    await noFalseClaims(race.page); await closeRecap(race.page);
    await race.page.locator("#store-a").click();
    assert.equal(await monthly(race.page, false), "61");
    const reads = race.reads.length;
    await race.page.locator("#mismatch").click();
    await race.page.locator(".s2-ru").click();
    await noFalseClaims(race.page); await closeRecap(race.page);
    assert.equal(race.reads.length, reads, "mismatched data cannot initiate another digest read");
    await race.page.locator("#resolve").click();
    assert.equal(await monthly(race.page, false), "83");
    assert.deepEqual(race.mutations, []); assert.deepEqual(race.errors, []);
    result.mutations = after.mutations.length + race.mutations.length;
    await race.page.screenshot({ path: `${OUT}/after-store-switch.png`, fullPage: true, animations: "disabled" });
    await race.context.close();
    await writeFile(`${OUT}/result.json`, JSON.stringify(result, null, 2));
    console.log("Daily integrity: real Manager views, privacy, retry, store switch and preservation passed");
  } catch (error) {
    if (active?.page && !active.page.isClosed()) await active.page.screenshot({ path: `${OUT}/failure.png`, fullPage: true, animations: "disabled" }).catch(() => {});
    console.error("Daily integrity failure:", error, active && { reads: active.reads, mutations: active.mutations.length, errors: active.errors,
      screen: await active.page.evaluate(() => ({ width: innerWidth, text: document.body.innerText.slice(0, 1400) })).catch(() => null) });
    throw error;
  } finally { if (active) await active.context.close().catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const module = process.env.FEEL_PLAYWRIGHT ? pathToFileURL(path.join(process.env.FEEL_PLAYWRIGHT, "index.mjs")).href : "playwright";
  const pw = await import(module);
  const browser = await pw[process.env.FEEL_BROWSER || "chromium"].launch({ headless: true });
  try { await verifyDailySalesIntegrity(browser); } finally { await browser.close(); }
}

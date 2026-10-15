import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const { chromium, webkit } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ||
    "/workspace/cloud-tools/node_modules/playwright",
);
const results = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch(
    name === "chromium"
      ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] }
      : {},
  );
  try {
    for (const [instant, zone, expected] of [
      ["2027-01-01T04:59:00Z", "Asia/Tokyo", "2026-12-31"],
      ["2027-01-01T05:00:00Z", "America/Los_Angeles", "2027-01-01"],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
        timezoneId: zone,
        reducedMotion: "reduce",
      });
      await page.clock.install({ time: new Date(instant) });
      await page.goto("http://127.0.0.1:5190");
      assert.equal(
        await page.locator(".sp-mini-grid .today").innerText(),
        String(Number(expected.slice(-2))),
      );
      await page
        .getByRole("button", { name: "Open Schedule", exact: true })
        .click();
      const frame = page.frames().find((f) => f.url().includes("/planner/"));
      await frame.locator("#month").waitFor();
      assert.equal(
        await frame.locator("#month").inputValue(),
        expected.slice(0, 7),
      );
      assert.equal(
        await frame.locator('[aria-current="date"]').getAttribute("data-day"),
        expected,
      );
      await frame.locator("#today").click();
      assert.match(
        await frame.locator("#sheet h2").innerText(),
        new RegExp(expected.endsWith("31") ? "Dec 31, 2026" : "Jan 1, 2027"),
      );
      await frame.getByRole("button", { name: "Back to month" }).click();
      results.push({
        engine: name,
        instant,
        browserTimeZone: zone,
        expectedStoreDay: expected,
        status: "passed",
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
const out = "scripts/scheduler-performance/evidence/calendar-refinement";
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/timezone-results.json`, JSON.stringify(results, null, 2));
console.log("Four New York/browser-timezone boundary scenarios passed.");

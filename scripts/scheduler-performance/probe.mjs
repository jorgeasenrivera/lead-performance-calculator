import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const { chromium, webkit } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ||
    "/workspace/cloud-tools/node_modules/playwright",
);
const engine = process.env.BROWSER || "chromium";
const browser = await { chromium, webkit }[engine].launch(
  engine === "chromium"
    ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] }
    : {},
);
const out =
  process.env.EVIDENCE_DIR || "scripts/scheduler-performance/evidence";
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const width of [1440, 390, 320])
    for (const scale of [1, 2]) {
      const key = `${engine}-${width}-text${scale * 100}`;
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(8000);
      const errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (r) => {
        if (new URL(r.request().url()).hostname !== "127.0.0.1") {
          external.push(r.request().url());
          return r.abort();
        }
        return r.continue();
      });
      await page.clock.install({ time: new Date("2026-10-14T16:00:00Z") });
      await page.goto("http://127.0.0.1:5190");
      if (width > 700)
        await page.getByRole("button", { name: "Close the round-up" }).click();
      const entry = page.locator(".sp-plan-entry");
      await entry.waitFor();
      const original = await entry.evaluate((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      );
      await page.evaluate(
        (s) => (document.documentElement.style.fontSize = `${s * 100}%`),
        scale,
      );
      const enlarged = await entry.evaluate((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      );
      assert.equal(enlarged / original, scale, "entry text actually scales");
      assert.ok((await entry.boundingBox()).height >= 44, "entry touch height");
      await page.screenshot({ path: `${out}/${key}-performance.png` });
      // Existing today details are still reachable through their original control.
      const today = page.locator(
        width > 700 ? ".sg-schedule-trigger" : ".sp-today",
      );
      await today.click();
      if (width > 700) {
        assert.equal(await today.getAttribute("aria-expanded"), "true");
        await today.press("Escape");
        await page.mouse.move(0, 0);
      } else {
        await page.keyboard.press("Escape");
        const scrim = page.locator(".bp-pop-scrim");
        if (await scrim.count())
          await scrim.click({ position: { x: 2, y: 2 } });
      }
      await entry.click();
      assert.ok(await page.locator(".sp-dialog").evaluate((e) => e.open));
      assert.equal(
        await page
          .getByRole("button", { name: "Return to Performance" })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        assert.ok(
          await page
            .locator(".sp-dialog")
            .evaluate((e) => e.contains(document.activeElement)),
          "focus stays inside planner",
        );
      }
      const frame = page.frames().find((f) => f.url().includes("/planner/"));
      await frame.locator("#week").waitFor();
      const selectors = ["#people", "#store", "#week"];
      const before = await Promise.all(
        selectors.map((s) =>
          frame
            .locator(s)
            .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ),
      );
      await frame.evaluate(
        (s) => (document.documentElement.style.fontSize = `${s * 100}%`),
        scale,
      );
      const after = await Promise.all(
        selectors.map((s) =>
          frame
            .locator(s)
            .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ),
      );
      before.forEach((v, i) =>
        assert.equal(
          after[i] / v,
          scale,
          `${selectors[i]} actual text scaling`,
        ),
      );
      const fit = async () => {
        assert.ok(
          await frame.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "planner horizontal reflow",
        );
        assert.ok(
          await page
            .locator(".sp-dialog")
            .evaluate(
              (e) =>
                e.getBoundingClientRect().right <=
                document.documentElement.clientWidth + 1,
            ),
          "dialog fits viewport",
        );
      };
      await fit();
      assert.equal(await frame.locator("#week").inputValue(), "2026-10-19");
      await page.screenshot({ path: `${out}/${key}-planner.png` });
      await frame.locator("#people").click();
      await frame.locator("[name=maxHours]").fill("1");
      await frame.locator("[name=maxHours]").press("Escape");
      assert.ok(
        await page.locator(".sp-dialog").evaluate((e) => e.open),
        "first Escape only closes sheet",
      );
      assert.equal(
        await frame.evaluate(() => document.activeElement.id),
        "people",
      );
      await frame.locator("#people").click();
      assert.equal(await frame.locator("[name=maxHours]").inputValue(), "40");
      await fit();
      await page.screenshot({ path: `${out}/${key}-person.png` });
      await page.getByRole("button", { name: "Return to Performance" }).click();
      assert.equal(
        await entry.evaluate((e) => e === document.activeElement),
        true,
        "return restores opener",
      );
      await entry.click();
      await frame.locator("#people").click();
      assert.equal(
        await frame.locator("[name=maxHours]").inputValue(),
        "40",
        "return cancels unfinished edit",
      );
      await frame.locator("[name=maxHours]").fill("0");
      await frame
        .getByRole("button", { name: "Apply to local proposal", exact: true })
        .click();
      for (const minimum of ["3", "2"]) {
        await frame.locator("#rules").click();
        await frame.locator("[name=minimum]").fill(minimum);
        await fit();
        await page.screenshot({ path: `${out}/${key}-store.png` });
        await frame
          .getByRole("button", { name: "Apply dated local rule" })
          .click();
        assert.equal(await frame.locator(".badge.unknown").count(), 1);
        assert.equal(await frame.locator(".badge.closed").count(), 2);
      }
      await frame.locator("#rules").click();
      assert.equal(await frame.locator("[name=minimum]").inputValue(), "2");
      await frame.locator("[name=minimum]").fill("8");
      await frame
        .getByRole("button", { name: "Close sheet", exact: true })
        .click();
      await frame.locator("#rules").click();
      assert.equal(await frame.locator("[name=minimum]").inputValue(), "2");
      await frame.locator("[name=minimum]").press("Escape");
      await frame.locator("#rules").press("Escape");
      assert.equal(
        await page.locator(".sp-dialog").evaluate((e) => e.open),
        false,
        "second Escape returns",
      );
      assert.equal(
        await entry.evaluate((e) => e === document.activeElement),
        true,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        scale,
        actualFonts: { before, after, entry: [original, enlarged] },
        errors,
        external,
        status: "passed",
      });
      console.log(key, "passed");
      await page.close();
    }
  writeFileSync(
    `${out}/${engine}-results.json`,
    JSON.stringify({ engine, version: browser.version(), results }, null, 2),
  );
} finally {
  await browser.close();
}

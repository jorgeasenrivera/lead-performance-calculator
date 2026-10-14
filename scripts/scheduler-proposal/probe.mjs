import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "/workspace/cloud-tools/node_modules/playwright",
);
const engine = process.env.BROWSER || "chromium";
const browser = await { chromium, webkit }[engine].launch(
  engine === "chromium"
    ? {
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        args: ["--no-sandbox"],
      }
    : {},
);
const out = process.env.EVIDENCE_DIR || "/workspace/scheduler-evidence";
mkdirSync(out, { recursive: true });
const evidence = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.clock.install({ time: new Date("2026-10-14T12:00:00Z") });
    await page.goto("http://127.0.0.1:5189/");
    assert.equal(await page.locator("#week").inputValue(), "2026-10-19");
    assert.equal(await page.locator(".day").count(), 7);
    assert.equal(await page.locator(".badge.unknown").count(), 1);
    assert.equal(await page.locator(".badge.closed").count(), 2);
    const fit = async () =>
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow at ${width}`,
      );
    await fit();
    await page.screenshot({
      path: `${out}/${engine}-${width}-week.png`,
      fullPage: true,
    });
    await page.locator("#accept").click();
    assert.match(await page.locator("#message").textContent(), /Resolve/);
    await page.locator("#people").click();
    await fit();
    await page.screenshot({
      path: `${out}/${engine}-${width}-person.png`,
      fullPage: true,
    });
    await page.locator("[name=maxHours]").fill("0");
    await page
      .getByRole("button", { name: "Apply to local proposal", exact: true })
      .click();
    assert.ok(
      !(await page.locator(".person").allTextContents()).includes("Alex 1"),
    );
    await page.locator("#rules").click();
    await fit();
    await page.screenshot({
      path: `${out}/${engine}-${width}-store.png`,
      fullPage: true,
    });
    await page.locator("[name=holidayState]").selectOption("open");
    await page.getByRole("button", { name: "Apply dated local rule" }).click();
    assert.equal(await page.locator(".badge.unknown").count(), 0);
    const first = page.locator(".day").first();
    await first.locator("summary").click();
    await first.locator("input[value=p0]").check();
    assert.match(
      await first.locator(".issues").textContent(),
      /weekly hours exceeded/,
    );
    await page.screenshot({
      path: `${out}/${engine}-${width}-override.png`,
      fullPage: true,
    });
    await first.getByRole("button", { name: "Use suggestion" }).click();
    await page.locator("#accept").click();
    assert.match(
      await page.locator("#message").textContent(),
      /Manager review recorded/,
    );
    await page.locator("#store").selectOption("1");
    assert.equal(await page.locator(".badge.unknown").count(), 1);
    assert.match(await page.locator(".person").first().textContent(), /2/);
    await page.locator("#week").fill("2026-10-26");
    await page.locator("#week").dispatchEvent("change");
    assert.match(await page.locator("h2").first().textContent(), /Oct 26/);
    assert.equal(await page.locator(".badge.unknown").count(), 0);
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    await fit();
    await page.screenshot({
      path: `${out}/${engine}-${width}-large-text.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    evidence.push({
      engine,
      width,
      checks: [
        "initial week",
        "closed/unknown",
        "blocked review",
        "person edit",
        "dated store edit",
        "override conflicts",
        "manager review",
        "store isolation",
        "week selection",
        "no horizontal overflow",
        "200% root text",
        "no external requests",
        "no page errors",
      ],
    });
    await page.close();
  }
  writeFileSync(
    `${out}/${engine}-results.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}

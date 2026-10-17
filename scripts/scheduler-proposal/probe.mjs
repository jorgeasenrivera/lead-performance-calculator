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
  for (const [width, textScale] of [1440, 390, 320].flatMap((width) =>
    [1, 2].map((scale) => [width, scale]),
  )) {
    const shot = `${engine}-${width}${textScale === 2 ? "-text200" : ""}`;
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      isMobile: width < 600,
      hasTouch: width < 600,
    });
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
    await page.evaluate(
      (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
      textScale,
    );
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
      path: `${out}/${shot}-week.png`,
      fullPage: true,
    });
    await page.locator("#accept").click();
    assert.match(await page.locator("#message").textContent(), /Resolve/);
    await page.locator("#people").click();
    await fit();
    await page.screenshot({
      path: `${out}/${shot}-person.png`,
      fullPage: true,
    });
    await page.locator("[name=maxHours]").fill("1");
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "people",
    );
    await page.locator("#people").click();
    assert.equal(await page.locator("[name=maxHours]").inputValue(), "40");
    await page.locator("[name=maxHours]").fill("2");
    await page.locator("[name=maxHours]").press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "people",
    );
    await page.locator("#people").click();
    assert.equal(await page.locator("[name=maxHours]").inputValue(), "40");
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
      path: `${out}/${shot}-store.png`,
      fullPage: true,
    });
    await page.locator("[name=minimum]").fill("8");
    await page.locator("[name=editHoliday]").check();
    await page.locator("[name=holidayState]").selectOption("closed");
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "rules");
    await page.locator("#rules").click();
    assert.equal(await page.locator("[name=minimum]").inputValue(), "2");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "unknown",
    );
    await page.locator("[name=minimum]").fill("7");
    await page.locator("[name=minimum]").press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rules");
    await page.locator("#rules").click();
    assert.equal(await page.locator("[name=minimum]").inputValue(), "2");
    await page.locator("[name=editHoliday]").check();
    await page.locator("[name=holidayState]").selectOption("open");
    await page.getByRole("button", { name: "Apply dated local rule" }).click();
    assert.equal(await page.locator(".badge.unknown").count(), 0);
    for (const minimum of ["3", "2"]) {
      await page.locator("#rules").click();
      assert.equal(await page.locator("[name=editHoliday]").isChecked(), false);
      assert.equal(
        await page.locator("[name=holidayState]").isDisabled(),
        true,
      );
      assert.equal(
        await page.locator("[name=holidayState]").inputValue(),
        "open",
      );
      await page.locator("[name=minimum]").fill(minimum);
      await page
        .getByRole("button", { name: "Apply dated local rule" })
        .click();
      assert.equal(await page.locator(".badge.unknown").count(), 0);
      assert.equal(await page.locator(".badge.closed").count(), 2);
    }
    await page.locator("#rules").click();
    await page.locator("[name=editHoliday]").check();
    await page.locator("[name=holiday]").fill("2026-10-23");
    await page.locator("[name=holiday]").dispatchEvent("change");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "closed",
    );
    await page.locator("[name=holiday]").fill("2026-10-21");
    await page.locator("[name=holiday]").dispatchEvent("change");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "open",
    );
    await page.locator("[name=holidayState]").selectOption("unknown");
    await page.locator("[name=editHoliday]").uncheck();
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "open",
    );
    await fit();
    await page.screenshot({
      path: `${out}/${shot}-repeat-save.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Apply dated local rule" }).click();
    assert.equal(await page.locator(".badge.unknown").count(), 0);
    for (const state of ["closed", "unknown", "open"]) {
      await page.locator("#rules").click();
      await page.locator("[name=editHoliday]").check();
      await page.locator("[name=holidayState]").selectOption(state);
      await page
        .getByRole("button", { name: "Apply dated local rule" })
        .click();
      const day = page.locator(".day").nth(2);
      assert.equal(
        (await day.locator(".badge").textContent()).toLowerCase(),
        state,
      );
      if (state !== "open")
        assert.equal(await day.locator(".person").count(), 0);
      if (state === "unknown") {
        await page.locator("#accept").click();
        assert.match(await page.locator("#message").textContent(), /Resolve/);
      }
    }
    const first = page.locator(".day").first();
    await first.locator("summary").click();
    await first.locator("input[value=p0]").check();
    assert.match(
      await first.locator(".issues").textContent(),
      /weekly hours exceeded/,
    );
    await page.screenshot({
      path: `${out}/${shot}-override.png`,
      fullPage: true,
    });
    await first.getByRole("button", { name: "Use suggestion" }).click();
    await page.locator("#accept").click();
    assert.match(
      await page.locator("#message").textContent(),
      /Manager review recorded/,
    );
    await page.locator("#rules").click();
    const effective = page.locator("[name=effective]");
    await effective.fill("2026-10-26");
    await effective.dispatchEvent("change");
    await page.locator("[name=minimum]").fill("5");
    await page.locator("[name=open]").fill("10");
    await page.locator("[name=close]").fill("18");
    await page.locator("[name=capacity]").fill("9");
    await page.locator("[name=useCapacity]").check();
    await page.locator('[name=closedDays][value="6"]').check();
    await page.locator("[name=editHoliday]").check();
    await page.locator("[name=holidayState]").selectOption("closed");
    await page.getByRole("button", { name: "Apply dated local rule" }).click();
    await page.locator("#rules").click();
    assert.equal(await effective.inputValue(), "2026-10-19");
    const assertEarlier = async () => {
      for (const [name, value] of Object.entries({
        minimum: "2",
        open: "9",
        close: "17",
        capacity: "6",
      })) {
        assert.equal(await page.locator(`[name=${name}]`).inputValue(), value);
      }
      assert.equal(await page.locator("[name=useCapacity]").isChecked(), false);
      assert.equal(
        await page.locator('[name=closedDays][value="6"]').isChecked(),
        false,
      );
      assert.equal(
        await page.locator("[name=holidayState]").inputValue(),
        "open",
      );
      assert.ok(
        !(await page.locator("#sheet").textContent()).includes(
          "2026-10-28: closed",
        ),
      );
    };
    await assertEarlier();
    await effective.fill("2026-10-26");
    await effective.dispatchEvent("change");
    assert.equal(await page.locator("[name=minimum]").inputValue(), "5");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "closed",
    );
    await effective.fill("2026-10-19");
    await effective.dispatchEvent("change");
    await assertEarlier();
    await fit();
    await page.screenshot({
      path: `${out}/${shot}-dated-rule.png`,
      fullPage: true,
    });
    await page.locator("[name=minimum]").fill("3");
    await page.getByRole("button", { name: "Apply dated local rule" }).click();
    await page.locator("#rules").click();
    assert.equal(await page.locator("[name=minimum]").inputValue(), "3");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "open",
    );
    await effective.fill("2026-10-26");
    await effective.dispatchEvent("change");
    assert.equal(await page.locator("[name=minimum]").inputValue(), "5");
    assert.equal(await page.locator("[name=open]").inputValue(), "10");
    assert.equal(
      await page.locator("[name=holidayState]").inputValue(),
      "closed",
    );
    await effective.fill("2025-12-29");
    await effective.dispatchEvent("change");
    assert.equal(await page.locator("[name=minimum]").inputValue(), "");
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "rules");
    await page.locator("#people").click();
    await page.locator("#person").selectOption("p1");
    await page
      .getByRole("button", { name: "Close sheet", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "people",
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
      path: `${out}/${shot}-large-text.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    evidence.push({
      engine,
      width,
      textScale,
      browserVersion: browser.version(),
      mobileEmulation: width < 600,
      checks: [
        "initial week",
        "closed/unknown",
        "blocked review",
        "person edit",
        "dated store edit",
        "repeated coverage saves preserve confirmed Open and Closed exceptions",
        "exception edits require opt-in and can be cancelled",
        "exception date changes load existing status",
        "future October 26 rule does not seed October 19 edits",
        "effective-date changes reload applicable settings",
        "earlier save preserves future rule",
        "before-first-rule fields are blank",
        "both sheets restore opener focus",
        "Close and Escape discard unsaved person and store edits",
        "cancelling exception edit restores displayed saved status",
        "explicit Closed / Unknown / Open transitions",
        "full editing flow at selected text scale",
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

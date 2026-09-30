import assert from "node:assert/strict";

// The feel server uses the salesperson fixture. Give this separate context
// the same mock account as a manager; never change the server or real data.
export async function verifyManagerPhoneSearch(browser, url) {
  assert.equal(new URL(url).hostname, "127.0.0.1", "manager probe requires the local mock app");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    reducedMotion: "reduce",
  });
  const errors = [];
  try {
    await context.route("http://127.0.0.1:5433/rest/v1/profiles?**", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const manager = (profile) => ({ ...profile, role: "manager", wants: "manager", onboarded: true });
      await route.fulfill({ response, json: Array.isArray(body) ? body.map(manager) : manager(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[autocomplete="username"]').fill("demo@sageonline.app");
    await page.locator('input[type="password"]').fill("x");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".bp-row").first().waitFor({ state: "visible", timeout: 40000 });
    const field = page.getByPlaceholder("Search associates", { exact: true });
    for (const width of [390, 720, 760]) {
      await page.setViewportSize({ width, height: 844 });
      await field.waitFor({ state: "visible", timeout: 5000 });
      const display = await field.evaluate((input) => {
        const row = input.closest(".seg-wrap");
        const box = input.getBoundingClientRect();
        return { row: getComputedStyle(row).display, width: box.width, height: box.height,
          tabs: [...row.querySelectorAll(".seg")].map((tab) => getComputedStyle(tab).display) };
      });
      assert.equal(display.row, "flex", `search row visible at ${width}px`);
      assert.ok(display.width > 0 && display.height > 0, `search input has area at ${width}px`);
      assert.ok(display.tabs.every((value) => value === "none"), "no duplicate desktop tabs");
      const nameSelector = width <= 700 ? ".bp-row .bp-nmx" : ".assoc-card .assoc-name";
      const names = page.locator(nameSelector);
      await names.first().waitFor({ state: "attached" });
      const baseline = await names.allTextContents();
      assert.ok(baseline.length > 1, "fixture must contain multiple people");
      const target = baseline[0];
      await field.fill(`  ${target.toUpperCase()}  `);
      await page.waitForFunction(([selector, name]) => {
        const rows = [...document.querySelectorAll(selector)];
        return rows.length === 1 && rows[0].textContent === name;
      }, [nameSelector, target]);
      await field.fill("no-such-person-phone-regression");
      await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, nameSelector);
      if (width <= 700) assert.equal(await page.locator(".bp-stand .fr-empty").textContent(), "Nobody here.");
      await page.locator(".search-top .search-clear").click();
      await page.waitForFunction(([selector, count]) => document.querySelectorAll(selector).length === count, [nameSelector, baseline.length]);
      assert.deepEqual(await names.allTextContents(), baseline, "clear restores the same ordered rows");
      assert.equal(await field.inputValue(), "");
      await page.emulateMedia({ media: "print" });
      assert.equal(await field.evaluate((input) => getComputedStyle(input.closest(".seg-wrap")).display), "none", "print still hides search");
      await page.emulateMedia({ media: "screen" });
      console.log(`manager phone search: ${width}px visible, type, no-match, clear and print passed`);
    }
    assert.deepEqual(errors, [], "manager page has no uncaught errors");
  } finally {
    await context.close();
  }
}

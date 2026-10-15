import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { assertDateReadability } from "./date-readability.mjs";
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
  process.env.EVIDENCE_DIR ||
  "scripts/scheduler-performance/evidence/sage-heatmap";
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const width of [1440, 390, 320])
    for (const scale of [1, 2]) {
      const key = `${engine}-${width}-text${scale * 100}`,
        page = await browser.newPage({
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
      assert.match(await entry.innerText(), /October 2026/);
      assert.doesNotMatch(await entry.innerText(), /Schedule|Staffing & sales/);
      assert.match(await entry.getAttribute("aria-label"), /October 2026, open Schedule for staffing and daily sales/);
      assert.equal(await page.locator(".s2-lampbtn").count(), 0);
      const dateBefore = await entry.locator("i:not(.blank)").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      const entryBefore = await entry.evaluate((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      );
      await page.evaluate(
        (s) => (document.documentElement.style.fontSize = `${s * 100}%`),
        scale,
      );
      assert.equal(
        await entry.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        entryBefore * scale,
      );
      assert.equal(await entry.locator("i:not(.blank)").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize)), dateBefore * scale);
      await page.keyboard.press("Tab");
      await entry.focus();
      assert.equal(await entry.evaluate(e => getComputedStyle(e).outlineStyle), "solid");
      assert.ok((await entry.boundingBox()).height >= 44);
      assert.ok(
        await entry.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return [...e.children].every((c) => {
            const b = c.getBoundingClientRect();
            return b.left >= r.left && b.right <= r.right + 1;
          });
        }),
        "entry text fits its button",
      );
      if (width < 700) {
        const units = await page.locator(".bp-l1").boundingBox(),
          schedule = await entry.boundingBox();
        assert.ok(
          schedule.y >= units.y + units.height,
          "Schedule must not cover the Performance units",
        );
      }
      assert.ok(await entry.locator("i:not(.blank)").evaluateAll(es => es.every(e => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight)), "dates fit without clipping");
      await page.screenshot({ path: `${out}/${key}-entry.png` });
      assert.equal(await entry.count(), 1, "one unified Schedule entry");
      assert.equal(
        await page.locator(".s2-salewin").count(),
        0,
        "no standalone Sold by Day popover",
      );
      assert.equal(
        await entry.locator(".sp-mini-grid").count(),
        1,
        "calendar visual belongs to Schedule entry",
      );
      assert.equal(
        await page.locator(".sp-today").count(),
        0,
        "no competing Who is on trigger",
      );
      await entry.click();
      const ret = page.getByRole("button", { name: "Return to Performance" }),
        f = page.frames().find((f) => f.url().includes("/planner/"));
      await f.locator("#month").waitFor();
      assert.equal(
        await page.locator(".fr-k-onoff").count(),
        0,
        "no old staffing popup",
      );
      assert.equal(await f.locator("#month").inputValue(), "2026-10");
      const fonts = async () =>
        Promise.all(
          ["#month", "#store", "#people"].map((s) =>
            f
              .locator(s)
              .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
          ),
        );
      const before = await fonts();
      await f.evaluate(
        (s) => (document.documentElement.style.fontSize = `${s * 100}%`),
        scale,
      );
      const after = await fonts();
      before.forEach((v, i) => assert.equal(after[i], v * scale));
      const fit = async () => {
        assert.ok(
          await f.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "no planner horizontal overflow",
        );
        assert.ok(
          await page
            .locator(".sp-dialog")
            .evaluate(
              (e) =>
                e.getBoundingClientRect().right <=
                document.documentElement.clientWidth + 1,
            ),
        );
      };
      const focus = async (id) =>
        assert.equal(
          await f.evaluate(() => document.activeElement.id),
          id,
          "focus restored after rerender",
        );
      const selectMonth = async (m) => {
        await f.locator("#month").fill(m);
        await f.locator("#month").dispatchEvent("change");
        await focus("month");
        assert.equal(await f.locator("#month").inputValue(), m);
      };
      const dates = async (m, n) => {
        const d = await f
          .locator("[data-day]")
          .evaluateAll((es) => es.map((e) => e.dataset.day));
        assert.equal(d.length, n);
        assert.equal(d[0], m + "-01");
        assert.equal(d.at(-1), m + "-" + n);
        assert.equal(new Set(d).size, n);
        assert.ok(d.every((x) => x.startsWith(m + "-")));
        await assertDateReadability(f);
      };
      const cycle = async () => {
        await ret.focus();
        for (const direction of ["Tab", "Shift+Tab"]) {
          let crossed = false,
            wrapped = false;
          for (let i = 0; i < 160; i++) {
            await page.keyboard.press(direction);
            const position = await page.evaluate(() => {
              const d = document.querySelector(".sp-dialog"),
                a = document.activeElement;
              return {
                inside: d.contains(a),
                returned: a === d.querySelector("button"),
                frame: a?.tagName === "IFRAME",
              };
            });
            assert.ok(
              position.inside,
              `${direction} must remain inside dialog`,
            );
            crossed ||= position.frame;
            if (position.returned && crossed) {
              wrapped = true;
              break;
            }
          }
          assert.ok(wrapped, `${direction} complete cycle through iframe`);
        }
      };
      if ((width === 1440 && scale === 1) || (width === 320 && scale === 2))
        await cycle();
      await f.evaluate(() => scrollTo(0, 0));
      await ret.focus();
      await fit();
      await dates("2026-10", 31);
      if (width === 1440 && scale === 1) {
        assert.equal(await f.locator(".weekday-heading").count(), 7);
        assert.equal(
          await f
            .locator(".month-days")
            .evaluate(
              (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
            ),
          7,
        );
        const headers = await f
          .locator(".weekday-heading")
          .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().left));
        for (const day of await f.locator("[data-day]").evaluateAll((es) =>
          es.map((e) => ({
            day: e.dataset.day,
            x: e.getBoundingClientRect().left,
          })),
        ))
          assert.ok(
            Math.abs(
              day.x -
                headers[(new Date(day.day + "T12:00:00Z").getUTCDay() + 6) % 7],
            ) < 1,
            "weekday alignment",
          );
        assert.equal(
          await f
            .locator(".month-days")
            .evaluate((e) =>
              [...e.children].indexOf(e.querySelector("[data-day]")),
            ),
          10,
          "three leading blanks after seven headings",
        );
      } else
        assert.equal(
          await f
            .locator("#app")
            .evaluate((e) => e.classList.contains("calendar-list")),
          true,
          "readable list at narrow widths or enlarged text",
        );
      assert.equal(
        await f.locator('[aria-current="date"]').getAttribute("data-day"),
        "2026-10-14",
      );

      assert.notEqual(
        await f.locator("#recorded-total").innerText(),
        "Not yet available",
      );
      await page.screenshot({ path: `${out}/${key}-overview.png` });
      await f.locator(".month-days").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${key}-calendar.png` });
      await f.locator("#day-2026-10-17").scrollIntoViewIfNeeded();
      await f.locator("#day-2026-10-17").screenshot({ path: `${out}/${key}-oct17.png` });
      // Current-month override and person settings survive future planning.
      await f.locator("#day-2026-10-14").click();
      for (const box of await f.locator("[name=assigned]").all())
        await box.uncheck();
      await f.getByRole("button", { name: "Apply day override" }).click();
      await focus("day-2026-10-14");
      assert.match(
        await f.locator("#day-2026-10-14").innerText(),
        /0 assigned/,
      );
      await f.locator("#people").click();
      await f.locator("[name=maxHours]").fill("32");
      await f
        .getByRole("button", { name: "Apply to local proposal", exact: true })
        .click();
      await focus("people");
      await selectMonth("2028-02");
      await dates("2028-02", 29);
      assert.equal(
        await f.locator("#recorded-total").innerText(),
        "Not yet available",
      );
      assert.match(
        await f.locator("#day-2028-02-29").innerText(),
        /Sales not yet available/,
      );
      await f.locator("#people").click();
      assert.equal(await f.locator("[name=maxHours]").inputValue(), "40");
      await f.locator("[name=maxHours]").fill("24");
      await f
        .getByRole("button", { name: "Apply to local proposal", exact: true })
        .click();
      await f.locator("#day-2028-02-29").click();
      assert.match(
        await f.locator(".recorded-day").innerText(),
        /Sales not yet available/,
      );
      assert.match(await f.locator("#sheet").innerText(), /Planning range/);
      for (const box of await f.locator("[name=assigned]").all())
        await box.uncheck();
      await f.locator("[name=assigned][value=p1]").check();
      await f.getByRole("button", { name: "Apply day override" }).click();
      await focus("day-2028-02-29");
      await f.locator("#rules").click();
      await f.locator("[name=effective]").fill("2028-02-15");
      await f.locator("[name=effective]").dispatchEvent("change");
      assert.equal(
        await f.locator("[name=effective]").inputValue(),
        "2028-02-15",
      );
      await f.locator("[name=minimum]").fill("3");
      await f.locator("[name=editHoliday]").check();
      await f.locator("[name=holiday]").fill("2028-02-29");
      await f.locator("[name=holidayState]").selectOption("closed");
      await fit();
      await page.screenshot({ path: `${out}/${key}-store.png` });
      await f.getByRole("button", { name: "Apply dated local rule" }).click();
      await focus("rules");
      assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      for (const min of ["4", "3"]) {
        await f.locator("#rules").click();
        await f.locator("[name=effective]").fill("2028-02-15");
        await f.locator("[name=effective]").dispatchEvent("change");
        await f.locator("[name=minimum]").fill(min);
        await f.getByRole("button", { name: "Apply dated local rule" }).click();
        assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      }
      await f.locator("#rules").click();
      await f.locator("[name=minimum]").fill("9");
      await f.locator("[name=minimum]").press("Escape");
      await focus("rules");
      assert.ok(await page.locator(".sp-dialog").evaluate((e) => e.open));
      await selectMonth("2026-10");
      await dates("2026-10", 31);
      assert.match(
        await f.locator("#day-2026-10-14").innerText(),
        /0 assigned/,
      );
      assert.match(await f.locator("#day-2026-10-21").innerText(), /Unknown/);
      await f.locator("#people").click();
      assert.equal(await f.locator("[name=maxHours]").inputValue(), "32");
      await f.locator("[name=maxHours]").fill("1");
      await ret.click();
      assert.equal(
        await entry.evaluate((e) => e === document.activeElement),
        true,
      );
      await entry.click();
      await f.locator("#people").click();
      assert.equal(await f.locator("[name=maxHours]").inputValue(), "32");
      await fit();
      await page.screenshot({ path: `${out}/${key}-person.png` });
      if (width === 320 && scale === 2) await cycle();
      await f.locator("[name=maxHours]").press("Escape");
      await focus("people");
      await selectMonth("2028-02");
      assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      await f.locator("#people").click();
      assert.equal(await f.locator("[name=maxHours]").inputValue(), "24");
      await f.getByRole("button", { name: "Close sheet", exact: true }).click();
      await f.locator("#store").selectOption("1");
      await focus("store");
      await f.locator("#store").selectOption("0");
      await focus("store");
      assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      await selectMonth("2026-12");
      await f.locator("#next").click();
      await focus("next");
      assert.equal(await f.locator("#month").inputValue(), "2027-01");
      await dates("2027-01", 31);
      await f.locator("#previous").click();
      await focus("previous");
      assert.equal(await f.locator("#month").inputValue(), "2026-12");
      await selectMonth("2027-02");
      await dates("2027-02", 28);
      await selectMonth("2027-04");
      await dates("2027-04", 30);
      await f.locator("#reset").click();
      await focus("reset");
      await selectMonth("2028-02");
      assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      await f.locator("#day-2028-02-15").click();
      assert.match(await f.locator("#sheet").innerText(), /3 people needed/);
      await page.screenshot({ path: `${out}/${key}-day.png` });
      await f
        .getByRole("button", { name: "Back to month", exact: true })
        .click();
      await f.locator("#today").click();
      assert.equal(await f.locator("#month").inputValue(), "2026-10");
      assert.match(await f.locator("#sheet h2").innerText(), /Oct 14, 2026/);
      await f
        .getByRole("button", { name: "Back to month", exact: true })
        .click();
      await focus("today");
      await selectMonth("2028-02");
      assert.match(await f.locator("#day-2028-02-29").innerText(), /Closed/);
      await f.locator("#reset").click();
      await focus("reset");
      assert.ok(
        await f
          .locator("#day-2028-02-29")
          .evaluate((e) => e.classList.contains("open")),
      );
      await selectMonth("2026-10");
      assert.match(
        await f.locator("#day-2026-10-14").innerText(),
        /0 assigned/,
      );
      await f.locator("#month").press("Escape");
      assert.equal(
        await page.locator(".sp-dialog").evaluate((e) => e.open),
        false,
      );
      assert.equal(
        await entry.evaluate((e) => e === document.activeElement),
        true,
      );
      if (width === 1440 && scale === 1) {
        await page.reload();
        await entry.waitFor();
        const recap = page.getByRole("button", { name: "Close the round-up" });
        if (await recap.count()) await recap.click();
        await entry.click();
        const fresh = page.frames().find((x) => x.url().includes("/planner/"));
        await fresh.locator("#month").waitFor();
        assert.equal(await fresh.locator("#month").inputValue(), "2026-10");
        assert.match(
          await fresh.locator("#day-2026-10-14").innerText(),
          /2 assigned/,
        );
        await fresh.locator("#people").click();
        assert.equal(await fresh.locator("[name=maxHours]").inputValue(), "40");
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        scale,
        fonts: { before, after },
        fullFocusCycles:
          (width === 1440 && scale === 1) || (width === 320 && scale === 2),
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

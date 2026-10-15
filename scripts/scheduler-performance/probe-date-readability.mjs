import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertDateReadability } from "./date-readability.mjs";

const engines = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "/workspace/cloud-tools/node_modules/playwright",
);
const out = process.env.EVIDENCE_DIR || "scripts/scheduler-performance/evidence/date-readability";
mkdirSync(out, { recursive: true });
const results = [];
for (const name of ["chromium", "webkit"]) {
  const browser = await engines[name].launch(name === "chromium"
    ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] } : {});
  try {
    for (const width of [1440, 390, 320]) for (const scale of [1, 2]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await page.clock.install({ time: new Date("2026-10-14T16:00:00Z") });
      await page.goto("http://127.0.0.1:5190");
      if (width > 700) await page.getByRole("button", { name: "Close the round-up" }).click();
      await page.evaluate(s => document.documentElement.style.fontSize = `${s * 100}%`, scale);
      await page.locator(".sp-calendar-entry").click();
      const frame = page.frames().find(f => f.url().includes("/planner/"));
      await frame.locator("#month").waitFor();
      await frame.evaluate(s => document.documentElement.style.fontSize = `${s * 100}%`, scale);
      await frame.waitForFunction(() => document.getElementById("app").classList.contains("calendar-list") ===
        (document.getElementById("app").clientWidth < 56 * parseFloat(getComputedStyle(document.documentElement).fontSize)));
      await assertDateReadability(frame);
      for (const day of ["14", "17"]) {
        const row = frame.locator(`#day-2026-10-${day}`);
        await row.scrollIntoViewIfNeeded();
        await row.screenshot({ path: `${out}/${name}-${width}-text${scale * 100}-date-${day}.png` });
      }
      results.push({ browser: name, version: browser.version(), width, textPercent: scale * 100, datesChecked: 31, status: "passed" });
      await page.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(`${out}/date-readability-results.json`, JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), results,
}, null, 2) + "\n");
console.log("12 date-readability scenarios passed, including every October date and the Today marker.");

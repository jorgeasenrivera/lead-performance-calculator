#!/usr/bin/env node
/* C66, the first tap. Thrown away when the row is done.
   The feel harness taps Lunch once, right after arriving on the floor, and in
   WebKit that reads 116 to 196 ms against a bar of 100 while the same tap
   repeated reads 59 to 95. This walks the harness's own sequence and then taps
   four times, saying for each what the frames did and what else was running. */
import { ensureMock, prepFloor, launch, phone, signIn } from "./probe-kit.mjs";

const URL_APP = process.env.FEEL_URL || "http://127.0.0.1:5178/";
const WHO = String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit" ? "webkit" : "chromium";
const ROOM = '.ar-room[data-room="floor"]';
const SEL = ROOM + " .sf-seg-btn";

async function main() {
  const mock = await ensureMock();
  await prepFloor();
  const b = await launch();
  const { ctx, page } = await phone(b, { width: 390, height: 844, open: "floor" });
  await ctx.route(/127\.0\.0\.1:5433/, async (r) => { await new Promise((z) => setTimeout(z, 400)); r.continue(); });
  /* Count what the page asks the server for, so a tap that waited on a
     round trip is not read as a tap that was slow. */
  let calls = 0;
  page.on("request", (r) => { if (/5433/.test(r.url())) calls++; });
  await signIn(page, URL_APP);
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector(".mc-flash-b")?.click());
  await page.waitForTimeout(600);
  console.log(`probe67 · ${WHO} · ${URL_APP}`);

  /* the harness's own arrival: the tab, the room settled, 800 ms */
  await page.locator('.ar-tab[aria-label="Live Floor"]').click();
  await page.waitForFunction(() => !!document.querySelector('.ar-room[data-room="floor"] .sf-pane-floor.on'), null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".ar-room.ar-in, .ar-room.ar-out"), null, { timeout: 15000 });
  await page.waitForTimeout(800);

  const tap = async (label, n, gap) => {
    const idx = await page.evaluate(([s, l]) => [...document.querySelectorAll(s)].findIndex((x) => x.textContent.includes(l)), [SEL, label]);
    await page.evaluate(() => {
      window.__f = { t0: performance.now(), frames: [], muts: 0 };
      let last = performance.now();
      const mo = new MutationObserver((rs) => { window.__f.muts += rs.length; });
      mo.observe(document.body, { attributes: true, childList: true, subtree: true });
      const tick = () => { const t = performance.now(); window.__f.frames.push(Math.round(t - last)); last = t;
        if (t - window.__f.t0 < 700) requestAnimationFrame(tick); else mo.disconnect(); };
      requestAnimationFrame(tick);
    });
    const before = calls;
    const t = Date.now();
    await page.locator(SEL).nth(idx).click();
    await page.waitForFunction(([s, k]) => /(^| )on( |$)/.test(document.querySelectorAll(s)[k].className), [SEL, idx], { timeout: 15000 });
    const wall = Date.now() - t;
    await page.waitForTimeout(800);
    const f = await page.evaluate(() => window.__f);
    const worst = Math.max(...f.frames.slice(1, 12));
    console.log(`  ${(n + " " + label).padEnd(10)} after ${String(gap).padStart(4)} ms of quiet   wall ${String(wall).padStart(4)} ms   worst frame ${String(worst).padStart(3)} ms   ${String(calls - before)} requests   ${f.muts} DOM writes   frames ${f.frames.slice(0, 10).join(" ")}`);
  };

  await tap("Lunch", 1, 800);
  await page.waitForTimeout(700); await tap("Here", 2, 700);
  await page.waitForTimeout(700); await tap("Lunch", 3, 700);
  await page.waitForTimeout(700); await tap("Here", 4, 700);
  /* and the same first tap again, this time after a long quiet, to tell a
     cold path from a floor that had not finished arriving */
  await page.waitForTimeout(6000); await tap("Lunch", 5, 6000);

  await ctx.close(); await b.close();
  if (mock) mock.kill();
}
main().catch((e) => { console.error("probe67:", e && e.message ? e.message : e); process.exit(1); });

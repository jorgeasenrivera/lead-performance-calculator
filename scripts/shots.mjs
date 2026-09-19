#!/usr/bin/env node
/**
 * The phone, pictured.
 * -------------------------------------------------------------------------
 * Every screen a salesperson can stand on, at the three text sizes, plus the
 * frame halfway through a swipe and the You're up takeover, written as PNGs.
 * On a pull request the checks workflow runs this in WebKit and keeps the
 * pictures, so the phone view of a change is on the pull request before the
 * phone is picked up. Nothing here is a bar: it is a look, not a measure.
 *
 * Run it:
 *   .env.local          VITE_SUPABASE_URL=http://127.0.0.1:5433
 *                       VITE_SUPABASE_ANON_KEY=mock-anon-key
 *   npm run build && npx vite preview --port 5178     (or set FEEL_URL)
 *   npm run shots       writes shots/<size>-<screen>.png, starting the mock
 *                       if port 5433 is quiet
 *
 * FEEL_BROWSER=webkit for WebKit; SHOTS_DIR for another folder; SHOTS_SIZES
 * for a subset, e.g. SHOTS_SIZES=1 for Normal only.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureMock, prepFloor, setUp, launch, phone, signIn, swipe, settled } from "./probe-kit.mjs";

const OUT = process.env.SHOTS_DIR || "shots";
const SIZES = { "1": "normal", "1.15": "large", "1.3": "largest" };
const want = (process.env.SHOTS_SIZES || "1,1.15,1.3").split(",").map((s) => s.trim()).filter((s) => SIZES[s]);
const browserName = String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit" ? "webkit" : "chromium";

const floorTab = (p) => p.locator('.ar-tab[aria-label="Live Floor"]');
/* The floor's pane in the frame (C29), or, on a build before the panes, the
   floor's content there at all. */
const paneOn = (p, which) => p.waitForFunction((w) => document.querySelector(".sf-pane")
  ? !!document.querySelector(`.ar-room[data-room="floor"] .sf-pane-${w}.on`)
  : !!document.querySelector('.ar-room[data-room="floor"] .sf-seg-btn'), which, { timeout: 30000 });
const roomAlone = (p) => p.waitForFunction(() => document.querySelectorAll(".ar-room:not([hidden])").length === 1 && !document.querySelector(".ar-room.ar-in, .ar-room.ar-out"), null, { timeout: 15000 });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mock = await ensureMock();
  const floor = await prepFloor();
  const b = await launch();
  const taken = [];
  const shot = async (page, name) => { const f = path.join(OUT, name + ".png"); await page.screenshot({ path: f }); taken.push(f); };
  try {
    for (const size of want) {
      const tag = SIZES[size];
      const { ctx, page, errors } = await phone(b, { prefs: { "lpcf:pref:text": size } });
      await signIn(page);
      await shot(page, `${tag}-home`);
      /* Home, scrolled to the foot: the corner is the one screen that scrolls,
         and its foot is where the bar's reserve shows or does not. */
      await page.evaluate(() => { const s = document.querySelector(".sf-pane-home > .sf-scroll") || document.querySelector('.ar-room[data-room="floor"] .q-page.sf'); if (s) s.scrollTop = 99999; });
      await page.waitForTimeout(400);
      await shot(page, `${tag}-home-foot`);
      await page.evaluate(() => { const s = document.querySelector(".sf-pane-home > .sf-scroll") || document.querySelector('.ar-room[data-room="floor"] .q-page.sf'); if (s) s.scrollTop = 0; });
      /* Halfway to the floor, thumb still down. */
      await swipe(page, { x0: 300, x1: 120, lift: false });
      await settled(page);
      await shot(page, `${tag}-home-to-floor-mid`);
      await page.evaluate(() => { const ev = new Event("touchcancel", { bubbles: true }); document.querySelector(".ar-stack")?.dispatchEvent(ev); });
      await page.waitForTimeout(600);
      await floorTab(page).click(); await paneOn(page, "floor"); await page.waitForTimeout(1200);
      await shot(page, `${tag}-floor`);
      await page.locator('.ar-tab[aria-label*="Phone"]').click(); await roomAlone(page); await page.waitForTimeout(1200);
      await shot(page, `${tag}-line`);
      await floorTab(page).click(); await roomAlone(page); await page.waitForTimeout(800);
      if (errors.length) console.error(`shots: page errors at ${tag}:`, errors);
      await ctx.close();
    }
    /* You're up, at Normal: the one takeover, and the floor snapped to. */
    await setUp(floor);
    const { ctx, page } = await phone(b);
    await signIn(page);
    await page.waitForTimeout(1500);
    await shot(page, "normal-up");
    await ctx.close();
  } finally {
    await b.close().catch(() => {});
    if (mock) mock.kill();
  }
  console.log(`shots · ${browserName} · ${taken.length} pictures in ${OUT}/`);
  for (const f of taken) console.log("  " + f);
}

main().catch((e) => { console.error("shots:", e && e.message ? e.message : e); process.exit(1); });

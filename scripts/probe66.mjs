#!/usr/bin/env node
/* C66 probe. Thrown away when the row is done.
   What a tap of the segment and a cross between the rooms cost, in this
   browser, with the rail's travelling dots running and with them detached.
   The dots are two <s class="lt"> that write transform and opacity inline on
   every frame for as long as the screen is up (useTrackLight, lineLight). */
import { ensureMock, prepFloor, launch, phone, signIn } from "./probe-kit.mjs";

const URL_APP = process.env.FEEL_URL || "http://127.0.0.1:5178/";
const WHO = String(process.env.FEEL_BROWSER || "").toLowerCase() === "webkit" ? "webkit" : "chromium";
const ROOM = '.ar-room[data-room="floor"]';

async function main() {
  const mock = await ensureMock();
  await prepFloor();
  const b = await launch();
  const { ctx, page } = await phone(b, { width: 390, height: 844, open: "floor" });
  await ctx.route(/127\.0\.0\.1:5433/, async (r) => { await new Promise((z) => setTimeout(z, 400)); r.continue(); });
  await signIn(page, URL_APP);
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector(".mc-flash-b")?.click());
  await page.waitForTimeout(600);
  await page.locator('.ar-tab[aria-label="Live Floor"]').click();
  await page.waitForSelector(ROOM + " .sf-seg-btn", { timeout: 30000 });
  await page.waitForTimeout(1500);
  console.log(`probe66 · ${WHO} · ${URL_APP}`);

  /* How many inline style writes land in one second of the screen at rest,
     and on what. */
  const atRest = async (tag) => {
    const r = await page.evaluate(() => new Promise((done) => {
      const log = [];
      const mo = new MutationObserver((rs) => { for (const x of rs) log.push((x.attributeName || x.type) + " " + ((x.target.className && x.target.className.baseVal !== undefined ? x.target.className.baseVal : x.target.className) || x.target.nodeName)); });
      mo.observe(document.body, { attributes: true, childList: true, subtree: true });
      let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else { mo.disconnect(); done({ n, log }); } };
      requestAnimationFrame(tick);
    }));
    const tally = {}; for (const k of r.log) tally[k] = (tally[k] || 0) + 1;
    const top = Object.entries(tally).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${v}x ${k}`).join(" | ");
    console.log(`  at rest ${tag.padEnd(10)} ${String(r.n).padStart(3)} frames in a second, ${String(r.log.length).padStart(4)} DOM writes   ${top}`);
  };

  const tap = async (label) => {
    const sel = ROOM + " .sf-seg-btn";
    const idx = await page.evaluate(([s, l]) => [...document.querySelectorAll(s)].findIndex((x) => x.textContent.includes(l)), [sel, label]);
    const t = Date.now();
    await page.locator(sel).nth(idx).click();
    await page.waitForFunction(([s, k]) => /(^| )on( |$)/.test(document.querySelectorAll(s)[k].className), [sel, idx], { timeout: 15000 });
    const wall = Date.now() - t;
    await page.waitForTimeout(800);
    return wall;
  };

  const cross = async (to) => {
    const t = Date.now();
    await page.locator(`.ar-tab[aria-label*="${to}"]`).click();
    if (to === "Phone") await page.waitForSelector(".sfl-title, .mcf-home", { timeout: 20000 });
    else await page.waitForSelector(ROOM + " .sf-seg-btn", { timeout: 20000 });
    const wall = Date.now() - t;
    await page.waitForTimeout(1500);
    return wall;
  };

  const round = async (tag) => {
    await atRest(tag);
    const lunch = [], here = [], toPhone = [], toFloor = [];
    for (let k = 0; k < 3; k++) { lunch.push(await tap("Lunch")); here.push(await tap("Here")); }
    for (let k = 0; k < 3; k++) { toPhone.push(await cross("Phone")); toFloor.push(await cross("Live Floor")); }
    const say = (n, a) => console.log(`  ${tag.padEnd(10)} ${n.padEnd(16)} ${a.map((x) => String(x).padStart(4)).join("  ")} ms`);
    say("tap Lunch", lunch); say("tap Here", here); say("Floor to Phone", toPhone); say("Phone to Floor", toFloor);
  };

  await round("as is");

  /* The room bar's backdrop blur. It is fixed above the rooms, so everything
     that moves under it is re-sampled through it; the corner's pill had its
     blur taken out for exactly this reason (the note at .mc-pill). */
  await page.addStyleTag({ content: ".ar-bar{ backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }" });
  await page.waitForTimeout(1000);
  await round("no blur");

  /* The rail's travelling dots. The rAF loop goes on writing to them, but a
     node outside the document dirties nothing. */
  const gone = await page.evaluate(() => { const d = [...document.querySelectorAll("s.lt")]; d.forEach((x) => x.remove()); return d.length; });
  console.log(`  detached ${gone} travelling dots`);
  await page.waitForTimeout(1200);
  await round("neither");

  await ctx.close(); await b.close();
  if (mock) mock.kill();
}
main().catch((e) => { console.error("probe66:", e && e.message ? e.message : e); process.exit(1); });

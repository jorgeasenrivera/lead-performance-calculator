/**
 * The feel, held in the source.
 * -------------------------------------------------------------------------
 * scripts/feel.mjs measures the phone in a browser and needs one running. This
 * is the part of that bar that can be read off the code in forty milliseconds,
 * so `npm test` catches the easy ways of losing it: a control greyed out for a
 * round trip, a curtain that grew back, a waiting screen that shows late and
 * stays, a tap that waits for the server, a rail that springs on `left`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
const tv = fs.readFileSync(new URL("../src/leaderboard-template.mjs", import.meta.url), "utf8");
const stn = fs.readFileSync(new URL("../api/_stations.mjs", import.meta.url), "utf8");
const ing = fs.readFileSync(new URL("../api/ingest.mjs", import.meta.url), "utf8");
const keys = fs.readFileSync(new URL("../api/_store-keys.mjs", import.meta.url), "utf8");
const feel = fs.readFileSync(new URL("../scripts/feel.mjs", import.meta.url), "utf8");
const sm = fs.readFileSync(new URL("../api/_store-month.mjs", import.meta.url), "utf8");
const fn = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name + " exists"); return src.slice(i, src.indexOf("\n}\n", i)); };

test("the status controls are never greyed out for a round trip", () => {
  for (const name of ["SfStatusSelect", "SfTiles"]) assert.ok(!/disabled=\{/.test(fn(core, name)), name + " has no disabled");
  for (const name of ["AssistBlock", "SeatBlock"]) assert.ok(!/useState\(false\);\s*$/m.test(fn(core, name).split("\n").filter((l) => /busy/.test(l)).join("\n")), name + " has no busy state");
});

test("both rooms commit a tap before the server answers", () => {
  assert.equal(core.split("useCommit(setRow, mutateRow, refetch, writes)").length - 1, 2, "the line and the floor both use the commit");
  assert.ok(/if \(writes\.current > 0\) return;/.test(core), "the poll holds off while a write is in flight");
  for (const name of ["setFlag", "leave"]) assert.ok(!new RegExp(`async function ${name}\\(`).test(core), name + " does not await the row");
});

/* The motion tokens: one set of numbers in the stylesheet, the same set in the
   script, read from the source here so they cannot drift apart. */
function motion() {
  const css = {}; const t = /--t-(\w+): (\d+)ms/g; let m;
  const block = /--t-press:[^\n]*/.exec(core); assert.ok(block, "the --t-* tokens exist");
  while ((m = t.exec(block[0]))) css[m[1]] = Number(m[2]);
  const js = /const MOTION = \{([^}]*)\};/.exec(core); assert.ok(js, "MOTION exists");
  const script = {}; for (const [, k, v] of js[1].matchAll(/(\w+): (\d+)/g)) script[k] = Number(v);
  return { css, script };
}

test("the motion tokens agree, in the stylesheet and in the script", () => {
  const { css, script } = motion();
  assert.deepEqual(css, script, "--t-* and MOTION hold the same numbers");
  for (const k of ["press", "release", "exit", "swap", "settle", "wipe"]) assert.ok(k in css, "token " + k);
});

test("the curtain is one quick sweep and every change gets one", () => {
  const { css } = motion();
  assert.ok(/\.q-curtain\.q-wipe\{animation:qcurtain var\(--t-wipe\)/.test(core), "the wipe reads its token"); assert.ok(css.wipe <= 400, "sweep at most 400 ms");
  assert.ok(/\.q-curtain\.q-out\{animation:qcurtainOut var\(--t-settle\)/.test(core), "the exit reads its token"); assert.ok(css.settle <= 350, "exit at most 350 ms");
  assert.equal(core.split("wipeT.current.end = setTimeout(() => setWiping(false), MOTION.wipe);").length - 1, 2, "the wipe's end timer lives outside the effect, in both rooms");
  assert.equal(core.split("}, MOTION.swap);").length - 1, 2, "the swap is paced by its token in both rooms");
});

test("waiting screens show soon and leave the moment the wait is over", () => {
  const m = /function useHeld\(active, \{ delay = (\d+), hold = (\d+) \}/.exec(core); assert.ok(m, "useHeld defaults");
  assert.ok(Number(m[1]) <= 500, "shown within half a second"); assert.ok(Number(m[2]) <= 300, "held no longer than 300 ms");
});

test("every sign-in gets the arrival; only reduced motion lands short", () => {
  assert.ok(/jumpShort = arrivalShort\(\);/.test(core), "decided at the press");
  assert.ok(!/JUMP_DAY_KEY|arrivalTaken/.test(core), "no daily read or write suppresses a repeat");
  assert.ok(/reduce \? 320 : ARRIVAL\.assemble/.test(core) && /const reduce = jumpShort;/.test(core), "the landing reads the same decision");
});

test("every control gives under the finger, and the tick is at touch-down", () => {
  assert.ok(/window\.addEventListener\("pointerdown", pressDown/.test(core), "the press listens at the window");
  assert.ok(/-webkit-tap-highlight-color: transparent/.test(core), "no grey flash");
  assert.ok(/if \(tick\) buzzTickAt = Date\.now\(\);/.test(core), "the click's short buzz stands down after a tick");
  assert.ok(/duration: MOTION\.press, easing/.test(core) && /duration: MOTION\.release, easing/.test(core), "the press and the release are paced by their tokens");
  for (const c of ["sf-seg-btn", "sft", "sf-link", "sf-go", "mc-tab", "fba-btn", "ar-tab", "botnav-btn", "sect-chip"])
    assert.ok(!new RegExp("\\." + c + ":active[^{]*\\{[^}]*scale\\(").test(core + mgr), c + " has no :active scale of its own to compound with the press");
});

test("the bar at the foot rises once the first room is there, and the boot is under the curtain", () => {
  assert.ok(/className=\{"ar-bar" \+ \(ready \? " up" : ""\) \+ \(drag \? " ar-thumb" : ""\)\}/.test(core), "the bar waits for ready");
  assert.equal(core.split("onReady={onReady}").length - 1, 2, "both rooms report when their curtain lets go");
  assert.ok(/\.ar-bar\.up\{ transform:translateX\(-50%\); \}/.test(core) && /\.ar-bar\{[^}]*transition:transform var\(--t-settle\) var\(--spring\)/.test(core), "it rises on the settle token");
  assert.ok(/bootHeld \|\| \(phoneBoot && bootRooms\) \? <LoadingScreen \/>/.test(core), "a phone that lives in the rooms boots under the curtain");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(/lpcf:boot"\) === "rooms"/.test(html), "index.html paints the curtain's green first");
});

test("the clocks roll: only the changed digit moves, on the settle token", () => {
  assert.equal(core.split("<b><Roll text={fmt(").length - 1, 5, "the floor's two clocks and the line's three roll");
  assert.ok(/\.roll-in\{ animation:rollIn var\(--t-settle\) var\(--spring\) both; \}/.test(core), "the roll reads its tokens");
  assert.ok(/prefers-reduced-motion: reduce\)\{ \.roll-in, \.roll-out\{ animation:none; \}/.test(core), "reduced motion cuts");
});

test("the status pill glides on the tokens and the heading crossfades", () => {
  assert.ok(/\.sf-seg-pill\{[^}]*transition:transform var\(--t-settle\) var\(--spring\)/.test(core), "the pill rides the settle token");
  assert.equal(core.split('className="mcf-title" key={title}').length - 1, 2, "the floor's heading remounts on change");
  assert.ok(/className="sfl-title" key=\{title\}/.test(core) && /className="sf-line-1" key=\{title\}/.test(core), "the line's headings too");
  assert.ok(/\.mcf-title, \.sfl-title, \.sf-line-1\{ animation:titleIn var\(--t-settle\)/.test(core), "the crossfade reads its token");
});

test("the LED dots re-form on a change, in the rooms and on the cord, and gather into UP at the door", () => {
  assert.ok(/function useDotsReform\(ref, chars, digitSel\)/.test(core) && /useLayoutEffect\(\(\) => \{\s*const was = drawn\.current;/.test(core), "one reform for every dot-matrix number");
  assert.ok(/useDotsReform\(ref, chars, "\.led-digit"\)/.test(core) && /useDotsReform\(ref, chars, "\.dm-digit"\)/.test(core), "the rooms' LED and the cord's count both reform");
  assert.ok(/duration: MOTION\.settle, easing: "cubic-bezier\(\.32,\.72,\.33,1\)"/.test(core), "a travelling dot rides the settle token");
  assert.ok(/"U": \["101", "101", "101", "101", "111"\]/.test(core) && /value=\{isNext \? "UP" : availableAhead\}/.test(core), "UP at the door");
});

test("a departure at the door shuffles the line up, 40 ms apart, on the rail and on the cord", () => {
  assert.ok(/"mcf-pip" \+ \(i === 0 \? " hd" : ""\)\} style=\{\{ "--p": headL\(i\), transitionDelay: `\$\{i \* 40\}ms`/.test(core), "the track staggers from the door");
  assert.ok(/const lag = \(id\) => `\$\{Math\.max\(0, fromHead\.indexOf\(id\)\) \* 40\}ms`;/.test(core) && /offsetDistance: sfPct\(tOf\[p\.id\]\), transitionDelay: lag\(p\.id\)/.test(core), "the cord staggers from the handset");
});

test("the phone speaks six things by feel, by name, in the page and in the shell", () => {
  const names = ["tick", "taken", "sent", "asked", "up", "refused"];
  const m = /const BUZZ = \{([^}]*)\};/.exec(core); assert.ok(m, "the vocabulary exists");
  for (const n of names) assert.ok(new RegExp("\\b" + n + ":").test(m[1]), "web has " + n);
  assert.ok(/nativePost\("buzz", name \? \{ name, pattern \} : pattern\)/.test(core), "the name travels to the shell with the pattern");
  assert.ok(!/buzz\(\[30, 60, 30\]\)/.test(core) && !/buzz\(\[40, 60, 40\]\)/.test(core), "you're up and refused are named, not numbered");
  const shell = fs.readFileSync(new URL("../native/App.js", import.meta.url), "utf8");
  for (const n of names) assert.ok(new RegExp("\\b" + n + ": \\(\\) => H\\.").test(shell), "shell plays " + n);
  assert.ok(/pref === "quiet" && !isTick/.test(core), "quiet keeps the tick only");
});

test("no connection is a bar with weight; stale is a small stamp; nothing greys out", () => {
  assert.ok(/className=\{"ar-net" \+ \(back \? " back" : ""\)\}/.test(core), "the bar, mint for a beat on the way back");
  assert.ok(/\.ar-net\{ position:fixed; z-index:104; top:0;/.test(core) && /animation:netIn var\(--t-settle\) var\(--spring\) both/.test(core), "it drops in from the top on the settle token");
  assert.ok(/staleMins > 0 && \(/.test(core) && /className="ar-age"/.test(core), "the stale stamp");
  assert.ok(/if \(!offline\) netState\.okAt = Date\.now\(\);/.test(core), "the last read that worked is remembered");
  assert.ok(/html\.net-off \.q-page\.sf\{ --glow:/.test(core) && !/html\.net-off[^}]*opacity/.test(core), "the glow cools; nothing dims");
});

test("the rails spring on transform, not left", () => {
  assert.ok(!/style=\{\{ left: (headL|behindL|youL|leftOf)/.test(core + mgr), "no pip placed by an inline left");
  assert.ok(/\.mc-pip, \.mcf-pip, \.mcf-you \{ left:0; transform:translate\(calc\(100cqw/.test(core), "the phone's pips ride on transform");
  assert.ok(/\.fr-pip \{ left:0; transform:translate\(calc\(100cqw/.test(mgr), "the manager's pips ride on transform");
  assert.ok(/querySelectorAll\(":scope > s\.lt"\)/.test(core), "the light takes the rail's own dots only");
});

test("one object across rooms: the mark flies, the rooms travel, and less motion gets the cut", () => {
  /* The arriving ground used to be handed down as a custom property so a flat
     layer could drop it in whole. The backdrop paints it now, travelling, so
     that whole path went with it rather than being left dead. */
  assert.ok(/const crossRooms = \(from, to, dx\) => \{/.test(core) &&
    /crossRooms\(room === "line" \? "line" : "floor", r === "line" \? "line" : "floor", dx\);/.test(core), "a tab switch crosses the rooms");
  /* A finish that a thumb started carries on from where the thumb left off. It
     used to throw that away and restart from the tap's 26 per cent, so the
     pages jumped backwards on release: measured, the leaving sheet from -250px
     to 0 in one frame. The same frame put its title inside the cut, which is
     the peek of letters near the edge Jorge saw on 18 September. */
  assert.ok(/if \(took\) go\(s0\.to, true, dx\);/.test(core) && /const go = \(t, bySwipe, dx\) => \{/.test(core),
    "the release hands on where the thumb actually left the sheets");
  /* One motion for a tap and for a swipe. A tap used to be a push, the arriving
     sheet coming in over the one being left from 26 per cent, which is what
     Jorge called folding on 18 September. The sheets tile now whoever started
     it; the only difference is where they start, and a tap starts at nothing. */
  assert.ok(/"--ar-out0": \(cross\.dx \|\| 0\) \+ "px"/.test(core) &&
    /"--ar-in0": "calc\(" \+ \(cross\.dx \|\| 0\) \+ "px \+ " \+ \(cross\.dir > 0 \? 100 : -100\) \+ "%\)"/.test(core),
    "the arriving sheet starts a screen to the side of the one being left, from wherever the thumb left them or from nothing");
  assert.ok(/@keyframes arPageIn\{\n\s*from\{ transform:translate3d\(var\(--ar-in0, 100%\), 0, 0\); \}/.test(core) &&
    /@keyframes arPageOut\{\n\s*from\{ transform:translate3d\(var\(--ar-out0, 0px\), 0, 0\); filter:brightness\(1\); \}/.test(core),
    "and they travel the same distance on the same curve, so they stay edge to edge");
  /* The push, its two sets of cut keyframes and the flat slab before them are
     all gone rather than left unused: there is no overlap left for any of them
     to answer. */
  assert.ok(!/clip-path/.test(core) && !/arPageOutL|arPageInD|arPageOutD|x-drag/.test(core) && !/--ar-x-gnd/.test(core),
    "nothing is cut, nothing goes opaque, and none of it is left lying about");
  assert.ok(!/var\(--ar-dx, 26%\)/.test(core), "and 26 per cent, which was the push, is nowhere");
  assert.ok(!/arFadeIn|arFadeOut/.test(core), "nothing crossfades");
  /* And nothing crosses the rooms either. A band of white light used to ride
     the arriving sheet on every switch, which Jorge read as a screen wipe on
     18 September: the backdrop's three dot fields and three lights already say
     the rooms moved, and saying it twice made the weaker answer the loud one. */
  assert.ok(!/arSheen/.test(core) && !/\.ar-room\.ar-in > \.q-page\.sf::after/.test(core),
    "no light crosses the arriving room, because the ground behind it is what shows the movement");
  /* Two sheets that OVERLAP can be read through each other, which Jorge
     photographed on 17 September. It was answered first by painting a flat
     ground on both of them, which put a slab over the backdrop for 440 ms, and
     then by cutting the one being left at the line the arriving one had
     reached. The overlap itself is gone now, so both answers are: the sheets
     tile and nothing is ever behind anything. */
  assert.ok(!/--ar-x-gnd/.test(core) && !/clip-path/.test(core),
    "no sheet goes opaque and none is cut, because neither is needed once nothing overlaps");
  assert.ok(/var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\)/.test(core.split(".ar-room.ar-in > .q-page.sf{")[1].slice(0, 200)) &&
    /var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\)/.test(core.split(".ar-room.ar-out > .q-page.sf{")[1].slice(0, 200)),
    "the arriving and the leaving sheet run on one duration and one curve, which is what keeps them edge to edge");
  assert.ok(!/arDotsIn|arDotsOut|steps\(5,end\)|steps\(3,end\)|@property --ar-r/.test(core), "nothing in the switch is stepped");
  assert.ok(/const roomEl = dest\.closest\("\.q-page\.sf"\) \|\| dest\.closest\("\.ar-room"\);/.test(core), "the mark lands where the room comes to rest, not where it started");
  assert.ok(/hidden=\{room !== "line" && !\(cross && cross\.from === "line"\) && !\(drag && drag\.room === "line"\)\}/.test(core),
    "the room being left stays on screen for the whole gesture, and the one being dragged in is uncovered before the finger reaches it");
});
/* A deploy that reaches the phone a launch late is a deploy nobody can review,
   and it cost a day: two changes were reported as not working when they were
   live on the server and correct in the bundle. */
test("a new build is taken at the next open, not the one after", () => {
  const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const sw = fs.readFileSync(new URL("../src/sw.js", import.meta.url), "utf8");
  /* Adopting a build means reloading, because the running page IS the old
     build. The only question is when that is paid, and mid-session is the one
     answer that is expensive: location.reload() is held until the page it was
     called on finishes loading, so a build taken 266 ms into an open did not
     commit until 1301 ms and threw the whole boot away. Measured: 3.2 s
     against a normal 2.0 on every open that followed a deploy. */
  assert.ok(/if \(reg && reg\.waiting && !tried\) \{/.test(main) && /reg\.waiting\.postMessage\("SKIP_WAITING"\);\n\s*return;/.test(main) &&
    /navigator\.serviceWorker\.controller\) \{\n\s*asking = true;/.test(main),
    "a build waiting from last time is taken before a pixel is drawn, where the reload costs almost nothing");
  /* Three things a force-close can leave behind that a clean run never shows,
     after Jorge's 30-second open of 18 September. None of them reproduced
     here; all three are bounded now regardless of which it was. */
  assert.ok(/\}\)\.catch\(\(\) => \{ \/\* a browser without it[\s\S]{0,900}navigator\.serviceWorker\.addEventListener\("controllerchange"/.test(main) &&
    !/reg\.update\(\)\.catch\(\(\) => \{\}\);\n\s*\/\*[^*]*\*\/\n\s*let had/.test(main),
    "the takeover is listened for at the top, synchronously, because it can land 18 ms into a page and a listener attached after register() resolves is attached after it fired");
  assert.ok(/sessionStorage\.getItem\("sage:swapped"\) === "1"/.test(main) && /sessionStorage\.setItem\("sage:swapped", "1"\)/.test(main),
    "and it is taken once per open, so a takeover that stalls cannot become a reload loop");
  assert.ok(/const t = setTimeout\(\(\) => resolve\(undefined\), 1500\);/.test(sw) && /const hit = await cached\("\/", \{ ignoreVary: true \}\);/.test(sw),
    "the page never waits more than a moment and a half on the cache, because WebKit's can stall after a process kill and the open waits on it");
  assert.ok(/const copy = res\.ok \? res\.clone\(\) : null;/.test(sw) && !/res\.clone\(\)\)\)/.test(sw),
    "and a response fetched from the network is cloned before it is handed back, because a body can only be read once");
  assert.ok(/const keep = new Set\(\[CACHE, \.\.\.names\.filter\(\(n\) => n !== CACHE\)\.slice\(-1\)\]\);/.test(sw),
    "and the previous build's files stay, because a page served from them may still be fetching from them when this build takes over");
  const vite = fs.readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  assert.ok(/const version = Date\.now\(\)\.toString\(36\) \+ "-" \+ crypto/.test(vite),
    "which only works because the cache names sort by when they were built");
  assert.ok(/let drawn = false;/.test(main) && /setTimeout\(draw, 300\);/.test(main) && /\.catch\(draw\);/.test(main) &&
    /if \(!asking\) draw\(\);/.test(main),
    "and the app is drawn anyway if that is slow, throws, or the swap never happens");
  assert.ok(!/setInterval\(/.test(main) && !/let touched = false;/.test(main),
    "nothing watches for a build mid-session any more, because taking one there is what cost the open its second");
  assert.ok(/document\.addEventListener\("visibilitychange", \(\) => \{ if \(document\.hidden\) \{ letIn\(\); reg\.update\(\)/.test(main),
    "the way out is still free, and still taken");
  assert.ok(/await Promise\.all\(PRECACHE\.map\(async \(url\) => \{/.test(sw),
    "and the new build's files are fetched at once rather than one at a time");
  assert.ok(/if \(!reg\) return;/.test(main),
    "a webview that resolves register() with nothing is left alone, which it was not, and it crashed the admin store in #367");
});

/* Building a room is what starts its fetch, so a room built too late is a room
   that shows its loading skeleton to the first person who crosses to it. The
   wait was written as a flat 2.5 s where what was meant was "once the first
   room has settled". Measured at a dealership's lag: a swipe 100 ms after the
   bar appears used to show the skeleton, and does not now. */
test("the other room is built once the first has settled, not on a guess at how long that takes", () => {
  assert.ok(/if \(!ready\) return undefined;\n\s*const t = setTimeout\(\(\) => setWarm\(true\), 250\);/.test(core),
    "the first room says when it is ready and the other is built a beat later");
  assert.ok(/const t = setTimeout\(\(\) => setWarm\(true\), 2500\);/.test(core),
    "and the flat timer stays as a backstop, for a room that never reports ready at all");
});

/* Home and Live Floor were two tabs of one sheet, so a swipe between them
   moved nothing until the finger lifted and then the stage slid on the clock.
   Jorge, 17 September: all three should be swipes. C29, decided 18 September:
   the floor page lays the corner and the floor side by side as two panes and
   the pane is what travels, under the thumb and then on the rooms' clock. */
test("C29 and C74: Home and Live Floor are two pages of the floor page's own scroller", () => {
  /* C29 (18 September) gave the pair two panes moved by the rooms' gesture.
     C74 (19 September) handed the travel to the phone's own scroller, after
     a recording showed one frame in eight dropped with the script moving
     them. The shape now: the page is a horizontal scroller that snaps a page
     at a time; the panes are its two pages; nothing of ours is in the loop. */
  /* justify-content:flex-start, said out loud: the page's flex row centred its
     items by inheritance, and two panes centred in one width overflow both
     ways, so the scroller could reach only half of the second and the snap
     fell back to the first. Measured before the fix: scrollWidth 591 of a
     786 it should have been, the Home pane at -196. */
  assert.ok(/\.q-page\.sf\.sf-panes\{ display:flex; justify-content:flex-start; align-items:stretch; overflow-x:auto; overflow-y:hidden; scroll-snap-type:x mandatory;\n\s*overscroll-behavior-x:none; touch-action:pan-x pan-y;/.test(core),
    "the page scrolls sideways and snaps a page at a time, with no rubber band at the ends so a swipe off the floor reaches the rooms' gesture");
  assert.ok(/\.sf-pane\{ position:relative; flex:0 0 100%; width:100%; height:100%; scroll-snap-align:start; scroll-snap-stop:always;\n(?:\s*\/\*[^]*?\*\/\n)?\s*will-change:transform; \}/.test(core),
    "each pane is a page of it, and its own layer, so the phone keeps the one off to the side painted (C75)");
  assert.ok(/\.q-page\.sf\.sf-panes\.sf-ramp\{ scroll-snap-type:none; \}/.test(core) && /\.q-page\.sf\.sf-panes\.sf-held\{ overflow-x:hidden; \}/.test(core),
    "the snap is off while a tap's travel runs, and the scroller is locked while You're up holds the floor");
  assert.ok(!/--sf-drag/.test(core) && !/ar-tabbing/.test(core) && !/--sf-at/.test(core) && !/tab: !s0\.slide/.test(core),
    "the gesture's pane drag, its variable and its class are gone");
  assert.ok(/if \(!s0\.slide\) \{ g\.current = null; return; \}/.test(core), "and the gesture stands aside for the pair the scroller owns");
  assert.ok(/if \(n\.classList && n\.classList\.contains\("sf-panes"\)\) continue;/.test(core), "the sideways-scroller rule knows the page is ours");
  /* Two directions of truth, kept in step: the scroller settling on a page
     sets the tab; the tab set from outside takes the scroller there on the
     rooms' clock. Every scroll event reports where the page is. */
  assert.ok(/const next = idx === 0 \? "corner" : "floor";\n\s*if \(next !== tabRef\.current\) setTab\(next\);/.test(core), "a settled page becomes the tab");
  assert.ok(/const k = Math\.min\(1, \(now - t0\) \/ MOTION\.wipe\);\n\s*const e = 1 - Math\.pow\(1 - k, 3\);\n\s*el\.scrollLeft = from \+ \(want - from\) \* e;/.test(core), "a tab set from outside travels the scroller on the rooms' clock and curve");
  assert.ok(/if \(onSlide && !r\.driving\) onSlide\(Math\.max\(0, Math\.min\(1, el\.scrollLeft \/ \(el\.clientWidth \|\| 1\)\)\)\);/.test(core), "and a scroll event says where the page is, unless the ramp or the thumb already has");
  /* Under the thumb nothing reads layout: the page's width is read once at
     the touch. A read behind the pill's write forced a layout of the whole
     floor page mid-frame, which is what the CI runner dropped frames on. */
  assert.ok(/const w = f\.w;\n\s*const frac = /.test(core) && /r\.f = \{ x0: t\.clientX, y0: t\.clientY, w, s0: el\.scrollLeft \/ w,/.test(core),
    "the thumb reads the page's width once, at the touch, never behind a write");
  /* C76: the phone's scroll reports arrive about a tenth of a second after
     the panes have moved, so the ramp and the thumb report the position
     themselves and the late reports are ignored while they drive. */
  assert.ok(/r\.driving = true;\n\s*if \(onSlide\) onSlide\(from \/ w\);/.test(core) && /if \(onSlide\) onSlide\(Math\.max\(0, Math\.min\(1, \(from \+ \(want - from\) \* e\) \/ w\)\)\);/.test(core),
    "the ramp reports where it is putting the page, before the first frame and on every step");
  assert.ok(/el\.addEventListener\("touchmove", move, \{ passive: true \}\);/.test(core) && /const frac = Math\.max\(0, Math\.min\(1, f\.s0 - dx \/ w\)\);/.test(core)
    && /const lift = \(\) => \{\n\s*const f = r\.f; r\.f = null;\n\s*if \(!f \|\| !f\.moved\) return;\n\s*r\.driving = false;/.test(core) && !/COAST/.test(core),
    "under a thumb the report is the thumb's, and when it lifts the phone's own reports drive the pill and the ground to the settle (F1: no finish on a clock of their own, no guessed page)");
  assert.ok(/on: !el\.classList\.contains\("sf-held"\) && !sideways\(e\.target\)/.test(core) && /if \(Math\.abs\(dx\) < Math\.abs\(dy\) \* RATIO\) \{ f\.on = false; return; \}/.test(core),
    "and the thumb is read the way the scroller reads it: not while You're up holds the floor, not on something that scrolls sideways itself, not on a mostly vertical drag");
  /* The ground and the pill follow the report straight to the screen, not
     through a render, and the ground's own ramp stands aside for the pair. */
  assert.ok(/if \(frac == null\) \{ if \(ind\) ind\.style\.transition = ""; return; \}\n\s*slideRef\.current = frac;/.test(core) && /if \(!paintRaf\.current\) paintRaf\.current = requestAnimationFrame\(\(\) => \{ paintRaf\.current = 0; paintRef\.current\(posRef\.current\); \}\);\n\s*if \(ind\) \{ ind\.style\.transition = "none"; ind\.style\.transform/.test(core),
    "the ground is painted once a frame and the pill moved at once from the report, without a render, and the pill has no easing while the panes move");
  assert.ok(/if \(onSlide\) \{ onSlide\(idx\); onSlide\(null\); \}\n\s*const next = idx === 0/.test(core), "and gets it back when the scroller settles, on the settled page, for the next tap of a tab");
  assert.ok(/drag && drag\.dx\n\s*\? tabs\.indexOf\(active\) \+ Math\.max\(-1, Math\.min\(1, -drag\.dx/.test(core), "the pill follows a live drag toward the line before the scroller's report (C76: it stood still on that drag since C74)");
  assert.ok(/\.sf-pane > \.mc-aurora, \.sf-pane > \.mc-spine, \.sf-pane > \.mc-me\{ position:absolute; \}/.test(core) && /<McSpine rows=\{rows\} land=\{!arrived\} \/>[^]*?className="mc-me"[^]*?<\/>\n\s*\);/.test(core),
    "the profile mark rides in the pane with the spine and the lights (C76: fixed to the screen, the pane left it behind)");
  assert.ok(/if \(roomOfTab\(was\) === "floor" && roomOfTab\(active\) === "floor" && slideRef\.current != null\) return undefined;/.test(core),
    "the ground's tap ramp stands aside between Home and Live Floor, where the scroller drives");
  /* S2, S4 as before; A2 and A3 from the third recording. */
  assert.ok((core.match(/<MyCorner still=\{tab !== "corner"\} host=\{homeHost\}/g) || []).length === 2 && /const \[arrived\] = useState\(!!still\);/.test(core),
    "the corner reads at birth whether it was born in the frame");
  assert.ok(/const holdWhy = up \? "up" : corner \? null : "one";/.test(core) && /\+ \(up \? " sf-held" : ""\)/.test(core) && /if \(next === "corner" && holdRef\.current === "up"\) return;/.test(core),
    "You're up locks the scroller and refuses Home from the bar until it is taken");
  assert.ok(/\.sf-pane > \.sf-scroll\{[^}]*margin:0 -1px; width:calc\(100% \+ 2px\);/.test(core), "A2: each pane's scroll box bleeds a pixel past its pane, so two panes overlap rather than meet at a fraction");
  assert.ok(/\.sf-pane > \.mc-aurora\{ -webkit-mask-image:linear-gradient\(90deg, transparent, #000 48px, #000 calc\(100% - 48px\), transparent\);/.test(core),
    "A3: the corner's lights fade out over the last 48 points at each side of the pane");
  assert.ok(/\.lpc:has\(> \.ar-bar\) \.q-page\.sf\.sf-panes\{ padding-bottom:0; \}/.test(core) && /\.lpc:has\(> \.ar-bar\) \.sf-pane > \.sf-scroll\{ padding-bottom:72px; \}/.test(core),
    "the bar's reserve is on each pane's scroller, not on the page that now scrolls sideways");
  assert.ok(/if \(r !== "line"\) return document\.querySelector\('\.ar-room\[data-room="floor"\] \.sf-pane\.on > \.sf-scroll'\);/.test(core),
    "the floor's remembered scroll is the pane that is showing");
  assert.ok(!/\[tabMove, setTabMove\]/.test(core), "and it does not borrow a name the manager's app already uses");
});

/* The corner is where the day is read, and the floor or the line is halfway
   through something. Jorge, 18 September. Last is still there for anybody who
   wants it, and anybody who has already chosen it keeps it. */
test("the app opens at Home unless somebody has said otherwise", () => {
  assert.ok(/return OPEN_TO\.some\(\(\[k\]\) => k === v\) \? v : "home";/.test(core) &&
    /catch \(e\) \{ return "home"; \}/.test(core),
    "Home is the default, both when nothing is stored and when the store cannot be read");
  assert.ok(/const OPEN_TO = \[\["last", "LAST"\], \["home", "HOME"\], \["floor", "FLOOR"\], \["line", "LINE"\]\];/.test(core),
    "and all four choices are still offered");
});

/* Sunlight was a second set of colours for the rooms, deep green with cream on
   it, behind a switch on the corner. Jorge had it removed on 18 September. The
   guard is inverted rather than deleted, because a feature that comes back by
   halves is worse than one that never left: a stray html.sun rule with no
   switch to set the class, or a switch with no rules behind it, would both look
   like working code. */
test("Sunlight is gone, all of it, with nothing left behind to half-work", () => {
  assert.ok(!/html\.sun|\.sun\b/.test(core), "no rule is scoped to daylight");
  assert.ok(!/lpcf:pref:sun/.test(core), "nothing is stored for it");
  /* The identifiers and the label, not the word: the comment that says why it
     was removed is worth keeping, and a guard that bans prose would delete the
     reason along with the code. */
  assert.ok(!/const sunOn|flipSun|Sunlight<span/.test(core), "there is no switch, and nothing reads one");
  assert.ok(!/glyph="sun"/.test(core) && !/\n\s*sun:\s*\[/.test(core), "and its mark is out of the glyph table");
  /* The two rules that existed only to keep the backdrop out of daylight's way
     are unscoped now rather than deleted: the rooms still carry no ground of
     their own, which is what keeps two grounds from meeting as a seam. */
  assert.ok(/\.ar-stack > \.ar-room > \.q-page\.sf:not\(\.mc-light\)\{ background:transparent; \}/.test(core) &&
    /\.ar-stack \.q-page\.sf:not\(\.mc-light\)::before\{ display:none; \}/.test(core),
    "and what daylight used to be excepted from now simply always holds");
});

/* Everything on the corner used to lift 14px as it loaded. Jorge, 18 September:
   it should come in from the right instead, subtly, because a lift says the
   screen was built and a slide says it arrived, and off the Live Floor the
   second one is what happened. */
test("the corner's elements arrive from the right, not from below", () => {
  assert.ok(/@keyframes mcSlide\{ from\{ opacity:0; transform:translateX\(22px\); \} to\{ opacity:1; transform:none; \} \}/.test(core),
    "they come in from the right and settle left");
  /* Twenty-two rather than fourteen, on a curve that spends almost all of
     itself slowing down: Jorge, 18 September, they should have more of a
     landing. And the spine lands with them, having been excluded alongside the
     two things that genuinely cannot move. */
  assert.ok(/\.mc > \*:not\(\.mc-aurora\):not\(\.mc-me\)\{ animation:mcSlide \.62s cubic-bezier\(\.16,1,\.3,1\) both; \}/.test(core) &&
    !/:not\(\.mc-spine\)\{ animation/.test(core),
    "the spine arrives with the cards, and the whole set lands rather than merely appearing");
  assert.ok(/\.mc > \*:nth-child\(4\)\{ animation-delay:\.05s; \}/.test(core),
    "on the stagger the lift used, because only the direction and the distance changed");
  assert.ok(/\.mc > \*:nth-child\(4\)\{ animation-delay:\.05s; \}/.test(core) &&
    /\.mc > \*:nth-child\(9\),\.mc > \*:nth-child\(10\)\{ animation-delay:\.28s; \}/.test(core),
    "and the stagger down the page is the one it had");
  /* mcRise was declared twice, and the later one, the flash card's, silently
     won for both. Taking the corner off it leaves one definition with one
     owner. */
  assert.ok((core.match(/@keyframes mcRise\{/g) || []).length === 1,
    "mcRise is declared once now, and belongs to the flash card alone");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\{\n\s*\.mc > \*:not\(\.mc-aurora\):not\(\.mc-me\)\{ animation:none; \} \}/.test(core),
    "and less motion gets none of it, which it did not before");
});

test("the desk speaks the same vocabulary: tokens, one press, one focus ring, a tick on the phone", () => {
  const mgrCss = mgr.slice(mgr.indexOf("const MANAGER_CSS"), mgr.indexOf("ensureStyleNamed(\"sage-manager\""));
  const raw = mgrCss.split("\n").filter((l) => /transition/.test(l) && /(?<![\w.])\.[0-4]\d?s\b/.test(l));
  assert.deepEqual(raw, [], "no hand-written control duration under half a second in a transition");
  assert.ok(!/cubic-bezier\(\.34,1\.[45],\.64,1\)|cubic-bezier\(\.3,1\.3,\.[34]5?,1\)|cubic-bezier\(\.2,\.8,\.2,1\)/.test(mgrCss), "the hand springs are the shared curves");
  assert.ok(/\.lpc :is\(button, \[role="button"\], \[role="tab"\], \[role="switch"\]\):not\(:disabled\):not\(\.tdial\):not\(\.sf \*\):active\{\n  transform:scale\(\.96\); transition-duration:var\(--t-press\);/.test(mgrCss), "one press, on the press token, and the rooms keep their own");
  assert.ok(/:focus-visible\{\n  outline:2px solid var\(--p2, #2E9E5B\); outline-offset:2px; \}/.test(mgrCss), "one focus ring");
  assert.ok(/if \(e\.pointerType !== "touch"\) return;[\s\S]{0,300}buzz\("tick", true\)/.test(mgr), "the phone ticks at touch-down; a mouse never buzzes");
  assert.ok(/lastSaveError = null; buzz\("taken"\);/.test(core) && /buzz\("refused"\); lastSaveError = \(e/.test(core), "saves say taken and refused");
});

test("the phone's section chips glide under one pill, on the wipe token and the bloop curve", () => {
  assert.ok(/className="sect-pill" aria-hidden="true" style=\{pill \? \{ opacity: 1, width: pill\.w/.test(mgr), "one pill, measured off the chip");
  assert.ok(/\.sect-pill \{ position:absolute;[^}]*transition:transform var\(--t-wipe\) var\(--ease-bloop\), width var\(--t-wipe\) var\(--ease-bloop\)/.test(core), "it glides on the tokens");
  assert.ok(/\.sect-chip\.on \{ color:#fff; background:transparent; border-color:transparent; \}/.test(core), "the chip itself no longer paints the highlight");
});

test("arrivals on the tokens: nothing waits for a scroll, cards arrive 40 ms apart, the dock rises, Import asks", () => {
  assert.ok(!/is-in|settleReveals|useReveal/.test(core + mgr), "the scroll observer and its patch are gone");
  assert.ok(/:where\(\.page > \*:not\(\.board-page\):not\(\.tab-page\), \.board-page > \*, \.tab-page > \*\) \{ animation: cardIn var\(--t-settle\) var\(--ease\) both; \}/.test(core), "the page's blocks arrive on the settle token, under any move's own entrance");
  assert.ok(/:nth-child\(2\) \{ animation-delay:40ms; \}/.test(core) && /:nth-child\(n\+4\) \{ animation-delay:120ms; \}/.test(core), "40 ms apart");
  assert.ok(/\.card \{[^}]*transition: box-shadow var\(--t-wipe\) var\(--ease\); \}/.test(core), "a card no longer transitions opacity or transform");
  assert.ok(/className=\{"botnav no-print" \+ \(up \? " up" : ""\)\}/.test(mgr) && /\.botnav\.up \{ transform:none; \}/.test(mgr), "the dock rises after the first paint");
  assert.ok(/\.botnav-fab\.ready \{ animation:fabAsk 1\.2s var\(--ease\) 2; \}/.test(mgr) && /if \(ready\) buzz\("asked"\)/.test(mgr), "Import asks when it is due");
});

test("a card grows from its row and goes back the way it came", () => {
  assert.ok(/setOrigin\(\{ x: e\.clientX, y: e\.clientY, rect: \{ left: rr\.left, top: rr\.top, width: rr\.width, height: rr\.height \} \}\)/.test(mgr), "the desk row hands over its rect");
  assert.ok(/frLastTap\.rect = \{ left: rr\.left/.test(mgr) && /frLastTap\.rect = null;/.test(core), "the phone row hands over its rect, and any other tap clears it");
  assert.ok(/el\.animate\(\[\{ transform: from \}, \{ transform: "none" \}\], \{ duration: MOTION\.settle, easing: "cubic-bezier\(\.32,\.72,\.33,1\)", fill: "both" \}\)/.test(mgr), "it grows on the settle token and the spring");
  assert.ok(/el\.animate\(\[\{ transform: "none" \}, \{ transform: grew\.current \}\]/.test(mgr), "and shrinks back into the row");
  assert.ok(/\{ opacity: 0, offset: 0\.35 \}, \{ opacity: 1 \}/.test(mgr), "the inside fades in a beat later");
});

test("the rooms move with the phones: a seat or a re-seat flies the person's mark on the wipe token", () => {
  assert.ok(/function flyMark\(from, to, look = \{\}\) \{/.test(mgr) && /duration: MOTION\.wipe, easing: "cubic-bezier\(\.32,\.72,\.33,1\)", fill: "both"/.test(mgr), "one flight, on the wipe token and the spring");
  assert.ok(/flyMark\(pipEl\(person\.id\) \|\| tableEl\(sat && sat\.n\) \|\| tapped, tableEl\(station\)/.test(mgr), "seating flies from the pip, the old desk, or the name that was tapped, to the station");
  assert.ok((mgr.match(/flyMark\(tableEl\(was && was\.table\), tableEl\(/g) || []).length === 2, "re-seating flies between tables in both floor rooms");
  assert.ok(/data-id=\{p\.id\}/.test(mgr) && /data-n=\{t\.n\}/.test(core), "pips and tables can be found by id");
  assert.ok(/prefers-reduced-motion: reduce\)"\)\.matches\) return; \} catch \(e\) \{\}\n  if \(typeof from\.animate/.test(mgr), "less motion gets the cut");
  assert.ok(/if \(needsOverride\(gate\) && !forced\) \{ setWarn\(\{ station, person, gate, viaOffer \}\); return false; \}/.test(mgr) && (mgr.match(/\) !== false\) setOpen\(null\)/g) || []).length === 2, "the desk keeps its panel open when the answer is a warning");
});

test("a tool or section switch is a shove: out thinning 22 ms apart on the exit token, in with a hard landing 40 ms apart on the settle token", () => {
  assert.ok(/animation: toolOut var\(--t-exit\) cubic-bezier\(\.5,0,\.9,\.4\) both;/.test(core) && /animation: tabOut var\(--t-exit\) cubic-bezier\(\.5,0,\.9,\.4\) both;/.test(core), "the exit on the exit token, both moves");
  assert.ok(/animation: toolIn var\(--t-settle\) linear both;/.test(core) && /animation: tabIn var\(--t-settle\) linear both;/.test(core), "the entrance on the settle token, both moves");
  for (const k of ["toolIn", "tabIn"]) {
    const kf = new RegExp("@keyframes " + k + " \\{([\\s\\S]*?)\\}\\s*\\}").exec(core); assert.ok(kf, k + " keyframes");
    assert.ok(/60%\s*\{ opacity:1; transform: translateX\(0\) scaleX\(1\);/.test(kf[1]) && /72%\s*\{ opacity:1; transform: translateX\(calc\(var\(--(?:tx|tabx)-out\) \* \.1333\)\) scaleX\(\.985\);/.test(kf[1]), k + " lands at 60%, 8 px past with a 1.5% squash at 72%, then back");
  }
  assert.ok(/\.tool-enter \.page > \*:nth-child\(2\)[^{]*\{ animation-delay:40ms; \}/.test(core) && /\.tab-enter \.page > \*:nth-child\(2\)[^{]*\{ animation-delay:40ms; \}/.test(core), "arrivals 40 ms apart");
  assert.ok(/\.tool-exit \.page > \*:nth-child\(2\)[^{]*\{ animation-delay:22ms; \}/.test(core) && /\.tab-exit \.page > \*:nth-child\(2\)[^{]*\{ animation-delay:22ms; \}/.test(core), "exits 22 ms apart");
  assert.ok(/--tx-in:110px; --tx-slide:110px;/.test(core) && /--tabx-out:-60px; --tabx-in:110px;/.test(mgr), "110 px in, 60 px out, both moves");
  assert.ok(/const TOOL_EXIT = 220;/.test(core) && /const TAB_EXIT = 210;/.test(mgr) && /const TAB_ENTER = 460;/.test(mgr), "the beats wait for the last element");
});


test("the hero redraws like a tube: one beam, new above it, old below, on the settle token", () => {
  assert.ok(/ghostRef\.current = t\.cloneNode\(true\)/.test(mgr), "the old frame is a clone of the whole picture");
  assert.ok(/tube\.style\.clipPath = `inset\(0 0 \$\{\(100 - f \* 100\)\.toFixed\(2\)\}% 0\)`;\n\s*ghost\.style\.clipPath = `inset\(\$\{\(f \* 100\)\.toFixed\(2\)\}% 0 0 0\)`;/.test(mgr), "one y clips both layers against each other");
  assert.ok(/const p = Math\.min\(1, \(performance\.now\(\) - t0\) \/ MOTION\.settle\);/.test(mgr) && /beam\.style\.top = y \+ "px";/.test(mgr), "the beam takes the settle token and is drawn at the clip's own y");
  assert.ok(!/el\.classList\.add\("s2-chswitch"\)/.test(mgr), "the channel flip is retired");
});

test("the hero loses its signal like a tape, with a clean display over it", () => {
  assert.ok(/function HeroSignal\(\) \{/.test(mgr) && (mgr.match(/<HeroSignal \/>/g) || []).length >= 7, "every hero carries the signal");
  assert.ok(/hero\.classList\.toggle\("s2-off", !!net\.offline\);/.test(mgr), "the hero goes off with the connection");
  assert.ok(/\.s2-hero\.s2-off \{ --hA:#6B7580; --hB:#4A525B; --hC:#2D343B; \}/.test(mgr) && /\.s2-hero\.s2-off \.s2-noise \{ opacity:\.22; animation:s2grain/.test(mgr) && /animation:s2track 1\.4s linear infinite/.test(mgr), "grey, grain and a tracking band");
  assert.ok(/text-shadow:-1px 0 rgba\(255,60,60,\.7\), 1px 0 rgba\(60,220,255,\.7\); animation:s2jit/.test(mgr), "the type fringes and twitches");
  assert.ok(/<b>\{back \? "BACK" : "NO CONNECTION"\}<\/b>/.test(mgr) && /\.s2-osd \{ position:absolute;[^}]*background:rgba\(0,0,0,\.82\); color:#fff;/.test(mgr), "the display is clean, white on black");
  assert.ok(/stale > 0 && <span className="s2-age"/.test(mgr), "stale is a sand stamp");
  assert.ok(/export \{ buzz, MOTION, useNet,/.test(core), "the rooms' connection hook is shared");
});

test("consistency pass, items 1, 4, 7 and 9: one close, one name each, honest icons, Import once on the phone", () => {
  assert.ok(/\.lpc \.x-close\{ width:36px; height:36px; border-radius:50%;/.test(core), "one close look");
  for (const cls of ["ac-x", "ru-x", "fr-x", "drawer-x"]) assert.ok(!new RegExp('className="' + cls + '"').test(mgr), cls + " wears the one close");
  assert.ok(!/className="mc-x"/.test(core), "the rooms' close wears it too");
  assert.ok(!/(?:x-close"[^>]*>\s*<PixIcon glyph="close" size=\{)(?!15\})/.test(mgr + core), "every close glyph is 15 px");
  assert.ok(!/board: "Board"|checkout: "Checkout"|queue: "Phones"/.test(mgr), "the phone shortens widths, never words");
  assert.ok(/\["board", "TV Board"\]/.test(mgr) && !/"The Board"/.test(mgr), "the TV tool is the TV Board");
  assert.ok(/Who is taking desk \$\{st\.n\}\?/.test(mgr) && !/Station \$\{st\.n\}|Station \{st\.n\}/.test(mgr), "a desk is a desk on every surface");
  assert.ok(/drawer-section-label">Sections</.test(mgr) && /drawer-section-label">Tools</.test(mgr), "the drawer uses the desk's words");
  assert.ok(/aria-label="Zoom in"><PixIcon glyph="plus"/.test(mgr) && /  plus:      \[/.test(core) && /  dash:      \[/.test(core), "zoom in is a plus; a dash exists for no data");
  assert.ok(!/aria-label="Close"><PixIcon glyph="remove"/.test(mgr), "close is never the remove glyph");
  assert.ok(/glyph="dash" size=\{13\} \/> Nothing logged today/.test(mgr), "nothing logged is a dash, not a minus");
  assert.ok(!/drawer-item[\s\S]{0,400}<ImportBadge/.test(mgr), "the drawer no longer repeats the dock's import count");
});

test("consistency pass, items 2, 3, 5, 6 and 8: one primary, one status control, three shapes, two bars one language, help is help", () => {
  assert.ok(/\.fr-b\.pri, \.fr-b\.go\{ flex-basis:100%; min-height:48px; font-size:16px; background:var\(--frp2d\);/.test(mgr), "the room's go button is the primary, 48 px on the phone");
  assert.ok(/\.fh-go \{[^}]*min-height:40px;[^}]*color:#fff; background:var\(--facc, #10B981\);/.test(mgr) && /\.lpc \.btn\.btn-primary\{ min-height:40px; \}/.test(core), "the floor's assign is a filled 40 px primary like the desk's");
  assert.ok(/<SfStatusSelect value=\{st\} variant=\{LEAD_VARIANTS\.line\} flags=\{LINE_SELF_FLAGS\} onPick=\{pick\} \/>/.test(core), "the line wears the floor's status pill");
  assert.ok(/\.lpc \.sect-strip\{ background:rgba\(118,118,128,\.14\); border-radius:12px;/.test(core) && /\.lpc \.sect-strip \.sect-pill\{ background:rgba\(255,255,255,\.92\); border-radius:9px;/.test(core), "the phone's strip is the desk's strip");
  assert.ok(/\.mc-you \.mc-seg3 button\.on\{ background:#8FD8AF; color:#12251B; \}/.test(core) && /\.lpc \.qpick \.qpick-btn\{ flex-direction:row;[^}]*border-radius:999px; background:var\(--qa\); color:#fff;/.test(core), "the corner's three-ways are the status pill; Up Next's tiles are tool pills");
  assert.ok(/<span className="ar-lbl">\{LABEL\[t\]\}<\/span>/.test(core) && /display:flex; padding:4px; border-radius:26px;/.test(core), "the salesperson's bar names its rooms and shares the dock's geometry");
  /* Item 8 said a question mark means help everywhere and the initials mean You.
     Jorge reversed that on 16 September: the sheet behind the initials already
     carried two rows that opened the same help panel, so the question mark was a
     second door to a room you were already in. One door now, and it says so. */
  assert.ok(/onHelp=\{\(\) => \{ buzz\(8\); setHelpPanel\(true\); \}\} onYou=\{\(\) => \{ buzz\(8\); setHelpOpen\(true\); \}\}/.test(core)
    && /className="mc-me" onClick=\{onYou\} aria-label="You and help"/.test(core),
    "the initials are the one way in, and the label says both of the things behind them");
});

test("consistency pass, items 10 and 11: the app asks in its own voice, and a seat is one tap", () => {
  assert.ok(/function AskHost\(\) \{/.test(mgr) && /<AskHost \/>/.test(mgr), "one host for every ask, mounted in the shell");
  const left = mgr.split("\n").filter((l) => /window\.(confirm|prompt|alert)\(/.test(l) && !/resolve\(window\.|window\.alert\(text\)|window\.prompt\(req\.title/.test(l) && !/^\s*(\/\*|\*|\/\/)/.test(l) && !/wore the browser/.test(l));
  assert.deepEqual(left, [], "no browser dialog is left outside the fallback");
  assert.ok(/const askStock = \(name\) => askText\(`Assigning \$\{name\}`/.test(mgr) && (mgr.match(/await askStock\(realName\(/g) || []).length === 4, "the stock number is asked in a sheet at every assign");
  assert.ok(/danger: opts\.danger != null \? opts\.danger : DANGER\.test\(title\)/.test(mgr) && /\.ask-btns \.btn-primary\.bad\{ background:#C43F3F; \}/.test(mgr), "a removing question wears red");
  assert.ok(/ok: `Yes, \$\{near\.tag\}`, cancel: `No, \$\{t\} is new`/.test(mgr) && /ok: "Reused", cancel: "One-time"/.test(mgr), "the plate questions have real answers, not OK means yes");
  assert.ok(/toast\("Card copied\. Paste it into an email or a text\.", \{ kind: "ok" \}\)/.test(mgr) && /@media \(max-width:760px\)\{ \.toasts\{ bottom:calc\(92px \+ var\(--sab,0px\)\); \} \}/.test(mgr), "notices are toasts that stand above the dock");
  assert.ok(/const freeDesks = board\.seats\.filter\(\(s\) => !s\.taken && !s\.offerTo\);/.test(mgr) && /className="sd-chair" disabled=\{!!busy\}\n\s*onClick=\{\(\) => seat\(s\.n, \{ id: nextP\.id, label: realName\(nextP\.id\) \}\)\}>\{s\.n\}<\/button>/.test(mgr), "the free desks are chips on the next-up card");
  assert.ok(/\{warn && !open && \(\s*<div className="sd-inwarn">/.test(mgr), "the standard's warning lands in the same card");
  assert.ok(/stnDeco\(board, t, realName, rotates && !!nextP && !taken\.has\(nextP\.id\)\)/.test(mgr) && /\.stn-map \.fbp-tbl\.stn-off\.stn-hot\{ border-style:solid;[^}]*animation:stnHot 1\.8s var\(--ease\) infinite; \}/.test(core), "a free desk breathes while somebody waits");
  assert.ok(/const solo = Array\.isArray\(rooms\) && rooms\.length === 1 \? queueTool\(rooms\[0\]\) : null;/.test(mgr) && /rooms=\{store \? roomListOf\(config, store\.id\) : null\}/.test(mgr) && /\{picking && !solo && \(/.test(mgr), "a one-room store's dock goes straight to the room");
});

test("five-second pass, items 6 to 12: plain words, one verdict per row, the empty room speaks, grids wait, type grows, set-up steps back, Rooms", () => {
  assert.ok(/\[QUEUE_TAB, "Rooms", "door"\]/.test(mgr), "the dock's third slot is Rooms");
  assert.ok(/working today\{offToday\.length/.test(mgr) && !/to hit`|to hit<\/span>|to hit<\/button>/.test(mgr), "7 working today; goal, never to hit");
  assert.ok(/Most penalty points this month/.test(mgr) && !/Biggest Loser · most points/.test(mgr), "penalty points say so");
  assert.ok(/`\$\{behindCount\} not signed in`/.test(mgr) && /"TV link"/.test(mgr) && /"Salesperson link"/.test(mgr) && /Lead cap reached · \{limitCount\}/.test(mgr) && /Month so far/.test(mgr), "the floor's words are a manager's words");
  assert.ok(!/"Never ours"|>Never ours</.test(mgr) && /Not this store's/.test(mgr), "not this store's, everywhere");
  assert.ok(!/if \(!l\) return <span className="(?:fr-st pe-noacct|pp-noacct)">no account<\/span>;/.test(mgr), "no account is a count with an action, not a chip on every row");
  assert.ok(/className="tg-hint">Grace days: how long/.test(mgr), "grace days and lead caps explain themselves");
  assert.ok(/className=\{"bp-verdict bp-" \+ worst\}/.test(mgr) && /grid-template-columns:28px minmax\(0,1fr\) 84px 34px;/.test(mgr) && !/<PixIcon glyph="globe" size=\{13\} \/><PixIcon glyph="phone" size=\{13\} \/>/.test(mgr), "one verdict per phone row, with a glyph");
  assert.ok(/const empty = !nextName && \(waitingNames \|\| \[\]\)\.length === 0;/.test(mgr) && /Nobody has signed in yet/.test(mgr) && /<PixIcon glyph="clipboard" size=\{12\} \/>Send the sign-in code<\/button>/.test(mgr) && (mgr.match(/onEmpty=\{withoutTest\(line\)\.length === 0 \? \(\) => setShowQR\(true\) : null\}/g) || []).length === 2, "an empty room states itself and offers one action");
  assert.ok(!/<div className="f-warn">/.test(mgr) && /className="f-note"><PixIcon glyph="warn"/.test(mgr), "the dealership note lives in settings, one line");
  assert.ok(/occ\.byHour\.filter\(\(b\) => b\.staffed > 0\)\.length < 3 \?/.test(mgr) && /if \(shown < 3\) return <div className="s2-none s2-notyet">/.test(mgr), "grids and charts wait for three points");
  assert.ok(/\.cap-sent\{ font-family:var\(--font-ui\); font-weight:600; letter-spacing:0; text-transform:none; font-size:12\.5px; \}/.test(mgr) && /\.sd-cap, \.bp-fivehead \.bp-lbl, \.stnd-hh[^{]*\{ font-size:11\.5px; \}/.test(mgr) && /@media \(max-width:760px\)\{\n  \.s2-cap,[^{]*\{ font-size:12\.5px; \}/.test(mgr), "the caption floor is 11.5 on the desk and 12.5 on the phone");
  assert.ok((mgr.match(/className="btn btn-primary" onClick=\{\(\) => setShowQR\(true\)\}>Sign-in code<\/button>/g) || []).length === 2 && (mgr.match(/<div className="q-setup">/g) || []).length === 2, "sign-in code is the filled daily control; set-up is behind one button on both rooms");
});

test("five-second pass, item 5: one verdict, three colours, three pix glyphs, on every figure with a target", () => {
  assert.ok(/const TARGET_VERDICT = \{\n\s*on:\s*\{ col: "#1F8A6B", mark: "check", word: "on" \},/.test(mgr), "the verdict is defined once");
  assert.ok(/near:\s*\{ col: "#E0A100", mark: "clock", word: "near" \},/.test(mgr) && /short: \{ col: "#C8352B", mark: "warn",\s*word: "short" \},/.test(mgr), "near is a clock, short is a warn");
  assert.ok(/function Verdict\(\{ ratio, size = 11, word = false, className \}\) \{/.test(mgr) && /<PixIcon glyph=\{t\.mark\} size=\{size\} \/>/.test(mgr), "the mark is a pix glyph");
  assert.ok(!/col: "#C2361F"|col: "#C98A00"|col: "#1E8A4C"|col: "#0BB25F"/.test(mgr), "the old tier colours are gone");
  /* Item 5 put the mark on every figure with a target. Jorge took it off the
     four that already draw the thing it was saying, on 16 September: the tube,
     the dial and the bar ARE the verdict, and a glyph beside each one made the
     row busy without adding a reading. It stays where nothing is drawn. */
  assert.ok(!/<Verdict ratio=\{pctV \/ target\}/.test(mgr), "the hero's channels let the tube say it");
  assert.ok(!/<Verdict ratio=\{v\.mean\} size=\{9\}/.test(mgr), "the video rings let the dial say it");
  assert.equal((mgr.match(/\{t && <Verdict ratio=\{vShow \/ tgt\} size=\{9\} \/>\}/g) || []).length, 0,
    "and neither shape of the desk table carries one");
  /* What was kept, because it is the one thing the drawing does NOT say: which
     way the figure moved since yesterday. */
  assert.ok(/<PixIcon glyph=\{d >= 0 \? "triup" : "tridown"\} size=\{11\} \/>/.test(mgr),
    "the direction arrow stays: a tube shows where you are, not which way you are going");
  assert.equal((mgr.match(/<Verdict /g) || []).length, 2,
    "the mark survives exactly where there is no drawing: the pace sentence and the weakest standard");
  assert.ok(/toneMark\(t\)\{ return pix\(t === 'g' \? 'check' : t === 'y' \? 'clock' : 'warn'\); \}/.test(tv) && /--green:#1F8A6B; --greenbg:#E1F1EA; --yellow:#E0A100;[^}]*--red:#C8352B;/.test(tv), "the TV board speaks the same three");
  assert.ok(/--frok:#1F8A6B; --frthin:#E0A100; --frgap:#C8352B;/.test(mgr) && /--frok:#1F8A6B; --frthin:#E0A100; --frgap:#C8352B;/.test(core), "the rooms and the phone take the same three");
  assert.ok(/\.vmark\{ display:inline-flex; align-items:center; gap:3px; color:var\(--vc\);/.test(mgr), "the mark takes its figure's colour");
});

test("five-second pass, items 1, 3, 4 and 8: the lamp, the sentence, five shades, a covered hour, no PIN list", () => {
  assert.ok(/className=\{"s2-imp s2-lampbtn" \+ \(missing\.length \? "" : " done"\)\}/.test(mgr) && /<b>\{missing\.length \? `\$\{missing\.length\} due today` : "All in"\}<\/b>/.test(mgr), "the imports card is the lamp");
  assert.ok(/\.s2-lampbtn \.s2-lamp\.y\{ background:#E0A100;[^}]*animation:lampPulse/.test(mgr) && !/className="s2-answers"/.test(mgr), "the lamp breathes while a report is owed, and there is no lamp row");
  assert.ok(/<div className="s2-vitals s2-say" style=\{\{ color: paceCol \}\}>/.test(mgr) && /Short by <b>\{fmtNum\(Math\.round\(storePace\.shortAtPace\)\)\}<\/b> at this pace/.test(mgr) && !/on the board\{capTotal/.test(mgr), "the pace sentence replaced the vitals line");
  assert.ok(/"s2-ansq bloop-host an-" \+ \(weakest\.mean >= 1 \? 5 : weakest\.mean >= 0\.9 \? 4 : weakest\.mean >= 0\.75 \? 3 : weakest\.mean >= 0\.5 \? 2 : 1\)/.test(mgr) && /\.s2-ansq\.an-1\{ background:linear-gradient\(150deg,#C8352B,#8E1F17\)/.test(mgr) && /\.s2-ansq\.an-5\{ background:linear-gradient\(150deg,#2A9C77,#1B6E54\)/.test(mgr), "five grounds on the standards card");
  assert.ok(/if \(b\.staffed === 0\) return "gap";\n\s*if \(b\.staffed >= b\.of\) return "full";\n\s*return b\.staffed >= line \? "ok" : "thin";/.test(mgr), "five states on the day's line");
  assert.ok(/<span className="k-pre">not yet<\/span>/.test(mgr) && /<span className="k-full">full<\/span>/.test(mgr), "the key names all five");
  assert.ok(/export function coverLineOf\(config, storeId, seatCount\)/.test(stn) && /return Math\.ceil\(seats \/ 2\);/.test(stn), "a store sets what covered means, defaulting to half the room");
  assert.ok(/coverAt=\{coverLineOf\(config, store\.id, board\.seats\.length\)\}/.test(mgr) && /const setCoverAt = \(v\) =>/.test(mgr), "the desk reads the setting and the settings card writes it");
  assert.ok(/timeZone: STORE_TZ, hour: "numeric", hour12: false/.test(mgr), "the day's line uses the store's clock");
  assert.ok(!/onClick=\{\(\) => setShowPins\(true\)\}>PINs<\/button>/.test(mgr) && !/\["pins", "PINs"\]/.test(mgr), "the PIN list is off the manager's rooms");
});

test("five-second pass, item 2: the shortfall is drawn, and its height is the severity", () => {
  assert.ok(/const band = pctV == null \|\| h >= TARGET_AT \? null\n\s*: \{ bottom: h, height: TARGET_AT - h, deep: pctV < \(thr\[c\.id\]\.yellow \?\? target \/ 2\) \};/.test(mgr), "the band runs from the fill to the target line");
  assert.ok(/className=\{"s2-hgap" \+ \(band\.deep \? " deep" : ""\)\}/.test(mgr), "under the yellow line it goes deep");
  assert.ok(/\.s2-hgap\{ position:absolute; left:0; right:0;[^}]*repeating-linear-gradient\(135deg, rgba\(224,161,0,\.30\)/.test(mgr) && /\.s2-hgap\.deep\{ background:repeating-linear-gradient\(135deg, rgba\(255,120,105,\.42\)/.test(mgr), "hatched amber, then hatched red");
  assert.ok(!/ch-short|s2-hbar\.ch-near|animation:chShort/.test(mgr), "nothing flashes and nothing is outlined");
  assert.ok(/<span className="s2-mklbl s2-hlbl"><i className="s2-hid" style=\{\{ background: ident \}\} \/>\{c\.label\}<\/span>/.test(mgr), "the channel's identity is a dot by its name");
  assert.ok(/const col = t \? t\.col : "rgba\(255,255,255,\.3\)";/.test(mgr), "the fill takes the verdict, not the identity");
});

test("the record slims down: backups prune by what is on the server, day rows have a window, restore points left the store row, no legacy stars", () => {
  assert.ok(/async function saveShared\(key, value, quiet\) \{/.test(core) && /lastSaveError = null; if \(!quiet\) buzz\("taken"\);/.test(core), "housekeeping writes do not buzz a phone");
  assert.ok(/await saveShared\(row\.key, null, true\)/.test(core) && /saveShared\(backupStoreKey\(sid, id\), stores\[sid\], true\)/.test(core), "the prunes and the backup rows are housekeeping");
  assert.ok(/async function pruneBackups\(keep\) \{/.test(core) && /\.select\("key"\)\.like\("key", "lpc:backup:%"\)/.test(core), "the prune asks the server what is actually there");
  assert.ok(/\.select\("key"\)\.like\("key", "lpc:config:backup:%"\)/.test(core), "the orphaned meta rows go with them");
  assert.ok(/await saveShared\(BACKUP_INDEX_KEY, keep, true\);\n\s*await pruneBackups\(keep\);/.test(core), "every backup run prunes");
  assert.ok(/const BOARD_DAYS = 45;/.test(core) && /async function pruneBoardDays\(storeId\) \{/.test(core), "the day rows have a window");
  assert.ok(/const GOAL_LOOKBACK = 21;/.test(core), "and the window clears the longest read of them by a fortnight");
  /* A store row carries NO restore points now. It used to carry two, and before
     that six, and before that forty, and every one of those numbers was an
     answer to "how many copies of the store can the store's own row afford".
     Out of the row, the question stops being how many. */
  assert.ok(/export const restoreKey   = \(storeId\) => `lpc:store:\$\{storeId\}:restore:v1`;/.test(keys),
    "the restore point has a row of its own, under lpc:store: so it lands on the existing row policy");
  assert.ok(!/next\.snapshots = \[/.test(core + mgr + ing), "nothing writes a restore point back into the store row");
  assert.ok(/if \(next && next\.snapshots\) delete next\.snapshots;/.test(core) && /if \(next\.snapshots\) delete next\.snapshots;/.test(ing),
    "and both writers drop the ones older builds left inside it, which is the shape Jorge chose over migrating them");
  assert.ok(!/data\.stars\?\.\[/.test(core + mgr) && !/const starsFor/.test(mgr), "the star count RockEd replaced is no longer read");
  assert.ok(/return null;\s*\/\/ no RockEd mark at all/.test(core), "no mark means no mark");
});

test("the Online room says it is not a room yet, in the house's own parts", () => {
  assert.ok(/function OnlineSoon\(\{ store, rooms, onToolChange \}\) \{/.test(mgr), "the room has a page of its own");
  assert.ok(/\) : queue === "online" \? \(\n\s*<OnlineSoon store=\{store\} rooms=\{roomListOf\(config, store\.id\)\} onToolChange=\{onToolChange\} \/>/.test(mgr), "and it is what Online opens, instead of a queue that does nothing");
  assert.ok(/aria-label="Under construction"/.test(mgr) && /<PixIcon glyph="warn" size=\{22\} \/>/.test(mgr) && /<b>Room under construction<\/b>/.test(mgr), "the sign is the pix set's own warn on sand");
  assert.ok(/repeating-linear-gradient\(135deg, #E4C98D 0 10px, #241A06 10px 20px\)/.test(mgr), "and the tape is painted the way tape is painted");
  // The hero is the sign and the sentence, and Jorge asked for it to be
  // purposeful. A cap saying Online under a tab that already says Online, a
  // line about doors and light switches, a bar that could only ever read
  // nought and a paragraph of history were the page talking about itself.
  assert.ok(/<div className="onsoon-head">\n\s*<h2>There is no room here yet<\/h2>\n\s*<\/div>/.test(mgr), "the hero carries the headline and nothing under it");
  assert.ok(!/Seventeen days have been opened|onsoon-led|onsoon-prog|onsoon-real|It has a door, a sign, a light switch/.test(mgr), "and the cap, the sentence, the bar at nought and the history are gone, their rules with them");
  assert.ok(/\.onsoon\{ max-width:1000px; margin:64px auto 0; \}/.test(mgr), "the page clears the header by the 64px every other content page leaves");
  assert.ok(/\.onsoon-hero \.s2-tube\{ width:100%; \}/.test(mgr), "the sign takes the card, so losing the paragraph does not shrink the tape to two stubs");
  assert.ok(/\.onsoon-tape\{ width:100%; height:12px; flex:none; \}/.test(mgr), "and stacked on a phone the tape has a height, rather than taking flex-basis:0 on the axis it is now stacked along");
  assert.ok(/\.onsoon\{ padding-bottom:104px; \}/.test(mgr), "the last card ends above the dock on a phone");
  assert.ok(/onClick=\{\(\) => onToolChange\(id\)\}/.test(mgr), "and there is a way out to a room that exists");
});

test("picking a name is the whole of signing in: no PIN screen, no pad, no identity row", () => {
  assert.ok(/function pickPerson\(p\) \{\n\s*setSelected\(p\); setMsg\(""\);\n\s*joinAs\(p\);\n\s*\}/.test(core), "picking a name joins, in both flows");
  assert.equal(core.split("function pickPerson(p) {").length - 1, 2, "both the line and the floor pick the same way");
  assert.ok(!/function submitPin\(|function SfPin\(|function SfPad\(/.test(core), "the PIN screen and the pad it stood on are gone");
  assert.ok(!/step === "pin"|step === "switch"|pinMode|qHashPin|qRandSalt|qFindByPin/.test(core), "no PIN stage, no clash check, no hashing");
  assert.ok(!/queue_identity|loadQueueIdentities|mutateQueueIdentities/.test(core + mgr), "and nothing reads or writes the identity row");
  assert.ok(!/resetPin|setShowPins|sf-pin-cell|q-stage-pin/.test(core + mgr), "the manager's reset path and the PIN sheets go with it");
});

test("one way to say two names are one person: one sentence, one audit line", () => {
  assert.ok(/const FOLD_ACTION = "Folded two names into one person";/.test(mgr), "the audit says the same thing every time");
  assert.ok(!/"Folded a duplicate person"|"Merged a misread name"|"Folded a spelling into a person"|"Merged misread names"/.test(mgr.replace(/\/\*[\s\S]*?\*\//g, "")), "and the three old wordings are gone from the code that runs");
  assert.ok(/async function foldNames\(\{ data, people, from, to, units = 0, why, by, onChange, after \}\) \{/.test(mgr), "one function folds two names");
  assert.ok(/async function foldAll\(\{ data, rows, storeName, by, onChange \}\) \{/.test(mgr), "and one folds the banner's list");
  assert.equal(mgr.split("foldNames({").length - 1, 11, "every single fold on the desk and the phone goes through it (ten call sites and the function itself)");
  assert.equal(mgr.split("foldAll({").length - 1, 3, "and both Merge all buttons through the other");
  assert.ok(mgr.split("sameAs(data,").length - 1 === 1 && /onChange\(sameAs\(data, from, to,/.test(mgr), "nothing writes the fold except the one flow");
  assert.ok(/const foldClaimed = \(people, name\) =>/.test(mgr) && /if \(foldClaimed\(people, from\) && !\(await askConfirm\(foldSentence\(from, to, units\)\)\)\) return;/.test(mgr), "it asks by one rule, not by a prop three call sites had to remember");
  assert.ok(!/confirm = false, onPick/.test(mgr), "the picker no longer carries a question of its own");
});

test("printing opens one window the same way, and the poster takes the room", () => {
  assert.ok(/function printPage\(\{ name, width = 850, height = 1050, title, head = "", css = "", body, warn, delay = 400 \}\) \{/.test(mgr), "one opener");
  assert.equal(mgr.split("window.open(\"\", ").length - 1, 1, "and only it opens a print window");
  assert.equal(mgr.split("printPage({").length - 1, 5, "all four printed things go through it");
  assert.ok(!/printQueueSignIn|printFloorSignIn/.test(mgr), "the two posters are one function now");
  assert.ok(/const SIGN_IN_POSTER = \{\n\s*line: \{[^}]*\},\n\s*floor: \{/.test(mgr), "the rooms are an argument, not a copy");
  assert.ok(/async function printSignIn\(\{ store, url, date, by, room = "line" \}\) \{/.test(mgr), "one poster takes the room");
  assert.equal(mgr.split("printSignIn({").length - 1, 5, "four Print buttons and the one function");
  assert.equal(mgr.split('room: "line" }').length - 1, 2, "two of them are the phone line");
  assert.equal(mgr.split('room: "floor" }').length - 1, 2, "and two are the floor");
  assert.ok(/function printOnePager\(/.test(mgr) && /function printMonthEndRecap\(/.test(mgr), "the coaching sheet and the recap keep their own bodies");
  assert.ok(!/w\.close\(\); toast\("No associates/.test(mgr), "and an empty batch no longer leaves a blank window open");
});

test("the burst check measures from inside the page, and reads the server until it stops moving", () => {
  assert.ok(/window\.__segRaf = requestAnimationFrame\(tick\);/.test(feel), "the screen records itself on its own frames");
  assert.ok(!/while \(Date\.now\(\) - t0 < 3200\)/.test(feel), "and is not sampled over the debugging channel forty times a second");
  assert.ok(/const STILL = 2 \* LAG \+ 600;/.test(feel) && /while \(Date\.now\(\) - unchangedSince < STILL/.test(feel), "the server is read until the row has been still for longer than one write costs, not on a fixed clock and not on two reads agreeing");
  assert.ok(!/if \(now\.st === last\.st\) \{ settled = now; break; \}/.test(feel), "two reads agreeing is not settled: between two chained writes the row sits unchanged for a whole write");
  assert.ok(/trace\[trace\.length - 1\] === "Here" && trace\.indexOf\("Lunch"\) >= 0 && trace\.indexOf\("Lunch"\) < trace\.lastIndexOf\("Here"\) && mine && mine\.status === "waiting"/.test(feel), "and the bar itself is unchanged: the second tap arrives, stays, and the server ends on it");
  assert.ok(/let n = \(window\.__vib \|\| \[\]\)\.length, still = 0;/.test(feel), "the press test waits for the phone to stop buzzing before it starts counting");
});

test("the phone's own measurements survive a larger text size, and the top of the room is a band", () => {
  assert.ok(/\.q-page\.sf, \.ar-bar, \.fba-sheetwrap, \.mc-ov\{ zoom:var\(--sftxt, 1\);/.test(core), "the person's text size is still a zoom of the whole screen");
  assert.ok(/--dvh:calc\(100dvh \/ var\(--sftxt, 1\)\);/.test(core), "and the screen's height is divided back down inside it, or at Largest a full-height screen is a third taller than the phone");
  assert.equal(core.split("100dvh").length - 1, 3, "so nothing reads the viewport's height raw: only :root's default, the zoom's own division, and the note about the keyboard");
  assert.ok(/--sat:calc\(\(var\(--satr\) \+ var\(--satx\)\) \/ var\(--sftxt, 1\)\);/.test(core) && /--sab:calc\(max\(env\(safe-area-inset-bottom, 0px\), var\(--shell-inset-bottom, 0px\)\) \/ var\(--sftxt, 1\)\);/.test(core), "and so are the two insets, which are the phone's measurements and not text the person asked to enlarge");

  assert.ok(/--satr:max\(env\(safe-area-inset-top, 0px\), var\(--shell-inset-top, 0px\)\);/.test(core) && /--satx:0px;/.test(core) && /--sat:calc\(var\(--satr\) \+ var\(--satx\)\);/.test(core), "the top band is the phone's inset plus whatever the room has put over it");
  assert.ok(/html\.net-off\{ --satx:36px; \}/.test(core) && /html\.net-stale\{ --satx:30px; \}/.test(core), "the offline bar and the stale stamp each claim their own height");
  assert.ok(/document\.documentElement\.classList\.toggle\("net-stale", stale\)/.test(core), "and the stamp turns its band on the way the offline bar does");

  // Three things read the phone's inset directly and three things sat on top of
  // the room because of it: the stamp, the offline bar, and Help.
  assert.equal(core.split("env(safe-area-inset-top").length - 1, 4, "nothing reads the top inset raw except --satr and the three fallbacks, because a WebView reports none and the shell measures it");
  assert.ok(/\.ar-age\{ position:fixed; z-index:104; top:calc\(var\(--satr\) \+ 6px\); left:14px; right:auto;/.test(core), "the stamp sits in the band it made, on the left, clear of Help");
  assert.ok(/\.ar-net\{ position:fixed; z-index:104; top:0; left:0; right:0; padding:calc\(var\(--satr\) \+ 10px\)/.test(core), "and so does the offline bar");
  assert.ok(/\.q-page \.help-fab:not\(\.inline\) \{ bottom:auto; top:calc\(var\(--sat\) \+ 18px\);/.test(core), "Help clears the clock rather than sitting under it");
  assert.ok(/padding:max\(clamp\(52px,8vh,70px\), calc\(66px \+ var\(--sat\)\)\) clamp\(20px,6vw,26px\)/.test(core), "and the first row of desks starts below Help, not eight pixels under the camera");

  assert.ok(/\.mc-head\{ display:flex; flex-wrap:wrap;/.test(core) && /\.mc-corner\{[^}]*margin-left:auto; \}/.test(core) && /\.mc-side\{ min-width:0; \}/.test(core), "and the corner head takes a second line rather than printing the stamp through the weekday");
  assert.ok(/\.mc-head\{ container-type:inline-size; container-name:mchead; \}/.test(core) && /@container mchead \(max-width:300px\)\{\n  \.mc-corner\{ flex-direction:row;/.test(core), "and on that line it lies across, asked of the head and not of the screen: the text size is a zoom, and a zoom does not move a media query");
});

test("new and used are counted off the report on every screen that shows them", () => {
  // One reader, because three screens draw this and three copies of "prefer the
  // report, else estimate" is three chances to disagree about the same month.
  assert.ok(/const statedSplitOf = \(M\) => \{/.test(mgr), "there is one reader for the stock split");
  assert.equal(mgr.split("statedSplitOf(M)").length - 1, 3,
    "and the three screens that show new and used all go through it: the hero, the phone board and the digest");
  assert.ok(/M\.stated = \{ \.\.\.M\.stated, vehicles: stated\.vehicles \};/.test(ing),
    "a roll-up owns how many cars, but the grid still hands over how many were new");
  assert.ok(/vehicles: stated\.vehicles, day, at: nowISO/.test(ing), "and the grid files its own split with the rest");
  // The estimate stays, for a month whose report landed before any of this.
  assert.ok(/const f = statedM\.deliveries \/ known;/.test(mgr),
    "the scaled fallback is kept for a month filed before the split was carried");
});

test("the month's goal is asked for once, written by one writer, and a change says what it replaced", () => {
  /* A goal belongs to one month. The standing figure a month used to fall back
     on is gone from the reader, from the two writers and from the store editor,
     because any one of them keeping it would put a new month back on the last
     one's number. */
  assert.ok(/const goalMonthState = \(store, month\) => \{/.test(mgr), "one reader for whether a month has a goal");
  assert.ok(!/g\.units/.test(mgr), "nothing in the manager reads or writes a standing figure any more");
  assert.ok(/const units = g\.byMonth\[monthKey\];/.test(sm) && !/: g\.units;/.test(sm), "and the shared reader takes the month's own figure or nothing");
  assert.equal(mgr.split("!goalMonth.set &&").length - 1, 2, "both surfaces ask on the same condition: the desk hero and the phone board");

  // One writer. Two copies of this were two chances to word one event
  // differently and two places to forget that a change is not a first.
  assert.ok(/async function saveMonthGoal\(\{ config, store, draft, onSaveConfig, confirm = askConfirm \}\)/.test(mgr), "there is one writer for the goal");
  assert.equal(mgr.split("saveMonthGoal({ config, store, draft, onSaveConfig })").length - 1, 2, "and both fields go through it");
  assert.ok(!/action: "Set the monthly unit goal", detail: `\$\{store\.name\}: \$\{n\} units`/.test(mgr), "neither surface writes its own audit line any more");

  assert.ok(/const changing = own != null && own !== n;/.test(mgr), "a change is a figure this month already had, and a different one");
  assert.ok(/action: changing \? "Changed the monthly unit goal" : "Set the monthly unit goal"/.test(mgr), "Set and Changed are two actions, so a change is findable on its own");
  assert.ok(/\$\{fmtNum\(own\)\} to \$\{fmtNum\(n\)\} units for \$\{monthLabel\(month\)\}/.test(mgr), "and the line carries the figure it replaced, and which month it was");
  assert.ok(/if \(changing && !\(await confirm\(/.test(mgr), "only a real change asks first, so the first of the month stays one tap and Enter");
  assert.ok(/if \(await saveMonthGoal\(\{ config, store, draft, onSaveConfig \}\)\) setGoalOpen\(false\);/.test(mgr), "and a cancel leaves the field open rather than closing as if it had saved");

  /* This one is here because it happened. saveGoal takes the draft as its first
     argument, so a bare onClick hands it React's click event, parseInt of which
     is NaN: the Set button silently did nothing and the field stayed open as if
     the change had been refused. Both fields keep their own draft in state and
     must call it with no argument at all. */
  assert.ok(!/onClick=\{saveGoal\}/.test(mgr), "no field hands the click event in as the figure to save");

  /* Written in, not offered. A figure a screen puts up for you is a figure you
     accept without deciding, and the point of asking is that the month gets a
     number somebody chose for it. */
  assert.ok(/const \[draft, setDraft\] = useState\(""\);/.test(mgr), "the card opens on an empty field");
  assert.ok(!/lastGoal/.test(mgr), "and the hero no longer offers last month's figure either");
  assert.ok(!/placeholder=\{suggest/.test(mgr) && !/last month \$\{fmtNum/.test(mgr), "nor does it print one as a hint");
});

test("the shortfall printed next to \"at this pace\" is the pace's, not the sell gap", () => {
  /* Two different numbers, and the line used to print the wrong one under the
     right words. Holler Ford: goal 200, sold 74, so 126 still to sell while the
     month runs at 159, which is 41 short. `needPerDay` wants the 126, because
     that is what actually has to be sold; the sentence wants the 41. */
  assert.ok(/out\.shortAtPace = Math\.max\(0, goal\.bar - projected\);/.test(mgr), "the pace's own shortfall is goal against projection");
  assert.ok(/out\.short = Math\.max\(0, goal\.bar - totalUnits\);/.test(mgr), "and the sell gap is still goal against what is delivered");
  assert.ok(/Short by <b>\{fmtNum\(Math\.round\(storePace\.shortAtPace\)\)\}<\/b> at this pace/.test(mgr), "the sentence prints the pace's shortfall");
  assert.ok(/out\.needPerDay = daysLeft > 0 \? out\.short \/ daysLeft : null;/.test(mgr), "and what to sell a day is still worked from the sell gap");
  assert.ok(!/Short by <b>\{fmtNum\(Math\.round\(storePace\.short\)\)\}<\/b> at this pace/.test(mgr), "the two are never swapped back");
});

test("a restore point survives leaving the store row: one writer, one reader, and an undo that still matches its own upload", () => {
  /* The point of moving it is that the common path stops carrying it. So the
     things worth holding are that nobody put it back, and that the paths which
     genuinely need it still find it. */
  assert.ok(/const saveRestorePoint = useCallback\(async \(storeId, point\) => \{/.test(core),
    "one writer for the restore row, so the three places that take a point cannot disagree about where it goes");
  assert.equal(core.split("saveShared(restoreKey(storeId), point)").length - 1, 1,
    "and it is the only place in the app that writes that row");
  assert.ok(/const snapT = await takeRestorePoint\(view, next, "Before import"\);/.test(core),
    "the import waits for its restore point, so a failed write is known here rather than at the undo");

  /* The undo used to search an array. With one point in a row of its own the
     stamp check is what stops it rewinding to a point taken before some later
     import, which is the same protection the find() gave. */
  assert.ok(/const snap = restorePoint && restorePoint\.t === u\.snapT \? restorePoint : null;/.test(mgr),
    "an undo only uses the restore point that was taken for that upload");
  assert.ok(/if \(restorePoint === undefined\) onLoadRestorePoint\?\.\(\)/.test(mgr),
    "the panel fetches it when it opens, and undefined is not the same as none");

  // The pipeline hands it out rather than writing it, because applyToStore runs
  // inside a compare-and-set retry and has to stay synchronous.
  assert.ok(/return \{ next, results, archiveDue, restorePoint \};/.test(ing), "the pipeline returns its restore point");
  assert.ok(/await sbPut\(restoreKey\(st\.id\), lastRestorePoint\)/.test(ing), "and the caller writes it once the store row it protects has landed");
  assert.ok(/imported but its restore point did not save/.test(ing), "a restore point that fails to write says so rather than failing the import");
});

test("the phone's right gutter is one axis, and the sold line never crosses its own caption", () => {
  /* The caption sits at bottom:-14px, so wrapping grew it UPWARD and the line
     ran through the words. Measured at 390px with a real caption before the
     change: one line at Normal, two at Large and 11.9px into the chart, three
     at Largest and 13.8px in. A 360px phone wrapped at Normal. */
  assert.ok(/\.mc-trail\{[^}]*container-type:inline-size; container-name:mctl;/.test(core),
    "the caption is measured against the chart's own box, because a zoom does not move a media query");
  /* Measured, not guessed. Two coefficients were tried and both were wrong,
     because no constant can be right for a string whose length is not fixed:
     the pace word is "ON PACE" on a good month and "12.5 BEHIND" on a bad one.
     On a real phone the second one overran the card and printed the three parts
     into each other, "SEP 1GOAL 40 ... BEHINDSEP 3", with the right end off the
     screen. The browser is asked how wide the line is instead. */
  assert.ok(/font-size:calc\(9\.5px \* var\(--tl-fit, 1\)\);/.test(core),
    "the caption's size comes from a measurement, so it prints full size when it fits and shrinks only by what it must");
  assert.ok(/fit = Math\.max\(FLOOR, fit \* \(have \/ used\(\)\)\);/.test(core),
    "and the measurement is what is needed against what there is");
  assert.ok(/for \(let pass = 0; pass < 2 && used\(\) > have; pass\+\+\)/.test(core),
    "twice, because scaling the type does not scale the drawn width by the same ratio and one pass lands over");
  assert.ok(/return w \+ 16;/.test(core), "with the air between the parts counted as needed, or they print into each other");
  assert.ok(/const FLOOR = 6 \/ 9\.5;/.test(core), "shrinking stops at six points, below which nobody reads it anyway");

  /* The change that makes the whole class of bug impossible, rather than the
     one that hides it: the caption used to be pinned by its BOTTOM edge, so
     every extra line grew up and across the sold line. */
  assert.ok(/\.mc-tl\{ position:absolute; left:0; right:0; top:calc\(100% \+ 1px\); bottom:auto;/.test(core),
    "the caption hangs downward from the chart, so a second line grows where there is nothing to cross");
  assert.ok(/\.mc-tl\[data-tl-wrap\] > span\{ white-space:normal; overflow-wrap:anywhere; \}/.test(core),
    "and only once the type has floored may the parts break inside themselves");
  /* The declaration, not any mention of it: the comment above the rule names
     both of the coefficients that were tried, and that history is the useful
     part of the comment. */
  assert.ok(!/font-size:min\(9\.5px, 2\.9cqw\);/.test(core) && !/font-size:min\(9\.5px, calc\(3\.4cqw/.test(core),
    "neither guessed coefficient is still SETTING the size");
  assert.ok(/\.mc-tl\{[^}]*white-space:nowrap;/.test(core) && /\.mc-tl > span\{ white-space:nowrap; \}/.test(core),
    "nothing in the caption may wrap, which is the whole point");

  // One axis down the right side. There were three, on three different offsets.
  assert.ok(/:root\{ --mc-axis:30px; \}/.test(core), "the gutter has one centre line");
  assert.equal(core.split("var(--mc-axis)").length - 1, 4,
    "and the initials, the spine and both of the spine's own rules are measured from it");
  assert.ok(!/className="mc-help"/.test(core), "the question mark is gone: the sheet behind the initials already opened the same help panel");
  assert.ok(/\.mc > \*:not\(\.mc-aurora\):not\(\.mc-spine\):not\(\.mc-me\)/.test(core),
    "the initials are exempt from the card stacking rules, or position:relative wins and they never reach the gutter");
  /* The weekday drops to its own line only when the row truly cannot hold it.
     At 300px, borrowed from the manager's corner-head rule next door without
     measuring what THIS row needs, it fired on a real phone at Normal and put
     the day under the calendar when there was room beside it. */
  assert.ok(/@container mchead \(max-width:250px\)\{\n\s*\.mc-side\{ flex-basis:100%; \}/.test(core),
    "the weekday drops at 250px, below the width where it can sit beside the calendar");
});

test("the swipe follows the thumb, and gives way to the three things that outrank it", () => {
  /* Touch events, not pointer events, and this one is worth holding: the app
     captures the pointer on every press for the held-and-released effect, and a
     capture on another element fires pointercancel on this one. Traced in a
     browser: the cancel arrived before a single pointermove did, so the gesture
     never ran. The first version only looked like it worked because a cancel
     was treated as a release and committed the switch. */
  assert.ok(/el\.addEventListener\("touchstart", down, opt\);/.test(core) && /el\.addEventListener\("touchmove", move, opt\);/.test(core),
    "the gesture listens on touch, which pointer capture cannot take away");
  assert.ok(!/onPointerDown=\{onDown\}/.test(core), "and not on pointer events, which it can");
  assert.ok(/const onCancel = \(\) => \{ g\.current = null; setDrag\(null\); \};/.test(core)
    && /el\.addEventListener\("touchcancel", cancel, opt\);/.test(core),
    "a cancel springs back and never commits: it means the gesture was taken away, not that a finger lifted");

  // The three that outrank it, each checked in a browser as well as here.
  assert.ok(/if \(t\.clientX <= EDGE \|\| t\.clientX >= window\.innerWidth - EDGE\) return;/.test(core), "the left and right edges are the phone's, for going back");
  assert.ok(/if \(overScroller\(e?\.?target\)\) return;|if \(overScroller\(target\)\) return;/.test(core), "anything that scrolls sideways under the finger wins");
  assert.ok(/if \(Math\.abs\(dx\) < Math\.abs\(dy\) \* RATIO\) \{ g\.current = null; return; \}/.test(core), "a vertical intent wins, because the page scrolls");
  assert.ok(/\.ar-stack\{ touch-action:pan-y; \}/.test(core), "and the browser is told the across is ours and the down is its own");

  /* Whether the neighbour is another room or the other pane of the floor is
     decided when the gesture starts; both follow the thumb since C29. */
  assert.ok(/s0\.slide = roomOfTab\(to\) !== roomOfTab\(active\);/.test(core), "whether the drag tiles two rooms or two panes is decided when the gesture starts");
  assert.ok(!/if \(!s0\.slide\) return;/.test(core), "and neither pair commits on release without having followed the thumb");
  assert.ok(/\.ar-stack\.ar-dragging > \.ar-room\.ar-cur > \.q-page\.sf\{ z-index:102;\n\s*transform:translate3d\(var\(--ar-drag, 0px\), 0, 0\); \}/.test(core),
    "the sheet being left moves with the finger");
  assert.ok(/\.ar-stack\.ar-dragging > \.ar-room > \.q-page\.sf\{ animation:none !important; transition:none;/.test(core),
    "and nothing animates while a finger is down, or the sheet lags behind the thumb");
});

test("the round-up's chip stays inside its card when the row is full", () => {
  /* It took two passes to find this, and the first guess was wrong twice over.
     It is not the window: these cards are a fixed 201px from 1280 to 2560. It
     is HOW MANY cards share the row. A store with yesterday's sold split gets
     two extra, New and Used, and five columns of minmax(108px, 1fr) collapse to
     112px each. At that width the tube, the figure and the chip stop fitting,
     and with nothing allowed to give the overflow went outside the card:
     measured at 3px past the border, and 69px inside it after.

     The demo store has no sold split, so it only ever draws three cards and the
     whole thing is invisible in the mock. That is why this is a source guard
     and not something the feel run would have caught. */
  assert.ok(/\.ru2-stat-row \{ display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; \}/.test(mgr),
    "the row may wrap, so the chip drops under the figure instead of off the card");
  assert.ok(/\.ru2-stat-num \{ min-width:0; \}/.test(mgr),
    "and the figure may shrink rather than push the chip out");
  assert.ok(/\.ru2-stats \{ display:grid; grid-template-columns:repeat\(auto-fit, minmax\(108px, 1fr\)\);/.test(mgr),
    "the column floor is what makes this possible at all, and it is the thing to re-measure if it changes");
});

test("a read the timeout gave up on cannot leave a room on its curtain", () => {
  /* Jorge, 18 September, with a screenshot: force close, reopen, and Home sat
     on the Sage mark for eight minutes with "as of 8 min ago" in the corner.
     The project logs for that window showed the phone reading the floor row
     every five seconds and getting 200 every time.

     The read wrote the row's stamp itself, so a read the timeout had given up
     on wrote it when it finally finished. Every poll after that asked for the
     stamp, got the same one, answered "same", and the room, which had never
     received the row, held its curtain for as long as the app was open.
     Reproduced on the mock with the floor's first reads queued behind a token
     refresh and released in order: curtain still up at 45 s, twenty polls,
     every one a 200. */
  const fn = core.slice(core.indexOf("async function loadRowIfChanged("), core.indexOf("async function loadRowIfChanged(") + 2600);
  const read = fn.indexOf("const read = async () =>"), used = fn.indexOf("if (r.timedOut)"), set = fn.indexOf("rowStamps.set(k,");
  assert.ok(read > 0 && used > read && set > used,
    "the stamp is written by the answer that is used, after the timeout has been checked, never inside the read");
  assert.ok(/return \{ row: data \? data\.data : null, stamp: data \? \(data\.updated_at \|\| "none"\) : "missing" \};/.test(fn),
    "so the read hands back the row and the stamp together and writes nothing shared");
  assert.strictEqual((core.match(/if \(force === true \|\| !haveRow\.current\) rowStamps\.delete\(/g) || []).length, 2,
    "and both rooms ask for the whole row while they have nothing on screen, whatever the stamp says");
  assert.strictEqual((core.match(/haveRow\.current = row !== undefined;/g) || []).length, 2,
    "which is read from the room's own row, not from the stamp");
  assert.ok(/const staleMins = !net\.offline && netState\.okAt && Date\.now\(\) - netState\.okAt > 60000 \? minsOld\(netState\.okAt\) : 0;/.test(core),
    "the corner pill reads the live stamp, because the snapshot in net is only retaken when the phone goes off or comes back");
});

test("the you're up takeover is the whole screen on every tab", () => {
  /* Jorge, 18 September, two screenshots: on Live Floor the takeover ended
     above the foot of the screen with the dark ground showing under the bar;
     on Home it filled. The floor tab's stage gives up 72px to the bar and the
     takeover is sized to the stage. Measured at 393x852 before: 0 to 780 on
     Live Floor, 0 to 852 on Home, the title 36px higher on the floor. */
  assert.ok(/\.lpc:has\(> \.ar-bar\) \.sf-pane\.mc-floor \.sf-live:has\(> \.sf-uptake\),\n\.lpc:has\(> \.ar-bar\) \.q-page\.sf\.sf-line \.q-stage:has\(\.sf-uptake\),\n\.lpc:has\(> \.ar-bar\) \.q-page\.sf\.sf-line \.sf-live:has\(> \.sf-uptake\)\{ min-height:var\(--dvh\); \}/.test(core),
    "with the takeover up, the floor's and the line's stage take the full height again");
  assert.ok(/\.lpc:has\(> \.ar-bar\) \.q-page\.sf:has\(\.sf-uptake\)\{ padding-bottom:0; \}/.test(core) &&
    /\.lpc:has\(> \.ar-bar\) \.sf-pane > \.sf-scroll:has\(\.sf-uptake\)\{ padding-bottom:0; \}/.test(core),
    "and the page's own reserve goes, and the pane's, so there is no band to scroll to under it");
  assert.ok(/\.sf-uptake\{ position:absolute; inset:0;/.test(core),
    "the takeover stays absolute in its stage rather than fixed, because the rooms are transformed while they travel and a fixed box would jump between the stage and the screen mid-slide");
});

test("the corner's closing sheet prints points, not the stored fraction", () => {
  /* Jorge, 18 September: 6 of 55 shown as 0.11%, 4 of 24 as 0.17%, 9 of 36 as
     0.25%. The month stats carry the rate as a fraction and the manager's side
     multiplies by a hundred to print it; the corner did not. */
  assert.ok(/const asPoints = \(v\) => \(v == null \? null : Math\.round\(v \* 1000\) \/ 10\);/.test(core),
    "the fraction becomes points to one decimal");
  assert.ok(/pct: asPoints\(ms\.internetPct\)/.test(core) && /pct: asPoints\(ms\.phonePct\)/.test(core) && /pct: asPoints\(ms\.showroomPct\)/.test(core),
    "for all three channels");
  assert.ok(/const prev = Object\.fromEntries\(Object\.entries\(\(ms && ms\.prevPct\) \|\| \{\}\)\.map\(\(\[k, v\]\) => \[k, asPoints\(v\)\]\)\);/.test(core),
    "and the previous reading is in the same unit, so the triangle's difference is real");
  assert.ok(/\.mc-rail\{ position:relative; display:block; height:34px; border-radius:0 999px 999px 0; background:#0E1812;/.test(core),
    "and the rail on Home sits on a solid dark ground, so the light's dots are not the backdrop's dots");
});

test("the rail on Home runs in from off screen, and the month card keeps its dates only", () => {
  /* Jorge, 18 September, with screenshots: the rail's left end sat on the
     screen's edge, so the light's dots started at the edge rather than
     arriving from beyond it; and the line under the chart said in words what
     the pace line, the goal ring and the pace pill already draw. */
  assert.ok(/\.mc-railw\{ position:relative; display:block; width:auto; margin:-2px 30px 0 -46px;/.test(core),
    "the rail starts 28px past the page's edge, so the dots are off screen when they start");
  assert.ok(/overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain;/.test(core),
    "and the page clips it there rather than growing a sideways scroll, which overflow-y:auto alone would have given it");
  assert.ok(!/GOAL \$\{goal\}/.test(core) && !/\.mc-tl \.mid\{/.test(core),
    "the goal caption and its colours are gone; the two dates stay");
});

test("the phone is asked for a fix once, by the shell, never by the WebView at the door", () => {
  /* Jorge, 18 September: the app should ask for location at install and
     never again when somebody joins the line. The page read the WebView's own
     geolocation at the door, on the desk fence and on a FlyBy, and inside the
     app each of those is the WebView's prompt on top of the one the app had
     asked. One helper now, which asks the shell when the shell says it can. */
  assert.strictEqual((core.match(/navigator\.geolocation\.getCurrentPosition\(/g) || []).length, 1,
    "the browser's geolocation is read in one place, the fallback inside readFix");
  assert.ok(/if \(w && w\.__lpcNative && w\.__lpcNative\.loc && w\.ReactNativeWebView\) \{/.test(core) && /nativePost\("loc", \{ id \}\);/.test(core),
    "and inside a shell that says it answers, the page asks the shell, by id");
  assert.ok(/const readPosition = \(\) => \(storeFence && canFix\(\) \? readFix\(\{ timeoutMs: 8000 \}\) : Promise\.resolve\(null\)\);/.test(core),
    "the door reads through it");
  assert.ok(/const read = \(\) => readFix\(\{ timeoutMs: 8000 \}\);/.test(core) && /readFix\(\{ timeoutMs: 6000 \}\)\.then\(\(r\) => \{/.test(core),
    "so do the desk fence and the FlyBy");
  const app = fs.readFileSync(new URL("../native/App.js", import.meta.url), "utf8");
  assert.ok(/if \(msg\.type === "loc"\) \{/.test(app) && /Location\.getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.High \}\)/.test(app),
    "the shell answers");
  assert.ok(/const fg = await Location\.requestForegroundPermissionsAsync\(\);\n\s+if \(fg\.granted\) await Location\.requestBackgroundPermissionsAsync\(\);\n\s+\} catch \(e\) \{ \/\* no permission is no fix/.test(app),
    "and asks once, at first open, for always");
  assert.ok(/useState\(\{ loc: true, platform: Platform\.OS/.test(app), "and says so in the handoff, so an older shell is read the old way");
});

test("a room opens itself at the store's time, and says the time while it waits", () => {
  /* Jorge, 18 September: the line should open at a set time, on a schedule,
     rather than a manager opening it, because the floors open at different
     times on different days. The day's row is what "open" means; the phone
     asks the server to make it once the store's clock reaches the time. */
  assert.ok(/function useScheduledOpen\(\{ cfg, store, room, row, refetch \}\) \{/.test(core),
    "one hook, shared by the two rooms");
  assert.ok(/apiCall\("\/api\/open-room", \{ method: "POST", body: \{ store, room \} \}\)/.test(core)
    && /if \(!waiting \|\| !openedBy\(at, localClock\(new Date\(\), STORE_TZ\)\.hm\)\) return undefined;/.test(core),
    "which asks only while the day has no row and only once the store's clock has reached the time");
  assert.ok(/useScheduledOpen\(\{ cfg, store, room: "floor", row, refetch \}\)/.test(core)
    && /useScheduledOpen\(\{ cfg, store, room: variant\.kind === "line" \? "line" : "online", row, refetch \}\)/.test(core),
    "both rooms use it");
  assert.ok(/\(opensAt \? `OPENS AT \$\{clockLabel\(opensAt\)\}` : "FLOOR NOT OPEN"\)/.test(core)
    && /\(opensAt \? `OPENS AT \$\{clockLabel\(opensAt\)\}` : "LINE NOT OPEN"\)/.test(core),
    "and both say the time while they wait, or the old words when the desk opens it");
  assert.ok(/<input type="time" value=\{hours\[k\]\[d\] \|\| ""\} onChange=\{\(e\) => setHour\(k, d, e\.target\.value\)\} \/>/.test(mgr),
    "the wall sets a time per weekday, blank for the desk");
  const api = fs.readFileSync(new URL("../api/open-room.mjs", import.meta.url), "utf8");
  assert.ok(/if \(!openedBy\(at, clock\.hm\)\) return res\.status\(200\)\.json\(\{ open: false, at, now: clock\.hm \}\);/.test(api)
    && /if \(had\) return res\.status\(200\)\.json\(\{ open: true, at, made: false \}\);/.test(api)
    && /String\(error\.code\) !== "23505"/.test(api),
    "the server makes nothing before the time, and never a second row");
});

test("the decisions of 18 September: the closing sheet and the floor's buttons", () => {
  /* From the proposal page, decided by Jorge: A1 yes, A2 yes, A3 no, A4 a
     now, B1 yes, B2 yes, B3 no, B4 yes. */
  assert.ok(/const gradeOf = \(c\) => \(c\.pct == null \? null : c\.pct >= stdOf\(c\.k\)\.green \? "g" : c\.pct >= stdOf\(c\.k\)\.yellow \? "y" : "r"\);/.test(core)
    && /<u className="thr" data-l=\{stdOf\(c\.k\)\.green\}/.test(core),
    "A1: the standard sits on every bar and the rate is graded the way the wall grades it");
  assert.ok(/\.\.\.closing\.map\(\(c\) => stdOf\(c\.k\)\.green\)\);/.test(core),
    "and the bars are scaled so the standard is always on them");
  assert.ok(/<div className="mc-clbig">/.test(core) && /target=\{stdOf\(openCh\)\.green\}/.test(core) && !/className="mc-clfoot"/.test(core),
    "A2: the opened channel shows the month in figures and the line carries the standard; the sentence at the foot is gone");
  assert.ok(/const need = Math\.ceil\(\(goal \/ 100\) \* c\.leads\) - \(c\.u \|\| 0\);/.test(core) && /<div className="mc-clcoach">/.test(core),
    "A4: one line of coaching from the standard");
  assert.ok(/\{st !== "customer" && \(\n\s+<SfStatusSelect value=\{st\} variant=\{FLOOR_SEG\}/.test(core),
    "B1: with a customer, no Here, Lunch or Away");
  assert.ok(/\.fba-seated\{display:flex;align-items:center;gap:8px;margin-top:6px;background:none;border:0;/.test(core),
    "B2: the table is one line in the room's ink");
  assert.ok(/\{st === "customer" && \(\n\s+<AssistBlock meId=\{meId\}/.test(core),
    "B4: FlyBy and T.O. only with a customer");
});

/* #385 gave the tab slide an end of its own and each tab a scroll memory,
   from Jorge's five screenshots of 18 September. C29 took both away with the
   shape that needed them: there is no slide, the pane travels, and each pane
   is its own scroll box. The guard for that is with the C29 test above. */

test("the first batch under the sheets: D4, R2, and a press WebKit can run", () => {
  /* Jorge's decisions of 18 September on the two state sheets. */
  const swift = fs.readFileSync(new URL("../native/targets/queue/QueueActivity.swift", import.meta.url), "utf8");
  assert.ok(/let cord: Bool = !strip && !offer && !\(\(p\.line \?\? \[\]\)\.isEmpty\) && p\.state == "cord"/.test(swift),
    "D4: a desk free draws the desk row only; the cord is drawn on the cord state alone");
  assert.ok(/scrolls\.current\[room === "line" \? "line" : "floor"\] = el \? el\.scrollTop : 0;/.test(core) && !/= window\.scrollY;/.test(core)
    && /if \(el\) el\.scrollTop = scrolls\.current\[room === "line" \? "line" : "floor"\] \|\| 0;/.test(core),
    "R2: each room's scroll is read from its own page and put back when the room is shown");
  /* Two uses of the debugging channel, both optional: the CPU throttle, and
     the real thumb the C74 swipe rows need. The press uses neither. */
  assert.strictEqual((feel.match(/newCDPSession/g) || []).length, 2,
    "the harness reaches Chromium's debugging channel only for the optional CPU throttle, never for the press");
  assert.ok(/new PointerEvent\(type, \{ bubbles: true, cancelable: true, composed: true, pointerType: "touch"/.test(feel),
    "the press is a pointer event with a finger's type, which both browsers run");
});

test("the Board's wall does not go white on a deploy", () => {
  /* Jorge, 18 September. app_errors: eleven chunk fetches failed on the
     Driver's Mart wall, one pair per deploy, including on the build it had
     just reloaded onto. */
  const sw = fs.readFileSync(new URL("../src/sw.js", import.meta.url), "utf8");
  assert.ok(/caches\.open\(CACHE\)\.then\(\(c\) => c\.match\(key, opts\)\)\.then\(\(hit\) => hit \|\| caches\.match\(key, opts\)\)/.test(sw),
    "the worker looks in this build's cache and then in any cache still kept, so a page on the previous build finds its own chunk");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  /* vercel.json is validated against a schema and a note under a "//" key
     fails it: every deploy from #388 to the C29 claim errored on exactly that,
     production stayed on the build before #388, and the fix #388 carried
     never went out. The reason for the ignore lives in README instead. */
  assert.ok(!Object.keys(vercel).some((k) => k.startsWith("/")), "vercel.json carries no comment keys, because Vercel refuses the file");
  /* A deployment that cannot change the site still costs: every preview keeps
     its own copy of the functions, and on 21 September the project was at
     27.74 GB against 10 included, most of it previews of commits that never
     touched the site. So the ignore list is every folder the site is not
     built from. */
  for (const dir of ["docs", "*.md", "scripts", "test", ".github", "native", "supabase"])
    assert.ok((vercel.ignoreCommand || "").includes(`':(exclude)${dir}'`), `a commit that touches only ${dir} does not deploy`);
  assert.ok(/^git diff --quiet HEAD\^ HEAD -- \./.test(vercel.ignoreCommand || ""),
    "and everything else does");
  /* The ingest function carried all seven of pdfjs's built files, 5.7 MB, to
     use two of them. */
  assert.strictEqual(vercel.functions["api/ingest.mjs"].includeFiles, "node_modules/pdfjs-dist/legacy/build/pdf{,.worker}.js",
    "the ingest function carries the two pdfjs files it imports and no others");
  assert.ok(/const BoardHold = \(\) => <div style=\{\{ position: "fixed", inset: 0, background: "#0B1622" \}\}/.test(core)
    && /render\(\) \{ return this\.state\.err \? <BoardHold \/> : this\.props\.children; \}/.test(core)
    && /<React\.Suspense fallback=\{<BoardHold \/>\}><BoardScreen/.test(core),
    "and while the board is not there the wall holds its own ground rather than white");
});

test("the ground arrives at the room's own ground, with no step at the end of a travel", () => {
  /* Jorge, 18 September: the background is a colour for a moment, then it
     switches. His recording of 19 September, read to the frame: the blend
     climbs for 300 ms, holds, drops in one frame. The leaving light stayed at
     full under the arriving one; it goes as the other comes now. */
  assert.ok(/const kk = k \* k \* \(3 - 2 \* k\);\n\s*drawBlob\(ctx, gA, gA\.c \|\| A\[g\.k\], w, h, dx, Math\.sqrt\(1 - kk\)\);\n\s*drawBlob\(ctx, gB, gB\.c \|\| B\[g\.k\], w, h, dx, Math\.sqrt\(kk\)\);/.test(core),
    "the leaving light fades out as the arriving one fades in, on the same curve, in square roots so the pair never thins");
  assert.ok(!/drawBlob\(ctx, gA, gA\.c \|\| A\[g\.k\], w, h, dx, 1\);/.test(core), "and the leaving light is no longer held at full");
  assert.ok(/groundStep: 24,/.test(feel) && /row\("ground: biggest change between two frames of the blend", stepMax, BAR\.groundStep\);/.test(feel),
    "the feel harness reads the ground on every frame of a tap and holds the biggest change between two frames to a blend's size");
});

test("the phone is pictured on every pull request, from the probe kit", () => {
  /* Jorge, 19 September: make the recommendations so they assist future
     builds. Every phone check on 18 September was a scratchpad probe thrown
     away six times; this is the one that stays. */
  const kit = fs.readFileSync(new URL("../scripts/probe-kit.mjs", import.meta.url), "utf8");
  const shots = fs.readFileSync(new URL("../scripts/shots.mjs", import.meta.url), "utf8");
  const ci = fs.readFileSync(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const name of ["ensureMock", "prepFloor", "setMine", "setUp", "launch", "phone", "signIn", "touch", "swipe", "settled"])
    assert.ok(new RegExp(`export (async function|const) ${name}\\b`).test(kit), `the kit exports ${name}`);
  assert.ok(/open = "home"/.test(kit), "a probe's phone opens at Home, the way a salesperson's does, unless told otherwise");
  assert.ok(pkg.scripts.shots === "node scripts/shots.mjs", "npm run shots");
  assert.ok(/from "\.\/probe-kit\.mjs"/.test(shots), "and the shots are written from the kit");
  for (const tag of ["-home", "-home-foot", "-home-to-floor-mid", "-floor", "-line"]) assert.ok(shots.includes("`${tag}" + tag + "`"), `a picture of ${tag}`);
  assert.ok(/"normal-up"/.test(shots), "and one of You're up");
  assert.ok(/\n  shots:\n    if: github\.event_name == 'pull_request'/.test(ci) && /FEEL_BROWSER=webkit FEEL_URL=http:\/\/127\.0\.0\.1:5178\/ npm run shots/.test(ci)
    && /name: phone-shots/.test(ci) && /<!-- sage-shots -->/.test(ci),
    "on a pull request the checks workflow pictures the phone in WebKit, keeps the pictures, and links them from the pull request");
});

test("the Live Activity is drawn on a pull request, behind a label, and never in the app", () => {
  /* C70. Nine builds of one card on 18 September, because nothing but a phone
     could draw it. The render entry lives in the widget's own file, behind a
     flag the widget's build never sets. */
  const swift = fs.readFileSync(new URL("../native/targets/queue/QueueActivity.swift", import.meta.url), "utf8");
  const entry = fs.readFileSync(new URL("../native/render/main.swift", import.meta.url), "utf8");
  const wf = fs.readFileSync(new URL("../.github/workflows/activity-render.yml", import.meta.url), "utf8");
  assert.ok(/#if !RENDER\n@main\n#endif\nstruct SageQueueBundle: WidgetBundle/.test(swift), "the widget's entry steps aside only when rendering");
  assert.ok(/#if RENDER\nimport UIKit\n\n@MainActor\nfunc renderActivityStates\(to dir: String\) throws -> \[\(String, CGSize\)\]/.test(swift), "and the render entry is behind the same flag");
  assert.strictEqual((swift.match(/#if RENDER/g) || []).length, 1, "one render block");
  for (const name of ["floor-waiting", "floor-up", "floor-customer", "floor-asking", "floor-lunch", "phone-cord", "phone-next", "phone-offer", "phone-desk", "phone-free", "both-quiet", "both-floor-up", "both-phone-offer", "both-customer-cord"])
    assert.ok(swift.includes(`("${name}",`), `the sheet's state ${name} is drawn`);
  assert.ok(/h > 160 \? "  OVER the 160 pt budget"/.test(entry), "each card's height is read against the lock screen's budget");
  assert.ok(/contains\(github\.event\.pull_request\.labels\.\*\.name, 'render activity'\)/.test(wf) && /runs-on: macos-15/.test(wf)
    && /swiftc -D RENDER -sdk "\$SDK" -target arm64-apple-ios17\.0-simulator/.test(wf) && /xcrun simctl spawn/.test(wf) && /<!-- sage-activity-render -->/.test(wf),
    "a Mac runner compiles it for the simulator, draws it there, and tells the pull request; only when labelled");
  /* The other copies of QueueAttributes must not grow a RENDER block by
     mistake: the render compiles the widget's copy alone. */
  assert.ok(!/RENDER/.test(fs.readFileSync(new URL("../native/targets/queue/QueueAttributes.swift", import.meta.url), "utf8")), "the attributes file carries no render code");
});

test("the month caption measures itself only when its words or its width changed", () => {
  /* C66. The caption fits itself to the card by asking the browser how wide
     the line is, in a layout effect with no dependency list, so it ran on
     every render of that card. Reading clientWidth flushes layout for the
     whole document, and during a room cross the document is both rooms at
     once: measured on the CI runner, 8 forced layouts costing 38 ms in WebKit
     against 12 in Chromium, which was the gap the row was opened for. The
     text is free to read, so a render that did not change it now costs
     nothing, and the observer catches a width that changed under the same
     words. Same pixels: the line is fitted to the same number. */
  assert.ok(/const fitLine = useCallback\(\(\) => \{\n\s*const el = tlRef\.current;\n\s*if \(!el\) return;\n\s*const words = el\.textContent;\n\s*if \(tlSeen\.current === words\) return;\n\s*tlSeen\.current = words;\n\s*const have = el\.clientWidth;/.test(core),
    "the words are read before the width, and an unchanged line never reaches clientWidth");
  assert.ok(/useLayoutEffect\(\(\) => \{ fitLine\(\); \}\);/.test(core),
    "and it still runs after every render, so no figure has to be listed as a dependency");
  assert.ok(/const ro = new ResizeObserver\(\(rs\) => \{\n\s*const w = rs\[0\] && rs\[0\]\.contentRect \? Math\.round\(rs\[0\]\.contentRect\.width\) : 0;\n\s*if \(!w \|\| w === Math\.round\(tlHave\.current\)\) return;\n\s*tlSeen\.current = null;\n\s*fitLine\(\);/.test(core),
    "a width that really differs from the one last fitted to sends the line back to be measured, and one that does not does nothing");
});

test("a dropped frame is one the person would feel, not one the runner was slow on", () => {
  /* C82. The row counted every frame over 25 ms, and on a shared CI runner
     that is the runner: it failed on main again and again, on commits that
     changed no JavaScript at all, and every frame it named was exactly 33 ms,
     one skipped vsync, with the page exactly the slop behind the thumb. The
     scroller is driven by the compositor, so a long frame on the main thread
     still arrives with the page where the thumb is. A frame counts now only
     when it is long AND the page lost ground while it lasted.
     Both halves of the reading are pinned, because each one was got wrong
     once on the way: the gap is read on the settled frame BEFORE the thumb
     steps, not at the end of the frame, and only frames the thumb moved
     through are counted. Reading it the other way made this row count two
     frames on a scroller whose follow spread was 0. */
  assert.ok(/const gapAt = moved\.map\(\(g, i\) => \{ const t = sw\.track\[from \+ i\] \|\| \[\]; return \(t\[0\] \|\| 0\) - \(t\[1\] \|\| 0\); \}\);/.test(feel),
    "the gap is read on the settled frame before the step, the way the follow row reads it");
  assert.ok(/const stepped = moved\.map\(\(g, i\) => \{ const a = sw\.track\[from \+ i\] \|\| \[\], b = sw\.track\[from \+ i \+ 1\] \|\| \[\]; return b\[0\] !== a\[0\]; \}\);/.test(feel),
    "and only the frames the thumb moved through count, so a frame where the page was catching up cannot set the floor");
  assert.ok(/const felt = moved\.map\(\(g, i\) => \[g, i\]\)\.filter\(\(\[g, i\]\) => g > 25 && stepped\[i\] && gapAt\[i\] - slop > 1\);/.test(feel),
    "long and behind, both, or it is not a dropped frame");
  assert.ok(/row\("swipe: frames dropped while the thumb moved", felt\.length, BAR\.dropped\);/.test(feel), "and that is the row");
  assert.ok(/long frame\(s\) the page rode out at the slop/.test(feel),
    "a long frame that cost the page nothing is still printed, because 'none of them lost ground' is what stops somebody re-running a green check");
});

test("each engine is held to a bar set from its own history, not from one day of the other's", () => {
  /* C85. The first bars came from one day of runs, and the table behind them
     had WebKit two to three times faster than it is. Two WebKit bars sat inside
     WebKit's own normal range and failed on code that could not have moved
     them. Read back from 21 runs, they are set just above the highest reading
     seen; Chromium's table was right and its bars are unchanged. */
  assert.ok(/const WEBKIT = String\(process\.env\.FEEL_BROWSER \|\| ""\)\.toLowerCase\(\) === "webkit";/.test(feel),
    "the engine is decided once");
  assert.ok(/tab: WEBKIT \? 140 : 110,/.test(feel) && /tap: WEBKIT \? 60 : 50,/.test(feel),
    "WebKit gets its own bars and Chromium keeps the ones that were already right");
  assert.ok(/Floor to Phone     30 ms         57      62      128/.test(feel),
    "the table shows what the first one said beside what the history says, so the correction is on the page");
  assert.ok(/The "four times the median" rule does not survive these numbers/.test(feel),
    "and it says why the old rule was not simply re-applied");
  assert.ok(/a room cross that doubled in WebKit alone could\n\s*hide in the same place/.test(feel),
    "the cost of the tab bar is written down, not left for somebody to discover");
});

test("a timed row prints its three samples, so a miss can be read instead of guessed at", () => {
  /* The median of three hid which of two things a miss was. On 22 September one
     commit failed twice with the two runs swapping which row went over, and
     nothing on the page could say whether one sample was slow or all three. */
  assert.ok(/const row3 = \(name, xs, bar\) => row\(name, mid\(xs\), bar, mid\(xs\) <= bar, xs\);/.test(feel));
  assert.ok(/\$\{r\.xs \? "   \[" \+ r\.xs\.join\(", "\) \+ "\]" : ""\}/.test(feel), "the line carries them");
  for (const name of ["tap Lunch to shown", "tap Here to shown", "Floor to Phone tab", "Phone to Floor tab"]) {
    assert.ok(feel.includes(`row3("${name}", `), `${name} is a row of three`);
  }
});

test("the FlyBy row waits for the page's own writes before it changes the status under them", () => {
  /* C87. The harness wrote "waiting" with no lag while the page's send and
     cancel were still read-then-writes in flight; landing between one read and
     its write, it was written over, the server read "customer", and the button
     stayed for good. Reproduced locally by moving that write 150 to 900 ms
     later: every run left the server on "customer". The timeout is not the fix. */
  assert.ok(/const before = new Set\(\(await myAssists\(\)\)\.map\(\(a\) => a\.id\)\);\n\s*await p\.locator\('\.fba-go:has-text\("Send the FlyBy"\)'\)\.click\(\);/.test(feel),
    "the FlyBys already on the row are noted before the send, so an old finished one cannot pass the wait");
  assert.ok(/await cancelLanded\(before, 8 \* LAG \+ 5000\);\n\s*await setMine\("waiting", null\); await p\.waitForSelector\("\.fba-btn\.fly", \{ state: "detached", timeout: 15000 \}\);/.test(feel),
    "the status changes only once the cancel is on the server, and the button's wait is still 15 s");
  assert.ok(/!before\.has\(a\.id\) && a\.doneAt/.test(feel), "the wait is for the new FlyBy, marked done");
});

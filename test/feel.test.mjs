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

test("the jump is once a day; a return the same day lands short", () => {
  assert.ok(/jumpShort = arrivalShort\(\);/.test(core) && /arrivalTaken\(\);/.test(core), "decided at the press");
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
  assert.ok(/className=\{"ar-bar" \+ \(ready \? " up" : ""\)\}/.test(core), "the bar waits for ready");
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
  assert.ok(/cross\.dx != null \? " x x-drag"/.test(core) &&
    /"--ar-in0": "calc\(" \+ cross\.dx \+ "px \+ " \+ \(cross\.dir > 0 \? 100 : -100\) \+ "%\)"/.test(core),
    "and the arriving sheet starts a screen to the side of the one being left, which is where the drag had them");
  assert.ok(/@keyframes arPageInD\{\n\s*from\{ transform:translate3d\(var\(--ar-in0, 100%\), 0, 0\); \}/.test(core) &&
    /@keyframes arPageOutD\{\n\s*from\{ transform:translate3d\(var\(--ar-out0, 0px\), 0, 0\); filter:brightness\(1\); \}/.test(core),
    "a swipe finishes by tiling, the way it ran under the thumb");
  {
    const d = (core.match(/@keyframes arPageOutD\{[\s\S]*?\}\s*\}/) || [""])[0];
    assert.ok(!/clip-path/.test(d),
      "and it needs no cut, because two sheets that tile are never one behind the other and nothing can peek between them");
  }
  assert.ok(!/groundOf|--ar-to-bg/.test(core), "and nothing is left handing a ground colour to a layer that no longer exists");
  assert.ok(/prefers-reduced-motion: reduce\)"\)\.matches; \} catch \(e\) \{\}\n    if \(reduce\) return;/.test(core), "less motion asks for the cut");
  /* One gesture, one clock: the rooms, the mark and the bar's pill all run for
     the wipe token on the same curve, and the classes are held until the last
     of them is done. */
  assert.ok(/duration: MOTION\.wipe, easing: "cubic-bezier\(\.35,\.12,\.2,1\)", fill: "both"/.test(core), "the mark flies on the wipe token and the page curve");
  assert.ok(/\.ar-room\.ar-in > \.q-page\.sf\{ z-index:102;\n\s*animation:arPageIn var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\) both;/.test(core) && /\.ar-room\.ar-out > \.q-page\.sf\{ z-index:100;\n\s*animation:arPageOut var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\) both;/.test(core), "the room's own sheet is what travels, on one clock and one curve");
  assert.ok(/\.ar-bar\{ position:fixed; z-index:105;/.test(core) && /\.ar-fly\{ position:fixed; z-index:106;/.test(core), "the bar and the mark stay above a room in mid-travel");
  assert.ok(!/box-shadow:0 0 44px 10px rgba\(0,0,0,\.6\)/.test(core),
    "and the arriving sheet casts no dark edge, because with one ground behind both rooms a shadow on it is a seam");
  /* The same fault in a second place, and the one Jorge kept photographing. A
     parked curtain sits one screen to the left of the room it belongs to, so
     the only thing its 60px shadow can reach is that room's first 60px, which
     during a drag is the join. Measured at a device ratio of three: a step of
     8.5 out of 255 at the join, fading out 70px to its right. With the shadow
     on the moving curtain only, the rooms add no vertical edge at all. */
  assert.ok(/\.q-curtain\{position:fixed;inset:0;[^}]*\}/.test(core) &&
    !/\.q-curtain\{[^}]*box-shadow/.test(core),
    "a parked curtain casts nothing");
  assert.ok(/\.q-curtain\.q-wipe\{box-shadow:0 0 60px rgba\(0,0,0,\.25\);\}/.test(core),
    "and only a curtain actually crossing the screen has an edge to weigh");
  /* The ground behind the switch was one flat dark, then the arriving room's
     colour dropped in whole. Neither travelled. It is a backdrop now: the
     blobs that used to sit inside each room live behind both of them, each on
     its own layer so each can move at its own speed, and each carries its
     colour from one room to the next rather than switching. Jorge's call of
     17 September, option B. */
  /* One canvas, not seven elements. Every element that moves on its own gets a
     GPU texture of its own, at width x height x dpr squared x four bytes, and
     seven of them at a device ratio of three came to 221 MB: over a WKWebView's
     ceiling, which an app cannot raise. That was the lag, the dots arriving
     late and the rooms loading in after the switch. Nothing a person sees
     changed. */
  assert.ok(/<canvas className="ar-gnd" ref=\{gndRef\} aria-hidden="true" \/>/.test(core),
    "the backdrop is one canvas");
  assert.ok(!/className="ar-blob"|className="ar-dots"|className="ar-gnd-base"/.test(core),
    "and none of the seven layers it replaced is left, because seven textures is what cost the phone its frames");
  assert.ok(/\.ar-gnd\{ position:fixed; inset:0; z-index:99; pointer-events:none;/.test(core),
    "the backdrop sits under both rooms");
  assert.ok(!/\.ar-gnd\{[^}]*will-change/.test(core),
    "the canvas itself never moves, so it needs no will-change: its contents move inside it, which is the whole saving");
  /* Measured rather than reasoned, and the guess was wrong twice before this
     number: neither clipping the fills nor taking out a forced layout moved it.
     What moves it is how many pixels the drawing is rasterised into. At two to
     the CSS pixel a room switch ran 377 ms against a 150 ms bar; at one it runs
     about 104, and the texture is 1.3 MB where the seven layers were 221.5. */
  assert.ok(/    const s = 1;\n/.test(core) && /const bw = Math\.round\(w \* s\), bh = Math\.round\(h \* s\);/.test(core),
    "and it is drawn one backing pixel to the CSS pixel, which is the whole difference between this being fast and being slower than what it replaced");
  assert.ok(!/\.ar-stack\.x::before|animation:arGround/.test(core),
    "and the flat ground that used to drop in whole is gone");
  assert.ok(/\.ar-stack \.q-page\.sf:not\(\.mc-light\)::before\{ display:none; \}/.test(core),
    "a room inside the stack no longer paints its own blobs");
  assert.ok(/\.q-page\.sf:not\(\.mc-light\)\{ background:transparent; \}/.test(core),
    "and the light corner is left alone, because it keeps its own background and its own moving lights");
  /* Sunlight was the one case in which the backdrop switched itself off, and
     Sunlight is gone. There is no case now. */
  assert.ok(!/\.ar-gnd\{ display:none; \}/.test(core),
    "and nothing switches the backdrop off any more");
  assert.ok(/const DOT_SPEED = \[0\.05, 0\.13, 0\.24\];/.test(core) && /\.ar-stack \.mc-aurora u\{ display:none; \}/.test(core),
    "three dot fields at three speeds, out behind the rooms, rather than one inside the corner that cannot travel");
  assert.ok(/\{ step: 22, r: 1\.0, edge: 2\.4, a: 0\.07 \}/.test(core) &&
    /\{ step: 54, r: 1\.7, edge: 3\.6, a: 0\.10 \}/.test(core),
    "tighter, smaller and fainter further back; looser, larger and a shade brighter nearer, each fainter than the single field it replaces");
  assert.ok(/ctx\.createPattern\(c, "repeat"\)/.test(core) && !/width:280vw/.test(core),
    "and a field is a repeating pattern now, so it wraps rather than needing 280vw of spare width to slide inside");
  /* The first version of this guard asserted every dot was slower than every
     blob, which is simply not true: the nearest dots run at 0.24 against the
     far blob's 0.12. The interleaving is the point, so the guard now checks
     what is actually meant. */
  {
    const dots = (core.match(/const DOT_SPEED = \[([^\]]+)\]/) || [])[1];
    const blobs = (core.match(/const BLOB_SPEED = \[([^\]]+)\]/) || [])[1];
    assert.ok(dots && blobs, "both sets of speeds are named in one place each");
    const D = dots.split(",").map(Number), B = blobs.split(",").map(Number);
    assert.ok(D.every((v, i) => i === 0 || v > D[i - 1]), "the dot fields run slowest first");
    assert.ok(B.every((v, i) => i === 0 || v > B[i - 1]), "and so do the blobs");
    assert.ok(D[0] < Math.min(...B), "the furthest dot field is the slowest thing on the screen");
    assert.ok(Math.max(...B) < 1, "and nothing behind the rooms keeps up with a room, which travels at 1");
  }
  assert.ok(/const BLOB_SPEED = \[0\.12, 0\.30, 0\.55\];/.test(core) && /const BLOB_LEAD = \[0, 0\.16, 0\.32\];/.test(core),
    "three blobs, three speeds, and three moments to turn colour: two layers read as a slide, three read as depth");
  assert.ok(/const ramp = \(v, last\) => \(last <= 0 \? 0 : \(v \* v\) \/ last\);/.test(core) &&
    /const dx = -Math\.round\(trav \* w \* BLOB_SPEED\[b\]\);/.test(core),
    "and the travel is squared, so it starts very quiet and arrives at the full effect rather than running at one rate throughout");
  assert.ok(/const dx = -Math\.round\(trav \* w \* BLOB_SPEED\[b\]\);/.test(core) &&
    /-Math\.round\(trav \* w \* DOT_SPEED\[d\] \* ds\)/.test(core),
    "every layer moves in whole pixels, because a fractional offset resamples a soft edge every frame and flickers");
  assert.ok(!/filter:\s*blur/.test(core.slice(core.indexOf("const BLOBS = ["), core.indexOf("const paintGround"))),
    "the haze is in the gradient's stops, not a filter blur that would run every frame of a drag");
  assert.ok(/const x0 = Math\.max\(-rx, -cx\), x1 = Math\.min\(rx, w - cx\);/.test(core) &&
    /ctx\.fillRect\(x0, y0, x1 - x0, y1 - y0\);/.test(core),
    "and a light fills only where its box and the screen overlap, every one of them being wider and taller than the screen with most of it below the bottom");
  /* The ground had no colour until the first animation frame, which is the
     black Jorge saw between rooms. A layout effect runs before the browser
     paints, so there is no such frame now. */
  assert.ok(/useLayoutEffect\(\(\) => \{\n    if \(!tabs\.length\) return undefined;/.test(core) &&
    /\}, \[tabKey, active, drag\]\);/.test(core),
    "the backdrop is painted before the browser paints, and only when something it draws has changed, rather than on every render of the app");
  assert.ok(/\.ar-stack > \.ar-room > \.q-page\.sf:not\(\.mc-light\)\{ background:transparent; \}/.test(core),
    "and a room inside the stack carries no ground of its own, because two grounds meeting is exactly what a seam is");
  assert.ok(/:root\{ --gnd-line:#06090F; --gnd-home:#15211B; --gnd-floor:#070A08; \}/.test(core), "the three grounds are named once, for the page behind the app");
  /* Warm sand was tried on 17 September and dropped the same day: the corner's
     own four lights are green and sit in front of this ground, so a warm one
     behind them read as two ideas at once. */
  assert.ok(/home:  \{ gnd: "#15211B", a1: "#6E9678", a2: "#A9C4AC", led: "#8FD8AF" \}/.test(core) &&
    !/#8A7A4E|#C7B382/.test(core),
    "and the corner is green, with nothing left of the warm sand it was briefly");
  assert.ok(/html:has\(\.q-page\.sf\), body:has\(\.q-page\.sf\) \{\n\s*transition:background-color var\(--t-wipe\)/.test(core),
    "and Home to Live Floor morphs too, which is two tabs of one room and never crossed at all");
  assert.ok(/transform:translate3d\(calc\(var\(--ar-dx, 26%\) \* -\.34\), 0, 0\); filter:brightness\(\.7\);/.test(core), "the room being left parallaxes a third of the way and dims");
  assert.ok(/transition:transform var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\); will-change:transform; \}/.test(core), "the bar's pill lands with the room");
  assert.ok(/crossTimer\.current = setTimeout\(\(\) => setCross\(null\), MOTION\.wipe \+ 60\);/.test(core), "the classes are held until the whole gesture is over");
  /* This guard used to check only that no class was named arFadeIn or
     arFadeOut, which is a proxy for the property rather than the property. It
     passed all the way through #356 making both sheets transparent, and two
     rooms then WERE readable through each other on every cross: Jorge
     photographed the two "isn't open yet" screens printed over one another. It
     checks the real thing now. */
  assert.ok(!/arFadeIn|arFadeOut/.test(core), "nothing crossfades");
  /* And nothing crosses the rooms either. A band of white light used to ride
     the arriving sheet on every switch, which Jorge read as a screen wipe on
     18 September: the backdrop's three dot fields and three lights already say
     the rooms moved, and saying it twice made the weaker answer the loud one. */
  assert.ok(!/arSheen/.test(core) && !/\.ar-room\.ar-in > \.q-page\.sf::after/.test(core),
    "no light crosses the arriving room, because the ground behind it is what shows the movement");
  /* Making both sheets opaque was the first answer and it was too expensive:
     a tap put a flat slab over the backdrop for 440 ms and then snapped to the
     real thing, which is what Jorge photographed on 18 September. The one
     leaving is cut instead, at the line the arriving one has reached, so
     nothing is ever underneath anything and every sheet stays transparent. */
  assert.ok(!/--ar-x-gnd/.test(core),
    "no sheet goes opaque to cross any more, because a slab over the backdrop for the length of a tap is what the flashing between pages was");
  assert.ok(/clip-path:inset\(0 74% 0 0\);/.test(core) && /clip-path:inset\(0 91\.16% 0 0\);/.test(core) &&
    /clip-path:inset\(0 0 0 74%\);/.test(core) && /clip-path:inset\(0 0 0 91\.16%\);/.test(core),
    "it is cut instead, on whichever side the room arrives from, so two rooms are still never readable through each other");
  /* 100% - |D| to 100% - 0.34|D|, which is where the arriving sheet's near edge
     falls in the leaving sheet's own box at each end of the run. It is only
     exact because both animations carry the same duration and the same curve;
     anything less exact would draw the seam the cut is here to avoid. */
  {
    const D = 26, out = (core.match(/@keyframes arPageOut\{[\s\S]*?\}\s*\}/) || [""])[0];
    assert.ok(/var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\)/.test(core.split(".ar-room.ar-in > .q-page.sf{")[1].slice(0, 200)) &&
      /var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\)/.test(core.split(".ar-room.ar-out > .q-page.sf{")[1].slice(0, 200)),
      "the arriving and the leaving sheet run on one duration and one curve, which is what lets the cut land on the edge");
    assert.ok(out.includes((100 - D) + "%") && out.includes((100 - 0.34 * D).toFixed(2) + "%"),
      "and the cut starts and ends where that edge actually is");
  }
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
  assert.ok(/let touched = false;/.test(main) && /\["pointerdown", "keydown", "wheel", "touchstart"\]/.test(main),
    "the app knows whether anybody has touched it yet");
  assert.ok(/if \(reg\.waiting\) \{ clearInterval\(look\); letIn\(\); \}/.test(main),
    "and a build that is already waiting is LOOKED for rather than listened for, because it can arrive before register() even resolves");
  assert.ok(/if \(touched\) return clearInterval\(look\);/.test(main),
    "the looking stops the moment a thumb lands, so nothing ever changes under one");
  assert.ok(/document\.addEventListener\("visibilitychange", \(\) => \{ if \(document\.hidden\) \{ letIn\(\); reg\.update\(\)/.test(main),
    "and after that it waits for the background, which is the rule this always had");
  /* ignoreVary is defensive rather than a fix for anything Jorge hit: the live
     server sends no Vary on assets. vite preview does, and with it every asset
     lookup missed, which made the app a white screen after a deploy locally.
     Same behaviour in both places is worth a word. */
  assert.ok((sw.match(/ignoreVary: true/g) || []).length === 2,
    "and a cached file is found whatever the response varied on, so the phone behaves the same as the preview");
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
  assert.ok(/toneMark\(t\)\{ return pix\(t === 'g' \? 'check' : t === 'y' \? 'clock' : 'warn'\); \}/.test(mgr) && /--green:#1F8A6B; --greenbg:#E1F1EA; --yellow:#E0A100;[^}]*--red:#C8352B;/.test(mgr), "the TV board speaks the same three");
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

  /* It follows the thumb only where there are two sheets. Home and Live Floor
     are two tabs of ONE .q-page, so there is nothing behind the first to pull. */
  assert.ok(/s0\.slide = roomOfTab\(to\) !== roomOfTab\(active\);/.test(core), "whether there is a second sheet to drag is decided when the gesture starts");
  assert.ok(/if \(!s0\.slide\) return;/.test(core), "and two tabs of one sheet commit on release instead of dragging");
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

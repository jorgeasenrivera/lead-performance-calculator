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
  assert.ok(/const crossRooms = \(from, to\) => \{/.test(core) && /crossRooms\(room === "line" \? "line" : "floor", r === "line" \? "line" : "floor"\);/.test(core), "a tab switch crosses the rooms");
  assert.ok(/prefers-reduced-motion: reduce\)"\)\.matches; \} catch \(e\) \{\}\n    if \(reduce\) return;/.test(core), "less motion asks for the cut");
  /* One gesture, one clock: the rooms, the mark and the bar's pill all run for
     the wipe token on the same curve, and the classes are held until the last
     of them is done. */
  assert.ok(/duration: MOTION\.wipe, easing: "cubic-bezier\(\.35,\.12,\.2,1\)", fill: "both"/.test(core), "the mark flies on the wipe token and the page curve");
  assert.ok(/\.ar-room\.ar-in > \.q-page\.sf\{ z-index:102;\n\s*animation:arPageIn var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\) both;/.test(core) && /\.ar-room\.ar-out > \.q-page\.sf\{ z-index:100;\n\s*animation:arPageOut var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\) both;/.test(core), "the room's own sheet is what travels, on one clock and one curve");
  assert.ok(/\.ar-bar\{ position:fixed; z-index:105;/.test(core) && /\.ar-fly\{ position:fixed; z-index:106;/.test(core), "the bar and the mark stay above a room in mid-travel");
  assert.ok(/\.ar-stack\.x::before\{ content:""; position:fixed; inset:0; z-index:99; background:#06090F;/.test(core), "the rooms' own ground is behind the switch, so no light edge shows");
  assert.ok(/to\{ transform:translate3d\(calc\(var\(--ar-dx, 26%\) \* -\.34\), 0, 0\); filter:brightness\(\.7\); \} \}/.test(core), "the room being left parallaxes a third of the way and dims");
  assert.ok(/transition:transform var\(--t-wipe\) cubic-bezier\(\.35,\.12,\.2,1\); will-change:transform; \}/.test(core), "the bar's pill lands with the room");
  assert.ok(/crossTimer\.current = setTimeout\(\(\) => setCross\(null\), MOTION\.wipe \+ 60\);/.test(core), "the classes are held until the whole gesture is over");
  assert.ok(!/arFadeIn|arFadeOut/.test(core), "nothing crossfades, so two rooms are never readable through each other");
  assert.ok(!/arDotsIn|arDotsOut|steps\(5,end\)|steps\(3,end\)|@property --ar-r/.test(core), "nothing in the switch is stepped");
  assert.ok(/const roomEl = dest\.closest\("\.q-page\.sf"\) \|\| dest\.closest\("\.ar-room"\);/.test(core), "the mark lands where the room comes to rest, not where it started");
  assert.ok(/hidden=\{room !== "line" && !\(cross && cross\.from === "line"\)\}/.test(core), "the room being left stays on screen for the whole gesture");
});
test("the rooms in sunlight: deep green ground, cream on it, only the tokens change, off by default", () => {
  assert.ok(/html\.sun \.q-page\.sf\.mc-floor, html\.sun \.q-page\.sf\.sf-line\{[^}]*background:#2E4A38;/.test(core), "the ground is the curtain's deep green");
  assert.ok(/html\.sun \.mc-floor \.sf-seg-pill, html\.sun \.sf-line \.sf-seg-pill\{ background:#8FD8AF; box-shadow:none; \}/.test(core), "the pill is mint");
  assert.ok(/html\.sun \.mc-floor \.fba-btn\.fly\{ background:#F6E3C3;/.test(core) && /html\.sun \.mc-floor \.fba-btn\.to\{ background:#F3D4CC;/.test(core), "the help cards are filled chips");
  assert.ok(/localStorage\.getItem\("lpcf:pref:sun"\) === "1"/.test(core), "off unless switched on");
  assert.ok(/glyph="sun"/.test(core) && /Sunlight<span className="hint">/.test(core), "a switch on the corner");
  assert.ok(!/html\.sun[^{]*\{[^}]*(padding|margin|font-size|animation)/.test(core), "layout, type sizes and animation stay");
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
  assert.ok(/onHelp=\{\(\) => \{ buzz\(8\); setHelpPanel\(true\); \}\} onYou=\{\(\) => \{ buzz\(8\); setHelpOpen\(true\); \}\}/.test(core) && /className="mc-me" onClick=\{onYou\} aria-label="You"/.test(core), "the ? is help; the initials are You");
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
  assert.ok(/fmtPct\(c\.pct\)\}\{t && <Verdict ratio=\{pctV \/ target\} size=\{10\}/.test(mgr), "the hero's channels carry the mark");
  assert.ok(/<span className="s2-mklbl">\{METRIC_TINY\[v\.m\] \|\| METRICS\[v\.m\]\.short\}<Verdict ratio=\{v\.mean\} size=\{9\} \/><\/span>/.test(mgr), "the video rings carry the mark");
  assert.ok((mgr.match(/\{t && <Verdict ratio=\{vShow \/ tgt\} size=\{9\} \/>\}/g) || []).length === 2, "both shapes of the desk table carry the mark");
  assert.ok(/toneMark\(t\)\{ return pix\(t === 'g' \? 'check' : t === 'y' \? 'clock' : 'warn'\); \}/.test(mgr) && /--green:#1F8A6B; --greenbg:#E1F1EA; --yellow:#E0A100;[^}]*--red:#C8352B;/.test(mgr), "the TV board speaks the same three");
  assert.ok(/--frok:#1F8A6B; --frthin:#E0A100; --frgap:#C8352B;/.test(mgr) && /--frok:#1F8A6B; --frthin:#E0A100; --frgap:#C8352B;/.test(core), "the rooms and the phone take the same three");
  assert.ok(/\.vmark\{ display:inline-flex; align-items:center; gap:3px; color:var\(--vc\);/.test(mgr), "the mark takes its figure's colour");
});

test("five-second pass, items 1, 3, 4 and 8: the lamp, the sentence, five shades, a covered hour, no PIN list", () => {
  assert.ok(/className=\{"s2-imp s2-lampbtn" \+ \(missing\.length \? "" : " done"\)\}/.test(mgr) && /<b>\{missing\.length \? `\$\{missing\.length\} due today` : "All in"\}<\/b>/.test(mgr), "the imports card is the lamp");
  assert.ok(/\.s2-lampbtn \.s2-lamp\.y\{ background:#E0A100;[^}]*animation:lampPulse/.test(mgr) && !/className="s2-answers"/.test(mgr), "the lamp breathes while a report is owed, and there is no lamp row");
  assert.ok(/<div className="s2-vitals s2-say" style=\{\{ color: paceCol \}\}>/.test(mgr) && /Short by <b>\{fmtNum\(Math\.round\(storePace\.short\)\)\}<\/b> at this pace/.test(mgr) && !/on the board\{capTotal/.test(mgr), "the pace sentence replaced the vitals line");
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

test("the record slims down: backups prune by what is on the server, day rows have a window, restore points are two, no legacy stars", () => {
  assert.ok(/async function pruneBackups\(keep\) \{/.test(core) && /\.select\("key"\)\.like\("key", "lpc:backup:%"\)/.test(core), "the prune asks the server what is actually there");
  assert.ok(/\.select\("key"\)\.like\("key", "lpc:config:backup:%"\)/.test(core), "the orphaned meta rows go with them");
  assert.ok(/await saveShared\(BACKUP_INDEX_KEY, keep\);\n\s*await pruneBackups\(keep\);/.test(core), "every backup run prunes");
  assert.ok(/const BOARD_DAYS = 45;/.test(core) && /async function pruneBoardDays\(storeId\) \{/.test(core), "the day rows have a window");
  assert.ok(/const GOAL_LOOKBACK = 21;/.test(core), "and the window clears the longest read of them by a fortnight");
  assert.ok(/\]\.slice\(0, 2\),/.test(core) && /\]\.slice\(0, 2\),/.test(mgr) && /\.\.\.\(next\.snapshots \|\| \[\]\)\]\.slice\(0, 2\);/.test(ing), "a row carries two restore points, not six, eight or twelve");
  assert.ok(!/data\.stars\?\.\[/.test(core + mgr) && !/const starsFor/.test(mgr), "the star count RockEd replaced is no longer read");
  assert.ok(/return null;\s*\/\/ no RockEd mark at all/.test(core), "no mark means no mark");
});

test("the Online room says it is not a room yet, in the house's own parts", () => {
  assert.ok(/function OnlineSoon\(\{ store, rooms, onToolChange \}\) \{/.test(mgr), "the room has a page of its own");
  assert.ok(/\) : queue === "online" \? \(\n\s*<OnlineSoon store=\{store\} rooms=\{roomListOf\(config, store\.id\)\} onToolChange=\{onToolChange\} \/>/.test(mgr), "and it is what Online opens, instead of a queue that does nothing");
  assert.ok(/aria-label="Under construction"/.test(mgr) && /<PixIcon glyph="warn" size=\{22\} \/>/.test(mgr) && /<b>Room under construction<\/b>/.test(mgr), "the sign is the pix set's own warn on sand");
  assert.ok(/repeating-linear-gradient\(135deg, #E4C98D 0 10px, #241A06 10px 20px\)/.test(mgr), "and the tape is painted the way tape is painted");
  assert.ok(/Seventeen days have been opened in this room/.test(mgr), "the joke is a real number or it is not a joke");
  assert.ok(/<div className="s2-led onsoon-led"><i style=\{\{ width: "0%" \}\} \/><\/div>/.test(mgr), "the progress bar is the app's own track, at nothing");
  assert.ok(/\.onsoon\{ padding-bottom:104px; \}/.test(mgr), "the last card ends above the dock on a phone");
  assert.ok(/onClick=\{\(\) => onToolChange\(id\)\}/.test(mgr), "and there is a way out to a room that exists");
});

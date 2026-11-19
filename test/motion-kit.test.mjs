/* The motion kit (src/motion-kit.mjs, src/motion-kit.css) and the TV board's
   in-place refresh. These pin what Jorge picked on the demo page on 18 November
   and the lines the kit must not cross: the rooms keep their own motion, the
   switch to turn it off stays, and two menus are never up together. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const kit = read("src/motion-kit.mjs");
const css = read("src/motion-kit.css");
const tv = read("src/leaderboard-template.mjs");

function block(src, begin, end) {
  const a = src.indexOf(begin), b = src.indexOf(end, a + begin.length);
  assert.ok(a >= 0 && b > a, "found " + begin);
  return src.slice(a, b + end.length);
}

test("the pop is the Fun spring: about 7% past its mark, then home", () => {
  const code = block(kit, "export function springPoints", "\n}\n").replace("export ", "");
  const ctx = {};
  vm.runInNewContext(code + "\nthis.springPoints = springPoints;", ctx);
  const pts = ctx.springPoints(0.64, 200);
  const peak = Math.max(...pts);
  assert.ok(peak > 1.05 && peak < 1.09, "overshoot " + peak);
  assert.equal(pts[pts.length - 1], 1);
  assert.match(kit, /zeta: 0\.64/);
  assert.match(kit, /tap: 110, move: 380, stage: 560/);
});

test("the kit leaves the rooms alone", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/:not\([^)]*\)/g, "");
  for (const room of [/\.sf(?![\w-])/, /\.mc-tab(?![\w-])/, /\.mcf(?![\w-])/, /\.ar(?![\w-])/]) assert.doesNotMatch(rules, room, String(room));
  assert.match(css, /\.fr-rail \{ --spring: cubic-bezier\(\.32,\.72,\.33,1\); --ease-bloop: cubic-bezier\(\.34,1\.56,\.64,1\); \}/,
    "the Floor rail on the desk keeps the rooms' curves");
});

test("the kit can be switched off and honours reduced motion", () => {
  assert.match(kit, /sage:motion/);
  assert.match(kit, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("no em dashes in the kit or the TV refresh", () => {
  const refresh = block(tv, "  /* ---- a refresh updates in place ----", "  /* The padding above is arithmetic");
  for (const [name, s] of [["kit", kit], ["css", css], ["tv refresh", refresh]]) assert.ok(!s.includes("\u2014"), name);
});

test("a failed TV refresh is not part of the motion kit: the error path is as before", () => {
  // Sage dot, 19 November: keeping the last board on a failed refresh also kept it
  // after access was denied. That is not motion, so it left this change.
  assert.ok(!tv.includes("keepStale"));
  assert.ok(!tv.includes("tv-stale"));
});

test("a TV refresh rolls numbers from what was on screen, not from 0", () => {
  assert.match(tv, /var was = \(SHOWN === shownAs\) \? tvSnap\(root\) : null;/);
  assert.match(tv, /num\.setAttribute\('data-from', old\.sold\)/);
  assert.match(tv, /#root\.tv-calm \.lb tbody tr\.row, #root\.tv-calm \.lb2 tbody tr\.row \{ animation:none; \}/);
});

test("opening More ends the room picker's fade at once: two menus are never up together", () => {
  // The spacing check taps Rooms then More and counts .qpick straight away. The
  // picker's fading copy is a .qpick too, so it must not outlive the drawer opening.
  const ghost = block(kit, "function ghostInPlace", "\n}\n");
  assert.ok(ghost.includes('document.querySelector(".drawer-root.open")'));
  const drawer = block(kit, "function watchDrawer", "\n}\n");
  assert.ok(drawer.includes('IN_PLACE + "[data-mk-ghost]"'));
  assert.ok(drawer.indexOf("[data-mk-ghost]") < drawer.indexOf("if (calm())"));
});

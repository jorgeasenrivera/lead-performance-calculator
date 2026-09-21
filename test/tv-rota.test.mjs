import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

const tpl = fs.readFileSync(new URL("../src/leaderboard-template.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* C84. The "Also show" list was built only from what the tool handed in, and
   the tool only hands it in to the window it opens. Every wall reads the
   published row, which has never carried it, so the one place the control was
   meant to be used was the one place it could not be: the gear offered a rota
   and then said the account had one store. Decided by Jorge on 21 September:
   fill it, from the public store row, and tell an unread list apart from a
   one-store account. */

test("the wall is told where to read the store list, and the spelling is written once", () => {
  const html = LEADERBOARD_HTML({ storeName: "Demo Motors", storesKey: "lpc:board:stores:v1" }, {});
  assert.ok(html.includes('"storesKey":"lpc:board:stores:v1"'), "the key reaches the board");
  assert.ok(/storesKey: PUBLIC_STORES_KEY,/.test(core) && /storesKey: PUBLIC_STORES_KEY,/.test(mgr),
    "both callers pass the one constant rather than each spelling the key out");
  assert.ok(/const PUBLIC_STORES_KEY = "lpc:board:stores:v1";/.test(core), "which is defined in one place");
});

test("the board route hands in no siblings, so the screen reads the list itself", () => {
  /* Deliberate, and the reason is the decision: the published row does not
     carry the group's store list and should not, one copy per board being the
     duplication the code has always avoided. */
  const boot = mgr.slice(mgr.indexOf("function BoardScreen("), mgr.indexOf("\n  return (", mgr.indexOf("function BoardScreen(")));
  assert.ok(/storesKey: PUBLIC_STORES_KEY,/.test(boot));
  assert.ok(!/^\s*siblings:/m.test(boot), "no siblings property on the TV payload (the word is in the comment saying why)");
  assert.ok(/siblings: \(config\?\.stores \|\| \[\]\)/.test(core), "while the tool still hands its own list in");
});

test("an unread list and a one-store account do not say the same thing", () => {
  assert.ok(/This is the only store on this account\./.test(tpl), "a real one-store account keeps its sentence");
  assert.ok(/Cannot reach the store list\. Close this and open it again to try\./.test(tpl),
    "and a list that could not be read says so, offering the retry the screen can actually perform");
  /* The wording matters: the board refreshes its data on its own, but the
     store list is only fetched when the gear is opened, so a sentence
     promising that the screen keeps trying would not be true. */
  assert.ok(!/store list\. This screen keeps trying/.test(tpl));
});

test("the rota is only ever filtered against a list that was really read", () => {
  /* The sharp edge. Dropping ids against a list that failed to load would
     quietly empty a working wall's rota, and Driver's Mart Winter Park is
     rotating today. The filter lives inside drawRota, which only runs on a
     list in hand, never on the failure path. */
  const draw = tpl.slice(tpl.indexOf("function drawRota(rl, sibs){"), tpl.indexOf("function wireTuner(){"));
  assert.ok(/DISP\.rotate = \(DISP\.rotate \|\| \[\]\)\.filter\(/.test(draw), "the filter is inside drawRota");
  const fetched = tpl.slice(tpl.indexOf("rl.innerHTML = '<div class=\"none\">Reading the store list"), tpl.indexOf("drawRota(rl, CFG.siblings);", tpl.indexOf("Reading the store list")));
  assert.ok(!/DISP\.rotate =/.test(fetched), "and nothing on the way to it touches the rota");
  assert.ok(/if \(!v \|\| v\.__err\) \{ rl\.innerHTML = '<div class="none">Cannot reach/.test(tpl),
    "a failed or missing row leaves the rota exactly as it was");
});

test("the handed-in list and the fetched list are drawn by the same code", () => {
  assert.ok(/if \(CFG\.siblings\) drawRota\(rl, CFG\.siblings\);/.test(tpl));
  assert.ok((tpl.match(/rl\.innerHTML = sibs\.map\(/g) || []).length === 1,
    "one drawing, so the tool's list and the wall's cannot drift apart");
});

test("the home store is not offered as somewhere to hand over to", () => {
  assert.ok(/\.filter\(function\(x\)\{ return x && x\.id !== HOME\.id; \}\)/.test(tpl),
    "the wall drops itself from the list it read");
  assert.ok(/\.filter\(\(x\) => x\.id !== storeId\)/.test(core), "the same way the tool always has");
});

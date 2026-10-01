/* C107: a stale manager chunk that lands on a room's snag card reloads once.
   #403 healed the same fault when it escaped as a bare error or rejection; a
   "render" (a boundary's own catch) was left alone, which suited the TV's
   BoardBoundary, that reloads for itself, and left RoomBoundary drawing a card
   whose Try again asks for the same retired file. Run against report.js itself
   on a fake page. */
import { test } from "node:test";
import assert from "node:assert/strict";

const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
let reloads = 0;
globalThis.window = { location: { reload: () => { reloads++; }, pathname: "/", search: "" } };
globalThis.location = globalThis.window.location;
globalThis.sessionStorage = store();
globalThis.localStorage = store();
globalThis.fetch = async () => ({ ok: true });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true });
const { report } = await import("../src/report.js");

const stale = new TypeError("Failed to fetch dynamically imported module: https://www.sageonline.io/assets/Manager-BMcY3tMv.js");
const fresh = () => { reloads = 0; globalThis.sessionStorage = store(); };

test("a room's snag card for a stale chunk reloads once (the 7 rows)", () => {
  fresh();
  report("render", stale, { screen: "app", component: "at Suspense" });
  assert.equal(reloads, 1);
  report("render", stale, { screen: "floor" });
  assert.equal(reloads, 1, "a second inside the cooldown does not: nothing loops");
});

test("the TV's BoardBoundary is left to its own reload and cooldown", () => {
  fresh();
  report("render", stale, { screen: "board", component: "at BoardScreen" });
  assert.equal(reloads, 0);
});

test("#403's paths still heal: a bare error and an unhandled rejection", () => {
  fresh(); report("error", stale); assert.equal(reloads, 1);
  fresh(); report("rejection", stale); assert.equal(reloads, 1);
});

test("a render fault that is not a stale chunk never reloads", () => {
  fresh();
  report("render", new TypeError("Cannot read properties of undefined (reading 'map')"), { screen: "app" });
  report("render", new Error("Importing the wrong thing"), { screen: "line" });
  assert.equal(reloads, 0);
});

test("the three engines' words are all caught", () => {
  for (const msg of ["Failed to fetch dynamically imported module: x.js", "error loading dynamically imported module: x.js", "Importing a module script failed."]) {
    fresh(); report("render", new TypeError(msg), { screen: "app" }); assert.equal(reloads, 1, msg);
  }
});

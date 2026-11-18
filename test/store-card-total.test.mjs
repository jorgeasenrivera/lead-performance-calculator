import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/* Every store and person here is fictional. The group page's card for a store
   summed every person on the roster, BDC and managers included, while the
   store's own home screen showed DriveCentric's count. Shared credit put the
   card a few cars above the home for the same store and month. These hold the
   two to one number. */

async function exported(path, names) {
  const url = new URL(path, import.meta.url);
  const output = await build({ stdin: { contents: fs.readFileSync(url, "utf8") + `\nexport { ${names.join(", ")} };\n`,
    resolveDir: fileURLToPath(new URL(".", url)), sourcefile: fileURLToPath(url), loader: "jsx" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent", loader: { ".css": "text" },
    define: { "import.meta.env": "{}", "import.meta.url": JSON.stringify(url.href) } });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(url), module, module.exports);
  return module.exports;
}
const manager = exported("../src/Manager.jsx", ["storeMonthUnits"]);

const ROLES = [
  { id: "sales", onBoard: true },
  { id: "bdc", onBoard: false },
  { id: "mgr", onBoard: false },
];
// Lakeside Motors: two salespeople, a BDC agent who set appointments on the
// same cars, and a manager with a split.
const DATA = {
  roster: [
    { id: "a", name: "Avery Lane", roleId: "sales" },
    { id: "b", name: "Blake Moss", roleId: "sales" },
    { id: "c", name: "Casey Reed", roleId: "bdc" },
    { id: "d", name: "Dana Fox", roleId: "mgr" },
  ],
  departed: [{ id: "e", name: "Ellis Park", roleId: "sales" }],
};
const STATS = {
  "avery lane": { internetUnits: 4, phoneUnits: 2, showroomUnits: 3, campaignUnits: 0, serviceUnits: 1 },
  "blake moss": { internetUnits: 3, phoneUnits: 1, showroomUnits: 2.5, campaignUnits: 0.5, serviceUnits: 0 },
  "casey reed": { internetUnits: 3, phoneUnits: 2 },
  "dana fox": { showroomUnits: 0.5 },
  "ellis park": { internetUnits: 2 },
};

test("with DriveCentric's count on file, the card shows exactly that count", async () => {
  const { storeMonthUnits } = await manager;
  const M = { stats: STATS, stated: { deliveries: 135 } };
  assert.equal(storeMonthUnits(DATA, M, ROLES), 135);
});

test("without it, the card counts the people the board shows, not BDC or managers", async () => {
  const { storeMonthUnits } = await manager;
  const M = { stats: STATS };
  // Avery 10, Blake 7, and Ellis 2 who left this month with credits. Casey (BDC)
  // and Dana (manager) carry credit for the same cars and are left out.
  assert.equal(storeMonthUnits(DATA, M, ROLES), 19);
});

test("someone on the ignore list stays out even with credits", async () => {
  const { storeMonthUnits } = await manager;
  const M = { stats: STATS };
  assert.equal(storeMonthUnits({ ...DATA, excluded: ["Ellis Park"] }, M, ROLES), 17);
});

test("a month with nothing filed counts nothing", async () => {
  const { storeMonthUnits } = await manager;
  assert.equal(storeMonthUnits(DATA, undefined, ROLES), 0);
  assert.equal(storeMonthUnits({}, { stats: STATS }, ROLES), 0);
});

test("the group card and the round-up both read the store's month from the one helper", () => {
  // The store's home already prefers DriveCentric's count; a screen that sums
  // the roster by hand is how the card drifted.
  const src = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  const overview = src.slice(src.indexOf("function AdminOverview("), src.indexOf("const groupUnits ="));
  assert.match(overview, /storeMonthUnits\(d, M, config\.roles\)/);
  assert.doesNotMatch(overview, /units \+= deliveredUnits/);
  const roundUp = src.slice(src.indexOf("function RoundUp("), src.indexOf("const goal = storeGoalFor(store, mk)"));
  assert.match(roundUp, /storeMonthUnits\(data, M, config\.roles\)/);
});

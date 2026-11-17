import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { deliveredUnits, DELIVERED_UNIT_FIELDS } from "../api/_delivered-units.mjs";
import { BOARD_STAT_FIELDS } from "../api/_store-keys.mjs";

/* Every store and person here is fictional. The TV board counts a delivery from
   any of the five sources DriveCentric credits, Service included; the app's own
   screens added up four, so a person with Service deals read lower in the app
   than on the wall. These hold the two to the same count. */

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
const manager = exported("../src/Manager.jsx", ["unitsOf", "personUnits"]);

// Alex sold 3.5 across the four lead sources and 2.5 through Service.
const ALEX = { internetUnits: 1.5, phoneUnits: 1, showroomUnits: 0.5, campaignUnits: 0.5, serviceUnits: 2.5 };

test("a delivery from any of the five sources counts once", () => {
  assert.equal(deliveredUnits(ALEX), 6);
  assert.deepEqual(DELIVERED_UNIT_FIELDS,
    ["internetUnits", "phoneUnits", "showroomUnits", "campaignUnits", "serviceUnits"]);
});

test("the app counts exactly what the TV board carries", () => {
  // Every source the app adds up has to reach the board row, or the wall and
  // the app would part again the next time a source is added.
  for (const f of DELIVERED_UNIT_FIELDS) assert.ok(BOARD_STAT_FIELDS.includes(f), f + " is not on the board row");
});

test("a month imported before Service was read still counts its other sources", () => {
  assert.equal(deliveredUnits({ internetUnits: 2, phoneUnits: 1, showroomUnits: 1, campaignUnits: 0 }), 4);
  assert.equal(deliveredUnits({ internetUnits: 2, serviceUnits: null }), 2);
});

test("nothing on file is nothing, and a stray value is not a car", () => {
  assert.equal(deliveredUnits(null), 0);
  assert.equal(deliveredUnits(undefined), 0);
  assert.equal(deliveredUnits({}), 0);
  assert.equal(deliveredUnits({ internetUnits: 2, phoneUnits: "n/a", serviceUnits: "1" }), 3);
});

test("the manager screens count Service: hover card, board, store hero, coaching", async () => {
  const { unitsOf, personUnits } = await manager;
  assert.equal(unitsOf(ALEX), 6);
  assert.equal(unitsOf(null), 0);
  const M = { stats: { "alex example": ALEX, "bailey example": { internetUnits: 2, serviceUnits: 0.5 } } };
  assert.equal(personUnits(M, "Alex Example"), 6);
  assert.equal(personUnits(M, "Bailey Example"), 2.5);
  assert.equal(personUnits(M, "Nobody Example"), 0);
});

test("no screen adds the sources up by hand, apart from the two held for review", () => {
  /* A hand-written sum is how Service went missing: each one listed four
     sources and nobody had a reason to look at it when a fifth arrived. The two
     left are the roster repair tool and the store's people panel, which belong
     to the People work and wait on that review before they change. */
  const sums = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8").split("\n")
    .map((line, i, all) => ({ line, before: all.slice(Math.max(0, i - 4), i + 1).join("\n") }))
    .filter(({ line }) => /internetUnits\s*(\?\?|\|\|)\s*0\)\s*\+/.test(line));
  assert.deepEqual(sums("../src/LeadPerformanceCalculator.jsx"), []);
  const held = sums("../src/Manager.jsx");
  assert.equal(held.length, 2);
  assert.ok(held.some((s) => /const monthUnits = /.test(s.before)), "roster repair tool");
  assert.ok(held.some((s) => /const monthUnitsFor = /.test(s.before)), "store people panel");
});

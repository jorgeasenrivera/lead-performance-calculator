import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { deliveredUnits, DELIVERED_UNIT_FIELDS } from "../api/_delivered-units.mjs";
import { unclaimed, pendingList, priorFor, manglings, mergeManglings, claimPending, transferIn, packUp } from "../api/_people-status.mjs";
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

test("the app and People summaries no longer hand-add delivery sources", () => {
  const sums = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8").split("\n")
    .map((line, i, all) => ({ line, before: all.slice(Math.max(0, i - 4), i + 1).join("\n") }))
    .filter(({ line }) => /internetUnits\s*(\?\?|\|\|)\s*0\)\s*\+/.test(line));
  assert.deepEqual(sums("../src/LeadPerformanceCalculator.jsx"), []);
  assert.deepEqual(sums("../src/Manager.jsx"), []);
  assert.deepEqual(sums("../api/_people-status.mjs"), []);
});

test("the Manager roster repair and People panel count Service without inventing missing rows", () => {
  const source = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  const repair = source.match(/^      const monthUnits = (\(\(\) => \{[\s\S]*?^      \}\)\(\));$/m);
  const people = source.match(/^  const monthUnitsFor = (\(key\) => \{[\s\S]*?^  \});$/m);
  assert.ok(repair && people, "the actual People and repair calculations are present");
  const month = "2026-11";
  const data = { months: { [month]: { stats: { alex: ALEX, legacy: { phoneUnits: 1.25 }, service: { serviceUnits: 0.5 } } } } };
  const evaluate = (match, input) => new Function("data", "ym", "deliveredUnits", "return " + match[1])(input, () => month, deliveredUnits);
  assert.deepEqual(evaluate(repair, data), { alex: 6, legacy: 1.25, service: 0.5 });
  assert.deepEqual(evaluate(repair, {}), {});
  const monthUnitsFor = evaluate(people, data);
  assert.deepEqual(["alex", "legacy", "service", "absent"].map(monthUnitsFor), [6, 1.25, 0.5, 0]);
  assert.equal(evaluate(people, {})("alex"), 0);
});

test("People previews count Service while claim, fold and transfer preserve the source credits", () => {
  const month = "2026-11";
  const legacy = { internetUnits: 0.75, showroomUnits: 0.5 };
  const misspelled = "Alex Example Alex Example";
  const foldKey = misspelled.toLowerCase();
  const alexKey = "alex example";
  const pendingKey = "casey example";
  const data = {
    roster: [{ id: "alex", name: "Alex Example", roleId: "sales" }],
    months: { [month]: { stats: {
      [foldKey]: { ...ALEX, displayName: misspelled },
      [alexKey]: { serviceUnits: 0.25 }, "legacy example": legacy,
    } } },
    pendingPeople: {
      [pendingKey]: { name: "Casey Example", months: { [month]: { serviceUnits: 0.5 } }, days: {} },
      "no data": { name: "No Data" },
    },
    priorHistory: { [alexKey]: { previous: { storeName: "Fictional", months: { [month]: ALEX, "2026-10": legacy } } } },
  };
  const original = structuredClone(data);
  assert.deepEqual(unclaimed(data).map(({ key, units }) => [key, units]), [[foldKey, 6], ["legacy example", 1.25]]);
  assert.deepEqual(pendingList(data).map(({ key, units }) => [key, units]), [[pendingKey, 0.5], ["no data", 0]]);
  assert.equal(priorFor(data, "Alex Example")[0].units, 7.25);
  const repairs = manglings(data);
  assert.deepEqual(repairs.map(({ from, to, units }) => [from, to, units]), [[misspelled, "Alex Example", 6]]);
  assert.deepEqual(data, original, "previews never change figures");
  const folded = mergeManglings(data, repairs);
  assert.equal(folded.months[month].stats[foldKey], undefined);
  assert.equal(folded.months[month].stats[alexKey].serviceUnits, 2.75);
  assert.equal(deliveredUnits(folded.months[month].stats[alexKey]), 6.25);
  const claimed = claimPending(data, "Casey Example", { newId: "casey" });
  assert.deepEqual(claimed.months[month].stats[pendingKey], { serviceUnits: 0.5 });
  assert.equal(claimed.pendingPeople[pendingKey], undefined);
  const packed = packUp(claimed, "Casey Example", "old-store", "Fictional");
  const destination = transferIn({ months: {} }, packed);
  assert.deepEqual(destination.months, {}, "prior-store credits stay off the destination totals");
  assert.equal(priorFor(destination, "Casey Example")[0].units, 0.5);
});

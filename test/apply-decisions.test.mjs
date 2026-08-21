/**
 * A decision has to survive being handed the server's copy.
 * -------------------------------------------------------------------------
 * The merge settles each field against its own rule. That is not the same
 * thing as the document obeying the decisions somebody made, and the gap
 * between those two has now produced the same fault twice:
 *
 *   a name folded into its real owner came back, because the fold was carried
 *   out by deleting a key and the server's month was handed over whole
 *
 *   a roll-up row marked as not one of this store's people kept its cars. The
 *   name stayed off every list, correctly, while its forty units walked back
 *   into the store's total — which is the single thing ignoring a name is for
 *
 * The second was found by writing this file rather than by a manager noticing
 * the total was wrong, which is the first time one of these has been caught
 * before it was reported.
 *
 * applyDecisions runs at the end of every merge and carries the decisions out
 * again over whatever came back. These are the decisions, one at a time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeAgainstServer, applyDecisions } from "../api/_store-merge.mjs";
import { setStatus, sameAs } from "../api/_people-status.mjs";

const YM = "2026-08";
const DAY = "2026-08-20";
const base = () => ({
  roster: [{ id: "a1", name: "Fin Smith" }, { id: "a2", name: "Round Robin" }],
  excluded: [], departed: [], ignoredAt: {}, unignored: {}, returned: {}, aliases: {},
  months: { [YM]: { stats: {
    "fin smith": { internetUnits: 5 },
    "round robin": { internetUnits: 40 },
  }, names: {}, imports: {} } },
  activity: { [DAY]: { "round robin": { calls: 99 }, "fin smith": { calls: 10 } } },
  importLog: [{ id: "i1", t: "2026-08-21T10:00:00.000Z" }],
});
/* The server with an import this browser has never seen, which is the branch
   that hands the month back whole. Reports arrive hourly, so this is the
   ordinary case rather than the rare one. */
const serverAhead = () => {
  const s = base();
  s.importLog = [{ id: "i2", t: "2026-08-21T18:00:00.000Z" }];
  return s;
};
const units = (d) => Object.values(d.months[YM].stats)
  .reduce((n, s) => n + (s.internetUnits || 0), 0);

test("an ignored roll-up row does not bring its cars back with the server's month", () => {
  const mine = setStatus(base(), "Round Robin", "ignored", { by: "Jorge" });
  assert.equal(units(mine), 5, "ignoring should have taken the figures out to begin with");
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(mine)), serverAhead());
  assert.equal(out.months[YM].stats["round robin"], undefined,
    "the ignored row is back in the books: " + JSON.stringify(out.months[YM].stats));
  assert.equal(units(out), 5, "the store's total is inflated by figures it never earned");
  assert.equal(out.activity[DAY]["round robin"], undefined, "and its activity came back too");
});

test("the name stays off the lists as well, which it always did", () => {
  const mine = setStatus(base(), "Round Robin", "ignored", { by: "Jorge" });
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(mine)), serverAhead());
  assert.ok(!out.roster.some((a) => a.name === "Round Robin"));
  assert.ok(out.excluded.includes("Round Robin"));
});

test("somebody who left keeps their cars, because the store did sell them", () => {
  /* The difference between the two standings is the whole reason for having
     both. A month that loses a leaver's deliveries reads as 84.5 where 85 were
     delivered, so this must NOT be swept up by the same pass. */
  const mine = setStatus(base(), "Round Robin", "departed", { by: "Jorge" });
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(mine)), serverAhead());
  assert.equal(out.months[YM].stats["round robin"].internetUnits, 40,
    "a leaver's deliveries were taken out of the month");
  assert.ok(out.departed.some((d) => d.name === "Round Robin"));
});

test("letting somebody back in stops their figures being stripped", () => {
  const ignored = setStatus(base(), "Round Robin", "ignored", { by: "Jorge" });
  const back = setStatus(ignored, "Round Robin", "active", { by: "Jorge" });
  // Their old figures were deleted when they were ignored; the server still has
  // them, and now that the decision is reversed they are allowed to come back.
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(back)), serverAhead());
  assert.equal(out.months[YM].stats["round robin"].internetUnits, 40);
});

test("a folded misspelling does not come back either", () => {
  // The first of the two faults, now handled by the same closing pass.
  const d = base();
  d.months[YM].stats["fin smith visit"] = { internetUnits: 3 };
  const folded = sameAs(d, "Fin Smith Visit", "Fin Smith", { by: "Jorge" });
  const server = serverAhead();
  server.months[YM].stats["fin smith visit"] = { internetUnits: 3 };
  const out = mergeAgainstServer(JSON.parse(JSON.stringify(folded)), server);
  assert.equal(out.months[YM].stats["fin smith visit"], undefined);
  assert.equal(out.months[YM].stats["fin smith"].internetUnits, 8, "3 folded into 5");
});

test("running it twice takes nothing extra and puts nothing back", () => {
  const mine = setStatus(base(), "Round Robin", "ignored", { by: "Jorge" });
  const once = applyDecisions(JSON.parse(JSON.stringify(mine)));
  const twice = applyDecisions(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("a document with no decisions in it is left alone", () => {
  const plain = base();
  const before = JSON.stringify(plain);
  applyDecisions(plain);
  assert.equal(JSON.stringify(plain), before);
});

test("an ignore recorded before stamps existed still counts", () => {
  /* Every store has ignore entries from before any of this. They have no
     stamps on either side and have always meant "ignored". */
  const d = base();
  d.excluded = ["Round Robin"];
  d.roster = d.roster.filter((a) => a.name !== "Round Robin");
  applyDecisions(d);
  assert.equal(d.months[YM].stats["round robin"], undefined);
});

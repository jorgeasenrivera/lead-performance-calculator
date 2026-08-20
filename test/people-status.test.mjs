/**
 * Somebody's standing at a store.
 * -------------------------------------------------------------------------
 * Three screens used to do this and all three did it differently; two were
 * broken in the same way. This is the one place that does it now, so these are
 * the checks that hold every screen at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setStatus, statusOf, everyone, unclaimed, STATUSES } from "../api/_people-status.mjs";

const store = () => ({
  roster: [{ id: "a1", name: "Fin Smith", roleId: "sales" },
           { id: "a2", name: "Angel Perez", roleId: "sales" }],
  departed: [{ id: "a3", name: "Old Hand", roleId: "sales", at: "2026-07-01T00:00:00.000Z" }],
  excluded: ["Round Robin"],
  ignoredAt: { "round robin": "2026-06-01T00:00:00.000Z" },
  unignored: {}, returned: {},
  months: { "2026-08": { stats: {
    "fin smith": { displayName: "Fin Smith", internetUnits: 6, phoneUnits: 2 },
    "angel perez": { displayName: "Angel Perez", internetUnits: 4 },
    "old hand": { displayName: "Old Hand", showroomUnits: 3 },
  } } },
  activity: { "2026-08-19": {
    "fin smith": { calls: 20, video: 2, tasks: 4 },
    "angel perez": { calls: 5, video: 0, tasks: 1 },
  } },
});

test("a store says what it thinks of everybody", () => {
  const d = store();
  assert.equal(statusOf(d, "Fin Smith"), "active");
  assert.equal(statusOf(d, "Old Hand"), "departed");
  assert.equal(statusOf(d, "Round Robin"), "ignored");
  assert.equal(statusOf(d, "Nobody At All"), "unknown");
  assert.equal(statusOf(d, "  FIN   smith "), "active", "spelling and spacing do not change who somebody is");
});

test("everyone comes back once, whatever list they are on", () => {
  const all = everyone(store());
  assert.deepEqual(all.map((p) => p.name), ["Angel Perez", "Fin Smith", "Old Hand", "Round Robin"]);
  assert.deepEqual(all.map((p) => p.status), ["active", "active", "departed", "ignored"]);
});

// ---- ignoring: the mistake case ----
test("ignoring somebody takes their figures with them", () => {
  /* They were never this store's cars. Leaving them behind is what keeps a
     store's total inflated after the people are gone. */
  const d = setStatus(store(), ["Angel Perez"], "ignored", { by: "Jorge" });
  assert.equal(statusOf(d, "Angel Perez"), "ignored");
  assert.ok(!d.roster.some((a) => a.name === "Angel Perez"));
  assert.equal(d.months["2026-08"].stats["angel perez"], undefined, "their month figures go");
  assert.equal(d.activity["2026-08-19"]["angel perez"], undefined, "and their days");
  assert.ok(d.months["2026-08"].stats["fin smith"], "and nobody else is touched");
});

test("and it is stamped, or the merge undoes it", () => {
  const d = setStatus(store(), ["Angel Perez"], "ignored", { at: "2026-08-20T12:00:00.000Z" });
  assert.equal(d.ignoredAt["angel perez"], "2026-08-20T12:00:00.000Z");
});

test("an older note that they were let back in is cleared", () => {
  /* Otherwise the stamp comparison sees a newer "unignored" and hands them back
     the moment anybody saves. */
  const d0 = store();
  d0.unignored["angel perez"] = "2026-08-01T00:00:00.000Z";
  const d = setStatus(d0, ["Angel Perez"], "ignored", { at: "2026-08-20T12:00:00.000Z" });
  assert.equal(d.unignored["angel perez"], undefined);
});

// ---- departing: the person case ----
test("somebody who leaves keeps their cars in the month they sold them", () => {
  /* The distinction the two statuses exist for. A month that loses a leaver's
     deliveries reads as 84.5 where 85 were delivered. */
  const d = setStatus(store(), ["Fin Smith"], "departed", { by: "Jorge" });
  assert.equal(statusOf(d, "Fin Smith"), "departed");
  assert.ok(!d.roster.some((a) => a.name === "Fin Smith"));
  assert.equal(d.months["2026-08"].stats["fin smith"].internetUnits, 6, "the store did sell those");
  assert.ok(d.activity["2026-08-19"]["fin smith"], "and the days they worked stand");
});

test("departing records when and who said so", () => {
  const d = setStatus(store(), ["Fin Smith"], "departed", { at: "2026-08-20T12:00:00.000Z", by: "Jorge" });
  const rec = d.departed.find((x) => x.name === "Fin Smith");
  assert.equal(rec.at, "2026-08-20T12:00:00.000Z");
  assert.equal(rec.by, "Jorge");
  assert.equal(rec.roleId, "sales", "and what they did, so bringing them back restores it");
});

test("departing somebody who was ignored lifts the ignore", () => {
  /* Leaving is not the same as never having been here, and leaving the two
     stamps to fight would make the outcome depend on which screen saved last. */
  const d = setStatus(store(), ["Round Robin"], "departed", { at: "2026-08-20T12:00:00.000Z" });
  assert.equal(statusOf(d, "Round Robin"), "departed");
  assert.equal(d.unignored["round robin"], "2026-08-20T12:00:00.000Z");
});

// ---- coming back ----
test("bringing somebody back puts them on the floor as they were", () => {
  const d = setStatus(store(), ["Old Hand"], "active", { at: "2026-08-20T12:00:00.000Z" });
  assert.equal(statusOf(d, "Old Hand"), "active");
  const rec = d.roster.find((a) => a.name === "Old Hand");
  assert.equal(rec.id, "a3", "the same person, not a new one");
  assert.equal(rec.roleId, "sales");
  assert.equal(d.returned["old hand"], "2026-08-20T12:00:00.000Z", "and it is stamped");
});

test("un-ignoring somebody is stamped too", () => {
  const d = setStatus(store(), ["Round Robin"], "active", { at: "2026-08-20T12:00:00.000Z" });
  assert.equal(statusOf(d, "Round Robin"), "active");
  assert.equal(d.unignored["round robin"], "2026-08-20T12:00:00.000Z");
});

test("a new hire arrives with a start date", () => {
  const d = setStatus(store(), ["Nina Cortez"], "active",
    { hiredAt: "2026-08-18", roleId: "sales", newId: "a9" });
  const rec = d.roster.find((a) => a.name === "Nina Cortez");
  assert.equal(rec.hiredAt, "2026-08-18");
  assert.equal(rec.roleId, "sales");
});

test("setting the standing somebody already has changes nothing and logs nothing", () => {
  const d = setStatus(store(), ["Fin Smith"], "active");
  assert.equal(d.peopleLog.length, 0);
  assert.equal(statusOf(d, "Fin Smith"), "active");
});

test("nobody ends up on two lists at once", () => {
  let d = store();
  for (const s of ["departed", "ignored", "active", "ignored", "departed"]) {
    d = setStatus(d, ["Fin Smith"], s);
    const on = [d.roster.some((a) => a.name === "Fin Smith"),
                d.departed.some((x) => x.name === "Fin Smith"),
                d.excluded.some((x) => x === "Fin Smith")].filter(Boolean).length;
    assert.equal(on, 1, `after ${s} they are on ${on} lists`);
    assert.equal(statusOf(d, "Fin Smith"), s);
  }
});

test("several people at once", () => {
  const d = setStatus(store(), ["Fin Smith", "Angel Perez"], "ignored");
  assert.equal(statusOf(d, "Fin Smith"), "ignored");
  assert.equal(statusOf(d, "Angel Perez"), "ignored");
  assert.equal(d.peopleLog.length, 2);
});

test("the log says what changed, not just where they ended up", () => {
  const d = setStatus(store(), ["Fin Smith"], "departed", { at: "2026-08-20T12:00:00.000Z", by: "Jorge", note: "moved to Ford" });
  assert.deepEqual(d.peopleLog[0], { at: "2026-08-20T12:00:00.000Z", by: "Jorge",
    name: "Fin Smith", from: "active", to: "departed", note: "moved to Ford" });
});

test("a bad status is refused rather than half applied", () => {
  const d = store();
  assert.equal(setStatus(d, ["Fin Smith"], "fired"), d);
});

test("an empty selection does nothing", () => {
  const d = setStatus(store(), [], "ignored");
  assert.equal(statusOf(d, "Fin Smith"), "active");
});

// ---- the check that would have caught Classic Mazda ----
test("figures for somebody the store does not claim are surfaced", () => {
  /* The shape every cross-store mix-up takes: books crediting somebody the store
     has never employed. It is also how a parser mistake shows up, since a
     heading read as a person arrives exactly this way. */
  const d = store();
  d.months["2026-08"].stats["danielle newsome"] = { displayName: "Danielle Newsome", internetUnits: 3 };
  d.activity["2026-08-19"]["danielle newsome"] = { calls: 8, video: 1, tasks: 2 };
  const out = unclaimed(d);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Danielle Newsome");
  assert.equal(out[0].units, 3, "with the cars it is counting for them");
  assert.equal(out[0].days, 1);
  assert.deepEqual(out[0].months, ["2026-08"]);
});

test("a store whose books match its people has nothing to answer for", () => {
  assert.deepEqual(unclaimed(store()), [], "including the departed and the ignored, who are still claimed");
});

test("and ignoring the stranger clears the finding", () => {
  const d0 = store();
  d0.months["2026-08"].stats["danielle newsome"] = { displayName: "Danielle Newsome", internetUnits: 3 };
  assert.equal(unclaimed(d0).length, 1);
  const d = setStatus(d0, ["Danielle Newsome"], "ignored");
  assert.deepEqual(unclaimed(d), [], "their figures went with them");
});

test("every status is one the screens can actually set", () => {
  assert.deepEqual(STATUSES, ["active", "departed", "ignored"]);
});

test("the store it was given is never modified", () => {
  const d = store();
  const copy = JSON.parse(JSON.stringify(d));
  setStatus(d, ["Fin Smith"], "ignored");
  assert.deepEqual(d, copy, "callers hold the original until they choose to save");
});

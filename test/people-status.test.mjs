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

// ---- holding a report's unknown names ----
import { admitsEveryone, holdPerson, pendingList, claimPending, dropPending,
         packUp, transferIn, transferOut, priorFor } from "../api/_people-status.mjs";

/* Somebody the store has no record of at all, which is the case being tested.
   Angel Perez is on the base fixture's roster, so holding her would have proved
   nothing — the first version of this did exactly that and passed for the wrong
   reason until the assertion caught it. */
const held = () => {
  const d = store();
  holdPerson(d, "Vernon Johnson", { monthKey: "2026-08", rec: { displayName: "Vernon Johnson", internetUnits: 4 },
    day: "2026-08-19", dayRow: { calls: 8, video: 1 }, at: "2026-08-20T10:00:00.000Z", file: "Report-8-20.pdf" });
  return d;
};

test("a new store takes its first report as gospel", () => {
  /* Otherwise a manager opens a brand new store to forty names in a queue and an
     empty screen, which is a worse first five minutes than the risk. */
  assert.equal(admitsEveryone({ roster: [] }), true);
  assert.equal(admitsEveryone({}), true);
  assert.equal(admitsEveryone(store()), false, "a store with people checks them");
});

test("an unknown name is parked, not added and not dropped", () => {
  const d = held();
  assert.equal(statusOf(d, "Vernon Johnson"), "unknown", "not on the floor");
  assert.equal(d.months["2026-08"].stats["vernon johnson"], undefined, "and not in the store's totals");
  const p = pendingList(d);
  assert.equal(p.length, 1);
  assert.equal(p[0].name, "Vernon Johnson");
  assert.equal(p[0].units, 4, "but the figures are kept, whole");
  assert.deepEqual(p[0].files, ["Report-8-20.pdf"], "with the report they came from");
});

test("the same name across two reports collects rather than replaces", () => {
  const d = held();
  holdPerson(d, "Vernon Johnson", { monthKey: "2026-08", rec: { phoneUnits: 2 },
    day: "2026-08-20", dayRow: { calls: 3 }, file: "Report-8-21.pdf" });
  const p = pendingList(d)[0];
  assert.equal(p.units, 6, "4 from one report and 2 from the next");
  assert.equal(p.days, 2);
  assert.equal(p.files.length, 2);
});

test("claiming somebody folds their held figures in", () => {
  /* The only path by which a report's numbers reach a store's totals now. */
  const d = claimPending(held(), ["Vernon Johnson"], { by: "Jorge" });
  assert.equal(statusOf(d, "Vernon Johnson"), "active");
  assert.equal(d.months["2026-08"].stats["vernon johnson"].internetUnits, 4);
  assert.equal(d.activity["2026-08-19"]["vernon johnson"].calls, 8);
  assert.equal(d.pendingPeople["vernon johnson"], undefined, "and nothing is left waiting");
});

test("claiming does not disturb what was already there", () => {
  const d = claimPending(held(), ["Vernon Johnson"]);
  assert.equal(d.months["2026-08"].stats["fin smith"].internetUnits, 6);
  assert.equal(d.activity["2026-08-19"]["fin smith"].calls, 20);
});

test("disowning somebody takes the held figures with the decision", () => {
  const d = dropPending(held(), ["Vernon Johnson"], { by: "Jorge" });
  assert.equal(statusOf(d, "Vernon Johnson"), "ignored");
  assert.equal(d.pendingPeople["vernon johnson"], undefined);
  assert.equal(d.months["2026-08"].stats["vernon johnson"], undefined,
    "they never reached the totals, and they are not going to now");
  assert.ok(d.ignoredAt["vernon johnson"], "and it is stamped, so a later report cannot undo it");
});

test("nothing waiting is the ordinary state", () => {
  assert.deepEqual(pendingList(store()), []);
  assert.deepEqual(pendingList({}), []);
});

// ---- transferring between stores ----
const ford = () => ({ roster: [{ id: "b1", name: "Someone Else", roleId: "sales" }],
  departed: [], excluded: [], months: { "2026-08": { stats: { "someone else": { internetUnits: 5 } } } },
  activity: {}, ignoredAt: {}, unignored: {}, returned: {} });

test("a transfer carries everything the old store knew", () => {
  const packed = packUp(store(), "Fin Smith", "classic-mazda", "Classic Mazda");
  assert.equal(packed.name, "Fin Smith");
  assert.equal(packed.roleId, "sales");
  assert.equal(packed.months["2026-08"].internetUnits, 6);
  assert.equal(packed.days["2026-08-19"].calls, 20);
  assert.equal(packed.fromName, "Classic Mazda");
});

test("the old store keeps every car they sold there", () => {
  /* A store whose past totals shrink because somebody transferred out is a store
     whose figures cannot be trusted. */
  const out = transferOut(store(), "Fin Smith", "Holler Ford", { by: "Jorge" });
  assert.equal(statusOf(out, "Fin Smith"), "departed");
  assert.equal(out.months["2026-08"].stats["fin smith"].internetUnits, 6);
  assert.match(out.peopleLog[0].note, /transferred to Holler Ford/);
});

test("and the new store gets their record without counting it as its own", () => {
  /* The whole point. Cars sold at another dealership must never be summed into
     this one's totals — doing that deliberately for a transfer would be no better
     than doing it by accident, which is the fault all of this exists to prevent. */
  const packed = packUp(store(), "Fin Smith", "classic-mazda", "Classic Mazda");
  const inn = transferIn(ford(), packed, { by: "Jorge", startedAt: "2026-08-21" });
  assert.equal(statusOf(inn, "Fin Smith"), "active");
  assert.equal(inn.roster.find((a) => a.name === "Fin Smith").hiredAt, "2026-08-21");
  assert.equal(inn.months["2026-08"].stats["fin smith"], undefined,
    "their Mazda cars are NOT in Ford's August");
  const prior = priorFor(inn, "Fin Smith");
  assert.equal(prior.length, 1);
  assert.equal(prior[0].storeName, "Classic Mazda");
  assert.equal(prior[0].units, 8, "6 internet and 2 phone, readable on their own screen");
  assert.deepEqual(prior[0].months, ["2026-08"]);
});

test("a transfer does not put the newcomer on the unclaimed list", () => {
  const packed = packUp(store(), "Fin Smith", "classic-mazda", "Classic Mazda");
  const inn = transferIn(ford(), packed, {});
  assert.deepEqual(unclaimed(inn), [], "they are claimed, and their old figures are not in these books");
});

test("somebody who moves twice keeps the store they came from", () => {
  const packed1 = packUp(store(), "Fin Smith", "classic-mazda", "Classic Mazda");
  const d = transferIn(ford(), packed1, {});
  d.months["2026-09"] = { stats: { "fin smith": { internetUnits: 4 } } };
  const packed2 = packUp(d, "Fin Smith", "holler-ford", "Holler Ford");
  const third = transferIn({ roster: [], departed: [], excluded: [], months: {}, activity: {} }, packed2, {});
  assert.deepEqual(priorFor(third, "Fin Smith").map((p) => p.storeName), ["Holler Ford"]);
  assert.equal(priorFor(d, "Fin Smith")[0].storeName, "Classic Mazda",
    "and the earlier move still stands where it was made");
});

test("packing somebody the store has never heard of gives an empty parcel", () => {
  const packed = packUp(store(), "Nobody At All", "classic-mazda", "Classic Mazda");
  assert.deepEqual(packed.months, {});
  assert.deepEqual(packed.days, {});
  const f = ford();
  assert.equal(transferIn(f, null, {}), f, "and an empty parcel changes nothing at all");
});

test("nobody with no prior record is claimed to have one", () => {
  assert.deepEqual(priorFor(ford(), "Someone Else"), []);
  assert.deepEqual(priorFor({}, "Anyone"), []);
});

// ---- the same person, spelled two ways ----
import { likelyMatches, sameAs } from "../api/_people-status.mjs";

/* Worth knowing before reading these: norm() already folds case and spacing, so
   "Juan Ruiz lopez" and "Juan Ruiz Lopez" are ONE key and were never two rows.
   The spellings that really split a person are the ones normalising cannot
   reach — a hyphen in a different place, a suffix, a middle name, a nickname. */

test("a hyphen in the wrong place is spotted, and confidently", () => {
  const d = store();
  d.roster.push({ id: "a4", name: "Karina Ramirez-Pagan", roleId: "sales" });
  const hits = likelyMatches(d, "Karina Ramirez- Pagan");
  assert.equal(hits[0].name, "Karina Ramirez-Pagan");
  assert.equal(hits[0].confident, true, "one character apart, so it can be offered as the answer");
});

test("a missing letter is spotted too", () => {
  const hits = likelyMatches(store(), "Fin Smth");
  assert.equal(hits[0].name, "Fin Smith");
  assert.ok(hits[0].confident);
});

test("a suffix that one report carries and another does not", () => {
  const d = store();
  d.roster.push({ id: "a4", name: "Samuel Miller", roleId: "sales" });
  const hits = likelyMatches(d, "Samuel Miller IV");
  assert.equal(hits[0].name, "Samuel Miller");
});

test("but two different people are not run together", () => {
  /* Edit distance alone calls these a match. An automatic merge would put one
     person's month onto another's, which is worse than a duplicate row — so the
     two signals have to agree before anything is offered confidently. */
  const d = store();
  d.roster.push({ id: "a5", name: "Toni Thomas", roleId: "sales" });
  assert.deepEqual(likelyMatches(d, "Toni Law").filter((h) => h.confident), [],
    "a shared first name is not a match");
});

test("a nickname is left for a person to decide", () => {
  /* "Mike" and "Michael" are four characters apart with one word in common,
     which is also what two different Ganuses would look like. Not suggested,
     which is why the screen also lets a manager pick anybody. */
  const d = store();
  d.roster.push({ id: "a6", name: "Michael Ganus", roleId: "sales" });
  assert.deepEqual(likelyMatches(d, "Mike Ganus").filter((h) => h.confident), []);
});

test("and a stranger matches nobody", () => {
  assert.deepEqual(likelyMatches(store(), "Vicente Pastoriza"), []);
});

test("somebody already ignored is never offered", () => {
  /* Folding a name into a person the store has said is not theirs would put the
     figures back by the side door. */
  assert.deepEqual(likelyMatches(store(), "Round Robbin").filter((h) => h.name === "Round Robin"), []);
});

test("saying they are the same person teaches it for good", () => {
  const d0 = store();
  d0.roster.push({ id: "a4", name: "Karina Ramirez-Pagan", roleId: "sales" });
  holdPerson(d0, "Karina Ramirez- Pagan", { monthKey: "2026-08", rec: { internetUnits: 3 },
    day: "2026-08-19", dayRow: { calls: 7 } });
  const d = sameAs(d0, "Karina Ramirez- Pagan", "Karina Ramirez-Pagan", { by: "Jorge" });
  assert.equal(d.aliases["karina ramirez- pagan"], "karina ramirez-pagan",
    "so every future report folds itself in without being asked again");
  assert.equal(d.pendingPeople["karina ramirez- pagan"], undefined, "nothing left waiting");
  assert.equal(d.months["2026-08"].stats["karina ramirez-pagan"].internetUnits, 3, "the held cars are theirs");
  assert.equal(d.activity["2026-08-19"]["karina ramirez-pagan"].calls, 7);
});

test("and adds up a month that was already split between the two spellings", () => {
  /* Overwriting would throw away the half that was filed correctly, which is the
     half the store has been reporting on all month. */
  const d0 = store();
  d0.roster.push({ id: "a4", name: "Karina Ramirez-Pagan", roleId: "sales" });
  d0.months["2026-08"].stats["karina ramirez-pagan"] = { displayName: "Karina Ramirez-Pagan", internetUnits: 5 };
  d0.months["2026-08"].stats["karina ramirez- pagan"] = { internetUnits: 3 };
  const d = sameAs(d0, "Karina Ramirez- Pagan", "Karina Ramirez-Pagan", {});
  assert.equal(d.months["2026-08"].stats["karina ramirez-pagan"].internetUnits, 8, "5 and 3, not 3");
  assert.equal(d.months["2026-08"].stats["karina ramirez- pagan"], undefined);
});

test("the misspelling is taken off every list", () => {
  /* Or the next report matches the wrong row before the alias is consulted. */
  const d0 = store();
  d0.roster.push({ id: "a4", name: "Karina Ramirez-Pagan", roleId: "sales" });
  d0.roster.push({ id: "a5", name: "Karina Ramirez- Pagan", roleId: "sales" });
  const d = sameAs(d0, "Karina Ramirez- Pagan", "Karina Ramirez-Pagan", {});
  const karinas = d.roster.filter((a) => /karina/i.test(a.name));
  assert.equal(karinas.length, 1);
  assert.equal(karinas[0].name, "Karina Ramirez-Pagan");
});

test("nobody is made an alias of themselves", () => {
  const d = store();
  assert.equal(sameAs(d, "Fin Smith", "Fin Smith", {}), d);
  assert.equal(sameAs(d, "FIN  smith", "Fin Smith", {}), d, "including a spelling norm already folds");
  assert.equal(sameAs(d, "", "Fin Smith", {}), d);
});

test("it is written down, like every other change to a person", () => {
  const d0 = store();
  d0.roster.push({ id: "a4", name: "Karina Ramirez-Pagan", roleId: "sales" });
  const d = sameAs(d0, "Karina Ramirez- Pagan", "Karina Ramirez-Pagan", { by: "Jorge", at: "2026-08-20T12:00:00.000Z" });
  assert.equal(d.peopleLog[0].by, "Jorge");
  assert.match(d.peopleLog[0].note, /same as Karina Ramirez-Pagan/);
});

// ---- the days somebody is actually judged on ----
import { servedOn } from "../api/_people-status.mjs";

test("a day before they started is not a day they failed to work", () => {
  /* A hire on the 18th used to be measured against the whole month, so their
     first week read as three weeks of doing nothing. */
  const nina = { name: "Nina Cortez", hiredAt: "2026-08-18" };
  assert.equal(servedOn(nina, "2026-08-17", null), false);
  assert.equal(servedOn(nina, "2026-08-18", null), true, "you worked the day you started");
  assert.equal(servedOn(nina, "2026-08-19", null), true);
});

test("and a leaver is not still missing calls after they went", () => {
  const fin = { name: "Fin Smith" };
  assert.equal(servedOn(fin, "2026-08-05", "2026-08-05T17:00:00.000Z"), true, "including their last day");
  assert.equal(servedOn(fin, "2026-08-06", "2026-08-05T17:00:00.000Z"), false);
});

test("somebody who started and left inside one month", () => {
  const short = { name: "Brief Stay", hiredAt: "2026-08-10" };
  const left = "2026-08-14T00:00:00.000Z";
  assert.deepEqual(
    ["2026-08-09", "2026-08-10", "2026-08-12", "2026-08-14", "2026-08-15"].map((d) => servedOn(short, d, left)),
    [false, true, true, true, false]);
});

test("no start date means the whole month, as it always has", () => {
  /* Nothing changes for anybody already on a roster, which is everybody. */
  assert.equal(servedOn({ name: "Old Hand" }, "2020-01-01", null), true);
  assert.equal(servedOn(null, "2026-08-01", null), true);
  assert.equal(servedOn({ name: "X", hiredAt: "" }, "2026-08-01", null), true);
});

test("a timestamp works as well as a date", () => {
  /* Departures are stamped with the full instant and start dates are typed as a
     day. Both have to answer the same question. */
  assert.equal(servedOn({ hiredAt: "2026-08-18T14:22:07.000Z" }, "2026-08-18", null), true);
  assert.equal(servedOn({ hiredAt: "2026-08-18T14:22:07.000Z" }, "2026-08-17", null), false);
});

// ---- names the reader mangled, which are real people underneath ----
import { unmangle, manglings, mergeManglings } from "../api/_people-status.mjs";

test("a column heading welded onto a name comes off", () => {
  /* The Visit column, once per report, for as long as nobody noticed. */
  assert.deepEqual(unmangle("Chase Cabney Visit"),
    { name: "Chase Cabney", why: "a column heading was read as part of the name" });
});

test("a name the report printed twice", () => {
  assert.equal(unmangle("Danielle Newsome Danielle Newsome").name, "Danielle Newsome");
  assert.equal(unmangle("LetitiaLetitia").name, "Letitia", "including with no space between");
});

test("two people welded together are left for a person to look at", () => {
  /* "Luke Pancake Mike Ganus" splits two ways and both are wrong. Guessing here
     would put one person's month onto another's. */
  assert.equal(unmangle("Luke Pancake Mike Ganus"), null);
});

test("an ordinary name is left alone", () => {
  for (const n of ["Fin Smith", "Rafael Lopez de Victoria", "Dr. David Davis II", ""]) {
    assert.equal(unmangle(n), null, n);
  }
});

test("a name that is only a column word is not turned into nothing", () => {
  /* Stripping to an empty string and then merging it into somebody would be the
     worst outcome available. */
  assert.equal(unmangle("Visit"), null);
  assert.equal(unmangle("Total Delivered"), null);
});

const mangled = () => {
  const d = store();
  d.roster.push({ id: "a7", name: "Chase Cabney", roleId: "sales" });
  d.months["2026-08"].stats["chase cabney"] = { displayName: "Chase Cabney", internetUnits: 4 };
  d.months["2026-08"].stats["chase cabney visit"] = { displayName: "Chase Cabney Visit", internetUnits: 3 };
  d.excluded.push("Danielle Newsome Danielle Newsome");
  d.roster.push({ id: "a8", name: "Danielle Newsome", roleId: "sales" });
  return d;
};

test("every mangled name with a real person behind it is found", () => {
  const rows = manglings(mangled());
  const names = rows.map((r) => r.from).sort();
  assert.deepEqual(names, ["Chase Cabney Visit", "Danielle Newsome Danielle Newsome"]);
  const chase = rows.find((r) => r.from === "Chase Cabney Visit");
  assert.equal(chase.to, "Chase Cabney");
  assert.equal(chase.units, 3, "and the cars it is holding, so the size of the fix is visible");
});

test("a mangled name with nobody behind it is left alone", () => {
  /* It might be somebody nobody has added yet, and merging it into thin air
     helps nothing. */
  const d = store();
  d.excluded.push("Nobody Here Visit");
  assert.deepEqual(manglings(d), []);
});

test("and one whose real self the store has disowned is not resurrected", () => {
  const d = store();
  d.excluded.push("Round Robin Visit");
  assert.deepEqual(manglings(d), [], "Round Robin is ignored, so this is not a repair");
});

test("a clean store proposes nothing", () => {
  assert.deepEqual(manglings(store()), []);
});

test("merging the batch puts the figures back on the real people", () => {
  const d0 = mangled();
  const rows = manglings(d0);
  const d = mergeManglings(d0, rows, { by: "Jorge" });
  assert.equal(d.months["2026-08"].stats["chase cabney"].internetUnits, 7, "4 that were his and 3 that were read wrong");
  assert.equal(d.months["2026-08"].stats["chase cabney visit"], undefined);
  assert.equal(statusOf(d, "Chase Cabney"), "active");
  assert.equal(d.excluded.includes("Danielle Newsome Danielle Newsome"), false, "off the ignore list");
  assert.equal(statusOf(d, "Danielle Newsome"), "active");
});

test("and teaches the spelling, so the next report needs no repair", () => {
  const d = mergeManglings(mangled(), manglings(mangled()), {});
  assert.equal(d.aliases["chase cabney visit"], "chase cabney");
});

test("merging the batch is written down, one line each", () => {
  const d = mergeManglings(mangled(), manglings(mangled()), { by: "Jorge" });
  assert.equal(d.peopleLog.length, 2);
  assert.match(d.peopleLog[0].note, /read wrong/);
});

test("an empty batch changes nothing", () => {
  const d = mangled();
  assert.equal(mergeManglings(d, [], {}), d);
  assert.equal(mergeManglings(d, null, {}), d);
});

/* ---- the ignore that could not be undone ----
   An ignore older than the tombstone window, or one made before stamps existed,
   carries no ignoredAt. Un-ignoring used to stamp nothing in that case, and the
   save's merge, a union of ignore lists, put the name straight back. Chase at
   Driver's Mart Winter Park was the example. */
import { mergeAgainstServer } from "../api/_store-merge.mjs";

test("un-ignoring somebody whose ignore has no stamp is still stamped", () => {
  const old = store(); delete old.ignoredAt["round robin"];
  const d = setStatus(old, ["Round Robin"], "active", { at: "2026-09-03T12:00:00.000Z" });
  assert.equal(statusOf(d, "Round Robin"), "active");
  assert.equal(d.unignored["round robin"], "2026-09-03T12:00:00.000Z");
});

test("and the merge respects it, so they stay back", () => {
  const server = store(); delete server.ignoredAt["round robin"];
  server.__storeId = "s"; server.rev = 4;
  const mine = setStatus(JSON.parse(JSON.stringify(server)), ["Round Robin"], "active", { at: new Date().toISOString() });
  const merged = mergeAgainstServer(mine, server);
  assert.equal(statusOf(merged, "Round Robin"), "active");
  assert.ok(!merged.excluded.some((x) => /round robin/i.test(x)));
  assert.ok(merged.roster.some((a) => a.name === "Round Robin"));
});

test("departing somebody whose ignore has no stamp lifts it for good", () => {
  const old = store(); delete old.ignoredAt["round robin"];
  const d = setStatus(old, ["Round Robin"], "departed", { at: "2026-09-03T12:00:00.000Z" });
  assert.equal(d.unignored["round robin"], "2026-09-03T12:00:00.000Z");
  assert.equal(statusOf(mergeAgainstServer(d, { ...old, rev: 1 }), "Round Robin"), "departed");
});

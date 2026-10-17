/**
 * What a hero says about a standard, and what a Summary says about a goal.
 * -------------------------------------------------------------------------
 * Three presentation corrections, none of which moves who is restricted:
 *
 *   1. The Summary shows the goal of the month on screen (storeGoalFor), not the
 *      standing figure the store record still carries.
 *   2. The heroes count a person with no figure as MISSING, not as 0%. A measured
 *      zero stays a measured zero. A figure that cannot be a measurement (a
 *      negative, NaN, Infinity) is unavailable, the same as no figure.
 *   3. The Live Floor button that opens "Behind the standard" says so.
 *
 * Manager.jsx is JSX and cannot be imported, so, as hero-channel-status.test.mjs
 * does, the real code is cut out of the file and run on synthetic people. Nothing
 * here is a real person or a real store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { norm } from "../api/_report-parsers.mjs";
import { storeGoalFor } from "../api/_store-month.mjs";
import { isMeasured, attainmentOf, newRollup, addToRollup, readRollup, weakestRollup } from "../api/_standard-rollup.mjs";

const manager = readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8");

/* The text from `start` up to and including the first `end` after it. */
function cut(start, end, from = 0) {
  const a = manager.indexOf(start, from);
  assert.ok(a >= 0, `Manager.jsx no longer contains: ${start}`);
  const b = manager.indexOf(end, a);
  assert.ok(b >= 0, `Manager.jsx no longer contains ${end} after: ${start}`);
  return manager.slice(a, b + end.length);
}

const METRICS = new Function(`${cut("const METRICS = {", "\n};")}; return METRICS;`)();
const evaluateAssociate = new Function("METRICS", `${cut("function evaluateAssociate(", "\n}\n")}; return evaluateAssociate;`)(METRICS);

const phoneAt = manager.indexOf("function BoardRoomPhone");
const heroAt = manager.indexOf("function StoreHero");
assert.ok(phoneAt > 0 && heroAt > 0, "both heroes are still in Manager.jsx");

const phoneSource = cut("const videoDials = (() => {", "\n  })();", phoneAt);
const rollSource = cut("const metricRoll = {};", "const anyMissing = Object.values(metricRoll).some((r) => r.missing > 0);", heroAt);
const dialsSource = cut('const videoDials = ["apptVideoDayPct", "bhVideoPct", "engagedVideoPct"]', ".filter(Boolean);", heroAt);
const urgentSource = cut("const urgent = [];", "urgent.sort((a, b) => b.capUse - a.capUse);", heroAt);

const helpers = { attainmentOf, newRollup, addToRollup, readRollup, weakestRollup };
const names = Object.keys(helpers);

/* The phone hero's dials for these people. */
function phoneDials({ config, roster, M }) {
  const run = new Function("config", "tiersOf", "roster", "M", "norm", "evaluateAssociate", ...names,
    `${phoneSource}; return videoDials;`);
  const tiersOf = (roleId) => config.standards.s1[roleId]?.tiers;
  return run(config, tiersOf, roster, M, norm, evaluateAssociate, ...names.map((n) => helpers[n]));
}

/* The desk hero's rollup and its dials for these people. */
function deskHero({ config, roster, M }) {
  const run = new Function("config", "store", "roster", "M", "norm", "evaluateAssociate", "METRICS", ...names,
    `${rollSource}\n${dialsSource}\nreturn { metricRoll, attSum, attN, pct, weakest, anyMissing, videoDials };`);
  return run(config, { id: "s1" }, roster, M, norm, evaluateAssociate, METRICS, ...names.map((n) => helpers[n]));
}

/* ---- synthetic floor: one role, three video standards ---- */
const TIERS = [{ cap: 100, requirements: [
  { metric: "apptVideoDayPct", min: 50 },
  { metric: "bhVideoPct", min: 40 },
  { metric: "engagedVideoPct", min: 30 },
] }];
const config = { roles: [{ id: "sales" }], standards: { s1: { sales: { tiers: TIERS } } } };
const person = (name) => ({ name, roleId: "sales" });
const stat = (appt, bh, engaged) => ({ opps: 20, apptVideoDayPct: appt, bhVideoPct: bh, engagedVideoPct: engaged });

const A = person("Fixture A"); // clears all three
const B = person("Fixture B"); // measured zeros: a real figure, and really below
const C = person("Fixture C"); // one figure at half the bar, one missing, one low
const D = person("Fixture D"); // the reports never mentioned them
const E = person("Fixture E"); // a record, with nothing in it
const G = person("Fixture G"); // two figures that clear, one missing
const stats = {
  [norm(A.name)]: stat(0.6, 0.5, 0.4),
  [norm(B.name)]: stat(0, 0, 0),
  [norm(C.name)]: stat(0.25, null, 0.06),
  [norm(E.name)]: stat(null, null, null),
  [norm(G.name)]: stat(0.9, 0.8, undefined),
};
const M = { stats };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

/* ---------------------------------------------------------------- 2 ---- */

test("a figure the reports lack is missing, and a measured zero is not", () => {
  assert.equal(attainmentOf(undefined, 0.5), null);
  assert.equal(attainmentOf(null, 0.5), null);
  assert.equal(attainmentOf(0, 0.5), 0, "zero was measured");
  assert.equal(attainmentOf(0.25, 0.5), 0.5);
  assert.equal(attainmentOf(0.5, 0.5), 1);
  assert.equal(attainmentOf(0.9, 0.5), 1, "one runaway number cannot hide a gap");
});

test("a rollup counts the measured and the missing apart, and averages only the measured", () => {
  const roll = newRollup();
  for (const got of [1, 0, 0.5, null, null]) addToRollup(roll, got);
  assert.deepEqual(readRollup(roll), { total: 5, observed: 3, missing: 2, below: 2, mean: 0.5 });
  /* The old arithmetic scored the two missing as 0% and read this as 30% with four
     of five below, which is a statement about the floor that nobody had checked. */
});

test("a measured zero is observed and below, never missing", () => {
  const roll = addToRollup(newRollup(), attainmentOf(0, 0.5));
  assert.deepEqual(readRollup(roll), { total: 1, observed: 1, missing: 0, below: 1, mean: 0 });
  assert.equal(readRollup(roll).mean, 0, "a real zero average, not 'no average'");
});

test("nobody measured is no average, not a zero", () => {
  const roll = newRollup();
  addToRollup(roll, attainmentOf(undefined, 0.5));
  addToRollup(roll, attainmentOf(null, 0.5));
  assert.deepEqual(readRollup(roll), { total: 2, observed: 0, missing: 2, below: 0, mean: null });
  assert.equal(weakestRollup({ apptVideoDayPct: roll }), null, "nothing to rank by, so no weakest standard");
});

test("the weakest standard is chosen among those somebody was measured on", () => {
  const roll = (...gots) => gots.reduce(addToRollup, newRollup());
  const rolls = { empty: roll(null, null), high: roll(1, 1), low: roll(0.4, 0.6), tied: roll(0.4, 0.6) };
  const weakest = weakestRollup(rolls);
  assert.equal(weakest.metric, "low", "the unmeasured standard does not win by averaging nothing");
  assert.equal(weakest.mean, 0.5);
  assert.deepEqual([weakest.total, weakest.observed, weakest.missing, weakest.below], [2, 2, 0, 2], "both measured people are under the bar");
});

test("only a finite number of zero or more is a figure, and zero is one", () => {
  for (const ok of [0, -0, 0.0001, 0.5, 1, 1.5, 250, Number.MAX_VALUE]) assert.equal(isMeasured(ok), true, String(ok));
  for (const bad of [-0.0001, -1, -Infinity, Infinity, NaN, null, undefined, "", "0", "0.4", true, false, {}, [], [0], 1n]) {
    assert.equal(isMeasured(bad), false, `${String(bad)} is not a figure`);
  }
});

test("a figure that cannot be a measurement is unavailable: not a shortfall and not a pass", () => {
  // The report reader lets a negative and an infinite figure through, and arithmetic upstream can make a NaN.
  for (const bad of [-0.2, -1, NaN, Infinity, -Infinity, "0.4", true, {}, 1n]) {
    assert.equal(attainmentOf(bad, 0.5), null, String(bad));
  }
  assert.ok(Object.is(attainmentOf(0, 0.5), 0), "a genuine zero is observed, and it is zero");
  assert.ok(Object.is(attainmentOf(-0, 0.5), 0), "a negative-signed zero is just zero");
  assert.equal(attainmentOf(0.25, 0.5), 0.5);
});

test("a bar that cannot be measured against measures nobody", () => {
  for (const bar of [0, -0.5, NaN, Infinity, -Infinity, undefined, null, "0.5"]) {
    assert.equal(attainmentOf(0.3, bar), null, `bar ${String(bar)}`);
  }
});

test("a rollup counts an invalid attainment as missing, and what it prints is always a real number", () => {
  const roll = newRollup();
  for (const got of [1, NaN, -0.3, Infinity, -Infinity, 0.5, 3, "0.9", null, undefined]) addToRollup(roll, got);
  const read = readRollup(roll);
  assert.deepEqual([read.total, read.observed, read.missing, read.below], [10, 3, 7, 1]);
  assert.equal(read.mean, (1 + 0.5 + 1) / 3, "a 3 is a met bar, capped at 1, and nothing else moves the average");
  for (const v of Object.values(read)) assert.ok(Number.isFinite(v), "no NaN or Infinity in what a hero prints");
});

test("the desk hero: missing figures are counted apart and never scored as underperformance", () => {
  const { metricRoll, weakest, anyMissing, videoDials } = deskHero({ config, roster: [A, B, C, D, E], M });
  const read = (metric) => readRollup(metricRoll[metric]);
  // appt: A clears, B real zero, C at half the bar; D and E have no figure.
  assert.deepEqual(read("apptVideoDayPct"), { total: 5, observed: 3, missing: 2, below: 2, mean: 0.5 });
  // bh: only A and B were measured, and C's missing figure is not a zero.
  assert.deepEqual(read("bhVideoPct"), { total: 5, observed: 2, missing: 3, below: 1, mean: 0.5 });
  const engaged = read("engagedVideoPct");
  assert.deepEqual([engaged.total, engaged.observed, engaged.missing, engaged.below], [5, 3, 2, 2]);
  close(engaged.mean, 0.4);

  assert.equal(weakest.metric, "engagedVideoPct");
  assert.equal(weakest.observed, 3);
  assert.equal(weakest.missing, 2);
  assert.equal(anyMissing, true);

  const dials = Object.fromEntries(videoDials.map((v) => [v.m, v]));
  assert.deepEqual([dials.apptVideoDayPct.observed, dials.apptVideoDayPct.missing, dials.apptVideoDayPct.below], [3, 2, 2]);
  assert.equal(dials.bhVideoPct.mean, 0.5);
});

test("the phone hero reads the same people the same way", () => {
  const dials = Object.fromEntries(phoneDials({ config, roster: [A, B, C, D, E], M }).map((v) => [v.m, v]));
  assert.deepEqual(
    [dials.apptVideoDayPct.total, dials.apptVideoDayPct.observed, dials.apptVideoDayPct.missing, dials.apptVideoDayPct.below, dials.apptVideoDayPct.mean],
    [5, 3, 2, 2, 0.5]);
  assert.deepEqual(
    [dials.bhVideoPct.total, dials.bhVideoPct.observed, dials.bhVideoPct.missing, dials.bhVideoPct.below, dials.bhVideoPct.mean],
    [5, 2, 3, 1, 0.5]);
  close(dials.engagedVideoPct.mean, 0.4);
  assert.equal(dials.apptVideoDayPct.min, 50, "the dial still says what the target is");
});

test("a measured zero stays measured in both heroes", () => {
  const desk = deskHero({ config, roster: [B], M });
  for (const metric of ["apptVideoDayPct", "bhVideoPct", "engagedVideoPct"]) {
    assert.deepEqual(readRollup(desk.metricRoll[metric]), { total: 1, observed: 1, missing: 0, below: 1, mean: 0 });
  }
  assert.equal(desk.weakest.mean, 0);
  assert.equal(desk.weakest.below, 1);
  assert.equal(desk.attN, 1, "a person with measured zeros is in the store average");
  for (const v of phoneDials({ config, roster: [B], M })) {
    assert.equal(v.mean, 0);
    assert.equal(v.observed, 1);
    assert.equal(v.missing, 0);
  }
});

test("when nobody has a figure, neither hero invents one", () => {
  const roster = [D, E];
  const desk = deskHero({ config, roster, M });
  assert.equal(desk.weakest, null, "no weakest standard to name");
  assert.equal(desk.attN, 0, "nobody in the store average");
  for (const v of [...desk.videoDials, ...phoneDials({ config, roster, M })]) {
    assert.equal(v.mean, null, `${v.m} has no average`);
    assert.equal(v.below, 0, `${v.m} has nobody below`);
    assert.equal(v.observed, 0);
    assert.equal(v.missing, 2);
  }
});

test("negative, NaN and infinite figures are unavailable in both heroes, and nothing prints NaN", () => {
  const H = person("Fixture H"); // nothing usable
  const I = person("Fixture I"); // a string, a negative infinity, and one real figure
  const odd = { stats: { ...stats, [norm(H.name)]: stat(-0.2, Infinity, NaN), [norm(I.name)]: stat("0.4", -Infinity, 0.1) } };
  const roster = [A, B, H, I];
  const desk = deskHero({ config, roster, M: odd });
  const read = (metric) => readRollup(desk.metricRoll[metric]);
  // A clears and B is a real zero, so each of these has one person below, measured.
  assert.deepEqual(read("apptVideoDayPct"), { total: 4, observed: 2, missing: 2, below: 1, mean: 0.5 });
  assert.deepEqual(read("bhVideoPct"), { total: 4, observed: 2, missing: 2, below: 1, mean: 0.5 });
  const engaged = read("engagedVideoPct");
  assert.deepEqual([engaged.total, engaged.observed, engaged.missing, engaged.below], [4, 3, 1, 2]);
  close(engaged.mean, (1 + 0 + 0.1 / 0.3) / 3);
  assert.equal(desk.weakest.metric, "engagedVideoPct");
  for (const dials of [desk.videoDials, phoneDials({ config, roster, M: odd })]) {
    for (const v of dials) for (const [k, n] of Object.entries(v)) if (typeof n === "number") assert.ok(Number.isFinite(n), `${v.m}.${k} is a real number`);
  }
  assert.ok(Number.isFinite(desk.attSum) && Number.isFinite(desk.pct), "the store average is a real number too");
});

test("with every figure present the heroes say what they always said", () => {
  // The previous arithmetic, kept here as the oracle: it is right whenever
  // nothing is missing, which is why this correction cannot move a complete floor.
  const F = person("Fixture F");
  const full = { stats: { ...stats, [norm(F.name)]: stat(0.3, 0.2, 0.1) } };
  const roster = [A, B, F];
  const desk = deskHero({ config, roster, M: full });
  for (const [metric, min] of [["apptVideoDayPct", 50], ["bhVideoPct", 40], ["engagedVideoPct", 30]]) {
    let sum = 0, below = 0;
    for (const p of roster) {
      const got = Math.min(1, (full.stats[norm(p.name)][metric] ?? 0) / (min / 100));
      sum += got; if (got < 1) below++;
    }
    const read = readRollup(desk.metricRoll[metric]);
    close(read.mean, sum / roster.length);
    assert.equal(read.below, below);
    assert.equal(read.observed, roster.length);
    assert.equal(read.total, roster.length);
    assert.equal(read.missing, 0);
  }
  assert.equal(desk.anyMissing, false);
});

/* Eligibility and coaching are not what this changes, and these hold it to that. */

test("eligibility is untouched: nothing to judge is no-data, one missing figure is still a shortfall", () => {
  const status = (p) => evaluateAssociate(stats[norm(p.name)], TIERS).status;
  assert.equal(status(A), "pass");
  assert.equal(status(B), "fail", "a measured zero fails");
  assert.equal(status(C), "fail");
  assert.equal(status(D), "no-data", "no stats at all");
  assert.equal(status(E), "no-data", "every required figure absent");

  const partial = evaluateAssociate(stats[norm(G.name)], TIERS);
  assert.equal(partial.status, "fail", "two figures clear and one is missing: still a real shortfall");
  assert.deepEqual(partial.failures.map((f) => [f.metric, f.val]), [["engagedVideoPct", null]]);

  const zeros = evaluateAssociate(stats[norm(B.name)], TIERS);
  assert.deepEqual(zeros.failures.map((f) => f.val), [0, 0, 0], "a measured zero is a value, not an absence");
});

test("the heroes count what eligibility still treats as a shortfall as missing, on purpose", () => {
  // G is restricted by the standard: one required figure is absent. The hero counts
  // that figure as missing, so the dial is not dragged down by a report that has not
  // landed, and the number of people it could not measure is on the dial.
  const desk = deskHero({ config, roster: [G], M });
  assert.deepEqual(readRollup(desk.metricRoll.engagedVideoPct), { total: 1, observed: 0, missing: 1, below: 0, mean: null });
  assert.deepEqual(readRollup(desk.metricRoll.apptVideoDayPct), { total: 1, observed: 1, missing: 0, below: 0, mean: 1 });
});

test("the coaching list is untouched: a missing figure is still the worst shortfall", () => {
  const run = new Function("config", "store", "roster", "isRestricted", "M", "norm", "evaluateAssociate",
    `${urgentSource}; return urgent;`);
  const urgent = run(config, { id: "s1" }, [A, B, G, D], () => false, M, norm, evaluateAssociate);
  assert.deepEqual(urgent.map((u) => u.name).sort(), ["Fixture B", "Fixture G"], "pass and no-data are not on it");
  const g = urgent.find((u) => u.name === "Fixture G");
  assert.equal(g.worst.metric, "engagedVideoPct");
  assert.equal(g.worst.val, null);
  assert.equal(g.worst.ratio, 0, "ranked as the worst, as before");
});

test("neither hero coerces a missing figure to zero any more", () => {
  for (const [where, source] of [["phone hero", phoneSource], ["desk hero", rollSource]]) {
    assert.ok(!/\?\? 0/.test(source), `${where} still reads a missing figure as 0`);
    assert.ok(/attainmentOf\(st\?\.\[/.test(source) && /addToRollup\(/.test(source), `${where} counts through the shared rollup`);
  }
  assert.ok(!/of \{(?:v|weakest)\.total\} below/.test(manager) && !/of \$\{v\.total\} below/.test(manager),
    "no count is still printed against everybody, missing included");
});

test("what a hero prints says how many were not measured", () => {
  assert.ok(/\{v\.missing\} no data/.test(manager), "the phone dial's pop says it");
  assert.ok(/\$\{v\.missing\} no data/.test(manager) && /\$\{weakest\.missing\} no data/.test(manager), "the desk dial and card say it");
  assert.ok(/Everyone measured is on target/.test(manager), "the card does not claim everyone while somebody is missing");
  const dial = cut("function S2Dial(", "\n}\n");
  assert.ok(/ratio == null/.test(dial) && /–/.test(dial), "a dial with no figure is a bare track, not a red 0%");
  assert.ok(/t \? Math\.round\(v\.mean \* 100\) : 0/.test(manager), "the phone ring draws nothing for no figure");
});

/* ------------------------------------------------ the phone's Who is below ---- */

/* The dial says "N of M below" and Who is below opens the board's list. This PR
   does not claim the two always agree, because they do not, and none of it is
   eligibility:

   - Scope. The count covers every role with standards. The list is the board's
     people for the role tab that is showing, narrowed by the search box.
   - The bar. Where a person's tier does not name a standard, the dial judges them
     at the gentlest bar set for it across the tiers; the list falls back to the
     store's threshold for it.
   - BH Video. A row carries five dots: internet, phone, showroom, appt video and
     engaged video. BH Video is not one of them, so the list cannot say who is
     below on it, and it is empty while the dial counts people.

   The second and third are marked todo below, as the gap itself and not as the
   behaviour anybody wants. Fixing either decides which bar and which people the
   list means, which is not a presentation detail, so it is left for a decision. */
const FIVE = new Function(`${cut("const FIVE = [", "\n];")}; return FIVE;`)();
const bpDotState = new Function(`${cut("function bpDotState(", "\n}\n")}; return bpDotState;`)();
const peopleSource = cut("const people = useMemo(() => boardRoster.map((a) => {", "[boardRoster, M, thr, restrictions, strengths]); // eslint-disable-line", phoneAt);
const rowsSource = cut("const rows = useMemo(() => {", "[people, roleFilter, limitOnly, drill, q]);", phoneAt);
const THRESHOLDS = { internet: { green: 20, yellow: 10 }, phone: { green: 25, yellow: 12 }, showroom: { green: 30, yellow: 15 },
  apptVideoDayPct: { green: 60 }, engagedVideoPct: { green: 50 } };

/* Who the phone's list shows after Who is below on this standard, for these people. */
function listedBelow({ config, roster, M, metric, roleFilter = null, query = "" }) {
  const run = new Function("boardRoster", "M", "norm", "evaluateAssociate", "tiersOf", "FIVE", "thr", "bpDotState", "isRestricted",
    "bpFirstTag", "strengths", "unitsOf", "restrictions", "useMemo", "limitOnly", "roleFilter", "drill", "q",
    `${peopleSource}\n${rowsSource}\nreturn rows;`);
  const tiersOf = (roleId) => config.standards.s1[roleId]?.tiers;
  const rows = run(roster, M, norm, evaluateAssociate, tiersOf, FIVE, THRESHOLDS, bpDotState, () => false,
    () => null, {}, () => 0, {}, (fn) => fn(), false, roleFilter, { kind: "below", id: metric }, norm(query));
  return rows.map((p) => p.a.name);
}
const dialFor = (args, metric) => phoneDials(args).find((v) => v.m === metric);

test("Who is below lists the people the dial counts, for a standard on the row's dots that every tier names", () => {
  const args = { config, roster: [A, B, C, D, E, G], M };
  for (const metric of ["apptVideoDayPct", "engagedVideoPct"]) {
    const listed = listedBelow({ ...args, metric });
    assert.deepEqual(listed.sort(), ["Fixture B", "Fixture C"], `${metric}: the measured people under the bar, and nobody who is missing`);
    assert.equal(listed.length, dialFor(args, metric).below, metric);
  }
});

test("Who is below lists nobody for BH Video while the dial counts people", { todo: "pre-existing: a row's five dots do not include BH Video" }, () => {
  const args = { config, roster: [A, B, C, D, E, G], M };
  assert.equal(dialFor(args, "bhVideoPct").below, 1, "the dial counts Fixture B, a measured zero");
  assert.equal(listedBelow({ ...args, metric: "bhVideoPct" }).length, dialFor(args, "bhVideoPct").below);
});

test("Who is below and the dial use the same bar when a person's tier does not name the standard", { todo: "pre-existing: the list falls back to the store threshold, the dial to the gentlest tier bar" }, () => {
  // The lower tier names engaged video only; appt video is asked of the upper tier at 50.
  const tiered = { roles: config.roles, standards: { s1: { sales: { tiers: [
    { cap: 50, requirements: [{ metric: "engagedVideoPct", min: 30 }] },
    { cap: 100, requirements: [{ metric: "apptVideoDayPct", min: 50 }, { metric: "engagedVideoPct", min: 30 }] },
  ] } } } };
  const X = person("Fixture X"); // in the lower tier, at 55% appt video
  const args = { config: tiered, roster: [X], M: { stats: { [norm(X.name)]: stat(0.55, null, 0.4) } } };
  assert.equal(dialFor(args, "apptVideoDayPct").below, 0, "55% clears the gentlest bar, 50%");
  assert.equal(listedBelow({ ...args, metric: "apptVideoDayPct" }).length, 0, "but the list judges 55% against the store threshold, 60%");
});

/* ---------------------------------------------------------------- 1 ---- */

test("the Summary reads the month's own goal on the desk and on the phone", () => {
  const expression = "storeGoalFor(single, month)?.units";
  const deskAt = manager.indexOf("function GMSummary");
  const phoneSummaryAt = manager.indexOf("function SummaryPhone");
  assert.ok(deskAt > 0 && phoneSummaryAt > 0);
  const lines = manager.split("\n").filter((l) => l.includes(`const goalUnits = ${expression};`));
  assert.equal(lines.length, 2, "one in SummaryPhone and one in GMSummary");
  assert.ok(manager.indexOf(`const goalUnits = ${expression};`, phoneSummaryAt) > phoneSummaryAt);
  assert.ok(manager.indexOf(`const goalUnits = ${expression};`, deskAt) > deskAt);
  assert.ok(!/single\??\.goal\??\.units/.test(manager), "the standing figure is not read from the store record");
  assert.ok(/\{goalUnits \? <span className="da-ksub">goal \{fmtNum\(goalUnits\)\}<\/span> : null\}/.test(manager), "desk tile");
  assert.ok(/delivered\{goalUnits \? <><br \/>of \{fmtNum\(goalUnits\)\} goal<\/> : null\}/.test(manager), "phone hero");
});

test("a month with no goal of its own shows no goal, whatever the store record still carries", () => {
  const goalFor = new Function("storeGoalFor", "single", "month", "return storeGoalFor(single, month)?.units;");
  const store = { id: "s1", goal: { units: 120, pct: 85, byMonth: { "2026-09": 95 } } };
  assert.equal(goalFor(storeGoalFor, store, "2026-09"), 95, "the month's own entry");
  assert.equal(goalFor(storeGoalFor, store, "2026-10"), undefined, "October has none, not September's and not the old 120");
  assert.equal(goalFor(storeGoalFor, { id: "s2", goal: { units: 120 } }, "2026-09"), undefined, "a store with only the old figure shows none");
  assert.equal(goalFor(storeGoalFor, null, "2026-09"), undefined, "several stores selected: no single store, no goal");
});

/* ---------------------------------------------------------------- 3 ---- */

test("the Live Floor button that opens Behind the standard says what it counts", () => {
  assert.ok(/`\$\{behindCount\} behind the standard`/.test(manager));
  assert.ok(!/behindCount\} not signed in/.test(manager), "the count is people behind the standard, not people who have not signed in");
  assert.ok(/<h3>Behind the standard<\/h3>/.test(manager), "the panel it opens is still called that");
  assert.ok(/onCount\(people === null \? null : \(people \|\| \[\]\)\.length\)/.test(manager), "the count is still everybody the panel lists");
  assert.ok(/behindCount > 0 && \(/.test(manager), "still shown only when somebody is in it");
  assert.ok(/notSignedIn/.test(manager), "the real not-signed-in attendance wording is left alone");
});

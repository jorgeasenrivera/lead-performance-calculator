/**
 * Every field of a store has to declare how it merges.
 * -------------------------------------------------------------------------
 * Five production faults, one shape: a field whose merge rule nobody had
 * decided, behaving the way the code happened to fall out. The ignore list, the
 * plate log, the roster, the repair tool, and the figures themselves.
 *
 * None of them failed loudly. A field with no rule keeps whichever copy saved
 * last, which looks exactly like working until a manager says the name came
 * back, weeks later.
 *
 * So FIELD_POLICY names the rule for every field, and this is what stops it
 * becoming just another second copy that drifts from the code it describes. It
 * reads the merge's own source and holds the two against each other:
 *
 *   every field the merge assigns must have a row
 *   every row must be a field the merge assigns, or one the importer counts as
 *     part of a store
 *   every row marked clientWins must be a field the merge genuinely leaves alone
 *
 * That last one is what makes the table falsifiable rather than decorative: a
 * row claiming a field is unmerged fails the moment somebody merges it, and a
 * row claiming a rule fails the moment the rule is taken away.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_POLICY, STRATEGIES, DEAD_FIELDS } from "../api/_store-merge.mjs";
import { mergeAgainstServer } from "../api/_store-merge.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MERGE = fs.readFileSync(path.join(ROOT, "api/_store-merge.mjs"), "utf8");
const INGEST = fs.readFileSync(path.join(ROOT, "api/ingest.mjs"), "utf8");

/* What the merge actually writes. Taken from the body of mergeAgainstServer so
   that the helpers above it, which assign to their own locals, do not count. */
const mergeBody = MERGE.slice(MERGE.indexOf("export function mergeAgainstServer"));
const ASSIGNED = new Set(
  [...mergeBody.matchAll(/next\.([a-zA-Z][a-zA-Z0-9]*)\s*=(?!=)/g)].map((m) => m[1]));

/* What the importer counts as part of a store: the snapshot it takes before
   writing. An independent list, kept for its own reasons by different code, and
   the disagreement between the two is exactly where the gaps live. */
const snap = INGEST.slice(INGEST.indexOf("const snapCopy"), INGEST.indexOf("}));", INGEST.indexOf("const snapCopy")));
const SNAPSHOT = new Set([...snap.matchAll(/([a-zA-Z][a-zA-Z0-9]*):/g)].map((m) => m[1]));

test("the two lists this is built on are really there", () => {
  // If either of these ever comes back empty the checks below all pass vacuously.
  assert.ok(ASSIGNED.size > 10, `only found ${ASSIGNED.size} assigned fields; the merge has moved`);
  assert.ok(SNAPSHOT.size > 10, `only found ${SNAPSHOT.size} snapshot fields; the importer has moved`);
});

test("every field the merge writes has a declared rule", () => {
  const missing = [...ASSIGNED].filter((f) => !FIELD_POLICY[f]).sort();
  assert.deepEqual(missing, [],
    "merged with no rule in FIELD_POLICY — decide what it does before it ships");
});

test("every field the importer counts as part of a store has one too", () => {
  const missing = [...SNAPSHOT].filter((f) => !FIELD_POLICY[f]).sort();
  assert.deepEqual(missing, [],
    "part of a store, and nothing says what happens when two copies of it meet");
});

test("no rule describes a field that does not exist", () => {
  const orphan = Object.keys(FIELD_POLICY).filter((f) => !ASSIGNED.has(f) && !SNAPSHOT.has(f)).sort();
  assert.deepEqual(orphan, [], "a rule for a field nothing writes; delete the row");
});

test("every rule names a strategy that exists", () => {
  const bad = Object.entries(FIELD_POLICY)
    .filter(([, v]) => !STRATEGIES[v.how]).map(([f, v]) => `${f}: ${v.how}`);
  assert.deepEqual(bad, []);
});

test("every rule says why, so the next person inherits the reasoning", () => {
  const bare = Object.entries(FIELD_POLICY).filter(([, v]) => !v.why || v.why.length < 20).map(([f]) => f);
  assert.deepEqual(bare, []);
});

/* The one rule that means "the merge does not touch this", and it is an
   admission rather than a decision: the field has no rule yet. There are none
   left. A field that turned out to have no purpose is deleted now rather than
   given a rule for its own sake — see DEAD_FIELDS. */
const UNMERGED = new Set(["clientWins"]);

/* ---- the check that makes the table falsifiable ---- */
test("a field claiming to be unmerged is really unmerged", () => {
  const lying = Object.entries(FIELD_POLICY)
    .filter(([f, v]) => UNMERGED.has(v.how) && ASSIGNED.has(f)).map(([f]) => f);
  assert.deepEqual(lying, [],
    "the merge writes this, so clientWins is wrong; give it the rule it actually has");
});

test("and a field claiming a rule is really merged", () => {
  const lying = Object.entries(FIELD_POLICY)
    .filter(([f, v]) => !UNMERGED.has(v.how) && !ASSIGNED.has(f)).map(([f]) => f);
  assert.deepEqual(lying, [],
    "declares a rule the merge does not carry out; either merge it or mark it clientWins");
});

/* ---- nothing is left unmerged at all ---- */
test("no field of a store is left for the last writer to win", () => {
  const unmerged = Object.entries(FIELD_POLICY)
    .filter(([, v]) => UNMERGED.has(v.how)).map(([f]) => f).sort();
  assert.deepEqual(unmerged, [],
    "a field a second manager can silently lose their work on, with no error and nothing in the log");
  /* The seven that used to be gaps are closed, so nothing should still be
     claiming to be one. A gap left marked after the work was done would put the
     next person off looking. */
  const stillMarked = Object.entries(FIELD_POLICY).filter(([, v]) => v.gap).map(([f]) => f);
  assert.deepEqual(stillMarked, [], "marked as a gap but no longer one");
});

test("a field that was deleted is not quietly still around", () => {
  /* Deleting beats merging for something nothing reads, but only if it is really
     gone: a dead field with a policy row, or one the merge still writes, is a
     field that was never actually removed. */
  for (const f of DEAD_FIELDS) {
    assert.ok(!FIELD_POLICY[f], `${f} is deleted but still has a merge rule`);
    assert.ok(!ASSIGNED.has(f), `${f} is deleted but the merge still writes it`);
    assert.ok(!SNAPSHOT.has(f), `${f} is deleted but the importer still snapshots it`);
    const APP = fs.readFileSync(path.join(ROOT, "src/LeadPerformanceCalculator.jsx"), "utf8") + fs.readFileSync(path.join(ROOT, "src/Manager.jsx"), "utf8");
    assert.ok(!APP.includes(f), `${f} is deleted but the app still carries it around`);
  }
});

test("the app actually writes the stamps these rules are settled by", () => {
  /* The rule and the writer are in different files, and a stamped rule with
     nothing writing the stamp is worse than no rule at all: it reads as decided
     and behaves as last-writer-wins, which is the state all seven of these were
     already in. So the two are held together here.

     Each entry is the field, and a line the app must contain to be writing its
     stamp. Deliberately the assignment itself rather than a loose mention, so
     that a stamp being read somewhere does not count as one being written. */
  const APP = fs.readFileSync(path.join(ROOT, "src/LeadPerformanceCalculator.jsx"), "utf8") + fs.readFileSync(path.join(ROOT, "src/Manager.jsx"), "utf8");
  const writers = [
    ["restrictions", "next.restrictionsAt[assoc.id] ="],
    ["goals", "next.goalsAt[a.id] ="],
    ["baselines", "next.baselinesAt[a.id] ="],
    ["qualified", "next.qualifiedAt[day][k] ="],
    ["statsExcluded", "next.statsExcludedAt[norm(a.name)] ="],
    ["statsExcluded (put back)", "next.statsExcludedGone[norm(a.name)] ="],
  ];
  const missing = writers.filter(([, line]) => !APP.includes(line)).map(([f]) => f);
  assert.deepEqual(missing, [],
    "the merge settles this by a stamp the app never writes, so it silently stays last-writer-wins");
});

test("every stamped field has the stamps it is settled by", () => {
  /* A rule of stampedMap with nothing writing the stamps is worse than no rule:
     it reads as decided and behaves as last-writer-wins. */
  for (const [f, v] of Object.entries(FIELD_POLICY)) {
    if (v.how !== "stampedMap" || f.endsWith("At")) continue;
    assert.ok(FIELD_POLICY[f + "At"], `${f} is settled by stamps but ${f}At has no rule`);
    assert.ok(ASSIGNED.has(f + "At"), `${f}At is never written by the merge`);
  }
});

test("Summary observation preservation is declared and found by the existing assignment guard", () => {
  assert.ok(ASSIGNED.has("deliverySummaryObservations"));
  assert.equal(FIELD_POLICY.deliverySummaryObservations?.how, "serverCopyOnly");
  assert.ok(STRATEGIES.serverCopyOnly);
});

test("ordinary stale saves keep the current complete Summary observations", () => {
  const current = { "2026-11": { fictionalA: { count: 12, sentAt: null }, fictionalB: { count: 11, sentAt: null } } };
  const old = { "2026-11": { fictionalA: { count: 9, sentAt: null } } };
  const server = { __storeId: "fictional", months: {}, deliverySummaryObservations: current };
  for (const baselineAware of [false, true]) {
    for (const change of ["omitted", "replaced", "deleted"]) {
      const baseline = { __storeId: "fictional", months: {} };
      const client = { __storeId: "fictional", months: {} };
      if (change !== "omitted") baseline.deliverySummaryObservations = structuredClone(old);
      if (change === "replaced") client.deliverySummaryObservations = { "2026-11": { invented: { count: 99 } } };
      const result = mergeAgainstServer(client, server, baselineAware ? { baseline } : undefined);
      assert.deepEqual(result.deliverySummaryObservations, current, `${change}, baseline ${baselineAware}`);
      assert.notStrictEqual(result.deliverySummaryObservations, current);
      result.deliverySummaryObservations["2026-11"].fictionalA.count = 100;
      assert.equal(current["2026-11"].fictionalA.count, 12, "the result must not mutate the read server observation");
    }
  }
});

test("current server absence and explicit null cannot be replaced by client observations", () => {
  for (const baselineAware of [false, true]) {
    const baseline = { __storeId: "fictional", months: {} };
    const client = { __storeId: "fictional", months: {}, deliverySummaryObservations: { invented: true } };
    const server = { __storeId: "fictional", months: {} };
    const intent = baselineAware ? { baseline } : undefined;
    const absent = mergeAgainstServer(structuredClone(client), server, intent);
    assert.equal(Object.hasOwn(absent, "deliverySummaryObservations"), false);
    const explicitNull = mergeAgainstServer(structuredClone(client), { ...server, deliverySummaryObservations: null }, intent);
    assert.equal(Object.hasOwn(explicitNull, "deliverySummaryObservations"), true);
    assert.equal(explicitNull.deliverySummaryObservations, null);
    const inherited = Object.assign(Object.create({ deliverySummaryObservations: { inherited: true } }), server);
    assert.equal(Object.hasOwn(mergeAgainstServer(structuredClone(client), inherited, intent), "deliverySummaryObservations"), false);
  }
});

test("first creation strips client observations before the absent-server return", () => {
  for (const server of [undefined, null]) {
    for (const intent of [undefined, { baseline: null, rowAbsentAtLoad: true }]) {
      const client = { __storeId: "fictional", months: {}, deliverySummaryObservations: { invented: true } };
      const result = mergeAgainstServer(client, server, intent);
      assert.equal(Object.hasOwn(result, "deliverySummaryObservations"), false);
      assert.deepEqual(result.months, {});
    }
  }
});

test("explicit cross-store mismatch copies neither server nor client observations", () => {
  const server = { __storeId: "other", deliverySummaryObservations: { privateToOtherStore: true } };
  const result = mergeAgainstServer({ __storeId: "fictional", deliverySummaryObservations: { invented: true } }, server);
  assert.equal(result.__storeId, "fictional");
  assert.equal(Object.hasOwn(result, "deliverySummaryObservations"), false);
  assert.deepEqual(server.deliverySummaryObservations, { privateToOtherStore: true });
});

test("each retry preserves the newly read observations or their disappearance", () => {
  const baseline = { __storeId: "fictional", months: {} };
  const client = { ...structuredClone(baseline), deliverySummaryObservations: { invented: true } };
  const earlier = { "2026-11": { fictionalA: { count: 12 } } };
  const newer = { "2026-11": { fictionalB: { count: 10 } } };
  const first = mergeAgainstServer(client, { ...baseline, deliverySummaryObservations: earlier }, { baseline });
  assert.deepEqual(first.deliverySummaryObservations, earlier);
  const retry = mergeAgainstServer(first, { ...baseline, deliverySummaryObservations: newer }, { baseline });
  assert.deepEqual(retry.deliverySummaryObservations, newer, "copy the whole newly read value without union or count-based selection");
  const gone = mergeAgainstServer(retry, { ...baseline }, { baseline });
  assert.equal(Object.hasOwn(gone, "deliverySummaryObservations"), false);
});

test("a missing store identifier still relies on the caller reading the same store", () => {
  const observations = { "2026-11": { fictionalA: { count: 12 } } };
  for (const [client, server] of [
    [{ __storeId: "fictional" }, {}],
    [{}, { __storeId: "fictional" }],
    [{}, {}],
  ]) {
    const result = mergeAgainstServer(client, { ...server, deliverySummaryObservations: observations });
    assert.deepEqual(result.deliverySummaryObservations, observations);
  }
});

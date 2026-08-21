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
import { FIELD_POLICY, STRATEGIES } from "../api/_store-merge.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
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

/* ---- the check that makes the table falsifiable ---- */
test("a field claiming to be unmerged is really unmerged", () => {
  const lying = Object.entries(FIELD_POLICY)
    .filter(([f, v]) => v.how === "clientWins" && ASSIGNED.has(f)).map(([f]) => f);
  assert.deepEqual(lying, [],
    "the merge writes this, so clientWins is wrong; give it the rule it actually has");
});

test("and a field claiming a rule is really merged", () => {
  const lying = Object.entries(FIELD_POLICY)
    .filter(([f, v]) => v.how !== "clientWins" && !ASSIGNED.has(f)).map(([f]) => f);
  assert.deepEqual(lying, [],
    "declares a rule the merge does not carry out; either merge it or mark it clientWins");
});

/* ---- the gaps, counted, so they can only go down on purpose ---- */
test("the unmerged fields are the seven known ones and no more", () => {
  const gaps = Object.entries(FIELD_POLICY).filter(([, v]) => v.gap).map(([f]) => f).sort();
  assert.deepEqual(gaps,
    ["baselines", "goals", "qualified", "repeatFlags", "restrictions", "stars", "statsExcluded"],
    "the list of fields a second manager can silently lose their work on has changed");
  /* Marked and unmerged have to mean the same thing, or a gap could be quietly
     closed in the table without being closed in the code. */
  for (const [f, v] of Object.entries(FIELD_POLICY)) {
    assert.equal(!!v.gap, v.how === "clientWins", `${f}: gap and clientWins must agree`);
  }
});

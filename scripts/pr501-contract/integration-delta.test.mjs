// Focused, fabricated tests for integration-delta.mjs. No Git, no network, no large trees: Maps and strings only.
// Run: node --test scripts/pr501-contract/integration-delta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIntegrationDelta, evaluateIntegrationDelta, SCHEMA } from "./integration-delta.mjs";

const B = (c) => c.repeat(40), S = (c) => c.repeat(64);
const WF = ".github/workflows/manager-spacing.yml", CONTRACT = "scripts/pr501-contract/";
const mk = (o = {}) => JSON.stringify({ schema: SCHEMA, status: "FINAL", existing: [{ path: "scripts/a.mjs", oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100644", newSha256: S("1") }], new: [{ path: "test/new.test.mjs", mode: "100644", sha256: S("2") }], ...o });
const base = () => {
  const composed = new Map([["scripts/a.mjs", { mode: "100644", blob: B("a") }], ["src/core.jsx", { mode: "100644", blob: B("c") }], ["api/row.mjs", { mode: "100644", blob: B("d") }], [WF, { mode: "100644", blob: B("e") }], ["vercel.json", { mode: "100644", blob: B("f") }]]);
  const head = new Map(composed);
  head.set("scripts/a.mjs", { mode: "100644", blob: B("9") });
  head.set("test/new.test.mjs", { mode: "100644", blob: B("8") });
  head.set(WF, { mode: "100644", blob: B("7") });
  head.set(`${CONTRACT}DELTA.sha256`, { mode: "100644", blob: B("6") });
  const sums = { "scripts/a.mjs": S("1"), "test/new.test.mjs": S("2") };
  return { composed, head, sums };
};
const run = (text, mut = (x) => x, extraDeclared = []) => {
  const { composed, head, sums } = mut(base());
  const p = parseIntegrationDelta(text);
  return evaluateIntegrationDelta({ delta: p.delta, pending: p.pending, composed, head, declared: new Set([`${CONTRACT}DELTA.sha256`, ...extraDeclared]), special: new Set([WF]),
    forbidden: { paths: new Set(["src/core.jsx", "api/row.mjs", "vercel.json", "scripts/search-runtime.sha256"]), prefixes: [CONTRACT] }, headSha256: (x) => sums[x] ?? null });
};
const bad = (r, frag) => { assert.equal(r.ok, false); assert.ok(r.violations.some((x) => x.includes(frag)), `${frag} not in ${JSON.stringify(r.violations)}`); };

test("T01 exact map passes", () => assert.deepEqual(run(mk()).violations, []));
test("T02 PENDING is parsed but never accepted", () => { const r = run(mk({ status: "PENDING" })); bad(r, "PENDING"); });
test("T03 PENDING placeholder hash is rejected in a FINAL map", () => assert.ok(parseIntegrationDelta(mk({ existing: [{ path: "scripts/a.mjs", oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100644", newSha256: "PENDING" }] })).errors.length));
test("T04 unknown or missing keys are rejected", () => {
  assert.ok(parseIntegrationDelta(mk({ extra: 1 })).errors.length);
  assert.ok(parseIntegrationDelta(mk({ existing: [{ path: "scripts/a.mjs", oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100644", newSha256: S("1"), allow: "*" }] })).errors.length);
  assert.ok(parseIntegrationDelta(mk({ new: [{ path: "x.mjs", mode: "100644" }] })).errors.length);
});
test("T05 wildcards, prefixes, traversal, absolute and directory paths are rejected", () => {
  for (const p of ["scripts/*", "scripts/**/a.mjs", "scripts/", "/etc/x", "../x", "a/../b", "a//b", "a/{b,c}", "a/[b]", ""]) assert.ok(parseIntegrationDelta(mk({ new: [{ path: p, mode: "100644", sha256: S("2") }] })).errors.length, p);
});
test("T06 bad modes, short or uppercase hashes, symlink mode are rejected", () => {
  assert.ok(parseIntegrationDelta(mk({ new: [{ path: "x.mjs", mode: "120000", sha256: S("2") }] })).errors.length);
  assert.ok(parseIntegrationDelta(mk({ new: [{ path: "x.mjs", mode: "100644", sha256: S("a").toUpperCase() }] })).errors.length);
  assert.ok(parseIntegrationDelta(mk({ existing: [{ path: "scripts/a.mjs", oldGitMode: "100644", oldGitBlob: "abc", newGitMode: "100644", newSha256: S("1") }] })).errors.length);
});
test("T07 duplicate path, in one list or across both, is rejected", () => {
  assert.ok(parseIntegrationDelta(mk({ new: [{ path: "scripts/a.mjs", mode: "100644", sha256: S("2") }] })).errors.length);
  assert.ok(parseIntegrationDelta(mk({ new: [{ path: "x.mjs", mode: "100644", sha256: S("2") }, { path: "x.mjs", mode: "100644", sha256: S("2") }] })).errors.length);
});
test("T08 old entry must equal the composed baseline", () => bad(run(mk(), (c) => (c.composed.set("scripts/a.mjs", { mode: "100644", blob: B("b") }), c)), "is not the declared old"));
test("T09 head bytes must equal the declared new sha256", () => bad(run(mk(), (c) => (c.sums["scripts/a.mjs"] = S("3"), c)), "not the declared new sha256"));
test("T10 head mode must equal the declared new mode", () => bad(run(mk(), (c) => (c.head.set("scripts/a.mjs", { mode: "100755", blob: B("9") }), c)), "head mode"));
test("T11 no-op transition is rejected", () => bad(run(mk(), (c) => (c.head.set("scripts/a.mjs", { mode: "100644", blob: B("a") }), c)), "no-op"));
test("T12 an unlisted composed path that changed in head is rejected", () => bad(run(mk(), (c) => (c.head.set("src/core.jsx", { mode: "100644", blob: B("0") }), c)), "unlisted composed path differs"));
test("T13 an unlisted composed path removed in head is rejected", () => bad(run(mk(), (c) => (c.head.delete("api/row.mjs"), c)), "missing in head"));
test("T14 an extra head path that nothing declares is rejected", () => bad(run(mk(), (c) => (c.head.set("extra.txt", { mode: "100644", blob: B("5") }), c)), "undeclared addition"));
test("T15 a protected composed path listed as new is rejected as forbidden AND as already existing", () => { const r = run(mk({ new: [{ path: "api/row.mjs", mode: "100644", sha256: S("2") }] })); bad(r, "forbidden path cannot be added"); bad(r, "already exists in the composed tree"); });
test("T16 forbidden transitions: row, pin, vercel, original manifest, contract tooling, workflow", () => {
  for (const p of ["src/core.jsx", "api/row.mjs", "vercel.json", `${CONTRACT}ci-verify.mjs`, WF]) {
    const r = run(mk({ existing: [{ path: p, oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100644", newSha256: S("1") }] }));
    bad(r, "forbidden");
  }
  bad(run(mk({ new: [{ path: "scripts/search-runtime.sha256", mode: "100644", sha256: S("2") }] })), "forbidden");
});
test("T17 mode-only change is a real transition only with a declared mode, and still needs matching bytes", () => {
  const t = mk({ existing: [{ path: "scripts/a.mjs", oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100755", newSha256: S("1") }] });
  assert.deepEqual(run(t, (c) => (c.head.set("scripts/a.mjs", { mode: "100755", blob: B("9") }), c)).violations, []);
  bad(run(t), "head mode");
});
test("T18 declared tooling path shadowing a composed path, or with a non-regular mode, is rejected", () => {
  bad(run(mk(), (c) => (c.composed.set(`${CONTRACT}DELTA.sha256`, { mode: "100644", blob: B("1") }), c)), "shadows");
  bad(run(mk(), (c) => (c.head.set(`${CONTRACT}DELTA.sha256`, { mode: "100755", blob: B("6") }), c)), "mode");
});
test("T19 a protected tooling path in the map is rejected as forbidden AND as owned by the tooling declaration", () => { const r = run(mk({ new: [{ path: `${CONTRACT}DELTA.sha256`, mode: "100644", sha256: S("2") }] })); bad(r, "forbidden path cannot be added"); bad(r, "also owned by the tooling declaration"); });
test("T20 an empty FINAL map passes only when head equals composed plus tooling", () => {
  const empty = mk({ existing: [], new: [] });
  assert.deepEqual(run(empty, (c) => { c.head.set("scripts/a.mjs", c.composed.get("scripts/a.mjs")); c.head.delete("test/new.test.mjs"); return c; }).violations, []);
  bad(run(empty), "unlisted composed path differs");
});
test("T21 the workflow is left to its own old-blob plus template check: a map entry for it is refused, its head change is not judged here", () => {
  assert.deepEqual(run(mk(), (c) => (c.head.set(WF, { mode: "100644", blob: B("4") }), c)).violations, []);
});

test("T23 a NON-protected existing composed path declared as new is rejected with the specific already-exists error only", () => {
  const r = run(mk({ new: [{ path: "scripts/a.mjs", mode: "100644", sha256: S("1") }], existing: [] }));
  bad(r, "scripts/a.mjs: new path already exists in the composed tree");
  assert.ok(!r.violations.some((x) => x.includes("forbidden")), JSON.stringify(r.violations));
});
test("T24 a NON-protected declared-tooling path also in the map is rejected with the specific overlap error only", () => {
  const withTool = (c) => (c.head.set("tools/x.mjs", { mode: "100644", blob: B("5") }), c.sums["tools/x.mjs"] = S("4"), c);
  const asNew = run(mk({ new: [{ path: "tools/x.mjs", mode: "100644", sha256: S("4") }] }), withTool, ["tools/x.mjs"]);
  bad(asNew, "tools/x.mjs: also owned by the tooling declaration");
  assert.ok(!asNew.violations.some((x) => x.includes("forbidden")), JSON.stringify(asNew.violations));
  const clean = run(mk(), withTool, ["tools/x.mjs"]);
  assert.deepEqual(clean.violations, []);
});
test("T25 a NON-protected declared-tooling path that is also an existing transition is rejected with the specific overlap error", () => {
  const c = (x) => (x.composed.set("tools/y.mjs", { mode: "100644", blob: B("a") }), x.head.set("tools/y.mjs", { mode: "100644", blob: B("9") }), x.sums["tools/y.mjs"] = S("1"), x);
  const r = run(mk({ existing: [{ path: "tools/y.mjs", oldGitMode: "100644", oldGitBlob: B("a"), newGitMode: "100644", newSha256: S("1") }] }), c, ["tools/y.mjs"]);
  bad(r, "tools/y.mjs: also owned by the tooling declaration");
  assert.ok(!r.violations.some((x) => x.includes("forbidden path cannot")), JSON.stringify(r.violations));
});

const here = path.dirname(fileURLToPath(import.meta.url));
test("T22 the shipped integration-delta.json parses, and while PENDING it is refused", () => {
  const p = parseIntegrationDelta(fs.readFileSync(path.join(here, "integration-delta.json"), "utf8"));
  assert.deepEqual(p.errors, []);
  if (p.pending) bad(evaluateIntegrationDelta({ delta: p.delta, pending: p.pending, composed: new Map(), head: new Map(), declared: new Set(), special: new Set(), forbidden: { paths: new Set(), prefixes: [] }, headSha256: () => null }), "PENDING");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createSchedulerPostgres, SCHEDULER_POSTGRES_RPC_CAPABILITY } from "../api/_scheduler-postgres.mjs";
import { createSchedulerBoundary } from "../api/_scheduler-store.mjs";
import { createSchedulerContract } from "../api/_scheduler-contract.mjs";

const clone = structuredClone;
const scope = { storeId: "fixture-east", month: "2026-10" };
const actor = { id: "fictional-manager" };
const authority = (action = "save", readKind = null) => ({ actorId: actor.id, action, ...scope, readKind });
const key = JSON.stringify([actor.id, scope.storeId, scope.month, "synthetic-request"]);
const fingerprint = "a".repeat(64);
const empty = () => ({ scope: clone(scope), head: null, draftText: null, publishedText: null, prevAuditHash: null, auditRevision: 0 });
const hash = (v) => createHash("sha256").update(v).digest("hex");
const code = (wanted) => (e) => e?.code === wanted && e.message === wanted;
const draft = () => ({ ...scope, store: {
  timezone: "America/New_York", people: [{ id: "person-a", name: "Fictional Person", start: 9, end: 17, off: [], maxHours: 40 }],
  rules: [{ effective: "2014-01-01", open: 9, close: 17, minimum: 1, capacity: 8, useCapacity: false, closedDays: [0], holidays: {} }],
  teams: [{ id: "team-a", name: "Fictional Team" }],
  memberships: [{ storeId: scope.storeId, personId: "person-a", teamIds: ["team-a"], from: "2014-01-01", to: "2100-12-31", unknown: false }],
}, overrides: {} });

// Default fixtures describe the port protocol, not C113 checksums or SQL.
let c113 = {
  validStoreId: (v) => typeof v === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),
  validMonth: (v) => typeof v === "string" && /^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$/.test(v) && v >= "2014-01" && v <= "2100-12",
  validRev: (v, min = 1) => Number.isSafeInteger(v) && v >= min,
  deserializeVersion: (text, expected) => {
    try { const v = JSON.parse(text); return { ok: Object.entries(expected).every(([k, value]) => v[k] === value),
      kind: v.kind, storeId: v.storeId, month: v.month, rev: v.rev, draft: v.payload, hash: v.hash.value }; }
    catch { return { ok: false }; }
  },
  verifyEntry: (entry) => ({ ok: entry?.entryVersion === 1 && typeof entry.hash === "string" }),
  adjacentMonths: () => ({ prev: "2026-09", next: "2026-11" }), validateDraft: () => ({ ok: true }),
  persistable: v => v, canonicalize: v => ({ ok: true, text: JSON.stringify(v) }),
  planDraftSave: () => { throw new Error("read-only fixture"); }, planPublication: () => { throw new Error("publication forbidden"); },
};
const artifactMode = process.env.SCHEDULER_POSTGRES_ARTIFACTS || "ports";
const artifactCheck = process.env.SCHEDULER_POSTGRES_VERIFY_ARTIFACTS;
const sqlMode = process.env.SCHEDULER_POSTGRES_MODE || "ports";
if (!["ports", "local"].includes(sqlMode)) throw new Error("Unknown SQL mode");
if (sqlMode === "local" && artifactMode !== "original-r1") throw new Error("Real SQL composition requires pinned original-r1 artifacts; no fallback");
if (sqlMode === "local" && artifactCheck !== undefined) throw new Error("Artifact-only preflight cannot claim SQL execution");
if (artifactCheck !== undefined && artifactCheck !== "1") throw new Error("Unknown artifact-check mode");
if (artifactCheck === "1" && artifactMode !== "original-r1") throw new Error("Artifact preflight requires original-r1");
if (!["ports", "original-r1"].includes(artifactMode)) throw new Error("Unknown artifact mode");
if (artifactMode === "original-r1") {
  const root = process.env.SCHEDULER_C113_ROOT, archive = process.env.SCHEDULER_C113_ARCHIVE;
  if (!root || !archive || !path.isAbsolute(root) || !path.isAbsolute(archive)) throw new Error("Absolute original C113 paths are required; no fallback");
  assert.equal(fs.statSync(archive).size, 59973, "Original archive byte count");
  assert.equal(hash(fs.readFileSync(archive)), "909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622");
  const pins = {
    "audit-entry.mjs": "4955fe594bb3736c0525f3c9975dfd43f53b4bc14394b6ced1a9dd0cc1b06300",
    "cas.mjs": "35de09c8e30a22272b61c051d45464fae5be0c076f1b30fe7fba7484d40929e6",
    "deserialize.mjs": "2d7a0c11148bbb90317805f750e792e5ae427a8eeafe4a26ba0ce985c1126ac8",
    "envelope.mjs": "c7df30414b4a37190c5bbf1e160cee877eefffb4fc54cdba4a4ea10c09a141e9",
    "identity.mjs": "2c5839019f28c8675d8f8e23e8d8eca5f0d72fcf41c40fa5e6a49a56b0accd1e",
    "publish-plan.mjs": "fbe774b576f3661c8b5db56d5be46a71a4929e4816827bc9fdad49e98695a0ba",
    "serialize.mjs": "5867e828fedf730c79b62d218af8ca8da3c3827f28e9b109cb142c3d04a55905",
    "validate.mjs": "bbdc8c822079691649c7cf5a7bfb364b2ab82ea85e3d8ce34827be1e6170e7ad",
  };
  const dir = path.join(root, "scripts/scheduler-performance/persistence");
  for (const [name, expected] of Object.entries(pins)) assert.equal(hash(fs.readFileSync(path.join(dir, name))), expected, name);
  c113 = Object.assign({}, ...await Promise.all(Object.keys(pins).map((name) => import(pathToFileURL(path.join(dir, name))))));
}
console.info(`scheduler Postgres adapter: ${artifactMode}; real SQL only in explicit local runner mode`);
if (artifactCheck === "1") console.info("PINNED_C113_ARTIFACTS_VERIFIED: no SQL executed");

if (artifactCheck !== "1") {

function makePlan(snapshot = empty()) {
  const head = snapshot.head || { draftRev: 0, publishedRev: 0 }, rev = head.draftRev + 1;
  if (artifactMode === "original-r1") {
    const p = c113.planDraftSave({ ...scope, head: snapshot.head, baseRev: head.draftRev, draft: draft(), actor,
      at: "2026-10-19T06:00:00.000Z", prevAuditHash: snapshot.prevAuditHash });
    assert.equal(p.ok, true, JSON.stringify(p)); return p.plan;
  }
  const text = JSON.stringify({ format: "sage.scheduler.version", version: 1, ...scope, kind: "draft", rev,
    meta: {}, payload: draft(), hash: { alg: "fixture", value: "0".repeat(16) } });
  const entry = { entryVersion: 1, action: "draft-save", ...scope, actor: clone(actor), at: "2026-10-19T06:00:00.000Z",
    fromRev: head.draftRev, toRev: rev, subject: { kind: "draft", rev, digest: "0".repeat(16) },
    detail: {}, prevHash: snapshot.prevAuditHash, hash: rev.toString(16).padStart(16, "0") };
  return { kind: "draft-save", ...scope, atomic: true, authorization: "not-checked",
    ops: [{ op: "put-version", kind: "draft", ...scope, expectedRev: head.draftRev, rev, text },
      { op: "append-audit", ...scope, entry }], auditEntry: entry,
    resultingHead: { draftRev: rev, publishedRev: head.publishedRev } };
}
const makeReceipt = (plan = makePlan(), id = key, fp = fingerprint) => ({ key: id, fingerprint: fp, result: { head: clone(plan.resultingHead) } });
function double({ snapshot = empty(), receipt = null, commit, rpc } = {}) {
  const calls = [];
  const transport = { capabilities: { [SCHEDULER_POSTGRES_RPC_CAPABILITY]: true }, rpc: async (name, args) => {
    calls.push({ name, args: clone(args) });
    if (rpc) return rpc(name, args);
    return { error: null, data: name === "scheduler_snapshot" ? clone({ snapshot, receipt }) :
      commit ? await commit(args) : { result: clone(args.p_receipt.result), replayed: receipt !== null } };
  } };
  const port = (a = authority()) => createSchedulerPostgres({ transport, authority: a, c113 });
  return { calls, transport, port };
}
async function stage(port, { id = key, fp = fingerprint, transform = (p) => p, beforeCommit } = {}) {
  return port.transaction(scope, async (tx) => {
    const receipt = await tx.getReceipt(id);
    if (receipt) {
      if (receipt.fingerprint !== fp) throw Object.assign(new Error("idempotency-conflict"), { code: "idempotency-conflict" });
      return { result: receipt.result, replayed: true };
    }
    const snapshot = await tx.snapshot(), plan = transform(makePlan(snapshot));
    assert.equal(await tx.apply(plan), true);
    const next = makeReceipt(plan, id, fp);
    assert.equal(await tx.putReceipt(next), true);
    if (beforeCommit) await beforeCommit(tx);
    return { result: next.result, replayed: false };
  });
}

test("factory fails closed without trusted ports/authority; publish makes no RPC", () => {
  assert.throws(() => createSchedulerPostgres(), code("storage-not-configured"));
  const f = double();
  for (const a of [authority("publish"), authority(null), { ...authority(), actorId: "" }, { ...authority(), readKind: "draft" }]) {
    assert.throws(() => f.port(a), code("forbidden"));
  }
  assert.equal(f.calls.length, 0);
});
test("authority binds exact actor, action, scope and read projection", async () => {
  const f = double(), port = f.port(authority("read", "published"));
  const request = { op: "read", ...scope, input: { kind: "published" } };
  assert.equal(port.authorize({ actor, request }), true);
  for (const r of [{ ...request, op: "save" }, { ...request, month: "2026-11" }, { ...request, storeId: "fixture-west" },
    { ...request, input: { kind: "draft" } }]) assert.equal(port.authorize({ actor, request: r }), false);
  assert.equal(port.authorize({ actor: { id: "another-person" }, request }), false);
  await assert.rejects(port.transaction(scope, () => {}), code("forbidden"));
  await assert.rejects(port.read({ ...scope, storeId: "fixture-west" }), code("forbidden"));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await port.read(scope), empty());
  await assert.rejects(port.read(scope), code("forbidden"));
});
test("save stages unchanged original-shaped plan and returns only committed result", async () => {
  const f = double(), plan = makePlan(), before = clone(plan);
  assert.deepEqual(await stage(f.port(), { transform: () => plan }), { result: { head: plan.resultingHead }, replayed: false });
  assert.deepEqual(plan, before);
  assert.deepEqual(f.calls.map((x) => x.name), ["scheduler_snapshot", "scheduler_commit"]);
  assert.deepEqual(f.calls[1].args.p_plan, plan);
  assert.deepEqual(f.calls[1].args.p_expected, { head: null, prevAuditHash: null, auditRevision: 0 });
  assert.equal(Object.hasOwn(f.calls[0].args, "contextTransaction"), false);
});
test("concurrent winner replaces speculative response with database receipt", async () => {
  const committed = { result: { head: { draftRev: 7, publishedRev: 2 } }, replayed: true };
  const f = double({ commit: () => committed });
  assert.deepEqual(await stage(f.port()), committed);
});
test("existing receipt is reconfirmed by commit without reapplying a plan", async () => {
  const receipt = makeReceipt(), f = double({ receipt });
  assert.deepEqual(await stage(f.port()), { result: receipt.result, replayed: true });
  assert.equal(f.calls[1].args.p_plan, null);
});
test("failed or unfinished staging never sends commit", async () => {
  for (const stop of ["callback", "no-receipt", "wrong-result"]) {
    const f = double();
    await assert.rejects(f.port().transaction(scope, async (tx) => {
      await tx.getReceipt(key); const p = makePlan(await tx.snapshot()); await tx.apply(p);
      if (stop === "callback") throw new Error("synthetic callback failure");
      if (stop !== "no-receipt") await tx.putReceipt(makeReceipt(p));
      return { result: null, replayed: false };
    }));
    assert.equal(f.calls.length, 1);
  }
});
test("callback completion precedes commit and expired transaction cannot be reused", async () => {
  const f = double(); let tx, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = stage(f.port(), { beforeCommit: async (value) => { tx = value; await gate; } });
  while (!tx) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.length, 1); release(); await pending;
  await assert.rejects(tx.snapshot(), code("storage-unavailable"));
});
test("mismatched plan scope, actor, revisions, publication and extra ops fail before commit", async () => {
  const mutations = [p => { p.kind = "publication"; }, p => { p.storeId = "fixture-west"; },
    p => { p.auditEntry.actor.id = "another-person"; }, p => { p.ops[0].rev++; },
    p => { p.ops.push({ op: "expect-head", ...scope, draftRev: 0 }); }, p => { p.resultingHead.publishedRev++; }];
  for (const change of mutations) {
    const f = double();
    await assert.rejects(stage(f.port(), { transform: p => { p = clone(p); change(p); return p; } }), code("contract-rejected"));
    assert.equal(f.calls.length, 1);
  }
});
test("receipt key scope is checked before the first RPC", async () => {
  for (const id of ["bad-json", JSON.stringify(["other", scope.storeId, scope.month, "x"]), JSON.stringify([actor.id, "fixture-west", scope.month, "x"])]) {
    const f = double(); await assert.rejects(stage(f.port(), { id })); assert.equal(f.calls.length, 0);
  }
});
test("safe conflict mapping and malformed transport results never leak details", async () => {
  for (const [message, wanted] of [["scheduler:conflict", "conflict"], ["scheduler:idempotency-conflict", "idempotency-conflict"],
    ["private database detail", "storage-unavailable"]]) {
    const f = double({ rpc: () => ({ data: null, error: { code: "P0001", message } }) });
    await assert.rejects(stage(f.port()), code(wanted));
  }
  for (const data of [{ extra: true }, new Array(100_001).fill(null), { snapshot: { ...empty(), draftText: "orphan" }, receipt: null }]) {
    const f = double({ rpc: () => ({ data, error: null }) }); await assert.rejects(stage(f.port()), code("storage-unavailable"));
  }
});
test("late malformed commit envelopes are rejected without returning extra fields", async () => {
  for (const commit of [() => ({ result: {}, replayed: false }), () => ({ result: {}, replayed: true, secret: "not exposed" }),
    () => ({ result: { private: "not exposed" }, replayed: true }),
    () => ({ result: { head: { draftRev: 1, publishedRev: -1 } }, replayed: true })]) {
    const f = double({ commit }); await assert.rejects(stage(f.port()), code("storage-unavailable"));
  }
});
test("stored receipt cannot smuggle extra fields through a replay", async () => {
  const receipt = makeReceipt(); receipt.result.private = "not exposed";
  const f = double({ receipt });
  await assert.rejects(stage(f.port()), code("storage-unavailable"));
  assert.equal(f.calls.length, 1);
});
test("authority is copied once and accessors are rejected without invocation", async () => {
  const f = double(), a = authority(), port = f.port(a);
  a.actorId = "other-person"; a.storeId = "fixture-west";
  await stage(port); assert.equal(f.calls[0].args.p_authority.actorId, actor.id);
  let invoked = false;
  const bad = authority(); Object.defineProperty(bad, "actorId", { enumerable: true, get() { invoked = true; return actor.id; } });
  assert.throws(() => f.port(bad), code("storage-unavailable")); assert.equal(invoked, false);
});
test("existing wrapper and contract project only published data from an internal dual snapshot", async () => {
  const published = draft(), privateDraft = draft();
  privateDraft.store.people[0].name = "DRAFT-ONLY-MARKER";
  function text(kind, value) {
    if (artifactMode === "original-r1") {
      const encoded = c113.serializeVersion({ ...scope, kind, rev: 1, draft: value, meta: kind === "published" ?
        { sourceDraftRev: 1, supersedes: 0, reviewDigest: "0".repeat(16), adjacent: { prev: 0, next: 0 } } : {} });
      assert.equal(encoded.ok, true, JSON.stringify(encoded)); return encoded.text;
    }
    const e = JSON.parse(makePlan().ops[0].text); e.kind = kind; e.payload = value; return JSON.stringify(e);
  }
  const snapshot = { ...empty(), head: { draftRev: 1, publishedRev: 1 }, draftText: text("draft", privateDraft),
    publishedText: text("published", published), auditRevision: 1, prevAuditHash: "0".repeat(16) };
  const f = double({ snapshot }), persistence = f.port(authority("read", "published"));
  const forbiddenReview = () => { throw new Error("review must not run for a read"); };
  const contract = createSchedulerContract({ c113, sha256: hash, reviewProvider: {
    REVIEW_DEFINITION: "month-review/1", validateReviewInput: forbiddenReview, verifyReview: forbiddenReview,
    reviewMonth: forbiddenReview, reviewSpan: forbiddenReview, canonicalJson: forbiddenReview,
  } });
  const boundary = createSchedulerBoundary({ contract, persistence, authorize: persistence.authorize });
  await assert.rejects(boundary.execute({ op: "read", ...scope, input: { kind: "draft" } }, actor), code("forbidden"));
  assert.equal(f.calls.length, 0);
  const result = await boundary.execute({ op: "read", ...scope, input: { kind: "published" } }, actor);
  assert.equal(result.result.kind, "published"); assert.equal(result.result.revision, 1);
  assert.deepEqual(result.result.schedule, published);
  assert.doesNotMatch(JSON.stringify(result), /DRAFT-ONLY-MARKER/);
  assert.equal(f.calls.length, 1);
});
test("real wrapper accepts the persistence protocol and rejects publish before storage", async () => {
  const f = double(), persistence = f.port();
  const contract = { validateRequest: () => true, plan: ({ snapshot }) => makePlan(snapshot),
    projectResult: ({ plan }) => ({ head: plan.resultingHead }), projectRead: () => ({}) };
  const boundary = createSchedulerBoundary({ contract, persistence, authorize: persistence.authorize, now: () => "2026-10-19T06:00:00.000Z" });
  await assert.rejects(boundary.execute({ op: "publish", ...scope, input: {}, requestId: "id" }, actor), code("forbidden"));
  assert.equal(f.calls.length, 0);
  const result = await boundary.execute({ op: "save", ...scope, input: {}, requestId: "id" }, actor);
  assert.deepEqual(result, { result: { head: { draftRev: 1, publishedRev: 0 } }, replayed: false });
});
test("existing endpoint, contract adapter and wrapper remain byte-identical", () => {
  for (const [name, expected] of Object.entries({
    "_scheduler-store.mjs": "55da636812b0d281c3475c110d098d08a235e308bb90b823c11c827d9dccf84e",
    "scheduler.mjs": "47a37141f37dfbd59f14001ddd4754a7a8f116967c9bf763f3153a118f3ea97a",
    "_scheduler-contract.mjs": "0cfdf82de511950c9bff159c2703a2d2b9213593bdb1694f3f4b1f94e320de47",
  })) assert.equal(hash(fs.readFileSync(new URL(`../api/${name}`, import.meta.url))), expected);
});
test("pending SQL is invoker-only, revokes default exposure and never grants access", () => {
  const sql = fs.readFileSync(new URL("../supabase/reference/scheduler-original-transaction.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*GRANT\b|SECURITY\s+DEFINER/im);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scheduler_private FROM PUBLIC/);
  assert.match(sql, /action IS NULL OR action NOT IN/);
  assert.ok(sql.indexOf("IF FOUND THEN") < sql.indexOf("p_expected->'head' IS DISTINCT"));
});

// Full-chain composition uses the unchanged contract. Review methods throw:
// save/read must never fabricate provider success or publication context.
function exactBoundary(transport, selectedScope, action = "save", readKind = null) {
  const rejectReview = () => { throw new Error("review is outside save/read tests"); };
  const contract = createSchedulerContract({ c113, sha256: hash, reviewProvider: {
    REVIEW_DEFINITION: "month-review/1", validateReviewInput: rejectReview, verifyReview: rejectReview,
    reviewMonth: rejectReview, reviewSpan: rejectReview, canonicalJson: rejectReview,
  } });
  const persistence = createSchedulerPostgres({ transport, c113,
    authority: { actorId: actor.id, ...selectedScope, action, readKind } });
  return createSchedulerBoundary({ contract, persistence, authorize: persistence.authorize,
    now: () => "2026-10-19T11:30:00.000Z" });
}
function scopedDraft(selectedScope, name = "Fictional Person") {
  const value = draft(); value.storeId = selectedScope.storeId; value.month = selectedScope.month;
  value.store.people[0].name = name;
  for (const membership of value.store.memberships) membership.storeId = selectedScope.storeId;
  return value;
}
const saveRequest = (selectedScope, requestId, baseRev = 0, name = requestId) => ({
  op: "save", ...selectedScope, requestId, input: { baseRev, draft: scopedDraft(selectedScope, name) },
});
const readRequest = (selectedScope, kind = "draft") => ({ op: "read", ...selectedScope, input: { kind } });
const textLiteral = (value) => value === null ? "NULL" : `E'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
const jsonLiteral = (value) => `${textLiteral(JSON.stringify(value))}::jsonb`;
function rpcStatement(name, args) {
  if (name === "scheduler_snapshot") return `SELECT scheduler_gateway.scheduler_snapshot(${jsonLiteral(args.p_authority)},${textLiteral(args.p_key)})`;
  if (name === "scheduler_commit") return `SELECT scheduler_gateway.scheduler_commit(${jsonLiteral(args.p_authority)},${jsonLiteral(args.p_expected)},${jsonLiteral(args.p_plan)},${jsonLiteral(args.p_receipt)})`;
  throw new Error("Unknown fixture RPC");
}
function sqlFailure(stderr) {
  const match = /\bERROR:\s+P0001:\s+(scheduler:(?:conflict|idempotency-conflict|forbidden))(?=\r?\n|$)/.exec(stderr || "");
  return match ? { code: "P0001", message: match[1] } : { code: "LOCAL_TEST_FAILURE", message: "local-sql-failure" };
}
test("SQL transport names and exact known error messages fail closed", () => {
  assert.throws(() => rpcStatement("anything_else", {}), /Unknown fixture RPC/);
  assert.equal(textLiteral("a'\\b"), "E'a''\\\\b'");
  for (const name of ["conflict", "idempotency-conflict", "forbidden"]) {
    assert.deepEqual(sqlFailure(`ERROR:  P0001: scheduler:${name}\nCONTEXT: private detail`), { code: "P0001", message: `scheduler:${name}` });
  }
  for (const message of ["scheduler:conflict", "ERROR: XX000: scheduler:conflict", "ERROR: P0001: scheduler:conflict private detail"]) {
    assert.deepEqual(sqlFailure(message), { code: "LOCAL_TEST_FAILURE", message: "local-sql-failure" });
  }
});
const childExec = promisify(execFile);
const testFile = fileURLToPath(import.meta.url);
const runnerFile = fileURLToPath(new URL("../scripts/scheduler-postgres-check.sh", import.meta.url));
const childEnv = { PATH: process.env.PATH, LANG: "C" };
test("runner requires explicit artifact paths before any database setup", async () => {
  for (const mode of ["--check-artifacts", "--run-local"]) {
    await assert.rejects(childExec("bash", [runnerFile, mode], { env: childEnv, timeout: 10000 }),
      e => e.code === 2 && /pinned original artifact paths are required/.test(e.stderr));
  }
});
test("SQL mode refuses port fixtures and conflicting preflight flags before connection", async () => {
  for (const settings of [
    { SCHEDULER_POSTGRES_MODE: "local", SCHEDULER_POSTGRES_ARTIFACTS: "ports" },
    { SCHEDULER_POSTGRES_MODE: "local", SCHEDULER_POSTGRES_ARTIFACTS: "original-r1", SCHEDULER_POSTGRES_VERIFY_ARTIFACTS: "1" },
  ]) {
    await assert.rejects(childExec(process.execPath, [testFile], { env: { ...childEnv, ...settings }, timeout: 10000 }),
      e => e.code === 1 && /requires pinned original-r1|preflight cannot claim SQL/.test(e.stderr));
  }
});
if (artifactMode === "original-r1") {
  const inputs = ["--c113-root", process.env.SCHEDULER_C113_ROOT, "--c113-archive", process.env.SCHEDULER_C113_ARCHIVE];
  test("PINNED runner preflight forwards only explicit paths and starts no SQL", async () => {
    const result = await childExec("bash", [runnerFile, "--check-artifacts", ...inputs], { env: { ...childEnv,
      NODE_OPTIONS: "--deliberately-invalid-option", PGHOST: "UNUSED", DATABASE_URL: "UNUSED",
      SCHEDULER_POSTGRES_MODE: "local", SCHEDULER_C113_ROOT: "/must-not-use-ambient-path" }, timeout: 10000 });
    assert.match(result.stdout, /PINNED_C113_ARTIFACTS_VERIFIED: no SQL executed/);
    assert.doesNotMatch(result.stdout, /REAL SQL COMPOSITION MODE|Subtest|initdb|server started/);
  });
  test("PINNED runner rejects altered module or archive before importing or creating a cluster", async () => {
    const temporary = fs.mkdtempSync(path.join(tmpdir(), "scheduler-artifact-negative-"));
    try {
      const dir = path.join(temporary, "scripts/scheduler-performance/persistence"); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "audit-entry.mjs"), "throw new Error('MUST_NOT_IMPORT');\n");
      await assert.rejects(childExec("bash", [runnerFile, "--check-artifacts", "--c113-root", temporary,
        "--c113-archive", process.env.SCHEDULER_C113_ARCHIVE], { env: childEnv, timeout: 10000 }),
      e => e.code === 1 && /audit-entry\.mjs/.test(e.stderr) && !/Error: MUST_NOT_IMPORT/.test(e.stderr));
      const wrongArchive = path.join(temporary, "wrong.tar.gz"); fs.writeFileSync(wrongArchive, "invalid");
      await assert.rejects(childExec("bash", [runnerFile, "--check-artifacts", "--c113-root", process.env.SCHEDULER_C113_ROOT,
        "--c113-archive", wrongArchive], { env: childEnv, timeout: 10000 }), e => e.code === 1 && /Original archive byte count/.test(e.stderr));
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
}
if (artifactMode === "original-r1") test("PINNED composition: actual wrapper, contract, original plan and adapter use an injected RPC double", async () => {
  const request = saveRequest(scope, "actual-composition"), f = double();
  const boundary = exactBoundary(f.transport, scope);
  await assert.rejects(boundary.execute({ op: "publish", ...scope, requestId: "forbidden-publication",
    input: { draftRev: 1, review: { definition: "month-review/1", digest: "a".repeat(64) } } }, actor), code("forbidden"));
  assert.equal(f.calls.length, 0);
  const result = await boundary.execute(request, actor);
  assert.deepEqual(result, { result: { head: { draftRev: 1, publishedRev: 0 } }, replayed: false });
  const actual = c113.planDraftSave({ ...scope, head: null, baseRev: 0, draft: request.input.draft,
    actor, at: "2026-10-19T11:30:00.000Z", prevAuditHash: null });
  assert.equal(actual.ok, true); assert.deepEqual(f.calls[1].args.p_plan, actual.plan);
  assert.equal(c113.verifyEntry(actual.plan.auditEntry).ok, true);
});

// Explicit integration mode cannot fall back to opaque plans. Nothing below
// executes in the ordinary suite or artifact-only preflight. SQL execution in
// this executor remains unavailable; these are prepared tests, not evidence.
if (sqlMode === "local") {
  const root = process.env.SCHEDULER_POSTGRES_ROOT, bin = process.env.SCHEDULER_POSTGRES_BIN;
  if (!root || !bin || !path.isAbsolute(root) || !path.isAbsolute(bin) || !path.basename(root).startsWith("sage-scheduler-pg.")) throw new Error("Use the isolated local runner");
  assert.equal(fs.statSync(root).uid, process.getuid());
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(path.join(root, "runner-marker"), "utf8"), root);
  const socket = path.join(root, "socket"), psql = path.join(bin, "psql");
  const args = ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", socket, "-p", "5432", "-U", "scheduler_fixture", "-d", "scheduler_fixture"];
  const env = { PATH: process.env.PATH, HOME: path.join(root, "home"), LANG: "C", PGCONNECT_TIMEOUT: "5" };
  const exec = promisify(execFile);
  const activeProcesses = new Set();
  function run(file, argv, options = {}) {
    const promise = exec(file, argv, { env, timeout: 20000, maxBuffer: 16_777_216, ...options });
    activeProcesses.add(promise);
    promise.then(() => activeProcesses.delete(promise), () => activeProcesses.delete(promise));
    return promise;
  }
  const sql = async (query, app = "scheduler-check") => (await run(psql, [...args, "-c", query], { env: { ...env, PGAPPNAME: app } })).stdout.trim();
  const runtimeArgs = args.map(v => v === "scheduler_fixture" ? "scheduler_runtime" : v);
  runtimeArgs[runtimeArgs.indexOf("-d") + 1] = "scheduler_fixture";
  const runtimeSql = async (query, app) => (await run(psql, [...runtimeArgs, "-c", query], { env: { ...env, PGAPPNAME: app } })).stdout.trim();
  assert.equal(await runtimeSql("SELECT session_user || ':' || current_user", "runtime-identity"), "scheduler_runtime:scheduler_runtime");
  async function verifiedCluster() {
    assert.equal(await sql("SHOW data_directory"), path.join(root, "data"));
    assert.equal(await sql("SHOW listen_addresses"), "");
    assert.equal(await sql("SHOW unix_socket_directories"), socket);
    assert.equal(await sql("SHOW fsync"), "on");
    assert.equal(await sql("SHOW synchronous_commit"), "on");
  }
  await verifiedCluster();
  console.info("REAL SQL COMPOSITION MODE: pinned original C113; no protocol-double fallback");
  let serial = 0;
  const appName = (prefix) => `scheduler-${prefix}-${++serial}`;
  const localScope = (name) => ({ storeId: `sql-${name}`, month: "2026-10" });
  const observe = (promise) => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  async function bounded(promise, milliseconds, label) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  async function until(predicate, label) {
    const deadline = Date.now() + 10000;
    do {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.fail(label);
  }
  const controllers = new Set();
  async function holdLock(lockText) {
    const app = appName("control"), child = spawn(psql, args, { env: { ...env, PGAPPNAME: app }, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "", exited = false, released = false;
    child.stdout.resume(); child.stderr.on("data", part => { stderr = (stderr + part).slice(-4000); });
    child.stdin.on("error", () => {});
    const done = new Promise(resolve => {
      child.once("error", error => { exited = true; resolve({ error }); });
      child.once("close", status => { exited = true; resolve({ status }); });
    });
    const controller = { child, done };
    controllers.add(controller);
    async function release() {
      if (released) return; released = true;
      if (!child.stdin.destroyed) child.stdin.end("ROLLBACK;\n");
      let outcome;
      try { outcome = await bounded(done, 5000, "controller did not exit"); }
      catch (error) {
        child.kill("SIGTERM");
        await bounded(done, 5000, "controller termination did not settle");
        throw error;
      } finally { controllers.delete(controller); }
      assert.equal(outcome.status, 0, `controller failed: ${outcome.error?.message || stderr}`);
    }
    controller.release = release;
    child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${textLiteral(lockText)},0));\n`);
    try {
      await until(async () => {
        assert.equal(exited, false, `controller exited: ${stderr}`);
        return await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${textLiteral(app)} AND l.locktype='advisory' AND l.granted)`) === "t";
      }, "controller never acquired its lock");
      const pid = Number(await sql(`SELECT pid FROM pg_stat_activity WHERE application_name=${textLiteral(app)}`));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      return { pid, release, async waitFor(apps) {
        let rows;
        await until(async () => {
          rows = JSON.parse(await sql(`SELECT COALESCE(jsonb_agg(jsonb_build_object('pid',pid,'app',application_name,'wait',wait_event,'blockers',pg_blocking_pids(pid))),'[]'::jsonb) FROM pg_stat_activity WHERE application_name IN (${apps.map(textLiteral).join(",")})`));
          return rows.length === apps.length && rows.every(r => r.wait === "advisory" && r.blockers.length > 0);
        }, "contenders did not all reach the lock barrier");
        const reachesController = (candidate, seen = new Set()) => candidate === pid || (!seen.has(candidate) &&
          (seen.add(candidate), rows.find(r => r.pid === candidate)?.blockers.some(blocker => reachesController(blocker, seen))));
        assert.ok(rows.every(r => reachesController(r.pid)), "each blocked backend must lead to this controller");
        return rows;
      } };
    } catch (error) { await release(); throw error; }
  }
  function client(selectedScope, { beforeCommit, afterCommit, app = appName("request") } = {}) {
    const events = [];
    const transport = { capabilities: { [SCHEDULER_POSTGRES_RPC_CAPABILITY]: true }, rpc: async (name, rawArgs) => {
      const dispatched = clone(rawArgs), event = { name, original: clone(rawArgs), args: dispatched }; events.push(event);
      if (name === "scheduler_commit" && beforeCommit) await beforeCommit(dispatched, event);
      let data;
      try { data = JSON.parse(await runtimeSql(rpcStatement(name, dispatched), app)); }
      catch (error) { return { data: null, error: sqlFailure(error.stderr) }; }
      event.data = clone(data);
      if (name === "scheduler_commit" && afterCommit) data = await afterCommit(data, event);
      return { data, error: null };
    } };
    return { app, events, execute(request) {
      // Always a fresh request-bound adapter, including reads and retries.
      return exactBoundary(transport, selectedScope, request.op === "read" ? "read" : "save",
        request.op === "read" ? request.input.kind : null).execute(request, actor);
    } };
  }
  const fullState = async () => JSON.parse(await sql("SELECT jsonb_build_object('heads',COALESCE((SELECT jsonb_agg(t ORDER BY store_id,month) FROM scheduler_private.heads t),'[]'::jsonb),'versions',COALESCE((SELECT jsonb_agg(t ORDER BY store_id,month,kind,rev) FROM scheduler_private.versions t),'[]'::jsonb),'audit',COALESCE((SELECT jsonb_agg(t ORDER BY store_id,month,revision) FROM scheduler_private.audit t),'[]'::jsonb),'receipts',COALESCE((SELECT jsonb_agg(t ORDER BY store_id,month,actor_id,key_digest) FROM scheduler_private.receipts t),'[]'::jsonb))"));
  function selectedState(state, selectedScope) {
    return Object.fromEntries(Object.entries(state).map(([table, rows]) => [table,
      rows.filter(row => row.store_id === selectedScope.storeId && row.month === selectedScope.month)]));
  }
  function assertCounts(state, selectedScope, { versions, audit, receipts, draftRev, publishedRev = 0 }) {
    const rows = selectedState(state, selectedScope);
    assert.equal(rows.heads.length, 1); assert.equal(rows.versions.length, versions);
    assert.equal(rows.audit.length, audit); assert.equal(rows.receipts.length, receipts);
    assert.equal(rows.heads[0].draft_rev, draftRev); assert.equal(rows.heads[0].published_rev, publishedRev);
    return rows;
  }
  const snapshotEvent = (c) => c.events.find(e => e.name === "scheduler_snapshot").data.snapshot;
  const commitEvent = (c) => c.events.find(e => e.name === "scheduler_commit");
  async function fixtureTrigger(table, operation, selectedScope, body) {
    assert.ok(["versions", "audit", "heads", "receipts"].includes(table));
    assert.ok(["INSERT", "UPDATE"].includes(operation));
    const name = `fixture_${++serial}`;
    await sql(`CREATE FUNCTION scheduler_private.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.store_id=${textLiteral(selectedScope.storeId)} AND NEW.month=${textLiteral(selectedScope.month)} THEN ${body} END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} AFTER ${operation} ON scheduler_private.${table} FOR EACH ROW EXECUTE FUNCTION scheduler_private.${name}();`);
    return async () => sql(`DROP TRIGGER ${name} ON scheduler_private.${table}; DROP FUNCTION scheduler_private.${name}();`);
  }
  async function seededPublished(selectedScope) {
    await client(selectedScope).execute(saveRequest(selectedScope, "seed-draft", 0, "DRAFT-ONLY-MARKER"));
    const prior = selectedState(await fullState(), selectedScope), head = prior.heads[0];
    const encoded = c113.serializeVersion({ ...selectedScope, kind: "published", rev: 1,
      draft: scopedDraft(selectedScope, "Published Fixture"), meta: { sourceDraftRev: 1, supersedes: 0,
        reviewDigest: "0".repeat(16), adjacent: { prev: 0, next: 0 } } });
    assert.equal(encoded.ok, true);
    const audit = c113.buildAuditEntry({ action: "publish", ...selectedScope, actor, at: "2026-10-19T11:30:00.000Z",
      fromRev: 1, toRev: 1, subject: { kind: "published", rev: 1, digest: encoded.envelope.hash.value }, prevHash: head.last_audit_hash });
    assert.equal(audit.ok, true);
    // Fixture-only historical published state. This is not a publication API
    // exercise; the adapter still rejects every publish request.
    await sql(`BEGIN; INSERT INTO scheduler_private.versions VALUES (${textLiteral(selectedScope.storeId)},${textLiteral(selectedScope.month)},'published',1,${textLiteral(encoded.text)}); INSERT INTO scheduler_private.audit VALUES (${textLiteral(selectedScope.storeId)},${textLiteral(selectedScope.month)},2,${jsonLiteral(audit.entry)}); UPDATE scheduler_private.heads SET published_rev=1,audit_revision=2,last_audit_hash=${textLiteral(audit.entry.hash)} WHERE store_id=${textLiteral(selectedScope.storeId)} AND month=${textLiteral(selectedScope.month)}; COMMIT;`);
    return encoded.text;
  }
  const realTest = (name, fn) => test(`REAL SQL COMPOSITION: ${name}`, { concurrency: false, timeout: 90000 }, fn);

  realTest("distinct request IDs contend for an absent month without loser fragments", async () => {
    const selectedScope = localScope("distinct-first"), lock = await holdLock(`sage-scheduler:${selectedScope.storeId}`);
    const a = client(selectedScope), b = client(selectedScope);
    const requests = [saveRequest(selectedScope, "first-a"), saveRequest(selectedScope, "first-b")];
    const pending = [observe(a.execute(requests[0])), observe(b.execute(requests[1]))];
    let outcomes;
    try {
      await lock.waitFor([a.app, b.app]);
      assert.equal(snapshotEvent(a).head, null); assert.equal(snapshotEvent(b).head, null);
      await lock.release(); outcomes = await Promise.all(pending);
    } finally { await lock.release(); await Promise.all(pending); }
    assert.equal(outcomes.filter(o => o.ok).length, 1);
    assert.ok(code("conflict")(outcomes.find(o => !o.ok).error));
    const winner = outcomes.findIndex(o => o.ok), before = await fullState();
    const rows = assertCounts(before, selectedScope, { versions: 1, audit: 1, receipts: 1, draftRev: 1 });
    assert.equal(JSON.parse(rows.receipts[0].request_key)[3], requests[winner].requestId);
    const retry = client(selectedScope);
    assert.deepEqual(await retry.execute(requests[winner]), { ...outcomes[winner].value, replayed: true });
    assert.equal(commitEvent(retry).args.p_plan, null); assert.deepEqual(await fullState(), before);
  });
  for (const changed of [false, true]) realTest(`same-ID ${changed ? "changed-fingerprint conflict" : "duplicate replay"} race`, async () => {
    const selectedScope = localScope(changed ? "changed-race" : "duplicate-race");
    const lock = await holdLock(`sage-scheduler:${selectedScope.storeId}`), a = client(selectedScope), b = client(selectedScope);
    const request = saveRequest(selectedScope, "same-request");
    const other = clone(request); if (changed) other.input.draft.store.people[0].name = "Changed Input";
    const pending = [observe(a.execute(request)), observe(b.execute(other))];
    let outcomes;
    try {
      await lock.waitFor([a.app, b.app]);
      assert.equal(snapshotEvent(a).head, null); assert.equal(snapshotEvent(b).head, null);
      await lock.release(); outcomes = await Promise.all(pending);
    } finally { await lock.release(); await Promise.all(pending); }
    if (changed) {
      assert.equal(outcomes.filter(o => o.ok).length, 1);
      assert.ok(code("idempotency-conflict")(outcomes.find(o => !o.ok).error));
    } else {
      assert.ok(outcomes.every(o => o.ok));
      assert.deepEqual(outcomes.map(o => o.value.replayed).sort(), [false, true]);
      assert.deepEqual(outcomes[0].value.result, outcomes[1].value.result);
    }
    assertCounts(await fullState(), selectedScope, { versions: 1, audit: 1, receipts: 1, draftRev: 1 });
  });
  for (const [table, operation] of [["versions", "INSERT"], ["audit", "INSERT"], ["heads", "INSERT"], ["heads", "UPDATE"], ["receipts", "INSERT"]]) {
    realTest(`AFTER ${table} ${operation} failure rolls back every table and permits exact retry`, async () => {
      const selectedScope = localScope(`rollback-${table}-${operation.toLowerCase()}`), seeded = operation === "UPDATE";
      if (seeded) await client(selectedScope).execute(saveRequest(selectedScope, "seed"));
      const request = saveRequest(selectedScope, "failed-then-retried", seeded ? 1 : 0), before = await fullState();
      const remove = await fixtureTrigger(table, operation, selectedScope, "RAISE EXCEPTION 'fixture-after-mutation';");
      try {
        await assert.rejects(client(selectedScope).execute(request), code("storage-unavailable"));
        assert.deepEqual(await fullState(), before);
      } finally { await remove(); }
      const result = await client(selectedScope).execute(request), committed = await fullState();
      assert.equal(result.replayed, false);
      const n = seeded ? 2 : 1;
      assertCounts(committed, selectedScope, { versions: n, audit: n, receipts: n, draftRev: n });
      const retry = client(selectedScope);
      assert.deepEqual(await retry.execute(request), { result: result.result, replayed: true });
      assert.equal(commitEvent(retry).args.p_plan, null); assert.deepEqual(await fullState(), committed);
    });
  }
  for (const field of ["publishedRev", "auditRevision", "prevAuditHash"]) realTest(`isolated stale ${field} expected-state fault rejects before mutation`, async () => {
    const selectedScope = localScope(`guard-${field.toLowerCase()}`);
    await seededPublished(selectedScope);
    const before = await fullState(), request = saveRequest(selectedScope, `stale-${field}`, 1);
    const c = client(selectedScope, { beforeCommit(args, event) {
      if (field === "publishedRev") args.p_expected.head.publishedRev = 0;
      else if (field === "auditRevision") args.p_expected.auditRevision--;
      else args.p_expected.prevAuditHash = null;
      assert.deepEqual(args.p_plan, event.original.p_plan); assert.deepEqual(args.p_receipt, event.original.p_receipt);
      const expected = clone(event.original.p_expected);
      if (field === "publishedRev") expected.head.publishedRev = 0;
      else if (field === "auditRevision") expected.auditRevision--;
      else expected.prevAuditHash = null;
      assert.deepEqual(args.p_expected, expected);
    } });
    // Only the expected-state packet is stale. The current plan/receipt remain
    // valid, so later plan checks cannot mask a missing CAS predicate.
    await assert.rejects(c.execute(request), code("conflict"));
    assert.deepEqual(await fullState(), before);
    assert.equal((await client(selectedScope).execute(request)).replayed, false);
  });
  realTest("a different store commits while the first store remains demonstrably blocked", async () => {
    const sa = localScope("store-a"), sb = localScope("store-b");
    assert.notEqual(await sql(`SELECT hashtextextended(${textLiteral(`sage-scheduler:${sa.storeId}`)},0)`),
      await sql(`SELECT hashtextextended(${textLiteral(`sage-scheduler:${sb.storeId}`)},0)`));
    const lock = await holdLock(`sage-scheduler:${sa.storeId}`), a = client(sa), b = client(sb);
    const pendingA = observe(a.execute(saveRequest(sa, "same-id"))); let pendingB;
    try {
      await lock.waitFor([a.app]);
      pendingB = observe(b.execute(saveRequest(sb, "same-id")));
      const resultB = await bounded(pendingB, 10000, "other store waited on the first store");
      assert.equal(resultB.ok, true); assert.equal(resultB.value.replayed, false);
      await lock.waitFor([a.app]);
      const state = await fullState();
      assert.deepEqual(selectedState(state, sa), { heads: [], versions: [], audit: [], receipts: [] });
      assertCounts(state, sb, { versions: 1, audit: 1, receipts: 1, draftRev: 1 });
      await lock.release(); assert.equal((await pendingA).ok, true);
    } finally { await lock.release(); await pendingA; if (pendingB) await pendingB; }
    assertCounts(await fullState(), sa, { versions: 1, audit: 1, receipts: 1, draftRev: 1 });
  });
  for (const existing of [false, true]) realTest(`coherent ${existing ? "existing" : "absent"} snapshots during a fully mutated uncommitted write`, async () => {
    const selectedScope = localScope(existing ? "coherent-existing" : "coherent-absent");
    if (existing) await seededPublished(selectedScope);
    const beforeReader = client(selectedScope), beforeResult = await beforeReader.execute(readRequest(selectedScope));
    const beforeSnapshot = snapshotEvent(beforeReader), lockText = `fixture-uncommitted-${selectedScope.storeId}`;
    const lock = await holdLock(lockText);
    const remove = await fixtureTrigger("receipts", "INSERT", selectedScope, `PERFORM pg_advisory_xact_lock(hashtextextended(${textLiteral(lockText)},0));`);
    const writer = client(selectedScope), pending = observe(writer.execute(saveRequest(selectedScope, "new-draft", existing ? 1 : 0, "DRAFT-ONLY-NEW")));
    try {
      await lock.waitFor([writer.app]);
      for (const kind of ["draft", "published", "draft"]) {
        const reader = client(selectedScope), result = await reader.execute(readRequest(selectedScope, kind));
        assert.deepEqual(snapshotEvent(reader), beforeSnapshot);
        if (kind === "draft") assert.deepEqual(result, beforeResult);
        else assert.doesNotMatch(JSON.stringify(result), /DRAFT-ONLY/);
      }
      await lock.release(); assert.equal((await pending).ok, true);
    } finally { await lock.release(); await pending; await remove(); }
    const afterReader = client(selectedScope), afterResult = await afterReader.execute(readRequest(selectedScope));
    const afterSnapshot = snapshotEvent(afterReader), staged = commitEvent(writer).args.p_plan;
    assert.deepEqual(afterSnapshot.head, staged.resultingHead);
    assert.equal(afterSnapshot.draftText, staged.ops[0].text);
    assert.equal(afterSnapshot.publishedText, beforeSnapshot.publishedText);
    assert.equal(afterSnapshot.auditRevision, beforeSnapshot.auditRevision + 1);
    assert.equal(afterSnapshot.prevAuditHash, staged.auditEntry.hash);
    assert.equal(afterResult.result.schedule.store.people[0].name, "DRAFT-ONLY-NEW");
    const published = await client(selectedScope).execute(readRequest(selectedScope, "published"));
    assert.doesNotMatch(JSON.stringify(published), /DRAFT-ONLY/);
  });
  for (const kind of ["lost", "malformed"]) realTest(`committed ${kind} reply recovers its historic receipt through a fresh full chain`, async () => {
    const selectedScope = localScope(`reply-${kind}`), request = saveRequest(selectedScope, "ambiguous");
    const first = client(selectedScope, { afterCommit(data) {
      assert.equal(data.replayed, false);
      if (kind === "lost") throw new Error("fictional reply lost after commit");
      return { result: { private: "must not escape" }, replayed: true };
    } });
    await assert.rejects(first.execute(request), code("storage-unavailable"));
    const initial = await fullState();
    assertCounts(initial, selectedScope, { versions: 1, audit: 1, receipts: 1, draftRev: 1 });
    await client(selectedScope).execute(saveRequest(selectedScope, "later-save", 1));
    const beforeRetry = await fullState(), retry = client(selectedScope);
    const recovered = await retry.execute(request);
    assert.deepEqual(recovered, { result: { head: { draftRev: 1, publishedRev: 0 } }, replayed: true });
    assert.equal(commitEvent(retry).args.p_plan, null);
    assert.deepEqual(await fullState(), beforeRetry);
    assertCounts(beforeRetry, selectedScope, { versions: 2, audit: 2, receipts: 2, draftRev: 2 });
  });
  realTest("saved immutable rows and an older receipt replay survive clean restart", async () => {
    const selectedScope = localScope("restart"), request = saveRequest(selectedScope, "before-restart");
    const original = await client(selectedScope).execute(request);
    await client(selectedScope).execute(saveRequest(selectedScope, "newer-head", 1));
    const before = await fullState();
    assert.equal(controllers.size, 0); assert.equal(activeProcesses.size, 0);
    await run(path.join(bin, "pg_ctl"), ["-D", path.join(root, "data"), "-w", "-m", "fast", "stop"]);
    await run(path.join(bin, "pg_ctl"), ["-D", path.join(root, "data"), "-l", path.join(root, "postgres.log"), "-w", "start"]);
    await verifiedCluster();
    const retry = client(selectedScope);
    assert.deepEqual(await retry.execute(request), { result: original.result, replayed: true });
    assert.equal(commitEvent(retry).args.p_plan, null); assert.deepEqual(await fullState(), before);
    await assert.rejects(sql(`UPDATE scheduler_private.versions SET version_text=version_text WHERE store_id=${textLiteral(selectedScope.storeId)}`));
    assert.deepEqual(await fullState(), before);
  });
  test("ACL FIXTURE: capture an original valid absent-scope command without committing", { concurrency: false }, async () => {
    const selectedScope = localScope("acl-valid-command"), before = await fullState();
    const c = client(selectedScope, { beforeCommit(dispatched) {
      fs.writeFileSync(path.join(root, "valid-commit.json"), JSON.stringify(dispatched), { mode: 0o600 });
      throw new Error("fixture capture only");
    } });
    await assert.rejects(c.execute(saveRequest(selectedScope, "acl-guard-probe")), code("storage-unavailable"));
    assert.equal(fs.existsSync(path.join(root, "valid-commit.json")), true);
    assert.deepEqual(await fullState(), before);
  });
  test("REAL SQL COMPOSITION: all owned processes and lock controllers settled", { concurrency: false }, async () => {
    for (const controller of [...controllers]) await controller.release();
    await Promise.allSettled([...activeProcesses]);
    assert.equal(controllers.size, 0); assert.equal(activeProcesses.size, 0);
  });
}
}

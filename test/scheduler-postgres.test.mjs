import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
if (!["ports", "original-r1"].includes(artifactMode)) throw new Error("Unknown artifact mode");
if (artifactMode === "original-r1") {
  const root = process.env.SCHEDULER_C113_ROOT, archive = process.env.SCHEDULER_C113_ARCHIVE;
  if (!root || !archive) throw new Error("Original C113 paths are required; no fallback");
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
  const sql = fs.readFileSync(new URL("../supabase/pending/scheduler-transaction.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*GRANT\b|SECURITY\s+DEFINER/im);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA scheduler_private FROM PUBLIC/);
  assert.match(sql, /action IS NULL OR action NOT IN/);
  assert.ok(sql.indexOf("IF FOUND THEN") < sql.indexOf("p_expected->'head' IS DISTINCT"));
});

// This separate mode is intentionally absent from normal unit coverage. It
// requires the isolated runner's private marker and a real psql executable.
const sqlMode = process.env.SCHEDULER_POSTGRES_MODE || "ports";
if (!["ports", "local"].includes(sqlMode)) throw new Error("Unknown SQL mode");
if (sqlMode === "local") {
  const root = process.env.SCHEDULER_POSTGRES_ROOT, bin = process.env.SCHEDULER_POSTGRES_BIN;
  if (!root || !bin || !path.isAbsolute(root) || !path.basename(root).startsWith("sage-scheduler-pg.")) throw new Error("Use the isolated local runner");
  assert.equal(fs.statSync(root).uid, process.getuid());
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(path.join(root, "runner-marker"), "utf8"), root);
  const socket = path.join(root, "socket"), psql = path.join(bin, "psql");
  const args = ["-X", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", "5432", "-U", "scheduler_fixture", "-d", "scheduler_fixture"];
  const env = { PATH: process.env.PATH, HOME: path.join(root, "home"), LANG: "C", PGCONNECT_TIMEOUT: "5" };
  const exec = promisify(execFile);
  const sql = async (query, app = "scheduler-check") => (await exec(psql, [...args, "-c", query], { env: { ...env, PGAPPNAME: app }, timeout: 15000, maxBuffer: 16_777_216 })).stdout.trim();
  assert.equal(await sql("SHOW data_directory"), path.join(root, "data"));
  assert.equal(await sql("SHOW listen_addresses"), "");
  const literal = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const snapshotSql = () => `SELECT scheduler_private.scheduler_snapshot(${literal(authority())},'${key.replaceAll("'", "''")}')`;
  const snapshot = async () => JSON.parse(await sql(snapshotSql())).snapshot;
  const command = (s, p = makePlan(s), r = makeReceipt(p)) => `SELECT scheduler_private.scheduler_commit(${literal(authority())},${literal({ head: s.head, prevAuditHash: s.prevAuditHash, auditRevision: s.auditRevision })},${literal(p)},${literal(r)})`;
  const state = () => sql("SELECT jsonb_build_array((SELECT jsonb_agg(t ORDER BY store_id,month) FROM scheduler_private.heads t),(SELECT jsonb_agg(t ORDER BY store_id,month,kind,rev) FROM scheduler_private.versions t),(SELECT jsonb_agg(t ORDER BY store_id,month,revision) FROM scheduler_private.audit t),(SELECT jsonb_agg(t ORDER BY store_id,month,actor_id,key_digest) FROM scheduler_private.receipts t))");
  test("REAL SQL: absent-month duplicate race, durable replay and immutable history", async () => {
    const s = await snapshot(), query = command(s);
    const control = spawn(psql, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const locked = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("lock barrier timed out")), 10000);
      control.stdout.on("data", chunk => { out += chunk; if (out.includes("LOCKED")) { clearTimeout(timeout); resolve(); } });
      control.on("error", reject);
    });
    control.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('sage-scheduler:${scope.storeId}',0)); SELECT 'LOCKED';\n`);
    try {
      await locked;
      const a = sql(query, "scheduler-race-a"), b = sql(query, "scheduler-race-b");
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        waiting = await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('scheduler-race-a','scheduler-race-b') AND wait_event='advisory'") === "2";
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(waiting, true, "both contenders must reach the lock barrier");
      control.stdin.end("COMMIT;\n");
      const results = (await Promise.all([a, b])).map(JSON.parse);
      assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]);
      assert.deepEqual(results[0].result, results[1].result);
    } finally { if (!control.stdin.destroyed) control.stdin.end("ROLLBACK;\n"); }
    const prior = await state();
    assert.equal(JSON.parse(await sql(query)).replayed, true);
    assert.equal(await state(), prior);
    await assert.rejects(sql("UPDATE scheduler_private.versions SET version_text=version_text"));
    assert.equal(await state(), prior);
    const changed = makeReceipt(makePlan(s), key, "b".repeat(64));
    await assert.rejects(sql(command(s, makePlan(s), changed)), /scheduler:idempotency-conflict/);
    assert.equal(await state(), prior);
  });
  test("REAL SQL: final receipt failure rolls back versions, audit and head", async () => {
    const s = await snapshot(), p = makePlan(s), r = makeReceipt(p, JSON.stringify([actor.id, scope.storeId, scope.month, "rollback"]));
    const before = await state();
    await sql("CREATE FUNCTION scheduler_private.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional failure'; END $$; CREATE TRIGGER fixture_failure BEFORE INSERT ON scheduler_private.receipts FOR EACH ROW EXECUTE FUNCTION scheduler_private.fixture_fail();");
    try { await assert.rejects(sql(command(s, p, r)), /fictional failure/); assert.equal(await state(), before); }
    finally { await sql("DROP TRIGGER fixture_failure ON scheduler_private.receipts; DROP FUNCTION scheduler_private.fixture_fail();"); }
    assert.equal(JSON.parse(await sql(command(s, p, r))).replayed, false);
    assert.equal(JSON.parse(await sql(command(s, p, r))).replayed, true);
  });
  test("REAL SQL: committed state survives a clean local server restart", async () => {
    const before = await state();
    await exec(path.join(bin, "pg_ctl"), ["-D", path.join(root, "data"), "-w", "-m", "fast", "stop"], { env, timeout: 15000 });
    await exec(path.join(bin, "pg_ctl"), ["-D", path.join(root, "data"), "-l", path.join(root, "postgres.log"), "-w", "start"], { env, timeout: 15000 });
    assert.equal(await state(), before);
  });
}

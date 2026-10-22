import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import handler, { handle } from "../api/scheduler.mjs";
import { ATOMIC_SCHEDULER_CAPABILITY, SchedulerError, SCHEDULER_TRANSPORT_LIMITS } from "../api/_scheduler-store.mjs";

const request = (op = "read") => ({ op, storeId: "fictional-east", month: "2026-10", input: {},
  ...(op === "read" ? {} : { requestId: "fixture-request" }) });

function fixture() {
  const calls = { auth: [], storage: 0, planned: [], validated: 0 };
  const receipts = new Map();
  const deps = {
    authenticate: async (input) => {
      calls.auth.push(input);
      return input.headers.authorization === "Bearer fixture-manager" ? { id: "fixture-manager" } : null;
    },
    authorize: async ({ actor, request: command }) => actor.id === "fixture-manager" && command.storeId === "fictional-east",
    now: () => "2026-10-18T12:00:00.000Z",
    contract: {
      validateRequest: () => { calls.validated++; return true; },
      projectRead: () => ({ published: { label: "fixture-publication" } }),
      projectResult: ({ plan }) => ({ head: plan.resultingHead }),
      plan: (input) => {
        calls.planned.push(input);
        return { kind: "fixture-plan", storeId: input.request.storeId, month: input.request.month,
          atomic: true, authorization: "not-checked", ops: [], auditEntry: { actor: input.actor.id }, resultingHead: { draftRev: 2, publishedRev: 1 } };
      },
    },
    persistence: {
      capabilities: { [ATOMIC_SCHEDULER_CAPABILITY]: true },
      read: async () => { calls.storage++; return {}; },
      transaction: async (_scope, callback) => {
        calls.storage++;
        return callback({ snapshot: async () => ({}), getReceipt: async (key) => receipts.get(key) || null,
          apply: async () => true, putReceipt: async (receipt) => { receipts.set(receipt.key, structuredClone(receipt)); return true; } });
      },
    },
  };
  return { deps, calls };
}

async function call({ body = request(), headers = { authorization: "Bearer fixture-manager" }, method = "POST", deps, target = handle } = {}) {
  const out = { headers: {} };
  const res = { setHeader(key, value) { out.headers[key] = value; }, status(status) { out.status = status; return this; },
    json(body) { out.body = body; return this; } };
  await target({ method, headers, body }, res, deps);
  return out;
}

test("the default endpoint is dormant for every method without touching a port", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const { deps, calls } = fixture();
    const out = await call({ target: handler, method, deps });
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: "storage-not-configured" });
    assert.equal(out.headers["Cache-Control"], "no-store");
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.storage, 0);
  }
});

test("the injected endpoint enforces POST before authentication or storage", async () => {
  const { deps, calls } = fixture();
  const out = await call({ method: "GET", deps });
  assert.equal(out.status, 405);
  assert.equal(out.headers.Allow, "POST");
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.storage, 0);
});

test("a missing authentication port fails closed", async () => {
  const out = await call();
  assert.equal(out.status, 503);
  assert.deepEqual(out.body, { error: "storage-not-configured" });
});

test("missing or invalid sessions do not reach storage or schema processing", async () => {
  for (const headers of [{}, { authorization: "Bearer unknown" }]) {
    const { deps, calls } = fixture();
    const out = await call({ deps, headers, body: "{" });
    assert.equal(out.status, 401);
    assert.equal(calls.storage, 0);
  }
});

test("authentication sees only headers and body identity is rejected", async () => {
  const { deps, calls } = fixture();
  const out = await call({ deps, body: { ...request(), actor: { id: "forged-manager" } } });
  assert.equal(out.status, 400);
  assert.deepEqual(Object.keys(calls.auth[0]), ["headers"]);
  assert.equal(calls.storage, 0);
});

test("malformed JSON, arrays, null, unknown actions and missing inputs are rejected", async () => {
  for (const body of ["{", "[]", "null", { ...request(), op: "reset" }, { op: "read", storeId: "fictional-east", month: "2026-10" }]) {
    const { deps, calls } = fixture();
    assert.equal((await call({ deps, body })).status, 400);
    assert.equal(calls.storage, 0);
  }
});

test("a JSON request uses the contract's explicit read projection", async () => {
  const { deps, calls } = fixture();
  const out = await call({ deps, body: JSON.stringify(request()) });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { result: { published: { label: "fixture-publication" } } });
  assert.equal(out.headers["Cache-Control"], "no-store");
  assert.equal(calls.storage, 1);
});

test("save receipts replay through the API with trusted actor and clock", async () => {
  const { deps, calls } = fixture();
  const first = await call({ deps, body: request("save") });
  const second = await call({ deps, body: request("save") });
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.equal(second.body.replayed, true);
  assert.equal(calls.planned.length, 1);
  assert.equal(calls.planned[0].actor.id, "fixture-manager");
  assert.equal(calls.planned[0].now, "2026-10-18T12:00:00.000Z");
});

test("store authorization must be exactly true, never a truthy value", async () => {
  for (const permission of [false, undefined, "true", { allowed: true }]) {
    const { deps, calls } = fixture();
    deps.authorize = () => permission;
    assert.equal((await call({ deps })).status, 403);
    assert.equal(calls.storage, 0);
  }
  const { deps, calls } = fixture();
  assert.equal((await call({ deps, body: { ...request(), storeId: "fictional-west" } })).status, 403);
  assert.equal(calls.storage, 0);
});

test("known conflicts and validation failures have stable safe response codes", async () => {
  for (const [code, status] of [["conflict", 409], ["idempotency-conflict", 409], ["contract-rejected", 422]]) {
    const { deps } = fixture();
    deps.contract.plan = () => { throw new SchedulerError(code); };
    const out = await call({ deps, body: request("save") });
    assert.equal(out.status, status);
    assert.deepEqual(out.body, { error: code });
  }
});

test("unexpected auth, contract and storage exceptions reveal no internal details", async () => {
  for (const change of [
    (deps) => { deps.authenticate = () => { throw new Error("private auth details"); }; },
    (deps) => { deps.contract.projectRead = () => { throw new Error("private draft details"); }; },
    (deps) => { deps.persistence.read = () => { throw new Error("private storage details"); }; },
  ]) {
    const { deps } = fixture();
    change(deps);
    const out = await call({ deps });
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { error: "storage-unavailable" });
  }
});

test("source-only modules contain no service, credential, existing-store or activity adapter", () => {
  for (const path of ["../api/scheduler.mjs", "../api/_scheduler-store.mjs"]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|createClient|\bfetch\s*\(|https?:\/\/|_store-merge|app_data|appendActivity/);
  }
});

test("raw body byte limits precede JSON parsing and contract validation", async () => {
  for (const body of ["{".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes + 1),
    `"${"é".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes / 2)}"`]) {
    const { deps, calls } = fixture();
    const out = await call({ deps, body });
    assert.equal(out.status, 413);
    assert.deepEqual(out.body, { error: "request-too-large" });
    assert.equal(calls.validated, 0);
    assert.equal(calls.storage, 0);
  }
});

test("an exact raw-body byte limit is accepted, with no internal framing penalty", async () => {
  const body = request("save");
  body.input.text = "";
  body.input.text = "x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes - Buffer.byteLength(JSON.stringify(body), "utf8"));
  const { deps } = fixture();
  const out = await call({ deps, body: JSON.stringify(body) });
  assert.equal(out.status, 200);
});

test("deep parsed JSON and oversized object bodies never reach the contract validator", async () => {
  const depth = 10_000;
  const deep = '{"op":"read","storeId":"fictional-east","month":"2026-10","input":' +
    '{"child":'.repeat(depth) + 'null' + '}'.repeat(depth) + '}';
  for (const body of [deep, { ...request(), input: { values: Array(400_000).fill(null) } }]) {
    const { deps, calls } = fixture();
    assert.equal((await call({ deps, body })).status, 413);
    assert.equal(calls.validated, 0);
    assert.equal(calls.storage, 0);
  }
});

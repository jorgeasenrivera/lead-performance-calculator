import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { ATOMIC_SCHEDULER_CAPABILITY, createSchedulerBoundary, SchedulerError, SCHEDULER_TRANSPORT_LIMITS } from "../api/_scheduler-store.mjs";

const clone = (value) => structuredClone(value);
const address = ({ storeId, month }) => JSON.stringify([storeId, month]);
const scope = { storeId: "fictional-east", month: "2026-10" };
const manager = { id: "fixture-manager" };
const reader = { id: "fixture-reader" };
const command = (op = "save", input = {}, requestId = "request-1") => ({
  op, ...scope, input: op === "read" ? { kind: "published", ...input } : { expectedDraftRev: 1, ...input },
  ...(op === "read" ? {} : { requestId }),
});
const rejected = (promise, code) => assert.rejects(promise, (error) => error instanceof SchedulerError && error.code === code);

/* This is a transaction-wrapper fixture, not a copy of C113. Its operation
   list is opaque. A WeakMap supplies synthetic effects solely so tests can see
   a working-copy commit and rollback. No scheduler algorithm runs here. */
function world() {
  const seed = () => ({
    draftRev: 1, publishedRev: 1, draft: { label: "private draft" }, published: { label: "published" },
    neighbors: { previous: 0, next: 4 },
    versions: { draft: { 1: "immutable-draft-1" }, published: { 1: "immutable-published-1" } },
    audit: [{ hash: "fixture-seed", actor: "seed" }],
  });
  let state = { aggregates: { [address(scope)]: seed() }, receipts: {} };
  let epoch = 0;
  let queue = Promise.resolve();
  const effects = new WeakMap();
  const calls = { read: 0, transaction: 0, plan: 0, apply: 0, clock: 0, validate: 0, authorized: [] };
  const flags = {};
  let lastPlan;
  const snapshotFor = (data, at) => clone(data.aggregates[address(at)] || null);
  const persistence = {
    capabilities: { [ATOMIC_SCHEDULER_CAPABILITY]: true },
    async read(at) { calls.read++; return snapshotFor(state, at); },
    async transaction(at, callback) {
      calls.transaction++;
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const startingEpoch = epoch;
        const staged = clone(state);
        const tx = {
          async snapshot() { return snapshotFor(staged, at); },
          async getReceipt(key) { return clone(staged.receipts[key] || null); },
          async apply(plan) {
            calls.apply++;
            assert.equal(plan, lastPlan, "the exact unchanged plan reaches apply");
            assert.equal(plan.authorization, "not-checked");
            if (flags.failApply) throw new Error("synthetic apply failure");
            if (flags.refuseApply) return false;
            effects.get(plan)(staged.aggregates[address(at)]);
            return true;
          },
          async putReceipt(receipt) {
            if (flags.failReceipt) throw new Error("synthetic receipt failure");
            staged.receipts[receipt.key] = clone(receipt);
            return flags.refuseReceipt ? false : true;
          },
        };
        if (flags.removeTransactionMethod) delete tx[flags.removeTransactionMethod];
        const result = await callback(tx);
        if (flags.beforeCommit) await flags.beforeCommit();
        if (epoch !== startingEpoch) throw new SchedulerError("conflict");
        if (flags.failCommit) throw new Error("synthetic commit failure");
        state = staged;
        epoch++;
        if (flags.loseReply) { flags.loseReply = false; throw new Error("synthetic lost response after commit"); }
        return result;
      } finally { release(); }
    },
  };
  const contract = {
    validateRequest(request) {
      calls.validate++;
      if (request.storeId !== "fictional-east" && request.storeId !== "fictional-west") return false;
      if (request.month !== "2026-10") return false;
      if (request.op === "read") return ["draft", "published"].includes(request.input.kind);
      return Number.isSafeInteger(request.input.expectedDraftRev) && request.input.expectedDraftRev >= 0;
    },
    plan({ request, actor, now, snapshot }) {
      calls.plan++;
      if (request.input.expectedDraftRev !== snapshot.draftRev) throw new SchedulerError("conflict");
      if (request.input.reviewedNeighbors && !isDeepStrictEqual(request.input.reviewedNeighbors, snapshot.neighbors)) {
        throw new SchedulerError("conflict");
      }
      const publish = request.op === "publish";
      const resultingHead = { draftRev: snapshot.draftRev + 1, publishedRev: snapshot.publishedRev + (publish ? 1 : 0) };
      const auditEntry = { actor: actor.id, at: now, prevHash: snapshot.audit.at(-1).hash,
        hash: `fixture-${calls.plan}`, action: request.op };
      const plan = Object.freeze({
        kind: request.op, storeId: request.storeId, month: request.month, atomic: true,
        authorization: "not-checked", ops: Object.freeze([Object.freeze({ fixture: "opaque C113 operations" })]),
        auditEntry: Object.freeze(auditEntry), resultingHead: Object.freeze(resultingHead),
      });
      effects.set(plan, (aggregate) => {
        aggregate.draftRev = resultingHead.draftRev;
        aggregate.draft = clone(request.input.payload || aggregate.draft);
        aggregate.versions.draft[aggregate.draftRev] = `immutable-draft-${aggregate.draftRev}`;
        if (publish) {
          aggregate.publishedRev = resultingHead.publishedRev;
          aggregate.published = clone(aggregate.draft);
          aggregate.versions.published[aggregate.publishedRev] = `immutable-published-${aggregate.publishedRev}`;
        }
        aggregate.audit.push(clone(auditEntry));
      });
      lastPlan = plan;
      if (flags.badPlan) return { ...plan, ...flags.badPlan };
      return plan;
    },
    projectRead({ request, snapshot }) { return { revision: snapshot[`${request.input.kind}Rev`], schedule: snapshot[request.input.kind] }; },
    projectResult({ plan }) { return { head: plan.resultingHead }; },
  };
  const deps = {
    contract, persistence,
    authorize({ actor, request }) {
      calls.authorized.push(clone({ actor, request }));
      if (flags.deny) return false;
      if (request.storeId !== scope.storeId) return false;
      return actor.id === manager.id || (actor.id === reader.id && request.op === "read" && request.input.kind === "published");
    },
    now() { calls.clock++; return "2026-10-18T12:00:00.000Z"; },
  };
  return {
    deps, flags, calls, boundary: createSchedulerBoundary(deps),
    state: () => clone(state),
    externalChange(change) { change(state); epoch++; },
    lastPlan: () => lastPlan,
  };
}

test("the wrapper commits synthetic draft, publication, audit and receipt together", async () => {
  const w = world();
  const initial = w.state();
  const result = await w.boundary.execute(command("publish", { reviewedNeighbors: { previous: 0, next: 4 } }), manager);
  assert.deepEqual(result, { result: { head: { draftRev: 2, publishedRev: 2 } }, replayed: false });
  const state = w.state();
  const next = state.aggregates[address(scope)];
  assert.equal(next.draftRev, 2);
  assert.equal(next.publishedRev, 2);
  assert.equal(next.audit.length, 2);
  assert.equal(next.audit[1].prevHash, "fixture-seed");
  assert.equal(next.audit[1].actor, manager.id);
  assert.equal(next.audit[1].at, "2026-10-18T12:00:00.000Z");
  assert.equal(Object.keys(state.receipts).length, 1);
  assert.equal(next.versions.draft[1], initial.aggregates[address(scope)].versions.draft[1]);
  assert.equal(next.versions.published[1], initial.aggregates[address(scope)].versions.published[1]);
  assert.equal(w.lastPlan().authorization, "not-checked");
});

test("saving a synthetic draft leaves the published version unchanged", async () => {
  const w = world();
  await w.boundary.execute(command("save", { payload: { memberships: ["second", "first"] } }), manager);
  const state = w.state().aggregates[address(scope)];
  assert.deepEqual(state.draft.memberships, ["second", "first"]);
  assert.equal(state.draftRev, 2);
  assert.equal(state.publishedRev, 1);
  assert.deepEqual(state.published, { label: "published" });
});

for (const flag of ["failApply", "refuseApply", "failReceipt", "refuseReceipt", "failCommit"]) {
  test(`${flag} rolls back the complete synthetic envelope`, async () => {
    const w = world();
    const before = w.state();
    w.flags[flag] = true;
    await rejected(w.boundary.execute(command("publish"), manager), flag === "refuseApply" ? "conflict" : "storage-unavailable");
    assert.deepEqual(w.state(), before);
  });
}

test("stale revisions leave versions, audit and receipt unchanged", async () => {
  const w = world();
  const before = w.state();
  await rejected(w.boundary.execute(command("save", { expectedDraftRev: 0 }), manager), "conflict");
  assert.deepEqual(w.state(), before);
});

test("publication keeps revision-zero neighbors in the injected planner input", async () => {
  const w = world();
  const before = w.state();
  await rejected(w.boundary.execute(command("publish", { reviewedNeighbors: { previous: 1, next: 4 } }), manager), "conflict");
  assert.deepEqual(w.state(), before);
  await w.boundary.execute(command("publish", { reviewedNeighbors: { previous: 0, next: 4 } }), manager);
  assert.equal(w.calls.apply, 1);
});

test("a neighbor created during commit prevents all target-month writes", async () => {
  const w = world();
  w.flags.beforeCommit = () => w.externalChange((state) => { state.aggregates[address(scope)].neighbors.previous = 1; });
  await rejected(w.boundary.execute(command("publish", { reviewedNeighbors: { previous: 0, next: 4 } }), manager), "conflict");
  const state = w.state();
  assert.equal(state.aggregates[address(scope)].neighbors.previous, 1);
  assert.equal(state.aggregates[address(scope)].draftRev, 1);
  assert.equal(state.aggregates[address(scope)].publishedRev, 1);
  assert.equal(state.aggregates[address(scope)].audit.length, 1);
  assert.deepEqual(state.receipts, {});
});

test("two stale-tab commands cannot both win, including publish versus edit", async () => {
  const w = world();
  const results = await Promise.allSettled([
    w.boundary.execute(command("publish", {}, "publish-1"), manager),
    w.boundary.execute(command("save", {}, "save-1"), manager),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "conflict");
  assert.equal(w.state().aggregates[address(scope)].audit.length, 2);
});

test("sequential and concurrent identical retries replay once without planning again", async () => {
  const w = world();
  const request = command("publish");
  const [first, second] = await Promise.all([w.boundary.execute(request, manager), w.boundary.execute(request, manager)]);
  const third = await w.boundary.execute(request, manager);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(third.replayed, true);
  assert.deepEqual(first.result, second.result);
  assert.equal(w.calls.plan, 1);
  assert.equal(w.calls.clock, 1);
  assert.equal(w.calls.apply, 1);
});

test("a lost response after commit is recovered through the same receipt", async () => {
  const w = world();
  w.flags.loseReply = true;
  await rejected(w.boundary.execute(command(), manager), "storage-unavailable");
  assert.equal(w.state().aggregates[address(scope)].draftRev, 2);
  assert.equal((await w.boundary.execute(command(), manager)).replayed, true);
  assert.equal(w.calls.apply, 1);
});

test("an old successful receipt survives newer commands without overwriting them", async () => {
  const w = world();
  const first = await w.boundary.execute(command(), manager);
  await w.boundary.execute(command("save", { expectedDraftRev: 2 }, "second-command"), manager);
  const replay = await w.boundary.execute(command(), manager);
  assert.deepEqual(replay.result, first.result);
  assert.equal(w.state().aggregates[address(scope)].draftRev, 3);
  assert.equal(w.state().aggregates[address(scope)].audit.length, 3);
});

test("reusing a key with changed payload, operation or revision is rejected", async () => {
  for (const request of [command("save", { payload: { changed: true } }), command("publish"), command("save", { expectedDraftRev: 2 })]) {
    const w = world();
    await w.boundary.execute(command(), manager);
    const before = w.state();
    await rejected(w.boundary.execute(request, manager), "idempotency-conflict");
    assert.deepEqual(w.state(), before);
  }
});

test("object-key order is canonical but membership-list order remains significant", async () => {
  const w = world();
  await w.boundary.execute(command("save", { payload: { a: 1, b: 2, memberships: ["one", "two"] } }), manager);
  const same = command("save", { payload: { memberships: ["one", "two"], b: 2, a: 1 } });
  assert.equal((await w.boundary.execute(same, manager)).replayed, true);
  await rejected(w.boundary.execute(command("save", { payload: { a: 1, b: 2, memberships: ["two", "one"] } }), manager), "idempotency-conflict");
});

test("authorization is rechecked before replay or any state access", async () => {
  const w = world();
  await w.boundary.execute(command(), manager);
  const calls = w.calls.transaction;
  w.flags.deny = true;
  await rejected(w.boundary.execute(command(), manager), "forbidden");
  assert.equal(w.calls.transaction, calls);
  assert.equal(w.calls.read, 0);
});

test("another store, another identity, and a published reader cannot access mutation receipts", async () => {
  const w = world();
  await w.boundary.execute(command(), manager);
  for (const [request, actor] of [
    [{ ...command(), storeId: "fictional-west" }, manager],
    [command(), { id: "other-manager" }],
    [command(), reader],
  ]) await rejected(w.boundary.execute(request, actor), "forbidden");
  assert.equal(w.calls.transaction, 1);
});

test("published reads use an explicit projection and cannot leak draft, audit or receipts", async () => {
  const w = world();
  assert.deepEqual(await w.boundary.execute(command("read"), reader), { result: { revision: 1, schedule: { label: "published" } } });
  await rejected(w.boundary.execute(command("read", { kind: "draft" }), reader), "forbidden");
  assert.equal(w.calls.read, 1);
  assert.equal(w.calls.transaction, 0);
});

test("caller and response objects cannot mutate committed state or receipt results", async () => {
  const w = world();
  const request = command("save", { payload: { memberships: ["one", "two"] } });
  const result = await w.boundary.execute(request, manager);
  request.input.payload.memberships.push("forged");
  result.result.head.draftRev = 900;
  assert.deepEqual(w.state().aggregates[address(scope)].draft.memberships, ["one", "two"]);
  const replay = await w.boundary.execute(command("save", { payload: { memberships: ["one", "two"] } }), manager);
  assert.equal(replay.result.head.draftRev, 2);
});

test("missing atomic capability or transaction methods fail closed", async () => {
  for (const value of [undefined, false, "true"]) {
    const w = world();
    w.deps.persistence.capabilities[ATOMIC_SCHEDULER_CAPABILITY] = value;
    await rejected(w.boundary.execute(command(), manager), "storage-not-configured");
    assert.equal(w.calls.transaction, 0);
  }
  for (const method of ["snapshot", "getReceipt", "apply", "putReceipt"]) {
    const w = world();
    const before = w.state();
    w.flags.removeTransactionMethod = method;
    await rejected(w.boundary.execute(command(), manager), "storage-not-configured");
    assert.deepEqual(w.state(), before);
  }
});

test("non-atomic, cross-scope or misrepresented plans never reach apply", async () => {
  for (const badPlan of [{ atomic: false }, { storeId: "fictional-west" }, { month: "2026-11" }, { authorization: "checked" }, { auditEntry: null }]) {
    const w = world();
    w.flags.badPlan = badPlan;
    await rejected(w.boundary.execute(command(), manager), "contract-rejected");
    assert.equal(w.calls.apply, 0);
  }
});

test("transport shape rejects identity injection and invalid JSON values", async () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const bad of [null, [], { ...command(), actor: manager }, { ...command(), requestId: "" },
    command("read", {}, "ignored"), { ...command(), input: cyclic }, { ...command(), input: { count: NaN } }]) {
    // command(read) deliberately omits requestId; add it for this negative case.
    const request = bad?.op === "read" ? { ...bad, requestId: "unexpected" } : bad;
    const w = world();
    await rejected(w.boundary.execute(request, manager), "invalid-request");
    assert.equal(w.calls.transaction, 0);
    assert.equal(w.calls.read, 0);
  }
});

test("missing contract functions and an unauthenticated actor cannot reach storage", async () => {
  const w = world();
  await rejected(w.boundary.execute(command(), null), "unauthenticated");
  delete w.deps.contract.plan;
  await rejected(w.boundary.execute(command(), manager), "contract-not-configured");
  assert.equal(w.calls.transaction, 0);
});

test("an exact-byte-limit request works and one extra byte is rejected before validation", async () => {
  const atLimit = command("save", { payload: { text: "" } });
  const overhead = Buffer.byteLength(JSON.stringify(atLimit), "utf8");
  atLimit.input.payload.text = "x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes - overhead);
  const w = world();
  assert.equal((await w.boundary.execute(atLimit, manager)).replayed, false);
  assert.equal((await w.boundary.execute(atLimit, manager)).replayed, true);
  const tooLarge = structuredClone(atLimit);
  tooLarge.input.payload.text += "x";
  const blocked = world();
  await rejected(blocked.boundary.execute(tooLarge, manager), "request-too-large");
  assert.equal(blocked.calls.validate, 0);
  assert.equal(blocked.calls.authorized.length, 0);
  assert.equal(blocked.calls.transaction, 0);
});

test("multibyte strings, escaped values and property names consume the byte budget", async () => {
  for (const payload of [
    { text: "é".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes / 2) },
    { text: "\u0000".repeat(Math.ceil(SCHEDULER_TRANSPORT_LIMITS.bytes / 6)) },
    { ["x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes)]: null },
  ]) {
    const w = world();
    await rejected(w.boundary.execute(command("save", { payload }), manager), "request-too-large");
    assert.equal(w.calls.validate, 0);
    assert.equal(w.calls.transaction, 0);
  }
});

test("the exact node limit survives fingerprinting and excess width stops before validation", async () => {
  // Root, four scalar fields, input, expected revision and payload array are 8.
  const payload = Array(SCHEDULER_TRANSPORT_LIMITS.nodes - 8).fill(null);
  const w = world();
  const request = command("save", { payload });
  assert.equal((await w.boundary.execute(request, manager)).replayed, false);
  assert.equal((await w.boundary.execute(request, manager)).replayed, true);
  for (const oversized of [Array(SCHEDULER_TRANSPORT_LIMITS.nodes).fill(null),
    Object.fromEntries(Array.from({ length: SCHEDULER_TRANSPORT_LIMITS.nodes }, (_, i) => [`n${i}`, null]))]) {
    const blocked = world();
    await rejected(blocked.boundary.execute(command("save", { payload: oversized }), manager), "request-too-large");
    assert.equal(blocked.calls.validate, 0);
    assert.equal(blocked.calls.transaction, 0);
  }
});

test("depth is bounded during the first traversal, including an adversarial deep value", async () => {
  const nested = (count) => { let value = null; for (let i = 0; i < count; i++) value = { child: value }; return value; };
  const w = world();
  // Root depth is 0, input is 1, and the outer payload object starts at 2.
  await w.boundary.execute(command("save", { payload: nested(SCHEDULER_TRANSPORT_LIMITS.depth - 2) }), manager);
  for (const depth of [SCHEDULER_TRANSPORT_LIMITS.depth - 1, 10_000]) {
    const blocked = world();
    await rejected(blocked.boundary.execute(command("save", { payload: nested(depth) }), manager), "request-too-large");
    assert.equal(blocked.calls.validate, 0);
    assert.equal(blocked.calls.transaction, 0);
  }
});

test("overlarge or malformed trusted-port results stay sanitized storage errors", async () => {
  for (const result of [{ data: "x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes) }, { value: undefined }]) {
    const w = world();
    w.deps.contract.projectRead = () => result;
    await rejected(w.boundary.execute(command("read"), manager), "storage-unavailable");
  }
});

test("non-JSON accessors are rejected without invoking them", async () => {
  let accessed = false;
  const payload = [null];
  Object.defineProperty(payload, 0, { enumerable: true, get() { accessed = true; return null; } });
  const w = world();
  await rejected(w.boundary.execute(command("save", { payload }), manager), "invalid-request");
  assert.equal(accessed, false);
  assert.equal(w.calls.validate, 0);
});

test("overlarge response framing is rejected before apply or receipt staging", async () => {
  for (const result of ["x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes - 2),
    Array(SCHEDULER_TRANSPORT_LIMITS.nodes - 1).fill(null)]) {
    const w = world();
    w.deps.contract.projectResult = () => result;
    const before = w.state();
    await rejected(w.boundary.execute(command(), manager), "storage-unavailable");
    assert.equal(w.calls.apply, 0);
    assert.deepEqual(w.state(), before);
  }
});

test("an exact-limit response is committed and replayed without a framing failure", async () => {
  const w = world();
  const result = { value: "" };
  result.value = "x".repeat(SCHEDULER_TRANSPORT_LIMITS.bytes - Buffer.byteLength(JSON.stringify({ result, replayed: false }), "utf8"));
  w.deps.contract.projectResult = () => result;
  assert.equal((await w.boundary.execute(command(), manager)).replayed, false);
  assert.equal((await w.boundary.execute(command(), manager)).replayed, true);
  assert.equal(w.calls.apply, 1);
});

test("the public response includes only result and replay status from the transaction", async () => {
  const w = world();
  const transaction = w.deps.persistence.transaction;
  w.deps.persistence.transaction = async (...args) => ({ ...(await transaction(...args)), privateSnapshot: "must not leave storage" });
  const result = await w.boundary.execute(command(), manager);
  assert.deepEqual(Object.keys(result).sort(), ["replayed", "result"]);
});

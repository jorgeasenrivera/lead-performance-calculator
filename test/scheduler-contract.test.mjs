import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createSchedulerContract, INPUT_BINDING_VERSION, CONTEXT_CAPABILITY } from "../api/_scheduler-contract.mjs";
import { createSchedulerBoundary, SchedulerError, ATOMIC_SCHEDULER_CAPABILITY } from "../api/_scheduler-store.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const clone = structuredClone;
const STORE = "fixture-east", MONTH = "2026-10", NOW = "2026-10-19T04:00:00.000Z";
const actor = { id: "fixture-manager", fixtureCapability: "manage" };
const scope = { storeId: STORE, month: MONTH };
const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ?
  Object.fromEntries(Object.keys(v).sort().map((key) => [key, sort(v[key])])) : v;
const canonical = (v) => JSON.stringify(sort(v));
const monthBefore = (month, delta) => {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const makeDraft = (month = MONTH) => ({ storeId: STORE, month, store: {
  timezone: "America/New_York",
  people: [{ id: "person-a", name: "Synthetic Person", start: 9, end: 17, off: [], maxHours: 40 }],
  rules: [{ effective: "2014-01-01", open: 9, close: 17, minimum: 1, capacity: 8, useCapacity: false, closedDays: [0, 1, 2, 3, 4, 5, 6], holidays: {} }],
  teams: [{ id: "team-a", name: "Synthetic Team" }],
  memberships: [{ storeId: STORE, personId: "person-a", teamIds: ["team-a"], from: "2014-01-01", to: "2100-12-31", unknown: false }],
}, overrides: {} });

// CI mode checks this adapter's contract with explicit port doubles. The second
// mode imports exact original artifacts, never fetches or copies module source,
// and aborts before imports if any required path or pinned hash is wrong.
const C113_HASHES = {
  "audit-entry.mjs": "4955fe594bb3736c0525f3c9975dfd43f53b4bc14394b6ced1a9dd0cc1b06300",
  "cas.mjs": "35de09c8e30a22272b61c051d45464fae5be0c076f1b30fe7fba7484d40929e6",
  "deserialize.mjs": "2d7a0c11148bbb90317805f750e792e5ae427a8eeafe4a26ba0ce985c1126ac8",
  "envelope.mjs": "c7df30414b4a37190c5bbf1e160cee877eefffb4fc54cdba4a4ea10c09a141e9",
  "fake-port.mjs": "5c2eaffb4782a8f2bf8ed68f0ebcc0fa0b260d047a95686b6e5a54c3cf5d16e8",
  "identity.mjs": "2c5839019f28c8675d8f8e23e8d8eca5f0d72fcf41c40fa5e6a49a56b0accd1e",
  "publish-plan.mjs": "fbe774b576f3661c8b5db56d5be46a71a4929e4816827bc9fdad49e98695a0ba",
  "recovery.mjs": "e91f2a0fdb2889b696687671fc02b84d363a8064790dd9b1554386c6b158bdd0",
  "serialize.mjs": "5867e828fedf730c79b62d218af8ca8da3c3827f28e9b109cb142c3d04a55905",
  "validate.mjs": "bbdc8c822079691649c7cf5a7bfb364b2ab82ea85e3d8ce34827be1e6170e7ad",
};
const PROVIDER_HASHES = {
  "scripts/scheduler-performance/month-review.mjs": "3be221ae7e062e1d584d2e7ad3f765715ae5ec7fbf89dea43c539d4ef68b5a2e",
  "scripts/scheduler-performance/month-model.mjs": "dd537e94ee3a31bc9938bdf03f88574ebb910963e839628e0df4463034249acf",
  "scripts/scheduler-performance/name-key.mjs": "3919ec1154836daabf2149660cb6a21a307db5e4afbd69def5ae91da338fcb92",
  "scripts/scheduler-performance/team-model.mjs": "7c25f9bc67b18f6b033f35657cf0abedc5999bea5a763378246d928a61c10ea5",
  "scripts/scheduler-performance/shift-intervals.mjs": "b56d8530bd0f49bebf014d1afc0df51357ad3871ec8d71692010b5d16ad0950f",
  "scripts/scheduler-proposal/model.mjs": "4da9871871ffc052c5732b90b63e138e81bdda0a025a3d691ba84d41740be0a1",
};

function portDoubles() {
  // These are interface doubles, not a substitute implementation of C113 or
  // the planner. Synthetic effects are attached to otherwise opaque plans.
  const effects = new WeakMap();
  const c113 = {
    validStoreId: (id) => id === STORE,
    validMonth: (month) => /^20\d\d-(0[1-9]|1[0-2])$/.test(month),
    validRev: (rev, min = 1) => Number.isSafeInteger(rev) && rev >= min,
    adjacentMonths: (month) => ({ prev: monthBefore(month, -1), next: monthBefore(month, 1) }),
    persistable: (draft) => Object.fromEntries(Object.entries(draft).filter(([key]) => !["accepted", "reviewFingerprint"].includes(key))),
    validateDraft: (draft, expected = {}) => ({ ok: !!draft?.store?.people && draft.storeId === STORE &&
      (!expected.month || draft.month === expected.month) && !Object.hasOwn(draft, "extra") }),
    canonicalize: (value) => ({ ok: true, text: canonical(value) }),
    deserializeVersion(text, expected = {}) {
      try {
        const value = JSON.parse(text);
        return Object.entries(expected).every(([key, wanted]) => value[key] === wanted) ? { ok: true, ...value } : { ok: false };
      } catch { return { ok: false }; }
    },
  };
  const makePlan = (input, publication) => {
    const head = input.head || { draftRev: 0, publishedRev: 0 };
    if ((publication ? input.draftRev : input.baseRev) !== head.draftRev) return { ok: false, code: "stale" };
    if (publication && input.review.openIssues) return { ok: false, code: "open-issues" };
    const resultingHead = { draftRev: head.draftRev + 1, publishedRev: head.publishedRev + (publication ? 1 : 0) };
    const plan = { kind: publication ? "publication" : "draft-save", storeId: input.storeId, month: input.month,
      atomic: true, authorization: "not-checked", ops: [{ fixture: "opaque operations" }],
      auditEntry: { actor: input.actor, at: input.at }, resultingHead };
    effects.set(plan, (state) => {
      const key = `${input.storeId}/${input.month}`;
      const old = state.heads[key] || { draftRev: 0, publishedRev: 0 };
      if (old.draftRev !== head.draftRev) return { ok: false, code: "stale" };
      state.heads[key] = clone(resultingHead);
      const write = (kind, rev) => { state.versions[`${key}/${kind}/${rev}`] = JSON.stringify({ kind, storeId: input.storeId,
        month: input.month, rev, draft: c113.persistable(input.draft) }); };
      write("draft", resultingHead.draftRev);
      if (publication) write("published", resultingHead.publishedRev);
      (state.audit[key] ||= []).push({ ...plan.auditEntry, hash: "0".repeat(16) });
      return { ok: true, applied: 1 };
    });
    return { ok: true, plan };
  };
  c113.planDraftSave = (input) => makePlan(input, false);
  c113.planPublication = (input) => makePlan(input, true);
  const createFakePort = () => {
    let state = { heads: {}, versions: {}, audit: {} };
    return {
      apply(plan) { const staged = clone(state), result = effects.get(plan)(staged); if (result.ok) state = staged; return result; },
      head: (storeId, month) => clone(state.heads[`${storeId}/${month}`] || null),
      versionText: (kind, storeId, month, rev) => state.versions[`${storeId}/${month}/${kind}/${rev}`] || null,
      lastAuditHash: (storeId, month) => state.audit[`${storeId}/${month}`]?.at(-1)?.hash || null,
      snapshot: () => canonical(state),
    };
  };
  const reviewProvider = {
    REVIEW_DEFINITION: "month-review/1", canonicalJson: canonical,
    reviewSpan(month) {
      const start = `${month}-01`, end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
      return { months: month === "2021-02" ? [month] : [monthBefore(month, -1), month, monthBefore(month, 1)], days: [start, end] };
    },
    validateReviewInput: (input) => clone(input),
    reviewMonth(input, { sha256: hash }) {
      const digest = hash(canonical(input));
      return { definition: "month-review/1", digest, inputDigest: digest,
        openIssues: input.months[input.scope.month].store.rules[0].closedDays.length === 7 ? 0 : 1 };
    },
    verifyReview(input, claim, options) {
      const result = this.reviewMonth(input, options);
      return result.digest === claim.digest ? { ok: true, digest: result.digest, openIssues: result.openIssues } : { ok: false, reason: "digest" };
    },
  };
  return { c113, reviewProvider, createFakePort };
}

async function modules() {
  const mode = process.env.SCHEDULER_ARTIFACT_MODE;
  if (!mode) return { ...portDoubles(), mode: "port doubles" };
  assert.equal(mode, "original-r1", "unknown artifact mode must not fall back to doubles");
  for (const name of ["SCHEDULER_C113_ROOT", "SCHEDULER_PROVIDER_ROOT", "SCHEDULER_C113_ARCHIVE"]) assert.ok(process.env[name], `${name} is required`);
  const archive = fs.readFileSync(process.env.SCHEDULER_C113_ARCHIVE);
  assert.equal(archive.length, 59973);
  assert.equal(sha256(archive), "909b442cebe6c9dec1c870b9cde96baf1f40582b97cfc0744a3fac127c58b622", "C113 archive hash mismatch");
  const root = path.join(process.env.SCHEDULER_C113_ROOT, "scripts/scheduler-performance/persistence");
  for (const [file, hash] of Object.entries(C113_HASHES)) assert.equal(sha256(fs.readFileSync(path.join(root, file))), hash, `C113 hash mismatch: ${file}`);
  for (const [file, hash] of Object.entries(PROVIDER_HASHES)) assert.equal(sha256(fs.readFileSync(path.join(process.env.SCHEDULER_PROVIDER_ROOT, file))), hash, `provider hash mismatch: ${file}`);
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const parts = await Promise.all(["identity.mjs", "validate.mjs", "serialize.mjs", "deserialize.mjs", "envelope.mjs", "cas.mjs", "publish-plan.mjs"].map(load));
  return { c113: Object.assign({}, ...parts), createFakePort: (await load("fake-port.mjs")).createFakePort,
    reviewProvider: await import(pathToFileURL(path.join(process.env.SCHEDULER_PROVIDER_ROOT, "scripts/scheduler-performance/month-review.mjs")).href),
    mode: "exact provider 5be1a1a + original C113 r1" };
}
const injected = await modules();
test(`adapter test mode: ${injected.mode}`, () => assert.ok(injected.c113 && injected.reviewProvider));

function world() {
  const { c113, reviewProvider, createFakePort } = injected;
  let port = createFakePort(), history = [], receipts = new Map(), queue = Promise.resolve(), transactionNumber = 0;
  let contextRevision = 1;
  const flags = {}, registered = [], appliedPlans = [], calls = { apply: 0, register: 0 };
  const sourceNames = ["baseStore", "teamState", "baseAssignments", "history", "planningPolicy"];
  const opened = (text) => { const value = c113.deserializeVersion(text); assert.equal(value.ok, true); return value.draft; };
  function snapshot(at, current = port, tx = null) {
    const head = current.head(at.storeId, at.month);
    const state = { scope: { ...at }, head, draftText: head?.draftRev ? current.versionText("draft", at.storeId, at.month, head.draftRev) : null,
      publishedText: head?.publishedRev ? current.versionText("published", at.storeId, at.month, head.publishedRev) : null,
      prevAuditHash: current.lastAuditHash(at.storeId, at.month) };
    if (head?.draftRev) {
      const draft = opened(state.draftText), calendar = c113.adjacentMonths(at.month), span = reviewProvider.reviewSpan(at.month);
      const enrich = (value) => ({ ...clone(value.store), id: at.storeId, history: [] });
      const months = { [at.month]: { store: enrich(draft), overrides: clone(draft.overrides) } };
      state.adjacentNow = {}; state.neighborDraftTexts = {};
      for (const side of ["prev", "next"]) {
        const month = calendar[side], rev = month === null ? null : (current.head(at.storeId, month)?.draftRev || 0);
        state.adjacentNow[side] = rev;
        state.neighborDraftTexts[side] = rev ? current.versionText("draft", at.storeId, month, rev) : null;
        if (rev && span.months.includes(month)) { const d = opened(state.neighborDraftTexts[side]); months[month] = { store: enrich(d), overrides: d.overrides }; }
      }
      state.reviewInput = { definition: "month-review/1", scope: { ...at }, baseStore: enrich(draft),
        teamState: { teams: clone(draft.store.teams), memberships: clone(draft.store.memberships) }, months,
        base: Object.fromEntries(span.days.map((day) => [day, null])) };
      const review = reviewProvider.reviewMonth(state.reviewInput, { sha256 });
      state.reviewBinding = { version: INPUT_BINDING_VERSION, scope: { ...at }, inputVersion: { id: "fixture-input", revision: contextRevision },
        inputDigest: review.inputDigest, draftRev: head.draftRev, publishedRev: head.publishedRev, adjacent: clone(state.adjacentNow),
        sources: Object.fromEntries(sourceNames.map((name) => [name, { id: `fixture-${name}`, revision: contextRevision }])) };
      state.contextTransaction = tx;
    }
    flags.alterSnapshot?.(state);
    return state;
  }
  const persistence = {
    capabilities: { [ATOMIC_SCHEDULER_CAPABILITY]: true },
    read: async (at) => snapshot(at),
    async transaction(at, work) {
      const before = queue; let release; queue = new Promise((resolve) => { release = resolve; }); await before;
      try {
        const staged = createFakePort();
        for (const prior of history) assert.equal(staged.apply(prior).ok, true);
        assert.equal(staged.snapshot(), port.snapshot());
        const stagedHistory = [...history], stagedReceipts = new Map([...receipts].map(([key, value]) => [key, clone(value)]));
        const guards = [], id = `transaction-${++transactionNumber}`;
        const transactionContext = { id, capabilities: { [CONTEXT_CAPABILITY]: true }, async register({ binding, bindingDigest }) {
          calls.register++;
          assert.ok(Object.isFrozen(binding) && Object.isFrozen(binding.sources) && Object.isFrozen(binding.sources.history));
          assert.equal(sha256(reviewProvider.canonicalJson(binding)), bindingDigest);
          guards.push(binding); registered.push({ binding, bindingDigest, transactionId: id });
          return flags.badAcknowledgement || { registered: true, transactionId: id, bindingDigest };
        } };
        const result = await work({
          snapshot: async () => snapshot(at, staged, transactionContext),
          getReceipt: async (key) => clone(stagedReceipts.get(key) || null),
          apply: async (plan) => { calls.apply++; assert.equal(plan.authorization, "not-checked"); const applied = staged.apply(plan); if (!applied.ok) throw new SchedulerError("conflict"); appliedPlans.push(plan); stagedHistory.push(plan); return true; },
          putReceipt: async (receipt) => { if (flags.failReceipt) throw new Error("synthetic receipt failure"); stagedReceipts.set(receipt.key, clone(receipt)); return true; },
        });
        if (guards.length && flags.changeContextBeforeCommit) contextRevision++;
        // A real adapter must enforce these predicates in the same database
        // commit. This fake deliberately detects a change after registration.
        for (const binding of guards) if (binding.inputVersion.revision !== contextRevision ||
          Object.values(binding.sources).some((ref) => ref.revision !== contextRevision)) throw new SchedulerError("conflict");
        port = staged; history = stagedHistory; receipts = stagedReceipts;
        if (flags.loseReply) { flags.loseReply = false; throw new Error("synthetic lost reply"); }
        return result;
      } finally { release(); }
    },
  };
  const options = { c113, reviewProvider, sha256 }, contract = createSchedulerContract(options);
  const deps = { contract, persistence, now: () => NOW, authorize: ({ request, actor: who }) => request.storeId === STORE &&
    (who.id === actor.id || who.id === "fixture-reader" && request.op === "read" && request.input.kind === "published") };
  return { options, contract, flags, calls, registered, appliedPlans, boundary: createSchedulerBoundary(deps),
    state: () => port.snapshot(), receipts: () => receipts.size, port: () => port,
    save: (baseRev = 0, month = MONTH, requestId = "save-1", draft = makeDraft(month)) => ({ op: "save", storeId: STORE, month, requestId, input: { baseRev, draft } }),
    publication(draftRev = 1, requestId = "publish-1", month = MONTH) {
      const at = { storeId: STORE, month };
      const review = reviewProvider.reviewMonth(snapshot(at).reviewInput, { sha256 });
      return { op: "publish", ...at, requestId, input: { draftRev, review: { definition: "month-review/1", digest: review.digest } } };
    },
  };
}
const rejects = (promise, code) => assert.rejects(promise, (error) => error instanceof SchedulerError && error.code === code);

test("save, verified publication and published projection use the injected modules", async () => {
  const w = world();
  assert.deepEqual((await w.boundary.execute(w.save(), actor)).result.head, { draftRev: 1, publishedRev: 0 });
  const oldText = w.port().versionText("draft", STORE, MONTH, 1);
  assert.deepEqual((await w.boundary.execute(w.publication(), actor)).result.head, { draftRev: 2, publishedRev: 1 });
  assert.equal(w.port().versionText("draft", STORE, MONTH, 1), oldText);
  assert.equal(w.registered.length, 1);
  assert.equal(w.registered[0].binding.review.definition, "month-review/1");
  assert.match(w.registered[0].binding.review.digest, /^[a-f0-9]{64}$/);
  const answer = await w.boundary.execute({ op: "read", ...scope, input: { kind: "published" } }, { id: "fixture-reader" });
  assert.deepEqual(answer.result, { kind: "published", revision: 1, schedule: makeDraft() });
});

test("context changes after registration roll back the staged plan and receipt", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  const command = w.publication(), before = w.state(); w.flags.changeContextBeforeCommit = true;
  await rejects(w.boundary.execute(command, actor), "conflict");
  assert.equal(w.calls.apply, 2, "the publication reached staged apply before the commit-time conflict");
  assert.equal(w.state(), before); assert.equal(w.receipts(), 1);
});

test("receipt failure rolls back a registered context and the staged publication", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  const before = w.state(); w.flags.failReceipt = true;
  await rejects(w.boundary.execute(w.publication(), actor), "storage-unavailable");
  assert.equal(w.state(), before); assert.equal(w.receipts(), 1);
});

test("lost publication reply and concurrent retries replay without another context registration", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor); const command = w.publication();
  w.flags.loseReply = true; await rejects(w.boundary.execute(command, actor), "storage-unavailable");
  const answers = await Promise.all([w.boundary.execute(command, actor), w.boundary.execute(command, actor)]);
  assert.ok(answers.every((answer) => answer.replayed)); assert.equal(w.calls.register, 1);
});

for (const [name, alter, code] of [
  ["input binding", (s) => { delete s.reviewBinding; }, "storage-unavailable"],
  ["source revision", (s) => { delete s.reviewBinding.sources.history; }, "storage-unavailable"],
  ["input digest", (s) => { s.reviewBinding.inputDigest = "0".repeat(64); }, "storage-unavailable"],
  ["draft revision", (s) => { s.reviewBinding.draftRev++; }, "storage-unavailable"],
  ["scope binding", (s) => { s.reviewBinding.scope.month = "2026-09"; }, "storage-unavailable"],
  ["transaction capability", (s) => { s.contextTransaction.capabilities[CONTEXT_CAPABILITY] = false; }, "contract-not-configured"],
  ["transaction callback", (s) => { delete s.contextTransaction.register; }, "contract-not-configured"],
  ["neighbor version text", (s) => { delete s.neighborDraftTexts.prev; }, "storage-unavailable"],
]) {
  test(`publication fails closed without the exact ${name}`, async () => {
    const w = world(); await w.boundary.execute(w.save(), actor); const command = w.publication(), before = w.state();
    w.flags.alterSnapshot = alter;
    await rejects(w.boundary.execute(command, actor), code);
    assert.equal(w.state(), before); assert.equal(w.calls.register, 0);
  });
}

test("a different persisted draft cannot borrow a valid review input", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor); const command = w.publication();
  w.flags.alterSnapshot = (s) => { s.reviewInput.months[MONTH].store.people[0].name = "Changed"; };
  await rejects(w.boundary.execute(command, actor), "storage-unavailable"); assert.equal(w.calls.register, 0);
});

test("a client claim mismatch and actual computed issues prevent publication", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  const command = w.publication(); command.input.review.digest = "0".repeat(64);
  await rejects(w.boundary.execute(command, actor), "contract-rejected");
  const open = world(), draft = makeDraft(); draft.store.rules[0].closedDays = [];
  await open.boundary.execute(open.save(0, MONTH, "open-save", draft), actor);
  await rejects(open.boundary.execute(open.publication(), actor), "contract-rejected");
  assert.equal(open.calls.register, 0);
});

test("client issue counts, recomputation and context acknowledgements are not accepted", async () => {
  for (const extra of [{ openIssues: 0 }, { recomputedFingerprint: "x" }, { contextTransaction: { registered: true } }]) {
    const w = world(); await w.boundary.execute(w.save(), actor);
    const command = w.publication(); Object.assign(command.input, extra);
    await rejects(w.boundary.execute(command, actor), "invalid-request"); assert.equal(w.calls.register, 0);
  }
});

test("an acknowledgement for a different transaction or manifest fails closed", async () => {
  for (const badAcknowledgement of [{ registered: true, transactionId: "other", bindingDigest: "0".repeat(64) }, true]) {
    const w = world(); await w.boundary.execute(w.save(), actor); const before = w.state();
    w.flags.badAcknowledgement = badAcknowledgement;
    await rejects(w.boundary.execute(w.publication(), actor), "storage-unavailable"); assert.equal(w.state(), before);
  }
});

test("moved neighbor revisions cannot be hidden by a matching review digest", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  const neighbors = w.publication();
  w.flags.alterSnapshot = (s) => { s.reviewBinding.adjacent.prev = 1; };
  await rejects(w.boundary.execute(neighbors, actor), "conflict");
  assert.equal(w.calls.register, 0);
});

test("both calendar neighbors remain guarded when complete weeks fit within one month", async () => {
  const w = world(), month = "2021-02";
  assert.deepEqual(injected.reviewProvider.reviewSpan(month).months, [month]);
  await w.boundary.execute(w.save(0, month), actor);
  await w.boundary.execute(w.publication(1, "publish-feb", month), actor);
  assert.deepEqual(w.registered[0].binding.adjacent, { prev: 0, next: 0 });
  if (process.env.SCHEDULER_ARTIFACT_MODE) {
    assert.deepEqual(w.appliedPlans.at(-1).ops.filter((op) => op.op === "expect-head").map((op) => [op.month, op.draftRev]), [["2021-01", 0], ["2021-03", 0]]);
  }
});

test("a saved neighbor is version-bound and must match the provider's month draft", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  await w.boundary.execute(w.save(0, "2026-09", "save-neighbor"), actor);
  const command = w.publication();
  w.flags.alterSnapshot = (s) => { s.reviewInput.months["2026-09"].store.people[0].name = "Different neighbor"; };
  await rejects(w.boundary.execute(command, actor), "storage-unavailable");
  assert.equal(w.calls.register, 0);
  delete w.flags.alterSnapshot;
  await w.boundary.execute(command, actor);
  assert.equal(w.registered[0].binding.adjacent.prev, 1);
});

test("read and save require an exact scope and stored version binding", async () => {
  const w = world(); await w.boundary.execute(w.save(), actor);
  w.flags.alterSnapshot = (s) => { s.scope.storeId = "other-store"; };
  await rejects(w.boundary.execute({ op: "read", ...scope, input: { kind: "published" } }, actor), "storage-unavailable");
  await rejects(w.boundary.execute(w.save(1, MONTH, "save-2"), actor), "storage-unavailable");
  w.flags.alterSnapshot = (s) => { s.draftText = null; };
  await rejects(w.boundary.execute(w.save(1, MONTH, "save-2"), actor), "storage-unavailable");
});

test("missing providers or trusted SHA implementation fail closed", () => {
  const w = world();
  for (const options of [{ ...w.options, sha256: null }, { ...w.options, reviewProvider: null }, { ...w.options, c113: null }]) {
    assert.throws(() => createSchedulerContract(options).validateRequest(w.save()), (error) => error.code === "contract-not-configured");
  }
});

test("raw plan authorization marker, wrapper default, and source-only boundary remain unchanged", () => {
  const source = fs.readFileSync(new URL("../api/_scheduler-contract.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|createClient|\bfetch\s*\(|https?:\/\/|appendActivity/);
  assert.equal(sha256(fs.readFileSync(new URL("../api/_scheduler-store.mjs", import.meta.url))), "55da636812b0d281c3475c110d098d08a235e308bb90b823c11c827d9dccf84e");
  assert.equal(sha256(fs.readFileSync(new URL("../api/scheduler.mjs", import.meta.url))), "47a37141f37dfbd59f14001ddd4754a7a8f116967c9bf763f3153a118f3ea97a");
});

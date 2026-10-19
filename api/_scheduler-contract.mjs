import { SchedulerError } from "./_scheduler-store.mjs";

// Injected only. Neither this factory nor the existing endpoint installs a
// provider, authentication, a database, or a transaction implementation.
export const INPUT_BINDING_VERSION = "scheduler-input-binding/1";
export const CONTEXT_CAPABILITY = "scheduler-context-cas-and-provenance-v1";
const REVIEW_DEFINITION = "month-review/1";
const HEX = /^[0-9a-f]{64}$/;
const SOURCES = ["baseStore", "teamState", "baseAssignments", "history", "planningPolicy"];
const fail = (code = "storage-unavailable") => { throw new SchedulerError(code); };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

function fields(value, names) {
  if (!object(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === names.length && keys.every((key) => typeof key === "string" && names.includes(key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function scopeMatches(value, scope) {
  return fields(value, ["storeId", "month"]) && value.storeId === scope.storeId && value.month === scope.month;
}

export function createSchedulerContract({ c113, reviewProvider, sha256 } = {}) {
  function configured() {
    const contractFunctions = ["validStoreId", "validMonth", "validRev", "adjacentMonths", "validateDraft", "persistable",
      "deserializeVersion", "canonicalize", "planDraftSave", "planPublication"];
    const reviewFunctions = ["validateReviewInput", "verifyReview", "reviewMonth", "reviewSpan", "canonicalJson"];
    if (!c113 || contractFunctions.some((name) => typeof c113[name] !== "function") || !reviewProvider ||
        reviewFunctions.some((name) => typeof reviewProvider[name] !== "function") ||
        reviewProvider.REVIEW_DEFINITION !== REVIEW_DEFINITION || typeof sha256 !== "function") fail("contract-not-configured");
  }

  function checkedPlan(result) {
    if (result?.ok === true && object(result.plan)) return result.plan;
    const conflicts = ["exists", "missing-base", "stale", "stale-draft", "ahead", "adjacent-moved", "head-moved", "would-overwrite", "audit-chain"];
    fail(conflicts.includes(result?.code) ? "conflict" : "contract-rejected");
  }

  function decode(text, scope, kind, rev) {
    if (rev === 0) { if (text !== null) fail(); return null; }
    if (typeof text !== "string") fail();
    const result = c113.deserializeVersion(text, { ...scope, kind, rev });
    if (result?.ok !== true || result.kind !== kind || result.rev !== rev ||
        result.storeId !== scope.storeId || result.month !== scope.month) fail();
    return result;
  }

  function stored(snapshot, scope) {
    if (!object(snapshot) || !scopeMatches(snapshot.scope, scope)) fail();
    const head = snapshot.head;
    if (head !== null && (!fields(head, ["draftRev", "publishedRev"]) ||
        !c113.validRev(head.draftRev, 0) || !c113.validRev(head.publishedRev, 0))) fail();
    const revisions = head || { draftRev: 0, publishedRev: 0 };
    const draft = decode(snapshot.draftText, scope, "draft", revisions.draftRev);
    const published = decode(snapshot.publishedText, scope, "published", revisions.publishedRev);
    if (snapshot.prevAuditHash !== null && (typeof snapshot.prevAuditHash !== "string" || !/^[0-9a-f]{16,128}$/.test(snapshot.prevAuditHash))) fail();
    return { head, revisions, draft, published };
  }

  function reference(raw, minimum) {
    if (!fields(raw, ["id", "revision"]) || typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 200 ||
        !c113.validRev(raw.revision, minimum)) fail();
    return { id: raw.id, revision: raw.revision };
  }

  function adjacent(raw, month) {
    if (!fields(raw, ["prev", "next"])) fail();
    const calendar = c113.adjacentMonths(month);
    for (const side of ["prev", "next"]) {
      if (calendar[side] === null ? raw[side] !== null : !c113.validRev(raw[side], 0)) fail();
    }
    return { prev: raw.prev, next: raw.next };
  }

  function binding(raw, scope, state, snapshot) {
    if (!fields(raw, ["version", "scope", "inputVersion", "inputDigest", "draftRev", "publishedRev", "adjacent", "sources"]) ||
        raw.version !== INPUT_BINDING_VERSION || !scopeMatches(raw.scope, scope) ||
        raw.draftRev !== state.revisions.draftRev || raw.publishedRev !== state.revisions.publishedRev ||
        typeof raw.inputDigest !== "string" || !HEX.test(raw.inputDigest) || !fields(raw.sources, SOURCES)) fail();
    const neighbors = adjacent(raw.adjacent, scope.month), current = adjacent(snapshot.adjacentNow, scope.month);
    if (neighbors.prev !== current.prev || neighbors.next !== current.next) fail("conflict");
    return { version: INPUT_BINDING_VERSION, scope: { ...scope }, inputVersion: reference(raw.inputVersion, 1),
      inputDigest: raw.inputDigest, draftRev: raw.draftRev, publishedRev: raw.publishedRev,
      adjacent: neighbors, sources: Object.fromEntries(SOURCES.map((name) => [name, reference(raw.sources[name], 0)])) };
  }

  function sameDraft(reviewDraft, persisted, scope) {
    if (!reviewDraft || !persisted) fail();
    const store = reviewDraft.store;
    const projected = { storeId: scope.storeId, month: scope.month,
      store: Object.fromEntries(["people", "rules", "teams", "memberships", "timezone"]
        .filter((key) => Object.hasOwn(store, key)).map((key) => [key, store[key]])), overrides: reviewDraft.overrides };
    // This projection compares persisted fields. It never saves a stripped
    // provider input or discards its history/policy provenance.
    if (c113.validateDraft(projected, scope)?.ok !== true) fail();
    const left = c113.canonicalize(projected), right = c113.canonicalize(persisted.draft);
    if (left?.ok !== true || right?.ok !== true || left.text !== right.text) fail();
  }

  function reviewVersions(input, state, snapshot, scope, manifest) {
    if (!scopeMatches(input.scope, scope) || !fields(snapshot.neighborDraftTexts, ["prev", "next"])) fail();
    sameDraft(input.months[scope.month], state.draft, scope);
    const calendar = c113.adjacentMonths(scope.month), span = reviewProvider.reviewSpan(scope.month);
    for (const side of ["prev", "next"]) {
      const month = calendar[side], rev = manifest.adjacent[side];
      if (month === null) { if (snapshot.neighborDraftTexts[side] !== null) fail(); continue; }
      const decoded = decode(snapshot.neighborDraftTexts[side], { storeId: scope.storeId, month }, "draft", rev);
      if (!span.months.includes(month)) continue;
      if (rev === 0) { if (Object.hasOwn(input.months, month)) fail(); }
      else sameDraft(input.months[month], decoded, { storeId: scope.storeId, month });
    }
  }

  function transactionContext(snapshot) {
    const tx = snapshot.contextTransaction;
    if (!object(tx) || typeof tx.id !== "string" || !tx.id.trim() || tx.id.length > 200 ||
        tx.capabilities?.[CONTEXT_CAPABILITY] !== true || typeof tx.register !== "function") fail("contract-not-configured");
    return tx;
  }

  function digest(value) {
    const text = reviewProvider.canonicalJson(value);
    const first = sha256(text);
    if (typeof first !== "string" || !HEX.test(first) || sha256(text) !== first) fail();
    return first;
  }

  function validateRequest(request) {
    configured();
    if (!c113.validStoreId(request.storeId) || !c113.validMonth(request.month) || !object(request.input)) return false;
    if (request.op === "read") return fields(request.input, ["kind"]) && ["draft", "published"].includes(request.input.kind);
    if (request.op === "save") return fields(request.input, ["baseRev", "draft"]) && c113.validRev(request.input.baseRev, 0) &&
      c113.validateDraft(c113.persistable(request.input.draft), { storeId: request.storeId, month: request.month })?.ok === true;
    return request.op === "publish" && fields(request.input, ["draftRev", "review"]) && c113.validRev(request.input.draftRev) &&
      fields(request.input.review, ["definition", "digest"]) && request.input.review.definition === REVIEW_DEFINITION &&
      typeof request.input.review.digest === "string" && HEX.test(request.input.review.digest);
  }

  async function plan({ request, actor, now, snapshot }) {
    configured();
    const scope = { storeId: request.storeId, month: request.month }, state = stored(snapshot, scope);
    const common = { ...scope, head: state.head, actor: { id: actor.id }, at: now, prevAuditHash: snapshot.prevAuditHash };
    if (request.op === "save") return checkedPlan(c113.planDraftSave({ ...common, baseRev: request.input.baseRev, draft: request.input.draft }));
    if (request.op !== "publish") fail("invalid-request");
    if (!state.draft) fail("contract-rejected");
    if (request.input.draftRev !== state.revisions.draftRev) fail("conflict");
    const tx = transactionContext(snapshot);
    const manifest = binding(snapshot.reviewBinding, scope, state, snapshot);
    let input, verified, recomputed;
    try {
      input = reviewProvider.validateReviewInput(snapshot.reviewInput);
      reviewVersions(input, state, snapshot, scope, manifest);
      verified = reviewProvider.verifyReview(input, request.input.review, { sha256 });
      if (verified?.ok !== true) fail(verified?.reason === "digest" ? "contract-rejected" : "storage-unavailable");
      // verifyReview deliberately returns no inputDigest. Reuse the same
      // provider to bind its complete input, rather than invent another hash.
      recomputed = reviewProvider.reviewMonth(input, { sha256 });
    } catch (error) {
      if (error instanceof SchedulerError) throw error;
      fail();
    }
    if (recomputed.definition !== REVIEW_DEFINITION || verified.digest !== recomputed.digest ||
        verified.openIssues !== recomputed.openIssues || !Number.isSafeInteger(verified.openIssues) || verified.openIssues < 0 ||
        recomputed.inputDigest !== manifest.inputDigest) fail();
    const review = { definition: REVIEW_DEFINITION, digest: verified.digest };
    const fingerprint = reviewProvider.canonicalJson(review);
    const planned = checkedPlan(c113.planPublication({ ...common, draft: state.draft.draft, draftRev: request.input.draftRev,
      review: { fingerprint, openIssues: verified.openIssues }, recomputedFingerprint: fingerprint,
      adjacent: { reviewedAgainst: manifest.adjacent, now: adjacent(snapshot.adjacentNow, scope.month) } }));
    const guardBinding = freeze({ ...manifest, review });
    const bindingDigest = digest(guardBinding);
    const acknowledgement = await tx.register({ binding: guardBinding, bindingDigest });
    if (!fields(acknowledgement, ["registered", "transactionId", "bindingDigest"]) || acknowledgement.registered !== true ||
        acknowledgement.transactionId !== tx.id || acknowledgement.bindingDigest !== bindingDigest) fail();
    // The acknowledgement is a trusted port contract, not evidence that a real
    // database has implemented CAS. The original C113 plan stays unchanged.
    return planned;
  }

  function projectRead({ request, snapshot }) {
    configured();
    const state = stored(snapshot, { storeId: request.storeId, month: request.month });
    const value = state[request.input.kind];
    return { kind: request.input.kind, revision: value?.rev || 0, schedule: value?.draft || null };
  }

  function projectResult({ plan: planned }) {
    return { head: { draftRev: planned.resultingHead.draftRev, publishedRev: planned.resultingHead.publishedRev } };
  }

  return { validateRequest, plan, projectRead, projectResult };
}

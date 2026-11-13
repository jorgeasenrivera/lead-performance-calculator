import { isDeepStrictEqual } from "node:util";
import { ATOMIC_SCHEDULER_CAPABILITY, SchedulerError } from "./_scheduler-store.mjs";

// Dormant, request-scoped adapter. A transport declaration does not establish
// database installation, endpoint reachability, user authorization or live CAS.
export const SCHEDULER_POSTGRES_RPC_CAPABILITY = "scheduler-postgres-save-read/1";
export const SCHEDULER_POSTGRES_LIMITS = Object.freeze({ bytes: 8_388_608, nodes: 100_000, depth: 64 });
const pgFail = (code = "storage-unavailable") => { throw new SchedulerError(code); };
const pgRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const pgFields = (v, keys) => pgRecord(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const pgHex = /^[0-9a-f]{16,128}$/;

// Bound the first traversal of port data, including encoded key/string bytes.
// Limits are RPC-envelope limits, not an alternative schedule validator.
function pgCopy(value) {
  const state = { bytes: 0, nodes: 0, seen: new Set() };
  const charge = (s) => {
    state.bytes += Buffer.byteLength(s, "utf8");
    if (state.bytes > SCHEDULER_POSTGRES_LIMITS.bytes) pgFail();
    return s;
  };
  const string = (s) => {
    if (s.length > SCHEDULER_POSTGRES_LIMITS.bytes) pgFail();
    return charge(JSON.stringify(s));
  };
  function encode(v, depth) {
    if (++state.nodes > SCHEDULER_POSTGRES_LIMITS.nodes || depth > SCHEDULER_POSTGRES_LIMITS.depth) pgFail();
    if (typeof v === "string") return string(v);
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return charge(JSON.stringify(v));
    if ((!Array.isArray(v) && !pgRecord(v)) || state.seen.has(v)) pgFail();
    state.seen.add(v);
    const keys = [];
    if (Array.isArray(v)) {
      if (v.length + state.nodes > SCHEDULER_POSTGRES_LIMITS.nodes) pgFail();
      for (let i = 0; i < v.length; i++) keys.push(i);
    } else {
      for (const k in v) if (Object.hasOwn(v, k)) {
        if (keys.length + state.nodes + 1 > SCHEDULER_POSTGRES_LIMITS.nodes) pgFail();
        keys.push(k);
      }
    }
    charge(Array.isArray(v) ? "[]" : "{}");
    const parts = keys.map((k) => {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d || !Object.hasOwn(d, "value")) pgFail();
      return (Array.isArray(v) ? "" : string(k) + charge(":")) + encode(d.value, depth + 1);
    });
    charge(",".repeat(Math.max(0, parts.length - 1)));
    state.seen.delete(v);
    return Array.isArray(v) ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  return JSON.parse(encode(value, 0));
}

export function createSchedulerPostgres({ transport, authority: rawAuthority, c113 } = {}) {
  if (!transport || transport.capabilities?.[SCHEDULER_POSTGRES_RPC_CAPABILITY] !== true ||
      typeof transport.rpc !== "function" || !c113 ||
      ["validStoreId", "validMonth", "validRev", "deserializeVersion", "verifyEntry"].some((k) => typeof c113[k] !== "function")) {
    pgFail("storage-not-configured");
  }
  const authority = pgCopy(rawAuthority);
  if (!pgFields(authority, ["actorId", "action", "storeId", "month", "readKind"]) ||
      typeof authority.actorId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$/.test(authority.actorId) ||
      !c113.validStoreId(authority.storeId) || !c113.validMonth(authority.month) ||
      !["save", "read"].includes(authority.action) ||
      (authority.action === "save" ? authority.readKind !== null : !["draft", "published"].includes(authority.readKind))) pgFail("forbidden");
  Object.freeze(authority);
  const scope = Object.freeze({ storeId: authority.storeId, month: authority.month });
  function requireScope(raw, action) {
    const supplied = pgCopy(raw);
    if (authority.action !== action || !pgFields(supplied, ["storeId", "month"]) || !isDeepStrictEqual(supplied, scope)) pgFail("forbidden");
  }
  function receiptKey(key) {
    if (typeof key !== "string" || Buffer.byteLength(key) > 1_048_576) pgFail();
    let parts;
    try { parts = JSON.parse(key); } catch { pgFail(); }
    if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== authority.actorId ||
        parts[1] !== scope.storeId || parts[2] !== scope.month || typeof parts[3] !== "string" || !parts[3].trim() ||
        JSON.stringify(parts) !== key) pgFail("forbidden");
  }
  function checkedReceipt(raw, key) {
    if (raw === null) return null;
    const r = pgCopy(raw);
    if (!pgFields(r, ["key", "fingerprint", "result"]) || r.key !== key ||
        typeof r.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.fingerprint)) pgFail();
    checkedResult(r.result);
    return r;
  }
  function checkedResult(result) {
    if (!pgFields(result, ["head"]) || !pgFields(result.head, ["draftRev", "publishedRev"]) ||
        !c113.validRev(result.head.draftRev) || !c113.validRev(result.head.publishedRev, 0)) pgFail();
  }
  function checkedSnapshot(raw) {
    const s = pgCopy(raw);
    if (!pgFields(s, ["scope", "head", "draftText", "publishedText", "prevAuditHash", "auditRevision"]) || !isDeepStrictEqual(s.scope, scope) ||
        !c113.validRev(s.auditRevision, 0) ||
        (s.head !== null && (!pgFields(s.head, ["draftRev", "publishedRev"]) ||
          !c113.validRev(s.head.draftRev, 0) || !c113.validRev(s.head.publishedRev, 0))) ||
        (s.prevAuditHash !== null && (typeof s.prevAuditHash !== "string" || !pgHex.test(s.prevAuditHash)))) pgFail();
    for (const kind of ["draft", "published"]) {
      const rev = s.head?.[`${kind}Rev`] || 0, text = s[`${kind}Text`];
      if (rev === 0) { if (text !== null) pgFail(); }
      else if (typeof text !== "string" || c113.deserializeVersion(text, { ...scope, kind, rev })?.ok !== true) pgFail();
    }
    if (s.head === null && (s.prevAuditHash !== null || s.auditRevision !== 0)) pgFail();
    return s;
  }
  async function call(name, args) {
    try {
      const reply = pgCopy(await transport.rpc(name, pgCopy(args)));
      if (!pgRecord(reply) || !Object.hasOwn(reply, "data") || !Object.hasOwn(reply, "error")) pgFail();
      if (reply.error !== null) {
        const code = reply.error?.code === "P0001" && {
          "scheduler:conflict": "conflict", "scheduler:idempotency-conflict": "idempotency-conflict",
          "scheduler:forbidden": "forbidden",
        }[reply.error?.message];
        pgFail(code || "storage-unavailable");
      }
      return reply.data;
    } catch (error) {
      if (error instanceof SchedulerError) throw error;
      pgFail();
    }
  }
  async function snapshotRpc(key) {
    const data = await call("scheduler_snapshot", { p_authority: authority, p_key: key });
    if (!pgFields(data, ["snapshot", "receipt"])) pgFail();
    if (key === null && data.receipt !== null) pgFail();
    return { snapshot: checkedSnapshot(data.snapshot), receipt: key === null ? null : checkedReceipt(data.receipt, key) };
  }
  function checkedPlan(raw, snapshot) {
    const plan = pgCopy(raw), head = snapshot.head || { draftRev: 0, publishedRev: 0 };
    if (!pgFields(plan, ["kind", "storeId", "month", "atomic", "authorization", "ops", "auditEntry", "resultingHead"]) ||
        plan.kind !== "draft-save" || plan.storeId !== scope.storeId || plan.month !== scope.month ||
        plan.atomic !== true || plan.authorization !== "not-checked" || !Array.isArray(plan.ops) || plan.ops.length !== 2) pgFail("contract-rejected");
    const [put, append] = plan.ops, entry = plan.auditEntry;
    if (!pgFields(put, ["op", "kind", "storeId", "month", "expectedRev", "rev", "text"]) ||
        put.op !== "put-version" || put.kind !== "draft" || put.storeId !== scope.storeId || put.month !== scope.month ||
        put.expectedRev !== head.draftRev || !c113.validRev(put.rev) || put.rev !== head.draftRev + 1 || typeof put.text !== "string" ||
        !pgFields(append, ["op", "storeId", "month", "entry"]) || append.op !== "append-audit" ||
        append.storeId !== scope.storeId || append.month !== scope.month || !isDeepStrictEqual(append.entry, entry) ||
        c113.verifyEntry(entry)?.ok !== true || entry.action !== "draft-save" || entry.actor?.id !== authority.actorId ||
        entry.storeId !== scope.storeId || entry.month !== scope.month || entry.fromRev !== head.draftRev || entry.toRev !== put.rev ||
        entry.subject?.kind !== "draft" || entry.subject.rev !== put.rev || entry.prevHash !== snapshot.prevAuditHash ||
        !isDeepStrictEqual(plan.resultingHead, { draftRev: put.rev, publishedRev: head.publishedRev })) pgFail("contract-rejected");
    const decoded = c113.deserializeVersion(put.text, { ...scope, kind: "draft", rev: put.rev });
    if (decoded?.ok !== true || entry.subject.digest !== decoded.hash) pgFail("contract-rejected");
    return plan;
  }
  let started = false;
  function begin() { if (started) pgFail("forbidden"); started = true; }
  function authorize({ actor, request } = {}) {
    return !started && actor?.id === authority.actorId && request?.op === authority.action &&
      request.storeId === authority.storeId && request.month === authority.month &&
      (authority.action !== "read" || request.input?.kind === authority.readKind);
  }
  async function read(suppliedScope) {
    requireScope(suppliedScope, "read");
    begin();
    return (await snapshotRpc(null)).snapshot;
  }
  async function transaction(suppliedScope, callback) {
    requireScope(suppliedScope, "save");
    begin();
    if (typeof callback !== "function") pgFail();
    let active = true, loaded = null, key = null, plan = null, receipt = null;
    const live = () => { if (!active) pgFail(); };
    const tx = {
      getReceipt: async (suppliedKey) => {
        live(); receiptKey(suppliedKey);
        if (key !== null && key !== suppliedKey) pgFail();
        if (!loaded) { key = suppliedKey; loaded = await snapshotRpc(key); }
        return pgCopy(loaded.receipt);
      },
      snapshot: async () => { live(); if (!loaded) pgFail(); return pgCopy(loaded.snapshot); },
      apply: async (suppliedPlan) => {
        live(); if (!loaded || loaded.receipt !== null || plan !== null) pgFail();
        plan = checkedPlan(suppliedPlan, loaded.snapshot); return true;
      },
      putReceipt: async (suppliedReceipt) => {
        live(); if (!plan || receipt !== null) pgFail();
        receipt = checkedReceipt(suppliedReceipt, key);
        if (!receipt || !isDeepStrictEqual(receipt.result, { head: plan.resultingHead })) pgFail();
        return true;
      },
    };
    let speculative;
    try { speculative = pgCopy(await callback(tx)); } finally { active = false; }
    if (!loaded) pgFail();
    const replay = loaded.receipt !== null;
    if (replay ? (plan !== null || receipt !== null) : (!plan || !receipt)) pgFail();
    const chosenReceipt = replay ? loaded.receipt : receipt;
    if (!isDeepStrictEqual(speculative, { result: chosenReceipt.result, replayed: replay })) pgFail();
    const committed = await call("scheduler_commit", {
      p_authority: authority, p_expected: { head: loaded.snapshot.head, prevAuditHash: loaded.snapshot.prevAuditHash,
        auditRevision: loaded.snapshot.auditRevision },
      p_plan: plan, p_receipt: chosenReceipt,
    });
    if (!pgFields(committed, ["result", "replayed"]) || typeof committed.replayed !== "boolean" ||
        (!committed.replayed && (replay || !isDeepStrictEqual(committed.result, chosenReceipt.result)))) pgFail();
    checkedResult(committed.result);
    // A competing identical command may win after the snapshot. Its stored
    // result and replay marker replace the callback's speculative response.
    return pgCopy(committed);
  }
  return Object.freeze({ capabilities: Object.freeze({ [ATOMIC_SCHEDULER_CAPABILITY]: true }), authorize, read, transaction });
}

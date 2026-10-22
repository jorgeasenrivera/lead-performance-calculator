// TEST-ONLY. An in-memory stand-in for whatever will one day store versions,
// so that plans can be applied and their promises checked: the heads move only
// if every operation holds, a stored version is never replaced, and the audit
// log is a chain. Nothing in the other modules imports this file, and a static
// test keeps it that way.
//
// It is not a design for the real store. It chooses no database, no schema, no
// policy and no authorization; applying a plan here checks the plan's own
// expectations and nothing about who is applying it.
import { monthKey, versionId, validRev, validStoreId, validMonth, validKind } from './identity.mjs';
import { deserializeVersion } from './deserialize.mjs';
import { verifyEntry } from './audit-entry.mjs';
import { plainSnapshot } from './validate.mjs';
import { DEFAULT_SEALER } from './envelope.mjs';

const refuse = (code, opIndex, message) => ({ ok: false, code, opIndex, message });

export function createFakePort(sealer = DEFAULT_SEALER) {
  let state = { heads: new Map(), versions: new Map(), audit: new Map() };
  const copy = s => ({ heads: new Map([...s.heads].map(([k, v]) => [k, { ...v }])), versions: new Map(s.versions), audit: new Map([...s.audit].map(([k, v]) => [k, [...v]])) });

  function step(work, op, i) {
    if (!op || typeof op !== 'object' || !validStoreId(op.storeId) || !validMonth(op.month)) return refuse('bad-op', i, 'Every operation names a store and month.');
    const key = monthKey(op.storeId, op.month);
    const head = work.heads.get(key) || { draftRev: 0, publishedRev: 0 };
    if (op.op === 'expect-head') {
      for (const field of ['draftRev', 'publishedRev']) if (op[field] !== undefined && head[field] !== op[field]) return refuse('head-moved', i, `${field} is ${head[field]}, expected ${op[field]}.`);
      return null;
    }
    if (op.op === 'put-version') {
      if (!validKind(op.kind) || !validRev(op.expectedRev, 0) || op.rev !== op.expectedRev + 1 || typeof op.text !== 'string') return refuse('bad-op', i, 'Malformed put-version.');
      const field = `${op.kind}Rev`;
      if (head[field] !== op.expectedRev) return refuse('stale', i, `${field} is ${head[field]}, expected ${op.expectedRev}.`);
      const id = versionId(op.kind, op.storeId, op.month, op.rev);
      if (work.versions.has(id)) return refuse('would-overwrite', i, 'That version is already stored and never changes.');
      const read = deserializeVersion(op.text, { storeId: op.storeId, month: op.month, kind: op.kind, rev: op.rev }, sealer);
      if (!read.ok) return refuse('invalid-version', i, read.problems.map(p => p.code).join(','));
      work.versions.set(id, op.text);
      work.heads.set(key, { ...head, [field]: op.rev });
      return null;
    }
    if (op.op === 'append-audit') {
      const checked = verifyEntry(op.entry, sealer);
      if (!checked.ok) return refuse('bad-audit', i, checked.problems.map(p => p.code).join(','));
      if (op.entry.storeId !== op.storeId || op.entry.month !== op.month) return refuse('bad-audit', i, 'The entry belongs to another store or month.');
      const log = work.audit.get(key) || [];
      if (op.entry.prevHash !== (log.length ? log[log.length - 1].hash : null)) return refuse('audit-chain', i, 'The entry does not follow the log.');
      work.audit.set(key, [...log, op.entry]);
      return null;
    }
    return refuse('unknown-op', i, `Unknown operation ${String(op.op)}.`);
  }

  return {
    // All or nothing: a working copy is changed and kept only if every operation holds.
    apply(rawPlan) {
      // One strict copy of the plan, so what is checked is what is applied.
      const copied = rawPlan === null || typeof rawPlan !== 'object' ? { ok: false } : plainSnapshot(rawPlan, { maxDepth: 6 });
      const plan = copied.ok ? copied.value : null;
      if (!plan || !Array.isArray(plan.ops) || plan.ops.length === 0 || plan.ops.length > 20) return refuse('bad-plan', -1, 'A plan is a list of 1 to 20 operations.');
      const work = copy(state);
      for (let i = 0; i < plan.ops.length; i++) { const stopped = step(work, plan.ops[i], i); if (stopped) return stopped; }
      state = work;
      return { ok: true, applied: plan.ops.length };
    },
    head: (storeId, month) => { const h = state.heads.get(monthKey(storeId, month)); return h ? { ...h } : null; },
    versionText: (kind, storeId, month, rev) => state.versions.get(versionId(kind, storeId, month, rev)) ?? null,
    versionIds: () => [...state.versions.keys()].sort(),
    auditLog: (storeId, month) => [...(state.audit.get(monthKey(storeId, month)) || [])],
    lastAuditHash: (storeId, month) => { const log = state.audit.get(monthKey(storeId, month)) || []; return log.length ? log[log.length - 1].hash : null; },
    // For comparing "nothing changed" after a refused plan.
    snapshot: () => JSON.stringify({ heads: [...state.heads].sort(), versions: [...state.versions].sort(), audit: [...state.audit].sort() }),
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, open, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntentJournal } from '../retry/intent-journal.mjs';

const binding = { actor: 'synthetic-a', person: 'synthetic-p', store: 'synthetic-store', date: '2026-10-26', lifecycle: 'synthetic-signin-1' };
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const entry = (id = first) => ({ context: structuredClone(binding), intent: { operationId: id, store: binding.store, date: binding.date, room: 'floor', action: 'away', input: {} } });
const proof = context => ({ context, identityVerified: true, roomCommandVerified: true, actionInputVerified: true });
const success = { status: 200, body: { ok: true, row: { historical: true } } };
function memory() {
  let bytes = null, tail = Promise.resolve();
  const p = { writes: 0, failAt: 0,
    exclusive(fn) { const result = tail.then(fn); tail = result.catch(() => {}); return result; },
    async read() { return bytes; },
    async replace(value) { p.writes++; if (p.writes === p.failAt) throw Error('synthetic disk failure'); bytes = value; },
    raw(value) { bytes = value; },
  }; return p;
}
function setup(storage = memory(), overrides = {}) {
  const sent = [], notices = [];
  const ports = { storage, verify: async c => proof(c), send: async (p, c) => { sent.push({ p, c }); return success; }, notify: async n => notices.push(n), ...overrides };
  return { journal: createIntentJournal(ports), ports, sent, notices, storage };
}
async function capture(f, id = first) { return f.journal.capture(entry(id)); }

test('capture is inert and immutable, contains no credentials and never auto sends', async () => {
  const f = setup(), e = entry(); const s = await f.journal.capture(e); e.intent.action = 'back';
  assert.equal((await f.journal.snapshot()).records[0].intent.action, 'away');
  assert.equal(s.records[0].state, 'held'); assert.equal(f.sent.length, 0);
  await assert.rejects(f.journal.capture({ ...entry(second), intent: { ...entry(second).intent, input: { access_token: 'synthetic' } } }), /credential/);
  assert.equal((await f.journal.snapshot()).records.length, 1);
});

test('capture snapshots arguments before lock acquisition and notification can reread', async () => {
  const f = setup(); const e = entry(); const pending = f.journal.capture(e); e.intent.action = 'back'; e.context.actor = 'changed';
  const s = await pending; assert.equal(s.records[0].intent.action, 'away'); assert.equal(s.records[0].context.actor, binding.actor);
  let journal, reread;
  journal = createIntentJournal({ ...f.ports, notify: async () => { reread = await journal.snapshot(); } });
  const r = await journal.attempt(first, s.revision); assert.deepEqual(reread, r);
});

test('retirement snapshots binding before queued work', async () => {
  const f = setup(); await capture(f); const b = { ...binding }; const pending = f.journal.retireContext(b); b.actor = 'changed';
  assert.equal((await pending).records[0].state, 'blocked');
});

test('same operation is retained once; changed payload or binding cannot reuse it', async () => {
  const f = setup(); const a = await capture(f); assert.deepEqual(await capture(f), a);
  const b = entry(); b.intent.input = { count: 1 }; await assert.rejects(f.journal.capture(b), /reused/);
  b.intent = entry().intent; b.context.person = 'another'; await assert.rejects(f.journal.capture(b), /reused/);
});

test('invalid calendar dates and corrupted attempt states cannot be captured or recovered', async () => {
  const f = setup(); const e = entry(); e.context.date = e.intent.date = '2026-02-30';
  await assert.rejects(f.journal.capture(e), /date/); assert.equal(f.storage.writes, 0);
  const s = await capture(f); s.records[0].state = 'resolved'; f.storage.raw(JSON.stringify(s));
  await assert.rejects(f.journal.recover(), /unavailable/);
});

test('missing identity/capability/transport fails closed', async () => {
  for (const overrides of [{ verify: undefined }, { send: undefined }, { verify: async c => ({ ...proof(c), roomCommandVerified: false }) }, { verify: async c => ({ ...proof(c), actionInputVerified: false }) }, { verify: async c => ({ ...proof(c), identityVerified: false }) }]) {
    const f = setup(memory(), overrides); const s = await capture(f);
    await assert.rejects(f.journal.attempt(first, s.revision), /verified/); assert.equal(f.sent.length, 0);
  }
});

test('every actor/person/store/date/lifecycle change blocks attempts', async () => {
  for (const key of Object.keys(binding)) {
    const f = setup(memory(), { verify: async c => proof({ ...c, [key]: 'changed' }) }); const s = await capture(f);
    await assert.rejects(f.journal.attempt(first, s.revision), /verified/); assert.equal(f.sent.length, 0);
  }
});

test('context changes during durable preparation still prevent dispatch', async () => {
  let calls = 0; const f = setup(memory(), { verify: async c => ++calls === 1 ? proof(c) : proof({ ...c, lifecycle: 'changed' }) });
  const s = await capture(f); const result = await f.journal.attempt(first, s.revision);
  assert.equal(f.sent.length, 0); assert.equal(result.records[0].state, 'blocked');
});

test('context retirement remains blocked after returning and after restart', async () => {
  const f = setup(); await capture(f); const s = await f.journal.retireContext(binding);
  const restarted = createIntentJournal(f.ports); await assert.rejects(restarted.attempt(first, s.revision), /not retryable/);
  assert.equal((await restarted.recover()).records[0].state, 'blocked'); assert.equal(f.sent.length, 0);
});

test('observed mismatch is sticky even if verifier later returns original context', async () => {
  let changed = true;
  const f = setup(memory(), { verify: async c => proof(changed ? { ...c, person: 'changed-person' } : c) });
  const s = await capture(f); await assert.rejects(f.journal.attempt(first, s.revision), /verified/); changed = false;
  const next = await f.journal.snapshot(); await assert.rejects(f.journal.attempt(first, next.revision), /not retryable/);
});

test('timeouts, malformed/negative replies, 401/403 remain uncertain until explicit review', async () => {
  for (const reply of [null, { status: 200 }, { status: 200, body: { ok: true, row: null } }, { status: 200, body: { ok: false, row: {} } }, { status: 401 }, { status: 403 }, { status: 500 }]) {
    let sends = 0; const f = setup(memory(), { send: async () => { sends++; if (reply === null) throw Error('timeout'); return reply; } });
    const s = await capture(f); const r = await f.journal.attempt(first, s.revision);
    assert.equal(r.records[0].state, 'uncertain'); await f.journal.recover(); await f.journal.snapshot(); assert.equal(sends, 1);
  }
});

test('explicit retry keeps operation/payload/context; no row is applied or persisted', async () => {
  const attempts = []; const f = setup(memory(), { send: async (...args) => { attempts.push(args); return attempts.length === 1 ? null : success; } });
  let s = await capture(f); s = await f.journal.attempt(first, s.revision); s = await f.journal.attempt(first, s.revision);
  assert.deepEqual(attempts[0], attempts[1]); assert.equal(s.records[0].state, 'resolved');
  assert(!JSON.stringify(s).includes('historical')); assert.deepEqual(f.notices.at(-1), { operationId: first, state: 'resolved' });
});

test('double submit across coordinator instances sends once using review revision', async () => {
  const f = setup(); const other = createIntentJournal(f.ports); const s = await capture(f);
  const results = await Promise.allSettled([f.journal.attempt(first, s.revision), other.attempt(first, s.revision)]);
  assert.equal(f.sent.length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});

test('in-flight transport holds competing attempts until outcome and rejects stale review', async () => {
  let release, began; const started = new Promise(r => { began = r; }); let sends = 0;
  const f = setup(memory(), { send: async () => { sends++; began(); return new Promise(r => { release = r; }); } });
  const s = await capture(f); const firstAttempt = f.journal.attempt(first, s.revision); await started;
  const secondAttempt = f.journal.attempt(first, s.revision); const rejected = assert.rejects(secondAttempt, /stale/);
  await new Promise(r => setImmediate(r)); assert.equal(sends, 1);
  release(null); assert.equal((await firstAttempt).records[0].state, 'uncertain'); await rejected;
});

test('write committed then rejected is uncertain storage and cannot lead to dispatch', async () => {
  const storage = memory(), replace = storage.replace; let writes = 0;
  storage.replace = async bytes => { await replace(bytes); if (++writes === 2) throw Error('ack lost after disk commit'); };
  const f = setup(storage); const s = await capture(f); await assert.rejects(f.journal.attempt(first, s.revision), /durability/);
  assert.equal(f.sent.length, 0); const reopened = createIntentJournal(f.ports);
  assert.equal((await reopened.recover()).records[0].state, 'uncertain'); assert.equal(f.sent.length, 0);
});

test('unknown predecessor and stopped record remain ordering barriers', async () => {
  const f = setup(memory(), { send: async () => null }); let s = await capture(f); s = await f.journal.attempt(first, s.revision); s = await capture(f, second);
  await assert.rejects(f.journal.attempt(second, s.revision), /predecessor/);
  s = await f.journal.stopRetrying(first, s.revision); assert.equal(s.records[0].reason, 'not_cancellation');
  await assert.rejects(f.journal.attempt(first, s.revision), /not retryable/);
  await assert.rejects(f.journal.attempt(second, s.revision), /predecessor/);
});

test('resolved predecessor permits explicit next action, never automatically', async () => {
  const f = setup(); let s = await capture(f); s = await capture(f, second);
  await assert.rejects(f.journal.attempt(second, s.revision), /predecessor/);
  s = await f.journal.attempt(first, s.revision); assert.equal(f.sent.length, 1);
  s = await f.journal.attempt(second, s.revision); assert.equal(f.sent.length, 2);
});

test('failed durable capture/pre-send write prohibits transport', async () => {
  for (const failAt of [1, 2]) {
    const storage = memory(); storage.failAt = failAt; const f = setup(storage);
    if (failAt === 1) await assert.rejects(capture(f), /durability/);
    else { const s = await capture(f); await assert.rejects(f.journal.attempt(first, s.revision), /durability/); }
    assert.equal(f.sent.length, 0); await assert.rejects(f.journal.snapshot(), /storage fault/);
  }
});

test('failed outcome persistence recovers sending as uncertain, never resends', async () => {
  const storage = memory(); storage.failAt = 3; const f = setup(storage); const s = await capture(f);
  await assert.rejects(f.journal.attempt(first, s.revision), /durability/); assert.equal(f.sent.length, 1);
  const restarted = createIntentJournal(f.ports); const recovered = await restarted.recover();
  assert.equal(recovered.records[0].state, 'uncertain'); assert.equal(f.sent.length, 1);
});

test('injection/ack notification failure cannot erase durable confirmed result', async () => {
  const f = setup(memory(), { notify: async () => { throw Error('synthetic bridge failure'); } }); const s = await capture(f);
  const r = await f.journal.attempt(first, s.revision); assert.equal(r.records[0].state, 'resolved');
  await assert.rejects(f.journal.attempt(first, r.revision), /not retryable/);
});

test('corruption/read failure never resets or replaces existing bytes', async () => {
  for (const bytes of ['{', '{}', '{"format":2,"revision":0,"records":[]}']) {
    const storage = memory(); storage.raw(bytes); const f = setup(storage);
    await assert.rejects(f.journal.recover(), /unavailable/); assert.equal(await storage.read(), bytes); assert.equal(storage.writes, 0);
  }
  const f = setup(memory()); f.storage.read = async () => { throw Error('disk'); };
  await assert.rejects(f.journal.snapshot(), /unavailable/); assert.equal(f.storage.writes, 0);
});

test('filesystem durable bytes survive coordinator restart without dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sage-synthetic-journal-')), file = join(dir, 'journal.json');
  // Test-only POSIX port. Mutex is same-process only, not a native production adapter.
  const storage = memory();
  storage.read = async () => { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  storage.replace = async bytes => {
    const tmp = join(dir, 'next'); const h = await open(tmp, 'w', 0o600);
    try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
    await rename(tmp, file); const d = await open(dir, 'r'); try { await d.sync(); } finally { await d.close(); }
  };
  try {
    const f = setup(storage); const s = await capture(f); const reopened = createIntentJournal(f.ports);
    assert.deepEqual(await reopened.recover(), s); assert.equal(f.sent.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

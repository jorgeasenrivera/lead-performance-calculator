// Synthetic unit tests for scripts/strict-webkit-kit.mjs. Fakes only: no browser, no launch of any real browser, no network, no install. A pass here is NEVER sandbox evidence:
// every receipt says qualifying false with a constant blocked list, and tests below pin that even for well-formed records, the "real" binding and a perfectly clean run.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createWebkitKit, checkRecordShape, realWebkitDeps, lifecycleFailed, webkitRunFailed, REASONS, BLOCKED, STATES } from './strict-webkit-kit.mjs';

const NOW0 = Date.parse('2026-10-31T12:00:00Z');
const HASH = 'a'.repeat(64), EVID = 'b'.repeat(64);
const EXE = '/opt/verified/webkit/pw_run.sh';   // a label for the fake; nothing here is read from disk
const prereq = () => ({ status: 'VERIFIED', webkitExecutable: EXE, webkitExecutableSha256: HASH, playwrightVersion: '1.0.0', verifiedBy: 'sandbox-lane', verifiedAt: '2026-10-30T00:00:00Z' });
const attest = () => ({ status: 'VERIFIED', kind: 'real-sandbox', engine: 'webkit', sandboxId: 'sbx-1', runnerLabel: 'runner-a', attestedBy: 'reviewer-1', evidenceSha256: EVID, attestedAt: '2026-10-30T00:00:00Z', expiresAt: '2026-11-30T00:00:00Z' });
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { preflight: 100, start: 40, startGrace: 20, connect: 40, health: 50, close: 40, kill: 40, exitObserve: 40, lateWait: 60 };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

/* A fake server whose child "exits" when close or kill is called, unless told otherwise. */
function fakeServer(o = {}) {
  const calls = { close: 0, kill: 0 };
  const cp = { pid: o.pid === undefined ? 4242 : o.pid, exitCode: null, signalCode: null };
  const exit = () => { cp.exitCode = 0; };
  const server = {
    wsEndpoint: () => (o.ws !== undefined ? o.ws : 'ws://127.0.0.1:5555/abc'),
    process: o.noProcess ? () => undefined : () => cp,
    close: async () => { calls.close++; if (o.closeThrows) throw new Error('secret-looking detail'); if (o.closeHangs) return never(); if (!o.neverExits) exit(); },
    kill: async () => { calls.kill++; if (o.killThrows) throw new Error('x'); if (o.killHangs) return never(); if (!o.neverExits) exit(); },
  };
  return { server, calls, cp };
}
function fakeBrowser(o = {}) {
  const calls = { close: 0 };
  return { calls, browser: { isConnected: () => o.connected !== false, version: () => (o.version === undefined ? '18.0' : o.version), close: async () => { calls.close++; if (o.closeThrows) throw new Error('secret-looking detail'); if (o.closeHangs) return never(); } } };
}
function harness(o = {}) {
  const s = o.server || fakeServer(), b = o.browser || fakeBrowser();
  const log = { launch: [], connect: [], hash: 0 };
  const clock = { now: NOW0 };
  const deps = {
    now: () => clock.now,
    executablePath: async () => (o.exe || EXE), playwrightVersion: async () => (o.ver || '1.0.0'), realPath: async (f) => (o.real || f), hashFile: async () => { log.hash++; return o.sha || HASH; },
    launchServer: (opts) => { log.launch.push(opts); return o.launch ? o.launch(s, clock) : Promise.resolve(s.server); },
    connect: (ws, opts) => { log.connect.push({ ws, opts }); return o.connect ? o.connect(b, clock) : Promise.resolve(b.browser); },
    ...(o.verifyNoDescendants ? { verifyNoDescendants: o.verifyNoDescendants } : {}),
  };
  const kit = createWebkitKit({ deps, prerequisites: o.prerequisites === undefined ? prereq() : o.prerequisites, attestation: o.attestation === undefined ? attest() : o.attestation, timeouts: T, ...(o.launchOptions !== undefined ? { launchOptions: o.launchOptions } : {}) });
  return { kit, log, s, b, clock };
}
const vocab = (r) => { for (const x of r.reasons) assert.ok(REASONS.includes(x), x); for (const t of r.transitions) assert.ok(STATES.includes(t.state), t.state); };
const NONQUALIFYING = (r, msg) => { assert.equal(r.qualifying, false, msg); assert.deepEqual(r.blocked, [...BLOCKED], msg); assert.equal(r.records.evidenceBound, false, msg); };

test('missing or unverified prerequisites and attestation refuse before ANY launch call', async () => {
  const bad = [
    [{ prerequisites: null }, 'prerequisites-missing'], [{ prerequisites: { ...prereq(), status: 'PENDING' } }, 'prerequisites-not-verified'],
    [{ prerequisites: { ...prereq(), webkitExecutableSha256: 'zz' } }, 'prerequisites-invalid'], [{ prerequisites: { ...prereq(), webkitExecutable: 'relative/path' } }, 'prerequisites-invalid'],
    [{ prerequisites: { ...prereq(), verifiedAt: '2027-01-01T00:00:00Z' } }, 'prerequisites-invalid'],
    [{ attestation: null }, 'attestation-missing'], [{ attestation: { ...attest(), status: 'UNVERIFIED' } }, 'attestation-not-verified'],
    [{ attestation: { ...attest(), kind: 'mock' } }, 'attestation-synthetic'], [{ attestation: { ...attest(), kind: 'synthetic' } }, 'attestation-synthetic'],
    [{ attestation: { ...attest(), engine: 'chromium' } }, 'attestation-invalid'], [{ attestation: { ...attest(), evidenceSha256: '' } }, 'attestation-invalid'],
    [{ attestation: { ...attest(), expiresAt: '2026-10-01T00:00:00Z' } }, 'attestation-expired'], [{ attestation: { ...attest(), expiresAt: 'tomorrow' } }, 'attestation-invalid'],
  ];
  for (const [o, reason] of bad) {
    const { kit, log } = harness(o); const r = await kit.start();
    assert.equal(r.ready, false, reason); assert.equal(log.launch.length, 0, reason + ': no launch'); assert.equal(log.connect.length, 0); assert.equal(log.hash, 0, 'no machine probe either');
    assert.equal(r.receipt.finalState, 'REFUSED'); assert.ok(r.receipt.reasons.includes(reason), reason + ' in ' + r.receipt.reasons); NONQUALIFYING(r.receipt, reason); assert.equal(lifecycleFailed(r.receipt), true); vocab(r.receipt);
  }
  assert.deepEqual(checkRecordShape({ prerequisites: prereq(), attestation: attest(), now: NOW0 }), [], 'well-formed means shape only');
});

test('the machine must match the record: canonical path, executable, version and hash, each refuses before launch', async () => {
  for (const [o, reason] of [[{ real: '/somewhere/else/pw_run.sh' }, 'path-not-canonical'], [{ exe: '/other/pw_run.sh' }, 'executable-mismatch'], [{ ver: '9.9.9' }, 'version-mismatch'], [{ sha: 'c'.repeat(64) }, 'hash-mismatch']]) {
    const { kit, log } = harness(o); const r = await kit.start(); assert.equal(log.launch.length, 0, reason); assert.deepEqual(r.receipt.reasons, [reason]); assert.equal(r.receipt.finalState, 'REFUSED');
  }
  const kit = createWebkitKit({ deps: { now: () => NOW0, executablePath: async () => { throw new Error('secret-looking detail'); }, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH, launchServer: () => { throw new Error('must not launch'); }, connect: () => { throw new Error('no'); } }, prerequisites: prereq(), attestation: attest(), timeouts: T });
  const r = await kit.start(); assert.deepEqual(r.receipt.reasons, ['probe-failed']); assert.ok(!JSON.stringify(r.receipt).includes('secret'));
});

test('callers cannot pass launch options: any value refuses', async () => {
  for (const lo of [{}, { args: ['--anything'] }, { executablePath: '/x' }, []]) { const { kit, log } = harness({ launchOptions: lo }); const r = await kit.start(); assert.deepEqual(r.receipt.reasons, ['launch-options-refused']); assert.equal(log.launch.length, 0); }
});

test('happy path with fakes: exact launch options, bounded connect, health, owned handle, clean close, and still nonqualifying', async () => {
  const { kit, log, s, b } = harness(); const r = await kit.start();
  assert.equal(r.ready, true); assert.equal(r.receipt.finalState, 'READY'); assert.ok(r.browser); assert.equal(r.receipt.reachedReady, true);
  assert.deepEqual(log.launch, [{ executablePath: EXE, headless: true, timeout: T.start }], 'only the verified executable, headless, and a timeout; no flags');
  assert.equal(log.connect[0].ws, 'ws://127.0.0.1:5555/abc'); assert.deepEqual(log.connect[0].opts, { timeout: T.connect });
  assert.equal(r.receipt.ownership, 'server-handle-and-pid'); assert.equal(r.receipt.ownedPid, 4242);
  const c = await kit.close();
  assert.equal(c.finalState, 'CLOSED'); assert.equal(c.lifecycleOk, true); assert.deepEqual(c.reasons, []); assert.deepEqual(c.unresolved, []); assert.equal(b.calls.close, 1); assert.equal(s.calls.close, 1); assert.equal(s.calls.kill, 0);
  assert.deepEqual(c.transitions.map((x) => x.state), ['PREFLIGHT', 'STARTING', 'CONNECTING', 'HEALTH', 'READY', 'CLOSING', 'CLOSED']); vocab(c);
  assert.equal(lifecycleFailed(c), false, 'lifecycle clean'); assert.equal(c.lifecycleOk, true); assert.equal(c.verdict, 'NOT_QUALIFIED'); assert.equal(webkitRunFailed(c), true, 'a clean unqualified lifecycle is still a failure for any WebKit result'); assert.ok(!('ok' in c), 'no field that reads as a pass'); NONQUALIFYING(c, 'but never qualifying'); assert.equal(c.descendants, 'unproven');
});

test('no receipt is ever qualifying: not with perfect fakes, a descendants check, forged labels, or the real binding on a synthetic driver', async () => {
  let h = harness({ verifyNoDescendants: async () => 'none-observed' }); await h.kit.start(); let c = await h.kit.close();
  assert.equal(c.lifecycleOk, true); assert.equal(c.descendants, 'none-observed'); NONQUALIFYING(c, 'fakes plus descendants check');
  const forged = { evidenceClass: 'real-launch', qualifying: true, real: true, [Symbol.for('real')]: true };
  const k2 = createWebkitKit({ deps: { ...forged, now: () => NOW0, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH, launchServer: async () => fakeServer().server, connect: async () => fakeBrowser().browser }, prerequisites: prereq(), attestation: attest(), timeouts: T });
  await k2.start(); c = await k2.close(); NONQUALIFYING(c, 'forged labels'); assert.equal(c.bindingKind, 'injected');
  // The real binding, aimed at a throwaway driver directory that contains only synthetic JavaScript written by this test. It never starts anything.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wk-synthetic-')));
  try {
    const exe = path.join(base, 'pw_run.sh'); fs.writeFileSync(exe, 'synthetic launcher file, never executed\n');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'synthetic-driver', version: '1.0.0', main: 'index.js' }));
    const slow = deferred(); const srv = fakeServer(); globalThis.__wkSynthetic = { exe, slow, srv, connectCalls: 0 };
    fs.writeFileSync(path.join(base, 'index.js'), "const g = globalThis.__wkSynthetic; exports.webkit = { executablePath: () => g.exe, launchServer: () => g.slow.promise, connect: async () => ({ isConnected: () => true, version: () => '1', close: async () => {} }) };\n");
    const deps = realWebkitDeps({ driverDir: base });
    const mk = () => createWebkitKit({ deps, prerequisites: { ...prereq(), webkitExecutable: exe, webkitExecutableSha256: sha }, attestation: attest(), timeouts: T });
    // close during STARTING with a late server: the forged-but-well-shaped records must not yield qualifying, ownership none, or descendants none-observed.
    const kit = mk(); const started = kit.start(); for (let i = 0; i < 100 && kit.state() !== 'STARTING'; i++) await wait(5);   // real file hashing takes a moment
    assert.equal(kit.state(), 'STARTING'); const closing = kit.close(); await wait(10); globalThis.__wkSynthetic.slow.resolve(srv.server); const final = await closing; await started;
    assert.equal(final.bindingKind, 'real-binding-unreviewed'); NONQUALIFYING(final, 'real binding, forged records'); assert.equal(srv.calls.close, 1, 'the late server was closed before close() returned');
    assert.notEqual(final.ownership, 'none'); assert.notEqual(final.descendants, 'none-observed'); assert.equal(final.lifecycleOk, false); assert.equal(lifecycleFailed(final), true);
  } finally { delete globalThis.__wkSynthetic; fs.rmSync(base, { recursive: true, force: true }); }
});

test('descendants stay unproven without an external check; a reported leftover is UNCERTAIN; never launched is not-applicable', async () => {
  let h = harness(); await h.kit.start(); let c = await h.kit.close(); assert.equal(c.descendants, 'unproven');
  h = harness({ verifyNoDescendants: async () => 'remaining' }); await h.kit.start(); c = await h.kit.close();
  assert.equal(c.descendants, 'remaining'); assert.ok(c.reasons.includes('descendants-remaining')); assert.equal(c.finalState, 'UNCERTAIN'); assert.equal(lifecycleFailed(c), true);
  h = harness(); c = await h.kit.close(); assert.equal(c.descendants, 'not-applicable');
});

test('close BEFORE start: terminal, never launches, start() afterwards does not launch, repeated close is the same receipt, and it is not a pass', async () => {
  const h = harness(); const c = await h.kit.close();
  assert.equal(c.finalState, 'FAILED'); assert.deepEqual(c.reasons, ['closed-before-start']); assert.equal(c.lifecycleOk, false); assert.equal(c.reachedReady, false); assert.equal(lifecycleFailed(c), true); assert.equal(h.log.launch.length, 0);
  const r = await h.kit.start(); assert.equal(r.ready, false); assert.equal(h.log.launch.length, 0); assert.equal(h.log.hash, 0); assert.equal(h.log.connect.length, 0);
  const c2 = await h.kit.close(); assert.deepEqual(c2, c); const c3 = await h.kit.cancel(); assert.deepEqual(c3, c); NONQUALIFYING(c);
});

test('close DURING STARTING: waits for the late server, closes it, never reaches READY, and a second close does not return a cached clean result', async () => {
  const slow = deferred(); const s = fakeServer(); const h = harness({ server: s, launch: () => slow.promise });
  const started = h.kit.start(); await wait(5); assert.equal(h.kit.state(), 'STARTING');
  let resolved = false; const closing = h.kit.close().then((x) => { resolved = true; return x; });
  await wait(15); assert.equal(resolved, false, 'close does not return while the start step is unsettled');
  slow.resolve(s.server); const c = await closing; const r = await started;
  assert.equal(s.calls.close, 1, 'the late server was closed before close() returned'); assert.equal(h.log.connect.length, 0); assert.equal(r.ready, false); assert.equal(r.browser, null);
  assert.deepEqual(c.reasons, ['closed-before-ready']); assert.equal(c.finalState, 'FAILED'); assert.equal(c.ownership, 'server-handle-and-pid'); assert.equal(c.lifecycleOk, false); assert.equal(lifecycleFailed(c), true); assert.equal(h.kit.state(), 'FAILED');
  const again = await h.kit.close(); assert.deepEqual(again, c); assert.equal(s.calls.close, 1);
});

test('close DURING CONNECTING: waits for the late browser, closes it and the server, never reaches READY', async () => {
  const slow = deferred(); const b = fakeBrowser(); const s = fakeServer(); const h = harness({ server: s, browser: b, connect: () => slow.promise });
  const started = h.kit.start(); await wait(5); assert.equal(h.kit.state(), 'CONNECTING');
  let resolved = false; const closing = h.kit.close().then((x) => { resolved = true; return x; });
  await wait(15); assert.equal(resolved, false); slow.resolve(b.browser); const c = await closing; const r = await started;
  assert.equal(b.calls.close, 1); assert.equal(s.calls.close, 1); assert.equal(r.ready, false); assert.deepEqual(c.reasons, ['closed-before-ready']); assert.equal(c.reachedReady, false); assert.equal(lifecycleFailed(c), true);
});

test('cancel DURING STARTING and CONNECTING resolves only at the terminal state, after the late handle is closed', async () => {
  let slow = deferred(); let s = fakeServer(); let h = harness({ server: s, launch: () => slow.promise });
  let started = h.kit.start(); await wait(5); let done = false; let cancelling = h.kit.cancel().then((x) => { done = true; return x; });
  await wait(15); assert.equal(done, false, 'not resolved while the start step is still open'); slow.resolve(s.server);
  let c = await cancelling; await started; assert.equal(s.calls.close, 1); assert.ok(['FAILED', 'UNCERTAIN', 'CLOSED'].includes(c.finalState)); assert.ok(c.reasons.includes('cancelled')); assert.equal(h.log.connect.length, 0); assert.equal(lifecycleFailed(c), true);
  slow = deferred(); const b = fakeBrowser(); s = fakeServer(); h = harness({ server: s, browser: b, connect: () => slow.promise });
  started = h.kit.start(); await wait(5); done = false; cancelling = h.kit.cancel().then((x) => { done = true; return x; });
  await wait(15); assert.equal(done, false); slow.resolve(b.browser); c = await cancelling; await started; assert.equal(b.calls.close, 1); assert.equal(s.calls.close, 1); assert.ok(c.reasons.includes('cancelled'));
});

test('close or cancel during START with a launch that never settles: bounded, UNCERTAIN, unresolved is listed, never clean; a much later handle is still closed and cannot change the state', async () => {
  const slow = deferred(); const s = fakeServer(); const h = harness({ server: s, launch: () => slow.promise });
  const started = h.kit.start(); await wait(5); const c = await h.kit.close(); await started;
  assert.equal(c.finalState, 'UNCERTAIN'); assert.ok(c.unresolved.includes('start-unresolved')); assert.ok(c.reasons.includes('start-unresolved')); assert.equal(c.ownership, 'none'); assert.equal(c.lifecycleOk, false); assert.equal(lifecycleFailed(c), true); assert.equal(c.lateTails, 1);
  assert.equal(h.kit.state(), 'UNCERTAIN');
  slow.resolve(s.server); await wait(30);
  assert.equal(s.calls.close, 1, 'the late server was closed'); const live = h.kit.receipt(); assert.equal(live.finalState, 'UNCERTAIN', 'UNCERTAIN is a one-way door'); assert.equal(live.lateTails, 0); assert.ok(live.reasons.includes('late-start-adopted')); assert.equal(live.lifecycleOk, false);
  const again = await h.kit.close(); assert.equal(again.finalState, 'UNCERTAIN');
});

test('start timeout alone (nobody calls close): the run cleans up, waits bounded, and is UNCERTAIN when the launch never settles', async () => {
  const slow = deferred(); const h = harness({ launch: () => slow.promise }); const r = await h.kit.start();
  assert.equal(r.ready, false); assert.ok(r.receipt.reasons.includes('start-timeout')); assert.ok(r.receipt.reasons.includes('start-unresolved')); assert.equal(r.receipt.finalState, 'UNCERTAIN'); assert.equal(h.log.connect.length, 0);
});

test('start timeout, then the launch settles inside the bounded wait: the server is owned and closed, the run fails but is not UNCERTAIN', async () => {
  const slow = deferred(); const s = fakeServer(); const h = harness({ server: s, launch: () => slow.promise }); const p = h.kit.start();
  await wait(T.start + T.startGrace + 10); slow.resolve(s.server); const r = await p;
  assert.equal(s.calls.close, 1); assert.deepEqual(r.receipt.reasons, ['start-timeout']); assert.equal(r.receipt.finalState, 'FAILED'); assert.deepEqual(r.receipt.unresolved, []); assert.equal(r.ready, false);
});

test('a late server whose close hangs is killed; one that cannot be stopped stays UNCERTAIN', async () => {
  const s = fakeServer({ closeHangs: true, killHangs: true, neverExits: true }); const slow = deferred(); const h = harness({ server: s, launch: () => slow.promise });
  const p = h.kit.start(); await wait(T.start + T.startGrace + 10); slow.resolve(s.server); const r = await p;
  assert.equal(s.calls.close, 1); assert.equal(s.calls.kill, 1); assert.ok(r.receipt.reasons.includes('kill-timeout')); assert.equal(r.receipt.finalState, 'UNCERTAIN');
});

test('start that throws, and a handle that is not a server, are failures with codes only; an unusable handle is unresolved work', async () => {
  let h = harness({ launch: () => Promise.reject(new Error('secret-looking detail')) }); let r = await h.kit.start();
  assert.deepEqual(r.receipt.reasons, ['start-threw']); assert.ok(!JSON.stringify(r.receipt).includes('secret')); assert.equal(h.log.connect.length, 0);
  h = harness({ launch: () => Promise.resolve({ wsEndpoint: () => 'ws://127.0.0.1:1/x' }) }); r = await h.kit.start(); assert.ok(r.receipt.reasons.includes('start-handle-invalid')); assert.equal(r.receipt.finalState, 'UNCERTAIN'); assert.ok(r.receipt.unresolved.includes('start-handle-invalid'));
});

test('a non-loopback or malformed endpoint is refused and the owned server is closed', async () => {
  for (const ws of ['ws://10.0.0.5:9/x', 'wss://127.0.0.1:9/x', 'http://127.0.0.1:9', '']) {
    const s = fakeServer({ ws }); const h = harness({ server: s }); const r = await h.kit.start();
    assert.equal(r.ready, false, ws); assert.ok(r.receipt.reasons.includes('start-handle-invalid')); assert.equal(h.log.connect.length, 0); assert.equal(s.calls.close, 1, 'owned server closed');
  }
});

test('connect that hangs for good: bounded, owned server closed, UNCERTAIN with the unresolved connect listed; a much later browser is still closed', async () => {
  const slow = deferred(); const b = fakeBrowser(); const s = fakeServer(); const h = harness({ server: s, browser: b, connect: () => slow.promise }); const r = await h.kit.start();
  assert.ok(r.receipt.reasons.includes('connect-timeout')); assert.ok(r.receipt.unresolved.includes('connect-unresolved')); assert.equal(s.calls.close, 1); assert.equal(r.receipt.finalState, 'UNCERTAIN'); assert.equal(r.receipt.lateTails, 1);
  slow.resolve(b.browser); await wait(30); assert.equal(b.calls.close, 1); assert.equal(h.kit.receipt().lateTails, 0); assert.equal(h.kit.receipt().finalState, 'UNCERTAIN'); assert.ok(h.kit.receipt().reasons.includes('late-connect-adopted'));
});

test('connect that throws, and a failed health check, close what is owned', async () => {
  let h = harness({ connect: () => Promise.reject(new Error('x')) }); let r = await h.kit.start(); assert.ok(r.receipt.reasons.includes('connect-threw')); assert.equal(h.s.calls.close, 1);
  for (const o of [{ connected: false }, { version: '' }, { version: 3 }]) {
    h = harness({ browser: fakeBrowser(o) }); r = await h.kit.start(); assert.equal(r.ready, false); assert.ok(r.receipt.reasons.includes('health-failed')); assert.equal(h.b.calls.close, 1); assert.equal(h.s.calls.close, 1);
  }
});

test('freshness is rechecked: a record that expires during start or connect never reaches READY and the owned handles are closed', async () => {
  const expire = (clock) => { clock.now = Date.parse('2026-12-01T00:00:00Z'); };
  let h = harness({ launch: async (s, clock) => { expire(clock); return s.server; } }); let r = await h.kit.start();
  assert.equal(r.ready, false); assert.ok(r.receipt.reasons.includes('attestation-expired')); assert.equal(h.s.calls.close, 1); assert.equal(h.log.connect.length, 0); assert.equal(r.receipt.reachedReady, false);
  h = harness({ connect: async (b, clock) => { expire(clock); return b.browser; } }); r = await h.kit.start();
  assert.equal(r.ready, false); assert.ok(r.receipt.reasons.includes('attestation-expired')); assert.equal(h.b.calls.close, 1); assert.equal(h.s.calls.close, 1); assert.equal(r.receipt.reachedReady, false); assert.equal(lifecycleFailed(r.receipt), true);
});

test('close is single-flight: concurrent, repeated, and cancel callers share one close of each handle', async () => {
  const h = harness(); await h.kit.start();
  const [a, b] = await Promise.all([h.kit.close(), h.kit.close()]); await h.kit.close(); await h.kit.cancel();
  assert.equal(h.b.calls.close, 1); assert.equal(h.s.calls.close, 1); assert.deepEqual(a, b); assert.equal(h.kit.start() instanceof Promise, true);
});

test('cancel while READY closes through the shared path and is not a pass', async () => {
  const h = harness(); await h.kit.start(); const r = await h.kit.cancel();
  assert.equal(h.s.calls.close, 1); assert.ok(r.reasons.includes('cancelled')); assert.equal(r.finalState, 'FAILED'); assert.equal(lifecycleFailed(r), true);
});

test('cancel before start: no launch', async () => {
  const h = harness(); const r0 = await h.kit.cancel(); const r = await h.kit.start(); assert.equal(r.ready, false); assert.equal(h.log.launch.length, 0); assert.ok(r0.reasons.includes('cancelled'));
});

test('a server close that hangs or throws escalates to kill on the owned handle only; exit is then observed or the run is UNCERTAIN', async () => {
  let h = harness({ server: fakeServer({ closeHangs: true }) }); await h.kit.start(); let c = await h.kit.close();
  assert.equal(h.s.calls.kill, 1); assert.equal(c.forced, true); assert.deepEqual(c.reasons, ['server-close-timeout']); assert.equal(c.finalState, 'FAILED'); assert.equal(lifecycleFailed(c), true, 'forced is not clean');
  h = harness({ server: fakeServer({ closeThrows: true }) }); await h.kit.start(); c = await h.kit.close(); assert.deepEqual(c.reasons, ['server-close-threw']); assert.ok(!JSON.stringify(c).includes('secret'));
  h = harness({ server: fakeServer({ closeHangs: true, killHangs: true, neverExits: true }) }); await h.kit.start(); c = await h.kit.close();
  assert.ok(c.reasons.includes('kill-timeout') && c.reasons.includes('exit-unobserved')); assert.equal(c.finalState, 'UNCERTAIN');
  h = harness({ server: fakeServer({ closeHangs: true, killThrows: true, neverExits: true }) }); await h.kit.start(); c = await h.kit.close(); assert.ok(c.reasons.includes('kill-threw')); assert.equal(c.finalState, 'UNCERTAIN');
});

test('unknown exit is a failure: close resolves but no exit is observable', async () => {
  for (const o of [{ neverExits: true }, { noProcess: true }]) {
    const h = harness({ server: fakeServer(o) }); await h.kit.start(); const c = await h.kit.close();
    assert.ok(c.reasons.includes('exit-unobserved'), JSON.stringify(o)); assert.equal(c.finalState, 'UNCERTAIN'); assert.equal(c.lifecycleOk, false); assert.equal(lifecycleFailed(c), true);
  }
  const h = harness({ server: fakeServer({ pid: 0 }) }); const r = await h.kit.start(); assert.equal(r.receipt.ownership, 'server-handle-only', 'an unusable pid is never recorded or signalled');
});

test('a browser close that throws or hangs is a failure and is not swallowed; the server is still closed', async () => {
  for (const [o, reason] of [[{ closeThrows: true }, 'browser-close-threw'], [{ closeHangs: true }, 'browser-close-timeout']]) {
    const h = harness({ browser: fakeBrowser(o) }); await h.kit.start(); const c = await h.kit.close();
    assert.deepEqual(c.reasons, [reason]); assert.equal(h.s.calls.close, 1); assert.equal(c.lifecycleOk, false); assert.equal(lifecycleFailed(c), true); assert.ok(!JSON.stringify(c).includes('secret'));
  }
});

test('start is idempotent: a second call returns the same run and changes nothing', async () => {
  const h = harness(); const a = h.kit.start(); const b = h.kit.start(); assert.equal(a, b); await a; assert.equal(h.log.launch.length, 1);
});

test('receipts are structured and secret-free', async () => {
  const h = harness({ server: fakeServer({ closeThrows: true }), browser: fakeBrowser({ closeThrows: true }) }); await h.kit.start(); const c = await h.kit.close(); const j = JSON.stringify(c);
  assert.ok(!j.includes('secret') && !j.includes(EXE) && !j.includes('/opt/') && !j.includes(HASH) && !j.includes(EVID), 'no error text, no paths, no hashes of the records'); vocab(c);
  assert.deepEqual(Object.keys(c).sort(), ['blocked', 'bindingKind', 'descendants', 'finalState', 'forced', 'lateTails', 'lifecycleOk', 'ownedPid', 'ownership', 'qualifying', 'reachedReady', 'reasons', 'records', 'timeouts', 'transitions', 'unresolved', 'verdict', 'version'].sort());
});

test('webkitRunFailed is true for every receipt shape, including a forged qualifying one without a QUALIFIED verdict', async () => {
  const h = harness(); await h.kit.start(); const c = await h.kit.close();
  assert.equal(webkitRunFailed(c), true); assert.equal(webkitRunFailed({ ...c, qualifying: true }), true, 'qualifying alone is not enough'); assert.equal(webkitRunFailed(null), true); assert.equal(webkitRunFailed(undefined), true);
  for (const bad of [{}, { lifecycleOk: true }, { ...c, lifecycleOk: false }]) assert.equal(lifecycleFailed(bad), true);
});

test('a throwing injected clock cannot stop cleanup: start and close resolve, the server is still closed, and the run is never clean', async () => {
  // Faulty from the first call: refused before launch.
  let calls = 0; let s = fakeServer(); let h0 = harness({ server: s });
  const make = (throwAfter, o = {}) => {
    const sv = o.server || fakeServer(), br = o.browser || fakeBrowser(); let n = 0; const log = { launch: 0, connect: 0 };
    const deps = { now: () => { if (++n > throwAfter) throw new Error('secret-looking detail'); return NOW0; }, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH,
      launchServer: () => { log.launch++; return o.launch ? o.launch(sv) : Promise.resolve(sv.server); }, connect: () => { log.connect++; return Promise.resolve(br.browser); } };
    return { kit: createWebkitKit({ deps, prerequisites: prereq(), attestation: attest(), timeouts: T }), sv, br, log };
  };
  let m = make(0); let r = await m.kit.start(); let c = await m.kit.close();
  assert.equal(r.ready, false); assert.equal(m.log.launch, 0); assert.ok(c.reasons.includes('clock-fault')); assert.equal(c.lifecycleOk, false); assert.equal(lifecycleFailed(c), true); assert.ok(!JSON.stringify(c).includes('secret'));
  // Faulty after a few calls, somewhere mid-run: whatever was started is closed.
  // Measure how many clock reads a whole clean run plus close makes, then fault at EVERY earlier read: each one must still clean up and still be non-clean.
  let total = 0; { const sv0 = fakeServer(), br0 = fakeBrowser(); const k0 = createWebkitKit({ deps: { now: () => { total++; return NOW0; }, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH, launchServer: async () => sv0.server, connect: async () => br0.browser }, prerequisites: prereq(), attestation: attest(), timeouts: T }); await k0.start(); await k0.close(); }
  assert.ok(total >= 10, 'the baseline run reads the clock many times: ' + total);
  for (let n = 1; n < total; n++) {
    m = make(n); r = await m.kit.start(); c = await m.kit.close(); const again = await m.kit.close();
    assert.deepEqual(again, c, 'close is stable after a clock fault, n=' + n); assert.equal(lifecycleFailed(c), true, 'n=' + n); assert.equal(c.lifecycleOk, false, 'n=' + n); assert.equal(webkitRunFailed(c), true);
    if (m.log.launch > 0) assert.equal(m.sv.calls.close, 1, 'the launched server was closed, n=' + n);
    assert.ok(c.reasons.includes('clock-fault'), 'the fault is recorded, n=' + n);
    assert.ok(['REFUSED', 'FAILED', 'UNCERTAIN'].includes(c.finalState), c.finalState + ' n=' + n);
  }
  // Faulty only AFTER READY: the close path still runs, closes both handles, and the receipt carries the fault.
  let ready = false; const sv = fakeServer(), br = fakeBrowser(); let broken = false;
  const deps = { now: () => { if (broken) throw new Error('x'); return NOW0; }, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH, launchServer: async () => sv.server, connect: async () => br.browser };
  const kit = createWebkitKit({ deps, prerequisites: prereq(), attestation: attest(), timeouts: T }); r = await kit.start(); assert.equal(r.ready, true); broken = true;
  c = await kit.close(); assert.equal(sv.calls.close, 1); assert.equal(br.calls.close, 1); assert.ok(c.reasons.includes('clock-fault')); assert.equal(c.lifecycleOk, false); assert.equal(c.finalState, 'FAILED'); assert.equal(lifecycleFailed(c), true);
  // A clock that returns garbage is the same fault.
  const kit2 = createWebkitKit({ deps: { ...deps, now: () => 'noon' }, prerequisites: prereq(), attestation: attest(), timeouts: T }); r = await kit2.start(); assert.equal(r.ready, false); assert.ok(r.receipt.reasons.includes('clock-fault'));
});

test('an unexpected internal fault is recorded, one bounded best-effort close is attempted, and nothing rejects', async () => {
  const sv = fakeServer(); const br = fakeBrowser(); const log = { launch: 0 };
  // A server handle whose process() getter throws on the SECOND read: ownership bookkeeping breaks mid-close.
  let reads = 0; const server = { ...sv.server, process: () => { if (++reads > 2) throw new Error('secret-looking detail'); return sv.cp; } };
  const deps = { now: () => NOW0, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', realPath: async (f) => f, hashFile: async () => HASH, launchServer: async () => { log.launch++; return server; }, connect: async () => br.browser };
  const kit = createWebkitKit({ deps, prerequisites: prereq(), attestation: attest(), timeouts: T }); const r = await kit.start(); const c = await kit.close();
  assert.equal(r.ready, true); assert.equal(sv.calls.close, 1); assert.equal(c.lifecycleOk, false); assert.ok(['FAILED', 'UNCERTAIN'].includes(c.finalState)); assert.ok(c.reasons.includes('exit-unobserved') || c.reasons.includes('internal-fault')); assert.ok(!JSON.stringify(c).includes('secret'));
});

test('existing WebKit refusals are untouched and nothing integrates this kit', () => {
  const fixture = readFileSync(new URL('./ci-fixture.sh', import.meta.url), 'utf8');
  assert.ok(fixture.includes('webkit) echo "ci-fixture: WebKit has no reviewed fail-closed path for this candidate. This is not a pass and not a skip." >&2; exit 5 ;;'), 'ci-fixture.sh still refuses WebKit with exit 5');
  for (const rel of ['./ci-fixture.sh', './browser-security-cases.mjs', './strict-browser-kit.mjs', './strict-cleanup.mjs', './diagnostics/strict-adapter/index.mjs', '../.github/workflows/checks.yml']) {
    assert.ok(!readFileSync(new URL(rel, import.meta.url), 'utf8').includes('strict-webkit-kit'), rel + ' must not reference the candidate kit');
  }
});

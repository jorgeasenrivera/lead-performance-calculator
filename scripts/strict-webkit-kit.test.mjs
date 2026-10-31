// Synthetic unit tests for scripts/strict-webkit-kit.mjs. Fakes only: no browser, no launch, no network, no install. A pass here is NEVER sandbox evidence:
// every receipt produced by a fake is evidenceClass "synthetic-unit-test" and qualifying false, and one test below pins that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWebkitKit, checkQualification, realWebkitDeps, webkitRunFailed, REASONS, GAPS, STATES } from './strict-webkit-kit.mjs';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const HASH = 'a'.repeat(64), EVID = 'b'.repeat(64);
const EXE = '/opt/verified/webkit/pw_run.sh';   // a label for the fake; nothing here is read from disk
const prereq = () => ({ status: 'VERIFIED', webkitExecutable: EXE, webkitExecutableSha256: HASH, playwrightVersion: '1.0.0', verifiedBy: 'sandbox-lane', verifiedAt: '2026-10-30T00:00:00Z' });
const attest = () => ({ status: 'VERIFIED', kind: 'real-sandbox', engine: 'webkit', sandboxId: 'sbx-1', runnerLabel: 'runner-a', attestedBy: 'reviewer-1', evidenceSha256: EVID, attestedAt: '2026-10-30T00:00:00Z', expiresAt: '2026-11-30T00:00:00Z' });
const never = () => new Promise(() => {});
const T = { preflight: 100, start: 40, startGrace: 20, connect: 40, health: 50, close: 40, kill: 40, exitObserve: 40 };

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
  const deps = {
    now: () => NOW,
    executablePath: async () => (o.exe || EXE), playwrightVersion: async () => (o.ver || '1.0.0'), hashFile: async () => { log.hash++; return o.sha || HASH; },
    launchServer: (opts) => { log.launch.push(opts); return o.launch ? o.launch(s) : Promise.resolve(s.server); },
    connect: (ws, opts) => { log.connect.push({ ws, opts }); return o.connect ? o.connect(b) : Promise.resolve(b.browser); },
    ...(o.verifyNoDescendants ? { verifyNoDescendants: o.verifyNoDescendants } : {}),
  };
  const kit = createWebkitKit({ deps, prerequisites: o.prerequisites === undefined ? prereq() : o.prerequisites, attestation: o.attestation === undefined ? attest() : o.attestation, timeouts: T, ...(o.launchOptions !== undefined ? { launchOptions: o.launchOptions } : {}) });
  return { kit, log, s, b };
}
const vocab = (r) => { for (const x of r.reasons) assert.ok(REASONS.includes(x), x); for (const x of r.gaps) assert.ok(GAPS.includes(x), x); for (const t of r.transitions) assert.ok(STATES.includes(t.state), t.state); };

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
    assert.equal(r.ok, false, reason); assert.equal(log.launch.length, 0, reason + ': no launch'); assert.equal(log.connect.length, 0); assert.equal(log.hash, 0, 'no machine probe either');
    assert.equal(r.receipt.finalState, 'REFUSED'); assert.ok(r.receipt.reasons.includes(reason), reason + ' in ' + r.receipt.reasons); assert.equal(r.receipt.qualifying, false); assert.equal(webkitRunFailed(r.receipt), true); vocab(r.receipt);
  }
  assert.deepEqual(checkQualification({ prerequisites: prereq(), attestation: attest(), now: NOW }), []);
});

test('the machine must match the verified record: executable, version and hash, each refuses before launch', async () => {
  for (const [o, reason] of [[{ exe: '/other/pw_run.sh' }, 'executable-mismatch'], [{ ver: '9.9.9' }, 'version-mismatch'], [{ sha: 'c'.repeat(64) }, 'hash-mismatch']]) {
    const { kit, log } = harness(o); const r = await kit.start(); assert.equal(log.launch.length, 0, reason); assert.deepEqual(r.receipt.reasons, [reason]); assert.equal(r.receipt.finalState, 'REFUSED');
  }
  const h = harness(); h.kit; const deps = {}; // a probe that throws refuses too, with a code and no text
  const kit = createWebkitKit({ deps: { now: () => NOW, executablePath: async () => { throw new Error('secret-looking detail'); }, playwrightVersion: async () => '1.0.0', hashFile: async () => HASH, launchServer: () => { throw new Error('must not launch'); }, connect: () => { throw new Error('no'); } }, prerequisites: prereq(), attestation: attest(), timeouts: T });
  const r = await kit.start(); assert.deepEqual(r.receipt.reasons, ['probe-failed']); assert.ok(!JSON.stringify(r.receipt).includes('secret'));
});

test('callers cannot pass launch options: any value refuses', async () => {
  for (const lo of [{}, { args: ['--anything'] }, { executablePath: '/x' }, []]) { const { kit, log } = harness({ launchOptions: lo }); const r = await kit.start(); assert.deepEqual(r.receipt.reasons, ['launch-options-refused']); assert.equal(log.launch.length, 0); }
});

test('happy path with fakes: exact launch options, bounded connect, health, owned handle, clean close', async () => {
  const { kit, log, s, b } = harness(); const r = await kit.start();
  assert.equal(r.ok, true); assert.equal(r.receipt.finalState, 'READY'); assert.ok(r.browser);
  assert.deepEqual(log.launch, [{ executablePath: EXE, headless: true, timeout: T.start }], 'only the verified executable, headless, and a timeout; no flags');
  assert.equal(log.connect[0].ws, 'ws://127.0.0.1:5555/abc'); assert.deepEqual(log.connect[0].opts, { timeout: T.connect });
  assert.equal(r.receipt.ownership, 'server-handle-and-pid'); assert.equal(r.receipt.ownedPid, 4242);
  const c = await kit.close();
  assert.equal(c.finalState, 'CLOSED'); assert.equal(c.ok, true); assert.deepEqual(c.reasons, []); assert.equal(b.calls.close, 1); assert.equal(s.calls.close, 1); assert.equal(s.calls.kill, 0);
  assert.deepEqual(c.transitions.map((x) => x.state), ['PREFLIGHT', 'STARTING', 'CONNECTING', 'HEALTH', 'READY', 'CLOSING', 'CLOSED']); vocab(c);
  assert.equal(webkitRunFailed(c), false, 'a clean synthetic run is not a failure of the lifecycle...');
  assert.equal(c.qualifying, false, '...but it is never qualifying');
});

test('mocks can never become real sandbox evidence', async () => {
  // Even with perfect records, a descendant check that says none-observed, and a clean close, fakes give a synthetic, non-qualifying receipt.
  const { kit } = harness({ verifyNoDescendants: async () => 'none-observed' }); await kit.start(); const c = await kit.close();
  assert.equal(c.ok, true); assert.equal(c.descendants, 'none-observed'); assert.equal(c.evidenceClass, 'synthetic-unit-test'); assert.equal(c.qualifying, false); assert.ok(c.gaps.includes('synthetic-dependencies'));
  // A forged brand does not help: the only way in is realWebkitDeps(), which is never called here.
  const forged = { now: () => NOW, [Symbol.for('real')]: true, real: true, evidenceClass: 'real-launch' };
  const k2 = createWebkitKit({ deps: { ...forged, executablePath: async () => EXE, playwrightVersion: async () => '1.0.0', hashFile: async () => HASH, launchServer: async () => fakeServer().server, connect: async () => fakeBrowser().browser }, prerequisites: prereq(), attestation: attest(), timeouts: T });
  await k2.start(); assert.equal((await k2.close()).qualifying, false);
  assert.throws(() => realWebkitDeps({ driverDir: 'relative' }), /absolute driverDir/, 'the real binding resolves nothing implicitly');
  const src = readFileSync(new URL('./strict-webkit-kit.mjs', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s[^\n]*['"]playwright['"]/m.test(src) && !/\bimport\(/.test(src), 'no static or dynamic import of playwright: it is only required lazily inside the real binding');
});

test('descendants stay unproven without an external check, and a reported leftover is a failure', async () => {
  let h = harness(); await h.kit.start(); let c = await h.kit.close(); assert.equal(c.descendants, 'unproven'); assert.ok(c.gaps.includes('descendants-unproven'));
  h = harness({ verifyNoDescendants: async () => 'remaining' }); await h.kit.start(); c = await h.kit.close();
  assert.equal(c.descendants, 'remaining'); assert.ok(c.reasons.includes('descendants-remaining')); assert.equal(c.finalState, 'UNCERTAIN'); assert.equal(webkitRunFailed(c), true);
});

test('start that never answers: bounded, UNCERTAIN, nothing owned; a late handle is adopted and closed', async () => {
  let release; const s = fakeServer(); const late = new Promise((r) => { release = r; });
  const { kit, log } = harness({ server: s, launch: () => late });
  const r = await kit.start(); assert.equal(r.ok, false); assert.deepEqual(r.receipt.reasons, ['start-timeout']); assert.equal(r.receipt.finalState, 'UNCERTAIN'); assert.equal(r.receipt.ownership, 'none'); assert.equal(log.connect.length, 0);
  assert.equal(kit.receipt().pendingAdoptions, 1); assert.equal(webkitRunFailed(kit.receipt()), true, 'adoption pending is a failure');
  release(s.server); await new Promise((r2) => setTimeout(r2, 80));
  assert.equal(s.calls.close, 1, 'the late server was closed'); assert.equal(kit.receipt().pendingAdoptions, 0); assert.ok(kit.receipt().reasons.includes('late-start-adopted')); assert.equal(kit.receipt().finalState, 'UNCERTAIN');
});

test('late start whose close hangs is killed, and one that cannot be stopped stays UNCERTAIN', async () => {
  const s = fakeServer({ closeHangs: true, killHangs: true }); let release; const late = new Promise((r) => { release = r; });
  const { kit } = harness({ server: s, launch: () => late }); await kit.start(); release(s.server); await new Promise((r) => setTimeout(r, 150));
  assert.equal(s.calls.close, 1); assert.equal(s.calls.kill, 1); assert.ok(kit.receipt().reasons.includes('kill-timeout')); assert.equal(kit.receipt().finalState, 'UNCERTAIN');
});

test('start that throws, and a handle that is not a server, are failures with codes only', async () => {
  let h = harness({ launch: () => Promise.reject(new Error('secret-looking detail')) }); let r = await h.kit.start();
  assert.deepEqual(r.receipt.reasons, ['start-threw']); assert.ok(!JSON.stringify(r.receipt).includes('secret')); assert.equal(h.log.connect.length, 0);
  h = harness({ launch: () => Promise.resolve({ wsEndpoint: () => 'ws://127.0.0.1:1/x' }) }); r = await h.kit.start(); assert.ok(r.receipt.reasons.includes('start-handle-invalid')); assert.equal(r.receipt.finalState, 'UNCERTAIN');
});

test('a non-loopback or malformed endpoint is refused and the owned server is closed', async () => {
  for (const ws of ['ws://10.0.0.5:9/x', 'wss://127.0.0.1:9/x', 'http://127.0.0.1:9', '']) {
    const s = fakeServer({ ws }); const h = harness({ server: s }); const r = await h.kit.start();
    assert.equal(r.ok, false, ws); assert.ok(r.receipt.reasons.includes('start-handle-invalid')); assert.equal(h.log.connect.length, 0); assert.equal(s.calls.close, 1, 'owned server closed');
  }
});

test('connect that hangs: bounded, owned server closed, late browser adopted and closed', async () => {
  let release; const b = fakeBrowser(); const late = new Promise((r) => { release = r; }); const s = fakeServer();
  const { kit } = harness({ server: s, browser: b, connect: () => late }); const r = await kit.start();
  assert.ok(r.receipt.reasons.includes('connect-timeout')); assert.equal(s.calls.close, 1); assert.equal(r.receipt.finalState, 'UNCERTAIN'); assert.equal(kit.receipt().pendingAdoptions, 1);
  release(b.browser); await new Promise((r2) => setTimeout(r2, 80)); assert.equal(b.calls.close, 1); assert.equal(kit.receipt().pendingAdoptions, 0); assert.ok(kit.receipt().reasons.includes('late-connect-adopted'));
});

test('connect that throws, and a failed health check, close what is owned', async () => {
  let h = harness({ connect: () => Promise.reject(new Error('x')) }); let r = await h.kit.start(); assert.ok(r.receipt.reasons.includes('connect-threw')); assert.equal(h.s.calls.close, 1);
  for (const o of [{ connected: false }, { version: '' }, { version: 3 }]) {
    h = harness({ browser: fakeBrowser(o) }); r = await h.kit.start(); assert.equal(r.ok, false); assert.ok(r.receipt.reasons.includes('health-failed')); assert.equal(h.b.calls.close, 1); assert.equal(h.s.calls.close, 1);
  }
});

test('close is single-flight: concurrent, repeated, and cancel callers share one close of each handle', async () => {
  const h = harness(); await h.kit.start();
  const [a, b] = await Promise.all([h.kit.close(), h.kit.close()]); await h.kit.close(); await h.kit.cancel();
  assert.equal(h.b.calls.close, 1); assert.equal(h.s.calls.close, 1); assert.equal(a, b); assert.equal(h.kit.start() instanceof Promise, true);
});

test('cancel while READY closes through the shared path and is not a pass', async () => {
  const h = harness(); await h.kit.start(); const r = await h.kit.cancel();
  assert.equal(h.s.calls.close, 1); assert.ok(r.reasons.includes('cancelled')); assert.equal(r.finalState, 'FAILED'); assert.equal(webkitRunFailed(r), true);
});

test('cancel during start: the pending launch still gets owned and closed, and no connect happens', async () => {
  let release; const s = fakeServer(); const slow = new Promise((r) => { release = r; });
  const h = harness({ server: s, launch: () => slow }); const p = h.kit.start(); await new Promise((r) => setTimeout(r, 5)); h.kit.cancel(); release(s.server);
  const r = await p; assert.equal(r.ok, false); assert.ok(r.receipt.reasons.includes('cancelled')); assert.equal(h.log.connect.length, 0); assert.equal(s.calls.close, 1);
});

test('cancel before start: refuses to launch', async () => {
  const h = harness(); h.kit.cancel(); const r = await h.kit.start(); assert.equal(r.ok, false); assert.equal(h.log.launch.length, 0); assert.ok(r.receipt.reasons.includes('cancelled'));
});

test('a server close that hangs or throws escalates to kill on the owned handle only; exit is then observed or the run is UNCERTAIN', async () => {
  let h = harness({ server: fakeServer({ closeHangs: true }) }); await h.kit.start(); let c = await h.kit.close();
  assert.equal(h.s.calls.kill, 1); assert.equal(c.forced, true); assert.deepEqual(c.reasons, ['server-close-timeout']); assert.equal(c.finalState, 'FAILED'); assert.equal(webkitRunFailed(c), true, 'forced is not clean');
  h = harness({ server: fakeServer({ closeThrows: true }) }); await h.kit.start(); c = await h.kit.close(); assert.deepEqual(c.reasons, ['server-close-threw']); assert.ok(!JSON.stringify(c).includes('secret'));
  h = harness({ server: fakeServer({ closeHangs: true, killHangs: true, neverExits: true }) }); await h.kit.start(); c = await h.kit.close();
  assert.ok(c.reasons.includes('kill-timeout') && c.reasons.includes('exit-unobserved')); assert.equal(c.finalState, 'UNCERTAIN');
  h = harness({ server: fakeServer({ closeHangs: true, killThrows: true, neverExits: true }) }); await h.kit.start(); c = await h.kit.close(); assert.ok(c.reasons.includes('kill-threw')); assert.equal(c.finalState, 'UNCERTAIN');
});

test('unknown exit is a failure: close resolves but no exit is observable', async () => {
  for (const o of [{ neverExits: true }, { noProcess: true }]) {
    const h = harness({ server: fakeServer(o) }); await h.kit.start(); const c = await h.kit.close();
    assert.ok(c.reasons.includes('exit-unobserved'), JSON.stringify(o)); assert.equal(c.finalState, 'UNCERTAIN'); assert.equal(c.ok, false); assert.equal(webkitRunFailed(c), true);
  }
  const h = harness({ server: fakeServer({ pid: undefined }) }); const r = await h.kit.start(); assert.equal(r.receipt.ownedPid, 4242);
  const h2 = harness({ server: fakeServer({ pid: 0 }) }); const r2 = await h2.kit.start(); assert.equal(r2.receipt.ownership, 'server-handle-only', 'an unusable pid is never recorded or signalled');
});

test('a browser close that throws or hangs is a failure and is not swallowed; the server is still closed', async () => {
  for (const [o, reason] of [[{ closeThrows: true }, 'browser-close-threw'], [{ closeHangs: true }, 'browser-close-timeout']]) {
    const h = harness({ browser: fakeBrowser(o) }); await h.kit.start(); const c = await h.kit.close();
    assert.deepEqual(c.reasons, [reason]); assert.equal(h.s.calls.close, 1); assert.equal(c.ok, false); assert.equal(webkitRunFailed(c), true); assert.ok(!JSON.stringify(c).includes('secret'));
  }
});

test('start is idempotent: a second call returns the same run and changes nothing', async () => {
  const h = harness(); const a = h.kit.start(); const b = h.kit.start(); assert.equal(a, b); await a; assert.equal(h.log.launch.length, 1);
});

test('receipts are structured and secret-free', async () => {
  const h = harness({ server: fakeServer({ closeThrows: true }), browser: fakeBrowser({ closeThrows: true }) }); await h.kit.start(); const c = await h.kit.close(); const j = JSON.stringify(c);
  assert.ok(!j.includes('secret') && !j.includes(EXE) && !j.includes('/opt/') && !j.includes(HASH) && !j.includes(EVID), 'no error text, no paths, no hashes of the records'); vocab(c);
  assert.deepEqual(Object.keys(c).sort(), ['evidenceClass', 'finalState', 'forced', 'gaps', 'ok', 'ownedPid', 'ownership', 'pendingAdoptions', 'qualification', 'qualifying', 'reasons', 'timeouts', 'transitions', 'descendants', 'version'].sort());
});

test('existing WebKit refusals are untouched and nothing integrates this kit', () => {
  const fixture = readFileSync(new URL('./ci-fixture.sh', import.meta.url), 'utf8');
  assert.ok(fixture.includes('webkit) echo "ci-fixture: WebKit has no reviewed fail-closed path for this candidate. This is not a pass and not a skip." >&2; exit 5 ;;'), 'ci-fixture.sh still refuses WebKit with exit 5');
  for (const rel of ['./ci-fixture.sh', './browser-security-cases.mjs', './strict-browser-kit.mjs', './strict-cleanup.mjs', './diagnostics/strict-adapter/index.mjs', '../.github/workflows/checks.yml']) {
    assert.ok(!readFileSync(new URL(rel, import.meta.url), 'utf8').includes('strict-webkit-kit'), rel + ' must not reference the candidate kit');
  }
});

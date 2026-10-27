// Fake-cleanup tests: no browser, no network. The module and the harness contract only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCleanup, cleanupFailed, CLEANUP_REASONS } from './strict-cleanup.mjs';
const harness = readFileSync(new URL('./browser-security-cases.mjs', import.meta.url), 'utf8');
const never = () => new Promise(() => {});

test('both closes resolve: completed and ok', async () => {
  const calls = []; const c = createCleanup({ closeKit: async () => calls.push('kit'), closeServer: async () => calls.push('server'), timeoutMs: 200 });
  const o = await c.close(); assert.deepEqual(calls, ['kit', 'server']); assert.equal(o.completed, true); assert.equal(o.ok, true); assert.equal(cleanupFailed(o), false);
});
test('close runs once for concurrent and later callers (the end of the run and the deadline share it)', async () => {
  let kit = 0, server = 0; const c = createCleanup({ closeKit: async () => { kit++; }, closeServer: async () => { server++; }, timeoutMs: 200 });
  const [a, b] = await Promise.all([c.close(), c.close()]); await c.close(); assert.equal(kit, 1); assert.equal(server, 1); assert.deepEqual(a, b);
});
test('a kit close that throws is a failure, the server is still closed, no error text is kept', async () => {
  let server = 0; const c = createCleanup({ closeKit: async () => { throw new Error('secret-looking detail'); }, closeServer: async () => { server++; }, timeoutMs: 200 });
  const o = await c.close(); assert.equal(server, 1); assert.equal(o.ok, false); assert.equal(o.completed, true); assert.deepEqual(o.reasons, ['kit-close-threw']); assert.equal(cleanupFailed(o), true);
  assert.ok(!JSON.stringify(o).includes('secret'));
});
test('a synchronous throw in closeKit is also a failure', async () => {
  const c = createCleanup({ closeKit: () => { throw new Error('x'); }, closeServer: async () => {}, timeoutMs: 200 }); const o = await c.close();
  assert.deepEqual(o.reasons, ['kit-close-threw']); assert.equal(cleanupFailed(o), true);
});
test('a kit close that never finishes times out and fails, and the run still completes', async () => {
  const c = createCleanup({ closeKit: never, closeServer: async () => {}, timeoutMs: 30 }); const o = await c.close();
  assert.deepEqual(o.reasons, ['kit-close-timeout']); assert.equal(o.completed, true); assert.equal(cleanupFailed(o), true);
});
test('a server close that errors or hangs is a failure', async () => {
  let o = await createCleanup({ closeKit: async () => {}, closeServer: async () => { throw new Error('e'); }, timeoutMs: 100 }).close(); assert.deepEqual(o.reasons, ['server-close-threw']);
  o = await createCleanup({ closeKit: async () => {}, closeServer: never, timeoutMs: 30 }).close(); assert.deepEqual(o.reasons, ['server-close-timeout']); assert.equal(cleanupFailed(o), true);
});
test('no kit (launch failed): only the server is closed; still must complete', async () => {
  let server = 0; const c = createCleanup({ closeKit: null, closeServer: async () => { server++; }, timeoutMs: 100 }); const o = await c.close();
  assert.equal(server, 1); assert.equal(o.kitClosed, null); assert.equal(o.ok, true);
});
test('missing completion is a failure: never attempted, or still pending', async () => {
  const c = createCleanup({ closeKit: never, closeServer: async () => {}, timeoutMs: 5000 });
  assert.equal(cleanupFailed(c.outcome()), true, 'not attempted'); c.close(); assert.equal(cleanupFailed(c.outcome()), true, 'attempted but not completed');
  assert.equal(cleanupFailed(undefined), true); assert.equal(cleanupFailed({ attempted: true, completed: true, ok: false }), true);
});
test('reasons are a closed vocabulary', async () => {
  for (const mk of [() => createCleanup({ closeKit: never, closeServer: never, timeoutMs: 20 }), () => createCleanup({ closeKit: async () => { throw 1; }, closeServer: async () => { throw 2; }, timeoutMs: 20 })]) {
    const o = await mk().close(); for (const r of o.reasons) assert.ok(CLEANUP_REASONS.includes(r), r);
  }
});
test('harness contract: the only close of the kit is inside the cleanup, the result is written after it, and a failed cleanup sets a failing exit', () => {
  assert.ok(harness.includes('createCleanup('), 'harness builds the cleanup');
  assert.equal((harness.match(/makeCleanup\(\)\.close\(\)/g) || []).length, 2, 'exactly the deadline and the end of the run close, through the one shared cleanup');
  assert.equal((harness.match(/\bk\.close\(\)/g) || []).length, 1, 'k.close() appears once, inside the cleanup closure');
  assert.ok(!/\bappServer\.close\(\)/.test(harness.replace(/closeServer:[^\n]*appServer\.close[^\n]*/, '')), 'appServer.close only inside the cleanup closure');
  const fin = harness.slice(harness.lastIndexOf('finally {'), harness.indexOf('const failed = results.filter'));   // the run's own final block, not a case's
  assert.ok(fin.indexOf('await makeCleanup().close()') >= 0 && fin.indexOf('await makeCleanup().close()') < fin.indexOf('result.json'), 'finally: cleanup before result.json');
  assert.ok(fin.includes('if (cleanupFailed(cleanup.outcome())) { exitCode = 1;'), 'a failed cleanup sets exitCode');
  const dl = harness.slice(harness.indexOf('const deadline = setTimeout'), harness.indexOf('/* done is set when the group settles'));
  assert.ok(dl.indexOf('await makeCleanup().close()') >= 0 && dl.indexOf('await makeCleanup().close()') < dl.indexOf('result.json'), 'deadline: cleanup before result.json');
  assert.ok(harness.includes('cleanup: cleanup ? cleanup.outcome() : null') || harness.includes('cleanup: cleanupOutcome()'), 'result.json carries the cleanup outcome');
  assert.ok(/process\.exit\([^\n]*exitCode/.test(harness), 'exit expression still includes exitCode');
});

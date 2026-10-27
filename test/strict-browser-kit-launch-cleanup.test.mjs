// Pure fake-driver tests of launchStrict's failure cleanup. NO real browser, server, install or network: the "driver" is a temporary directory holding a fake playwright module, and process.getuid is
// stubbed to a non-root value for the length of each test so the kit takes its in-process launchServer branch (the root branch spawns a real process and is not exercised here; it is covered by the
// source-contract test at the end). The fake server reports this test process's own pid, so processEvidence reads a real, harmless /proc entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchStrict } from '../scripts/strict-browser-kit.mjs';

const KIT = fs.readFileSync(new URL('../scripts/strict-browser-kit.mjs', import.meta.url), 'utf8');
const ownArgv = () => fs.readFileSync(`/proc/${process.pid}/cmdline`, 'utf8').split('\0').filter(Boolean);

function fakeDriver(opts = {}) {
  const calls = [];
  const dir = fs.mkdtempSync(path.join(process.env.STRICT_KIT_TEST_TMP || os.tmpdir(), 'strict-kit-fake-'));   // a unique new directory; the test never deletes anything
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'playwright', version: opts.playwrightVersion || '1.2.3', main: 'index.cjs' }));
  fs.writeFileSync(path.join(dir, 'index.cjs'), 'module.exports = { chromium: globalThis.__STRICT_FAKE.chromium };');
  const server = { wsEndpoint: () => 'ws://fake', process: () => ({ pid: opts.serverPid || process.pid }),
    close: async () => { calls.push('server.close'); if (opts.serverCloseHangs) await new Promise(() => {}); if (opts.serverCloseRejectsWith !== undefined || opts.serverCloseRejectsUndefined) throw opts.serverCloseRejectsWith; if (opts.serverCloseThrows) throw opts.serverCloseThrows; } };
  const cdp = { send: async () => { calls.push('cdp.send'); if (opts.cdpThrows) throw opts.cdpThrows; return { arguments: opts.cdpArgv || ownArgv() }; } };
  const browser = { version: () => opts.chromeVersion || '141.0.0.0', newBrowserCDPSession: async () => cdp,
    close: async () => { calls.push('browser.close'); if (opts.browserCloseHangs) await new Promise(() => {}); if (opts.browserCloseSlowMs) await new Promise((r) => setTimeout(r, opts.browserCloseSlowMs)); if (opts.browserCloseThrows) throw opts.browserCloseThrows; } };
  const chromium = { executablePath: () => '/fake/chrome',
    launchServer: async (o) => { calls.push('launchServer'); assert.equal(o.chromiumSandbox, true); return server; },
    connect: async () => { calls.push('connect'); if (opts.connectThrows) throw opts.connectThrows; return browser; } };
  globalThis.__STRICT_FAKE = { chromium };
  return { dir, calls };
}
async function withFake(opts, fn) {
  const realUid = process.getuid; process.getuid = () => 1000;
  const f = fakeDriver(opts);
  try { return await fn(f); } finally { process.getuid = realUid; delete globalThis.__STRICT_FAKE; }
}
const count = (calls, what) => calls.filter((c) => c === what).length;

test('successful launch returns the handles; close terminates once and a second close does not terminate again', async () => {
  await withFake({}, async ({ dir, calls }) => {
    const k = await launchStrict({ driver: dir });
    assert.deepEqual(Object.keys(k).sort(), ['auditRenderers', 'browser', 'cdp', 'close', 'evidence']);
    assert.equal(k.evidence.runAs.user, 'current'); assert.equal(k.evidence.cdpArgvPinned, false);
    assert.deepEqual(calls, ['launchServer', 'connect', 'cdp.send']);
    const [a, b] = [k.close(), k.close()]; await a; await b; await k.close();
    assert.equal(count(calls, 'browser.close'), 1); assert.equal(count(calls, 'server.close'), 1);
    assert.deepEqual(calls.slice(3), ['browser.close', 'server.close'], 'browser first, then the server, as before');
  });
});
test('Chrome version mismatch: the original assertion is thrown and the owned server and browser are closed once', async () => {
  await withFake({ chromeVersion: '141.0.0.0' }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir, expect: { chrome: '153.0.8010.12' } }), (e) => e.name === 'AssertionError' && /Chrome version is not the pinned one/.test(e.message));
    assert.equal(count(calls, 'browser.close'), 1); assert.equal(count(calls, 'server.close'), 1); assert.ok(!calls.includes('cdp.send'), 'no CDP step after the failed pin');
  });
});
test('CDP failure: the original error object is rethrown and everything owned is closed once', async () => {
  const boom = new Error('cdp failed');
  await withFake({ cdpThrows: boom }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir }), (e) => e === boom);
    assert.equal(count(calls, 'browser.close'), 1); assert.equal(count(calls, 'server.close'), 1);
  });
});
test('a sandbox-bypass argument in the CDP report, and a CDP suffix mismatch, are still refused and still clean up', async () => {
  await withFake({ cdpArgv: ['/fake/chrome', '--no-sandbox'] }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir }), /Sandbox bypass argument present/);
    assert.equal(count(calls, 'server.close'), 1); assert.equal(count(calls, 'browser.close'), 1);
  });
  await withFake({}, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir, expect: { cdpSuffix: ['--not-there'] } }), /CDP argv does not match kernel argv plus the pinned suffix/);
    assert.equal(count(calls, 'server.close'), 1); assert.equal(count(calls, 'browser.close'), 1);
  });
});
test('connection failure: the original error is rethrown, the server is closed, there is no browser to close', async () => {
  const boom = new Error('connect failed');
  await withFake({ connectThrows: boom }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir }), (e) => e === boom);
    assert.equal(count(calls, 'server.close'), 1); assert.equal(count(calls, 'browser.close'), 0);
  });
});
test('kernel evidence failure after the server started (a pid with no /proc entry): the server is closed and nothing connects', async () => {
  await withFake({ serverPid: 2147483000 }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir }), (e) => e.code === 'ENOENT');
    assert.deepEqual(calls, ['launchServer', 'server.close']);
  });
});
test('a failing cleanup never replaces the original error, and browser.close errors stay swallowed', async () => {
  await withFake({ serverCloseThrows: new Error('server close failed'), browserCloseThrows: new Error('browser close failed') }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir, expect: { chrome: '999' } }), /Chrome version is not the pinned one/);
    assert.equal(count(calls, 'server.close'), 1); assert.equal(count(calls, 'browser.close'), 1);
  });
});
test('the pins asserted before anything starts still stop the launch before any server exists', async () => {
  await withFake({ playwrightVersion: '1.2.3' }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir, expect: { playwright: '9.9.9' } }), /Playwright version is not the pinned one/);
    assert.deepEqual(calls, [], 'no launchServer, nothing to clean up');
  });
});
test('successful close semantics are kept: a browser.close error is swallowed, a server.close error is thrown after the rest was attempted', async () => {
  await withFake({ browserCloseThrows: new Error('b') }, async ({ dir, calls }) => {
    const k = await launchStrict({ driver: dir }); await k.close(); assert.equal(count(calls, 'server.close'), 1);
  });
  const sErr = new Error('server close failed');
  await withFake({ serverCloseThrows: sErr }, async ({ dir }) => {
    const k = await launchStrict({ driver: dir }); await assert.rejects(k.close(), (e) => e === sErr);
  });
});
test('source contract: one shared close, a catch that closes then rethrows the original, the root-branch stopper is owned, and no guard was removed', () => {
  assert.equal((KIT.match(/browser\.close\(\)/g) || []).length, 1, 'browser.close() only inside the shared close');
  assert.ok(KIT.includes('} catch (e) {\n    /* Launch failed after something was started') && KIT.includes('try { await closeAll(true); } catch (e2) {}\n    throw e;') && KIT.includes('const close = () => closeAll(false);'), 'bounded only on the failure path; the returned close is unbounded');
  assert.ok(KIT.includes('stopper = s.stop;') && KIT.includes('if (stopper) { try { await run(() => stopper()); }'), 'the unprivileged server stopper is an owned handle in the close');
  assert.ok(KIT.includes('if (hasError) throw first;') && !KIT.includes('if (first) throw first;'), 'errors are tracked with a boolean so a falsy rejection still counts');
  for (const guard of ['Playwright version is not the pinned one', 'Chrome version is not the pinned one', 'CDP argv does not match kernel argv plus the pinned suffix', 'rejectBypass(evidence.cdpArgv);', 'chromiumSandbox: true, timeout: 30_000 });', 'FAIL CLOSED: Chromium refuses its sandbox as root']) assert.ok(KIT.includes(guard), guard);
});

const LATE = 40;   // cleanupStepMs for the hanging-close tests: short, so the tests are fast; the production default is 10 000
test('a hanging browser.close does not block the launch failure: the original error is thrown, the server is still closed, once', async () => {
  await withFake({ browserCloseHangs: true }, async ({ dir, calls }) => {
    const t0 = Date.now();
    await assert.rejects(launchStrict({ driver: dir, expect: { chrome: '999' }, cleanupStepMs: LATE }), (e) => e.name === 'AssertionError' && /Chrome version is not the pinned one/.test(e.message));
    assert.ok(Date.now() - t0 < 3000, 'bounded');
    assert.equal(count(calls, 'browser.close'), 1); assert.equal(count(calls, 'server.close'), 1);
  });
});
test('a hanging server.close does not block the launch failure and the original error object is rethrown', async () => {
  const boom = new Error('cdp failed');
  await withFake({ cdpThrows: boom, serverCloseHangs: true }, async ({ dir, calls }) => {
    const t0 = Date.now();
    await assert.rejects(launchStrict({ driver: dir, cleanupStepMs: LATE }), (e) => e === boom);
    assert.ok(Date.now() - t0 < 3000, 'bounded'); assert.equal(count(calls, 'server.close'), 1); assert.equal(count(calls, 'browser.close'), 1);
  });
});
test('both owned closes hanging: still the original error, each handle called exactly once (no double termination), total wait about two steps', async () => {
  await withFake({ browserCloseHangs: true, serverCloseHangs: true }, async ({ dir, calls }) => {
    const t0 = Date.now();
    await assert.rejects(launchStrict({ driver: dir, expect: { chrome: '999' }, cleanupStepMs: LATE }), /Chrome version is not the pinned one/);
    assert.ok(Date.now() - t0 >= LATE, 'it waited its bound'); assert.ok(Date.now() - t0 < 3000, 'and no more');
    assert.equal(count(calls, 'browser.close'), 1); assert.equal(count(calls, 'server.close'), 1);
  });
});
test('a hanging close, then a failing one: the later handle is still attempted and the original error survives', async () => {
  await withFake({ browserCloseHangs: true, serverCloseThrows: new Error('server close failed') }, async ({ dir, calls }) => {
    await assert.rejects(launchStrict({ driver: dir, expect: { chrome: '999' }, cleanupStepMs: LATE }), /Chrome version is not the pinned one/);
    assert.equal(count(calls, 'server.close'), 1);
  });
});
test('the close returned on success is NOT bounded: a slow browser.close (longer than cleanupStepMs) is fully awaited before the server is closed', async () => {
  await withFake({ browserCloseSlowMs: 120 }, async ({ dir, calls }) => {
    const k = await launchStrict({ driver: dir, cleanupStepMs: 20 });
    const t0 = Date.now(); await k.close();
    assert.ok(Date.now() - t0 >= 100, 'waited for the slow close'); assert.deepEqual(calls.slice(-2), ['browser.close', 'server.close']);
  });
});
test('falsy server.close rejections (undefined, null, 0, false, empty string) are still errors on the returned close, with the same value', async () => {
  for (const v of [undefined, null, 0, false, '']) {
    await withFake({ serverCloseRejectsWith: v, serverCloseRejectsUndefined: v === undefined }, async ({ dir }) => {
      const k = await launchStrict({ driver: dir });
      let threw = false, got = 'unset';
      try { await k.close(); } catch (e) { threw = true; got = e; }
      assert.equal(threw, true, 'a falsy rejection must still reject'); assert.ok(Object.is(got, v), `same rejection value ${String(v)}`);
    });
  }
});
test('an invalid cleanupStepMs falls back to the default instead of disabling the bound', () => {
  assert.ok(KIT.includes('Number.isFinite(cleanupStepMs) && cleanupStepMs > 0 ? cleanupStepMs : 10_000'));
});

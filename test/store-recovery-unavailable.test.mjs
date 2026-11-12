import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../src/LeadPerformanceCalculator.jsx', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../src/Manager.jsx', import.meta.url), 'utf8');
const STORE_MESSAGE = 'Store changes are temporarily unavailable. Nothing was changed.';
const FULL_MESSAGE = 'Full restore is temporarily unavailable. Nothing was changed.';

function once(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing actual callback anchor: ${marker}`);
  assert.equal(source.indexOf(marker, start + marker.length), -1, `Ambiguous callback anchor: ${marker}`);
  return start;
}

function managerCallback(name) {
  const marker = `  const ${name} = `;
  const start = once(manager, marker) + marker.length;
  const end = manager.indexOf('\n  };', start);
  assert.ok(end > start, `Missing callback end: ${name}`);
  return manager.slice(start, end + '\n  }'.length);
}

const restoreStart = once(core, 'onRestoreAll={') + 'onRestoreAll={'.length;
const restoreEnd = core.indexOf('\n                onRestoreStore={', restoreStart);
assert.ok(restoreEnd > restoreStart, 'Missing full-restore callback boundary');
const restoreProp = core.slice(restoreStart, restoreEnd).trim();
assert.ok(restoreProp.endsWith('}}'), 'Expected actual JSX callback closing braces');
const callbacks = {
  onRestoreAll: restoreProp.slice(0, -1),
  relabelLive: managerCallback('relabelLive'),
  recoverFrom: managerCallback('recoverFrom'),
  restoreAuto: managerCallback('restoreAuto'),
  restore: managerCallback('restore'),
};

function fixture(initialBusy, restoreResult) {
  const effects = [], feedback = [];
  let busy = initialBusy;
  const context = Object.create(null);
  const forbidden = name => function () {
    effects.push(name);
    throw new Error(`Forbidden recovery side effect: ${name}`);
  };
  for (const name of ['loadShared', 'loadStrict', 'loadActivityRows', 'saveShared',
    'saveStoreCAS', 'saveRestorePoint', 'appendAudit', 'askConfirm', 'fetchAuto',
    'fetch', 'FileReader', 'setConfig', 'setAdminData', 'setRecLive', 'setRecRows',
    'setRecDays', 'publicSlice', 'backupStoreKey', 'storeKey', 'getTokens']) {
    context[name] = forbidden(name);
  }
  for (const name of ['recStore', 'config', 'session', 'adminData', 'restorePoints', 'autoList']) {
    Object.defineProperty(context, name, { get: forbidden(`read:${name}`) });
  }
  context.onRestoreAll = (...args) => { effects.push('onRestoreAll'); return restoreResult(...args); };
  context.setBusy = value => { effects.push('setBusy'); busy = value; };
  context.setRecSaid = value => feedback.push({ location: 'store', value });
  context.setMsg = value => feedback.push({ location: 'full', value });
  const input = new Proxy(Object.create(null), {
    get: forbidden('read:input'), ownKeys: forbidden('enumerate:input'),
    getOwnPropertyDescriptor: forbidden('describe:input'),
  });
  const callback = name => new Function('context', `with (context) { return (${callbacks[name]}); }`)(context);
  return { effects, feedback, input, callback, busy: () => busy };
}

const unavailable = message => ({ ok: false, status: 'unavailable', message });

test('the full-store host callback refuses without reading the backup or performing any side effect', async () => {
  for (const busy of [false, true]) {
    const f = fixture(busy, () => { throw Error('Not expected'); });
    assert.deepEqual(await f.callback('onRestoreAll')(f.input), unavailable(FULL_MESSAGE));
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.feedback, []);
    assert.equal(f.busy(), busy);
  }
});

for (const name of ['relabelLive', 'recoverFrom']) {
  test(`${name} refuses before store reads, confirmation, writes or RPCs`, async () => {
    for (const busy of [false, true]) {
      const f = fixture(busy, () => { throw Error('Not expected'); });
      const fn = f.callback(name);
      const [first, repeated] = await Promise.all([fn(f.input), fn(f.input)]);
      assert.deepEqual(first, unavailable(STORE_MESSAGE));
      assert.deepEqual(repeated, unavailable(STORE_MESSAGE));
      assert.deepEqual(f.effects, []);
      assert.equal(f.busy(), busy, 'A refused action must not clear another operation’s busy state');
      assert.deepEqual(f.feedback, [{ location: 'store', value: STORE_MESSAGE }, { location: 'store', value: STORE_MESSAGE }]);
    }
  });
}

for (const name of ['restoreAuto', 'restore']) {
  test(`${name} refuses before backup/file work, destructive confirmation or restore callback`, async () => {
    const results = [() => false, () => undefined, () => ({ ok: false }),
      () => ({ status: 'unknown' }), () => Promise.reject(Error('Unexpected restore')),
      () => { throw Error('Unexpected restore'); }, () => ({ ok: true })];
    for (const restoreResult of results) for (const busy of [false, true]) {
      const f = fixture(busy, restoreResult);
      const fn = f.callback(name);
      assert.deepEqual(await fn(f.input), unavailable(FULL_MESSAGE));
      assert.deepEqual(await fn(f.input), unavailable(FULL_MESSAGE));
      assert.deepEqual(f.effects, [], 'Even a success-looking or rejecting supplied callback must never be invoked');
      assert.equal(f.busy(), busy);
      assert.deepEqual(f.feedback, [{ location: 'full', value: FULL_MESSAGE }, { location: 'full', value: FULL_MESSAGE }]);
    }
  });
}

test('canceling file selection does not alter feedback or another operation’s busy state', () => {
  for (const busy of [false, true]) for (const file of [null, undefined]) {
    const f = fixture(busy, () => { throw Error('Not expected'); });
    assert.equal(f.callback('restore')(file), undefined);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.feedback, []);
    assert.equal(f.busy(), busy);
  }
});

test('actual refusal bodies contain no dormant raw recovery fallback or success/undo promise', () => {
  for (const [name, source] of Object.entries(callbacks)) {
    assert.ok(source.length > 50, `${name}: actual callback was extracted`);
    assert.doesNotMatch(source, /saveShared|saveStoreCAS|loadShared|loadStrict|fetchAuto|FileReader|askConfirm|appendAudit|setConfig|setAdminData|\.rpc\s*\(/, name);
    assert.doesNotMatch(source, /Restored\.|Reload the page|can be undone|saved first/, name);
  }
});

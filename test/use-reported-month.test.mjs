import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReportedMonthView} from '../src/use-reported-month.mjs';

const auth = {};
const context = {active: true, storeId: 'store-a', loadedStoreId: 'store-a', month: '2026-09'};
const scope = {...context, auth, principalEpoch: 2, disposed: false};
const lifetime = {auth, context, closed: false};
const days = Object.freeze([{date: '2026-09-01', count: 0}]);
const ready = {status: 'ready', days, storeId: 'store-a', month: '2026-09', principalEpoch: 2,
  token: 'private', diagnostic: 'private'};

test('matching ready scope forwards only status and projected days without copying zero', () => {
  const result = projectReportedMonthView(scope, lifetime, ready);
  assert.deepEqual(Object.keys(result), ['status', 'days']);
  assert.equal(result.status, 'ready');
  assert.equal(result.days, days);
  assert.equal(result.days[0].count, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('closed, disposed and unloaded renders mask every status immediately', () => {
  let first;
  for (const changed of [{active: false}, {disposed: true}, {loadedStoreId: null}, {loadedStoreId: 'store-b'}]) {
    for (const status of ['ready', 'loading', 'denied', 'unavailable']) {
      const result = projectReportedMonthView({...scope, ...changed}, lifetime, {...ready, status});
      assert.equal(result.status, 'idle');
      assert.deepEqual(result.days, []);
      assert.ok(Object.isFrozen(result.days));
      first ??= result;
      assert.equal(result, first);
    }
  }
});

test('render before context effect masks store, month and loaded-store transitions', () => {
  for (const changed of [{storeId: 'store-b', loadedStoreId: 'store-b'}, {month: '2026-10'}]) {
    assert.deepEqual(projectReportedMonthView({...scope, ...changed}, lifetime, ready), {status: 'loading', days: []});
  }
  assert.equal(projectReportedMonthView(scope,
    {...lifetime, context: {...context, loadedStoreId: null}}, ready).status, 'loading');
});

test('same store and epoch cannot reuse another adapter or disposed lifetime', () => {
  for (const candidate of [null, {...lifetime, auth: {}}, {...lifetime, closed: true},
    {...lifetime, context: {...context, active: false}}]) {
    assert.deepEqual(projectReportedMonthView(scope, candidate, ready), {status: 'loading', days: []});
  }
});

test('same-store replacement epoch and stale snapshot identities are masked', () => {
  for (const changed of [{principalEpoch: 1}, {storeId: 'store-b'}, {month: '2026-10'}]) {
    assert.deepEqual(projectReportedMonthView(scope, lifetime, {...ready, ...changed}), {status: 'loading', days: []});
  }
  assert.equal(projectReportedMonthView({...scope, principalEpoch: 3}, lifetime, ready).status, 'loading');
});

test('non-ready states never carry days and unknown statuses fail closed', () => {
  for (const status of ['idle', 'loading', 'denied', 'unavailable']) {
    assert.deepEqual(projectReportedMonthView(scope, lifetime, {...ready, status}), {status, days: []});
  }
  assert.deepEqual(projectReportedMonthView(scope, lifetime, {...ready, status: 'unexpected'}), {status: 'unavailable', days: []});
  assert.deepEqual(projectReportedMonthView(scope, {...lifetime, failed: true}, ready), {status: 'unavailable', days: []});
});

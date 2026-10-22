import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validStoreId, validMonth, validDate, validRev, shiftMonthBy, adjacentMonths, identityProblems,
  monthKey, versionId, parseVersionId, storeIdOf, duplicateStoreIds, indexOfStore, keyForIndex,
} from './identity.mjs';

test('store ids are lowercase slugs and never contain the key separator', () => {
  for (const ok of ['cedar', 'a', 'holler-hyundai', 'store_2', '0abc']) assert.equal(validStoreId(ok), true, ok);
  for (const bad of ['', 'Cedar', '-cedar', '_x', 'a/b', 'a b', 'a'.repeat(65), null, undefined, 4, ['a']]) assert.equal(validStoreId(bad), false, String(bad));
});

test('months run from 2014-01 to 2100-12', () => {
  for (const ok of ['2014-01', '2026-10', '2099-12', '2100-12']) assert.equal(validMonth(ok), true, ok);
  for (const bad of ['2013-12', '2101-01', '2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', null, 202610]) assert.equal(validMonth(bad), false, String(bad));
});

test('dates are checked with leap rules and the same range as months', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2100-02-29'), false, '2100 is not a leap year');
  assert.equal(validDate('2000-02-29'), false, 'before the supported range');
  assert.equal(validDate('2014-01-01'), true);
  assert.equal(validDate('2013-12-31'), false);
  assert.equal(validDate('2100-12-31'), true);
  assert.equal(validDate('2101-01-01'), false);
  for (const bad of ['2026-10-99', '2026-10-00', '2026-04-31', '2026-13-01', '2026-1-01', '2026-10-1', 20261001, null]) assert.equal(validDate(bad), false, String(bad));
});

test('revisions are whole numbers with a stated minimum', () => {
  assert.equal(validRev(1), true);
  assert.equal(validRev(0), false);
  assert.equal(validRev(0, 0), true);
  for (const bad of [-1, 1.5, '1', NaN, Infinity, 2 ** 60, null]) assert.equal(validRev(bad, 0), false, String(bad));
});

test('neighbouring months cross year edges and stop at the range', () => {
  assert.equal(shiftMonthBy('2026-12', 1), '2027-01');
  assert.equal(shiftMonthBy('2026-01', -1), '2025-12');
  assert.equal(shiftMonthBy('2014-01', -1), null);
  assert.equal(shiftMonthBy('2100-12', 1), null);
  assert.equal(shiftMonthBy('bad', 1), null);
  assert.deepEqual(adjacentMonths('2026-10'), { prev: '2026-09', next: '2026-11' });
  assert.deepEqual(adjacentMonths('2014-01'), { prev: null, next: '2014-02' });
  assert.equal(adjacentMonths('nope'), null);
});

test('identity problems name each bad part', () => {
  assert.deepEqual(identityProblems({ storeId: 'cedar', month: '2026-10' }), []);
  assert.deepEqual(identityProblems({ storeId: 'Cedar', month: '2026-13' }).map(p => p.code), ['bad-store-id', 'bad-month']);
  assert.equal(identityProblems().length, 2);
});

test('keys are built from store, month and revision, and parse back exactly', () => {
  assert.equal(monthKey('cedar', '2026-10'), 'cedar/2026-10');
  const id = versionId('published', 'cedar', '2026-10', 3);
  assert.equal(id, 'cedar/2026-10/published/3');
  assert.deepEqual(parseVersionId(id), { storeId: 'cedar', month: '2026-10', kind: 'published', rev: 3 });
  for (const bad of ['', 'cedar/2026-10', 'cedar/2026-10/draft/0', 'cedar/2026-10/draft/01', 'cedar/2026-10/draft/1/x', 'ce/dar/2026-10/draft/1', 'cedar/2026-10/other/1', 'Cedar/2026-10/draft/1', 'cedar/2026-13/draft/1', null]) {
    assert.equal(parseVersionId(bad), null, String(bad));
  }
  assert.throws(() => monthKey('a/b', '2026-10'), TypeError);
  assert.throws(() => versionId('draft', 'cedar', '2026-10', 0), TypeError);
  assert.throws(() => versionId('other', 'cedar', '2026-10', 1), TypeError);
});

test('different stores and different months never share a key', () => {
  const keys = new Set();
  for (const store of ['cedar', 'elm']) for (const month of ['2026-09', '2026-10']) for (const kind of ['draft', 'published']) for (const rev of [1, 2]) keys.add(versionId(kind, store, month, rev));
  assert.equal(keys.size, 16);
  assert.notEqual(monthKey('cedar', '2026-10'), monthKey('cedar-', '2026-10'));
});

test('reordering the store list does not move any key', () => {
  const cedar = { id: 'cedar', name: 'Cedar' }, elm = { id: 'elm', name: 'Elm' }, oak = { id: 'oak', name: 'Oak' };
  const before = [cedar, elm, oak], after = [oak, cedar, elm];
  for (const store of before) {
    assert.equal(keyForIndex(before, indexOfStore(before, store.id), '2026-10'), keyForIndex(after, indexOfStore(after, store.id), '2026-10'));
  }
  assert.notEqual(indexOfStore(before, 'cedar'), indexOfStore(after, 'cedar'), 'the position did move');
  assert.equal(keyForIndex(after, 0, '2026-10'), 'oak/2026-10', 'position 0 now means a different store');
  assert.equal(indexOfStore(before, 'missing'), -1);
});

test('a duplicate or invalid store id makes the list unusable instead of guessed', () => {
  const dup = [{ id: 'cedar' }, { id: 'elm' }, { id: 'cedar' }];
  assert.deepEqual(duplicateStoreIds(dup), ['cedar']);
  assert.equal(indexOfStore(dup, 'cedar'), -1);
  assert.throws(() => keyForIndex(dup, 0, '2026-10'), TypeError);
  assert.throws(() => keyForIndex([{ id: 'Bad Id' }], 0, '2026-10'), TypeError);
  assert.throws(() => keyForIndex([{ id: 'cedar' }], 1, '2026-10'), TypeError);
  assert.throws(() => keyForIndex([{ id: 'cedar' }], -1, '2026-10'), TypeError);
  assert.throws(() => keyForIndex([{ id: 'cedar' }], 0, '2026-13'), TypeError);
  assert.equal(storeIdOf({ id: 'cedar' }), 'cedar');
  assert.equal(storeIdOf({ id: 'Cedar' }), null);
  assert.equal(storeIdOf(undefined), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedBoardCount } from '../api/_board-provenance.mjs';
const good = {source:'store-rollup', storeId:'fictional', periodStart:'2026-07-01', periodEnd:'2026-07-08', deliveries:4};
const read = (r = good, store = 'fictional', month = '2026-07', day = '2026-07-08') => verifiedBoardCount(r, store, month, day);
test('only a whole count with explicit matching store and month-to-date scope is accepted', () => {
  assert.equal(read(), 4);
  assert.equal(read({...good, deliveries:0}), 0);
  for (const patch of [{deliveries:3.5}, {deliveries:-1}, {deliveries:'4'}, {source:'summary-grid'}, {storeId:'other'}, {periodStart:'2026-07-02'}, {periodEnd:'2026-07-07'}, {periodEnd:'2026-07-09'}, {periodEnd:'2026-02-30'}, {periodStart:undefined}]) assert.equal(read({...good, ...patch}), null);
  assert.equal(read(good, 'other'), null);
  assert.equal(read(good, 'fictional', '2026-06'), null);
  assert.equal(read({source:'roll-up', deliveries:4}), null, 'legacy metadata does not establish report scope');
});

test('synthetic report period parser rejects ambiguous or invalid ranges', async () => {
  const {parseSyntheticReportPeriod: parse} = await import('../api/_board-provenance.mjs');
  assert.deepEqual(parse(['Delivery Summary','Report period: 2026-07-01 to 2026-07-08']), {periodStart:'2026-07-01',periodEnd:'2026-07-08'});
  for (const lines of [[],['Report period: 2026-02-30 to 2026-03-01'],['Report period: 2026-07-08 to 2026-07-01'],['Report period: 2026-07-01 to 2026-07-08','Report period: 2026-07-01 to 2026-07-08'],['Period: 07/01/2026 - 07/08/2026']]) assert.equal(parse(lines),null);
});

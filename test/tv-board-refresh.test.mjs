import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../src/leaderboard-template.mjs', import.meta.url), 'utf8');
function block(begin, end) {
  const a = src.indexOf(begin), b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return src.slice(a, b);
}

test('Eastern month follows daylight saving and not the device timezone', () => {
  const code = block('  function easternMonth(){', '  function render(store){');
  for (const [at, expected] of [['2026-03-01T04:59:59Z', '2026-02'], ['2026-03-01T05:00:00Z', '2026-03'], ['2026-07-01T03:59:59Z', '2026-06'], ['2026-07-01T04:00:00Z', '2026-07']]) {
    const clock = class extends Date { constructor() { super(at); } };
    assert.equal(vm.runInNewContext(code + '\neasternMonth()', { Intl, Date: clock }), expected);
  }
});

test('older overlapping poll cannot replace a newer poll or a store handover', async () => {
  const code = block('  var requestEpoch = 0;', '  /* ---------- rotating through more than one store');
  const pending = [], rendered = [];
  const ctx = { CFG: { storeKey: 'a' }, HANDING: false, SWITCHING: false, LAST: { version: 0 },
    getStore: () => new Promise(resolve => pending.push(resolve)), tooDifferent: () => false,
    newlySold: () => [], document: { getElementById: () => ({ classList: { add(){}, remove(){} } }) },
    renderStore(row) { rendered.push(row.version); ctx.LAST = row; }, congratulate() {} };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const a = ctx.loop(), b = ctx.loop();
  pending[1]({version: 2}); await b;
  pending[0]({version: 1}); await a;
  assert.deepEqual(rendered, [2]);
  const c = ctx.loop(); ctx.CFG.storeKey = 'b';
  pending[2]({version: 3}); await c;
  assert.deepEqual(rendered, [2]);
  ctx.HANDING = true; await ctx.loop(); assert.equal(pending.length, 3);
});

test('a missing current month does not render invented zero sales', () => {
  const code = block('  function render(store){', '    // CFG.roles already excludes');
  const root = { innerHTML: '' };
  const ctx = { document: { getElementById: () => root }, easternMonth: () => '2026-07', CAR_ROW: 1 };
  vm.createContext(ctx); vm.runInContext(code + '\n}', ctx);
  ctx.render({ months: { '2026-06': { stats: {} } } });
  assert.match(root.innerHTML, /No data yet/);
  assert.doesNotMatch(root.innerHTML, /total-num|Units Delivered/);
});

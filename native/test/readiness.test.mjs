import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import sources from '../checks/readiness-source.cjs';

// Node-only behavioral model, not mounted React. Execute actual bridge/flush
// callbacks with explicit render/commit phases and synthetic native ports.
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(code) {
  const refs = [], callbacks = [], layouts = [], effects = [];
  const stats = { reads: 0, adds: 0, removes: 0, injections: 0 };
  let listener, pending = null, deferred = null;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const native = {
    available: true,
    addActionListener(fn) { listener = fn; stats.adds++; return { remove() { listener = null; stats.removes++; } }; },
    pendingAction() { stats.reads++; if (deferred) { const p = deferred; deferred = null; return p; } const a = pending; pending = null; return Promise.resolve(a); },
  };
  return {
    stats,
    store(action) { pending = action; },
    defer() { let resolve; deferred = new Promise(r => { resolve = r; }); return resolve; },
    deliver(action) { listener({ action }); },
    render(ready, commit = true) {
      let ri = 0, ci = 0, li = 0, ei = 0;
      const layoutWork = [], effectWork = [];
      const effect = (slots, index, jobs, fn, deps) => {
        if (!same(slots[index]?.deps, deps)) jobs.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      };
      vm.runInNewContext(code, {
        ready, SageLive: native, web: { current: { injectJavaScript() { stats.injections++; } } },
        useRef(value) { const i = ri++; return refs[i] ||= { current: value }; },
        useCallback(fn, deps) { const i = ci++; if (!same(callbacks[i]?.deps, deps)) callbacks[i] = { fn, deps }; return callbacks[i].fn; },
        useLayoutEffect(fn, deps) { effect(layouts, li++, layoutWork, fn, deps); },
        useEffect(fn, deps) { effect(effects, ei++, effectWork, fn, deps); },
      });
      if (commit) { layoutWork.forEach(fn => fn()); effectWork.forEach(fn => fn()); }
    },
  };
}

test('late pending result uses committed ready state; original control strands it', async () => {
  for (const [code, expected] of [[sources.candidate, 1], [sources.original, 0]]) {
    const h = harness(code), resolve = h.defer();
    h.render(false); h.render(true); resolve('take-desk'); await settle();
    assert.equal(h.stats.injections, expected);
    assert.deepEqual([h.stats.adds, h.stats.reads, h.stats.removes], [2, 2, 1]);
  }
});

test('a native word written after the empty first read is recovered on readiness', async () => {
  for (const [code, expected] of [[sources.candidate, 1], [sources.rejected, 0]]) {
    const h = harness(code); h.render(false); await settle(); h.store('take-desk'); h.render(true); await settle();
    assert.equal(h.stats.injections, expected);
  }
});

test('uncommitted readiness does not leak to the pending continuation', async () => {
  for (const [code, expected] of [[sources.candidate, 0], [sources.rejected, 1]]) {
    const h = harness(code), resolve = h.defer(); h.render(false); h.render(true, false); resolve('take-desk'); await settle();
    assert.equal(h.stats.injections, expected);
  }
});

test('early pending result waits and flushes once, with no extra read on unchanged readiness', async () => {
  const h = harness(sources.candidate); h.store('take-desk'); h.render(false); await settle(); assert.equal(h.stats.injections, 0);
  h.render(true); await settle(); h.render(true); await settle();
  assert.deepEqual(h.stats, { reads: 2, adds: 2, removes: 1, injections: 1 });
});

test('event and pending collision remains duplicated; this patch does not deduplicate', async () => {
  const h = harness(sources.candidate), resolve = h.defer(); h.render(false); h.render(true);
  h.deliver('take-desk'); resolve('take-desk'); await settle(); assert.equal(h.stats.injections, 2);
});

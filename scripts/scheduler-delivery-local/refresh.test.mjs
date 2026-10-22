import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefresh } from './refresh.mjs';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const calls = [], frames = [], timers = new Map(), listeners = [];
  let id = 0;
  const controller = createRefresh({
    read(scope, { signal }) { return new Promise((resolve, reject) => calls.push({ scope, signal, resolve, reject })); },
    render(value) { frames.push(value); },
    subscribe(scope, notify) { listeners.push(notify); return () => {}; },
    setTimer(fn, delay) { timers.set(++id, { fn, delay }); return id; },
    clearTimer(key) { timers.delete(key); },
  });
  const tick = delay => { const entry = [...timers].find(([, v]) => v.delay === delay); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); };
  return { controller, calls, frames, timers, listeners, tick };
}
test('switch clears content and ignores old account and store responses', async () => {
  const f = fixture(); f.controller.select({ user: 'a', store: 'one' });
  f.controller.select({ user: 'b', store: 'two' });
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[0].resolve({ ok: true, revision: 100, schedule: 'private-a' }); await flush();
  assert.equal(f.frames.some(x => x.schedule === 'private-a'), false);
  f.calls[1].resolve({ ok: true, revision: 1, schedule: 'own-b' }); await flush();
  assert.equal(f.frames.at(-1).schedule, 'own-b'); f.controller.dispose(); assert.equal(f.timers.size, 0);
});
test('notification re-reads; queued invalidation and fallback work without shared client state', async () => {
  const a = fixture(), b = fixture();
  a.controller.select('a'); b.controller.select('b'); a.listeners[0]();
  a.calls[0].resolve({ ok: true, revision: 1, schedule: 'a' });
  b.calls[0].resolve({ ok: true, revision: 1, schedule: 'b' }); await flush();
  assert.equal(a.calls.length, 2); assert.equal(b.calls.length, 1);
  a.calls[1].resolve({ ok: true, revision: 2, schedule: 'new-a' }); await flush();
  b.tick(2000); assert.equal(b.calls.length, 2);
  a.controller.dispose(); b.controller.dispose();
});
test('resume and reconnect refresh; pre-suspension responses are discarded', async () => {
  const f = fixture(); f.controller.select('a'); f.controller.foreground(false);
  f.calls[0].resolve({ ok: true, revision: 9, schedule: 'old' }); await flush();
  f.controller.foreground(true); assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ ok: true, revision: 2, schedule: 'current' }); await flush();
  f.listeners[0](); assert.equal(f.calls.length, 3);
  f.calls[2].resolve({ ok: true, revision: 1, schedule: 'regression' }); await flush();
  assert.equal(f.frames.at(-1).schedule, 'current');
  f.controller.reconnect(); assert.equal(f.calls.length, 4); f.controller.dispose();
});
test('denied or failed refresh clears content; hung read cannot prevent fallback', async () => {
  const f = fixture(); f.controller.select('a');
  f.calls[0].resolve({ ok: true, revision: 1, schedule: 'own' }); await flush();
  f.tick(2000); f.calls[1].resolve({ ok: false }); await flush();
  assert.deepEqual(f.frames.at(-1), { status: 'unavailable' });
  f.tick(2000); f.tick(4000); assert.equal(f.calls[2].signal.aborted, true);
  f.tick(2000); assert.equal(f.calls.length, 4);
  f.calls[2].resolve({ ok: true, revision: 50, schedule: 'late' }); await flush();
  assert.equal(f.frames.some(x => x.schedule === 'late'), false);
  f.calls[3].reject(new Error('synthetic')); await flush();
  assert.deepEqual(f.frames.at(-1), { status: 'unavailable' }); f.controller.dispose();
});
test('old subscription cannot trigger a read after logout', () => {
  const f = fixture(); f.controller.select('a'); f.controller.select(null); f.listeners[0]();
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});

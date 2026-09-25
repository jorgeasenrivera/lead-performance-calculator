import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createArrivalScheduler } from "../src/arrival-scheduler.mjs";

function harness(make = createArrivalScheduler) {
  const pending = new Map(), errors = [], messages = [];
  let id = 0, ticks = 0, sleeping = false;
  const engine = {
    sleeping: () => sleeping,
    tick() { ticks++; sleeping = true; },
    msg(m) { messages.push(m); if (m.type === "ready" && m.ready) sleeping = false; },
  };
  const scheduler = make(engine, f => { pending.set(++id, f); return id; }, n => pending.delete(n), e => errors.push(e));
  return { scheduler, engine, pending, errors, messages, ticks: () => ticks,
    frame() { const [n, f] = pending.entries().next().value; pending.delete(n); f(100); } };
}

test("arrival scheduler sleeps at waiting and wakes once for readiness", () => {
  const h = harness();
  h.scheduler.start(); h.scheduler.start();
  assert.equal(h.pending.size, 1);
  h.frame();
  assert.equal(h.ticks(), 1); assert.equal(h.pending.size, 0);
  h.scheduler.send({ type: "dest", dest: { name: "Store" } });
  assert.equal(h.pending.size, 0);
  h.scheduler.send({ type: "ready", ready: true });
  h.scheduler.send({ type: "ready", ready: true });
  assert.equal(h.pending.size, 1);
  h.frame(); assert.equal(h.ticks(), 2); assert.equal(h.pending.size, 0);
});

test("arrival cancellation clears its frame and ignores later readiness", () => {
  const h = harness();
  h.scheduler.start(); h.scheduler.stop(); h.scheduler.stop();
  h.scheduler.send({ type: "ready", ready: true }); h.scheduler.start();
  assert.equal(h.pending.size, 0); assert.equal(h.ticks(), 0);
  assert.deepEqual(h.messages, [{ type: "stop" }]);
});

test("a drawing failure stops scheduling and reports once", () => {
  const h = harness(), error = new Error("Drawing failed");
  h.engine.tick = () => { throw error; };
  h.scheduler.start(); h.frame(); h.scheduler.send({ type: "ready", ready: true });
  assert.deepEqual(h.errors, [error]); assert.equal(h.pending.size, 0);
});

test("scheduler source works in an isolated worker without module closures", () => {
  const make = vm.runInNewContext("(" + createArrivalScheduler.toString() + ")");
  const h = harness(make); h.scheduler.start(); h.frame();
  assert.equal(h.pending.size, 0);
  h.scheduler.send({ type: "ready", ready: true });
  assert.equal(h.pending.size, 1); h.scheduler.stop(); assert.equal(h.pending.size, 0);
});

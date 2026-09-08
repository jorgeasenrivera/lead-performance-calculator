import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueueAction, QUEUE_ACTIONS } from "../api/_queue-action.mjs";

const NOW = "2026-09-06T15:00:00.000Z";
const row = () => ({
  line: [{ id: "a", label: "Alex D.", status: "waiting" }, { id: "b", label: "Brianna D.", status: "waiting", table: 4 }, { id: "c", label: "Casey Q.", status: "customer" }],
  history: [], assists: [],
});

test("lunch and away step off, back returns, with the page's history events", () => {
  let r = applyQueueAction(row(), "b", "lunch", NOW);
  assert.equal(r.changed, true);
  assert.equal(r.row.line[1].status, "lunch");
  assert.equal(r.row.line[1].awayReason, "lunch");
  assert.deepEqual(r.row.history.at(-1), { t: NOW, action: "lunch", id: "b", who: "Brianna D.", by: "self" });
  r = applyQueueAction(r.row, "b", "back", NOW);
  assert.equal(r.row.line[1].status, "waiting");
  assert.equal(r.row.line[1].awayReason, null);
  assert.deepEqual(r.row.history.at(-1), { t: NOW, action: "back", from: "lunch", id: "b", who: "Brianna D.", by: "self" });
});

test("take is with a customer; done is back in the line", () => {
  let r = applyQueueAction(row(), "a", "take", NOW);
  assert.equal(r.row.line[0].status, "customer");
  assert.equal(r.row.history.at(-1).action, "customer");
  r = applyQueueAction(r.row, "a", "done", NOW);
  assert.equal(r.row.line[0].status, "waiting");
  assert.equal(r.row.history.at(-1).from, "customer");
});

test("pass goes to the back of the line and is logged as a decline by the person", () => {
  const r = applyQueueAction(row(), "a", "pass", NOW);
  assert.deepEqual(r.row.line.map((p) => p.id), ["b", "c", "a"]);
  assert.equal(r.row.line[2].movedAt, NOW);
  assert.deepEqual(r.row.history.at(-1), { t: NOW, action: "declined", id: "a", who: "Alex D.", by: "self" });
});

test("FlyBy and T.O. raise one ask each, replacing an open one, carrying the table", () => {
  let r = applyQueueAction(row(), "b", "fly", NOW, { askId: "k1" });
  assert.equal(r.row.assists.length, 1);
  assert.deepEqual(r.row.assists[0], { id: "k1", t: NOW, kind: "fly", byId: "b", byName: "Brianna D.", table: 4, spot: "floor", note: null });
  r = applyQueueAction(r.row, "b", "to", NOW, { askId: "k2" });
  assert.deepEqual(r.row.assists.map((a) => a.kind), ["to"]);
});

test("ack clears the desk's nudge once, and is a no-op without one", () => {
  const r0 = row(); r0.line[0].nudgedAt = NOW;
  const r = applyQueueAction(r0, "a", "ack", NOW);
  assert.equal(r.row.line[0].nudgedAt, null);
  assert.equal(r.row.history.at(-1).action, "on-my-way");
  assert.equal(applyQueueAction(r.row, "a", "ack", NOW).changed, false);
});

test("leave takes the person off the line for the day and logs it as left", () => {
  const row = { line: [{ id: "a", label: "AB", status: "waiting" }, { id: "b", label: "CD", status: "waiting" }], history: [] };
  const out = applyQueueAction(row, "a", "leave", "2026-09-06T20:00:00.000Z");
  assert.equal(out.changed, true);
  assert.equal(out.status, "gone");
  assert.deepEqual(out.row.line.map((p) => p.id), ["b"]);
  assert.equal(out.row.history.at(-1).action, "left");
  assert.equal(out.row.checkouts.length, 1);
  assert.equal(out.row.checkouts[0].partial, true);
  assert.equal(applyQueueAction(out.row, "a", "leave", "2026-09-06T20:01:00.000Z").changed, false);
});

test("nobody off the line, no unknown words, no crash on an empty row", () => {
  assert.equal(applyQueueAction(row(), "zz", "lunch", NOW).changed, false);
  assert.equal(applyQueueAction(row(), "a", "dance", NOW).changed, false);
  assert.equal(applyQueueAction(null, "a", "lunch", NOW).changed, false);
  assert.equal(QUEUE_ACTIONS.length, 12);
});

test("never mind takes the ask down and keeps that it was withdrawn", () => {
  const row = { line: [{ id: "a", label: "AB", status: "customer" }],
                assists: [{ id: "x", byId: "a", kind: "fly", t: "2026-09-08T20:00:00.000Z" }], history: [] };
  const out = applyQueueAction(row, "a", "cancel", "2026-09-08T20:01:00.000Z");
  assert.equal(out.changed, true);
  assert.equal(out.row.assists[0].cancelled, true);
  assert.ok(out.row.assists[0].doneAt);
  assert.equal(out.row.history.at(-1).action, "assist-cancelled");
  // and again, with nothing open, changes nothing
  assert.equal(applyQueueAction(out.row, "a", "cancel", "2026-09-08T20:02:00.000Z").changed, false);
});

test("with a guest answers the desk, and is not doubted when there is a guest", () => {
  const row = { line: [{ id: "a", label: "AB", status: "customer", nudgedAt: "2026-09-08T20:00:00.000Z" }], history: [] };
  const out = applyQueueAction(row, "a", "with-guest", "2026-09-08T20:01:00.000Z");
  assert.equal(out.changed, true);
  assert.equal(out.row.line[0].nudgedAt, null);
  const ev = out.row.history.at(-1);
  assert.equal(ev.action, "with-guest");
  assert.equal(ev.unverified, undefined, "a real guest is not flagged");
});

test("with a guest, when the row says otherwise, is kept as a plain fact", () => {
  const row = { line: [{ id: "a", label: "AB", status: "waiting", nudgedAt: "2026-09-08T20:00:00.000Z" }], history: [] };
  const out = applyQueueAction(row, "a", "with-guest", "2026-09-08T20:01:00.000Z");
  assert.equal(out.changed, true, "the press is honoured either way");
  assert.equal(out.row.line[0].nudgedAt, null, "the desk still gets its answer");
  const ev = out.row.history.at(-1);
  assert.equal(ev.unverified, true);
  assert.equal(ev.wasStatus, "waiting");
});

test("with a guest with nothing asked is a no-op", () => {
  const row = { line: [{ id: "a", label: "AB", status: "waiting" }], history: [] };
  assert.equal(applyQueueAction(row, "a", "with-guest", "2026-09-08T20:01:00.000Z").changed, false);
});

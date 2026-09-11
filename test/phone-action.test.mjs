/**
 * A press on the lock screen's phone lane, held against what the room screen
 * writes. The card cannot argue with a refusal, so every refusal says why.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyPhoneAction, PHONE_ACTIONS } from "../api/_phone-action.mjs";

const NOW = "2026-09-11T14:02:11.000Z";
const later = (ms) => new Date(Date.parse(NOW) + ms).toISOString();
const STORE = "s1";
const config = { stores: [{ id: STORE, stationMode: "rotation", stationPlan: { seats: [{ n: "1", x: 1, y: 1 }, { n: "2", x: 2, y: 1 }] } }] };
const P = (id, status = "waiting") => ({ id, label: id.toUpperCase(), status, statusAt: NOW });

test("take-desk takes the desk offered, and refuses without one", () => {
  const row = { line: [P("do"), P("ma")], stations: { 2: { id: "x", label: "X", at: NOW } }, offers: { 1: { id: "do", label: "DO", until: later(120000) } } };
  const r = applyPhoneAction(config, STORE, row, "do", "take-desk", NOW);
  assert.equal(r.changed, true);
  assert.equal(r.desk, "1");
  assert.equal(r.row.stations["1"].id, "do");
  assert.equal(r.row.sits.find((s) => s.id === "do").via, "line");
  const none = applyPhoneAction(config, STORE, row, "ma", "take-desk", NOW);
  assert.equal(none.changed, false);
  assert.equal(none.why, "no desk", "an offer standing for somebody else is nobody else's desk");
});

test("take-desk in open mode takes the desk named, or the first free one", () => {
  const open = { stores: [{ id: STORE, stationMode: "open", stationPlan: config.stores[0].stationPlan }] };
  const row = { line: [P("do")], stations: {} };
  const named = applyPhoneAction(open, STORE, row, "do", "take-desk", NOW, { desk: "2" });
  assert.equal(named.desk, "2");
  const first = applyPhoneAction(open, STORE, row, "do", "take-desk", NOW);
  assert.equal(first.desk, "1");
  assert.equal(applyPhoneAction(open, STORE, { line: [P("do", "lunch")], stations: {} }, "do", "take-desk", NOW).why, "not waiting");
});

test("pass-desk moves the offer on with a reason from the card", () => {
  const row = { line: [P("do"), P("ma")], stations: {}, offers: { 1: { id: "do", label: "DO", until: later(120000) } } };
  const r = applyPhoneAction(config, STORE, row, "do", "pass-desk", NOW);
  assert.equal(r.changed, true);
  assert.notEqual((r.row.offers["1"] || {}).id, "do");
  assert.ok(r.row.history.some((h) => h.action === "station-skipped" && /card/.test(h.reason || "")), "the skip is in the day's record with its reason");
  assert.equal(applyPhoneAction(config, STORE, { line: [P("do")] }, "do", "pass-desk", NOW).why, "nothing offered");
});

test("leave-desk and lunch-desk get up from the desk; lunch also steps off the cord", () => {
  const row = { line: [P("do")], stations: { 1: { id: "do", label: "DO", at: NOW } }, sits: [{ id: "do", station: "1", in: NOW }] };
  const out = applyPhoneAction(config, STORE, row, "do", "leave-desk", later(60000));
  assert.equal(out.changed, true);
  assert.equal(out.row.stations["1"], undefined);
  assert.equal(out.row.line[0].status, "waiting");
  const lunch = applyPhoneAction(config, STORE, row, "do", "lunch-desk", later(60000));
  assert.equal(lunch.row.line[0].status, "lunch");
  assert.equal(lunch.row.stations["1"], undefined);
  assert.equal(applyPhoneAction(config, STORE, { line: [P("do")] }, "do", "leave-desk", NOW).why, "not seated");
});

test("lunch-line, away-line and back-line move the status as the room does", () => {
  const row = { line: [P("do")] };
  const lunch = applyPhoneAction(config, STORE, row, "do", "lunch-line", NOW);
  assert.equal(lunch.row.line[0].status, "lunch");
  assert.equal(lunch.row.line[0].awayReason, "lunch");
  assert.equal(lunch.row.history[0].action, "lunch");
  const back = applyPhoneAction(config, STORE, lunch.row, "do", "back-line", later(1000));
  assert.equal(back.row.line[0].status, "waiting");
  assert.equal(back.row.history[1].action, "back");
  assert.equal(back.row.history[1].from, "lunch");
  assert.equal(applyPhoneAction(config, STORE, row, "do", "back-line", NOW).why, "already waiting");
  const seated = { line: [P("do")], stations: { 1: { id: "do", label: "DO", at: NOW } } };
  assert.equal(applyPhoneAction(config, STORE, seated, "do", "away-line", NOW).why, "seated");
});

test("the list is the list", () => {
  assert.deepEqual(PHONE_ACTIONS, ["take-desk", "pass-desk", "leave-desk", "lunch-desk", "lunch-line", "away-line", "back-line"]);
  assert.equal(applyPhoneAction(config, STORE, { line: [P("do")] }, "do", "fly", NOW).why, "unknown action");
  assert.equal(applyPhoneAction(config, STORE, { line: [] }, "do", "back-line", NOW).why, "not in line");
});

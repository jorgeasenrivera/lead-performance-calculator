/**
 * Which rooms a store gives its people.
 * -------------------------------------------------------------------------
 * The rules worth pinning down are the defaults and the fallback, because both
 * are places where being wrong is quiet: a default that changes hands a store
 * an app it did not ask for, and a remembered room that no longer exists shows
 * a blank screen rather than an error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS, roomsOf, roomListOf, openRoom } from "../api/_rooms.mjs";

const cfg = (rooms) => ({ stores: [{ id: "a", ...(rooms ? { rooms } : {}) }] });

test("a store gives the floor and not the line, until it says otherwise", () => {
  /* The floor is where a linked salesperson already lands, so defaulting it
     off would take away the app they have today. The line is off because most
     stores run no phone up system, and a tab into a line nobody uses is worse
     than no tab. */
  assert.deepEqual(roomsOf(cfg(null), "a"), { floor: true, line: false });
  assert.deepEqual(roomsOf(null, "a"), { floor: true, line: false });
  assert.deepEqual(ROOMS, ["floor", "line"]);
});

test("each room is set on its own, and a half-written setting keeps the rest", () => {
  assert.deepEqual(roomsOf(cfg({ line: true }), "a"), { floor: true, line: true });
  assert.deepEqual(roomsOf(cfg({ floor: false }), "a"), { floor: false, line: false });
  assert.deepEqual(roomsOf(cfg({ floor: false, line: true }), "a"), { floor: false, line: true });
});

test("only a boolean counts as a setting", () => {
  /* A stray string or null in a config should not read as "off". */
  assert.deepEqual(roomsOf(cfg({ floor: "no", line: null }), "a"), { floor: true, line: false });
});

test("the list is what is on, in the order it is shown", () => {
  assert.deepEqual(roomListOf(cfg({ line: true }), "a"), ["floor", "line"]);
  assert.deepEqual(roomListOf(cfg({ floor: false, line: true }), "a"), ["line"]);
  assert.deepEqual(roomListOf(cfg({ floor: false }), "a"), []);
});

test("a remembered room is honoured when the store still has it", () => {
  assert.equal(openRoom(cfg({ line: true }), "a", "line"), "line");
  assert.equal(openRoom(cfg({ line: true }), "a", "floor"), "floor");
});

test("a room that has been switched off falls back rather than showing nothing", () => {
  /* A store can turn a room off while somebody is standing in it. */
  assert.equal(openRoom(cfg({ line: false }), "a", "line"), "floor");
  assert.equal(openRoom(cfg({ floor: false, line: true }), "a", "floor"), "line");
  assert.equal(openRoom(cfg(null), "a", undefined), "floor");
});

test("a store that offers nothing says so", () => {
  /* Somebody has switched both off. That is a real state and the caller should
     say it plainly rather than draw an empty shell. */
  assert.equal(openRoom(cfg({ floor: false, line: false }), "a", "floor"), null);
});

/**
 * The per-date team schedule (Driver's Mart Winter Park style).
 * -------------------------------------------------------------------------
 * One row per date, a column per team holding a shift time or OFF, and the
 * people in a legend to the right: "Team A Wes" headers (the lead shares the
 * header cell) with members in the neighboring column beneath. The parser
 * lives in the app beside the other schedule readers, so these tests extract
 * it from the source between its markers and run it against the real sheet
 * the store sent, saved as a fixture verbatim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(ROOT, "src/LeadPerformanceCalculator.jsx"), "utf8");

const begin = APP.indexOf("/* dm-daterows-begin */");
const end = APP.indexOf("/* dm-daterows-end */");
assert.ok(begin >= 0 && end > begin, "the date-rows parser block is marked in the source");
const src = APP.slice(begin, end);

// The block references matchRosterName only through its injectable third
// argument, so a stub matcher is all the harness needs.
const mod = new Function(`${src}\nreturn { drDate, looksLikeDateRows, parseDateRows };`)();

const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/dm-winterpark-schedule.json"), "utf8"));

// A roster where every legend name exists exactly, so matching is not the
// thing under test here.
const LEGEND = [
  "Wes", "Mitch", "Alex B", "Jamarley", "Haroldo", "Adam", "Sammy",
  "Tariq", "Jason", "Samuel", "Juan Pablo", "Mo", "Jose", "Earl", "Chase",
  "Elvis", "Angel", "Vernon", "Danielle", "Juan Ruiz Lopez", "Vinny", "John", "Luis",
];
const roster = LEGEND.map((name, i) => ({ id: `p${i}`, name }));
const matchName = (label) => roster.find((a) => a.name.toLowerCase() === String(label).trim().toLowerCase()) || null;

test("drDate reads the sheet's long date format", () => {
  assert.equal(mod.drDate("Tue, Sep 01, 2026"), "2026-09-01");
  assert.equal(mod.drDate("Wed, Sep 30, 2026"), "2026-09-30");
  assert.equal(mod.drDate("9/5/2026"), "2026-09-05");
  assert.equal(mod.drDate("Tuesday"), null);
  assert.equal(mod.drDate("9:00 AM - 9:00 PM"), null);
});

test("the real sheet is recognized", () => {
  assert.ok(mod.looksLikeDateRows(rows));
});

test("other shapes are not swallowed by the detector", () => {
  assert.ok(!mod.looksLikeDateRows([["Name", "Off dates"], ["Mitch", "2026-09-04"]]));
  assert.ok(!mod.looksLikeDateRows([]));
  // A header without date rows under it is not a schedule.
  assert.ok(!mod.looksLikeDateRows([["Date", "Day", "Team A", "Team B"]]));
});

test("the legend yields the three teams with their leads", () => {
  const res = mod.parseDateRows(rows, roster, matchName);
  assert.deepEqual(Object.keys(res.teams).sort(), ["A", "B", "C"]);
  assert.deepEqual(res.teams.A, ["Wes", "Mitch", "Alex B", "Jamarley", "Haroldo", "Adam", "Sammy"]);
  assert.deepEqual(res.teams.B, ["Tariq", "Jason", "Samuel", "Juan Pablo", "Mo", "Jose", "Earl", "Chase"]);
  assert.deepEqual(res.teams.C, ["Elvis", "Angel", "Vernon", "Danielle", "Juan Ruiz Lopez", "Vinny", "John", "Luis"]);
});

test("the notes column never becomes a person", () => {
  const res = mod.parseDateRows(rows, roster, matchName);
  const everyone = [...Object.values(res.teams).flat(), ...res.unmatched];
  assert.ok(!everyone.some((n) => /labor day/i.test(n)));
});

test("a team's OFF days land on every member of that team", () => {
  const res = mod.parseDateRows(rows, roster, matchName);
  assert.equal(res.ty, 2026);
  assert.equal(res.tm, 9);
  assert.equal(res.unmatched.length, 0);

  // Team A reads OFF on these dates in the sheet.
  const teamAOff = ["2026-09-01", "2026-09-02", "2026-09-10", "2026-09-11",
    "2026-09-13", "2026-09-14", "2026-09-22", "2026-09-23"];
  const mitch = res.matched.find((m) => m.name === "Mitch");
  assert.ok(mitch, "Mitch carries off-days");
  assert.deepEqual(mitch.dates, teamAOff);
  const wes = res.matched.find((m) => m.name === "Wes");
  assert.deepEqual(wes.dates, teamAOff, "the lead in the header cell is a member too");

  // Saturdays are all-hands: nobody is off on Sep 5.
  assert.ok(!res.matched.some((m) => m.dates.includes("2026-09-05")));

  // Team C's first OFF is Tue Sep 8.
  const elvis = res.matched.find((m) => m.name === "Elvis");
  assert.ok(elvis.dates.includes("2026-09-08"));
  assert.ok(!elvis.dates.includes("2026-09-01"));
});

test("a legend name missing from the roster surfaces as unmatched", () => {
  const short = roster.filter((a) => a.name !== "Vinny");
  const res = mod.parseDateRows(rows, short, (l) => short.find((a) => a.name.toLowerCase() === String(l).trim().toLowerCase()) || null);
  assert.deepEqual(res.unmatched, ["Vinny"]);
});

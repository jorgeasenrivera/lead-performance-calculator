import test from "node:test";
import assert from "node:assert/strict";
import {
  monthDays,
  shiftMonth,
  createPlanner,
  recordedDay,
  monthSales,
  storeToday,
  calendarCells,
} from "./month-model.mjs";
const store = () => ({
  name: "Fictional",
  people: [
    { id: "a", name: "Alex", start: 9, end: 17, off: [], maxHours: 40 },
    { id: "b", name: "Blair", start: 9, end: 17, off: [], maxHours: 40 },
  ],
  rules: [
    {
      effective: "2014-01-01",
      open: 9,
      close: 17,
      minimum: 1,
      capacity: 8,
      useCapacity: false,
      closedDays: [],
      holidays: {},
    },
  ],
  history: [],
});
test("full months have exact unique dates, including leap and century years", () => {
  for (const [m, count] of [
    ["2026-01", 31],
    ["2026-04", 30],
    ["2026-02", 28],
    ["2028-02", 29],
    ["2100-02", 28],
  ]) {
    const days = monthDays(m);
    assert.equal(days.length, count);
    assert.equal(days[0], m + "-01");
    assert.equal(days.at(-1), m + "-" + count);
    assert.equal(new Set(days).size, count);
  }
  for (let year = 2014; year <= 2100; year++)
    for (let month = 1; month <= 12; month++) {
      const m = `${year}-${String(month).padStart(2, "0")}`;
      for (const d of monthDays(m))
        assert.equal(new Date(d + "T12:00:00Z").toISOString().slice(0, 10), d);
    }
  for (const bad of ["2026-00", "2026-13", "2013-12", "2101-01", "2026-2", ""])
    assert.throws(() => monthDays(bad));
});
test("month navigation crosses years and respects the explicit supported range", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.equal(shiftMonth("2026-10", 16), "2028-02");
  assert.throws(() => shiftMonth("2100-12", 1));
});
test("future store/month snapshots and reset do not overwrite current edits", () => {
  const p = createPlanner([store(), store()]),
    oct = p.get(0, "2026-10");
  oct.overrides["2026-10-14"] = ["b"];
  oct.store.people[0].maxHours = 16;
  oct.store.rules[0].minimum = 2;
  oct.accepted = true;
  const saved = JSON.stringify(oct),
    rows = JSON.stringify(p.rows(0, "2026-10"));
  const future = p.get(0, "2028-02");
  future.overrides["2028-02-29"] = [];
  future.store.people[0].off = [2];
  future.store.rules.push({
    ...future.store.rules[0],
    effective: "2028-02-15",
    minimum: 4,
  });
  p.get(1, "2026-10").store.people[0].maxHours = 0;
  assert.equal(JSON.stringify(p.get(0, "2026-10")), saved);
  assert.equal(JSON.stringify(p.rows(0, "2026-10")), rows);
  assert.deepEqual(p.get(0, "2028-02").overrides["2028-02-29"], []);
  p.reset(0, "2028-02");
  assert.equal(JSON.stringify(oct), saved);
  assert.deepEqual(p.get(0, "2028-02").overrides, {});
});
test("effective dates and exact holiday/override dates survive leap-month planning", () => {
  const p = createPlanner([store()]),
    d = p.get(0, "2028-02");
  d.store.rules.push({
    ...structuredClone(d.store.rules[0]),
    effective: "2028-02-15",
    minimum: 2,
    holidays: {
      "2028-02-20": "closed",
      "2028-02-21": "unknown",
      "2028-02-29": "open",
    },
  });
  d.overrides["2028-02-29"] = ["b"];
  const r = p.rows(0, "2028-02");
  assert.equal(r.length, 29);
  assert.equal(r[13].required, 1);
  assert.equal(r[14].required, 2);
  assert.equal(r[19].state, "closed");
  assert.deepEqual(r[19].ids, []);
  assert.equal(r[20].state, "unknown");
  assert.equal(r[28].override, true);
  assert.deepEqual(r[28].ids, ["b"]);
  assert.equal(p.rows(0, "2028-03")[0].required, 1);
});
test("entered shifts, not suggestions, consume complete neighboring weeks", () => {
  const s = store(); s.people = s.people.slice(0, 1);
  const p = createPlanner([s]);
  assert.ok(p.rows(0, "2028-02").every(r => r.ids.length === 0));
  const jan = p.get(0, "2028-01"), feb = p.get(0, "2028-02");
  jan.overrides["2028-01-31"] = ["a"];
  for (let n=1;n<=5;n++) feb.overrides[`2028-02-0${n}`] = ["a"];
  let r = p.rows(0, "2028-02");
  assert.equal(r[0].weeklyHours.a,48);
  assert.ok(r[0].issues.some(i=>i.includes("weekly hours exceeded")));
  assert.equal(r[0].eligibleIds.length,0);
  assert.deepEqual(r[0].ids,["a"], "invalid manual choices remain entered");
  assert.equal(r[6].weeklyHours.a,0, "Monday starts a new complete week");
  const saved=JSON.stringify([jan,feb]);p.rows(0,"2028-01");assert.equal(JSON.stringify([jan,feb]),saved);
  jan.overrides["2028-01-31"]=[];
  r=p.rows(0,"2028-02");assert.equal(r[0].weeklyHours.a,40);assert.deepEqual(r[0].eligibleIds,["a"]);
});
test("next-month entered shifts invalidate an earlier month's boundary-week review", () => {
  const s=store();s.people[0].maxHours=8;const p=createPlanner([s]);
  p.setAssignment(0,"2026-10-31",{on:["a"],off:[]});
  const before=JSON.stringify(p.rows(0,"2026-10"));
  p.setAssignment(0,"2026-11-01",{on:["a"],off:[]});
  const r=p.rows(0,"2026-10").at(-1);
  assert.equal(r.weeklyHours.a,16);assert.match(r.issues.join(' '),/weekly hours exceeded/);
  assert.notEqual(JSON.stringify(p.rows(0,"2026-10")),before);
});
test("fixtures, overrides and review rows share exactly one entered source", () => {
  const p=createPlanner([store()],{assignmentForDay:day=>day==='2026-10-14'?{on:['b'],off:['a']}:null});
  assert.deepEqual(p.rows(0,'2026-10')[13].record,p.record(0,'2026-10-14'));
  assert.deepEqual(p.rows(0,'2026-10')[13].ids,['b']);
  const before=JSON.stringify(p.get(0,'2026-10'));
  assert.ok(p.rows(0,'2026-10')[14].suggestions.length);
  assert.equal(p.record(0,'2026-10-15'),null);assert.equal(JSON.stringify(p.get(0,'2026-10')),before);
  p.setAssignment(0,'2026-10-14',{on:['a','a'],off:['b']});
  assert.deepEqual(p.rows(0,'2026-10')[13].ids,['a']);
  assert.equal(p.rows(0,'2026-10')[13].weeklyHours.a,8);
  assert.deepEqual(p.record(0,'2026-10-14').off,['b']);
});
test("days off, insufficient availability and unknown policy cannot clear coverage",()=>{
 const s=store();s.people[0].off=[3];s.people[1].maxHours=undefined;
 const p=createPlanner([s]);p.setAssignment(0,'2026-10-14',{on:['a','b'],off:[]});
 const r=p.rows(0,'2026-10')[13];assert.deepEqual(r.ids,['a','b']);assert.deepEqual(r.eligibleIds,[]);
 assert.match(r.issues.join(' '),/day off/);assert.match(r.issues.join(' '),/unknown/);
});

test("recorded sales distinguish known zero, Closed, missing and future from estimates", () => {
  const s = store();
  s.history = [
    { day: "2028-02-01", state: "known", units: 0 },
    { day: "2028-02-02", state: "known", units: 7 },
    { day: "2028-02-03", state: "closed", units: null },
    { day: "2028-02-29", state: "known", units: 99 },
  ];
  assert.deepEqual(recordedDay(s, "2028-02-01", "2028-02-14"), {
    state: "known",
    units: 0,
  });
  assert.equal(recordedDay(s, "2028-02-03", "2028-02-14").state, "closed");
  assert.equal(recordedDay(s, "2028-02-04", "2028-02-14").state, "unknown");
  assert.deepEqual(recordedDay(s, "2028-02-29", "2028-02-14"), {
    state: "future",
    units: null,
  });
  const r = monthSales(s, "2028-02", "2028-02-14");
  assert.equal(r.total, 7);
  assert.equal(r.known, 2);
  assert.equal(r.closed, 1);
  assert.equal(r.future, 15);
  assert.equal(r.best.day, "2028-02-02");
  assert.equal(monthSales(s, "2028-03", "2028-02-14").total, null);
  assert.equal(monthSales(s, "2028-01", "2028-02-14").total, null);
});

test("Today follows New York at midnight, year boundaries and both DST offsets", () => {
  for (const [instant, expected] of [
    ["2027-01-01T04:59:59Z", "2026-12-31"],
    ["2027-01-01T05:00:00Z", "2027-01-01"],
    ["2026-03-08T04:59:59Z", "2026-03-07"],
    ["2026-03-08T05:00:00Z", "2026-03-08"],
    ["2026-03-09T03:59:59Z", "2026-03-08"],
    ["2026-03-09T04:00:00Z", "2026-03-09"],
    ["2026-11-01T03:59:59Z", "2026-10-31"],
    ["2026-11-01T04:00:00Z", "2026-11-01"],
    ["2026-11-02T04:59:59Z", "2026-11-01"],
    ["2026-11-02T05:00:00Z", "2026-11-02"],
  ])
    assert.equal(storeToday(new Date(instant)), expected, instant);
});
test("calendar has seven Monday-first columns with exact leading and trailing blanks", () => {
  const october = calendarCells("2026-10");
  assert.deepEqual(october.slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(october.length, 35);
  assert.equal(october.at(-1), null);
  for (const month of ["2026-03", "2026-10", "2028-02", "2100-02"]) {
    const cells = calendarCells(month);
    assert.equal(cells.length % 7, 0);
    assert.deepEqual(cells.filter(Boolean), monthDays(month));
    cells.forEach((day, i) => {
      if (day)
        assert.equal(i % 7, (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7);
    });
  }
});

test('unknown neighboring shift hours cannot be treated as zero for weekly clearance',()=>{
 const s=store();s.rules[0].effective='2028-02-01';const p=createPlanner([s]);
 p.setAssignment(0,'2028-01-31',{on:['a'],off:[]});p.setAssignment(0,'2028-02-01',{on:['a'],off:[]});
 const r=p.rows(0,'2028-02')[0];assert.match(r.issues.join(' '),/weekly hours unknown/);assert.deepEqual(r.eligibleIds,[]);assert.ok(!r.suggestions.includes('a'));
});
test('missing sales history is advisory and does not replace entered store minimum',()=>{
 const s=store();s.rules[0].closedDays=[0,1,2,3,4,5,6];s.rules[0].holidays={'2026-10-14':'open'};
 const p=createPlanner([s]);p.setAssignment(0,'2026-10-14',{on:['b'],off:['a']});
 const rows=p.rows(0,'2026-10');assert.ok(rows.every(r=>r.issues.length===0));
 assert.equal(rows[13].estimate,null);assert.equal(rows[13].required,1);assert.deepEqual(rows[13].ids,['b']);
});

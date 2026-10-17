import test from "node:test";
import assert from "node:assert/strict";
import {
  nextWeek,
  reading,
  fixtures,
  propose,
  ruleFor,
  forecast,
} from "./model.mjs";
test("next full week on Wednesday, Monday, Sunday and year boundary", () => {
  assert.equal(nextWeek("2026-10-14"), "2026-10-19");
  assert.equal(nextWeek("2026-10-19"), "2026-10-26");
  assert.equal(nextWeek("2026-10-18"), "2026-10-19");
  assert.equal(nextWeek("2026-12-31"), "2027-01-04");
});
test("NA closed, missing unknown, explicit zero known", () => {
  assert.equal(reading("NA").state, "closed");
  for (const x of [undefined, null, "", -1, 1.5, NaN])
    assert.equal(reading(x).state, "unknown");
  assert.deepEqual(reading(0), { state: "known", units: 0 });
});
test("six fictional long-history stores, no real mapping", () => {
  const s = fixtures();
  assert.equal(s.length, 6);
  for (const x of s) {
    assert.match(x.id, /^fictional-/);
    assert.equal(x.history[0].day, "2014-01-01");
    assert.equal(x.history.at(-1).day, "2026-10-13");
  }
});
test("dated rules apply per day, future rules do not leak backward", () => {
  const s = fixtures()[0];
  s.rules.push({ ...s.rules[0], effective: "2026-10-22", minimum: 4 });
  assert.equal(ruleFor(s.rules, "2026-10-20").minimum, 2);
  assert.equal(ruleFor(s.rules, "2026-10-22").minimum, 4);
  assert.equal(ruleFor(s.rules, "2013-01-01"), undefined);
});
test("forecast excludes future, unknown and closed, preserves known zero", () => {
  const h = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"].map(
    (day) => ({ day, state: "known", units: 0 }),
  );
  h.push({ day: "2026-10-26", state: "known", units: 999 });
  assert.equal(forecast(h, "2026-10-19").high, 0);
  assert.equal(forecast(h.slice(0, 3), "2026-10-19"), null);
});
test("closed and unknown never assigned; zero history does not erase minimum", () => {
  const s = fixtures()[0];
  s.history = s.history.map((r) => ({ ...r, units: 0 }));
  const r = propose(s, "2026-10-19");
  assert.equal(r[0].required, 2);
  assert.equal(r[2].state, "unknown");
  assert.equal(r[4].state, "closed");
  assert.equal(r[2].ids.length + r[4].ids.length, 0);
});
test("suggestions respect days off, availability and weekly max", () => {
  const s = fixtures()[0];
  s.people[0].maxHours = 0;
  s.people[1].start = 10;
  const r = propose(s, "2026-10-19");
  assert.ok(r.every((r) => !r.ids.includes("p0") && !r.ids.includes("p1")));
  for (const row of r)
    for (const id of row.ids)
      assert.ok(
        !s.people
          .find((p) => p.id === id)
          .off.includes(new Date(row.day).getUTCDay()),
      );
});
test("capacity must be entered and enabled, minimum always applies", () => {
  const s = fixtures()[0];
  s.history = s.history.map((r) => ({ ...r, units: 30 }));
  assert.equal(propose(s, "2026-10-19")[0].required, 2);
  s.rules[0].useCapacity = true;
  s.rules[0].capacity = 5;
  assert.equal(propose(s, "2026-10-19")[0].required, 6);
  assert.ok(propose(s, "2026-10-19")[0].issues.length);
});
test("overrides preserve manager selection and show conflicts", () => {
  const s = fixtures()[0];
  s.people[0].maxHours = 0;
  const r = propose(s, "2026-10-19", { "2026-10-19": ["p0"] })[0];
  assert.deepEqual(r.ids, ["p0"]);
  assert.ok(r.issues.some((s) => s.includes("day off")));
  assert.ok(r.issues.some((s) => s.includes("weekly hours")));
  assert.ok(r.issues.some((s) => s.includes("more needed")));
});
test("unknown rules and invalid store hours cannot suggest staffing", () => {
  const s = fixtures()[0];
  assert.equal(propose(s, "2013-01-07")[0].state, "unknown");
  s.rules[0].close = 8;
  assert.equal(propose(s, "2026-10-19")[0].state, "unknown");
});
test("store and week changes are pure and do not share assignments", () => {
  const s = fixtures();
  const before = JSON.stringify(s);
  propose(s[0], "2026-10-19", { "2026-10-19": [] });
  propose(s[1], "2026-10-26");
  assert.equal(JSON.stringify(s), before);
});

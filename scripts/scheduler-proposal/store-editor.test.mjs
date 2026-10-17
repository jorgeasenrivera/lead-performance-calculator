import test from "node:test";
import assert from "node:assert/strict";
import { fixtures, ruleFor } from "./model.mjs";
import { storeRuleDraft, ruleFromForm } from "./store-editor.mjs";
function form(draft, overrides = {}) {
  const f = new FormData();
  for (const key of ["effective", "open", "close", "minimum", "capacity"])
    f.set(key, draft[key]);
  if (draft.useCapacity) f.set("useCapacity", "on");
  draft.closedDays.forEach((day) => f.append("closedDays", day));
  for (const [key, value] of Object.entries(overrides)) f.set(key, value);
  return f;
}
function save(rules, f) {
  const rule = ruleFromForm(rules, f);
  return rules.filter((r) => r.effective !== rule.effective).concat(rule);
}
test("confirmed Open survives repeated coverage-only saves; closed and unknown stay distinct", () => {
  let rules = fixtures()[0].rules;
  rules = save(
    rules,
    form(storeRuleDraft(rules, "2026-10-19"), {
      editHoliday: "on",
      holiday: "2026-10-21",
      holidayState: "open",
    }),
  );
  for (const minimum of ["3", "4", "2"]) {
    const draft = storeRuleDraft(rules, "2026-10-19");
    assert.equal(draft.holidays["2026-10-21"], "open");
    rules = save(
      rules,
      form(draft, { minimum, holiday: "2026-10-21", holidayState: "unknown" }),
    );
    assert.deepEqual(ruleFor(rules, "2026-10-19").holidays, {
      "2026-10-21": "open",
      "2026-10-23": "closed",
    });
  }
  rules = save(
    rules,
    form(storeRuleDraft(rules, "2026-10-19"), {
      editHoliday: "on",
      holiday: "2026-10-21",
      holidayState: "unknown",
    }),
  );
  assert.equal(ruleFor(rules, "2026-10-19").holidays["2026-10-21"], "unknown");
});
test("coverage-only saves do not manufacture missing exceptions", () => {
  const rules = fixtures()[0].rules;
  const result = ruleFromForm(rules, form(storeRuleDraft(rules, "2026-11-02")));
  assert.equal(Object.hasOwn(result.holidays, "2026-11-04"), false);
  assert.equal(result.holidays["2026-10-21"], "unknown");
});
test("October 26 rule never seeds October 19 edits, even with unsorted versions", () => {
  let rules = fixtures()[0].rules;
  rules = save(
    rules,
    form(storeRuleDraft(rules, "2026-10-26"), {
      minimum: "5",
      open: "10",
      close: "18",
      capacity: "9",
      editHoliday: "on",
      holiday: "2026-10-28",
      holidayState: "closed",
    }),
  );
  rules.reverse();
  const earlier = storeRuleDraft(rules, "2026-10-19");
  assert.equal(earlier.minimum, 2);
  assert.equal(earlier.open, 9);
  assert.equal(earlier.close, 17);
  assert.equal(earlier.capacity, 6);
  assert.equal(earlier.holidays["2026-10-28"], undefined);
  rules = save(rules, form(earlier, { minimum: "3" }));
  assert.equal(ruleFor(rules, "2026-10-19").minimum, 3);
  assert.equal(storeRuleDraft(rules, "2026-10-26").minimum, 5);
  assert.equal(
    storeRuleDraft(rules, "2026-10-26").holidays["2026-10-28"],
    "closed",
  );
});
test("date before first rule leaves required settings blank, never copies future settings", () => {
  const draft = storeRuleDraft(fixtures()[0].rules, "2025-12-29");
  for (const key of ["open", "close", "minimum", "capacity"])
    assert.equal(draft[key], "");
  assert.deepEqual(draft.holidays, {});
  assert.deepEqual(draft.closedDays, []);
});
test("editing a draft cannot mutate an earlier rule", () => {
  const rules = fixtures()[0].rules,
    before = JSON.stringify(rules);
  const draft = storeRuleDraft(rules, "2026-10-19");
  draft.holidays["2026-10-21"] = "open";
  draft.closedDays.push(6);
  assert.equal(JSON.stringify(rules), before);
});

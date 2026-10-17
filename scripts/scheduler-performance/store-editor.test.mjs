import test from "node:test";
import assert from "node:assert/strict";
import { fixtures } from "../scheduler-proposal/model.mjs";
import { createPlanner } from "./month-model.mjs";
import { storeRuleDraft, applyStoreRuleForm, effectiveExceptions } from "./store-editor.mjs";
function form(rules, effective, extra = {}) {
  const r = { ...storeRuleDraft(rules, effective), ...extra }, f = new FormData();
  for (const key of ["effective", "open", "close", "minimum", "capacity"]) f.set(key, r[key]);
  if (r.useCapacity) f.set("useCapacity", "on");
  for (const day of r.closedDays) f.append("closedDays", day);
  for (const key of ["editHoliday", "holiday", "holidayState"]) if (key in extra) f.set(key, extra[key]);
  return f;
}
test("special-day edits update the rule governing the date while preserving dated coverage", () => {
  const p = createPlanner(fixtures()), d = p.get(0, "2026-10");
  d.store.rules = applyStoreRuleForm(d.store.rules, form(d.store.rules, "2026-10-15", { minimum: 3 }));
  assert.equal(p.rows(0, "2026-10")[22].state, "closed");
  const before = structuredClone(d.store.rules);
  d.store.rules = applyStoreRuleForm(d.store.rules, form(d.store.rules, "2026-10-01", {
    editHoliday: "on", holiday: "2026-10-23", holidayState: "open",
  }));
  const rows = p.rows(0, "2026-10");
  assert.equal(rows[22].state, "open");
  assert.equal(rows[22].required, 3);
  assert.equal(rows[13].required, 2);
  assert.equal(rows[14].required, 3);
  assert.equal(effectiveExceptions(d.store.rules, "2026-10")["2026-10-23"], "open");
  assert.equal(before[1].holidays["2026-10-23"], "closed");
  for (const state of ["unknown", "closed", "open"]) {
    d.store.rules = applyStoreRuleForm(d.store.rules, form(d.store.rules, "2026-10-01", {editHoliday:"on", holiday:"2026-10-23", holidayState:state}));
    assert.equal(p.rows(0, "2026-10")[22].state, state);
  }
  assert.equal(p.get(0, "2026-11").store.rules[0].minimum, 2);
});

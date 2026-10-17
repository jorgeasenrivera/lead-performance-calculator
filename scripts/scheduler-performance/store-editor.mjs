import { ruleFor } from "../scheduler-proposal/model.mjs";

export function storeRuleDraft(rules, effective) {
  const rule = ruleFor(rules, effective);
  return {
    effective,
    open: rule?.open ?? "",
    close: rule?.close ?? "",
    minimum: rule?.minimum ?? "",
    capacity: rule?.capacity ?? "",
    useCapacity: rule?.useCapacity ?? false,
    closedDays: [...(rule?.closedDays ?? [])],
    holidays: { ...rule?.holidays },
  };
}

export function ruleFromForm(rules, form) {
  const effective = form.get("effective");
  // Coverage edits must not silently create or replace a holiday exception.
  const holidays = storeRuleDraft(rules, effective).holidays;
  if (form.has("editHoliday")) {
    holidays[form.get("holiday")] = form.get("holidayState");
  }
  return {
    effective,
    open: +form.get("open"),
    close: +form.get("close"),
    minimum: +form.get("minimum"),
    capacity: +form.get("capacity"),
    useCapacity: form.has("useCapacity"),
    closedDays: form.getAll("closedDays").map(Number),
    holidays,
  };
}

// Exceptions belong to the rule governing their date, not the sheet's earlier version.
export function applyStoreRuleForm(rules, form) {
  const coverage = new FormData();
  for (const [key, value] of form) if (key !== "editHoliday") coverage.append(key, value);
  const rule = ruleFromForm(rules, coverage);
  const next = rules.filter(r => r.effective !== rule.effective)
    .map(r => structuredClone(r)).concat(rule)
    .sort((a, b) => a.effective.localeCompare(b.effective));
  if (form.has("editHoliday")) {
    const day = form.get("holiday"), state = form.get("holidayState");
    if (day < rule.effective || !["open", "closed", "unknown"].includes(state))
      throw Error("Choose a valid special-day status on or after the effective date.");
    const governing = ruleFor(next, day);
    if (!governing) throw Error("No store rule governs the special-day date.");
    governing.holidays[day] = state;
  }
  return next;
}
export function effectiveExceptions(rules, month) {
  const dates = new Set(rules.flatMap(r => Object.keys(r.holidays)));
  return Object.fromEntries([...dates].filter(d => d.startsWith(month + "-"))
    .sort().filter(d => ruleFor(rules, d)?.holidays[d])
    .map(d => [d, ruleFor(rules, d).holidays[d]]));
}

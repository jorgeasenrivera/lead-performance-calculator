import { ruleFor } from "./model.mjs";

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

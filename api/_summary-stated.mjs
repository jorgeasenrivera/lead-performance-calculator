/* Shared manual/email PDF aggregate precedence. Null means unreported, not zero.
   This preserves existing email authority; stock-only observations without an
   existing aggregate do not invent a store delivery count. */
export function applySummaryStated(month, stated, { day, at, file }) {
  if (stated && stated.total != null && month.stated?.source !== "roll-up") {
    month.stated = { deliveries: stated.total, units: stated.units, leads: stated.leads,
      vehicles: stated.vehicles, day, at, file, source: "summary-grid" };
    return true;
  }
  if (stated && stated.vehicles && month.stated) {
    month.stated = { ...month.stated, vehicles: stated.vehicles };
    return true;
  }
  return false;
}

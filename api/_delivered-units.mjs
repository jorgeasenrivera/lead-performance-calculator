/* ---------- every car a person delivered ----------
   DriveCentric credits a delivery to one of five sources: Internet, Phone,
   Showroom, Campaign or Service. The TV board has counted all five since
   Service was read off the Delivery Summary, but the app's own screens added
   up four, so a person with Service deals read lower in the app than on the
   wall. One definition, used by both sides, keeps them from drifting again.

   A field that is missing counts as nothing, not as a reason to drop the row:
   a month imported before Service was read has no serviceUnits at all, and its
   other four sources still count. */
export const DELIVERED_UNIT_FIELDS = ["internetUnits", "phoneUnits", "showroomUnits", "campaignUnits", "serviceUnits"];

export function deliveredUnits(stats) {
  if (!stats) return 0;
  let n = 0;
  for (const f of DELIVERED_UNIT_FIELDS) {
    const v = Number(stats[f]);
    if (stats[f] != null && Number.isFinite(v)) n += v;
  }
  return n;
}

// Extracted verbatim from candidate core; app entrypoint remains unchanged.
import { norm } from '../../api/_report-parsers.mjs';
export function workedAnyway(data, aId, d) {
  const a = (data.roster || []).find((x) => x.id === aId);
  if (!a) return false;
  // Calls and videos only. Texts and emails fire from automated follow-up whether or
  // not the person is in the building, and completed tasks can close the same way, so
  // counting those would flag almost everybody as present on their day off.
  const rec = data.activity?.[d]?.[norm(a.name)];
  if (rec && ((rec.calls || 0) > 0 || (rec.video || 0) > 0)) return true;
  // signing into the line or the floor is the same evidence, just earlier in the day
  for (const key of ["queue", "queueOnline", "floor"]) {
    const row = data[key]?.[d];
    if (row && (row.line || []).some((p) => p.id === aId)) return true;
  }
  return false;
}

export function isOff(data, aId, d) {
  /* A manager's own Mark off is authoritative. The workedAnyway override below
     exists for the UPLOADED schedule -- somebody listed off who plainly came in
     -- but it was also overriding the button: one logged call, or a sign-in to
     the floor, and Mark off did nothing at all, silently. An explicit mark made
     by a person standing there beats evidence collected before they made it. */
  if (data.forcedOff?.[aId]?.includes(d)) return true;
  if (!(data.daysOff?.[aId] && data.daysOff[aId].includes(d))) return false;
  return !workedAnyway(data, aId, d);
}

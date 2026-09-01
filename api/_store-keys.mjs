/**
 * Where a store's figures live, and which of them travel.
 * -------------------------------------------------------------------------
 * One copy, imported by the app and by the pipeline that reads the emailed
 * reports. Both write these rows, so both have to agree about them — and they
 * did not. Two drifts were live when this file was made:
 *
 *   FLOOR_STAT_FIELDS gained "visits" on the server and not in the app, so a
 *   PDF a manager dropped in by hand wrote a day with the visit count stripped
 *   out of it, while the same report arriving by email kept it
 *
 *   BOARD_STAT_FIELDS carries the lead counts in the app and did not on the
 *   server, so every emailed import quietly published a board without them and
 *   a salesperson lost what their percentage was out of
 *
 * A field list is the worst possible thing to keep two copies of. A key that
 * drifts fails loudly — the read finds nothing. A field list that drifts writes
 * a row that is the right shape, in the right place, missing one column, and
 * says nothing at all.
 */

/* The keys. A drift here is survivable only because it is obvious: the reader
   looks somewhere the writer never wrote and the panel is simply empty. */
export const storeKey     = (storeId) => `lpc:store:${storeId}:v2`;
export const actKey       = (storeId, day) => `lpc:store:${storeId}:act:${day}`;
export const floorStatsKey = (storeId, day) => `lpc:board:${storeId}:act:${day}`;
export const boardKey     = (storeId) => `lpc:board:${storeId}:v1`;
/* Where an emailed report's own file is archived, exactly as it arrived. The
   reports are sent ONLY to the pipeline, so without this nobody could ever look
   at the PDF a number came from. Keyed by store, arrival day and a sanitised
   filename, so a same-day resend overwrites rather than piling up. */
export const reportFileKey = (storeId, day, fileName) =>
  `lpc:reportfile:${storeId}:${day}:${String(fileName || "file").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80)}`;

/* What the floor keeps of a day. The floor reads its own narrow copy rather
   than the whole import, so anything missing from this list does not reach it. */
export const FLOOR_STAT_FIELDS = ["calls", "video", "contacted", "text", "email", "tasks", "tasksPosted",
  "apptScheduled", "apptConfirmed", "apptShow", "units",
  /* What the day's report credits somebody with seeing. It is what the Live
     Floor shows beside each person, and the only record a second salesperson on
     a deal ever appears in — the deal notification names the primary rep and
     nobody else. */
  "visits",
  /* Whether the person qualified in RockEd that day, folded in at publish time
     from the checkout marks so the phone's points are the desk's points. */
  "rocked",
  "uploadedAt"];

/* What the wall keeps. The lead counts are in here so a salesperson can see
   what the percentage is out of. */
export const BOARD_STAT_FIELDS = ["internetUnits", "internetPct", "phoneUnits", "phonePct",
  "showroomUnits", "showroomPct", "campaignUnits", "prevPct", "prevUnits",
  "internetLeads", "phoneLeads", "showroomLeads",
  /* The new and used split, so a phone's pace bar can show both halves. */
  "newUnits", "usedUnits"];

/* Keeping only the fields that travel, which is the same operation on both
   sides and was written out twice. */
export function slimTo(fields, dayRows) {
  const out = {};
  for (const [k, r] of Object.entries(dayRows || {})) {
    if (!r) continue;
    const keep = {};
    for (const f of fields) if (r[f] !== undefined) keep[f] = r[f];
    out[k] = keep;
  }
  return out;
}
export const slimFloorStats = (dayRows) => slimTo(FLOOR_STAT_FIELDS, dayRows);

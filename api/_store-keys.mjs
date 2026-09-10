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
  /* The month's closing, per channel, as it stood on this day. See withChannels
     below for why it is stamped onto a DAY row. */
  "mtd",
  "uploadedAt"];

/* What the wall keeps. The lead counts are in here so a salesperson can see
   what the percentage is out of. */
export const BOARD_STAT_FIELDS = ["internetUnits", "internetPct", "phoneUnits", "phonePct",
  "showroomUnits", "showroomPct", "campaignUnits", "prevPct", "prevUnits",
  "internetLeads", "phoneLeads", "showroomLeads",
  /* The new and used split, so a phone's pace bar can show both halves. */
  "newUnits", "usedUnits"];

/* ---- the month's closing, stamped on the day ----
   A salesperson wants to know whether their closing is actually down or whether
   it only feels down, which is a question about a trend and not about today.
   Nothing here could answer it: the day rows carry units and visits but no
   channel split, and the Daily Activity report does not break units down by
   channel at all, so a per-day channel rate is not derivable from what arrives.

   What DOES arrive, in the Delivery Summary, is the month-to-date figure per
   channel. Stamped onto each day's row it gives two things for six numbers.
   Read directly, the days plot how the running rate has moved — which is the
   better answer anyway, because a daily rate on two leads is noise. Diffed
   against the day before, they recover that day's own channel units and leads,
   so a true rolling rate is available from the same six numbers.

   It costs nothing to read. The phone already fetches one of these rows per day
   for the whole month, stamp-gated and cached, so this rides along in a request
   that was happening regardless.

   No backfill: the history was never stored, so the series starts at the first
   import after this ships. And month-to-date resets on the 1st, which a reader
   spanning a boundary has to expect — a gap on that day, not a cliff. */
const MTD_MAP = { iu: "internetUnits", il: "internetLeads", pu: "phoneUnits",
  pl: "phoneLeads", su: "showroomUnits", sl: "showroomLeads" };

export function withChannels(dayRows, sdata, day) {
  const month = String(day || "").slice(0, 7);
  const stats = ((sdata && sdata.months && sdata.months[month]) || {}).stats || {};
  const out = {};
  for (const [k, r] of Object.entries(dayRows || {})) {
    if (!r) continue;
    const m = stats[k];
    if (!m) { out[k] = { ...r }; continue; }
    const mtd = {};
    for (const [short, field] of Object.entries(MTD_MAP)) {
      if (m[field] != null) mtd[short] = m[field];
    }
    out[k] = Object.keys(mtd).length ? { ...r, mtd } : { ...r };
  }
  return out;
}

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

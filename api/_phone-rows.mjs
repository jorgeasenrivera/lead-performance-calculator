/* What a salesperson's phone is allowed to know beyond the counts.
   -------------------------------------------------------------------------
   The floor phone has no account, so it reads two published rows: the board
   row (the month) and the split day rows (each day). Both the app and the
   pipeline write those rows, so the extras a phone needs ride through here,
   once, and neither writer can drift from the other:

     goals    the person's monthly goal, from coaching, by the month it applies to
     off      the person's scheduled days off, this month and next
     rocked   whether the person qualified in RockEd that day, the same rule the
              checkout sheet grades by, so the phone's points are the desk's points
     moves    a stamp on the line entry each time a person moves up a spot, so
              "last move" on the phone means exactly that */

/* The monthly goal, honoring a month-specific figure over the standing one. */
export function goalFor(sdata, aId, month) {
  const g = sdata && sdata.goals && sdata.goals[aId];
  if (!g) return null;
  if (g.byMonth && g.byMonth[month] != null) return g.byMonth[month];
  return g.monthly == null ? null : g.monthly;
}

/* The scheduled days off that matter to a phone: this month and the next, so a
   schedule uploaded ahead of time shows up before the month turns. */
export function offDatesFor(sdata, aId, month) {
  const list = (sdata && sdata.daysOff && sdata.daysOff[aId]) || [];
  const [y, m] = String(month).split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return list.filter((d) => typeof d === "string" && (d.startsWith(month) || d.startsWith(next))).sort();
}

/* Everything the board row carries for phones beyond the stats, keyed the way
   the stats are keyed: by the normalized name. */
export function phoneExtras(sdata, roster, month, norm) {
  const goals = {}; const off = {};
  for (const a of roster || []) {
    const k = norm(a.name);
    const g = goalFor(sdata, a.id, month);
    if (g != null) goals[k] = g;
    const o = offDatesFor(sdata, a.id, month);
    if (o.length) off[k] = o;
  }
  return { goals, off };
}

/* RockEd for one person on one day, the checkout sheet's rule: a tick wins,
   a legacy star count is measured against the bar, no mark at all is unknown. */
export function rockedFor(sdata, day, nameKey, rockEdStars = 40) {
  const q = sdata && sdata.qualified && sdata.qualified[day] && sdata.qualified[day][nameKey];
  if (q === true) return true;
  if (q === false) return false;
  const stars = sdata && sdata.stars && sdata.stars[day] && sdata.stars[day][nameKey];
  if (stars == null) return null;
  return stars >= rockEdStars;
}

/* The day's rows with each person's RockEd answer folded in, ready to slim. A
   person with no mark keeps no field, so "unknown" stays distinguishable from
   "did not qualify" on the phone. */
export function withRocked(sdata, day, rows, rockEdStars = 40) {
  const out = {};
  for (const [k, r] of Object.entries(rows || {})) {
    if (!r) continue;
    const rk = rockedFor(sdata, day, k, rockEdStars);
    out[k] = rk == null ? { ...r } : { ...r, rocked: rk };
  }
  return out;
}

/* The checkout sheet's arithmetic for one day, on a phone: a missed standard is a
   point, and lower wins. Strict thresholds, exactly as the desk grades. */
export function pointsForDay(rec, std) {
  const r = rec || {};
  const has = r.calls != null || r.video != null || r.rocked != null;
  if (!has) return { points: 0, missed: [], noData: true };
  const missed = [];
  if (!(r.calls != null && r.calls >= (std.minCalls || 0))) missed.push("calls");
  if (!(r.video != null && r.video >= (std.minVideos || 0))) missed.push("videos");
  if (r.rocked !== true) missed.push("rocked");
  return { points: missed.length, missed, noData: false };
}

/* Stamp the people who moved up. Compared on the waiting order only: standing
   down and coming back is not a move, and neither is somebody behind you
   leaving. Joining the line counts as your first move. */
export function stampLineMoves(prev, next, now) {
  if (!next || !Array.isArray(next.line)) return next;
  const before = ((prev && prev.line) || []).filter((p) => p.status === "waiting").map((p) => p.id);
  const after = next.line.filter((p) => p.status === "waiting").map((p) => p.id);
  for (const p of next.line) {
    if (p.status !== "waiting") continue;
    const was = before.indexOf(p.id), is = after.indexOf(p.id);
    if (was < 0 || is < was) p.movedAt = now;
  }
  return next;
}

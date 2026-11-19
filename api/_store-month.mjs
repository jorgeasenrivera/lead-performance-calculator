/**
 * The store's month.
 * -------------------------------------------------------------------------
 * Kept apart from the app because the arithmetic here is what a manager acts on
 * — whether to push the floor on the 22nd — and arithmetic worth acting on is
 * arithmetic worth checking.
 *
 * Holidays are passed in rather than read from module state, so a check can ask
 * what December looks like without arranging the rest of the world first.
 */

/* ---- The store's own month, which is not the same month a salesperson has ----

   An associate's working days skip Sundays, because that is a day they are not
   rostered and judging their averages against it would be unfair to them.

   A STORE does not work that way. The doors are open every day of the month, so
   every day of the month belongs in the denominator — and a pace worked out over
   six-day weeks would flatter the store by about a sixth, which on a hundred-car
   month is sixteen cars of daylight between the projection and the truth.

   The exception is a holiday. Those are set once for the group and they come out
   of the month entirely: nobody sold anything, and dividing by a day the doors
   never opened understates the rate for the rest of it.
*/
export function storeDaysInMonth(monthKey, isHoliday = () => false) {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    if (!isHoliday(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)) n++;
  }
  return n;
}

/* Days that are FINISHED, which is a different question again.

   The delivery figures come from a report that lands the following morning, so
   today's cars are not in the month total yet. Counting today in the denominator
   divides real sales by a day whose sales have not arrived, and every projection
   sags a little every morning and recovers every afternoon for no reason anybody
   could name. The round-up managers read already stops at end of day yesterday
   for exactly this reason; this matches it. */
export function storeDaysDone(monthKey, isHoliday = () => false, todayStr = null) {
  const t = todayStr;
  if (!t) return storeDaysInMonth(monthKey, isHoliday);
  if (t.slice(0, 7) !== monthKey) return storeDaysInMonth(monthKey, isHoliday);   // a month gone by
  const [y, m, d] = t.split("-").map(Number);
  let n = 0;
  for (let day = 1; day < d; day++) {
    if (!isHoliday(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`)) n++;
  }
  return n;
}

/* What this store is being asked for this month, and the number that counts as
   having got there.

   Two figures rather than one because they are two different things. The goal is
   what the manufacturer or the group asked for. The percentage is what the store
   is actually held to — a store on a 100-car goal at 85% is judged at 85, and the
   difference between those two numbers is the difference between a good month and
   a bad one. Nobody should have to do that multiplication in their head while
   standing at a screen.

   A goal belongs to ONE month and to no other. There used to be a standing
   figure a month with no entry of its own would fall back on, which meant a new
   month silently opened holding the last one's number: on the first of October
   a store would appear to be chasing September's goal, against a bar nobody had
   agreed to, and the screen that asks for a goal would never ask. Jorge settled
   it on 15 September: the month turns over, the goal goes with it, and the new
   month has none until somebody writes one in. So there is no fallback here.

   The consequence, said plainly rather than discovered later: four store-months
   that never had a goal set were borrowing one, and now correctly show none.
   They are Holler Ford's July and August, Holler Honda's July and Driver's Mart
   Winter Park's July. */
export function storeGoalFor(store, monthKey) {
  const g = (store && store.goal) || null;
  if (!g || !g.byMonth) return null;
  const units = g.byMonth[monthKey];
  if (!(units > 0)) return null;
  const pct = g.pct > 0 ? g.pct : 100;
  return { units, pct, bar: units * (pct / 100) };
}

/* ---- The store's pace, one way for every screen that prints one ----

   The hero worked its pace over selling days with holidays out, finished days
   only, against the share of the goal the store is held to. The morning
   round-up worked its own over calendar days against the raw goal, so on a
   holiday month or an 85% store the two printed different "on pace for"
   numbers a screen apart. Both read this now.

   Under three finished days it says so rather than projecting: one strong
   Saturday is not a month. */
export function storePace(goal, units, monthKey, isHoliday = () => false, todayStr = null) {
  const daysAll = storeDaysInMonth(monthKey, isHoliday);
  const daysDone = storeDaysDone(monthKey, isHoliday, todayStr);
  const daysLeft = Math.max(0, daysAll - daysDone);
  if (daysDone < 3 || !(daysAll > 0)) return { tooEarly: true, goal, daysAll, daysDone, daysLeft };
  const perDay = units / daysDone;
  const projected = perDay * daysAll;
  const out = { goal, daysAll, daysDone, daysLeft, perDay, projected, units };
  if (goal) {
    out.short = Math.max(0, goal.bar - units);
    out.shortAtPace = Math.max(0, goal.bar - projected);
    out.needPerDay = daysLeft > 0 ? out.short / daysLeft : null;
    out.willHit = projected >= goal.bar;
    out.parToday = goal.bar * (daysDone / daysAll);
    out.aheadBy = units - out.parToday;
    out.tone = out.aheadBy >= 0 ? "g" : out.aheadBy > -(goal.bar * 0.05) ? "y" : "r";
    // The projection against the bar, as a whole percent: +6 means the month is
    // running 6% over what the store is held to.
    out.vsBarPct = goal.bar > 0 ? Math.round(((projected - goal.bar) / goal.bar) * 100) : null;
  }
  return out;
}

/* ---- Month over month, compared on the same days ----

   The Summary set this month so far against all of last month, so for most of
   any month every row sat red: the 18th against a finished 31 days. A month in
   progress is now compared through the same day: the finished days of this
   month (through yesterday, since today's report has not landed) against the
   same days of last month.

   cut is the last day of each month to count, or null to compare whole months
   (any month that is over). scale is what last month's month-to-date figures
   are multiplied by when only a whole-month total exists for them, such as
   units and opportunities: the share of last month those days cover. Daily
   figures, the activity report's, are cut to the same days instead and need no
   scaling. */
export function likeForLike(monthKey, todayStr) {
  if (!todayStr || todayStr.slice(0, 7) !== monthKey) return { cut: null, scale: 1 };
  const cut = Math.max(0, Number(todayStr.slice(8, 10)) - 1);
  const [y, m] = monthKey.split("-").map(Number);
  const prevDays = new Date(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 0).getDate();
  return { cut, scale: Math.min(1, cut / prevDays) };
}

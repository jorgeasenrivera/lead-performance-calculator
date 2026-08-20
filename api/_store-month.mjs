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

   A month of its own beats the standing figure, because goals move every month
   and last month's is worse than nothing. */
export function storeGoalFor(store, monthKey) {
  const g = (store && store.goal) || null;
  if (!g) return null;
  const units = (g.byMonth && g.byMonth[monthKey] != null) ? g.byMonth[monthKey] : g.units;
  if (!(units > 0)) return null;
  const pct = g.pct > 0 ? g.pct : 100;
  return { units, pct, bar: units * (pct / 100) };
}

/**
 * How a hero counts the people held to a standard.
 * -------------------------------------------------------------------------
 * "3 of 8 below target" is read as eight people measured and three of them
 * short. The sentence has to be true, so the two ways a person can have nothing
 * to show are counted apart.
 *
 * OBSERVED: the reports gave a figure, and that includes a measured zero. A
 * salesperson who posted no videos has a real 0% and is really below the bar.
 *
 * MISSING: the reports never mentioned them. No figure at all, null or
 * undefined, which is the same test evaluateAssociate uses for "absent". A new
 * hire in their first week, somebody on leave, a store whose report has not
 * landed yet. That is not a shortfall. It is the absence of the thing that
 * would say whether there is one, and a hero that scored it as 0% would tell a
 * manager the floor is failing when the truth is that a file has not arrived.
 *
 * This decides how the heroes COUNT and average, and nothing else. It does not
 * decide who is restricted: evaluateAssociate still treats one missing figure
 * among several as a real shortfall, on purpose, and none of this reaches it.
 */

/* How much of the bar this person has cleared, 0 to 1, or null when there is no
   figure to measure. `need` is the bar in the same units as `value` and must be
   above zero: a standard with no bar has nothing to be measured against, and the
   caller leaves it out before it gets here. */
export function attainmentOf(value, need) {
  if (value == null) return null;
  return Math.min(1, value / need);
}

export function newRollup() {
  return { total: 0, observed: 0, missing: 0, below: 0, sum: 0 };
}

/* One person's attainment, as attainmentOf gave it. `below` only ever counts
   somebody who was measured. */
export function addToRollup(rollup, got) {
  rollup.total++;
  if (got == null) {
    rollup.missing++;
    return rollup;
  }
  rollup.observed++;
  rollup.sum += got;
  if (got < 1) rollup.below++;
  return rollup;
}

/* What the hero prints. The mean is across the people who were measured, and it
   is null when nobody was: there is no average of nothing, and 0 would be a
   claim about the floor that nobody has checked. */
export function readRollup(rollup) {
  const { total, observed, missing, below } = rollup;
  return { total, observed, missing, below, mean: observed > 0 ? rollup.sum / observed : null };
}

/* The standard furthest from its target, among the ones anybody was measured
   on. A standard nobody has a figure for cannot be the weakest, because there is
   nothing to rank it by. Null when no standard has a single figure. */
export function weakestRollup(rollups) {
  let weakest = null;
  for (const [metric, rollup] of Object.entries(rollups)) {
    const read = readRollup(rollup);
    if (read.mean == null) continue;
    if (!weakest || read.mean < weakest.mean) weakest = { metric, ...read };
  }
  return weakest;
}

/**
 * How a hero counts the people held to a standard.
 * -------------------------------------------------------------------------
 * "3 of 8 below target" is read as eight people measured and three of them
 * short. The sentence has to be true, so the two ways a person can have nothing
 * to show are counted apart.
 *
 * OBSERVED: the reports gave a figure that can be a measurement, which is a
 * finite number, zero or more. A measured zero is observed. A salesperson who
 * posted no videos has a real 0% and is really below the bar.
 *
 * UNAVAILABLE, counted as "missing": there is nothing to measure. Either no
 * figure at all (null or undefined, which is the same test evaluateAssociate
 * uses for "absent"), or a figure that cannot be a measurement: a negative,
 * NaN, Infinity, or anything that is not a number. The report reader lets a
 * negative and an infinite figure through, and a hero that scored one would put
 * a dial over 100% or print "NaN%". Neither is a shortfall and neither is a
 * pass. A new hire in their first week, somebody on leave, a store whose report
 * has not landed yet: each is the absence of the thing that would say whether
 * there is a shortfall, and a hero that scored it as 0% would tell a manager the
 * floor is failing when the truth is that a file has not arrived.
 *
 * This decides how the heroes COUNT and average, and nothing else. It does not
 * decide who is restricted: evaluateAssociate still treats one missing figure
 * among several as a real shortfall, on purpose, reads every figure by its own
 * rules, and none of this reaches it.
 */

/* A figure the hero may score: a finite number, zero or more. Zero passes. */
export function isMeasured(value) {
  return Number.isFinite(value) && value >= 0;
}

/* How much of the bar this person has cleared, 0 to 1, or null when there is
   nothing to measure: no figure, a figure that cannot be a measurement, or a bar
   that is not a finite number above zero. A standard with no bar has nothing to
   be measured against, and the caller leaves it out before it gets here. */
export function attainmentOf(value, need) {
  if (!isMeasured(value) || !Number.isFinite(need) || !(need > 0)) return null;
  const got = Math.min(1, value / need);
  return got === 0 ? 0 : got;
}

export function newRollup() {
  return { total: 0, observed: 0, missing: 0, below: 0, sum: 0 };
}

/* One person's attainment, as attainmentOf gave it. Anything that is not a
   finite number of zero or more is unavailable and counts as missing, and
   `below` only ever counts somebody who was measured. */
export function addToRollup(rollup, got) {
  rollup.total++;
  if (!isMeasured(got)) {
    rollup.missing++;
    return rollup;
  }
  rollup.observed++;
  rollup.sum += Math.min(1, got);
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

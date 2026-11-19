/**
 * A video standard for the whole store, as the ring on the hero prints it.
 * -------------------------------------------------------------------------
 * The ring used to print the average of each person's progress toward their
 * own target, capped at the target. That number reads like a video rate ("84%
 * of appointments got a video") and is not one: it can never pass 100, and a
 * floor sending 40% against a 50% bar showed 80.
 *
 * So the ring now carries two plain figures a manager can check against the
 * people under it: the floor's rate, which is the average of each person's own
 * rate as DriveCentric printed it, uncapped, and the target most of the floor
 * is held to. The fill is how close the one is to the other.
 *
 * The report gives a percentage per person and no counts behind it for the
 * BH and Engaged videos, so a true pooled rate is not on offer. The average of
 * the people is the honest version of the number, and the popup says so.
 */

/* entries: one per person the standard applies to, { got, min }, where got is
   the person's rate as a fraction (0.62) or null when the report had nothing
   for them, and min is the target their tier sets, as a whole percent (70).
   A person with no figure counts as 0, the same way the standard grades them. */
export function videoStandard(entries) {
  const list = (entries || []).filter((e) => e && e.min > 0);
  if (!list.length) return null;
  const total = list.length;
  const rate = list.reduce((n, e) => n + (Number.isFinite(e.got) ? e.got : 0), 0) / total;
  // The bar most people are held to. Tiers can differ person to person; a tie
  // takes the lower bar, the gentler reading.
  const seen = new Map();
  for (const e of list) seen.set(e.min, (seen.get(e.min) || 0) + 1);
  const target = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const below = list.filter((e) => (Number.isFinite(e.got) ? e.got : 0) < e.min / 100).length;
  const ratio = target > 0 ? rate / (target / 100) : 0;
  return { rate, target, ratio, below, total };
}

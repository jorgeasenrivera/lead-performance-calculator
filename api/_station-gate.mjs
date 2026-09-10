/**
 * Whether somebody should be taking a phone station.
 * -------------------------------------------------------------------------
 * Phase four, and deliberately the last of the behaviour work: it is the part
 * that tells people no, and it should land on a system everybody already
 * trusts rather than arriving alongside it.
 *
 * None of the judgement is new. The store already sets what good looks like on
 * the phone — thresholds.phone.green, a closing percentage — and the queue
 * already knows about a grace period, about figures being absent, and about
 * the difference between somebody failing a standard and somebody nobody has
 * measured yet. A station is that same judgement pointed at a seat instead of
 * at lead volume, so this reads the store's own numbers and reaches the same
 * kind of verdict in the same words.
 *
 * ---- it warns, it does not block ----
 * Every path out of here still lets the person sit down. What "below" buys is
 * a sentence on the screen and a line in the audit log with a name on it. That
 * was settled early and it is the right shape: the desk knows things the
 * figures do not — somebody is being coached, somebody just moved off the
 * showroom, somebody is covering a shift nobody else can — and a gate that
 * cannot be overruled by a manager standing in the room is a gate that gets
 * worked around instead of used.
 *
 * ---- nothing to judge is not a failure ----
 * The same rule the tier evaluation already keeps. A person with no phone
 * leads this month has no phone closing rate, and 0% out of nothing is not
 * evidence of anything. Neither is 0% out of three. So there is a floor on how
 * much history counts as a reading at all, and under it the answer is that we
 * do not know — which is a different sentence from "they are below standard",
 * and it is the one that lands on new hires, on somebody back from leave, and
 * on anybody whose month has barely started.
 */

/** How many phone leads a month needs before the rate means anything.
 *
 *  A judgement call, and the one most worth arguing about: too low and the
 *  first person to lose a single early lead reads as below standard; too high
 *  and the gate says nothing until the month is nearly over. Ten is roughly
 *  where one deal stops moving the number by more than the standard itself. */
export const MIN_PHONE_LEADS = 10;

/** Somebody's phone closing this month, as a fraction, or null when there is
    not enough behind it to be a rate. Reads the same fields the channel
    strips and the closing sheet already read. */
export function phoneCloseOf(stats, { minLeads = MIN_PHONE_LEADS } = {}) {
  const leads = Number(stats && stats.phoneLeads);
  const units = Number(stats && stats.phoneUnits);
  if (!Number.isFinite(leads) || leads < minLeads) return null;
  if (!Number.isFinite(units)) return null;
  return leads > 0 ? units / leads : null;
}

/**
 * The verdict on one person taking one seat.
 *
 *   clear         at or above the store's phone standard
 *   below         under it — warn, and let a manager wave them through
 *   grace         under it, inside the month's grace days
 *   unrated       not enough phone leads yet to have a rate
 *   no-standard   the store has not said what good looks like on the phone
 *
 * `standard` is a percentage the way the store stores it (25 means 25%), and
 * `pct` comes back as a fraction the way the app's own formatters expect. The
 * two units are kept apart deliberately: mixing them is how a gate ends up
 * comparing 0.14 against 25 and failing everybody in the building.
 */
export function stationGate({ stats, standard, inGrace = false, minLeads = MIN_PHONE_LEADS } = {}) {
  const bar = Number(standard);
  const pct = phoneCloseOf(stats, { minLeads });
  const leads = Number(stats && stats.phoneLeads) || 0;

  if (!Number.isFinite(bar) || bar <= 0) {
    return { state: "no-standard", ok: true, pct, standard: null, leads };
  }
  if (pct == null) {
    return { state: "unrated", ok: true, pct: null, standard: bar, leads, minLeads };
  }
  if (pct >= bar / 100) return { state: "clear", ok: true, pct, standard: bar, leads };
  /* Below, but the store's own grace period says this month is for coaching
     rather than restricting. The queue already words it "working toward
     standard" and this says the same thing rather than a second one. */
  if (inGrace) return { state: "grace", ok: true, pct, standard: bar, leads };
  return { state: "below", ok: false, pct, standard: bar, leads };
}

/** Whether taking this seat needs a manager to say so out loud. */
export const needsOverride = (gate) => !!gate && gate.state === "below";

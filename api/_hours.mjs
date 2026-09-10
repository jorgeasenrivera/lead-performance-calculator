/**
 * What happened in each hour, recovered by keeping the snapshots.
 * -------------------------------------------------------------------------
 * The Delivery Summary arrives hourly and every import OVERWRITES the day's
 * row, so the system knows a person's totals as of the last upload and nothing
 * at all about what changed between ten and eleven. "Did they take phone
 * opportunities while they were sitting at the station" is exactly a
 * between-uploads question, and it is unanswerable from a row that only ever
 * holds the latest total.
 *
 * The fix is the one the thirty-day closing lines already use: keep the
 * snapshot and difference consecutive ones. Each import stamps the day's
 * running counters into the bucket for its own hour; the hour's own figures
 * are that bucket minus the one before it.
 *
 * Nothing reads this yet. It is here because an hour that was never recorded
 * cannot be recovered afterwards, and the attribution it exists for is
 * entirely a question about history — every week this waits is a week that
 * never existed. Shipping it with no screen attached is the point.
 *
 * Kept deliberately small. The row it rides on is fetched by every phone, so
 * this stores four numbers per person per hour, sparsely: an hour with no
 * import is simply absent, and a person with nothing in the day is not
 * written at all.
 */

const TZ = "America/New_York";

/** The store's hour, as a two-digit string. Same basis as the day the row is
    keyed by, or a bucket would land on the wrong side of midnight. */
export function hourIn(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", hour12: false,
  }).format(d);
  /* Intl returns "24" for midnight in some runtimes and "00" in others. */
  return h === "24" ? "00" : h;
}

/* The four that answer "did sitting there produce anything". Short keys
   because they are written once per person per hour and read as a block. */
const KEEP = { op: "oppPhone", ca: "calls", ct: "contacted", ap: "apptScheduled" };

/* Named for what it does rather than `num`, which the app already has: two
   definitions of one name across the two sides is the drift the duplicate
   guard exists to catch, and it has caught it. Number.isFinite rather than the
   global, which coerces and would let a numeric string through as a count. */
const counted = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The counters worth keeping from one person's day row, or null for a day
    with nothing in it — an empty bucket is weight, not information. */
export function bucketOf(dayRow) {
  if (!dayRow) return null;
  const out = {};
  let any = false;
  for (const [k, field] of Object.entries(KEEP)) {
    const v = counted(dayRow[field]);
    if (v) { out[k] = v; any = true; }
  }
  return any ? out : null;
}

/**
 * Stamp this import's totals into its own hour.
 *
 * Last write for an hour wins, because a second import in the same hour is the
 * more complete one, not a second hour's worth. Existing hours are left alone:
 * an import aimed at a past day must not rewrite the hours of a day it is not
 * describing, and re-running today's import must not disturb this morning.
 */
export function stampHours(hours, dayRows, at = new Date()) {
  const h = hourIn(at);
  const next = { ...(hours || {}) };
  const bucket = {};
  for (const [key, row] of Object.entries(dayRows || {})) {
    const b = bucketOf(row);
    if (b) bucket[key] = b;
  }
  if (!Object.keys(bucket).length) return next;
  next[h] = bucket;
  return next;
}

/**
 * One person's hours, as what happened IN each hour rather than by then.
 *
 * The first bucket of a day has nothing before it, so it counts as everything
 * since the doors opened — which is true, and better than dropping the hour
 * that usually holds the morning's calls.
 *
 * A counter that goes backwards yields nothing rather than a negative. That
 * happens when a report is re-pulled and corrected downward, and a negative
 * hour is never a real thing that occurred.
 */
export function hourDeltas(hours, personKey) {
  const keys = Object.keys(hours || {}).sort();
  const out = [];
  let prev = null;
  for (const h of keys) {
    const cur = (hours[h] || {})[personKey];
    if (!cur) continue;
    const d = { hour: h };
    for (const k of Object.keys(KEEP)) {
      const now = counted(cur[k]);
      const was = prev ? counted(prev[k]) : 0;
      d[k] = Math.max(0, now - was);
    }
    out.push(d);
    prev = cur;
  }
  return out;
}

/**
 * What one person picked up across a window, which is what a sit is.
 *
 * Hour-granular against a minute-granular interval, so the rule has to be
 * stated rather than discovered: an hour counts when the window covers MOST of
 * it. Somebody who sat down at 10:40 does not get the ten o'clock hour;
 * somebody who sat at 10:10 does. It is the simpler of the two honest choices
 * and it is applied the same way every time, which matters more than which one
 * it is when a manager asks why a number reads as it does.
 */
export function betweenHours(hours, personKey, fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const totals = { op: 0, ca: 0, ct: 0, ap: 0, hours: 0 };
  if (!(from < to)) return totals;

  /* The hour labels are the STORE's hours and the window is epoch
     milliseconds, so the two have to be brought into one basis before they can
     be compared. setHours would do it in whatever zone the server happens to
     run in — which on a Vercel function is UTC, four hours off, so every
     window would miss every bucket and quietly attribute nothing.

     Taken from the window itself: the distance between the store's hour and
     the same instant's UTC hour is the offset, and every bucket that day is
     that same distance away. Holds unless a window spans a daylight-saving
     change, which happens at two in the morning with the phone room shut. */
  const storeHour = Number(hourIn(new Date(from)));
  const base = new Date(from);
  base.setUTCMinutes(0, 0, 0);

  for (const d of hourDeltas(hours, personKey)) {
    const hStart = base.getTime() + (Number(d.hour) - storeHour) * 3600000;
    const hEnd = hStart + 3600000;
    const covered = Math.min(to, hEnd) - Math.max(from, hStart);
    if (covered >= 1800000) {           // most of the hour
      for (const k of Object.keys(KEEP)) totals[k] += counted(d[k]);
      totals.hours += 1;
    }
  }
  return totals;
}

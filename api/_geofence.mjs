/**
 * Where the lot ends.
 * -------------------------------------------------------------------------
 * Two jobs, and they are not the same shape.
 *
 * A manager draws the lot as a POLYGON, because a dealership is an L around a
 * service drive, not a circle. But neither iOS nor Android will monitor a
 * polygon in the background — both watch circles and nothing else. So the phone
 * watches a circle drawn around the whole lot, and when the operating system
 * wakes the app on crossing it, the exact answer is worked out here against the
 * real outline. The wake-up is approximate; the decision is not.
 *
 * ---- Drift is the whole problem ----
 * A phone standing still at the edge of a lot does not report a fixed point. It
 * reports a point and a radius of doubt, and that radius is routinely 10-40m on
 * a forecourt with a metal canopy over it. Treating "the point is outside" as
 * "the person left" would drop somebody out of line for standing near the road.
 *
 * So a reading is inside, outside, or UNCERTAIN — uncertain being when the
 * circle of doubt straddles the boundary — and only a run of confident readings
 * moves anybody. Nothing here ever decides from a single fix.
 *
 * ---- What is stored ----
 * Nothing. This module takes a reading and returns a verdict; the caller keeps
 * the verdict and throws the coordinates away. The database is meant to be able
 * to answer "was Luis on the lot at 12:40" and to be incapable of answering
 * "where did Luis go for lunch".
 */

const R_EARTH = 6371008.8;                     // metres, mean radius
const rad = (d) => (d * Math.PI) / 180;

/** Metres between two { lat, lng } points. */
export function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat), la2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Working in metres on a local tangent plane rather than in degrees: a degree of
   longitude is 111km at the equator and 78km in Florida, so comparing raw
   degrees would make every lot the wrong shape by a third. */
function toXY(pt, origin) {
  return {
    x: rad(pt.lng - origin.lng) * R_EARTH * Math.cos(rad(origin.lat)),
    y: rad(pt.lat - origin.lat) * R_EARTH,
  };
}

/** Ray casting. True when the point is within the outline. */
export function pointInPolygon(pt, ring) {
  if (!pt || !Array.isArray(ring) || ring.length < 3) return false;
  const o = ring[0];
  const p = toXY(pt, o);
  const v = ring.map((q) => toXY(q, o));
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i], b = v[j];
    const straddles = (a.y > p.y) !== (b.y > p.y);
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to the outline, in metres. */
export function metersToEdge(pt, ring) {
  if (!pt || !Array.isArray(ring) || ring.length < 2) return Infinity;
  const o = ring[0];
  const p = toXY(pt, o);
  const v = ring.map((q) => toXY(q, o));
  let best = Infinity;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i], b = v[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const cx = a.x + t * dx, cy = a.y + t * dy;
    best = Math.min(best, Math.hypot(p.x - cx, p.y - cy));
  }
  return best;
}

/**
 * The circle the phone is asked to watch: everything the lot touches, plus a
 * margin so the operating system wakes us slightly before the real edge rather
 * than slightly after.
 */
export function watchCircle(ring, marginM = 60) {
  if (!Array.isArray(ring) || !ring.length) return null;
  const lat = ring.reduce((n, p) => n + p.lat, 0) / ring.length;
  const lng = ring.reduce((n, p) => n + p.lng, 0) / ring.length;
  const centre = { lat, lng };
  const radius = ring.reduce((m, p) => Math.max(m, metersBetween(centre, p)), 0);
  return { ...centre, radius: Math.round(radius + marginM) };
}

/**
 * One reading against one fence: "in", "out", or "unsure".
 *
 * `accuracy` is the reading's own radius of doubt, as both platforms report it.
 * When that circle reaches across the boundary the honest answer is that we do
 * not know, and a person is never moved on an answer of "we do not know".
 */
export function readingVerdict(reading, fence, opts = {}) {
  const slack = opts.slackM ?? 15;              // a forecourt's worth of forgiveness
  const maxAccuracy = opts.maxAccuracyM ?? 120; // beyond this the fix is worthless
  if (!reading || !fence || !Array.isArray(fence.ring) || fence.ring.length < 3) return "unsure";
  if (!(reading.accuracy >= 0) || reading.accuracy > maxAccuracy) return "unsure";

  const inside = pointInPolygon(reading, fence.ring);
  const edge = metersToEdge(reading, fence.ring);
  const doubt = reading.accuracy + slack;

  // Straddling the line: the point says one thing and its own error bar says the
  // other is just as likely.
  if (edge <= doubt) return "unsure";
  return inside ? "in" : "out";
}

/**
 * Readings arrive one at a time; this holds the running state and only reports a
 * crossing once it is properly convinced.
 *
 * Both a count and a clock, because they catch different lies. A count alone is
 * fooled by a phone that fires three fixes in two seconds while its owner walks
 * past a window. A clock alone is fooled by one wild fix followed by silence.
 */
export function settle(state, reading, fence, now, opts = {}) {
  const needed = opts.confirmations ?? 3;
  const dwellMs = opts.dwellMs ?? 90 * 1000;
  const s = state && typeof state === "object"
    ? { ...state }
    : { where: "unknown", runVerdict: null, runCount: 0, runSince: null, changedAt: null };

  const v = readingVerdict(reading, fence, opts);
  if (v === "unsure") return { ...s, crossed: null };       // it tells us nothing; keep what we had

  if (s.runVerdict !== v) { s.runVerdict = v; s.runCount = 1; s.runSince = now; }
  else s.runCount += 1;

  const convinced = s.runCount >= needed && now - (s.runSince ?? now) >= dwellMs;
  if (!convinced || s.where === v) return { ...s, crossed: null };

  const from = s.where;
  s.where = v;
  s.changedAt = now;
  /* "unknown" to "in" is somebody's phone waking up on the lot, not an arrival
     worth acting on. Only a real crossing is reported. */
  const crossed = from === "unknown" ? null : (v === "out" ? "left" : "returned");
  return { ...s, crossed };
}

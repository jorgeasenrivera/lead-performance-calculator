/**
 * A button pressed on the lock screen's phone lane, applied to the day's
 * queue row.
 * -------------------------------------------------------------------------
 * The phone room's presses are the room's own moves (api/_stations.mjs), so
 * a press from the card writes exactly what the room screen writes. Pure on
 * purpose; the endpoint reads, applies, writes, and the row's webhook moves
 * the card.
 *
 * actions:
 *   take-desk     the desk offered is theirs (rotation), or the free one they
 *                 named (open mode) — through the store's phone standard first
 *   pass-desk     not this one: the offer moves on, logged as a skip from the card
 *   leave-desk    up from the desk, back on the cord
 *   lunch-desk    up from the desk and off to lunch
 *   lunch-line    off the cord for lunch;  away-line likewise
 *   back-line     back on the cord, waiting
 */
import { takeOffer, skipOffer, releasePerson, claimStation, stationOf, offerOf, offerLeftMs,
  stationLine, stationPlanOf, stationModeOf } from "./_stations.mjs";

export const PHONE_ACTIONS = ["take-desk", "pass-desk", "leave-desk", "lunch-desk", "lunch-line", "away-line", "back-line"];
export const isPhoneAction = (a) => PHONE_ACTIONS.includes(a);

/* Which desk a press is about: the one offered to them, else the one they
   named, else the first free one nobody is being sent to. */
function deskFor(config, store, row, personId, want, now) {
  const seats = stationLine(stationPlanOf(config, store), row, { now, offers: stationModeOf(config, store) === "rotation" }).seats;
  const offered = seats.find((s) => s.offerTo === personId);
  if (offered) return { n: offered.n, viaOffer: true };
  if (want != null && want !== "") {
    const s = seats.find((x) => String(x.n) === String(want));
    if (s && !s.taken && !s.offerTo) return { n: s.n, viaOffer: false };
    return null;
  }
  const free = seats.find((s) => !s.taken && !s.offerTo);
  return free ? { n: free.n, viaOffer: false } : null;
}

export function applyPhoneAction(config, store, row, personId, action, now, { desk = null } = {}) {
  if (!isPhoneAction(action)) return { row, changed: false, why: "unknown action" };
  if (!row || !Array.isArray(row.line)) return { row, changed: false, why: "no line" };
  const p = row.line.find((x) => x && x.id === personId);
  if (!p) return { row, changed: false, why: "not in line" };
  const person = { id: personId, label: p.label || "" };
  const nowMs = Date.parse(now) || Date.now();

  if (action === "take-desk") {
    if (stationOf(row, personId) != null) return { row, changed: false, why: "already seated" };
    if ((p.status || "waiting") !== "waiting") return { row, changed: false, why: "not waiting" };
    const d = deskFor(config, store, row, personId, desk, nowMs);
    if (!d) return { row, changed: false, why: "no desk" };
    const r = d.viaOffer ? takeOffer(row, d.n, person, now) : claimStation(row, d.n, person, now);
    return r.changed ? { ...r, desk: String(d.n) } : r;
  }
  if (action === "pass-desk") {
    const n = Object.keys(row.offers || {}).find((k) => { const o = offerOf(row, k); return o && o.id === personId && offerLeftMs(o, nowMs) > 0; });
    if (n == null) return { row, changed: false, why: "nothing offered" };
    return skipOffer(row, n, now, { by: person.label || "self", why: "passed from the card" });
  }
  if (action === "leave-desk" || action === "lunch-desk") {
    if (stationOf(row, personId) == null) return { row, changed: false, why: "not seated" };
    const r = releasePerson(row, personId, now, action === "lunch-desk" ? "lunch" : "out");
    if (!r.changed) return r;
    if (action === "lunch-desk") setStatus(r.row, personId, "lunch", now);
    return r;
  }
  if (action === "lunch-line" || action === "away-line") {
    if (stationOf(row, personId) != null) return { row, changed: false, why: "seated" };
    const next = JSON.parse(JSON.stringify(row));
    setStatus(next, personId, action === "lunch-line" ? "lunch" : "away", now);
    return { row: next, changed: true };
  }
  if (action === "back-line") {
    if ((p.status || "waiting") === "waiting") return { row, changed: false, why: "already waiting" };
    const next = JSON.parse(JSON.stringify(row));
    setStatus(next, personId, "waiting", now);
    return { row: next, changed: true };
  }
  return { row, changed: false, why: "unknown action" };
}

/* The same status write the room screen makes, history line included. */
function setStatus(row, personId, status, now) {
  const p = (row.line || []).find((x) => x && x.id === personId);
  if (!p) return;
  row.history = row.history || [];
  if (status === "waiting") {
    row.history.push({ t: now, action: "back", from: p.awayReason || (p.status !== "waiting" ? p.status : null), id: personId, who: p.label || "", by: "self" });
    p.awayReason = null;
  } else {
    p.awayReason = status;
    row.history.push({ t: now, action: status, id: personId, who: p.label || "", by: "self" });
  }
  p.status = status; p.statusAt = now;
}

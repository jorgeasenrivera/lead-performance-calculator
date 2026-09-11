/**
 * What the phone tells the lock screen: one message per person, carrying the
 * floor, the phone line, or both.
 * -------------------------------------------------------------------------
 * Contract v2. Built here, in one place, from the two day rows, and used by
 * both senders: the app posts it to the native shell whenever a standing
 * changes, and the server mirrors it into pushes so the card moves with the
 * app closed. The shell never re-decides which lane leads; `hot` says.
 *
 * Old shells (build 17) read only the v1 fields at the top level, which are
 * filled from the leading lane, so a person only on the phone line gets the
 * floor-shaped card with the phone's numbers, exactly as they did before.
 *
 * Pure on purpose: no clock beyond `now`, no network. The tests can run it.
 */
import { standings, railOf, askOf, hueOf, railInitials } from "./_queue-notify.mjs";
import { stationLine, stationPlanOf, stationModeOf, roomInUse } from "./_stations.mjs";

const NUDGE_MIN = 10;
const minsSince = (iso, now) => (iso ? Math.max(0, (now - Date.parse(iso)) / 60000) : Infinity);
const firstOf = (nm) => String(nm || "").split(" ")[0];

/* Everybody on a rail as initials and a hue, you marked. The same shape the
   floor sends today; the phone's rail is in DESK order, the rotation's own. */
function railFrom(people, roster, meId, max = 8) {
  const nameOf = (p) => p.label || ((roster || []).find((r) => r && r.id === p.id) || {}).label
    || ((roster || []).find((r) => r && r.id === p.id) || {}).name || "";
  return people.slice(0, max).map((p) => {
    const nm = nameOf(p);
    return { i: railInitials(nm) || "·", h: hueOf(nm), s: (p.status || "waiting") === "waiting" ? "w" : "x", me: p.id === meId };
  });
}

/** The floor lane for one person, or null when they are not on the floor today. */
export function floorLane(row, meId, now = Date.now()) {
  const line = (row && Array.isArray(row.line)) ? row.line : [];
  const idx = line.findIndex((p) => p && p.id === meId);
  if (idx < 0) return null;
  const me = line[idx];
  const s = standings(line).get(meId);
  return {
    position: idx + 1,
    ahead: s.ahead,
    status: s.up ? "up" : s.status,
    line: railOf(row, meId),
    table: me.table != null ? String(me.table) : null,
    since: me.statusAt || null,
    nudge: !!(me.nudgedAt && minsSince(me.nudgedAt, now) < NUDGE_MIN),
    ask: null, askAt: null, askBy: null,
    ...askOf(row, meId),
  };
}

/** The phone lane for one person, or null when they are not on the line today. */
export function phoneLane(config, store, row, meId, now = Date.now()) {
  const line = (row && Array.isArray(row.line)) ? row.line : [];
  const idx = line.findIndex((p) => p && p.id === meId);
  if (idx < 0) return null;
  const me = line[idx];
  const status = me.status || "waiting";
  const roster = (row && row.roster) || [];

  /* A phone line with no room is a line: the cord, in the line's own order. */
  if (!roomInUse(config, store, row)) {
    const s = standings(line).get(meId);
    return { state: status !== "waiting" ? "off" : "cord", position: idx + 1, ahead: s.ahead,
      line: railOf(row, meId), status, since: me.statusAt || null };
  }

  const plan = stationPlanOf(config, store);
  const board = stationLine(plan, row, { now, offers: stationModeOf(config, store) === "rotation" });
  const mine = board.seats.find((s) => s.taken && s.id === meId) || null;
  const offered = board.seats.find((s) => s.offerTo === meId) || null;
  const freeSeats = board.seats.filter((s) => !s.taken && !s.offerTo);
  const myIdx = board.waiting.findIndex((p) => p.id === meId);
  const state = status !== "waiting" ? "off" : mine ? "desk" : offered ? "offer" : freeSeats.length ? "free" : "cord";
  const lane = {
    state,
    status,
    since: me.statusAt || null,
    desks: board.seats.map((s) => ({
      n: String(s.n),
      who: s.taken ? firstOf(s.label) : s.offerTo ? firstOf(s.offerLabel) : "",
      mine: !!(s.taken && s.id === meId),
      open: !s.taken && (!s.offerTo || s.offerTo === meId),
    })),
  };
  if (state === "cord" || state === "free") {
    lane.position = myIdx >= 0 ? myIdx + 1 : 0;
    lane.ahead = myIdx >= 0 ? myIdx : board.waiting.length;
    lane.line = railFrom(board.waiting, roster, meId);
  }
  if (state === "offer") {
    lane.desk = String(offered.n); lane.until = new Date(now + offered.offerLeftMs).toISOString();
    /* the cord, with you at the front: the card draws it lit to the handset */
    lane.line = railFrom([me, ...board.waiting.filter((p) => p.id !== meId)], roster, meId);
  }
  if (state === "desk") { lane.desk = String(mine.n); lane.since = mine.at || me.statusAt || null; }
  if (state === "free") lane.free = freeSeats.map((s) => String(s.n));
  return lane;
}

/** Which lane leads, by the agreed order; null when neither is urgent. */
export function hotOf(floor, phone) {
  if (phone && phone.state === "offer") return "phone";
  if (floor && (floor.status === "up" || floor.nudge)) return "floor";
  if (floor && floor.ask) return "floor";
  if (phone && phone.state === "cord" && phone.ahead === 0) return "phone";
  return null;
}

/* The v1 fields a build-17 shell reads, filled from the leading lane. */
function v1From(lead, floor, phone, rep) {
  if (lead === "floor" && floor) {
    return { queue: "Live Floor", rep, position: floor.position, ahead: floor.ahead, status: floor.status, line: floor.line,
      table: floor.table, since: floor.since, nudge: floor.nudge, ask: floor.ask, askAt: floor.askAt, askBy: floor.askBy };
  }
  if (phone) {
    /* An offer is the phone line's "you're up": the old card says so and the
       person knows to look. Everything else reads as the line it always was. */
    const up = phone.state === "offer";
    return { queue: "Phone Line", rep, position: up ? 1 : (phone.position || 1), ahead: up ? 0 : (phone.ahead || 0),
      status: up ? "up" : phone.status, line: phone.line || [], table: null, since: phone.since || null, nudge: false };
  }
  return null;
}

/**
 * The whole message. `lastRoom` is the room the app opened to last ("floor" or
 * "line"), the tie-break when neither lane is urgent; the shell shows both
 * small when `hot` is null either way.
 */
export function liveEnvelope({ config, store, storeName = "", date, meId, floorRow, queueRow, lastRoom = null, now = Date.now() }) {
  if (!meId) return null;
  const floor = floorLane(floorRow, meId, now);
  const phone = phoneLane(config, store, queueRow, meId, now);
  const roster = [...(((floorRow || {}).roster) || []), ...(((queueRow || {}).roster) || [])];
  const rep = ((roster.find((r) => r && r.id === meId)) || {}).label || "";
  const base = { v: 2, store, storeName: storeName || (floorRow && floorRow.storeName) || (queueRow && queueRow.storeName) || "",
    date, rep, updatedAt: new Date(now).toISOString() };
  if (!floor && !phone) return { ...base, status: "gone" };
  const hot = hotOf(floor, phone);
  const lead = hot || (floor && phone ? (lastRoom === "line" ? "phone" : "floor") : (floor ? "floor" : "phone"));
  return { ...base, ...(floor ? { floor } : {}), ...(phone ? { phone } : {}), hot, ...v1From(lead, floor, phone, rep) };
}

/**
 * What a change to the phone room means for the people on its line, beyond
 * what `decide` already says about the line's order.
 *
 * kinds:
 *   "offer"   — buzz them. A desk is theirs and the clock is running.
 *   "seated"  — no alert; they took a desk, the card moves.
 *   "freed"   — no alert; a desk came open for them (open mode, or an offer
 *               that ran out of takers), the card moves.
 *   "position"— no alert; their place on the cord moved, or they left a desk.
 * Leaving the line is `decide`'s "end", not repeated here.
 */
export function decidePhone(config, store, before, after, now = Date.now()) {
  if (!roomInUse(config, store, after)) return [];
  const out = [];
  for (const p of (after && after.line) || []) {
    if (!p || !p.id) continue;
    const was = phoneLane(config, store, before, p.id, now);
    const is = phoneLane(config, store, after, p.id, now);
    if (!is) continue;
    const label = p.label || "";
    if (is.state === "offer" && (!was || was.state !== "offer" || was.desk !== is.desk)) {
      out.push({ id: p.id, kind: "offer", label, desk: is.desk, until: is.until,
        title: `Desk ${is.desk} is yours`, body: "Three minutes to take it." });
      continue;
    }
    if (is.state === "desk" && (!was || was.state !== "desk" || was.desk !== is.desk)) { out.push({ id: p.id, kind: "seated", label, desk: is.desk }); continue; }
    if (is.state === "free" && (!was || was.state !== "free")) { out.push({ id: p.id, kind: "freed", label, free: is.free }); continue; }
    if (!was || was.state !== is.state || was.ahead !== is.ahead || was.status !== is.status) out.push({ id: p.id, kind: "position", label });
  }
  return out;
}

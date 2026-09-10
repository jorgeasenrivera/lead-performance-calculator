/**
 * Who is sitting at which phone station.
 * -------------------------------------------------------------------------
 * The Phone Line was a rotation: you took a turn and went to the back. With
 * staffed stations it becomes a place as well, and a place needs to know who
 * is in it. This is that, and only that — no gating, no presence, no
 * attribution. Those are later phases and they all read what is written here.
 *
 * Two things live on the day's queue row:
 *
 *   stations   which seat each person holds right now, keyed by station
 *   sits       every sit today, open or closed, in the order they started
 *
 * `sits` is the part worth being deliberate about. Nothing in phase one reads
 * it. It exists because a sit that was never recorded cannot be recovered
 * afterwards, and the whole point of the later work — did sitting there
 * produce anything, are the seats covered when the phone rings — is a question
 * about history. Writing it from the first day costs six fields and buys the
 * only thing that cannot be added later.
 *
 * Pure, like applyQueueAction, so the desk, the phone and the tests all agree
 * about what a claim does.
 */

/** The seats a store has, until it draws its own. Percent coordinates, the
    same as the floor plan, so the same editor and the same map can draw it. */
export const DEFAULT_STATION_PLAN = {
  zones: [{ t: "phone room", x: 4, y: 8, w: 92, h: 84 }],
  /* `seats` rather than `tables`: a station is not a table, and the map reads
     either. Six is what a room this size usually holds; a store with four or
     twelve draws its own. */
  seats: [
    { n: "1", x: 14, y: 24 }, { n: "2", x: 42, y: 24 }, { n: "3", x: 70, y: 24 },
    { n: "4", x: 14, y: 58 }, { n: "5", x: 42, y: 58 }, { n: "6", x: 70, y: 58 },
  ],
};

/** The plan this store uses. Mirrors floorPlanOf, including the fallback. */
export function stationPlanOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === storeId);
  const plan = st && st.stationPlan;
  const seats = plan && (plan.seats || plan.tables);
  return (Array.isArray(seats) && seats.length) ? plan : DEFAULT_STATION_PLAN;
}

/** The seats on a plan, whichever key they were drawn under. */
export const seatsOf = (plan) => (plan && (plan.seats || plan.tables)) || [];

/** Which station this person is holding, or null. */
export function stationOf(row, personId) {
  const all = (row && row.stations) || {};
  for (const [n, s] of Object.entries(all)) if (s && s.id === personId) return n;
  return null;
}

/** Their open sit, if they have one. */
export function openSit(row, personId) {
  return ((row && row.sits) || []).find((s) => s && s.id === personId && !s.out) || null;
}

const clone = (row) => JSON.parse(JSON.stringify(row || {}));

/* Closing a sit in place rather than pushing a second record: one sit is one
   interval, and a pair of half-records is how a day ends up with somebody
   seated twice at once. */
function closeSit(next, personId, now, why) {
  const open = (next.sits || []).find((s) => s && s.id === personId && !s.out);
  if (open) { open.out = now; open.why = why; }
  return open || null;
}

/**
 * Take a seat.
 *
 * Refuses a seat somebody else is in — the desk moves people, a claim does not
 * take them. Claiming while already seated elsewhere is a MOVE: the old sit is
 * closed and a new one opened, because two open sits for one person would
 * quietly double every hour they were counted for.
 */
export function claimStation(row, station, person, now) {
  const n = String(station == null ? "" : station);
  if (!n) return { row, changed: false, why: "no station" };
  if (!person || !person.id) return { row, changed: false, why: "no person" };

  const next = clone(row);
  next.stations = next.stations || {};
  next.sits = next.sits || [];

  const held = next.stations[n];
  if (held && held.id === person.id) return { row, changed: false, why: "already there" };
  if (held) return { row, changed: false, why: "taken" };

  const was = stationOf(next, person.id);
  if (was != null) {
    delete next.stations[was];
    closeSit(next, person.id, now, "moved");
  }

  next.stations[n] = { id: person.id, label: person.label || person.name || "", at: now };
  next.sits.push({ st: n, id: person.id, label: person.label || person.name || "",
    in: now, out: null, why: null });
  return { row: next, changed: true, station: n, moved: was };
}

/**
 * Leave a seat.
 *
 * `why` is kept because the later phases care about the difference between
 * somebody who tapped out, somebody at lunch, and somebody whose phone left
 * the lot — the last of those frees a seat nobody told the system about.
 */
export function releaseStation(row, station, now, why = "out") {
  const n = String(station == null ? "" : station);
  const held = ((row && row.stations) || {})[n];
  if (!held) return { row, changed: false, why: "empty" };

  const next = clone(row);
  delete next.stations[n];
  closeSit(next, held.id, now, why);
  return { row: next, changed: true, station: n, id: held.id };
}

/** Leave whatever seat this person is in, wherever it is. */
export function releasePerson(row, personId, now, why = "out") {
  const n = stationOf(row, personId);
  if (n == null) return { row, changed: false, why: "not seated" };
  return releaseStation(row, n, now, why);
}

/**
 * What the board draws: every seat on the plan, with who is in it.
 * Free seats are included, because an empty station is the thing a manager is
 * looking for and a list of the occupied ones would leave it out.
 */
export function stationBoard(plan, row) {
  const held = (row && row.stations) || {};
  return seatsOf(plan).map((seat) => {
    const who = held[String(seat.n)] || null;
    return { ...seat, n: String(seat.n), taken: !!who,
      id: who ? who.id : null, label: who ? who.label : "", at: who ? who.at : null,
      /* `seen` travels with the seat or presence cannot see it: without this
         the board hands presenceOf a seat whose only clock is when they sat
         down, every touch is invisible, and everybody greys fifteen minutes
         into their shift no matter what they are doing. */
      seen: who ? (who.seen || who.at || null) : null };
  });
}

/* ---- presence: seated, held, free ----
   A seat knows three things about the person in it, and each is driven by
   something observable rather than inferred from silence.

     seated   theirs, and we have heard from them recently
     held     theirs, greyed on the board — on the lot, but quiet for a while
     free     nobody's

   Held is cosmetic. The seat stays theirs until they tap out, go to lunch, or
   their phone leaves the lot; greying says "we have not heard from them", not
   "they are gone". That distinction matters because the thing being measured
   is not attendance — GPS cannot see a desk, only the lot — it is whether the
   system still has reason to believe somebody is working the seat.

   Which also means the honest trigger is their last ACTION, not whether the
   app is open. A phone in a pocket with the screen off is not evidence of
   anything either way, and treating app-open as presence would grey somebody
   the moment their screen locked. The cost is the other direction: a person
   quietly working the phones without pressing anything in Sage greys after
   fifteen minutes. That is the system saying what it actually knows. */
export const HOLD_MS = 15 * 60 * 1000;

/** When this person was last heard from, falling back to when they sat. */
export const seenAt = (seat) => (seat && (seat.seen || seat.at)) || null;

/**
 * The state of one seat.
 *
 * `onLot` is what the geofence last said about this person: true inside, false
 * outside, and undefined when nothing is known — no fence drawn, permission
 * refused, a reading too vague to act on. Unknown is treated as inside,
 * because the alternative is freeing a seat on the strength of a reading the
 * fence itself would not stand behind.
 */
export function presenceOf(seat, { now = Date.now(), onLot, holdMs = HOLD_MS } = {}) {
  if (!seat || !seat.taken) return "free";
  if (onLot === false) return "free";
  const seen = seenAt(seat);
  if (!seen) return "seated";
  const quiet = now - new Date(seen).getTime();
  return quiet >= holdMs ? "held" : "seated";
}

/** Mark that we have heard from whoever is in this seat. */
export function touchStation(row, personId, now) {
  const n = stationOf(row, personId);
  if (n == null) return { row, changed: false, why: "not seated" };
  const next = clone(row);
  next.stations[n].seen = now;
  return { row: next, changed: true, station: n };
}

/** The board, with each seat's state worked out. */
export function stationPresence(plan, row, { now = Date.now(), onLot = {}, holdMs = HOLD_MS } = {}) {
  return stationBoard(plan, row).map((seat) => ({
    ...seat,
    seen: seenAt(seat),
    state: presenceOf(seat, { now, onLot: seat.id ? onLot[seat.id] : undefined, holdMs }),
  }));
}

/**
 * Today's sits for one person, which is what "your day at the station" draws.
 * Open sits are included with no end, because the one they are in now is the
 * one they most want to see.
 */
export function sitsFor(row, personId) {
  return ((row && row.sits) || []).filter((s) => s && s.id === personId);
}

/** How long a sit ran, in minutes. An open one runs to now. */
export function sitMinutes(sit, now = Date.now()) {
  if (!sit || !sit.in) return 0;
  const end = sit.out ? new Date(sit.out).getTime() : now;
  return Math.max(0, Math.round((end - new Date(sit.in).getTime()) / 60000));
}

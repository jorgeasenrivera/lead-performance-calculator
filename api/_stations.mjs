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
  /* Whatever the rotation was offering for this chair is over: somebody is in
     it. Dropped here rather than in the rotation's own code so it holds for
     the desk seating a person directly, which is the case that would
     otherwise leave a round running against an occupied seat. */
  if (next.offers) delete next.offers[n];
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

/* ---- the rotation: where a freed seat goes ----
   Phases one and two make a seat something a person can be in. This is the
   part that decides WHO, so the room stops needing somebody to run it.

   The waiting list is not new machinery: it is the Phone Line itself, in its
   own order, which is the list the store already trusts and already argues
   about. A seat coming free is offered to whoever is next on it. The offer
   stands for a few minutes, and if it is not taken it rolls on.

   Two things are deliberately NOT true here, because both were tempting:

   An offer does not move anybody in the line. Passing on a seat is not
   declining a call, and if it cost somebody their place then sitting down
   would be a gamble against their own next up. The line orders calls; the
   offer only says whose turn the chair is.

   An offer does not stop the desk. claimStation is still the desk's word and
   seats whoever it is told to — taking the offer with it, because the seat is
   then occupied and there is nothing left to offer. The offer is how the room
   runs itself when nobody is watching, not a lock on the manager. */

/** How long an offer stands before it rolls to the next person. One number,
    in one place, because the right value is a floor decision rather than a
    technical one and it will be argued about. */
export const OFFER_MS = 3 * 60 * 1000;

/**
 * Everyone who could take a seat right now, in the order the room should ask.
 *
 * Waiting means waiting: somebody at lunch, on a call or already in a chair is
 * not offered one, and `skip` is how the caller keeps the test identity out of
 * a real rotation.
 *
 * The order is NOT simply the line's, and the reason is worth writing down
 * because the obvious version was built first and watched misbehave. The Phone
 * Line orders who gets the next CALL. Used unchanged for chairs it hands a
 * freed seat straight back to whoever just stood up from it — they are still
 * high in the line, they are waiting again the moment they are released, and
 * the desk frees a station only to be offered the same person a second later.
 *
 * So the room asks in the rotation's own terms, which is what the Phone Line
 * has always been: take a turn, go to the back. Anybody who has not had a
 * station today is asked first, in the line's order. Everybody else follows,
 * longest since they got up first. Nobody is punished for sitting down — being
 * behind for a CHAIR costs nothing in the queue for calls, which is the whole
 * separation this phase depends on.
 */
export function waitingFor(row, { skip = [] } = {}) {
  const out = new Set(skip);
  const seated = (row && row.stations) || {};
  for (const s of Object.values(seated)) if (s && s.id) out.add(s.id);

  /* When each person last got up, so a turn just taken sorts to the back. */
  const lastUp = {};
  for (const sit of (row && row.sits) || []) {
    if (!sit || !sit.id || !sit.out) continue;
    const t = Date.parse(sit.out) || 0;
    if (t > (lastUp[sit.id] || 0)) lastUp[sit.id] = t;
  }

  return ((row && row.line) || [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && p.id && !out.has(p.id) && (p.status || "waiting") === "waiting")
    .sort((a, b) => {
      const A = lastUp[a.p.id] || 0, B = lastUp[b.p.id] || 0;
      if (!A !== !B) return A ? 1 : -1;      // nobody who has sat outranks somebody who has not
      return (A - B) || (a.i - b.i);         // then longest since they got up, then the line
    })
    .map(({ p }) => p);
}

/** The offer standing on a seat, or null. A round that ran out of takers is
    kept — `id` null — so the seat is not offered to the same people again on
    the next tick; it is simply open to anybody. */
export const offerOf = (row, station) => ((row && row.offers) || {})[String(station)] || null;

/** Milliseconds left on an offer, or 0 for one that is spent or empty. */
export function offerLeftMs(offer, now = Date.now()) {
  if (!offer || !offer.id || !offer.until) return 0;
  return Math.max(0, new Date(offer.until).getTime() - now);
}

/* Whoever is next for this seat, given who has already had their turn in this
   round and who is holding an offer somewhere else. One offer per person: two
   chairs promised to one body is how a room ends up with an empty seat that
   everybody believes is spoken for. */
function nextFor(row, station, passed, offers) {
  const spoken = new Set();
  for (const [n, o] of Object.entries(offers || {})) {
    if (n !== String(station) && o && o.id) spoken.add(o.id);
  }
  return waitingFor(row, { skip: [...passed, ...spoken] })[0] || null;
}

/**
 * Bring the offers up to date with the clock.
 *
 * Pure and idempotent on purpose: every phone looking at the board calls this,
 * and it has to return changed:false when nothing has actually moved or the
 * row would be rewritten on every tick by every device. The test that matters
 * is the quiet one — a board left open all afternoon writes nothing.
 *
 * The comparison is structural rather than clever. At the instant an offer
 * expires two devices can both roll it and write near-identical rows; they
 * then read each other's offer, find it live, and settle. A couple of extra
 * writes at the moment of an expiry is the honest cost of not needing a
 * server to hold the clock.
 */
export function rollOffers(row, plan, now = Date.now(), { skip = [], offerMs = OFFER_MS } = {}) {
  const nowIso = new Date(now).toISOString();
  const cur = (row && row.offers) || {};
  const seats = stationBoard(plan, row);
  const offers = {};

  for (const seat of seats) {
    if (seat.taken) continue;                  // an occupied seat has nothing to offer
    const was = cur[seat.n] || null;
    const passed = new Set((was && was.passed) || []);

    /* A live offer stands. It also ends early when the person it names is no
       longer available — gone to lunch, taken a different chair, left the line
       — because a promise to somebody who is not there holds the seat empty.
       That is not counted as passing: if they come back they are eligible
       again, they simply do not hold this offer while they are gone. */
    if (was && was.id && offerLeftMs(was, now) > 0) {
      const still = waitingFor(row, { skip }).some((p) => p.id === was.id);
      if (still) { offers[seat.n] = was; continue; }
    } else if (was && was.id) {
      passed.add(was.id);                      // their few minutes ran out
    }

    const who = nextFor(row, seat.n, [...passed, ...skip], offers);
    if (who) {
      offers[seat.n] = { id: who.id, label: who.label || "", at: nowIso,
        until: new Date(now + offerMs).toISOString(), passed: [...passed] };
    } else if (was) {
      /* Nobody left to ask, but this round did have somebody. It is kept
         rather than cleared so the same people are not offered it again a
         second later; the seat is open to anyone until somebody sits in it. */
      offers[seat.n] = { id: null, at: was.at || nowIso, passed: [...passed] };
    }
    /* An empty room with an empty line gets no round at all. Writing one would
       put an offers object on the row of every store that never opens this
       screen, for a seat nobody has ever asked for. */
  }

  if (JSON.stringify(cur) === JSON.stringify(offers)) return { row, changed: false };
  const next = clone(row);
  next.offers = offers;
  return { row: next, changed: true };
}

/**
 * The person the seat was offered to takes it.
 *
 * Refuses a seat offered to somebody else, which is the whole point of an
 * offer — the desk can still seat anybody through claimStation, but a claim
 * arriving from a phone or a tag has to wait its turn.
 */
export function takeOffer(row, station, person, now) {
  const n = String(station == null ? "" : station);
  const offer = offerOf(row, n);
  if (!person || !person.id) return { row, changed: false, why: "no person" };
  if (offer && offer.id && offer.id !== person.id && offerLeftMs(offer, Date.parse(now) || Date.now()) > 0) {
    return { row, changed: false, why: "offered" };
  }
  const res = claimStation(row, n, person, now);
  if (!res.changed) return res;
  /* How they came by the chair, stamped on the sit while it is known. Phase
     six asks whether the rotation actually staffed the room, and a sit that
     does not say where it came from cannot answer. */
  const sit = (res.row.sits || []).find((s) => s && s.id === person.id && !s.out);
  if (sit) sit.via = offer && offer.id === person.id ? "line" : "self";
  return res;
}

/**
 * The desk says not this person, with a reason.
 *
 * Mirrors the skip the line already has for a call: it needs a name and a
 * reason, it is written into the day's history where the timeline reads it,
 * and it costs the person nothing but this round of this chair.
 */
export function skipOffer(row, station, now, { by = "the desk", why = "" } = {}) {
  const n = String(station == null ? "" : station);
  const offer = offerOf(row, n);
  if (!offer || !offer.id) return { row, changed: false, why: "nothing offered" };

  const next = clone(row);
  next.offers = next.offers || {};
  next.offers[n] = { ...offer, id: null, until: null,
    passed: [...new Set([...(offer.passed || []), offer.id])] };
  next.history = next.history || [];
  next.history.push({ t: now, action: "station-skipped", id: offer.id, who: offer.label || "",
    by, reason: why || null, station: n });
  return { row: next, changed: true, id: offer.id };
}

/**
 * What the board draws beside the map: the seats, and the line behind them.
 *
 * Somebody holding an offer is waiting, but they are not waiting for the NEXT
 * seat — theirs is on the map with their name on it. Drawing them in both
 * places at once reads as two different facts about one person, so the two
 * lists are separated here rather than in the screen:
 *
 *   waiting   everybody who could take a seat
 *   queued    those without a chair already offered to them
 *   next      whoever the next seat to come free belongs to
 */
export function stationLine(plan, row, { now = Date.now(), onLot = {}, holdMs = HOLD_MS, skip = [] } = {}) {
  const spoken = new Set();
  const seats = stationPresence(plan, row, { now, onLot, holdMs }).map((seat) => {
    const offer = offerOf(row, seat.n);
    const live = !seat.taken && offer && offer.id && offerLeftMs(offer, now) > 0;
    if (live) spoken.add(offer.id);
    return { ...seat,
      offerTo: live ? offer.id : null,
      offerLabel: live ? (offer.label || "") : "",
      offerLeftMs: live ? offerLeftMs(offer, now) : 0 };
  });
  const waiting = waitingFor(row, { skip });
  const queued = waiting.filter((p) => !spoken.has(p.id));
  return { seats, waiting, queued, next: queued[0] || null,
    free: seats.filter((s) => !s.taken).length,
    full: seats.length > 0 && seats.every((s) => s.taken) };
}

/**
 * The same room, drawn to fill its box.
 *
 * A plan is authored for a desk, where a wide short room and a tall empty band
 * underneath it cost nothing. On a phone that band is a third of the screen
 * showing nothing, because the map IS the screen there.
 *
 * So the vertical coordinates are stretched until the lowest seat, plus room
 * for the chip that sits on it, reaches the bottom. Everything scales by the
 * one factor — seats, zones, doors — so the room keeps its shape and the walls
 * still fall where the seats say they should. Horizontal is left alone: width
 * is the axis a phone is short of, and stretching it would put the seats
 * through the walls.
 *
 * Never shrinks. A plan whose seats already reach the floor of the box is
 * handed back untouched, which is also what happens to a plan with no seats on
 * it at all.
 */
export function tightenPlan(plan, { pad = 14 } = {}) {
  const seats = seatsOf(plan);
  if (!plan || !seats.length) return plan;
  const low = Math.max(...seats.map((s) => Number(s.y) || 0));
  const bottom = low + pad;
  if (!(bottom > 0) || bottom >= 100) return plan;
  const k = 100 / bottom;
  const up = (v) => Math.min(100, Math.round((Number(v) || 0) * k * 10) / 10);
  const key = plan.seats ? "seats" : "tables";
  const out = { ...plan, [key]: seats.map((s) => ({ ...s, y: up(s.y) })) };
  if (plan.seats && plan.tables) delete out.tables;
  if (Array.isArray(plan.zones)) {
    out.zones = plan.zones.map((z) => {
      const y = up(z.y);
      return { ...z, y, h: Math.min(100 - y, up(z.h)) };
    });
  }
  for (const k2 of ["doors", "cars"]) {
    if (Array.isArray(plan[k2])) out[k2] = plan[k2].map((d) => ({ ...d, y: up(d.y) }));
  }
  if (plan.door) out.door = { ...plan.door, y: up(plan.door.y) };
  return out;
}

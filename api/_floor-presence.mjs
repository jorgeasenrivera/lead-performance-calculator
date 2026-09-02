/**
 * Leaving the lot while you are in line.
 * -------------------------------------------------------------------------
 * Three things happen on a floor and they look identical from the outside:
 *
 *   somebody goes to lunch and forgets to sign out
 *   somebody takes a customer on a test drive and forgets to check them in
 *   somebody takes a customer on a test drive and stays in line ON PURPOSE
 *
 * Only the third is a problem, and nothing observable tells it apart from the
 * second in the moment. So the app does not try to. It asks, it acts on the
 * answer, and it writes down what was claimed — and later, when the day's record
 * exists, it checks whether the claim was borne out.
 *
 * ---- Passed over, not removed ----
 * Somebody off the lot keeps their place in the line. They are skipped for a
 * customer they could not physically take, and they get their turn when they are
 * back. Removing them would make an honest test drive cost a salesperson their
 * position, which turns the feature into something to be avoided rather than
 * something to be used.
 *
 * ---- The mark is a fact, not a verdict ----
 * "Claimed a test drive, no customer on the record that day" is a fact. It is
 * also what a dead battery, a lost signal or a genuinely forgotten check-in
 * looks like. So the flag is raised UNVERIFIED and a manager upholds or excuses
 * it. If a phone going flat could brand somebody dishonest by itself, the first
 * false accusation would cost more trust than the feature could ever earn back.
 */

export const AWAY_REASONS = ["customer", "lunch", "away"];

/** A person's presence record for the day, as it is stored. No coordinates. */
export const emptyPresence = () => ({ events: [], state: {} });

/**
 * They have just been confirmed off the lot. What the app does now.
 *
 * Returns the event to record and whether to prompt. Passing over is not decided
 * here — it happens when the grace runs out, so that somebody who answers in
 * twenty seconds is never skipped at all.
 */
export function onLeft({ personId, label, at, inLine, status }) {
  if (!personId) return null;
  return {
    id: `${personId}:${at}`,
    personId, label: label || "",
    at,
    kind: "left",
    /* Whether they were in the running when they left is the only reason any of
       this matters. Somebody off the clock walking to their car is nobody's
       business, and no event is worth raising for them. */
    inLine: !!inLine,
    statusWhenLeft: status || "waiting",
    asked: !!inLine && status === "waiting",
    answered: null,
    answeredAt: null,
    passedOverAt: null,
    resolved: false,
  };
}

/**
 * Scheduled off, asked twice whether they were working, said no twice, and the
 * day's report showed activity anyway. The phone records the facts it saw; a
 * manager reads them beside the other flags and draws the conclusion.
 */
export function onOffDayWorked({ personId, label, at, activity }) {
  if (!personId) return null;
  return { id: `${personId}:off:${at}`, personId, label: label || "", at, kind: "offday",
    activity: activity || {}, resolved: false };
}

/** They answered the prompt. One tap, and it sets their real status too. */
export function answerLeft(event, reason, at) {
  if (!event || !AWAY_REASONS.includes(reason)) return event;
  return { ...event, answered: reason, answeredAt: at };
}

/**
 * Events that have gone unanswered long enough to act on.
 * The grace is generous on purpose: somebody driving a customer is not going to
 * reach for their phone, and that is the behaviour we want from them.
 */
export function dueToPassOver(presence, now, graceMs = 5 * 60 * 1000) {
  return (presence.events || []).filter((e) =>
    e.kind === "left" && e.asked && !e.answered && !e.passedOverAt && now - e.at >= graceMs);
}

/** Back on the lot: the skip ends, and an unanswered prompt stops mattering. */
export function onReturned({ personId, label, at }) {
  return { id: `${personId}:${at}`, personId, label: label || "", at, kind: "returned" };
}

/**
 * Who should be skipped for the next customer right now.
 *
 * Off the lot and in line, from the moment they were confirmed gone until they
 * are confirmed back. Deliberately independent of whether they answered: a
 * salesperson who said "test drive" still cannot take the next one.
 */
export function skipSet(presence, now) {
  const out = new Set();
  const last = new Map();
  for (const e of presence.events || []) {
    if (e.kind !== "left" && e.kind !== "returned") continue;
    const prev = last.get(e.personId);
    if (!prev || e.at >= prev.at) last.set(e.personId, e);
  }
  for (const [id, e] of last) if (e.kind === "left" && e.inLine) out.add(id);
  return out;
}

/**
 * The reckoning, run once the day is done.
 *
 * Two independent records can back a claim up, and it takes only one:
 *
 *   customerActions  the day's queue history filtered to the customer flag —
 *                    somebody marking themselves with a customer at the time
 *
 *   visits           the Visit column on the daily activity report, which is the
 *                    count of customers that person was credited with seeing
 *
 * The second matters more than it looks. DriveCentric's deal notification names
 * the PRIMARY salesperson and nobody else, so a second salesperson who checked
 * the customer in leaves no trace in any notification we receive — the Visit
 * column is the only place their up shows up at all. Reconciling on the queue
 * history alone would flag a co-sold walk-in as an unbacked claim, which is the
 * exact honest case this is not supposed to punish.
 *
 * A claim with nothing behind it in EITHER record is what a manager is asked to
 * look at. Everything else is left alone.
 */
export function reconcile(presence, customerActions, opts = {}) {
  const windowMs = opts.windowMs ?? 4 * 60 * 60 * 1000;   // a check-in either side of the trip
  const hadCustomer = new Map();
  for (const a of customerActions || []) {
    if (!a || !a.id || !a.t) continue;
    const t = typeof a.t === "number" ? a.t : Date.parse(a.t);
    if (!Number.isFinite(t)) continue;
    if (!hadCustomer.has(a.id)) hadCustomer.set(a.id, []);
    hadCustomer.get(a.id).push(t);
  }

  const flags = [];
  for (const e of presence.events || []) {
    if (e.kind === "offday") {
      const a = e.activity || {};
      const bits = [a.calls ? `${a.calls} calls` : "", a.video ? `${a.video} videos` : "", a.units ? `${a.units} units` : ""].filter(Boolean);
      flags.push({
        id: e.id, personId: e.personId, label: e.label, at: e.at, claimed: "off",
        reason: `Scheduled off, said twice they were not working, and the day's report showed ${bits.length ? bits.join(", ") : "activity"} anyway.`,
        status: "unverified",
      });
      continue;
    }
    if (e.kind !== "left" || !e.inLine) continue;

    /* Somebody who said they were at lunch, or away, has claimed nothing that
       the day's record could contradict. They were passed over, which is the
       whole of what was owed. */
    const claimedCustomer = e.answered === "customer";
    const saidNothing = e.asked && !e.answered;
    if (!claimedCustomer && !saidNothing) continue;

    const times = hadCustomer.get(e.personId) || [];
    const backedByQueue = times.some((t) => Math.abs(t - e.at) <= windowMs);
    /* A visit is a whole-day figure with no clock on it, so it cannot be matched
       to the hour the person left — which is the right amount of doubt to give
       somebody. If the report credits them with seeing anybody that day, the
       claim stands. */
    const visits = (opts.visits && opts.visits[e.personId]) || 0;
    if (backedByQueue || visits > 0) continue;

    flags.push({
      id: e.id,
      personId: e.personId,
      label: e.label,
      at: e.at,
      claimed: e.answered || null,
      /* The wording a manager reads. It states what happened and stops there —
         the conclusion is theirs to draw, and they know things this does not. */
      reason: claimedCustomer
        ? "Left the lot in line, said it was a customer, and neither the line nor the day's visit count shows one."
        : "Left the lot in line and never answered, and neither the line nor the day's visit count shows a customer.",
      status: "unverified",
    });
  }
  return flags;
}

/**
 * A manager's judgement on one flag. Upheld sticks to the record; excused does
 * not — and the excuse is kept, because next month somebody will ask why.
 */
export function judge(flag, verdict, by, at, note = "") {
  if (!flag || (verdict !== "upheld" && verdict !== "excused")) return flag;
  return { ...flag, status: verdict, judgedBy: by || "", judgedAt: at, note };
}

/** What actually counts against somebody: upheld flags, and nothing else. */
export function upheldFor(flags, personId) {
  return (flags || []).filter((f) => f.personId === personId && f.status === "upheld");
}

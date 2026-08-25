/**
 * What the queue changing means for the people in it.
 * -------------------------------------------------------------------------
 * The one piece of this that has to be exactly right, and the one piece that
 * can be checked without a phone, a certificate or an Apple account: given the
 * queue row as it was and as it now is, who should be told what.
 *
 * It is deliberately pure — no network, no database, no clock beyond what it is
 * handed — because everything else here is plumbing around this decision, and a
 * mistake here means either a salesperson standing around waiting for a customer
 * nobody told them about, or a phone buzzing in somebody's pocket for a customer
 * that was never theirs. The second is worse: it teaches the floor to ignore it.
 *
 * The rules are read off the app, not invented here. A person is up when their
 * own status is "waiting" and nobody ahead of them in the line is also waiting —
 * people at lunch, away, or already with a customer are passed over rather than
 * counted (see `availableAhead` in the queue screen). If those rules ever change
 * in the app, they change here, and the tests should fail loudly.
 */

/** Everyone's standing in one line, keyed by person id. */
export function standings(line) {
  const out = new Map();
  const list = Array.isArray(line) ? line : [];
  let waitingAhead = 0;
  for (const p of list) {
    if (!p || !p.id) continue;
    out.set(p.id, {
      id: p.id,
      label: p.label || "",
      status: p.status || "waiting",
      ahead: waitingAhead,
      // Up means: waiting, with nobody waiting in front. Exactly the app's rule.
      up: (p.status || "waiting") === "waiting" && waitingAhead === 0,
      // When the desk last asked for them, if it has.
      nudgedAt: p.nudgedAt || null,
    });
    if ((p.status || "waiting") === "waiting") waitingAhead++;
  }
  return out;
}

/**
 * The notifications one change should produce.
 *
 * kinds:
 *   "up"       — buzz them. They are next and were not before.
 *   "nudge"    — buzz them. A manager asked for them by name.
 *   "position" — no alert; the Live Activity / ongoing notification moves.
 *   "end"      — take the standing display away; they are out of the running.
 */
export function decide(before, after, opts = {}) {
  const was = standings(before && before.line);
  const now = standings(after && after.line);
  const out = [];

  for (const [id, s] of now) {
    const w = was.get(id);

    /* A manager asked for this person by name. It outranks everything else in
       this loop, including being up: if the desk is calling for somebody who is
       with a customer or at lunch, that IS the message, and their place in the
       line can be said quietly afterwards.

       The test is that the stamp CHANGED. A nudge that is merely still on the
       row would fire again on every unrelated write to the line, which on a busy
       floor is every few seconds, and a phone that buzzes every few seconds is a
       phone that gets put face down. */
    if (s.nudgedAt && (!w || w.nudgedAt !== s.nudgedAt)) {
      out.push({ id, kind: "nudge", label: s.label, ahead: s.ahead, status: s.status,
                 title: opts.nudgeTitle || "The desk is asking for you",
                 body: opts.nudgeBody || "Head back to the floor." });
      continue;
    }

    if (s.up && (!w || !w.up)) {
      /* The moment worth interrupting somebody for. Everything else on this
         screen can wait for them to look; this cannot. */
      out.push({ id, kind: "up", label: s.label, ahead: 0, status: s.status,
                 title: "You're up", body: opts.upBody || "Head to the door. The next one is yours." });
      continue;
    }

    /* Off the waiting list — with a customer, at lunch, away. The standing
       display is about a place in a line they are no longer standing in. */
    if (s.status !== "waiting") {
      if (!w || w.status === "waiting") out.push({ id, kind: "end", label: s.label, status: s.status });
      continue;
    }

    // Still waiting, and their place moved. Quiet update, no buzz.
    if (!w || w.ahead !== s.ahead || w.status !== s.status) {
      out.push({ id, kind: "position", label: s.label, ahead: s.ahead, status: s.status });
    }
  }

  /* Gone from the line entirely — signed out, or the day rolled over. Their
     display has to be taken down or it sits on the lock screen all evening
     showing a queue they left. */
  for (const [id, w] of was) {
    if (!now.has(id)) out.push({ id, kind: "end", label: w.label, status: "gone" });
  }

  return out;
}

/** What a standing display should read at this moment. */
export function contentState(s, extra = {}) {
  return {
    ahead: s.ahead,
    up: !!s.up,
    status: s.status,
    label: s.label,
    ...extra,
  };
}

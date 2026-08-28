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

/* =========================================================================
   FlyBy assists. A salesperson at a table asks the floor for a manager, and
   the ask rides in the same per-day floor row the queue lives in, so the same
   webhook sees it. This works out who a change in that list is worth
   interrupting: a NEW ask goes to the managers the board stamped onto the row
   (assistTargets); a CLAIM goes back to the one person waiting on it; an
   ESCALATION re-pings the managers, because two silent minutes on a T.O. is
   the floor failing somebody in front of a customer.
   Pure on purpose: the webhook calls it, and the tests can too.
   ========================================================================== */
export function assistWhere(x) {
  if (x.spot === "lot") return "out on the lot";
  if (x.table != null && x.table !== "") return (String(x.table).startsWith("O") ? "office " + String(x.table).slice(1) : "table " + x.table);
  return "on the floor";
}
export function assistPlan(before, after) {
  const b = (before && before.assists) || [];
  const a = (after && after.assists) || [];
  const targets = (after && after.assistTargets) || [];
  const was = new Map(b.map((x) => [x.id, x]));
  const out = [];
  for (const x of a) {
    if (!x || !x.id) continue;
    const prev = was.get(x.id);
    const label = x.kind === "to" ? "T.O." : "FlyBy";
    const where = assistWhere(x);
    if (!prev && !x.doneAt && !x.claimedBy) {
      for (const id of targets) {
        if (id === x.byId) continue;   // a manager asking for help is not told about their own ask
        out.push({ id, kind: "nudge", label: x.byName || "",
          title: `${label} · ${x.byName || "the floor"}`,
          body: `Asking at ${where}${x.note ? ` · ${x.note}` : ""}` });
      }
      continue;
    }
    if (prev && !prev.claimedBy && x.claimedBy && !x.doneAt && x.byId) {
      out.push({ id: x.byId, kind: "nudge", label: x.byName || "",
        title: `${x.claimedBy} is on the way`,
        body: `Your ${label} at ${where} was picked up.` });
      continue;
    }
    if (prev && !prev.escalatedAt && x.escalatedAt && !x.claimedBy && !x.doneAt) {
      const mins = Math.max(1, Math.round((new Date(x.escalatedAt) - new Date(x.t)) / 60000));
      for (const id of targets) {
        out.push({ id, kind: "nudge", label: x.byName || "",
          title: `Still waiting · ${label} at ${where}`,
          body: `${x.byName || "Someone"} has been waiting ${mins} minute${mins === 1 ? "" : "s"}. Nobody has claimed it.` });
      }
    }
  }
  return out;
}

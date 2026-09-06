/**
 * A button pressed on the lock screen, applied to the floor row.
 * -------------------------------------------------------------------------
 * The Live Activity's buttons cannot reach the page's session, so they come
 * here, and this has to do exactly what the page's own buttons do to the row:
 * same statuses, same history events, same shape of an ask. Pure on purpose,
 * so the tests can hold it against the page's behaviour.
 *
 * actions:
 *   lunch, away   step off the line for now
 *   back, done    back in the line, waiting
 *   take          the up is yours: with a customer
 *   pass          decline the up: to the back of the line, logged as a decline
 *   fly, to       an ask for a manager, from wherever you are
 *   ack           you saw the desk's nudge
 */
export const QUEUE_ACTIONS = ["lunch", "away", "back", "done", "take", "pass", "fly", "to", "ack", "leave"];

export function applyQueueAction(row, personId, action, now, opts = {}) {
  if (!QUEUE_ACTIONS.includes(action)) return { row, changed: false, why: "unknown action" };
  if (!row || !Array.isArray(row.line)) return { row, changed: false, why: "no line" };
  const next = JSON.parse(JSON.stringify(row));
  next.history = next.history || [];
  const idx = next.line.findIndex((x) => x && x.id === personId);
  if (idx < 0) return { row, changed: false, why: "not in line" };
  const p = next.line[idx];
  const who = p.label || opts.label || "";

  if (action === "lunch" || action === "away") {
    p.awayReason = action; p.status = action; p.statusAt = now;
    next.history.push({ t: now, action, id: personId, who, by: "self" });
  } else if (action === "back" || action === "done") {
    const from = p.awayReason || (p.status !== "waiting" ? p.status : null);
    next.history.push({ t: now, action: "back", from, id: personId, who, by: "self" });
    p.awayReason = null; p.status = "waiting"; p.statusAt = now;
  } else if (action === "take") {
    p.awayReason = "customer"; p.status = "customer"; p.statusAt = now;
    next.history.push({ t: now, action: "customer", id: personId, who, by: "self" });
  } else if (action === "pass") {
    next.history.push({ t: now, action: "declined", id: personId, who, by: "self" });
    next.line.splice(idx, 1);
    next.line.push({ ...p, movedAt: now });
  } else if (action === "fly" || action === "to") {
    const ask = { id: opts.askId || ("a" + now.replace(/\D/g, "").slice(-9) + Math.random().toString(36).slice(2, 6)),
      t: now, kind: action, byId: personId, byName: opts.name || who, table: p.table != null ? p.table : null, spot: "floor", note: null };
    next.assists = [ask, ...((next.assists || []).filter((a) => !(a.byId === personId && !a.doneAt)))].slice(0, 40);
  } else if (action === "leave") {
    /* Off the floor for the day, the same event the page writes from its
       Good night button. Reached from the "done for the day" notification
       when the phone has left the lot.

       The desk's checkout list is how a manager sees who has gone home, so
       leaving this way files one too. The day's numbers are not here to put in
       it, so it is marked partial and the page fills them in the next time it
       is opened; a stub with the right name and time beats a missing line. */
    next.line.splice(idx, 1);
    next.history.push({ t: now, action: "left", id: personId, who, by: "self", from: "lock-screen" });
    next.checkouts = (next.checkouts || []).filter((c) => c && c.id !== personId);
    next.checkouts.push({ id: personId, who, name: opts.name || who, t: now, partial: true });
    return { row: next, changed: true, status: "gone" };
  } else if (action === "ack") {
    if (!p.nudgedAt) return { row, changed: false, why: "nothing to acknowledge" };
    p.nudgedAt = null;
    next.history.push({ t: now, action: "on-my-way", id: personId, who, by: "self" });
  }
  return { row: next, changed: true, status: next.line.find((x) => x.id === personId)?.status || "waiting" };
}

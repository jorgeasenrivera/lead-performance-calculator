/* Cleanup for the strict browser cases, as a small pure module so it can be tested with fakes and no browser.
 *
 * One close, once: every caller (the end of the run, the deadline) gets the same promise, so the kit and the app server are each closed at most once. The result says in fixed words
 * whether cleanup COMPLETED and whether it was OK. A required close that throws, runs out of time, or was never attempted is not ok, and the caller must exit non-zero.
 * It reads no output of either close: only that it resolved, threw, or timed out.
 */
export const CLEANUP_REASONS = Object.freeze(["kit-close-threw", "kit-close-timeout", "server-close-threw", "server-close-timeout"]);

const withTimeout = (promise, ms, timeoutReason) => new Promise((resolve) => {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: false, reason: timeoutReason }); } }, ms);
  Promise.resolve(promise).then(
    () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: true }); } },
    () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, reason: timeoutReason.replace("-timeout", "-threw") }); } },
  );
});

/* closeKit may be null when the kit never launched (nothing to close); closeServer is required. */
export function createCleanup({ closeKit, closeServer, timeoutMs = 15000 }) {
  if (typeof closeServer !== "function") throw new Error("createCleanup needs closeServer");
  let closing = null;
  const outcome = { attempted: false, completed: false, ok: false, kitClosed: closeKit ? false : null, serverClosed: false, reasons: [] };
  const close = () => {
    if (closing) return closing;
    outcome.attempted = true;
    closing = (async () => {
      if (closeKit) {
        let r;
        try { r = await withTimeout(Promise.resolve().then(closeKit), timeoutMs, "kit-close-timeout"); } catch (e) { r = { ok: false, reason: "kit-close-threw" }; }
        outcome.kitClosed = r.ok; if (!r.ok) outcome.reasons.push(r.reason);
      }
      let s;
      try { s = await withTimeout(Promise.resolve().then(closeServer), timeoutMs, "server-close-timeout"); } catch (e) { s = { ok: false, reason: "server-close-threw" }; }
      outcome.serverClosed = s.ok; if (!s.ok) outcome.reasons.push(s.reason);
      outcome.completed = true;
      outcome.ok = outcome.reasons.length === 0;
      return snapshot();
    })();
    return closing;
  };
  const snapshot = () => ({ attempted: outcome.attempted, completed: outcome.completed, ok: outcome.ok, kitClosed: outcome.kitClosed, serverClosed: outcome.serverClosed, reasons: [...outcome.reasons] });
  return { close, outcome: snapshot };
}

/* The run may only report cleanup as fine when it completed and was ok. Anything else (not attempted, still pending, failed) is a failed run. */
export const cleanupFailed = (o) => !(o && o.attempted === true && o.completed === true && o.ok === true);

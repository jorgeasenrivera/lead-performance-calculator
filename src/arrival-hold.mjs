/* The identity rules of one sign-in arrival attempt (the "hold"), as a pure object so every ordering can be tested without a browser.
 *
 * An attempt belongs to ONE press. It is bound to ONE auth subject, and the history of subjects it has seen is an ORDERED sequence, not a set.
 *   normal attempt:  before acceptance the history must read  baseline+ then U+  (consecutive repeats collapse, nothing else does). The first subject that is not the baseline is
 *                    the only one allowed from then on; a return to the baseline, or any other subject, kills the attempt for good. Acceptance needs the sign-in RESPONSE user id
 *                    and the live subject to agree, and the history to be consistent with it. After acceptance only the bound subject is allowed; anything else kills.
 *   custom attempt:  (the recovery save) it has no sign-in response; its subject is the known recovery subject at the press and never changes. No known subject means dead at once.
 * Dead is permanent: nothing revives an attempt. A new press makes a new attempt.
 * The profile is never an input here; callers must not feed one in.
 */
const subj = (v) => (typeof v === "string" && v ? v : null);

export function createHoldAttempt({ baseline = null, custom = false } = {}) {
  const b = subj(baseline);
  let dead = custom === true && b === null;
  let accepted = custom === true && !dead;
  let bound = accepted ? b : null;
  let moved;                  // normal, before acceptance: the first subject that is not the baseline, or undefined while only the baseline has been seen
  let last = b;
  const history = [b];
  return {
    observe(v) {
      const s = subj(v);
      if (dead) return false;
      if (s === last) return true;               // consecutive repeats only
      last = s; history.push(s);
      if (accepted) { if (s !== bound) dead = true; return !dead; }
      if (moved === undefined) { if (s !== b) moved = s; return true; }
      if (s !== moved) dead = true;              // a return to the baseline, or another subject, after leaving it
      return !dead;
    },
    accept(userId, live) {
      if (dead || accepted || custom === true) return false;
      const u = subj(userId), l = subj(live);
      const consistent = moved === undefined ? u === b : u === moved;
      if (u === null || l !== u || !consistent) { dead = true; return false; }
      accepted = true; bound = u; return true;
    },
    canHandOver(live) { return !dead && accepted && subj(live) === bound; },
    kill() { dead = true; },
    isDead() { return dead; },
    isAccepted() { return accepted && !dead; },
    subject() { return bound; },
    history() { return history.slice(); },
  };
}

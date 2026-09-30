/* C97, the review of 30 September: a reset link may choose a new password only
   for the account it was sent to. The lifecycle, run against the real guard with
   a fake Supabase that says what auth-js 2.112.3 says (read from its source:
   a callback that fails to validate leaves the stored session alone and sends no
   PASSWORD_RECOVERY; a good one sends it, with the session it made, a tick after
   reading the link). The app's side is checked in password-reset.test.mjs; the
   real-browser run, with a counted PUT /user, is scripts/recovery-probe.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecoveryHash } from "../src/recovery-link.mjs";
import { createRecoveryGuard, LINK_FAILED_NOTICE, PENDING_LIMIT_MS } from "../src/recovery-session.mjs";

const A = { user: { id: "user-a" } }, B = { user: { id: "user-b" } };
/* A timer we wind by hand, so "Supabase never said yes" is tested without waiting. */
const clock = () => { let fn = null; return { setTimer: (f) => { fn = f; return 1; }, clearTimer: () => { fn = null; }, fire: () => { const f = fn; fn = null; if (f) f(); }, armed: () => fn != null }; };
/* What the app does: the guard starts from the address, then hears Supabase. */
const load = (hash) => { const c = clock(); const g = createRecoveryGuard(readRecoveryHash(hash), { setTimer: c.setTimer, clearTimer: c.clearTimer }); return { g, c }; };
const GOOD = "#access_token=t&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery";

test("a good link: pending from the address, ready only when Supabase says so, for the user it named", () => {
  const { g, c } = load(GOOD);
  assert.equal(g.snapshot().status, "pending");
  assert.equal(g.canSave("user-a"), false, "the address alone saves nothing");
  g.onAuthEvent("INITIAL_SESSION", null);
  assert.equal(g.snapshot().status, "pending");
  g.onAuthEvent("PASSWORD_RECOVERY", A);
  assert.deepEqual(g.snapshot(), { status: "ready", userId: "user-a" });
  assert.equal(c.armed(), false, "the wait is over");
  assert.equal(g.canSave("user-a"), true);
});

test("the review's case: session B stored, a broken callback meant for A, no PASSWORD_RECOVERY: never ready, never saves for B", () => {
  /* auth-js returns the error and keeps B. Invalid tokens, 401 from the user check. */
  const { g, c } = load(GOOD);
  g.onAuthEvent("INITIAL_SESSION", B);
  assert.equal(g.canSave("user-b"), false, "B is signed in, and the link proved nothing");
  c.fire();                                        // Supabase never answered yes
  assert.equal(g.snapshot().status, "failed");
  assert.equal(g.canSave("user-b"), false);
});

test("Supabase finished reading the address and never said yes: settle fails it now, and only a pending one", () => {
  const { g, c } = load(GOOD);
  g.settle();
  assert.equal(g.snapshot().status, "failed");
  assert.equal(c.armed(), false);
  const ready = load(GOOD).g; ready.onAuthEvent("PASSWORD_RECOVERY", A); ready.settle();
  assert.equal(ready.snapshot().status, "ready", "a link it did confirm is left alone");
  const none = load("").g; none.settle();
  assert.equal(none.snapshot().status, "idle");
});

test("a bare type=recovery (a cut link), and an error that also says recovery, are not links", () => {
  for (const hash of ["#type=recovery", "#type=recovery&access_token=x", "#type=recovery&error_code=otp_expired&error=access_denied"]) {
    const { g } = load(hash);
    assert.equal(g.snapshot().status, "failed", hash);
    g.onAuthEvent("INITIAL_SESSION", B);
    assert.equal(g.canSave("user-b"), false, hash + ": with B signed in");
  }
});

test("an expired link with B signed in still says so, and saves nothing", () => {
  const { g } = load("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  g.onAuthEvent("INITIAL_SESSION", B);
  assert.equal(g.snapshot().status, "failed", "the card has something to show (P2)");
  assert.equal(g.canSave("user-b"), false);
});

test("validated for A, then somebody else signs in: the binding is gone", () => {
  const { g } = load(GOOD);
  g.onAuthEvent("PASSWORD_RECOVERY", A);
  g.onAuthEvent("TOKEN_REFRESHED", A);
  g.onAuthEvent("USER_UPDATED", A);
  assert.equal(g.snapshot().status, "ready", "the same user's own events change nothing");
  g.onAuthEvent("SIGNED_IN", B);
  assert.equal(g.snapshot().status, "failed");
  assert.equal(g.canSave("user-a"), false);
  assert.equal(g.canSave("user-b"), false);
});

test("validated for A, then signed out: the binding is gone", () => {
  const { g } = load(GOOD);
  g.onAuthEvent("PASSWORD_RECOVERY", A);
  g.onAuthEvent("SIGNED_OUT", null);
  assert.equal(g.snapshot().status, "failed");
  assert.equal(g.canSave("user-a"), false);
});

test("the last check: ready for A, but the session at the moment of saving is B", () => {
  const { g } = load(GOOD);
  g.onAuthEvent("PASSWORD_RECOVERY", A);
  assert.equal(g.canSave("user-b"), false, "an event was missed, the check at the write is not");
  assert.equal(g.canSave(null), false);
  assert.equal(g.canSave(undefined), false);
  g.invalidate();
  assert.equal(g.snapshot().status, "failed", "and the caller can say so");
  assert.equal(g.canSave("user-a"), false);
});

test("a fresh good link recovers a failed one, and saving finishes it", () => {
  const { g } = load("#error_code=otp_expired");
  assert.equal(g.snapshot().status, "failed");
  g.onAuthEvent("PASSWORD_RECOVERY", A);
  assert.equal(g.canSave("user-a"), true);
  g.done();
  assert.equal(g.snapshot().status, "idle");
  assert.equal(g.canSave("user-a"), false, "one save per link");
});

test("no link: idle, and nothing in an ordinary sign-in touches it", () => {
  const { g, c } = load("");
  assert.equal(c.armed(), false);
  for (const ev of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT"]) g.onAuthEvent(ev, B);
  assert.equal(g.snapshot().status, "idle");
  assert.equal(g.canSave("user-b"), false);
});

test("subscribers hear each change once, and the wait is ten seconds", () => {
  const { g } = load(GOOD);
  const seen = []; const off = g.subscribe((s) => seen.push(s.status));
  g.onAuthEvent("PASSWORD_RECOVERY", A); g.onAuthEvent("PASSWORD_RECOVERY", A);
  g.onAuthEvent("SIGNED_OUT", null);
  off(); g.onAuthEvent("PASSWORD_RECOVERY", A);
  assert.deepEqual(seen, ["ready", "failed"]);
  assert.equal(PENDING_LIMIT_MS, 10000);
  assert.match(LINK_FAILED_NOTICE, /^That link has run out/);
});

/* C97: a reset link that works, and one that has run out. Jorge decided the
   screen on 28 September (https://claude.ai/artifact/4YRmieMrPqbXsAKT6SVfN6).
   Until then a good link signed the person in and never asked for a new
   password, and nothing in the app read the link at all. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readRecoveryHash } from "../src/recovery-link.mjs";
import { LINK_FAILED_NOTICE } from "../src/recovery-session.mjs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const owner = fs.readFileSync(new URL("../src/recovery-controller.mjs", import.meta.url), "utf8");

test("the link's answer is read from the address, good or run out", () => {
  assert.equal(readRecoveryHash("#access_token=x&expires_in=3600&refresh_token=y&token_type=bearer&type=recovery"), "recovery", "a real link's shape: intent, to be confirmed by Supabase");
  assert.equal(readRecoveryHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), "expired");
  assert.equal(readRecoveryHash("#error=access_denied&error_description=Email+link+is+invalid"), "expired");
  assert.equal(readRecoveryHash("#access_token=x&type=signup"), null, "an account confirmation is not a reset");
  /* Intent, not proof (review, 30 September): only a link with both tokens even
     starts the wait; the rest are not links Supabase would take. */
  assert.equal(readRecoveryHash("#type=recovery"), "expired", "a bare type, what an email client leaves of a cut link");
  assert.equal(readRecoveryHash("#type=recovery&access_token=x"), "expired", "no refresh token");
  assert.equal(readRecoveryHash("#type=recovery&error_code=otp_expired"), "expired", "an error wins over the type: the client takes the error and stops");
  assert.equal(readRecoveryHash("#type=recovery&error=server_error"), "expired");
  assert.equal(readRecoveryHash(""), null);
  assert.equal(readRecoveryHash(undefined), null);
});

test("it is read at load, before Supabase clears the address", () => {
  const read = app.indexOf("const recoveryIntent = (() =>");
  assert.ok(read > 0 && !/^\s/.test(app.slice(app.lastIndexOf("\n", read) + 1, read)), "module level, evaluated once as the page loads");
});

test("while a link is being answered the card stays up and the dashboard stays hidden", () => {
  assert.match(app, /const under = !WALL_SCREEN && \(!session \|\| recoveryLayer \|\| \(jumpHold && !jumpLanded\)\);/, "the TV (C99) is the one page it never covers");
  assert.match(app, /const recoveryLayer = rec\.status === "ready" \|\| rec\.status === "failed" \|\| rec\.status === "interrupted";/);
  assert.match(app, /authReady && rec\.status !== "pending" && \(!session \|\| jumpHold \|\| recoveryLayer\) \? \(/,
    "the ground, not a card that flips a moment later, while Supabase decides; and a failed link shows the card even with somebody signed in (P2)");
});

test("the form opens on Supabase's proof, from a subscription made where the client is made", () => {
  assert.ok(app.includes('const recoveryFlow = createRecoveryController({ guard: recoveryGuard, continuity: recoveryContinuity,') &&
    app.includes('supabase.auth.onAuthStateChange((ev, session) => recoveryFlow.onAuthEvent(ev, session));'),
    "module-level SDK subscription delegates to the live proof owner");
  assert.ok(app.indexOf("const recoveryGuard = ") > app.indexOf("export const supabase = "), "after the client exists");
  assert.ok(app.includes('recoveryFlow.settled(data?.session); setTimeout(() => recoveryFlow.settle(), 1500);'), "SDK settlement keeps the bounded unconfirmed-link timeout");
  assert.match(app, /resetting=\{rec\.status === "ready"\} linkFailed=\{rec\.status === "failed"\}/);
  assert.match(app, /onRecoveryDismissed=\{\(\) => recoveryFlow\.dismiss\(\)\}/, "Back leaves a failed link (P2)");
  assert.ok(!/setRecovering|recoveryAtLoad/.test(app), "nothing opens the form from the address any more");
});

test("the save is bound to the recovery's own token, never to a fresh look at the stored session (P1)", () => {
  assert.ok(app.includes('return recoveryFlow.save(password);'));
  assert.ok(owner.includes('const bound = guard.binding()') && owner.includes('if (!bound) return { error: failedNotice, lost: true };'));
  assert.ok(owner.includes('session?.user?.id !== bound.userId') && owner.includes('guard.canSave(bound.userId)'), "settled identity and live guard are checked");
  assert.ok(owner.includes('writePassword(bound.accessToken, password)'));
  assert.ok(app.includes('writePassword: (accessToken, password) => setPasswordAs({ url: SUPABASE_URL, apikey: SUPABASE_ANON_KEY, accessToken, password })'));
  assert.ok(!/auth\.updateUser\(\{[^)]*password/.test(app), "password never uses SDK updateUser session rebinding");
  assert.ok(owner.includes('if (result?.lost) { guard.invalidate(); continuity.failed(handle); emit(); }'));

});

test("Back and an ordinary sign-in both leave a failed link (P2)", () => {
  assert.match(app, /onClick=\{\(\) => \{ if \(\(linkFailed \|\| interrupted\) && onRecoveryDismissed\) onRecoveryDismissed\(\); setMode\("signin"\);/, "the existing Back action");
  assert.match(app, /if \(!custom && onRecoveryDismissed\) onRecoveryDismissed\(\);/, "an ordinary sign-in that succeeds");
});

test("saving uses Create Account's rules, then the same flight as signing in (A2)", () => {
  const save = app.slice(app.indexOf("const saveNewPassword = () =>"), app.indexOf("const saveNewPassword = () =>") + 700);
  assert.match(save, /password\.length < 8/);
  assert.match(save, /password !== password2/);
  assert.match(save, /return signIn\(\(\) => authSetPassword\(password\),/, "one arrival, not a second copy of it");
  assert.match(save, /authSetPassword\(password\)/);
  assert.match(app, /res = await \(custom \? authCall\(\) : authSignIn\(/);
  assert.ok(owner.includes("continuity.succeeded(handle);") && owner.includes("context = null; arrivalIdentity = bound.userId; guard.done(); emit();"), "accepted success releases the guard independently of storage cleanup");
});

test("an old link opens Forgot, says so, and offers this phone's last address (A3)", () => {
  assert.equal(LINK_FAILED_NOTICE, "That link has run out or was already used. Send yourself a new one.", "the words Jorge approved, in one place");
  assert.match(app, /useState\(resetting \? "reset" : \(linkFailed \|\| interrupted\) \? "forgot" : "signin"\)/);
  assert.match(app, /const \[err, setErr\] = useState\(linkFailed && !resetting \? LINK_FAILED_NOTICE : ""\);/);
  assert.match(app, /localStorage\.setItem\(RESET_EMAIL_KEY, email\)/);
});

test("the words Jorge approved (A1, A5)", () => {
  for (const s of ["Choose a new password", "At least 8 characters", "Repeat it", "Save and sign in",
    "If that email has an account, a link is on its way from no-reply@sageonline.io. Not there in a minute? Check junk."]) {
    assert.ok(app.includes(s), s);
  }
  assert.ok(!app.includes("a reset link is on its way. Check your inbox."), "the old confirmation is gone");
});

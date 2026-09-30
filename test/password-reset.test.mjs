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
  assert.match(app, /const recoveryLayer = rec\.status === "ready" \|\| rec\.status === "failed";/);
  assert.match(app, /authReady && rec\.status !== "pending" && \(!session \|\| jumpHold \|\| recoveryLayer\) \? \(/,
    "the ground, not a card that flips a moment later, while Supabase decides; and a failed link shows the card even with somebody signed in (P2)");
});

test("the form opens on Supabase's proof, from a subscription made where the client is made", () => {
  assert.match(app, /const recoveryGuard = createRecoveryGuard\(recoveryIntent\);\nif \(supabase\) \{\n  try \{\n    supabase\.auth\.onAuthStateChange\(\(ev, session\) => recoveryGuard\.onAuthEvent\(ev, session\)\);/,
    "module level: Supabase sends PASSWORD_RECOVERY a tick after reading the link, so a screen that subscribed later could miss it");
  assert.ok(app.indexOf("const recoveryGuard = ") > app.indexOf("export const supabase = "), "after the client exists");
  assert.match(app, /supabase\.auth\.getSession\(\)\.then\(\(\) => setTimeout\(\(\) => recoveryGuard\.settle\(\), 1500\)\)/, "a link Supabase has finished reading and not confirmed fails at once, not at the backstop");
  assert.match(app, /resetting=\{rec\.status === "ready"\} resetUserId=\{rec\.userId\} linkFailed=\{rec\.status === "failed"\}/);
  assert.ok(!/setRecovering|recoveryAtLoad/.test(app), "nothing opens the form from the address any more");
});

test("the save is for the user Supabase confirmed, checked at the write", () => {
  const f = app.slice(app.indexOf("async function authSetPassword("), app.indexOf("async function authSetPassword(") + 900);
  assert.match(f, /supabase\.auth\.getSession\(\)/, "asks who is signed in, now");
  assert.match(f, /if \(!expectedUserId \|\| current !== expectedUserId \|\| !recoveryGuard\.canSave\(current\)\) return \{ error: LINK_FAILED_NOTICE, lost: true \};/);
  assert.ok(f.indexOf("canSave") < f.indexOf("updateUser"), "and only then writes");
  assert.match(app, /if \(res\.lost\) recoveryGuard\.invalidate\(\);/);
});

test("saving uses Create Account's rules, then the same flight as signing in (A2)", () => {
  const save = app.slice(app.indexOf("const saveNewPassword = () =>"), app.indexOf("const saveNewPassword = () =>") + 700);
  assert.match(save, /password\.length < 8/);
  assert.match(save, /password !== password2/);
  assert.match(save, /return signIn\(async \(\) => \{/, "one arrival, not a second copy of it");
  assert.match(save, /authSetPassword\(password, resetUserId\)/);
  assert.match(app, /res = await \(custom \? authCall\(\) : authSignIn\(/);
  assert.match(app, /onPasswordSaved=\{\(\) => recoveryGuard\.done\(\)\}/, "the card lets go only once the password is saved");
});

test("an old link opens Forgot, says so, and offers this phone's last address (A3)", () => {
  assert.equal(LINK_FAILED_NOTICE, "That link has run out or was already used. Send yourself a new one.", "the words Jorge approved, in one place");
  assert.match(app, /useState\(resetting \? "reset" : linkFailed \? "forgot" : "signin"\)/);
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

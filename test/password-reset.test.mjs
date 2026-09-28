/* C97: a reset link that works, and one that has run out. Jorge decided the
   screen on 28 September (https://claude.ai/artifact/4YRmieMrPqbXsAKT6SVfN6).
   Until then a good link signed the person in and never asked for a new
   password, and nothing in the app read the link at all. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readRecoveryHash } from "../src/recovery-link.mjs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the link's answer is read from the address, good or run out", () => {
  assert.equal(readRecoveryHash("#access_token=x&expires_in=3600&refresh_token=y&token_type=bearer&type=recovery"), "recovery");
  assert.equal(readRecoveryHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), "expired");
  assert.equal(readRecoveryHash("#error=access_denied&error_description=Email+link+is+invalid"), "expired");
  assert.equal(readRecoveryHash("#access_token=x&type=signup"), null, "an account confirmation is not a reset");
  assert.equal(readRecoveryHash(""), null);
  assert.equal(readRecoveryHash(undefined), null);
});

test("it is read at load, before Supabase clears the address", () => {
  const read = app.indexOf("const recoveryAtLoad = (() =>");
  assert.ok(read > 0 && !/^\s/.test(app.slice(app.lastIndexOf("\n", read) + 1, read)), "module level, evaluated once as the page loads");
});

test("while recovering, the card stays up and the dashboard stays hidden", () => {
  assert.match(app, /const under = !WALL_SCREEN && \(!session \|\| recovering \|\| \(jumpHold && !jumpLanded\)\);/, "recovering holds the card up; the TV (C99) is the one page it never covers");
  assert.match(app, /\(!session \|\| jumpHold \|\| recovering\) \? \(/);
  assert.match(app, /ev === "PASSWORD_RECOVERY"\) setRecovering\(true\)/, "a recovery that lands after the page has loaded still counts");
});

test("saving uses Create Account's rules, then the same flight as signing in (A2)", () => {
  const save = app.slice(app.indexOf("const saveNewPassword = () =>"), app.indexOf("const saveNewPassword = () =>") + 700);
  assert.match(save, /password\.length < 8/);
  assert.match(save, /password !== password2/);
  assert.match(save, /return signIn\(async \(\) => \{/, "one arrival, not a second copy of it");
  assert.match(save, /authSetPassword\(password\)/);
  assert.match(app, /res = await \(custom \? authCall\(\) : authSignIn\(/);
  assert.match(app, /onPasswordSaved=\{\(\) => setRecovering\(false\)\}/, "the card lets go only once the password is saved");
});

test("an old link opens Forgot, says so, and offers this phone's last address (A3)", () => {
  assert.match(app, /"That link has run out or was already used\. Send yourself a new one\."/);
  assert.match(app, /useState\(resetting \? "reset" : linkExpired \? "forgot" : "signin"\)/);
  assert.match(app, /localStorage\.setItem\(RESET_EMAIL_KEY, email\)/);
});

test("the words Jorge approved (A1, A5)", () => {
  for (const s of ["Choose a new password", "At least 8 characters", "Repeat it", "Save and sign in",
    "If that email has an account, a link is on its way from no-reply@sageonline.io. Not there in a minute? Check junk."]) {
    assert.ok(app.includes(s), s);
  }
  assert.ok(!app.includes("a reset link is on its way. Check your inbox."), "the old confirmation is gone");
});

/* C91 and C90, the app's half: "Your account" opens a page with Delete my
   account at its foot, DELETE is typed, the server does the deleting; the
   admin's Delete goes through the same server step; the sign-in card links the
   privacy policy. Decided by Jorge on 23 September, built 28 September. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mgr = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sheet = app.slice(app.indexOf("function AccountSheet("), app.indexOf("function AccountSheet(") + 5000);

test("the sheet asks for DELETE typed, and the server gets the word", () => {
  assert.match(sheet, /const ready = typed\.trim\(\) === "DELETE";/);
  assert.match(sheet, /disabled=\{!ready \|\| busy\}/, "the red button waits for the word");
  assert.match(sheet, /apiCall\("\/api\/delete-account", \{ method: "POST", body: \{ confirm: "DELETE" \} \}\)/,
    "no user_id: the server takes who from the session");
  assert.match(sheet, /if \(!out \|\| out\.error\) \{ setBusy\(false\); setErr\(/, "a refusal (the last admin) is said, and nothing signs out");
  assert.match(sheet, /Stays with your store:<\/b> your name on past days and your numbers/, "it says what stays (A1 a)");
  assert.ok(!/QR/.test(sheet), "the QR sign-in is gone (C99), so the sheet does not offer it");
});

test("afterwards: signed out, and the sign-in card says it is done", () => {
  assert.match(sheet, /sessionStorage\.setItem\(DELETED_KEY, "1"\)/);
  assert.match(app, /if \(sessionStorage\.getItem\(DELETED_KEY\)\) \{ sessionStorage\.removeItem\(DELETED_KEY\); return "Your account is deleted\."; \}/);
  assert.match(app, /onDeleted=\{\(\) => \{ setAcctOpen\(false\); onSignOut\(\); \}\}/, "the phone");
  assert.match(mgr, /onDeleted=\{\(\) => \{ setAcct\(false\); onSignOut\(\); \}\}/, "the desk");
});

test("it is behind Your account on both screens, not beside Sign out (A2)", () => {
  assert.match(app, /setAcctOpen\(true\); \}\}>\n\s*<span className="ic"><PixIcon glyph="home" size=\{16\} \/><\/span>\n\s*<span>Your account</);
  assert.ok(!/The daily QR still/.test(app), "the corner no longer offers the QR");
  assert.match(mgr, /setAcct\(true\); \}\}>Your account<\/button>\n\s*<button className="bm-item" onClick=\{\(\) => \{ setOpen\(false\); onSignOut\(\); \}\}>Sign out<\/button>/);
});

test("the admin's Delete removes the login too, through the same server step (B1)", () => {
  assert.match(mgr, /apiCall\("\/api\/delete-account", \{ method: "POST", body: \{ confirm: "DELETE", user_id: u\.id \} \}\)/);
  assert.ok(!/function deleteProfile\(/.test(mgr) && !/from\("profiles"\)\.delete\(\)/.test(mgr), "nothing deletes a profile alone any more");
});

test("the sign-in card links the privacy policy (C90)", () => {
  assert.match(app, /Create New Account<\/button>\n[\s\S]{0,300}<a className="lf-privacy" href="\/privacy">Privacy<\/a>/);
});

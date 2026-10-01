/* The privacy policy promises things the code has to keep true (C90).
   Each check here ties one sentence on the page to the code that makes it
   true, so a change to either one has to meet the other. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const page = read("public/privacy.html");
const sw = read("src/sw.js");
const vercel = JSON.parse(read("vercel.json"));
const migrations = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql")).map((f) => read("supabase/migrations/" + f)).join("\n");

test("no blank is left to fill in", () => {
  /* The company's legal name is Jorge's to give. The page does not go live
     with a placeholder in it. */
  assert.equal(page.match(/\{\{[A-Z]+\}\}/g), null, "a {{BLANK}} is still on the page");
});

test("the house rules hold on the page", () => {
  assert.ok(!/[—–]/.test(page), "no em or en dashes");
  assert.ok(!/<script/i.test(page), "a plain page: nothing to run, so it opens anywhere");
});

test("the times it promises are the times the database deletes at", () => {
  const days = (fn) => {
    const m = migrations.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?interval '(\\d+) days'`));
    return m && Number(m[1]);
  };
  assert.equal(days("prune_app_errors"), 90);
  assert.equal(days("prune_app_vitals"), 30);
  assert.equal(days("prune_device_tokens"), 90);
  assert.ok(page.includes("<b>Error reports:</b> 90 days."));
  assert.ok(page.includes("<b>Speed readings:</b> 30 days."));
  assert.ok(page.includes("<b>A device's notification details:</b> 90 days after"));
});

test("the nightly store copies are kept the 30 days the page says, and the page says what that means for a deletion (C109)", () => {
  assert.match(migrations, /function public\.prune_store_backups\(\)[\s\S]*?lpc:backup:%[\s\S]*?lpc:config:backup:%[\s\S]*?interval '30 days'/,
    "the copies, and the settings taken with them, are deleted at 30 days");
  assert.match(migrations, /lpc:config:backups-index:v1[\s\S]*?interval '30 days'/, "and the list the restore screen reads is cut to match");
  assert.match(migrations, /select public\.prune_store_backups\(\);/, "by the daily job, not by somebody opening the tool");
  assert.ok(page.includes("<b>A nightly copy of each store's records, kept so a mistake can be undone:</b> 30 days, then deleted. Something deleted at your request can stay in these copies until they age out."));
});

test("where you are is never sent, and the lot check says the same", () => {
  assert.ok(page.includes("Where you are is never sent or stored."));
  assert.ok(read("api/_geofence.mjs").includes("the caller keeps\n * the verdict and throws the coordinates away"),
    "the geofence module still promises to keep only the verdict");
});

test("the page is reachable at /privacy, even on a phone that has opened Sage", () => {
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/privacy" && r.destination === "/privacy.html"));
  const pass = sw.indexOf("(privacy|support)");
  assert.ok(pass > 0 && pass < sw.indexOf('req.mode === "navigate"'),
    "the worker lets the policy through before it answers page visits with the app");
});

test("the support page: reachable, plain, and naming the app's real controls", () => {
  const support = read("public/support.html");
  const app = read("src/LeadPerformanceCalculator.jsx");
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/support" && r.destination === "/support.html"));
  assert.ok(!/[\u2014\u2013]/.test(support) && !/<script/i.test(support));
  /* It tells people what to tap, so the words have to be the ones on the
     screen: the sign-in link says "Forgot?", not "Forgot your password?". */
  assert.ok(support.includes('Tap "Forgot?"') && app.includes(">Forgot?</button>"));
  assert.ok(support.includes('"Something looks wrong"') && app.includes(">Something looks wrong<"));
  assert.ok(support.includes('href="/privacy"'));
});

test("the policy says what the app does since 28 September: no QR, and deleting from inside the app", () => {
  const html = fs.readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  assert.ok(!/QR/.test(html), "the QR sign-in is gone (C99)");
  assert.match(html, /<b>Not the camera\.<\/b> Sage never turns it on\./);
  assert.match(html, /Delete your account yourself: Your account, then Delete my account\. This removes your login, your name and email, your phone's notification details and your error reports at once\. Your store keeps its history, with your name on past days and your numbers\. Write to us to have those removed too\./);
});

/* The page says what Delete my account removes, so a test reads the function
   that does it: every kind of thing the page lists as removed is a delete in
   api/delete-account.mjs, and nothing the page says is kept is deleted there. */
test("what the page says Delete my account removes is what the function removes, and what it keeps it keeps (C110)", () => {
  const html = fs.readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  const fn = fs.readFileSync(new URL("../api/delete-account.mjs", import.meta.url), "utf8");
  assert.match(html, /<li><b>Your account:<\/b> until you delete it, and deleting it in the app removes it at once\.<\/li>/);
  assert.match(html, /<li><b>Your floor days and your numbers:<\/b> for as long as your store uses Sage, because they are the store's history\. They stay when you delete your account\. Write to us to have them removed too\.<\/li>/);
  assert.ok(!/They are deleted when you ask/.test(html), "the line that read as the opposite of the next one is gone");
  assert.match(fn, /from\("device_tokens"\)\.delete\(\)/, "the phone's notification details");
  assert.match(fn, /from\("app_errors"\)\.delete\(\)/, "the error reports");
  assert.match(fn, /db\.auth\.admin\.deleteUser\(/, "the login, which takes the profile (name, email) with it");
  assert.ok(!/from\("app_data"\)/.test(fn), "the store's floor days and numbers are not touched here, as the page says");
});

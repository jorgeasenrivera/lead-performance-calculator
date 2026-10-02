#!/usr/bin/env node
/**
 * The reset link, in a real browser, with the writes counted (C97).
 * -------------------------------------------------------------------------
 * The independent review of 30 September found that the reset form opened from
 * the address alone, and saving updated whoever was signed in. The lifecycle is
 * tested in node (test/recovery-session.test.mjs); this runs the built app
 * against the mock with Supabase's own user endpoint under this script's
 * control, so it can say what it told the app and count what the app did about
 * it: every PUT /auth/v1/user, which is the only thing that changes a password.
 *
 *   npm run build && npx vite preview --port 5178 --host 127.0.0.1 &
 *   FEEL_PLAYWRIGHT=... node scripts/recovery-probe.mjs
 *
 * Not in CI (it needs the built app and the mock, like the feel run, and it is
 * a regression for one review's finding, not a timing bar). Exit 1 if any
 * scenario does the wrong thing.
 */
import { ensureMock, launch } from "./probe-kit.mjs";

const URL_APP = process.env.FEEL_URL || "http://127.0.0.1:5178/";
const NOTICE = "That link has run out or was already used. Send yourself a new one.";
const future = () => Math.floor(Date.now() / 1000) + 3600;
const user = (id) => ({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" });
const sessionOf = (id, token) => ({ access_token: token, refresh_token: "refresh-" + id, token_type: "bearer", expires_in: 3600, expires_at: future(), user: user(id) });
/* Who Supabase would say a token belongs to. Anything else is a 401, which is
   what a token that does not check out gets. */
/* B is the mock's own user, so the app really does treat B as signed in: it has
   the profile the app looks for. (A made-up B has none, and the sign-in card
   stays up for lack of a profile, which hides exactly what P2 is about.) */
const B_ID = "00000000-0000-4000-8000-000000000001";
const WHO = { "token-a": "user-a", "token-b": B_ID };
const goodHash = (token) => `#access_token=${token}&expires_in=3600&refresh_token=refresh-a&token_type=bearer&type=recovery`;

const results = [];
const mock = await ensureMock();
const browser = await launch();

async function scenario(name, { stored = null, hash, after = null, expect }) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const puts = [];
  await page.route("**/auth/v1/user", async (route) => {
    const req = route.request();
    const auth = req.headers()["authorization"] || "";
    const token = auth.replace(/^Bearer /, "");
    if (req.method() === "PUT") { puts.push({ token, body: req.postData() }); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user(WHO[token] || "unknown")) }); }
    const id = WHO[token];
    if (!id) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user(id)) });
  });
  if (stored) await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} }, ["lpc-auth", JSON.stringify(stored)]);
  await page.goto(URL_APP + hash, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const form = () => page.getByText("Choose a new password").count();
  const notice = () => page.getByText(NOTICE).count();
  const seen = { form: await form(), notice: await notice(), card: await page.locator(".signin-over").count(), layer: await page.locator(".signin-over").count(), usable: await page.locator(".ar-bar.up").count() };
  if (after) { await after(page, puts, form, notice, seen); }
  const got = { ...seen, puts: puts.length, putTokens: puts.map((p) => p.token) };
  const fails = [];
  for (const [k, v] of Object.entries(expect)) { if (JSON.stringify(got[k]) !== JSON.stringify(v)) fails.push(`${k}: wanted ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`); }
  results.push({ name, ok: !fails.length, fails, got });
  await ctx.close();
}

const save = async (page) => {
  await page.fill('input[placeholder="At least 8 characters"]', "a-new-password-1");
  await page.fill('input[placeholder="Repeat it"]', "a-new-password-1");
  await page.click('button:has-text("Save and sign in")');
  await page.waitForTimeout(2500);
};
/* If the form is up, use it: a write is what counts, and "the form is not there"
   is only half of the claim. */
const saveIfShown = async (page, puts, form) => { if (await form()) await save(page); };
/* Leaving a failed link (the second review's P2): Back, then, if the sign-in
   form is what is there, an ordinary valid login and the full arrival. Reports
   whether the sign-in layer is gone and the app is usable. */
const backThenUse = async (page, puts, form, notice, seen) => {
  await page.click('button:has-text("Back to sign in")');
  await page.waitForTimeout(800);
  if (await page.locator('input[type="password"]').count()) {
    await page.fill('input[type="email"], input[autocomplete="username"]', "demo@sageonline.app");
    await page.fill('input[type="password"]', "an-ordinary-password");
    await page.click('button:has-text("Sign in")');
  }
  await page.waitForSelector(".ar-bar.up", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  seen.layer = await page.locator(".signin-over").count();
  seen.usable = await page.locator(".ar-bar.up").count();
  seen.form = await form(); seen.notice = await notice();
};
const broadcast = (page, event, id, token) => page.evaluate(([event, s]) => { const ch = new BroadcastChannel("lpc-auth"); ch.postMessage({ event, session: s }); ch.close(); }, [event, id ? sessionOf(id, token) : null]);

try {
  /* Control: B is really signed in, so the scenarios below mean what they say. */
  await scenario("control: B signed in, no link: the sign-in card is not up",
    { stored: sessionOf(B_ID, "token-b"), hash: "", expect: { form: 0, notice: 0, card: 0 } });
  /* The review's case: B is signed in, a recovery link whose tokens do not check out. */
  await scenario("B signed in, link with tokens Supabase rejects (401): no form, the notice, no write",
    { stored: sessionOf(B_ID, "token-b"), hash: goodHash("not-a-real-token"), after: saveIfShown, expect: { form: 0, notice: 1, puts: 0 } });
  await scenario("B signed in, bare #type=recovery: no form, the notice, no write",
    { stored: sessionOf(B_ID, "token-b"), hash: "#type=recovery", after: saveIfShown, expect: { form: 0, notice: 1, puts: 0 } });
  await scenario("B signed in, type=recovery with otp_expired (mixed): no form, the notice, no write",
    { stored: sessionOf(B_ID, "token-b"), hash: "#type=recovery&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", after: saveIfShown, expect: { form: 0, notice: 1, puts: 0 } });
  await scenario("B signed in, plain expired link: the notice shows (P2), no write",
    { stored: sessionOf(B_ID, "token-b"), hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", expect: { form: 0, notice: 1, card: 1, puts: 0 } });
  /* Leaving a failed link (P2): Back, an ordinary login if the card is a sign-in, the arrival. */
  const EXPIRED = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  await scenario("nobody signed in, expired link, Back, ordinary login, full arrival: the layer is gone, the app is usable, no write",
    { hash: EXPIRED, after: backThenUse, expect: { layer: 0, usable: 1, form: 0, puts: 0 } });
  await scenario("B stored, expired link, Back: the layer is gone, the app is usable, no write",
    { stored: sessionOf(B_ID, "token-b"), hash: EXPIRED, after: backThenUse, expect: { layer: 0, usable: 1, form: 0, puts: 0 } });
  /* Nobody signed in, a good link. */
  await scenario("nobody signed in, a good link for A: the form, and saving writes once, as A",
    { hash: goodHash("token-a"), after: save, expect: { form: 1, notice: 0, puts: 1, putTokens: ["token-a"] } });
  /* B signed in, a good link for A: Supabase swaps the session for A's. */
  await scenario("B signed in, a good link for A: saving writes once, as A, never as B",
    { stored: sessionOf(B_ID, "token-b"), hash: goodHash("token-a"), after: save, expect: { form: 1, puts: 1, putTokens: ["token-a"] } });
  /* The form is up for A; then B signs in, or everybody signs out. */
  await scenario("form up for A, then B signs in elsewhere: the form is withdrawn, the notice shows, no write",
    { hash: goodHash("token-a"), after: async (page, puts, form, notice, seen) => { await broadcast(page, "SIGNED_IN", B_ID, "token-b"); await page.waitForTimeout(1200); seen.form = await form(); seen.notice = await notice(); },
      expect: { form: 0, notice: 1, puts: 0 } });
  await scenario("form up for A, then signed out: the form is withdrawn, the notice shows, no write",
    { hash: goodHash("token-a"), after: async (page, puts, form, notice, seen) => { await broadcast(page, "SIGNED_OUT", null); await page.waitForTimeout(1200); seen.form = await form(); seen.notice = await notice(); },
      expect: { form: 0, notice: 1, puts: 0 } });
} finally {
  await browser.close();
  if (mock) mock.kill();
}

let bad = 0;
for (const r of results) { console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}`); if (!r.ok) { bad++; for (const f of r.fails) console.log(`         ${f}`); } }
console.log(bad ? `recovery-probe: ${bad} of ${results.length} did the wrong thing` : `recovery-probe: all ${results.length} as they should be`);
process.exit(bad ? 1 : 0);

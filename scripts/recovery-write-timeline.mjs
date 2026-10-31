/* DIAGNOSIS ONLY, read-only about the app: when does the app write, and as which session, while a password reset is unfinished?
 *
 * NEW work for PR 501 (27 October 2026). Opens a valid synthetic recovery link in the strict browser against the synthetic backend (scripts/synthetic-backend.mjs), holds the password write,
 * and records every request with a time relative to the page load, the token it carried, and which stage of the reset it fell in. It also diffs the app_data rows before and after, so the answer
 * to "which keys change" is measured. It approves nothing: every table write is let through (and recorded) because the question is what the app does. It is not a result and cannot count as one.
 *
 * Usage: node scripts/recovery-write-timeline.mjs --dist <built dir> --out <new dir> [--label corrected|baseline] [--driver <abs playwright dir>]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { launchStrict, guardContext } from "./strict-browser-kit.mjs";
import { createBackend, MOCK_PORT, USER_A } from "./synthetic-backend.mjs";

const argv = process.argv.slice(2), opt = (n, f) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : f; };
const DIST = path.resolve(opt("dist")), OUT = path.resolve(opt("out")), LABEL = opt("label", "unlabelled"), APP_PORT = 5190, APP = `http://127.0.0.1:${APP_PORT}`;
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) throw new Error("The output directory must be new or empty");
await mkdir(OUT, { recursive: true });

const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, APP); req.resume();
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/_vercel/") || u.pathname === "/sw.js") {
    if (req.method === "POST" && u.pathname === "/api/vitals") { res.writeHead(204); return res.end(); }
    if (req.method === "POST" && u.pathname === "/api/floor-row") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ row: null, stamp: "missing" })); }
    res.writeHead(404); return res.end();
  }
  let f = path.join(DIST, decodeURIComponent(u.pathname));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise((r, j) => { server.once("error", j); server.listen(APP_PORT, "127.0.0.1", r); });

const hash = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12);
const snapshot = (b) => Object.fromEntries(b.tables.app_data.map((r) => [r.key, hash(r.value)]));
const backend = createBackend({ role: "admin", name: "Alex Reyner", extra: { noStated: true } });
backend.writePolicy = () => true;   // diagnosis: let everything through and record it
backend.addUser({ id: USER_A, token: "token-rec", email: "demo@sageonline.app" });
await backend.listen();
const k = await launchStrict({ driver: opt("driver"), expect: {} });
const marks = {}; const log = [];
try {
  const ctx = await k.browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  await guardContext(ctx, { allowedOrigins: [APP, `http://127.0.0.1:${MOCK_PORT}`], log });
  const page = await ctx.newPage();
  const before = snapshot(backend);
  const t0 = Date.now(); const rel = () => Date.now() - t0;
  marks.pageGoto = 0;
  await page.goto(`${APP}/#access_token=token-rec&expires_in=3600&refresh_token=refresh-token-rec&token_type=bearer&type=recovery`);
  await page.getByText("Choose a new password").first().waitFor({ state: "visible", timeout: 20000 }); marks.resetFormVisible = rel();
  const close = page.getByRole("button", { name: "Close the round-up", exact: true });
  try { await close.first().waitFor({ state: "visible", timeout: 6000 }); marks.roundupDrawnOverForm = rel(); await close.first().click(); marks.roundupClosed = rel(); } catch (e) { marks.roundupDrawnOverForm = null; }
  await page.waitForTimeout(3000); marks.settledBeforeSave = rel();
  const hold = backend.hold((e) => e.method === "PUT" && e.path === "/auth/v1/user");
  await page.getByPlaceholder("At least 8 characters").fill("a-new-synthetic-password-1");
  await page.getByPlaceholder("Repeat it").fill("a-new-synthetic-password-1");
  await page.getByRole("button", { name: /Save and sign in/ }).click(); marks.saveClicked = rel();
  await hold.seen; marks.passwordPutHeld = rel();
  await page.waitForTimeout(2500); marks.heldFor2500ms = rel();
  hold.release(); marks.passwordPutReleased = rel();
  await page.waitForTimeout(6000); marks.end = rel();
  const after = snapshot(backend);
  const stage = (t) => t < marks.resetFormVisible ? "1 before the reset form is on screen" : t < marks.saveClicked ? "2 reset form up, new password not yet sent" : t < marks.passwordPutReleased ? "3 password write in flight (held)" : "4 after the harness released the held password write (not instrumented: response returned or accepted by the SDK is not observed here)";
  const keyOf = (r) => { try { const b = JSON.parse(r.body); return (Array.isArray(b) ? b : [b]).map((x) => x.key || x.id || "").join(",").replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<ts>"); } catch (e) { return "(body cut at 1500 chars)" + (r.body.match(/"key":"([^"]+)"/) || [])[1]; } };
  const tokenLabel = (a) => a === "token-rec" ? "recovery token" : a ? "other: " + a.slice(0, 20) : "none (anon key only)";
  const requests = backend.requests.filter((r) => r.method !== "OPTIONS").map((r) => ({ t: r.at - t0, stage: stage(r.at - t0), method: r.method, path: r.path, token: tokenLabel(r.auth), key: /^\/rest\/v1\/(app_data|profiles|floor_people)$/.test(r.path) && r.method !== "GET" ? keyOf(r) : undefined, query: r.method === "GET" ? r.query.slice(0, 80) : undefined }));
  const writes = requests.filter((r) => r.method !== "GET");
  const changed = Object.keys(after).filter((key) => before[key] !== after[key]).map((key) => ({ key: key.replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<ts>"), change: before[key] === undefined ? "added" : "replaced" }));
  const result = { label: LABEL, note: "diagnosis only; every table write let through and recorded; not a test result", marks, tokenEpochs: { recoveryToken: "token-rec, the access token in the link, valid for the account (USER_A) in the synthetic Auth", afterSave: "the same token; the synthetic Auth does not rotate it" }, writes, changedAppDataKeys: changed, requestsByStage: requests.reduce((a, r) => { a[r.stage] = (a[r.stage] || 0) + 1; return a; }, {}), allRequests: requests, refused: log };
  await writeFile(path.join(OUT, "timeline.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ label: LABEL, marks, writes: writes.map((w) => `${w.t}ms [${w.stage}] ${w.method} ${w.path} ${w.key || ""} as ${w.token}`), changedAppDataKeys: changed }, null, 1));
} finally { await k.close(); await backend.close(); server.close(); }

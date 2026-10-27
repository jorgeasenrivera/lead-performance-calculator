/* Synthetic browser cases for the combined security, recovery and cross-check work in PR 501.
 *
 * NEW work (27 October 2026), not a recovery of any earlier file: the original unpublished harness bytes were not available and nothing here claims to be them.
 *
 * What it does. Serves a built copy of the app from loopback, answers the app's backend from scripts/synthetic-backend.mjs (an exact contract, 501 for anything else),
 * launches Chromium through scripts/strict-browser-kit.mjs (sandbox always on, argv and every renderer checked from /proc), and refuses every request that is not to
 * those two loopback origins. Nothing here reads a credential or a .env: the app is built against literals (http://127.0.0.1:5433 and a made-up key) and every
 * person, file and token is invented.
 *
 * Modes. --expect corrected (default) asserts the behaviour PR 501 intends. --expect baseline asserts what the unmodified head 82e59f9 does where the two differ, so
 * a baseline run PASSES only if it reproduces the defect, and the report says which cases did. A case that is not implemented reports NOT RUN with its reason; nothing
 * is quietly counted as passing.
 *
 * Usage: node scripts/browser-security-cases.mjs --dist <built dir> --out <empty-or-new dir> [--only id,id] [--expect corrected|baseline] [--driver <abs playwright dir>]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { launchStrict, guardContext, pinsFromEnv, sandboxDiagnostics } from "./strict-browser-kit.mjs";
import { createBackend, MOCK_PORT, USER_A, USER_B, makeWritePolicy as makePolicy } from "./synthetic-backend.mjs";
import { createAnnotator } from "./safe-annotations.mjs";
import { createCleanup, cleanupFailed } from "./strict-cleanup.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : fallback; };
const DIST = path.resolve(opt("dist", "dist"));
const OUT = path.resolve(opt("out", "browser-cases-evidence"));
const ONLY = opt("only") ? new Set(opt("only").split(",")) : null;
const EXPECT = opt("expect", "corrected");
const APP_PORT = Number(opt("app-port", "5190"));
const APP = `http://127.0.0.1:${APP_PORT}`;
const WRITE_PROBE = process.env.STRICT_WRITE_PROBE === "1";
/* A discovery run is never a result: it cannot run on the hosted runner, it says so in result.json, and it always exits 1. */
if (WRITE_PROBE && process.env.GITHUB_ACTIONS === "true") throw new Error("STRICT_WRITE_PROBE is for local discovery only and is refused on the hosted runner");
if (!["corrected", "baseline"].includes(EXPECT)) throw new Error("--expect must be corrected or baseline");
/* Diagnostic annotations only (scripts/safe-annotations.mjs): fixed sentences, closed ids and Y/N flags, never an error, detail, request or payload. It never throws and never changes an exit code. */
const note = createAnnotator({ scope: EXPECT });
if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error("No built app in " + DIST);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) throw new Error("The output directory must be new or empty: " + OUT);
await mkdir(OUT, { recursive: true });

/* ---- the app's own origin: static files, and the few /api calls the shell makes, recorded ---- */
const appCalls = [], appLog = [];   // appCalls is a per-case working list that cases reset; appLog is the whole run, with the status each call was answered with
/* The ONLY calls the app may make to its own origin, by exact method, path and answer. Anything else (a client-error report, a different /api route, a different status) fails the case. */
const APP_ALLOWED = new Set(["GET /_vercel/speed-insights/script.js 404", "POST /api/vitals 204", "POST /api/floor-row 200"]);
const appKey = (e) => `${e.method} ${e.path} ${e.status}`;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const appServer = http.createServer((req, res) => {
  const u = new URL(req.url, APP);
  let body = ""; req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (u.pathname.startsWith("/api/") || u.pathname === "/sw.js" || u.pathname.startsWith("/_vercel/")) {   // the host's own scripts are not served here: a 404, not the app shell
      const rec = { method: req.method, path: u.pathname, body: body.slice(0, 600), status: null }; appCalls.push(rec); appLog.push(rec);
      const reply = (code, headers, payload) => { rec.status = code; res.writeHead(code, headers); return res.end(payload); };
      // telemetry is accepted and discarded; anything else the app asks of its own server is a 404 the case can see
      if (req.method === "POST" && (u.pathname === "/api/client-error" || u.pathname === "/api/vitals")) return reply(204);
      // the floor row: a day with no row yet (the shape api/floor-row.mjs documents: { row, stamp } or { same: true })
      if (req.method === "POST" && u.pathname === "/api/floor-row") {
        let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) {}
        if (b.op === "read") return reply(200, { "content-type": "application/json" }, JSON.stringify(b.stamp === "missing" ? { same: true, stamp: "missing" } : { row: null, stamp: "missing" }));
      }
      return reply(404);
    }
    if (!["GET", "HEAD"].includes(req.method)) { const rec = { method: req.method, path: u.pathname, body: body.slice(0, 200), status: 405 }; appLog.push(rec); res.writeHead(405); return res.end(); }
    // a same-origin page with nothing in it: the stand-in for "another tab" that writes the SDK's storage key and posts on its channel
    if (u.pathname === "/__harness/blank.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><title>blank</title>"); }
    let f = path.join(DIST, decodeURIComponent(u.pathname));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
});
await new Promise((r, j) => { appServer.once("error", j); appServer.listen(APP_PORT, "127.0.0.1", r); });

const results = [];
/* caught is true only at a catch block that recorded the failure; the annotator is given the id, the status and that flag, nothing else, and the stored record is unchanged. */
const record = (r, caught) => { results.push(r); console.log(`${r.status.padEnd(8)} ${r.id}  ${r.title}${r.detail ? "\n         " + String(r.detail).split("\n").join("\n         ") : ""}`); try { note.caseRecord(caught === true ? { id: r.id, status: r.status, caught: true } : { id: r.id, status: r.status }); } catch (e) {} };
const want = (id) => !ONLY || ONLY.has(id);
const notRun = (id, title, why) => { if (want(id)) record({ id, title, status: "NOT RUN", detail: why }); };

/* ---- helpers shared by the cases ---- */
const DEMO_EMAIL = "demo@sageonline.app", DEMO_PASSWORD = "synthetic-password-1";
async function signIn(page) {
  await page.goto(APP + "/");
  await page.locator('input[type="email"], input[autocomplete="username"]').fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForSelector(".topbar, .assoc-card, .bp-row", { timeout: 40000 });
  await page.waitForTimeout(4000);
  const closeRound = page.getByRole("button", { name: "Close the round-up", exact: true });
  if (await closeRound.count()) await closeRound.click();
}
/* The app opens a realtime socket to its backend. The harness refuses every WebSocket (fail closed); this one, to the synthetic origin and nothing else, is the single refusal
   that is expected and counted, and the app carries on without it. Any other refusal is a failure. */
const isExpectedRefusal = (e) => e.kind === "refused-websocket" && e.url.startsWith(`ws://127.0.0.1:${MOCK_PORT}/realtime/v1/websocket?`);
const stray = (log) => log.filter((e) => !isExpectedRefusal(e));
/* The host's own script path answers 404 on purpose (see the app server above), and the browser reports each as one console line without a URL. Those lines are allowed only
   up to the number of 404s the app server actually sent; every other console error or page error is a problem. */
const sinceStart = (s) => appLog.slice(s.appStart || 0);
const appProblems = (s) => sinceStart(s).filter((e) => !APP_ALLOWED.has(appKey(e))).map((e) => `unexpected app-origin call: ${appKey(e)}`);
const realProblems = (s, { denied = 0 } = {}) => { let allow = sinceStart(s).filter((e) => e.status === 404 && APP_ALLOWED.has(appKey(e))).length, allow403 = denied; return s.problems.filter((p) => { if (/Failed to load resource: the server responded with a status of 404/.test(p) && allow > 0) { allow--; return false; } if (/Failed to load resource: the server responded with a status of 403/.test(p) && allow403 > 0) { allow403--; return false; } return true; }); };
const compact = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* ---- table writes: each case may make only the writes named for it ----
   A rule names a table, a method, a pattern every written row's key must match, and the most writes it may take. Rows are also refused if they carry anything from the
   invented files or the typed password. A write no rule matches is refused by the backend and fails the case; the rules below were set from a discovery run
   (STRICT_WRITE_PROBE=1 allows everything and records it, and is for discovery only, never for a result). */

const probeWrites = [];
/* The only table writes any case approves, each tied to the source that makes it:
   runAutoBackup (src/LeadPerformanceCalculator.jsx, called when an ADMIN opens the tool, at most once per 20 hours) writes a store snapshot, a settings snapshot and the index, three upserts to app_data,
   keys lpc:backup:<store>:<id>:v1, lpc:config:backup:<id>:v1 and lpc:config:backups-index:v1, as the admin's own session. That is approved for the cases that sign an admin in to use the app (A1, the cross-check
   session). It is NOT approved while a password reset is still unfinished: the recovery cases approve the same three writes only in a phase set AFTER the reset is saved or left, so one during the reset is refused and fails the case.
   Associate and pending accounts have no approved table write at all. Nothing else is approved anywhere: no profile, store, floor or schedule write. */
const TS = "\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-\\d{3}Z";
const backupRules = (auth, finding) => [
  { table: "app_data", method: "POST", key: new RegExp(`^lpc:backup:sage-demo:${TS}:v1$`), auth, min: 1, max: 1, finding },
  { table: "app_data", method: "POST", key: new RegExp(`^lpc:config:backup:${TS}:v1$`), auth, min: 1, max: 1, finding },
  { table: "app_data", method: "POST", key: /^lpc:config:backups-index:v1$/, auth, min: 1, max: 1, finding },
];
/* The backup a recovery case may see, and only once recovery is over: one store snapshot, one settings snapshot, one index, all as the recovery session's own token, in the named phase. */
const afterReset = (phase) => backupRules(/^token-rec\d?$/).map((r) => ({ ...r, phase }));
const WRITE_RULES = {
  default: [],
  A1: backupRules(/^synthetic-token-/),
  XC: backupRules(/^synthetic-token-/),
  REC: [],   // a recovery session approves no table write by default; a case names the one backup it expects, and only after the reset is over (see afterReset)
};
async function newSession(k, backendOptions, { logName }) {
  const backend = createBackend(backendOptions);
  backend.writePolicy = WRITE_PROBE ? (() => true) : makePolicy(WRITE_RULES[logName] || WRITE_RULES.default);
  await backend.listen();
  const ctx = await k.browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  const log = [];
  await guardContext(ctx, { allowedOrigins: [APP, `http://127.0.0.1:${MOCK_PORT}`], log });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console.error: " + m.text().slice(0, 200)); });
  return { backend, ctx, page, log, problems, logName, appStart: appLog.length, async close() { if (WRITE_PROBE) probeWrites.push({ session: logName, writes: backend.requests.filter((r) => !["GET", "OPTIONS"].includes(r.method) && /^\/rest\/v1\/[a-z_]+$/.test(r.path)).map((r) => ({ method: r.method, path: r.path, auth: r.auth, body: r.body.slice(0, 400) })) }); await ctx.close(); await backend.close(); } };
}

/* ---- case 1: the real sign-in form reaches the manager app ---- */
async function case1(k) {
  const id = "A1", title = "Actual login UI with a synthetic session reaches the manager app";
  if (!want(id)) return;
  const s = await newSession(k, { role: "admin", name: "Alex Reyner" }, { logName: id });
  try {
    appCalls.length = 0;
    await signIn(s.page);
    const topbar = await s.page.locator(".topbar").count();
    const tokenPosts = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/auth/v1/token");
    const body = tokenPosts[0] ? JSON.parse(tokenPosts[0].body || "{}") : null;
    const profileReads = s.backend.requests.filter((r) => r.path === "/rest/v1/profiles");
    const failures = [];
    if (!topbar) failures.push("the manager app (topbar) did not render");
    if (tokenPosts.length !== 1) failures.push(`expected exactly 1 password sign-in, saw ${tokenPosts.length}`);
    if (!body || body.email !== DEMO_EMAIL || body.password !== DEMO_PASSWORD) failures.push("sign-in body is not the typed synthetic credentials: " + JSON.stringify(body));
    if (!profileReads.length) failures.push("no profile read: role and store binding not exercised");
    if (s.backend.unexpected.length) failures.push("requests outside the synthetic contract: " + JSON.stringify(s.backend.unexpected.map((u) => `${u.method} ${u.path}`)));
    if (realProblems(s).length) failures.push("page or console errors: " + realProblems(s).join(" | "));
    for (const p of appProblems(s)) failures.push(p);
    if (stray(s.log).length) failures.push("refused traffic that was not the synthetic realtime socket: " + JSON.stringify(stray(s.log)));
    if (s.backend.writePolicy.unmet) for (const m of s.backend.writePolicy.unmet()) failures.push("an approved write did not happen: " + m);
    const writes = s.backend.requests.filter((r) => !["GET", "OPTIONS"].includes(r.method) && r.path !== "/auth/v1/token" && !/^\/rest\/v1\/rpc\/sage_(config|store)_read$/.test(r.path))
      .map((r) => ({ method: r.method, path: r.path, key: (() => { try { const b = JSON.parse(r.body); return (Array.isArray(b) ? b : [b]).map((x) => x.key || x.id).join(","); } catch (e) { return ""; } })() }));
    const audit = await k.auditRenderers("A1");
    record({ id, title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") || `topbar rendered; 1 sign-in POST; ${profileReads.length} profile read(s); ${writes.length} table write(s) after sign-in: ${writes.map((w) => `${w.method} ${w.path} [${w.key}]`).join("; ") || "none"}; app-origin calls: ${appCalls.map((c) => c.method + " " + c.path).join(", ") || "none"}; renderers audited: ${audit.length}; realtime socket attempts refused: ${s.log.filter(isExpectedRefusal).length}; page and console errors other than the planned 404s: ${realProblems(s).length}`, evidence: { requestCounts: countBy(s.backend.requests), appCalls: [...appCalls], problems: s.problems } });
  } catch (e) { record({ id, title, status: "FAIL", detail: String(e).slice(0, 500) }, true); }
  finally { await s.close(); }
}
const countBy = (reqs) => reqs.reduce((a, r) => { const key = `${r.method} ${r.path}`; a[key] = (a[key] || 0) + 1; return a; }, {});

/* ---- the cross-check cases (the missing-value correction) ---- */
const csv = (...lines) => lines.join("\n") + "\n";
const ROLL_HEAD = "Store,Sold,Net Opportunities,Deals Delivered";
const PPL_HEAD = "User,Units Delivered,Net Opportunities";
const MARK = "Zzfictional";   // appears in every invented name, so a request body carrying it would prove a file left the page

async function openCrossCheck(page) {
  await page.getByRole("button", { name: /^Import/ }).first().click();
  await page.getByRole("button", { name: /Cross-check the board/ }).first().click();
  await page.waitForSelector(".xc-modal h2");
}
async function closeCrossCheck(page) {
  await page.keyboard.press("Escape");
  await page.waitForSelector(".xc-modal", { state: "detached" });
}
async function upload(page, name, text) {
  await page.locator('.xc-modal input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
}
/* What the person sees, read once, as plain text. */
const snapshot = (page) => page.evaluate(() => {
  const t = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : null);
  const modal = document.querySelector(".xc-modal");
  const tiles = [...modal.querySelectorAll(".xc-tile")].map((el) => ({ cap: t(el.querySelector(".xc-cap")), n: t(el.querySelector(".xc-n")), note: t(el.querySelector(".xc-note")) }));
  const warn = t(modal.querySelector(".xc-note-blue p")), lead = t(modal.querySelector(".xc-lead"));
  return {
    file: t(modal.querySelector(".xc-file b")),
    rollN: t(modal.querySelector(".xc-roll .xc-rollrow .xc-n")), rollNote: t(modal.querySelector(".xc-roll .xc-rollrow .xc-note")),
    tiles, warn, lead, clean: !!modal.querySelector(".xc-clean"),
    lists: [...modal.querySelectorAll(".xc-list")].map((el) => ({ title: t(el.querySelector(".xc-list-cap")), rows: [...el.querySelectorAll(".xc-row")].map((r) => t(r)) })),
    err: t(modal.querySelector(".sched-err")),
  };
});
const verdictOf = (snap) => snap.lead && /exactly/.test(snap.lead) ? "exact" : snap.warn ? (/runs (high|low) by ([^\s.,]+)/.exec(snap.warn) || []).slice(1, 3).join(" ") || "warn?" : "none";

/* Each case: files uploaded in order (a roll-up first when there is one), the modal reopened fresh for every case, and an expectation per field.
   `corrected` is the intended behaviour; `baseline` lists only the fields where the unmodified head differs, so a baseline run reproduces exactly those. */
/* The demo board's own held people, each as the file would state them if it agreed exactly (units = the four channel counts), so a case can add unknown records to an otherwise matching file. */
import { buildDemo as buildDemoForXc } from "./demo-seed.mjs";
const boardMatchingLines = () => {
  const demo = buildDemoForXc(); const store = demo.rows.find((r) => r.table === "app_data" && /^lpc:store:[^:]+:v2$/.test(r.row.key)).row.value;
  const month = Object.keys(store.months)[0], stats = store.months[month].stats, norm = (x) => (x || "").trim().toLowerCase().replace(/\s+/g, " ");
  return store.roster.filter((a) => stats[norm(a.name)]).map((a) => { const t = stats[norm(a.name)]; return `${a.name},${(t.internetUnits || 0) + (t.phoneUnits || 0) + (t.showroomUnits || 0) + (t.campaignUnits || 0)},`; });
};
const XC = [
  { id: "B-roll-blank", title: "Store roll-up with a blank Deals Delivered shows a dash, not 0", roll: [ROLL_HEAD, "Example Motors,40,120,"], corrected: { rollN: "–", rollNote: "deliveries at Example Motors · 40 sold · 120 opportunities" }, baseline: { rollN: "0" } },
  { id: "B-roll-spaces", title: "Store roll-up with a spaces-only Deals Delivered shows a dash", roll: [ROLL_HEAD, "Example Motors,40,120,   "], corrected: { rollN: "–" }, baseline: { rollN: "0" } },
  { id: "B-roll-dash", title: "Store roll-up with a dash Deals Delivered shows a dash, not NaN", roll: [ROLL_HEAD, "Example Motors,40,120,-"], corrected: { rollN: "–" }, baseline: { rollN: "NaN" } },
  { id: "B-roll-sold-blank", title: "Blank Sold and Net Opportunities are left out of the line, not shown as 0", roll: [ROLL_HEAD, "Example Motors,,,31"], corrected: { rollN: "31", rollNote: "deliveries at Example Motors" }, baseline: { rollNote: "deliveries at Example Motors · 0 sold · 0 opportunities" } },
  { id: "B-roll-sold-dash", title: "Dash Sold and Net Opportunities are left out of the line, not shown as NaN", roll: [ROLL_HEAD, "Example Motors,-,-,31"], corrected: { rollN: "31", rollNote: "deliveries at Example Motors" }, baseline: { rollNote: "deliveries at Example Motors · NaN sold · NaN opportunities" } },
  { id: "C12-roll-zero", title: "Case 12: an explicit zero in the store report is shown as 0", roll: [ROLL_HEAD, "Example Motors,0,0,0"], corrected: { rollN: "0", rollNote: "deliveries at Example Motors · 0 sold · 0 opportunities" }, baseline: {} },
  { id: "C13-roll-half", title: "Case 13: a fractional 0.5 in the store report is kept", roll: [ROLL_HEAD, "Example Motors,0.5,2.5,0.5"], corrected: { rollN: "0.5", rollNote: "deliveries at Example Motors · 0.5 sold · 2.5 opportunities" }, baseline: {} },
  { id: "B-roll-malformed", title: "Characterization: malformed roll-up text stays NaN, as before (no new parsing)", roll: [ROLL_HEAD, "Example Motors,12abc,\"1,234\",$12"], corrected: { rollN: "NaN", rollNote: "deliveries at Example Motors · NaN sold · NaN opportunities" }, baseline: {} },
  { id: "C11-people-unknown", title: "Case 11: a people list with no store aggregate and no units says unknown, not 0", people: [PPL_HEAD, `Quinn ${MARK},,`, `Robin ${MARK}, ,-`, `Sam ${MARK},-,`], corrected: { people: "–", dc: "–", verdict: "none" }, baseline: { people: "0" } },
  { id: "C11-people-unknown-vs-roll", title: "All-unknown people against a store of 31: no false 'runs low by 31'", roll: [ROLL_HEAD, "Example Motors,40,120,31"], people: [PPL_HEAD, `Quinn ${MARK},,`, `Robin ${MARK},-,-`], corrected: { people: "–", dc: "31", verdict: "none" }, baseline: { people: "0", verdict: "low 31" } },
  { id: "C11-people-unknown-vs-unknown", title: "All-unknown people against an unknown store figure: no comparison at all", roll: [ROLL_HEAD, "Example Motors,40,120,"], people: [PPL_HEAD, `Quinn ${MARK},,`, `Robin ${MARK},-,-`], corrected: { people: "–", dc: "–", verdict: "none" }, baseline: { people: "0", dc: "0", verdict: "exact" } },
  { id: "C12-people-zero", title: "Case 12: explicit zeros everywhere are reported as 0 and agree", roll: [ROLL_HEAD, "Example Motors,0,0,0"], people: [PPL_HEAD, `Quinn ${MARK},0,0`, `Robin ${MARK},0,0`], corrected: { people: "0", dc: "0", verdict: "exact" }, baseline: {} },
  { id: "C12-people-zero-vs-store-zero", title: "Case 12: people with units against a store that reported 0 run high by their units", roll: [ROLL_HEAD, "Example Motors,0,0,0"], people: [PPL_HEAD, `Quinn ${MARK},2,1`], corrected: { people: "2", dc: "0", verdict: "high 2" }, baseline: {} },
  { id: "C13-people-half", title: "Case 13: 0.5 credit is kept in the people tile and in each off-board row (no held figure, so no moved-diff is claimed)", roll: [ROLL_HEAD, "Example Motors,1,3,1"], people: [PPL_HEAD, `Quinn ${MARK},0.5,1`, `Robin ${MARK},0.5,1`], corrected: { people: "1", dc: "1", verdict: "exact", offBoardRows: [`Quinn ${MARK}0.5`, `Robin ${MARK}0.5`] }, baseline: {} },
  { id: "B-people-mixed", title: "Mixed known and unknown units: the known ones still add, unknown count as nothing", roll: [ROLL_HEAD, "Example Motors,40,120,4"], people: [PPL_HEAD, `Quinn ${MARK},3,1`, `Robin ${MARK},,1`, `Sam ${MARK},2,1`], corrected: { people: "5", dc: "4", verdict: "high 1" }, baseline: {} },
  { id: "B-people-opps-unknown", title: "Blank and dash opportunities add no 'across the people' clause (the old code showed NaN)", roll: [ROLL_HEAD, "Example Motors,40,120,4"], people: [PPL_HEAD, `Quinn ${MARK},3,`, `Robin ${MARK},2,-`], corrected: { people: "5", verdict: "high 1", warnHas: [], warnLacks: ["across the people"] }, baseline: { warnHas: ["NaN across the people against 120 for the store"], warnLacks: [] } },
  /* CHARACTERIZATION ONLY, no product policy: "Every name and every figure matches." is drawn when the three lists (off board with a figure, on board missing, moved) are empty, so it can also appear when the file's figures were unknown. */
  { id: "CHAR-clean-unknown-offboard", title: "Characterization: the 'every figure matches' line with an all-unknown, off-board people list", roll: [ROLL_HEAD, "Example Motors,40,120,31"], people: [PPL_HEAD, `Quinn ${MARK},,`, `Robin ${MARK},-,-`], corrected: { people: "–", verdict: "none", clean: false }, baseline: { people: "0", verdict: "low 31", clean: false } },   // not clean: the board's own held people are all missing from this file, so that list is never empty here
  { id: "CHAR-clean-matching-plus-unknown", title: "Characterization: every held figure matches and two other records are unknown, and the 'every figure matches' line is shown", people: () => [PPL_HEAD, ...boardMatchingLines(), "Alex Reyner,,", `Quinn ${MARK},-,-`], corrected: { verdict: "none", clean: true }, baseline: { clean: true } },
  { id: "CHAR-clean-unknown-onboard", title: "Characterization: an on-board person whose unit cell is blank (what the board holds is not compared)", people: [PPL_HEAD, "Priya Ramanan,,", "Sam Demo,-,-"], corrected: {}, baseline: {} },
  { id: "B-people-nan", title: "Characterization: nonblank text in the units column stays NaN, as before", roll: [ROLL_HEAD, "Example Motors,40,120,4"], people: [PPL_HEAD, `Quinn ${MARK},12abc,1`, `Robin ${MARK},1 ,1`], corrected: { people: "NaN" }, baseline: {} },
];

async function runCrossCheck(k) {
  const ids = XC.filter((c) => want(c.id));
  const regroup = want("XC-reopen");
  if (!ids.length && !regroup) return;
  const s = await newSession(k, { role: "admin", name: "Alex Reyner", extra: { noStated: true } }, { logName: "XC" });
  try {
    appCalls.length = 0;
    await signIn(s.page);
    let boardSeen = null;
    for (const c of ids) {
      const before = { reqs: s.backend.requests.length, refused: stray(s.log).length, app: appCalls.length };
      let snap = null, failures = [];
      try {
        await openCrossCheck(s.page);
        if (c.roll) {
          await upload(s.page, "roll-up.csv", csv(...c.roll));
          await s.page.waitForSelector(".xc-modal .xc-roll");   // fresh modal, no filed figure: this block exists only once THIS file has been read
        }
        if (c.people) {
          await upload(s.page, `people-${c.id}.csv`, csv(...(typeof c.people === "function" ? c.people() : c.people)));
          await s.page.waitForFunction((name) => { const b = document.querySelector(".xc-modal .xc-file b"); return b && b.textContent === name; }, `people-${c.id}.csv`, { timeout: 15000 });
        }
        snap = await snapshot(s.page);
        const got = { rollN: snap.rollN, rollNote: snap.rollNote, dc: snap.tiles[0]?.n, people: snap.tiles[1]?.n, verdict: c.people ? verdictOf(snap) : undefined, clean: c.people ? snap.clean : undefined, lists: c.people ? snap.lists.map((l) => `${l.title}: ${l.rows.length}`) : undefined };
        if (c.people && snap.tiles[2]) { if (boardSeen === null) boardSeen = snap.tiles[2].n; else if (snap.tiles[2].n !== boardSeen) failures.push(`board tile moved between cases: ${boardSeen} vs ${snap.tiles[2].n}`); }
        const exp = { ...c.corrected, ...(EXPECT === "baseline" ? c.baseline : {}) };
        for (const key of ["rollN", "rollNote", "dc", "people", "verdict", "clean"]) if (exp[key] !== undefined && got[key] !== exp[key]) failures.push(`${key}: saw ${JSON.stringify(got[key])}, expected ${JSON.stringify(exp[key])}`);
        for (const frag of exp.warnHas || []) if (!(snap.warn || "").includes(frag)) failures.push(`warning text lacks "${frag}": ${snap.warn}`);
        for (const frag of exp.warnLacks || []) if ((snap.warn || "").includes(frag)) failures.push(`warning text has "${frag}": ${snap.warn}`);
        if (exp.offBoardRows) { const rows = (snap.lists.find((l) => /not on the board/.test(l.title)) || { rows: [] }).rows; if (JSON.stringify(rows) !== JSON.stringify(exp.offBoardRows)) failures.push(`off-board rows: ${JSON.stringify(rows)}`); }
        c.__got = got; c.__rows = (snap.lists.find((l) => /not on the board/.test(l.title)) || { rows: [] }).rows;
      } catch (e) { failures.push("did not finish: " + String(e).split("\n")[0].slice(0, 200)); }
      try { await closeCrossCheck(s.page); } catch (e) { failures.push("modal did not close"); }
      const sent = s.backend.requests.slice(before.reqs), nonGet = sent.filter((r) => !["GET", "OPTIONS"].includes(r.method));
      if (nonGet.length) failures.push("a write left the page during a read-only check: " + nonGet.map((r) => r.method + " " + r.path).join(", "));
      if (sent.concat(appCalls.slice(before.app)).some((r) => JSON.stringify(r).includes(MARK))) failures.push("an invented name from the file appeared in an outgoing request");
      if (stray(s.log).length !== before.refused) failures.push("traffic outside loopback was attempted");
      const differs = EXPECT === "baseline" && Object.keys(c.baseline).some((key) => JSON.stringify(c.baseline[key]) !== JSON.stringify(c.corrected[key]));
      record({ id: c.id, title: c.title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") || (EXPECT === "baseline" ? (differs ? "baseline DEFECT REPRODUCED: " + JSON.stringify(c.__got) : "baseline already matches (unchanged behaviour): " + JSON.stringify(c.__got)) : JSON.stringify(c.__got)), evidence: { snapshot: snap } });
    }
    if (regroup) await reopenCase(s);
    const unexpected = s.backend.unexpected;
    const unmetWrites = s.backend.writePolicy.unmet ? s.backend.writePolicy.unmet() : [];
    record({ id: "XC-session", title: "Cross-check session: nothing outside the synthetic contract, no page errors", status: unexpected.length || unmetWrites.length || realProblems(s).length || appProblems(s).length ? "FAIL" : "PASS", detail: unexpected.length ? JSON.stringify(unexpected.map((u) => u.method + " " + u.path + " " + (u.why || ""))) : unmetWrites.length ? unmetWrites.join("; ") : realProblems(s).length ? realProblems(s).join("\n") : appProblems(s).length ? appProblems(s).join("\n") : `${s.backend.requests.length} backend requests, all GET/OPTIONS or sign-in; app-origin calls: ${appCalls.map((c) => c.method + " " + c.path).join(", ") || "none"}` });
    await k.auditRenderers("XC").then((a) => record({ id: "XC-renderers", title: "Renderers during the cross-check session are sandboxed", status: "PASS", detail: `${a.length} renderer(s): Seccomp 2, NoNewPrivs 1, CapEff 0, nested PID namespace` }));
  } catch (e) { record({ id: "XC-suite", title: "Cross-check suite", status: "FAIL", detail: String(e).slice(0, 600) }, true); }
  finally { await s.close(); }
}

/* "Check another" keeps the prior roll-up, so a people result after it must be the CURRENT file's, never a leftover tile. */
async function reopenCase(s) {
  const id = "XC-reopen", title = "'Check another' keeps the prior roll-up; each result is waited for by its own file name";
  const failures = [];
  try {
    await openCrossCheck(s.page);
    await upload(s.page, "roll-up.csv", csv(ROLL_HEAD, "Example Motors,40,120,31"));
    await s.page.waitForSelector(".xc-modal .xc-roll");
    await upload(s.page, "first.csv", csv(PPL_HEAD, `Quinn ${MARK},0,0`));
    await s.page.waitForFunction(() => document.querySelector(".xc-modal .xc-file b")?.textContent === "first.csv");
    const a = await snapshot(s.page);
    await s.page.getByRole("button", { name: "Check another", exact: true }).click();
    await s.page.waitForSelector(".xc-modal .xc-roll");
    const kept = await snapshot(s.page);
    if (kept.rollN !== "31") failures.push("the prior roll-up was not kept: " + kept.rollN);
    await upload(s.page, "second.csv", csv(PPL_HEAD, `Quinn ${MARK},,`, `Robin ${MARK},-,-`));
    await s.page.waitForFunction(() => document.querySelector(".xc-modal .xc-file b")?.textContent === "second.csv");
    const b = await snapshot(s.page);
    if (a.tiles[1].n !== "0") failures.push("first file did not read 0: " + a.tiles[1].n);
    const want2 = EXPECT === "baseline" ? "0" : "–";
    if (b.tiles[1].n !== want2) failures.push(`second file people tile: saw ${b.tiles[1].n}, expected ${want2}`);
    if (b.tiles[0].n !== "31") failures.push("the roll-up figure did not carry over: " + b.tiles[0].n);
    if (EXPECT === "corrected" && verdictOf(b) !== "none") failures.push("a comparison ran on unknown figures: " + verdictOf(b));
    await closeCrossCheck(s.page);
  } catch (e) { failures.push(String(e).split("\n")[0].slice(0, 200)); }
  record({ id, title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") });
}


/* ---- the recovery cases (the reset link, in the real app, with the Auth endpoints under this harness's control) ---- */
const LINK_FAILED = "That link has run out or was already used. Send yourself a new one.";
const INTERRUPTED = "This reset was interrupted. To choose a new password, request a fresh link.";
const EXPIRED = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
const goodHash = (token) => `#access_token=${token}&expires_in=3600&refresh_token=refresh-${token}&token_type=bearer&type=recovery`;
const NEW_PASSWORD = "a-new-synthetic-password-1";
const PUT_USER = (e) => e.method === "PUT" && e.path === "/auth/v1/user";
const countOf = (s, pred) => s.backend.requests.filter(pred).length;
const puts = (s) => s.backend.requests.filter(PUT_USER);
const logouts = (s) => countOf(s, (r) => r.path === "/auth/v1/logout");
const emails = (s) => countOf(s, (r) => r.path === "/auth/v1/recover" || r.path === "/auth/v1/otp");
const visible = async (page, text, ms = 12000) => { try { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: ms }); return true; } catch (e) { return false; } };
const absent = async (page, text) => (await page.getByText(text, { exact: false }).count()) === 0;
const authorized = (page) => page.locator(".topbar, .assoc-card, .bp-row").count();
/* Watch the page for a while and say what was on it, sample by sample (every 50 ms), so "the form came back for a moment" is a measured thing and not a snapshot. */
const watchScreen = (page, ms = 3000) => page.evaluate(async ([ms, form, notice, failed]) => {
  const out = []; const t0 = performance.now();
  while (performance.now() - t0 < ms) { const t = document.body.innerText; out.push({ t: Math.round(performance.now() - t0), form: t.includes(form), interrupted: t.includes(notice), failed: t.includes(failed), saving: t.includes("Saving") }); await new Promise((r) => setTimeout(r, 50)); }
  return out;
}, [ms, "Choose a new password", "This reset was interrupted", "That link has run out"]);
const summarize = (w) => ({ samples: w.length, formFirstMs: (w.find((x) => x.form) || {}).t ?? null, formLastMs: ([...w].reverse().find((x) => x.form) || {}).t ?? null, interruptedFirstMs: (w.find((x) => x.interrupted) || {}).t ?? null,
  overlapSamples: w.filter((x) => x.form && x.interrupted).length, savingAtEnd: w[w.length - 1].saving, formAtEnd: w[w.length - 1].form, interruptedAtEnd: w[w.length - 1].interrupted, failedAtEnd: w[w.length - 1].failed });
async function keepStopped(s, id) {
  try { await s.page.screenshot({ path: path.join(OUT, `${id}-stopped.png`) }); await writeFile(path.join(OUT, `${id}-stopped.txt`), (await s.page.locator("body").innerText()).slice(0, 3000)); } catch (e) {}
}
async function recoverySession(k, tokens = ["token-rec"], extraUsers = []) {
  const s = await newSession(k, { role: "admin", name: "Alex Reyner", extra: { noStated: true } }, { logName: "REC" });
  try {
    for (const t of tokens) s.backend.addUser({ id: USER_A, token: t, email: "demo@sageonline.app" });
    for (const u of extraUsers) s.backend.addUser(u);
  } catch (e) { await s.close(); throw e; }
  return s;
}
/* FINDING, not a harness shortcut: for a manager account the app's morning round-up dialog is drawn ABOVE the reset form, so the form cannot be reached until the person closes the
   round-up. The cases close it the way a person would and record that it was there (roundupCovered); the app is not changed to make a case easier. */
const roundupCovered = [];
const timelines = [];
async function closeRoundup(page, id) {
  const b = page.getByRole("button", { name: "Close the round-up", exact: true });
  try { await b.first().waitFor({ state: "visible", timeout: 6000 }); roundupCovered.push(id); await b.first().click(); await page.waitForTimeout(600); } catch (e) {}
}
async function fillAndSave(page) {
  await page.getByPlaceholder("At least 8 characters").fill(NEW_PASSWORD);
  await page.getByPlaceholder("Repeat it").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: /Save and sign in|Saving/ }).click();
}
/* Run one recovery case: a fresh strict session, the steps, and the checks every case shares (nothing off-contract, no stray refusals, no email, no page errors). */
/* The second save, with its password write HELD: no table write may happen while it is open or in flight, and the phase that allows the one backup is set only when the held write is released.
   Completion is then asserted from the screen (the form and the sign-in layer are gone), not from a timer. Returns what it saw so the case can state it. */
async function heldSecondSave(s, fail, label) {
  const hold = s.backend.hold(PUT_USER);
  const writesBefore = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data").length;
  s.backend.phase = "during-second-save";
  await fillAndSave(s.page);
  const seen = await Promise.race([hold.seen, new Promise((r) => setTimeout(() => r(null), 15000))]);
  if (!seen) { fail(label + ": the second password write never reached the backend"); return null; }
  await s.page.waitForTimeout(3000);
  const during = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data").length - writesBefore;
  if (during !== 0) fail(`${label}: ${during} table write(s) while the second password write was held`);
  const stillOpen = await visible(s.page, "Choose a new password", 1500);
  if (!stillOpen) fail(label + ": the reset form closed before the held password write was released");
  s.backend.phase = "after-completion";   // set only now: this is the first moment a backup is allowed
  hold.release();
  let done = false;
  for (let i = 0; i < 60 && !done; i++) { await s.page.waitForTimeout(500); done = (await s.page.getByText("Choose a new password").count()) === 0 && (await s.page.locator(".signin-over").count()) === 0; }
  if (!done) fail(label + ": the screen never showed completion (the form or the sign-in layer is still there)");
  return { during, done };
}
async function recoveryCase(k, id, title, steps) {
  if (!want(id)) return;
  let s, failures = [], note = "";
  try {
    s = await recoverySession(k, steps.tokens, steps.users);
    if (!WRITE_PROBE) s.backend.writePolicy = makePolicy(steps.writeRules || []);
    const fail = (m) => failures.push(m);
    note = (await steps.run(s, fail)) || "";
    if (s.backend.unexpected.length) fail("requests outside the synthetic contract: " + s.backend.unexpected.map((u) => `${u.method} ${u.path}`).join(", "));
    if (stray(s.log).length) fail("refused traffic that was not the synthetic realtime socket: " + JSON.stringify(stray(s.log)));
    if (emails(s)) fail("a reset email was requested without anyone asking");
    { const um = s.backend.writePolicy && s.backend.writePolicy.unmet ? s.backend.writePolicy.unmet() : []; for (const m of um) fail("an expected write did not happen: " + m); }
    { const pol = s.backend.writePolicy, found = pol && pol.findings ? pol.findings() : []; if (found.length) fail(`FINDING: ${found[0].finding}; ${found.length} write(s): ${found.map((f) => f.key.replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<ts>")).join(", ")}`); }
    if (realProblems(s).length) fail("page or console errors: " + realProblems(s).join(" | "));
    for (const p of appProblems(s)) fail(p);
    await k.auditRenderers(id);
  } catch (e) {
    failures.push("did not finish: " + String(e).split("\n")[0].slice(0, 300));
    // keep what the page looked like when it stopped, with the visible text, so a failed run can be read later
    if (s) { try { await s.page.screenshot({ path: path.join(OUT, `${id}-stopped.png`) }); await writeFile(path.join(OUT, `${id}-stopped.txt`), (await s.page.locator("body").innerText()).slice(0, 3000) + "\n\nbuttons: " + JSON.stringify(await s.page.evaluate(() => [...document.querySelectorAll("button")].map((b) => ({ t: b.textContent.trim().slice(0, 40), disabled: b.disabled, visible: !!(b.offsetWidth || b.offsetHeight) }))))); } catch (e2) {} }
  }
  if (s && failures.length && !failures.some((f) => f.startsWith("did not finish"))) await keepStopped(s, id);
  record({ id, title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") || note, evidence: s ? { timelines: timelines.splice(0), requestCounts: countBy(s.backend.requests), puts: puts(s).map((p) => ({ auth: p.auth, body: p.body.replace(NEW_PASSWORD, "<synthetic password>") })) } : undefined });
  if (s) await s.close();
}
const startHeldSave = async (s, fail, token = "token-rec") => {
  await s.page.goto(APP + "/" + goodHash(token));
  if (!(await visible(s.page, "Choose a new password"))) { fail("the reset form did not open for a good link"); return null; }
  await closeRoundup(s.page, "recovery");
  const hold = s.backend.hold(PUT_USER);
  await fillAndSave(s.page);
  const seen = await Promise.race([hold.seen, new Promise((r) => setTimeout(() => r(null), 12000))]);
  if (!seen) { fail("the password write never reached the backend"); return null; }
  if (seen.auth !== token) fail(`the write carried ${seen.auth}, not ${token}`);
  return hold;
};

async function runRecovery(k) {
  await recoveryCase(k, "A2", "Expired or invalid recovery link: failure copy, no write, a way back to sign-in", { tokens: [], users: [], async run(s, fail) {
    await s.page.goto(APP + "/" + EXPIRED);
    if (!(await visible(s.page, LINK_FAILED))) fail("the expired-link notice did not show");
    if (!(await absent(s.page, "Choose a new password"))) fail("a reset form opened for a dead link");
    await s.page.getByRole("button", { name: "Back to sign in", exact: true }).click();
    await s.page.waitForSelector('input[type="password"]', { timeout: 8000 }).catch(() => fail("no sign-in form after Back to sign in"));
    if (!(await absent(s.page, LINK_FAILED))) fail("the notice stayed after leaving it");
    if (puts(s).length) fail("a password write was sent for an expired link");
    if (countOf(s, (r) => r.path === "/auth/v1/token")) fail("a sign-in was attempted by itself");
    return "notice shown, no form, back at sign-in, 0 password writes, 0 sign-ins";
  } });
  await recoveryCase(k, "A3", "Valid synthetic recovery: the real form, one held write, success once, the authorized app, and the daily backup once AFTER the reset", { tokens: ["token-rec"], writeRules: afterReset("after-completion"), async run(s, fail) {
    const hold = await startHeldSave(s, fail); if (!hold) return;
    if (!(await visible(s.page, "Saving"))) fail("the button did not show Saving while the write was held");
    const body = JSON.parse(hold.hit.body || "{}");
    if (body.password !== NEW_PASSWORD || Object.keys(body).length !== 1) fail("the write body is not exactly the typed password: keys " + Object.keys(body).join(","));
    if (puts(s).length !== 1) fail(`expected exactly 1 write while held, saw ${puts(s).length}`);
    s.backend.phase = "after-completion";   // a write before this point (while the password write is held) has the wrong phase and is refused
    hold.release();
    await s.page.waitForSelector(".topbar, .assoc-card, .bp-row", { timeout: 40000 }).catch(() => fail("the app did not open after the save"));
    await s.page.waitForTimeout(2500);
    if (puts(s).length !== 1) fail(`success was followed by extra writes: ${puts(s).length}`);
    if (!(await absent(s.page, "Choose a new password"))) fail("the reset form stayed up after success");
    if (logouts(s)) fail("a logout was sent");
    return "1 write with the recovery token, body only the password, app opened, form gone";
  } });
  await recoveryCase(k, "A4", "Interrupt an in-flight reset (synthetic persisted pagehide, then a real reload): notice, no restored authority, no retry, no email", { tokens: ["token-rec"], async run(s, fail) {
    const hold = await startHeldSave(s, fail); if (!hold) return;
    await s.page.evaluate(() => window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true })));
    const w1 = summarize(await watchScreen(s.page, 3000)); timelines.push({ step: "after the persisted pagehide", ...w1 });
    if (!w1.interruptedAtEnd) fail("the interruption notice did not show after a persisted pagehide");
    if (w1.formAtEnd) fail("the reset form is still up after the interruption");
    if (puts(s).length !== 1) fail(`a retry or a second write followed the interruption: ${puts(s).length}`);
    await s.page.reload();
    const w2 = summarize(await watchScreen(s.page, 4000)); timelines.push({ step: "after a real reload", ...w2 });
    if (!w2.interruptedAtEnd) fail("after a real reload the interruption notice was not restored from the marker");
    if (w2.formAtEnd) fail("the marker brought the reset form back");
    if (puts(s).length !== 1) fail(`the restored marker caused a write: ${puts(s).length} total`);
    if (logouts(s)) fail("a logout was sent");
    return "notice after the event and again after a reload; form never returned; 1 write total; 0 emails; 0 logouts. This is a synthetic persisted-pagehide event plus a real reload, not a BFCache proof.";
  } });
  await recoveryCase(k, "A5", "Release the late first-attempt response after the interruption: nothing resurrected, no write during it, the notice exit adds no password write or logout, and the daily backup once after the exit", { tokens: ["token-rec"], writeRules: afterReset("after-exit"), async run(s, fail) {
    const hold = await startHeldSave(s, fail); if (!hold) return;
    await s.page.evaluate(() => window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true })));
    if (!(await visible(s.page, INTERRUPTED))) fail("the interruption notice did not show");
    hold.release();
    const w3 = summarize(await watchScreen(s.page, 3000)); timelines.push({ step: "after the late response was released", ...w3 });
    if (!w3.interruptedAtEnd) fail("the late response replaced the interruption notice");
    if (w3.formAtEnd || w3.formFirstMs !== null) fail("the late response brought the reset form back (seen at " + w3.formFirstMs + " ms)");
    if (puts(s).length !== 1) fail(`writes after the late response: ${puts(s).length}`);
    s.backend.phase = "after-exit";
    await s.page.getByRole("button", { name: "Continue without resetting", exact: true }).click();
    await s.page.waitForTimeout(4000);
    if (!(await absent(s.page, INTERRUPTED))) fail("the notice stayed after Continue without resetting");
    if (puts(s).length !== 1) fail("the notice exit sent a write");
    if (logouts(s)) fail("the notice exit sent a logout");
    return "late response ignored; notice kept until the explicit exit; 1 write, 0 logouts, 0 emails";
  } });
  await recoveryCase(k, "A6", "Same-user replacement while the first attempt is held: the stale completion cannot bind the new recovery, and no backup runs until the second reset completes", { tokens: ["token-rec", "token-rec2"], writeRules: afterReset("after-completion"), async run(s, fail) {
    const hold = await startHeldSave(s, fail); if (!hold) return;
    /* The SDK's own stored session moves first (a new link does that), then the event is posted on its channel: posting the event alone leaves getSession() on the old token, which the app correctly refuses to bind to (seen in run cases-rec9). */
    await s.page.evaluate(([session]) => { localStorage.setItem("lpc-auth", JSON.stringify(session)); const ch = new BroadcastChannel("lpc-auth"); ch.postMessage({ event: "PASSWORD_RECOVERY", session }); ch.close(); }, [s.backend.session(USER_A)].map((x) => ({ ...x, access_token: "token-rec2", refresh_token: "refresh-token-rec2" })));
    const w1 = summarize(await watchScreen(s.page, 2500)); timelines.push({ step: "after the same-user PASSWORD_RECOVERY replacement (first write still held)", ...w1 });
    hold.release();
    const w2 = summarize(await watchScreen(s.page, 3000)); timelines.push({ step: "after the first write was released", ...w2 });
    if (puts(s).length !== 1) fail(`writes after the release: ${puts(s).length}`);
    const layerUp = async () => (await s.page.locator(".signin-over").count()) > 0;
    const notice1 = w1.interruptedAtEnd || w1.failedAtEnd, notice2 = w2.interruptedAtEnd || w2.failedAtEnd;
    if (w1.formAtEnd) {
      /* Positive branch: the replacement opened a new recovery. The stale completion must not have consumed it, and only a second save may arrive. */
      if (!w2.formAtEnd) fail("the stale completion took the new recovery's form away without a second save");
      if (w2.savingAtEnd) fail("the new form is stuck on Saving after the stale response");
      if (!(await layerUp())) fail("the app was entered without the second save (sign-in layer gone after the stale release)");
      const second = await heldSecondSave(s, fail, "A6 second save");
      await s.page.waitForTimeout(3000);
      const ps = puts(s);
      if (ps.length !== 2 || ps[0].auth !== "token-rec" || ps[1].auth !== "token-rec2") fail(`expected one write per recovery, token-rec then token-rec2: ${JSON.stringify(ps.map((p) => p.auth))}`);
      return "branch: new form. The replacement opened a new form, the release did not complete it, the second save wrote once with the new token and then arrived";
    }
    /* Refusal branch: the replacement did not open a form. That is acceptable only as a stable refusal: a notice before and after the release, no form at any sample, no arrival, no new write. */
    if (!notice1) { fail("after the replacement the screen shows neither a reset form nor a notice"); return; }
    if (!notice2 || w2.formAtEnd || w2.formFirstMs !== null) fail("after the release the notice did not hold, or a form appeared: " + JSON.stringify({ notice2, formFirstMs: w2.formFirstMs }));
    if (!(await layerUp())) fail("the app was entered after a refused replacement (sign-in layer gone)");
    if (puts(s).length !== 1) fail(`a write followed the refused replacement: ${puts(s).length}`);
    return "branch: refusal. Notice " + (w1.interruptedAtEnd ? "(interrupted)" : "(link failed)") + " before and after the release, no form, no arrival, 1 write";
  } });
  await recoveryCase(k, "A7", "Account replacement through the SDK's storage key and channel while a reset is held: A cannot be restored, B is not written as A", { tokens: ["token-rec"], users: [{ id: USER_B, token: "token-b", email: "dev@example.test", profile: { name: "Dev Okonjo", role: "associate", wants: "associate" }, link: "__DEV__" }], async run(s, fail) {
    const dev = (await import("./demo-seed.mjs")).buildDemo().roster.find((r) => r.name === "Dev Okonjo");
    const link = s.backend.tables.floor_people.find((r) => r.person_id === "__DEV__"); if (link) link.person_id = dev.id;
    const hold = await startHeldSave(s, fail); if (!hold) return;
    const B = s.backend.session(USER_B); B.access_token = "token-b";
    const replaceFrom = s.backend.requests.length;   // an index, not a clock: the held write and the replacement can share a millisecond
    const other = await s.ctx.newPage();
    await other.goto(APP + "/__harness/blank.html");
    await other.evaluate(([session]) => { localStorage.setItem("lpc-auth", JSON.stringify(session)); const ch = new BroadcastChannel("lpc-auth"); ch.postMessage({ event: "SIGNED_IN", session }); ch.close(); }, [B]);
    await s.page.waitForTimeout(1500);
    hold.release();
    await s.page.waitForTimeout(3000);
    if (puts(s).length !== 1) fail(`writes after the replacement: ${puts(s).length}`);
    if (puts(s)[0] && puts(s)[0].auth !== "token-rec") fail("the only write was not A's");
    if (!(await absent(s.page, "Choose a new password"))) fail("A's reset form is still up after B replaced A");
    if (!(await visible(s.page, LINK_FAILED, 3000))) fail("no notice that the link no longer applies");
    await s.page.getByRole("button", { name: "Back to sign in", exact: true }).click().catch(() => fail("no way out of the recovery overlay"));
    await other.close();
    /* Positive proof that B, and only B, is now using the app: B's corner is on screen, the manager chrome is not, and every read after the replacement was made as B about B. */
    try { await s.page.locator(".mc").first().waitFor({ state: "visible", timeout: 30000 }); } catch (e) { fail("B's corner never appeared after the overlay was dismissed"); }
    await s.page.waitForTimeout(2500);
    if (await s.page.locator(".topbar").count()) fail("manager chrome is on screen for an associate");
    if (await s.page.locator(".signin-over").count()) fail("a sign-in layer is still over the app");
    const body = (await s.page.locator("body").innerText()).replace(/\s+/g, " ");
    if (!/Your corner is ready|Calls OF|POINTS/.test(body) && !(await s.page.locator(".mc").count())) fail("no corner content");
    const after = s.backend.requests.slice(replaceFrom);
    const asA = after.filter((r) => r.auth === "token-rec" || r.auth === "synthetic-token-" + USER_A);
    if (asA.length) fail("requests were made as A after B replaced A: " + asA.map((r) => `${r.method} ${r.path}`).join(", "));
    const profileAsB = after.filter((r) => r.path === "/rest/v1/profiles" && r.query.includes("id=eq." + USER_B));
    const linkAsB = after.filter((r) => r.path === "/rest/v1/floor_people" && r.query.includes("user_id=eq." + USER_B));
    const schedAsB = after.filter((r) => r.path === "/rest/v1/rpc/sage_schedule_read" && r.auth === "token-b");
    const profAll = after.filter((r) => r.path === "/rest/v1/profiles"), linkAll = after.filter((r) => r.path === "/rest/v1/floor_people");
    const notB = profAll.concat(linkAll).filter((r) => r.auth !== "token-b");
    if (notB.length) fail("a profile or linked-staff read after the replacement did not carry B's token: " + notB.map((r) => `${r.path} as ${r.auth || "no token"}`).join(", "));
    if (profileAsB.length !== profAll.length || (linkAsB.length !== linkAll.length)) fail("a profile or link read after the replacement was not for B's own id");
    if (!profileAsB.length) fail("B's profile was never read as B");
    if (!linkAsB.length) fail("B's linked-staff row was never read as B");
    if (!schedAsB.length) fail("B's own schedule was never requested as B");
    const subj = schedAsB.map((r) => { try { return JSON.parse(r.response || "null"); } catch (e) { return null; } });
    if (subj.length && subj.some((x) => !x || x.subject !== dev.id)) fail("B's schedule read did not answer for B's linked person: " + JSON.stringify(subj[0]));
    if (puts(s).length !== 1) fail("dismissing the overlay sent a write");
    return `B is on screen: corner visible, no manager chrome, no sign-in layer; after the replacement ${profileAsB.length} profile read(s), ${linkAsB.length} link read(s) and ${schedAsB.length} schedule read(s) were all made as B, 0 requests as A`;
  } });
}


/* ---- the schedule cases: linked staff reading their own published schedule (A8, A9) and a pending account (A10) ---- */
const BANNERS = { unpublished: "Your schedule has not been published.", forbidden: "Schedule access requires account approval.", unavailable: "Your schedule is unavailable. Trying again." };
async function scheduleCase(k, id, title, { pending = false, publish = null, expectBanner, expectKnown }) {
  if (!want(id)) return;
  const { buildDemo } = await import("./demo-seed.mjs");
  const roster = buildDemo().roster;
  const me = roster.find((r) => r.name === "Dev Okonjo"), other = roster.find((r) => r.name === "Marisol Vantry");
  const s = await newSession(k, { role: "associate", name: "Dev Okonjo", extra: { noStated: true, profile: { wants: "associate", pending } } }, { logName: id });
  const failures = [], fail = (m) => failures.push(m);
  let note = "";
  try {
    s.backend.addUser({ id: USER_A, token: "synthetic-token-" + USER_A, email: "demo@sageonline.app", link: me.id });
    if (publish) {
      const now = new Date();
      for (const delta of [-1, 0, 1]) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1)); const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        s.backend.publications[`sage-demo:${m}`] = publish(m, me.id, other.id);
      }
    }
    appCalls.length = 0;
    await signIn(s.page).catch(() => {});
    await s.page.waitForTimeout(6000);
    const text = (await s.page.locator("body").innerText()).replace(/\s+/g, " ");
    const reads = s.backend.requests.filter((r) => r.path === "/rest/v1/rpc/sage_schedule_read");
    const bodies = reads.map((r) => JSON.parse(r.body || "{}"));
    if (!reads.length) fail("the corner never asked for the schedule");
    for (const b of bodies) {
      if (JSON.stringify(Object.keys(b).sort()) !== JSON.stringify(["p_month", "p_store"]) || b.p_store !== "sage-demo" || !/^\d{4}-\d{2}$/.test(b.p_month)) fail("schedule read body is not exactly { p_store, p_month }: " + JSON.stringify(b));
    }
    const floorReads = appCalls.filter((c) => c.path === "/api/floor-row").map((c) => JSON.parse(c.body || "{}"));
    if (!floorReads.length) fail("no floor-row read: floor participation was not exercised");
    for (const b of floorReads) if (b.op !== "read" || b.store !== "sage-demo" || !["floor", "line", "online"].includes(b.room) || b.view !== "own" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) fail("floor-row body is not the own-floor read shape: " + JSON.stringify(b));
    if (bodies[0] && floorReads[0] && bodies[0].p_month !== floorReads[0].date.slice(0, 7)) fail(`schedule month ${bodies[0].p_month} differs from the floor day's month ${floorReads[0].date}`);
    if (s.backend.requests.some((r) => /sage_schedule_publish/.test(r.path))) fail("a publication was attempted");
    if (bodies.some((b) => b.p_view === "manager")) fail("the manager view of the schedule was requested");
    const leak = reads.map((r) => r.response || "").filter((t) => t.includes(other.id));
    if (leak.length) fail("another person's identity or dates appeared in a response to this account");
    if (text.includes(other.id)) fail("another person's id is in the page");
    const shown = Object.entries(BANNERS).filter(([, t]) => text.includes(t)).map(([name]) => name);
    if (expectBanner) { if (!shown.includes(expectBanner) || shown.length !== 1) fail(`banner: saw ${JSON.stringify(shown)}, expected only ${expectBanner}`); }
    else if (shown.length) fail("a not-published, denied or unavailable banner is showing on a valid published schedule: " + shown.join(","));
    const states = reads.map((r) => { try { return JSON.parse(r.response || "null"); } catch (e) { return null; } });
    if (expectKnown === "published") { if (!states.length || states.some((x) => !x || x.state !== "published" || x.subject !== me.id || Object.keys(x.people || {}).join() !== me.id)) fail("response is not a published own-only entry: " + JSON.stringify(states)); if (/Unavailable/.test(await s.page.locator(".mc-num").first().innerText().catch(() => ""))) fail("the schedule-dependent figure still reads Unavailable"); }
    if (expectKnown === "unpublished" && states.some((x) => !x || x.state !== "unpublished" || x.subject !== me.id)) fail("response is not the unpublished shape: " + JSON.stringify(states));
    if (pending) {
      /* Exactly what a pending account is refused with: HTTP 403 and SQLSTATE 42501 on every schedule read, and none of them an answer. Read-only UI evidence: no floor tap and no management control is attempted here. */
      const refusals = reads.map((r) => { try { return JSON.parse(r.response || "null"); } catch (e) { return null; } });
      if (!refusals.length || refusals.some((x) => !x || x.status !== 403 || x.code !== "42501")) fail("a schedule read for a pending account was not refused with 403 / 42501: " + JSON.stringify(refusals.slice(0, 2)));
      if (await s.page.locator(".topbar").count()) fail("a pending account is looking at manager chrome");
    }
    if (s.backend.unexpected.length) fail("requests outside the synthetic contract: " + [...new Set(s.backend.unexpected.map((u) => `${u.method} ${u.path}`))].join(", "));
    if (stray(s.log).length) fail("refused traffic that was not the synthetic realtime socket: " + JSON.stringify(stray(s.log)));
        for (const p of appProblems(s)) fail(p);
        if (realProblems(s, { denied: pending ? reads.length : 0 }).length) fail("page or console errors: " + realProblems(s, { denied: pending ? reads.length : 0 }).slice(0, 3).join(" | "));
    await s.page.screenshot({ path: path.join(OUT, `${id}-final.png`) });
    await writeFile(path.join(OUT, `${id}-final.txt`), text.slice(0, 2500));
    const audit = await k.auditRenderers(id);
    note = `schedule reads: ${reads.length} (bodies exactly {p_store,p_month}); responses: ${[...new Set(states.map((x) => x && x.state ? x.state : "denied"))].join(",")}; floor-row reads: ${floorReads.length} (own view); banners shown: ${JSON.stringify(shown)}; renderers audited after the app loaded: ${audit.length}`;
    record({ id, title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") || note, evidence: { requestCounts: countBy(s.backend.requests), scheduleBodies: bodies, floorReads, shown, statesSeen: states } });
  } catch (e) { record({ id, title, status: "FAIL", detail: failures.concat(["did not finish: " + String(e).split("\n")[0].slice(0, 300)]).join("\n") }, true); try { await keepStopped(s, id); } catch (e2) {} }
  finally { await s.close(); }
}
async function runSchedule(k) {
  await scheduleCase(k, "A8", "Approved linked staff, unpublished schedule: correct request shapes, an explicit not-published state, nothing private", { publish: (m, me, other) => ({ revision: 3, sourceRevision: 9, publishedAt: "2026-10-01T00:00:00Z", people: { [other]: { offDates: [m + "-28"] } } }), expectBanner: "unpublished", expectKnown: "unpublished" });
  await scheduleCase(k, "A9", "Approved linked staff, published-empty schedule: a valid empty publication is not the denied or unavailable state", { publish: (m, me, other) => ({ revision: 4, sourceRevision: 9, publishedAt: "2026-10-01T00:00:00Z", people: { [me]: { offDates: [] }, [other]: { offDates: [m + "-28"] } } }), expectBanner: null, expectKnown: "published" });
  await scheduleCase(k, "A10", "Pending linked staff: the floor still works, the schedule is denied, no management", { pending: true, publish: (m, me, other) => ({ revision: 4, sourceRevision: 9, publishedAt: "2026-10-01T00:00:00Z", people: { [me]: { offDates: [m + "-27"] }, [other]: { offDates: [m + "-28"] } } }), expectBanner: "forbidden", expectKnown: null });
}


/* ---- the backup cases: a running backup must stop at an account change or a new recovery, and the entry must not be lost ---- */
const STORE_BACKUP_WRITE = (e) => e.method === "POST" && e.path === "/rest/v1/app_data" && /"key":"lpc:backup:sage-demo:/.test(e.body);
const storeBackupRule = (phase, auth) => ({ table: "app_data", method: "POST", key: new RegExp(`^lpc:backup:sage-demo:${TS}:v1$`), auth, phase, min: 1, max: 1 });
async function backupCase(k, id, title, setup) {
  if (!want(id)) return;
  const { buildDemo } = await import("./demo-seed.mjs");
  const dev = buildDemo().roster.find((r) => r.name === "Dev Okonjo");
  const s = await newSession(k, { role: "admin", name: "Alex Reyner", extra: { noStated: true } }, { logName: id });
  const failures = [], fail = (m) => failures.push(m);
  let note = "";
  try {
    s.backend.addUser({ id: USER_A, token: "token-rec2", email: "demo@sageonline.app" });
    s.backend.addUser({ id: USER_B, token: "token-b", email: "dev@example.test", profile: { name: "Dev Okonjo", role: "associate", wants: "associate" }, link: dev.id });
    note = (await setup(s, fail, dev)) || "";
    if (s.backend.unexpected.length) fail("requests outside the synthetic contract: " + s.backend.unexpected.map((u) => `${u.method} ${u.path} ${u.why || ""}`).join(", "));
    const um = s.backend.writePolicy.unmet ? s.backend.writePolicy.unmet() : []; for (const m of um) fail("an expected write did not happen: " + m);
    if (stray(s.log).length) fail("refused traffic that was not the synthetic realtime socket: " + JSON.stringify(stray(s.log)));
    if (realProblems(s, { denied: s.backend.unexpected.length }).length) fail("page or console errors: " + realProblems(s, { denied: s.backend.unexpected.length }).slice(0, 3).join(" | "));
    for (const p of appProblems(s)) fail(p);
    await k.auditRenderers(id);
    if (failures.length) await keepStopped(s, id);
  } catch (e) { failures.push("did not finish: " + String(e).split("\n")[0].slice(0, 300)); try { await keepStopped(s, id); } catch (e2) {} }
  const keysWritten = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data").map((r) => ({ key: (r.body.match(/"key":"([^"]+)"/) || [])[1].replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<ts>"), auth: r.auth, phase: r.phase }));
  record({ id, title, status: failures.length ? "FAIL" : "PASS", detail: failures.join("\n") || note, evidence: { requestCounts: countBy(s.backend.requests), tableWrites: keysWritten, timelines: timelines.splice(0) } });
  await s.close();
}
async function runBackups(k) {
  await backupCase(k, "A11", "Account replaced while the daily backup is mid-flight: the old run dispatches nothing more, and B is the one on screen", async (s, fail, dev) => {
    s.backend.phase = "pre-replacement";
    s.backend.writePolicy = makePolicy([storeBackupRule("pre-replacement", /^synthetic-token-/)]);   // the one store snapshot that was already out; nothing else is approved
    const hold = s.backend.hold(STORE_BACKUP_WRITE);
    await signIn(s.page).catch(() => {});
    const seen = await Promise.race([hold.seen, new Promise((r) => setTimeout(() => r(null), 15000))]);
    if (!seen) { fail("the daily backup never started"); return; }
    const replaceFrom = s.backend.requests.length;
    const B = s.backend.session(USER_B); B.access_token = "token-b";
    const other = await s.ctx.newPage(); await other.goto(APP + "/__harness/blank.html");
    s.backend.phase = "after-replacement";
    await other.evaluate(([session]) => { localStorage.setItem("lpc-auth", JSON.stringify(session)); const ch = new BroadcastChannel("lpc-auth"); ch.postMessage({ event: "SIGNED_IN", session }); ch.close(); }, [B]);
    await s.page.waitForTimeout(1500);
    hold.release();
    try { await s.page.locator(".mc").first().waitFor({ state: "visible", timeout: 30000 }); } catch (e) { fail("B's corner never appeared"); }
    await s.page.waitForTimeout(4000); await other.close();
    const writes = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data");
    if (writes.length !== 1) fail(`expected exactly the one store snapshot already in flight, saw ${writes.length} table write(s)`);
    if (s.backend.requests.some((r) => /lpc:config:backup|backups-index/.test(r.body || "") && r.method === "POST")) fail("the settings snapshot or the index was written after the account changed");
    const after = s.backend.requests.slice(replaceFrom);
    const asA = after.filter((r) => /^synthetic-token-/.test(r.auth) && r.method !== "GET" && r.method !== "OPTIONS" && !STORE_BACKUP_WRITE(r));
    if (asA.length) fail("A made writes after B replaced A: " + asA.map((r) => `${r.method} ${r.path}`).join(", "));
    const notB = after.filter((r) => (r.path === "/rest/v1/profiles" || r.path === "/rest/v1/floor_people") && r.auth !== "token-b");
    if (notB.length) fail("a profile or link read after the replacement did not carry B's token");
    if (await s.page.locator(".topbar").count()) fail("manager chrome is still on screen for B, an associate");
    return `one table write in flight (A's store snapshot), then none; B's corner on screen; ${after.filter((r) => r.auth === "token-b").length} requests as B`;
  });
  await backupCase(k, "A12", "A new recovery arrives while the daily backup is mid-flight: no more writes during the reset, and one complete backup after it", async (s, fail) => {
    s.backend.phase = "pre-recovery";
    s.backend.writePolicy = makePolicy([storeBackupRule("pre-recovery", /^synthetic-token-/), ...backupRules(/^token-rec2$/).map((r) => ({ ...r, phase: "after-completion" }))]);
    const hold = s.backend.hold(STORE_BACKUP_WRITE);
    await signIn(s.page).catch(() => {});
    const seen = await Promise.race([hold.seen, new Promise((r) => setTimeout(() => r(null), 15000))]);
    if (!seen) { fail("the daily backup never started"); return; }
    const session2 = { ...s.backend.session(USER_A), access_token: "token-rec2", refresh_token: "refresh-token-rec2" };
    s.backend.phase = "during-recovery";
    await s.page.evaluate(([session]) => { localStorage.setItem("lpc-auth", JSON.stringify(session)); const ch = new BroadcastChannel("lpc-auth"); ch.postMessage({ event: "PASSWORD_RECOVERY", session }); ch.close(); }, [session2]);
    if (!(await visible(s.page, "Choose a new password", 15000))) { fail("the reset form did not open"); return; }
    await closeRoundup(s.page, "A12");
    hold.release();
    await s.page.waitForTimeout(4000);
    const during = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data");
    if (during.length !== 1) fail(`expected only the store snapshot already in flight while the reset is open, saw ${during.length} table write(s)`);
    const second = await heldSecondSave(s, fail, "A12 second save");
    await s.page.waitForTimeout(6000);
    const all = s.backend.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/app_data").map((r) => (r.body.match(/"key":"([^"]+)"/) || [])[1].replace(/\d{4}-\d\d-\d\dT[\d-]+Z/, "<ts>"));
    const wanted = ["lpc:backup:sage-demo:<ts>:v1", "lpc:backup:sage-demo:<ts>:v1", "lpc:config:backup:<ts>:v1", "lpc:config:backups-index:v1"];
    if (JSON.stringify(all) !== JSON.stringify(wanted)) fail("table writes were " + JSON.stringify(all) + ", expected the stopped run's one snapshot, then one complete backup after the reset");
    if (puts(s).length !== 1 || puts(s)[0].auth !== "token-rec2") fail("expected one password write with the new recovery token: " + JSON.stringify(puts(s).map((p) => p.auth)));
    return "stopped run: 1 snapshot dispatched, then nothing while the reset was open; after the reset: one complete backup (snapshot, settings, index) as the recovery session; characterization: the stopped run's snapshot row stays until a later prune";
  });
}

/* ---- run ---- */
/* Fail closed. A group of cases that does not finish in its time, a case that is missing, a renderer audit that never ran, a pin that was asked for and not met, or a driver
   that is not the one named: each is a failed run, never a quieter pass. The deadline writes what exists so far, then exits 1. */
const GROUP_MS = Number(process.env.STRICT_GROUP_TIMEOUT_MS || 150_000), DEADLINE_MS = Number(process.env.STRICT_DEADLINE_MS || 480_000);
const EXPECTED_IDS = ["A1", ...XC.map((c) => c.id), "XC-reopen", "XC-session", "XC-renderers", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"];
const rendererAudits = [];
const PINS_COMPLETE = (() => { try { const p = pinsFromEnv(); return !!(p.playwright && p.chrome && p.cdpSuffix); } catch (e) { return false; } })();   // local runs set no pins: they are evidence about the local browser only
let k = null, auditCalls = 0, diagnostics = null, finished = false, deadlineHit = false, cleanup = null;
/* One cleanup for the whole run (scripts/strict-cleanup.mjs): created when first needed so it knows whether the kit launched; the end of the run and the deadline share it. */
const makeCleanup = () => (cleanup = cleanup || createCleanup({ closeKit: k ? () => k.close() : null, closeServer: () => new Promise((resolve, reject) => appServer.close((e) => (e ? reject(e) : resolve()))) }));
const summary = (extra = {}) => ({ when: new Date().toISOString(), expect: EXPECT, countsAsRepairResult: EXPECT === "corrected" && !WRITE_PROBE, qualifying: !WRITE_PROBE && PINS_COMPLETE && !!diagnostics, evidenceKind: PINS_COMPLETE ? "pinned-run" : "local-unpinned-run", pinsComplete: PINS_COMPLETE, writeProbe: WRITE_PROBE, dist: DIST, browser: k ? k.evidence : null, auditCalls, rendererAudits, diagnostics, deadlineExceeded: deadlineHit, cleanup: cleanup ? cleanup.outcome() : null, roundupDrawnOverResetForm: roundupCovered.length, expectedIds: ONLY ? null : EXPECTED_IDS, results, ...extra });
/* The end-of-run annotation reads the same facts the exit expression reads, as booleans. It decides nothing and cannot throw. */
const annotateEnd = (exception) => { try { const passed = new Set(results.filter((r) => r.status === "PASS").map((r) => r.id)); note.terminal({ failed: results.some((r) => r.status === "FAIL"), skipped: results.some((r) => r.status === "NOT RUN"), missing: !ONLY && EXPECTED_IDS.some((id) => !passed.has(id)), audit: auditCalls > 0, deadline: deadlineHit, exception: exception === true, probe: WRITE_PROBE, only: !!ONLY, results }); } catch (e) {} };
const deadline = setTimeout(async () => {
  if (finished) return;
  deadlineHit = true;
  try { note.runDeadline(); annotateEnd(false); } catch (e) {}
  console.error(`DEADLINE: the run did not finish in ${DEADLINE_MS} ms`);
  try { await makeCleanup().close(); } catch (e) {}
  try { fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(summary(), null, 2) + "\n"); } catch (e) {}
  process.exit(1);
}, DEADLINE_MS);
/* done is set when the group settles, so a group timer that fires later, after the group already finished, is not reported as a deadline. */
const bounded = (name, fn) => { const run = fn(); let done = false; run.then(() => { done = true; }, () => { done = true; }); return Promise.race([run, new Promise((_, reject) => setTimeout(() => { if (!done) { try { note.groupDeadline(name); } catch (e) {} } reject(new Error(`group ${name} did not finish in ${GROUP_MS} ms`)); }, GROUP_MS))]); };

let exitCode = 0;
try {
  k = await launchStrict({ driver: opt("driver"), expect: pinsFromEnv() });
  note.phase("KIT_LAUNCHED");
  const realAudit = k.auditRenderers; k.auditRenderers = async (label = "unlabelled") => { const r = await realAudit(); auditCalls++; rendererAudits.push({ label, at: new Date().toISOString(), renderers: r.map((x) => ({ pid: x.pid, Seccomp: x.Seccomp, NoNewPrivs: x.NoNewPrivs, CapEff: x.CapEff, NSpid: x.NSpid, bypassArgv: false })) }); return r; };
  if (process.env.STRICT_REQUIRE_DIAGNOSTICS === "1") { diagnostics = await sandboxDiagnostics(k.browser); console.log("chrome://sandbox diagnostics verified"); note.phase("DIAGNOSTICS_OK"); }
  for (const [name, fn] of [["login", case1], ["cross-check", runCrossCheck], ["recovery", runRecovery], ["backup", runBackups], ["schedule", runSchedule]]) { note.group(name); await bounded(name, () => fn(k)); }
  note.phase("CASES_END");
} catch (e) { console.error("RUNNER ERROR", e); exitCode = 1; try { note.runnerException(); } catch (e2) {} record({ id: "RUNNER", title: "The run itself", status: "FAIL", detail: String(e && e.message || e).slice(0, 500) }, !note.groupDeadlineFired()); }
finally {
  finished = true; clearTimeout(deadline);
  if (WRITE_PROBE) try { await writeFile(path.join(OUT, "write-probe.json"), JSON.stringify(probeWrites, null, 2) + "\n"); } catch (e) {}
  /* Close first, once; the result is written only AFTER it, so it carries the cleanup outcome. A cleanup that failed, timed out or never completed is a failed run. */
  await makeCleanup().close();
  if (cleanupFailed(cleanup.outcome())) { exitCode = 1; console.error("CLEANUP FAILED: " + cleanup.outcome().reasons.join(", ")); }
  try { await writeFile(path.join(OUT, "result.json"), JSON.stringify(summary(), null, 2) + "\n"); } catch (e) { console.error("could not write result.json", e); exitCode = 1; }
}
const failed = results.filter((r) => r.status === "FAIL").length, skipped = results.filter((r) => r.status === "NOT RUN").length;
const passedIds = new Set(results.filter((r) => r.status === "PASS").map((r) => r.id));
const missing = ONLY ? [] : EXPECTED_IDS.filter((id) => !passedIds.has(id));
if (missing.length) console.error("MISSING OR NOT PASSING: " + missing.join(", "));
if (!auditCalls) console.error("NO RENDERER AUDIT RAN: no proof the application renderers were sandboxed");
annotateEnd(exitCode !== 0 && !note.groupDeadlineFired());
console.log(`\n${passedIds.size} passed, ${failed} failed, ${skipped} not run (${EXPECT})${EXPECT === "baseline" ? " - CHARACTERIZATION of the unmodified head, never a repair result" : ""}`);
if (WRITE_PROBE) console.error("NON-QUALIFYING: STRICT_WRITE_PROBE run (every table write allowed); discovery output only");
process.exit(WRITE_PROBE || failed || skipped || exitCode || missing.length || !auditCalls ? 1 : 0);

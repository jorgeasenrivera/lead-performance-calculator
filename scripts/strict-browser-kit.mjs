/* Strict-sandbox browser kit for the synthetic application cases.
 *
 * NEW work for PR 501 (27 October 2026). This is not a recovery of any earlier file: the original unpublished harness bytes were not available.
 * Its sandbox rules are adapted from the reviewed public baseline, scripts/browser-sandbox-qualification.mjs at PR 500 head 79afba4c4575220b31a82cdf3e869753d9623760,
 * which qualified only a hosted VM and a synthetic fixture and never the application. Changed on purpose: the same checks are exported as functions so they can be
 * tested and reused by the application cases, a root session can run the browser as an existing unprivileged user, and the network is an exact allowlist, not
 * "abort everything".
 *
 * Rules that are never relaxed here: Chromium always launches with chromiumSandbox: true; nothing in this file launches without it or falls back to it;
 * the browser's real command line (kernel argv and the browser's own report) is read and refused if it carries any sandbox bypass; every renderer found is read
 * from /proc and must have seccomp filtering, no new privileges, no effective capabilities and a deeper PID namespace than the browser. Absent evidence fails closed.
 * A launch failure is reported, never worked around.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const BYPASS_ARGUMENT = /^--(?:no-sandbox|disable-.*sandbox|disable-seccomp-filter-sandbox|single-process|no-zygote)(?:=|$)/;

export function rejectBypass(argv) {
  assert(Array.isArray(argv) && argv.length > 0, "No browser argv evidence");
  assert(!argv.some((arg) => BYPASS_ARGUMENT.test(arg)), "Sandbox bypass argument present");
}

export function parseProcStatus(text) {
  return Object.fromEntries(String(text).trim().split("\n").map((line) => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
}

/* What one process must look like. `browserNSpid` is the browser's NSpid list; a sandboxed renderer sits in a deeper PID namespace than the browser. */
export function checkRenderer(evidence, browserNSpid) {
  assert.equal(evidence.Seccomp, "2", "Renderer lacks seccomp filtering");
  assert.equal(evidence.NoNewPrivs, "1", "Renderer can gain privileges");
  assert(typeof evidence.CapEff === "string" && /^0+$/.test(evidence.CapEff), "Renderer has effective capabilities");
  assert(Array.isArray(evidence.NSpid) && Array.isArray(browserNSpid) && evidence.NSpid.length > browserNSpid.length, "Renderer lacks nested PID namespace");
  return true;
}

export async function processEvidence(pid, readFileImpl = readFile) {
  const fields = parseProcStatus(await readFileImpl(`/proc/${pid}/status`, "utf8"));
  const argv = (await readFileImpl(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
  rejectBypass(argv);
  return { pid, argv, NoNewPrivs: fields.NoNewPrivs, Seccomp: fields.Seccomp, CapEff: fields.CapEff, NSpid: fields.NSpid?.split(/\s+/) };
}

/* ---- the pins (CI) and the browser's own sandbox page ---- */
/* The hosted run pins the driver, the browser and the whole of the browser's startup suffix. With STRICT_REQUIRE_PINS=1 a missing pin is a failure, not a quieter run:
   no proof means no pass. Locally the pins are optional and the run says so (cdpArgvPinned: false). */
export function pinsFromEnv(env = process.env) {
  const pins = {};
  if (env.STRICT_EXPECT_PLAYWRIGHT) pins.playwright = env.STRICT_EXPECT_PLAYWRIGHT;
  if (env.STRICT_EXPECT_CHROME) pins.chrome = env.STRICT_EXPECT_CHROME;
  if (env.STRICT_EXPECT_CDP_SUFFIX) {
    const suffix = JSON.parse(env.STRICT_EXPECT_CDP_SUFFIX);
    assert(Array.isArray(suffix) && suffix.length > 0 && suffix.every((x) => typeof x === "string"), "STRICT_EXPECT_CDP_SUFFIX must be a JSON array of strings");
    pins.cdpSuffix = suffix;
  }
  if (env.STRICT_REQUIRE_PINS === "1") for (const k of ["playwright", "chrome", "cdpSuffix"]) assert(pins[k], `Pin missing while STRICT_REQUIRE_PINS=1: ${k}`);
  return pins;
}

/* The text chrome://sandbox shows. Pure, so it can be tested with text that is wrong as well as text that is right. */
export function checkSandboxText(text) {
  assert(/^Layer 1 Sandbox\s+Namespace\s*$/m.test(String(text)), "Layer 1 sandbox is not Namespace");
  for (const label of ["PID namespaces", "Network namespaces", "Seccomp-BPF sandbox"]) assert(new RegExp(`${label}\\s+Yes`, "i").test(String(text)), `Missing effective ${label}`);
  return true;
}
export async function sandboxDiagnostics(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    await context.route("**/*", (route) => route.abort());   // nothing but browser internals is reachable from this page
    const page = await context.newPage();
    await page.goto("chrome://sandbox");
    const text = await page.locator("body").innerText();
    checkSandboxText(text);
    return text;
  } finally { await context.close(); }
}

/* ---- launching ---- */
function resolveDriver(driver) {
  const dir = driver || process.env.STRICT_BROWSER_DRIVER || process.env.QUALIFICATION_DRIVER;
  if (dir) {
    assert(path.isAbsolute(dir), "The browser driver path must be absolute");
    const require = createRequire(path.join(dir, "package.json"));
    return { dir, chromium: require(dir).chromium, version: require("./package.json").version };
  }
  const require = createRequire(import.meta.url);
  const dirOf = path.dirname(require.resolve("playwright/package.json"));
  return { dir: dirOf, chromium: require("playwright").chromium, version: require("playwright/package.json").version };
}

/* The browser server is started inline as the unprivileged user when this session is root. Nothing is read from the repository by that process. */
const childScript = (dir, executablePath, timeout) => `
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(${JSON.stringify(dir)}, "package.json"));
const { chromium } = require(${JSON.stringify(dir)});
const server = await chromium.launchServer({ executablePath: ${JSON.stringify(executablePath)}, args: ["--enable-automation"], headless: true, chromiumSandbox: true, timeout: ${Number(timeout)} });
console.log("STRICT_SERVER " + JSON.stringify({ ws: server.wsEndpoint(), pid: server.process().pid }));
const stop = async () => { try { await server.close(); } finally { process.exit(0); } };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
setInterval(() => {}, 1 << 30);
`;

async function startServerAsUser(user, dir, executablePath, timeout) {
  assert(/^[a-z_][a-z0-9_-]*$/.test(user) && user !== "root", "STRICT_BROWSER_RUN_AS must name an existing unprivileged user");
  const uid = spawnSync("id", ["-u", user], { encoding: "utf8" }), gid = spawnSync("id", ["-g", user], { encoding: "utf8" });
  assert(uid.status === 0 && gid.status === 0, `User ${user} does not exist`);
  assert(Number(uid.stdout) > 0, "The browser user must not be root");
  const child = spawn("setpriv", [`--reuid=${uid.stdout.trim()}`, `--regid=${gid.stdout.trim()}`, "--clear-groups", "env", "-i", `PATH=${process.env.PATH}`, "HOME=/nonexistent",
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? [`PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH}`] : []),
    process.execPath, "--input-type=module", "-e", childScript(dir, executablePath, timeout)], { cwd: "/", stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stderr.on("data", (d) => { err += d; });
  const info = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The unprivileged browser server did not start in time. " + err.slice(-600))), timeout + 5000);
    child.stdout.on("data", (d) => { out += d; const m = /STRICT_SERVER (.*)\n/.exec(out); if (m) { clearTimeout(t); resolve(JSON.parse(m[1])); } });
    child.on("exit", (code) => { clearTimeout(t); reject(new Error(`The unprivileged browser server exited (${code}). The sandbox is never switched off to get past this. ` + err.slice(-800))); });
  });
  return { ...info, user, uid: Number(uid.stdout), stop: () => new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000); }) };
}

/* Waits for one owned close, but never longer than `ms`: a close that hangs is abandoned (it is not called again and not killed twice) so the NEXT owned handle is still attempted. It never rejects. */
function boundedStep(fn, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    Promise.resolve().then(fn).then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  });
}

export async function launchStrict({ driver, expect = {}, cleanupStepMs = 10_000 } = {}) {
  assert.equal(process.platform, "linux", "The strict browser kit is for Linux");
  const { dir, chromium, version: playwright } = resolveDriver(driver);
  if (expect.playwright) assert.equal(playwright, expect.playwright, "Playwright version is not the pinned one");
  const executablePath = chromium.executablePath();
  assert(executablePath, "No Chromium executable: install it through the official Playwright route; no system-browser fallback is used");
  const evidence = { playwright, executable: executablePath, runAs: null, qualified: false };
  let server = null, stopper = null, browser = null, wsEndpoint, serverPid, closing = null;
  /* One close for everything this launch owns (the browser connection, the in-process server, the unprivileged server's stopper). It is shared by the failure path below and by the close that is
     returned, and it runs once: a second call gets the same promise, so nothing is terminated twice. As before, a browser.close error is swallowed; the server and the stopper are both attempted
     even if the first fails, and the first of their errors is thrown after the last attempt. */
  const stepMs = Number.isFinite(cleanupStepMs) && cleanupStepMs > 0 ? cleanupStepMs : 10_000;
  /* `bounded` is true ONLY on the launch-failure path below: each owned handle then gets at most `stepMs`, and a handle that hangs or fails is skipped so the next one is still closed. The close that is
     returned to the caller on success is not bounded and keeps its semantics exactly. */
  const closeAll = (bounded) => closing || (closing = (async () => {
    const run = (fn) => (bounded ? boundedStep(fn, stepMs) : fn());
    if (browser) { try { await run(() => browser.close()); } catch (e) {} }
    let hasError = false, first;   // a boolean, not the value: a falsy rejection (undefined, null, 0, false) is still an error, as it was with a plain await
    if (server) { try { await run(() => server.close()); } catch (e) { if (!hasError) { hasError = true; first = e; } } }
    if (stopper) { try { await run(() => stopper()); } catch (e) { if (!hasError) { hasError = true; first = e; } } }
    if (hasError) throw first;
  })());
  const close = () => closeAll(false);
  try {
    if (process.getuid() === 0) {
      const user = process.env.STRICT_BROWSER_RUN_AS;
      assert(user, "FAIL CLOSED: Chromium refuses its sandbox as root. Run unprivileged, or name an existing unprivileged user in STRICT_BROWSER_RUN_AS so only the browser runs as that user. The sandbox is never turned off.");
      const s = await startServerAsUser(user, dir, executablePath, 30_000);
      wsEndpoint = s.ws; serverPid = s.pid; stopper = s.stop; evidence.runAs = { user: s.user, uid: s.uid };
    } else {
      server = await chromium.launchServer({ executablePath, args: ["--enable-automation"], headless: true, chromiumSandbox: true, timeout: 30_000 });
      wsEndpoint = server.wsEndpoint(); serverPid = server.process().pid; evidence.runAs = { user: "current", uid: process.getuid() };
    }
    evidence.browserProcess = await processEvidence(serverPid);
    browser = await chromium.connect(wsEndpoint);
    evidence.version = browser.version();
    if (expect.chrome) assert.equal(evidence.version, expect.chrome, "Chrome version is not the pinned one");
    const cdp = await browser.newBrowserCDPSession();
    evidence.cdpArgv = (await cdp.send("Browser.getBrowserCommandLine")).arguments;
    rejectBypass(evidence.cdpArgv);
    if (expect.cdpSuffix) assert.deepEqual(evidence.cdpArgv, [...evidence.browserProcess.argv, ...expect.cdpSuffix], "CDP argv does not match kernel argv plus the pinned suffix");
    else evidence.cdpArgvPinned = false;
    return { browser, cdp, evidence, close, auditRenderers: () => auditRenderers(cdp, evidence) };
  } catch (e) {
    /* Launch failed after something was started: close what this launch owns, then rethrow the ORIGINAL error (a cleanup error or a hanging close never replaces it, and never blocks the next owned handle past `cleanupStepMs`). Nothing here relaxes a pin or a sandbox check. */
    try { await closeAll(true); } catch (e2) {}
    throw e;
  }
}

/* Every renderer that exists right now, read from the kernel. Called again after pages have loaded so renderers created for the application are covered too. */
export async function auditRenderers(cdp, evidence) {
  const processes = (await cdp.send("SystemInfo.getProcessInfo")).processInfo.filter((item) => item.type === "renderer");
  assert(processes.length > 0, "No renderer evidence");
  const out = [];
  for (const p of processes) {
    const r = await processEvidence(p.id);
    checkRenderer(r, evidence.browserProcess.NSpid);
    out.push(r);
  }
  return out;
}

/* ---- the network: an exact allowlist, and everything else is refused and recorded ---- */
export async function guardContext(context, { allowedOrigins, log }) {
  assert(Array.isArray(allowedOrigins) && allowedOrigins.every((o) => /^http:\/\/127\.0\.0\.1:\d+$/.test(o)), "Only loopback origins can be allowed");
  await context.route("**/*", (route) => {
    const url = route.request().url();
    let origin = null; try { origin = new URL(url).origin; } catch (e) {}
    if (/^data:|^blob:/.test(url) || (origin && allowedOrigins.includes(origin))) return route.continue();
    log.push({ kind: "refused-request", url: url.slice(0, 160), method: route.request().method() });
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => { log.push({ kind: "refused-websocket", url: ws.url().slice(0, 160) }); ws.close({ code: 1008, reason: "refused by the harness" }); });
}

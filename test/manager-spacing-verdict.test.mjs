/* The final verdict of the spacing run, executed from the REAL patched script text against the real refusal latch and a fake browser context. No browser, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installSpacingRoutes, FAILURES, LATCH_CAP, CONFIG_KEY } from "../scripts/manager-spacing-fixture.mjs";

const PATCHED = process.env.SPACING_PATCHED && fs.readFileSync(process.env.SPACING_PATCHED, "utf8");
const t = (name, fn) => (PATCHED ? test(name, fn) : test(name, { skip: "set SPACING_PATCHED to the patched manager-spacing.mjs" }, fn));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/* The script's own ending, cut out of the patched text: the last assertions of the try block, the finally block, and what follows the finally (the terminal check and the success message). */
function harness() {
  const lines = PATCHED.split("\n");
  const a = lines.indexOf("  assert.deepEqual(errors,[]);");
  assert.ok(a > 0 && lines[a + 1] === "  spacingFx.assertNoRefusals();", "the final assertions were found");
  const fin = lines.indexOf("} finally {", a), close = lines.indexOf("}", fin + 1);
  assert.ok(fin > a && close > fin);
  const tryTail = lines.slice(a, fin).join("\n"), finallyBody = lines.slice(fin + 1, close).join("\n"), after = lines.slice(close + 1).join("\n");
  assert.ok(after.includes("spacingFx.assertNoRefusals();") && after.includes("console.log('Keyboard/navigation passed:"), "the terminal check and the success message come after the finally");
  return new AsyncFunction("assert", "spacingFx", "errors", "results", "engine", "baseline", "writeFile", "page", "context", "browser", "bodyThrows", "console",
    `try {\n if (bodyThrows) throw bodyThrows;\n${tryTail}\n} finally {\n${finallyBody}\n}\n${after}`);
}
function fakes(hooks = {}) {
  const written = [], logged = [], timeline = [];
  return { written, logged, timeline, writeFile: async (p, s) => { timeline.push("geometry"); written.push([p, s]); }, console: { log: (x) => { timeline.push(String(x).startsWith("Keyboard") ? "success-message" : "json-line"); logged.push(x); } },
    page: { screenshot: () => { timeline.push("screenshot"); return Promise.resolve(hooks.screenshot && hooks.screenshot()); } },
    context: { close: async () => { timeline.push("context.close"); if (hooks.contextClose) await hooks.contextClose(); } },
    browser: { close: async () => { timeline.push("browser.close"); if (hooks.browserClose) await hooks.browserClose(); } } };
}
const row = () => ({ key: CONFIG_KEY, value: { stores: [{ id: "sage-demo" }] } });
function fakeContext(reply) { const routes = []; return { routes, route: async (p, h) => { routes.push({ p, h }); }, request: { get: async () => ({ status: () => reply.status, json: async () => (reply.body === undefined ? [row()] : reply.body) }) } }; }
const rpcRoute = (post = "{}", name = "sage_config_read", status = 200) => { const c = { fetch: [], fulfill: [], abort: [] }; return { c, request: () => ({ url: () => `http://127.0.0.1:5433/rest/v1/rpc/${name}`, method: () => "POST", postData: () => post }), fetch: async (o) => { c.fetch.push(o); return { status: () => status, json: async () => [] }; }, fulfill: async (o) => { c.fulfill.push(o); }, fallback: async () => {}, abort: async (x) => { c.abort.push(x); } }; };
async function controller(reply) { const ctx = fakeContext(reply); const fx = await installSpacingRoutes(ctx, { log: () => {} }); return { fx, ctx, call: (r) => ctx.routes[1].h(r) }; }

const run = async ({ fx, errors = [], bodyThrows = null, hooks = {} }) => {
  const f = fakes(hooks);
  const results = [{ phase: "after" }];
  const rec = { refusals: () => fx.refusals(), assertNoRefusals: () => { f.timeline.push("check"); return fx.assertNoRefusals(); } };
  let error = null;
  try { await harness()(assert, rec, errors, results, "chromium", "baseline-sha", f.writeFile, f.page, f.context, f.browser, bodyThrows, f.console); } catch (e) { error = e; }
  return { error, geometry: f.written.length ? JSON.parse(f.written[0][1]) : null, written: f.written, logged: f.logged, timeline: f.timeline };
};

t("zero refusals: the run passes exactly as before, and the geometry carries a zero latch", async () => {
  const { fx } = await controller({ status: 200 });
  const r = await run({ fx });
  assert.equal(r.error, null); assert.equal(r.written[0][0], "manager-spacing/geometry.json");
  assert.deepEqual(r.geometry.fixtureRefusals, { scope: "until-geometry-write", total: 0, counts: Object.fromEntries(FAILURES.map((w) => [w, 0])) });
  assert.deepEqual(r.timeline, ["check", "json-line", "geometry", "screenshot", "context.close", "browser.close", "check", "success-message"], "an early check, the cleanup, a terminal check, and only then the success message");
  assert.deepEqual(Object.keys(r.geometry), ["engine", "baseline", "results", "errors", "fixtureRefusals"]); assert.deepEqual(r.geometry.errors, []);
  assert.ok(r.logged.some((x) => String(x).startsWith("Keyboard/navigation passed:")), "the success message still prints");
});

t("a refusal and then a later success still fails the run, with the latch in the geometry", async () => {
  const reply = { status: 503 }; const { fx, call } = await controller(reply);
  const bad = rpcRoute(); await call(bad); assert.deepEqual(bad.c.abort, ["failed"]);
  reply.status = 200;                                  // the backend recovers, the app recovers, every later read is fine
  const good = rpcRoute(); await call(good); assert.equal(good.c.fulfill.length, 1); assert.deepEqual(good.c.abort, []);
  const r = await run({ fx });
  assert.ok(r.error instanceof Error); assert.equal(r.error.message, "spacing fixture refused 1 request(s): read-status=1");
  assert.equal(r.logged.some((x) => String(x).startsWith("Keyboard/navigation passed:")), false, "no success message after a refusal");
  assert.equal(r.geometry.fixtureRefusals.total, 1); assert.equal(r.geometry.fixtureRefusals.counts["read-status"], 1); assert.equal(r.written.length, 1, "the evidence is written before the failure leaves");
});

t("the header-fetch refusal latches the same way", async () => {
  const { fx, call } = await controller({ status: 200 });
  await call(rpcRoute("{}", "sage_config_read", 503));
  const r = await run({ fx }); assert.equal(r.error.message, "spacing fixture refused 1 request(s): header-status=1");
});

t("a run that already failed keeps ITS error: the very same object, with or without refusals, and the evidence is still written", async () => {
  for (const refuse of [false, true]) {
    const reply = { status: refuse ? 401 : 200 }; const { fx, call } = await controller(reply); if (refuse) await call(rpcRoute());
    const original = new Error("390: last row clears controls, bottom=700, ceiling=690");
    const r = await run({ fx, bodyThrows: original });
    assert.strictEqual(r.error, original, "refuse=" + refuse); assert.equal(r.geometry.fixtureRefusals.total, refuse ? 1 : 0); assert.equal(r.written.length, 1); assert.equal(r.logged.some((x) => String(x).startsWith("Keyboard")), false, "no success message");
  }
  /* an assertion that fails at the end (page errors) is the error too, not the refusal */
  const { fx, call } = await controller({ status: 503 }); await call(rpcRoute());
  const r = await run({ fx, errors: ["Uncaught TypeError: x"] });
  assert.equal(r.error.name, "AssertionError"); assert.ok(!/spacing fixture refused/.test(r.error.message), "the original assertion wins"); assert.equal(r.geometry.fixtureRefusals.total, 1);
});

t("the latch is bounded and holds only fixed words and counts: saturating counters, one key per word, no request text", async () => {
  const { fx, ctx } = await controller({ status: 503 });
  const hostile = rpcRoute("{\"p_store\":\"sage-demo\",\"note\":\"x\\ny::set-output\"}", "sage_store_read");
  for (let i = 0; i < LATCH_CAP + 500; i++) await ctx.routes[1].h(hostile);
  const snap = fx.refusals();
  assert.equal(snap.counts["read-status"], LATCH_CAP); assert.equal(snap.total, LATCH_CAP); assert.deepEqual(Object.keys(snap.counts), FAILURES);
  assert.ok(JSON.stringify(snap).length < 400, "tiny and fixed in size");
  assert.ok(!JSON.stringify(snap).includes("set-output") && !JSON.stringify(snap).includes("p_store") && !JSON.stringify(snap).includes("sage-demo"));
  assert.throws(() => fx.assertNoRefusals(), (e) => e.message === `spacing fixture refused ${LATCH_CAP} request(s): read-status=${LATCH_CAP}`);
  snap.counts["read-status"] = 0; snap.total = 0; assert.equal(fx.refusals().total, LATCH_CAP, "the returned snapshot is a copy: it cannot clear the latch");
});

t("several kinds are all named, in the fixed order, and an unknown reason is counted as read-error rather than stored", async () => {
  const ctx = fakeContext({ status: 200 }); let boom = null;
  const fx = await installSpacingRoutes(ctx, { log: () => {}, readRow: async () => { throw boom; } });
  const h = ctx.routes[1].h;
  for (const e of [Object.assign(new Error("x"), { reason: "read-redirect" }), Object.assign(new Error("x"), { reason: "read-shape" }), Object.assign(new Error("x"), { reason: "evil\nreason" }), new Error("plain"), Object.assign(new Error("x"), { reason: "read-shape" })]) { boom = e; await h(rpcRoute()); }
  assert.throws(() => fx.assertNoRefusals(), (e) => e.message === "spacing fixture refused 5 request(s): read-redirect=1, read-shape=2, read-error=2");
});

/* ---- the temporal hole: a refusal that happens AFTER the early check, during the final screenshot or the closes ---- */
const late = async (where, extra = {}) => {
  const reply = { status: 200 }; const { fx, ctx } = await controller(reply); reply.status = 503;
  const fire = () => ctx.routes[1].h(rpcRoute());
  const hooks = { [where]: fire };
  return { fx, ...(await run({ fx, hooks, ...extra })) };
};
t("a refusal during the final screenshot, the context close or the browser close fails the run at the terminal check, not green", async () => {
  for (const where of ["screenshot", "contextClose", "browserClose"]) {
    const r = await late(where);
    assert.ok(r.error instanceof Error && r.error.message === "spacing fixture refused 1 request(s): read-status=1", where + ": " + (r.error && r.error.message));
    assert.deepEqual(r.timeline.filter((x) => x === "check"), ["check", "check"], "the early check passed (zero then), the terminal check caught it");
    assert.equal(r.logged.some((x) => String(x).startsWith("Keyboard")), false, "no success message after a late refusal");
    assert.equal(r.timeline.indexOf("browser.close") < r.timeline.lastIndexOf("check"), true, "the terminal check is after every cleanup step");
  }
});

t("the evidence says where it was captured: a late refusal is NOT in geometry.json, which is labelled as written before the final screenshot and closes", async () => {
  const r = await late("contextClose");
  assert.equal(r.geometry.fixtureRefusals.scope, "until-geometry-write"); assert.equal(r.geometry.fixtureRefusals.total, 0, "captured before the refusal; the label says so");
  assert.ok(r.error.message.includes("read-status=1"), "the terminal error carries the late count in fixed words");
});

t("a run that already failed keeps ITS error even when a refusal also happens during cleanup; the terminal check never replaces it", async () => {
  for (const where of ["screenshot", "contextClose", "browserClose"]) {
    const original = new Error("390: no document overflow");
    const r = await late(where, { bodyThrows: original });
    assert.strictEqual(r.error, original, where); assert.equal(r.timeline.filter((x) => x === "check").length, 0, "neither check ran: the body threw first");
  }
  /* a late refusal after an EARLY refusal: the early check reports first, once */
  const reply = { status: 503 }; const { fx, ctx } = await controller(reply); await ctx.routes[1].h(rpcRoute());
  const r = await run({ fx, hooks: { contextClose: () => ctx.routes[1].h(rpcRoute()) } });
  assert.equal(r.error.message, "spacing fixture refused 1 request(s): read-status=1", "the early check wins; the late one is never reached");
  assert.equal(r.timeline.filter((x) => x === "check").length, 1);
});

t("a cleanup failure is still the error (unchanged behaviour), and success needs both checks to pass", async () => {
  const { fx } = await controller({ status: 200 });
  const boom = new Error("browser.close failed");
  const r = await run({ fx, hooks: { browserClose: () => { throw boom; } } });
  assert.strictEqual(r.error, boom, "the pre-existing behaviour, not masked and not changed");
  assert.equal((await run({ fx })).error, null);
});

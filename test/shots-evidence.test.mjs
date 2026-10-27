/* The evidence file for a shots run: what it may hold, what it must refuse, and
   the order the failure path does things in. Invented inputs only: no browser,
   no server, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_BYTES, MAX_REQUESTS, classifyRoute, shapeOf, createRecorder, resolveCommit, validateEvidence, validateFixtureReport, buildFile,
  fetchFixtureReport, readCapped, probePage, classifyError, stageName, createShotsEvidence,
} from "../scripts/shots-evidence.mjs";

const HEX64 = "a".repeat(64);
const SHA = "0123456789abcdef".repeat(2).concat("01234567");
const report = (extra = {}) => ({ schema: 1, mode: "compatible", clock: "fixed", seed: "shared", dist: { files: 3, bytes: 900, sha256: HEX64 },
  requests: [{ m: "POST", c: "rpc:sage_config_read", s: 200, n: 2 }], shapes: [{ c: "rpc:sage_config_read", h: { "object-value-present": 2 } }],
  unexpectedByClass: [], unexpected: 0, dropped: 0, droppedShapes: 0, droppedUnexpected: 0, ...extra });
const full = (extra = {}) => ({ schema: 1, phase: "final", commit: SHA, commitSource: "env", cell: "fixture-compatible", engine: "webkit", stage: "normal: wait for room bar",
  pictures: 0, exit: 1, errorClass: "timeout", verdict: "frozen", binding: { shots: HEX64, probeKit: HEX64, evidence: HEX64, fixture: null },
  page: null, browserWindow: "until-failure", fixtureWindow: "until-report-read-after-cleanup", requests: [{ m: "GET", c: "static", s: 200, n: 4 }], dropped: 0, unexpected: 0, fixtureState: "ok", fixture: report(), ...extra });
const src = fs.readFileSync(new URL("../scripts/shots.mjs", import.meta.url), "utf8");

test("a request becomes a method and a class, and the path is not kept", () => {
  assert.deepEqual(classifyRoute("post", "/rest/v1/rpc/sage_config_read"), { m: "POST", c: "rpc:sage_config_read" });
  assert.deepEqual(classifyRoute("POST", "/rest/v1/rpc/sage_not_a_thing"), { m: "POST", c: "rpc:other" });
  assert.deepEqual(classifyRoute("GET", "/rest/v1/floor_public"), { m: "GET", c: "rest:floor_public" });
  assert.deepEqual(classifyRoute("GET", "/rest/v1/secrets"), { m: "GET", c: "other" });
  assert.deepEqual(classifyRoute("GET", "/rest/v1/"), { m: "GET", c: "rest:root" });
  assert.deepEqual(classifyRoute("POST", "/api/floor-row"), { m: "POST", c: "api:floor-row" });
  assert.deepEqual(classifyRoute("POST", "/api/open-room"), { m: "POST", c: "api:open-room" });
  assert.deepEqual(classifyRoute("POST", "/api/anything-else"), { m: "POST", c: "api:other" });
  assert.deepEqual(classifyRoute("GET", "/assets/index-abc.js"), { m: "GET", c: "static" });
  assert.deepEqual(classifyRoute("POST", "/somewhere"), { m: "POST", c: "other" });
  assert.equal(classifyRoute("TRACE", "/"), null, "a method outside the allowlist has no class");
});

test("the same route answered two ways is two entries, and what cannot be kept is counted", () => {
  const r = createRecorder();
  for (const s of [200, 200, 200, 501]) r.observe("POST", "/rest/v1/rpc/sage_config_read", s);
  r.observe("TRACE", "/", 200);
  r.observe("GET", "/", 99);
  r.observe("GET", "/", NaN);
  const snap = r.freeze();
  assert.deepEqual(snap.requests.filter((e) => e.c === "rpc:sage_config_read"), [{ m: "POST", c: "rpc:sage_config_read", s: 200, n: 3 }, { m: "POST", c: "rpc:sage_config_read", s: 501, n: 1 }]);
  assert.equal(snap.dropped, 3);
});

test("a failed request is status 0, and the 65th distinct triple goes to dropped", () => {
  const r = createRecorder();
  r.observe("GET", "/", 0);
  for (let i = 0; i < MAX_REQUESTS + 5; i++) r.observe("GET", "/", 100 + i);
  const snap = r.freeze();
  assert.equal(snap.requests.length, MAX_REQUESTS);
  assert.ok(snap.requests.some((e) => e.s === 0));
  assert.equal(snap.dropped, 6);
});

test("after the verdict is frozen, cleanup cannot change the counts", () => {
  const r = createRecorder();
  r.observe("GET", "/", 200);
  const before = JSON.stringify(r.freeze());
  r.observe("GET", "/", 0); r.observe("GET", "/x", 200);
  assert.equal(JSON.stringify(r.freeze()), before);
});

test("the shape is read off what the fixture sends, and returns none of it", () => {
  assert.equal(shapeOf([]), "array-empty");
  assert.equal(shapeOf([{ a: 1 }]), "array-nonempty");
  assert.equal(shapeOf({ value: { a: 1 } }), "object-value-present");
  assert.equal(shapeOf({ value: null }), "object-value-null");
  assert.equal(shapeOf({ rows: 1 }), "object-no-value-key");
  assert.equal(shapeOf(null), "null");
  assert.equal(shapeOf(3), "scalar");
  assert.equal(shapeOf("secret"), "scalar");
  assert.equal(shapeOf(undefined), "empty-body");
  assert.ok(!JSON.stringify(shapeOf({ value: "do-not-leak" })).includes("leak"));
});

test("the commit is a forty-character hash or an honest unknown", () => {
  assert.deepEqual(resolveCommit({ GITHUB_SHA: SHA }), { commit: SHA, commitSource: "env" });
  for (const bad of [undefined, "", "abc", SHA.toUpperCase(), SHA + "0", "g".repeat(40)]) assert.deepEqual(resolveCommit({ GITHUB_SHA: bad }), { commit: null, commitSource: "unknown" });
  assert.deepEqual(resolveCommit({}), { commit: null, commitSource: "unknown" });
});

test("a full document passes, and so does the fallback", () => {
  assert.ok(validateEvidence(full()));
  assert.ok(validateEvidence({ schema: 1, invalid: true, commit: null, commitSource: "unknown", stage: "unknown", errorClass: null }));
  assert.ok(validateEvidence(full({ commit: null, commitSource: "unknown" })));
});

test("unknown keys, free strings, wrong numbers and a mismatched commit source are refused", () => {
  assert.ok(!validateEvidence({ ...full(), extra: 1 }));
  assert.ok(!validateEvidence({ schema: 1, invalid: true, commit: null, commitSource: "unknown", stage: "unknown", errorClass: null, extra: 1 }));
  assert.ok(!validateEvidence(full({ stage: "https://example.test/?token=abc" })));
  assert.ok(!validateEvidence(full({ cell: "my own cell" })));
  assert.ok(!validateEvidence(full({ errorClass: "something went wrong in the page" })));
  for (const n of [-1, 1.5, NaN, Infinity, 1e10, Number.MAX_SAFE_INTEGER + 2]) assert.ok(!validateEvidence(full({ pictures: n })), String(n));
  assert.ok(!validateEvidence(full({ commit: SHA.toUpperCase() })));
  assert.ok(!validateEvidence(full({ commit: null, commitSource: "env" })));
  assert.ok(!validateEvidence(full({ commit: SHA, commitSource: "unknown" })));
  assert.ok(!validateEvidence(full({ requests: [{ m: "TRACE", c: "static", s: 200, n: 1 }] })));
  assert.ok(!validateEvidence(full({ requests: [{ m: "GET", c: "/rest/v1/profiles?id=eq.1", s: 200, n: 1 }] })));
  assert.ok(!validateEvidence(full({ requests: [{ m: "GET", c: "static", s: 99, n: 1 }] })));
  assert.ok(!validateEvidence(full({ requests: Array.from({ length: MAX_REQUESTS + 1 }, () => ({ m: "GET", c: "static", s: 200, n: 1 })) })));
  assert.ok(!validateEvidence(null));
  assert.ok(!validateEvidence([]));
});

test("a page that could not be asked is unknown, never no", () => {
  const ok = full({ page: { loginCard: "unknown", signinOver: "unknown", arBar: "unknown", arBarUp: "unknown", rootInert: "unknown", flightLock: "unknown", rooms: null, notHiddenRooms: null } });
  assert.ok(validateEvidence(ok));
  assert.ok(!validateEvidence(full({ page: { ...ok.page, arBar: false } })), "a boolean is not a state");
  assert.ok(!validateEvidence(full({ page: { ...ok.page, rooms: -1 } })));
});

test("the page probe maps every failure to unknown", async () => {
  const unknown = { loginCard: "unknown", signinOver: "unknown", arBar: "unknown", arBarUp: "unknown", rootInert: "unknown", flightLock: "unknown", rooms: null, notHiddenRooms: null };
  assert.deepEqual(await probePage(null), unknown);
  assert.deepEqual(await probePage({ evaluate: async () => { throw new Error("Target closed"); } }), unknown);
  assert.deepEqual(await probePage({ evaluate: () => new Promise(() => {}) }, 20), unknown, "a probe that never answers is cut off");
  const got = await probePage({ evaluate: async () => ({ loginCard: false, signinOver: true, arBar: false, arBarUp: false, rootInert: true, flightLock: false, rooms: 2, notHiddenRooms: 1 }) });
  assert.deepEqual(got, { loginCard: "no", signinOver: "yes", arBar: "no", arBarUp: "no", rootInert: "yes", flightLock: "no", rooms: 2, notHiddenRooms: 1 });
  assert.equal((await probePage({ evaluate: async () => ({ arBar: "maybe", rooms: -4 }) })).arBar, "unknown");
  assert.equal((await probePage({ evaluate: async () => ({ rooms: -4 }) })).rooms, null);
});

test("the file is measured in bytes, sheds the request list first, and never truncates a string", () => {
  assert.equal(buildFile(full()).kind, "full");
  const big = full({ requests: Array.from({ length: MAX_REQUESTS }, (_, i) => ({ m: "GET", c: "static", s: 100 + i, n: 999999999 })),
    fixture: report({ requests: Array.from({ length: MAX_REQUESTS }, (_, i) => ({ m: "GET", c: "static", s: 100 + i, n: 999999999 })), shapes: Array.from({ length: 16 }, () => ({ c: "static", h: { "non-json": 999999999, null: 999999999, scalar: 999999999 } })) }) });
  /* Every list is capped, so the worst case is built to fit the real limit; the
     shedding order is exercised with a smaller one. */
  assert.ok(Buffer.byteLength(buildFile(big).text, "utf8") <= MAX_BYTES);
  const small = buildFile(big, 3000);
  assert.ok(Buffer.byteLength(small.text, "utf8") <= 3000);
  const kept = JSON.parse(small.text);
  assert.ok(validateEvidence(kept), "a shed document is still a valid one");
  assert.equal(small.kind, "full");
  assert.ok(kept.dropped > 0 && kept.requests.length < MAX_REQUESTS, "the browser's request list is shed first and what was shed is counted");
  assert.equal(buildFile(big, 400).kind, "fallback", "too small for the document, big enough for the unknown note");
  assert.equal(buildFile(big, 120), null, "the fallback itself is longer than 120 bytes, so nothing is written");
  assert.equal(buildFile(big, 10), null, "when even the fallback will not fit, nothing is written");
  const hopeless = buildFile({ ...full(), stage: "a".repeat(40000) });
  assert.equal(hopeless.kind, "fallback");
  assert.ok(Buffer.byteLength(hopeless.text, "utf8") <= MAX_BYTES);
  assert.deepEqual(JSON.parse(hopeless.text), { schema: 1, invalid: true, commit: SHA, commitSource: "env", stage: "unknown", errorClass: "timeout" },
    "the fallback keeps the checkable fields and writes a stage outside the set as unknown");
  assert.equal(buildFile(null).kind, "fallback", "even a non-document leaves the unknown note");
});

test("a stage is one of the names shots.mjs prints, or unknown", () => {
  assert.equal(stageName("normal: wait for room bar"), "normal: wait for room bar");
  assert.equal(stageName("capture large-home-foot"), "capture large-home-foot");
  assert.equal(stageName("normal-up: settle takeover"), "normal-up: settle takeover");
  assert.equal(stageName("starting"), "starting");
  assert.equal(stageName("normal: something new"), "unknown");
  assert.equal(stageName(undefined), "unknown");
});

test("a fixture report is fixed enums and counts, and an invalid one is refused", () => {
  assert.ok(validateFixtureReport(report()));
  assert.ok(!validateFixtureReport(report({ mode: "other" })));
  assert.ok(!validateFixtureReport(report({ dist: { files: 1, bytes: 1, sha256: "short" } })));
  assert.ok(!validateFixtureReport(report({ shapes: [{ c: "static", h: { "free text": 1 } }] })));
  assert.ok(!validateFixtureReport({ ...report(), body: "[]" }));
  assert.ok(!validateFixtureReport(report({ requests: [{ m: "GET", c: "static", s: 200, n: -1 }] })));
  assert.ok(!validateFixtureReport(report({ requests: [{ c: "static", s: 200, n: 1 }] })), "a request entry without its method is refused");
  assert.ok(!validateFixtureReport(report({ requests: [{ m: "TRACE", c: "static", s: 200, n: 1 }] })));
  assert.ok(!validateFixtureReport(report({ clock: "whenever" })));
  assert.ok(!validateFixtureReport(report({ seed: "mine" })));
  assert.ok(!validateFixtureReport(report({ droppedShapes: -1 })));
  assert.ok(!validateFixtureReport(report({ droppedUnexpected: 1.5 })));
  assert.ok(!validateFixtureReport({ ...report(), droppedShapes: undefined }));
});

test("the fixture report is read with a cap on what arrives, not on what is claimed", async () => {
  const stream = (chunks, headers = {}) => ({ ok: true, headers, body: { getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }), cancel: async () => {} }; } } });
  assert.equal(await readCapped(stream([Buffer.from("[]")]), 8), "[]");
  await assert.rejects(readCapped(stream([Buffer.alloc(5), Buffer.alloc(5)], { "content-length": "3" }), 8), /cap/);
  const good = JSON.stringify(report());
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => stream([Buffer.from(good)]) })).state, "ok");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => stream([Buffer.from("{}")]) })).state, "invalid");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => stream([Buffer.alloc(9000)]) })).state, "invalid");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => { throw new TypeError("fetch failed"); } })).state, "unreachable");
  let asked = null;
  await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async (url, init) => { asked = { url, init }; return stream([Buffer.from(good)]); } });
  assert.equal(asked.init.redirect, "error", "a redirect is refused, not followed away from the loopback check");
  assert.ok(asked.init.signal, "and the ask carries its abort signal");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => { throw new TypeError("redirect mode is set to error"); } })).state, "unreachable");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/__fixture/report", { fetchImpl: async () => ({ ...stream([Buffer.from(good)]), redirected: true }) })).state, "invalid", "an answer that arrived by redirect is not trusted");
  assert.equal((await fetchFixtureReport("http://example.test/__fixture/report")).state, "invalid", "only loopback is asked");
  assert.equal((await fetchFixtureReport("http://127.0.0.1:5178/other")).state, "invalid");
  assert.equal((await fetchFixtureReport("")).state, "none");
});

test("errors are classed by kind, and a lost browser outranks everything else", () => {
  assert.equal(classifyError(new Error("x"), "it went away mid-run"), "browser-lost");
  assert.equal(classifyError(Object.assign(new Error("x"), { unexpectedRoutes: true }), "it went away mid-run"), "browser-lost");
  assert.equal(classifyError(Object.assign(new Error("x"), { unexpectedRoutes: true }), null), "unexpected-routes");
  assert.equal(classifyError(Object.assign(new Error("x"), { name: "TimeoutError" }), null), "timeout");
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "ERR_ASSERTION" }), null), "assertion");
  assert.equal(classifyError("a string", null), "other");
});

test("shots.mjs freezes the verdict, then the evidence, then closes the browser", () => {
  const catchAt = src.indexOf("e.lostBrowser = lost.why(e)");
  const failedAt = src.indexOf("await ev.failed(e)");
  const closeAt = src.indexOf("await b.close()");
  assert.ok(catchAt > 0 && failedAt > catchAt && closeAt > failedAt, "lost.why, then ev.failed, then b.close");
  assert.ok(src.indexOf("ev.freeze()") < closeAt, "the pass path freezes before the browser closes too");
  assert.ok(src.indexOf("await ev.passed()") > closeAt, "the pass verdict comes after cleanup, from counts already frozen");
  assert.equal(src.split("ev.watchPage(page)").length - 1, 2, "both page creations are watched");
});

test("no browser response body is read anywhere in the evidence path", () => {
  const ev = fs.readFileSync(new URL("../scripts/shots-evidence.mjs", import.meta.url), "utf8");
  assert.ok(!/response\.body|\.body\(\)|r\.text\(\)|r\.json\(\)|page\.on\("requestfinished"/.test(ev), "no body read on a browser response");
  assert.ok(/p\.on\("response"/.test(ev) && /r\.status\(\)/.test(ev), "only the status of a response is taken");
  assert.ok(!/continue-on-error/.test(src));
});

/* The object shots.mjs holds, with the page and the fixture replaced by fakes. */
const HERE = new URL("../scripts/", import.meta.url).pathname;
const stream = (text) => ({ ok: true, body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: Buffer.from(text) })), cancel: async () => {} }; } } });
const harness = (env = {}, fetchImpl) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-evidence-"));
  const ev = createShotsEvidence({ engine: "webkit", dir, here: HERE, env: { GITHUB_SHA: SHA, ...env }, fetchImpl });
  return { ev, dir, read: () => JSON.parse(fs.readFileSync(path.join(dir, "shots-evidence.json"), "utf8")), done: () => {} /* the directory is unique (mkdtemp) and is KEPT: nothing is deleted here */ };
};
const livePage = (answer) => ({ on() {}, evaluate: async () => answer });
const URL_ = "http://127.0.0.1:5178/__fixture/report";

test("a run that is lost keeps exit 3, is never probed, and nothing the fixture saw outranks it", async () => {
  const h = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => stream(JSON.stringify(report({ unexpected: 4 }))));
  h.ev.watchPage(livePage({ arBar: true }));
  h.ev.stage("normal: wait for room bar");
  await h.ev.failed(Object.assign(new Error("Target closed"), { lostBrowser: "it went away mid-run" }));
  const d = h.read();
  assert.ok(validateEvidence(d));
  assert.equal(d.exit, 3); assert.equal(d.errorClass, "browser-lost"); assert.equal(d.verdict, "frozen");
  assert.equal(d.page.arBar, "unknown", "no probe on a browser that is gone");
  assert.equal(d.unexpected, null, "the fixture was not even asked");
  h.done();
});

test("an ordinary failure is probed after the verdict is frozen, and the fixture is asked", async () => {
  const h = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => stream(JSON.stringify(report({ unexpected: 2 }))));
  h.ev.watchPage(livePage({ loginCard: true, signinOver: false, arBar: false, arBarUp: false, rootInert: false, flightLock: false, rooms: 0, notHiddenRooms: 0 }));
  h.ev.stage("large: wait for room bar");
  await h.ev.failed(Object.assign(new Error("Timeout 40000ms exceeded"), { name: "TimeoutError" }));
  const d = h.read();
  assert.equal(d.exit, 1); assert.equal(d.errorClass, "timeout"); assert.equal(d.page.loginCard, "yes"); assert.equal(d.page.arBar, "no");
  assert.equal(d.unexpected, 2); assert.equal(d.cell, "fixture-compatible");
  assert.equal(d.fixtureWindow, "until-report-read-before-cleanup", "a failure asks the fixture from the catch, before anything is closed");
  assert.equal(d.browserWindow, "until-failure");
  h.done();
});

test("a pass is a pass only if the fixture saw nothing unexpected and could be read", async () => {
  const ok = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => stream(JSON.stringify(report())));
  await ok.ev.passed();
  assert.equal(ok.read().exit, 0); assert.equal(ok.read().errorClass, "none");
  assert.equal(ok.read().fixtureWindow, "until-report-read-after-cleanup", "a pass asks after the finally");
  assert.equal(ok.read().browserWindow, "until-last-context-closed"); ok.done();
  const bad = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => stream(JSON.stringify(report({ unexpected: 1, unexpectedByClass: [{ c: "api:open-room", n: 1 }] }))));
  await assert.rejects(bad.ev.passed(), (e) => e.unexpectedRoutes === true);
  assert.equal(bad.read().exit, 1); assert.equal(bad.read().errorClass, "unexpected-routes"); bad.done();
  const gone = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(gone.ev.passed(), (e) => e.fixtureReport === true);
  assert.equal(gone.read().exit, 1); assert.equal(gone.read().fixtureState, "unreachable"); assert.equal(gone.read().cell, "unknown"); gone.done();
  const plain = harness();
  await plain.ev.passed();
  assert.equal(plain.read().cell, "ordinary"); assert.equal(plain.read().unexpected, null); plain.done();
});

test("a started note is written first, and a bad commit is an honest unknown", () => {
  const h = harness({ GITHUB_SHA: "nope" });
  h.ev.start();
  const d = h.read();
  assert.equal(d.phase, "started"); assert.equal(d.commit, null); assert.equal(d.commitSource, "unknown"); assert.equal(d.stage, "starting");
  assert.ok(validateEvidence(d));
  h.done();
});

test("the two windows are labelled, and a fixture window only exists with a fixture report", () => {
  assert.ok(validateEvidence(full({ browserWindow: "until-last-context-closed" })));
  assert.ok(validateEvidence(full({ browserWindow: null, fixtureWindow: null, fixture: null, fixtureState: "none", unexpected: null })));
  assert.ok(!validateEvidence(full({ browserWindow: "always" })));
  assert.ok(validateEvidence(full({ fixtureWindow: "until-report-read-before-cleanup" })), "both lifecycle labels are accepted");
  assert.ok(validateEvidence(full({ fixtureWindow: "until-report-read-after-cleanup" })));
  assert.ok(!validateEvidence(full({ fixtureWindow: "until-report-read" })), "the neutral label is not a member: the file says which path it was");
  assert.ok(!validateEvidence(full({ fixtureWindow: null })), "a report with no window label");
  assert.ok(!validateEvidence(full({ fixture: null, fixtureState: "none", unexpected: null })), "a window label with no report");
});

test("the room count is named for what it counts: not hidden by attribute, not visible", () => {
  const ev = fs.readFileSync(new URL("../scripts/shots-evidence.mjs", import.meta.url), "utf8");
  assert.ok(/notHiddenRooms: document\.querySelectorAll\("\.ar-room:not\(\[hidden\]\)"\)\.length/.test(ev));
  assert.ok(!/visibleRooms/.test(ev) && !/visibleRooms/.test(src), "the word visible is gone from the field");
  assert.ok(/not what is on screen/.test(ev), "and the probe says what it does not mean");
  assert.ok(!validateEvidence(full({ page: { loginCard: "yes", signinOver: "no", arBar: "no", arBarUp: "no", rootInert: "no", flightLock: "no", rooms: 1, visibleRooms: 1 } })), "the old field is not accepted");
});

test("shedding the fixture's shape classes is counted, not silent", () => {
  const shapes = Array.from({ length: 16 }, (_, i) => ({ c: i % 2 ? "static" : "rest:profiles", h: { "non-json": 999999999, null: 999999999, scalar: 999999999, "array-empty": 999999999 } }));
  const big = full({ fixture: report({ shapes, requests: Array.from({ length: 64 }, (_, i) => ({ m: "GET", c: "static", s: 100 + i, n: 999999999 })) }), requests: [] });
  const small = JSON.parse(buildFile(big, 2200).text);
  assert.ok(validateEvidence(small));
  assert.ok(small.fixture.droppedShapes > 0, "a shape class that was shed is counted");
  assert.equal(small.fixture.shapes.length + small.fixture.droppedShapes, 16, "kept plus shed is what there was");
});

test("the fixture window label follows the code path that reads the report", () => {
  const ev = fs.readFileSync(new URL("../scripts/shots-evidence.mjs", import.meta.url), "utf8");
  assert.ok(/await settle\("until-report-read-after-cleanup"\)/.test(ev) && /await settle\("until-report-read-before-cleanup"\)/.test(ev));
  const passedAt = ev.indexOf("async passed()"), failedAt = ev.indexOf("async failed(e)");
  assert.ok(ev.indexOf('settle("until-report-read-after-cleanup")') > passedAt && ev.indexOf('settle("until-report-read-after-cleanup")') < failedAt, "after-cleanup belongs to passed()");
  assert.ok(ev.indexOf('settle("until-report-read-before-cleanup")') > failedAt, "before-cleanup belongs to failed()");
  const catchAt = src.indexOf("await ev.failed(e)"), finallyAt = src.indexOf("finally {"), passAt = src.indexOf("await ev.passed()");
  assert.ok(catchAt > 0 && catchAt < finallyAt && finallyAt < passAt, "failed() runs in the catch, passed() after the finally, so the two labels are true");
  assert.ok(!/until-report-read"/.test(ev), "no unlabelled window remains");
});

test("a fixture window is only ever stamped when a report was read", async () => {
  const h = harness({ SHOTS_FIXTURE_REPORT_URL: URL_ }, async () => { throw new TypeError("fetch failed"); });
  h.ev.watchPage(livePage({}));
  await h.ev.failed(new Error("x"));
  const d = h.read();
  assert.equal(d.fixture, null); assert.equal(d.fixtureWindow, null, "no report, no window label");
  assert.ok(validateEvidence(d));
  h.done();
});

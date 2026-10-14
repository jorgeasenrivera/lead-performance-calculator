import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { watchFeelEvidence } from "../scripts/feel-evidence.mjs";

test("failure evidence keeps errors and failed requests when the page is already lost", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feel-evidence-"));
  try {
    const page = new EventEmitter();
    page.content = page.screenshot = async () => { throw new Error("page closed"); };
    const capture = watchFeelEvidence(page, { directory, fixture: true, url: "http://127.0.0.1:5178/", log() {} });
    page.emit("pageerror", new Error("fictional crash"));
    page.emit("requestfailed", { url: () => "http://127.0.0.1:5433/rest?token=fictional#secret", method: () => "GET", resourceType: () => "fetch", failure: () => ({ errorText: "net::ERR_FAILED" }) });
    page.emit("response", { url: () => "http://127.0.0.1:5178/chunk.js", status: () => 503 });
    await capture(new Error("original timeout"));
    const evidence = JSON.parse(await fs.readFile(path.join(directory, "events.json"), "utf8"));
    assert.match(evidence.error, /original timeout/);
    assert.deepEqual(evidence.events.map(e => e.type), ["pageerror", "requestfailed", "http"]);
    assert.match(evidence.events[0].error, /fictional crash/);
    assert.equal(evidence.events[1].url, "http://127.0.0.1:5433/rest");
    const status = JSON.parse(await fs.readFile(path.join(directory, "capture.json"), "utf8"));
    assert.deepEqual(status.failures.map(e => e.artifact), ["failure.html", "failure.png"]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("capture is opt-in and rejects nonfixture destinations", () => {
  assert.equal(watchFeelEvidence(new EventEmitter()), null);
  for (const options of [{ fixture: false, url: "http://localhost/" }, { fixture: true, url: "https://example.com/" }]) {
    assert.throws(() => watchFeelEvidence(new EventEmitter(), { directory: path.join(os.tmpdir(), "unused"), ...options }), /fictional loopback/);
  }
});

test("failure evidence writes DOM and screenshot and bounds noisy events", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "feel-evidence-"));
  try {
    const page = new EventEmitter();
    page.content = async () => "<html><body>Fictional fixture</body></html>";
    page.screenshot = async ({ path: file, timeout }) => {
      assert.equal(timeout, 5000);
      await fs.writeFile(file, "fictional screenshot stub");
    };
    const capture = watchFeelEvidence(page, { directory, fixture: true, url: "http://localhost/", log() {} });
    for (let i = 0; i < 105; i++) page.emit("pageerror", new Error(`fictional ${i}`));
    await capture(new Error("timeout"));
    const evidence = JSON.parse(await fs.readFile(path.join(directory, "events.json"), "utf8"));
    assert.equal(evidence.events.length, 100);
    assert.equal(evidence.dropped, 5);
    assert.match(await fs.readFile(path.join(directory, "failure.html"), "utf8"), /Fictional fixture/);
    assert.equal((await fs.stat(path.join(directory, "failure.png"))).size > 0, true);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "capture.json"), "utf8")), { failures: [] });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

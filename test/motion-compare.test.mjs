import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { commonMotionCSS, tighterMotionCSS, comparisonPage, installMotionComparison, serveMotionComparison } from "../scripts/motion-compare.mjs";

test("comparison preserves animation identity instead of restarting cardIn", () => {
  assert.match(tighterMotionCSS, /@keyframes saRadial/);
  assert.match(tighterMotionCSS, /scale\(1\.012\)/);
  assert.doesNotMatch(tighterMotionCSS, /animation\s*:/);
  assert.match(commonMotionCSS, /scrollbar-gutter:stable/);
  assert.match(commonMotionCSS, /comparison-lock body/);
});

test("comparison has one actual app viewport and separate decisions", () => {
  const html = comparisonPage();
  assert.equal((html.match(/<iframe /g) || []).length, 1);
  assert.match(html, /id="repair"/);
  assert.match(html, /id="motion"/);
  assert.match(html, /Landing only/);
  assert.match(html, /Choices stay on this page only/);
  assert.doesNotMatch(html, /<iframe[^>]+src=/);
});

test("preview lock has completion, timeout and unload exits without changing motion preference", () => {
  const source = installMotionComparison.toString();
  assert.match(source, /if \(landed && !active\)/);
  assert.match(source, /20000/);
  assert.match(source, /pagehide/);
  assert.match(source, /classList.remove\("comparison-lock"\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(source, /matchMedia\s*=/);
  assert.match(source, /event.origin !== location.origin/);
});

async function fixture(t, bundle) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sage-motion-test-"));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  await fs.mkdir(path.join(root,"assets"));
  await fs.writeFile(path.join(root,"index.html"), '<html><head></head><body><script type="module" src="/assets/index-demo.js"></script></body></html>');
  await fs.writeFile(path.join(root,"assets/index-demo.js"), bundle);
  return root;
}

test("comparison refuses a live-backed bundle", async (t) => {
  const root = await fixture(t, 'const backend="https://example.supabase.co";');
  await assert.rejects(serveMotionComparison(root, 0), /local mock/);
});

test("comparison serves isolated variants and refuses writes and service workers", async (t) => {
  const root = await fixture(t, 'const backend="http://127.0.0.1:5433";');
  const server = await serveMotionComparison(root, 0);
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = await (await fetch(base + "/app?variant=A")).text();
  const b = await (await fetch(base + "/app?variant=B")).text();
  assert.match(a, /localStorage.removeItem\("lpc-auth"\)/);
  assert.doesNotMatch(a, /@keyframes saRadial/);
  assert.match(b, /@keyframes saRadial/);
  assert.match(b, /index-demo.js/);
  assert.equal((await fetch(base, {method:"POST"})).status, 405);
  assert.equal((await fetch(base + "/sw.js")).status, 204);
  // Node's fetch normalizes Host. Use an actual HTTP header for this guard.
  const badHost = await new Promise((resolve,reject) => {
    const req = http.get(base, {headers:{Host:"untrusted.example"}}, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error",reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(base + "/%2e%2e%5cpackage.json")).status, 403);
});

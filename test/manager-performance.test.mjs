import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { assetPath, serveManagerProbe } from "../scripts/manager-performance.mjs";

test("the local manager probe only resolves files inside its build directory", () => {
  const root = path.resolve("dist");
  assert.equal(assetPath(root, "/"), path.join(root, "index.html"));
  assert.equal(assetPath(root, "/assets/app.js?v=1"), path.join(root, "assets/app.js"));
  assert.equal(assetPath(root, "/%2e%2e%2foutside.txt"), null);
  assert.equal(assetPath(root, "/assets%5c..%5c..%5csecret"), null);
  assert.equal(assetPath(root, "/%00"), null);
});

test("the probe is injected into local HTML only and does not edit built assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sage-manager-probe-"));
  let server;
  try {
    const html = "<html><body><div id='root'></div></body></html>";
    await fs.writeFile(path.join(root, "index.html"), html);
    await fs.writeFile(path.join(root, "app.js"), "console.log('unchanged');");
    server = await serveManagerProbe(root, 0);
    const url = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /manager-performance-results/);
    assert.equal(await fs.readFile(path.join(root, "index.html"), "utf8"), html);
    assert.equal(await (await fetch(url + "/app.js")).text(), "console.log('unchanged');");
    assert.equal((await fetch(url + "/missing.js")).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Source guard, not a rendering test. The figures now draw as dot glyphs;
// animating discarded values would rerender and clone the entire tube again.
test("StoreHero does not animate discarded count-up values", async () => {
  const source = await fs.readFile(new URL("../src/Manager.jsx", import.meta.url), "utf8");
  assert.equal(/const\s+n(?:Pct|Roster|Opps)\s*=\s*useCountUp/.test(source), false);
  assert.match(source, /function CountUp\(/, "visible count-up components still exist");
  assert.match(source, /ghostRef\.current = t\.cloneNode\(true\)/, "the CRT old-frame snapshot remains");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Run the actual mock on an ephemeral loopback port without changing its CLI
// or competing with a feel session's server on 5433.
test("mock OPTIONS explicitly permits the authenticated client's headers", async (t) => {
  let server;
  const listen = http.Server.prototype.listen;
  let ready;
  const listening = new Promise(resolve => { ready = resolve; });
  const stub = t.mock.method(http.Server.prototype, "listen", function (_port, host) {
    server = this;
    return listen.call(this, 0, host, ready);
  });
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  try { await import("../scripts/mock-supabase.mjs"); }
  finally { stub.mock.restore(); }
  await listening;
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ["/rest/v1/floor_public?select=*", "GET", "Authorization, apikey, x-client-info, accept-profile"],
    ["/rest/v1/floor_public", "PATCH", "authorization, apikey, content-type, content-profile, prefer, x-client-info"],
    ["/auth/v1/token?grant_type=password", "POST", "authorization, apikey, content-type, x-client-info, x-supabase-api-version"],
  ];
  for (const [url, method, requested] of cases) {
    await t.test(`${method} ${url}`, async () => {
      const response = await fetch(origin + url, { method: "OPTIONS", headers: {
        Origin: "http://localhost:5178", "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": requested,
      }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
      const allowed = response.headers.get("access-control-allow-headers").toLowerCase().split(/\s*,\s*/);
      for (const header of requested.toLowerCase().split(/\s*,\s*/)) {
        assert.ok(allowed.includes(header), `${header} must be explicitly allowed; wildcard does not cover Authorization`);
      }
      assert.ok(!allowed.includes("*"));
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("access-control-allow-methods"), "*");
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
    });
  }
});

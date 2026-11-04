/** Direct-handler lifecycle checks. All requests stop at this fictional fetch stub. */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://lifecycle.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-service";
let caller, calls;
const json = (value) => new Response(JSON.stringify(value), {
  status: 200, headers: { "content-type": "application/json" },
});
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  assert.equal(parsed.origin, "https://lifecycle.invalid", "never contact a real service");
  const method = options.method || "GET";
  calls.push({ path: parsed.pathname, method, query: parsed.searchParams, body: options.body });
  if (parsed.pathname === "/auth/v1/user") return json({ id: "caller" });
  if (parsed.pathname === "/auth/v1/admin/users") return json({ users: [] });
  if (parsed.pathname === "/rest/v1/profiles") {
    if (method === "PATCH") return json([]);
    const profile = parsed.searchParams.get("id") === "eq.caller" ? caller : { role: "manager" };
    const columns = parsed.searchParams.get("select").split(",").map((name) => name.trim());
    return json(profile ? [Object.fromEntries(Object.entries(profile).filter(([key]) => columns.includes(key)))] : []);
  }
  if (parsed.pathname === "/rest/v1/floor_people") {
    return json(method === "GET" ? [{ user_id: "target", store: "fictional", person_id: "person" }] : []);
  }
  if (parsed.pathname === "/rest/v1/device_tokens") return json([]);
  throw new Error(`Unexpected request: ${parsed.pathname}`);
};
const { default: link } = await import("../api/link-person.mjs");
const { default: account } = await import("../api/floor-account.mjs");

const operations = ["read", "link", "unlink", "activate", "deactivate"];
const profiles = [
  ["approved manager", { role: "manager", stores: ["fictional"], active: true, pending: false }, true],
  ["approved overseer", { role: "overseer", stores: ["fictional"], active: true, pending: false }, true],
  ["approved admin without store membership", { role: "admin", stores: [], active: true, pending: false }, true],
  ["pending admin preserves the existing exception", { role: "admin", stores: [], active: true, pending: true }, true],
  ["inactive manager", { role: "manager", stores: ["fictional"], active: false, pending: false }, false],
  ["pending manager", { role: "manager", stores: ["fictional"], active: true, pending: true }, false],
  ["inactive overseer", { role: "overseer", stores: ["fictional"], active: false, pending: false }, false],
  ["pending overseer", { role: "overseer", stores: ["fictional"], active: true, pending: true }, false],
  ["inactive admin", { role: "admin", stores: [], active: false, pending: false }, false],
  ["inactive pending admin", { role: "admin", stores: [], active: false, pending: true }, false],
  ["wrong-store manager", { role: "manager", stores: ["elsewhere"], active: true, pending: false }, false],
  ["missing active state", { role: "manager", stores: ["fictional"], pending: false }, false],
  ["missing pending state", { role: "manager", stores: ["fictional"], active: true }, false],
  ["null lifecycle state", { role: "manager", stores: ["fictional"], active: null, pending: null }, false],
  ["missing profile", null, false],
];
for (const [name, profile, allowed] of profiles) {
  for (const operation of operations) {
    test(`${name}: ${operation}`, async () => {
      caller = profile; calls = [];
      const body = { store: "fictional", user_id: "target", person_id: "person" };
      if (operation === "unlink") body.unlink = true;
      if (operation === "activate" || operation === "deactivate") body.action = operation;
      const response = {
        status(code) { this.code = code; return this; },
        json(value) { this.body = value; return this; },
      };
      await (body.action ? account : link)({
        method: operation === "read" ? "GET" : "POST",
        url: "/api/link-person?store=fictional",
        headers: { authorization: "Bearer fictional-token" }, body,
      }, response);
      assert.equal(response.code, allowed ? 200 : 403, JSON.stringify(response.body));
      assert.equal(calls[0].path, "/auth/v1/user");
      assert.equal(calls[1].path, "/rest/v1/profiles");
      assert.equal(calls[1].query.get("id"), "eq.caller");
      assert.deepEqual(calls[1].query.get("select").split(",").map((v) => v.trim()), ["role", "stores", "active", "pending"]);
      if (!allowed) {
        assert.equal(calls.length, 2, "denied callers perform only authentication and their own profile lookup");
        assert.ok(calls.every((call) => call.method === "GET"), "no mutation on denial");
        return;
      }
      const mutations = calls.filter((call) => call.method !== "GET");
      if (operation === "read") {
        assert.equal(mutations.length, 0);
        assert.ok(calls.some((call) => call.path === "/auth/v1/admin/users"));
      } else if (operation === "link") {
        assert.equal(mutations.length, 1);
        assert.equal(mutations[0].path, "/rest/v1/floor_people");
        assert.equal(JSON.parse(mutations[0].body).linked_by, "caller");
      } else if (operation === "unlink") {
        assert.deepEqual(mutations.map((call) => [call.path, call.method]), [
          ["/rest/v1/floor_people", "DELETE"], ["/rest/v1/device_tokens", "DELETE"],
        ]);
      } else {
        assert.equal(mutations.length, 1);
        assert.equal(mutations[0].path, "/rest/v1/profiles");
        assert.equal(mutations[0].query.get("id"), "eq.target");
        assert.deepEqual(JSON.parse(mutations[0].body), { active: operation === "activate" });
      }
    });
  }
}

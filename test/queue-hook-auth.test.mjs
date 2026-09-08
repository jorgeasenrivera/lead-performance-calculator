import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/queue-changed.mjs";

/* A webhook that answers "bad secret" to three different mistakes is a webhook
   nobody can fix from its delivery log. These pin the three apart, and pin that
   none of them ever says what the secret is. */
const call = async (headers, env) => {
  const had = process.env.QUEUE_HOOK_SECRET;
  if (env === undefined) delete process.env.QUEUE_HOOK_SECRET;
  else process.env.QUEUE_HOOK_SECRET = env;
  let code = 0, body = null;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
  await handler({ method: "POST", headers, body: {} }, res);
  if (had === undefined) delete process.env.QUEUE_HOOK_SECRET; else process.env.QUEUE_HOOK_SECRET = had;
  return { code, body };
};

test("no secret on the server says so, and does not say what was sent", async () => {
  const r = await call({ "x-lpc-secret": "sent-value" }, undefined);
  assert.equal(r.code, 401);
  assert.match(r.body.error, /no QUEUE_HOOK_SECRET set on the server/);
  assert.ok(!JSON.stringify(r.body).includes("sent-value"));
});

test("no header on the request says so", async () => {
  const r = await call({}, "server-value");
  assert.equal(r.code, 401);
  assert.match(r.body.error, /no x-lpc-secret header/);
});

test("a mismatch says so, and names neither value", async () => {
  const r = await call({ "x-lpc-secret": "sent-value" }, "server-value");
  assert.equal(r.code, 401);
  assert.match(r.body.error, /did not match/);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes("sent-value") && !s.includes("server-value"));
});

test("a matching secret gets past the gate", async () => {
  const r = await call({ "x-lpc-secret": "same" }, "same");
  assert.notEqual(r.code, 401);
});

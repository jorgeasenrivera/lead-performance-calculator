import { test } from "node:test";
import assert from "node:assert/strict";
import { errText, sendApns } from "../api/_push-apns.mjs";

/* "fetch failed" was the whole of what a dead push told us. These hold the
   chain open, and hold the secrets out of it. */
test("the cause chain is walked, nearest fault first", () => {
  const deep = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  const top = Object.assign(new Error("fetch failed"), { cause: deep });
  const s = errText(top);
  assert.match(s, /fetch failed/);
  assert.match(s, /UND_ERR_SOCKET/);
  assert.match(s, /other side closed/);
});

test("a bare error still says something", () => {
  assert.equal(errText(new Error("boom")), "boom");
  assert.equal(errText(null), "unknown");
});

test("a repeated message is not said twice", () => {
  const inner = new Error("same");
  const outer = Object.assign(new Error("same"), { cause: inner });
  assert.equal(errText(outer), "same");
});

/* A real signing key, made here, so the send can be exercised end to end
   without one being kept anywhere. */
import crypto from "node:crypto";
const testKey = () => crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" });
const cfg = () => ({ keyId: "K", teamId: "T", bundleId: "com.sageonline", p8: testKey() });

test("a throwing send reports the cause and never the device token", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const boom = () => Promise.reject(Object.assign(new Error("fetch failed"), { cause }));
  const r = await sendApns({ token: "SECRET-DEVICE-TOKEN", payload: {}, postImpl: boom, cfg: cfg() });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.match(r.reason, /ECONNREFUSED/);
  assert.ok(!JSON.stringify(r).includes("SECRET-DEVICE-TOKEN"));
});

test("the send speaks HTTP/2: an origin, a path, and lower-case headers", async () => {
  let saw = null;
  const spy = (opts) => { saw = opts; return Promise.resolve({ status: 200, text: "" }); };
  const r = await sendApns({ token: "abc123", payload: { aps: {} }, postImpl: spy, cfg: cfg() });
  assert.equal(r.ok, true);
  assert.equal(saw.origin, "https://api.push.apple.com");
  assert.equal(saw.path, "/3/device/abc123");
  assert.equal(saw.headers["apns-topic"], "com.sageonline");
  assert.match(saw.headers.authorization, /^bearer /);
  for (const k of Object.keys(saw.headers)) assert.equal(k, k.toLowerCase(), k + " must be lower case for HTTP/2");
});

test("a Live Activity push goes to the activity topic", async () => {
  let saw = null;
  const spy = (opts) => { saw = opts; return Promise.resolve({ status: 200, text: "" }); };
  await sendApns({ token: "t", payload: {}, pushType: "liveactivity", postImpl: spy, cfg: cfg() });
  assert.equal(saw.headers["apns-topic"], "com.sageonline.push-type.liveactivity");
});

test("Apple's refusal is read out of the body, and 410 retires the token", async () => {
  const gone = () => Promise.resolve({ status: 410, text: JSON.stringify({ reason: "Unregistered" }) });
  const r = await sendApns({ token: "t", payload: {}, postImpl: gone, cfg: cfg() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "Unregistered");
  assert.equal(r.gone, true);
});

test("a wrong-environment refusal is tried once on the other side", async () => {
  const seen = [];
  const impl = ({ origin }) => {
    seen.push(origin);
    return Promise.resolve(origin.includes("sandbox")
      ? { status: 200, text: "" }
      : { status: 403, text: JSON.stringify({ reason: "BadEnvironmentKeyInToken" }) });
  };
  const r = await sendApns({ token: "t", payload: {}, postImpl: impl, cfg: cfg(), env: "production" });
  assert.equal(r.ok, true);
  assert.equal(r.env, "sandbox");
  assert.deepEqual(seen, ["https://api.push.apple.com", "https://api.sandbox.push.apple.com"]);
});

test("both sides refusing reports the first answer and stops", async () => {
  let calls = 0;
  const impl = () => { calls++; return Promise.resolve({ status: 403, text: JSON.stringify({ reason: "BadDeviceToken" }) }); };
  const r = await sendApns({ token: "t", payload: {}, postImpl: impl, cfg: cfg(), env: "production" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "BadDeviceToken");
  assert.equal(r.gone, true);
  assert.equal(calls, 2, "one retry, and only one");
});

test("a refusal that is not about the environment is not retried", async () => {
  let calls = 0;
  const impl = () => { calls++; return Promise.resolve({ status: 400, text: JSON.stringify({ reason: "TopicDisallowed" }) }); };
  const r = await sendApns({ token: "t", payload: {}, postImpl: impl, cfg: cfg(), env: "production" });
  assert.equal(r.reason, "TopicDisallowed");
  assert.equal(calls, 1);
});

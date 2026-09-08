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

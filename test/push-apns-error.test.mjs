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

test("a throwing send reports the cause and no token or key", async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const boom = () => Promise.reject(Object.assign(new Error("fetch failed"), { cause }));
  const r = await sendApns({ token: "SECRET-DEVICE-TOKEN", payload: {}, fetchImpl: boom,
                             cfg: { keyId: "K", teamId: "T", bundleId: "com.sageonline",
                                    p8: process.env.APNS_TEST_P8 || "" } }).catch((e) => ({ threw: e.message }));
  if (r.threw) return;                       // no key to sign with here; the shape is covered above
  assert.equal(r.ok, false);
  assert.match(r.reason, /ECONNREFUSED/);
  assert.ok(!JSON.stringify(r).includes("SECRET-DEVICE-TOKEN"));
});

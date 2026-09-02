import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationBody } from "../api/_device.mjs";

test("an iPhone registers an APNs token", () => {
  assert.deepEqual(registrationBody({ platform: "ios", deviceId: "D1", pushToken: "abc" }, "honda"),
    { store: "honda", platform: "ios", device_id: "D1", apns_token: "abc" });
});
test("an Android phone registers an FCM token", () => {
  assert.deepEqual(registrationBody({ platform: "android", deviceId: "A9", pushToken: "fcm1" }, "honda"),
    { store: "honda", platform: "android", device_id: "A9", fcm_token: "fcm1" });
});
test("nothing to register without a token, a device or a store", () => {
  assert.equal(registrationBody({ platform: "ios", deviceId: "D1", pushToken: null }, "honda"), null);
  assert.equal(registrationBody({ platform: "ios", deviceId: null, pushToken: "abc" }, "honda"), null);
  assert.equal(registrationBody({ platform: "ios", deviceId: "D1", pushToken: "abc" }, ""), null);
  assert.equal(registrationBody({ platform: "web", deviceId: "D1", pushToken: "abc" }, "honda"), null);
});

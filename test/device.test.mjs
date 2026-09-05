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
test("an iPhone with a Live Activity registers those tokens too", () => {
  assert.deepEqual(registrationBody({ platform: "ios", deviceId: "D1", pushToken: "abc", ptsToken: "pts1", activityToken: "act1" }, "honda"),
    { store: "honda", platform: "ios", device_id: "D1", apns_token: "abc", apns_pts_token: "pts1", activity_token: "act1" });
  // Only the one that has arrived; the endpoint merges the rest.
  assert.deepEqual(registrationBody({ platform: "ios", deviceId: "D1", pushToken: "abc", ptsToken: "pts1" }, "honda"),
    { store: "honda", platform: "ios", device_id: "D1", apns_token: "abc", apns_pts_token: "pts1" });
  // Android has no ActivityKit; nothing leaks across.
  assert.deepEqual(registrationBody({ platform: "android", deviceId: "A9", pushToken: "fcm1", ptsToken: "x" }, "honda"),
    { store: "honda", platform: "android", device_id: "A9", fcm_token: "fcm1" });
});

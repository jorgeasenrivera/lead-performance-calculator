/* What the page sends to /api/register-device once the shell has handed it the
   phone's own push token. The shell speaks the phone's names for things; the
   API speaks the queue's. This is the translation, kept pure so it is tested. */
export function registrationBody(native, store) {
  if (!native || !store || !native.deviceId || !native.pushToken) return null;
  const platform = native.platform === "ios" ? "ios" : native.platform === "android" ? "android" : null;
  if (!platform) return null;
  const body = { store, platform, device_id: String(native.deviceId) };
  body[platform === "ios" ? "apns_token" : "fcm_token"] = String(native.pushToken);
  /* The Live Activity's two tokens ride along when the shell has them (iOS
     only; push-to-start needs 17.2). The endpoint merges, so a body without
     them never blanks ones already filed. */
  if (platform === "ios") {
    if (native.ptsToken) body.apns_pts_token = String(native.ptsToken);
    if (native.activityToken) body.activity_token = String(native.activityToken);
  }
  return body;
}

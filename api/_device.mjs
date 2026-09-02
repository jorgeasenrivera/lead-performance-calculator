/* What the page sends to /api/register-device once the shell has handed it the
   phone's own push token. The shell speaks the phone's names for things; the
   API speaks the queue's. This is the translation, kept pure so it is tested. */
export function registrationBody(native, store) {
  if (!native || !store || !native.deviceId || !native.pushToken) return null;
  const platform = native.platform === "ios" ? "ios" : native.platform === "android" ? "android" : null;
  if (!platform) return null;
  const body = { store, platform, device_id: String(native.deviceId) };
  body[platform === "ios" ? "apns_token" : "fcm_token"] = String(native.pushToken);
  return body;
}

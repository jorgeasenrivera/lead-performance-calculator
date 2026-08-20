/**
 * Android push, and the ongoing notification that stands in for a Live Activity.
 * -------------------------------------------------------------------------
 * Android has no ActivityKit. What it does have is a notification that can be
 * ongoing (not swipeable away), silent on update, and re-posted under the same
 * id — which behaves like a Live Activity in the way that matters here: a
 * salesperson glances at their lock screen and sees where they are in the line.
 *
 * The buzz and the standing display are the same mechanism on Android, told
 * apart by priority and whether they make a sound. Re-posting the same
 * notification id replaces it in place rather than stacking a second one, which
 * is why every message here carries a tag.
 *
 * Auth is OAuth2 against the service account, cached for its hour.
 *
 * Env:
 *   FCM_PROJECT_ID
 *   FCM_CLIENT_EMAIL
 *   FCM_PRIVATE_KEY     newlines as \n
 */
import crypto from "node:crypto";

let cached = { token: null, exp: 0 };
export function _clearFcmToken() { cached = { token: null, exp: 0 }; }

export async function fcmAccessToken({ now = Date.now(), fetchImpl = fetch, cfg = {} } = {}) {
  if (cached.token && now < cached.exp - 60_000) return cached.token;
  const email = cfg.clientEmail || process.env.FCM_CLIENT_EMAIL;
  const key = (cfg.privateKey || process.env.FCM_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("FCM is not configured");

  const iat = Math.floor(now / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim = b64({ iss: email, scope: "https://www.googleapis.com/auth/firebase.messaging",
                      aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 });
  const head = b64({ alg: "RS256", typ: "JWT" });
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key).toString("base64url");

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                assertion: `${head}.${claim}.${sig}` }).toString(),
  });
  if (!res.ok) throw new Error("FCM token exchange failed: " + res.status);
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

/** The buzz: it wakes the phone and it makes a noise. */
export function fcmUpMessage({ token, title, body, tag = "lpc-queue", data = {} }) {
  return { message: { token,
    notification: { title, body },
    android: { priority: "HIGH", notification: {
      tag, channel_id: "queue_up", notification_priority: "PRIORITY_MAX",
      default_sound: true, default_vibrate_timings: true, visibility: "PUBLIC" } },
    data: { ...data, kind: "up" } } };
}

/** The standing display: ongoing, silent, replaced in place. */
export function fcmStandingMessage({ token, title, body, tag = "lpc-queue", data = {} }) {
  return { message: { token,
    /* No `notification` block. A data-only message lets the app post and re-post
       the ongoing notification itself, which is the only way to keep it from
       being swiped away and the only way to update it without a sound. */
    android: { priority: "HIGH", ttl: "3600s" },
    data: { ...data, kind: "position", title, body, tag, ongoing: "true" } } };
}

/** Take the standing display down. */
export function fcmEndMessage({ token, tag = "lpc-queue", data = {} }) {
  return { message: { token, android: { priority: "NORMAL" },
    data: { ...data, kind: "end", tag } } };
}

export async function sendFcm({ message, fetchImpl = fetch, now = Date.now(), cfg = {} }) {
  const project = cfg.projectId || process.env.FCM_PROJECT_ID;
  const access = await fcmAccessToken({ now, fetchImpl, cfg });
  const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (res.ok) return { ok: true };
  let err = {};
  try { err = await res.json(); } catch { /* nothing useful in the body */ }
  const status = (err && err.error && err.error.status) || "";
  // The device has uninstalled or the token rotated: stop sending to it.
  const gone = res.status === 404 || status === "NOT_FOUND" || status === "UNREGISTERED";
  return { ok: false, status: res.status, reason: status, gone };
}

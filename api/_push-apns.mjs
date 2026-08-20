/**
 * Apple push, including Live Activities.
 * -------------------------------------------------------------------------
 * Three different things go over the same connection and Apple tells them apart
 * by headers rather than by payload, which is the part that catches people out:
 *
 *   alert         topic = <bundle>                              a normal push
 *   liveactivity  topic = <bundle>.push-type.liveactivity       start/update/end
 *
 * A Live Activity push carries no badge or sound of its own — it moves a display
 * that is already on the lock screen. The "you're up" buzz is a separate alert
 * push. Sending one and expecting the other is silent failure.
 *
 * Auth is a JWT signed with the .p8 key from the developer account, good for an
 * hour; Apple rejects tokens refreshed more often than every 20 minutes, so it is
 * cached and reused rather than minted per send.
 *
 * Env:
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID
 *   APNS_KEY_P8         the .p8 contents, newlines as \n
 *   APNS_ENV            "production" | "sandbox"  (default production)
 */
import crypto from "node:crypto";

const HOST = (env) => (env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");

let cached = { token: null, at: 0 };

export function apnsJwt(now = Date.now(), cfg = {}) {
  const keyId = cfg.keyId || process.env.APNS_KEY_ID;
  const teamId = cfg.teamId || process.env.APNS_TEAM_ID;
  const p8 = (cfg.p8 || process.env.APNS_KEY_P8 || "").replace(/\\n/g, "\n");
  if (!keyId || !teamId || !p8) throw new Error("APNs is not configured");
  // Apple refuses a token minted less than 20 minutes after the last one.
  if (cached.token && now - cached.at < 40 * 60 * 1000) return cached.token;

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: keyId });
  const body = b64({ iss: teamId, iat: Math.floor(now / 1000) });
  const sig = crypto.createSign("SHA256").update(`${head}.${body}`)
    .sign({ key: p8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cached = { token: `${head}.${body}.${sig}`, at: now };
  return cached.token;
}

/** Reset between tests, and after a credential change. */
export function _clearApnsJwt() { cached = { token: null, at: 0 }; }

/* ---- the three payloads ---- */

/** The buzz. This is the one that has to reach somebody walking a lot. */
export function alertPayload({ title, body, data = {} }) {
  return {
    aps: {
      alert: { title, body },
      sound: "default",
      "interruption-level": "time-sensitive",   // through Focus, which a floor uses
      "relevance-score": 1,
    },
    ...data,
  };
}

/** Start a Live Activity from the server (iOS 17.2+, push-to-start token). */
export function liveStartPayload({ state, attributes, attributesType, staleAfterSec = 60 * 60, now = Date.now() }) {
  return {
    aps: {
      timestamp: Math.floor(now / 1000),
      event: "start",
      "content-state": state,
      "attributes-type": attributesType,
      attributes,
      "stale-date": Math.floor(now / 1000) + staleAfterSec,
      "relevance-score": state && state.up ? 100 : 50,
    },
  };
}

/** Move an activity that is already on screen. No sound, no alert. */
export function liveUpdatePayload({ state, staleAfterSec = 60 * 60, now = Date.now(), alert = null }) {
  const aps = {
    timestamp: Math.floor(now / 1000),
    event: "update",
    "content-state": state,
    "stale-date": Math.floor(now / 1000) + staleAfterSec,
    "relevance-score": state && state.up ? 100 : 50,
  };
  /* An update MAY carry an alert, which is how a Live Activity can buzz on a
     locked phone without a second push. Used only for "you're up". */
  if (alert) aps.alert = alert;
  return { aps };
}

/** Take it off the lock screen. */
export function liveEndPayload({ state = {}, dismissAt = null, now = Date.now() }) {
  const aps = {
    timestamp: Math.floor(now / 1000),
    event: "end",
    "content-state": state,
  };
  // Absent, iOS leaves the final state up for up to four hours.
  aps["dismissal-date"] = Math.floor((dismissAt ? dismissAt : now) / 1000);
  return { aps };
}

/* ---- the send ---- */
export async function sendApns({ token, payload, pushType = "alert", topic, priority = 10,
                                 collapseId = null, env = process.env.APNS_ENV, fetchImpl = fetch, cfg = {} }) {
  const bundle = cfg.bundleId || process.env.APNS_BUNDLE_ID;
  const headers = {
    authorization: `bearer ${apnsJwt(Date.now(), cfg)}`,
    "apns-push-type": pushType,
    "apns-topic": topic || (pushType === "liveactivity" ? `${bundle}.push-type.liveactivity` : bundle),
    "apns-priority": String(priority),
    "content-type": "application/json",
  };
  if (collapseId) headers["apns-collapse-id"] = collapseId.slice(0, 64);

  const res = await fetchImpl(`${HOST(env)}/3/device/${token}`, {
    method: "POST", headers, body: JSON.stringify(payload),
  });
  if (res.status === 200) return { ok: true };
  let reason = "";
  try { reason = (await res.json()).reason || ""; } catch { /* empty body is normal on some errors */ }
  /* 410 means the device is gone for good — the caller should forget the token
     rather than retry it every time the line moves for the rest of the year. */
  return { ok: false, status: res.status, reason, gone: res.status === 410 || reason === "BadDeviceToken" };
}

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

import http2 from "node:http2";

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
export function liveStartPayload({ state, attributes, attributesType, staleAfterSec = 12 * 60 * 60, now = Date.now() }) {
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
export function liveUpdatePayload({ state, staleAfterSec = 12 * 60 * 60, now = Date.now(), alert = null }) {
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

/* Node's fetch reports every transport failure as the same two words, "fetch
   failed", and puts the actual fault underneath in `cause`: the refused
   connection, the DNS miss, the timeout, the certificate. Reported as those two
   words it names nothing and cannot be acted on, which is exactly where a real
   push failure left us. So the chain is walked and the codes kept. Codes and
   messages only; no token, no key, nothing that identifies a phone. */
export function errText(e, depth = 3) {
  const bits = [];
  let cur = e;
  for (let i = 0; cur && i <= depth; i++) {
    const part = [cur.code, cur.message || (typeof cur === "string" ? cur : "")]
      .filter(Boolean).join(" ").trim();
    if (part && !bits.includes(part)) bits.push(part);
    cur = cur.cause;
  }
  return bits.join(" <- ") || "unknown";
}

/* ---- the wire ----
   APNs is an HTTP/2 service and Node's fetch speaks HTTP/1.1, so every push
   this app has ever sent died in the parser with "Response does not match the
   HTTP/1.1 protocol": Apple answered in frames the client could not read. It
   looks like a protocol a server would simply refuse, which is why it took a
   production log to catch — probing the endpoint by hand gets an HTTP/1.1 403
   from something in front of it and tells you nothing.

   A session per send, closed after. A serverless function takes a burst and
   then goes away, so a pooled connection is one nobody is left to close. */
export function apnsPost({ origin, path, headers, body, timeoutMs = 10000,
                           connect = http2.connect }) {
  return new Promise((resolve, reject) => {
    let session;
    try { session = connect(origin); } catch (e) { reject(e); return; }
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { session.close(); } catch (e) { /* already gone */ }
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, Object.assign(new Error("APNs did not answer in time"), { code: "APNS_TIMEOUT" })),
      timeoutMs);
    session.on("error", (e) => finish(reject, e));
    let req;
    try {
      req = session.request({ ":method": "POST", ":path": path, ...headers });
    } catch (e) { finish(reject, e); return; }
    let status = 0, text = "";
    req.on("response", (h) => { status = Number(h[":status"]) || 0; });
    req.on("data", (d) => { text += d; });
    req.on("error", (e) => finish(reject, e));
    req.on("end", () => finish(resolve, { status, text }));
    req.end(body);
  });
}

/* ---- the send ---- */
export async function sendApns({ token, payload, pushType = "alert", topic, priority = 10,
                                 collapseId = null, env = process.env.APNS_ENV, postImpl = apnsPost, cfg = {} }) {
  const bundle = cfg.bundleId || process.env.APNS_BUNDLE_ID;
  const headers = {
    authorization: `bearer ${apnsJwt(Date.now(), cfg)}`,
    "apns-push-type": pushType,
    "apns-topic": topic || (pushType === "liveactivity" ? `${bundle}.push-type.liveactivity` : bundle),
    "apns-priority": String(priority),
    "content-type": "application/json",
  };
  if (collapseId) headers["apns-collapse-id"] = collapseId.slice(0, 64);

  let res;
  try {
    res = await postImpl({ origin: HOST(env), path: `/3/device/${token}`,
                           headers, body: JSON.stringify(payload) });
  } catch (e) {
    // Apple never answered. Say what actually stopped it rather than "failed".
    return { ok: false, status: 0, reason: errText(e), gone: false };
  }
  if (res.status === 200) return { ok: true };
  let reason = "";
  try { reason = JSON.parse(res.text || "{}").reason || ""; } catch { /* empty body is normal on some errors */ }
  /* 410 means the device is gone for good — the caller should forget the token
     rather than retry it every time the line moves for the rest of the year. */
  return { ok: false, status: res.status, reason, gone: res.status === 410 || reason === "BadDeviceToken" };
}

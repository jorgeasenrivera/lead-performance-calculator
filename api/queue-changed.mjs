/**
 * Vercel serverless function — /api/queue-changed
 * -------------------------------------------------------------------------
 * Supabase calls this whenever a row in queue_public is written. It works out
 * what the change means for each person in that line (see _queue-notify.mjs)
 * and tells their devices.
 *
 * This has to live on a server rather than in the app for the obvious reason:
 * the phone we need to reach is in a pocket with the screen off. That is the
 * entire point of the feature, and it is why nothing about it can be done from
 * the browser.
 *
 * Set up in Supabase → Database → Webhooks: table queue_public, events INSERT
 * and UPDATE, method POST, and one header — x-lpc-secret — matching
 * QUEUE_HOOK_SECRET here.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (server only, never shipped)
 *   QUEUE_HOOK_SECRET                          shared with the webhook
 *   plus the APNs and FCM variables the senders document
 */
import { createClient } from "@supabase/supabase-js";
import { decide, contentState } from "./_queue-notify.mjs";
import { alertPayload, liveUpdatePayload, liveEndPayload, liveStartPayload, sendApns } from "./_push-apns.mjs";
import { fcmUpMessage, fcmStandingMessage, fcmEndMessage, sendFcm } from "./_push-fcm.mjs";

const ACTIVITY_TYPE = "QueueAttributes";     // must match the Swift struct's name

/* The line's own id carries the store, the day and which queue it is. */
function partsOf(rowId) {
  const [store, date, kind = "line"] = String(rowId || "").split(":");
  return { store, date, kind };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.QUEUE_HOOK_SECRET || req.headers["x-lpc-secret"] !== process.env.QUEUE_HOOK_SECRET) {
    return res.status(401).json({ error: "bad secret" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const after = body.record || null;
  const before = body.old_record || null;
  if (!after) return res.status(200).json({ ok: true, sent: 0, note: "nothing to compare" });

  const { store, date, kind } = partsOf(after.id);
  const plan = decide(before && before.data, after.data);
  if (!plan.length) return res.status(200).json({ ok: true, sent: 0 });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  /* Devices belonging to the people this change touches. One query, not one per
     person: a busy floor changes the line every few seconds and this endpoint is
     on the path of every one of them. */
  const ids = [...new Set(plan.map((p) => p.id))];
  const { data: devices, error } = await db
    .from("device_tokens").select("*").eq("store", store).in("person_id", ids);
  if (error) return res.status(500).json({ error: "device lookup failed" });

  const byPerson = new Map();
  for (const d of devices || []) {
    if (!byPerson.has(d.person_id)) byPerson.set(d.person_id, []);
    byPerson.get(d.person_id).push(d);
  }

  const attributes = { store, date, kind };
  const results = [];
  const retire = [];            // tokens the platforms told us are dead

  await Promise.all(plan.flatMap((item) => (byPerson.get(item.id) || []).map(async (dev) => {
    const state = contentState({ ahead: item.ahead ?? 0, up: item.kind === "up",
                                 status: item.status || "waiting", label: item.label });
    /* One collapse id per person per queue: a phone that was off all through a
       busy hour should wake to where the line is NOW, not to forty of them. */
    const collapseId = `${store}:${kind}:${item.id}`;

    try {
      if (dev.platform === "ios") {
        if (item.kind === "end") {
          if (dev.activity_token) {
            results.push(await sendApns({ token: dev.activity_token, pushType: "liveactivity",
              payload: liveEndPayload({ state }), priority: 5, collapseId }));
          }
        } else if (item.kind === "up") {
          // The buzz goes to the device; the display moves on its own token.
          if (dev.apns_token) {
            results.push(await sendApns({ token: dev.apns_token, pushType: "alert", collapseId,
              payload: alertPayload({ title: item.title, body: item.body,
                                      data: { store, kind, date, ahead: 0, up: true } }) }));
          }
          if (dev.activity_token) {
            results.push(await sendApns({ token: dev.activity_token, pushType: "liveactivity", collapseId,
              payload: liveUpdatePayload({ state, alert: { title: item.title, body: item.body } }) }));
          } else if (dev.apns_pts_token) {
            /* No activity running: start one from here. Push-to-start needs
               iOS 17.2 or newer, which is why the plain alert above is sent
               regardless rather than being made conditional on this working. */
            results.push(await sendApns({ token: dev.apns_pts_token, pushType: "liveactivity", collapseId,
              payload: liveStartPayload({ state, attributes, attributesType: ACTIVITY_TYPE }) }));
          }
        } else {
          if (dev.activity_token) {
            results.push(await sendApns({ token: dev.activity_token, pushType: "liveactivity",
              payload: liveUpdatePayload({ state }), priority: 5, collapseId }));
          } else if (dev.apns_pts_token) {
            results.push(await sendApns({ token: dev.apns_pts_token, pushType: "liveactivity", priority: 5,
              collapseId, payload: liveStartPayload({ state, attributes, attributesType: ACTIVITY_TYPE }) }));
          }
        }
      } else if (dev.platform === "android" && dev.fcm_token) {
        const body = item.kind === "up" ? item.body
          : item.ahead === 0 ? "You're next." : `${item.ahead} ahead of you.`;
        const msg = item.kind === "end" ? fcmEndMessage({ token: dev.fcm_token, tag: collapseId, data: { store, kind } })
          : item.kind === "up" ? fcmUpMessage({ token: dev.fcm_token, title: item.title, body: item.body,
                                                tag: collapseId, data: { store, kind, ahead: "0" } })
          : fcmStandingMessage({ token: dev.fcm_token, title: "In the line", body,
                                 tag: collapseId, data: { store, kind, ahead: String(item.ahead ?? 0) } });
        results.push(await sendFcm({ message: msg }));
      }
    } catch (e) {
      /* One device failing is not a reason to leave the rest of the floor
         unnotified, so every send is caught individually. */
      results.push({ ok: false, reason: String((e && e.message) || e) });
    }

    const last = results[results.length - 1];
    if (last && last.gone) retire.push(dev.id);
  })));

  /* A dead token retried on every queue change is a slow leak of both time and
     the platforms' patience. Forget them. */
  if (retire.length) {
    try { await db.from("device_tokens").delete().in("id", retire); } catch { /* next time */ }
  }

  const sent = results.filter((r) => r && r.ok).length;
  return res.status(200).json({ ok: true, planned: plan.length, sent, failed: results.length - sent,
                                retired: retire.length });
}

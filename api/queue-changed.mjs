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
 * Set up in Supabase → Database → Webhooks: tables queue_public AND
 * floor_public, events INSERT and UPDATE, method POST, and one header —
 * x-lpc-secret — matching QUEUE_HOOK_SECRET here. Both tables are wired to this
 * one handler because a line and a floor are the same thing to a phone: a place
 * you are standing in, and a moment somebody needs to know about. The floor rows
 * carry no kind in their id, so the table name is what says which it is.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (server only, never shipped)
 *   QUEUE_HOOK_SECRET                          shared with the webhook
 *   plus the APNs and FCM variables the senders document
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./_env.mjs";
import { decide, contentState, assistPlan, railOf, askOf } from "./_queue-notify.mjs";
import { liveEnvelope, decidePhone } from "./_live-standing.mjs";
import { alertPayload, liveUpdatePayload, liveEndPayload, liveStartPayload, sendApns } from "./_push-apns.mjs";
import { fcmUpMessage, fcmStandingMessage, fcmEndMessage, sendFcm } from "./_push-fcm.mjs";
import { sendAlert, worthSending } from "./_report-alert.mjs";

const ACTIVITY_TYPE = "QueueAttributes";     // must match the Swift struct's name

/* The line's own id carries the store, the day and which queue it is. A floor
   row's id has no kind on the end — the table it arrived from is the kind. */
function partsOf(rowId, table) {
  const [store, date, kind = "line"] = String(rowId || "").split(":");
  if (table === "floor_public") return { store, date, kind: "floor" };
  return { store, date, kind };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  /* One 401 with one message covered three different mistakes: the variable
     never set on the server, the header never sent by the webhook, and the two
     simply not matching. Somebody reading the delivery log could not tell which,
     and the answer decides where to go and fix it. Which side is wrong is not a
     secret; the value is, and none of these say it. */
  const want = process.env.QUEUE_HOOK_SECRET;
  const got = req.headers["x-lpc-secret"];
  if (!want) return res.status(401).json({ error: "no QUEUE_HOOK_SECRET set on the server" });
  if (!got) return res.status(401).json({ error: "no x-lpc-secret header on the request" });
  if (got !== want) return res.status(401).json({ error: "x-lpc-secret did not match QUEUE_HOOK_SECRET" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const after = body.record || null;
  const before = body.old_record || null;
  if (!after) return res.status(200).json({ ok: true, sent: 0, note: "nothing to compare" });

  /* Reports ride in this same table, so they arrive here too. They are not a
     queue change and there is nobody in a line to tell — but they are the one
     thing in the table somebody is waiting on, so they get carried on. Without
     this branch the row fell through partsOf() as a store called "ticket",
     matched no devices, and quietly went nowhere. */
  if (String(after.id || "").startsWith("ticket:")) {
    const t = after.data || {};
    /* Which kinds are worth interrupting somebody for is decided in one place,
       next to the wording each of them gets. A report of a wrong number, and a
       note from somebody who kept missing the standard: both are about today and
       both go stale in a panel. */
    if (!worthSending(t)) {
      return res.status(200).json({ ok: true, sent: 0, note: "nothing to carry on" });
    }
    const db0 = createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } });
    let hook = "";
    try {
      const { data } = await db0.from("app_data").select("value").eq("key", "lpc:config:v2").maybeSingle();
      hook = (data && data.value && data.value.support && data.value.support.alertWebhook) || "";
    } catch { /* the report is saved either way; this only ever adds */ }
    const out = await sendAlert(hook, t);
    return res.status(200).json({ ok: true, sent: out.sent ? 1 : 0, note: out.why || "alerted" });
  }

  const { store, date, kind } = partsOf(after.id, body.table);
  const plan = decide(before && before.data, after.data);
  /* FlyBy asks ride in the floor row beside the line. A new ask goes to the
     managers the board stamped onto the row, a claim goes back to the person
     waiting on it, an unclaimed T.O. re-pings after two minutes. */
  if (kind === "floor") plan.push(...assistPlan(before && before.data, after.data));

  const db = createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  /* The store's setup, for the phone room: which desks, and whether they
     rotate. One read; the same document the app reads. */
  let config = null;
  try {
    const { data } = await db.from("app_data").select("value").eq("key", "lpc:config:v2").maybeSingle();
    config = (data && data.value) || null;
  } catch { /* no room to speak of without it; the line still gets its pushes */ }

  /* The phone room's own moments: a desk offered (buzz), taken or freed
     (quiet). They outrank the line's quiet "position" for the same person in
     the same write, which would only say less. */
  if (kind === "line" && config) {
    const phone = decidePhone(config, store, before && before.data, after.data);
    for (const item of phone) {
      const at = plan.findIndex((x) => x.id === item.id && x.kind === "position");
      if (at >= 0) plan.splice(at, 1);
      if (!plan.some((x) => x.id === item.id && (x.kind === "up" || x.kind === "nudge" || x.kind === "end"))) plan.push(item);
    }
  }
  if (!plan.length) return res.status(200).json({ ok: true, sent: 0 });

  /* The other room's row, so the card carries both lanes: a person on the
     floor AND the phone line gets one card, not the last room to write. */
  let floorRow = kind === "floor" ? after.data : null;
  let queueRow = kind === "line" ? after.data : null;
  try {
    if (kind === "floor") {
      const { data } = await db.from("queue_public").select("data").eq("id", `${store}:${date}`).maybeSingle();
      queueRow = (data && data.data) || null;
    } else if (kind === "line") {
      const { data } = await db.from("floor_public").select("data").eq("id", `${store}:${date}`).maybeSingle();
      floorRow = (data && data.data) || null;
    }
  } catch { /* one lane is still a card */ }

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
    /* Beyond the standing: the rail (everybody in line, coloured), whether this
       is the desk asking, and where they are sitting when with a customer, so
       the card can draw the whole phase without the app open. */
    const meRow = ((after.data && after.data.line) || []).find((x) => x && x.id === item.id) || {};
    /* The v2 envelope rides in the same state: `floor`, `phone` and `hot`
       for the shell that reads them, the v1 fields for the one that does not.
       The v1 fields come from THIS row's lane when it is the one that moved,
       so a build-17 card keeps following the line it always followed. */
    const env = (config && liveEnvelope({ config, store, date, meId: item.id, floorRow, queueRow,
      lastRoom: kind === "line" ? "line" : "floor" })) || {};
    const state = contentState({ ahead: item.ahead ?? 0, up: item.kind === "up",
                                 status: item.status || "waiting", label: item.label },
      { line: railOf(after.data, item.id), nudge: item.kind === "nudge",
        table: meRow.table != null ? String(meRow.table) : null, since: meRow.statusAt || null,
        /* The open FlyBy or T.O., so the card can show it was asked and who
           picked it up. Without this the lock screen has no way to know. */
        ...askOf(after.data, item.id),
        ...(env.v === 2 && env.status !== "gone" ? { v: 2, hot: env.hot, floor: env.floor || null, phone: env.phone || null } : {}) });
    /* A desk offered is the phone room's "you're up": the old card says so. */
    if (item.kind === "offer") { state.up = true; state.ahead = 0; }
    /* A nudge on a phone that has no Live Activity running should not start one
       claiming a place in a line the person may not be in. The alert carries the
       message; the display only follows for people who are actually queued. */
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
        } else if (item.kind === "up" || item.kind === "nudge" || item.kind === "offer") {
          // The buzz goes to the device; the display moves on its own token.
          if (dev.apns_token) {
            results.push(await sendApns({ token: dev.apns_token, pushType: "alert", collapseId,
              payload: alertPayload({ title: item.title, body: item.body,
                                      data: { store, kind, date, ahead: item.ahead ?? 0,
                                              up: item.kind === "up" || item.kind === "offer", nudge: item.kind === "nudge",
                                              ...(item.kind === "offer" ? { desk: item.desk, until: item.until } : {}) } }) }));
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
        const body = (item.kind === "up" || item.kind === "nudge" || item.kind === "offer") ? item.body
          : item.ahead === 0 ? "You're next." : `${item.ahead} ahead of you.`;
        /* The same content state the Live Activity is sent, carried as a string
           because FCM data values are strings. It is what lets an Android phone
           redraw its Live Update from a push with the app closed, rail and all,
           rather than showing whatever it last knew. The rail is capped at eight
           people, so this stays well inside FCM's four kilobytes. */
        const stateJson = JSON.stringify(state);
        const msg = item.kind === "end" ? fcmEndMessage({ token: dev.fcm_token, tag: collapseId, data: { store, kind } })
          : (item.kind === "up" || item.kind === "nudge" || item.kind === "offer")
            ? fcmUpMessage({ token: dev.fcm_token, title: item.title, body: item.body, tag: collapseId,
                             data: { store, kind, ahead: String(item.ahead ?? 0), nudge: item.kind === "nudge" ? "1" : "0",
                                     state: stateJson } })
          : fcmStandingMessage({ token: dev.fcm_token, title: "In the line", body,
                                 tag: collapseId, data: { store, kind, ahead: String(item.ahead ?? 0), state: stateJson } });
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
  /* Every sender already returns why it failed, and the count threw it away, so
     a delivery log could say a push failed but never say why. Apple's reasons
     are diagnostic words (BadDeviceToken, TopicDisallowed, InvalidProviderToken)
     and each points at a different thing to go and fix; none of them is a
     secret, and no token or key goes in here. Distinct reasons only, because
     forty phones failing the same way is one fact, not forty. */
  const why = [...new Set(results.filter((r) => r && !r.ok)
    .map((r) => [r.status, r.reason].filter(Boolean).join(" ").trim() || "unknown"))].slice(0, 5);
  return res.status(200).json({ ok: true, planned: plan.length, sent, failed: results.length - sent,
                                retired: retire.length, ...(why.length ? { why } : {}) });
}

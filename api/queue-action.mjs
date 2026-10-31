/**
 * Vercel serverless function — /api/queue-action
 * -------------------------------------------------------------------------
 * A button pressed on the Live Activity. The phone sends the session it was
 * handed by the page, the store, the day and one word; this finds the person
 * the account is linked to, applies the word to the floor row exactly as the
 * page's own buttons would, and writes it back. The row's webhook then moves
 * the Live Activity, so the phone sees the result the same way it sees
 * everything else.
 *
 * The person is taken from the session, never from the body: a phone that
 * could name a person_id could put somebody else at lunch.
 */
import { accountIsActive, rowAddress, storeDay } from "./_floor-access.mjs";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, envGap, serviceKey } from "./_env.mjs";
import { applyQueueAction, QUEUE_ACTIONS } from "./_queue-action.mjs";
import { applyPhoneAction, isPhoneAction } from "./_phone-action.mjs";
import { stationGate, needsOverride } from "./_station-gate.mjs";
import { stampLineMoves } from "./_phone-rows.mjs";

const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const DEFAULT_PHONE_GREEN = 25;

/* The store's phone standard, held against this person's month, the way the
   desk's own seat action holds it. A press on a card cannot be waved through
   by a manager, so below the bar the answer is no, with the reason. */
async function phoneGate(db, config, store, row, personId) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === store) || {};
  const t = st.thresholds || {};
  const bar = t.green !== undefined ? t.green : ((t.phone || {}).green ?? DEFAULT_PHONE_GREEN);
  const inGrace = Number(storeDay().slice(8)) <= (st.graceDays ?? 10);
  const person = ((row && row.roster) || []).find((r) => r && r.id === personId) || {};
  const name = person.name || person.label || "";
  let stats = null;
  try {
    const { data, error } = await db.from("app_data").select("value").eq("key", `lpc:store:${store}:v2`).maybeSingle();
    if (error || !data?.value) throw new Error("could not read the store figures");
    const ym = storeDay().slice(0, 7);
    stats = (((((data || {}).value || {}).months || {})[ym] || {}).stats || {})[normName(name)] || null;
  } catch { throw new Error("could not read the store figures"); }
  return stationGate({ stats, standard: bar, inGrace });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch { return res.status(400).json({ error: "bad json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "bad body" });
  const { store, date, action } = body;
  if (typeof store !== "string" || typeof date !== "string" || !rowAddress("floor", store, date)
    || !Number.isFinite(Date.parse(date + "T12:00:00Z")) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date || !(QUEUE_ACTIONS.includes(action) || isPhoneAction(action))) return res.status(400).json({ error: "store, date and a known action are required" });

  const gap = envGap();
  if (gap) return res.status(500).json({ error: gap });
  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(jwt);
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "that session is not valid. Open Sage and sign in again." });

  const { data: profile, error: profileErr } = await db.from("profiles")
    .select("active").eq("id", who.user.id).maybeSingle();
  if (profileErr) return res.status(500).json({ error: "could not check this account" });
  if (!accountIsActive(profile)) return res.status(403).json({ error: "this account is not active" });

  const { data: links, error: linkErr } = await db
    .from("floor_people").select("person_id").eq("user_id", who.user.id).eq("store", store).limit(1);
  if (linkErr) return res.status(500).json({ error: "could not check this account" });
  const personId = links && links[0] && links[0].person_id;
  if (!personId) return res.status(403).json({ error: "not-linked", message: "This account isn't linked to anybody on this store's floor." });

  const id = `${store}:${date}`;
  // Older installed clients have no durable request identifier. Keep their wire
  // contract, but recheck authority atomically; retries across HTTP remain legacy.
  const operationId = crypto.randomUUID();
  const nextStamp = previous => new Date(Math.max(Date.now(), Number.isFinite(Date.parse(previous)) ? Date.parse(previous) + 1 : 0)).toISOString();

  /* ---- the phone lane's presses: the day's queue row ---- */
  if (isPhoneAction(action)) {
    let config = null;
    try {
      const { data, error } = await db.from("app_data").select("value").eq("key", "lpc:config:v2").maybeSingle();
      if (error) throw error;
      config = (data && data.value) || null;
    } catch { config = null; }
    if (!config) return res.status(500).json({ error: "could not read the store's setup" });
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: cur, error } = await db.from("queue_public").select("data,updated_at").eq("id", id).eq("store", store).eq("qdate", date).maybeSingle();
      if (error) return res.status(500).json({ error: "could not read the line" });
      if (!cur || !cur.data) return res.status(404).json({ error: "no line today" });
      const now = nextStamp(cur.updated_at);
      if (action === "take-desk") {
        let gate;
        try { gate = await phoneGate(db, config, store, cur.data, personId); }
        catch { return res.status(500).json({ error: "could not read the store figures" }); }
        if (needsOverride(gate)) {
          return res.status(200).json({ ok: true, changed: false, why: "below-standard",
            message: "Below the store's phone standard this month; the desk can seat you." });
        }
      }
      const out = applyPhoneAction(config, store, cur.data, personId, action, now, { desk: body.desk == null ? null : String(body.desk) });
      if (!out.changed) return res.status(200).json({ ok: true, changed: false, why: out.why });
      const { data: committed, error: werr } = await db.rpc("sage_room_commit", {
        p_actor: who.user.id, p_person: personId, p_store: store, p_room: "line", p_date: date,
        p_expected: cur.updated_at, p_next: out.row, p_operation_id: operationId, p_request: { action, input: { desk: body.desk == null ? null : String(body.desk) } }
      });
      if (werr?.code === "40001") continue;
      if (werr) return res.status(werr.code === "42501" ? 403 : 500).json({ error: "could not write the line" });
      if (committed?.ok) {
        out.row = committed.row;
        const me = out.row.line.find((x) => x.id === personId) || {};
        return res.status(200).json({ ok: true, changed: true, status: me.status || "waiting", ...(out.desk ? { desk: out.desk } : {}) });
      }
    }
    return res.status(409).json({ error: "the line was busy; try again" });
  }

  /* Read, apply, write, and check nothing else wrote in between. The page
     serialises its own writes; from here the row's updated_at is the guard,
     and a lost race is simply tried again. */
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: cur, error } = await db.from("floor_public").select("data,updated_at").eq("id", id).eq("store", store).eq("fdate", date).maybeSingle();
    if (error) return res.status(500).json({ error: "could not read the floor" });
    if (!cur || !cur.data) return res.status(404).json({ error: "no line today" });
    const now = nextStamp(cur.updated_at);
    const out = applyQueueAction(cur.data, personId, action, now);
    if (!out.changed) return res.status(200).json({ ok: true, changed: false, why: out.why });
    stampLineMoves(cur.data, out.row, now);
    const { data: committed, error: werr } = await db.rpc("sage_room_commit", {
      p_actor: who.user.id, p_person: personId, p_store: store, p_room: "floor", p_date: date,
      p_expected: cur.updated_at, p_next: out.row, p_operation_id: operationId, p_request: { action, input: {} }
    });
    if (werr?.code === "40001") continue;
    if (werr) return res.status(werr.code === "42501" ? 403 : 500).json({ error: "could not write the floor" });
    if (committed?.ok) {
      out.row = committed.row;
      const me = out.row.line.find((x) => x.id === personId) || {};
      const ahead = out.row.line.slice(0, out.row.line.findIndex((x) => x.id === personId)).filter((x) => (x.status || "waiting") === "waiting").length;
      return res.status(200).json({ ok: true, changed: true, status: me.status || "waiting", ahead, up: (me.status || "waiting") === "waiting" && ahead === 0 });
    }
  }
  return res.status(409).json({ error: "the floor was busy; try again" });
}

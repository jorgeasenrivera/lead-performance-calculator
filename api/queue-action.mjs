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
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, envGap, serviceKey } from "./_env.mjs";
import { applyQueueAction, QUEUE_ACTIONS } from "./_queue-action.mjs";
import { stampLineMoves } from "./_phone-rows.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const { store, date, action } = body;
  if (!store || !date || !QUEUE_ACTIONS.includes(action)) return res.status(400).json({ error: "store, date and a known action are required" });

  const gap = envGap();
  if (gap) return res.status(500).json({ error: gap });
  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(jwt);
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "that session is not valid. Open Sage and sign in again." });

  const { data: links, error: linkErr } = await db
    .from("floor_people").select("person_id").eq("user_id", who.user.id).eq("store", store).limit(1);
  if (linkErr) return res.status(500).json({ error: "could not check this account" });
  const personId = links && links[0] && links[0].person_id;
  if (!personId) return res.status(403).json({ error: "not-linked", message: "This account isn't linked to anybody on this store's floor." });

  const id = `${store}:${date}`;
  const now = new Date().toISOString();
  /* Read, apply, write, and check nothing else wrote in between. The page
     serialises its own writes; from here the row's updated_at is the guard,
     and a lost race is simply tried again. */
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: cur, error } = await db.from("floor_public").select("data,updated_at").eq("id", id).maybeSingle();
    if (error) return res.status(500).json({ error: "could not read the floor" });
    if (!cur || !cur.data) return res.status(404).json({ error: "no line today" });
    const out = applyQueueAction(cur.data, personId, action, now);
    if (!out.changed) return res.status(200).json({ ok: true, changed: false, why: out.why });
    stampLineMoves(cur.data, out.row, now);
    let q = db.from("floor_public").update({ data: out.row, updated_at: now }).eq("id", id);
    q = cur.updated_at ? q.eq("updated_at", cur.updated_at) : q.is("updated_at", null);
    const { data: wrote, error: werr } = await q.select("id");
    if (werr) return res.status(500).json({ error: "could not write the floor" });
    if (wrote && wrote.length) {
      const me = out.row.line.find((x) => x.id === personId) || {};
      const ahead = out.row.line.slice(0, out.row.line.findIndex((x) => x.id === personId)).filter((x) => (x.status || "waiting") === "waiting").length;
      return res.status(200).json({ ok: true, changed: true, status: me.status || "waiting", ahead, up: (me.status || "waiting") === "waiting" && ahead === 0 });
    }
  }
  return res.status(409).json({ error: "the floor was busy; try again" });
}

/**
 * Vercel serverless function — /api/link-person
 * -------------------------------------------------------------------------
 * A manager saying "this account is that person on the floor".
 *
 * It is the only way a link is ever made. Not because a salesperson could not be
 * trusted to pick their own name, but because the link decides whose phone
 * buzzes when a customer walks in: anybody able to set their own could take the
 * next up from somebody else, quietly, all day.
 *
 * The caller's own profile is read server-side to check they manage that store.
 * A role sent in the body would be worth exactly nothing.
 *
 * POST { store, person_id, user_id }        link (or move) an account
 * POST { store, user_id, unlink: true }     take a link away
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { checkLink } from "./_people-link.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const { store, person_id: personId, user_id: userId, unlink } = body;
  if (!store || !userId) return res.status(400).json({ error: "store and user_id are required" });

  const asUser = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "that session is not valid" });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const { data: prof } = await db.from("profiles").select("role, stores").eq("id", who.user.id).maybeSingle();
  const isAdmin = prof && prof.role === "admin";
  const managesStore = prof && Array.isArray(prof.stores) && prof.stores.includes(store);
  if (!prof || (!isAdmin && !managesStore)) {
    return res.status(403).json({ error: "only a manager of this store can link accounts" });
  }

  if (unlink) {
    /* Read it first: the devices are filed under the ROSTER id, so once the link
       is gone there is no way to find them, and a phone left registered would go
       on being told about a person this account no longer is. */
    const { data: cur } = await db.from("floor_people")
      .select("person_id").eq("user_id", userId).eq("store", store).maybeSingle();
    const { error } = await db.from("floor_people").delete().eq("user_id", userId).eq("store", store);
    if (error) return res.status(500).json({ error: "could not unlink" });
    if (cur && cur.person_id) {
      try { await db.from("device_tokens").delete().eq("store", store).eq("person_id", cur.person_id); }
      catch { /* the link is gone, which is the part that matters */ }
    }
    return res.status(200).json({ ok: true, unlinked: true });
  }

  if (!personId) return res.status(400).json({ error: "person_id is required" });

  const { data: links, error: readErr } = await db.from("floor_people").select("*").eq("store", store);
  if (readErr) return res.status(500).json({ error: "could not read the current links" });

  const complaint = checkLink({ links: links || [], userId, store, personId });
  if (complaint) return res.status(409).json({ error: complaint });

  const { error } = await db.from("floor_people").upsert(
    { id: `${store}:${userId}`, user_id: userId, store, person_id: personId,
      linked_by: who.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return res.status(500).json({ error: "could not save the link" });

  return res.status(200).json({ ok: true });
}

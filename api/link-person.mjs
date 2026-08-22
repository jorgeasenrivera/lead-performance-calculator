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
 * GET  ?store=X                            who is linked to whom, and whose
 *                                          phone has actually registered
 * POST { store, person_id, user_id }        link (or move) an account
 * POST { store, user_id, unlink: true }     take a link away
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { checkLink } from "./_people-link.mjs";

/* ---- why every failure below now says what went wrong ----
   This handler had no try/catch, so anything that threw — a malformed body, a
   missing env var, Supabase being unreachable — came back as the platform's bare
   500 with no JSON in it at all. The browser prints `That failed (500).` in that
   case for exactly one reason: there was no `error` field to print instead. A
   manager sees a number and nobody, including the next person to read the logs,
   can tell which of a dozen things it was.

   Every handled failure now carries a `detail`, and everything unhandled is
   caught and reported the same way. It is a manager-only endpoint and the detail
   is a database message, not a secret; the cost of hiding it is a bug that can
   only be guessed at. */
function fail(res, code, error, err) {
  const detail = err && (err.message || err.details || err.hint || String(err));
  if (err) console.error("link-person:", error, err);
  return res.status(code).json({ error: detail ? error + " (" + detail + ")" : error });
}

export default async function handler(req, res) {
  try {
    return await run(req, res);
  } catch (e) {
    return fail(res, 500, "The link could not be saved", e);
  }
}

async function run(req, res) {
  const reading = req.method === "GET";
  if (!reading && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  let body = {};
  if (!reading) {
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      return fail(res, 400, "That request was not readable", e);
    }
  }
  const store = reading ? String(req.query.store || "") : body.store;
  const { person_id: personId, user_id: userId, unlink } = body;
  if (!store) return res.status(400).json({ error: "store is required" });
  if (!reading && !userId) return res.status(400).json({ error: "user_id is required" });

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

  if (reading) {
    /* The links themselves, and one fact about each that a manager cannot get
       anywhere else: whether a phone has actually arrived. A link with no device
       looks identical to a working one on screen, and the difference only shows
       up the night nobody's phone buzzes. No token is returned — the manager has
       no use for it and it is the one part of this worth stealing. */
    const { data: links, error: linkErr } = await db.from("floor_people")
      .select("user_id, person_id, linked_by, updated_at").eq("store", store);
    if (linkErr) return fail(res, 500, "Could not read the links", linkErr);

    const { data: devices } = await db.from("device_tokens")
      .select("person_id, platform, updated_at").eq("store", store);
    const byPerson = new Map();
    for (const d of devices || []) {
      const cur = byPerson.get(d.person_id) || { devices: 0, platforms: [], lastSeen: null };
      cur.devices += 1;
      if (d.platform && !cur.platforms.includes(d.platform)) cur.platforms.push(d.platform);
      if (!cur.lastSeen || d.updated_at > cur.lastSeen) cur.lastSeen = d.updated_at;
      byPerson.set(d.person_id, cur);
    }

    return res.status(200).json({
      links: (links || []).map((l) => ({ ...l, ...(byPerson.get(l.person_id) || { devices: 0, platforms: [], lastSeen: null }) })),
    });
  }

  if (unlink) {
    /* Read it first: the devices are filed under the ROSTER id, so once the link
       is gone there is no way to find them, and a phone left registered would go
       on being told about a person this account no longer is. */
    const { data: cur } = await db.from("floor_people")
      .select("person_id").eq("user_id", userId).eq("store", store).maybeSingle();
    const { error } = await db.from("floor_people").delete().eq("user_id", userId).eq("store", store);
    if (error) return fail(res, 500, "Could not unlink", error);
    if (cur && cur.person_id) {
      try { await db.from("device_tokens").delete().eq("store", store).eq("person_id", cur.person_id); }
      catch { /* the link is gone, which is the part that matters */ }
    }
    return res.status(200).json({ ok: true, unlinked: true });
  }

  if (!personId) return res.status(400).json({ error: "person_id is required" });

  const { data: links, error: readErr } = await db.from("floor_people").select("*").eq("store", store);
  if (readErr) return fail(res, 500, "Could not read the current links", readErr);

  const complaint = checkLink({ links: links || [], userId, store, personId });
  if (complaint) return res.status(409).json({ error: complaint });

  const { error } = await db.from("floor_people").upsert(
    { id: `${store}:${userId}`, user_id: userId, store, person_id: personId,
      linked_by: who.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return fail(res, 500, "Could not save the link", error);

  return res.status(200).json({ ok: true });
}

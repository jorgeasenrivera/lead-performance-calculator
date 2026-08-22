/**
 * Vercel serverless function — /api/floor-account
 * -------------------------------------------------------------------------
 * The account things a store manager needs to do for somebody on their floor,
 * and nothing else.
 *
 * ---- why this is not done from the browser ----
 * Turning an account off is a privileged act, and the only thing standing
 * between a browser and the profiles table is a policy nobody can read from
 * here. So the caller's own profile is read server-side and the answer comes
 * from that. A role sent in a request body is worth nothing.
 *
 * ---- and why it is fenced to one store ----
 * A store manager may act on accounts linked to a person on THEIR floor. Not on
 * an administrator's, not on a manager's, and not on somebody at another
 * rooftop. Without that, the first thing this endpoint would be good for is a
 * store manager switching off the group admin who was about to look at their
 * numbers.
 *
 * POST { store, user_id, action: "deactivate" | "activate" }
 *
 * Password resets are deliberately NOT here. Supabase sends those to the
 * account's own address, and anybody can already ask for one from the sign-in
 * page, so routing it through a privileged endpoint would add a check that
 * guards nothing and a place for it to break.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, anonKey, envGap } from "./_env.mjs";

/* Same guard as /api/link-person, and for the same reason: without it anything
   that throws comes back as the platform's bare 500 with no JSON in it, and the
   browser has nothing to print but the number. See the note there. */
function fail(res, code, error, err) {
  const detail = err && (err.message || err.details || err.hint || String(err));
  if (err) console.error("floor-account:", error, err);
  return res.status(code).json({ error: detail ? error + " (" + detail + ")" : error });
}

export default async function handler(req, res) {
  try {
    return await run(req, res);
  } catch (e) {
    return fail(res, 500, "That account could not be changed", e);
  }
}

async function run(req, res) {
  const gap = envGap({ anon: true });
  if (gap) return fail(res, 500, gap);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const { store, user_id: userId, action } = body;
  if (!store || !userId) return res.status(400).json({ error: "store and user_id are required" });
  if (action !== "deactivate" && action !== "activate") {
    return res.status(400).json({ error: "action must be deactivate or activate" });
  }

  const asUser = createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "that session is not valid" });

  const db = createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const { data: me } = await db.from("profiles").select("role, stores").eq("id", who.user.id).maybeSingle();
  const isAdmin = me && me.role === "admin";
  const managesStore = me && Array.isArray(me.stores) && me.stores.includes(store);
  if (!me || (!isAdmin && !managesStore)) {
    return res.status(403).json({ error: "only a manager of this store can do that" });
  }

  /* Turning off your own account locks you out of the tool with no way back in
     that does not involve somebody else. */
  if (userId === who.user.id) {
    return res.status(400).json({ error: "you cannot switch off your own account" });
  }

  /* The link is what makes somebody this store's business. A manager who is not
     an admin may only reach an account that belongs to a person on their floor. */
  if (!isAdmin) {
    const { data: link } = await db.from("floor_people")
      .select("person_id").eq("user_id", userId).eq("store", store).maybeSingle();
    if (!link) return res.status(403).json({ error: "that account is not linked to anybody on this floor" });

    /* And never at somebody who outranks the floor, even if a link exists. An
       administrator with a linked account is still an administrator. */
    const { data: target } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (target && (target.role === "admin" || target.role === "overseer")) {
      return res.status(403).json({ error: "that account is not a floor account; an admin has to do this" });
    }
  }

  const { error } = await db.from("profiles")
    .update({ active: action === "activate" }).eq("id", userId);
  if (error) return fail(res, 500, "Could not change that account", error);

  return res.status(200).json({ ok: true, active: action === "activate" });
}

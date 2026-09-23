/**
 * Vercel serverless function — /api/delete-account
 * -------------------------------------------------------------------------
 * Deleting an account: your own from the app, or somebody else's from the
 * admin list (C91). Who may do which is decided in _account-delete.mjs; this
 * file only finds out who is asking and does the deleting.
 *
 * POST { confirm: "DELETE" }                 delete my own account
 * POST { confirm: "DELETE", user_id }        an admin deleting somebody else's
 *   → 200 { ok, self } · 400 not confirmed · 401 no session · 403 not allowed
 *   · 409 the last admin · 500 something failed part way
 *
 * ---- the order is the safe one ----
 * The phone and floor links go first, and the login last, because the login
 * is the one step that can fail on the auth server's side. If it does, the
 * person still has a working account with nothing linked, which an admin can
 * put back together; the other way round would leave rows pointing at an
 * account that is gone. The profile is not deleted here: the database removes
 * it with the login (profiles_id_fkey, on delete cascade).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, envGap, serviceKey } from "./_env.mjs";
import { serverFault } from "./_report.mjs";
import { decideDelete } from "./_account-delete.mjs";

function fail(res, code, error, err) {
  const detail = err && (err.message || err.details || err.hint || String(err));
  if (err) { console.error("delete-account:", error, err); serverFault("delete-account", err, { error, code }); }
  return res.status(code).json({ error: detail ? error + " (" + detail + ")" : error });
}

export default async function handler(req, res) {
  try {
    return await run(req, res);
  } catch (e) {
    return fail(res, 500, "That account could not be deleted", e);
  }
}

async function run(req, res) {
  const gap = envGap();
  if (gap) return fail(res, 500, gap);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(jwt);
  if (whoErr || !who || !who.user) {
    return res.status(401).json({ error: "that session is not valid. Sign out and back in, then try again." });
  }
  const callerId = who.user.id;
  const targetId = body.user_id || callerId;

  const [{ data: caller }, { data: target }, { data: admins }] = await Promise.all([
    db.from("profiles").select("role, active").eq("id", callerId).maybeSingle(),
    db.from("profiles").select("role, active").eq("id", targetId).maybeSingle(),
    db.from("profiles").select("id").eq("role", "admin").eq("active", true),
  ]);
  const otherAdmins = (admins || []).filter((a) => a.id !== targetId).length;

  const d = decideDelete({ callerId, caller, targetId: body.user_id, target, confirm: body.confirm, otherAdmins });
  if (!d.ok) return res.status(d.code).json({ error: d.error });

  /* The names this account is linked to, on every floor, so the phones that
     were told when those names were up stop being told. */
  const { data: links, error: linkErr } = await db.from("floor_people").select("store, person_id").eq("user_id", d.targetId);
  if (linkErr) return fail(res, 500, "Could not read the account's links", linkErr);
  for (const l of links || []) {
    const { error } = await db.from("device_tokens").delete().eq("store", l.store).eq("person_id", l.person_id);
    if (error) return fail(res, 500, "Could not remove the phone's notifications", error);
  }
  { const { error } = await db.from("floor_people").delete().eq("user_id", d.targetId);
    if (error) return fail(res, 500, "Could not remove the account's links", error); }
  { const { error } = await db.from("app_errors").delete().eq("user_id", d.targetId);
    if (error) return fail(res, 500, "Could not remove the account's error reports", error); }

  const { error: authErr } = await db.auth.admin.deleteUser(d.targetId);
  if (authErr) return fail(res, 500, "The links are gone but the login could not be deleted", authErr);

  return res.status(200).json({ ok: true, self: d.self });
}

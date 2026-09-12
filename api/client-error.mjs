/**
 * Vercel serverless function — /api/client-error
 * -------------------------------------------------------------------------
 * A phone saying something went wrong. The page's reporter (src/report.js)
 * posts here on an uncaught error, an unhandled rejection, a screen that
 * failed to render, a write that failed, or a server answer of 500.
 *
 * POST { kind, message, stack, url, build, store, person_id, device_id, ua, screen, extra }
 *   → 204 written · 400 refused · 429 this device has said enough for now
 *
 * Signed in or not: the sign-in screen can crash too. A bearer token, when
 * there is one, only adds the account id to the row. Nothing here is trusted
 * for anything but a label, and nothing here can be read back by a phone.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey } from "./_env.mjs";
import { cleanReport, tooMany, RATE } from "./_report.mjs";

export async function handle(req, res, deps) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const source = req.headers && req.headers["x-sage-source"] === "shell" ? "shell" : "web";
  const c = cleanReport(body, source);
  if (!c.ok) return res.status(400).json({ error: c.why });
  const row = c.row;
  try {
    const auth = (req.headers && req.headers.authorization) || "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (jwt) { const who = await deps.userOf(jwt); if (who) row.user_id = who; }
    if (row.device_id) {
      const recent = await deps.recentFromDevice(row.device_id, RATE.windowMinutes);
      if (tooMany(recent)) return res.status(429).json({ error: "enough for now" });
    }
    await deps.insert(row);
    return res.status(204).end();
  } catch (e) {
    /* The feed must never be a second fault on top of the first; the phone
       treats any answer as done and moves on. */
    console.error("client-error:", e && e.message);
    return res.status(200).json({ ok: false });
  }
}

function realDeps() {
  const c = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  return {
    userOf: async (jwt) => { const { data } = await c.auth.getUser(jwt); return data && data.user ? data.user.id : null; },
    recentFromDevice: async (device, minutes) => {
      const since = new Date(Date.now() - minutes * 60000).toISOString();
      const { count } = await c.from("app_errors").select("id", { count: "exact", head: true }).eq("device_id", device).gte("at", since);
      return count || 0;
    },
    insert: async (row) => { const { error } = await c.from("app_errors").insert(row); if (error) throw error; },
  };
}

export default function handler(req, res) { return handle(req, res, realDeps()); }

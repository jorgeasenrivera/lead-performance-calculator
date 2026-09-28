/**
 * Vercel serverless function: /api/floor-row  (C92)
 * -------------------------------------------------------------------------
 * The day's row for a TV showing the line, which has nobody signed in. Once
 * `floor_public` and `queue_public` close to the public key
 * (supabase/pending/02-lock.sql), this is its only way in. Signed-in staff
 * keep using the tables directly.
 *
 * POST { op: "read", room, store, date, stamp? }
 *   → 200 { row, stamp } · 200 { same: true, stamp } when stamp is current
 * POST { op: "wallkey", store }             staff only: the TV link's key
 *   → 200 { key }
 *
 * Who is asking comes from the headers, never the body:
 *   x-sage-wall-key: <store's key>     a TV
 *   Authorization: Bearer <session>    staff
 * The rules are all in _floor-access.mjs.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WALL_KEY_SECRET
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey, envGap } from "./_env.mjs";
import { decide, readable, rowAddress, staffMayUse, storeDay, wallKey, sameSecret, WALL_HEADER } from "./_floor-access.mjs";

const header = (req, name) => {
  const h = (req.headers && req.headers[name]) || "";
  return Array.isArray(h) ? h[0] : String(h);
};

async function whoIsAsking(req, store, deps) {
  const auth = header(req, "authorization");
  if (auth.startsWith("Bearer ")) {
    const user = await deps.userFor(auth.slice(7));
    if (!user) return { kind: "staff", allowed: false };
    const [profile, linkedStores] = await Promise.all([deps.profileOf(user.id), deps.linkedStoresOf(user.id)]);
    return { kind: "staff", allowed: staffMayUse({ profile, linkedStores }, store) };
  }
  const wall = header(req, WALL_HEADER);
  if (wall) return { kind: "wall", ok: sameSecret(wall, wallKey(store, deps.wallSecret)) };
  return null;
}

export async function handle(req, res, deps) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const { op, room, store, date, stamp } = body;
  const today = storeDay(deps.now ? deps.now() : new Date());
  const via = await whoIsAsking(req, store, deps);
  const d = decide({ op, room, store, date, today, via });
  if (!d.ok) return res.status(d.status).json({ error: d.why });

  if (op === "wallkey") {
    const key = wallKey(store, deps.wallSecret);
    if (!key) return res.status(500).json({ error: "WALL_KEY_SECRET is not set" });
    return res.status(200).json({ key });
  }
  const row = await deps.getRow(rowAddress(room, store, date));
  if (stamp && row && row.updated_at === stamp) return res.status(200).json({ same: true, stamp });
  return res.status(200).json(readable(row));
}

export default async function handler(req, res) {
  const gap = envGap();
  if (gap) return res.status(500).json({ error: gap });
  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  try {
    return await handle(req, res, {
      wallSecret: process.env.WALL_KEY_SECRET || "",
      userFor: async (jwt) => {
        const { data, error } = await db.auth.getUser(jwt);
        return error || !data ? null : data.user;
      },
      profileOf: async (id) => {
        const { data } = await db.from("profiles").select("role,stores,active,pending").eq("id", id).maybeSingle();
        return data || null;
      },
      linkedStoresOf: async (id) => {
        const { data } = await db.from("floor_people").select("store").eq("user_id", id);
        return (data || []).map((r) => r.store);
      },
      getRow: async ({ table, id }) => {
        const { data, error } = await db.from(table).select("data,updated_at").eq("id", id).maybeSingle();
        if (error) throw error;
        return data || null;
      },
    });
  } catch (e) {
    console.error("floor-row:", e && (e.message || e));
    return res.status(500).json({ error: "could not reach the floor just now" });
  }
}

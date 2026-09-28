/**
 * Vercel serverless function: /api/floor-row  (C92)
 * -------------------------------------------------------------------------
 * The day's floor and phone-line rows for the screens that have no account:
 * a phone that scanned today's QR code, and a TV showing the line. Once
 * `floor_public` and `queue_public` close to the public key
 * (supabase/pending/02-lock.sql), this is their only way in. Signed-in staff
 * may use it too, but need not: the lock lets them keep reading and writing
 * the tables directly for their own stores.
 *
 * POST { op: "read",   room, store, date, stamp? }
 *   → 200 { row, stamp } · 200 { same: true, stamp } when stamp is current
 * POST { op: "write",  room, store, date, data, expect? }
 *   → 200 { row, stamp } · 409 the row moved since `expect`
 * POST { op: "ticket", store, data }
 *   → 201 · 409 that ticket already exists
 * POST { op: "wallkey", store }            staff only: the TV link's key
 *   → 200 { key }
 *
 * Who is asking comes from the headers, never the body:
 *   Authorization: Bearer <session>   staff
 *   x-sage-day-token: <today's code>   a phone with no account
 *   x-sage-wall-key: <store's key>     a TV
 * The rules are all in _floor-access.mjs.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WALL_KEY_SECRET
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey, envGap } from "./_env.mjs";
import { decide, readable, rowAddress, staffMayUse, storeDay, wallKey, sameSecret,
  TOKEN_HEADER, WALL_HEADER, TICKET_PREFIX } from "./_floor-access.mjs";

const header = (req, name) => {
  const h = (req.headers && req.headers[name]) || "";
  return Array.isArray(h) ? h[0] : String(h);
};

async function whoIsAsking(req, store, deps) {
  const auth = header(req, "authorization");
  if (auth.startsWith("Bearer ")) {
    const user = await deps.userFor(auth.slice(7));
    if (!user) return { kind: "staff", allowed: false, user: null };
    const [profile, linkedStores] = await Promise.all([deps.profileOf(user.id), deps.linkedStoresOf(user.id)]);
    return { kind: "staff", allowed: staffMayUse({ profile, linkedStores }, store), user };
  }
  const wall = header(req, WALL_HEADER);
  if (wall) return { kind: "wall", ok: sameSecret(wall, wallKey(store, deps.wallSecret)) };
  const token = header(req, TOKEN_HEADER);
  if (token) return { kind: "token", token };
  return null;
}

export async function handle(req, res, deps) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const { op, room, store, date, stamp, data, expect } = body;
  const today = storeDay(deps.now ? deps.now() : new Date());
  const via = await whoIsAsking(req, store, deps);

  if (op === "wallkey") {
    if (!via || via.kind !== "staff" || !via.allowed) return res.status(403).json({ error: "not one of your stores" });
    const key = wallKey(store, deps.wallSecret);
    if (!key) return res.status(500).json({ error: "WALL_KEY_SECRET is not set" });
    return res.status(200).json({ key });
  }

  if (op === "ticket") {
    /* A phone with no account files a ticket with the code it scanned, which
       belongs to one of today's rows at that store: the floor's or a line's. */
    let row = null;
    if (via && via.kind === "token") {
      for (const r of ["floor", "line", "online"]) {
        const a = rowAddress(r, store, today);
        const got = a ? await deps.getRow(a) : null;
        if (got && got.data && sameSecret(via.token, got.data.token)) { row = got; break; }
      }
    }
    const d = decide({ op, store, date: today, today, via, row: via && via.kind === "token" ? row : null, data });
    if (!d.ok) return res.status(d.status).json({ error: d.why });
    /* store and qdate are NOT NULL on queue_public. The app's own saveTicket
       sends neither, which is why no ticket has ever been saved (C98). */
    const put = await deps.insertTicket(TICKET_PREFIX + data.id, { ...data, store }, store, today);
    return put ? res.status(201).json({ ok: true }) : res.status(409).json({ error: "that ticket already exists" });
  }

  const addr = rowAddress(room, store, date);
  const row = addr ? await deps.getRow(addr) : null;
  const d = decide({ op, room, store, date, today, via, row, data, expect });
  if (!d.ok) return res.status(d.status).json({ error: d.why });

  if (op === "read") {
    if (stamp && row && row.updated_at === stamp) return res.status(200).json({ same: true, stamp });
    return res.status(200).json(readable(row));
  }

  /* A write replaces the row, as the pages' own writes do; `expect` lets a
     writer say which version it read, and a row that moved since is refused
     rather than overwritten (C89 is the same loss, seen from the desk). */
  const written = await deps.putRow(addr, { store, date, data }, row ? (expect || null) : null, !row);
  if (!written) return res.status(409).json({ error: "the row moved; read it again" });
  return res.status(200).json(readable(written));
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
      putRow: async ({ table, id, dateCol }, { store, date, data }, expect, create) => {
        const now = new Date().toISOString();
        if (create) {
          const { data: out, error } = await db.from(table)
            .insert({ id, store, [dateCol]: date, data, updated_at: now }).select("data,updated_at").maybeSingle();
          if (error && error.code === "23505") return null;   // made meanwhile: read it again
          if (error) throw error;
          return out;
        }
        let q = db.from(table).update({ data, updated_at: now }).eq("id", id);
        if (expect) q = q.eq("updated_at", expect);
        const { data: out, error } = await q.select("data,updated_at").maybeSingle();
        if (error) throw error;
        return out || null;
      },
      insertTicket: async (id, ticket, store, day) => {
        const { error } = await db.from("queue_public").insert({ id, store, qdate: day, data: ticket });
        if (error && error.code === "23505") return false;
        if (error) throw error;
        return true;
      },
    });
  } catch (e) {
    console.error("floor-row:", e && (e.message || e));
    return res.status(500).json({ error: "could not reach the floor just now" });
  }
}

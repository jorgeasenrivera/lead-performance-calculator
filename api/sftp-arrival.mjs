/**
 * Vercel serverless function: /api/sftp-arrival
 * -------------------------------------------------------------------------
 * The SFTP server saying "a file has landed" (C96). What may be said, and the
 * secret, are checked in _sftp-arrival.mjs; this only records it.
 *
 * POST { account, filename, size, sha256 }   a file finished uploading
 *   → 201 recorded · 200 already recorded · 400 refused · 401 no secret
 * GET ?sha256=…                              was this file recorded?
 *   → 200 { arrival } · 404 not yet · 401 no secret
 *
 * The GET is what the server's check uses to prove a test upload reached
 * Sage, end to end, without anybody opening the database. Both need the
 * secret; nothing here is readable by a phone.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SFTP_NOTIFY_SECRET
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey } from "./_env.mjs";
import { cleanArrival, secretOk, SECRET_HEADER } from "./_sftp-arrival.mjs";

export async function handle(req, res, deps) {
  if (!secretOk(req.headers && req.headers[SECRET_HEADER], deps.secret)) {
    return res.status(401).json({ error: "not the SFTP server" });
  }
  if (req.method === "GET") {
    const sha = String((req.query && req.query.sha256) || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) return res.status(400).json({ error: "bad sha256" });
    const arrival = await deps.find(sha);
    return arrival ? res.status(200).json({ arrival }) : res.status(404).json({ error: "not recorded" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const c = cleanArrival(body);
  if (!c.ok) return res.status(400).json({ error: c.why });
  /* The same file sent twice is one arrival: the server retries a notice it
     could not deliver, and a vendor sometimes resends a whole drop. */
  const dup = await deps.find(c.row.sha256, c.row.filename);
  if (dup) return res.status(200).json({ ok: true, duplicate: true });
  await deps.insert(c.row);
  return res.status(201).json({ ok: true });
}

export default async function handler(req, res) {
  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  try {
    return await handle(req, res, {
      secret: process.env.SFTP_NOTIFY_SECRET,
      find: async (sha256, filename) => {
        let q = db.from("sftp_arrivals").select("received_at, account, filename, size_bytes, sha256").eq("sha256", sha256);
        if (filename) q = q.eq("filename", filename);
        const { data, error } = await q.order("received_at", { ascending: false }).limit(1);
        if (error) throw error;
        return (data && data[0]) || null;
      },
      insert: async (row) => {
        const { error } = await db.from("sftp_arrivals").insert(row);
        if (error) throw error;
      },
    });
  } catch (e) {
    console.error("sftp-arrival:", e && (e.message || e));
    return res.status(500).json({ error: "could not record the arrival" });
  }
}

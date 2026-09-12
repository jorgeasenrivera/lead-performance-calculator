/**
 * Vercel serverless function — /api/vitals
 * -------------------------------------------------------------------------
 * How fast the phone felt, one row per measurement. The page's reporter
 * (src/report.js, reportVital) posts here with the web vitals: INP, the
 * slowest tap on the page; LCP, the first screen's paint; CLS, whether
 * anything jumped. Each row carries the build, the room, the store and the
 * device, so a build can be compared with the one before it and a room with
 * the others.
 *
 * POST { name, value, rating, nav, target, interaction, url, build, store, person_id, device_id, ua, screen, shell }
 *   → 204 written · 400 refused · 429 this device has said enough for now
 *
 * Nothing here is trusted for anything but a label, and nothing here can be
 * read back by a phone: the table is service-role only.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey } from "./_env.mjs";

export const NAMES = ["INP", "LCP", "CLS", "FCP", "TTFB"];
export const RATINGS = ["good", "needs-improvement", "poor"];
/* A phone sends a dozen a page; sixty in ten minutes is a page in a reload loop. */
export const RATE = { windowMinutes: 10, perDevice: 60 };
const LIMIT = { url: 300, build: 40, store: 60, person_id: 40, device_id: 120, ua: 300, screen: 60, target: 200, interaction: 20, nav: 30 };

const str = (v, n) => (v == null ? null : String(v).slice(0, n));

export function cleanVital(body) {
  if (!body || typeof body !== "object") return { ok: false, why: "no body" };
  const name = String(body.name || "");
  if (!NAMES.includes(name)) return { ok: false, why: "unknown vital" };
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return { ok: false, why: "bad value" };
  if (name === "CLS" ? value > 100 : value > 120000) return { ok: false, why: "value out of range" };
  const rating = RATINGS.includes(body.rating) ? body.rating : null;
  const row = {
    name, value: Math.round(value * 1000) / 1000, rating,
    nav: str(body.nav, LIMIT.nav), target: str(body.target, LIMIT.target), interaction: str(body.interaction, LIMIT.interaction),
    url: str(body.url, LIMIT.url), build: str(body.build, LIMIT.build), store: str(body.store, LIMIT.store),
    person_id: str(body.person_id, LIMIT.person_id), device_id: str(body.device_id, LIMIT.device_id),
    ua: str(body.ua, LIMIT.ua), screen: str(body.screen, LIMIT.screen), shell: body.shell === true,
  };
  return { ok: true, row };
}

export function tooMany(recentFromDevice) { return Number(recentFromDevice) >= RATE.perDevice; }

export async function handle(req, res, deps) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const c = cleanVital(body);
  if (!c.ok) return res.status(400).json({ error: c.why });
  try {
    if (c.row.device_id) {
      const recent = await deps.recentFromDevice(c.row.device_id, RATE.windowMinutes);
      if (tooMany(recent)) return res.status(429).json({ error: "enough for now" });
    }
    await deps.insert(c.row);
    return res.status(204).end();
  } catch (e) {
    console.error("vitals:", e && e.message);
    return res.status(200).json({ ok: false });
  }
}

function realDeps() {
  const c = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  return {
    recentFromDevice: async (device, minutes) => {
      const since = new Date(Date.now() - minutes * 60000).toISOString();
      const { count } = await c.from("app_vitals").select("id", { count: "exact", head: true }).eq("device_id", device).gte("at", since);
      return count || 0;
    },
    insert: async (row) => { const { error } = await c.from("app_vitals").insert(row); if (error) throw error; },
  };
}

export default function handler(req, res) { return handle(req, res, realDeps()); }

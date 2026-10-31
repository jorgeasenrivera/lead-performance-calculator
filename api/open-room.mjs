/**
 * A room opens itself at the time the store set for the day.
 * -------------------------------------------------------------------------
 * The day's row is what makes Live Floor or Phone Line "open", and until now
 * only the wall made one, when a manager got to it. With a time set on the
 * store (see hoursOf in _rooms.mjs) the first phone that looks after that
 * time asks here, and this makes the row the wall would have made: the roster
 * as the store has it, an empty line, a fresh token. The wall's own pass adds
 * the checklist and the strengths when it next looks, exactly as it does for
 * a row it made itself.
 *
 * Idempotent and time-gated: before the time it makes nothing, after the time
 * it makes the row once, and a row that already exists is left alone. Active staff with access to the store
 * may ask; asking early does nothing, and asking late is what the
 * phones do anyway.
 */
import { staffMayUse, rowAddress } from "./_floor-access.mjs";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, envGap, serviceKey } from "./_env.mjs";
import { ROOMS, roomsOf, openAtFor, localClock, openedBy } from "./_rooms.mjs";
import { storeKey, CONFIG_KEY, TEST_ID, shortLabel } from "./_store-keys.mjs";

const TZ = "America/New_York";
const uid = () => Math.random().toString(36).slice(2, 10);

/* The roster the wall publishes on a day row, without the parts only the wall
   can work out (the checklist, the earned strengths): it fills those in on its
   next look, the way it does for any row. */
export function rosterSnapshot(config, sdata) {
  const sales = new Set(((config && config.roles) || []).filter((r) => r && r.coaching !== false && r.tracked !== false).map((r) => r.id));
  const snap = ((sdata && sdata.roster) || [])
    .filter((a) => a && a.roleId && sales.has(a.roleId))
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((a) => ({ id: a.id, name: a.name, label: shortLabel(a.name),
      role: (((config && config.roles) || []).find((r) => r.id === a.roleId) || {}).name || "",
      langs: Array.isArray(a.langs) ? a.langs : [], skills: Array.isArray(a.skills) ? a.skills : [], strengths: [] }));
  snap.push({ id: TEST_ID, name: "Test", label: "Test", role: "Test", test: true });
  return snap;
}

export function dayRowFor(room, store, day, at, config, sdata) {
  const st = ((config && config.stores) || []).find((x) => x && x.id === store) || {};
  const base = { token: uid(), date: day, store, storeName: st.name || store, createdAt: new Date().toISOString(),
    roster: rosterSnapshot(config, sdata), line: [], history: [], openedBy: "schedule", openAt: at };
  return room === "floor" ? { ...base, unmatched: [], processed: [], lastEventAt: null } : base;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const gap = envGap();
  if (gap) return res.status(500).json({ error: gap });
  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "Sign in first." });
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : (req.body || {});
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "bad body" });
  const store = String(body.store || "").trim();
  const room = String(body.room || "floor");
  if (typeof body.store !== "string" || body.store !== store || !ROOMS.includes(room) || !rowAddress(room, store, "2000-01-01")) return res.status(400).json({ error: "Which store, and which room." });

  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await db.auth.getUser(jwt);
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "Sign in again." });

  const { data: profile, error: profileError } = await db.from("profiles").select("role,stores,active,pending").eq("id", who.user.id).maybeSingle();
  if (profileError) return res.status(500).json({ error: "Could not check this account." });
  const { data: links, error: linkError } = await db.from("floor_people").select("store").eq("user_id", who.user.id).eq("store", store);
  if (linkError) return res.status(500).json({ error: "Could not check this account." });
  if (!staffMayUse({ profile, linkedStores: (links || []).map(x => x.store) }, store)) return res.status(403).json({ error: "Not one of your stores." });

  const { data: cfgRow, error: cfgError } = await db.from("app_data").select("value").eq("key", CONFIG_KEY).maybeSingle();
  if (cfgError) return res.status(500).json({ error: "Could not read the store setup." });
  const config = (cfgRow && cfgRow.value) || null;
  if (!config || !roomsOf(config, store)[room]) return res.status(400).json({ error: "That store does not run that room." });

  const clock = localClock(new Date(), TZ);
  const at = openAtFor(config, store, room, clock.day);
  if (!at) return res.status(200).json({ open: false, at: null, reason: "The desk opens it." });
  if (!openedBy(at, clock.hm)) return res.status(200).json({ open: false, at, now: clock.hm });

  const { table, id } = rowAddress(room, store, clock.day);
  const dateColumn = room === "floor" ? "fdate" : "qdate";
  const { data: had, error: readError } = await db.from(table).select("id").eq("id", id).eq("store", store).eq(dateColumn, clock.day).maybeSingle();
  if (readError) return res.status(500).json({ error: "Could not read the room." });
  if (had) return res.status(200).json({ open: true, at, made: false });

  const { data: sRow, error: storeError } = await db.from("app_data").select("value").eq("key", storeKey(store)).maybeSingle();
  if (storeError || !sRow?.value) return res.status(500).json({ error: "Could not read the store roster." });
  const data = dayRowFor(room, store, clock.day, at, config, (sRow && sRow.value) || null);
  const row = room === "floor"
    ? { id, store, fdate: clock.day, data, updated_at: new Date().toISOString() }
    : { id, store, qdate: clock.day, data, updated_at: new Date().toISOString() };
  const { error } = await db.from(table).insert(row);
  /* Two phones at the same minute: the second insert loses on the key, which
     is the row being there, which is the answer. */
  if (error && String(error.code) !== "23505") return res.status(500).json({ error: error.message || "The row could not be made." });
  if (error) {
    const { data: winner, error: retryError } = await db.from(table).select("id").eq("id", id).eq("store", store).eq(dateColumn, clock.day).maybeSingle();
    if (retryError || !winner) return res.status(409).json({ error: "The room identity could not be confirmed." });
  }
  return res.status(200).json({ open: true, at, made: !error });
}

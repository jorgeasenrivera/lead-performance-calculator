/* The calendar reads only counts. Report bytes, identity, receipts and parser
   diagnostics never leave this authenticated server boundary. */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey } from "./_env.mjs";
import { validStoreId, validBusinessDay } from "./_report-version.mjs";
import { dailyStorage, publicDailyMonth } from "./_daily-delivery-store.mjs";

export function mayReadDaily(profile, storeId) {
  return profile?.active === true && profile.pending === false
    && (profile.role === "admin" || (Array.isArray(profile.stores) && profile.stores.includes(storeId)));
}
export async function handle(req, res, deps) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const { store, month } = req.query || {};
  if (!validStoreId(store) || store.length > 64 || typeof month !== "string"
    || !/^\d{4}-\d{2}$/.test(month) || !validBusinessDay(month + "-01"))
    return res.status(400).json({ error: "which store and month" });
  const auth = req.headers?.authorization;
  if (typeof auth !== "string" || !/^Bearer \S+$/.test(auth))
    return res.status(401).json({ error: "sign in first" });
  try {
    const user = await deps.userFor(auth.slice(7));
    if (!user?.id) return res.status(401).json({ error: "sign in first" });
    const profile = await deps.profileOf(user.id);
    if (!mayReadDaily(profile, store)) return res.status(403).json({ error: "not one of your stores" });
    const records = await deps.list(store);
    return res.status(200).json(publicDailyMonth({ storeId: store, month, records }));
  } catch (_) {
    return res.status(503).json({ error: "daily deliveries unavailable" });
  }
}
export default async function handler(req, res) {
  if (!supabaseUrl() || !serviceKey()) {
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(503).json({ error: "daily deliveries unavailable" });
  }
  const controller = new globalThis.AbortController();
  const db = createClient(supabaseUrl(), serviceKey(), { auth: { persistSession: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: controller.signal }) } });
  const timer = setTimeout(() => controller.abort(), 5000);
  try { return await handle(req, res, {
    userFor: async (jwt) => {
      const { data, error } = await db.auth.getUser(jwt);
      return error ? null : data?.user;
    },
    profileOf: async (id) => {
      const { data, error } = await db.from("profiles").select("role,stores,active,pending").eq("id", id).maybeSingle().abortSignal(controller.signal);
      if (error) throw error;
      return data;
    },
    list: dailyStorage(db, controller.signal).list,
  }); } finally { clearTimeout(timer); }
}

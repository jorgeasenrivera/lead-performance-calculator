/**
 * Vercel serverless function — /api/register-device
 * -------------------------------------------------------------------------
 * A phone saying "this is me, and here is where to reach me".
 *
 * The person is taken from the Supabase session the app sends, never from the
 * request body. A device that could name its own person_id could sign up to be
 * told when somebody ELSE is up, which on a floor where being up is money is not
 * a theoretical concern.
 *
 * A phone carries several tokens and they arrive at different moments:
 *   apns_token       the device itself, for the buzz
 *   apns_pts_token   push-to-start, so an activity can be started from here (iOS 17.2+)
 *   activity_token   this particular running Live Activity — new every time one starts
 *   fcm_token        Android, for both the buzz and the ongoing notification
 * so this merges rather than replaces: an activity starting must not wipe the
 * device token that arrived at login.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
import { createClient } from "@supabase/supabase-js";

const FIELDS = ["apns_token", "apns_pts_token", "activity_token", "fcm_token"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = String(req.headers.authorization || "");
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "sign in first" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const { store, platform, device_id } = body;
  if (!store || !device_id) return res.status(400).json({ error: "store and device_id are required" });
  if (platform !== "ios" && platform !== "android") return res.status(400).json({ error: "unknown platform" });

  /* Who the session actually belongs to. Asking Supabase rather than decoding
     the token here means an expired or revoked session is refused for us. */
  const asUser = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who || !who.user) return res.status(401).json({ error: "that session is not valid" });
  const userId = who.user.id;

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  /* The account is not the person. The line is written with ROSTER ids, so a
     device filed under the account's uuid would sit there perfectly registered
     and never match anybody in any queue — registered, and unreachable. The link
     is what turns one into the other, and until a manager has made it there is
     nothing to register against. */
  const { data: links, error: linkErr } = await db
    .from("floor_people").select("person_id").eq("user_id", userId).eq("store", store).limit(1);
  if (linkErr) return res.status(500).json({ error: "could not check this account" });
  const personId = links && links[0] && links[0].person_id;
  if (!personId) {
    return res.status(403).json({ error: "not-linked",
      message: "This account isn't linked to anybody on this store's floor yet. A manager can link it under Access." });
  }

  const row = { id: `${device_id}:${store}`, device_id, store, person_id: personId, platform,
                updated_at: new Date().toISOString() };
  for (const f of FIELDS) if (typeof body[f] === "string" && body[f]) row[f] = body[f];

  const { error } = await db.from("device_tokens").upsert(row, { onConflict: "id" });
  if (error) return res.status(500).json({ error: "could not register this device" });

  /* One device belongs to one person. If this phone was registered to somebody
     else — a shared demo handset, a salesperson who left and handed it on — the
     old rows go, or the previous owner keeps getting told about this line. */
  try {
    await db.from("device_tokens").delete().eq("device_id", device_id).neq("person_id", personId);
  } catch { /* the row above is already correct; this is tidying */ }

  return res.status(200).json({ ok: true });
}

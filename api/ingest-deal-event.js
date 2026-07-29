/**
 * Vercel serverless function — /api/ingest-deal-event
 * -------------------------------------------------------------------------
 * Place at:  api/ingest-deal-event.js   in your Vercel project.
 * Receives { subject, text, receivedAt } from the Cloudflare Email Worker,
 * parses the labeled fields, STRIPS customer PII, and inserts one row into
 * public.deal_events using the Supabase service role key.
 *
 * Env vars (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (server-only; never ships to the browser)
 *   INGEST_SHARED_SECRET        (must match the worker's secret)
 */
import { createClient } from "@supabase/supabase-js";

// pull "Label: value" from its own line, case-insensitive.
// Only consume spaces/tabs around the colon — never a newline — so an EMPTY
// field (e.g. "Description:") stays empty instead of grabbing the next line.
function field(body, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(body || "").match(new RegExp("^[ \\t]*" + esc + "[ \\t]*:[ \\t]*(.*)$", "im"));
  return m ? m[1].trim() : "";
}

// Subject is "<seg> - <seg> - ...". One segment is the event type (no spaces,
// e.g. SalesAppointmentCreated), one is the alert (also in the body), and the
// dealership (has spaces, e.g. "Driver's Mart Winter Park") will be added soon.
// We resolve by role, not position, so the order can change without breaking.
function parseSubject(subject, alert) {
  const segs = String(subject || "").split(" - ").map((s) => s.trim()).filter(Boolean);
  const rest = segs.filter((s) => !(alert && s.toLowerCase() === alert.toLowerCase()));
  const dealership = rest.find((s) => s.includes(" ")) || null;
  const event = rest.find((s) => !s.includes(" ")) || rest[0] || null;
  return { dealership, event };
}

function parseDealEvent({ subject, text, receivedAt }) {
  // Fields we KEEP:
  const alert = field(text, "ALERT");
  const description = field(text, "Description");
  const sales = field(text, "Sales");
  const source = field(text, "Source Description");
  // Fields we intentionally DO NOT read: Customer, Email, Phone, BDC. (PII denied.)

  const { dealership, event } = parseSubject(subject, alert);
  return {
    received_at: receivedAt || new Date().toISOString(),
    dealership,
    dealership_norm: dealership ? dealership.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : null,
    event: event || null,
    alert: alert || null,
    description: description || null,
    sales: sales || null,
    source: source || null,
    raw_subject: subject || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (req.headers["x-ingest-secret"] !== process.env.INGEST_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const row = parseDealEvent(body);
    if (!row.event && !row.alert) return res.status(422).json({ error: "nothing parseable in email" });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const { error } = await supabase.from("deal_events").insert(row);
    if (error) throw error;

    return res.status(200).json({ ok: true, stored: { event: row.event, dealership: row.dealership, sales: row.sales } });
  } catch (err) {
    console.error("ingest-deal-event error", err && err.message);
    return res.status(500).json({ error: "ingest failed" });
  }
}

// exported for local testing
export { parseDealEvent };

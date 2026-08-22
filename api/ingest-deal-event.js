/**
 * Vercel serverless function — /api/ingest-deal-event
 * -------------------------------------------------------------------------
 * Receives the raw email from the Cloudflare worker, parses it, STRIPS
 * customer PII, and inserts one row into public.deal_events using the
 * Supabase service role key.
 *
 * Accepts either { raw } (full MIME, preferred) or { subject, text }.
 *
 * Env vars (Vercel → Settings → Environment Variables):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (server-only; never ships to the browser)
 *   INGEST_SHARED_SECRET        (must match the worker's secret)
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./_env.mjs";

/* ---- tiny MIME reader (no dependencies) ---- */
function decodeMimeWords(s) {
  return String(s || "")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
      try {
        if (enc.toUpperCase() === "B") return Buffer.from(txt, "base64").toString("utf8");
        return txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      } catch { return txt; }
    });
}
function decodeQP(s) {
  return String(s)
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function unfold(headerBlock) {
  return String(headerBlock).replace(/\r?\n[ \t]+/g, " ");
}
function header(headerBlock, name) {
  const m = unfold(headerBlock).match(new RegExp("^" + name + ":\\s*(.*)$", "im"));
  return m ? m[1].trim() : "";
}
function decodePart(headers, bodyText) {
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) return decodeQP(bodyText);
  if (/content-transfer-encoding:\s*base64/i.test(headers)) {
    try { return Buffer.from(bodyText.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return bodyText; }
  }
  return bodyText;
}
function parseRawEmail(raw) {
  const norm = String(raw || "").replace(/\r\n/g, "\n");
  const idx = norm.indexOf("\n\n");
  const headerBlock = idx >= 0 ? norm.slice(0, idx) : norm;
  const body = idx >= 0 ? norm.slice(idx + 2) : "";
  const subject = decodeMimeWords(header(headerBlock, "Subject"));
  const ctype = header(headerBlock, "Content-Type");
  const b = ctype.match(/boundary="?([^";]+)"?/i);

  const pickPart = (wantHtml) => {
    if (!b) return "";
    for (const part of body.split("--" + b[1])) {
      const pi = part.indexOf("\n\n");
      if (pi < 0) continue;
      const ph = part.slice(0, pi);
      const want = wantHtml ? /content-type:\s*text\/html/i : /content-type:\s*text\/plain/i;
      if (want.test(ph)) return decodePart(ph, part.slice(pi + 2)).trim();
    }
    return "";
  };

  let text = "";
  if (b) {
    text = pickPart(false);
    if (!text) {
      const html = pickPart(true);
      text = html
        .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
        .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    }
  } else {
    text = decodePart(headerBlock, body).trim();
  }
  return { subject, text };
}

/* ---- field extraction (keeps only the allowed fields) ---- */
// Only consume spaces/tabs around the colon — never a newline — so an EMPTY
// field (e.g. "Description:") stays empty instead of grabbing the next line.
function field(body, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(body || "").match(new RegExp("^[ \\t]*" + esc + "[ \\t]*:[ \\t]*(.*)$", "im"));
  return m ? m[1].trim() : "";
}
// Real DriveCentric subject format: "<EventType> - <Alert> - <Dealership>"
// (older test emails were just "<EventType> - <Alert>" with no dealership).
// The body's ALERT is "<Alert> - <Dealership>", so we strip the dealership
// suffix off it to get a clean alert.
function parseSubject(subject, bodyAlert) {
  subject = String(subject || "").trim();
  bodyAlert = String(bodyAlert || "").trim();
  let event = null, alert = bodyAlert || null, dealership = null;

  // body ALERT is "<alert> - <dealership>"; the dealership is the last " - " piece.
  if (bodyAlert) {
    const a = bodyAlert.split(" - ");
    if (a.length >= 2) { dealership = a[a.length - 1].trim(); alert = a.slice(0, -1).join(" - ").trim(); }
    else { alert = bodyAlert; }
  }

  // event = the subject with the trailing bodyAlert removed (handles event types that
  // themselves contain " - ", e.g. "Sales Appointment - Show").
  if (bodyAlert && subject.toLowerCase().endsWith(bodyAlert.toLowerCase())) {
    event = subject.slice(0, subject.length - bodyAlert.length).replace(/\s*-\s*$/, "").trim() || null;
  } else {
    const segs = subject.split(" - ").map((s) => s.trim()).filter(Boolean);
    event = segs[0] || null;
    if (!dealership && segs.length >= 3) dealership = segs[segs.length - 1];
  }
  return { event, alert: alert || null, dealership };
}
function parseDealEvent({ subject, text, receivedAt }) {
  const bodyAlert = field(text, "ALERT");
  const description = field(text, "Description");
  const sales = field(text, "Sales");
  const source = field(text, "Source Description");
  // intentionally NOT read: Customer, Email, Phone, BDC  (PII denied)
  const { event, alert, dealership } = parseSubject(subject, bodyAlert);
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
    const input = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    let subject = input.subject, text = input.text;
    if (input.raw) { const p = parseRawEmail(input.raw); subject = p.subject; text = p.text; }
    const row = parseDealEvent({ subject, text, receivedAt: input.receivedAt });
    if (!row.event && !row.alert) return res.status(422).json({ error: "nothing parseable in email" });

    const supabase = createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY, {
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

export { parseRawEmail, parseDealEvent };

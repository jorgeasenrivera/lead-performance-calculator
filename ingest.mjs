/* =========================================================================
   LPC automated report ingest — Vercel serverless function
   =========================================================================
   POST /api/ingest        (multipart from the Cloudflare Email Worker)
   Auth: x-ingest-secret header must equal process.env.INGEST_SECRET.

   The email's raw MIME is parsed here (postal-mime), every CSV attachment is
   run through THE SAME detection + parsing code as the app's import screen
   (extracted verbatim below), and the result is merged into the store's
   Supabase document exactly the way a manual import would be — including the
   day-over-day trend baselines The Board's arrows depend on, the Open Tasks
   preservation rule, roster auto-add, the import log, and a pre-import
   snapshot for one-click restore.

   Routing:
   - Store: the email's TO address local part after "lpc-" names the store
     (lpc-classicmazda@yourdomain → store whose name squashes to "classicmazda").
   - Delivery channel: the subject or attachment filename must contain
     internet / phone / showroom / campaign (name the scheduled report that way
     in DriveCentric). A delivery file with no channel word is skipped and logged.
   - Daily Activity lands on the DATE IN THE FILENAME
     (Standard-Daily_Activity_2026-07-17.csv), falling back to today (Eastern).

   Env vars (Vercel → Settings → Environment Variables):
     SUPABASE_URL                e.g. https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY   service role key (server only — never in the app)
     INGEST_SECRET               any long random string; the Worker sends it back
   ========================================================================= */

import PostalMime from "postal-mime";
import Papa from "papaparse";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";

export const config = { api: { bodyParser: false } };

/* ---------- tiny helpers copied from the app so behaviour matches ---------- */
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(/[$,%]/g, ""));
  return isNaN(n) ? null : n;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const TZ = "America/New_York";
const todayET = () => {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  return d; // YYYY-MM-DD
};
const ymET = () => todayET().slice(0, 7);

/* Stubs for app-side lookups the extracted code touches (labels only). */
const REPORTS = {}; const LEADERBOARD_REPORTS = {};

/* ---------- BEGIN code extracted verbatim from the app ---------- */
function detectReportType(rows, filename = "") {
  const h2 = (rows[1] || []).join("|").toLowerCase();
  const h1 = (rows[0] || []).join("|").toLowerCase();
  const fn = filename.toLowerCase();
  // ACTIVITY MUST BE CHECKED FIRST. The Daily Activity export also carries a
  // "Units Delivered" column, so testing for that first swallowed it as a delivery
  // summary and quietly wrote activity numbers into the wrong place. Only the
  // activity report has Call Contacted AND Personalized Video together, so this
  // signature is unambiguous.
  if (h2.includes("call contacted") && h2.includes("personalized video")) return "activity";

  if (h2.includes("units delivered")) {
    // Every channel (Internet, Phone, Showroom, Campaign) comes from the SAME
    // "Delivery Summary" report, filtered by Source inside DriveCentric. So the file
    // is always titled "Delivery Summary" and never by channel. If a manager instead
    // pulled a per-channel report (a file titled "Phone", "Internet", etc.), that is
    // the WRONG export and must be caught, not silently accepted.
    const namesChannel = /\b(internet|phone|showroom|show-room|floor|campaign|web)\b/.test(fn);
    const namesDelivery = fn.includes("delivery");
    if (namesChannel && !namesDelivery) return "wrong-channel-report";
    // Correct report. We don't trust the filename to say which channel it is, so the
    // channel is always confirmed by the manager (the ambiguous-channel picker).
    return "delivery";
  }
  if (h2.includes("video day of appt")) return "appointment";
  if (h1.includes("bh lead") && h1.includes("engaged")) return "video";
  return null;
}

function parseReport(rows, type) {
  const header = rows[1] || [];
  const idx = (label) => header.findIndex((h) => norm(h) === norm(label));
  const out = {};
  const channel = type.startsWith("delivery-") ? type.split("-")[1] : null;
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0] || !String(row[0]).trim()) continue;
    const name = String(row[0]).trim();
    const key = norm(name);
    const rec = { displayName: name };
    if (type === "delivery" || channel) {
      const units = toNum(row[idx("Units Delivered")]);
      const dpct = toNum(row[idx("Delivered %")]);
      if (type === "delivery") {
        // legacy: also fills the standards fields + internet channel
        rec.opps = toNum(row[idx("Opportunities")]);
        rec.sold = toNum(row[idx("Sold")]);
        rec.soldPct = toNum(row[idx("Sold %")]);
        rec.unitsDelivered = units;
        rec.deliveredPct = dpct;
        rec.internetUnits = units;
        rec.internetPct = dpct;
      } else if (channel === "campaign") {
        // units only, on purpose. No pct is stored, so nothing can accidentally grade it.
        rec.campaignUnits = units;
      } else {
        rec[channel + "Units"] = units;
        rec[channel + "Pct"] = dpct;
        if (channel === "internet") {
          // internet delivery still drives the lead-standards fields
          rec.opps = toNum(row[idx("Opportunities")]);
          rec.sold = toNum(row[idx("Sold")]);
          rec.soldPct = toNum(row[idx("Sold %")]);
          rec.unitsDelivered = units;
          rec.deliveredPct = dpct;
        }
      }
    } else if (type === "appointment") {
      rec.apptVideoDayPct = toNum(row[idx("Video Day of Appt %")]);
      // Appointments set and the show rate live on THIS report, not Daily Activity.
      // "Total Created" counts appointments made in the period; "Total Scheduled" is the
      // ones actually on the books, which is what "appointments set" should mean.
      rec.apptTotalCreated = toNum(row[idx("Total Created")]);
      rec.apptTotalScheduled = toNum(row[idx("Total Scheduled")]);
      rec.apptTotalShow = toNum(row[idx("Total Show")]);
      // Percentages here export as fractions (0.857) but accept a whole number too.
      rec.apptShowPct = (() => {
        const raw = toNum(row[idx("Total Show %")]);
        if (raw == null) return null;
        return raw > 1 ? raw / 100 : raw;
      })();
    } else if (type === "video") {
      const pctCols = header
        .map((h, i) => (norm(h) === norm("Personalized Video %") ? i : -1))
        .filter((i) => i >= 0);
      rec.bhVideoPct = toNum(row[pctCols[0]]);
      rec.engagedVideoPct = toNum(row[pctCols[1]]);
    } else if (type === "activity") {
      rec.actCalls = toNum(row[idx("Calls")]);
      rec.actCallContacted = toNum(row[idx("Call Contacted")]);
      rec.actVideo = toNum(row[idx("Personalized Video")]);
      rec.actText = toNum(row[idx("Text")]);
      rec.actEmail = toNum(row[idx("Email")]);
      rec.actApptCreated = toNum(row[idx("Created")]);
      rec.actApptShow = toNum(row[idx("Show")]);
      rec.actOppsTotal = toNum(row[idx("Total")]);
      rec.actCompletedTasks = toNum(row[idx("Completed Tasks")]);
      // "Open Tasks" is the posted/outstanding task count on the Workplan; the completion
      // rate is Completed / Open. Fall back to other header names other exports have used.
      rec.actOpenTasks = toNum(row[idx("Open Tasks")]) ?? toNum(row[idx("Total Tasks")]) ??
        toNum(row[idx("Tasks Due")]) ?? toNum(row[idx("Assigned Tasks")]);
      rec.actSold = toNum(row[idx("Sold")]);
      rec.actUnits = toNum(row[idx("Units Delivered")]);
      // Opportunities by source. These are what make closing rates per channel possible.
      rec.actOppShowroom = toNum(row[idx("Showroom")]);
      rec.actOppPhone    = toNum(row[idx("Phone")]);
      rec.actOppInternet = toNum(row[idx("Internet")]);
      rec.actOppCampaign = toNum(row[idx("Campaign")]);
      // The appointment funnel, end to end.
      rec.actApptScheduled = toNum(row[idx("Scheduled")]);
      rec.actApptConfirmed = toNum(row[idx("Confirmed")]);
      rec.actApptNoShow    = toNum(row[idx("No Show")]);
    }
    out[key] = rec;
  }
  return out;
}

/* ---------- END extracted code ---------- */

/* =========================================================================
   PDF scheduled reports
   =========================================================================
   DriveCentric's scheduler only sends PDF. These are digital PDFs with real
   positioned text, so the table is reconstructed from coordinates: words are
   banded into lines, a line with no numbers starts a person block (multi-line
   names merge; a name repeated across a page break is the same person), and
   metric lines (label + numbers) attach to the current person.

   Each report layout gets a MAPPER keyed on the PDF's title line. A PDF whose
   title has no mapper is read and reported back, but NEVER written — better a
   loud skip than silently wrong numbers. Add a mapper per real report as its
   first scheduled email arrives.
   ========================================================================= */
async function extractPdfBlocks(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const items = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5], pg: pn });
    }
  }
  items.sort((a, b) => a.pg - b.pg || a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && L.pg === it.pg && Math.abs(L.y - it.y) < 4) L.parts.push(it);
    else lines.push({ pg: it.pg, y: it.y, parts: [it] });
  }
  const METRIC = /^(internet|phone|showroom|campaign|chat|email|text|calls?|total|appointments?|scheduled|confirmed|show|no show|cancelled|sold|units?)$/i;
  const isNum = (t) => /^[\d,.%\$-]+$/.test(t);
  const blocks = []; let cur = null; let title = null; let dateRange = null; let pendingName = [];
  for (const L of lines) {
    const texts = L.parts.map((p) => p.str);
    const nums = texts.filter(isNum);
    const label = texts.filter((t) => !isNum(t)).join(" ");
    if (!title && /report/i.test(label)) { title = label; continue; }
    if (/^\d+\/\d+\/\d+/.test(texts[0])) { dateRange = texts.join(" "); continue; }
    if (nums.length && METRIC.test(texts[0])) {
      if (pendingName.length) {
        const name = pendingName.join(" ");
        if (!(cur && cur.name === name)) { cur = { name, metrics: {} }; blocks.push(cur); }
        pendingName = [];
      }
      if (cur) cur.metrics[texts[0]] = nums.map((n) => toNum(n));
    } else if (label && !nums.length) {
      pendingName.push(label);
    }
  }
  return { title: title || "", dateRange, blocks };
}

/* Mapper registry: title regex -> function(blocks, ctx) -> entries[] for applyToStore.
   Each real scheduled report gets an entry here, built against its first real PDF.
   The commented template shows the shape using the sample "Activity Report". */
const PDF_MAPPERS = [
  // {
  //   match: /^Activity Report/i,
  //   map(blocks, { storeName }) {
  //     // drop the store-header block, turn each person's metrics into a rec,
  //     // then return [{ rows: <synthesized>, type: "...", fileName, actDay }]
  //   },
  // },
];

/* ---------- Supabase (PostgREST, service role) ---------- */
const SB = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
async function sbGet(key) {
  const { url, key: k } = SB();
  const r = await fetch(`${url}/rest/v1/app_data?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: { apikey: k, Authorization: `Bearer ${k}` },
  });
  if (!r.ok) throw new Error(`supabase read ${r.status}`);
  const rows = await r.json();
  return rows.length ? rows[0].value : null;
}
async function sbPut(key, value) {
  const { url, key: k } = SB();
  const r = await fetch(`${url}/rest/v1/app_data`, {
    method: "POST",
    headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key, value }]),
  });
  if (!r.ok) throw new Error(`supabase write ${r.status}: ${await r.text()}`);
}

/* ---------- the merge: a faithful port of the app's applyEntries ---------- */
function applyToStore(data, entries, sourceLabel) {
  const month = ymET(); const day = todayET();
  const next = JSON.parse(JSON.stringify(data || {}));
  next.roster = next.roster || [];
  next.months = next.months || {};
  const M = (next.months[month] = next.months[month] || { stats: {}, names: {}, imports: {} });
  M.stats = M.stats || {}; M.names = M.names || {}; M.imports = M.imports || {};
  M.imports[day] = M.imports[day] || {};
  const aliases = next.aliases || {};
  const canon = (k) => aliases[k] || k;
  const excludedSet = new Set((next.excluded || []).map(norm));
  const results = [];

  // pre-import snapshot, exactly like a manual import
  const snapCopy = JSON.parse(JSON.stringify({
    roster: next.roster, months: next.months, activity: next.activity,
    plates: next.plates, restrictions: next.restrictions, aliases: next.aliases,
    stars: next.stars, goals: next.goals, baselines: next.baselines, qualified: next.qualified,
    repeatFlags: next.repeatFlags, excluded: next.excluded, daysOff: next.daysOff,
    statsExcluded: next.statsExcluded, plateRegistry: next.plateRegistry,
  }));
  const snapT = new Date().toISOString();
  next.snapshots = [{ t: snapT, by: "Auto-import", reason: "Before email import", data: snapCopy },
    ...(next.snapshots || [])].slice(0, 12);

  for (const { rows, type, fileName, actDay: fileDay } of entries) {
    const actDay = (fileDay && fileDay <= day) ? fileDay : day;
    const raw = parseReport(rows, type);
    const parsed = {};
    let skipped = 0;
    for (const [k, v] of Object.entries(raw)) {
      if (excludedSet.has(k)) { skipped++; continue; }
      const c = canon(k);
      parsed[c] = { ...(parsed[c] || {}), ...v };
    }
    M.names[type] = Object.keys(parsed);
    let count = 0;

    if (type === "activity") {
      if (!next.activity) next.activity = {};
      const priorDay = next.activity[actDay] || {};
      next.activity[actDay] = {};
      for (const [key, rec] of Object.entries(parsed)) {
        const priorPosted = priorDay[key]?.tasksPosted;
        const posted = rec.actOpenTasks != null ? rec.actOpenTasks : (priorPosted ?? null);
        next.activity[actDay][key] = {
          displayName: rec.displayName,
          calls: rec.actCalls, video: rec.actVideo, contacted: rec.actCallContacted,
          text: rec.actText, email: rec.actEmail, apptCreated: rec.actApptCreated,
          apptShow: rec.actApptShow, opps: rec.actOppsTotal, tasks: rec.actCompletedTasks,
          tasksPosted: posted,
          sold: rec.actSold, units: rec.actUnits,
          oppShowroom: rec.actOppShowroom, oppPhone: rec.actOppPhone,
          oppInternet: rec.actOppInternet, oppCampaign: rec.actOppCampaign,
          apptScheduled: rec.actApptScheduled, apptConfirmed: rec.actApptConfirmed,
          apptNoShow: rec.actApptNoShow,
          uploadedAt: new Date().toISOString(),
        };
        count++;
      }
    }

    for (const [key, rec] of Object.entries(parsed)) {
      const prevStat = M.stats[key] || {};
      const trend = { ...(prevStat.prevPct || {}) };
      const pctDay = { ...(prevStat.pctDay || {}) };
      const hist = JSON.parse(JSON.stringify(prevStat.pctHistory || {}));
      for (const ch of ["internet", "phone", "showroom"]) {
        if (rec[ch + "Pct"] == null) continue;
        const storedVal = prevStat[ch + "Pct"];
        const storedDay = pctDay[ch];
        if (storedVal != null && storedDay && storedDay !== day) trend[ch] = storedVal;
        pctDay[ch] = day;
        hist[ch] = (hist[ch] || []).filter((p) => p.d !== day);
        hist[ch].push({ d: day, v: rec[ch + "Pct"] });
        hist[ch] = hist[ch].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-30);
      }
      M.stats[key] = { ...prevStat, ...rec, prevPct: trend, pctDay, pctHistory: hist, [`${type}Updated`]: day };
      if (type !== "activity") count++;
    }

    M.imports[day][type] = true;
    if (type === "delivery-internet") M.imports[day]["delivery"] = true;
    if (type === "delivery") M.imports[day]["delivery-internet"] = true;

    next.importLog = [
      { id: uid(), t: new Date().toISOString(), type, label: type, file: fileName, count, skipped,
        by: sourceLabel, snapT, day: type === "activity" ? actDay : null },
      ...(next.importLog || []),
    ].slice(0, 200);

    const rosterKeys = new Set(next.roster.map((a) => norm(a.name)));
    for (const [key, rec] of Object.entries(parsed)) {
      if (excludedSet.has(key)) continue;
      if (!rosterKeys.has(key)) {
        next.roster.push({ id: uid(), name: rec.displayName, roleId: null, order: next.roster.length });
        rosterKeys.add(key);
      }
    }
    results.push({ file: fileName, type, day: type === "activity" ? actDay : day, count, skipped });
  }
  return { next, results };
}

/* ---------- routing helpers ---------- */
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function channelFrom(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("internet")) return "internet";
  if (t.includes("phone")) return "phone";
  if (t.includes("showroom")) return "showroom";
  if (t.includes("campaign")) return "campaign";
  return null;
}
function activityDateFrom(name) {
  const m = String(name || "").match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if ((req.headers["x-ingest-secret"] || "") !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: "bad secret" });
  }
  try {
    const raw = await readRaw(req);
    const mail = await PostalMime.parse(raw);
    const to = (mail.to?.[0]?.address || req.headers["x-envelope-to"] || "").toLowerCase();
    const subject = mail.subject || "";

    // which store? lpc-<storename>@…
    const local = to.split("@")[0] || "";
    const slug = squash(local.replace(/^lpc-?/, ""));
    const cfg = await sbGet("lpc:config:v2");
    const store = (cfg?.stores || []).find((s) => squash(s.name) === slug || squash(s.id) === slug);
    if (!store) return res.status(200).json({ skipped: `no store matches address "${to}"` });

    const atts = mail.attachments || [];
    const csvs = atts.filter((a) => /csv$/i.test(a.filename || "") || /text\/csv/i.test(a.mimeType || ""));
    const pdfs = atts.filter((a) => /pdf$/i.test(a.filename || "") || /application\/pdf/i.test(a.mimeType || ""));
    if (!csvs.length && !pdfs.length) return res.status(200).json({ skipped: "no CSV or PDF attachment" });

    const entries = [];
    const skippedFiles = [];
    for (const a of csvs) {
      const text = Buffer.from(a.content).toString("utf8").replace(/^\ufeff/, "");
      const rows = Papa.parse(text, { skipEmptyLines: true }).data;
      let type = detectReportType(rows, a.filename || "");
      if (type === "delivery" || (type && type.startsWith("delivery"))) {
        const ch = channelFrom(subject) || channelFrom(a.filename);
        if (!ch) { skippedFiles.push({ file: a.filename, why: "delivery report with no channel word in subject or filename" }); continue; }
        type = "delivery-" + ch;
      }
      if (!type) { skippedFiles.push({ file: a.filename, why: "unrecognized report" }); continue; }
      entries.push({ rows, type, fileName: a.filename || "email.csv", actDay: activityDateFrom(a.filename) });
    }
    // PDF attachments: reconstruct, then map if a mapper exists for the title
    const pdfReads = [];
    for (const a of pdfs) {
      try {
        const { title, dateRange, blocks } = await extractPdfBlocks(Buffer.from(a.content));
        const mapper = PDF_MAPPERS.find((m) => m.match.test(title));
        if (mapper) {
          const mapped = mapper.map(blocks, { storeName: store.name, subject, fileName: a.filename, dateRange });
          for (const e of mapped) entries.push(e);
          pdfReads.push({ file: a.filename, title, people: blocks.length, mapped: true });
        } else {
          pdfReads.push({ file: a.filename, title, people: blocks.length, mapped: false,
            note: "PDF read successfully but no mapper is configured for this report title; nothing written" });
        }
      } catch (e) {
        skippedFiles.push({ file: a.filename, why: "PDF read failed: " + String(e.message || e) });
      }
    }
    if (!entries.length) return res.status(200).json({ skipped: skippedFiles, pdfReads });

    const key = `lpc:store:${store.id}:v2`;
    const data = await sbGet(key);
    if (!data) return res.status(200).json({ skipped: `store ${store.id} has no data document yet` });
    const { next, results } = applyToStore(data, entries, "Auto-import (email)");
    await sbPut(key, next);
    return res.status(200).json({ ok: true, store: store.id, results, skippedFiles, pdfReads });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

/* =========================================================================
   LPC automated report ingest — Vercel serverless function
   POST /api/ingest  (from the Cloudflare Email Worker)
   Auth: x-ingest-secret header must equal process.env.INGEST_SECRET.
   ========================================================================= */

import PostalMime from "postal-mime";
import Papa from "papaparse";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
try {
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");
} catch (e) { /* bundled include covers it */ }

export const config = { api: { bodyParser: false } };

/* ---------- helpers copied from the app so behaviour matches ---------- */
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
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const ymET = () => todayET().slice(0, 7);

/* ---------- BEGIN code extracted verbatim from the app ---------- */
function detectReportType(rows, filename = "") {
  const h2 = (rows[1] || []).join("|").toLowerCase();
  const h1 = (rows[0] || []).join("|").toLowerCase();
  const fn = filename.toLowerCase();
  if (h2.includes("call contacted") && h2.includes("personalized video")) return "activity";
  if (h2.includes("units delivered")) {
    const namesChannel = /\b(internet|phone|showroom|show-room|floor|campaign|web)\b/.test(fn);
    const namesDelivery = fn.includes("delivery");
    if (namesChannel && !namesDelivery) return "wrong-channel-report";
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
        rec.opps = toNum(row[idx("Opportunities")]);
        rec.sold = toNum(row[idx("Sold")]);
        rec.soldPct = toNum(row[idx("Sold %")]);
        rec.unitsDelivered = units; rec.deliveredPct = dpct;
        rec.internetUnits = units; rec.internetPct = dpct;
      } else if (channel === "campaign") {
        rec.campaignUnits = units;
      } else {
        rec[channel + "Units"] = units;
        rec[channel + "Pct"] = dpct;
        if (channel === "internet") {
          rec.opps = toNum(row[idx("Opportunities")]);
          rec.sold = toNum(row[idx("Sold")]);
          rec.soldPct = toNum(row[idx("Sold %")]);
          rec.unitsDelivered = units; rec.deliveredPct = dpct;
        }
      }
    } else if (type === "appointment") {
      rec.apptVideoDayPct = toNum(row[idx("Video Day of Appt %")]);
      rec.apptTotalCreated = toNum(row[idx("Total Created")]);
      rec.apptTotalScheduled = toNum(row[idx("Total Scheduled")]);
      rec.apptTotalShow = toNum(row[idx("Total Show")]);
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
      rec.actOpenTasks = toNum(row[idx("Open Tasks")]) ?? toNum(row[idx("Total Tasks")]) ??
        toNum(row[idx("Tasks Due")]) ?? toNum(row[idx("Assigned Tasks")]);
      rec.actSold = toNum(row[idx("Sold")]);
      rec.actUnits = toNum(row[idx("Units Delivered")]);
      rec.actOppShowroom = toNum(row[idx("Showroom")]);
      rec.actOppPhone    = toNum(row[idx("Phone")]);
      rec.actOppInternet = toNum(row[idx("Internet")]);
      rec.actOppCampaign = toNum(row[idx("Campaign")]);
      rec.actApptScheduled = toNum(row[idx("Scheduled")]);
      rec.actApptConfirmed = toNum(row[idx("Confirmed")]);
      rec.actApptNoShow    = toNum(row[idx("No Show")]);
    }
    out[key] = rec;
  }
  return out;
}
/* ---------- END extracted code ---------- */

/* ---------- shared PDF line extraction ---------- */
async function extractPdfLines(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
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
  return lines;
}

const squashT = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Remove vocabulary from a token list, including runs of up to 4 consecutive
   tokens that only form a vocab word when glued ("Con"+"fi"+"rmed"). */
function stripVocabWith(vocab, tokens) {
  const kept = [];
  let i = 0;
  while (i < tokens.length) {
    let consumed = 0;
    for (let len = 4; len >= 1; len--) {
      if (i + len > tokens.length) continue;
      const glued = squashT(tokens.slice(i, i + len).join(""));
      if (glued && vocab.has(glued)) { consumed = len; break; }
    }
    if (consumed) { i += consumed; continue; }
    const t = tokens[i];
    if (squashT(t)) kept.push(t);
    i++;
  }
  return kept;
}

function vocabCountWith(vocab, tokens) {
  let n = 0, i = 0;
  while (i < tokens.length) {
    let consumed = 0;
    for (let len = 4; len >= 1; len--) {
      if (i + len > tokens.length) continue;
      const glued = squashT(tokens.slice(i, i + len).join(""));
      if (glued && vocab.has(glued)) { consumed = len; break; }
    }
    if (consumed) { n++; i += consumed; } else i++;
  }
  return n;
}

/* =========================================================================
   PDF #1: Daily Activity grid.
   Names embedded INSIDE the two header lines; "Confirmed" splits by ligature
   as "Con fi rmed". Name fragments accumulate until the "All" row consumes
   them. 19 numbers per All row:
   Net Leads(=TOTAL opps), Showroom, Phone Ups, ILM(=internet), Campaign,
   App Created, App Scheduled, App Confirmed, App Show, Calls Made, Connects,
   Texts, Emails, Videos, Video %, Open Tasks, Completed Tasks,
   Total Delivered, Total Closing %.
   First block is the STORE.
   ========================================================================= */
const DA_VOCAB = new Set(["netleads","net","leads","showroom","phoneups","phone","ups",
  "ilmleads","ilm","campaign","appcreated","appscheduled","appconfirmed","appshow","app",
  "created","scheduled","confirmed","show","callsmade","calls","made","connects","texts",
  "text","emails","email","videos","video","opentasks","open","tasks","completedtasks",
  "completed","totaldelivered","totalclosing","total","delivered","closing"]);

function mapDailyActivityGrid(lines) {
  const isNum = (t) => /^[\d,]+$/.test(t) || t === "-" || t === "∞" || /^\d+\.?\d*%$/.test(t);
  const val = (t) => (t === "-" || t === "∞" || t == null) ? null : toNum(t);

  let storeName = null, sawHeaderSig = false;
  let nameParts = [];
  const people = {};

  for (const L of lines) {
    const texts = L.parts.map((p) => p.str.split(/\s+/)).flat().filter(Boolean);
    if (!texts.length) continue;
    if (squashT(texts.join("")).includes("netleads")) sawHeaderSig = true;
    const rowTag = texts[0];

    if (rowTag === "New" || rowTag === "Used" || rowTag === "All") {
      if (rowTag !== "All") continue;
      const nums = texts.slice(1).filter(isNum);
      if (nums.length < 19) continue;
      const nm = nameParts.join(" ").replace(/\s+/g, " ").trim();
      nameParts = [];
      if (!nm) continue;
      const v = nums.slice(0, 19).map(val);
      if (!storeName) { storeName = nm; continue; }
      people[norm(nm)] = { displayName: nm, cols: v };
      continue;
    }

    const nonNum = texts.filter((t) => !isNum(t) && t !== "%");
    if (vocabCountWith(DA_VOCAB, nonNum) >= 3) {
      const frag = stripVocabWith(DA_VOCAB, nonNum);
      if (frag.length) nameParts.push(frag.join(" "));
    }
  }
  if (!sawHeaderSig || Object.keys(people).length < 3) return null;

  const header = ["Name","Total","Showroom","Phone","Internet","Campaign",
    "Created","Scheduled","Confirmed","Show","Calls","Call Contacted","Text","Email",
    "Personalized Video","Open Tasks","Completed Tasks","Units Delivered"];
  const rows = [["Daily Activity"], header];
  for (const p of Object.values(people)) {
    const c = p.cols;
    rows.push([p.displayName, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8],
      c[9], c[10], c[11], c[12], c[13], c[15], c[16], c[17]]);
  }
  return { storeName, rows };
}

/* =========================================================================
   PDF #2: Delivery Summary grid.
   Eight rows per person in two groups:
     vehicle type — New / Used / Other / Total   (not used)
     source       — Showroom / Phone / Internet / Campaign
   Six values + a percentage per row:
     Total Leads | Total Ups | Unsold In Showroom | Be Backs |
     Total Delivered/F&I | Closing %
   Total Ups / Unsold In Showroom / Be Backs are SHOWROOM-ONLY metrics and are
   only read on the Showroom row.

   PAIRING RULE — the important bit. Unlike Daily Activity, the name block
   appears AFTER the person's data. So a completed source-group is held until
   the next name arrives, then attributed. Getting this off by one silently
   assigns everyone their neighbour's numbers, so the response echoes a
   `pairings` array for spot-checking.

   Verified: Jason Campion Internet 110 leads / 5 delivered / 4.5% matches the
   old Delivery Summary CSV (110 net opportunities, 5 deals, 4.5% delivered).
   ========================================================================= */
const DS_VOCAB = new Set(["total","leads","totalleads","ups","totalups","showroom",
  "unsold","in","unsoldin","unsoldinshowroom","be","backs","bebacks","delivered",
  "f","i","fi","delivered/f&i","totaldelivered","closing","closing%","%"]);

const DS_SOURCES = ["Showroom", "Phone", "Internet", "Campaign"];
const DS_VEHICLE = ["New", "Used", "Other", "Total"];

function mapDeliverySummaryGrid(lines) {
  const isNum = (t) => /^[\d,]+$/.test(t) || t === "-" || /^\d+\.?\d*%$/.test(t);
  const val = (t) => (t === "-" || t == null) ? null : toNum(t);

  let sawHeaderSig = false;
  let nameParts = [];
  let pending = {};            // source rows collected but not yet named
  const ordered = [];          // { name, sources } in document order
  const pairings = [];

  const flushName = () => {
    const nm = nameParts.join(" ").replace(/\s+/g, " ").trim();
    nameParts = [];
    return nm;
  };

  for (const L of lines) {
    const texts = L.parts.map((p) => p.str.split(/\s+/)).flat().filter(Boolean);
    if (!texts.length) continue;
    const joined = squashT(texts.join(""));
    if (joined.includes("unsoldinshowroom") || joined.includes("bebacks")) sawHeaderSig = true;
    const rowTag = texts[0];

    // a source row: collect it into the pending block
    if (DS_SOURCES.includes(rowTag)) {
      const nums = texts.slice(1).filter(isNum);
      if (nums.length >= 6) pending[rowTag.toLowerCase()] = nums.slice(0, 6).map(val);
      continue;
    }
    // vehicle-type rows are ignored entirely
    if (DS_VEHICLE.includes(rowTag)) continue;

    // header/name line: 2+ vocabulary words means it carries the label block
    const nonNum = texts.filter((t) => !isNum(t) && t !== "%");
    if (vocabCountWith(DS_VOCAB, nonNum) >= 2) {
      const frag = stripVocabWith(DS_VOCAB, nonNum);
      if (frag.length) {
        // a name arrived — it names the block that came BEFORE it
        if (Object.keys(pending).length) {
          const nm = flushName();
          if (nm) { ordered.push({ name: nm, sources: pending }); }
          pending = {};
        }
        nameParts.push(frag.join(" "));
      }
    }
  }
  // trailing block, if the file ends on data
  if (Object.keys(pending).length) {
    const nm = flushName();
    if (nm) ordered.push({ name: nm, sources: pending });
  }

  if (!sawHeaderSig || ordered.length < 3) return null;

  // first block is the store's own totals
  const storeName = ordered[0].name;
  const people = ordered.slice(1);

  const header = ["Name","Opportunities","Units Delivered","Delivered %",
    "internetUnits","internetPct","phoneUnits","phonePct",
    "showroomUnits","showroomPct","campaignUnits",
    "showroomUps","showroomUnsold","showroomBeBacks"];
  const rows = [["Delivery Summary"], header];

  for (const p of people) {
    const s = p.sources;
    const pick = (k, i) => (s[k] ? s[k][i] : null);
    const pctOf = (k) => {
      const v = pick(k, 5);
      if (v == null) return null;
      return v > 1 ? v / 100 : v;   // stored as a fraction, like the old report
    };
    const internetLeads = pick("internet", 0);
    const internetDel   = pick("internet", 4);
    rows.push([
      p.name,
      internetLeads,                 // Opportunities  (lead standards)
      internetDel,                   // Units Delivered
      pctOf("internet"),             // Delivered %
      internetDel,  pctOf("internet"),
      pick("phone", 4),    pctOf("phone"),
      pick("showroom", 4), pctOf("showroom"),
      pick("campaign", 4),           // campaign: units only, never graded
      pick("showroom", 1),           // Total Ups        (showroom-only)
      pick("showroom", 2),           // Unsold In Showroom
      pick("showroom", 3),           // Be Backs
    ]);
    pairings.push({
      name: p.name,
      internet: s.internet ? `${pick("internet",0)} leads / ${internetDel} delivered / ${pick("internet",5)}%` : "-",
      showroom: s.showroom ? `${pick("showroom",0)} leads / ${pick("showroom",4)} delivered` : "-",
    });
  }
  return { storeName, rows, pairings };
}

/* Delivery Summary rows are pre-shaped, so they bypass parseReport(). */
function parseDeliverySummaryRows(rows) {
  const header = rows[1] || [];
  const idx = (label) => header.indexOf(label);
  const out = {};
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    out[norm(name)] = {
      displayName: name,
      opps: row[idx("Opportunities")],
      unitsDelivered: row[idx("Units Delivered")],
      deliveredPct: row[idx("Delivered %")],
      internetUnits: row[idx("internetUnits")],
      internetPct: row[idx("internetPct")],
      phoneUnits: row[idx("phoneUnits")],
      phonePct: row[idx("phonePct")],
      showroomUnits: row[idx("showroomUnits")],
      showroomPct: row[idx("showroomPct")],
      campaignUnits: row[idx("campaignUnits")],
      showroomUps: row[idx("showroomUps")],
      showroomUnsold: row[idx("showroomUnsold")],
      showroomBeBacks: row[idx("showroomBeBacks")],
    };
  }
  return out;
}

function activityDateFrom(name) {
  const s = String(name || "");
  let m = s.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

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

  const snapCopy = JSON.parse(JSON.stringify({
    roster: next.roster, months: next.months, activity: next.activity,
    plates: next.plates, restrictions: next.restrictions, aliases: next.aliases,
    stars: next.stars, goals: next.goals, baselines: next.baselines, qualified: next.qualified,
    repeatFlags: next.repeatFlags, excluded: next.excluded, daysOff: next.daysOff,
    statsExcluded: next.statsExcluded, plateRegistry: next.plateRegistry,
  }));

  // Snapshot only on the FIRST auto-import of a given report type per day —
  // hourly re-sends would otherwise flush the whole history in a day.
  const snapT = new Date().toISOString();
  const alreadyToday = entries.every((e) => M.imports?.[day]?.[e.type]);
  if (!alreadyToday) {
    next.snapshots = [{ t: snapT, by: "Auto-import", reason: "Before email import", data: snapCopy },
      ...(next.snapshots || [])].slice(0, 40);
  }

  for (const { rows, type, fileName, actDay: fileDay } of entries) {
    const actDay = (fileDay && fileDay <= day) ? fileDay : day;
    const raw = type === "delivery-summary"
      ? parseDeliverySummaryRows(rows)
      : parseReport(rows, type);
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
    // the combined summary satisfies every per-channel checklist tick
    if (type === "delivery-summary") {
      for (const t of ["delivery", "delivery-internet", "delivery-phone",
                       "delivery-showroom", "delivery-campaign"]) M.imports[day][t] = true;
    }

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

    const local = to.split("@")[0] || "";
    const slug = squash(local.replace(/^lpc-?/, ""));
    const cfg = await sbGet("lpc:config:v2");
    let store = (cfg?.stores || []).find((s) => squash(s.name) === slug || squash(s.id) === slug) || null;

    const atts = mail.attachments || [];
    const csvs = atts.filter((a) => /csv$/i.test(a.filename || "") || /text\/csv/i.test(a.mimeType || ""));
    const pdfs = atts.filter((a) => /pdf$/i.test(a.filename || "") || /application\/pdf/i.test(a.mimeType || ""));
    if (!csvs.length && !pdfs.length) return res.status(200).json({ skipped: "no CSV or PDF attachment" });

    const entries = [];
    const skippedFiles = [];
    const pdfReads = [];

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
      entries.push({ rows, type, fileName: a.filename || "email.csv",
        actDay: activityDateFrom(a.filename) });
    }

    // PDFs: each grid names its own store, so ONE shared address works for
    // every store. If the parsed store matches no real store, the parse is
    // suspect and NOTHING is written.
    const wantsSummary = /delivery\s*summary/i.test(subject);
    for (const a of pdfs) {
      try {
        const lines = await extractPdfLines(Buffer.from(a.content));

        // Subject says Delivery Summary → try that mapper first.
        let mapped = null, kind = null, pairings = null;
        if (wantsSummary) {
          const ds = mapDeliverySummaryGrid(lines);
          if (ds) { mapped = ds; kind = "delivery-summary"; pairings = ds.pairings; }
        }
        if (!mapped) {
          const da = mapDailyActivityGrid(lines);
          if (da) { mapped = da; kind = "activity"; }
        }
        if (!mapped && !wantsSummary) {
          const ds = mapDeliverySummaryGrid(lines);
          if (ds) { mapped = ds; kind = "delivery-summary"; pairings = ds.pairings; }
        }

        if (mapped) {
          const byHeader = (cfg?.stores || []).find((s) => squash(s.name) === squash(mapped.storeName));
          if (!byHeader) {
            pdfReads.push({ file: a.filename, mapped: false, kind,
              note: `parsed store "${mapped.storeName}" matches no store; nothing written`,
              parsedPeople: mapped.rows.slice(2).map((r) => r[0]) });
            continue;
          }
          store = byHeader;
          entries.push({ rows: mapped.rows, type: kind, fileName: a.filename || "email.pdf",
            actDay: kind === "activity"
              ? (activityDateFrom(a.filename) || activityDateFrom(subject))
              : null });
          const read = { file: a.filename, kind, store: mapped.storeName,
            people: mapped.rows.length - 2, mapped: true,
            names: mapped.rows.slice(2).map((r) => r[0]) };
          // VERIFY THIS on the first Delivery Summary import: it is the
          // name-to-numbers pairing, which is the one thing that can go wrong
          // silently on this layout.
          if (pairings) read.pairings = pairings.slice(0, 12);
          pdfReads.push(read);
        } else {
          const dbg = [];
          for (const L of lines.slice(0, 40)) {
            dbg.push(L.parts.map((p) => p.str).join(" | "));
          }
          pdfReads.push({ file: a.filename, mapped: false,
            note: "PDF layout not recognized; nothing written",
            debugLines: dbg });
        }
      } catch (e) {
        skippedFiles.push({ file: a.filename, why: "PDF read failed: " + String(e.message || e) });
      }
    }

    if (!store) return res.status(200).json({
      skipped: `no store matches address "${to}" or any PDF header`, skippedFiles, pdfReads });
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

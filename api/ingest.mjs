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
   ========================================================================= */
const DA_VOCAB = new Set(["netleads","net","leads","showroom","phoneups","phone","ups",
  "ilmleads","ilm","campaign","appcreated","appscheduled","appconfirmed","appshow","app",
  "created","scheduled","confirmed","show","callsmade","calls","made","connects","texts",
  "text","emails","email","videos","video","opentasks","open","tasks","completedtasks",
  "completed","totaldelivered","totalclosing","total","delivered","closing"]);

function mapDailyActivityGrid(lines) {
  // Same decimal fix as the Delivery Summary: Units Delivered carries half
  // credit on split deals, and one dropped token knocks the whole row out.
  const isNum = (t) => /^[\d,]+(?:\.\d+)?$/.test(t) || t === "-" || t === "∞" || /^\d+(?:\.\d+)?%$/.test(t);
  const val = (t) => (t === "-" || t === "∞" || t == null) ? null : toNum(t);

  let storeName = null, sawHeaderSig = false;
  let nameParts = [];
  // Some exports print the first person's name in the same block as the store
  // heading. Those fragments are carried to the next data row instead of being
  // swallowed, which is what used to drop that person from the whole report AND
  // corrupt the store name so nothing could be routed.
  let storeParts = null, pendingName = null;
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
      const parts = nameParts.slice();
      let nm = parts.join(" ").replace(/\s+/g, " ").trim();
      nameParts = [];
      const v = nums.slice(0, 19).map(val);
      if (!storeName) {
        if (!nm) continue;
        storeName = nm;
        storeParts = parts;
        // anything past the first fragment may belong to a person, not the store
        if (parts.length > 1) pendingName = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();
        continue;
      }
      // A data row with no name of its own is the tell: its name was absorbed
      // into the store heading above. Give it back, and trim the store name.
      if (!nm && pendingName) {
        nm = pendingName;
        storeName = (storeParts && storeParts[0]) ? storeParts[0].trim() : storeName;
      }
      pendingName = null;
      if (!nm) continue;
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
   Confirmed layout from live debug output:
     - THREE header lines per person, the name split across lines 1 and 3
       ("Drivers Mart Winter" / "Be Backs" / "Park | Leads | ...").
     - The name comes BEFORE its data rows.
     - A page break REPEATS the header, splitting one person's eight rows
       across the boundary; the repeat merges rather than creating a second.
     - Lines before the FIRST header block (report title, date range) carry no
       column vocabulary and must be skipped, or they glue onto the store name.
     - Eight rows per person: New/Used/Other/Total (vehicle type, ignored)
       and Showroom/Phone/Internet/Campaign (source, used).
     - Six values + a percentage per row:
       Total Leads | Total Ups | Unsold In Showroom | Be Backs |
       Total Delivered/F&I | Closing %
       Total Ups / Unsold / Be Backs are SHOWROOM-ONLY and only read there.
   Verified: Jason Campion Internet 110 leads / 5 delivered / 4.5% matches the
   old Delivery Summary CSV (110 net opportunities, 5 deals, 4.5% delivered).
   ========================================================================= */
const DS_VOCAB = new Set(["total","leads","totalleads","ups","totalups","showroom",
  "unsold","in","unsoldin","unsoldinshowroom","be","backs","bebacks","delivered",
  "f","i","fi","f&i","delivered/f&i","totaldelivered","closing","closing%","%"]);

const DS_SOURCES = ["Showroom", "Phone", "Internet", "Campaign"];
const DS_VEHICLE = ["New", "Used", "Other", "Total"];

function mapDeliverySummaryGrid(lines) {
  // Split deals are credited in halves, so the Delivered column legitimately
  // reads 3.5 or 13.5. The old pattern had no decimal point, so those tokens
  // failed isNum, got filtered out of the row, and the row then fell one value
  // short of six and was dropped whole. That is why people with split deals
  // came back with null internet numbers while their all-integer channels
  // survived. Anyone who splits a deal must not vanish from the board.
  const isNum = (t) => /^[\d,]+(?:\.\d+)?$/.test(t) || t === "-" || /^\d+(?:\.\d+)?%$/.test(t);
  // A "%" token is a percentage no matter its size. Deciding by magnitude
  // (v > 1) would silently turn a real 0.9% into 90%.
  const val = (t) => {
    if (t === "-" || t == null) return null;
    if (/%$/.test(String(t))) {
      const n = parseFloat(String(t));
      return Number.isFinite(n) ? n / 100 : null;
    }
    return toNum(t);
  };

  let sawHeaderSig = false;
  let storeName = null;
  let curName = null;
  let pendingFrags = [];
  const people = {};       // norm(name) -> { displayName, sources }
  const order = [];
  const pairings = [];

  const commitName = () => {
    if (!pendingFrags.length) return;
    const nm = pendingFrags.join(" ").replace(/\s+/g, " ").trim();
    pendingFrags = [];
    if (!nm) return;
    if (!storeName) { storeName = nm; curName = null; return; }
    curName = nm;
    const k = norm(nm);
    if (!people[k]) { people[k] = { displayName: nm, sources: {} }; order.push(k); }
  };

  for (const L of lines) {
    const texts = L.parts.map((p) => p.str.split(/\s+/)).flat().filter(Boolean);
    if (!texts.length) continue;
    const joined = squashT(texts.join(""));
    if (joined.includes("unsoldin") || joined.includes("bebacks")) sawHeaderSig = true;
    const rowTag = texts[0];

    // A data row ends the header block, so commit whatever name accumulated.
    if (DS_SOURCES.includes(rowTag) || DS_VEHICLE.includes(rowTag)) {
      commitName();
      if (DS_VEHICLE.includes(rowTag)) continue;          // vehicle-type: ignored
      const nums = texts.slice(1).filter(isNum);
      if (nums.length < 6) continue;
      if (!curName) continue;                             // store block: not a person
      const k = norm(curName);
      if (!people[k]) { people[k] = { displayName: curName, sources: {} }; order.push(k); }
      people[k].sources[rowTag.toLowerCase()] = nums.slice(0, 6).map(val);
      continue;
    }

    // Header line: strip the column vocabulary, whatever survives is a name
    // fragment. The name spans up to three lines, so fragments accumulate.
    // Lines BEFORE the first header block (report title, date range) carry no
    // column vocabulary at all — skip them, or they glue onto the store name.
    const nonNum = texts.filter((t) => !isNum(t) && t !== "%");
    if (!nonNum.length) continue;
    const hasVocab = vocabCountWith(DS_VOCAB, nonNum) >= 1;
    if (!hasVocab && !sawHeaderSig) continue;             // pre-header preamble
    const frag = stripVocabWith(DS_VOCAB, nonNum);
    if (frag.length) pendingFrags.push(frag.join(" "));
  }
  commitName();

  if (!sawHeaderSig || order.length < 3) return null;

  const header = ["Name","Opportunities","Units Delivered","Delivered %",
    "internetUnits","internetPct","phoneUnits","phonePct",
    "showroomUnits","showroomPct","campaignUnits",
    "internetLeads","phoneLeads","showroomLeads",
    "showroomUps","showroomUnsold","showroomBeBacks"];
  const rows = [["Delivery Summary"], header];

  for (const k of order) {
    const p = people[k];
    const s = p.sources;
    const pick = (src, i) => (s[src] ? s[src][i] : null);
    // val() already returns percentages as a fraction, matching what the old
    // CSV stored with Round % switched off.
    const pctOf = (src) => pick(src, 5);
    const internetLeads = pick("internet", 0);
    const internetDel   = pick("internet", 4);
    rows.push([
      p.displayName,
      internetLeads,                   // Opportunities (drives lead standards)
      internetDel,                     // Units Delivered
      pctOf("internet"),               // Delivered %
      internetDel,  pctOf("internet"),
      pick("phone", 4),    pctOf("phone"),
      pick("showroom", 4), pctOf("showroom"),
      pick("campaign", 4),             // campaign: units only, never graded
      internetLeads,                   // internetLeads  (Net Opportunities per channel)
      pick("phone", 0),                // phoneLeads
      pick("showroom", 0),             // showroomLeads
      pick("showroom", 1),             // Total Ups          (showroom-only)
      pick("showroom", 2),             // Unsold In Showroom (showroom-only)
      pick("showroom", 3),             // Be Backs           (showroom-only)
    ]);
    pairings.push({
      name: p.displayName,
      internet: s.internet
        ? `${pick("internet",0)} leads / ${internetDel} delivered / ${
            pctOf("internet") == null ? "-" : (pctOf("internet") * 100).toFixed(1) + "%"}`
        : "-",
      showroom: s.showroom
        ? `${pick("showroom",0)} leads / ${pick("showroom",4)} delivered`
        : "-",
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

/* Read, change, write, but only if nobody moved it underneath us.
   The browsers now guard their saves with a revision number; this has to play the
   same game or an import would quietly overwrite a manager's work, which is the
   very failure this is meant to end. */
async function sbSwap(key, apply, tries = 5) {
  const { url, key: k } = SB();
  for (let attempt = 0; attempt < tries; attempt++) {
    const cur = await sbGet(key);
    if (!cur) return { ok: false, why: "row does not exist" };
    const rev = Number(cur.rev) || 0;
    const next = { ...apply(cur), rev: rev + 1 };
    const q = `${url}/rest/v1/app_data?key=eq.${encodeURIComponent(key)}&value->>rev=eq.${rev}`;
    const r = await fetch(q, {
      method: "PATCH",
      headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json",
        Prefer: "return=representation" },
      body: JSON.stringify({ value: next }),
    });
    if (!r.ok) throw new Error(`supabase swap ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    if (rows.length) return { ok: true, rev: next.rev, attempts: attempt + 1 };
    await new Promise((res) => setTimeout(res, 120 * (attempt + 1)));
  }
  return { ok: false, why: "row kept changing under the import" };
}

/* ---------- split activity rows ----------
   Activity is written one row per day so the hourly import stops competing with
   managers for a single document. The import touches today only, so it writes one
   small row instead of rewriting an entire store. The embedded copy is kept in step
   as well, until every browser is reading split rows. */
const actKey = (storeId, day) => `lpc:store:${storeId}:act:${day}`;

async function sbPutActivityDay(storeId, day, rows) {
  await sbPut(actKey(storeId, day), rows);
}

/* ---------- the TV board row ----------
   The board on the wall reads its own sanitized row, and until now only a
   browser ever wrote it. That meant every screen sat on figures from the last
   time a manager happened to save something, while the hourly import quietly
   moved the real numbers underneath. The import refreshes it now.

   Branding, thresholds and display tuning are left exactly as the app
   published them: this only replaces the parts that come from the data, so
   there is no second copy of the app's styling rules to drift out of step. */
const BOARD_STAT_FIELDS = ["internetUnits", "internetPct", "phoneUnits", "phonePct",
  "showroomUnits", "showroomPct", "campaignUnits", "prevPct", "prevUnits"];

async function refreshBoardRow(storeId, sdata) {
  const boardKey = `lpc:board:${storeId}:v1`;
  const prev = await sbGet(boardKey);
  // No row yet means the board has never been opened for this store. Creating a
  // half-formed one here would put an unbranded board on a wall, so leave it.
  if (!prev) return { published: false, why: "no board row yet; open The Board once from the tool" };

  const month = ymET();
  const src = ((sdata && sdata.months) || {})[month]?.stats || {};
  const gone = new Set((((sdata && sdata.departed) || [])).map((x) => norm(x.name)));
  const onBoard = new Set((prev.roles || []).map((r) => r.id));
  const stats = {}; const roster = [];

  for (const a of (sdata && sdata.roster) || []) {
    if (!a.roleId || !onBoard.has(a.roleId)) continue;
    if (gone.has(norm(a.name))) continue;
    roster.push({ name: a.name, roleId: a.roleId });
    const s = src[norm(a.name)];
    if (!s) continue;
    const keep = {};
    for (const f of BOARD_STAT_FIELDS) if (s[f] !== undefined) keep[f] = s[f];
    stats[norm(a.name)] = keep;
  }

  await sbPut(boardKey, {
    ...prev,
    ym: month,
    roster,
    departed: [...gone],
    boardDisplay: (sdata && sdata.boardDisplay) || prev.boardDisplay || null,
    months: { [month]: { stats } },
    updatedAt: new Date().toISOString(),
  });
  return { published: true, people: roster.length };
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
  // Roll-up rows that are not people, plus anyone who has left the store. Both
  // have to be kept out or the import quietly puts them back on the roster.
  const excludedSet = new Set([
    ...(next.excluded || []).map(norm),
    ...((next.departed || []).map((x) => norm(x.name))),
  ]);
  const results = [];

  const snapCopy = JSON.parse(JSON.stringify({
    roster: next.roster, months: next.months, activity: next.activity,
    plates: next.plates, restrictions: next.restrictions, aliases: next.aliases,
    stars: next.stars, goals: next.goals, baselines: next.baselines, qualified: next.qualified,
    repeatFlags: next.repeatFlags, excluded: next.excluded, departed: next.departed,
    daysOff: next.daysOff, daysOffAt: next.daysOffAt,
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

  const nowISO = new Date().toISOString();
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
      // NOTE: month-level totals are deliberately NOT stamped here. This report
      // is one day's pull, and stamping it as the month would overwrite a real
      // whole-month figure with a single day's number every hour.

      // The activity report is a running daily total, so two pulls an hour apart
      // describe that hour. Keeping every import lets the app difference them into
      // hourly buckets. Only meaningful once the report is scheduled more than
      // once a day; before that there is one snapshot and no hour to derive.
      next.activitySnaps = next.activitySnaps || {};
      const snapRows = {};
      for (const [key, r] of Object.entries(next.activity[actDay])) {
        snapRows[key] = {
          calls: r.calls, contacted: r.contacted, video: r.video, text: r.text,
          email: r.email, apptScheduled: r.apptScheduled, apptShow: r.apptShow,
          tasks: r.tasks, units: r.units,
        };
      }
      const daySnaps = (next.activitySnaps[actDay] || []).filter((x) => x.t !== nowISO);
      daySnaps.push({ t: nowISO, rows: snapRows });
      next.activitySnaps[actDay] = daySnaps.slice(-16);
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

/* Match a store name read out of a PDF against the configured stores.

   Exact equality was too brittle to trust. A PDF heading picks up whatever the
   layout puts next to it — a stray first name, a suffix, a line break landing in
   an awkward place — and one contaminated character meant an entire day's report
   was thrown away. A configured store name that the parsed heading BEGINS with is
   a match, longest name winning so "Driver's Mart Winter Park" is never beaten by
   a shorter store that happens to share a prefix. */
function matchStoreByName(stores, parsedName) {
  const P = squash(parsedName);
  if (!P) return null;
  let best = null;
  const consider = (s, cand, quality) => {
    if (!cand) return;
    if (!best || cand.length > best.len) best = { store: s, len: cand.length, quality };
  };
  for (const s of stores || []) {
    for (const cand of [squash(s.name), squash(s.id)]) {
      if (!cand) continue;
      if (P === cand) { consider(s, cand, "exact"); continue; }
      // the heading carries the store name plus something extra
      if (P.startsWith(cand) && cand.length >= 6) { consider(s, cand, "prefix"); continue; }
      // the heading was truncated, but is long enough to be unambiguous
      if (cand.startsWith(P) && P.length >= 10) consider(s, cand, "truncated");
    }
  }
  return best ? { store: best.store, quality: best.quality } : null;
}

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
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if ((req.headers["x-ingest-secret"] || "") !== process.env.INGEST_SECRET) {
    return res.status(401).json({ ok: false, error: "bad secret" });
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
    // Mail with no report attached is not a failure; nothing was expected of it.
    if (!csvs.length && !pdfs.length) {
      return res.status(200).json({ ok: true, skipped: "no CSV or PDF attachment" });
    }

    const entries = [];
    const skippedFiles = [];
    const pdfReads = [];
    // Anything that parsed cleanly and then had nowhere to go. This is the case
    // that used to answer 200 and disappear, taking a whole day's report with it.
    const failures = [];

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
    // suspect and NOTHING is written — but it is now reported as a failure
    // rather than being buried in a 200.
    for (const a of pdfs) {
      try {
        const lines = await extractPdfLines(Buffer.from(a.content));

        // Try both mappers; each returns null unless the layout truly matches.
        let mapped = null, kind = null, pairings = null;
        const ds = mapDeliverySummaryGrid(lines);
        if (ds) { mapped = ds; kind = "delivery-summary"; pairings = ds.pairings; }
        if (!mapped) {
          const da = mapDailyActivityGrid(lines);
          if (da) { mapped = da; kind = "activity"; }
        }

        if (mapped) {
          const hit = matchStoreByName(cfg?.stores, mapped.storeName);
          if (!hit) {
            const note = `parsed store "${mapped.storeName}" matches no store; nothing written`;
            pdfReads.push({ file: a.filename, mapped: false, kind, note,
              parsedPeople: mapped.rows.slice(2).map((r) => r[0]) });
            failures.push({ file: a.filename, why: note });
            continue;
          }
          store = hit.store;
          entries.push({ rows: mapped.rows, type: kind, fileName: a.filename || "email.pdf",
            actDay: kind === "activity"
              ? (activityDateFrom(a.filename) || activityDateFrom(subject))
              : null });
          const read = { file: a.filename, kind, store: mapped.storeName,
            matchedStore: hit.store.id, matchQuality: hit.quality,
            people: mapped.rows.length - 2, mapped: true,
            names: mapped.rows.slice(2).map((r) => r[0]) };
          // VERIFY on the first Delivery Summary import: this is the
          // name-to-numbers pairing, the one thing that can go wrong silently.
          if (pairings) read.pairings = pairings.slice(0, 12);
          pdfReads.push(read);
        } else {
          // Forty bare lines was not enough to work out what an unknown layout is:
          // no column headings, no idea how many values a row carries, no sense of
          // where anything sits. This dumps more of the page and keeps the x of each
          // fragment, which is what tells a name apart from a column of figures.
          const dbg = [];
          for (const L of lines.slice(0, 120)) {
            dbg.push(L.parts.map((p) => `${p.str}@${Math.round(p.x)}`).join(" | "));
          }
          const note = "PDF layout not recognized; nothing written";
          pdfReads.push({ file: a.filename, mapped: false, note,
            pages: lines.length ? lines[lines.length - 1].pg : 0,
            lineCount: lines.length, debugLines: dbg });
          failures.push({ file: a.filename, why: note });
        }
      } catch (e) {
        const why = "PDF read failed: " + String(e.message || e);
        skippedFiles.push({ file: a.filename, why });
        failures.push({ file: a.filename, why });
      }
    }

    // From here on, every exit that writes nothing answers with a failing status
    // and ok:false, so the Cloudflare worker records an error and the run shows
    // up red instead of blending into the successes.
    if (!store) {
      const why = `no store matches address "${to}" or any PDF header`;
      console.error("ingest:", why);
      return res.status(422).json({ ok: false, error: why, failures, skippedFiles, pdfReads });
    }
    if (!entries.length) {
      const why = "nothing in this message could be read as a report";
      console.error("ingest:", why, JSON.stringify(skippedFiles));
      return res.status(422).json({ ok: false, error: why, failures, skippedFiles, pdfReads });
    }

    const key = `lpc:store:${store.id}:v2`;
    const data = await sbGet(key);
    if (!data) {
      const why = `store ${store.id} has no data document yet`;
      console.error("ingest:", why);
      return res.status(422).json({ ok: false, error: why, failures, skippedFiles, pdfReads });
    }
    // Apply inside the swap, so a retry re-applies to whatever the row now holds
    // rather than replaying against the copy we first read.
    let next = null, lastResults = [];
    const swap = await sbSwap(key, (cur) => {
      const out = applyToStore(cur, entries, "Auto-import (email)");
      next = out.next; lastResults = out.results;
      return out.next;
    });
    if (!swap.ok) {
      const why = `could not write ${store.id}: ${swap.why}`;
      console.error("ingest:", why);
      return res.status(409).json({ ok: false, error: why, failures, skippedFiles, pdfReads });
    }

    // The day rows the import just touched, each written on its own. A failure here
    // is worth reporting but not worth failing the import: the same data is in the
    // document that was just written successfully.
    const dayWrites = [];
    for (const r of results) {
      if (r.type !== "activity" || !r.day) continue;
      const rows = next && next.activity && next.activity[r.day];
      if (!rows) continue;
      try { await sbPutActivityDay(store.id, r.day, rows); dayWrites.push(r.day); }
      catch (e) { console.error("ingest: day row write failed", store.id, r.day, String(e.message || e)); }
    }
    const results = lastResults;

    // Push the fresh figures to the wall. A board that cannot be refreshed must
    // not sink the import that already succeeded, so this is reported, not thrown.
    let board;
    try {
      board = await refreshBoardRow(store.id, next);
    } catch (e) {
      board = { published: false, why: String(e.message || e) };
      console.error("ingest: board refresh failed for", store.id, board.why);
    }

    // Some files landed and others did not. The import stands, but the message
    // says so out loud rather than reporting a clean success.
    if (failures.length) {
      console.error("ingest: partial success for", store.id, JSON.stringify(failures));
      return res.status(422).json({ ok: false, error: "some attachments could not be filed",
        store: store.id, results, board, failures, skippedFiles, pdfReads });
    }

    return res.status(200).json({ ok: true, store: store.id, results, board, dayWrites, skippedFiles, pdfReads });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

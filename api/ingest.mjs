/* =========================================================================
   LPC automated report ingest — Vercel serverless function
   POST /api/ingest  (from the Cloudflare Email Worker)
   Auth: x-ingest-secret header must equal process.env.INGEST_SECRET.
   ========================================================================= */

import PostalMime from "postal-mime";
import Papa from "papaparse";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
/* The reader for the scheduled reports. Shared verbatim with the app, which
   reads the same PDFs when a manager drops one in by hand — see the note at the
   top of that file for what living as two copies cost. */
import {
  norm, toNum, squashT,
  detectReportType, parseReport, parseDeliverySummaryRows,
  mapDailyActivityGrid, mapDeliverySummaryGrid, matchStoreByName,
} from "./_report-parsers.mjs";
/* Where a store's figures live and which of them travel, shared with the app for
   the same reason the reader is: both sides write these rows, and a field list
   that drifts writes a row of the right shape in the right place with one column
   missing, and says nothing at all. */
import {
  storeKey, actKey, floorStatsKey, boardKey,
  BOARD_STAT_FIELDS, slimFloorStats,
} from "./_store-keys.mjs";
/* A person's standing at a store, shared with the app so an import and a screen
   cannot disagree about who this store's people are. */
import { admitsEveryone, holdPerson } from "./_people-status.mjs";
import { supabaseUrl } from "./_env.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
try {
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");
} catch (e) { /* bundled include covers it */ }

export const config = { api: { bodyParser: false } };

const uid = () => Math.random().toString(36).slice(2, 10);
const TZ = "America/New_York";
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const ymET = () => todayET().slice(0, 7);

/* ---------- shared PDF line extraction ---------- */
async function extractPdfLines(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let items = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5], w: it.width || 0, pg: pn });
    }
  }
  items.sort((a, b) => a.pg - b.pg || a.y - b.y || a.x - b.x);
  /* Ligatures come back as their own text runs. A name set with "ff" or "fi" in it
     arrives as three pieces sitting flush against each other, so "Jeffrey Berlan"
     reads as "Je ff rey Berlan" and stops matching the roster. The gap between two
     pieces is what separates a real space from a ligature seam: touching pieces are
     one word, pieces with air between them are two. */
  const glued = [];
  for (const it of items) {
    const p = glued[glued.length - 1];
    const touching = p && p.pg === it.pg && Math.abs(p.y - it.y) < 2 && (it.x - (p.x + p.w)) < 0.9;
    if (touching) { p.str += it.str; p.w = (it.x + it.w) - p.x; }
    else glued.push({ ...it });
  }
  items = glued;
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && L.pg === it.pg && Math.abs(L.y - it.y) < 4) L.parts.push(it);
    else lines.push({ pg: it.pg, y: it.y, parts: [it] });
  }
  return lines;
}


/* Some rows print the name twice, so the pieces assemble into "Peter Tran Peter
   Tran". The key built from that matches nobody on the roster and the person shows
   up with no data at all. If the second half of a name is the first half repeated,
   it is one name that was printed twice, not two people. */



/* =========================================================================
   PDF #1: Daily Activity grid.
   ========================================================================= */


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



/* Delivery Summary rows are pre-shaped, so they bypass parseReport(). */

function activityDateFrom(name) {
  const s = String(name || "");
  let m = s.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/* ---------- Supabase (PostgREST, service role) ---------- */
const SB = () => ({ url: supabaseUrl(), key: process.env.SUPABASE_SERVICE_ROLE_KEY });
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
    // A row written before revisions existed has no rev, and in SQL a missing value
    // matches nothing, so eq.0 can never hit those rows. Match on it being absent
    // the first time; from then on it carries one.
    const revFilter = (cur.rev == null) ? "value->>rev=is.null" : `value->>rev=eq.${rev}`;
    const q = `${url}/rest/v1/app_data?key=eq.${encodeURIComponent(key)}&${revFilter}`;
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

async function sbPutActivityDay(storeId, day, rows) {
  await sbPut(actKey(storeId, day), rows);
}

/* The same figures again, under the board prefix, which is the only thing a phone
   with no account can read. Without this a salesperson can never see their own day:
   the store rows require a signed-in session and a sign-in page has none. Counts
   only, one day, for the people on the floor. */
async function sbPutFloorStats(storeId, day, rows) {
  await sbPut(floorStatsKey(storeId, day), slimFloorStats(rows));
}

/* ---------- the TV board row ----------
   The board on the wall reads its own sanitized row, and until now only a
   browser ever wrote it. That meant every screen sat on figures from the last
   time a manager happened to save something, while the hourly import quietly
   moved the real numbers underneath. The import refreshes it now.

   Branding, thresholds and display tuning are left exactly as the app
   published them: this only replaces the parts that come from the data, so
   there is no second copy of the app's styling rules to drift out of step. */
async function refreshBoardRow(storeId, sdata) {
  const prev = await sbGet(boardKey(storeId));
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

  await sbPut(boardKey(storeId), {
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
    plates: next.plates, restrictions: next.restrictions,
    /* The folds and both of their stamps. Without the stamps a restore puts the
       aliases back and loses the record of which ones somebody had undone. */
    aliases: next.aliases, aliasesAt: next.aliasesAt, aliasesGone: next.aliasesGone,
    stars: next.stars, goals: next.goals, baselines: next.baselines, qualified: next.qualified,
    excluded: next.excluded, departed: next.departed,
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
    /* ---- Nobody joins this store's books by turning up in a file ----
       The same gate as the app's, and the one that matters more: this is the
       path the reports actually arrive by, and nobody re-imports by hand. An
       unrecognised name is held with its figures parked exactly as they came,
       and folded in the moment a manager says the person works here. A store
       with nobody on it yet takes the lot, because that is its first import. */
    const openDoor = admitsEveryone(next);
    const knownHere = new Set([
      ...(next.roster || []).map((a) => norm(a.name)),
      ...(next.departed || []).map((d) => norm(d && d.name)),
    ]);
    let heldCount = 0;
    if (!openDoor) {
      for (const key of Object.keys(parsed)) {
        if (knownHere.has(key)) continue;
        const rec = parsed[key];
        heldCount++;
        /* Parked in the shape it would have been written in. A day report and a
           month report do not use the same field names, and parking one as the
           other would hand somebody back an empty week. */
        holdPerson(next, rec.displayName || key, type === "activity"
          ? { day: actDay, dayRow: {
              displayName: rec.displayName,
              calls: rec.actCalls, video: rec.actVideo, contacted: rec.actCallContacted,
              text: rec.actText, email: rec.actEmail, apptCreated: rec.actApptCreated,
              apptShow: rec.actApptShow, opps: rec.actOppsTotal, tasks: rec.actCompletedTasks,
              tasksPosted: rec.actOpenTasks ?? null,
              sold: rec.actSold, units: rec.actUnits,
              oppShowroom: rec.actOppShowroom, oppPhone: rec.actOppPhone,
              oppInternet: rec.actOppInternet, oppCampaign: rec.actOppCampaign,
              apptScheduled: rec.actApptScheduled, apptConfirmed: rec.actApptConfirmed,
              apptNoShow: rec.actApptNoShow, visits: rec.actVisits,
              uploadedAt: nowISO,
            }, at: nowISO, file: fileName }
          : { monthKey: month, rec, at: nowISO, file: fileName });
        delete parsed[key];
      }
    }

    M.names[type] = Object.keys(parsed);
    /* The combined Delivery Summary already ticks every per-channel box in
       M.imports. It never did the same for M.names, and M.names is what the
       per-associate "incomplete file" check reads. So for every store on the PDF
       rather than the per-channel CSVs, the delivery half of that check has been
       silently skipped: names.delivery was never written, so delivery never
       counted as a required report for anybody. Write it here too. */
    if (type === "delivery-summary") M.names.delivery = Object.keys(parsed);
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
          visits: rec.actVisits,
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

    // Only a store with nobody on it yet reaches this; everyone else's unknown
    // names were held above.
    if (openDoor) {
      const rosterKeys = new Set(next.roster.map((a) => norm(a.name)));
      for (const [key, rec] of Object.entries(parsed)) {
        if (excludedSet.has(key) || rosterKeys.has(key)) continue;
        next.roster.push({ id: uid(), name: rec.displayName, roleId: null, order: next.roster.length });
        rosterKeys.add(key);
      }
    }
    results.push({ file: fileName, type, day: type === "activity" ? actDay : day, count, skipped, held: heldCount });
  }
  return { next, results };
}

/* ---------- routing helpers ---------- */

/* Match a store name read out of a PDF against the configured stores.

   Exact equality was too brittle to trust. A PDF heading picks up whatever the
   layout puts next to it — a stray first name, a suffix, a line break landing in
   an awkward place — and one contaminated character meant an entire day's report
   was thrown away. A configured store name that the parsed heading BEGINS with is
   a match, longest name winning so "Driver's Mart Winter Park" is never beaten by
   a shorter store that happens to share a prefix. */
/* One group per store, in the order the stores were first seen. Every entry has
   to carry its own store by the time it gets here — an entry that does not know
   where it belongs has no safe place to go. */
export function groupByStore(entries) {
  const byStore = new Map();
  for (const e of entries || []) {
    if (!e || !e.store || !e.store.id) continue;
    if (!byStore.has(e.store.id)) byStore.set(e.store.id, { store: e.store, entries: [] });
    byStore.get(e.store.id).entries.push(e);
  }
  return byStore;
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
    const slug = squashT(local.replace(/^lpc-?/, ""));
    const cfg = await sbGet("lpc:config:v2");
    /* The store the ADDRESS names, and nothing else may change it. It used to be
       the same variable the PDF loop assigned to, so the last PDF in a message
       silently became the store for everything in that message. */
    const addressStore = (cfg?.stores || []).find((s) => squashT(s.name) === slug || squashT(s.id) === slug) || null;

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
      /* A CSV names no store anywhere inside it, so the only thing that can place
         it is the address it was sent to. It used to be placed by whichever PDF
         happened to be read after it, which is how one store's figures ended up
         filed under another's name. Unplaceable is now refused rather than
         guessed: a report in the wrong store is worse than a report nowhere. */
      if (!addressStore) {
        const why = "a CSV names no store, and this address names no store either. Send it to that store's own address";
        skippedFiles.push({ file: a.filename, why });
        failures.push({ file: a.filename, why });
        continue;
      }
      entries.push({ store: addressStore, rows, type, fileName: a.filename || "email.csv",
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
          entries.push({ store: hit.store, rows: mapped.rows, type: kind, fileName: a.filename || "email.pdf",
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
          /* Park the dump somewhere it can be read later. The worker logs the first
             2000 characters of this response and no more, and these reports are sent
             to the worker address rather than to a person, so an unrecognised layout
             used to be diagnosable only in the minutes before the log rolled and only
             if somebody happened to be looking. Writing the geometry down is what
             makes the mapper writable at all: 120 lines with the x of every fragment
             is what separates a name from a column of figures.
             Best effort by design. A diagnostic that can fail an import is worse than
             no diagnostic. */
          try {
            const dkey = "lpc:config:unparsed:v1";
            const prev = (await sbGet(dkey)) || {};
            const items = Array.isArray(prev.items) ? prev.items : [];
            /* The stored copy keeps far more than the 120 lines the HTTP response
               carries, and keeps the page and y of every line. Two things were
               missing from the first real capture and both need the extra reach:
               a header row naming the columns, which may sit on a later page or be
               repeated per page, and enough of the document to prove whether the
               figures belong to the name above them or the name below. Getting that
               pairing wrong shifts every person's numbers by one, silently, which is
               worse than declining the report. */
            await sbPut(dkey, { items: [{
              at: new Date().toISOString(),
              file: a.filename || "email.pdf",
              subject, to,
              pages: lines.length ? lines[lines.length - 1].pg : 0,
              lineCount: lines.length,
              debugLines: dbg,
              fullDump: lines.slice(0, 900).map((L) =>
                `p${L.pg} y${Math.round(L.y)}  ` +
                L.parts.map((pt) => `${pt.str}@${Math.round(pt.x)}`).join(" | ")),
            }, ...items].slice(0, 4) });
          } catch (e) { console.error("ingest: could not store the unparsed dump", String(e.message || e)); }
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
    if (!entries.length) {
      const why = failures.length
        ? "nothing in this message could be filed"
        : `no store matches address "${to}" or any PDF header`;
      console.error("ingest:", why, JSON.stringify(skippedFiles));
      return res.status(422).json({ ok: false, error: why, failures, skippedFiles, pdfReads });
    }

    /* Each attachment is filed under the store IT names, and a message carrying
       two stores' reports writes to both.

       This used to be one store and one list. Every attachment's rows went into
       the same list, and whichever PDF was read last decided where the whole lot
       went — so a message with two dealerships in it put both under one name, and
       a CSV (which names no store anywhere inside it) followed whatever PDF
       happened to come after it. The figures were real, complete and filed under
       somebody else's dealership, which is the worst shape a wrong number can
       take: nothing about it looks wrong. */
    const byStore = groupByStore(entries);

    const stores = [];
    for (const { store: st, entries: mine } of byStore.values()) {
      const key = storeKey(st.id);
      const data = await sbGet(key);
      if (!data) {
        const why = `store ${st.id} has no data document yet`;
        console.error("ingest:", why);
        failures.push({ file: mine.map((e) => e.fileName).join(", "), why });
        continue;
      }
      // Apply inside the swap, so a retry re-applies to whatever the row now holds
      // rather than replaying against the copy we first read.
      let next = null, lastResults = [];
      const swap = await sbSwap(key, (cur) => {
        const out = applyToStore(cur, mine, "Auto-import (email)");
        next = out.next; lastResults = out.results;
        return out.next;
      });
      if (!swap.ok) {
        const why = `could not write ${st.id}: ${swap.why}`;
        console.error("ingest:", why);
        failures.push({ file: mine.map((e) => e.fileName).join(", "), why });
        continue;
      }
      const results = lastResults;

      // The day rows the import just touched, each written on its own. A failure here
      // is worth reporting but not worth failing the import: the same data is in the
      // document that was just written successfully.
      const dayWrites = [];
      for (const r of results) {
        if (r.type !== "activity" || !r.day) continue;
        const rows = next && next.activity && next.activity[r.day];
        if (!rows) continue;
        try {
          await sbPutActivityDay(st.id, r.day, rows);
          await sbPutFloorStats(st.id, r.day, rows);
          dayWrites.push(r.day);
        } catch (e) { console.error("ingest: day row write failed", st.id, r.day, String(e.message || e)); }
      }

      // Push the fresh figures to the wall. A board that cannot be refreshed must
      // not sink the import that already succeeded, so this is reported, not thrown.
      let board;
      try {
        board = await refreshBoardRow(st.id, next);
      } catch (e) {
        board = { published: false, why: String(e.message || e) };
        console.error("ingest: board refresh failed for", st.id, board.why);
      }
      stores.push({ store: st.id, results, board, dayWrites });
    }

    if (!stores.length) {
      const why = "every attachment was refused; nothing was written";
      console.error("ingest:", why, JSON.stringify(failures));
      return res.status(422).json({ ok: false, error: why, stores, failures, skippedFiles, pdfReads });
    }

    // Some files landed and others did not. The import stands, but the message
    // says so out loud rather than reporting a clean success.
    if (failures.length) {
      console.error("ingest: partial success", JSON.stringify(failures));
      return res.status(422).json({ ok: false, error: "some attachments could not be filed",
        stores, failures, skippedFiles, pdfReads });
    }

    return res.status(200).json({ ok: true, stores, skippedFiles, pdfReads });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

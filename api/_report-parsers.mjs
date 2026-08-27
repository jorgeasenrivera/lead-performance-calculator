/**
 * Reading the scheduled reports.
 * -------------------------------------------------------------------------
 * One copy, imported by both the pipeline that reads the emailed reports and
 * the app that reads a PDF a manager drops in by hand.
 *
 * It was two copies for a long time, with a comment in the app promising they
 * were the same. They were not, and the ways they differed only ever showed up
 * in production:
 *
 *   the app learned the word "Visit" when the column was added; the pipeline
 *   did not, so every emailed activity report arrived with the column heading
 *   welded into somebody's name and the store's name too, matching no store,
 *   and the whole file was refused
 *
 *   the app learned that DriveCentric prints "?" in App Confirmed where the
 *   figure does not apply; the pipeline did not, so the store row fell a token
 *   short, was skipped, and the first salesperson was read as the store
 *
 *   the app read the per-channel lead counts and four spellings of the
 *   appointment-show column; the pipeline read neither, and quietly dropped
 *   both from every emailed CSV
 *
 * Nobody re-imports by hand, so the copy that was wrong was the copy that
 * mattered. The point of this file is that there is now nowhere for the two to
 * drift apart to.
 *
 * Nothing here touches a network, a database or a browser API, which is what
 * lets both sides import it and what makes it testable on its own.
 */

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* ---------------- CSV parsing ---------------- */

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

const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(/[$,%]/g, ""));
  return isNaN(n) ? null : n;
};

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
        rec.internetLeads = rec.opps;
      } else if (channel === "campaign") {
        // units only, on purpose. No pct is stored, so nothing can accidentally grade it.
        rec.campaignUnits = units;
        rec.campaignLeads = toNum(row[idx("Opportunities")]);
      } else {
        rec[channel + "Units"] = units;
        rec[channel + "Pct"] = dpct;
        rec[channel + "Leads"] = toNum(row[idx("Opportunities")]);
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
      rec.actApptShow = toNum(row[idx("Show")]) ?? toNum(row[idx("Total Show")]) ?? toNum(row[idx("Appt Show")]) ?? toNum(row[idx("Shown")]);
      rec.actOppsTotal = toNum(row[idx("Total")]);
      rec.actCompletedTasks = toNum(row[idx("Completed Tasks")]);
      /* Visits: customers this person was credited with seeing that day. It is the
         only figure in any export that credits a SECOND salesperson on a walk-in —
         DriveCentric's deal notification names the primary and nobody else — so it
         is the one place a co-sold up leaves a trace at all. */
      rec.actVisits = toNum(row[idx("Visit")]) ?? toNum(row[idx("Visits")]);
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

const squashT = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Some rows print the name twice, so the pieces assemble into "Peter Tran Peter
   Tran". The key built from that matches nobody on the roster and the person shows
   up with no data at all. If the second half of a name is the first half repeated,
   it is one name that was printed twice, not two people. */
function dedupeName(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return t;
  const w = t.split(" ");
  if (w.length >= 2 && w.length % 2 === 0) {
    const half = w.length / 2;
    if (w.slice(0, half).join(" ").toLowerCase() === w.slice(half).join(" ").toLowerCase()) {
      return w.slice(0, half).join(" ");
    }
  }
  // also catches a single word doubled with no space, e.g. "LetitiaLetitia"
  const m = t.match(/^(.{3,})\1$/i);
  return m ? m[1].trim() : t;
}

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
  "completed","totaldelivered","totalclosing","total","delivered","closing",
  /* Added to the export later. It has to be in here as well as in the columns
     below: a name is whatever is LEFT of a header line after the vocabulary is
     struck out, so a column word missing from this list becomes part of every
     salesperson's name. */
  "visit","visits"]);

function mapDailyActivityGrid(lines) {
  /* Same decimal fix as the Delivery Summary: Units Delivered carries half credit
     on split deals, and one dropped token knocks the whole row out.

     "?" belongs in here for a harder reason. DriveCentric prints it in App
     Confirmed wherever the figure is not applicable, and the STORE row carries
     one on most days. Without it that row fell one token short, was skipped, and
     the first salesperson's row was taken for the store instead — so the store
     came through named "Holler Ford Fin Smith", Fin vanished from the report
     entirely, and every later person carrying a "?" was dropped in a way that
     welded their name onto the next one: "Luke Pancake Mike Ganus", one person,
     nobody's numbers. All of it silent. */
  const isNum = (t) => /^[\d,]+(?:\.\d+)?$/.test(t) || t === "-" || t === "?" || t === "∞" || /^\d+(?:\.\d+)?%$/.test(t);
  const val = (t) => (t === "-" || t === "?" || t === "∞" || t == null) ? null : toNum(t);

  let storeName = null, sawHeaderSig = false;
  let nameParts = [];
  // Some exports print the first person's name in the same block as the store
  // heading. Those fragments get carried to the next data row instead of being
  // swallowed, which is what used to drop that person from the whole report.
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
      let nm = dedupeName(parts.join(" "));
      nameParts = [];
      /* Twenty since Visit was added to the export, nineteen before it. Both are
         read rather than one being demanded, so a store still on the older report
         keeps importing exactly as it did. */
      const v = nums.slice(0, 20).map(val);
      if (!storeName) {
        if (!nm) continue;
        storeName = nm;
        storeParts = parts;
        // anything past the first fragment may belong to a person, not the store
        if (parts.length > 1) pendingName = dedupeName(parts.slice(1).join(" "));
        continue;
      }
      // A data row with no name of its own is the tell: its name was absorbed into
      // the store heading above. Give it back, and trim the store name to match.
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
    "Personalized Video","Open Tasks","Completed Tasks","Units Delivered","Visit"];
  const rows = [["Daily Activity"], header];
  for (const p of Object.values(people)) {
    const c = p.cols;
    rows.push([p.displayName, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8],
      c[9], c[10], c[11], c[12], c[13], c[15], c[16], c[17],
      /* Visit sits past Total Closing %, so it is only there on the newer export.
         Absent, it stays null rather than becoming a zero — nobody logged no
         visits, the report simply did not say. */
      c.length > 19 ? c[19] : null]);
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
  /* DriveCentric prints its own totals in a block above the people, under the
     store's name. They were read and thrown away, which meant the one number
     the report is authoritative about -- how many units the store delivered --
     was the one number the app could not quote back. Kept now, so the board can
     be checked against the report it came from instead of against memory. */
  const storeSources = {};
  let curName = null;
  let pendingFrags = [];
  const people = {};       // norm(name) -> { displayName, sources }
  const order = [];
  const pairings = [];

  const commitName = () => {
    if (!pendingFrags.length) return;
    const nm = dedupeName(pendingFrags.join(" "));
    pendingFrags = [];
    if (!nm) return;
    if (!storeName) { storeName = nm; curName = null; return; }
    curName = nm;
    const k = norm(nm);
    if (!people[k]) { people[k] = { displayName: nm, sources: {}, vehicles: {} }; order.push(k); }
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
      const nums = texts.slice(1).filter(isNum);
      if (nums.length < 6) continue;
      const k = curName ? norm(curName) : null;
      if (k && !people[k]) { people[k] = { displayName: curName, sources: {}, vehicles: {} }; order.push(k); }
      if (k) people[k].vehicles = people[k].vehicles || {};
      const vals = nums.slice(0, 6).map(val);
      if (!curName) { storeSources[rowTag.toLowerCase()] = vals; continue; }
      /* The New/Used/Other/Total rows carry the same six columns cut by vehicle type
         rather than by source. They used to be thrown away at this line, which is why
         nothing in the tool could say how much of a month was new against used.
         Only the delivered column is read off them: the lead counts on these rows are
         the same leads already counted under the source rows, so keeping those would
         double count every opportunity. */
      if (DS_VEHICLE.includes(rowTag)) { people[k].vehicles[rowTag.toLowerCase()] = vals; continue; }
      people[k].sources[rowTag.toLowerCase()] = vals;
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
    "showroomUps","showroomUnsold","showroomBeBacks",
    "newUnits","usedUnits","otherUnits"];
  const rows = [["Delivery Summary"], header];

  for (const k of order) {
    const p = people[k];
    const s = p.sources;
    const veh = p.vehicles || {};
    const pick = (src, i) => (s[src] ? s[src][i] : null);
    // index 4 is Total Delivered/F&I, the same column read off the source rows
    const pickV = (t) => (veh[t] ? veh[t][4] : null);
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
      pickV("new"), pickV("used"), pickV("other"),   // the vehicle split
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
  /* What the report itself says the store did, straight off its own block:
     units by channel and the total. Nothing here is derived from the people
     rows, which is the whole point -- it is the figure to check them against. */
  const g = (src, i) => (storeSources[src] ? storeSources[src][i] : null);
  const dcUnits = { internet: g("internet", 4), phone: g("phone", 4),
    showroom: g("showroom", 4), campaign: g("campaign", 4) };
  const dcTotal = ["internet", "phone", "showroom", "campaign"]
    .reduce((n, c) => (dcUnits[c] == null ? n : n + dcUnits[c]), 0);
  const dcLeads = { internet: g("internet", 0), phone: g("phone", 0), showroom: g("showroom", 0) };
  const stated = Object.keys(storeSources).length
    ? { units: dcUnits, total: dcTotal, leads: dcLeads } : null;
  return { storeName, rows, pairings, stated };
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
      internetLeads: row[idx("internetLeads")],
      phoneUnits: row[idx("phoneUnits")],
      phonePct: row[idx("phonePct")],
      phoneLeads: row[idx("phoneLeads")],
      showroomUnits: row[idx("showroomUnits")],
      showroomPct: row[idx("showroomPct")],
      showroomLeads: row[idx("showroomLeads")],
      campaignUnits: row[idx("campaignUnits")],
      showroomUps: row[idx("showroomUps")],
      showroomUnsold: row[idx("showroomUnsold")],
      showroomBeBacks: row[idx("showroomBeBacks")],
      // Absent on every month imported before the vehicle split was read, so
      // anything showing these has to treat null as "not known" and say so.
      newUnits: row[idx("newUnits")],
      usedUnits: row[idx("usedUnits")],
      otherUnits: row[idx("otherUnits")],
    };
  }
  return out;
}

/* Which real store a parsed heading names, and how sure we are.
   Lives here because both the pipeline and the app need it now: the pipeline to
   route an emailed report, and the app to refuse a PDF a manager drops into the
   wrong store. */
function matchStoreByName(stores, parsedName) {
  const P = squashT(parsedName);
  if (!P) return null;
  let best = null;
  const consider = (s, cand, quality) => {
    if (!cand) return;
    if (!best || cand.length > best.len) best = { store: s, len: cand.length, quality };
  };
  for (const s of stores || []) {
    for (const cand of [squashT(s.name), squashT(s.id)]) {
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

/* The store a report belongs to, when somebody is standing in a different one.
   Null means go ahead: either the heading names this very store, or it names no
   store we know — a store may have been renamed or not added yet, and whoever is
   importing did choose where they are deliberately. A heading naming a DIFFERENT
   store is returned, because there is no reading of that where they meant it. */
export function reportBelongsElsewhere(stores, parsedName, currentStoreId) {
  const hit = matchStoreByName(stores, parsedName);
  if (!hit || hit.store.id === currentStoreId) return null;
  return hit.store;
}

export {
  norm, toNum, squashT,
  detectReportType, parseReport, parseDeliverySummaryRows,
  dedupeName, stripVocabWith, vocabCountWith,
  DA_VOCAB, mapDailyActivityGrid,
  DS_VOCAB, DS_SOURCES, DS_VEHICLE, mapDeliverySummaryGrid,
  matchStoreByName,
};

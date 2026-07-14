import React, { useState, useEffect, useRef, useCallback } from "react";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

/* ============================================================
   LEAD PERFORMANCE CALCULATOR v3 for the Holler-Classic Family of Dealerships
   "Earn the next lead."
   v3: Apple-inspired redesign with frosted chrome, segmented controls,
   spring transitions, logo + favicon. Logic & storage identical to v2.
   ============================================================ */

const CONFIG_KEY = "lpc:config:v2";
const AUDIT_KEY = "lpc:audit:v2";
const storeKey = (id) => `lpc:store:${id}:v2`;

const METRICS = {
  deliveredPct: { label: "Internet Lead Delivery %", short: "Delivery %", kind: "pct" },
  soldPct: { label: "Sold %", short: "Sold %", kind: "pct" },
  unitsDelivered: { label: "Units Delivered", short: "Units", kind: "num" },
  apptVideoDayPct: { label: "Video Day of Appt %", short: "Appt Video %", kind: "pct" },
  bhVideoPct: { label: "BH Lead Personalized Video %", short: "BH Video %", kind: "pct" },
  engagedVideoPct: { label: "Engaged Personalized Video %", short: "Engaged Video %", kind: "pct" },
  // leaderboard channel metrics (Delivered % + Units per channel)
  internetPct: { label: "Internet Delivered %", short: "Internet %", kind: "pct" },
  phonePct: { label: "Phone Delivered %", short: "Phone %", kind: "pct" },
  showroomPct: { label: "Showroom Delivered %", short: "Showroom %", kind: "pct" },
  campaignUnits: { label: "Campaign Units", short: "Campaign", kind: "num" },
  internetUnits: { label: "Internet Units", short: "Internet", kind: "num" },
  phoneUnits: { label: "Phone Units", short: "Phone", kind: "num" },
  showroomUnits: { label: "Showroom Units", short: "Showroom", kind: "num" },
};

const CHANNELS = { internet: "Internet", phone: "Phone", showroom: "Showroom" };

const REPORTS = {
  delivery: { label: "Delivery Summary" },
  appointment: { label: "Appointment" },
  video: { label: "Video" },
};

// One safe place to turn any report key into a human label. Indexing REPORTS
// directly blew up on the leaderboard channels and the activity report, which
// are not in it.
const reportLabel = (t) =>
  REPORTS[t]?.label ||
  LEADERBOARD_REPORTS[t]?.label ||
  (t === "activity" ? "Daily Activity" : t);

// leaderboard needs three channel delivery reports
const LEADERBOARD_REPORTS = {
  "delivery-internet": { label: "Internet Delivery" },
  "delivery-phone": { label: "Phone Delivery" },
  "delivery-showroom": { label: "Showroom Delivery" },
  // Campaign covers service-to-sales and finance applications. Those leads genuinely
  // sell cars, so the units must count, but grading them on close rate would punish
  // people for working a completely different kind of lead. Units only.
  "delivery-campaign": { label: "Campaign Delivery" },
};

const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

// All day/month boundaries run on dealership time, not the browser's clock and not UTC.
// (toISOString() is UTC, so an 8pm Eastern import would have counted as tomorrow.)
const STORE_TZ = "America/New_York";
const dayIn = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(d); // YYYY-MM-DD
const today = () => dayIn();
const ym = () => today().slice(0, 7);
const prevYm = () => {
  const [y, m] = today().split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}`;
};
const dayOfMonth = () => Number(today().slice(8, 10));
const fmtPct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
const fmtNum = (v) => (v == null ? "-" : Math.round(v * 10) / 10);
const monthLabel = (m) => new Date(m + "-02").toLocaleDateString("en-US", { month: "long", year: "numeric" });

const DEFAULT_TIERS = [
  { cap: 60, requirements: [
    { metric: "apptVideoDayPct", min: 50 },
    { metric: "deliveredPct", min: 10 },
    { metric: "engagedVideoPct", min: 40 },
  ]},
  { cap: 80, requirements: [
    { metric: "apptVideoDayPct", min: 55 },
    { metric: "deliveredPct", min: 12 },
    { metric: "engagedVideoPct", min: 45 },
  ]},
  { cap: 100, requirements: [
    { metric: "apptVideoDayPct", min: 60 },
    { metric: "deliveredPct", min: 14 },
    { metric: "engagedVideoPct", min: 50 },
    { metric: "bhVideoPct", min: 40 },
  ]},
];

const ROLE_COLORS = ["#2A5E9B", "#00A896", "#BF5AF2", "#FF9F0A", "#5E8C31", "#FF375F"];

// Leaderboard delivered-% thresholds, per channel. At or above green is green, at or
// above yellow is yellow, anything lower is red. Internet, phone and showroom sit in
// very different ranges, so each gets its own pair.
const CHANNEL_LIST = [
  { id: "internet", label: "Internet" },
  { id: "phone", label: "Phone" },
  { id: "showroom", label: "Showroom" },
];
const DEFAULT_THRESHOLDS = {
  internet: { green: 20, yellow: 10 },
  phone:    { green: 25, yellow: 12 },
  showroom: { green: 30, yellow: 15 },
};

// Older stores saved a single flat { green, yellow }. Spread it across all three
// channels so nothing breaks and the numbers carry over.
function normThresholds(t) {
  if (!t) return JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
  if (t.green !== undefined || t.yellow !== undefined) {
    const flat = { green: t.green ?? 20, yellow: t.yellow ?? 10 };
    return { internet: { ...flat }, phone: { ...flat }, showroom: { ...flat } };
  }
  const out = {};
  for (const c of CHANNEL_LIST) {
    out[c.id] = { ...DEFAULT_THRESHOLDS[c.id], ...(t[c.id] || {}) };
  }
  return out;
}

// Daily Activity checkout minimums (per store, editable)
// minStars is optional: leave it at 0 and stars are recorded but not required.
// repeatDays is how many days below standard in a month before someone is flagged
// automatically as a repeat offender.
const DEFAULT_ACTIVITY_STANDARDS = { minCalls: 16, minVideos: 2, minStars: 0, repeatDays: 3 };

// Per-store brand colors. `primary` drives the hero band + accents on the manager's view.
const DEFAULT_BRAND = { primary: "#2A5E9B", deep: "#1D4674", accent: "#C1D730" };

// Manufacturer palettes so a store instantly reads as its franchise.
const BRAND_PRESETS = [
  { id: "honda",    label: "Honda",        primary: "#CC0000", deep: "#8E0000", accent: "#F2F2F2" },
  { id: "ford",     label: "Ford",         primary: "#1F5FA9", deep: "#00095B", accent: "#8FC5E8" },
  { id: "hyundai",  label: "Hyundai",      primary: "#00559A", deep: "#002C5F", accent: "#A4C8E1" },
  { id: "mazda",    label: "Mazda",        primary: "#3D4B54", deep: "#101820", accent: "#C8102E" },
  { id: "audi",     label: "Audi",         primary: "#3C4247", deep: "#1A1D20", accent: "#BB0A30" },
  { id: "toyota",   label: "Toyota",       primary: "#C8102E", deep: "#8A0B20", accent: "#E8E8E8" },
  { id: "kia",      label: "Kia",          primary: "#05141F", deep: "#000000", accent: "#BB162B" },
  { id: "chevy",    label: "Chevrolet",    primary: "#1B4E8C", deep: "#0D2240", accent: "#FCC10F" },
  { id: "nissan",   label: "Nissan",       primary: "#C3002F", deep: "#8A0021", accent: "#E5E5E5" },
  { id: "driversmart", label: "Driver's Mart", primary: "#00A896", deep: "#00776A", accent: "#C1D730" },
  { id: "hc",       label: "Holler-Classic", primary: "#2A5E9B", deep: "#1D4674", accent: "#C1D730" },
];

const DEFAULT_CONFIG = {
  stores: [
    { id: "holler-honda", name: "Holler Honda", icon: null },
    { id: "classic-honda", name: "Classic Honda", icon: null },
    { id: "holler-hyundai", name: "Holler Hyundai", icon: null },
  ],
  roles: [
    { id: "sales", name: "Sales Associate", color: "#2A5E9B", onBoard: true, coaching: true },
    { id: "bdc", name: "BDC Agent", color: "#00A896", onBoard: false, coaching: false },
  ],
  standards: {},
  approvedDomains: [],
  registrationOpen: true,
};

/* ---------------- Logo + favicon ---------------- */

function Logo({ size = 40, animated = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={animated ? "logo-anim" : ""}>
      <defs>
        <linearGradient id="lpcg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A5E9B" />
          <stop offset="100%" stopColor="#1D4674" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#lpcg)" />
      {/* full ring track (light blue) */}
      <circle cx="32" cy="32" r="17" fill="none" stroke="rgba(136,198,234,.5)" strokeWidth="5" />
      {/* soft rounded start for the lime (a butt-capped path would cut flat here) */}
      <circle className="logo-arc-start" cx="15" cy="32" r="2.5" fill="#C1D730" />
      {/* Lime sweeps 180° → 320.2°: the SAME angular span as the needle, so the two tips
          travel together. A butt cap ends it flat on the needle's centerline, whereas a round cap
          would bulge sideways past the needle. The white needle is drawn on top of the seam. */}
      <path className="logo-arc" d="M 15 32 A 17 17 0 0 1 45.06 21.12" fill="none" stroke="#C1D730" strokeWidth="5" strokeLinecap="butt" pathLength="100" />
      {/* needle: width 5 so its round tip reaches the arc's outer edge (r=19.5) and covers the seam */}
      <g className="logo-needle" style={{ transformOrigin: "32px 32px" }}>
        <line x1="32" y1="32" x2="45.06" y2="21.12" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="#FFFFFF" />
    </svg>
  );
}

const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#2A5E9B'/><stop offset='100%' stop-color='#1D4674'/></linearGradient></defs><rect x='2' y='2' width='60' height='60' rx='15' fill='url(#g)'/><circle cx='32' cy='32' r='17' fill='none' stroke='rgba(136,198,234,.5)' stroke-width='5'/><circle cx='15' cy='32' r='2.5' fill='#C1D730'/><path d='M 15 32 A 17 17 0 0 1 45.06 21.12' fill='none' stroke='#C1D730' stroke-width='5' stroke-linecap='butt'/><line x1='32' y1='32' x2='45.06' y2='21.12' stroke='#FFF' stroke-width='5' stroke-linecap='round'/><circle cx='32' cy='32' r='4.5' fill='#FFF'/></svg>`;

function useFavicon() {
  useEffect(() => {
    try {
      const href = "data:image/svg+xml," + encodeURIComponent(LOGO_SVG);
      let link = document.querySelector("link[rel~='icon']");
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = href;
      document.title = "Lead Performance Calculator";
    } catch {}
  }, []);
}

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
    // three same-format delivery reports; tell them apart by filename keyword
    if (fn.includes("campaign")) return "delivery-campaign";
    if (fn.includes("phone")) return "delivery-phone";
    if (fn.includes("showroom") || fn.includes("show-room") || fn.includes("floor")) return "delivery-showroom";
    if (fn.includes("internet") || fn.includes("web")) return "delivery-internet";
    return "delivery"; // legacy single delivery report (treated as internet for standards)
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

/* ---------------- Evaluation ---------------- */

function evaluateAssociate(stats, tiers) {
  if (!tiers || tiers.length === 0) return { status: "no-standards" };
  const opps = stats?.opps;
  const sorted = [...tiers].sort((a, b) => a.cap - b.cap);
  let tierIndex = sorted.findIndex((t) => (opps ?? 0) <= t.cap);
  if (tierIndex === -1) tierIndex = sorted.length - 1;
  const tier = sorted[tierIndex];
  const failures = [];
  let marginSum = 0, marginCount = 0;
  for (const req of tier.requirements) {
    const def = METRICS[req.metric];
    const val = stats?.[req.metric];
    const needed = def.kind === "pct" ? req.min / 100 : req.min;
    if (val == null || val < needed) failures.push({ metric: req.metric, val: val ?? null, min: req.min, def });
    else if (needed > 0) { marginSum += (val - needed) / needed; marginCount++; }
  }
  // surpass = average % above each requirement (only meaningful when passing)
  const surpass = marginCount ? marginSum / marginCount : 0;
  return {
    status: failures.length === 0 ? "pass" : "fail",
    failures, tier, tierIndex, cap: tier.cap, opps: opps ?? 0,
    atCap: (opps ?? 0) >= tier.cap,
    nextCap: sorted[tierIndex + 1]?.cap ?? null,
    surpass,
  };
}

// which required metrics is this associate missing report data for?
function missingMetricData(stats, tiers) {
  if (!tiers || !tiers.length) return [];
  const sorted = [...tiers].sort((a, b) => a.cap - b.cap);
  const opps = stats?.opps;
  let ti = sorted.findIndex((t) => (opps ?? 0) <= t.cap);
  if (ti === -1) ti = sorted.length - 1;
  const miss = [];
  for (const req of sorted[ti].requirements) {
    if (stats?.[req.metric] == null) miss.push(METRICS[req.metric].short);
  }
  return miss;
}

const failureText = (ev) =>
  ev.failures.map((f) =>
    `${f.def.short} ${f.val == null ? "no data" : f.def.kind === "pct" ? fmtPct(f.val) : fmtNum(f.val)} (needs ${f.def.kind === "pct" ? f.min + "%" : f.min})`
  ).join("; ");

/* ===== BACKEND BLOCK: Supabase (storage + real auth) ===== */
// Set in Vercel: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const AUTH_ENABLED = true;

async function loadShared(key, fallback) {
  if (!supabase) return fallback;
  try {
    const { data, error } = await supabase.from("app_data").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data ? data.value : fallback;
  } catch (e) { console.error("load failed", key, e); return fallback; }
}
async function saveShared(key, value) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("app_data").upsert({ key, value }, { onConflict: "key" });
    if (error) throw error;
    return true;
  } catch (e) { console.error("save failed", key, e); return false; }
}

// ---- auth ----
// Passwords live in Supabase Auth (hashed). This app never sees them.
// The `profiles` row carries role + store access, and only an admin can change it.
async function authGetProfile() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !data) return null;
  return data;
}
async function authSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? error.message : null };
}
async function authSignUp(email, password, name) {
  const { error } = await supabase.auth.signUp({
    email, password, options: { data: { name } },
  });
  return { error: error ? error.message : null };
}
async function authSignOut() {
  if (supabase) await supabase.auth.signOut();
}
async function authResetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  return { error: error ? error.message : null };
}
async function listProfiles() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("profiles").select("*").order("created_at");
  if (error) { console.error("listProfiles", error); return []; }
  return data || [];
}
async function updateProfile(id, patch) {
  if (!supabase) return false;
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  if (error) { console.error("updateProfile", error); return false; }
  return true;
}
async function deleteProfile(id) {
  if (!supabase) return false;
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) { console.error("deleteProfile", error); return false; }
  return true;
}
// Deliberately narrow: this is the only thing a non-admin may change about themselves.
async function markOnboarded() {
  if (!supabase) return;
  await supabase.rpc("mark_onboarded");
}
function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(() => cb());
  return () => { try { data.subscription.unsubscribe(); } catch (e) {} };
}
async function getTokens() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
}

// A read that FAILED and a key that simply does not exist are completely different
// things. Treating them the same is how a transient error (a network blip, an auth
// token that was not ready yet, an RLS denial) got mistaken for "first run" and
// overwrote real data with defaults. These say which actually happened.
async function loadStrict(key) {
  if (!supabase) return { ok: false, missing: false, value: null };
  try {
    const { data, error } = await supabase
      .from("app_data").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return { ok: true, missing: !data, value: data ? data.value : null };
  } catch (e) {
    console.error("load failed", key, e);
    return { ok: false, missing: false, value: null, error: e };
  }
}

// Every store's data row, whether or not the store is still listed in the config.
// This is what lets the recovery tool find data that was orphaned.
async function listStoreKeys() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("app_data").select("key").like("key", "lpc:store:%");
    if (error) throw error;
    return (data || []).map((r) => r.key);
  } catch (e) {
    console.error("listStoreKeys", e);
    return [];
  }
}
/* ===== END BACKEND BLOCK ===== */

// Stamped automatically at build time by vite.config.js, so every deploy
// carries its own version without anyone remembering to bump a number.
const APP_VERSION = (typeof __APP_VERSION__ !== "undefined") ? __APP_VERSION__ : "preview";

const BACKUP_INDEX_KEY = "lpc:backups:index:v1";
const backupKey = (id) => `lpc:backup:${id}:v1`;
const AUTO_BACKUP_EVERY_HOURS = 20;   // once a working day
const KEEP_BACKUPS = 14;

// Writes a full snapshot to the database, at most once a day, whenever an admin
// opens the tool. No server or cron needed: the admin's own visit is the trigger.
// Snapshots are stripped out of the copy so backups can't nest inside each other.
async function runAutoBackup(config, adminData, byName) {
  const index = await loadShared(BACKUP_INDEX_KEY, []);
  const newest = index[0] ? new Date(index[0].t).getTime() : 0;
  if (Date.now() - newest < AUTO_BACKUP_EVERY_HOURS * 3600 * 1000) return index;

  const stores = {};
  for (const [sid, d] of Object.entries(adminData || {})) {
    if (!d) continue;
    const copy = { ...d };
    delete copy.snapshots;
    stores[sid] = copy;
  }
  if (Object.keys(stores).length === 0) return index;

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = {
    app: "lead-performance-calculator",
    version: 2,
    exportedAt: new Date().toISOString(),
    auto: true,
    by: byName || "auto",
    config,
    stores,
    audit: await loadShared(AUDIT_KEY, []),
  };

  const ok = await saveShared(backupKey(id), payload);
  if (!ok) return index;

  const next = [{ id, t: payload.exportedAt, stores: Object.keys(stores).length, auto: true }, ...index];
  const keep = next.slice(0, KEEP_BACKUPS);
  // free the space used by anything that fell off the end
  for (const old of next.slice(KEEP_BACKUPS)) await saveShared(backupKey(old.id), null);
  await saveShared(BACKUP_INDEX_KEY, keep);
  return keep;
}

const emptyStoreData = () => ({ roster: [], months: {} });

async function appendAudit(entry) {
  const log = await loadShared(AUDIT_KEY, []);
  log.unshift({ t: new Date().toISOString(), ...entry });
  await saveShared(AUDIT_KEY, log.slice(0, 400));
}

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================ */

export default function LeadPerformanceCalculator() {
  useFavicon();
  const [config, setConfig] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [appModule, setAppModule] = useState("perf");
  const [view, setView] = useState("admin");
  const [storeData, setStoreData] = useState(null);
  const [adminData, setAdminData] = useState({});
  const [tab, setTab] = useState("board");
  const [adminTab, setAdminTab] = useState("overview");
  const [dragName, setDragName] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [importLog, setImportLog] = useState([]);
  const [pendingChannels, setPendingChannels] = useState(null); // { ambiguous:[{rows,fileName}], ready:[] }
  // The landing view is decided once when you sign in. Re-deciding it every time the
  // config saved was throwing you out of the store you were working in: editing a
  // standard at Driver's Mart wrote the config, the effect re-ran, reset the view to
  // "All Stores", and the activity guard then bounced you to the first store.
  const viewPicked = useRef(false);
  // which slice of the board is showing. Driven by the hero tiles.
  const [boardFilter, setBoardFilter] = useState(null); // null | cleared | attention | off | unassigned
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const fileRef = useRef(null);

  // Who is signed in? Preview returns a stand-in admin; the hosted site
  // reads the real Supabase session and its matching profile row.
  const refreshProfile = useCallback(async () => {
    const p = await authGetProfile();
    setSession(p);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    refreshProfile();
    const unsub = onAuthChange(() => refreshProfile());
    return () => { try { unsub && unsub(); } catch (e) {} };
  }, [refreshProfile]);

  // Daily Activity is recorded per store, so the all-stores view has nothing to show.
  // If an admin ends up there, drop them into their first store instead of a blank page.
  useEffect(() => {
    if (!config || !session) return;
    if (appModule !== "activity" || view !== "admin") return;
    const list = session.role === "admin"
      ? config.stores
      : config.stores.filter((s) => (session.stores || []).includes(s.id));
    if (list[0]) setView(list[0].id);
  }, [appModule, view, config, session]);

  useEffect(() => {
    (async () => {
      // Strict read. If this FAILS we must not proceed: a failed read used to look
      // identical to "no config yet", and the app would helpfully write DEFAULT_CONFIG
      // straight over the real one, wiping every store. Bail out and say so instead.
      const res = await loadStrict(CONFIG_KEY);
      if (!res.ok) { setLoadErr(true); return; }

      let cfg = res.value;

      if (cfg) {
        let dirty = false;
        for (const r of cfg.roles || []) {
          if (r.color === "#0A84FF") { r.color = "#2A5E9B"; dirty = true; }
        }
        if (cfg.approvedDomains === undefined) { cfg.approvedDomains = []; dirty = true; }
        // which roles appear on The Board. BDC agents don't sell units, so they're off.
        for (const r of cfg.roles || []) {
          if (r.onBoard === undefined) { r.onBoard = r.id !== "bdc"; dirty = true; }
          // coaching is built on cars sold, so it does not apply to BDC by default
          if (r.coaching === undefined) { r.coaching = r.id !== "bdc"; dirty = true; }
        }
        if (cfg.registrationOpen === undefined) { cfg.registrationOpen = true; dirty = true; }
        if (cfg.users) { delete cfg.users; dirty = true; }
        if (dirty) await saveShared(CONFIG_KEY, cfg);
        setConfig(cfg);
        return;
      }

      // Genuinely absent, not merely unreadable. Check the v1 key before assuming
      // this is a brand new install.
      const old = await loadStrict("lpc:config:v1");
      if (!old.ok) { setLoadErr(true); return; }

      cfg = old.value
        ? { ...DEFAULT_CONFIG, ...old.value }
        : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      delete cfg.users;

      if (!old.value) {
        cfg.standards = {};
        for (const s of cfg.stores) {
          cfg.standards[s.id] = {};
          for (const r of cfg.roles) cfg.standards[s.id][r.id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
        }
      }
      await saveShared(CONFIG_KEY, cfg);
      setConfig(cfg);
    })().catch(() => setLoadErr(true));
  }, []);

  useEffect(() => {
    if (!config || !session) return;
    (async () => {
      const accessible = session.role === "admin" ? config.stores : config.stores.filter((s) => session.stores.includes(s.id));
      const all = {};
      for (const s of accessible) {
        const r = await loadStrict(storeKey(s.id));
        if (!r.ok) { setLoadErr(true); return; }   // never let a failed read look like an empty store
        let d = r.value;
        if (!d) {
          const legacy = await loadStrict(`lpc:store:${s.id}:v1`);
          if (!legacy.ok) { setLoadErr(true); return; }
          d = legacy.value || emptyStoreData();
        }
        all[s.id] = d;
      }
      setAdminData(all);
      // an admin opening the tool is what triggers the daily backup
      if (session.role === "admin") {
        runAutoBackup(config, all, session.name).catch(() => {});
      }
      if (!viewPicked.current) {
        viewPicked.current = true;
        if (session.role === "admin") {
          setView("admin");
        } else if (session.role === "overseer" && accessible.length > 1) {
          setView("combined");
        } else {
          const first = accessible[0]?.id;
          if (first) { setView(first); setStoreData(all[first]); }
        }
      } else if (view !== "admin" && view !== "combined" && all[view]) {
        // config changed while working in a store: refresh that store's data, stay put
        setStoreData(all[view]);
      }
    })();
  }, [config, session]);

  useEffect(() => { setBoardFilter(null); }, [view, tab, appModule]);

  // The Board opens in its own window and is tuned at the TV, not here. It calls
  // back into this window to save what the person standing at the screen chose.
  useEffect(() => {
    window.__lpcSaveBoardDisplay = async (storeId, display) => {
      const current = adminData[storeId] || (view === storeId ? storeData : null);
      if (!current) return false;
      const next = JSON.parse(JSON.stringify(current));
      next.boardDisplay = display;
      await persistStore(storeId, next, { action: "Changed board display", detail: JSON.stringify(display) });
      return true;
    };
    return () => { delete window.__lpcSaveBoardDisplay; };
  }, [adminData, storeData, view]); // eslint-disable-line

  useEffect(() => {
    if (!config || view === "admin" || view === "combined" || !session) return;
    (async () => {
      const d = adminData[view] || (await loadShared(storeKey(view), emptyStoreData()));
      setStoreData(d);
      setTab("board");
    })();
  }, [view]); // eslint-disable-line

  const persistConfig = async (next, audit) => {
    setConfig(next); setSaving(true);
    await saveShared(CONFIG_KEY, next);
    if (audit) await appendAudit({ user: session?.name, ...audit });
    setSaving(false);
  };
  const persistStore = async (storeId, next, audit) => {
    setStoreData(next); setSaving(true);
    setAdminData((p) => ({ ...p, [storeId]: next }));
    await saveShared(storeKey(storeId), next);
    if (audit) await appendAudit({ user: session?.name, store: storeId, ...audit });
    setSaving(false);
  };

  // Keep a rolling set of restore points so a bad import is never fatal.
  const snapshotStore = (data, reason) => {
    const copy = JSON.parse(JSON.stringify({
      roster: data.roster, months: data.months, activity: data.activity,
      plates: data.plates, restrictions: data.restrictions, aliases: data.aliases,
      stars: data.stars, goals: data.goals, baselines: data.baselines,
      repeatFlags: data.repeatFlags, excluded: data.excluded,
    }));
    const t = new Date().toISOString();
    const snaps = data.snapshots || [];
    snaps.unshift({ t, by: session?.name || "-", reason, data: copy });
    data.snapshots = snaps.slice(0, 12);
    return t;   // so an upload can point back at the exact state before it
  };

  // Apply already-typed report entries. Ambiguous delivery files are resolved before we get here.
  const applyEntries = async (entries) => {
    const month = ym(); const day = today();
    let next = JSON.parse(JSON.stringify(storeData));
    const snapT = snapshotStore(next, "Before import");
    if (!next.months[month]) next.months[month] = { stats: {}, imports: {}, names: {} };
    const M = next.months[month];
    if (!M.imports[day]) M.imports[day] = {};
    const log = []; const importedFiles = [];

    const aliases = next.aliases || {};
    const canon = (k) => aliases[k] || k; // a renamed person folds into their existing record

    for (const { rows, type, fileName } of entries) {
      const raw = parseReport(rows, type);
      // fold every incoming name through the alias map, and drop anything on the
      // exclusion list. Reports contain roll-up rows like "Team A" that are not
      // people, and letting them through skews every average on the board.
      const excluded = new Set((next.excluded || []).map(norm));
      const parsed = {};
      let skipped = 0;
      for (const [k, v] of Object.entries(raw)) {
        if (excluded.has(k)) { skipped++; continue; }
        const c = canon(k);
        parsed[c] = { ...(parsed[c] || {}), ...v };
      }
      M.names[type] = Object.keys(parsed);
      const label = REPORTS[type]?.label || LEADERBOARD_REPORTS[type]?.label || (type === "activity" ? "Daily Activity" : type);
      let count = 0;

      if (type === "activity") {
        if (!next.activity) next.activity = {};
        next.activity[day] = {};
        for (const [key, rec] of Object.entries(parsed)) {
          next.activity[day][key] = {
            displayName: rec.displayName,
            calls: rec.actCalls, video: rec.actVideo, contacted: rec.actCallContacted,
            text: rec.actText, email: rec.actEmail, apptCreated: rec.actApptCreated,
            apptShow: rec.actApptShow, opps: rec.actOppsTotal, tasks: rec.actCompletedTasks,
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
        // Day-over-day trend: only move the baseline when this import is a NEW day.
        // Re-importing twice in one day must not compare a number against itself.
        const trend = { ...(prevStat.prevPct || {}) };
        const pctDay = { ...(prevStat.pctDay || {}) };
        const hist = JSON.parse(JSON.stringify(prevStat.pctHistory || {}));
        for (const ch of ["internet", "phone", "showroom"]) {   // campaign has no pct by design
          if (rec[ch + "Pct"] == null) continue;
          const storedVal = prevStat[ch + "Pct"];
          const storedDay = pctDay[ch];
          if (storedVal != null && storedDay && storedDay !== day) {
            trend[ch] = storedVal; // yesterday's figure becomes the comparison baseline
          }
          pctDay[ch] = day;
          // running history, one point per day, so a real trend can be drawn
          hist[ch] = (hist[ch] || []).filter((p) => p.d !== day);
          hist[ch].push({ d: day, v: rec[ch + "Pct"] });
          hist[ch] = hist[ch].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-30);
        }
        M.stats[key] = { ...prevStat, ...rec, prevPct: trend, pctDay, pctHistory: hist, [`${type}Updated`]: day };
        if (type !== "activity") count++;
      }

      M.imports[day][type] = true;
      // a full log of every upload, not just a tick for the day
      next.importLog = [
        { id: uid(), t: new Date().toISOString(), type, label, file: fileName, count, skipped,
          by: session?.name || "-", snapT, day: type === "activity" ? day : null },
        ...(next.importLog || []),
      ].slice(0, 200);
      // The Internet Delivery Summary is the same DriveCentric export that drives the
      // lead standards. Uploading it once should satisfy both checklists, not leave the
      // other one stuck as "waiting".
      if (type === "delivery-internet") M.imports[day]["delivery"] = true;
      if (type === "delivery") M.imports[day]["delivery-internet"] = true;
      importedFiles.push(`${label} (${count})`);
      log.push({ ok: true, msg: `${fileName} → ${label} · ${count} associates updated${skipped ? `, ${skipped} excluded row${skipped === 1 ? "" : "s"} skipped` : ""}.` });

      const rosterKeys = new Set(next.roster.map((a) => norm(a.name)));
      for (const [key, rec] of Object.entries(parsed)) {
        if (excluded.has(key)) continue;
        if (!rosterKeys.has(key)) {
          next.roster.push({ id: uid(), name: rec.displayName, roleId: null, order: next.roster.length });
          rosterKeys.add(key);
        }
      }
    }

    setImportLog(log);
    if (importedFiles.length) {
      // freeze the standards in force this month so past months stay judged under their own rules
      M.standardsSnapshot = JSON.parse(JSON.stringify(config.standards?.[view] || {}));
    }
    await persistStore(view, next, {
      action: "Imported reports",
      detail: importedFiles.join(", ") || "nothing usable",
    });
  };

  const handleFiles = useCallback(async (fileList) => {
    if (!storeData || view === "admin") return;
    const ready = []; const ambiguous = []; const log = [];

    for (const file of Array.from(fileList)) {
      const text = await file.text();
      const rows = Papa.parse(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;
      const type = detectReportType(rows, file.name);
      if (!type) {
        log.push({ ok: false, msg: `${file.name} isn't a Delivery, Appointment, Video, or Daily Activity report, so it was skipped.` });
        continue;
      }
      // "delivery" means we saw a delivery report but couldn't tell which channel from the filename.
      // Rather than guess (and silently mis-file it), ask.
      if (type === "delivery") ambiguous.push({ rows, fileName: file.name });
      else ready.push({ rows, type, fileName: file.name });
    }

    if (log.length) setImportLog(log);
    if (ambiguous.length) setPendingChannels({ ambiguous, ready });
    else if (ready.length) await applyEntries(ready);
  }, [storeData, view, session]); // eslint-disable-line


  const moveAssociate = async (name, targetName, roleId) => {
    if (!storeData) return;
    const next = JSON.parse(JSON.stringify(storeData));
    const list = next.roster;
    const from = list.findIndex((a) => a.name === name);
    if (from === -1) return;
    const roleChanged = list[from].roleId !== roleId;
    const [item] = list.splice(from, 1);
    item.roleId = roleId;
    const to = targetName ? list.findIndex((a) => a.name === targetName) : list.length;
    list.splice(to === -1 ? list.length : to, 0, item);
    list.forEach((a, i) => (a.order = i));
    await persistStore(view, next, roleChanged ? {
      action: "Changed position",
      detail: `${name} → ${config.roles.find((r) => r.id === roleId)?.name || "Needs a position"}`,
    } : null);
  };

  const setRestriction = async (assoc, restriction) => {
    if (!storeData) return;
    const next = JSON.parse(JSON.stringify(storeData));
    next.restrictions = next.restrictions || {};
    if (restriction) next.restrictions[assoc.id] = restriction;
    else delete next.restrictions[assoc.id];
    await persistStore(view, next, {
      action: restriction ? "Confirmed off leads" : "Put back on leads",
      detail: restriction
        ? `${assoc.name}${restriction.until ? `, re-evaluate ${new Date(restriction.until).toLocaleDateString()}` : ", no re-eval date"}`
        : assoc.name,
    });
  };
  if (loadErr) return <div style={{ padding: 40, fontFamily: "sans-serif" }}>Couldn't reach saved data. Reload the page to try again.</div>;
  if (!config || !authReady) return <Shell><LoadingScreen /><Style /></Shell>;

  const signOut = async () => {
    await authSignOut();
    viewPicked.current = false;
    setSession(null); setEntered(false); setAppModule("perf");
  };

  // Signed out: splash first, then the sign-in card.
  if (!session) {
    return <Shell><Login config={config}
      onAuthed={async () => { await refreshProfile(); }} /><Style /></Shell>;
  }

  // Signed in, but the admin hasn't granted a store yet (or the account was switched off).
  if (!session.active) {
    return <Shell><div className="login"><div className="login-card">
      <div className="login-logo"><Logo size={64} animated /></div>
      <h1 className="login-title">Account paused</h1>
      <p className="setup-note">This account has been deactivated. Contact your group admin.</p>
      <button className="btn wide" onClick={signOut}>Sign out</button>
    </div></div><Style /></Shell>;
  }
  if (session.role !== "admin" && session.pending) {
    return <Shell><PendingScreen profile={session} onSignOut={signOut} /><Style /></Shell>;
  }

  // Pick a tool. Daily Activity is per-store, so an admin who chooses it gets dropped
  // into a store rather than the all-stores overview, which has no activity data.
  const chooseModule = (mod) => {
    setAppModule(mod || "perf");
    if (mod === "activity" && view === "admin") {
      const first = (isAdmin ? config.stores : accessibleStores)[0];
      if (first) setView(first.id);
    }
    if (mod === "perf" && isAdmin && view !== "admin") {
      // leave the admin where they were; they can switch stores from the dropdown
    }
    setEntered(true);
  };

  if (!entered) {
    return <Shell><Splash config={config} session={session} onEnter={chooseModule} onSignOut={signOut} /><Style /></Shell>;
  }

  const isAdmin = session.role === "admin";
  const isOverseer = session.role === "overseer";
  const hasOverview = isAdmin || (isOverseer && session.stores.length > 1);
  const accessibleStores = isAdmin ? config.stores : config.stores.filter((s) => session.stores.includes(s.id));
  const currentStore = view !== "admin" ? config.stores.find((s) => s.id === view) : null;
  const overviewStores = isAdmin ? config.stores : accessibleStores;

  // "The Board" chosen from the splash: scope it to who's signed in.
  if (appModule === "board") {
    return (
      <Shell>
        <header className="topbar no-print">
          <div className="brand">
            <Logo size={36} />
            <div>
              <div className="brand-title">Lead Performance</div>
              <div className="brand-sub">Holler-Classic · Earn the next lead</div>
            </div>
          </div>
          <div className="topbar-right">
            <ToolSwitcher value="board" onChange={(mod) => {
              if (mod === "board") return;
              if (mod === "activity" && view === "admin") {
                const first = (isAdmin ? config.stores : accessibleStores)[0];
                if (first) setView(first.id);
              }
              setAppModule(mod);
              setTab(mod === "activity" ? "checkout" : "board");
            }} />
            <span className="whoami">{session.name}{isOverseer && <span className="role-tag">BDC Oversight</span>}</span>
            <button className="btn-quiet" onClick={() => setEntered(false)}>Tools</button>
            <button className="btn-quiet" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <div className="page">
          <BoardLauncher config={config} session={session}
            onLaunch={(storeId) => openLeaderboard(config, storeId)}
            onBack={signOut} />
        </div>
        <Style />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="topbar no-print">
        <div className="brand">
          <Logo size={36} />
          <div>
            <div className="brand-title">Lead Performance</div>
            <div className="brand-sub">Holler-Classic · Earn the next lead</div>
          </div>
        </div>
        <div className="topbar-right">
          {saving && <span className="save-dot">Saving…</span>}

          <ToolSwitcher value={appModule} onChange={(mod) => {
            if (mod === appModule) return;
            if (mod === "board") { setAppModule("board"); return; }
            if (mod === "activity" && view === "admin") {
              const first = (isAdmin ? config.stores : accessibleStores)[0];
              if (first) setView(first.id);
            }
            setAppModule(mod);
            setTab(mod === "activity" ? "checkout" : "board");
          }} />

          <select className="view-select" value={view} onChange={(e) => setView(e.target.value)}>
            {/* Daily Activity is recorded per store, so there is no all-stores view of it */}
            {isAdmin && appModule !== "activity" && <option value="admin">All Stores</option>}
            {isOverseer && appModule !== "activity" && session.stores.length > 1 && <option value="combined">Combined (my stores)</option>}
            {accessibleStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <span className="whoami">{session.name}{isOverseer && <span className="role-tag">BDC Oversight</span>}</span>
          <button className="btn-quiet" onClick={() => setEntered(false)}>Tools</button>
          <button className="btn-quiet" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {view === "admin" && isAdmin ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["overview", "Overview"], ["gm", "Summary"], ["access", "Access"], ["audit", "Audit Log"], ["settings", "Stores"], ["backup", "Backup"]]}
              value={adminTab} onChange={setAdminTab} />
          </nav>
          <div key={adminTab} className="page">
            {adminTab === "overview" && <AdminOverview config={config} adminData={adminData} onOpenStore={setView} />}
            {adminTab === "gm" && <GMSummary config={config} data={adminData} stores={config.stores} />}
            {adminTab === "access" && <AccessPanel config={config} session={session} onChange={persistConfig} />}
            {adminTab === "audit" && <AuditLog />}
            {adminTab === "settings" && <SettingsPanel config={config} onChange={persistConfig} />}
            {adminTab === "backup" && (
              <BackupPanel config={config} adminData={adminData} session={session}
                onRestoreAll={async (backup) => {
                  await saveShared(CONFIG_KEY, backup.config);
                  for (const [sid, sdata] of Object.entries(backup.stores || {})) {
                    await saveShared(storeKey(sid), sdata);
                  }
                  if (backup.audit) await saveShared(AUDIT_KEY, backup.audit);
                  setConfig(backup.config);
                  setAdminData(backup.stores || {});
                  await appendAudit({ user: session.name, action: "Restored from backup", detail: backup.exportedAt || "" });
                }}
                onRestoreStore={async (storeId, snap) => {
                  const current = adminData[storeId] || emptyStoreData();
                  const restored = {
                    ...current,
                    ...snap.data,
                    // keep the existing restore points, and add one for the state we're leaving
                    snapshots: [
                      { t: new Date().toISOString(), by: session.name, reason: "Before rollback", data: JSON.parse(JSON.stringify({
                        roster: current.roster, months: current.months, activity: current.activity,
                        plates: current.plates, restrictions: current.restrictions, aliases: current.aliases,
                      })) },
                      ...(current.snapshots || []),
                    ].slice(0, 8),
                  };
                  await persistStore(storeId, restored, { action: "Rolled back store", detail: `${config.stores.find((s) => s.id === storeId)?.name} → ${new Date(snap.t).toLocaleString()}` });
                }} />
            )}
          </div>
        </>
      ) : view === "combined" && isOverseer ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["board", "Combined Board"], ["gm", "Summary"]]}
              value={tab === "board" || tab === "gm" ? tab : "board"} onChange={setTab} />
          </nav>
          <div key={"combined" + tab} className="page">
            {tab === "gm"
              ? <GMSummary config={config} data={adminData} stores={accessibleStores} />
              : <CombinedBoard config={config} stores={accessibleStores} adminData={adminData} onOpenStore={setView} />}
          </div>
        </>
      ) : accessibleStores.length === 0 ? (
        <div className="empty">Your account is active but no store has been assigned yet. Your group admin needs to grant you store access in the Access panel.</div>
      ) : !storeData ? (
        <LoadingScreen label={`Loading ${currentStore?.name || "store"}`} />
      ) : isOverseer ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["board", "Lead Board"], ["gm", "Summary"], ["history", "History"]]}
              value={["board", "gm", "history"].includes(tab) ? tab : "board"} onChange={setTab} />
          </nav>
          <div key={view + tab} className="page">
            {(tab === "board" || !["gm", "history"].includes(tab)) && <Board config={config} store={currentStore} data={storeData} dragName={dragName} setDragName={setDragName} onMove={moveAssociate} onSetRestriction={setRestriction} readOnly />}
            {tab === "gm" && <GMSummary config={config} data={{ [view]: storeData }} stores={[currentStore]} />}
            {tab === "history" && <HistoryPanel config={config} store={currentStore} data={storeData} />}
          </div>
        </>
      ) : (
        <>
          <nav className="seg-wrap no-print">
            {appModule === "activity" ? (
              <SegControl
                items={isAdmin
                  ? [["checkout", "Check Out"], ["coaching", "Coaching"], ["plates", "License Plates"], ["import", "Import"], ["actstd", "Standards"]]
                  : [["checkout", "Check Out"], ["coaching", "Coaching"], ["plates", "License Plates"], ["import", "Import"]]}
                value={(isAdmin ? ["checkout", "coaching", "plates", "import", "actstd"] : ["checkout", "coaching", "plates", "import"]).includes(tab) ? tab : "checkout"}
                onChange={setTab}
                renderExtra={(id) => (id === "import" ? <ImportBadge storeData={storeData} activity /> : null)} />
            ) : (
              <SegControl
                items={isAdmin
                  ? [["board", "Lead Board"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["standards", "Standards"], ["roster", "Roster"]]
                  : [["board", "Lead Board"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["roster", "Roster"]]}
                value={(isAdmin
                  ? ["board", "import", "gm", "history", "standards", "roster"]
                  : ["board", "import", "gm", "history", "roster"]).includes(tab) ? tab : "board"}
                onChange={setTab}
                renderExtra={(id) => (id === "import" ? <ImportBadge storeData={storeData} /> : null)} />
            )}
          </nav>
          <div key={view + tab + appModule} className="page">
            {appModule === "activity" ? (
              <>
                {(tab === "checkout" || !["coaching", "plates", "import", "actstd"].includes(tab)) && <CheckOutTracker config={config} store={currentStore} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} />}
                {tab === "coaching" && <CoachingPanel config={config} store={currentStore} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} />}
                {tab === "plates" && <PlateTracker data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} userName={session.name} />}
                {tab === "import" && <ImportPanel data={storeData} log={importLog} dropActive={dropActive} setDropActive={setDropActive} onFiles={handleFiles} fileRef={fileRef} activity onChange={(d, audit) => persistStore(view, d, audit)} />}
                {tab === "actstd" && isAdmin && <ActivityStandardsEditor config={config} storeId={view} onChange={persistConfig} />}
              </>
            ) : (
              <>
                {tab === "board" && (
                  <div className="board-page">
                    {session.role === "manager" && !session.onboarded && (
                      <WelcomeCard store={currentStore} onDismiss={async () => {
                        await markOnboarded();
                        setSession((s) => ({ ...s, onboarded: true }));
                      }} />
                    )}
                    <StoreHero config={config} store={currentStore} data={storeData} session={session} onGoTab={setTab}
                      filter={boardFilter} onFilter={setBoardFilter} />
                    <Board config={config} store={currentStore} data={storeData} dragName={dragName} setDragName={setDragName}
                      onMove={moveAssociate} onSetRestriction={setRestriction}
                      filter={boardFilter} onClearFilter={() => setBoardFilter(null)} />
                  </div>
                )}
                {tab === "import" && <ImportPanel data={storeData} log={importLog} dropActive={dropActive} setDropActive={setDropActive} onFiles={handleFiles} fileRef={fileRef} onChange={(d, audit) => persistStore(view, d, audit)} />}
                {tab === "gm" && <GMSummary config={config} data={{ [view]: storeData }} stores={[currentStore]} />}
                {tab === "history" && <HistoryPanel config={config} store={currentStore} data={storeData} />}
                {tab === "standards" && isAdmin && <StandardsEditor config={config} storeId={view} onChange={persistConfig} />}
                {tab === "roster" && <RosterEditor config={config} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} />}
              </>
            )}
          </div>
        </>
      )}
      {pendingChannels && (
        <ChannelPrompt
          pending={pendingChannels}
          onCancel={() => { setPendingChannels(null); setImportLog([{ ok: false, msg: "Import cancelled, nothing was changed." }]); }}
          onConfirm={async (resolved) => {
            const all = [...pendingChannels.ready, ...resolved];
            setPendingChannels(null);
            await applyEntries(all);
          }} />
      )}
      <Style />
    </Shell>
  );
}

/* ---------------- Sliding segmented control ---------------- */
function SegControl({ items, value, onChange, renderExtra }) {
  const wrapRef = useRef(null);
  const btnRefs = useRef({});
  const [thumb, setThumb] = useState({ left: 0, width: 0, ready: false });

  const measure = useCallback(() => {
    const btn = btnRefs.current[value];
    const wrap = wrapRef.current;
    if (!btn || !wrap) return;
    setThumb({ left: btn.offsetLeft, width: btn.offsetWidth, ready: true });
  }, [value]);

  useEffect(() => {
    measure();
    // smoothly bring the active segment into view when the control overflows
    const btn = btnRefs.current[value];
    if (btn?.scrollIntoView) {
      try { btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch {}
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, measure]);

  // re-measure once fonts settle
  useEffect(() => { const t = setTimeout(measure, 150); return () => clearTimeout(t); }, [measure]);

  return (
    <div className="seg" ref={wrapRef}>
      <div className={"seg-thumb" + (thumb.ready ? " ready" : "")} style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />
      {items.map(([id, label]) => (
        <button key={id} ref={(el) => (btnRefs.current[id] = el)}
          className={"seg-btn" + (value === id ? " active" : "")}
          onClick={() => onChange(id)}>
          {label}
          {renderExtra && renderExtra(id)}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Standalone TV leaderboard (HTML string) ---------------- */
function LEADERBOARD_HTML(p) {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${p.storeName} · Leaderboard</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Archivo+Black&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  :root { --blue:#2A5E9B; --dblue:#1D4674; --lime:#C1D730; --lblue:#88C6EA;
    --green:#2E9E4F; --greenbg:#E4F4E7; --yellow:#E0A100; --yellowbg:#FCF2D3; --red:#D5433A; --redbg:#FBE3E1; }
  html,body { height:100%; }
  body { font-family:'Archivo','Inter',system-ui,-apple-system,'Segoe UI',sans-serif; color:#EAF1F8;
    font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1;
    background:#0E2033; overflow:hidden; }
  /* slow aurora. Long cycles on purpose: this hangs on a wall all day and must never
     become the thing people look at instead of the numbers. */
  body::before { content:''; position:fixed; inset:-15%; z-index:0; pointer-events:none;
    background:
      radial-gradient(42% 55% at 18% 8%, rgba(36,79,128,.95), transparent 70%),
      radial-gradient(38% 50% at 82% 12%, rgba(193,215,48,.12), transparent 70%),
      radial-gradient(50% 60% at 50% 100%, rgba(42,94,155,.35), transparent 72%);
    animation: aurora 40s ease-in-out infinite alternate; }
  @keyframes aurora {
    0% { transform: translate3d(0,0,0) scale(1); }
    100% { transform: translate3d(-2.5%, 2%, 0) scale(1.08); }
  }
  /* Display tuning, set at the TV itself.
     --tscale   : overall text size
     --squeeze  : horizontal pre-compression. If the TV stretches the picture sideways
                  (casting 4:3 into 16:9, or a stretched picture mode), squeezing the
                  content here means it comes out the right shape on the wall.
     --pad      : edge inset, for TVs that overscan and crop the borders. */
  .wrap { position:relative; z-index:1;
    --tscale: 1; --squeeze: 1; --pad: 0vw;
    padding-left: calc(2vw + var(--pad)); padding-right: calc(2vw + var(--pad));
    transform: scaleX(var(--squeeze));
    transform-origin: center center; }
  .wrap { height:100vh; display:flex; flex-direction:column; padding:2.2vh 2vw; }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.6vh; }
  .head-l { display:flex; align-items:center; gap:1.2vw; }
  .head-r { display:flex; align-items:center; gap:2.4vw; }
  .head-logo { width:calc(6.6vh * var(--tscale)); height:calc(6.6vh * var(--tscale)); border-radius:1.2vh; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .head-logo img { width:100%; height:100%; object-fit:contain; }
  .head-title { font-family:'Archivo Black','Archivo',sans-serif; font-weight:900; font-size:calc(5.4vh * var(--tscale)); letter-spacing:.5px; line-height:1; }
  .head-sub { font-size:calc(1.7vh * var(--tscale)); color:#A8CBEA; letter-spacing:.10em; text-transform:uppercase; font-weight:600; }
  .total { text-align:right; }
  .total-num { font-family:'Archivo Black','Archivo',sans-serif; font-weight:900; font-size:calc(5.8vh * var(--tscale)); line-height:1; color:var(--lime); }
  .total-cap { font-size:calc(1.5vh * var(--tscale)); color:#A8CBEA; letter-spacing:.10em; text-transform:uppercase; font-weight:700; margin-top:.4vh; }
  .clock { text-align:right; font-family:'Archivo','Inter',sans-serif; }
  .clock-time { font-size:calc(3.2vh * var(--tscale)); font-weight:700; }
  .clock-date { font-size:1.5vh; color:#9FC2E4; display:flex; align-items:center; gap:.4vw; justify-content:flex-end; }
  .live { width:.8vh; height:.8vh; border-radius:50%; background:#69E08A; flex:0 0 auto;
    box-shadow:0 0 0 0 rgba(105,224,138,.7); animation: livePulse 2.4s ease-out infinite; }
  @keyframes livePulse {
    0% { box-shadow:0 0 0 0 rgba(105,224,138,.55); }
    70% { box-shadow:0 0 0 1.1vh rgba(105,224,138,0); }
    100% { box-shadow:0 0 0 0 rgba(105,224,138,0); }
  }

  /* one panel, one table, everybody visible without scrolling */
  .panel { flex:1; position:relative; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    border-radius:1.4vh; padding:1.2vh 1.2vw; min-height:0; overflow:hidden; }
  .scroller { height:100%; overflow:hidden; }
  /* soft fade at the bottom edge so a row cut mid-scroll reads as intentional */
  .panel::after { content:''; position:absolute; left:0; right:0; bottom:0; height:5vh; pointer-events:none;
    background:linear-gradient(180deg, transparent, rgba(14,32,51,.75)); border-radius:0 0 1.4vh 1.4vh; }
  /* The table is capped and centred. Stretched across a 65in screen the columns drifted
     so far apart the eye lost the row on the way across. */
  .lb { width:100%; max-width:1500px; margin:0 auto; border-collapse:collapse; table-layout:fixed; }
  .lb th { font-size:calc(1.7vh * var(--tscale)); text-transform:uppercase; letter-spacing:.10em; color:#A8CBEA;
    font-weight:700; padding:0 .5vw 1.2vh; text-align:center; }
  .lb th.nm { text-align:left; padding-left:1vw; }
  .lb td { padding:var(--rowpad) .5vw; font-size:var(--rowfs); text-align:center; }

  /* zebra striping instead of hairlines: from across the room a solid band is far
     easier to track than a 1px line */
  .lb tbody tr:nth-child(odd) { background:rgba(255,255,255,.045); }
  .lb tbody tr td:first-child { border-radius:1vh 0 0 1vh; }
  .lb tbody tr td:last-child { border-radius:0 1vh 1vh 0; }

  .lb .rank { width:6%; }
  /* podium badges. Gold, silver, bronze read instantly from across a floor. */
  .badge { display:inline-flex; align-items:center; justify-content:center;
    width:calc(var(--rowfs) * 1.7); height:calc(var(--rowfs) * 1.7); border-radius:50%;
    font-family:'Archivo Black','Archivo',sans-serif; font-size:calc(var(--rowfs) * .82);
    background:rgba(255,255,255,.08); color:#8FB3D6; }
  .badge.m1 { background:linear-gradient(145deg,#FFD75E,#E0A100); color:#3A2B00;
    box-shadow:0 0 calc(var(--rowfs)*.8) rgba(255,200,60,.55); }
  .badge.m2 { background:linear-gradient(145deg,#E6ECF2,#AFBECB); color:#2A3540; }
  .badge.m3 { background:linear-gradient(145deg,#E8A87C,#C0764A); color:#3A1E0B; }

  .lb .nm { width:30%; text-align:left; padding-left:1vw; font-weight:700;
    font-size:calc(var(--rowfs) * 1.12); letter-spacing:-.01em;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Delivered doubles as a bar chart: volume is instantly comparable down the column */
  .lb .sold { width:14%; position:relative; }
  /* --barw is a percentage of the cell, and the leader gets 100%. Starting at 6% meant
     the leader's bar ran to 106% and spilled into the Internet column. Scale it into
     the space that actually exists. */
  .lb .sold .bar { position:absolute; left:5%; top:14%; bottom:14%;
    width:calc(var(--barw) * 0.86);
    background:linear-gradient(90deg, rgba(193,215,48,.32), rgba(193,215,48,.08));
    border-radius:.5vh; z-index:0; transition:width .8s cubic-bezier(.22,1,.36,1); }
  .lb .sold .camp { position:relative; z-index:1; display:inline-block; margin-left:.4vw;
    font-size:calc(var(--rowfs) * .55); font-weight:700; color:#B9CE4B;
    background:rgba(193,215,48,.14); padding:.15vh .45vw; border-radius:.5vh; vertical-align:middle; }
  .lb .sold .soldnum { position:relative; z-index:1;
    font-family:'Archivo Black','Archivo',sans-serif; color:var(--lime);
    font-size:calc(var(--rowfs) * 1.45); }
  .lb .pcell { width:16.6%; white-space:nowrap; }

  /* rows arrive in sequence rather than all at once */
  .lb tbody tr.row { animation: rowIn .5s cubic-bezier(.22,1,.36,1) both;
    animation-delay: calc(var(--i) * 45ms); }
  @keyframes rowIn { from { opacity:0; transform: translateY(1.2vh); } to { opacity:1; transform:none; } }

  /* the leader gets a lit band and a slow shine that travels across it */
  .lb tbody tr.leader { position:relative; }
  .lb tbody tr.leader td { background:linear-gradient(90deg, rgba(193,215,48,.16), rgba(193,215,48,.03) 60%, transparent); }
  .lb tbody tr.leader .nm { color:#F2F7DC; }
  .lb tbody tr.leader .nm::after { content:''; position:absolute; inset:0; pointer-events:none;
    background:linear-gradient(105deg, transparent 35%, rgba(255,255,255,.16) 50%, transparent 65%);
    background-size:220% 100%; animation: shine 5.5s ease-in-out infinite; }
  @keyframes shine { 0% { background-position:180% 0; } 55%,100% { background-position:-60% 0; } }

  .pill { font-family:'Archivo Black','Archivo',sans-serif; font-weight:900; font-size:calc(var(--rowfs) * 1.05);
    padding:.3vh .7vw; border-radius:.9vh; display:inline-block; min-width:5.2vw; }
  .pill.g { background:var(--greenbg); color:var(--green); }
  .pill.y { background:var(--yellowbg); color:var(--yellow); }
  .pill.r { background:var(--redbg); color:var(--red); }
  .pill.dim { background:rgba(255,255,255,.07); color:#6E93BC; }
  .pill-mark { font-size:calc(var(--rowfs) * .85); margin-right:.3vw; opacity:.9; }
  .move { display:inline-flex; align-items:center; gap:.2vw; margin-left:.45vw; min-width:3.4vw;
    justify-content:flex-start; }
  .trend { font-size:calc(var(--rowfs) * .78); }
  .delta { font-size:calc(var(--rowfs) * .72); font-weight:700; font-variant-numeric:tabular-nums; }
  .up { color:#69E08A; } .down { color:#FF8A80; } .flat { color:#5C7F9F; }

  .flag { color:#FFCF6B; }
  .foot { text-align:center; font-size:1.4vh; color:#7FA8D4; margin-top:1.1vh; letter-spacing:.04em; }
  .empty { color:#7FA8D4; font-size:2vh; padding:4vh; text-align:center; }
  .fade { animation:fade .5s ease; } @keyframes fade { from{opacity:0;transform:translateY(6px);} to{opacity:1;} }

  /* tuning controls: nearly invisible until someone goes looking for them */
  .gear { position:fixed; right:1.2vw; bottom:1.2vh; z-index:40; width:4.4vh; height:4.4vh; border-radius:50%;
    border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.07); color:#9FC2E4;
    font-size:2.2vh; cursor:pointer; opacity:.16; transition:opacity .25s, background .25s; }
  .gear:hover { opacity:1; background:rgba(255,255,255,.14); }
  .tuner { position:fixed; right:1.2vw; bottom:7vh; z-index:41; width:min(340px, 32vw);
    background:rgba(10,24,40,.96); border:1px solid rgba(255,255,255,.14); border-radius:1.4vh;
    padding:1.6vh 1.4vw; display:none; box-shadow:0 1.5vh 4vh rgba(0,0,0,.55); font-size:1.6vh; }
  .tuner.on { display:block; }
  .tuner-head { display:flex; justify-content:space-between; align-items:center;
    font-weight:800; font-size:1.9vh; margin-bottom:1.2vh; }
  .tuner-x { background:none; border:none; color:#9FC2E4; font-size:2.4vh; cursor:pointer; line-height:1; }
  .tuner-row { display:block; margin-bottom:1vh; }
  .tuner-row span { display:flex; justify-content:space-between; color:#BFD9F0; margin-bottom:.5vh; }
  .tuner-row b { color:#fff; }
  .tuner-row input[type=range] { width:100%; accent-color:#C1D730; }
  .tuner-hint { color:#7FA8D4; font-size:1.35vh; margin:-.3vh 0 1.2vh; line-height:1.45; }
  .tuner-foot { display:flex; gap:.6vw; margin-top:1.4vh; }
  .tuner-btn { flex:1; padding:.9vh .6vw; border-radius:.9vh; border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06); color:#EAF1F8; font-size:1.5vh; font-weight:700; cursor:pointer; }
  .tuner-btn.primary { background:#C1D730; color:#1F2A00; border-color:#C1D730; }
  .tuner-msg { color:#69E08A; font-size:1.35vh; margin-top:.8vh; min-height:1.6vh; }
</style></head>
<body>
<div class="wrap" id="root"><div class="empty">Loading leaderboard…</div></div>

<!-- Tuning happens standing at the TV, so the controls live here rather than back in the app. -->
<button class="gear" id="gear" title="Display settings">&#9881;</button>
<div class="tuner" id="tuner">
  <div class="tuner-head">Display <button class="tuner-x" id="tclose">&times;</button></div>

  <label class="tuner-row">
    <span>Text size <b id="v-t">100%</b></span>
    <input id="s-t" type="range" min="60" max="160" step="5" value="100">
  </label>

  <label class="tuner-row">
    <span>Horizontal squeeze <b id="v-s">100%</b></span>
    <input id="s-s" type="range" min="70" max="100" step="1" value="100">
  </label>
  <p class="tuner-hint">If the TV stretches the picture sideways, pull this down until the letters look the right shape on the wall.</p>

  <label class="tuner-row">
    <span>Edge inset <b id="v-p">0%</b></span>
    <input id="s-p" type="range" min="0" max="8" step="0.5" value="0">
  </label>
  <p class="tuner-hint">For screens that crop the edges.</p>

  <div class="tuner-foot">
    <button class="tuner-btn" id="treset">Reset</button>
    <button class="tuner-btn primary" id="tsave">Save for this store</button>
  </div>
  <div class="tuner-msg" id="tmsg"></div>
</div>
<script>
  var CFG = ${JSON.stringify(p)};
  function norm(s){return (s||'').trim().toLowerCase().replace(/\\s+/g,' ');}
  // No external library and no CDN. A TV on a dealership network may not be able to
  // reach an external CDN at all, and an import that never resolves left it stuck on
  // "Loading" forever. Plain fetch against the REST API, with the token refreshed by
  // hand so the screen can sit there unattended for days.
  var TOK = CFG.tokens ? {
    access: CFG.tokens.access_token,
    refresh: CFG.tokens.refresh_token
  } : null;

  function withTimeout(promise, ms){
    return Promise.race([
      promise,
      new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, ms); })
    ]);
  }

  async function refreshToken(){
    if (!TOK || !TOK.refresh) return false;
    try {
      var r = await withTimeout(fetch(CFG.tokens.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.tokens.anonKey },
        body: JSON.stringify({ refresh_token: TOK.refresh })
      }), 12000);
      if (!r.ok) return false;
      var d = await r.json();
      if (!d.access_token) return false;
      TOK.access = d.access_token;
      if (d.refresh_token) TOK.refresh = d.refresh_token;
      return true;
    } catch (e) { return false; }
  }

  async function getStore(){
    if (!TOK) return { __err: 'This board was opened without a signed-in session. Open it again from the tool.' };
    var url = CFG.tokens.url + '/rest/v1/app_data?key=eq.' + encodeURIComponent(CFG.storeKey) + '&select=value';
    function headers(){
      return { apikey: CFG.tokens.anonKey, Authorization: 'Bearer ' + TOK.access };
    }
    try {
      var res = await withTimeout(fetch(url, { headers: headers() }), 12000);
      if (res.status === 401 || res.status === 403) {
        var ok = await refreshToken();
        if (!ok) return { __err: 'The session for this board expired. Open it again from the tool.' };
        res = await withTimeout(fetch(url, { headers: headers() }), 12000);
      }
      if (!res.ok) return { __err: 'Could not reach the database (' + res.status + '). Retrying...' };
      var rows = await res.json();
      return (rows && rows[0]) ? rows[0].value : null;
    } catch (e) {
      return { __err: 'No connection to the database. Retrying...' };
    }
  }

  // keep the session alive well before it lapses, so an all-day board never drops out
  setInterval(function(){ refreshToken(); }, 40 * 60 * 1000);
  // each channel is judged on its own scale: a 25% showroom close and a 25% internet
  // close are nowhere near the same achievement
  function tone(pct, ch){
    if (pct==null) return 'r';
    var t = (CFG.thresholds && CFG.thresholds[ch]) || { green: 20, yellow: 10 };
    var v = pct*100;
    if (v>=t.green) return 'g';
    if (v>=t.yellow) return 'y';
    return 'r';
  }
  // symbol as well as colour, so the board reads for colour-blind viewers too
  function toneMark(t){ return t==='g' ? '\\u2713' : t==='y' ? '\\u2013' : '\\u2717'; }
  // direction AND distance moved since the previous report, in percentage points
  function arrow(cur, prev){
    if (cur==null||prev==null) return ['flat','·',''];
    var d = (cur - prev) * 100;
    if (d > 0.05)  return ['up','▲','+'+d.toFixed(1)];
    if (d < -0.05) return ['down','▼', d.toFixed(1)];
    return ['flat','·',''];
  }
  function fmtPct(v){ return v==null?'-':(v*100).toFixed(1)+'%'; }
  function num(v){ return v==null?0:v; }
  function render(store){
    var root = document.getElementById('root');
    // an error is not the same as an empty store: say which, never just hang
    if (store && store.__err){
      root.innerHTML = '<div class="empty">' + store.__err + '</div>';
      return;
    }
    if (!store){ root.innerHTML = '<div class="empty">No data yet for this store. Import the delivery reports in the tool and this board will fill in.</div>'; return; }
    var M = (store.months||{})[CFG.ym] || {stats:{}};

    // CFG.roles already excludes any role turned off for The Board (BDC by default),
    // so only the people who actually deliver units show up here.
    var boardRoles = {};
    (CFG.roles||[]).forEach(function(r){ boardRoles[r.id] = true; });

    var people = (store.roster||[])
      .filter(function(a){ return a.roleId && boardRoles[a.roleId]; })
      .map(function(a){
        var s = M.stats[norm(a.name)] || {};
        var iU=num(s.internetUnits), pU=num(s.phoneUnits), rU=num(s.showroomUnits);
        var cU=num(s.campaignUnits);   // service-to-sales and finance apps: units count, close rate is not graded
        var haveAll = (s.internetUnits!=null) && (s.phoneUnits!=null) && (s.showroomUnits!=null);
        return {
          name:a.name,
          internetPct:s.internetPct, phonePct:s.phonePct, showroomPct:s.showroomPct,
          prev:(s.prevPct||{}),
          camp: cU,
          sold: iU+pU+rU+cU,
          haveAll:haveAll
        };
      })
      .sort(function(a,b){ return b.sold - a.sold; });

    var totalSold = people.reduce(function(n,x){ return n + x.sold; }, 0);
    var grandFlag = Math.abs(totalSold - Math.round(totalSold)) > 0.01;

    // Everyone has to fit on one screen with no scrolling, so the rows scale to the
    // size of the team rather than being a fixed height.
    // Size from the space that is actually available rather than a fixed lookup.
    // This is on a TV across a showroom floor, so fill the screen: a small team should
    // read enormous, and a big team should still be as large as it possibly can be.
    var n = Math.max(people.length, 1);
    var AVAIL = 80;                                   // vh the table body gets
    var rowH  = Math.min(8.5, AVAIL / (n + 1));
    // Never shrink below what is readable from across a floor. If the team does not
    // fit at that size, the board scrolls instead of squinting.
    var rowFs = Math.max(2.2, Math.min(4.2, rowH * 0.60)) * DISP.tscale;   // vh
    var rowPad = Math.max(0.35, rowH * 0.10) * DISP.tscale;                // vh

    function cell(pct, prevVal, ch){
      if (pct == null) return '<td class="pcell"><span class="pill dim">-</span></td>';
      var tn = tone(pct, ch);
      var ar = arrow(pct, prevVal);
      var delta = ar[2] ? '<span class="delta '+ar[0]+'">'+ar[2]+'</span>' : '';
      return '<td class="pcell">' +
        '<span class="pill '+tn+'"><span class="pill-mark">'+toneMark(tn)+'</span>'+fmtPct(pct)+'</span>' +
        '<span class="move"><span class="trend '+ar[0]+'">'+ar[1]+'</span>'+delta+'</span>' +
      '</td>';
    }

    var maxSold = people.reduce(function(m,x){ return Math.max(m, x.sold); }, 0) || 1;

    var rows = people.map(function(x,i){
      var medal = i < 3 ? ' m' + (i+1) : '';
      var barw = Math.round((x.sold / maxSold) * 100);
      return '<tr class="row' + (i === 0 ? ' leader' : '') + '" style="--i:' + i + '; --barw:' + barw + '%">' +
        '<td class="rank"><span class="badge' + medal + '">' + (i+1) + '</span></td>' +
        '<td class="nm">' + x.name + (x.haveAll ? '' : ' <span class="flag" title="A delivery report is missing for this person, so their total may be incomplete.">&#9873;</span>') + '</td>' +
        '<td class="sold"><span class="bar"></span><span class="soldnum" data-to="' + x.sold + '">0</span>' +
          (x.camp > 0 ? '<span class="camp" title="Campaign units: service-to-sales and finance. Counted, not graded.">+' + x.camp + ' camp</span>' : '') +
        '</td>' +
        cell(x.internetPct, x.prev.internet, 'internet') +
        cell(x.phonePct,    x.prev.phone,    'phone') +
        cell(x.showroomPct, x.prev.showroom, 'showroom') +
      '</tr>';
    }).join('');

    if (!rows) rows = '<tr><td colspan="6" class="empty">No sales associates on the board yet. Give them a position in the tool.</td></tr>';

    root.innerHTML =
      '<div class="head"><div class="head-l"><div class="head-logo">'+(CFG.icon?'<img src="'+CFG.icon+'"/>':'')+'</div>'+
      '<div><div class="head-title">'+CFG.storeName+'</div><div class="head-sub">Delivery Leaderboard</div></div></div>'+
      '<div class="head-r">'+
        '<div class="total"><div class="total-num"><span class="totnum" data-to="'+totalSold+'">0</span>'+(grandFlag?' <span class="flag">&#9873;</span>':'')+'</div><div class="total-cap">Units Delivered</div></div>'+
        '<div class="clock"><div class="clock-time" id="clk"></div><div class="clock-date" id="dat"><span class="live"></span><span id="datt"></span></div></div>'+
      '</div></div>'+
      '<div class="panel" style="--rowfs:'+rowFs+'vh; --rowpad:'+rowPad+'vh;">'+
        '<div class="scroller" id="scroller">'+
        '<table class="lb">'+
          '<thead><tr>'+
            '<th class="rank">#</th>'+
            '<th class="nm">Associate</th>'+
            '<th class="sold">Delivered</th>'+
            '<th class="pcell">Internet %</th>'+
            '<th class="pcell">Phone %</th>'+
            '<th class="pcell">Showroom %</th>'+
          '</tr></thead>'+
          '<tbody>'+rows+'</tbody>'+
        '</table>'+
        '</div>'+
      '</div>'+
      '<div class="foot">' +
        'Green at: Internet ' + CFG.thresholds.internet.green + '%+ &middot; ' +
        'Phone ' + CFG.thresholds.phone.green + '%+ &middot; ' +
        'Showroom ' + CFG.thresholds.showroom.green + '%+' +
        ' &middot; arrows show the change since the previous report &middot; data refreshes every 15 minutes' +
      '</div>';
    tick();
    countUp();
    startScroll();
  }

  // If the whole team cannot fit at a readable size, the board walks slowly down the
  // list, holds at the bottom, then springs back to the top with a bounce. Nobody at
  // the bottom of the board should be invisible all day.
  var scrollRAF = null;
  function startScroll(){
    if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
    var el = document.getElementById('scroller');
    if (!el) return;

    // let layout settle before measuring
    setTimeout(function(){
      var over = el.scrollHeight - el.clientHeight;
      if (over <= 4) return;                 // everyone fits: nothing to do

      var HOLD_TOP = 4000;                   // pause so the leaders get their moment
      var HOLD_BOTTOM = 2500;
      var SPEED = 22;                        // px per second: a slow, readable crawl
      var BLOOP = 950;                       // the spring back to the top

      var phase = 'holdTop', t0 = null, from = 0;

      function bloopEase(p){
        // overshoot slightly then settle: the "bloop"
        var c = 1.70158 * 1.2;
        return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
      }

      function frame(ts){
        if (t0 === null) t0 = ts;
        var dt = ts - t0;

        if (phase === 'holdTop') {
          el.scrollTop = 0;
          if (dt > HOLD_TOP) { phase = 'down'; t0 = ts; }
        } else if (phase === 'down') {
          var y = (dt / 1000) * SPEED;
          if (y >= over) { el.scrollTop = over; phase = 'holdBottom'; t0 = ts; }
          else el.scrollTop = y;
        } else if (phase === 'holdBottom') {
          if (dt > HOLD_BOTTOM) { phase = 'bloop'; t0 = ts; from = el.scrollTop; }
        } else if (phase === 'bloop') {
          var p = Math.min(1, dt / BLOOP);
          el.scrollTop = Math.max(0, from * (1 - bloopEase(p)));
          if (p >= 1) { el.scrollTop = 0; phase = 'holdTop'; t0 = ts; }
        }
        scrollRAF = requestAnimationFrame(frame);
      }
      scrollRAF = requestAnimationFrame(frame);
    }, 400);
  }

  // numbers roll up rather than snapping into place. Runs on every refresh, so a
  // new unit landing on the board actually announces itself.
  function countUp(){
    var els = document.querySelectorAll('[data-to]');
    for (var k = 0; k < els.length; k++) {
      (function(el){
        var to = parseFloat(el.getAttribute('data-to')) || 0;
        var dur = 900, t0 = null;
        function step(ts){
          if (!t0) t0 = ts;
          var p = Math.min(1, (ts - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          var v = to * eased;
          el.textContent = (to % 1 === 0) ? Math.round(v) : v.toFixed(1);
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      })(els[k]);
    }
  }
  function tick(){ var n=new Date();
    var c=document.getElementById('clk'); var d=document.getElementById('dat');
    if(c) c.textContent = n.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    var dt = document.getElementById('datt');
    if(dt) dt.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'});
    else if(d) d.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'}); }
  async function loop(){
    var s = await getStore();
    if (s && s.boardDisplay && !s.__err) {
      // only adopt saved settings on the first load, so a live adjustment is not
      // stamped over every fifteen minutes
      if (!LAST) {
        DISP.tscale = s.boardDisplay.tscale || 1;
        DISP.squeeze = s.boardDisplay.squeeze || 1;
        DISP.pad = s.boardDisplay.pad || 0;
      }
    }
    if (s && !s.__err) LAST = s;
    applyDisp();
    render(s);
    wireTuner();
    applyDisp();
  }
  /* ---------- display tuning ---------- */
  // Read whatever was saved for this store, and let the person at the TV change it.
  var DISP = { tscale: 1, squeeze: 1, pad: 0 };

  function applyDisp(){
    var w = document.getElementById('root');
    if (!w) return;
    w.style.setProperty('--tscale', DISP.tscale);
    w.style.setProperty('--squeeze', DISP.squeeze);
    w.style.setProperty('--pad', DISP.pad + 'vw');
    var t = document.getElementById('v-t'), s = document.getElementById('v-s'), pd = document.getElementById('v-p');
    if (t) t.textContent = Math.round(DISP.tscale * 100) + '%';
    if (s) s.textContent = Math.round(DISP.squeeze * 100) + '%';
    if (pd) pd.textContent = DISP.pad + '%';
  }

  function wireTuner(){
    var gear = document.getElementById('gear');
    var tun = document.getElementById('tuner');
    var st = document.getElementById('s-t'), ss = document.getElementById('s-s'), sp = document.getElementById('s-p');
    if (!gear || !tun) return;

    gear.onclick = function(){ tun.classList.toggle('on'); };
    document.getElementById('tclose').onclick = function(){ tun.classList.remove('on'); };

    st.value = Math.round(DISP.tscale * 100);
    ss.value = Math.round(DISP.squeeze * 100);
    sp.value = DISP.pad;

    // text size changes the row maths, so re-render; the others are pure CSS
    st.oninput = function(){ DISP.tscale = st.value / 100; applyDisp(); if (LAST) render(LAST); };
    ss.oninput = function(){ DISP.squeeze = ss.value / 100; applyDisp(); };
    sp.oninput = function(){ DISP.pad = parseFloat(sp.value); applyDisp(); };

    document.getElementById('treset').onclick = function(){
      DISP = { tscale: 1, squeeze: 1, pad: 0 };
      st.value = 100; ss.value = 100; sp.value = 0;
      applyDisp(); if (LAST) render(LAST);
    };

    document.getElementById('tsave').onclick = async function(){
      var msg = document.getElementById('tmsg');
      try {
        var op = window.opener;
        if (op && op.__lpcSaveBoardDisplay) {
          var ok = await op.__lpcSaveBoardDisplay(CFG.storeId, DISP);
          msg.textContent = ok ? 'Saved for this store.' : 'Could not save.';
        } else {
          msg.textContent = 'Keep the tool window open to save this.';
        }
      } catch (e) { msg.textContent = 'Could not save.'; }
      setTimeout(function(){ msg.textContent = ''; }, 4000);
    };
  }

  var LAST = null;   // last store payload, so a text-size change can re-render

  // Data is pulled every 15 minutes. Hitting the database every 30 seconds all day
  // was pointless: the reports only change when a manager uploads one.
  // The clock is separate and ticks every 10 seconds, so the minute on screen is
  // always right regardless of when the data last refreshed.
  loop();
  setInterval(loop, 15 * 60 * 1000);
  setInterval(tick, 10000);
</script></body></html>`;
}

/* ---------------- Splash ---------------- */
function Splash({ config, session, onEnter, onSignOut }) {
  const first = (session?.name || "").split(" ")[0];
  return (
    <div className="splash">
      <div className="splash-inner">
        <div className="splash-logo"><Logo size={92} animated /></div>
        <h1 className="splash-title">Lead Performance</h1>
        <p className="splash-sub">
          {first ? `Welcome back, ${first}. Which tool do you need?` : "Which tool do you need?"}
        </p>
        <div className="splash-actions">
          <button className="btn wide splash-btn-primary" onClick={() => onEnter("perf")}>Performance Tracker</button>
          <button className="btn wide splash-btn-primary splash-btn-activity" onClick={() => onEnter("activity")}>Daily Activity Tracker</button>
          <button className="btn-outline wide splash-btn-secondary" onClick={() => onEnter("board")}>The Board</button>
        </div>
        <button className="btn-link" onClick={onSignOut}>Sign out</button>
        <p className="splash-foot">Earn the next lead.</p>
      </div>
    </div>
  );
}

/* ---------------- Board launcher (after sign-in, role-aware) ---------------- */
function BoardLauncher({ config, session, onLaunch, onBack }) {
  const isAdmin = session.role === "admin";
  const stores = isAdmin ? config.stores : config.stores.filter((s) => session.stores.includes(s.id));
  const single = stores.length === 1;
  const [opened, setOpened] = useState(false);

  // A manager belongs to exactly one store, so their board opens straight away, with no picker.
  useEffect(() => {
    if (single && !opened) { onLaunch(stores[0].id); setOpened(true); }
  }, [single, opened]); // eslint-disable-line

  if (stores.length === 0) {
    return <div className="empty">No store is assigned to your account yet, so there's no board to show. Ask your group admin to grant you store access.</div>;
  }

  if (single) {
    const s = stores[0];
    return (
      <div className="board-launch">
        <div className="card board-launch-card">
          <div className="bl-logo">{s.icon ? <img src={s.icon} alt="" /> : <Logo size={54} animated />}</div>
          <h2 className="bl-title">{s.name}</h2>
          <p className="hint">The Board opened in its own window, sized for a TV or big screen. It refreshes on its own every 30 seconds.</p>
          <button className="btn" onClick={() => onLaunch(s.id)}>Open it again</button>
          <button className="btn-link" onClick={onBack}>← Back to start</button>
        </div>
      </div>
    );
  }

  // Admin and Centralized BDC pick which store's board to throw on the screen.
  return (
    <div className="board-launch">
      <h2 className="section-title">The Board <span className="section-sub">choose a store</span></h2>
      <p className="hint">Opens a live leaderboard in its own window, sized for a TV. Managers skip this step, their board opens straight to their own store.</p>
      <div className="bl-grid">
        {stores.map((s) => {
          const b = s.brand || DEFAULT_BRAND;
          return (
            <button key={s.id} className="bl-tile" style={{ "--sp": b.primary, "--sd": b.deep }} onClick={() => onLaunch(s.id)}>
              <span className="bl-tile-logo">{s.icon ? <img src={s.icon} alt="" /> : <span className="bl-tile-ph">{s.name[0]}</span>}</span>
              <span className="bl-tile-name">{s.name}</span>
              <span className="bl-tile-go">Open ↗</span>
            </button>
          );
        })}
      </div>
      <button className="btn-link" onClick={onBack}>← Back to start</button>
    </div>
  );
}

// Opens a standalone, auto-refreshing leaderboard in a new window sized for a TV.
async function openLeaderboard(config, storeId) {
  const w = window.open("", "lpc_leaderboard_" + storeId, "width=1600,height=900");
  if (!w) { alert("Please allow pop-ups for this site to open the leaderboard on a second screen."); return; }
  const store = config.stores.find((s) => s.id === storeId);
  const thresholds = normThresholds(store?.thresholds);
  // The board runs on a TV all day, so it carries the signed-in user's tokens and
  // refreshes them itself. Without this it would lose access once the data is locked down.
  const tokens = await getTokens();
  const payload = {
    storeId,
    storeKey: `lpc:store:${storeId}:v2`,
    storeName: store?.name || "Store",
    icon: store?.icon || null,
    thresholds,
    roles: config.roles.filter((r) => r.onBoard !== false),
    ym: ym(),
    tokens,
  };
  w.document.open();
  w.document.write(LEADERBOARD_HTML(payload));
  w.document.close();
}

/* ---------------- Login (real accounts) ---------------- */
function Login({ config, onBack, onAuthed }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const domains = config.approvedDomains || [];
  const canRegister = config.registrationOpen && domains.length > 0;

  const signIn = async () => {
    setErr(""); setOk("");
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    const res = await authSignIn(email.trim().toLowerCase(), password);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onAuthed();
  };

  const signUp = async () => {
    setErr(""); setOk("");
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) { setErr("Enter a valid email."); return; }
    if (!name.trim()) { setErr("Enter your full name."); return; }
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== password2) { setErr("The two passwords do not match."); return; }
    // The very first account created becomes the admin, so it is not domain-gated.
    if (domains.length > 0 && !domains.includes(domainOf(e))) {
      setErr("Email must be on an approved company domain (" + domains.join(", ") + ").");
      return;
    }
    setBusy(true);
    const res = await authSignUp(e, password, name.trim());
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setOk("Account created.");
    onAuthed();
  };

  const forgot = async () => {
    setErr(""); setOk("");
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) { setErr("Enter your email first."); return; }
    setBusy(true);
    const res = await authResetPassword(e);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setOk("If that email has an account, a reset link is on its way. Check your inbox.");
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><Logo size={64} animated /></div>
        <h1 className="login-title">Lead Performance</h1>
        <p className="login-sub">Holler-Classic Family of Dealerships</p>

        {!AUTH_ENABLED && <p className="setup-note">This is a preview. Real sign-in works on the hosted site.</p>}

        {mode === "signin" && (
          <>
            <label>Work email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              placeholder="you@company.com" autoComplete="username" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && signIn()} placeholder="Your password" autoComplete="current-password" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="btn wide" onClick={signIn} disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button>
            <button className="btn-link" onClick={() => { setMode("forgot"); setErr(""); setOk(""); }}>Forgot password?</button>
            <div className="login-divider"><span>or</span></div>
            <button className="btn-outline wide" onClick={() => { setMode("signup"); setErr(""); setOk(""); setPassword(""); }}>Create New Account</button>
            {onBack && <button className="btn-link" onClick={onBack}>&larr; Back to start</button>}
          </>
        )}

        {mode === "signup" && (
          <>
            <p className="setup-note">
              {canRegister
                ? "Create your account. Your group admin grants store access after you register."
                : "Create your account. Heads up: the very first account created becomes the group admin."}
            </p>
            <label>Work email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              placeholder="you@company.com" autoComplete="username" />
            <label>Full name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="First Last" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              placeholder="At least 8 characters" autoComplete="new-password" />
            <label>Confirm password</label>
            <input type="password" value={password2} onChange={(e) => { setPassword2(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && signUp()} placeholder="Repeat it" autoComplete="new-password" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="btn wide" onClick={signUp} disabled={busy}>{busy ? "Creating..." : "Create Account"}</button>
            <button className="btn-link" onClick={() => { setMode("signin"); setErr(""); setPassword(""); setPassword2(""); }}>Back to sign in</button>
          </>
        )}

        {mode === "forgot" && (
          <>
            <p className="setup-note">Enter your email and we will send a link to set a new password.</p>
            <label>Work email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && forgot()} placeholder="you@company.com" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="btn wide" onClick={forgot} disabled={busy}>{busy ? "Sending..." : "Send reset link"}</button>
            <button className="btn-link" onClick={() => { setMode("signin"); setErr(""); setOk(""); }}>Back to sign in</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Waiting on approval ---------------- */
function PendingScreen({ profile, onSignOut }) {
  const first = (profile.name || "").split(" ")[0];
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><Logo size={64} animated /></div>
        <h1 className="login-title">Almost there</h1>
        <p className="setup-note">
          Your account exists{first ? ", " + first : ""}, but no store has been assigned to it yet.
          Your group admin needs to approve you and grant access. Once they do, sign in again and you are in.
        </p>
        <button className="btn wide" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

/* ---------------- Import badge ---------------- */
function ImportBadge({ storeData, activity }) {
  const M = storeData.months[ym()];
  const t = M?.imports?.[today()] || {};
  if (activity) {
    return <span className={"badge " + (t.activity ? "badge-ok" : "badge-warn")}>{t.activity ? "✓" : "0/1"}</span>;
  }
  const done = ["delivery", "appointment", "video"].filter((k) => t[k]).length;
  return <span className={"badge " + (done === 3 ? "badge-ok" : "badge-warn")}>{done}/3</span>;
}

/* ---------------- Check Out Tracker (Daily Activity) ---------------- */
function CheckOutTracker({ config, store, data, onChange }) {
  const [query, setQuery] = useState("");
  const [day, setDay] = useState(today());
  const std = { ...DEFAULT_ACTIVITY_STANDARDS, ...(store.activityStandards || {}) };
  const activityDays = Object.keys(data.activity || {}).sort().reverse();
  const dayData = data.activity?.[day] || {};

  // Stars come from a different app that we cannot pull a report from, so they are
  // typed in. They live outside data.activity on purpose: that gets overwritten on
  // every import and would wipe them.
  const starsFor = (k) => data.stars?.[day]?.[k];
  const setStars = (k, v) => {
    const next = JSON.parse(JSON.stringify(data));
    next.stars = next.stars || {};
    next.stars[day] = next.stars[day] || {};
    if (v == null || v === "") delete next.stars[day][k];
    else next.stars[day][k] = Math.max(0, parseInt(v) || 0);
    onChange(next);
  };

  const manualFlags = data.repeatFlags || {};
  const toggleFlag = (a) => {
    const next = JSON.parse(JSON.stringify(data));
    next.repeatFlags = { ...(next.repeatFlags || {}) };
    if (next.repeatFlags[a.id]) delete next.repeatFlags[a.id];
    else next.repeatFlags[a.id] = { by: "manual", since: new Date().toISOString() };
    onChange(next, { action: next.repeatFlags[a.id] ? "Flagged repeat offender" : "Cleared repeat flag", detail: a.name });
  };

  const q = norm(query);
  const roster = (data.roster || []).filter((a) => a.roleId).sort((a, b) => a.order - b.order);

  const evalDay = (a, d) => {
    const rec = (data.activity?.[d] || {})[norm(a.name)] || {};
    const stars = data.stars?.[d]?.[norm(a.name)];
    const hasData = rec.calls != null || rec.video != null;
    const callsMet = rec.calls != null && rec.calls >= std.minCalls;
    const videoMet = rec.video != null && rec.video >= std.minVideos;
    // Once a Stars minimum is set, it is a real gate: missing counts as short, exactly
    // like calls or videos. At 0 it is recorded but never held against anyone.
    const starsRequired = (std.minStars ?? 0) > 0;
    const starsMet = !starsRequired || (stars != null && stars >= std.minStars);
    return {
      calls: rec.calls, video: rec.video, stars,
      callsMet, videoMet, starsMet, starsRequired, hasData,
      rocked: callsMet && videoMet && starsMet,   // all three, or the day is a miss
    };
  };

  // How many days this month has each person missed the bar? That is what makes
  // somebody a repeat offender rather than someone who had one bad Tuesday.
  const monthDays = activityDays.filter((d) => d.startsWith(ym()));
  const missCount = {};
  for (const a of roster) {
    missCount[a.id] = monthDays.filter((d) => {
      const e = evalDay(a, d);
      return e.hasData && !e.rocked;
    }).length;
  }

  const rows = roster.map((a) => {
    const e = evalDay(a, day);
    const misses = missCount[a.id] || 0;
    const autoFlag = std.repeatDays > 0 && misses >= std.repeatDays;
    return { a, ...e, rec: dayData[norm(a.name)] || {}, misses, autoFlag, manualFlag: !!manualFlags[a.id] };
  }).filter((r) => !q || norm(r.a.name).includes(q));

  const repeatList = roster
    .map((a) => ({ a, misses: missCount[a.id] || 0, manual: !!manualFlags[a.id] }))
    .filter((r) => r.manual || (std.repeatDays > 0 && r.misses >= std.repeatDays))
    .sort((x, y) => y.misses - x.misses);

  const rockedCount = rows.filter((r) => r.rocked).length;
  const withData = rows.filter((r) => r.hasData);
  const offenders = withData.filter((r) => !r.rocked);

  if (activityDays.length === 0)
    return <div className="empty">No Daily Activity imported yet. Drop today's Standard Daily Activity report in the Import tab to build the checkout sheet.</div>;

  return (
    <div className="checkout">
      <div className="gm-toolbar">
        <select value={day} onChange={(e) => setDay(e.target.value)}>
          {activityDays.map((d) => <option key={d} value={d}>{new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</option>)}
        </select>
        <span className="hint">Minimum standard: {std.minCalls} calls · {std.minVideos} videos. Change it in the Standards tab.</span>
      </div>
      <div className="checkout-summary">
        <span className="stat-pass">✓ {rockedCount} RockEd</span>
        <span className="stat-fail">✕ {offenders.length} below standard</span>
        <span className="stat-dim">{withData.length} of {rows.length} with data</span>
      </div>
      <div className="search-wrap">
        <span className="search-icon">⌕</span>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${store.name}`} />
        {query && <button className="search-clear" onClick={() => setQuery("")}>✕</button>}
      </div>
      {/* the sheet and the people who need a conversation, side by side. Scanning a
          table and then scrolling to find who to talk to was the wrong shape. */}
      <div className="checkout-split">
        <div className="card checkout-card">
          <table className="checkout-table">
            <thead><tr>
              <th>Name</th><th>Calls</th><th>Videos</th><th>Stars</th><th>RockEd</th><th>Repeat</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.a.id} className={!r.hasData ? "co-nodata" : r.rocked ? "co-rocked" : "co-miss"}>
                  <td><b>{r.a.name}</b></td>
                  <td className={r.hasData ? (r.callsMet ? "cell-g" : "cell-r") : ""}>
                    {r.hasData && <span className="cell-mark">{r.callsMet ? "\u2713" : "\u2717"}</span>}
                    {r.calls ?? "-"}{r.hasData && <span className="cell-need"> / {std.minCalls}</span>}
                  </td>
                  <td className={r.hasData ? (r.videoMet ? "cell-g" : "cell-r") : ""}>
                    {r.hasData && <span className="cell-mark">{r.videoMet ? "\u2713" : "\u2717"}</span>}
                    {r.video ?? "-"}{r.hasData && <span className="cell-need"> / {std.minVideos}</span>}
                  </td>
                  {/* Stars come from a different app with no report, so they are typed in. */}
                  <td className={r.starsRequired ? (r.starsMet ? "cell-g" : "cell-r") : ""}>
                    {r.starsRequired && <span className="cell-mark">{r.starsMet ? "✓" : "✗"}</span>}
                    <input className="star-inp" type="number" min="0" value={r.stars ?? ""}
                      placeholder="-" onChange={(e) => setStars(norm(r.a.name), e.target.value)} />
                    {r.starsRequired && <span className="cell-need"> / {std.minStars}</span>}
                  </td>
                  <td>{!r.hasData ? <span className="co-badge dim">no data</span>
                    : r.rocked ? <span className="co-badge yes">✓ RockEd</span>
                    : <span className="co-badge no">✗ Check out</span>}</td>
                  <td>
                    <button className={"flag-btn " + (r.manualFlag ? "on" : r.autoFlag ? "auto" : "")}
                      title={r.manualFlag ? "Flagged by you. Click to clear."
                        : r.autoFlag ? `Missed the bar on ${r.misses} days this month. Click to also flag by hand.`
                        : `Missed ${r.misses} day${r.misses === 1 ? "" : "s"} this month. Click to flag.`}
                      onClick={() => toggleFlag(r.a)}>
                      {r.manualFlag ? "\u2691 flagged" : r.autoFlag ? `\u2691 ${r.misses}x` : r.misses > 0 ? `${r.misses}x` : "-"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="checkout-side">
          {repeatList.length > 0 && (
            <div className="card repeat-card">
              <h3 className="off-title">
                Repeat offenders
                <span className="section-sub">{new Date().toLocaleDateString("en-US", { month: "long" })}</span>
              </h3>
              <p className="hint">
                Below the bar on {std.repeatDays}+ days this month, or flagged by hand.
                One bad day is noise. This is a pattern.
              </p>
              {repeatList.map((r) => (
                <div key={r.a.id} className="repeat-row">
                  <b>{r.a.name}</b>
                  <span className="repeat-count">{r.misses} day{r.misses === 1 ? "" : "s"} missed</span>
                  {r.manual && <span className="repeat-tag">flagged by you</span>}
                </div>
              ))}
            </div>
          )}
          <div className={"card offender-card " + (offenders.length === 0 ? "offender-clear" : "")}>
            <h3 className="off-title">
              {offenders.length === 0 ? "Nobody to check out" : `Check these ${offenders.length}`}
              <span className="section-sub">{new Date(day + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </h3>
            {offenders.length === 0 ? (
              <p className="hint">Everyone with data on file hit both minimums today. Worth saying so out loud.</p>
            ) : (
              <>
                <p className="hint">Furthest from standard first.</p>
                {offenders
                  .sort((a, b) => (num(a.calls) + num(a.video) * 8) - (num(b.calls) + num(b.video) * 8))
                  .map((r) => (
                    <div key={r.a.id} className="offender-row">
                      <b>{r.a.name}</b>
                      <span className="offender-detail">
                        {!r.callsMet && <span className="reason watch">Calls {r.calls ?? 0} / {std.minCalls}</span>}
                        {!r.videoMet && <span className="reason watch">Videos {r.video ?? 0} / {std.minVideos}</span>}
                      </span>
                    </div>
                  ))}
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
const num = (v) => (v == null ? 0 : v);

/* ---------------- License Plate Tracker ---------------- */
function PlateTracker({ data, onChange, userName }) {
  const [day, setDay] = useState(today());
  const [tag, setTag] = useState("");
  const [assignee, setAssignee] = useState("");
  const plates = data.plates || {}; // { day: [ {id, tag, assignee, checkedOut, checkedIn, by} ] }
  const dayPlates = plates[day] || [];
  const roster = (data.roster || []).filter((a) => a.roleId).sort((a, b) => a.order - b.order);

  const save = (nextDayPlates, audit) => {
    const next = JSON.parse(JSON.stringify(data));
    next.plates = next.plates || {};
    next.plates[day] = nextDayPlates;
    onChange(next, audit);
  };
  const addPlate = () => {
    const t = tag.trim().toUpperCase(); if (!t) return;
    if (dayPlates.some((p) => p.tag === t)) return;
    save([...dayPlates, { id: uid(), tag: t, assignee: assignee.trim(), checkedOut: true, checkedIn: false, by: userName }],
      { action: "Assigned plate", detail: `${t} → ${assignee.trim() || "unassigned"}` });
    setTag(""); setAssignee("");
  };
  const toggleIn = (id) => {
    save(dayPlates.map((p) => p.id === id ? { ...p, checkedIn: !p.checkedIn } : p));
  };
  const setPlateAssignee = (id, name) => {
    save(dayPlates.map((p) => p.id === id ? { ...p, assignee: name } : p));
  };
  const remove = (id) => save(dayPlates.filter((p) => p.id !== id));
  const carryForward = () => {
    // pull yesterday's (most recent prior day) assignments into today
    const priorDays = Object.keys(plates).filter((d) => d < day).sort().reverse();
    const prior = priorDays.length ? plates[priorDays[0]] : [];
    if (!prior.length) return;
    const existing = new Set(dayPlates.map((p) => p.tag));
    const carried = prior.filter((p) => !existing.has(p.tag)).map((p) => ({ ...p, id: uid(), checkedIn: false, checkedOut: true, by: userName }));
    save([...dayPlates, ...carried], { action: "Carried plates forward", detail: `${carried.length} from ${priorDays[0]}` });
  };

  const plateDays = Object.keys(plates).sort().reverse();

  return (
    <div className="plates">
      <div className="gm-toolbar">
        <select value={day} onChange={(e) => setDay(e.target.value)}>
          <option value={today()}>Today · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option>
          {plateDays.filter((d) => d !== today()).map((d) => <option key={d} value={d}>{new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</option>)}
        </select>
        <button className="btn secondary" onClick={carryForward}>Carry forward last day's tags</button>
        <span className="hint">Assignments are saved per day, so you can look back and see who had which plate on any date.</span>
      </div>
      <div className="card">
        <div className="inline-form">
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag / plate #" onKeyDown={(e) => e.key === "Enter" && addPlate()} style={{ width: 140 }} />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Assign to</option>
            {roster.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <button className="btn" onClick={addPlate}>Add plate</button>
        </div>
      </div>
      <div className="card">
        {dayPlates.length === 0 ? <p className="hint">No plates logged for this day yet. Add one above, or carry forward the last day's tags.</p> : (
          <table className="roster-table wide">
            <thead><tr><th>Tag</th><th>Assigned to</th><th>Checked back in</th><th>Logged by</th><th /></tr></thead>
            <tbody>
              {dayPlates.map((p) => (
                <tr key={p.id} className={p.checkedIn ? "" : "plate-out"}>
                  <td><b>{p.tag}</b></td>
                  <td>
                    <select value={p.assignee || ""} onChange={(e) => setPlateAssignee(p.id, e.target.value)}>
                      <option value="">Unassigned</option>
                      {roster.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                      {p.assignee && !roster.some((a) => a.name === p.assignee) && <option value={p.assignee}>{p.assignee}</option>}
                    </select>
                  </td>
                  <td><button className={"plate-check " + (p.checkedIn ? "in" : "out")} onClick={() => toggleIn(p.id)}>{p.checkedIn ? "✓ Returned" : "Out"}</button></td>
                  <td className="mono">{p.by || "-"}</td>
                  <td><button className="btn-x" onClick={() => remove(p.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------------- Leaderboard thresholds (per channel) ---------------- */
function ThresholdGrid({ value, onChange }) {
  const t = normThresholds(value);
  const set = (ch, key, v) => {
    const next = normThresholds(t);
    next[ch][key] = Math.max(0, Math.min(100, v));
    onChange(next);
  };
  return (
    <div className="thr-grid">
      <div className="thr-grid-head">
        <span />
        <span><span className="thr-dot g" />Green at or above</span>
        <span><span className="thr-dot y" />Yellow at or above</span>
      </div>
      {CHANNEL_LIST.map((c) => (
        <div key={c.id} className="thr-grid-row">
          <span className="thr-ch">{c.label} %</span>
          <label className="thr-inp">
            <input type="number" min="0" max="100" value={t[c.id].green}
              onChange={(e) => set(c.id, "green", parseInt(e.target.value) || 0)} />%
          </label>
          <label className="thr-inp">
            <input type="number" min="0" max="100" value={t[c.id].yellow}
              onChange={(e) => set(c.id, "yellow", parseInt(e.target.value) || 0)} />%
          </label>
        </div>
      ))}
      <p className="hint">
        Each channel is scored on its own scale, because a 25% showroom close and a 25% internet
        close are not the same achievement. At or above green shows green on The Board, at or above
        yellow shows yellow, anything below that shows red.
      </p>
    </div>
  );
}

/* ---------------- Activity Standards Editor ---------------- */
function StoreStepper({ label, value, onChange, hint }) {
  return (
    <div className="stepper-block">
      <div className="stepper-label">{label}</div>
      <div className="stepper">
        <button className="stepper-btn" onClick={() => onChange(value - 1)} disabled={value <= 1}>&minus;</button>
        <div className="stepper-value">{value}</div>
        <button className="stepper-btn" onClick={() => onChange(value + 1)}>+</button>
      </div>
      <div className="stepper-hint">{hint}</div>
    </div>
  );
}

function ActivityStandardsEditor({ config, storeId, onChange }) {
  const store = config.stores.find((s) => s.id === storeId);
  const std = store.activityStandards || DEFAULT_ACTIVITY_STANDARDS;
  const set = (field, v) => {
    const val = Math.max(0, v);
    const next = JSON.parse(JSON.stringify(config));
    const s = next.stores.find((x) => x.id === storeId);
    s.activityStandards = { ...(s.activityStandards || DEFAULT_ACTIVITY_STANDARDS), [field]: val };
    onChange(next, { store: storeId, action: "Changed activity standards", detail: `${store.name}: ${field} ${val}` });
  };
  const Stepper = ({ label, field, value, hint }) => (
    <div className="stepper-block">
      <div className="stepper-label">{label}</div>
      <div className="stepper">
        <button className="stepper-btn" onClick={() => set(field, value - 1)} disabled={value <= 0}>−</button>
        <div className="stepper-value">{value}</div>
        <button className="stepper-btn" onClick={() => set(field, value + 1)}>+</button>
      </div>
      <div className="stepper-hint">{hint}</div>
    </div>
  );
  return (
    <div className="standards">
      <div className="card">
        <h3>Daily Check Out Minimums <span className="section-sub">{store.name}</span></h3>
        <p className="hint">An associate "rocks it" for the day when they meet both minimums. These pull from the Daily Activity report's Calls and Personalized Video columns, and apply to this store only.</p>
        <div className="stepper-row">
          <Stepper label="Calls" field="minCalls" value={std.minCalls} hint="per day" />
          <Stepper label="Videos" field="minVideos" value={std.minVideos} hint="per day" />
          <Stepper label="Stars" field="minStars" value={std.minStars ?? 0} hint="0 = not required" />
          <Stepper label="Repeat after" field="repeatDays" value={std.repeatDays ?? 3} hint="days missed in a month" />
        </div>
        <div className="stepper-row">
          <StoreStepper label="Working days" value={store.workingDaysInMonth ?? 26}
            onChange={(v) => {
              const next = JSON.parse(JSON.stringify(config));
              const s = next.stores.find((x) => x.id === storeId);
              s.workingDaysInMonth = Math.max(1, Math.min(31, v));
              onChange(next, { store: storeId, action: "Set working days", detail: String(v) });
            }} hint="in the month, for pacing" />
        </div>
        <div className="preset-row">
          <span className="hint">Quick set:</span>
          <button className="btn-ghost" onClick={() => { set("minCalls", 16); setTimeout(() => set("minVideos", 2), 60); }}>16 calls · 2 videos</button>
          <button className="btn-ghost" onClick={() => { set("minCalls", 20); setTimeout(() => set("minVideos", 3), 60); }}>20 calls · 3 videos</button>
          <button className="btn-ghost" onClick={() => { set("minCalls", 25); setTimeout(() => set("minVideos", 5), 60); }}>25 calls · 5 videos</button>
        </div>
        <div className="preview-line">
          To RockEd: <b>{std.minCalls} calls</b> and <b>{std.minVideos} videos</b>
          {std.minStars > 0 ? <> and <b>{std.minStars} stars</b></> : null} in a day.
          Missing that on <b>{std.repeatDays ?? 3} days</b> in a month flags someone as a repeat offender automatically.
          {!std.minStars && " Stars are recorded but not required at 0."}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Admin overview ---------------- */
function AdminOverview({ config, adminData, onOpenStore }) {
  return (
    <div className="admin">
      <h2 className="section-title">Group Overview <span className="section-sub">{monthLabel(ym())}</span></h2>
      <div className="store-grid">
        {config.stores.map((s) => {
          const d = adminData[s.id] || emptyStoreData();
          const M = d.months?.[ym()];
          const t = M?.imports?.[today()] || {};
          const done = ["delivery", "appointment", "video"].filter((k) => t[k]).length;
          const inGrace = dayOfMonth() <= (s.graceDays ?? 10);
          let pass = 0, fail = 0, grace = 0;
          for (const a of d.roster || []) {
            if (!a.roleId) continue;
            const ev = evaluateAssociate(M?.stats?.[norm(a.name)], config.standards?.[s.id]?.[a.roleId]?.tiers);
            if (ev.status === "pass") pass++;
            else if (ev.status === "fail") { if (inGrace) grace++; else fail++; }
          }
          return (
            <button key={s.id} className="store-card" onClick={() => onOpenStore(s.id)}>
              <div className="store-card-top">
                {s.icon ? <img className="store-logo" src={s.icon} alt="" /> : <div className="store-logo placeholder">{s.name[0]}</div>}
                <div className="store-card-name">{s.name}</div>
              </div>
              <div className="store-card-row">
                <span className={"badge " + (done === 3 ? "badge-ok" : "badge-warn")}>Imports {done}/3</span>
              </div>
              <div className="store-card-stats">
                <span className="stat-pass">↑ {pass} cleared</span>
                {grace > 0 ? <span className="stat-grace">◔ {grace} in grace</span> : <span className="stat-fail">↓ {fail} restrict</span>}
                {grace > 0 && fail > 0 && <span className="stat-fail">↓ {fail} restrict</span>}
                <span className="stat-dim">{(d.roster || []).length} on roster</span>
              </div>
              <div className="store-card-open">Open →</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Lead Board ---------------- */
function Board({ config, store, data, dragName, setDragName, onMove, onSetRestriction, readOnly, filter, onClearFilter }) {
  const [query, setQuery] = useState("");
  const M = data.months?.[ym()];
  const names = M?.names || {};
  // An associate is only "incomplete" if they're missing one of the three REQUIRED
  // reports. The optional Board channels (phone/showroom) and the Daily Activity
  // report also land in `names`, and mapping those through REPORTS returned undefined,
  // which crashed the whole page the moment anyone was given a role.
  const requiredTypes = Object.keys(REPORTS).filter((t) => names[t]);
  const missingReports = (nameKey) =>
    requiredTypes
      .filter((t) => !(names[t] || []).includes(nameKey))
      .map((t) => reportLabel(t));
  const importedTypes = requiredTypes;

  const graceDays = store.graceDays ?? 10;
  const inGrace = new Date().getDate() <= graceDays;
  const restrictions = data.restrictions || {};

  // rankings: passing associates ordered by how far they surpass standard
  const isRestricted = (a) => {
    const r = restrictions[a.id];
    return r && (!r.until || new Date(r.until) > new Date());
  };
  const ranked = [];
  for (const role of config.roles) {
    const tiers = config.standards?.[store.id]?.[role.id]?.tiers;
    for (const a of (data.roster || []).filter((x) => x.roleId === role.id)) {
      if (isRestricted(a)) continue;
      const ev = evaluateAssociate(M?.stats?.[norm(a.name)], tiers);
      if (ev.status === "pass") ranked.push({ name: a.name, role, surpass: ev.surpass, opps: ev.opps });
    }
  }
  ranked.sort((a, b) => b.surpass - a.surpass);
  const top3 = ranked.slice(0, 3);
  const rankOf = {}; top3.forEach((r, i) => (rankOf[norm(r.name)] = i + 1));
  // "wildly surpassing" = 40%+ average over every requirement
  const stars = new Set(ranked.filter((r) => r.surpass >= 0.4).map((r) => norm(r.name)));

  // last-month recap: judged under that month's frozen standards
  const P = data.months?.[prevYm()];
  const recap = [];
  if (inGrace && P) {
    for (const role of config.roles) {
      const tiers = P.standardsSnapshot?.[role.id]?.tiers || config.standards?.[store.id]?.[role.id]?.tiers;
      for (const a of (data.roster || []).filter((x) => x.roleId === role.id)) {
        const ev = evaluateAssociate(P.stats?.[norm(a.name)], tiers);
        if (ev.status === "fail") recap.push({ name: a.name, role, focus: ev.failures });
      }
    }
  }

  const q = norm(query);
  const matches = (a) => !q || norm(a.name).includes(q);

  // Which bucket is a person in? Exactly the rules the hero tiles count with, so the
  // numbers up there and the cards down here can never disagree.
  const bucketOf = (a) => {
    const r = restrictions[a.id];
    if (r && (!r.until || new Date(r.until) > new Date())) return "off";
    const tiers = config.standards?.[store.id]?.[a.roleId]?.tiers;
    const ev = evaluateAssociate(M?.stats?.[norm(a.name)], tiers);
    if (ev.status === "pass") return "cleared";
    if (ev.status === "fail") return "attention";
    return "other";
  };
  const inFilter = (a) => !filter || bucketOf(a) === filter;

  const sections = config.roles.map((role) => ({
    role,
    people: (data.roster || []).filter((a) => a.roleId === role.id && matches(a) && inFilter(a)).sort((a, b) => a.order - b.order),
  }));
  // unassigned people have no standards to be judged by, so a bucket filter hides them
  const unassigned = filter ? [] : (data.roster || []).filter((a) => !a.roleId && matches(a)).sort((a, b) => a.order - b.order);
  const totalMatches = sections.reduce((n, s) => n + s.people.length, 0) + unassigned.length;

  if ((data.roster || []).length === 0)
    return <div className="empty">No associates yet. Drop today's three reports in the Import tab and the roster builds itself.</div>;

  return (
    <div className="board">
      <div className="search-wrap">
        <span className="search-icon">⌕</span>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search associates at ${store.name}`} />
        {query && <button className="search-clear" onClick={() => setQuery("")}>✕</button>}
      </div>
      {query && <p className="hint search-count">{totalMatches} match{totalMatches === 1 ? "" : "es"}</p>}

      {!query && top3.length > 0 && (
        <div className="card leaderboard">
          <h3 className="lb-title">Top Performers <span className="section-sub">furthest above standard</span></h3>
          <div className="lb-row">
            {top3.map((r, i) => (
              <div key={r.name} className={"lb-item lb-" + (i + 1)}>
                <div className="lb-medal">{["①", "②", "③"][i]}</div>
                <div className="lb-name">{r.name}</div>
                <div className="lb-meta" style={{ color: r.role.color }}>{r.role.name}</div>
                <div className="lb-surpass">+{Math.round(r.surpass * 100)}% over target</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!query && inGrace && (
        <div className="card grace-banner">
          <span className="badge badge-warn">Grace period</span>
          <span>Month-to-date numbers swing hard this early, so no restrictions are recommended through day {graceDays}. Anything below standard shows as a focus area instead. You can change the grace window in Standards.</span>
        </div>
      )}
      {!query && recap.length > 0 && (
        <div className="card recap">
          <h3 className="role-header">{monthLabel(prevYm())} Wrap-Up: Focus Areas This Month</h3>
          <p className="hint">These associates finished last month below standard (judged by last month's requirements). Use the first {graceDays} days to coach these before restrictions resume.</p>
          {recap.map((r, i) => (
            <div key={i} className="recap-row">
              <span className="recap-name" style={{ color: r.role.color }}>●</span>
              <b>{r.name}</b>
              <span className="recap-chips">
                {r.focus.map((f, j) => (
                  <span key={j} className="reason watch">{f.def.short} {f.val == null ? "(no data)" : (f.def.kind === "pct" ? fmtPct(f.val) : fmtNum(f.val))} → {f.def.kind === "pct" ? f.min + "%" : f.min}</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      {!query && inGrace && P && recap.length === 0 && (
        <div className="card recap">
          <h3 className="role-header">{monthLabel(prevYm())} Wrap-Up</h3>
          <p className="hint">Everyone on the roster finished last month at or above standard. Clean slate.</p>
        </div>
      )}
      {filter && (
        <div className="filter-bar">
          <span className="filter-what">
            Showing only <b>{filter === "cleared" ? "cleared to grab leads" : filter === "attention" ? "needs attention" : "off leads"}</b>
            {" \u00b7 "}{totalMatches} {totalMatches === 1 ? "person" : "people"}
          </span>
          <button className="btn-x" onClick={onClearFilter}>Show everyone</button>
        </div>
      )}
      {sections.map(({ role, people }) => (
        <section key={role.id} className="card role-section" style={{ "--role": role.color }}
          onDragOver={(e) => !readOnly && e.preventDefault()}
          onDrop={(e) => { if (readOnly) return; e.preventDefault(); if (dragName) onMove(dragName, null, role.id); setDragName(null); }}>
          <h3 className="role-header"><span className="role-swatch" />{role.name} <span className="role-count">{people.length}</span></h3>
          {people.length === 0 && <div className="role-empty">{query ? "No matches in this section" : readOnly ? "No associates in this section" : "Drag associates here"}</div>}
          {people.map((a) => {
            const stats = M?.stats?.[norm(a.name)];
            const ev = evaluateAssociate(stats, config.standards?.[store.id]?.[role.id]?.tiers);
            const missing = importedTypes.length ? missingReports(norm(a.name)) : [];
            const missingData = missingMetricData(stats, config.standards?.[store.id]?.[role.id]?.tiers);
            const incomplete = importedTypes.length > 0 && (missing.length > 0 || missingData.length > 0);
            return (
              <AssociateRow key={a.id} a={a} stats={stats} ev={ev} missing={missing} incomplete={incomplete}
                grace={inGrace} rank={rankOf[norm(a.name)]} star={stars.has(norm(a.name))} readOnly={readOnly}
                restriction={restrictions[a.id]} onSetRestriction={(r) => onSetRestriction(a, r)}
                onDragStart={() => setDragName(a.name)}
                onDropOn={() => { if (dragName && dragName !== a.name) onMove(dragName, a.name, role.id); setDragName(null); }} />
            );
          })}
        </section>
      ))}
      {unassigned.length > 0 && (
        <section className="card role-section unassigned" style={{ "--role": "#8E8E93" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (dragName) onMove(dragName, null, null); setDragName(null); }}>
          <h3 className="role-header"><span className="role-swatch" />Needs a Position <span className="role-count">{unassigned.length}</span></h3>
          <p className="hint">These names came in from reports. Drag each one into a position to start scoring them.</p>
          {unassigned.map((a) => (
            <div key={a.id} className="assoc-row" draggable
              onDragStart={() => setDragName(a.name)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragName && dragName !== a.name) onMove(dragName, a.name, null); setDragName(null); }}>
              <span className="grip">⠿</span><span className="assoc-name">{a.name}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function AssociateRow({ a, stats, ev, missing, incomplete, grace, rank, star, restriction, onSetRestriction, onDragStart, onDropOn, readOnly }) {
  const [open, setOpen] = useState(false);
  const [showRestrict, setShowRestrict] = useState(false);
  const [days, setDays] = useState(14);
  const pct = ev.cap ? Math.min(100, (ev.opps / ev.cap) * 100) : 0;
  const softFail = ev.status === "fail" && grace;

  const restrictedNow = restriction && (!restriction.until || new Date(restriction.until) > new Date());
  const daysLeft = restriction?.until ? Math.ceil((new Date(restriction.until) - new Date()) / 86400000) : null;

  const confirmRestrict = () => {
    const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
    onSetRestriction({ since: new Date().toISOString(), until, reasons: failureText(ev) });
    setShowRestrict(false);
  };

  return (
    <div className={"assoc-card " + (ev.status || "") + (incomplete ? " incomplete" : "") + (restrictedNow ? " is-restricted" : "")} draggable={!readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      onDragOver={(e) => !readOnly && e.preventDefault()}
      onDrop={(e) => { if (readOnly) return; e.preventDefault(); onDropOn(); }}>
      <div className="assoc-row" onClick={() => setOpen(!open)}>
        {!readOnly && <span className="grip">⠿</span>}
        {rank && <span className={"rank-badge rank-" + rank}>{["①", "②", "③"][rank - 1]}</span>}
        <span className="assoc-name">{a.name}</span>
        {star && <span className="star-badge" title="Wildly surpassing standard">★ Crushing it</span>}
        {incomplete && <span className="flag flag-gray" title={"Waiting on: " + missing.join(", ")}>⚑ incomplete file</span>}
        <span className="assoc-leads">{ev.opps ?? 0}<span className="of-cap"> / {ev.cap ?? "-"}</span></span>
        {restrictedNow ? <span className="verdict verdict-off">Off leads{daysLeft != null ? ` · ${daysLeft}d left` : ""}</span> : (<>
          {ev.status === "pass" && <span className="verdict verdict-pass">Cleared to Grab Leads</span>}
          {softFail && <span className="verdict verdict-grace">Early month</span>}
          {ev.status === "fail" && !grace && <span className="verdict verdict-fail">Restrict leads</span>}
          {ev.status === "no-standards" && <span className="verdict verdict-dim">No standards</span>}
        </>)}
      </div>
      {ev.cap != null && (
        <div className="gauge">
          <div className={"gauge-fill " + (ev.status === "fail" && !grace && ev.atCap ? "gauge-red" : "")} style={{ width: pct + "%" }} />
          <div className="gauge-notch" style={{ left: "100%" }} />
        </div>
      )}
      {incomplete && (
        <div className="reasons gray-note">
          Not all reports are in yet for this associate. {missing.length > 0 ? `Waiting on: ${missing.join(", ")}.` : "Some required numbers are blank."} The status stays on hold until the file is complete.
        </div>
      )}
      {restrictedNow && (
        <div className="reasons off-note">
          Confirmed off leads since {new Date(restriction.since).toLocaleDateString()}.
          {restriction.until ? ` Set to re-evaluate on ${new Date(restriction.until).toLocaleDateString()}.` : " No re-evaluation date set."}
          {!readOnly && <button className="btn-x" onClick={() => onSetRestriction(null)}>Put back on leads</button>}
        </div>
      )}
      {softFail && !restrictedNow && (
        <div className="reasons watch-note">
          Working toward:{" "}
          {ev.failures.map((f, i) => (
            <span key={i} className="reason watch">
              {f.def.short} {f.val == null ? "(no data)" : (f.def.kind === "pct" ? fmtPct(f.val) : fmtNum(f.val))} → {f.def.kind === "pct" ? f.min + "%" : f.min}
            </span>
          ))}
          <span className="hint"> No restriction recommended during the grace period.</span>
        </div>
      )}
      {ev.status === "fail" && !grace && !incomplete && !restrictedNow && (
        <div className="reasons">
          <div>Restrict leads because of:{" "}
            {ev.failures.map((f, i) => (
              <span key={i} className="reason">
                {f.def.short} {f.val == null ? "(no data)" : (f.def.kind === "pct" ? fmtPct(f.val) : fmtNum(f.val))}, needs {f.def.kind === "pct" ? f.min + "%" : f.min}
              </span>
            ))}
          </div>
          {!readOnly && (!showRestrict ? (
            <button className="btn-confirm" onClick={() => setShowRestrict(true)}>Confirm removed from leads</button>
          ) : (
            <div className="restrict-form">
              <span>Re-evaluate in</span>
              <input type="number" min="0" max="90" value={days} onChange={(e) => setDays(Math.max(0, Math.min(90, parseInt(e.target.value) || 0)))} />
              <span>days</span>
              <button className="btn" onClick={confirmRestrict}>Confirm</button>
              <button className="btn-x" onClick={() => setShowRestrict(false)}>Cancel</button>
              <span className="hint">{days > 0 ? `Comes back up for review on ${new Date(Date.now() + days * 86400000).toLocaleDateString()}. Set 0 for no auto date.` : "No automatic re-evaluation date."}</span>
            </div>
          ))}
        </div>
      )}
      {ev.status === "pass" && ev.nextCap && !restrictedNow && (
        <div className="reasons pass-note">
          {star ? "Blowing past every requirement. " : `Tier ${ev.tierIndex + 1} requirements met. `}Cleared up to {ev.nextCap} leads.
        </div>
      )}
      {open && stats && (
        <div className="detail">
          {Object.entries(METRICS).map(([k, def]) => (
            <div key={k} className={"detail-cell" + (stats[k] == null ? " blank" : "")}><span>{def.short}</span><b>{def.kind === "pct" ? fmtPct(stats[k]) : fmtNum(stats[k])}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Combined oversight board (read-only) ---------------- */
function CombinedBoard({ config, stores, adminData, onOpenStore }) {
  const [query, setQuery] = useState("");
  const q = norm(query);

  // aggregate every associate across the assigned stores
  const rows = [];
  for (const store of stores) {
    const d = adminData[store.id]; if (!d) continue;
    const M = d.months?.[ym()];
    const restrictions = d.restrictions || {};
    for (const role of config.roles) {
      const tiers = config.standards?.[store.id]?.[role.id]?.tiers;
      for (const a of (d.roster || []).filter((x) => x.roleId === role.id).sort((x, y) => x.order - y.order)) {
        if (q && !norm(a.name).includes(q)) continue;
        const ev = evaluateAssociate(M?.stats?.[norm(a.name)], tiers);
        const r = restrictions[a.id];
        const off = r && (!r.until || new Date(r.until) > new Date());
        rows.push({ store, role, name: a.name, ev, off });
      }
    }
  }
  const counts = {
    pass: rows.filter((r) => !r.off && r.ev.status === "pass").length,
    fail: rows.filter((r) => !r.off && r.ev.status === "fail").length,
    off: rows.filter((r) => r.off).length,
  };
  // group by store for display
  const byStore = stores.map((s) => ({ store: s, people: rows.filter((r) => r.store.id === s.id) }));

  return (
    <div className="board">
      <h2 className="section-title">BDC Oversight <span className="section-sub">{stores.map((s) => s.name).join(" · ")}</span></h2>
      <div className="combined-summary">
        <span className="stat-pass">↑ {counts.pass} cleared</span>
        <span className="stat-fail">↓ {counts.fail} restrict</span>
        <span className="stat-dim">◑ {counts.off} off leads</span>
      </div>
      <div className="search-wrap">
        <span className="search-icon">⌕</span>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search across all my stores" />
        {query && <button className="search-clear" onClick={() => setQuery("")}>✕</button>}
      </div>
      {byStore.map(({ store, people }) => (
        <section key={store.id} className="card combined-store">
          <div className="combined-store-head">
            <div className="combined-store-name">
              {store.icon ? <img className="store-logo" src={store.icon} alt="" /> : <div className="store-logo placeholder">{store.name[0]}</div>}
              {store.name}
            </div>
            <button className="btn-quiet" onClick={() => onOpenStore(store.id)}>Open store →</button>
          </div>
          {people.length === 0 && <p className="hint">{query ? "No matches at this store." : "No associates yet."}</p>}
          {people.map((r, i) => (
            <div key={i} className="combined-row">
              <span className="combined-role-dot" style={{ background: r.role.color }} />
              <span className="assoc-name">{r.name}</span>
              <span className="combined-role-label">{r.role.name}</span>
              <span className="assoc-leads">{r.ev.opps ?? 0}<span className="of-cap"> / {r.ev.cap ?? "-"}</span></span>
              {r.off ? <span className="verdict verdict-off">Off leads</span>
                : r.ev.status === "pass" ? <span className="verdict verdict-pass">Cleared</span>
                : r.ev.status === "fail" ? <span className="verdict verdict-fail">Restrict</span>
                : <span className="verdict verdict-dim">No standards</span>}
            </div>
          ))}
        </section>
      ))}
      <p className="hint">This is a read-only oversight view. To make changes, open a specific store, though your account is set to view-only there as well.</p>
    </div>
  );
}

/* ---------------- First-run welcome (managers) ---------------- */
function WelcomeCard({ store, onDismiss }) {
  return (
    <div className="card welcome">
      <div className="welcome-head">
        <h3>Welcome to the Lead Performance Tracker</h3>
        <button className="btn-x" onClick={onDismiss}>Got it ✕</button>
      </div>
      <p className="welcome-lede">
        This is where {store?.name || "your store"} tracks who has earned the right to take more internet leads.
        The idea is simple: handle your leads well, and you unlock the next one.
      </p>
      <div className="welcome-steps">
        <div className="welcome-step">
          <span className="ws-num">1</span>
          <div>
            <b>Import each morning</b>
            <p>Drop the DriveCentric exports on the Import tab. The tool sorts out which report is which.</p>
          </div>
        </div>
        <div className="welcome-step">
          <span className="ws-num">2</span>
          <div>
            <b>Read the board</b>
            <p>Green means cleared to grab leads. Red means their numbers say to pause them. The reasons are listed on each card.</p>
          </div>
        </div>
        <div className="welcome-step">
          <span className="ws-num">3</span>
          <div>
            <b>Act, then confirm</b>
            <p>If you take someone off leads, hit "Confirm removed from leads" so the tool knows and can re-check them later.</p>
          </div>
        </div>
      </div>
      <p className="hint">No one is restricted during the first days of the month while numbers settle, you'll see "Early month" instead. This card won't show again.</p>
    </div>
  );
}

/* ---------------- Backup / restore ---------------- */
function BackupPanel({ config, adminData, session, onRestoreAll, onRestoreStore }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [autoList, setAutoList] = useState(null);

  useEffect(() => {
    loadShared(BACKUP_INDEX_KEY, []).then(setAutoList).catch(() => setAutoList([]));
  }, []);

  // pull one of the automatic snapshots back out of the database
  const fetchAuto = async (id) => await loadShared(backupKey(id), null);

  const [orphans, setOrphans] = useState(null);

  // Store data lives under lpc:store:{id}:v2. If a store vanished from config, the
  // row is still there, just unreferenced. Find those.
  const scanOrphans = async () => {
    setBusy(true); setMsg("");
    const keys = await listStoreKeys();
    const known = new Set(config.stores.map((s) => s.id));
    const found = [];
    for (const k of keys) {
      const id = k.split(":")[2];
      if (!id || known.has(id)) continue;
      const d = await loadShared(k, null);
      if (!d) continue;
      const roster = (d.roster || []).length;
      const months = Object.keys(d.months || {}).length;
      if (roster === 0 && months === 0) continue;  // nothing worth recovering
      found.push({ id, key: k, roster, months });
    }
    setOrphans(found);
    setBusy(false);
    if (found.length === 0) setMsg("");
  };

  const recoverOrphan = async (o) => {
    // Look through the automatic backups for the last time this store was properly
    // configured, so its real name, logo and colours come back too rather than
    // being reset to a blank default.
    let found = null;
    for (const b of (autoList || [])) {
      const snap = await fetchAuto(b.id);
      const s = snap?.config?.stores?.find((x) => x.id === o.id);
      if (s) { found = { store: s, standards: snap.config.standards?.[o.id], when: b.t }; break; }
    }

    const suggested = found
      ? found.store.name
      : o.id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    const name = window.prompt(
      found
        ? "Restoring this store from the backup taken " + new Date(found.when).toLocaleString() +
          ". Its logo and colours are coming back too. Name:"
        : "No backup found for this store, so its logo and colours will start fresh. What should it be called?",
      suggested
    );
    if (!name || !name.trim()) return;

    setBusy(true);
    const next = JSON.parse(JSON.stringify(config));
    next.stores.push(found
      ? { ...found.store, name: name.trim() }
      : { id: o.id, name: name.trim(), icon: null, brand: { ...DEFAULT_BRAND } });

    if (found?.standards) {
      next.standards[o.id] = JSON.parse(JSON.stringify(found.standards));
    } else if (!next.standards[o.id]) {
      next.standards[o.id] = {};
      for (const r of next.roles) next.standards[o.id][r.id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
    }

    const ok = await saveShared(CONFIG_KEY, next);
    setBusy(false);
    if (!ok) { setMsg("Couldn't save. You may not have permission."); return; }
    await appendAudit({ user: session?.name, action: "Recovered store", detail: `${name.trim()} (${o.id})` });
    setMsg(`${name.trim()} is back${found ? ", with its logo, colours and standards" : ""}. Reload the page to see it.`);
    setOrphans((list) => (list || []).filter((x) => x.id !== o.id));
  };

  const downloadAuto = async (b) => {
    setBusy(true);
    const data = await fetchAuto(b.id);
    setBusy(false);
    if (!data) { setMsg("That backup couldn't be read."); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lpc-backup-${b.t.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Downloaded.");
  };

  const restoreAuto = async (b) => {
    if (!window.confirm(
      "Restore the automatic backup from " + new Date(b.t).toLocaleString() + "?" +
      String.fromCharCode(10, 10) +
      "This OVERWRITES everything currently in the tool: all stores, rosters, imports, standards, and settings. It cannot be undone." +
      String.fromCharCode(10, 10) +
      "Download a fresh backup first if you're unsure."
    )) return;
    setBusy(true);
    const data = await fetchAuto(b.id);
    if (!data) { setBusy(false); setMsg("That backup couldn't be read."); return; }
    await onRestoreAll(data);
    setBusy(false);
    setMsg("Restored. Reload the page to see it everywhere.");
  };

  const download = async () => {
    setBusy(true);
    try {
      const audit = await loadShared(AUDIT_KEY, []);
      const payload = {
        app: "lead-performance-calculator",
        version: 2,
        exportedAt: new Date().toISOString(),
        config,
        stores: adminData,
        audit,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lpc-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Backup downloaded (${config.stores.length} stores).`);
    } catch (e) {
      setMsg("Couldn't build the backup. Try again.");
    }
    setBusy(false);
  };

  const restore = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = async () => {
      let data;
      try { data = JSON.parse(r.result); }
      catch { setMsg("That file isn't valid JSON."); return; }
      if (data.app !== "lead-performance-calculator" || !data.config) {
        setMsg("That doesn't look like a Lead Performance backup file."); return;
      }
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : "an unknown date";
      if (!window.confirm(`Restore the backup from ${when}?\n\nThis OVERWRITES everything currently in the tool: all stores, rosters, imports, standards, and users. This cannot be undone.\n\nConsider downloading a fresh backup first.`)) return;
      setBusy(true);
      await onRestoreAll(data);
      setBusy(false);
      setMsg("Restored. Reload the page to see it everywhere.");
    };
    r.readAsText(file);
  };

  return (
    <div className="settings">
      <div className="card">
        <h3>Backup</h3>
        <p className="hint">
          Everything lives in one database with no version history, so a bad import, an accidental delete, or two people saving at once can lose data with no way back.
          Download a backup regularly, and always before a big change. The file holds every store, roster, import, standard, and user.
        </p>
        <div className="inline-form">
          <button className="btn" onClick={download} disabled={busy}>Download backup</button>
          <label className="btn-ghost file-btn">
            Restore from file
            <input type="file" accept="application/json,.json" style={{ display: "none" }}
              onChange={(e) => { restore(e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
        {msg && <div className="login-ok" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      <div className="card recover-card">
        <h3>Recover missing stores</h3>
        <p className="hint">
          If a store disappeared from the tool but you know you created it, its data is very likely
          still in the database, just no longer listed. This scans for store data that isn't attached
          to any store and offers to put it back, with its roster, imports, and history intact.
        </p>
        <button className="btn" disabled={busy} onClick={scanOrphans}>Scan for missing stores</button>
        {orphans !== null && (
          orphans.length === 0
            ? <p className="hint" style={{ marginTop: 10 }}>Nothing orphaned. Every store with data is showing in the tool.</p>
            : (
              <div className="snap-list" style={{ marginLeft: 0, marginTop: 10 }}>
                {orphans.map((o) => (
                  <div key={o.id} className="snap-row">
                    <span className="snap-when">{o.id}</span>
                    <span className="snap-reason">
                      {o.roster} on roster, {o.months} month{o.months === 1 ? "" : "s"} of data
                    </span>
                    <button className="btn" disabled={busy} onClick={() => recoverOrphan(o)}>Restore this store</button>
                  </div>
                ))}
              </div>
            )
        )}
      </div>

      <div className="card">
        <h3>Automatic backups</h3>
        <p className="hint">
          The tool saves a full snapshot of everything once a day, the first time you open it.
          Nothing to remember and nothing to schedule. The last {KEEP_BACKUPS} are kept.
        </p>
        {autoList === null ? <p className="hint">Loading backups...</p>
          : autoList.length === 0 ? <p className="hint">No automatic backup yet. One will be written the next time you open the tool.</p>
          : (
            <div className="snap-list" style={{ marginLeft: 0 }}>
              {autoList.map((b) => (
                <div key={b.id} className="snap-row">
                  <span className="snap-when">{new Date(b.t).toLocaleString()}</span>
                  <span className="snap-reason">{b.stores} store{b.stores === 1 ? "" : "s"}</span>
                  <button className="btn-x" disabled={busy} onClick={() => downloadAuto(b)}>Download</button>
                  <button className="btn-x" disabled={busy} onClick={() => restoreAuto(b)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        <p className="hint">
          One caveat worth knowing: these live in the same database as your data, so they protect you
          from a bad import or an accidental delete, but not from losing the Supabase project itself.
          Download a copy now and then and keep it somewhere else.
        </p>
      </div>

      <div className="card">
        <h3>Restore points</h3>
        <p className="hint">The tool automatically saves the state of a store right before every import. If an import goes wrong, roll that store back here. The last 8 are kept per store.</p>
        {config.stores.map((s) => {
          const snaps = adminData[s.id]?.snapshots || [];
          return (
            <div key={s.id} className="snap-store">
              <div className="snap-store-name">
                {s.icon ? <img className="store-logo" src={s.icon} alt="" /> : <div className="store-logo placeholder">{s.name[0]}</div>}
                <b>{s.name}</b>
                <span className="hint">{snaps.length ? `${snaps.length} restore point${snaps.length === 1 ? "" : "s"}` : "no restore points yet"}</span>
              </div>
              {snaps.length > 0 && (
                <div className="snap-list">
                  {snaps.map((sn, i) => (
                    <div key={i} className="snap-row">
                      <span className="snap-when">{new Date(sn.t).toLocaleString()}</span>
                      <span className="snap-reason">{sn.reason}{sn.by ? ` · ${sn.by}` : ""}</span>
                      <button className="btn-x" onClick={() => {
                        if (!window.confirm(`Roll ${s.name} back to ${new Date(sn.t).toLocaleString()}?\n\nAnything imported or changed at this store since then will be lost.`)) return;
                        onRestoreStore(s.id, sn);
                      }}>Restore this</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Channel prompt (no more guessing from filenames) ---------------- */
function ChannelPrompt({ pending, onCancel, onConfirm }) {
  // Internet is the report imported every day and the one that feeds the lead
  // standards, so it is the sensible default. Phone and Showroom are optional extras
  // for The Board. Still shown for confirmation so nothing is silently misfiled.
  const [picks, setPicks] = useState(() => pending.ambiguous.map((_, i) => (i === 0 ? "delivery-internet" : "")));
  const allPicked = picks.every((p) => p);
  const dupes = picks.filter(Boolean).length !== new Set(picks.filter(Boolean)).size;

  return (
    <div className="wiz-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="wiz" style={{ maxWidth: 560 }}>
        <div className="wiz-head">
          <h3>Which delivery report is this?</h3>
          <button className="btn-x" onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding: "8px 24px 4px" }}>
          <p className="hint">
            These are delivery reports, but they're identical in format so the file name is the only clue, and it didn't say.
            Tell the tool which channel each one is. Naming the files with "internet", "phone", or "showroom" skips this step next time.
          </p>
          {pending.ambiguous.map((f, i) => (
            <div key={i} className="chan-row">
              <span className="chan-file">{f.fileName}</span>
              <select value={picks[i]} onChange={(e) => { const n = [...picks]; n[i] = e.target.value; setPicks(n); }}>
                <option value="">Select a channel</option>
                <option value="delivery-internet">Internet</option>
                <option value="delivery-phone">Phone</option>
                <option value="delivery-showroom">Showroom</option>
                <option value="delivery-campaign">Campaign (units only)</option>
              </select>
            </div>
          ))}
          {dupes && <div className="login-err">Two files are set to the same channel. Each channel should only be imported once.</div>}
        </div>
        <div className="wiz-foot">
          <button className="btn-x" onClick={onCancel}>Cancel import</button>
          <button className="btn" disabled={!allPicked || dupes}
            onClick={() => onConfirm(pending.ambiguous.map((f, i) => ({ rows: f.rows, type: picks[i], fileName: f.fileName })))}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Channel prompt end ---------------- */

/* ---------------- Store wizard (create / edit before it goes live) ---------------- */
function StoreWizard({ config, store, onCancel, onSave }) {
  const editing = !!store;
  const [name, setName] = useState(store?.name || "");
  const [icon, setIcon] = useState(store?.icon || null);
  const [brand, setBrand] = useState(store?.brand || { ...DEFAULT_BRAND });
  const [thresholds, setThresholds] = useState(() => normThresholds(store?.thresholds));
  const [act, setAct] = useState(store?.activityStandards || { ...DEFAULT_ACTIVITY_STANDARDS });
  const [graceDays, setGraceDays] = useState(store?.graceDays ?? 10);
  const [cropSrc, setCropSrc] = useState(null);
  const [err, setErr] = useState("");

  const id = editing ? store.id : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const idTaken = !editing && id && config.stores.some((s) => s.id === id);

  const pickFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setCropSrc(r.result);
    r.readAsDataURL(file);
  };

  const applyPreset = (p) => setBrand({ primary: p.primary, deep: p.deep, accent: p.accent });

  const save = () => {
    if (!name.trim()) { setErr("Give the store a name."); return; }
    if (!id) { setErr("That name doesn't make a valid store ID. Try adding a letter or number."); return; }
    if (idTaken) { setErr("A store with that name already exists."); return; }
    onSave({ id, name: name.trim(), icon, brand, thresholds, activityStandards: act, graceDays });
  };

  return (
    <div className="wiz-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="wiz">
        <div className="wiz-head">
          <h3>{editing ? `Customize ${store.name}` : "New Store"}</h3>
          <button className="btn-x" onClick={onCancel}>✕</button>
        </div>

        <div className="wiz-body">
          <div className="wiz-form">
            <label>Store name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="e.g. Audi North Orlando" />
            {editing && <p className="hint">Rename it freely. Its roster, imports, and history are tied to the store itself, not to what it is called, so nothing is lost.</p>}

            <label>Manufacturer</label>
            <div className="wiz-presets">
              {BRAND_PRESETS.map((p) => (
                <button key={p.id} className={"wiz-preset " + (brand.primary === p.primary && brand.deep === p.deep ? "on" : "")}
                  onClick={() => applyPreset(p)} title={p.label}>
                  <span className="wiz-swatch" style={{ background: `linear-gradient(130deg, ${p.primary}, ${p.deep})` }}>
                    <span className="wiz-swatch-dot" style={{ background: p.accent }} />
                  </span>
                  <span className="wiz-preset-label">{p.label}</span>
                </button>
              ))}
            </div>

            <label>Fine-tune colors</label>
            <div className="wiz-colors">
              <label className="wiz-color">Primary
                <input type="color" value={brand.primary} onChange={(e) => setBrand({ ...brand, primary: e.target.value })} />
              </label>
              <label className="wiz-color">Deep
                <input type="color" value={brand.deep} onChange={(e) => setBrand({ ...brand, deep: e.target.value })} />
              </label>
              <label className="wiz-color">Accent
                <input type="color" value={brand.accent} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} />
              </label>
            </div>

            <label>Logo</label>
            <div className="wiz-logo-row">
              {icon ? <img className="store-logo" src={icon} alt="" /> : <div className="store-logo placeholder">{(name.trim()[0] || "?").toUpperCase()}</div>}
              <label className="btn-ghost file-btn">
                {icon ? "Replace" : "Upload"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ""; }} />
              </label>
              {icon && <button className="btn-x" onClick={() => setCropSrc(icon)}>Crop</button>}
              {icon && <button className="btn-x" onClick={() => setIcon(null)}>Remove</button>}
            </div>

            <label>Leaderboard colors</label>
            <ThresholdGrid value={thresholds} onChange={setThresholds} />

            <label>Daily check out minimums</label>
            <div className="wiz-nums">
              <label className="thr-label">Calls
                <input type="number" min="0" value={act.minCalls}
                  onChange={(e) => setAct({ ...act, minCalls: Math.max(0, parseInt(e.target.value) || 0) })} />
              </label>
              <label className="thr-label">Videos
                <input type="number" min="0" value={act.minVideos}
                  onChange={(e) => setAct({ ...act, minVideos: Math.max(0, parseInt(e.target.value) || 0) })} />
              </label>
              <label className="thr-label">Grace days
                <input type="number" min="0" max="28" value={graceDays}
                  onChange={(e) => setGraceDays(Math.max(0, Math.min(28, parseInt(e.target.value) || 0)))} />
              </label>
            </div>

            {err && <div className="login-err">{err}</div>}
            {idTaken && <div className="login-err">A store with that name already exists.</div>}
          </div>

          {/* live preview of exactly what the manager will see */}
          <div className="wiz-preview">
            <div className="wiz-preview-label">Manager's view</div>
            <div className="wiz-hero" style={{ "--sp": brand.primary, "--sd": brand.deep, "--sa": brand.accent }}>
              <div className="wiz-hero-band">
                <div className="wiz-hero-id">
                  <div className="wiz-hero-logo">
                    {icon ? <img src={icon} alt="" /> : <Logo size={34} />}
                  </div>
                  <div>
                    <div className="wiz-hero-greet">Good morning</div>
                    <div className="wiz-hero-name">{name.trim() || "Your Store"}</div>
                  </div>
                </div>
                <div className="wiz-hero-ring">
                  <svg width="52" height="52" viewBox="0 0 52 52">
                    <circle cx="26" cy="26" r="19" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="5" />
                    <circle cx="26" cy="26" r="19" fill="none" stroke={brand.accent} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${0.72 * 2 * Math.PI * 19} ${2 * Math.PI * 19}`} transform="rotate(-90 26 26)" />
                  </svg>
                  <span className="wiz-hero-pct">72%</span>
                </div>
              </div>
              <div className="wiz-hero-tiles">
                <div className="wiz-tile" style={{ borderLeftColor: "#30B155" }}><b>8</b><span>Cleared</span></div>
                <div className="wiz-tile" style={{ borderLeftColor: "#E5473C" }}><b>2</b><span>Attention</span></div>
                <div className="wiz-tile" style={{ borderLeftColor: brand.primary }}><b>12</b><span>On board</span></div>
              </div>
            </div>
            <p className="hint">This is how the store will look to its manager. Colors carry into their hero, accents, and The Board.</p>
          </div>
        </div>

        <div className="wiz-foot">
          <button className="btn-x" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={save} disabled={!name.trim() || idTaken}>{editing ? "Save changes" : "Create store"}</button>
        </div>

        {cropSrc && (
          <LogoCropper src={cropSrc} onCancel={() => setCropSrc(null)}
            onSave={(dataUrl) => { setIcon(dataUrl); setCropSrc(null); }} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Baseline import (historical period) ---------------- */
function BaselineImport({ data, onChange }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const seeded = Object.keys(data.baselines || {}).length;

  // count working days between two dates, Sundays excluded
  const workingDaysBetween = (a, b) => {
    if (!a || !b) return 0;
    const s = new Date(a + "T12:00"), e = new Date(b + "T12:00");
    if (e < s) return 0;
    let n = 0;
    for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0) n++;   // skip Sundays
    }
    return n;
  };

  const onDates = (a, b) => {
    setStart(a); setEnd(b);
    const wd = workingDaysBetween(a, b);
    if (wd) setDays(String(wd));
  };

  const read = async (file) => {
    if (!file) return;
    setBusy(true);
    const text = await file.text();
    const rows = Papa.parse(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;
    const type = detectReportType(rows, file.name);
    setBusy(false);
    if (type !== "activity") {
      setPreview({ error: "That is not a Daily Activity report. Pull the activity report for your date range and drop it here." });
      return;
    }
    const parsed = parseReport(rows, "activity");
    const excluded = new Set((data.excluded || []).map(norm));
    const aliases = data.aliases || {};
    const people = [];
    for (const [k, rec] of Object.entries(parsed)) {
      const key = aliases[k] || k;
      if (excluded.has(key)) continue;
      const a = (data.roster || []).find((x) => norm(x.name) === key);
      if (!a) continue;   // only people already on the roster
      people.push({ a, rec });
    }
    setPreview({ people, fileName: file.name });
  };

  const commit = () => {
    const d = parseInt(days) || 0;
    if (!preview?.people?.length || d <= 0) return;
    if (seeded && !window.confirm(
      "This overwrites the existing baseline for everyone in the file." +
      String.fromCharCode(10, 10) +
      "Their history is what every coaching target is built from, so only do this if the old seed was wrong."
    )) return;

    const next = JSON.parse(JSON.stringify(data));
    next.baselines = next.baselines || {};
    for (const { a, rec } of preview.people) {
      next.baselines[a.id] = {
        daysWorked: d,
        oppShowroom: rec.actOppShowroom ?? 0,
        oppInternet: rec.actOppInternet ?? 0,
        oppPhone: rec.actOppPhone ?? 0,
        oppCampaign: rec.actOppCampaign ?? 0,
        // The activity report gives total units, not units per channel. Split them the
        // way this person's own opportunities split, which is the best honest estimate
        // available. Overwrite by hand on their card if you know better.
        ...(function () {
          const units = rec.actUnits ?? 0;
          const o = {
            showroom: rec.actOppShowroom ?? 0, internet: rec.actOppInternet ?? 0,
            phone: rec.actOppPhone ?? 0, campaign: rec.actOppCampaign ?? 0,
          };
          const total = o.showroom + o.internet + o.phone + o.campaign;
          const share = (v) => (total > 0 ? (units * v) / total : 0);
          return {
            unitsShowroom: Math.round(share(o.showroom) * 10) / 10,
            unitsInternet: Math.round(share(o.internet) * 10) / 10,
            unitsPhone: Math.round(share(o.phone) * 10) / 10,
            unitsCampaign: Math.round(share(o.campaign) * 10) / 10,
          };
        })(),
        apptCreated: rec.actApptCreated ?? 0,
        apptConfirmed: rec.actApptConfirmed ?? 0,
        apptShowed: rec.actApptShow ?? 0,
        calls: rec.actCalls ?? 0,
        contacted: rec.actCallContacted ?? 0,
        text: rec.actText ?? 0,
        email: rec.actEmail ?? 0,
        video: rec.actVideo ?? 0,
        tasks: rec.actCompletedTasks ?? 0,
        units: rec.actUnits ?? 0,
        period: { start, end, days: d },
      };
    }
    onChange(next, {
      action: "Imported 90-day baseline",
      detail: `${preview.people.length} associates, ${start} to ${end}, ${d} working days`,
    });
    setPreview(null);
  };

  return (
    <div className="card baseline-card">
      <h3>90-day baseline {seeded > 0 && <span className="badge badge-ok">{seeded} seeded</span>}</h3>
      <p className="hint">
        Every coaching target is built from a person's own conversion history, and the tool has none until it has
        been running a while. Pull the <b>Daily Activity report for a past date range</b> out of DriveCentric,
        drop it here, and it seeds everyone at once. From then on the tool builds its own history and the seed
        matters less every week.
      </p>

      <div className="bl-dates">
        <label className="bl-field">
          <span>Period start</span>
          <input type="date" value={start} onChange={(e) => onDates(e.target.value, end)} />
        </label>
        <label className="bl-field">
          <span>Period end</span>
          <input type="date" value={end} onChange={(e) => onDates(start, e.target.value)} />
        </label>
        <label className="bl-field">
          <span>Working days</span>
          <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <span className="hint">Sundays are excluded automatically. Change it if your store works differently.</span>
      </div>

      <div className="inline-form">
        <label className="btn-ghost file-btn">
          {busy ? "Reading..." : "Choose activity report"}
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={(e) => { read(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>

      {preview?.error && <div className="login-err">{preview.error}</div>}

      {preview?.people && (
        <div className="bl-preview">
          <div className="check-group-label">
            {preview.people.length} matched from {preview.fileName}
          </div>
          {preview.people.length === 0 ? (
            <p className="hint">Nobody in that file matches your roster. Check the names, or import the report normally first so the roster builds itself.</p>
          ) : (
            <>
              <table className="roster-table">
                <thead><tr><th>Name</th><th>Units</th><th>Calls</th><th>Videos</th><th>Opportunities</th></tr></thead>
                <tbody>
                  {preview.people.slice(0, 8).map(({ a, rec }) => (
                    <tr key={a.id}>
                      <td><b>{a.name}</b></td>
                      <td>{rec.actUnits ?? 0}</td>
                      <td>{rec.actCalls ?? 0}</td>
                      <td>{rec.actVideo ?? 0}</td>
                      <td>{(rec.actOppShowroom ?? 0) + (rec.actOppInternet ?? 0) + (rec.actOppPhone ?? 0) + (rec.actOppCampaign ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.people.length > 8 && <p className="hint">and {preview.people.length - 8} more.</p>}
              <div className="inline-form">
                <button className="btn" disabled={!days || !start || !end} onClick={commit}>
                  Seed baseline for {preview.people.length} {preview.people.length === 1 ? "person" : "people"}
                </button>
                <button className="btn-x" onClick={() => setPreview(null)}>Cancel</button>
              </div>
              {(!start || !end || !days) && <p className="hint">Set the period the report covers first.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Upload history ---------------- */
function UploadHistory({ data, onChange }) {
  const log = data.importLog || [];
  const [busy, setBusy] = useState(false);
  if (log.length === 0) return null;

  // Two genuinely different situations, and pretending they're the same would lose data.
  //
  // ACTIVITY is stored per day, so removing one is surgical: delete that day and
  // nothing else is touched.
  //
  // DELIVERY / APPOINTMENT / VIDEO overwrite the month's running totals. There is no
  // way to subtract one upload back out of them, because the previous value is gone.
  // The only honest undo is to restore the snapshot taken immediately before it, which
  // also rewinds anything imported afterwards. So we say that out loud.

  const laterThan = (entry) => log.filter((u) => new Date(u.t) > new Date(entry.t)).length;

  const deleteActivityDay = (u) => {
    if (!window.confirm(
      "Delete the activity for " + new Date(u.day + "T12:00").toLocaleDateString() + "?" +
      String.fromCharCode(10, 10) +
      "Only that day is removed. Every other day and every other report stays exactly as it is." +
      String.fromCharCode(10, 10) +
      "Stars you typed in for that day are kept, in case you re-import it."
    )) return;
    setBusy(true);
    const next = JSON.parse(JSON.stringify(data));
    if (next.activity) delete next.activity[u.day];
    // clear the tick for that day so the checklist is honest again
    for (const mk of Object.keys(next.months || {})) {
      if (next.months[mk]?.imports?.[u.day]) delete next.months[mk].imports[u.day].activity;
    }
    next.importLog = (next.importLog || []).filter((x) => x.id !== u.id);
    onChange(next, { action: "Deleted activity day", detail: u.day });
    setBusy(false);
  };

  const undoUpload = (u) => {
    const snap = (data.snapshots || []).find((s) => s.t === u.snapT);
    const after = laterThan(u);
    if (!snap) {
      alert(
        "The restore point for this upload has aged out, so it can no longer be undone cleanly." +
        String.fromCharCode(10, 10) +
        "Re-import the correct file instead: it overwrites these numbers. Or restore a backup from the Backup tab."
      );
      return;
    }
    if (!window.confirm(
      "Undo " + u.label + " from " + new Date(u.t).toLocaleString() + "?" +
      String.fromCharCode(10, 10) +
      "This report overwrote the month's running totals, so the only way back is to restore the state from just before it." +
      (after > 0
        ? String.fromCharCode(10, 10) + "WARNING: " + after + " later upload" + (after === 1 ? "" : "s") +
          " will also be undone. You will need to re-import " + (after === 1 ? "it" : "them") + "."
        : "")
    )) return;

    setBusy(true);
    const current = JSON.parse(JSON.stringify(data));
    const restored = {
      ...current,
      ...snap.data,
      snapshots: [
        { t: new Date().toISOString(), by: "-", reason: "Before undo", data: JSON.parse(JSON.stringify({
          roster: current.roster, months: current.months, activity: current.activity,
          plates: current.plates, restrictions: current.restrictions, aliases: current.aliases,
          stars: current.stars, goals: current.goals, baselines: current.baselines,
          repeatFlags: current.repeatFlags, excluded: current.excluded,
        })) },
        ...(current.snapshots || []),
      ].slice(0, 12),
      // the undo itself is undoable
      importLog: (current.importLog || []).filter((x) => new Date(x.t) < new Date(u.t)),
      // these are yours, not the report's: never rewind them
      goals: current.goals,
      baselines: current.baselines,
      stars: current.stars,
      repeatFlags: current.repeatFlags,
      excluded: current.excluded,
    };
    onChange(restored, { action: "Undid upload", detail: `${u.label} (${u.file})` });
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Upload history</h3>
      <p className="hint">
        Every upload, with the time it landed. Activity days can be deleted on their own.
        The other reports overwrite the month's totals, so undoing one means rewinding to just before it.
      </p>
      <div className="up-list">
        {log.slice(0, 25).map((u, i) => {
          const canSurgical = u.type === "activity" && u.day;
          const after = laterThan(u);
          return (
            <div key={u.id || i} className="up-row">
              <span className="up-when">{new Date(u.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span className="up-type">{u.label}</span>
              <span className="up-file">{u.file}</span>
              <span className="up-count">{u.count} rows{u.skipped ? `, ${u.skipped} ignored` : ""}</span>
              <span className="up-by">{u.by}</span>
              {canSurgical ? (
                <button className="btn-x danger" disabled={busy} onClick={() => deleteActivityDay(u)}>Delete</button>
              ) : u.snapT ? (
                <button className="btn-x danger" disabled={busy} onClick={() => undoUpload(u)}
                  title={after > 0 ? `Also undoes ${after} later upload${after === 1 ? "" : "s"}` : "Rewinds to just before this upload"}>
                  Undo{after > 0 ? ` (+${after})` : ""}
                </button>
              ) : (
                <span className="hint">-</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= OWN YOUR OUTCOME =================
   Coaching only. It never gates leads. The Lead Board's tier system remains the
   single source of truth for who can take another lead, so the two can't contradict
   each other.

   The whole point: coach against a person's OWN conversion history rather than a
   number somebody invented. "You need 25 calls per car, you're 8 cars short with 10
   days left, so that's 20 calls a day and you're doing 12" beats "make more calls".
   ==================================================== */

const OYO_CHANNELS = [
  { id: "showroom", label: "Showroom" },
  { id: "internet", label: "Internet" },
  { id: "phone", label: "Phone" },
  { id: "campaign", label: "Campaign" },
];

// The outreach the workbook tracks, and the field each one lives in.
const OYO_OUTREACH = [
  { id: "calls", label: "Calls made" },
  { id: "contacted", label: "Calls contacted" },
  { id: "text", label: "Texts sent" },
  { id: "email", label: "Emails sent" },
  { id: "video", label: "Personalized videos" },
  { id: "tasks", label: "Completed tasks" },
];

const emptyBaseline = () => ({
  daysWorked: 0,
  oppShowroom: 0, oppInternet: 0, oppPhone: 0, oppCampaign: 0,
  unitsShowroom: 0, unitsInternet: 0, unitsPhone: 0, unitsCampaign: 0,
  apptCreated: 0, apptConfirmed: 0, apptShowed: 0,
  calls: 0, contacted: 0, text: 0, email: 0, video: 0, tasks: 0,
  units: 0,
});

// Everything this person has done this month, summed straight out of the imports.
// This is the MTD sheet, built from the Daily Activity report instead of typed in.
function oyoMTD(data, nameKey, monthStats) {
  const days = Object.keys(data.activity || {}).filter((d) => d.startsWith(ym()));
  const rows = days.map((d) => data.activity[d][nameKey]).filter(Boolean);
  const sum = (f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);

  const s = monthStats || {};
  return {
    daysElapsed: rows.length,          // days we actually have data for, not a guess
    oppShowroom: sum("oppShowroom"),
    oppInternet: sum("oppInternet"),
    oppPhone: sum("oppPhone"),
    oppCampaign: sum("oppCampaign"),
    // units per channel come from the Delivery Summaries, which are the authority on units
    unitsShowroom: s.showroomUnits ?? 0,
    unitsInternet: s.internetUnits ?? 0,
    unitsPhone: s.phoneUnits ?? 0,
    unitsCampaign: s.campaignUnits ?? 0,
    apptCreated: sum("apptCreated"),
    apptConfirmed: sum("apptConfirmed"),
    apptShowed: sum("apptShow"),
    calls: sum("calls"),
    contacted: sum("contacted"),
    text: sum("text"),
    email: sum("email"),
    video: sum("video"),
    tasks: sum("tasks"),
  };
}

const oyoUnits = (m) =>
  (m.unitsShowroom ?? 0) + (m.unitsInternet ?? 0) + (m.unitsPhone ?? 0) + (m.unitsCampaign ?? 0);

// A person's own conversion history. Seeded by hand until the tool has enough of its
// own, then blended with what it has actually seen.
function oyoBaseline(data, nameKey, aId) {
  const seed = data.baselines?.[aId];
  const seeded = seed && (seed.daysWorked ?? 0) > 0;

  // everything the tool has observed itself, across every month on file
  const allDays = Object.keys(data.activity || {});
  const rows = allDays.map((d) => data.activity[d][nameKey]).filter(Boolean);
  const sum = (f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);

  const observedUnits = Object.keys(data.months || {}).reduce((n, mk) => {
    const st = data.months[mk]?.stats?.[nameKey] || {};
    return n + (st.showroomUnits ?? 0) + (st.internetUnits ?? 0) + (st.phoneUnits ?? 0) + (st.campaignUnits ?? 0);
  }, 0);

  const observed = {
    daysWorked: rows.length,
    oppShowroom: sum("oppShowroom"), oppInternet: sum("oppInternet"),
    oppPhone: sum("oppPhone"), oppCampaign: sum("oppCampaign"),
    apptCreated: sum("apptCreated"), apptConfirmed: sum("apptConfirmed"), apptShowed: sum("apptShow"),
    calls: sum("calls"), contacted: sum("contacted"), text: sum("text"),
    email: sum("email"), video: sum("video"), tasks: sum("tasks"),
    units: observedUnits,
    unitsShowroom: 0, unitsInternet: 0, unitsPhone: 0, unitsCampaign: 0,
  };
  for (const mk of Object.keys(data.months || {})) {
    const st = data.months[mk]?.stats?.[nameKey] || {};
    observed.unitsShowroom += st.showroomUnits ?? 0;
    observed.unitsInternet += st.internetUnits ?? 0;
    observed.unitsPhone += st.phoneUnits ?? 0;
    observed.unitsCampaign += st.campaignUnits ?? 0;
  }

  if (!seeded) return { ...observed, source: observed.daysWorked > 0 ? "observed" : "none" };

  // Seed plus what we have seen since. The seed stops mattering as real history
  // accumulates, which is exactly what you want.
  const merged = { ...emptyBaseline(), source: "seed+observed" };
  for (const k of Object.keys(emptyBaseline())) {
    merged[k] = (seed[k] ?? 0) + (observed[k] ?? 0);
  }
  return merged;
}

// Per-vehicle ratios: the heart of the whole thing.
function oyoRatios(b) {
  const u = b.units || 0;
  if (u <= 0) return null;
  const r = {};
  for (const o of OYO_OUTREACH) r[o.id] = (b[o.id] ?? 0) / u;
  r.apptCreated = (b.apptCreated ?? 0) / u;
  r.apptShowed = (b.apptShowed ?? 0) / u;
  for (const c of OYO_CHANNELS) {
    const opp = b["opp" + c.id.charAt(0).toUpperCase() + c.id.slice(1)] ?? 0;
    const un = b["units" + c.id.charAt(0).toUpperCase() + c.id.slice(1)] ?? 0;
    r["close_" + c.id] = opp > 0 ? un / opp : null;     // closing rate on that channel
    r["leadsPerCar_" + c.id] = un > 0 ? opp / un : null;
  }
  return r;
}

/* ---------------- Coaching: associate cards ---------------- */

// Average a person's daily activity across every day we have on file.
function activityAverages(data, nameKey) {
  const days = Object.keys(data.activity || {});
  const rows = days.map((d) => data.activity[d][nameKey]).filter(Boolean);
  if (rows.length === 0) return null;
  const sum = (f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);
  const n = rows.length;
  return {
    days: n,
    calls: sum("calls") / n,
    contacted: sum("contacted") / n,
    video: sum("video") / n,
    text: sum("text") / n,
    email: sum("email") / n,
    apptCreated: sum("apptCreated") / n,
    apptShow: sum("apptShow") / n,
    tasks: sum("tasks") / n,
    // contact rate is the one that usually separates people: calls are effort,
    // contacts are effectiveness
    contactRate: sum("calls") > 0 ? sum("contacted") / sum("calls") : null,
    showRate: sum("apptCreated") > 0 ? sum("apptShow") / sum("apptCreated") : null,
  };
}

const BEHAVIOURS = [
  { id: "calls", label: "Calls per day", kind: "num" },
  { id: "contacted", label: "Contacts per day", kind: "num" },
  { id: "contactRate", label: "Contact rate", kind: "pct" },
  { id: "video", label: "Personalized videos per day", kind: "num" },
  { id: "text", label: "Texts per day", kind: "num" },
  { id: "email", label: "Emails per day", kind: "num" },
  { id: "apptCreated", label: "Appointments set per day", kind: "num" },
  { id: "showRate", label: "Appointment show rate", kind: "pct" },
  { id: "tasks", label: "Tasks completed per day", kind: "num" },
];

function CoachingPanel({ config, store, data, onChange }) {
  const [openId, setOpenId] = useState(null);
  const M = data.months?.[ym()];

  // Coaching is built entirely on cars sold: per-car outreach ratios, closing rates,
  // pace to a unit goal. A BDC agent does not deliver units, so every one of those
  // numbers is meaningless for them, and including them dragged the benchmark down.
  const coachRoles = new Set(config.roles.filter((r) => r.coaching !== false).map((r) => r.id));
  const roster = (data.roster || []).filter((a) => a.roleId && coachRoles.has(a.roleId));
  const excludedRoles = config.roles.filter((r) => r.coaching === false).map((r) => r.name);

  // Rank everyone by units delivered this month, then treat the top third as the
  // benchmark. What separates them is the whole point of this view.
  const scored = roster.map((a) => {
    const s = M?.stats?.[norm(a.name)] || {};
    const units = (s.internetUnits ?? 0) + (s.phoneUnits ?? 0) + (s.showroomUnits ?? 0) + (s.campaignUnits ?? 0);
    // the same verdict the Lead Board reaches, so the one-pager can explain a pause
    // in exactly the terms the person already sees.
    const tiers = config.standards?.[store.id]?.[a.roleId]?.tiers;
    const ev = evaluateAssociate(s, tiers);
    return { a, units, stats: s, ev, act: activityAverages(data, norm(a.name)) };
  }).sort((x, y) => y.units - x.units);

  const withData = scored.filter((r) => r.act);
  const topCount = Math.max(1, Math.round(withData.length / 3));
  const top = withData.slice(0, topCount);

  const topAvg = {};
  for (const b of BEHAVIOURS) {
    const vals = top.map((r) => r.act[b.id]).filter((v) => v != null);
    topAvg[b.id] = vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : null;
  }

  if (roster.length === 0) {
    return <div className="empty">No associates with a position yet. Assign roles on the Roster tab and this will fill in.</div>;
  }
  // No early exit for missing activity. The benchmark needs it, but a card does not:
  // you can still set a goal, seed a baseline, and print the one-pager. Bailing out
  // here is why the cards would not open at all.

  const openRow = scored.find((r) => r.a.id === openId);

  return (
    <div className="coaching">
      {withData.length === 0 ? (
        <div className="card">
          <h3>What the strongest people do differently</h3>
          <p className="hint">
            Needs Daily Activity imported before it can tell you anything. You can still open anyone's card
            below to set a goal, seed their baseline, and print their one-pager.
          </p>
        </div>
      ) : (
      <div className="card">
        <h3>What the strongest people do differently <span className="section-sub">{store.name}</span></h3>
        <p className="hint">
          Top third by units delivered this month ({top.length} of {withData.length} with activity on file), averaged
          across every day imported. This is the bar, drawn from your own floor rather than a number someone made up.
        </p>
        <div className="bench-grid">
          {BEHAVIOURS.filter((b) => topAvg[b.id] != null).map((b) => (
            <div key={b.id} className="bench-tile">
              <div className="bench-num">{b.kind === "pct" ? fmtPct(topAvg[b.id]) : fmtNum(topAvg[b.id])}</div>
              <div className="bench-lbl">{b.label}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      <div className="card">
        <h3>Associates</h3>
        <p className="hint">
          Open anyone to see their card, how they compare, and what to coach.
          {excludedRoles.length > 0 && ` ${excludedRoles.join(" and ")} are not shown here: coaching is built on cars sold, which does not apply to them. You can change that under Stores.`}
        </p>
        <div className="coach-list">
          {scored.map((r) => (
            <button key={r.a.id} className={"coach-row " + (openId === r.a.id ? "on" : "")}
              onClick={() => setOpenId(openId === r.a.id ? null : r.a.id)}>
              <span className="coach-name">{r.a.name}</span>
              <span className="coach-role">{config.roles.find((x) => x.id === r.a.roleId)?.name}</span>
              <span className="coach-units">{r.units} <em>units</em></span>
              {r.act ? <span className="coach-days">{r.act.days} day{r.act.days === 1 ? "" : "s"} of activity</span>
                     : <span className="coach-days dim">no activity yet</span>}
              <span className="coach-open">{openId === r.a.id ? "Close" : "Open card"}</span>
            </button>
          ))}
        </div>
      </div>

      {openRow && <AssociateCard config={config} store={store} row={openRow} topAvg={topAvg} topCount={top.length} data={data} onChange={onChange} />}
    </div>
  );
}

// The one-pager. It exists to answer two questions in a room, on paper:
//   "Why am I not getting leads?"  and  "What do I have to do to be successful?"
// Everything on it is derived from this person's own numbers, so it is not an opinion.
function printOnePager({ store, config, a, stats, ev, restriction, mtd, base, ratios, goal, workingDays }) {
  const w = window.open("", "lpc_onepager_" + a.id, "width=900,height=1100");
  if (!w) { alert("Allow pop-ups for this site to print the one-pager."); return; }

  const delivered = oyoUnits(mtd);
  const elapsed = Math.max(1, mtd.daysElapsed);
  const remaining = Math.max(0, workingDays - mtd.daysElapsed);
  const stillNeeded = Math.max(0, goal - delivered);
  const perDay = remaining > 0 ? stillNeeded / remaining : 0;
  const pace = (delivered / elapsed) * workingDays;

  const restrictedNow = restriction && (!restriction.until || new Date(restriction.until) > new Date());
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
  const num = (v) => (v == null ? "-" : (Math.round(v * 10) / 10).toString());

  // ---- WHY ----
  let whyTitle, whyBody, whyClass;
  if (restrictedNow) {
    whyTitle = "Your leads are paused right now.";
    whyBody = "Confirmed off leads since " + new Date(restriction.since).toLocaleDateString() +
      (restriction.until ? ". Back up for review on " + new Date(restriction.until).toLocaleDateString() + "." : ".");
    whyClass = "bad";
  } else if (ev && ev.status === "fail") {
    whyTitle = "You are below the standard, so new leads are on hold.";
    whyBody = "Clear the items below and leads resume. Nothing else is required.";
    whyClass = "bad";
  } else if (ev && ev.status === "pass") {
    whyTitle = "You are cleared to take leads.";
    whyBody = "You are meeting every standard at your current tier. Keep the process consistent.";
    whyClass = "good";
  } else {
    whyTitle = "No standards are set for your position yet.";
    whyBody = "Ask your manager which tier you are on.";
    whyClass = "flat";
  }

  const failRows = (ev && ev.failures ? ev.failures : []).map((f) =>
    '<tr><td>' + esc(f.def.short) + '</td>' +
    '<td class="r">' + (f.val == null ? "no data" : (f.def.kind === "pct" ? pct(f.val) : num(f.val))) + '</td>' +
    '<td class="r">' + (f.def.kind === "pct" ? f.min + "%" : f.min) + '</td>' +
    '<td class="r bad">short</td></tr>'
  ).join("");

  // ---- WHAT IT TAKES ----
  const outreachRows = ratios ? OYO_OUTREACH.map((o) => {
    const per = ratios[o.id];
    const target = remaining > 0 ? (per * stillNeeded) / remaining : 0;
    const doing = (mtd[o.id] || 0) / elapsed;
    const ok = stillNeeded === 0 || remaining === 0 || doing >= target;
    return '<tr><td>' + esc(o.label) + '</td>' +
      '<td class="r">' + num(per) + '</td>' +
      '<td class="r"><b>' + num(target) + '</b></td>' +
      '<td class="r">' + num(doing) + '</td>' +
      '<td class="r ' + (ok ? "good" : "bad") + '">' + (ok ? "on pace" : "behind") + '</td></tr>';
  }).join("") : "";

  const leadRows = ratios ? OYO_CHANNELS.map((c) => {
    const lpc = ratios["leadsPerCar_" + c.id];
    const cr = ratios["close_" + c.id];
    if (!lpc || cr == null) return "";
    return '<tr><td>' + esc(c.label) + '</td>' +
      '<td class="r">' + pct(cr) + '</td>' +
      '<td class="r">' + Math.ceil(lpc) + '</td>' +
      '<td class="r"><b>' + (goal > 0 ? Math.ceil(lpc * goal) : "-") + '</b></td></tr>';
  }).join("") : "";

  const html =
'<!doctype html><html><head><meta charset="utf-8"><title>' + esc(a.name) + ' - Own Your Outcome</title><style>' +
'@page { size: letter portrait; margin: 12mm; }' +
'* { box-sizing:border-box; margin:0; padding:0; }' +
'body { font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#12212F; font-size:10.5px; line-height:1.4; }' +
'.sheet { max-width:186mm; }' +
'.hd { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #2A5E9B; padding-bottom:8px; margin-bottom:12px; }' +
'.nm { font-size:22px; font-weight:800; letter-spacing:-.02em; }' +
'.sub { color:#5B6874; font-size:10px; margin-top:2px; }' +
'.goalbox { text-align:right; }' +
'.goalbox b { font-size:26px; font-weight:800; color:#2A5E9B; display:block; line-height:1; }' +
'.goalbox span { font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:#5B6874; font-weight:700; }' +
'h2 { font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:#5B6874; margin:14px 0 6px; }' +
'.why { padding:10px 12px; border-radius:7px; border-left:4px solid #9AA5B1; background:#F4F6F8; }' +
'.why.bad { border-left-color:#C13529; background:#FBEEEC; }' +
'.why.good { border-left-color:#1E7A3C; background:#EAF6EE; }' +
'.why b { font-size:13px; display:block; margin-bottom:2px; }' +
'.stats { display:flex; gap:0; border:1px solid #DDE3E9; border-radius:7px; overflow:hidden; margin-top:4px; }' +
'.stat { flex:1; padding:9px 10px; border-right:1px solid #DDE3E9; }' +
'.stat:last-child { border-right:none; }' +
'.stat b { display:block; font-size:19px; font-weight:800; letter-spacing:-.02em; }' +
'.stat span { font-size:8.5px; text-transform:uppercase; letter-spacing:.07em; color:#5B6874; font-weight:700; }' +
'table { width:100%; border-collapse:collapse; }' +
'th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.07em; color:#5B6874; padding:5px 7px; border-bottom:1px solid #DDE3E9; }' +
'td { padding:5px 7px; border-bottom:1px solid #EEF1F4; font-variant-numeric:tabular-nums; }' +
'td.r, th.r { text-align:right; }' +
'.good { color:#1E7A3C; font-weight:700; } .bad { color:#C13529; font-weight:700; }' +
'.big { background:#F0F5FA; border:1px solid #C9DAEA; border-radius:7px; padding:10px 12px; margin-top:8px; font-size:12.5px; }' +
'.big b { color:#2A5E9B; }' +
'.cols { display:flex; gap:14px; }' +
'.cols > div { flex:1; }' +
'.sign { margin-top:16px; padding-top:10px; border-top:1px solid #DDE3E9; display:flex; gap:24px; font-size:9px; color:#5B6874; }' +
'.sign div { flex:1; }' +
'.line { border-bottom:1px solid #9AA5B1; height:22px; margin-bottom:3px; }' +
'.foot { margin-top:10px; font-size:8.5px; color:#8B95A1; }' +
'</style></head><body><div class="sheet">' +

'<div class="hd">' +
  '<div><div class="nm">' + esc(a.name) + '</div>' +
  '<div class="sub">' + esc(store.name) + ' &middot; ' + new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + '</div></div>' +
  (goal > 0 ? '<div class="goalbox"><b>' + delivered + ' / ' + goal + '</b><span>Units this month</span></div>' : '') +
'</div>' +

'<h2>Why am I not getting leads?</h2>' +
'<div class="why ' + whyClass + '"><b>' + whyTitle + '</b>' + esc(whyBody) + '</div>' +
(failRows ?
  '<table style="margin-top:6px"><thead><tr><th>What is measured</th><th class="r">You</th><th class="r">Needed</th><th class="r">Status</th></tr></thead><tbody>' +
  failRows + '</tbody></table>' : '') +

(goal > 0 ?
'<h2>Where you stand</h2>' +
'<div class="stats">' +
  '<div class="stat"><b>' + num(delivered) + '</b><span>Delivered</span></div>' +
  '<div class="stat"><b>' + num(stillNeeded) + '</b><span>Still needed</span></div>' +
  '<div class="stat"><b>' + remaining + '</b><span>Days left</span></div>' +
  '<div class="stat"><b class="' + (pace >= goal ? "good" : "bad") + '">' + num(pace) + '</b><span>Projected</span></div>' +
'</div>' +
(stillNeeded > 0 && remaining > 0 ?
  '<div class="big">To hit <b>' + goal + '</b>, you need <b>' + num(perDay) + ' car' + (perDay === 1 ? "" : "s") + ' a day</b> for the ' + remaining + ' working days left.</div>'
 : stillNeeded === 0 ? '<div class="big">Goal met. <b>' + num(delivered) + '</b> delivered against a goal of <b>' + goal + '</b>.</div>' : '')
: '') +

(ratios ?
'<h2>What do I have to do?</h2>' +
'<div class="cols">' +
  '<div><table><thead><tr><th>Every day</th><th class="r">Per car</th><th class="r">Target</th><th class="r">Doing</th><th class="r"></th></tr></thead>' +
  '<tbody>' + outreachRows + '</tbody></table></div>' +
'</div>' +
(leadRows ?
  '<h2>Leads it takes, at your own closing rate</h2>' +
  '<table><thead><tr><th>Channel</th><th class="r">You close</th><th class="r">Leads per car</th><th class="r">For your goal</th></tr></thead>' +
  '<tbody>' + leadRows + '</tbody></table>' : '')
: '<h2>What do I have to do?</h2><div class="why flat">Not enough history yet to build your plan. Once your activity has been imported for a while, this page will show exactly what it takes.</div>') +

'<div class="sign">' +
  '<div><div class="line"></div>Associate</div>' +
  '<div><div class="line"></div>Manager</div>' +
  '<div><div class="line"></div>Date</div>' +
'</div>' +
'<div class="foot">Every number here comes from your own reported activity and your own closing rates. Nothing on this page is an opinion.</div>' +
'</div></body></html>';

  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.focus(); w.print(); }, 400);
}

function OwnYourOutcome({ store, data, a, monthStats, onChange }) {
  const [editBase, setEditBase] = useState(false);
  const key = norm(a.name);

  const goal = data.goals?.[a.id]?.monthly ?? 0;
  const workingDays = store.workingDaysInMonth ?? 26;

  const mtd = oyoMTD(data, key, monthStats);
  const base = oyoBaseline(data, key, a.id);
  const ratios = oyoRatios(base);

  const delivered = oyoUnits(mtd);
  const elapsed = Math.max(1, mtd.daysElapsed);
  const remaining = Math.max(0, workingDays - mtd.daysElapsed);
  const stillNeeded = Math.max(0, goal - delivered);
  const perDayNeeded = remaining > 0 ? stillNeeded / remaining : 0;
  const pace = (delivered / elapsed) * workingDays;         // where this month lands at today's rate
  const onTrack = goal > 0 && pace >= goal;

  const setGoal = (v) => {
    const next = JSON.parse(JSON.stringify(data));
    next.goals = next.goals || {};
    next.goals[a.id] = { ...(next.goals[a.id] || {}), monthly: Math.max(0, parseInt(v) || 0) };
    onChange(next, { action: "Set monthly goal", detail: `${a.name}: ${v}` });
  };

  const saveBase = (b) => {
    const next = JSON.parse(JSON.stringify(data));
    next.baselines = next.baselines || {};
    next.baselines[a.id] = b;
    onChange(next, { action: "Set 90-day baseline", detail: a.name });
    setEditBase(false);
  };

  return (
    <>
      {/* ---- goal + pace ---- */}
      <h3 className="ac-h3">Own your outcome</h3>
      <div className="oyo-goal">
        <div className="oyo-goalset">
          <label>Monthly goal</label>
          <input type="number" min="0" value={goal || ""} placeholder="0"
            onChange={(e) => setGoal(e.target.value)} />
          <span className="hint">units. Set per person.</span>
        </div>

        {goal > 0 && (
          <div className="oyo-pace">
            <div className="oyo-track">
              <div className={"oyo-fill " + (onTrack ? "good" : "behind")}
                style={{ width: Math.min(100, (delivered / goal) * 100) + "%" }} />
              <div className="oyo-pacemark" style={{ left: Math.min(100, (mtd.daysElapsed / workingDays) * 100) + "%" }}
                title="Where you should be by today" />
            </div>
            <div className="oyo-stats">
              <span><b>{delivered}</b> delivered</span>
              <span><b>{stillNeeded}</b> still needed</span>
              <span><b>{remaining}</b> days left</span>
              <span className={onTrack ? "good" : "behind"}>
                <b>{fmtNum(pace)}</b> projected
              </span>
            </div>
            {stillNeeded > 0 && remaining > 0 && (
              <p className="oyo-lede">
                That is <b>{fmtNum(perDayNeeded)} car{perDayNeeded === 1 ? "" : "s"} a day</b> for the rest of the month.
              </p>
            )}
            {stillNeeded === 0 && <p className="oyo-lede good">Goal met. {delivered} of {goal}.</p>}
            {remaining === 0 && stillNeeded > 0 && <p className="oyo-lede behind">Month is out of days.</p>}
          </div>
        )}
      </div>

      {/* ---- closing rate by channel ---- */}
      <h3 className="ac-h3">Closing rate this month</h3>
      <div className="oyo-chan">
        {OYO_CHANNELS.map((c) => {
          const cap = c.id.charAt(0).toUpperCase() + c.id.slice(1);
          const opp = mtd["opp" + cap] ?? 0;
          const un = mtd["units" + cap] ?? 0;
          const rate = opp > 0 ? un / opp : null;
          const hist = ratios ? ratios["close_" + c.id] : null;
          const better = rate != null && hist != null && rate >= hist;
          return (
            <div key={c.id} className="oyo-chan-tile">
              <div className="oyo-chan-name">{c.label}</div>
              <div className="oyo-chan-rate">{rate == null ? "-" : fmtPct(rate)}</div>
              <div className="oyo-chan-sub">{un} of {opp} leads</div>
              {hist != null && (
                <div className={"oyo-chan-hist " + (better ? "good" : "behind")}>
                  {better ? "\u25b2" : "\u25bc"} your usual {fmtPct(hist)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- the blueprint ---- */}
      {!ratios ? (
        <p className="hint">
          No conversion history yet, so there is nothing to build a plan from. Seed this person's 90-day numbers
          below, or wait for a few weeks of imports to accumulate.
        </p>
      ) : (
        <>
          <h3 className="ac-h3">
            What it takes {goal > 0 && stillNeeded > 0 ? <span className="section-sub">to find {stillNeeded} more car{stillNeeded === 1 ? "" : "s"}</span> : null}
          </h3>
          <p className="hint">
            Built from this person's own conversion history, not a number anybody made up.
            Historically they deliver <b>{fmtNum(base.units)}</b> car{base.units === 1 ? "" : "s"} across <b>{base.daysWorked}</b> working days.
          </p>

          <table className="oyo-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Per car</th>
                <th>Needed</th>
                <th>Target / day</th>
                <th>Doing / day</th>
                <th>On pace?</th>
              </tr>
            </thead>
            <tbody>
              {OYO_OUTREACH.map((o) => {
                const per = ratios[o.id];
                const need = per * stillNeeded;
                const target = remaining > 0 ? need / remaining : 0;
                const doing = (mtd[o.id] ?? 0) / elapsed;
                const ok = remaining === 0 || stillNeeded === 0 || doing >= target;
                return (
                  <tr key={o.id} className={ok ? "" : "oyo-behind"}>
                    <td><b>{o.label}</b></td>
                    <td>{fmtNum(per)}</td>
                    <td>{goal > 0 ? Math.ceil(need) : "-"}</td>
                    <td>{goal > 0 && remaining > 0 ? fmtNum(target) : "-"}</td>
                    <td>{fmtNum(doing)}</td>
                    <td>
                      {goal === 0 ? <span className="co-badge dim">no goal</span>
                        : stillNeeded === 0 ? <span className="co-badge yes">done</span>
                        : remaining === 0 ? <span className="co-badge dim">month over</span>
                        : ok ? <span className="co-badge yes">✓ on pace</span>
                        : <span className="co-badge no">✗ behind</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="ac-h3">Leads it takes, by channel</h3>
          <table className="oyo-table">
            <thead>
              <tr><th>Channel</th><th>Their closing rate</th><th>Leads per car</th>
                <th>For 1 car</th><th>For 5</th>{goal > 0 && <th>For the goal</th>}</tr>
            </thead>
            <tbody>
              {OYO_CHANNELS.map((c) => {
                const cr = ratios["close_" + c.id];
                const lpc = ratios["leadsPerCar_" + c.id];
                if (cr == null || !lpc) return (
                  <tr key={c.id} className="co-nodata">
                    <td><b>{c.label}</b></td><td>-</td><td>-</td><td>-</td><td>-</td>{goal > 0 && <td>-</td>}
                  </tr>
                );
                return (
                  <tr key={c.id}>
                    <td><b>{c.label}</b></td>
                    <td>{fmtPct(cr)}</td>
                    <td>{fmtNum(lpc)}</td>
                    <td>{Math.ceil(lpc)}</td>
                    <td>{Math.ceil(lpc * 5)}</td>
                    {goal > 0 && <td><b>{Math.ceil(lpc * goal)}</b></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* ---- baseline ---- */}
      <div className="oyo-base">
        <div className="oyo-base-head">
          <div>
            <b>90-day baseline</b>
            <span className="hint">
              {base.source === "seed+observed"
                ? ` Seeded, plus everything imported since. ${base.daysWorked} days on file.`
                : base.source === "observed"
                ? ` Built from ${base.daysWorked} imported day${base.daysWorked === 1 ? "" : "s"}. Seed their real 90-day numbers to make this meaningful sooner.`
                : " Nothing yet. Paste in their current 90-day numbers to start."}
            </span>
          </div>
          <button className="btn-ghost" onClick={() => setEditBase(!editBase)}>
            {editBase ? "Cancel" : base.source === "none" ? "Seed baseline" : "Edit seed"}
          </button>
        </div>
        {editBase && <BaselineEditor seed={data.baselines?.[a.id] || emptyBaseline()} onSave={saveBase} />}
      </div>
    </>
  );
}

function BaselineEditor({ seed, onSave }) {
  const [b, setB] = useState({ ...emptyBaseline(), ...seed });
  const f = (k, label) => (
    <label key={k} className="bl-field">
      <span>{label}</span>
      <input type="number" min="0" step="any" value={b[k] ?? 0}
        onChange={(e) => setB({ ...b, [k]: parseFloat(e.target.value) || 0 })} />
    </label>
  );
  return (
    <div className="bl-editor">
      <p className="hint">
        Type in what this person actually did over their last 90 days, straight from the workbook.
        The tool blends it with everything it imports from here on, so the seed matters less and less over time.
      </p>
      <div className="bl-grid">
        {f("daysWorked", "Days worked")}
        {f("units", "Vehicles delivered")}
      </div>
      <div className="check-group-label">Opportunities</div>
      <div className="bl-grid">
        {f("oppShowroom", "Showroom")}{f("oppInternet", "Internet")}
        {f("oppPhone", "Phone")}{f("oppCampaign", "Campaign")}
      </div>
      <div className="check-group-label">Units delivered by channel</div>
      <div className="bl-grid">
        {f("unitsShowroom", "Showroom")}{f("unitsInternet", "Internet")}
        {f("unitsPhone", "Phone")}{f("unitsCampaign", "Campaign")}
      </div>
      <div className="check-group-label">Appointments</div>
      <div className="bl-grid">
        {f("apptCreated", "Set")}{f("apptConfirmed", "Confirmed")}{f("apptShowed", "Showed")}
      </div>
      <div className="check-group-label">Outreach</div>
      <div className="bl-grid">
        {f("calls", "Calls")}{f("contacted", "Contacted")}{f("text", "Texts")}
        {f("email", "Emails")}{f("video", "Videos")}{f("tasks", "Tasks")}
      </div>
      <div className="inline-form">
        <button className="btn" onClick={() => onSave(b)}>Save baseline</button>
      </div>
    </div>
  );
}

function AssociateCard({ config, store, row, topAvg, topCount, data, onChange }) {
  const { a, stats, act, units } = row;
  const goal = data.goals?.[a.id]?.monthly ?? 0;
  const role = config.roles.find((x) => x.id === a.roleId);
  const thr = normThresholds(store.thresholds);

  const gaps = BEHAVIOURS
    .filter((b) => act && act[b.id] != null && topAvg[b.id] != null && topAvg[b.id] > 0)
    .map((b) => ({ ...b, mine: act[b.id], theirs: topAvg[b.id], ratio: act[b.id] / topAvg[b.id] }))
    .sort((x, y) => x.ratio - y.ratio);

  const behind = gaps.filter((g) => g.ratio < 0.85);
  const ahead = gaps.filter((g) => g.ratio > 1.1);

  const summaryText = () => {
    const L = [];
    L.push(`${a.name} — ${store.name} — ${new Date().toLocaleDateString()}`);
    L.push("");
    L.push(`Units delivered this month: ${units}`);
    if (stats.internetPct != null) L.push(`Internet delivered: ${fmtPct(stats.internetPct)}`);
    if (stats.phonePct != null) L.push(`Phone delivered: ${fmtPct(stats.phonePct)}`);
    if (stats.showroomPct != null) L.push(`Showroom delivered: ${fmtPct(stats.showroomPct)}`);
    L.push("");
    L.push(`Compared with the top ${topCount} performer${topCount === 1 ? "" : "s"} at this store:`);
    if (behind.length === 0) L.push("  You are at or above the benchmark on every behaviour.");
    for (const g of behind) {
      const f = g.kind === "pct" ? fmtPct : fmtNum;
      L.push(`  ${g.label}: ${f(g.mine)} vs ${f(g.theirs)}`);
    }
    if (ahead.length) {
      L.push("");
      L.push("Strengths:");
      for (const g of ahead) {
        const f = g.kind === "pct" ? fmtPct : fmtNum;
        L.push(`  ${g.label}: ${f(g.mine)} vs ${f(g.theirs)}`);
      }
    }
    return L.join(String.fromCharCode(10));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(summaryText()); alert("Card copied. Paste it into an email or a text."); }
    catch (e) { alert("Couldn't copy automatically. Use Print instead."); }
  };

  return (
    <div className="card assoc-card-full print-area">
      <div className="ac-head">
        <div>
          <h2 className="ac-name">{a.name}</h2>
          <div className="ac-sub">{role?.name} · {store.name} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>
        </div>
        <div className="ac-actions no-print">
          <button className="btn-ghost" onClick={copy}>Copy summary</button>
          <button className="btn" disabled={!goal} title={goal ? "" : "Set a monthly goal first"}
            onClick={() => printOnePager({
              store, config, a, stats, ev: row.ev,
              restriction: (data.restrictions || {})[a.id],
              mtd: oyoMTD(data, norm(a.name), stats),
              base: oyoBaseline(data, norm(a.name), a.id),
              ratios: oyoRatios(oyoBaseline(data, norm(a.name), a.id)),
              goal: data.goals?.[a.id]?.monthly ?? 0,
              workingDays: store.workingDaysInMonth ?? 26,
            })}>
            Print one-pager
          </button>
        </div>
        {!goal && <p className="hint no-print">Set a monthly goal below and the one-pager unlocks.</p>}
      </div>

      <OwnYourOutcome store={store} data={data} a={a} monthStats={stats} onChange={onChange} />

      <h3 className="ac-h3">Results this month</h3>
      <div className="ac-results">
        <div className="ac-stat"><b>{units}</b><span>Units delivered</span></div>
        <div className="ac-stat"><b>{fmtPct(stats.internetPct)}</b><span>Internet %</span></div>
        <div className="ac-stat"><b>{fmtPct(stats.phonePct)}</b><span>Phone %</span></div>
        <div className="ac-stat"><b>{fmtPct(stats.showroomPct)}</b><span>Showroom %</span></div>
      </div>

      {!act ? (
        <p className="hint">No Daily Activity on file for this person yet, so there is nothing to compare their behaviour against.</p>
      ) : (
        <>
          <h3 className="ac-h3">Behaviour vs the top {topCount} at this store</h3>
          <div className="ac-bars">
            {gaps.map((g) => {
              const f = g.kind === "pct" ? fmtPct : fmtNum;
              // benchmark sits at 70% of the track, so a bar that reaches the line is at parity
              const pct = Math.max(3, Math.min(100, g.ratio * 70));
              const state = g.ratio < 0.85 ? "behind" : g.ratio > 1.1 ? "ahead" : "even";
              return (
                <div key={g.id} className="ac-bar-row">
                  <span className="ac-bar-lbl">{g.label}</span>
                  <div className="ac-bar-track">
                    <div className="ac-bench" title="Top performers" />
                    <div className={"ac-bar " + state} style={{ width: pct + "%" }} />
                  </div>
                  <span className="ac-bar-val">{f(g.mine)}<em> vs {f(g.theirs)}</em></span>
                </div>
              );
            })}
          </div>

          <div className="ac-coach">
            {behind.length > 0 ? (
              <>
                <h3 className="ac-h3">What to coach</h3>
                <ul className="ac-list">
                  {behind.slice(0, 3).map((g) => {
                    const f = g.kind === "pct" ? fmtPct : fmtNum;
                    return (
                      <li key={g.id}>
                        <b>{g.label}</b> is at {f(g.mine)}, against {f(g.theirs)} for the strongest people here.
                        {g.id === "contactRate" && " Effort is not the issue if calls are fine; this is about when they are calling and what they open with."}
                        {g.id === "video" && " Personalized video is the single easiest habit to add, and it shows up in delivery rate."}
                        {g.id === "showRate" && " Appointments are being set but not landing. Look at confirmation habits the day before."}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="hint">This person is at or above the benchmark on every behaviour we track. Worth asking what they do that is not in the report.</p>
            )}
            {ahead.length > 0 && (
              <p className="hint">Strengths worth naming out loud: {ahead.slice(0, 3).map((g) => g.label.toLowerCase()).join(", ")}.</p>
            )}
          </div>

          <p className="hint">Based on {act.days} day{act.days === 1 ? "" : "s"} of activity on file. The more days imported, the more the pattern means.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Tool switcher ---------------- */
function ToolSwitcher({ value, onChange }) {
  const tools = [
    ["perf", "Performance"],
    ["activity", "Daily Activity"],
    ["board", "The Board"],
  ];
  return (
    <div className="tool-switch" role="group" aria-label="Switch tool">
      {tools.map(([id, label]) => (
        <button key={id}
          className={"tool-btn " + (value === id ? "on" : "")}
          onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Loading screen ---------------- */
function LoadingScreen({ label = "Loading" }) {
  return (
    <div className="loadscreen">
      <div className="loadscreen-inner">
        <div className="loadscreen-logo"><Logo size={80} animated /></div>
        <div className="loadscreen-bar"><div className="loadscreen-bar-fill" /></div>
        <div className="loadscreen-label">{label}</div>
      </div>
    </div>
  );
}

/* Animates a number up from zero. Honours the OS reduce-motion setting by
   jumping straight to the final value. */
function useCountUp(target, ms = 1000, delay = 150) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !target) { setV(target || 0); return; }
    let raf, startT = null;
    const tick = (t) => {
      if (startT === null) startT = t;
      const elapsed = t - startT - delay;
      if (elapsed < 0) { raf = requestAnimationFrame(tick); return; }
      const p = Math.min(1, elapsed / ms);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic: quick then settles
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

/* ---------------- Store hero (manager landing) ---------------- */
function StoreHero({ config, store, data, session, onGoTab, filter, onFilter }) {
  const M = data.months?.[ym()];
  const restrictions = data.restrictions || {};
  const graceDays = store.graceDays ?? 10;
  const inGrace = new Date().getDate() <= graceDays;

  const isRestricted = (a) => {
    const r = restrictions[a.id];
    return r && (!r.until || new Date(r.until) > new Date());
  };

  // same evaluation the Board uses, so the tiles can never disagree with the cards
  let cleared = 0, attention = 0, offLeads = 0, oppsUsed = 0, capTotal = 0;
  const ranked = [];
  const roster = (data.roster || []).filter((a) => a.roleId);
  for (const role of config.roles) {
    const tiers = config.standards?.[store.id]?.[role.id]?.tiers;
    for (const a of roster.filter((x) => x.roleId === role.id)) {
      const ev = evaluateAssociate(M?.stats?.[norm(a.name)], tiers);
      if (ev.opps != null) oppsUsed += ev.opps;
      if (ev.cap != null) capTotal += ev.cap;
      if (isRestricted(a)) { offLeads++; continue; }
      if (ev.status === "pass") { cleared++; ranked.push({ name: a.name, role, surpass: ev.surpass, opps: ev.opps }); }
      else if (ev.status === "fail") attention++;
    }
  }
  ranked.sort((a, b) => b.surpass - a.surpass);
  const leader = ranked[0];

  const evaluated = cleared + attention + offLeads;
  const pct = evaluated > 0 ? Math.round((cleared / evaluated) * 100) : 0;

  // today's import status
  const t = M?.imports?.[today()] || {};
  const need = ["delivery", "appointment", "video"];
  const done = need.filter((k) => t[k]);
  const missing = need.filter((k) => !t[k]).map((k) => reportLabel(k));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (session.name || "").split(" ")[0];

  // Progress ring. Bigger than it was: at r=34 the inner space was only ~60px across,
  // which pushed the word "cleared" hard up against the stroke. r=45 leaves ~80px.
  const SIZE = 122, CX = SIZE / 2, R = 45, SW = 9;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  // numbers roll up rather than just appearing
  const nPct = useCountUp(pct, 1100, 300);
  const nCleared = useCountUp(cleared, 800, 250);
  const nAttention = useCountUp(attention, 800, 320);
  const nOff = useCountUp(offLeads, 800, 390);
  const nRoster = useCountUp(roster.length, 800, 460);
  const nOpps = useCountUp(oppsUsed, 900, 530);

  const b = store.brand || DEFAULT_BRAND;
  const brandVars = { "--sp": b.primary, "--sd": b.deep, "--sa": b.accent };

  return (
    <div className="hero" style={brandVars}>
      <div className="hero-band">
        <div className="hero-id">
          <div className="hero-logo">
            {store.icon ? <img src={store.icon} alt="" /> : <Logo size={54} animated />}
          </div>
          <div className="hero-text">
            <div className="hero-greet">{greeting}{firstName ? `, ${firstName}` : ""}</div>
            <h1 className="hero-store">{store.name}</h1>
            <div className="hero-date">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
        </div>

        <div className="hero-ring-wrap" style={{ width: SIZE, height: SIZE }}>
          <svg className="hero-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle cx={CX} cy={CX} r={R} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth={SW} />
            <circle className="hero-ring-fill" cx={CX} cy={CX} r={R} fill="none" stroke={b.accent} strokeWidth={SW}
              strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform={`rotate(-90 ${CX} ${CX})`}
              style={{ "--c": dash }} />
          </svg>
          <div className="hero-ring-label">
            <div className="hero-ring-pct">{nPct}<span>%</span></div>
            <div className="hero-ring-cap">Cleared</div>
          </div>
        </div>
      </div>

      <div className="hero-tiles">
        <button className={"tile tile-good " + (filter === "cleared" ? "picked" : "")}
          onClick={() => onFilter(filter === "cleared" ? null : "cleared")}>
          <div className="tile-num">{nCleared}</div>
          <div className="tile-label">Cleared to grab</div>
        </button>
        <button className={"tile " + (attention === 0 ? "tile-flat" : inGrace ? "tile-warn" : "tile-bad") + (filter === "attention" ? " picked" : "")}
          onClick={() => onFilter(filter === "attention" ? null : "attention")}>
          <div className="tile-num">{nAttention}</div>
          <div className="tile-label">{inGrace ? "Working toward" : "Needs attention"}</div>
        </button>
        <button className={"tile " + (offLeads > 0 ? "tile-warn" : "tile-flat") + (filter === "off" ? " picked" : "")}
          onClick={() => onFilter(filter === "off" ? null : "off")}>
          <div className="tile-num">{nOff}</div>
          <div className="tile-label">Off leads</div>
        </button>
        <button className={"tile tile-info " + (filter === null ? "picked" : "")}
          onClick={() => onFilter(null)}>
          <div className="tile-num">{nRoster}</div>
          <div className="tile-label">On the board</div>
        </button>
        <div className="tile tile-info tile-static" title="Internet leads the team is currently holding, against the combined ceiling their tiers allow">
          <div className="tile-num">{nOpps}<span className="tile-of">/{capTotal || "-"}</span></div>
          <div className="tile-label">Leads held / capacity</div>
        </div>
      </div>

      <div className="hero-strip">
        <button className={"strip-chip " + (missing.length === 0 ? "chip-ok" : "chip-warn")} onClick={() => onGoTab("import")}>
          <span className="chip-dot" />
          {missing.length === 0
            ? `All ${done.length} of today's reports are in`
            : `Waiting on ${missing.join(" and ")}. Import now.`}
        </button>
        {inGrace && <span className="strip-note">Grace period · first {graceDays} days, no restrictions recommended yet</span>}
        {leader && (
          <div className="strip-leader">
            <span className="leader-crown">★</span>
            <span className="leader-name">{leader.name}</span>
            <span className="leader-tag">leading the board</span>
            <span className="leader-pct">+{Math.round(leader.surpass * 100)}% over standard</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Import ---------------- */
function ImportPanel({ data, log, dropActive, setDropActive, onFiles, fileRef, activity, onChange }) {
  const M = data.months?.[ym()];
  const t = M?.imports?.[today()] || {};
  if (activity) {
    return (
      <div className="import">
        <div className="card checklist">
          <div className="checklist-title">Today's Activity Import <span className="section-sub">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span></div>
          <div className={"check " + (t.activity ? "done" : "")}>
            <span className="check-box">{t.activity ? "✓" : ""}</span>Standard Daily Activity report
          </div>
          {!t.activity && <p className="hint">Drop today's Daily Activity export to build the Check Out sheet for today.</p>}
        </div>
        <div className={"dropzone " + (dropActive ? "active" : "")}
          onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => { e.preventDefault(); setDropActive(false); onFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}>
          <div className="dz-icon">⇩</div>
          <div className="dz-title">Drop today's Daily Activity CSV here</div>
          <div className="dz-sub">The Standard Daily Activity report. Calls and Personalized Video feed the Check Out sheet.</div>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {log.length > 0 && <div className="import-log">{log.map((l, i) => <div key={i} className={l.ok ? "log-ok" : "log-err"}>{l.ok ? "✓" : "✕"} {l.msg}</div>)}</div>}
        <BaselineImport data={data} onChange={onChange} />
        <UploadHistory data={data} onChange={onChange} />
        <p className="hint">Each day's activity is saved separately so the Check Out sheet and history stay accurate day to day.</p>
      </div>
    );
  }
  return (
    <div className="import">
      <div className="card checklist">
        <div className="checklist-title">Today's Imports <span className="section-sub">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span></div>
        <div className="check-group-label">Required</div>
        <div className={"check " + (t.delivery ? "done" : "")}>
          <span className="check-box">{t.delivery ? "✓" : ""}</span>
          Delivery Summary (Internet)
          <span className="check-note">also fills the Internet column on The Board</span>
        </div>
        <div className={"check " + (t.appointment ? "done" : "")}>
          <span className="check-box">{t.appointment ? "✓" : ""}</span>Appointment report
        </div>
        <div className={"check " + (t.video ? "done" : "")}>
          <span className="check-box">{t.video ? "✓" : ""}</span>Video report
        </div>
        <div className="check-group-label">The Board (optional)</div>
        <div className={"check " + (t["delivery-phone"] ? "done" : "")}>
          <span className="check-box">{t["delivery-phone"] ? "✓" : ""}</span>Phone Delivery Summary
        </div>
        <div className={"check " + (t["delivery-showroom"] ? "done" : "")}>
          <span className="check-box">{t["delivery-showroom"] ? "✓" : ""}</span>Showroom Delivery Summary
        </div>
        <div className={"check " + (t["delivery-campaign"] ? "done" : "")}>
          <span className="check-box">{t["delivery-campaign"] ? "✓" : ""}</span>Campaign Delivery Summary
          <span className="check-note">units only, no percentage</span>
        </div>
        {!(t.delivery && t.appointment && t.video) && <p className="hint">Lead statuses reflect the latest data on file. Drop today's DriveCentric exports to bring everyone current.</p>}
      </div>
      <div className={"dropzone " + (dropActive ? "active" : "")}
        onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => { e.preventDefault(); setDropActive(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}>
        <div className="dz-icon">⇩</div>
        <div className="dz-title">Drop today's CSVs here</div>
        <div className="dz-sub">Drop the Delivery Summary, Appointment, and Video reports. The Internet Delivery Summary is one file that covers both the Lead Board and The Board. If you also run Phone and Showroom summaries for The Board, put "phone" or "showroom" in those file names so the tool can tell them apart.</div>
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }}
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {log.length > 0 && (
        <div className="import-log">
          {log.map((l, i) => <div key={i} className={l.ok ? "log-ok" : "log-err"}>{l.ok ? "✓" : "✕"} {l.msg}</div>)}
        </div>
      )}
      <UploadHistory data={data} onChange={onChange} />
      <p className="hint">Performance is measured month-to-date and resets automatically on the 1st. Each import replaces the previous numbers for that report. Imports are recorded in the audit log.</p>
    </div>
  );
}

/* ---------------- GM Summary ---------------- */
function GMSummary({ config, data, stores }) {
  const [month, setMonth] = useState(ym());
  const monthOptions = Array.from(new Set(
    stores.flatMap((s) => Object.keys(data[s.id]?.months || {}))
  )).sort().reverse();
  useEffect(() => {
    if (!monthOptions.includes(month) && monthOptions.length) setMonth(monthOptions[0]);
  }, [monthOptions.join(","), month]); // eslint-disable-line

  const buildRows = () => {
    const rows = [];
    const dayNow = new Date().getDate();
    for (const s of stores) {
      const d = data[s.id]; if (!d) continue;
      const M = d.months?.[month]; if (!M) continue;
      const inGrace = month === ym() && dayNow <= (s.graceDays ?? 10);
      for (const role of config.roles) {
        const frozen = month !== ym() ? M.standardsSnapshot?.[role.id]?.tiers : null;
        const tiers = frozen || config.standards?.[s.id]?.[role.id]?.tiers;
        for (const a of (d.roster || []).filter((x) => x.roleId === role.id).sort((x, y) => x.order - y.order)) {
          const stats = M.stats?.[norm(a.name)];
          const ev = evaluateAssociate(stats, tiers);
          rows.push({ store: s.name, role: role.name, name: a.name, ev, stats, grace: inGrace && ev.status === "fail" });
        }
      }
    }
    return rows;
  };
  const rows = buildRows();
  const restricted = rows.filter((r) => r.ev.status === "fail" && !r.grace);
  const trending = rows.filter((r) => r.grace);
  const cleared = rows.filter((r) => r.ev.status === "pass");

  const exportCSV = () => {
    const out = [["Store", "Position", "Associate", "Leads MTD", "Tier Cap", "Verdict", "Restriction Reasons", "Delivery %", "Sold %", "Units", "Appt Video %", "BH Video %", "Engaged Video %"]];
    for (const r of rows) {
      out.push([
        r.store, r.role, r.name, r.ev.opps ?? "", r.ev.cap ?? "",
        r.ev.status === "pass" ? "Cleared to grab leads" : r.grace ? "Grace period, trending below standard" : r.ev.status === "fail" ? "Restrict leads" : "No standards",
        r.ev.status === "fail" ? failureText(r.ev) : "",
        fmtPct(r.stats?.deliveredPct), fmtPct(r.stats?.soldPct), fmtNum(r.stats?.unitsDelivered),
        fmtPct(r.stats?.apptVideoDayPct), fmtPct(r.stats?.bhVideoPct), fmtPct(r.stats?.engagedVideoPct),
      ]);
    }
    downloadCSV(`Lead-Performance-Summary_${month}.csv`, out);
  };

  return (
    <div className="gm print-area">
      <div className="gm-toolbar no-print">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {(monthOptions.length ? monthOptions : [ym()]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button className="btn" onClick={() => window.print()}>Print</button>
        <button className="btn secondary" onClick={exportCSV}>Export CSV</button>
      </div>
      <div className="gm-head">
        <h2>Lead Performance Summary <span className="section-sub">{monthLabel(month)}</span></h2>
        <p className="gm-sub">{stores.map((s) => s.name).join(" · ")} · Generated {new Date().toLocaleDateString()} · {restricted.length} restricted · {trending.length > 0 ? `${trending.length} in grace period · ` : ""}{cleared.length} cleared to grab leads</p>
      </div>
      {rows.length === 0 && <div className="empty">No data for this month yet.</div>}
      {trending.length > 0 && (
        <div className="card gm-card">
          <h3 className="gm-section watch">Grace Period: Trending Below Standard ({trending.length})</h3>
          <p className="hint">Early-month numbers; no restriction recommended yet. Coach these before the grace window closes.</p>
          <table className="gm-table">
            <thead><tr><th>Store</th><th>Associate</th><th>Position</th><th>Leads</th><th>Working toward</th></tr></thead>
            <tbody>
              {trending.map((r, i) => (
                <tr key={i}><td>{r.store}</td><td><b>{r.name}</b></td><td>{r.role}</td><td>{r.ev.opps} / {r.ev.cap}</td><td>{failureText(r.ev)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {restricted.length > 0 && (
        <div className="card gm-card">
          <h3 className="gm-section fail">Restrict Leads ({restricted.length})</h3>
          <table className="gm-table">
            <thead><tr><th>Store</th><th>Associate</th><th>Position</th><th>Leads</th><th>Because of</th></tr></thead>
            <tbody>
              {restricted.map((r, i) => (
                <tr key={i}><td>{r.store}</td><td><b>{r.name}</b></td><td>{r.role}</td><td>{r.ev.opps} / {r.ev.cap}</td><td>{failureText(r.ev)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cleared.length > 0 && (
        <div className="card gm-card">
          <h3 className="gm-section pass">Cleared to Grab Leads ({cleared.length})</h3>
          <table className="gm-table">
            <thead><tr><th>Store</th><th>Associate</th><th>Position</th><th>Leads</th><th>Cleared up to</th></tr></thead>
            <tbody>
              {cleared.map((r, i) => (
                <tr key={i}><td>{r.store}</td><td><b>{r.name}</b></td><td>{r.role}</td><td>{r.ev.opps} / {r.ev.cap}</td><td>{r.ev.nextCap ? `${r.ev.nextCap} leads` : "Top tier"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- History ---------------- */
function HistoryPanel({ config, store, data }) {
  const months = Object.keys(data.months || {}).sort().reverse();
  const [month, setMonth] = useState(months[0] || ym());
  if (months.length === 0) return <div className="empty">History builds itself month by month. Nothing here yet.</div>;
  const M = data.months[month];
  return (
    <div className="history">
      <div className="gm-toolbar">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        {month !== ym() && <span className="hint">{M.standardsSnapshot ? "Verdicts shown under the standards that were in effect that month." : "This month predates standards snapshots, so verdicts are recalculated with today's standards."}</span>}
      </div>
      {config.roles.map((role) => {
        const frozen = month !== ym() ? M.standardsSnapshot?.[role.id]?.tiers : null;
        const tiers = frozen || config.standards?.[store.id]?.[role.id]?.tiers;
        const people = (data.roster || []).filter((a) => a.roleId === role.id).sort((a, b) => a.order - b.order);
        if (!people.length) return null;
        return (
          <div key={role.id} className="card role-section" style={{ "--role": role.color }}>
            <h3 className="role-header"><span className="role-swatch" />{role.name}</h3>
            <table className="gm-table">
              <thead><tr><th>Associate</th><th>Leads</th><th>Delivery %</th><th>Appt Video %</th><th>Engaged %</th><th>BH %</th><th>Verdict</th></tr></thead>
              <tbody>
                {people.map((a) => {
                  const s = M.stats?.[norm(a.name)];
                  const ev = evaluateAssociate(s, tiers);
                  return (
                    <tr key={a.id}>
                      <td><b>{a.name}</b></td>
                      <td>{ev.opps ?? 0} / {ev.cap ?? "-"}</td>
                      <td>{fmtPct(s?.deliveredPct)}</td><td>{fmtPct(s?.apptVideoDayPct)}</td>
                      <td>{fmtPct(s?.engagedVideoPct)}</td><td>{fmtPct(s?.bhVideoPct)}</td>
                      <td>{ev.status === "pass" ? <span className="verdict verdict-pass sm">Cleared</span> : ev.status === "fail" ? <span className="verdict verdict-fail sm">Restrict</span> : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Standards editor ---------------- */
function StandardsEditor({ config, storeId, onChange }) {
  const [roleId, setRoleId] = useState(config.roles[0]?.id);
  const std = config.standards?.[storeId]?.[roleId] || { tiers: [] };
  const roleName = config.roles.find((r) => r.id === roleId)?.name;
  const storeName = config.stores.find((s) => s.id === storeId)?.name;

  const update = (fn, detail) => {
    const next = JSON.parse(JSON.stringify(config));
    if (!next.standards[storeId]) next.standards[storeId] = {};
    if (!next.standards[storeId][roleId]) next.standards[storeId][roleId] = { tiers: [] };
    fn(next.standards[storeId][roleId]);
    next.standards[storeId][roleId].tiers.sort((a, b) => a.cap - b.cap);
    onChange(next, { store: storeId, action: "Edited standards", detail: `${roleName} @ ${storeName}: ${detail}` });
  };

  return (
    <div className="standards">
      <div className="card grace-setting">
        <label className="grace-label">Grace period
          <input type="number" min="0" max="28" defaultValue={config.stores.find((s) => s.id === storeId)?.graceDays ?? 10}
            onBlur={(e) => {
              const v = Math.max(0, Math.min(28, toNum(e.target.value) ?? 10));
              const cur = config.stores.find((s) => s.id === storeId)?.graceDays ?? 10;
              if (v === cur) return;
              const next = JSON.parse(JSON.stringify(config));
              next.stores.find((s) => s.id === storeId).graceDays = v;
              onChange(next, { store: storeId, action: "Changed grace period", detail: `${storeName}: ${cur} → ${v} days` });
            }} />
          days
        </label>
        <span className="hint">No restrictions are recommended during the first days of the month while numbers settle. Anyone below standard shows as working toward the target instead. Set to 0 to turn this off.</span>
      </div>
      <div className="card">
        <h3>Leaderboard colors <span className="section-sub">{storeName}</span></h3>
        <ThresholdGrid
          value={config.stores.find((s) => s.id === storeId)?.thresholds}
          onChange={(next) => {
            const cfg = JSON.parse(JSON.stringify(config));
            const s = cfg.stores.find((x) => x.id === storeId);
            s.thresholds = next;
            onChange(cfg, { store: storeId, action: "Changed leaderboard thresholds", detail: storeName });
          }} />
      </div>
      <div className="std-head">
        <h3>Standards for</h3>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span className="hint">These apply to every {roleName} at this store only. Changes are recorded in the audit log.</span>
      </div>
      {std.tiers.map((tier, ti) => (
        <div key={ti} className="card tier">
          <div className="tier-head">
            <span className="tier-label">Tier {ti + 1}</span>
            <label>Lead cap <input type="number" defaultValue={tier.cap}
              onBlur={(e) => { const v = toNum(e.target.value) ?? 0; if (v !== tier.cap) update((s) => { s.tiers[ti].cap = v; }, `Tier ${ti + 1} cap ${tier.cap} → ${v}`); }} /></label>
            <span className="hint">{ti === 0 ? `Everyone starts here. Meet the requirements below to grab past ${tier.cap}.` : `Applies from ${(std.tiers[ti - 1]?.cap ?? 0) + 1} to ${tier.cap} leads.`}</span>
            <button className="btn-x" onClick={() => update((s) => s.tiers.splice(ti, 1), `Removed tier ${ti + 1} (cap ${tier.cap})`)}>Remove tier</button>
          </div>
          {tier.requirements.map((req, ri) => (
            <div key={ri} className="req-row">
              <select value={req.metric} onChange={(e) => update((s) => { s.tiers[ti].requirements[ri].metric = e.target.value; }, `Tier ${ti + 1}: metric → ${METRICS[e.target.value].label}`)}>
                {Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
              <span>must be at least</span>
              <input type="number" defaultValue={req.min}
                onBlur={(e) => { const v = toNum(e.target.value) ?? 0; if (v !== req.min) update((s) => { s.tiers[ti].requirements[ri].min = v; }, `Tier ${ti + 1}: ${METRICS[req.metric].short} ${req.min} → ${v}`); }} />
              <span>{METRICS[req.metric].kind === "pct" ? "%" : "units"}</span>
              <button className="btn-x" onClick={() => update((s) => s.tiers[ti].requirements.splice(ri, 1), `Tier ${ti + 1}: removed ${METRICS[req.metric].short} requirement`)}>✕</button>
            </div>
          ))}
          <button className="btn-ghost" onClick={() => update((s) => s.tiers[ti].requirements.push({ metric: "apptVideoDayPct", min: 50 }), `Tier ${ti + 1}: added requirement`)}>+ Add requirement</button>
        </div>
      ))}
      <button className="btn" onClick={() => update((s) => s.tiers.push({ cap: (std.tiers[std.tiers.length - 1]?.cap ?? 40) + 20, requirements: [{ metric: "apptVideoDayPct", min: 50 }] }), "Added tier")}>+ Add Tier</button>
    </div>
  );
}

/* ---------------- Roster editor ---------------- */
function RosterEditor({ config, data, onChange }) {
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(config.roles[0]?.id);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [excl, setExcl] = useState("");

  // names that are not people. Skipped on every future import, and removed from the
  // roster now if they already slipped in.
  const addExcluded = () => {
    const n = excl.trim();
    if (!n) return;
    const next = JSON.parse(JSON.stringify(data));
    next.excluded = [...(next.excluded || [])];
    if (!next.excluded.some((x) => norm(x) === norm(n))) next.excluded.push(n);
    next.roster = (next.roster || []).filter((a) => norm(a.name) !== norm(n));
    setExcl("");
    onChange(next, { action: "Excluded name from imports", detail: n });
  };
  const removeExcluded = (n) => {
    const next = JSON.parse(JSON.stringify(data));
    next.excluded = (next.excluded || []).filter((x) => x !== n);
    onChange(next, { action: "Stopped excluding name", detail: n });
  };

  // Fold a duplicate/renamed person into the person they really are.
  const merge = () => {
    const from = data.roster.find((a) => a.id === mergeFrom);
    const into = data.roster.find((a) => a.id === mergeInto);
    if (!from || !into || from.id === into.id) return;
    const fk = norm(from.name), ik = norm(into.name);
    if (!window.confirm(`Merge "${from.name}" into "${into.name}"?\n\nTheir history moves to ${into.name}, "${from.name}" is removed from the roster, and any future report that still says "${from.name}" will automatically count toward ${into.name}.`)) return;

    const next = JSON.parse(JSON.stringify(data));
    // move monthly stats where the canonical person has none
    for (const mKey of Object.keys(next.months || {})) {
      const M = next.months[mKey];
      if (M.stats?.[fk]) {
        M.stats[ik] = { ...(M.stats[fk]), ...(M.stats[ik] || {}) };
        delete M.stats[fk];
      }
      if (M.names) {
        for (const t of Object.keys(M.names)) {
          M.names[t] = (M.names[t] || []).map((k) => (k === fk ? ik : k));
        }
      }
    }
    // move daily activity
    for (const d of Object.keys(next.activity || {})) {
      if (next.activity[d]?.[fk]) {
        next.activity[d][ik] = { ...(next.activity[d][fk]), ...(next.activity[d][ik] || {}) };
        delete next.activity[d][fk];
      }
    }
    // repoint plate assignments
    for (const d of Object.keys(next.plates || {})) {
      next.plates[d] = (next.plates[d] || []).map((p) => (norm(p.assignee || "") === fk ? { ...p, assignee: into.name } : p));
    }
    // carry any active restriction across, then drop the duplicate
    if (next.restrictions?.[from.id] && !next.restrictions?.[into.id]) {
      next.restrictions[into.id] = next.restrictions[from.id];
    }
    delete next.restrictions?.[from.id];
    next.roster = next.roster.filter((a) => a.id !== from.id);
    // remember the alias so future imports fold automatically
    next.aliases = { ...(next.aliases || {}), [fk]: ik };

    setMergeFrom(""); setMergeInto("");
    onChange(next, { action: "Merged associates", detail: `${from.name} → ${into.name}` });
  };

  const unmerge = (aliasKey) => {
    const next = JSON.parse(JSON.stringify(data));
    delete next.aliases[aliasKey];
    onChange(next, { action: "Removed name link", detail: aliasKey });
  };

  const add = () => {
    const n = name.trim(); if (!n) return;
    const next = JSON.parse(JSON.stringify(data));
    if (next.roster.some((a) => norm(a.name) === norm(n))) return;
    next.roster.push({ id: uid(), name: n, roleId, order: next.roster.length });
    setName("");
    onChange(next, { action: "Added associate", detail: `${n} (${config.roles.find((r) => r.id === roleId)?.name})` });
  };
  const setRole = (id, rid) => {
    const next = JSON.parse(JSON.stringify(data));
    const a = next.roster.find((x) => x.id === id); if (!a) return;
    a.roleId = rid || null;
    onChange(next, { action: "Changed position", detail: `${a.name} → ${config.roles.find((r) => r.id === rid)?.name || "Needs a position"}` });
  };
  const remove = (id) => {
    const next = JSON.parse(JSON.stringify(data));
    const a = next.roster.find((x) => x.id === id);
    next.roster = next.roster.filter((x) => x.id !== id);
    onChange(next, { action: "Removed associate", detail: a?.name });
  };
  return (
    <div className="roster">
      <div className="card">
        <div className="inline-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last, exactly as it appears in DriveCentric" style={{ minWidth: 260 }} />
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className="btn" onClick={add}>Add Associate</button>
        </div>
        <p className="hint">Names must match DriveCentric exports exactly (not case-sensitive). Anyone who shows up in a report but isn't listed here gets added automatically under "Needs a Position." Roster changes are recorded in the audit log.</p>
      </div>

      <div className="card">
        <h3>Ignore these names</h3>
        <p className="hint">
          DriveCentric exports contain roll-up rows that are not people, like "Team A" or a house account.
          Left alone they get added to the roster and drag every average around. Anything listed here is
          skipped on import and will never appear again.
        </p>
        <div className="inline-form">
          <input value={excl} onChange={(e) => setExcl(e.target.value)} placeholder="e.g. Team A"
            onKeyDown={(e) => e.key === "Enter" && addExcluded()} />
          <button className="btn" onClick={addExcluded}>Ignore this name</button>
        </div>
        {(data.excluded || []).length > 0 && (
          <div className="domain-list">
            {(data.excluded || []).map((n) => (
              <span key={n} className="domain-chip">{n}
                <button className="btn-x" onClick={() => removeExcluded(n)}>✕</button>
              </span>
            ))}
          </div>
        )}
        {(data.roster || []).filter((a) => !a.roleId).length > 0 && (
          <p className="hint">
            Tip: anyone sitting in "Needs a Position" who is not a real person is probably one of these.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Merge duplicate names</h3>
        <p className="hint">If DriveCentric ever spells someone differently (a nickname, a married name, a typo), they'll show up here as a second person and their history splits. Merge them and the history joins back up, plus future reports using the old spelling will automatically count toward the right person.</p>
        <div className="inline-form">
          <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
            <option value="">Select the duplicate</option>
            {(data.roster || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span className="merge-arrow">→</span>
          <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            <option value="">Select the real person</option>
            {(data.roster || []).filter((a) => a.id !== mergeFrom).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn" onClick={merge} disabled={!mergeFrom || !mergeInto}>Merge</button>
        </div>
        {Object.keys(data.aliases || {}).length > 0 && (
          <div className="alias-list">
            <div className="check-group-label">Linked names</div>
            {Object.entries(data.aliases).map(([from, to]) => (
              <div key={from} className="alias-row">
                <span className="mono">{from}</span> <span className="merge-arrow">→</span> <span className="mono">{to}</span>
                <button className="btn-x" onClick={() => unmerge(from)}>Unlink</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <table className="roster-table">
          <thead><tr><th>Name</th><th>Position</th><th /></tr></thead>
          <tbody>
            {(data.roster || []).sort((a, b) => a.order - b.order).map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>
                  <select value={a.roleId || ""} onChange={(e) => setRole(a.id, e.target.value)}>
                    <option value="">needs a position</option>
                    {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td><button className="btn-x" onClick={() => remove(a.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Access panel ---------------- */
function AccessPanel({ config, session, onChange }) {
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [domain, setDomain] = useState("");

  const reload = useCallback(async () => {
    setPeople(await listProfiles());
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const patch = async (id, fields, auditNote) => {
    setBusy(true);
    const ok = await updateProfile(id, fields);
    setBusy(false);
    if (!ok) { setMsg("That change didn't save. You may not have permission."); return; }
    if (auditNote) await appendAudit({ user: session.name, action: auditNote.action, detail: auditNote.detail });
    setMsg("");
    reload();
  };

  const approve = (u, storeIds) =>
    patch(u.id, { pending: false, stores: storeIds }, { action: "Approved account", detail: u.email });

  const toggleStore = (u, sid, on) => {
    const next = on ? [...(u.stores || []), sid] : (u.stores || []).filter((x) => x !== sid);
    patch(u.id, { stores: next }, { action: "Changed store access", detail: u.email + ": " + next.join(", ") });
  };

  const setRole = (u, role) =>
    patch(u.id, { role }, { action: "Changed role", detail: u.email + " -> " + role });

  const promote = (u) => {
    if (!window.confirm("Make " + (u.name || u.email) + " a Group Admin?" + String.fromCharCode(10, 10) +
      "Admins see and change everything across every store, manage accounts, and edit standards. Only do this for someone you fully trust.")) return;
    patch(u.id, { role: "admin", pending: false }, { action: "Promoted to admin", detail: u.email });
  };

  const demote = (u) => {
    const others = (people || []).filter((x) => x.role === "admin" && x.id !== u.id && x.active);
    if (others.length === 0) { alert("You can't remove the last admin. Promote someone else first."); return; }
    if (!window.confirm("Remove admin rights from " + (u.name || u.email) + "? They become a store manager with no store access until you assign one.")) return;
    patch(u.id, { role: "manager", stores: [] }, { action: "Removed admin rights", detail: u.email });
  };

  const toggleActive = (u) =>
    patch(u.id, { active: !u.active }, { action: u.active ? "Deactivated account" : "Reactivated account", detail: u.email });

  const remove = async (u) => {
    if (!window.confirm("Delete " + (u.name || u.email) + " permanently?" + String.fromCharCode(10, 10) +
      "This removes their profile. It does not delete any store data they imported.")) return;
    setBusy(true);
    const ok = await deleteProfile(u.id);
    setBusy(false);
    if (!ok) { setMsg("Couldn't delete that profile."); return; }
    await appendAudit({ user: session.name, action: "Deleted account", detail: u.email });
    reload();
  };

  const addDomain = () => {
    const d = domain.trim().toLowerCase().replace(/^@/, "");
    if (!d || !d.includes(".")) return;
    if ((config.approvedDomains || []).includes(d)) return;
    const next = JSON.parse(JSON.stringify(config));
    next.approvedDomains = [...(next.approvedDomains || []), d];
    setDomain("");
    onChange(next, { action: "Added approved domain", detail: d });
  };
  const removeDomain = (d) => {
    const next = JSON.parse(JSON.stringify(config));
    next.approvedDomains = (next.approvedDomains || []).filter((x) => x !== d);
    onChange(next, { action: "Removed approved domain", detail: d });
  };

  if (!AUTH_ENABLED) {
    return <div className="empty">Accounts are managed on the hosted site, where real sign-in is available. This preview has no account system.</div>;
  }
  if (!people) return <LoadingScreen label="Loading accounts" />;

  const pending = people.filter((u) => u.pending && u.role !== "admin");
  const active = people.filter((u) => !u.pending || u.role === "admin");

  return (
    <div className="access">
      {msg && <div className="login-err">{msg}</div>}

      {pending.length > 0 && (
        <div className="card">
          <h3>Waiting for approval <span className="badge badge-warn">{pending.length}</span></h3>
          <p className="hint">These people created an account and are waiting on you. Tick the stores they should see, then approve.</p>
          {pending.map((u) => (
            <PendingRow key={u.id} u={u} stores={config.stores} busy={busy}
              onApprove={(ids) => approve(u, ids)} onReject={() => remove(u)} />
          ))}
        </div>
      )}

      <div className="card">
        <h3>Accounts</h3>
        <p className="hint">
          Passwords are handled by Supabase and stored hashed. No one, including you, can read them.
          If someone forgets theirs they use "Forgot password?" on the sign-in screen.
        </p>
        <table className="roster-table wide">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Stores</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {active.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name || "-"}</b></td>
                <td className="mono">{u.email}</td>
                <td>
                  {u.role === "admin" ? "Group Admin" : (
                    <select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={busy}>
                      <option value="manager">Store Manager</option>
                      <option value="overseer">Centralized BDC</option>
                    </select>
                  )}
                </td>
                <td>
                  {u.role === "admin" ? <span className="hint">All stores</span> : (
                    <div className="store-checks tight">
                      {config.stores.map((s) => (
                        <label key={s.id} className="check-inline">
                          <input type="checkbox" disabled={busy}
                            checked={(u.stores || []).includes(s.id)}
                            onChange={(e) => toggleStore(u, s.id, e.target.checked)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td>{u.active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-off">Inactive</span>}</td>
                <td className="row-actions">
                  {u.id !== session.id && (
                    <>
                      <button className="btn-x" onClick={() => toggleActive(u)} disabled={busy}>{u.active ? "Deactivate" : "Reactivate"}</button>
                      {u.role !== "admin"
                        ? <button className="btn-x" onClick={() => promote(u)} disabled={busy}>Make admin</button>
                        : <button className="btn-x" onClick={() => demote(u)} disabled={busy}>Remove admin</button>}
                      <button className="btn-x" onClick={() => remove(u)} disabled={busy}>Delete</button>
                    </>
                  )}
                  {u.id === session.id && <span className="hint">This is you</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Approved email domains</h3>
        <p className="hint">Only these domains may create an account. Leave this empty and nobody new can register.</p>
        <div className="inline-form">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="hollerclassic.com"
            onKeyDown={(e) => e.key === "Enter" && addDomain()} />
          <button className="btn" onClick={addDomain}>Add domain</button>
        </div>
        <div className="domain-list">
          {(config.approvedDomains || []).length === 0
            ? <p className="hint">No domains yet, so account creation is closed.</p>
            : (config.approvedDomains || []).map((d) => (
              <span key={d} className="domain-chip">@{d}<button className="btn-x" onClick={() => removeDomain(d)}>✕</button></span>
            ))}
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={!!config.registrationOpen}
            onChange={(e) => {
              const next = JSON.parse(JSON.stringify(config));
              next.registrationOpen = e.target.checked;
              onChange(next, { action: e.target.checked ? "Opened registration" : "Closed registration" });
            }} />
          Allow new people to create accounts
        </label>
      </div>
    </div>
  );
}

function PendingRow({ u, stores, busy, onApprove, onReject }) {
  const [ids, setIds] = useState([]);
  return (
    <div className="pending-row">
      <div className="pending-who">
        <b>{u.name || "-"}</b>
        <span className="mono">{u.email}</span>
      </div>
      <div className="store-checks tight">
        {stores.map((s) => (
          <label key={s.id} className="check-inline">
            <input type="checkbox" checked={ids.includes(s.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />
            {s.name}
          </label>
        ))}
      </div>
      <div className="row-actions">
        <button className="btn" disabled={busy || ids.length === 0} onClick={() => onApprove(ids)}>Approve</button>
        <button className="btn-x" disabled={busy} onClick={onReject}>Reject</button>
      </div>
    </div>
  );
}

/* ---------------- Audit log ---------------- */
function AuditLog() {
  const [log, setLog] = useState(null);
  const [filter, setFilter] = useState("");
  useEffect(() => { loadShared(AUDIT_KEY, []).then(setLog); }, []);
  if (!log) return <div className="loading">Loading audit log…</div>;
  const shown = log.filter((e) => !filter || JSON.stringify(e).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="audit">
      <div className="inline-form">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, store, action…" style={{ minWidth: 280 }} />
        <button className="btn secondary" onClick={() => downloadCSV(`Audit-Log_${today()}.csv`, [["When", "User", "Store", "Action", "Detail"], ...log.map((e) => [e.t, e.user, e.store || "", e.action, e.detail || ""])])}>Export CSV</button>
      </div>
      <p className="hint">Last {log.length} events (capped at 400). Imports, standards edits, roster changes, and user access changes all land here automatically.</p>
      <div className="card">
        <table className="roster-table wide">
          <thead><tr><th>When</th><th>User</th><th>Store</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i}>
                <td className="mono">{new Date(e.t).toLocaleString()}</td>
                <td>{e.user}</td>
                <td>{e.store || "-"}</td>
                <td><b>{e.action}</b></td>
                <td>{e.detail || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function SettingsPanel({ config, onChange }) {
  const [newRole, setNewRole] = useState("");
  const [cropping, setCropping] = useState(null); // { storeId, src }
  const [wizard, setWizard] = useState(null); // { store } for edit, {} for new

  const saveStore = (draft) => {
    const next = JSON.parse(JSON.stringify(config));
    const existing = next.stores.find((s) => s.id === draft.id);
    if (existing) {
      Object.assign(existing, draft);
      onChange(next, { action: "Customized store", detail: draft.name });
    } else {
      next.stores.push(draft);
      next.standards[draft.id] = {};
      for (const r of next.roles) next.standards[draft.id][r.id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
      onChange(next, { action: "Added store", detail: draft.name });
    }
    setWizard(null);
  };
  const moveStore = (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= config.stores.length) return;
    const next = JSON.parse(JSON.stringify(config));
    const [item] = next.stores.splice(idx, 1);
    next.stores.splice(to, 0, item);
    onChange(next, { action: "Reordered stores", detail: `${item.name} moved ${dir < 0 ? "up" : "down"}` });
  };
  const deleteStore = async (s) => {
    const ok = window.confirm(`Delete ${s.name}? Its roster, imports, and history stay saved in storage, but the store disappears from every view and its standards are removed. Anyone whose only access was this store will have nothing to see.`);
    if (!ok) return;
    const next = JSON.parse(JSON.stringify(config));
    next.stores = next.stores.filter((x) => x.id !== s.id);
    delete next.standards[s.id];
    onChange(next, { action: "Deleted store", detail: s.name });
    // strip the store from everyone's access list
    try {
      const people = await listProfiles();
      for (const u of people) {
        if ((u.stores || []).includes(s.id)) {
          await updateProfile(u.id, { stores: (u.stores || []).filter((id) => id !== s.id) });
        }
      }
    } catch (e) { /* profiles aren't available in preview */ }
  };
  const addRole = () => {
    const name = newRole.trim(); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (config.roles.some((r) => r.id === id)) return;
    const next = JSON.parse(JSON.stringify(config));
    next.roles.push({ id, name, color: ROLE_COLORS[next.roles.length % ROLE_COLORS.length] });
    for (const s of next.stores) {
      next.standards[s.id] = next.standards[s.id] || {};
      next.standards[s.id][id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
    }
    setNewRole("");
    onChange(next, { action: "Added position", detail: name });
  };
  const setIcon = (storeId, file) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { alert("That image is too large. Please use one under 4 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setCropping({ storeId, src: reader.result });
    reader.readAsDataURL(file);
  };
  const saveCroppedIcon = (dataUrl) => {
    const next = JSON.parse(JSON.stringify(config));
    const s = next.stores.find((x) => x.id === cropping.storeId);
    s.icon = dataUrl;
    setCropping(null);
    onChange(next, { action: "Updated store logo", detail: s.name });
  };
  const clearIcon = (storeId) => {
    const next = JSON.parse(JSON.stringify(config));
    const s = next.stores.find((x) => x.id === storeId);
    s.icon = null;
    onChange(next, { action: "Removed store logo", detail: s.name });
  };

  return (
    <div className="settings">
      <div className="card">
        <h3>Stores &amp; Manufacturer Logos</h3>
        <div className="store-list">
          {config.stores.map((s, idx) => (
            <div key={s.id} className="store-item">
              <div className="store-item-main">
                <div className="store-item-order">
                  <button className="btn-arrow" disabled={idx === 0} onClick={() => moveStore(idx, -1)} title="Move up">↑</button>
                  <button className="btn-arrow" disabled={idx === config.stores.length - 1} onClick={() => moveStore(idx, 1)} title="Move down">↓</button>
                </div>
                {s.icon ? <img className="store-logo" src={s.icon} alt="" /> : <div className="store-logo placeholder">{s.name[0]}</div>}
                <div className="store-item-name">
                  <b>{s.name}</b>
                  <span className="brand-swatch" title="Store colors"
                    style={{ background: `linear-gradient(130deg, ${(s.brand || DEFAULT_BRAND).primary}, ${(s.brand || DEFAULT_BRAND).deep})` }} />
                </div>
              </div>
              <div className="store-item-actions">
                <button className="btn-ghost" onClick={() => setWizard({ store: s })}>Customize</button>
                <label className="btn-ghost file-btn">
                  {s.icon ? "Replace logo" : "Upload logo"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setIcon(s.id, e.target.files[0]); e.target.value = ""; }} />
                </label>
                {s.icon && <button className="btn-x" onClick={() => setCropping({ storeId: s.id, src: s.icon })}>Crop</button>}
                {s.icon && <button className="btn-x" onClick={() => clearIcon(s.id)}>Remove logo</button>}
                <button className="btn-x danger" onClick={() => deleteStore(s)}>Delete store</button>
              </div>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <button className="btn" onClick={() => setWizard({})}>+ New Store</button>
        </div>
        <p className="hint">"New Store" opens a setup tool where you pick the manufacturer colors, logo, standards, and thresholds, with a live preview of the manager's view, before the store is created. "Customize" reopens that tool for an existing store. The order here is the order everywhere.</p>
      </div>
      {wizard && (
        <StoreWizard config={config} store={wizard.store} onCancel={() => setWizard(null)} onSave={saveStore} />
      )}
      <div className="card">
        <h3>Positions</h3>
        <p className="hint">
          Both The Board and Coaching are built on cars sold. A position that does not deliver units
          has no meaningful closing rate or per-car ratio, so it is switched off for both by default.
        </p>
        <table className="roster-table">
          <thead>
            <tr><th>Position</th><th>Show on The Board</th><th>Include in Coaching</th></tr>
          </thead>
          <tbody>
            {config.roles.map((r) => (
              <tr key={r.id}>
                <td><span className="role-chip" style={{ background: r.color }}>{r.name}</span></td>
                <td>
                  <label className="check-inline">
                    <input type="checkbox" checked={r.onBoard !== false}
                      onChange={(e) => {
                        const next = JSON.parse(JSON.stringify(config));
                        next.roles.find((x) => x.id === r.id).onBoard = e.target.checked;
                        onChange(next, { action: "Changed position visibility", detail: `${r.name} on The Board: ${e.target.checked}` });
                      }} />
                    Delivers units
                  </label>
                </td>
                <td>
                  <label className="check-inline">
                    <input type="checkbox" checked={r.coaching !== false}
                      onChange={(e) => {
                        const next = JSON.parse(JSON.stringify(config));
                        next.roles.find((x) => x.id === r.id).coaching = e.target.checked;
                        onChange(next, { action: "Changed position visibility", detail: `${r.name} in Coaching: ${e.target.checked}` });
                      }} />
                    Coach on cars
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-form">
          <input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. Internet Sales" />
          <button className="btn" onClick={addRole}>Add Position</button>
        </div>
        <p className="hint">Every store gets its own editable standards for each position.</p>
      </div>
      {cropping && <LogoCropper src={cropping.src} onCancel={() => setCropping(null)} onSave={saveCroppedIcon} />}
    </div>
  );
}

/* ---------------- Logo cropper ---------------- */
function LogoCropper({ src, onCancel, onSave }) {
  const SIZE = 280; // on-screen crop square
  const OUT = 256;  // saved logo resolution
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // image top-left offset in crop space
  const drag = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const mz = SIZE / Math.min(img.width, img.height); // cover the square at minimum
      setMinZoom(mz); setZoom(mz);
      setPos({ x: (SIZE - img.width * mz) / 2, y: (SIZE - img.height * mz) / 2 });
      setReady(true);
    };
    img.src = src;
  }, [src]);

  const clamp = useCallback((p, z) => {
    const img = imgRef.current; if (!img) return p;
    const w = img.width * z, h = img.height * z;
    return {
      x: Math.min(0, Math.max(SIZE - w, p.x)),
      y: Math.min(0, Math.max(SIZE - h, p.y)),
    };
  }, []);

  // redraw preview
  useEffect(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img || !ready) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, pos.x, pos.y, img.width * zoom, img.height * zoom);
  }, [pos, zoom, ready]);

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos(clamp({ x: drag.current.ox + (e.clientX - drag.current.sx), y: drag.current.oy + (e.clientY - drag.current.sy) }, zoom));
  };
  const onPointerUp = () => { drag.current = null; };

  const onZoom = (z) => {
    // zoom around the center of the crop square
    const img = imgRef.current; if (!img) return;
    const cx = (SIZE / 2 - pos.x) / zoom, cy = (SIZE / 2 - pos.y) / zoom;
    const nz = Math.max(minZoom, Math.min(minZoom * 5, z));
    setZoom(nz);
    setPos(clamp({ x: SIZE / 2 - cx * nz, y: SIZE / 2 - cy * nz }, nz));
  };

  const save = () => {
    const img = imgRef.current; if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUT; out.height = OUT;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    const scale = OUT / SIZE;
    ctx.drawImage(img, pos.x * scale, pos.y * scale, img.width * zoom * scale, img.height * zoom * scale);
    onSave(out.toDataURL("image/png"));
  };

  return (
    <div className="crop-overlay" onClick={onCancel}>
      <div className="card crop-card" onClick={(e) => e.stopPropagation()}>
        <h3>Crop Logo</h3>
        <p className="hint">Drag to position, use the slider to zoom. The square is exactly what everyone will see.</p>
        <div className="crop-stage">
          <canvas ref={canvasRef} width={SIZE} height={SIZE} className="crop-canvas"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        </div>
        <input className="crop-zoom" type="range" min={minZoom} max={minZoom * 5} step={minZoom / 50} value={zoom}
          onChange={(e) => onZoom(parseFloat(e.target.value))} />
        <div className="crop-actions">
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={save} disabled={!ready}>Save Logo</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shell + styles ---------------- */
function Shell({ children }) {
  return <div className="lpc">{children}
      <div className="version-stamp" title="Build version">v{APP_VERSION}</div></div>;
}

function Style() {
  return (
    <style>{`
      :root {
        --bg: #F5F5F7; --card: #FFFFFF; --ink: #1D1D1F; --ink-2: #6E6E73; --ink-3: #AEAEB2;
        --line: rgba(0,0,0,.08); --blue: #2A5E9B; --green: #30B155; --red: #E5473C; --amber: #C77800; --lime: #C1D730;
        --radius: 18px; --spring: cubic-bezier(.32,.72,.33,1);
        --shadow-1: 0 1px 2px rgba(0,0,0,.04), 0 2px 12px rgba(0,0,0,.05);
        --shadow-2: 0 4px 10px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.10);
      }
      .lpc { min-height: 100vh; background: var(--bg); color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        font-size: 14px; padding-bottom: 72px; -webkit-font-smoothing: antialiased; position:relative; isolation:isolate;
        overflow-x:clip;
        /* Scroll anchoring is what shifts the store logo when you reverse scroll
           direction. It was only turned off for touch; the desktop kept it, and the
           extra compositor layers (promoted top bar, fixed version stamp) made it
           show up there too. Off everywhere now. */
        overflow-anchor: none; }
      .lpc * { overflow-anchor: none; }
      /* base wash */
      .lpc::before { content:""; position:fixed; inset:-10%; z-index:-2; pointer-events:none;
        background:
          radial-gradient(38% 34% at 15% 8%, rgba(136,198,234,.38), transparent 70%),
          radial-gradient(34% 32% at 85% 14%, rgba(193,215,48,.24), transparent 70%),
          var(--bg);
        animation: driftA 34s ease-in-out infinite alternate; will-change: transform; }
      /* second drifting layer, slower and offset, for parallax life */
      .lpc::after { content:""; position:fixed; inset:-15%; z-index:-2; pointer-events:none;
        background:
          radial-gradient(30% 30% at 70% 85%, rgba(42,94,155,.16), transparent 72%),
          radial-gradient(26% 26% at 25% 92%, rgba(0,168,150,.12), transparent 72%);
        animation: driftB 46s ease-in-out infinite alternate; will-change: transform; }
      @keyframes driftA {
        0%   { transform: translate3d(0,0,0) scale(1); }
        50%  { transform: translate3d(2.5%, 2%, 0) scale(1.06); }
        100% { transform: translate3d(-2%, 3%, 0) scale(1.03); }
      }
      @keyframes driftB {
        0%   { transform: translate3d(0,0,0) scale(1.05); }
        50%  { transform: translate3d(-3%, -2.5%, 0) scale(1); }
        100% { transform: translate3d(2%, -3%, 0) scale(1.08); }
      }

      /* ---- living logo: needle sweeps left→right, lime arc draws in behind it ---- */
      .logo-anim { animation: logoFloat 7s ease-in-out 1.8s infinite; will-change: transform; }
      .logo-anim .logo-arc {
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        animation: arcDraw 1.5s var(--spring) .25s forwards;
      }
      .logo-anim .logo-needle {
        transform: rotate(-140.2deg);
        animation: needleSweep 1.5s var(--spring) .25s forwards;
      }
      @keyframes arcDraw { to { stroke-dashoffset: 0; } }
      /* needle sweeps from the arc's start (180°) to its resting angle (320.2°).
         No overshoot: backing off even a few degrees exposed the lime arc behind the tip. */
      @keyframes needleSweep {
        from { transform: rotate(-140.2deg); }
        to   { transform: rotate(0deg); }
      }
      @keyframes logoFloat {
        0%, 100% { transform: translateY(0) scale(1); }
        50%      { transform: translateY(-3px) scale(1.015); }
      }

      .lpc * { box-sizing: border-box; }
      ::selection { background: rgba(42,94,155,.2); }

      /* ---- store hero (manager landing) ---- */
      .hero { margin-bottom: 26px; --sp: #2A5E9B; --sd: #1D4674; --sa: #C1D730; }
      .hero-band { display:flex; align-items:center; justify-content:space-between; gap:32px; flex-wrap:wrap;
        padding:30px 34px; border-radius:24px; position:relative; overflow:hidden;
        background: linear-gradient(120deg, var(--sp) 0%, var(--sp) 40%, var(--sd) 100%);
        box-shadow: 0 12px 34px rgba(29,70,116,.30), inset 0 1px 0 rgba(255,255,255,.18);
        animation: heroIn .6s var(--spring) both; }
      .hero-band::after { content:""; position:absolute; inset:0; pointer-events:none;
        background: radial-gradient(40% 70% at 78% 10%, color-mix(in srgb, var(--sa) 26%, transparent), transparent 70%),
                    radial-gradient(45% 80% at 8% 100%, rgba(255,255,255,.16), transparent 70%);
        animation: heroSheen 18s ease-in-out infinite alternate; }
      .hero-id { display:flex; align-items:center; gap:20px; position:relative; z-index:1; }
      .hero-text { display:flex; flex-direction:column; gap:6px; }
      .hero-logo { width:64px; height:64px; border-radius:16px; background:rgba(255,255,255,.95);
        display:flex; align-items:center; justify-content:center;
        overflow:hidden; box-shadow: 0 4px 14px rgba(0,0,0,.18); flex:0 0 auto; }
      .hero-logo img { width:100%; height:100%; object-fit:contain; }
      /* small caps get real tracking. They were set tight and read as a smudge. */
      .hero-greet { color:rgba(255,255,255,.75); font-size:11.5px; font-weight:700;
        letter-spacing:.12em; text-transform:uppercase; }
      .hero-store { color:#fff; font-size:31px; font-weight:700; letter-spacing:-.015em; line-height:1.12; margin:0; }
      .hero-date { color:rgba(255,255,255,.62); font-size:13px; letter-spacing:.015em; }

      .hero-ring-wrap { position:relative; flex:0 0 auto; z-index:1; }
      .hero-ring { display:block; }
      .hero-ring-fill { animation: ringIn 1.5s var(--spring) .3s both; }
      @keyframes ringIn { from { stroke-dashoffset: var(--c); } to { stroke-dashoffset: 0; } }
      /* inset pulls the label off the stroke. "Cleared" was touching the ring. */
      .hero-ring-label { position:absolute; inset:20px; display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:6px; }
      .hero-ring-pct { color:#fff; font-size:31px; font-weight:700; letter-spacing:-.03em; line-height:1;
        font-variant-numeric:tabular-nums; }
      .hero-ring-pct span { font-size:16px; font-weight:600; opacity:.68; margin-left:2px; }
      .hero-ring-cap { color:rgba(255,255,255,.72); font-size:9.5px; text-transform:uppercase;
        letter-spacing:.16em; font-weight:700; line-height:1; }

      .hero-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(134px, 1fr)); gap:14px; margin-top:16px; }
      .tile { position:relative; overflow:hidden;
        background: rgba(255,255,255,.6); border:1px solid rgba(255,255,255,.75); border-radius:16px;
        padding:17px 19px 17px 22px;
        backdrop-filter: blur(22px) saturate(170%); -webkit-backdrop-filter: blur(22px) saturate(170%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 6px 18px rgba(31,54,86,.07);
        transition: transform .3s var(--spring), box-shadow .3s var(--spring);
        animation: tileIn .5s var(--spring) both;
        --accent: rgba(0,0,0,.12); }
      /* full-height accent. A border-left would be curved away by the border-radius
         and blend into the pale top/bottom borders, which made the colour stop short. */
      .tile::before { content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
        background: var(--accent); }
      .tile:hover { transform: translateY(-2px); box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 12px 26px rgba(31,54,86,.12); }
      .hero-tiles .tile:nth-child(1) { animation-delay:.10s; }
      .hero-tiles .tile:nth-child(2) { animation-delay:.17s; }
      .hero-tiles .tile:nth-child(3) { animation-delay:.24s; }
      .hero-tiles .tile:nth-child(4) { animation-delay:.31s; }
      .hero-tiles .tile:nth-child(5) { animation-delay:.38s; }
      @keyframes tileIn { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform:none; } }
      .tile-num { font-size:31px; font-weight:700; letter-spacing:-.03em; line-height:1.05;
        font-variant-numeric:tabular-nums; }
      .tile-of { font-size:15px; font-weight:600; color:var(--ink-3); margin-left:2px; letter-spacing:0; }
      .tile-label { font-size:10px; color:var(--ink-2); font-weight:700; margin-top:8px;
        letter-spacing:.09em; text-transform:uppercase; }
      .tile-good { --accent:#30B155; } .tile-good .tile-num { color:#1E7A3C; }
      .tile-bad  { --accent:#E5473C; } .tile-bad .tile-num { color:#C13529; }
      .tile-warn { --accent:#FF9F0A; } .tile-warn .tile-num { color:#B8730A; }
      .tile-info { --accent: var(--sp); } .tile-info .tile-num { color: var(--sd); }
      .tile-flat { --accent:rgba(0,0,0,.12); } .tile-flat .tile-num { color:var(--ink-3); }
      /* the tiles are buttons: click one to see only those people on the board below */
      button.tile { cursor:pointer; text-align:left; font:inherit; width:100%; display:block; }
      .tile.picked { outline:2px solid var(--accent); outline-offset:1px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 10px 24px rgba(31,54,86,.14); }
      .tile-static { cursor:default; }
      .filter-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
        background:rgba(42,94,155,.08); border:1px solid rgba(42,94,155,.18); border-radius:12px;
        padding:10px 15px; margin-bottom:14px; font-size:13px; }
      .filter-what b { font-weight:700; }

      .hero-strip { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:14px;
        animation: tileIn .5s var(--spring) .40s both; }
      .strip-chip { display:inline-flex; align-items:center; gap:8px; border:none; cursor:pointer;
        padding:9px 15px; border-radius:20px; font-size:12.5px; font-weight:600; transition: all .2s var(--spring); }
      .strip-chip:hover { transform: translateY(-1px); box-shadow: var(--shadow-1); }
      .chip-ok { background:rgba(48,177,85,.14); color:#1E7A3C; }
      .chip-warn { background:rgba(255,159,10,.16); color:#95600A; }
      .chip-dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
      .chip-warn .chip-dot { animation: chipPulse 1.8s ease-in-out infinite; }
      @keyframes chipPulse { 0%,100% { opacity:.45; transform:scale(1); } 50% { opacity:1; transform:scale(1.25); } }
      .strip-note { font-size:12px; color:var(--ink-2); background:rgba(255,255,255,.55); padding:8px 14px; border-radius:20px;
        border:1px solid rgba(255,255,255,.7); }
      .strip-leader { display:inline-flex; align-items:center; gap:8px; margin-left:auto;
        padding:8px 15px; border-radius:20px; font-size:12.5px;
        background: linear-gradient(100deg, rgba(193,215,48,.22), rgba(136,198,234,.18));
        border:1px solid rgba(193,215,48,.35); }
      .leader-crown { color:#7E9410; font-size:13px; animation: starGlow 3.2s ease-in-out infinite; }
      .leader-name { font-weight:700; }
      .leader-tag { color:var(--ink-2); }
      .leader-pct { font-weight:700; color:#1E7A3C; }
      @media (max-width: 700px) {
        .hero-band { padding:18px; }
        .hero-store { font-size:22px; }
        .strip-leader { margin-left:0; }
      }

      /* ---- store wizard ---- */
      .wiz-overlay { position:fixed; inset:0; z-index:60; background:rgba(18,33,47,.42);
        backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
        display:flex; align-items:center; justify-content:center; padding:20px; animation: fadeIn .25s ease; }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      .wiz { width:100%; max-width:920px; max-height:90vh; overflow:auto; border-radius:24px;
        background:rgba(255,255,255,.86); backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%);
        border:1px solid rgba(255,255,255,.8); box-shadow: 0 30px 70px rgba(18,33,47,.32);
        animation: heroIn .4s var(--spring) both; position:relative; }
      .wiz-head { display:flex; align-items:center; justify-content:space-between; padding:20px 24px 0; }
      .wiz-head h3 { font-size:20px; font-weight:700; letter-spacing:-.02em; }
      .wiz-body { display:grid; grid-template-columns: 1.15fr .85fr; gap:24px; padding:16px 24px; }
      .wiz-form label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.07em;
        color:var(--ink-3); font-weight:700; margin:14px 0 6px; }
      .wiz-form > input[type=text], .wiz-form > input { width:100%; }
      .wiz-presets { display:grid; grid-template-columns: repeat(auto-fill, minmax(88px,1fr)); gap:8px; }
      .wiz-preset { display:flex; flex-direction:column; align-items:center; gap:5px; padding:8px 4px; cursor:pointer;
        border-radius:12px; border:2px solid transparent; background:rgba(255,255,255,.5); transition: all .2s var(--spring); }
      .wiz-preset:hover { background:#fff; transform:translateY(-1px); }
      .wiz-preset.on { border-color:var(--blue); background:#fff; box-shadow: var(--shadow-1); }
      .wiz-swatch { width:36px; height:36px; border-radius:10px; position:relative; box-shadow: inset 0 1px 0 rgba(255,255,255,.3); }
      .wiz-swatch-dot { position:absolute; right:-2px; bottom:-2px; width:12px; height:12px; border-radius:50%; border:2px solid #fff; }
      .wiz-preset-label { font-size:10.5px; font-weight:600; color:var(--ink-2); }
      .wiz-colors { display:flex; gap:14px; flex-wrap:wrap; }
      .wiz-color { display:flex !important; align-items:center; gap:7px; text-transform:none !important; letter-spacing:0 !important;
        font-size:12px !important; color:var(--ink) !important; margin:0 !important; }
      .wiz-color input[type=color] { width:38px; height:30px; border:1px solid var(--line); border-radius:8px; padding:0; cursor:pointer; background:none; }
      .wiz-logo-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .wiz-nums { display:flex; gap:16px; flex-wrap:wrap; }
      .wiz-nums .thr-label { text-transform:none; letter-spacing:0; font-size:12.5px; color:var(--ink); margin:0; }
      .wiz-foot { display:flex; justify-content:flex-end; gap:10px; padding:12px 24px 22px; border-top:1px solid var(--line); margin-top:4px; }
      .wiz-foot .btn:disabled { opacity:.45; cursor:default; }

      .wiz-preview-label { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--ink-3); font-weight:700; margin-bottom:8px; }
      .wiz-hero { --sp:#2A5E9B; --sd:#1D4674; --sa:#C1D730; }
      .wiz-hero-band { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-radius:16px;
        background: linear-gradient(120deg, var(--sp) 0%, var(--sp) 40%, var(--sd) 100%);
        box-shadow: 0 8px 20px rgba(31,54,86,.22); }
      .wiz-hero-id { display:flex; align-items:center; gap:10px; }
      .wiz-hero-logo { width:38px; height:38px; border-radius:10px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex:0 0 auto; }
      .wiz-hero-logo img { width:100%; height:100%; object-fit:contain; }
      .wiz-hero-greet { color:rgba(255,255,255,.7); font-size:10px; font-weight:600; }
      .wiz-hero-name { color:#fff; font-size:16px; font-weight:700; letter-spacing:-.02em; }
      .wiz-hero-ring { position:relative; width:52px; height:52px; flex:0 0 auto; }
      .wiz-hero-pct { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:700; }
      .wiz-hero-tiles { display:flex; gap:7px; margin-top:8px; }
      .wiz-tile { flex:1; background:rgba(255,255,255,.7); border:1px solid rgba(255,255,255,.8); border-left-width:3px;
        border-radius:10px; padding:8px 9px; }
      .wiz-tile b { display:block; font-size:16px; font-weight:700; letter-spacing:-.02em; }
      .wiz-tile span { font-size:9.5px; color:var(--ink-2); font-weight:600; }
      .brand-swatch { display:inline-block; width:22px; height:12px; border-radius:4px; margin-left:8px; vertical-align:middle;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.3); }
      @media (max-width: 780px) { .wiz-body { grid-template-columns: 1fr; } }

      /* ---- loading screen ---- */
      .loadscreen { min-height:70vh; display:flex; align-items:center; justify-content:center; }
      .loadscreen-inner { text-align:center; animation: heroIn .5s var(--spring) both; }
      .loadscreen-logo { display:flex; justify-content:center; margin-bottom:22px;
        filter: drop-shadow(0 10px 26px rgba(42,94,155,.28)); }
      .loadscreen-bar { width:170px; height:4px; border-radius:4px; background:rgba(42,94,155,.14); overflow:hidden; margin:0 auto; }
      .loadscreen-bar-fill { width:40%; height:100%; border-radius:4px;
        background:linear-gradient(90deg, var(--blue), var(--lime));
        animation: loadSlide 1.25s ease-in-out infinite; }
      @keyframes loadSlide {
        0%   { transform: translateX(-120%); }
        100% { transform: translateX(320%); }
      }
      .loadscreen-label { margin-top:14px; font-size:12.5px; color:var(--ink-2); font-weight:600; letter-spacing:.03em; }

      /* ---- board launcher ---- */
      .board-launch { max-width:760px; margin:0 auto; }
      .board-launch-card { text-align:center; padding:34px 28px; }
      .bl-logo { display:flex; justify-content:center; margin-bottom:14px; }
      .bl-logo img { width:64px; height:64px; object-fit:contain; border-radius:14px; }
      .bl-title { font-size:24px; font-weight:700; letter-spacing:-.02em; margin-bottom:6px; }
      .board-launch-card .btn { margin-top:14px; }
      .bl-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:14px; margin:16px 0; }
      .bl-tile { --sp:#2A5E9B; --sd:#1D4674; display:flex; flex-direction:column; align-items:flex-start; gap:8px;
        padding:18px; border-radius:18px; cursor:pointer; border:none; text-align:left; color:#fff;
        background: linear-gradient(130deg, var(--sp), var(--sd));
        box-shadow: 0 8px 22px rgba(31,54,86,.18); transition: transform .25s var(--spring), box-shadow .25s var(--spring);
        animation: tileIn .5s var(--spring) both; }
      .bl-tile:hover { transform: translateY(-3px); box-shadow: 0 16px 34px rgba(31,54,86,.26); }
      .bl-tile-logo { width:42px; height:42px; border-radius:11px; background:rgba(255,255,255,.95);
        display:flex; align-items:center; justify-content:center; overflow:hidden; }
      .bl-tile-logo img { width:100%; height:100%; object-fit:contain; }
      .bl-tile-ph { font-weight:700; color:var(--ink-2); font-size:17px; }
      .bl-tile-name { font-weight:700; font-size:16px; letter-spacing:-.01em; }
      .bl-tile-go { font-size:12px; opacity:.75; font-weight:600; }

      /* ---- welcome / backup / merge / channel prompt ---- */
      .welcome { border-left:4px solid var(--lime); }
      .welcome-head { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      .welcome-lede { font-size:14px; color:var(--ink-2); margin:6px 0 14px; max-width:70ch; }
      .welcome-steps { display:grid; grid-template-columns: repeat(auto-fit, minmax(210px,1fr)); gap:14px; margin-bottom:12px; }
      .welcome-step { display:flex; gap:10px; align-items:flex-start; }
      .ws-num { flex:0 0 auto; width:24px; height:24px; border-radius:50%; background:var(--blue); color:#fff;
        display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
      .welcome-step b { font-size:13.5px; }
      .welcome-step p { font-size:12.5px; color:var(--ink-2); margin-top:2px; }

      .recover-card { border-left:4px solid var(--amber); }
      .snap-store { padding:12px 0; border-bottom:1px solid rgba(0,0,0,.06); }
      .snap-store:last-child { border-bottom:none; }
      .snap-store-name { display:flex; align-items:center; gap:10px; }
      .snap-list { margin:8px 0 0 42px; }
      .snap-row { display:flex; align-items:center; gap:12px; padding:5px 0; font-size:12.5px; flex-wrap:wrap; }
      .snap-when { font-weight:600; font-variant-numeric:tabular-nums; }
      .snap-reason { color:var(--ink-2); flex:1; }

      .merge-arrow { color:var(--ink-3); font-weight:700; }
      .alias-list { margin-top:12px; }
      .alias-row { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:12.5px; }

      .chan-row { display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid rgba(0,0,0,.06); }
      .chan-row:last-child { border-bottom:none; }
      .chan-file { flex:1; font-size:13px; font-weight:600; word-break:break-all; }

      /* colour-blind safety: never rely on colour alone */
      .cell-mark { font-weight:700; margin-right:5px; }
      .co-badge.yes, .co-badge.no { letter-spacing:.01em; }

      /* ---- touch devices: stability over glass ----
         Three things were compounding to make the store logo jump and the header
         jitter on iOS:
           1. overflow-x:clip on the tall root container. Clipping overflow on a long
              scrolling element makes Safari's scroll anchoring misfire, so reversing
              scroll direction shifts the content. This was the jump.
           2. will-change:transform on the drifting background. Even with the animation
              switched off, will-change permanently promotes a compositor layer that
              repaints on every scroll frame. This was the jitter.
           3. Infinite animations (background drift, hero sheen, logo float) repainting
              behind blurred surfaces.
         On touch we drop all of it: no clip, no anchoring, no promoted layers, no
         blur, no looping animation. The desktop keeps the full treatment. */
      @media (hover: none) and (pointer: coarse) {
        .lpc {
          overflow-x: visible;          /* the clip was the jump */
          overflow-anchor: none;        /* stop Safari re-anchoring mid-scroll */
          isolation: auto;
          background: linear-gradient(180deg, #F7F8FA 0%, #EDF2F8 100%);
        }
        .lpc::before, .lpc::after { display: none !important; }

        /* no promoted layers anywhere. This is what was jittering. */
        .lpc, .lpc * { will-change: auto !important; }

        /* nothing loops forever behind a scrolling surface */
        .logo-anim, .hero-band::after, .dz-icon, .star-badge,
        .chip-warn .chip-dot, .leader-crown, .loadscreen-bar-fill {
          animation: none !important;
        }
        /* leave the logo in its finished state rather than mid-sweep */
        .logo-anim .logo-arc { stroke-dashoffset: 0 !important; }
        .logo-anim .logo-needle { transform: rotate(0deg) !important; }
        .loadscreen-bar-fill { width: 100%; }

        /* the sticky blurred header was the other half of the jump */
        .topbar {
          position: static;
          backdrop-filter: none; -webkit-backdrop-filter: none;
          background: #FFFFFF;
          transform: none;
        }
        .topbar::after { display: none; }
        .version-stamp { backdrop-filter:none; -webkit-backdrop-filter:none; background:rgba(255,255,255,.85); }
        .card, .tile, .store-item, .wiz, .wiz-overlay, .splash-store, .bl-tile {
          backdrop-filter: none; -webkit-backdrop-filter: none;
        }
        .card, .tile, .store-item, .wiz { background: #FFFFFF; }

        /* hover lifts only ever stick on a touchscreen */
        .card:hover, .tile:hover, .store-item:hover, .bl-tile:hover,
        .splash-store:hover, .strip-chip:hover { transform: none; }
      }

      /* ---- small screens (layout only) ---- */
      @media (max-width: 640px) {
        .lpc { font-size:13.5px; padding-bottom:48px; }
        .topbar { padding:10px 14px; }
        .page, .print-area { padding-left:14px; padding-right:14px; }
        /* .board-page sits inside .page, so don't stack their side padding */
        .board-page { padding:18px 0 0; }
        .hero-band { flex-direction:column; align-items:flex-start; padding:18px; }
        .hero-ring-wrap { align-self:flex-end; margin-top:-46px; }
        .hero-tiles { grid-template-columns: repeat(2, 1fr); }
        .hero-strip { flex-direction:column; align-items:stretch; }
        .strip-leader { margin-left:0; }

        /* only cards that actually hold a wide table become scroll containers */
        .card:has(table) { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .checkout-table, .roster-table, .gm-table { min-width:520px; }

        /* store rows stack; every action stays on screen, no sideways swipe */
        .store-item { flex-direction:column; align-items:stretch; }
        .store-item-actions { justify-content:flex-start; }
        .store-item-actions .btn-ghost, .store-item-actions .btn-x { flex:1 1 auto; text-align:center; }

        .assoc-row { flex-wrap:wrap; gap:6px; }
        .assoc-leads { margin-left:auto; }
        .seg-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .seg { min-width:max-content; }
        .wiz-body { grid-template-columns:1fr; }
        .wiz { max-height:94vh; border-radius:18px; }
        .inline-form { flex-direction:column; align-items:stretch; }
        .inline-form > * { width:100%; }
        .row-actions { flex-wrap:wrap; }
        .pending-row .row-actions { margin-left:0; }
        .splash-actions { max-width:100%; }
        .stepper-row { justify-content:space-between; }
      }

      /* ---- store list (reflows instead of a cramped table) ---- */
      .store-list { display:flex; flex-direction:column; gap:10px; margin-bottom:14px; }
      .store-item { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;
        padding:12px 14px; border-radius:14px; background:rgba(255,255,255,.5); border:1px solid rgba(255,255,255,.7); }
      .store-item-main { display:flex; align-items:center; gap:12px; min-width:0; }
      .store-item-order { display:flex; flex-direction:column; gap:2px; }
      .store-item-name { display:flex; align-items:center; gap:8px; min-width:0; }
      .store-item-name b { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .store-item-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .btn-x.danger { color:var(--red); }
      .btn-x.danger:hover { background:rgba(229,71,60,.1); }

      /* ---- upload history ---- */
      .up-list { display:flex; flex-direction:column; }
      .up-row { display:grid; grid-template-columns: 140px 140px 1fr 120px 90px auto; gap:10px; align-items:center;
        padding:7px 0; border-top:1px solid rgba(0,0,0,.05); font-size:12.5px; }
      .up-row:first-child { border-top:none; }
      .up-when { font-weight:700; font-variant-numeric:tabular-nums; }
      .up-type { color:var(--blue); font-weight:600; }
      .up-file { color:var(--ink-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .up-count, .up-by { color:var(--ink-3); }

      /* ---- coaching ---- */
      .bench-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:12px; margin-top:14px; }
      .bench-tile { background:rgba(193,215,48,.12); border:1px solid rgba(193,215,48,.35); border-radius:14px; padding:14px 16px; }
      .bench-num { font-size:24px; font-weight:700; letter-spacing:-.02em; color:#5E7A0C; font-variant-numeric:tabular-nums; }
      .bench-lbl { font-size:11px; color:var(--ink-2); font-weight:600; margin-top:4px; }

      .coach-list { display:flex; flex-direction:column; gap:6px; }
      .coach-row { display:grid; grid-template-columns: 1.4fr 1fr .8fr 1.2fr auto; gap:12px; align-items:center;
        text-align:left; padding:11px 14px; border-radius:12px; cursor:pointer; border:1px solid transparent;
        background:rgba(255,255,255,.5); font-size:13px; transition: all .2s var(--spring); }
      .coach-row:hover { background:#fff; }
      .coach-row.on { border-color:var(--blue); background:#fff; box-shadow:var(--shadow-1); }
      .coach-name { font-weight:700; font-size:14px; }
      .coach-role { color:var(--ink-2); }
      .coach-units { font-weight:700; } .coach-units em { font-style:normal; font-weight:500; color:var(--ink-3); font-size:11.5px; }
      .coach-days { color:var(--ink-3); font-size:12px; } .coach-days.dim { opacity:.6; }
      .coach-open { color:var(--blue); font-weight:600; font-size:12px; }

      .assoc-card-full { border-top:4px solid var(--blue); }
      .ac-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      .ac-name { font-size:26px; font-weight:700; letter-spacing:-.02em; }
      .ac-sub { color:var(--ink-2); font-size:13px; margin-top:3px; }
      .ac-actions { display:flex; gap:8px; }
      .ac-results { display:grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap:12px; margin:18px 0 6px; }
      .ac-stat { background:rgba(42,94,155,.07); border-radius:12px; padding:12px 14px; }
      .ac-stat b { display:block; font-size:22px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
      .ac-stat span { font-size:11px; color:var(--ink-2); font-weight:600; }
      .ac-h3 { font-size:15px; font-weight:700; margin:20px 0 10px; }
      .ac-bars { display:flex; flex-direction:column; gap:9px; }
      .ac-bar-row { display:grid; grid-template-columns: 210px 1fr 170px; gap:12px; align-items:center; font-size:12.5px; }
      .ac-bar-lbl { font-weight:600; }
      .ac-bar-track { position:relative; height:14px; background:rgba(0,0,0,.06); border-radius:7px; overflow:hidden; }
      .ac-bar { height:100%; border-radius:7px; transition:width .6s var(--spring); }
      .ac-bar.behind { background:#E5473C; }
      .ac-bar.even { background:var(--blue); }
      .ac-bar.ahead { background:#30B155; }
      /* the benchmark line: where the top performers sit */
      /* where the top performers sit. A bar reaching this line means parity with them. */
      .ac-bench { position:absolute; left:70%; top:-3px; bottom:-3px; width:2px; background:rgba(0,0,0,.5); z-index:2; }
      .ac-bar-val { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
      .ac-bar-val em { font-style:normal; font-weight:500; color:var(--ink-3); }
      .ac-list { margin:0 0 0 18px; display:flex; flex-direction:column; gap:8px; font-size:13px; }
      .ac-coach { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }

      /* ---- own your outcome ---- */
      .oyo-goal { display:grid; grid-template-columns: 200px 1fr; gap:20px; align-items:start;
        background:rgba(42,94,155,.05); border-radius:14px; padding:16px; margin-bottom:6px; }
      .oyo-goalset label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.07em;
        color:var(--ink-3); font-weight:700; margin-bottom:6px; }
      .oyo-goalset input { width:100%; font-size:22px; font-weight:700; text-align:center; padding:8px; }
      .oyo-track { position:relative; height:22px; background:rgba(0,0,0,.07); border-radius:11px; overflow:hidden; }
      .oyo-fill { height:100%; border-radius:11px; transition:width .8s var(--spring); }
      .oyo-fill.good { background:linear-gradient(90deg,#30B155,#5FCB7E); }
      .oyo-fill.behind { background:linear-gradient(90deg,#E5473C,#F0796F); }
      /* where they SHOULD be by today: the gap between bar and mark is the whole story */
      .oyo-pacemark { position:absolute; top:-3px; bottom:-3px; width:3px; background:var(--ink); z-index:2; }
      .oyo-stats { display:flex; gap:18px; flex-wrap:wrap; margin-top:10px; font-size:12.5px; color:var(--ink-2); }
      .oyo-stats b { font-size:16px; color:var(--ink); font-weight:700; }
      .oyo-stats .good b { color:#1E7A3C; } .oyo-stats .behind b { color:#C13529; }
      .oyo-lede { margin-top:10px; font-size:14px; }
      .oyo-lede.good { color:#1E7A3C; font-weight:600; }
      .oyo-lede.behind { color:#C13529; font-weight:600; }

      .oyo-chan { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:12px; }
      .oyo-chan-tile { background:rgba(255,255,255,.6); border:1px solid var(--line); border-radius:14px; padding:13px 15px; }
      .oyo-chan-name { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--ink-3); font-weight:700; }
      .oyo-chan-rate { font-size:26px; font-weight:700; letter-spacing:-.02em; margin-top:4px; font-variant-numeric:tabular-nums; }
      .oyo-chan-sub { font-size:11.5px; color:var(--ink-3); }
      .oyo-chan-hist { font-size:11.5px; font-weight:700; margin-top:5px; }
      .oyo-chan-hist.good { color:#1E7A3C; } .oyo-chan-hist.behind { color:#C13529; }

      .oyo-table { width:100%; border-collapse:collapse; margin-bottom:6px; }
      .oyo-table th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em;
        color:var(--ink-3); font-weight:700; padding:8px 10px; }
      .oyo-table td { padding:9px 10px; border-top:1px solid rgba(0,0,0,.06); font-size:13px;
        font-variant-numeric:tabular-nums; }
      .oyo-table tr.oyo-behind { background:rgba(229,71,60,.05); }

      .oyo-base { margin-top:20px; padding-top:14px; border-top:1px solid var(--line); }
      .oyo-base-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; }
      .bl-editor { margin-top:12px; background:rgba(0,0,0,.02); border-radius:12px; padding:14px; }
      .baseline-card { border-left:4px solid var(--lime); }
      .bl-dates { display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap; margin:12px 0; }
      .bl-dates .bl-field input { padding:7px 9px; }
      .bl-preview { margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
      .bl-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap:10px; margin-bottom:6px; }
      .bl-field { display:flex; flex-direction:column; gap:3px; }
      .bl-field span { font-size:11px; color:var(--ink-2); font-weight:600; }
      @media (max-width: 760px) { .oyo-goal { grid-template-columns:1fr; } }

      /* ---- pending approvals ---- */
      .pending-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:12px 0;
        border-bottom:1px solid rgba(0,0,0,.06); }
      .pending-row:last-child { border-bottom:none; }
      .pending-who { display:flex; flex-direction:column; min-width:180px; }
      .pending-who .mono { font-size:12px; color:var(--ink-2); }
      .pending-row .row-actions { margin-left:auto; }

      /* ---- frosted top bar ---- */
      /* Sticky frosted header. What makes it read as smooth rather than "clicking":
         - translateZ(0) + will-change put it on its own GPU layer, so the blur is
           composited rather than re-rasterised coarsely on every scroll frame.
         - A SMALL blur radius. Cost scales with radius: a 28px blur samples a big
           region each frame and the browser drops to a cheaper, steppier redraw.
           16px stays cheap enough to resolve continuously.
         - A fairly opaque fill, so colour underneath reads as a soft tint instead of
           punching through and making every step obvious.
         - A gradient fade below the bar (::after) so elements ease out from under it
           instead of popping across a hard edge. */
      .topbar { position: sticky; top: 0; z-index: 30; display:flex; align-items:center; justify-content:space-between;
        padding:12px 24px; background: rgba(252,253,254,.78); backdrop-filter: saturate(170%) blur(16px);
        -webkit-backdrop-filter: saturate(170%) blur(16px); border-bottom: 1px solid rgba(255,255,255,.55);
        flex-wrap:wrap; gap:10px;
        transform: translateZ(0); will-change: backdrop-filter; backface-visibility: hidden; }
      .topbar::after { content:""; position:absolute; left:0; right:0; top:100%; height:16px; pointer-events:none;
        background: linear-gradient(180deg, rgba(244,246,249,.85), rgba(244,246,249,0)); }
      .brand { display:flex; gap:12px; align-items:center; }
      .brand-title { font-weight:700; font-size:17px; letter-spacing:-.02em; }
      .brand-sub { font-size:11px; color:var(--ink-2); letter-spacing:.02em; }
      .topbar-right { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .save-dot { font-size:12px; color:var(--ink-3); animation: pulse 1.2s ease infinite; }
      @keyframes pulse { 50% { opacity:.4; } }
      .whoami { font-size:13px; color:var(--ink-2); }
      .tool-switch { display:inline-flex; gap:2px; background:rgba(118,118,128,.12); border-radius:10px; padding:2px; }
      .tool-btn { border:none; background:none; padding:6px 12px; border-radius:8px; cursor:pointer;
        font-size:12.5px; font-weight:600; color:var(--ink-2); white-space:nowrap;
        transition: background .2s var(--spring), color .2s var(--spring); }
      .tool-btn:hover { color:var(--ink); }
      .tool-btn.on { background:#fff; color:var(--blue); box-shadow:0 1px 3px rgba(0,0,0,.10); }

      /* ---- segmented control (sliding) ---- */
      .seg-wrap { display:flex; padding:16px 24px 0; }
      .seg { position:relative; display:inline-flex; gap:2px; background:rgba(118,118,128,.14); border-radius:12px; padding:3px;
        backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
        border:1px solid rgba(255,255,255,.5); max-width:100%; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
      .seg::-webkit-scrollbar { display:none; }
      .seg-thumb { position:absolute; top:3px; bottom:3px; left:0; background:rgba(255,255,255,.92); border-radius:9px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,1), 0 1px 5px rgba(31,54,86,.18); opacity:0; pointer-events:none;
        transition: transform .4s var(--spring), width .4s var(--spring); will-change: transform, width; }
      .seg-thumb.ready { opacity:1; }
      .seg-btn { position:relative; z-index:1; border:none; background:transparent; padding:8px 16px; border-radius:9px;
        font-size:13px; font-weight:600; color:var(--ink-2); cursor:pointer; display:flex; gap:7px; align-items:center;
        white-space:nowrap; flex:0 0 auto;
        transition: color .3s var(--spring), transform .15s var(--spring); }
      .seg-btn:active { transform: scale(.96); }
      .seg-btn.active { color:var(--ink); }

      /* ---- page transition ---- */
      .page { animation: pageIn .38s var(--spring); }
      /* the hero + welcome card live directly in .page, which carries no padding of
         its own (the padding sits on .board). Without this they butt straight up
         against the tab bar and the window edge. */
      .board-page { padding:28px 32px 0; max-width:1440px; margin:0 auto; }
      .board-page > .board { padding:0; max-width:none; }
      .board-page > .welcome { margin-bottom:18px; }
      .seg-wrap { padding-bottom:4px; }
      @keyframes pageIn { from { opacity:0; transform: translateY(10px) scale(.995); } to { opacity:1; transform:none; } }

      /* ---- layout & cards ---- */
      /* Wider, and centred rather than pinned to the left. 1440px keeps line lengths
         readable while letting a big monitor actually breathe. */
      .board, .import, .standards, .roster, .admin, .gm, .history, .access, .audit, .settings {
        padding:24px 32px; max-width:1440px; margin:0 auto; }

      /* No backdrop-filter here. A fixed, blurred element is a permanently compositing
         layer, which is a lot to pay for a version badge, and it fed the scroll shift. */
      .version-stamp { position:fixed; right:14px; bottom:12px; z-index:20; pointer-events:none;
        font-size:10.5px; font-weight:600; letter-spacing:.06em; color:var(--ink-3);
        background:#F0F2F5; border:1px solid rgba(0,0,0,.06);
        padding:4px 9px; border-radius:20px;
        font-variant-numeric:tabular-nums; opacity:.7; }
      .loading, .empty { padding:64px 24px; color:var(--ink-2); }
      .card { background: rgba(255,255,255,.58); border:1px solid rgba(255,255,255,.7); border-radius:var(--radius);
        padding:18px 20px; backdrop-filter: blur(26px) saturate(170%); -webkit-backdrop-filter: blur(26px) saturate(170%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(31,54,86,.07);
        margin-bottom:16px; transition: box-shadow .3s var(--spring), transform .3s var(--spring); }
      .card:hover { transform: translateY(-1px);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 2px 4px rgba(0,0,0,.05), 0 14px 34px rgba(31,54,86,.11); }
      .section-title { font-size:24px; font-weight:700; letter-spacing:-.03em; margin:4px 0 18px; }
      .section-sub { font-size:14px; font-weight:500; color:var(--ink-2); margin-left:8px; letter-spacing:0; }

      /* ---- login ---- */
      .login { display:flex; justify-content:center; padding:80px 20px; }
      .login-card { background:rgba(255,255,255,.6); border:1px solid rgba(255,255,255,.75); border-radius:24px; padding:36px 32px; width:360px;
        text-align:center; backdrop-filter: blur(30px) saturate(170%); -webkit-backdrop-filter: blur(30px) saturate(170%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.9), var(--shadow-2); animation: loginIn .5s var(--spring); }
      @keyframes loginIn { from { opacity:0; transform: translateY(16px) scale(.97); } to { opacity:1; transform:none; } }
      .login-logo { display:flex; justify-content:center; margin-bottom:12px; }
      .login-card h2 { font-size:22px; font-weight:700; letter-spacing:-.02em; margin:0 0 2px; }
      .login-card label { display:block; text-align:left; font-size:12px; font-weight:600; margin:16px 0 6px; color:var(--ink-2); }
      .login-card select, .login-card input { width:100%; }
      .login-err { color:var(--red); font-size:12.5px; margin-top:10px; }
      .hint.center { text-align:center; }

      /* ---- board ---- */
      .role-section { border-left:none; position:relative; overflow:hidden; }
      .role-section::before { content:""; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--role); border-radius:4px 0 0 4px; }
      .role-header { display:flex; align-items:center; gap:8px; margin:0 0 12px; font-size:16px; font-weight:700; letter-spacing:-.01em; }
      .role-swatch { width:10px; height:10px; border-radius:50%; background:var(--role); }
      .role-count { font-size:12px; color:var(--ink-3); font-weight:600; background:#F2F2F4; border-radius:10px; padding:1px 8px; }
      .role-empty { padding:16px; border:1.5px dashed var(--line); border-radius:12px; color:var(--ink-3); text-align:center; }
      .assoc-card { border-bottom:1px solid rgba(0,0,0,.05); padding:10px 0 12px; transition: background .2s; border-radius:10px; }
      .assoc-card:last-child { border-bottom:none; }
      .assoc-row { display:flex; align-items:center; gap:10px; cursor:grab; flex-wrap:wrap; }
      .assoc-row:active { cursor:grabbing; }
      .grip { color:var(--ink-3); font-size:13px; }
      .assoc-name { font-weight:600; flex:0 0 200px; letter-spacing:-.01em; }
      .flag { font-size:11px; color:var(--amber); background:rgba(255,159,10,.14); padding:3px 9px; border-radius:20px; font-weight:600; }
      .assoc-leads { margin-left:auto; font-weight:700; font-size:17px; font-variant-numeric: tabular-nums; letter-spacing:-.02em; }
      .of-cap { color:var(--ink-3); font-size:13px; font-weight:600; }
      .verdict { font-size:12px; font-weight:700; padding:5px 12px; border-radius:20px; min-width:118px; text-align:center;
        transition: transform .2s var(--spring); }
      .verdict.sm { min-width:0; font-size:11px; padding:3px 9px; }
      .verdict-pass { background:rgba(48,177,85,.14); color:#1E7A3C; }
      .verdict-fail { background:rgba(229,71,60,.13); color:#C13529; }
      .verdict-dim { background:#F2F2F4; color:var(--ink-2); }
      .gauge { position:relative; height:8px; background:#E9E9EB; border-radius:5px; margin:9px 0 0 23px; max-width:520px; }
      .gauge-fill { height:100%; border-radius:5px; background:linear-gradient(90deg, #2A5E9B, #C1D730);
        transition: width .6s var(--spring); }
      .gauge-red { background:linear-gradient(90deg, #FF6B5E, #E5473C); }
      .gauge-notch { position:absolute; top:-3px; width:2.5px; height:14px; background:var(--ink); border-radius:2px; transform:translateX(-1px); }
      .reasons { margin:9px 0 0 23px; font-size:12.5px; color:#C13529; animation: pageIn .3s var(--spring); }
      .reason { display:inline-block; background:rgba(229,71,60,.10); border-radius:14px; padding:3px 10px; margin:2px 5px 0 0; font-weight:500; }
      .pass-note { color:#1E7A3C; }

      /* ---- grace period & recap ---- */
      .verdict-grace { background:rgba(136,198,234,.28); color:#1D4674; }
      .watch-note { color:#7A5A00; }
      .reason.watch { background:rgba(255,159,10,.12); color:#8A5A00; }
      .grace-banner { display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-left:4px solid #88C6EA;
        background:linear-gradient(90deg, rgba(136,198,234,.10), rgba(255,255,255,0) 60%); font-size:13px; color:var(--ink-2); }
      .recap { border-left:4px solid var(--lime); }
      .recap-row { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; padding:7px 0; border-bottom:1px solid rgba(0,0,0,.05); }
      .recap-row:last-child { border-bottom:none; }
      .recap-name { font-size:11px; }
      .recap-chips { display:flex; gap:5px; flex-wrap:wrap; }
      .gm-section.watch::before { background:#88C6EA; }
      .stat-grace { color:#1D4674; font-weight:600; }
      .grace-setting { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
      .grace-label { display:flex; gap:9px; align-items:center; font-weight:600; }
      .grace-setting input[type=number] { width:64px; }

      /* ---- search ---- */
      .search-wrap { position:relative; margin-bottom:14px; max-width:420px; }
      .search-icon { position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--ink-3); font-size:16px; }
      .search-input { width:100%; padding:11px 38px; border-radius:12px; background:rgba(255,255,255,.7);
        border:1px solid rgba(255,255,255,.8); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
      .search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); border:none; background:rgba(118,118,128,.2);
        color:var(--ink-2); width:22px; height:22px; border-radius:50%; cursor:pointer; font-size:11px; }
      .search-count { margin:-8px 0 12px 4px; }

      /* ---- leaderboard ---- */
      .leaderboard { border-left:4px solid var(--lime); }
      .lb-title { font-size:16px; font-weight:700; margin:0 0 12px; }
      .lb-row { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
      .lb-item { padding:14px; border-radius:14px; text-align:center; background:rgba(255,255,255,.5);
        border:1px solid rgba(255,255,255,.7); transition: transform .3s var(--spring); }
      .lb-item:hover { transform: translateY(-2px); }
      .lb-1 { background:linear-gradient(160deg, rgba(255,215,90,.28), rgba(255,255,255,.4)); }
      .lb-2 { background:linear-gradient(160deg, rgba(200,205,215,.32), rgba(255,255,255,.4)); }
      .lb-3 { background:linear-gradient(160deg, rgba(205,145,95,.26), rgba(255,255,255,.4)); }
      .lb-medal { font-size:26px; line-height:1; }
      .lb-name { font-weight:700; margin-top:6px; letter-spacing:-.01em; }
      .lb-meta { font-size:11.5px; font-weight:600; margin-top:2px; }
      .lb-surpass { font-size:12px; color:#1E7A3C; font-weight:600; margin-top:6px; }
      @media (max-width:560px){ .lb-row { grid-template-columns:1fr; } }

      /* ---- rank + star + incomplete + off leads ---- */
      .rank-badge { font-size:15px; }
      .star-badge { font-size:11px; font-weight:700; color:#1E7A3C; background:rgba(48,177,85,.14); padding:3px 9px; border-radius:20px;
        animation: starGlow 3.2s ease-in-out infinite; }
      @keyframes starGlow {
        0%,100% { box-shadow: 0 0 0 0 rgba(48,177,85,0); }
        50%     { box-shadow: 0 0 0 3px rgba(48,177,85,.10); }
      }
      .assoc-card.incomplete { opacity:.55; filter:grayscale(.75); }
      .assoc-card.incomplete .verdict { visibility:hidden; }
      .flag-gray { color:var(--ink-2); background:rgba(118,118,128,.16); }
      .gray-note { color:var(--ink-2); }
      .detail-cell.blank { opacity:.45; }
      .assoc-card.is-restricted { opacity:1; filter:none; }
      .verdict-off { background:rgba(118,118,128,.2); color:var(--ink); }
      .off-note { color:var(--ink-2); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .btn-confirm { margin-top:8px; background:rgba(229,71,60,.12); color:#C13529; border:1px solid rgba(229,71,60,.3);
        border-radius:10px; padding:7px 14px; font-weight:600; font-size:12.5px; cursor:pointer; transition: all .2s var(--spring); }
      .btn-confirm:hover { background:rgba(229,71,60,.18); }
      .restrict-form { display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-top:10px; }
      .restrict-form input[type=number] { width:64px; }

      /* ---- auth extras ---- */
      .btn-link { background:none; border:none; color:var(--blue); font-weight:600; font-size:13px; cursor:pointer; margin-top:12px; }
      .btn-outline { background:rgba(255,255,255,.5); color:var(--blue); border:1px solid var(--blue); border-radius:12px;
        padding:11px; font-weight:600; font-size:14px; cursor:pointer; transition: all .2s var(--spring); }
      .btn-outline:hover { background:rgba(42,94,155,.08); }
      .btn-outline.wide { width:100%; }
      .login-divider { display:flex; align-items:center; text-align:center; margin:14px 0 12px; color:var(--ink-3); font-size:12px; }
      .login-divider::before, .login-divider::after { content:""; flex:1; height:1px; background:rgba(0,0,0,.1); }
      .login-divider span { padding:0 12px; }

      /* ---- splash ---- */
      .splash { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:40px 20px;
        background:radial-gradient(70% 90% at 50% 0%, rgba(136,198,234,.25), transparent 60%); }
      .splash-inner { text-align:center; max-width:440px; width:100%; animation: loginIn .6s var(--spring); }
      .splash-logo { display:flex; justify-content:center; margin-bottom:18px; filter: drop-shadow(0 8px 24px rgba(42,94,155,.25)); }
      .splash-title { font-size:34px; font-weight:700; letter-spacing:-.03em; margin-bottom:4px; }
      .splash-sub { color:var(--ink-2); font-size:14px; margin-bottom:28px; }
      .splash-actions { display:flex; flex-direction:column; gap:12px; max-width:320px; margin:0 auto; align-items:center; }
      .splash-btn-primary { padding:18px; font-size:17px; font-weight:700; width:100%; border-radius:15px;
        box-shadow: 0 6px 20px rgba(42,94,155,.32); }
      .splash-btn-secondary { padding:11px; font-size:13.5px; width:78%; border-radius:12px; }
      .splash-btn-activity { background:#00A896; }
      .splash-btn-activity:hover { box-shadow:0 3px 10px rgba(0,168,150,.35); }

      /* ---- check out tracker ---- */
      .checkout-summary { display:flex; gap:16px; margin-bottom:14px; font-size:13px; font-weight:600; }
      .checkout-table { width:100%; border-collapse:collapse; }
      .checkout-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-3); padding:8px; font-weight:600; }
      .checkout-table th:not(:first-child) { text-align:center; }
      .checkout-table td { padding:8px; border-top:1px solid rgba(0,0,0,.05); text-align:center; }
      .checkout-table td:first-child { text-align:left; }
      .cell-g { color:#1E7A3C; font-weight:700; } .cell-r { color:#C13529; font-weight:700; }
      .cell-need { color:var(--ink-3); font-weight:500; font-size:11px; }
      .co-nodata { opacity:.5; }
      .co-badge { font-size:11px; font-weight:700; padding:4px 10px; border-radius:20px; }
      .co-badge.yes { background:rgba(48,177,85,.14); color:#1E7A3C; }
      .co-badge.no { background:rgba(229,71,60,.13); color:#C13529; }
      .co-badge.dim { background:#F2F2F4; color:var(--ink-2); }
      /* activity sheet left, the people who need a conversation right */
      .checkout-split { display:grid; grid-template-columns: minmax(0, 1.9fr) minmax(280px, 1fr); gap:16px; align-items:start; }
      .checkout-side { position:sticky; top:80px; }
      .offender-card { border-left:4px solid var(--red); }
      .repeat-card { border-left:4px solid var(--amber); margin-bottom:12px; }
      .repeat-row { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; padding:6px 0;
        border-bottom:1px solid rgba(0,0,0,.05); font-size:13px; }
      .repeat-row:last-child { border-bottom:none; }
      .repeat-count { color:var(--red); font-weight:700; font-size:12px; }
      .repeat-tag { font-size:10.5px; color:var(--ink-3); background:#F2F2F4; padding:2px 7px; border-radius:10px; }
      .star-inp { width:54px; text-align:center; padding:4px 6px; font-size:13px; }
      .flag-btn { border:none; background:#F2F2F4; color:var(--ink-3); font-size:11.5px; font-weight:700;
        padding:4px 9px; border-radius:10px; cursor:pointer; transition: all .2s var(--spring); white-space:nowrap; }
      .flag-btn:hover { background:#E6E6EA; }
      .flag-btn.auto { background:rgba(255,159,10,.16); color:#95600A; }
      .flag-btn.on { background:rgba(229,71,60,.14); color:#C13529; }
      .offender-card.offender-clear { border-left-color:#30B155; }
      .off-title { font-size:15px; font-weight:700; margin-bottom:6px; display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
      @media (max-width: 1000px) {
        .checkout-split { grid-template-columns: 1fr; }
        .checkout-side { position:static; }
      }
      .offender-row { display:flex; gap:12px; align-items:baseline; padding:7px 0; border-bottom:1px solid rgba(0,0,0,.05); }
      .offender-row:last-child { border-bottom:none; }
      .offender-detail { display:flex; gap:6px; flex-wrap:wrap; }

      /* ---- plate tracker ---- */
      .plate-out td { }
      .plate-check { border:none; border-radius:8px; padding:5px 12px; font-weight:600; font-size:12px; cursor:pointer; }
      .plate-check.out { background:rgba(255,159,10,.16); color:var(--amber); }
      .plate-check.in { background:rgba(48,177,85,.14); color:#1E7A3C; }

      /* ---- activity standards stepper ---- */
      .stepper-row { display:flex; gap:20px; margin:16px 0; flex-wrap:wrap; }
      .stepper-block { text-align:center; }
      .stepper-label { font-weight:700; font-size:14px; margin-bottom:8px; }
      .stepper { display:flex; align-items:center; gap:0; border:1px solid var(--line); border-radius:14px; overflow:hidden; background:#fff; }
      .stepper-btn { border:none; background:rgba(255,255,255,.6); width:46px; height:46px; font-size:22px; font-weight:600; color:var(--blue); cursor:pointer; transition: background .15s; }
      .stepper-btn:hover:not(:disabled) { background:rgba(42,94,155,.1); }
      .stepper-btn:disabled { opacity:.3; cursor:default; }
      .stepper-value { min-width:60px; font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; }
      .stepper-hint { font-size:11px; color:var(--ink-3); margin-top:5px; }
      .preset-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:14px 0; }
      .preview-line { font-size:13px; color:var(--ink-2); margin-top:8px; padding-top:12px; border-top:1px solid var(--line); }
      .splash-foot { margin-top:28px; font-size:12px; color:var(--ink-3); letter-spacing:.06em; text-transform:uppercase; }

      /* ---- thresholds + check groups ---- */
      .thr-label { display:flex; gap:8px; align-items:center; font-weight:600; }
      .thr-grid { display:flex; flex-direction:column; gap:8px; }
      .thr-grid-head, .thr-grid-row { display:grid; grid-template-columns: 1.1fr 1fr 1fr; gap:12px; align-items:center; }
      .thr-grid-head span { font-size:11px; font-weight:700; color:var(--ink-3); text-transform:uppercase;
        letter-spacing:.06em; display:flex; align-items:center; gap:6px; }
      .thr-ch { font-weight:700; font-size:13.5px; }
      .thr-inp { display:flex; align-items:center; gap:5px; font-size:13px; color:var(--ink-2); }
      .thr-inp input { width:70px; }
      .thr-label input[type=number] { width:64px; }
      .thr-dot { width:11px; height:11px; border-radius:50%; }
      .thr-dot.g { background:var(--green); } .thr-dot.y { background:#E0A100; }
      .check-group-label { font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--ink-3); font-weight:700; margin:10px 0 4px; }
      .check-group-label:first-of-type { margin-top:0; }
      .check-note { font-size:11px; color:var(--ink-3); margin-left:8px; font-style:italic; }
      .setup-note { font-size:13px; color:var(--ink-2); margin:8px 0 6px; }
      .login-ok { color:#1E7A3C; font-size:12.5px; margin-top:10px; background:rgba(48,177,85,.12); padding:8px 10px; border-radius:8px; }
      .pending-card { border-left:4px solid var(--amber); }
      .pending-row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding:9px 0; border-bottom:1px solid rgba(0,0,0,.05); }
      .pending-row:last-child { border-bottom:none; }
      .pending-email { color:var(--ink-2); font-size:12px; margin-left:10px; }
      .pending-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .chip-list { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
      .domain-chip { display:inline-flex; align-items:center; gap:6px; background:rgba(42,94,155,.1); color:var(--blue);
        font-weight:600; font-size:12.5px; padding:4px 10px; border-radius:16px; }
      .domain-chip button { border:none; background:none; color:var(--blue); cursor:pointer; font-size:11px; padding:0; }
      .toggle-row { display:flex; gap:9px; align-items:center; margin-top:12px; font-weight:600; }
      .toggle-row input[type=checkbox] { accent-color:var(--blue); width:16px; height:16px; }

      /* ---- centralized BDC oversight ---- */
      .role-tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; background:rgba(0,168,150,.16);
        color:#00776a; padding:2px 7px; border-radius:10px; margin-left:8px; }
      .combined-summary { display:flex; gap:16px; margin-bottom:14px; font-size:13px; font-weight:600; }
      .combined-store { padding:14px 18px; }
      .combined-store-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
      .combined-store-name { display:flex; align-items:center; gap:10px; font-weight:700; font-size:16px; letter-spacing:-.01em; }
      .combined-row { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid rgba(0,0,0,.05); }
      .combined-row:last-child { border-bottom:none; }
      .combined-role-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; }
      .combined-role-label { font-size:11.5px; color:var(--ink-2); }
      .combined-row .assoc-name { flex:0 0 auto; }
      .combined-row .verdict { min-width:0; padding:3px 10px; }

      /* ---- store reorder + logo cropper ---- */
      .btn-arrow { background:rgba(255,255,255,.7); border:1px solid rgba(255,255,255,.8); border-radius:8px; width:28px; height:28px;
        cursor:pointer; color:var(--ink-2); font-size:13px; margin-right:4px; transition: all .2s var(--spring); }
      .btn-arrow:hover:not(:disabled) { color:var(--blue); transform: translateY(-1px); }
      .btn-arrow:disabled { opacity:.3; cursor:default; }
      .crop-overlay { position:fixed; inset:0; z-index:60; background:rgba(29,29,31,.35);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        display:flex; align-items:center; justify-content:center; animation: fadeIn .25s var(--spring); }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      .crop-card { width:340px; text-align:center; animation: loginIn .35s var(--spring); }
      .crop-stage { display:flex; justify-content:center; margin:14px 0 10px; }
      .crop-canvas { width:280px; height:280px; border-radius:18px; background:
        repeating-conic-gradient(#ECECEE 0% 25%, #F8F8FA 0% 50%) 50% / 20px 20px;
        cursor:grab; touch-action:none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
      .crop-canvas:active { cursor:grabbing; }
      .crop-zoom { width:88%; accent-color:var(--blue); margin:4px 0 12px; }
      .crop-actions { display:flex; gap:10px; justify-content:center; }
      .detail { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 0 23px; animation: pageIn .3s var(--spring); }
      .detail-cell { background:rgba(255,255,255,.55); border:1px solid rgba(255,255,255,.6); border-radius:12px; padding:6px 12px; font-size:12px; display:flex; gap:8px; }
      .detail-cell span { color:var(--ink-2); }

      /* ---- badges ---- */
      .badge { font-size:11px; padding:3px 9px; border-radius:20px; font-weight:700; }
      .badge-ok { background:rgba(48,177,85,.14); color:#1E7A3C; }
      .badge-warn { background:rgba(255,159,10,.16); color:var(--amber); }
      .badge-off { background:#F2F2F4; color:var(--ink-2); }

      /* ---- import ---- */
      .checklist { max-width:440px; }
      .checklist-title { font-size:16px; font-weight:700; letter-spacing:-.01em; margin-bottom:12px; }
      .check { display:flex; gap:11px; align-items:center; padding:6px 0; color:var(--ink-2); transition: color .3s; }
      .check.done { color:#1E7A3C; font-weight:600; }
      .check-box { width:22px; height:22px; border:1.5px solid var(--ink-3); border-radius:50%; display:flex; align-items:center;
        justify-content:center; font-size:12px; transition: all .3s var(--spring); }
      .check.done .check-box { background:var(--green); border-color:var(--green); color:#fff; transform: scale(1.05); }
      .dropzone { border:1.5px dashed rgba(42,94,155,.35); border-radius:var(--radius); padding:48px 20px; text-align:center; cursor:pointer;
        background:rgba(255,255,255,.45); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
        transition: all .25s var(--spring); max-width:640px; }
      .dropzone:hover { border-color: var(--blue); transform: translateY(-1px); box-shadow: var(--shadow-1); }
      .dropzone.active { border-color:var(--blue); background:rgba(10,132,255,.05); transform: scale(1.01); box-shadow: var(--shadow-2); }
      .dz-icon { font-size:28px; color:var(--blue); animation: dzBob 2.6s ease-in-out infinite; }
      @keyframes dzBob { 0%,100% { transform: translateY(0); opacity:.85; } 50% { transform: translateY(4px); opacity:1; } }
      .dropzone.active .dz-icon { animation-duration: 1s; }
      .dz-title { font-size:17px; font-weight:700; letter-spacing:-.01em; margin-top:8px; }
      .dz-sub { color:var(--ink-2); font-size:12.5px; margin-top:5px; }
      .import-log { margin-top:14px; max-width:640px; }
      .log-ok { color:#1E7A3C; padding:3px 0; animation: pageIn .3s var(--spring); }
      .log-err { color:var(--red); padding:3px 0; animation: pageIn .3s var(--spring); }

      /* ---- forms & buttons ---- */
      .inline-form { display:flex; gap:9px; margin:10px 0; flex-wrap:wrap; align-items:center; }
      input, select { border:1px solid rgba(255,255,255,.8); border-radius:11px; padding:9px 12px; font-size:13px; font-family:inherit;
        background:rgba(255,255,255,.75); color:var(--ink); transition: border-color .2s, box-shadow .2s, background .2s; outline:none; }
      input:hover, select:hover { background:rgba(255,255,255,.92); }
      input:focus, select:focus { border-color:var(--blue); background:#fff; box-shadow: 0 0 0 3.5px rgba(42,94,155,.18); }
      input[type=number] { width:84px; }
      .btn { background:var(--blue); color:#fff; border:none; border-radius:11px; padding:9px 18px; font-weight:600; font-size:13px;
        cursor:pointer; transition: transform .15s var(--spring), filter .2s, box-shadow .2s; }
      .btn:hover { filter:brightness(1.06); box-shadow:0 3px 10px rgba(42,94,155,.35); }
      .btn:active { transform: scale(.96); }
      .btn.wide { width:100%; margin-top:18px; padding:12px; border-radius:12px; font-size:14px; }
      .btn.secondary { background:rgba(118,118,128,.14); color:var(--ink); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border:1px solid rgba(255,255,255,.5); }
      .btn.secondary:hover { box-shadow:0 3px 10px rgba(0,0,0,.10); }
      .btn-quiet { background:transparent; border:none; color:var(--blue); font-weight:600; font-size:13px; cursor:pointer;
        padding:7px 10px; border-radius:9px; transition: background .2s; }
      .btn-quiet:hover { background:rgba(10,132,255,.08); }
      .btn-ghost { background:transparent; border:1px solid var(--line); border-radius:11px; padding:7px 14px; color:var(--ink-2);
        cursor:pointer; margin-top:6px; display:inline-block; font-weight:600; font-size:12.5px; transition: all .2s; }
      .btn-ghost:hover { border-color:var(--ink-3); color:var(--ink); }
      .file-btn { cursor:pointer; margin:0; }
      .btn-x { background:transparent; border:none; color:var(--red); cursor:pointer; font-size:12px; font-weight:600;
        padding:4px 8px; border-radius:8px; transition: background .2s; }
      .btn-x:hover { background:rgba(229,71,60,.08); }
      .hint { font-size:12px; color:var(--ink-2); line-height:1.45; }

      /* ---- standards ---- */
      .std-head { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
      .std-head h3 { margin:0; font-size:16px; font-weight:700; letter-spacing:-.01em; }
      .tier-head { display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
      .tier-label { font-weight:700; font-size:13px; background:var(--ink); color:#fff; padding:5px 13px; border-radius:20px; }
      .tier-head label { display:flex; gap:8px; align-items:center; font-weight:600; }
      .req-row { display:flex; gap:9px; align-items:center; padding:5px 0; flex-wrap:wrap; }

      /* ---- tables ---- */
      .roster-table { width:100%; max-width:760px; border-collapse:collapse; }
      .roster-table.wide { max-width:1060px; }
      .roster-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-3);
        padding:7px 10px; font-weight:600; }
      .roster-table td { padding:8px 10px; border-top:1px solid rgba(0,0,0,.05); vertical-align:top; }
      .row-inactive { opacity:.45; }
      .row-actions { white-space:nowrap; }
      .mono { font-size:12px; color:var(--ink-2); white-space:nowrap; font-variant-numeric: tabular-nums; }

      /* ---- GM summary ---- */
      .gm-toolbar { display:flex; gap:10px; align-items:center; margin-bottom:18px; flex-wrap:wrap; }
      .gm-head h2 { font-size:24px; font-weight:700; letter-spacing:-.03em; margin:0 0 4px; }
      .gm-sub { color:var(--ink-2); font-size:13px; margin:0 0 20px; }
      .gm-card { padding-top:14px; }
      .gm-section { font-size:16px; font-weight:700; letter-spacing:-.01em; margin:4px 0 10px; display:flex; align-items:center; gap:9px; }
      .gm-section::before { content:""; width:10px; height:10px; border-radius:50%; }
      .gm-section.fail::before { background:var(--red); } .gm-section.pass::before { background:var(--green); }
      .gm-table { width:100%; border-collapse:collapse; }
      .gm-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-3);
        padding:8px; border-bottom:1px solid var(--line); font-weight:600; }
      .gm-table td { padding:9px 8px; border-bottom:1px solid rgba(0,0,0,.05); }
      .gm-table tr:last-child td { border-bottom:none; }

      /* ---- admin ---- */
      .store-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:16px; margin-bottom:28px; }
      .store-card { text-align:left; background:rgba(255,255,255,.58); border:1px solid rgba(255,255,255,.7); border-radius:var(--radius);
        padding:18px; cursor:pointer; backdrop-filter: blur(26px) saturate(170%); -webkit-backdrop-filter: blur(26px) saturate(170%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85), var(--shadow-1); transition: box-shadow .3s var(--spring), transform .3s var(--spring); }
      .store-card:hover { box-shadow:var(--shadow-2); transform: translateY(-3px); }
      .store-card:active { transform: translateY(-1px) scale(.99); }
      .store-card-top { display:flex; gap:11px; align-items:center; margin-bottom:10px; }
      .store-logo { width:38px; height:38px; flex:0 0 38px; object-fit:contain; border-radius:10px; background:#fff;
        border:1px solid var(--line); display:block; }
      .store-logo.placeholder { display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--ink-3);
        background:#F5F5F7; font-size:16px; }
      .store-card-name { font-weight:700; font-size:17px; letter-spacing:-.02em; }
      .store-card-row { margin-bottom:9px; }
      .store-card-stats { display:flex; gap:12px; font-size:12.5px; flex-wrap:wrap; }
      .stat-pass { color:#1E7A3C; font-weight:600; } .stat-fail { color:var(--red); font-weight:600; } .stat-dim { color:var(--ink-3); }
      .store-card-open { margin-top:12px; font-size:13px; color:var(--blue); font-weight:600; }
      .role-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
      .role-chip { color:#fff; font-size:12px; font-weight:600; padding:5px 12px; border-radius:20px; }
      .store-checks { display:flex; gap:12px; flex-wrap:wrap; margin:10px 0; }
      .store-checks.tight { gap:8px; }
      .check-inline { display:flex; gap:6px; align-items:center; font-size:12.5px; }
      .check-inline input[type=checkbox] { accent-color: var(--blue); width:15px; height:15px; }
      .card h3 { margin:0 0 10px; font-size:16px; font-weight:700; letter-spacing:-.01em; }

      @media (max-width: 700px) { .assoc-name { flex:1 1 auto; } }

      /* ---- respect the OS "reduce motion" setting: everything holds still ---- */
      @media (prefers-reduced-motion: reduce) {
        .lpc *, .lpc *::before, .lpc *::after {
          animation-duration: .001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .001ms !important;
          scroll-behavior: auto !important;
        }
        .lpc::before, .lpc::after { animation: none !important; transform: none !important; }
        /* leave the logo in its finished state rather than mid-sweep */
        .logo-anim { animation: none !important; transform: none !important; }
        .logo-anim .logo-arc { stroke-dashoffset: 0 !important; animation: none !important; }
        .logo-anim .logo-needle { transform: rotate(0deg) !important; animation: none !important; }
        .dz-icon, .star-badge { animation: none !important; }
        /* hero holds its finished state instead of animating in */
        .hero-band, .hero-band::after, .tile, .hero-strip { animation: none !important; transform: none !important; }
        .hero-ring-fill { animation: none !important; stroke-dashoffset: 0 !important; }
        .chip-warn .chip-dot, .leader-crown { animation: none !important; }
        .loadscreen-bar-fill, .wiz, .wiz-overlay, .bl-tile, .loadscreen-inner { animation: none !important; }
        .loadscreen-bar-fill { width:100%; }
      }

      @media print {
        .no-print, .topbar, .seg-wrap { display:none !important; }
        .lpc { background:#fff; padding:0; }
        .print-area { padding:0; max-width:none; }
        .card { box-shadow:none; border:none; padding:0; margin-bottom:20px; }
        .gm-table td, .gm-table th { font-size:11px; }
        .lpc::before, .lpc::after { display:none !important; }
        .version-stamp { display:none; }
        .logo-anim, .dz-icon, .star-badge { animation:none !important; }
        .logo-anim .logo-arc { stroke-dashoffset: 0 !important; }
        .logo-anim .logo-needle { transform: rotate(0deg) !important; }
      }
    `}</style>
  );
}

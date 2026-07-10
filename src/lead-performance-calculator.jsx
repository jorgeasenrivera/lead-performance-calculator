import React, { useState, useEffect, useRef, useCallback } from "react";
import Papa from "papaparse";

/* ============================================================
   LEAD PERFORMANCE CALCULATOR v3 — Holler-Classic Family of Dealerships
   "Earn the next lead."
   v3: Apple-inspired redesign — frosted chrome, segmented controls,
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

// leaderboard needs three channel delivery reports
const LEADERBOARD_REPORTS = {
  "delivery-internet": { label: "Internet Delivery" },
  "delivery-phone": { label: "Phone Delivery" },
  "delivery-showroom": { label: "Showroom Delivery" },
};

const uid = () => Math.random().toString(36).slice(2, 10);
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const ym = () => new Date().toISOString().slice(0, 7);
const prevYm = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const dayOfMonth = () => new Date().getDate();
const today = () => new Date().toISOString().slice(0, 10);
const fmtPct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
const fmtNum = (v) => (v == null ? "—" : Math.round(v * 10) / 10);
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

// Leaderboard delivered-% thresholds. >= green is green; >= yellow is yellow; below is red.
const DEFAULT_THRESHOLDS = { green: 20, yellow: 10 };

const DEFAULT_CONFIG = {
  stores: [
    { id: "holler-honda", name: "Holler Honda", icon: null },
    { id: "classic-honda", name: "Classic Honda", icon: null },
    { id: "holler-hyundai", name: "Holler Hyundai", icon: null },
  ],
  roles: [
    { id: "sales", name: "Sales Associate", color: "#2A5E9B" },
    { id: "bdc", name: "BDC Agent", color: "#00A896" },
  ],
  standards: {},
  approvedDomains: [],
  registrationOpen: true,
  users: [
    { id: "admin-1", name: "Jorge (Group Admin)", email: "", pin: null, role: "admin", stores: [], active: true },
  ],
};

/* ---------------- Logo + favicon ---------------- */

function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lpcg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2A5E9B" />
          <stop offset="100%" stopColor="#1D4674" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#lpcg)" />
      {/* full ring track (light blue) */}
      <circle cx="32" cy="32" r="17" fill="none" stroke="rgba(136,198,234,.5)" strokeWidth="5" />
      {/* lime progress: starts at ring's left edge, sweeps left→right over the top, stops at the needle tip on the ring */}
      <path d="M 15 32 A 17 17 0 0 1 45.06 21.12" fill="none" stroke="#C1D730" strokeWidth="5" strokeLinecap="round" />
      {/* speedometer needle reaching the same point on the ring */}
      <line x1="32" y1="32" x2="45.06" y2="21.12" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill="#FFFFFF" />
    </svg>
  );
}

const LOGO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#2A5E9B'/><stop offset='100%' stop-color='#1D4674'/></linearGradient></defs><rect x='2' y='2' width='60' height='60' rx='15' fill='url(#g)'/><circle cx='32' cy='32' r='17' fill='none' stroke='rgba(136,198,234,.5)' stroke-width='5'/><path d='M 15 32 A 17 17 0 0 1 45.06 21.12' fill='none' stroke='#C1D730' stroke-width='5' stroke-linecap='round'/><line x1='32' y1='32' x2='45.06' y2='21.12' stroke='#FFF' stroke-width='4.5' stroke-linecap='round'/><circle cx='32' cy='32' r='4.5' fill='#FFF'/></svg>`;

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
  if (h2.includes("units delivered")) {
    // three same-format delivery reports; tell them apart by filename keyword
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

/* ---------------- Storage + audit ---------------- */

async function loadShared(key, fallback) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function saveShared(key, value) {
  try { await window.storage.set(key, JSON.stringify(value), true); return true; }
  catch (e) { console.error("save failed", key, e); return false; }
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
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState("admin");
  const [storeData, setStoreData] = useState(null);
  const [adminData, setAdminData] = useState({});
  const [tab, setTab] = useState("board");
  const [adminTab, setAdminTab] = useState("overview");
  const [dragName, setDragName] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [importLog, setImportLog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      let cfg = await loadShared(CONFIG_KEY, null);
      if (cfg) {
        // brand-color migration for configs saved before the Holler-Classic palette
        let dirty = false;
        for (const r of cfg.roles || []) {
          if (r.color === "#0A84FF") { r.color = "#2A5E9B"; dirty = true; }
        }
        // auth migration: add new fields, force admin to set a real PIN if still on the old default
        if (cfg.approvedDomains === undefined) { cfg.approvedDomains = []; dirty = true; }
        if (cfg.registrationOpen === undefined) { cfg.registrationOpen = true; dirty = true; }
        for (const u of cfg.users || []) {
          if (u.email === undefined) { u.email = ""; dirty = true; }
          if (u.role === "admin" && u.pin === "1234") { u.pin = null; dirty = true; }
        }
        if (dirty) await saveShared(CONFIG_KEY, cfg);
      }
      if (!cfg) {
        const v1 = await loadShared("lpc:config:v1", null);
        cfg = v1 ? { ...DEFAULT_CONFIG, ...v1, users: DEFAULT_CONFIG.users } : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        if (!v1) {
          cfg.standards = {};
          for (const s of cfg.stores) {
            cfg.standards[s.id] = {};
            for (const r of cfg.roles) cfg.standards[s.id][r.id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
          }
        }
        await saveShared(CONFIG_KEY, cfg);
      }
      setConfig(cfg);
    })().catch(() => setLoadErr(true));
  }, []);

  useEffect(() => {
    if (!config || !session) return;
    (async () => {
      const accessible = session.role === "admin" ? config.stores : config.stores.filter((s) => session.stores.includes(s.id));
      const all = {};
      for (const s of accessible) {
        let d = await loadShared(storeKey(s.id), null);
        if (!d) d = await loadShared(`lpc:store:${s.id}:v1`, emptyStoreData());
        all[s.id] = d;
      }
      setAdminData(all);
      if (session.role === "admin") {
        setView("admin");
      } else if (session.role === "overseer" && accessible.length > 1) {
        setView("combined");
      } else {
        const first = accessible[0]?.id;
        if (first) { setView(first); setStoreData(all[first]); }
      }
    })();
  }, [config, session]);

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

  const handleFiles = useCallback(async (fileList) => {
    if (!storeData || view === "admin") return;
    const month = ym(); const day = today();
    let next = JSON.parse(JSON.stringify(storeData));
    if (!next.months[month]) next.months[month] = { stats: {}, imports: {}, names: {} };
    const M = next.months[month];
    if (!M.imports[day]) M.imports[day] = {};
    const log = []; const importedFiles = [];

    for (const file of Array.from(fileList)) {
      const text = await file.text();
      const rows = Papa.parse(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;
      const type = detectReportType(rows, file.name);
      if (!type) { log.push({ ok: false, msg: `${file.name} isn't a Delivery, Appointment, or Video report, so it was skipped.` }); continue; }
      const parsed = parseReport(rows, type);
      M.names[type] = Object.keys(parsed);
      const label = REPORTS[type]?.label || LEADERBOARD_REPORTS[type]?.label || type;
      let count = 0;
      for (const [key, rec] of Object.entries(parsed)) {
        const prevStat = M.stats[key] || {};
        // capture prior channel delivered % so the leaderboard can show a trend
        const trend = { ...(prevStat.prevPct || {}) };
        for (const ch of ["internet", "phone", "showroom"]) {
          if (rec[ch + "Pct"] != null && prevStat[ch + "Pct"] != null) trend[ch] = prevStat[ch + "Pct"];
        }
        M.stats[key] = { ...prevStat, ...rec, prevPct: trend, [`${type}Updated`]: day };
        count++;
      }
      M.imports[day][type] = true;
      importedFiles.push(`${label} (${count})`);
      log.push({ ok: true, msg: `${file.name} → ${label} · ${count} associates updated.` });
      const rosterKeys = new Set(next.roster.map((a) => norm(a.name)));
      for (const [key, rec] of Object.entries(parsed)) {
        if (!rosterKeys.has(key)) {
          next.roster.push({ id: uid(), name: rec.displayName, roleId: null, order: next.roster.length });
          rosterKeys.add(key);
        }
      }
    }
    setImportLog(log);
    if (importedFiles.length) {
      M.standardsSnapshot = JSON.parse(JSON.stringify(config.standards?.[view] || {}));
    }
    await persistStore(view, next, importedFiles.length ? { action: "Imported reports", detail: importedFiles.join(", ") } : null);
  }, [storeData, view, session, config]);

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
  if (!config) return <Shell><div className="loading">Loading…</div><Style /></Shell>;
  if (!entered && !session) return <Shell><Splash config={config} onEnter={() => setEntered(true)} onLaunchBoard={(storeId) => openLeaderboard(config, storeId)} /><Style /></Shell>;
  if (!session) return <Shell><Login config={config} onBack={() => setEntered(false)}
    onLogin={(u) => { setSession(u); appendAudit({ user: u.name, action: "Signed in" }); }}
    onRegister={async (u) => {
      const fresh = await loadShared(CONFIG_KEY, null);
      const base = fresh ? JSON.parse(JSON.stringify(fresh)) : JSON.parse(JSON.stringify(config));
      if (base.users.some((x) => (x.email || "").toLowerCase() === u.email)) {
        alert("An account with that email already exists. Please sign in instead.");
        return { ok: false };
      }
      base.users.push(u);
      const saved = await saveShared(CONFIG_KEY, base);
      if (!saved) {
        alert("Couldn't save your registration. The tool may not be published yet, storage only works on the published link.");
        return { ok: false };
      }
      setConfig(base);
      await appendAudit({ user: u.name, action: "Requested account", detail: `${u.email}, wants ${config.stores.find((s) => s.id === u.requestedStore)?.name || "a store"}` });
      return { ok: true };
    }}
    onSetupAdmin={async ({ email, pin }) => {
      const fresh = await loadShared(CONFIG_KEY, null);
      const freshAdmin = fresh?.users?.find((x) => x.role === "admin");
      if (freshAdmin && freshAdmin.pin) {
        alert("An admin account has already been set up for this tool. Please sign in with your email and PIN instead, or ask your group admin to create your account.");
        return { ok: false };
      }
      const next = fresh ? JSON.parse(JSON.stringify(fresh)) : JSON.parse(JSON.stringify(config));
      const a = next.users.find((x) => x.role === "admin");
      a.email = email; a.pin = pin;
      const saved = await saveShared(CONFIG_KEY, next);
      if (!saved) {
        alert("Couldn't save your account. This usually means the tool isn't published yet, storage only works on the published link. Publish first, then open the published URL and set up your account there.");
        return { ok: false };
      }
      setConfig(next);
      await appendAudit({ user: a.name, action: "Set up admin account" });
      return { ok: true, admin: a };
    }}
  /><Style /></Shell>;

  const isAdmin = session.role === "admin";
  const isOverseer = session.role === "overseer";
  const hasOverview = isAdmin || (isOverseer && session.stores.length > 1);
  const accessibleStores = isAdmin ? config.stores : config.stores.filter((s) => session.stores.includes(s.id));
  const currentStore = view !== "admin" ? config.stores.find((s) => s.id === view) : null;
  const overviewStores = isAdmin ? config.stores : accessibleStores;

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
          <select className="view-select" value={view} onChange={(e) => setView(e.target.value)}>
            {isAdmin && <option value="admin">All Stores</option>}
            {isOverseer && session.stores.length > 1 && <option value="combined">Combined (my stores)</option>}
            {accessibleStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="whoami">{session.name}{isOverseer && <span className="role-tag">BDC Oversight</span>}</span>
          {view !== "admin" && view !== "combined" && <button className="btn-quiet" onClick={() => openLeaderboard(config, view)}>Leaderboard ↗</button>}
          <button className="btn-quiet" onClick={() => { setSession(null); setEntered(false); }}>Sign out</button>
        </div>
      </header>

      {view === "admin" && isAdmin ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["overview", "Overview"], ["gm", "Summary"], ["access", "Access"], ["audit", "Audit Log"], ["settings", "Stores"]]}
              value={adminTab} onChange={setAdminTab} />
          </nav>
          <div key={adminTab} className="page">
            {adminTab === "overview" && <AdminOverview config={config} adminData={adminData} onOpenStore={setView} />}
            {adminTab === "gm" && <GMSummary config={config} data={adminData} stores={config.stores} />}
            {adminTab === "access" && <AccessPanel config={config} session={session} onChange={persistConfig} />}
            {adminTab === "audit" && <AuditLog />}
            {adminTab === "settings" && <SettingsPanel config={config} onChange={persistConfig} />}
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
        <div className="loading">Loading {currentStore?.name}…</div>
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
            <SegControl
              items={[["board", "Lead Board"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["standards", "Standards"], ["roster", "Roster"]]}
              value={tab} onChange={setTab}
              renderExtra={(id) => (id === "import" ? <ImportBadge storeData={storeData} /> : null)} />
          </nav>
          <div key={view + tab} className="page">
            {tab === "board" && <Board config={config} store={currentStore} data={storeData} dragName={dragName} setDragName={setDragName} onMove={moveAssociate} onSetRestriction={setRestriction} />}
            {tab === "import" && <ImportPanel data={storeData} log={importLog} dropActive={dropActive} setDropActive={setDropActive} onFiles={handleFiles} fileRef={fileRef} />}
            {tab === "gm" && <GMSummary config={config} data={{ [view]: storeData }} stores={[currentStore]} />}
            {tab === "history" && <HistoryPanel config={config} store={currentStore} data={storeData} />}
            {tab === "standards" && <StandardsEditor config={config} storeId={view} onChange={persistConfig} />}
            {tab === "roster" && <RosterEditor config={config} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} />}
          </div>
        </>
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
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700;800&family=Inter:wght@500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  :root { --blue:#2A5E9B; --dblue:#1D4674; --lime:#C1D730; --lblue:#88C6EA;
    --green:#2E9E4F; --greenbg:#E4F4E7; --yellow:#E0A100; --yellowbg:#FCF2D3; --red:#D5433A; --redbg:#FBE3E1; }
  html,body { height:100%; }
  body { font-family:'Inter',system-ui,sans-serif; color:#EAF1F8;
    background:radial-gradient(60% 80% at 20% 0%, #244F80, #16324F 60%, #0E2033 100%); overflow:hidden; }
  .wrap { height:100vh; display:flex; flex-direction:column; padding:2.2vh 2vw; }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.6vh; }
  .head-l { display:flex; align-items:center; gap:1.2vw; }
  .head-logo { width:5vh; height:5vh; border-radius:1vh; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .head-logo img { width:100%; height:100%; object-fit:contain; }
  .head-title { font-family:'Barlow Semi Condensed'; font-weight:800; font-size:4.2vh; letter-spacing:.5px; line-height:1; }
  .head-sub { font-size:1.6vh; color:#9FC2E4; letter-spacing:.08em; text-transform:uppercase; }
  .clock { text-align:right; font-family:'Barlow Semi Condensed'; }
  .clock-time { font-size:3.2vh; font-weight:700; }
  .clock-date { font-size:1.5vh; color:#9FC2E4; }
  .board { flex:1; display:grid; grid-template-columns:1.35fr 1fr; gap:1.4vw; min-height:0; }
  .panel { background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:1.4vh; padding:1.6vh 1.4vw; display:flex; flex-direction:column; min-height:0; }
  .panel-title { font-family:'Barlow Semi Condensed'; font-weight:700; font-size:2.1vh; letter-spacing:.05em; text-transform:uppercase; color:#BFD9F0; margin-bottom:1.2vh; display:flex; justify-content:space-between; gap:1vw; }
  .panel-title span:last-child { color:#7FA8D4; font-size:1.5vh; font-weight:600; }
  .rows { flex:1; overflow:hidden; display:flex; flex-direction:column; gap:.7vh; }
  .drow { display:grid; grid-template-columns:2.6vh 1fr auto; align-items:center; gap:1vw; padding:.7vh 1vw; border-radius:1vh; background:rgba(255,255,255,.04); }
  .rank { font-family:'Barlow Semi Condensed'; font-weight:800; font-size:2.4vh; color:#7FA8D4; text-align:center; }
  .dname { font-weight:600; font-size:2.3vh; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .dpct { display:flex; align-items:center; gap:.6vw; }
  .pill { font-family:'Barlow Semi Condensed'; font-weight:800; font-size:2.7vh; padding:.4vh 1.1vw; border-radius:1vh; min-width:7vw; text-align:center; }
  .pill.g { background:var(--greenbg); color:var(--green); }
  .pill.y { background:var(--yellowbg); color:var(--yellow); }
  .pill.r { background:var(--redbg); color:var(--red); }
  .trend { font-size:2vh; width:2vh; text-align:center; }
  .up { color:#69E08A; } .down { color:#FF8A80; } .flat { color:#7FA8D4; }
  .utable { width:100%; border-collapse:collapse; }
  .utable th { font-size:1.5vh; text-transform:uppercase; letter-spacing:.06em; color:#9FC2E4; text-align:right; padding:.6vh .6vw; font-weight:600; }
  .utable th:first-child { text-align:left; }
  .utable td { font-size:2.1vh; padding:.55vh .6vw; text-align:right; border-top:1px solid rgba(255,255,255,.07); font-variant-numeric:tabular-nums; }
  .utable td:first-child { text-align:left; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:12vw; }
  .utot { font-family:'Barlow Semi Condensed'; font-weight:800; font-size:2.3vh; }
  .flag { color:#FFCf6b; font-size:1.6vh; }
  .foot { text-align:center; font-size:1.4vh; color:#7FA8D4; margin-top:1.1vh; letter-spacing:.04em; }
  .empty { color:#7FA8D4; font-size:2vh; padding:4vh; text-align:center; }
  .fade { animation:fade .5s ease; } @keyframes fade { from{opacity:0;transform:translateY(6px);} to{opacity:1;} }
</style></head>
<body><div class="wrap" id="root"><div class="empty">Loading leaderboard…</div></div>
<script>
  var CFG = ${JSON.stringify(p)};
  function norm(s){return (s||'').trim().toLowerCase().replace(/\\s+/g,' ');}
  async function getStore(){
    try {
      var op = window.opener;
      if (op && op.storage && op.storage.get) {
        var r = await op.storage.get(CFG.storeKey, true);
        return r ? JSON.parse(r.value) : null;
      }
    } catch(e){}
    return null;
  }
  function tone(pct){ if (pct==null) return 'r'; var v=pct*100;
    if (v>=CFG.thresholds.green) return 'g'; if (v>=CFG.thresholds.yellow) return 'y'; return 'r'; }
  function arrow(cur, prev){ if (cur==null||prev==null) return ['flat','·'];
    if (cur>prev+0.001) return ['up','▲']; if (cur<prev-0.001) return ['down','▼']; return ['flat','·']; }
  function fmtPct(v){ return v==null?'—':(v*100).toFixed(1)+'%'; }
  function num(v){ return v==null?0:v; }
  function render(store){
    var root = document.getElementById('root');
    if (!store){ root.innerHTML = '<div class="empty">No data yet for this store. Import today\\'s delivery reports in the tool and this board will fill in.</div>'; return; }
    var M = (store.months||{})[CFG.ym] || {stats:{}};
    var people = (store.roster||[]).filter(function(a){return a.roleId;}).map(function(a){
      var s = M.stats[norm(a.name)] || {};
      var iU=num(s.internetUnits), pU=num(s.phoneUnits), rU=num(s.showroomUnits);
      var haveAll = (s.internetUnits!=null) && (s.phoneUnits!=null) && (s.showroomUnits!=null);
      return { name:a.name, internetPct:s.internetPct, phonePct:s.phonePct, showroomPct:s.showroomPct,
        prev:(s.prevPct||{}), iU:iU, pU:pU, rU:rU, sum:iU+pU+rU, haveAll:haveAll,
        best: Math.max(num(s.internetPct),num(s.phonePct),num(s.showroomPct)) };
    });
    var byPct = people.slice().filter(function(x){return x.internetPct!=null||x.phonePct!=null||x.showroomPct!=null;})
      .sort(function(a,b){return b.best-a.best;});
    var pctRows = byPct.map(function(x,i){
      var cur = x.internetPct; var ar = arrow(cur, x.prev.internet);
      return '<div class="drow fade"><div class="rank">'+(i+1)+'</div><div class="dname">'+x.name+'</div>'+
        '<div class="dpct"><span class="trend '+ar[0]+'">'+ar[1]+'</span><span class="pill '+tone(cur)+'">'+fmtPct(cur)+'</span></div></div>';
    }).join('') || '<div class="empty">Import an Internet Delivery report to populate delivered %.</div>';
    var uRows = people.slice().sort(function(a,b){return b.sum-a.sum;}).map(function(x){
      var flag = !x.haveAll;
      return '<tr class="fade"><td>'+x.name+'</td><td>'+x.rU+'</td><td>'+x.iU+'</td><td>'+x.pU+'</td>'+
        '<td class="utot">'+x.sum+(flag?' <span class="flag" title="Missing one or more delivery reports for this associate, the total may be incomplete.">⚑</span>':'')+'</td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">Import delivery reports to populate units.</td></tr>';
    var totSum = people.reduce(function(n,x){return n+x.sum;},0);
    // grand-total reconciliation: sum should be a whole number of units
    var grandFlag = Math.abs(totSum - Math.round(totSum)) > 0.01;
    root.innerHTML =
      '<div class="head"><div class="head-l"><div class="head-logo">'+(CFG.icon?'<img src="'+CFG.icon+'"/>':'')+'</div>'+
      '<div><div class="head-title">'+CFG.storeName+'</div><div class="head-sub">Delivery Leaderboard</div></div></div>'+
      '<div class="clock"><div class="clock-time" id="clk"></div><div class="clock-date" id="dat"></div></div></div>'+
      '<div class="board">'+
        '<div class="panel"><div class="panel-title"><span>Internet Delivered %</span><span>green ≥ '+CFG.thresholds.green+'% · yellow ≥ '+CFG.thresholds.yellow+'%</span></div><div class="rows">'+pctRows+'</div></div>'+
        '<div class="panel"><div class="panel-title"><span>Units Delivered</span><span>'+totSum+' total'+(grandFlag?' ⚑':'')+'</span></div>'+
        '<table class="utable"><thead><tr><th>Associate</th><th>Show</th><th>Net</th><th>Phone</th><th>Total</th></tr></thead><tbody>'+uRows+'</tbody></table>'+
        '<div class="foot">⚑ next to a name means a delivery report is missing for them. ⚑ on the total means units don\\'t reconcile to a whole number, check for a missing unit.</div></div>'+
      '</div>'+
      '<div class="foot">Live view · refreshes every 30 seconds · Earn the next lead.</div>';
    tick();
  }
  function tick(){ var n=new Date();
    var c=document.getElementById('clk'); var d=document.getElementById('dat');
    if(c) c.textContent = n.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    if(d) d.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'}); }
  async function loop(){ var s = await getStore(); render(s); }
  loop(); setInterval(loop, 30000); setInterval(tick, 20000);
</script></body></html>`;
}

/* ---------------- Splash ---------------- */
function Splash({ config, onEnter, onLaunchBoard }) {
  const [pickStore, setPickStore] = useState(false);
  return (
    <div className="splash">
      <div className="splash-inner">
        <div className="splash-logo"><Logo size={92} /></div>
        <h1 className="splash-title">Lead Performance</h1>
        <p className="splash-sub">Holler-Classic Family of Dealerships</p>
        <div className="splash-actions">
          <button className="btn wide splash-btn-primary" onClick={onEnter}>Launch Tool</button>
          <button className="btn-outline wide splash-btn-secondary" onClick={() => setPickStore((v) => !v)}>Launch The Board</button>
        </div>
        {pickStore && (
          <div className="splash-picker">
            <p className="hint">Open a live leaderboard for a big screen or TV. It opens in its own window and refreshes on its own.</p>
            <div className="splash-store-list">
              {config.stores.map((s) => (
                <button key={s.id} className="splash-store" onClick={() => onLaunchBoard(s.id)}>
                  {s.icon ? <img src={s.icon} alt="" /> : <span className="splash-store-ph">{s.name[0]}</span>}
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="splash-foot">Earn the next lead.</p>
      </div>
    </div>
  );
}

// Opens a standalone, auto-refreshing leaderboard in a new window sized for a TV.
function openLeaderboard(config, storeId) {
  const w = window.open("", "lpc_leaderboard_" + storeId, "width=1600,height=900");
  if (!w) { alert("Please allow pop-ups for this site to open the leaderboard on a second screen."); return; }
  const store = config.stores.find((s) => s.id === storeId);
  const thresholds = store?.thresholds || DEFAULT_THRESHOLDS;
  // The board reads its own data from shared storage on an interval so it stays live.
  const payload = {
    storeKey: `lpc:store:${storeId}:v2`,
    storeName: store?.name || "Store",
    icon: store?.icon || null,
    thresholds,
    roles: config.roles,
    ym: ym(),
  };
  w.document.open();
  w.document.write(LEADERBOARD_HTML(payload));
  w.document.close();
}

/* ---------------- Login ---------------- */
function Login({ config, onLogin, onRegister, onSetupAdmin, onBack }) {
  const admin = config.users.find((u) => u.role === "admin");
  const needsSetup = admin && !admin.pin;
  const [mode, setMode] = useState(needsSetup ? "setup" : "signin");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [name, setName] = useState("");
  const [storeId, setStoreId] = useState(config.stores[0]?.id || "");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const validPin = (p) => /^\d{6}$/.test(p);
  const domainOf = (e) => (e.split("@")[1] || "").trim().toLowerCase();

  const doSetup = async () => {
    if (!validPin(pin)) { setErr("PIN must be exactly 6 digits."); return; }
    if (pin !== pin2) { setErr("The two PINs don't match."); return; }
    if (!email.trim() || !email.includes("@")) { setErr("Enter your work email."); return; }
    const result = await onSetupAdmin({ email: email.trim().toLowerCase(), pin });
    if (result && result.ok) onLogin(result.admin);
  };

  const doSignin = () => {
    const e = email.trim().toLowerCase();
    const u = config.users.find((x) => (x.email || "").toLowerCase() === e);
    if (!u) { setErr(canRegister ? "No account found for that email. Use \u201cCreate new account\u201d below." : "No account found for that email. Ask your group admin to set up your account."); return; }
    if (!u.active) { setErr("That account is inactive. Contact your group admin."); return; }
    if (u.pending) { setErr("Your account is awaiting admin approval for store access."); return; }
    if (u.pin !== pin.trim()) { setErr("That PIN doesn't match."); return; }
    onLogin(u);
  };

  const canRegister = config.registrationOpen && (config.approvedDomains || []).length > 0;

  const doRegister = async () => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) { setErr("Enter a valid email."); return; }
    if (!config.registrationOpen) { setErr("Account creation is currently closed. Contact your group admin."); return; }
    const domains = config.approvedDomains || [];
    if (domains.length === 0) { setErr("No approved email domains are set up yet. Contact your group admin."); return; }
    if (!domains.includes(domainOf(e))) { setErr(`Email must be on an approved company domain (${domains.join(", ")}).`); return; }
    if (config.users.some((u) => (u.email || "").toLowerCase() === e)) { setErr("An account with that email already exists. Try signing in."); return; }
    if (!name.trim()) { setErr("Enter your full name."); return; }
    if (!validPin(pin)) { setErr("PIN must be exactly 6 digits."); return; }
    if (pin !== pin2) { setErr("The two PINs don't match."); return; }
    const result = await onRegister({ id: uid(), name: name.trim(), email: e, pin, role: "manager", stores: [], requestedStore: storeId, pending: true, active: true });
    if (result && result.ok) {
      setOk("Account created. You'll be able to sign in once your group admin approves your store access.");
      setMode("signin"); setPin(""); setPin2("");
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><Logo size={64} /></div>
        <h2>Lead Performance</h2>
        <p className="hint center">Holler-Classic Family of Dealerships</p>

        {mode === "setup" && (
          <>
            <p className="setup-note">Welcome. Create the first account to get started. This one is your group admin account, it can manage stores, users, and standards.</p>
            <label>Your work email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="you@company.com" />
            <label>Create a 6-digit PIN</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(""); }} placeholder="••••••" />
            <label>Confirm PIN</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={(e) => { setPin2(e.target.value.replace(/\D/g, "")); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && doSetup()} placeholder="••••••" />
            {err && <div className="login-err">{err}</div>}
            <button className="btn wide" onClick={doSetup}>Create Account</button>
          </>
        )}

        {mode === "signin" && (
          <>
            <label>Work email</label>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); setOk(""); }} placeholder="you@company.com" />
            <label>PIN</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && doSignin()} placeholder="••••••" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="btn wide" onClick={doSignin}>Sign In</button>
            <div className="login-divider"><span>or</span></div>
            <button className="btn-outline wide" onClick={() => { setMode("register"); setErr(""); setOk(""); setPin(""); setPin2(""); }}>Create New Account</button>
            {onBack && <button className="btn-link" onClick={onBack}>← Back to start</button>}
          </>
        )}

        {mode === "register" && (
          !canRegister ? (
            <>
              <p className="setup-note">New account creation isn't available right now. Your group admin needs to turn on registration and add an approved email domain first, or they can create your account for you directly.</p>
              <button className="btn wide" onClick={() => { setMode("signin"); setErr(""); }}>Back to Sign In</button>
            </>
          ) : (
            <>
              <p className="setup-note">Create your account. Your group admin grants store access after you register, so you'll sign in once approved.</p>
              <label>Work email</label>
              <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="you@company.com" />
              <label>Full name</label>
              <input value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="First Last" />
              <label>Store you need access to</label>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                {config.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label>Create a 6-digit PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setErr(""); }} placeholder="••••••" />
              <label>Confirm PIN</label>
              <input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={(e) => { setPin2(e.target.value.replace(/\D/g, "")); setErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && doRegister()} placeholder="••••••" />
              {err && <div className="login-err">{err}</div>}
              <button className="btn wide" onClick={doRegister}>Create Account</button>
              <button className="btn-link" onClick={() => { setMode("signin"); setErr(""); setPin(""); setPin2(""); }}>Back to sign in</button>
            </>
          )
        )}
      </div>
    </div>
  );
}

/* ---------------- Import badge ---------------- */
function ImportBadge({ storeData }) {
  const M = storeData.months[ym()];
  const t = M?.imports?.[today()] || {};
  const done = ["delivery", "appointment", "video"].filter((k) => t[k]).length;
  return <span className={"badge " + (done === 3 ? "badge-ok" : "badge-warn")}>{done}/3</span>;
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
function Board({ config, store, data, dragName, setDragName, onMove, onSetRestriction, readOnly }) {
  const [query, setQuery] = useState("");
  const M = data.months?.[ym()];
  const names = M?.names || {};
  const importedTypes = Object.keys(names);
  const missingReports = (nameKey) =>
    importedTypes.filter((t) => !(names[t] || []).includes(nameKey)).map((t) => REPORTS[t].label);

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

  const sections = config.roles.map((role) => ({
    role,
    people: (data.roster || []).filter((a) => a.roleId === role.id && matches(a)).sort((a, b) => a.order - b.order),
  }));
  const unassigned = (data.roster || []).filter((a) => !a.roleId && matches(a)).sort((a, b) => a.order - b.order);
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
        <span className="assoc-leads">{ev.opps ?? 0}<span className="of-cap"> / {ev.cap ?? "—"}</span></span>
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
              <span className="assoc-leads">{r.ev.opps ?? 0}<span className="of-cap"> / {r.ev.cap ?? "—"}</span></span>
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

/* ---------------- Import ---------------- */
function ImportPanel({ data, log, dropActive, setDropActive, onFiles, fileRef }) {
  const M = data.months?.[ym()];
  const t = M?.imports?.[today()] || {};
  return (
    <div className="import">
      <div className="card checklist">
        <div className="checklist-title">Today's Imports <span className="section-sub">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span></div>
        <div className="check-group-label">Lead standards</div>
        {Object.entries(REPORTS).map(([k, r]) => (
          <div key={k} className={"check " + (t[k] ? "done" : "")}>
            <span className="check-box">{t[k] ? "✓" : ""}</span>{r.label} report
          </div>
        ))}
        <div className="check-group-label">Leaderboard delivery</div>
        {Object.entries(LEADERBOARD_REPORTS).map(([k, r]) => (
          <div key={k} className={"check " + (t[k] ? "done" : "")}>
            <span className="check-box">{t[k] ? "✓" : ""}</span>{r.label}
          </div>
        ))}
        {!(t.delivery && t.appointment && t.video) && <p className="hint">Lead statuses reflect the latest data on file. Drop today's DriveCentric exports to bring everyone current.</p>}
      </div>
      <div className={"dropzone " + (dropActive ? "active" : "")}
        onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => { e.preventDefault(); setDropActive(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}>
        <div className="dz-icon">⇩</div>
        <div className="dz-title">Drop today's CSVs here</div>
        <div className="dz-sub">Standards reports (Appointment, Video) plus your delivery reports. For the leaderboard, name the three delivery files with "internet", "phone", and "showroom" so the tool can tell them apart.</div>
        <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }}
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {log.length > 0 && (
        <div className="import-log">
          {log.map((l, i) => <div key={i} className={l.ok ? "log-ok" : "log-err"}>{l.ok ? "✓" : "✕"} {l.msg}</div>)}
        </div>
      )}
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
                      <td>{ev.opps ?? 0} / {ev.cap ?? "—"}</td>
                      <td>{fmtPct(s?.deliveredPct)}</td><td>{fmtPct(s?.apptVideoDayPct)}</td>
                      <td>{fmtPct(s?.engagedVideoPct)}</td><td>{fmtPct(s?.bhVideoPct)}</td>
                      <td>{ev.status === "pass" ? <span className="verdict verdict-pass sm">Cleared</span> : ev.status === "fail" ? <span className="verdict verdict-fail sm">Restrict</span> : "—"}</td>
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
      <div className="card grace-setting">
        <span className="grace-label">Leaderboard colors</span>
        <label className="thr-label"><span className="thr-dot g" />Green at or above
          <input type="number" min="0" max="100" defaultValue={config.stores.find((s) => s.id === storeId)?.thresholds?.green ?? DEFAULT_THRESHOLDS.green}
            onBlur={(e) => {
              const v = Math.max(0, Math.min(100, toNum(e.target.value) ?? DEFAULT_THRESHOLDS.green));
              const next = JSON.parse(JSON.stringify(config));
              const s = next.stores.find((x) => x.id === storeId);
              s.thresholds = { ...(s.thresholds || DEFAULT_THRESHOLDS), green: v };
              onChange(next, { store: storeId, action: "Changed leaderboard threshold", detail: `${storeName}: green ${v}%` });
            }} />%
        </label>
        <label className="thr-label"><span className="thr-dot y" />Yellow at or above
          <input type="number" min="0" max="100" defaultValue={config.stores.find((s) => s.id === storeId)?.thresholds?.yellow ?? DEFAULT_THRESHOLDS.yellow}
            onBlur={(e) => {
              const v = Math.max(0, Math.min(100, toNum(e.target.value) ?? DEFAULT_THRESHOLDS.yellow));
              const next = JSON.parse(JSON.stringify(config));
              const s = next.stores.find((x) => x.id === storeId);
              s.thresholds = { ...(s.thresholds || DEFAULT_THRESHOLDS), yellow: v };
              onChange(next, { store: storeId, action: "Changed leaderboard threshold", detail: `${storeName}: yellow ${v}%` });
            }} />%
        </label>
        <span className="hint">Delivered % at or above green shows green on the TV leaderboard, at or above yellow shows yellow, anything lower shows red. Below yellow is red.</span>
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("manager");
  const [storeIds, setStoreIds] = useState([]);
  const [domain, setDomain] = useState("");

  const validPin = (p) => /^\d{6}$/.test(p);
  const pending = config.users.filter((u) => u.pending);

  const addDomain = () => {
    const d = domain.trim().toLowerCase().replace(/^@/, "");
    if (!d || !d.includes(".")) return;
    if ((config.approvedDomains || []).includes(d)) { setDomain(""); return; }
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
  const toggleRegistration = () => {
    const next = JSON.parse(JSON.stringify(config));
    next.registrationOpen = !next.registrationOpen;
    onChange(next, { action: next.registrationOpen ? "Opened registration" : "Closed registration" });
  };

  const approve = (u, storeId) => {
    const next = JSON.parse(JSON.stringify(config));
    const t = next.users.find((x) => x.id === u.id); if (!t) return;
    t.pending = false;
    t.stores = storeId ? [storeId] : [];
    delete t.requestedStore;
    onChange(next, { action: "Approved account", detail: `${t.name} → ${config.stores.find((s) => s.id === storeId)?.name || "no store"}` });
  };
  const deny = (u) => {
    if (!window.confirm(`Deny and delete the pending account for ${u.name}?`)) return;
    const next = JSON.parse(JSON.stringify(config));
    next.users = next.users.filter((x) => x.id !== u.id);
    onChange(next, { action: "Denied account", detail: u.name });
  };

  const addUser = () => {
    const n = name.trim(); const e = email.trim().toLowerCase();
    if (!n || !validPin(pin)) { alert("Name is required and PIN must be exactly 6 digits."); return; }
    if (e && config.users.some((u) => (u.email || "").toLowerCase() === e)) { alert("That email is already in use."); return; }
    const next = JSON.parse(JSON.stringify(config));
    next.users.push({ id: uid(), name: n, email: e, pin, role, stores: role === "admin" ? [] : storeIds, active: true });
    setName(""); setEmail(""); setPin(""); setStoreIds([]);
    onChange(next, { action: "Created user", detail: `${n} (${role})` });
  };
  const toggleActive = (u) => {
    const next = JSON.parse(JSON.stringify(config));
    const t = next.users.find((x) => x.id === u.id); if (!t) return;
    t.active = !t.active;
    onChange(next, { action: t.active ? "Reactivated user" : "Deactivated user", detail: t.name });
  };
  const changePin = (u) => {
    const p = prompt(`New 6-digit PIN for ${u.name}:`);
    if (p == null) return;
    if (!/^\d{6}$/.test(p.trim())) { alert("PIN must be exactly 6 digits."); return; }
    const next = JSON.parse(JSON.stringify(config));
    next.users.find((x) => x.id === u.id).pin = p.trim();
    onChange(next, { action: "Changed PIN", detail: u.name });
  };
  const changeStores = (u, id, checked) => {
    const next = JSON.parse(JSON.stringify(config));
    const t = next.users.find((x) => x.id === u.id); if (!t) return;
    t.stores = checked ? [...new Set([...t.stores, id])] : t.stores.filter((s) => s !== id);
    onChange(next, { action: "Changed store access", detail: `${t.name} → ${t.stores.map((s) => config.stores.find((x) => x.id === s)?.name).join(", ") || "none"}` });
  };
  const domainOf = (e) => (String(e).split("@")[1] || "").toLowerCase();
  const offDomain = (u) => u.email && (config.approvedDomains || []).length > 0 && !(config.approvedDomains || []).includes(domainOf(u.email));

  return (
    <div className="access">
      {pending.length > 0 && (
        <div className="card pending-card">
          <h3>Pending Approvals <span className="badge badge-warn">{pending.length}</span></h3>
          <p className="hint">These people registered and are waiting for store access. Approve to let them in, or deny to remove the request.</p>
          {pending.map((u) => (
            <div key={u.id} className="pending-row">
              <div><b>{u.name}</b><span className="pending-email">{u.email}</span></div>
              <div className="pending-actions">
                <span className="hint">Requested: {config.stores.find((s) => s.id === u.requestedStore)?.name || "none"}</span>
                <select defaultValue={u.requestedStore || ""} id={"appr-" + u.id}>
                  <option value="">no store yet</option>
                  {config.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="btn" onClick={() => approve(u, document.getElementById("appr-" + u.id).value)}>Approve</button>
                <button className="btn-x" onClick={() => deny(u)}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Approved Email Domains</h3>
        <p className="hint">Only emails on these domains can create an account. Without at least one domain, self-registration stays closed.</p>
        <div className="chip-list">
          {(config.approvedDomains || []).map((d) => (
            <span key={d} className="domain-chip">{d}<button onClick={() => removeDomain(d)}>✕</button></span>
          ))}
          {(config.approvedDomains || []).length === 0 && <span className="hint">No domains yet.</span>}
        </div>
        <div className="inline-form">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="hollerclassic.com" onKeyDown={(e) => e.key === "Enter" && addDomain()} />
          <button className="btn" onClick={addDomain}>Add domain</button>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={!!config.registrationOpen} onChange={toggleRegistration} />
          <span>Allow new account creation {config.registrationOpen ? "(open)" : "(closed)"}</span>
        </label>
        <p className="hint">Turn this off once everyone's enrolled to close the door entirely. Only you can reopen it.</p>
      </div>

      <div className="card">
        <h3>Create a User Directly</h3>
        <div className="inline-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={6} placeholder="6-digit PIN" inputMode="numeric" />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">Store Manager</option>
            <option value="overseer">Centralized BDC (oversight)</option>
            <option value="admin">Group Admin</option>
          </select>
          <button className="btn" onClick={addUser}>Create</button>
        </div>
        {(role === "manager" || role === "overseer") && (
          <div className="store-checks">
            {config.stores.map((s) => (
              <label key={s.id} className="check-inline">
                <input type="checkbox" checked={storeIds.includes(s.id)}
                  onChange={(e) => setStoreIds(e.target.checked ? [...storeIds, s.id] : storeIds.filter((x) => x !== s.id))} />
                {s.name}
              </label>
            ))}
          </div>
        )}
        <p className="hint">Use this to add someone without waiting for them to self-register. Managers and Centralized BDC users only see the stores checked here; a Centralized BDC user gets a read-only combined view across all of them. Keep in mind this is honor-system access control inside a shared tool: it keeps people organized and accountable, but it isn't bank-grade security.</p>
      </div>

      <div className="card">
        <table className="roster-table wide">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Store access</th><th>Status</th><th /></tr></thead>
          <tbody>
            {config.users.filter((u) => !u.pending).map((u) => (
              <tr key={u.id} className={u.active ? "" : "row-inactive"}>
                <td><b>{u.name}</b></td>
                <td className="mono">{u.email || "—"}{offDomain(u) && <span className="flag flag-gray" title="Email is not on an approved domain">off-domain</span>}</td>
                <td>{u.role === "admin" ? "Group Admin" : u.role === "overseer" ? "Centralized BDC" : "Manager"}</td>
                <td>
                  {u.role === "admin" ? <span className="hint">All stores</span> : (
                    <div className="store-checks tight">
                      {config.stores.map((s) => (
                        <label key={s.id} className="check-inline">
                          <input type="checkbox" checked={u.stores.includes(s.id)} onChange={(e) => changeStores(u, s.id, e.target.checked)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td>{u.active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-off">Inactive</span>}</td>
                <td className="row-actions">
                  <button className="btn-x" onClick={() => changePin(u)}>Change PIN</button>
                  {u.id !== session.id && <button className="btn-x" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Reactivate"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">To move a manager to a different store, just check the new store and uncheck the old one. Changes take effect the next time they load the tool.</p>
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
                <td>{e.store || "—"}</td>
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
  const [newStore, setNewStore] = useState("");
  const [newRole, setNewRole] = useState("");
  const [cropping, setCropping] = useState(null); // { storeId, src }

  const addStore = () => {
    const name = newStore.trim(); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (config.stores.some((s) => s.id === id)) return;
    const next = JSON.parse(JSON.stringify(config));
    next.stores.push({ id, name, icon: null });
    next.standards[id] = {};
    for (const r of next.roles) next.standards[id][r.id] = { tiers: JSON.parse(JSON.stringify(DEFAULT_TIERS)) };
    setNewStore("");
    onChange(next, { action: "Added store", detail: name });
  };
  const moveStore = (idx, dir) => {
    const to = idx + dir;
    if (to < 0 || to >= config.stores.length) return;
    const next = JSON.parse(JSON.stringify(config));
    const [item] = next.stores.splice(idx, 1);
    next.stores.splice(to, 0, item);
    onChange(next, { action: "Reordered stores", detail: `${item.name} moved ${dir < 0 ? "up" : "down"}` });
  };
  const deleteStore = (s) => {
    const ok = window.confirm(`Delete ${s.name}? Its roster, imports, and history stay saved in storage, but the store disappears from every view and its standards are removed. Users with access only to this store will have nothing to see.`);
    if (!ok) return;
    const next = JSON.parse(JSON.stringify(config));
    next.stores = next.stores.filter((x) => x.id !== s.id);
    delete next.standards[s.id];
    for (const u of next.users) u.stores = (u.stores || []).filter((id) => id !== s.id);
    onChange(next, { action: "Deleted store", detail: s.name });
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
        <h3>Stores & Manufacturer Logos</h3>
        <table className="roster-table">
          <thead><tr><th>Order</th><th>Logo</th><th>Store</th><th /></tr></thead>
          <tbody>
            {config.stores.map((s, idx) => (
              <tr key={s.id}>
                <td className="row-actions">
                  <button className="btn-arrow" disabled={idx === 0} onClick={() => moveStore(idx, -1)} title="Move up">↑</button>
                  <button className="btn-arrow" disabled={idx === config.stores.length - 1} onClick={() => moveStore(idx, 1)} title="Move down">↓</button>
                </td>
                <td>{s.icon ? <img className="store-logo" src={s.icon} alt="" /> : <div className="store-logo placeholder">{s.name[0]}</div>}</td>
                <td><b>{s.name}</b></td>
                <td className="row-actions">
                  <label className="btn-ghost file-btn">
                    {s.icon ? "Replace logo" : "Upload logo"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { setIcon(s.id, e.target.files[0]); e.target.value = ""; }} />
                  </label>
                  {s.icon && <button className="btn-x" onClick={() => setCropping({ storeId: s.id, src: s.icon })}>Edit</button>}
                  {s.icon && <button className="btn-x" onClick={() => clearIcon(s.id)}>Remove</button>}
                  <button className="btn-x" onClick={() => deleteStore(s)}>Delete store</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-form">
          <input value={newStore} onChange={(e) => setNewStore(e.target.value)} placeholder="e.g. Audi North Orlando" />
          <button className="btn" onClick={addStore}>Add Store</button>
        </div>
        <p className="hint">The order here is the order everywhere: the overview cards and the store dropdown. Upload any image and you can crop and zoom it before it saves. New stores start with the default tier standards.</p>
      </div>
      <div className="card">
        <h3>Positions</h3>
        <div className="role-chips">
          {config.roles.map((r) => <span key={r.id} className="role-chip" style={{ background: r.color }}>{r.name}</span>)}
        </div>
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
  return <div className="lpc">{children}</div>;
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
        font-size: 14px; padding-bottom: 72px; -webkit-font-smoothing: antialiased; position:relative; isolation:isolate; }
      .lpc::before { content:""; position:fixed; inset:0; z-index:-1; pointer-events:none;
        background:
          radial-gradient(48% 42% at 12% 6%, rgba(136,198,234,.34), transparent 70%),
          radial-gradient(42% 40% at 88% 12%, rgba(193,215,48,.22), transparent 70%),
          radial-gradient(52% 46% at 50% 100%, rgba(42,94,155,.14), transparent 72%),
          var(--bg); }
      .lpc * { box-sizing: border-box; }
      ::selection { background: rgba(42,94,155,.2); }

      /* ---- frosted top bar ---- */
      .topbar { position: sticky; top: 0; z-index: 30; display:flex; align-items:center; justify-content:space-between;
        padding:12px 24px; background: rgba(255,255,255,.55); backdrop-filter: saturate(180%) blur(28px);
        -webkit-backdrop-filter: saturate(180%) blur(28px); border-bottom: 1px solid rgba(255,255,255,.6);
        box-shadow: 0 1px 0 rgba(0,0,0,.05); flex-wrap:wrap; gap:10px; }
      .brand { display:flex; gap:12px; align-items:center; }
      .brand-title { font-weight:700; font-size:17px; letter-spacing:-.02em; }
      .brand-sub { font-size:11px; color:var(--ink-2); letter-spacing:.02em; }
      .topbar-right { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .save-dot { font-size:12px; color:var(--ink-3); animation: pulse 1.2s ease infinite; }
      @keyframes pulse { 50% { opacity:.4; } }
      .whoami { font-size:13px; color:var(--ink-2); }

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
      @keyframes pageIn { from { opacity:0; transform: translateY(10px) scale(.995); } to { opacity:1; transform:none; } }

      /* ---- layout & cards ---- */
      .board, .import, .standards, .roster, .admin, .gm, .history, .access, .audit, .settings { padding:20px 24px; max-width:1120px; }
      .loading, .empty { padding:64px 24px; color:var(--ink-2); }
      .card { background: rgba(255,255,255,.58); border:1px solid rgba(255,255,255,.7); border-radius:var(--radius);
        padding:18px 20px; backdrop-filter: blur(26px) saturate(170%); -webkit-backdrop-filter: blur(26px) saturate(170%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(31,54,86,.07);
        margin-bottom:16px; transition: box-shadow .3s var(--spring), transform .3s var(--spring); }
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
      .star-badge { font-size:11px; font-weight:700; color:#1E7A3C; background:rgba(48,177,85,.14); padding:3px 9px; border-radius:20px; }
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
      .splash-picker { margin-top:20px; animation: pageIn .3s var(--spring); }
      .splash-store-list { display:flex; flex-direction:column; gap:8px; max-width:300px; margin:10px auto 0; }
      .splash-store { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:12px; cursor:pointer;
        background:rgba(255,255,255,.6); border:1px solid rgba(255,255,255,.8); backdrop-filter:blur(14px); font-weight:600; font-size:14px; transition: all .2s var(--spring); }
      .splash-store:hover { background:#fff; transform: translateY(-1px); box-shadow: var(--shadow-1); }
      .splash-store img { width:26px; height:26px; object-fit:contain; border-radius:6px; }
      .splash-store-ph { width:26px; height:26px; border-radius:6px; background:#F5F5F7; display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--ink-3); }
      .splash-foot { margin-top:28px; font-size:12px; color:var(--ink-3); letter-spacing:.06em; text-transform:uppercase; }

      /* ---- thresholds + check groups ---- */
      .thr-label { display:flex; gap:8px; align-items:center; font-weight:600; }
      .thr-label input[type=number] { width:64px; }
      .thr-dot { width:11px; height:11px; border-radius:50%; }
      .thr-dot.g { background:var(--green); } .thr-dot.y { background:#E0A100; }
      .check-group-label { font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--ink-3); font-weight:700; margin:10px 0 4px; }
      .check-group-label:first-of-type { margin-top:0; }
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
      .dz-icon { font-size:28px; color:var(--blue); }
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
      .store-logo { width:38px; height:38px; object-fit:contain; border-radius:10px; background:#fff; border:1px solid var(--line); }
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
      @media print {
        .no-print, .topbar, .seg-wrap { display:none !important; }
        .lpc { background:#fff; padding:0; }
        .print-area { padding:0; max-width:none; }
        .card { box-shadow:none; border:none; padding:0; margin-bottom:20px; }
        .gm-table td, .gm-table th { font-size:11px; }
      }
    `}</style>
  );
}

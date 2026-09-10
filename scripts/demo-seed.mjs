/**
 * The demo store, and everything in it.
 * -------------------------------------------------------------------------
 * Apple will not review a beta without a way into it, and the way in must not
 * be a real dealership. Two reasons, and the second is the one that would do
 * damage:
 *
 *   A real store's board carries named people with their close rates, their
 *   coaching notes and their honesty flags. That is employment performance
 *   data about people who never agreed to have it read by a stranger.
 *
 *   A reviewer with a manager login can WRITE. They will tap things — that is
 *   the job. On a live store that means claiming an up, reordering the line,
 *   marking somebody off the floor, and firing a Live Activity at a real
 *   salesperson's phone in the middle of their shift.
 *
 * So the demo is its own store with invented staff, and this file is what puts
 * it there. Everybody in it is fictional. The numbers are generated from a
 * fixed seed, so the same command twice gives the same store and a screenshot
 * taken today still matches the app next week.
 *
 * Run it:
 *   node scripts/demo-seed.mjs --out demo.json      write the rows to a file
 *   node scripts/demo-seed.mjs --push               write them to Supabase
 *
 * --push needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 * The service role key bypasses row-level security, which is the only way to
 * write app_data for a store that has no members yet, and is also why this is
 * a script somebody runs deliberately rather than anything the app can do.
 */

import { storeKey, actKey, floorStatsKey, boardKey, withChannels } from "../api/_store-keys.mjs";

/* The store. The id is not a real dealership's and the name says demo out loud,
   so nobody looking at a support ticket has to work out whether this is a
   customer. */
export const DEMO_STORE_ID = "sage-demo";
export const DEMO_STORE_NAME = "Sage Demo Motors";
export const DEMO_EMAIL = "demo@sageonline.app";

/* Invented people. First names deliberately unlike anybody on a real roster,
   and no surname is repeated from a live store. The role ids line up with
   DEFAULT_CONFIG.roles so the board colours them the way it colours anybody. */
const CAST = [
  { name: "Marisol Vantry",  roleId: "sales",   tenure: "veteran" },
  { name: "Dev Okonjo",      roleId: "sales",   tenure: "strong" },
  { name: "Priya Ramanan",   roleId: "sales",   tenure: "strong" },
  { name: "Tobias Ferrell",  roleId: "sales",   tenure: "steady" },
  { name: "Ines Marchetti",  roleId: "sales",   tenure: "steady" },
  { name: "Coby Alderidge",  roleId: "sales",   tenure: "new" },
  { name: "Wren Halloway",   roleId: "service", tenure: "steady" },
  { name: "敏 Nakashima",     roleId: "sales",   tenure: "new" },
];

/* A manager, so the reviewer's own account has a name on the roster rather
   than appearing as a ghost beside eight people who do have one. */
const DEMO_MANAGER = { name: "Alex Reyner", roleId: "manager" };

/* The same three tiers DEFAULT_TIERS carries in the app. Written out rather
   than imported because they live inside the one big component file, and a
   demo script reaching in there would be a worse dependency than a copy. */
const DEMO_TIERS = [
  { cap: 60,  requirements: [{ metric: "apptVideoDayPct", min: 50 }, { metric: "deliveredPct", min: 10 }, { metric: "engagedVideoPct", min: 40 }] },
  { cap: 80,  requirements: [{ metric: "apptVideoDayPct", min: 55 }, { metric: "deliveredPct", min: 12 }, { metric: "engagedVideoPct", min: 45 }] },
  { cap: 100, requirements: [{ metric: "apptVideoDayPct", min: 60 }, { metric: "deliveredPct", min: 14 }, { metric: "engagedVideoPct", min: 50 }, { metric: "bhVideoPct", min: 40 }] },
];

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const uid = () => Math.random().toString(36).slice(2, 10);

/* Fixed-seed randomness. Math.random would make every run a different store,
   which is fine until you are comparing a screenshot against what the reviewer
   is looking at. mulberry32 is small enough to read and repeats exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayStr = (d) => d.toISOString().slice(0, 10);
const monthStr = (d) => d.toISOString().slice(0, 7);

/* The last N days the store was open, newest last. Sundays are skipped because
   a dealership that trades seven days a week reads as a data error to anybody
   who knows the business. */
function openDays(n, from = new Date()) {
  const out = [];
  const d = new Date(from);
  while (out.length < n) {
    if (d.getUTCDay() !== 0) out.push(dayStr(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

/* How hard somebody works, by where they are in their career. The point of the
   demo is that the coaching pages have something to say, which means the people
   have to differ from each other in ways the app is built to notice. */
const SHAPE = {
  veteran: { calls: [28, 46], video: [4, 9],  text: [22, 40], email: [10, 20], appts: [3, 6], close: 0.34, tasks: [10, 18] },
  strong:  { calls: [24, 40], video: [3, 7],  text: [18, 34], email: [8, 16],  appts: [2, 5], close: 0.28, tasks: [8, 16] },
  steady:  { calls: [16, 30], video: [1, 4],  text: [12, 26], email: [5, 12],  appts: [1, 4], close: 0.21, tasks: [5, 12] },
  new:     { calls: [9, 22],  video: [0, 2],  text: [7, 18],  email: [3, 9],   appts: [0, 3], close: 0.14, tasks: [2, 9] },
};

const pick = (r, [lo, hi]) => lo + Math.floor(r() * (hi - lo + 1));

/* One person's day. The fields are the ones a Daily Activity import writes, in
   the same shape, because every page downstream reads that shape and a demo
   that invents its own would exercise none of them. */
function personDay(r, person, day) {
  const s = SHAPE[person.tenure];
  const calls = pick(r, s.calls);
  const contacted = Math.round(calls * (0.3 + r() * 0.25));
  const apptCreated = pick(r, s.appts);
  const apptScheduled = apptCreated;
  const apptConfirmed = Math.round(apptScheduled * (0.5 + r() * 0.4));
  const apptShow = Math.round(apptConfirmed * (0.5 + r() * 0.45));
  const visits = apptShow + (r() < 0.4 ? 1 : 0);
  const units = visits > 0 && r() < s.close ? 1 : 0;
  const oppShowroom = visits;
  const oppPhone = Math.round(contacted * 0.12);
  const oppInternet = pick(r, [0, 3]);
  const tasks = pick(r, s.tasks);
  return {
    displayName: person.name,
    calls, video: pick(r, s.video), contacted,
    text: pick(r, s.text), email: pick(r, s.email),
    apptCreated, apptScheduled, apptConfirmed, apptShow,
    opps: oppShowroom + oppPhone + oppInternet,
    oppShowroom, oppPhone, oppInternet, oppCampaign: 0,
    tasks, tasksPosted: pick(r, [0, 6]),
    sold: units, units, visits,
    /* RockEd qualification, which the phone turns into points. Not everybody,
       every day — a demo where every light is green teaches the reviewer
       nothing about what the screen looks like when one is not. */
    rocked: r() < 0.55,
    uploadedAt: new Date().toISOString(),
  };
}

/* ---------------- The line, as it stands right now ----------------
   A reviewer opening the app should find a working floor rather than an empty
   one, so the demo has people mid-shift: somebody with a guest, somebody who
   asked for a FlyBy, and a queue with names waiting their turn.

   The shape is applyQueueAction's, exactly — row.line of people carrying
   label/status/statusAt, row.assists for open asks, row.history for the day.
   An earlier draft of this file invented `people` instead of `line` and the
   page rendered "0 in line" over a full roster, which is the failure mode this
   whole demo exists to avoid. */
function liveQueue(r, roster, nowIso) {
  const mins = (m) => new Date(Date.now() - m * 60000).toISOString();
  const [a, b, c, d, e, f] = roster;
  const at = (p, status, m, extra = {}) => ({
    id: p.id, label: p.name, name: p.name, status, statusAt: mins(m),
    joinedAt: mins(m + 30), awayReason: status === "waiting" ? null : status,
    table: null, ...extra,
  });
  return {
    updatedAt: nowIso,
    line: [
      at(b, "waiting", 41),
      at(c, "waiting", 17),
      at(a, "customer", 23, { table: 4, awayReason: "customer" }),
      at(e, "waiting", 6),
      at(d, "away", 64, { awayReason: "away" }),
      at(f, "lunch", 12, { awayReason: "lunch" }),
    ],
    /* One open ask, so the FlyBy path is visible standing still. */
    assists: [
      { id: uid(), t: mins(3), kind: "fly", byId: c.id, byName: c.name,
        table: 4, spot: "floor", note: null },
    ],
    checkouts: [],
    history: [
      { t: mins(64), action: "away", id: d.id, who: d.name, by: "self" },
      { t: mins(23), action: "customer", id: a.id, who: a.name, by: "self" },
      { t: mins(12), action: "lunch", id: f.id, who: f.name, by: "self" },
    ],
  };
}

/* The coaching mirror. queueCoachingStats reads data.queue[day].history, so a
   demo with no history gives the manager an empty coaching page — which is
   exactly the "unable to access all features" the first submission was
   rejected for. */
function queueHistory(r, roster, days) {
  const out = {};
  for (const day of days.slice(-30)) {
    const events = [];
    const n = 3 + Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const who = roster[Math.floor(r() * roster.length)];
      const hour = 9 + Math.floor(r() * 9);
      const t = `${day}T${String(hour).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}:00.000Z`;
      const roll = r();
      const kind = roll < 0.45 ? "claimed" : roll < 0.7 ? "with-guest"
        : roll < 0.85 ? "fly" : roll < 0.95 ? "to" : "leave";
      const ev = { id: uid(), t, kind, byId: who.id, byName: who.name, table: 1 + Math.floor(r() * 8) };
      /* A handful of "with a guest" presses where nobody was with a guest.
         This is the flag the coaching page shows a manager, and a demo that
         never produces one hides a whole panel. */
      if (kind === "with-guest" && r() < 0.18) { ev.unverified = true; ev.wasStatus = "waiting"; }
      events.push(ev);
    }
    events.sort((x, y) => (x.t < y.t ? -1 : 1));
    out[day] = { history: events };
  }
  return out;
}

/* ---------------- Putting the store together ---------------- */
export function buildDemo() {
  const r = rng(20260909);
  const nowIso = new Date().toISOString();
  const days = openDays(45);
  const month = monthStr(new Date());
  const today = days[days.length - 1];

  /* label as well as name: the line and the phone read `label`, the board and
     the coaching pages read `name`, and a roster carrying only one of them
     leaves whichever screen wanted the other looking at an empty person. */
  const roster = CAST.map((p, i) => ({
    id: uid(), name: p.name, label: p.name, roleId: p.roleId, order: i,
    tenure: p.tenure, updatedAt: nowIso,
  }));
  roster.push({ id: uid(), name: DEMO_MANAGER.name, label: DEMO_MANAGER.name,
    roleId: DEMO_MANAGER.roleId, order: roster.length, updatedAt: nowIso });

  /* Per-day activity, for everybody who is tracked. The manager is not. */
  const tracked = roster.filter((p) => p.roleId !== "manager");
  const activity = {};
  for (const day of days) {
    activity[day] = {};
    for (const p of tracked) {
      /* Not everybody works every day. A roster where nobody is ever off makes
         the schedule and the off-day handling untestable. */
      if (r() < 0.12) continue;
      activity[day][norm(p.name)] = personDay(r, p, day);
    }
  }

  const queue = queueHistory(r, tracked, days);
  const floor = {};
  for (const day of Object.keys(queue)) floor[day] = { history: [] };

  /* The month, as a Delivery Summary import leaves it. Without this the
     dashboard's headline is a zero over "set a goal" and the channel gauges are
     three dashes, which is a demo that shows a reviewer nothing. unitsOf sums
     the four channel counts, so those are the fields that have to be here.

     The totals are derived from the goal and how far into the month it is,
     rather than picked. A fixed pile of units looks right on the day it is
     written and absurd three weeks later — the first draft of this put the
     store on pace for 274 against a goal of 96, which is not a demo, it is a
     bug report. Deriving it means the store is always a little behind pace,
     whatever day the reviewer opens the app, which is also the more useful
     state to show: it is the one where the coaching pages have a job. */
  const dim = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0).getDate();
  const elapsed = Math.max(1, new Date().getUTCDate() - 1);
  const GOAL = 96;
  const storeSoFar = Math.max(1, Math.round(GOAL * (elapsed / dim) * 0.92));
  /* The roster sums higher than the store's own count, because a car credits
     the salesperson and again whoever set the appointment. That gap is real and
     the app is built to show it, so the demo has to have it. */
  const rosterTotal = Math.round(storeSoFar / 0.82);

  const weight = { veteran: 1.6, strong: 1.3, steady: 1.0, new: 0.55 };
  const totalWeight = tracked.reduce((n, p) => n + weight[p.tenure], 0);
  const monthStats = {};
  for (const p of tracked) {
    const mine = Math.max(0, Math.round((rosterTotal * weight[p.tenure]) / totalWeight));
    /* Split across the three channels the dashboard gauges. */
    const showroomUnits = Math.round(mine * (0.45 + r() * 0.1));
    const internetUnits = Math.round((mine - showroomUnits) * (0.55 + r() * 0.2));
    const phoneUnits = Math.max(0, mine - showroomUnits - internetUnits);
    monthStats[norm(p.name)] = {
      internetUnits, phoneUnits, showroomUnits, campaignUnits: 0,
      internetLeads: internetUnits * pick(r, [6, 12]) + pick(r, [4, 12]),
      phoneLeads: phoneUnits * pick(r, [7, 14]) + pick(r, [3, 9]),
      showroomLeads: showroomUnits * pick(r, [3, 6]) + pick(r, [2, 6]),
      internetPct: Math.round(8 + r() * 14),
      phonePct: Math.round(7 + r() * 13),
      showroomPct: Math.round(18 + r() * 22),
      apptVideoDayPct: Math.round(35 + r() * 45),
      engagedVideoPct: Math.round(30 + r() * 45),
      bhVideoPct: Math.round(25 + r() * 45),
      deliveredPct: Math.round(8 + r() * 12),
      newUnits: Math.round(mine * 0.6),
      usedUnits: mine - Math.round(mine * 0.6),
    };
  }
  /* The store's own delivered count, which is the only figure that counts a car
     once. Everywhere the store's month is shown reads this instead of the sum. */
  const stated = {
    deliveries: storeSoFar, sold: storeSoFar,
    storeName: DEMO_STORE_NAME, day: today, at: nowIso, source: "roll-up",
  };

  const storeData = {
    roster,
    months: { [month]: { stats: monthStats, imports: {}, names: {}, stated } },
    activity,
    queue,
    floor,
    __storeId: DEMO_STORE_ID,
  };

  /* The board row, which is what the wall display AND the phone read. The
     phone gets its month figures from here rather than from the store, because
     the store rows need a signed-in session and this one does not. Shape
     matters: it looks for b.months[b.ym].stats, and an earlier draft of this
     file invented a people[] array instead, which drew "No month row yet" over
     a store with forty-five days of history in it. */
  const people = roster.filter((a) => a.roleId !== "manager")
    .map((a) => ({ id: a.id, name: a.name, roleId: a.roleId }));
  const board = {
    updatedAt: nowIso,
    storeId: DEMO_STORE_ID,
    storeName: DEMO_STORE_NAME,
    icon: null,
    brand: { primary: "#2A5E9B", deep: "#1D4674", accent: "#C1D730" },
    goals: {}, off: {}, ticker: [], departed: [],
    roles: [{ id: "sales" }, { id: "service" }],
    /* Both lists, because they are read by different screens: `roster` is the
       phone's "which of these is me", `people` is the wall's. buildBoardPayload
       publishes both and so must this, or whichever screen wanted the other one
       looks at a store with nobody in it. */
    roster: people,
    people,
    ym: month,
    months: { [month]: { stats: monthStats, stated } },
    thresholds: { internet: { green: 12 }, phone: { green: 10 }, showroom: { green: 25 },
      apptVideoDayPct: { green: 60 }, engagedVideoPct: { green: 50 } },
  };

  const rows = [];
  const put = (table, row) => rows.push({ table, row });

  put("app_data", { key: storeKey(DEMO_STORE_ID), value: storeData, updated_at: nowIso });
  put("app_data", { key: boardKey(DEMO_STORE_ID), value: board, updated_at: nowIso });

  /* The last 45 days also live in their own rows, which is what the phone reads
     so it never pulls the whole store to draw one week. */
  for (const day of days) {
    put("app_data", { key: actKey(DEMO_STORE_ID, day), value: activity[day], updated_at: nowIso });
    /* The floor row is what the phone reads, and it carries the month's channel
       figures as they stood that day — which is what the thirty-day closing
       line is drawn from. Walked forward rather than stamped flat, so the line
       has somewhere to go: each day gets the month-to-date as of that day. */
    const upTo = days.filter((d) => d.slice(0, 7) === day.slice(0, 7) && d <= day);
    const asOf = { months: { [day.slice(0, 7)]: { stats: {} } } };
    for (const p of tracked) {
      const key = norm(p.name);
      let iu = 0, il = 0, pu = 0, pl = 0, su = 0, sl = 0;
      for (const d of upTo) {
        const r = activity[d] && activity[d][key];
        if (!r) continue;
        /* The day's own opportunities are the leads; a unit lands on the
           channel that saw them, which for a demo is close enough to the way a
           real Delivery Summary credits it. */
        il += r.oppInternet || 0; pl += r.oppPhone || 0; sl += r.oppShowroom || 0;
        if (r.units) {
          if ((r.oppShowroom || 0) >= (r.oppInternet || 0)) su += r.units; else iu += r.units;
        }
      }
      asOf.months[day.slice(0, 7)].stats[key] = {
        internetUnits: iu, internetLeads: il, phoneUnits: pu, phoneLeads: pl,
        showroomUnits: su, showroomLeads: sl,
      };
    }
    put("app_data", { key: floorStatsKey(DEMO_STORE_ID, day),
      value: withChannels(activity[day], asOf, day), updated_at: nowIso });
  }

  /* Today's live line and floor. */
  const line = liveQueue(r, tracked, nowIso);
  /* queueRowId is `store:date` for the line and `store:date:kind` for the rest;
     floorRowId is `store:date`. Getting these wrong writes rows nothing reads. */
  put("queue_public", { id: `${DEMO_STORE_ID}:${today}`, store: DEMO_STORE_ID, qdate: today, data: line, updated_at: nowIso });
  put("floor_public", { id: `${DEMO_STORE_ID}:${today}`, store: DEMO_STORE_ID, fdate: today,
    data: { updatedAt: nowIso, line: [], assists: [], checkouts: [], history: [] }, updated_at: nowIso });

  /* The store as the config carries it. The goal is what turns the headline
     from "set a goal" into a pace, and thresholds/graceDays are what the
     restriction logic reads — leave them out and every page says "no standards
     set yet" no matter how much history is underneath. */
  const storeConfig = {
    id: DEMO_STORE_ID, name: DEMO_STORE_NAME, icon: null,
    brand: { primary: "#2A5E9B", deep: "#1D4674", accent: "#C1D730" },
    goal: { units: GOAL, pct: 0, byMonth: { [month]: GOAL } },
    graceDays: 10,
    hours: { open: "09:00", close: "20:00" },
    reportCutoff: "23:00",
  };

  return { storeId: DEMO_STORE_ID, storeName: DEMO_STORE_NAME, today, days, roster,
    storeData, storeConfig, rows };
}

/* ---------------- Command line ---------------- */
async function main() {
  const args = process.argv.slice(2);
  const demo = buildDemo();

  const outAt = args.indexOf("--out");
  if (outAt !== -1) {
    const fs = await import("node:fs");
    const path = args[outAt + 1] || "demo.json";
    fs.writeFileSync(path, JSON.stringify(demo, null, 2));
    console.log(`Wrote ${demo.rows.length} rows to ${path}`);
    return;
  }

  if (args.includes("--sql")) {
    const fs = await import("node:fs");
    const at = args.indexOf("--sql");
    const path = (args[at + 1] && !args[at + 1].startsWith("--")) ? args[at + 1] : "demo-store.sql";
    /* Dollar-quoting, so none of the JSON needs escaping. The tag carries a
       nonce because a $$...$$ block ends at the first matching tag, and one
       stray $j$ inside a note would truncate the statement into something that
       still parses. */
    const tag = "$j" + Math.random().toString(36).slice(2, 8) + "$";
    /* Two literals, and the difference is the whole ballgame. jsonb wants the
       JSON text; a text or date column wants the bare string. Using the JSON
       one for both wrote every key as "lpc:store:sage-demo:v2" — quotes and
       all, a key the app looks for and never finds. That fails exactly like a
       seed that was never run, which is the failure this file exists to stop
       somebody chasing. */
    const json = (v) => tag + JSON.stringify(v) + tag;
    const lit = (v) => tag + String(v) + tag;
    const out = [];
    out.push("-- Sage Demo Motors: the whole demo store, as one script.");
    out.push("-- Paste into the Supabase SQL editor and run. Safe to run twice.");
    out.push("-- Everybody in here is invented. No real store is touched.");
    out.push("begin;");
    for (const { table, row } of demo.rows) {
      if (table === "app_data") {
        out.push(`insert into app_data (key, value, updated_at) values (${lit(row.key)}::text, ${json(row.value)}::jsonb, now())\n  on conflict (key) do update set value = excluded.value, updated_at = now();`);
      } else {
        const dateCol = table === "queue_public" ? "qdate" : "fdate";
        const dateVal = table === "queue_public" ? row.qdate : row.fdate;
        out.push(`insert into ${table} (id, store, ${dateCol}, data, updated_at) values (${lit(row.id)}::text, ${lit(row.store)}::text, ${lit(dateVal)}::date, ${json(row.data)}::jsonb, now())\n  on conflict (id) do update set data = excluded.data, updated_at = now();`);
      }
    }
    /* The config, read-modified-written in one statement. Merging with || rather
       than jsonb_set because jsonb_set on a path whose parent is missing returns
       null, which would blank the settings row rather than fail. */
    const stdBlock = { sales: { tiers: DEMO_TIERS }, service: { tiers: DEMO_TIERS } };
    out.push([
      "update app_data set value =",
      "  value",
      `  || jsonb_build_object('stores', (`,
      `       select coalesce(jsonb_agg(s), '[]'::jsonb) || ${json(demo.storeConfig)}::jsonb`,
      `       from jsonb_array_elements(coalesce(value->'stores', '[]'::jsonb)) s`,
      `       where s->>'id' is distinct from ${lit(DEMO_STORE_ID)}::text))`,
      `  || jsonb_build_object('standards',`,
      `       coalesce(value->'standards', '{}'::jsonb)`,
      `       || jsonb_build_object(${lit(DEMO_STORE_ID)}::text, ${json(stdBlock)}::jsonb)),`,
      "  updated_at = now()",
      "where key = 'lpc:config:v2';",
    ].join("\n"));
    out.push("commit;");
    out.push("");
    out.push("-- One step left, on purpose: create the account for " + DEMO_EMAIL);
    out.push("-- through the app's own Create New Account screen, then grant it");
    out.push("-- manager access to " + DEMO_STORE_ID + " and nothing else. Minting a");
    out.push("-- login from SQL is how a demo account ends up seeing a real store.");
    fs.writeFileSync(path, out.join("\n\n"));
    console.log(`Wrote ${demo.rows.length} rows plus the config update to ${path}`);
    return;
  }

  if (args.includes("--push")) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
      process.exit(1);
    }
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });
    /* One table at a time, because the conflict column differs. */
    const byTable = new Map();
    for (const { table, row } of demo.rows) {
      if (!byTable.has(table)) byTable.set(table, []);
      byTable.get(table).push(row);
    }
    for (const [table, list] of byTable) {
      const onConflict = table === "app_data" ? "key" : "id";
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const { error } = await sb.from(table).upsert(chunk, { onConflict });
        if (error) { console.error(`${table} failed:`, error.message); process.exit(1); }
      }
      console.log(`${table}: ${list.length} rows`);
    }
    /* The rows are not enough on their own. A store nothing lists is a store
       nobody can open: the app draws its switcher from the config, so writing
       the data and leaving the config alone puts a complete dealership in the
       database that no screen has a route to. Editing that JSON by hand is
       exactly the kind of step that gets half done, so the push does it. */
    const CONFIG_KEY = "lpc:config:v2";
    const { data: cfgRow, error: cfgErr } = await sb
      .from("app_data").select("value").eq("key", CONFIG_KEY).maybeSingle();
    if (cfgErr) { console.error("could not read the config:", cfgErr.message); process.exit(1); }
    const cfg = (cfgRow && cfgRow.value) || null;
    if (!cfg) {
      console.error(`No config at ${CONFIG_KEY}. Refusing to write one — that row is the whole app's settings and this script should not be the thing that invents it.`);
      process.exit(1);
    }
    cfg.stores = Array.isArray(cfg.stores) ? cfg.stores : [];
    const at = cfg.stores.findIndex((x) => x && x.id === DEMO_STORE_ID);
    if (at >= 0) cfg.stores[at] = { ...cfg.stores[at], ...demo.storeConfig };
    else cfg.stores.push(demo.storeConfig);
    /* Standards, or every page says "no standards set yet" over a full store. */
    cfg.standards = cfg.standards || {};
    cfg.standards[DEMO_STORE_ID] = cfg.standards[DEMO_STORE_ID] || {};
    for (const role of ["sales", "service"]) {
      cfg.standards[DEMO_STORE_ID][role] = cfg.standards[DEMO_STORE_ID][role] || { tiers: DEMO_TIERS };
    }
    const { error: wErr } = await sb.from("app_data")
      .upsert({ key: CONFIG_KEY, value: cfg, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (wErr) { console.error("could not write the config:", wErr.message); process.exit(1); }
    console.log(`config: ${at >= 0 ? "updated" : "added"} "${DEMO_STORE_ID}" in the store list`);

    console.log(`\nDemo store "${demo.storeName}" (${demo.storeId}) is in place.`);
    console.log(`\nOne step left, and it is deliberately not automated: create the`);
    console.log(`account for ${DEMO_EMAIL} through the app's own Create New Account`);
    console.log(`screen, then grant it manager access to ${DEMO_STORE_ID} and nothing`);
    console.log(`else. Making accounts from a script is how a demo login ends up`);
    console.log(`able to see a real dealership.`);
    return;
  }

  console.log(`${demo.rows.length} rows would be written for "${demo.storeName}".`);
  console.log(`Roster: ${demo.roster.length} people. Days of history: ${demo.days.length}.`);
  console.log(`Pass --sql <file> for a script to paste into the Supabase SQL editor,`);
  console.log(`--push to write them over the API, or --out <file> for the raw JSON.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

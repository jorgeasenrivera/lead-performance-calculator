import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { createPortal } from "react-dom";
/* The CSV reader is a manager's tool: it runs when somebody drops a report on
   the Import page. A salesperson on the floor never touches it, so it is fetched
   on the first parse rather than carried in everyone's first load. */
let _papa = null;
const loadPapa = async () => (_papa || (_papa = import("papaparse").then((m) => m.default || m)));
import { createClient } from "@supabase/supabase-js";
/* The mark. One drawing on the same 9x9 grid PixIcon uses, so the identity and
   the app's iconography come off one ruler. Its own file because it is shipped
   artwork rather than a screen: every size, plate and print form is generated
   from the single pattern inside it. */
import SageMark, { sageDots, SAGE_PLATE, SAGE_BASE_REVERSED, SAGE_CAP_REVERSED } from "./SageMark.jsx";
/* The reader for the scheduled reports, shared verbatim with the pipeline that
   reads the emailed ones. It used to be a second copy of the same code with a
   comment promising they matched; they did not, and every way they differed was
   found in production. See api/_report-parsers.mjs. */
import {
  norm, toNum,
  detectReportType, parseReport, parseDeliverySummaryRows, parseStoreRollup,
  mapDailyActivityGrid, mapDeliverySummaryGrid, reportBelongsElsewhere,
} from "../api/_report-parsers.mjs";
import {
  storeKey, actKey, floorStatsKey, boardKey, reportFileKey,
  BOARD_STAT_FIELDS, slimFloorStats, withChannels,
} from "../api/_store-keys.mjs";
import { phoneExtras, withRocked, pointsForDay, stampLineMoves, channelSeries } from "../api/_phone-rows.mjs";
import { stampHours } from "../api/_hours.mjs";
import { stationPlanOf, claimStation, releaseStation,
  releasePerson, stationOf, sitsFor,
  stationLine, rollOffers, takeOffer, skipOffer, tightenPlan, seatsOf,
  stationModeOf, DEFAULT_STATION_PLAN, ownerAction, roomInUse, OFFER_MS } from "../api/_stations.mjs";
import { stationGate, needsOverride } from "../api/_station-gate.mjs";
import { occupancy, attribution, personDay } from "../api/_station-day.mjs";
import { homeLinkFor } from "../api/_people-link.mjs";
import { roomListOf, openRoom, roomsOf } from "../api/_rooms.mjs";
import { liveEnvelope } from "../api/_live-standing.mjs";
import { registrationBody } from "../api/_device.mjs";
/* The store's month: every day the doors are open, minus the holidays, and what
   the store is being asked for. Its own file because it is the arithmetic a
   manager acts on, and that is worth being able to check on its own. */
import { storeDaysInMonth, storeDaysDone, storeGoalFor } from "../api/_store-month.mjs";
import { doorCheck, readingVerdict, settle, watchCircle } from "../api/_geofence.mjs";
import { assistWhere } from "../api/_queue-notify.mjs";
/* A person's standing at a store, and every list and stamp a change to it
   implies. One place, because three screens used to do this and two of them were
   quietly broken in the same way. */
import { setStatus as setPersonStatus, statusOf, everyone as everyPerson, unclaimed,
  admitsEveryone, holdPerson, pendingList, claimPending, dropPending,
  packUp, transferOut, likelyMatches, sameAs, servedOn,
  manglings, mergeManglings, folds, unfold } from "../api/_people-status.mjs";
/* Two copies of a store, folded into one. Out here rather than in this file so
   that it can be imported and checked; see the note at the top of it. */
import { mergeAgainstServer, normTag } from "../api/_store-merge.mjs";
/* Somebody who keeps missing the standard, and the note they owe about it. The
   rule and what counts as a bad day are in one file so the manager's screen and
   the salesperson's phone can never come to two different answers about the same
   week; see the note at the top of it. */
import { notesFor, owesNote, makeNote, addNote,
  makeLift, isLifted, readFloorDays, standingFor, gates as gatesMyDay } from "../api/_goal-standing.mjs";
/* The rules for what a claim of "I'm with a customer" has to be backed by live
   next to the code that will one day raise them from a phone, not here, so that
   the server and the screen can never drift into judging people differently. */
import { reconcile as reconcilePresence, judge as judgePresence, upheldFor, onOffDayWorked } from "../api/_floor-presence.mjs";
import qrcodeGen from "qrcode-generator";

/* ---- the manager's pages ----
   They live in their own file (Manager.jsx) and their own download, fetched
   the first time a manager's page is drawn. A salesperson's phone never
   fetches them. Each is a lazy component; the root's wrap() holds the
   Suspense that shows the curtain for the moment the file takes to arrive. */
const managerChunk = () => import("./Manager.jsx");
const lazyManager = (name) => React.lazy(() => managerChunk().then((m) => ({ default: m[name] })));
const AccessPanel = lazyManager("AccessPanel");
const ActivityStandardsEditor = lazyManager("ActivityStandardsEditor");
const AdminOverview = lazyManager("AdminOverview");
const AppShell = lazyManager("AppShell");
const AssistWatcher = lazyManager("AssistWatcher");
const AssocSearch = lazyManager("AssocSearch");
const AuditLog = lazyManager("AuditLog");
const BackupPanel = lazyManager("BackupPanel");
const Board = lazyManager("Board");
const BoardLauncher = lazyManager("BoardLauncher");
const BoardRoomPhone = lazyManager("BoardRoomPhone");
const BoardScreen = lazyManager("BoardScreen");
const ChannelPrompt = lazyManager("ChannelPrompt");
const CheckOutTracker = lazyManager("CheckOutTracker");
const ChecklistEditor = lazyManager("ChecklistEditor");
const CoachingPanel = lazyManager("CoachingPanel");
const CombinedBoard = lazyManager("CombinedBoard");
const DeliveryGuideModal = lazyManager("DeliveryGuideModal");
const FloorModule = lazyManager("FloorModule");
const GMSummary = lazyManager("GMSummary");
const HistoryPanel = lazyManager("HistoryPanel");
const ImportBadge = lazyManager("ImportBadge");
const ImportPanel = lazyManager("ImportPanel");
const NoAccessPanel = lazyManager("NoAccessPanel");
const PlateTracker = lazyManager("PlateTracker");
const RepairPanel = lazyManager("RepairPanel");
const SegControl = lazyManager("SegControl");
const SettingsPanel = lazyManager("SettingsPanel");
const StoreHero = lazyManager("StoreHero");
const StoreMismatch = lazyManager("StoreMismatch");
const StorePeoplePanel = lazyManager("StorePeoplePanel");
const StoreStuck = lazyManager("StoreStuck");
const TargetsEditor = lazyManager("TargetsEditor");
const TicketsPanel = lazyManager("TicketsPanel");
const WelcomeCard = lazyManager("WelcomeCard");
const WrongReportStop = lazyManager("WrongReportStop");








const CONFIG_KEY = "lpc:config:v2";
/* ---- what the sign-up screen may know before anybody is signed in ----
   The config row is readable only with a session, so a person creating an
   account used to be shown the three example stores the app ships with, not
   the group's own. The store list, the approved domains and whether sign-up is
   open ride in a slim row under the board prefix, which is readable by anyone
   already, and it is rewritten every time the config is saved. */
const PUBLIC_STORES_KEY = "lpc:board:stores:v1";
const publicSlice = (cfg) => ({
  stores: ((cfg && cfg.stores) || []).map((s) => ({ id: s.id, name: s.name })),
  approvedDomains: (cfg && cfg.approvedDomains) || [],
  registrationOpen: !cfg || cfg.registrationOpen !== false,
  at: new Date().toISOString(),
});
const AUDIT_KEY = "lpc:audit:v2";








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
  // Campaign covers service-to-sales and finance applications. Those leads genuinely
  // sell cars, so the units must count, but grading them on close rate would punish
  // people for working a completely different kind of lead. Units only.
  "delivery-campaign": { label: "Campaign Delivery" },
};

const uid = () => Math.random().toString(36).slice(2, 10);



const DEFAULT_TAGS = [
  { id: "trucks", label: "Trucks", kind: "skill" },
  { id: "finance", label: "Finance", kind: "skill" },
  { id: "ev", label: "EV", kind: "skill" },
  { id: "fleet", label: "Fleet", kind: "skill" },
  { id: "firsttime", label: "First-time buyer", kind: "skill" },
];
// What a strength is measured on, and the field it reads.
const STRENGTH_METRICS = [
  { id: "closer", label: "Closer", from: "showroomPct", need: 4, what: "showroom closing over 90 days" },
  { id: "phone", label: "Phone", from: "phonePct", need: 4, what: "phone closing over 90 days" },
  { id: "internet", label: "Internet", from: "internetPct", need: 4, what: "internet delivery over 90 days" },
  { id: "video", label: "Video", from: "videoPct", need: 8, what: "personalised video over 90 days" },
];


/* Four letters, not two. "ES" means nothing to somebody reading the wall for the
   first time; "SPAN" is guessable from across a showroom. Anything typed that is not
   on the list is kept as the first four letters of whatever was written, so a floor
   that speaks something unusual is never blocked from recording it. */
const LANG_NAMES = {
  SPAN: "Spanish", SPANISH: "Spanish", ES: "Spanish",
  HAIT: "Haitian Creole", HT: "Haitian Creole", CREOLE: "Haitian Creole",
  PORT: "Portuguese", PT: "Portuguese",
  FREN: "French", FR: "French",
  ARAB: "Arabic", AR: "Arabic",
  URDU: "Urdu", UR: "Urdu",
  HIND: "Hindi", HI: "Hindi",
  MAND: "Mandarin", ZH: "Mandarin",
  VIET: "Vietnamese", VI: "Vietnamese",
  RUSS: "Russian", RU: "Russian",
  GERM: "German", DE: "German",
  ITAL: "Italian", IT: "Italian",
  TAGA: "Tagalog", TL: "Tagalog",
  KORE: "Korean", KO: "Korean",
  JAPA: "Japanese", JA: "Japanese",
  POLI: "Polish", PL: "Polish",
  SINH: "Sinhala", SI: "Sinhala",
  ASL: "Sign language", SIGN: "Sign language",
};


const langName = (code) => LANG_NAMES[String(code || "").toUpperCase()] || String(code || "");





// All day/month boundaries run on dealership time, not the browser's clock and not UTC.
// (toISOString() is UTC, so an 8pm Eastern import would have counted as tomorrow.)
const STORE_TZ = "America/New_York";
const dayIn = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(d); // YYYY-MM-DD
const today = () => dayIn();

/* The arrival plays only on the first sign-in of each calendar day, per person:
   keyed by dealership day plus user, so it resets at midnight and is independent
   per account on a shared machine. The key is `lpc:arrival` rather than the old
   `lpc:intro-played`, which means everybody sees the new arrival once even if
   they had already seen the old cinematic today — which is the right way round,
   since it is the thing they have not seen. */
const ym = () => today().slice(0, 7);

const dayOfMonth = () => Number(today().slice(8, 10));

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


/* What the old ramp becomes. Only these exact values are rewritten, so a colour
   a manager picked for themselves is never overwritten by an upgrade. */
const ROLE_COLOR_WARM = {
  "#2A5E9B": "#C77800",   // sales: blue      -> amber, the site's own
  "#7A4F9B": "#7E8B24",   // service: purple  -> olive, off the lime it uses for good news
  "#00A896": "#A6402F",   // bdc: teal        -> brick
  "#5B6874": "#8A7360",   // manager: slate   -> warm stone
  "#BF5AF2": "#8A5A3C",   // and the rest of the old ramp, for positions a store added
  "#FF9F0A": "#B08A1F",
  "#5E8C31": "#6F6A2E",
  "#FF375F": "#A6402F",
  "#0A84FF": "#C77800",   // the one the earlier migration was already rewriting
};

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
  /* The two video standards sit in the same list, because the store is run on
     five figures and splitting three of them into "thresholds" and two into
     "whatever the first tier happens to ask for" is how the two drifted apart.
     A tier can still require a video figure; this is what good looks like. */
  apptVideoDayPct:  { green: 60, yellow: 45 },
  engagedVideoPct:  { green: 50, yellow: 35 },
};






function normThresholds(t) {
  if (!t) return JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
  if (t.green !== undefined || t.yellow !== undefined) {
    const flat = { green: t.green ?? 20, yellow: t.yellow ?? 10 };
    return { ...JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
      internet: { ...flat }, phone: { ...flat }, showroom: { ...flat } };
  }
  const out = {};
  for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
    out[k] = { ...DEFAULT_THRESHOLDS[k], ...(t[k] || {}) };
  }
  return out;
}






const DEFAULT_ACTIVITY_STANDARDS = { minCalls: 16, minVideos: 2, minStars: 0, rockEdStars: 40,
  repeatDays: 3, repeatWindow: 5, taskBar: 80 };

// Someone can only be counted absent while there is no sign of them. A person who
// was scheduled off but is making calls, sending videos or standing in the line was
// clearly here, and the schedule is simply out of date. Evidence wins over the plan,
// and nothing is rewritten to make it so: the schedule stays as uploaded.
function workedAnyway(data, aId, d) {
  const a = (data.roster || []).find((x) => x.id === aId);
  if (!a) return false;
  // Calls and videos only. Texts and emails fire from automated follow-up whether or
  // not the person is in the building, and completed tasks can close the same way, so
  // counting those would flag almost everybody as present on their day off.
  const rec = data.activity?.[d]?.[norm(a.name)];
  if (rec && ((rec.calls || 0) > 0 || (rec.video || 0) > 0)) return true;
  // signing into the line or the floor is the same evidence, just earlier in the day
  for (const key of ["queue", "queueOnline", "floor"]) {
    const row = data[key]?.[d];
    if (row && (row.line || []).some((p) => p.id === aId)) return true;
  }
  return false;
}
/* Is there a schedule on file covering this person and this month? Without one
   there is nothing to be absent from, and guessing would mark a new hire off on
   their first week. */
function isScheduled(data, aId, d) {
  const list = data.daysOff?.[aId];
  if (!Array.isArray(list) || !list.length) return false;
  const mo = String(d).slice(0, 7);
  return list.some((x) => String(x).slice(0, 7) === mo);
}

/* Did the activity report actually run for this day? If nothing landed at all,
   silence proves nothing about any individual: it means the import is missing.
   Every automatic decision below hangs on this. */
function activityLandedOn(data, d) {
  const rows = data.activity?.[d];
  if (!rows) return false;
  return Object.values(rows).some((r) => r && ((r.calls || 0) > 0 || (r.video || 0) > 0));
}

/* Scheduled to work, the report ran, and still no sign of them. */
function looksAbsent(data, aId, d) {
  /* A day before somebody started is not a day they failed to turn up on, and
     the overnight close-out reads this — so without it a new hire's first
     morning came with a fortnight of days off already written against them. */
  const who = ((data && data.roster) || []).find((a) => a.id === aId);
  if (who && !servedOn(who, d, departedOnFor(data, who))) return false;
  if (!isScheduled(data, aId, d)) return false;
  if (data.daysOff?.[aId]?.includes(d)) return false;   // already off
  if (!activityLandedOn(data, d)) return false;
  // A manager has said this person was here. That outranks the absence of numbers.
  if (((data.presentAnyway || {})[d] || []).includes(aId)) return false;
  return !workedAnyway(data, aId, d);
}

function isOff(data, aId, d) {
  /* A manager's own Mark off is authoritative. The workedAnyway override below
     exists for the UPLOADED schedule -- somebody listed off who plainly came in
     -- but it was also overriding the button: one logged call, or a sign-in to
     the floor, and Mark off did nothing at all, silently. An explicit mark made
     by a person standing there beats evidence collected before they made it. */
  if (data.forcedOff?.[aId]?.includes(d)) return true;
  if (!(data.daysOff?.[aId] && data.daysOff[aId].includes(d))) return false;
  return !workedAnyway(data, aId, d);
}

// Points for one person on one day: one point per missed required item
// (calls, videos, RockEd), each judged independently. 0-3. Days off and days with
// no data at all score no points. RockEd is a simple "qualified" mark now: the manager
// ticks whether the person qualified in the RockEd training tool that day, rather than
// typing a star count. Legacy star counts (>= the old bar) still read as qualified.
function isQualified(data, aName, d, std) {
  const q = data.qualified?.[d]?.[norm(aName)];
  if (q === true) return true;
  if (q === false) return false;
  const stars = data.stars?.[d]?.[norm(aName)]; // legacy
  if (stars == null) return null;               // no RockEd mark at all
  return stars >= (std.rockEdStars ?? 40);
}
function dayPoints(data, a, d, std) {
  if (isOff(data, a.id, d)) return { off: true, points: 0, missed: [] };
  const rec = (data.activity?.[d] || {})[norm(a.name)] || {};
  const qual = isQualified(data, a.name, d, std);
  const hasData = rec.calls != null || rec.video != null || qual != null;
  if (!hasData) return { off: false, points: 0, missed: [], noData: true };
  const missed = [];
  if (!(rec.calls != null && rec.calls >= std.minCalls)) missed.push("calls");
  if (!(rec.video != null && rec.video >= std.minVideos)) missed.push("videos");
  if (qual !== true) missed.push("rocked");
  return { off: false, points: missed.length, missed, noData: false };
}
// A person's current streak, read from their recent working days that have data.
// Positive: consecutive days meeting ALL three (0 points). Negative: consecutive days
// missing ALL three (3 points). Days off and no-data days are skipped, not broken on.
// Returns { dir: "up"|"down"|null, len }.
function currentStreak(data, a, std) {
  const days = Object.keys(data.activity || {}).sort().reverse(); // most recent first
  let dir = null, len = 0;
  for (const d of days) {
    if (isOff(data, a.id, d)) continue;
    const dp = dayPoints(data, a, d, std);
    if (dp.noData) continue;
    const perfect = dp.points === 0;
    const zero = dp.points === 3;
    if (!perfect && !zero) break;           // a mixed day ends any streak
    const thisDir = perfect ? "up" : "down";
    if (dir === null) { dir = thisDir; len = 1; }
    else if (dir === thisDir) len++;
    else break;
  }
  return { dir, len };
}
/* ============================================================================
   Dot-matrix icon system. Every icon is a 9x9 grid of dots (lit only), drawn
   with currentColor so it inherits text color and scales via CSS. This is the
   salesperson dot-matrix language carried across the whole app.
   ========================================================================= */
/* One grid. Every mark in the app is 5x5 — 25 cells — and there is no second
   table to disagree with this one.

   There used to be two, a 9x9 and a 5x5, with six marks defined at both. A mark
   drawn two ways reads as two different marks, and the mismatch is noticeable
   without being nameable, so PixIcon grew a rule about which grid won for which
   glyph. The rule is gone because the choice is gone.

   Four things fell out of drawing the whole set at once, none of which the old
   table enforced:
     - the four arrows are ONE shape at four rotations, computed rather than
       drawn, so they cannot drift apart
     - nothing collides: no two glyphs share a bit pattern
     - the seven pairs that sit within two cells were each rendered and looked
       at, because counting cells finds collisions and nothing else. An arrowhead
       against a flat bar is two cells and unmistakable; a blob with a hole in it
       counted as perfectly distinct and read as neither a flame nor a gear.
     - `plus` is unused today and is two cells from all four arrows. If it comes
       into use, it must not sit beside one.

   Some marks stopped being pictures at this size — handshake, users, car and
   phone are shapes now, and the label beside them carries the meaning. That was
   the deliberate trade for having one grid. */
const PIX = {
  check:     ["0000000","0000001","0000011","1000110","1101100","0111000","0010000"],
  close:     ["1000001","0100010","0010100","0001000","0010100","0100010","1000001"],
  warn:      ["0001000","0001000","0011100","0011100","0111110","0111110","1111111"],
  triup:     ["0000000","0001000","0011100","0111110","1111111","0000000","0000000"],
  tridown:   ["0000000","0000000","1111111","0111110","0011100","0001000","0000000"],
  dot:       ["0000000","0000000","0011100","0011100","0011100","0000000","0000000"],
  more:      ["0000000","0000000","0000000","1101011","0000000","0000000","0000000"],
  question:  ["0011100","0100010","0000010","0000100","0001000","0000000","0001000"],
  plus:      ["0001000","0001000","0001000","1111111","0001000","0001000","0001000"],
  minus:     ["0000000","0000000","0000000","1111111","0000000","0000000","0000000"],
  arrowup:   ["0001000","0011100","0101010","1001001","0001000","0001000","0001000"],
  arrowdown: ["0001000","0001000","0001000","1001001","0101010","0011100","0001000"],
  arrow:     ["0001000","0000100","0000010","1111111","0000010","0000100","0001000"],
  arrowleft: ["0001000","0010000","0100000","1111111","0100000","0010000","0001000"],
  chart:     ["0000001","0000001","0000101","0000101","0010101","1010101","1010101"],
  doc:       ["1111100","1000110","1000111","1000001","1000001","1000001","1111111"],
  door:      ["1111111","1000001","1000001","1000011","1000011","1000001","1000001"],
  clock:     ["0111110","1000001","1001001","1001111","1000001","1000001","0111110"],
  tap:       ["0001000","0010100","0100010","1000001","0100010","0010100","0001000"],
  calendar:  ["0100010","1111111","1000001","1011101","1011101","1000001","1111111"],
  clipboard: ["0011100","1111111","1000001","1011101","1000001","1011101","1111111"],
  gear:      ["1001001","0111110","0100010","1100011","0100010","0111110","1001001"],
  user:      ["0011100","0011100","0001000","0111110","1111111","1111111","1111111"],
  users:     ["0110110","0110110","0000000","1111111","1111111","1111111","1111111"],
  globe:     ["0011100","0110110","1101011","1101011","1101011","0110110","0011100"],
  search:    ["0111000","1000100","1000100","1000100","0111110","0000011","0000001"],
  trophy:    ["1111111","1111111","1111111","0111110","0011100","0001000","0111110"],
  star:      ["0001000","0011100","1111111","1111111","0111110","0110110","1100011"],
  bolt:      ["0001110","0011100","0111000","1111111","0001110","0011100","0111000"],
  flame:     ["0001000","0011000","0011100","0111110","0110110","0111110","0011100"],
  car:       ["0000000","0011100","0111110","1111111","1111111","1111111","0110110"],
  phone:     ["0111110","0100010","0100010","0100010","0100010","0100010","0111110"],
  handshake: ["0000000","1100000","1110000","0111100","0001111","0000011","0000000"],
  lunch:     ["1010011","1010011","1110011","0100011","0100010","0100010","0100010"],
  away:      ["1111100","1000000","1000100","1000110","1011111","1000110","1000100"],
  swap:      ["0001000","0011100","0111110","0000000","0111110","0011100","0001000"],
  home:      ["0001000","0011100","0111110","1111111","0110110","0110110","0111110"],
  cup:       ["0000000","1111100","1111110","1111101","1111110","0111100","0000000"],
  walk:      ["0011000","0011000","0001000","0111110","0001000","0010100","0100010"],
  /* ---- one per job: the second set ---- */
  take:      ["0001000","0001100","0001100","0111100","0111110","0111110","0011100"],
  nope:      ["0111110","1000011","1000101","1001001","1010001","1100001","0111110"],
  remove:    ["0011100","1111111","0100010","0101010","0101010","0101010","0111110"],
  report:    ["1111100","1000110","1000111","1011101","1000001","1011101","1111111"],
  print:     ["0011100","0010100","1111111","1000001","1111111","0010100","0011100"],
  list:      ["1011111","0000000","1011111","0000000","1011111","0000000","1011111"],
  upload:    ["0001000","0011100","0101010","0001000","0001000","1000001","1111111"],
  export:    ["1110000","1010000","1010100","1011111","1010100","1010000","1110000"],
  schedule:  ["0100010","1111111","1000001","1000001","1000101","1001001","1111111"],
  off:       ["0011110","0111000","1110000","1110000","1110000","0111000","0011110"],
  edit:      ["0000110","0001111","0011110","0111100","1111000","1110000","1100000"],
  sold:      ["0111000","1000100","1000100","0111000","0010000","0010110","0010100"],
  nudge:     ["0001000","0011100","0111110","0111110","1111111","0000000","0001000"],
  sparkle:   ["0001000","0001000","1101011","0111110","1101011","0001000","0001000"],
  handover:  ["0000100","1111110","0000100","0000000","0010000","0111111","0010000"],
  pass:      ["1001000","0100100","0010010","0001001","0010010","0100100","1001000"],
  assign:    ["0001000","0101010","0011100","0001000","1111111","0100010","0100010"],
  moveup:    ["1111111","0000000","0001000","0011100","0101010","0001000","0001000"],
  movedown:  ["0001000","0001000","0101010","0011100","0001000","0000000","1111111"],
  line:      ["0100101","1111111","0100101","0000000","1000001","1000001","1111111"],
  book:      ["1111111","1001001","1001001","1001001","1001001","1001001","1111111"],
  bar:       ["0001000","0011100","0111110","0000000","1111111","0000000","0000000"],
  copy:      ["0011111","0010001","1111101","1000101","1000111","1000100","1111100"],
  target:    ["0111110","1000001","1011101","1010101","1011101","1000001","0111110"],
  fair:      ["0001000","1111111","1001001","0101010","0101010","1110111","0011100"],
  roundup:   ["0111101","1000011","1000111","1000000","1000000","1000001","0111110"],
};


/* There is no `fine` prop any more. It chose between two grids; there is one.
   Every previous attempt to keep the two honest was a rule somebody had to
   remember, and the last one was still being got wrong — the bar drew the
   Standards tick and the Tickets warning at 9x9 while the same two marks were
   5x5 everywhere else. Deleting the choice is what finally fixes that. */
function PixIcon({ glyph, size = 20, className, style, title }) {
  const rows = PIX[glyph] || PIX.dot;
  const n = rows.length;
  const cell = size / n;
  /* 0.48 of a cell. Dots still touch, so a run of them reads as one stroke, but
     they read as dots rather than as a filled shape. 0.52 overlapped enough to
     lose the grain; below about 0.46 the solid shapes come apart at 12px — the
     phone stops closing and the person scatters. */
  const r = +(cell * 0.48).toFixed(2);
  const dots = [];
  for (let y = 0; y < n; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "1") dots.push(<circle key={y * n + x} cx={+((x + 0.5) * cell).toFixed(2)} cy={+((y + 0.5) * cell).toFixed(2)} r={r} />);
    }
  }
  return (
    <svg className={"pix" + (className ? " " + className : "")} style={style} width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="currentColor" aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}{dots}
    </svg>
  );
}







/* Somebody's days so far this month, which is the denominator under every
   average they are judged by.

   A day before they started is not a day they failed to work. Somebody hired on
   the 18th used to be measured against the whole month, so their first week read
   as three weeks of doing nothing, and the one person on the floor least able to
   argue with a screen was the one it was hardest on. Same at the other end: a
   leaver is not still missing calls in the fortnight after they went.

   Both bounds are inclusive of the day itself — you worked the day you started. */
function departedOnFor(data, a) {
  const rec = ((data && data.departed) || []).find((d) => d && a && norm(d.name) === norm(a.name));
  return rec ? rec.at : null;
}

// Per-store brand colors. `primary` drives the hero band + accents on the manager's view.
const DEFAULT_BRAND = { primary: "#2A5E9B", deep: "#1D4674", accent: "#C1D730" };



/* Holidays are set once for the whole group. They live at module scope so the
   working-day helpers can see them without every call site carrying the config
   down through four layers of props. Kept in step with the saved config below. */
let GROUP_HOLIDAYS = new Set();
function setGroupHolidays(list) {
  GROUP_HOLIDAYS = new Set((list || []).map((h) => (typeof h === "string" ? h : h.date)));
}






const DEFAULT_CONFIG = {
  stores: [
    { id: "holler-honda", name: "Holler Honda", icon: null },
    { id: "classic-honda", name: "Classic Honda", icon: null },
    { id: "holler-hyundai", name: "Holler Hyundai", icon: null },
  ],
  roles: [
    { id: "sales", name: "Sales Associate", color: "#C77800", onBoard: true, coaching: true },
    { id: "service", name: "Service to Sales", color: "#7E8B24", onBoard: true, coaching: true },
    { id: "bdc", name: "BDC Agent", color: "#A6402F", onBoard: false, coaching: false },
    { id: "manager", name: "Manager", color: "#8A7360", onBoard: false, coaching: false, tracked: false },
  ],
  standards: {},
  approvedDomains: [],
  /* Who to contact when something goes wrong, and where tickets land. Every error
     message in the app points here, so a person who hits a problem is never left
     staring at a dead end. */
  support: {
    name: "Jorge Asencio Rivera",
    role: "Digital Sales Training",
    email: "",
    phone: "",
    note: "",
  },
  registrationOpen: true,
  holidays: [],
};

/* ---------------- Logo + favicon ---------------- */

/* ---------------- The mark ----------------
   The app is Sage now, and the mark is one drawing on the same 9x9 grid the
   PixIcon glyphs are drawn on — so the identity and the app's own iconography
   come off the same ruler rather than merely sitting next to each other.

   `Logo` is kept as the name every call site already uses, and it keeps both of
   the states those call sites pass:

     animated   a slow float, which the old mark had and which costs nothing
     loading    seven dots lighting one at a time, which is the identity's own
                loading pattern rather than a spinner borrowed from elsewhere

   The colour pair is fixed and identical in every store: the store palettes
   paint identity elsewhere and the status colours are reserved, so neither ever
   touches the mark. */
function Logo({ size = 40, animated = false, loading = false, word = false, ...rest }) {
  if (loading) return <SageLoading size={size} />;
  return (
    <SageMark word={word} size={size} className={animated ? "logo-anim" : undefined} {...rest} />
  );
}

/* Seven dots, lighting one at a time, 150ms apart. The same dot the mark is made
   of, doing the one job a spinner used to do. */
function SageLoading({ size = 40 }) {
  const d = Math.max(4, Math.round(size / 7));
  return (
    <span className="sage-loading" aria-label="Loading" role="img"
      style={{ gap: Math.round(d * 0.7) + "px" }}>
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ width: d, height: d, animationDelay: i * 150 + "ms" }} />
      ))}
    </span>
  );
}


// Set at module scope, before anything paints. Reveal-on-scroll hides elements
// until they are observed, so it must only ever engage when this bundle is live.
// If the script never runs, nothing is hidden and the app renders plainly.
if (typeof document !== "undefined") document.documentElement.classList.add("js-anim");
/* Touch has no hover, so the dial / health / weakest popups would never open.
   On a touch device a tap toggles the "popped" class the CSS opens on, and a tap
   anywhere else closes whatever is open.

   Two attempts came before this and both fought the same losing battle. Each
   popup lives inside a card that sets its own z-index, and a z-index makes a
   stacking context, so an absolutely-positioned popup is sealed inside its card
   and paints behind whatever is above it. Portaling the content out to
   document.body escaped that — but it left the original still in the page, so
   two copies of the same panel showed at once, and the floating copy had to be
   positioned by hand against a card it no longer lived near.

   The answer is not to position it at all. On touch the popup opens IN FLOW,
   below whatever was tapped, pushing the page down instead of floating over it.
   There is nothing to place, nothing to clip it, and no stacking context to
   escape, because it is not overlapping anything. The hover card on a desktop
   is unchanged. */
/* Pages kept opening a little way down, and the first fix for it did not work.

   The browser restores the previous scroll offset on reload, and it does that
   as soon as it has enough document to scroll — long before this app has
   rendered anything. Setting scrollRestoration from a component effect was
   therefore always too late: AppShell does not mount until Supabase auth and
   the config have come back, by which point the restore has already happened
   and the page is sitting where it was left.

   At module scope it runs as the bundle parses, which is early enough. The
   scroll-to-top on navigation stays in the shell, where it belongs. */
if (typeof history !== "undefined" && "scrollRestoration" in history) {
  try { history.scrollRestoration = "manual"; } catch { /* older Safari */ }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const isTouch = window.matchMedia && window.matchMedia("(hover: none)").matches;
  if (isTouch) {
    document.documentElement.classList.add("is-touch");
    document.addEventListener("click", (e) => {
      const host = e.target.closest(".mdial, .hf-fix, .hero-health, .pod");
      const open = document.querySelector(".popped");
      if (open && open !== host) open.classList.remove("popped");
      if (host && host.querySelector(".mdial-pop, .hf-pop, .health-pop")) {
        e.preventDefault();
        host.classList.toggle("popped");
      }
    }, true);
  }
}


/* Fades sections in as they come into view. One-shot per element: once it has
   arrived it is left alone, so scrolling back up never re-triggers anything. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".card:not(.is-in), .reveal:not(.is-in)");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
      /* Cards that appear LATER still need marking, or they sit at opacity 0
         forever -- the moving path below has a MutationObserver for exactly
         this, and skipping it here left every late-mounted card (a settings
         panel opened on demand, a coaching card) invisible for anyone with
         reduce-motion on, which is every TV this app runs on. */
      const moQuiet = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches(".card, .reveal")) n.classList.add("is-in");
            if (n.querySelectorAll) n.querySelectorAll(".card:not(.is-in), .reveal:not(.is-in)").forEach((el) => el.classList.add("is-in"));
          }
        }
      });
      moQuiet.observe(document.body, { childList: true, subtree: true });
      return () => moQuiet.disconnect();
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });
    const watch = (root) => root.querySelectorAll(".card:not(.is-in), .reveal:not(.is-in)").forEach((el) => io.observe(el));
    watch(document);
    // A card opened by a child component's own state never re-runs this effect,
    // so it would sit at opacity 0 forever. Coaching cards did exactly that.
    // Watching the tree means anything that appears later still gets revealed.
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches(".card, .reveal")) io.observe(n);
          if (n.querySelectorAll) watch(n);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  });
}

/* The backdrop drifts against the page: scrolling drags it along at a fraction of
   the speed and it coasts to a stop rather than tracking the finger, and once the
   manager settles on a view the colours morph noticeably faster. Vars go on the
   root element so this survives the app swapping its own shell around. */
function useLivingBackground() {
  useEffect(() => {
    const root = document.documentElement;
    if (!window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { root.classList.add("bg-idle"); return; }
    let cur = 0, target = 0, raf = 0, idleT = 0;
    const settle = (ms = 700) => { clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("bg-idle"), ms); };
    /* ---- the ground drifts for a moment, then holds still ----
       On a desktop the washes, the colour field and the blobs drifted for ever
       under thirty-odd frosted surfaces, and a frosted surface re-blurs its
       backdrop on every frame anything behind it moves. Measured with no GPU
       to hide it, that was two thirds of the frame. So the drift runs while the
       page is being used, for a few seconds after a page change, and pauses
       once the manager is reading. A navigation wakes it through this hook. */
    window.__bgWake = (ms) => { root.classList.remove("bg-idle"); settle(ms || 4000); };
    const tick = () => {
      cur += (target - cur) * 0.07;                 // the lag that reads as inertia
      root.style.setProperty("--bgy", cur.toFixed(1) + "px");
      if (Math.abs(target - cur) > 0.4) raf = requestAnimationFrame(tick);
      else { cur = target; root.style.setProperty("--bgy", cur.toFixed(1) + "px"); raf = 0; }
    };
    const onScroll = () => {
      target = -(window.scrollY || 0) * 0.15;
      root.classList.remove("bg-idle");
      clearTimeout(idleT); settle();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    settle();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(idleT);
      if (raf) cancelAnimationFrame(raf);
      delete window.__bgWake;
    };
  }, []);
}

function useFavicon() {
  useEffect(() => {
    try {
      /* The favicon is declared in index.html now — an SVG, a 32px raster and the
         Apple touch icon, all generated from the same 9x9 pattern as the mark.
         This used to paint one in at runtime from an inline copy of the old logo,
         which would now overwrite the real one with a second-best version of it a
         moment after the page loaded. */
      document.title = "Sage";
      // Type system, loaded as a stylesheet link rather than an @import so it never
      // blocks first paint. Space Grotesk is the same face The Board uses on the TV.
      if (!document.getElementById("lpc-fonts")) {
        const pre = document.createElement("link");
        pre.rel = "preconnect"; pre.href = "https://fonts.gstatic.com"; pre.crossOrigin = "anonymous";
        document.head.appendChild(pre);
        const f = document.createElement("link");
        f.id = "lpc-fonts"; f.rel = "stylesheet";
        // Geist Mono rides along: the phone's caps, clocks and counts are set in
        // it, and a face that never loads falls back to a different mono on
        // every phone, which is the mismatch a salesperson notices first.
        f.href = "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap";
        document.head.appendChild(f);
      }
    } catch {}
  }, []);
}


/* ---------------- Reading the PDF reports in the browser ----------------
   The scheduled reports arrive as PDFs and the email pipeline reads them on the
   server. A manager can also drop one in here — to backfill a day that was
   missed, or to keep working when the pipeline is down.

   Only the page-to-lines step lives here, because it is the one part that
   differs: the browser loads pdf.js lazily and takes a File rather than a
   buffer. Everything downstream of it is imported from the same file the
   pipeline imports, which is the only arrangement under which the sentence this
   comment used to end with — "so the two paths can never drift apart" — is true
   rather than hopeful. */
async function extractPdfLinesInBrowser(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
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


/* ---------------- Import sanity checks ----------------
   The tool knows the shape a normal day should have, so it can catch a bad upload
   even after a manager clicks through every prompt. Two things get checked:
     1) A big swing from the numbers already on file (a re-pull that lands far from
        where the month was) — usually a wrong file in the wrong slot.
     2) The channel pecking order. Across a rooftop there are almost always more
        Internet deliveries than Phone, more Phone than Showroom, and more Showroom
        than Campaign. When that order is inverted it is very likely a mis-filed
        Delivery Summary (e.g. the Phone export dropped into the Internet slot).
   These are FLAGS, not blocks: the numbers still import, but the admin gets told. */
function channelTotals(stats) {
  const t = { internet: 0, phone: 0, showroom: 0, campaign: 0, has: {} };
  for (const s of Object.values(stats || {})) {
    for (const ch of ["internet", "phone", "showroom", "campaign"]) {
      const u = s?.[ch + "Units"];
      if (u != null) { t[ch] += u; t.has[ch] = true; }
    }
  }
  return t;
}

// Expected volume order, most to least. Used to sanity-check the channel pecking order.
const CHANNEL_ORDER = ["internet", "phone", "showroom", "campaign"];
const CHANNEL_LABEL = { internet: "Internet", phone: "Phone", showroom: "Showroom", campaign: "Campaign" };

function analyzeImport(prior, after, importedChannels) {
  const flags = [];
  // 1) Big swing on a channel that already had numbers on file.
  for (const ch of CHANNEL_ORDER) {
    if (!importedChannels.has(ch)) continue;
    if (!prior.has[ch]) continue;                 // nothing to compare against yet
    const was = prior[ch], now = after[ch];
    if (was < 5 && now < 5) continue;             // too small to be meaningful
    const drop = was > 0 && now <= was * 0.5;     // lost half or more
    const spike = was > 0 && now >= was * 2 && (now - was) >= 10; // doubled, and a real jump
    if (drop) flags.push({ level: "warn", msg: `${CHANNEL_LABEL[ch]} units fell from ${was} to ${now} versus what was already on file. If this file wasn't meant to replace it, undo this import.` });
    else if (spike) flags.push({ level: "warn", msg: `${CHANNEL_LABEL[ch]} units jumped from ${was} to ${now}. Double-check the right Source was selected before exporting.` });
  }
  // 2) Pecking order. Only judge channels that actually have numbers on file now.
  const present = CHANNEL_ORDER.filter((ch) => after.has[ch] && after[ch] > 0);
  for (let i = 0; i < present.length - 1; i++) {
    const hi = present[i], lo = present[i + 1];
    if (after[lo] > after[hi] && (after[lo] - after[hi]) >= 5) {
      flags.push({ level: "warn", msg: `${CHANNEL_LABEL[lo]} (${after[lo]}) is higher than ${CHANNEL_LABEL[hi]} (${after[hi]}). Normally ${CHANNEL_LABEL[hi]} runs higher, so this can mean two Delivery Summaries were filed under the wrong channels.` });
    }
  }
  return flags;
}






/* ===== BACKEND BLOCK: Supabase (storage + real auth) ===== */
// Set in Vercel: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Keep people signed in across reloads and across days. The cinematic
        // loading sequence is gated separately (once per calendar day); the login
        // itself persists so The Board and their session survive between visits.
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "lpc-auth",
      },
    })
  : null;

const AUTH_ENABLED = true;

/* The same bargain loadRowIfChanged strikes, for the shared rows: ask for the
   stamp, which is a few bytes, and ask for the value only when it has moved.
   These rows are published a handful of times a day and read on a timer by
   every phone and every wall board, so nearly every poll becomes the cheap
   half. "same" means nothing changed; undefined means the read failed and the
   screen should hold what it has. */
const sharedStamps = new Map();
async function loadSharedIfChanged(key, tag) {
  if (!supabase) return undefined;
  const k = tag || key;
  try {
    const { data: s, error: e1 } = await supabase.from("app_data").select("updated_at").eq("key", key).maybeSingle();
    if (e1) throw e1;
    const stamp = s ? (s.updated_at || "none") : "missing";
    if (sharedStamps.has(k) && sharedStamps.get(k) === stamp) return "same";
    const { data, error } = await supabase.from("app_data").select("value,updated_at").eq("key", key).maybeSingle();
    if (error) throw error;
    sharedStamps.set(k, data ? (data.updated_at || "none") : "missing");
    return data ? data.value : null;
  } catch (e) { console.error("poll", key, e); return undefined; }
}
/* ---- the phone's memory of the last answer ----
   A dealership lot is not a place with signal. The app used to know nothing
   until the network answered, though it knew everything a minute ago: the
   store's setup, who is signed in, the line as it stood. Each of those is
   now kept on the phone after a good read and handed back when a read fails
   or takes too long, with the time it was true, so the app opens to the
   last thing it knew rather than to a pulsing mark. Nothing is ever WRITTEN
   from a remembered answer: the read that failed is retried, and the memory
   only fills the screen in the meantime. */
const CACHE_NS = "lpc:cache:";
function cacheGet(k) {
  try { const v = localStorage.getItem(CACHE_NS + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function cachePut(k, value) {
  try { localStorage.setItem(CACHE_NS + k, JSON.stringify({ at: Date.now(), value })); } catch (e) { /* full or blocked: no memory, no harm */ }
}
function cacheDel(k) { try { localStorage.removeItem(CACHE_NS + k); } catch (e) {} }
/* A read that takes longer than this is treated as failed: the memory fills
   in, the read carries on, and whichever answers first is what is shown. */
const SLOW_MS = 5000;
/* Once one read has failed, the next are given only a moment: the auth client
   retries its own refresh with backoff and every read waits behind that lock,
   so without this the profile, the setup, the link and the line each took
   their full turn and the screen arrived half a minute later. The reads still
   go out, and the first that gets through turns the wait back up. */
const QUICK_MS = 1500;
function withTimeout(promise, ms) {
  if (ms == null) ms = netState.offline ? QUICK_MS : SLOW_MS;
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ timedOut: true }); } }, ms);
    Promise.resolve(promise).then(
      (value) => { if (!done) { done = true; clearTimeout(t); resolve({ value }); } },
      (error) => { if (!done) { done = true; clearTimeout(t); resolve({ error }); } });
  });
}
/* What the phone knows about its connection, from the reads that matter: off
   after a failed one, on again after the next that works, with the stamp of
   the memory on screen so the person knows how old it is. */
const netState = { offline: false, asOf: null };
function netSet(offline, asOf) {
  const was = netState.offline;
  netState.offline = offline;
  netState.asOf = offline ? (asOf || netState.asOf) : null;
  if (was !== offline || offline) { try { window.dispatchEvent(new CustomEvent("lpc:net")); } catch (e) {} }
}
function useNet() {
  const [st, setSt] = useState({ ...netState });
  useEffect(() => {
    const on = () => setSt({ ...netState });
    window.addEventListener("lpc:net", on);
    return () => window.removeEventListener("lpc:net", on);
  }, []);
  return st;
}
/* The shared rows worth remembering: the store's setup and its public slice.
   The rest are either large or somebody else's numbers, and a memory of those
   would cost more than it saves. */
const REMEMBERED_SHARED = new Set(["lpc:config:v2", "lpc:board:stores:v1"]);
async function loadShared(key, fallback, throwOnError) {
  if (!supabase) return fallback;
  try {
    const read = supabase.from("app_data").select("value").eq("key", key).maybeSingle();
    const r = REMEMBERED_SHARED.has(key) ? await withTimeout(read) : { value: await read };
    if (r.timedOut) throw new Error("timed out");
    if (r.error) throw r.error;
    const { data, error } = r.value;
    if (error) throw error;
    if (REMEMBERED_SHARED.has(key) && data) cachePut("shared:" + key, data.value);
    return data ? data.value : fallback;
  } catch (e) {
    console.error("load failed", key, e);
    if (REMEMBERED_SHARED.has(key)) { const c = cacheGet("shared:" + key); if (c) return c.value; }
    if (throwOnError) throw e; return fallback;
  }
}
/* =======================================================================
   SPLIT STORAGE
   =======================================================================
   One row per store meant every save rewrote everything, so an hourly import and a
   manager editing a goal fought over the same document. Revision checking stopped
   that being silent, but the contention is still there, and at a hundred people it
   is constant.

   Activity now lives one row per day. An import writing today cannot collide with
   anyone editing anything else, because they are no longer the same row.

   The split is confined to this layer on purpose. loadStore puts the object back
   together in exactly the shape the app already expects, so every `data.activity[day]`
   in the rest of the file keeps working untouched. Nothing above here knows.

   Rolling out in stages, each independently reversible:
     - reads take split rows when they exist and fall back to the embedded copy
     - writes go to both places for now, so an older tab still works
     - the embedded copy is dropped only once every store has moved
   ======================================================================= */

/* A salesperson on a sign-in page has no account, and the store rows are gated on
   having one. So their own numbers were unreadable to them: the query returned
   nothing and the panel simply stayed empty.

   The board keys are the one thing already readable without signing in, so today's
   figures get a slim copy under that prefix. It carries counts only, for the people
   on the floor, for one day. No goals, no money, nothing that is not already on the
   wall in front of them. */

// Only recent days are worth splitting out: they are the ones being written. Older
// days are read constantly and never change, so they stay in the main document.
const SPLIT_ACT_DAYS = 45;

function recentDays(n) {
  const out = [];
  const d = new Date(today() + "T12:00");
  for (let i = 0; i < n; i++) {
    out.push(d.toLocaleDateString("en-CA"));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/* Pull the split activity rows for a store.

   Every read of a store pulls these, and a store is re-read whenever its
   document changes, which on a working day is often. But the rows are one per
   day and only today's is moving: re-fetching six weeks of them to learn that
   yesterday is still yesterday is most of what a manager's app costs. So the
   stamps come first and only the days that moved are fetched; the rest are
   answered from what this browser already read. */
const actCache = new Map();     // storeId -> { key: { s: stamp, v: value } }
async function loadActivityRows(storeId) {
  if (!supabase) return {};
  const prefix = `lpc:store:${storeId}:act:`;
  const { data: stamps, error: e1 } = await supabase.from("app_data")
    .select("key,updated_at").like("key", prefix + "%");
  if (e1) throw e1;
  const seen = actCache.get(storeId) || {};
  const stampOf = {};
  for (const r of stamps || []) stampOf[r.key] = r.updated_at || "none";
  const keys = Object.keys(stampOf);
  const need = keys.filter((k) => !seen[k] || seen[k].s !== stampOf[k]);
  if (need.length) {
    const { data: fresh, error: e2 } = await supabase.from("app_data")
      .select("key,value").in("key", need);
    if (e2) throw e2;
    for (const r of fresh || []) seen[r.key] = { s: stampOf[r.key], v: r.value };
  }
  // A day whose row has gone must not be answered from memory.
  for (const k of Object.keys(seen)) if (!stampOf[k]) delete seen[k];
  actCache.set(storeId, seen);
  const out = {};
  for (const k of keys) {
    const day = k.slice(prefix.length);
    const v = (seen[k] || {}).v;
    if (day && v) out[day] = v;
  }
  return out;
}

/* Read a store as one object. Split rows win over the embedded copy for any day
   they cover, because they are the ones being kept current. */
async function loadStore(storeId, fallback, throwOnError) {
  const base = await loadShared(storeKey(storeId), fallback, throwOnError);
  if (!base || typeof base !== "object") return base;
  try {
    const rows = await loadActivityRows(storeId);
    if (Object.keys(rows).length) {
      base.activity = { ...(base.activity || {}), ...rows };
      base.__splitDays = Object.keys(rows);
    }
  } catch (e) {
    // A failure here must not cost the whole store: the embedded copy still has
    // the day, it is simply older. Losing the store outright would be worse.
    console.error("split activity load failed", storeId, e);
  }
  return base;
}

/* Write the days this save actually changed, each to its own row. Days nobody
   touched are not written at all, which is the entire point. */
async function saveActivityDays(storeId, next, prev) {
  if (!supabase) return { written: 0, failed: [] };
  const keep = new Set(recentDays(SPLIT_ACT_DAYS));
  /* A day that already HAS a row of its own has to keep being written to it,
     however old it is. Rows are read back whatever their age and they win over
     the embedded copy, so a correction to an older day would be saved into the
     document, overlaid by the stale row on the next read, and appear to undo
     itself a few seconds later. Only the last 45 days may gain a NEW row; days
     that already have one are maintained for as long as they exist. */
  const split = new Set(next.__splitDays || []);
  const cur = next.activity || {};
  const before = (prev && prev.activity) || {};
  const changed = [];
  for (const day of Object.keys(cur)) {
    if (!keep.has(day) && !split.has(day)) continue;
    if (JSON.stringify(cur[day]) === JSON.stringify(before[day])) continue;
    changed.push(day);
  }
  if (!changed.length) return { written: 0, failed: [] };
  const rows = changed.map((day) => ({ key: actKey(storeId, day), value: cur[day] }));
  const { error } = await supabase.from("app_data").upsert(rows, { onConflict: "key" });
  if (error) {
    console.error("split activity save failed", storeId, error);
    return { written: 0, failed: changed };
  }
  return { written: changed.length, failed: [] };
}






// The plate log is worked by several managers at once, so it has to be re-read
// often. Pulling the whole store blob on a timer would be brutal, so this asks the
// database for the two plate fields and nothing else.
// When the row was last written, without pulling the row itself down. The store blob
// is far too big to poll, but one timestamp is nothing.
async function loadStoreStamp(key) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("app_data").select("updated_at").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? data.updated_at : null;
}

let lastSaveError = null;
async function saveShared(key, value) {
  if (!supabase) { lastSaveError = "No database client"; return false; }
  try {
    const { error } = await supabase.from("app_data").upsert({ key, value }, { onConflict: "key" });
    if (error) throw error;
    lastSaveError = null;
    return true;
  } catch (e) {
    console.error("save failed", key, e);
    lastSaveError = (e && (e.message || e.error_description || e.hint || e.details || e.code)) || String(e);
    return false;
  }
}

/* ---- Saving a store safely with many people on it ----
   Every save rewrites the whole store document, so two people saving within a
   second of each other means the second one silently erases the first. With a
   handful of managers that was rare enough to look like bad luck. With a hundred
   it is constant, and it is invisible: nobody gets an error, the work simply is
   not there later.

   So a store row now carries a revision number, and a save only lands if the row
   is still on the revision it was read from. If somebody got there first the write
   is refused rather than applied, and we start again from their copy: re-read,
   re-run the same field merges against the newer document, bump, retry. The merge
   is what makes a retry correct rather than just another race.

   Returns { ok, rev, conflictsResolved } so a caller can tell a genuine failure
   from a save that simply took two goes. */
/* The last server copy this browser saw for a key, with its revision. A save
   needs the server copy to merge against, and it used to download the whole
   document to get it, every save, on every browser. Most saves follow a save
   from the same browser and nothing else has written in between: the revision
   says so in a few bytes, and the copy we already hold is the server's. */
const casCache = new Map();
async function saveStoreCAS(key, build, tries = 8) {
  if (!supabase) { lastSaveError = "No database client"; return { ok: false, rev: null }; }
  let conflicts = 0;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      let server;
      const cached = casCache.get(key);
      if (cached) {
        const { data: r, error: e0 } = await supabase.from("app_data").select("rev:value->>rev").eq("key", key).maybeSingle();
        if (e0) throw e0;
        if (r && String(r.rev ?? "") === String(cached.rev ?? "")) server = cached.value;
      }
      if (server === undefined) {
        const { data: row, error: readErr } = await supabase
          .from("app_data").select("value").eq("key", key).maybeSingle();
        if (readErr) throw readErr;
        server = row ? row.value : null;
        if (server) casCache.set(key, { rev: server.rev ?? null, value: server });
      }
      const rev = (server && Number(server.rev)) || 0;
      const value = { ...build(server), rev: rev + 1 };

      if (!server) {
        // First write for this store. insert, not upsert, so two browsers racing to
        // create it cannot both believe they won.
        const { error } = await supabase.from("app_data").insert({ key, value });
        if (error) {
          if (String(error.code) === "23505") { conflicts++; continue; }   // someone beat us
          throw error;
        }
        lastSaveError = null;
        casCache.set(key, { rev: value.rev, value });
        return { ok: true, rev: value.rev, value, conflictsResolved: conflicts };
      }

      /* Only replace the row if it is still the revision we just read.

         A row written before revisions existed has no rev at all, and in SQL a
         missing value equals nothing, not even itself. Matching on rev = '0' can
         therefore never succeed on those rows, which is every row that predates
         this change. The first save on such a row has to match on rev being
         absent instead; after that it carries one like everything else. */
      let q = supabase.from("app_data").update({ value }).eq("key", key);
      q = (server.rev == null) ? q.is("value->>rev", null) : q.eq("value->>rev", String(rev));
      const { data: hit, error } = await q.select("key");
      if (error) throw error;
      if (hit && hit.length) {
        lastSaveError = null;
        casCache.set(key, { rev: value.rev, value });
        return { ok: true, rev: value.rev, value, conflictsResolved: conflicts };
      }
      // Somebody saved in between. Their work stands; go again from their copy.
      casCache.delete(key);
      conflicts++;
      await new Promise((r) => setTimeout(r, 90 * (attempt + 1) + Math.random() * 120));
    } catch (e) {
      console.error("save failed", key, e);
      lastSaveError = (e && (e.message || e.error_description || e.hint || e.details || e.code)) || String(e);
      return { ok: false, rev: null, conflictsResolved: conflicts };
    }
  }
  lastSaveError = `Could not save after ${tries} attempts. Someone else may be saving this store at the same moment, or the row is being rejected by a database rule. Nothing was overwritten.`;
  console.error("save gave up after conflicts", key);
  return { ok: false, rev: null, conflictsResolved: conflicts };
}

/* The merge that settles this browser's copy against the server's now lives in
   api/_store-merge.mjs, next to the readers and the key list, and for the same
   reason: it is written by more than one place and it could not be tested while
   it sat in here. See the note at the top of that file for the rule every one of
   its fields has to declare. */

// ---- auth ----
// Passwords live in Supabase Auth (hashed). This app never sees them.
// The `profiles` row carries role + store access, and only an admin can change it.
async function authGetProfile() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  /* A read that failed is not "nobody is signed in". Said as an error, so
     the boot can fall back on what the phone remembers about this account
     rather than showing a signed-in person the sign-in screen. */
  if (error) throw error;
  if (!data) return null;
  /* The claim (which store, which name on its roster) lives in the account's
     own metadata rather than the profile row, so it needs no database change
     and only the person and a manager can ever see it. */
  const m = (session.user && session.user.user_metadata) || {};
  const claim = m.claim_store ? { store: m.claim_store, person: m.claim_person || null, name: m.claim_name || "", at: m.claim_at || null } : null;
  return { ...data, claim, wants: data.wants || m.wants || null };
}
/* "I am this name at this store." Written by the person themselves; nothing
   acts on it until a manager taps Join. */
const claimMeta = (claim) => claim && claim.store
  ? { claim_store: claim.store, claim_person: claim.person || "", claim_name: claim.name || "", claim_at: new Date().toISOString() }
  : {};
async function authClaimName(claim) {
  if (!supabase) return { error: "No database connection" };
  const { error } = await supabase.auth.updateUser({ data: claimMeta(claim) });
  return { error: error ? error.message : null };
}
async function authSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? error.message : null };
}
/* Two kinds of person sign up here and they need opposite things. A manager
   needs a store to look at, which only an admin can grant. A salesperson needs
   no store at all - they need their account joined to their name on the roster,
   which happens on the floor. Asking which at sign-up is the difference between
   an admin guessing and an admin knowing.

   The answer rides in the account's own metadata, which needs nothing added to
   the database to work. If the profiles trigger is taught to copy it across
   (see supabase-account-kind.sql), the admin sees it on the approval row too. */
const ACCOUNT_KINDS = {
  associate: { label: "Salesperson", sub: "You take ups, calls and leads" },
  manager: { label: "Manager", sub: "You watch the floor and the numbers" },
};
async function authSignUp(email, password, name, kind, claim = null) {
  const { error } = await supabase.auth.signUp({
    email, password, options: { data: { name, wants: kind || "associate", ...claimMeta(claim) } },
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
/* ---- the link between an account and a person on the floor ----
   Reads and writes both go through /api/link-person, which reads the caller's
   own role server-side. floor_people lets a salesperson read their own row and
   nothing else on purpose: a table a browser can list is a table that tells
   anybody who signs in exactly whose phone to aim at. */
async function apiCall(path, { method = "GET", body = null } = {}) {
  const t = await getTokens();
  if (!t) return { error: "You are not signed in." };
  try {
    const r = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${t.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    /* Read it as text first. A function that THREW rather than returning does not
       reply with JSON at all — the platform sends its own error page — and parsing
       that away left the browser with nothing but a status code to show. "That
       failed (500)." is what a manager saw for every distinct cause there is.

       So the body is kept: put in the console whole, and the first line of it
       shown when the server had nothing better to say. */
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
    if (!r.ok) {
      if (!json.error && !json.message) console.error("apiCall", path, r.status, text);
      const raw = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      return { error: json.error || json.message
        || (raw ? `That failed (${r.status}). ${raw}` : `That failed (${r.status}).`) };
    }
    return json;
  } catch (e) {
    return { error: "The server could not be reached." };
  }
}
/* The person YOU are on this store's floor.

   floor_people lets somebody read their own row and nobody else's, so this needs
   no endpoint and no manager: the signed-in salesperson asks the database who
   they are and the policy answers for exactly one row. */
async function myFloorPerson(store) {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase.from("floor_people")
      .select("person_id").eq("store", store).eq("user_id", session.user.id).maybeSingle();
    if (error) throw error;
    return data ? data.person_id : null;
  } catch (e) { console.error("myFloorPerson", e); return null; }
}

/* Every store this account is somebody at. Same policy, same one-row-per-store
   answer; this is the account door asking "where is home?" before it knows a
   store to ask about. */
async function myFloorLinks() {
  if (!supabase) return [];
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase.from("floor_people")
      .select("store, person_id").eq("user_id", session.user.id);
    if (error) throw error;
    return data || [];
  } catch (e) {
    /* Not "nobody has linked this account": a read that failed. Thrown, so
       the door can stand on what the phone remembers rather than sending a
       linked salesperson to the waiting screen because the lot has no signal. */
    console.error("myFloorLinks", e); throw e;
  }
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


/* ===== END BACKEND BLOCK ===== */

// Stamped automatically at build time by vite.config.js, so every deploy
// carries its own version without anyone remembering to bump a number.
const APP_VERSION = (typeof __APP_VERSION__ !== "undefined") ? __APP_VERSION__ : "preview";

/* ---- Backup keys ----
   A backup used to be one row holding every store at once, which meant no rule
   could ever be written for it: there is no single store to check access against.
   That is why every write was refused. It is now split. Each store's copy lives
   under its own id, so it is gated by exactly the same store-access rule as the
   live data, and the config and audit log ride along in a config row, which every
   signed-in user may already read. */
const BACKUP_INDEX_KEY = "lpc:config:backups-index:v1";
const backupStoreKey = (storeId, id) => `lpc:backup:${storeId}:${id}:v1`;
const backupMetaKey = (id) => `lpc:config:backup:${id}:v1`;



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
  const storeIds = Object.keys(stores);
  const exportedAt = new Date().toISOString();

  // Each store first. If any one of them cannot be written the backup is incomplete,
  // and an incomplete backup that looks complete is worse than none at all.
  for (const sid of storeIds) {
    const ok = await saveShared(backupStoreKey(sid, id), stores[sid]);
    if (!ok) {
      console.error("backup failed for store", sid, lastSaveError);
      for (const done of storeIds) await saveShared(backupStoreKey(done, id), null);
      return index;
    }
  }
  const meta = {
    app: "lead-performance-calculator",
    version: 2,
    exportedAt,
    auto: true,
    by: byName || "auto",
    config,
    storeIds,
    audit: await loadShared(AUDIT_KEY, []),
  };
  const okMeta = await saveShared(backupMetaKey(id), meta);
  if (!okMeta) {
    console.error("backup meta failed", lastSaveError);
    for (const sid of storeIds) await saveShared(backupStoreKey(sid, id), null);
    return index;
  }

  const next = [{ id, t: exportedAt, stores: storeIds.length, storeIds, auto: true }, ...index];
  const keep = next.slice(0, KEEP_BACKUPS);
  // free the space used by anything that fell off the end
  for (const old of next.slice(KEEP_BACKUPS)) {
    for (const sid of (old.storeIds || [])) await saveShared(backupStoreKey(sid, old.id), null);
    await saveShared(backupMetaKey(old.id), null);
  }
  await saveShared(BACKUP_INDEX_KEY, keep);
  return keep;
}

const emptyStoreData = () => ({ roster: [], months: {} });

/* What a store document looks like from the outside, for a screen that has to
   report on one it is refusing to open. Names are the only part that identifies
   whose data this really is, so only a handful are taken and the caller decides
   who may see them. */
function describeDoc(d) {
  if (!d || typeof d !== "object") return null;
  const months = Object.keys(d.months || {}).sort();
  return {
    roster: (d.roster || []).length,
    names: (d.roster || []).slice(0, 5).map((a) => a && a.name).filter(Boolean),
    months: months.length,
    firstMonth: months[0] || "",
    lastMonth: months[months.length - 1] || "",
    days: Object.keys(d.activity || {}).length,
    plates: (d.plateRegistry || []).length,
  };
}

/* ---- People who have left ----
   Taking someone off the roster was never enough on its own: the next report still
   carried their name and the import put them straight back. Someone who has left is
   recorded here instead, which lifts them off every current list AND tells the
   importer to leave them alone. Their history stays exactly where it is, and the
   whole thing is reversible if they come back or it was done by mistake. */
const departedNames = (d) => new Set((((d && d.departed) || [])).map((x) => norm(x.name)));


async function appendAudit(entry) {
  const log = await loadShared(AUDIT_KEY, []);
  log.unshift({ t: new Date().toISOString(), ...entry });
  await saveShared(AUDIT_KEY, log.slice(0, 400));
}


/* ============================================================ */

export default function LeadPerformanceCalculator() {
  useFavicon();
  useReveal();
  useLivingBackground();
  const [config, setConfig] = useState(null);
  // Set during render rather than in an effect: children read the holiday set as
  // they render, and an effect would land a beat too late on the first pass.
  setGroupHolidays(config?.holidays);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  /* ---- the account door ----
     A salesperson's account is linked to their name on a floor by a manager,
     and from then on the link is the identity: signing in lands them on their
     own corner, today, with no daily code. undefined = not asked yet; [] = asked
     and nobody has linked this account, so the waiting screen is the truth. */
  const [floorLinks, setFloorLinks] = useState(undefined);
  /* The boot could not get through and nothing is remembered: said, with a retry. */
  const [bootStall, setBootStall] = useState(false);
  const [doorDay, setDoorDay] = useState(() => today());
  const wantsFloor = !!session && session.role !== "admin" && (session.pending || (session.wants || session.requested_role) === "associate");
  const [linksWave, setLinksWave] = useState(0);
  useEffect(() => {
    if (!wantsFloor) { setFloorLinks(undefined); return; }
    let dead = false;
    const ck = "links:" + (session && session.id);
    const ask = async () => {
      const r = await withTimeout(myFloorLinks());
      if (dead) return;
      if (!r.timedOut && !r.error) { setFloorLinks(r.value); cachePut(ck, r.value); return; }
      const c = cacheGet(ck);
      if (c) { setFloorLinks(c.value); netSet(true, c.at); return; }
      /* asked, no answer, nothing remembered: the same stall as the boot,
         with the same retry, rather than a curtain with no end */
      if (floorLinks === undefined) setBootStall(true);
    };
    ask();
    /* Somebody sitting on the waiting screen is waiting for exactly one thing,
       and it should not take a sign-out to notice it happened. */
    const t = setInterval(() => { if (!document.hidden) ask(); }, 30000);
    return () => { dead = true; clearInterval(t); };
  }, [wantsFloor, session && session.id, linksWave]);   // eslint-disable-line
  /* The phone stays open across midnight; the corner has to roll over with it. */
  useEffect(() => {
    if (!wantsFloor) return;
    const t = setInterval(() => { const d = today(); setDoorDay((cur) => (cur === d ? cur : d)); }, 60000);
    return () => clearInterval(t);
  }, [wantsFloor]);
  const [entered, setEntered] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  /* True while the sign-in screen is taking itself apart. See where it is read. */
  const [jumpHold, setJumpHold] = useState(false);
  /* Holds the dashboard's mount until the jump's cruise. The session lands a
     third of a second after the press, and mounting the whole app tree right
     then blocks the main thread in the middle of the ratchet — the canvas
     freezes and the most watched beat of the animation stutters. The cruise is
     the loading zone; the heavy work belongs inside it. */
  const [holdMount, setHoldMount] = useState(false);
  useEffect(() => {
    const on = (e) => { if (e.detail === "cruise" || e.detail === "off") setHoldMount(false); };
    document.addEventListener(JUMP_PHASE, on);
    return () => document.removeEventListener(JUMP_PHASE, on);
  }, []);
  /* Hides the app while the sign-in layer is over it. A LAYOUT effect, so the
     class is gone in the same commit that drops the layer — an ordinary effect
     runs after paint and would show one frame of an un-animated dashboard right
     where the landing is supposed to begin. */
  useLayoutEffect(() => {
    /* jumpLanded: once the landing has revealed the app, a session identity
       change must not hide it again. See the latch's comment. */
    const under = !session || (jumpHold && !jumpLanded);
    document.documentElement.classList.toggle("jump-under", under);
    return () => document.documentElement.classList.remove("jump-under");
  }, [session, jumpHold]);
  // True for the length of the build-in only. Set the moment a session appears, so
  // the regions animate in while the sign-in wash is still clearing over the top.
  const [entering, setEntering] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Watch the intro on demand rather than waiting for tomorrow. Clearing the mark
  // means the next sign-in plays it as well, which is what makes it possible to
  // review the whole handover end to end.
  /* Kept for the account menu, which has always had it, though with the arrival
     playing every time there is far less for it to do. */
  const replayIntro = () => {
    setIntroDone(false);
    setIntroPlaying(true);
  };
  const sawSession = useRef(false);
  useLayoutEffect(() => {
    if (!session || sawSession.current) return;
    sawSession.current = true;
    /* Unless the arrival is already doing this. See jumpOwnsEntrance: two
       entrances at once is what made the landing segmented. */
    if (jumpOwnsEntrance) return;
    /* A refresh restores the session with nobody pressing sign-in, so the jump
       never plays and the app used to fall back to the old top/bottom entrance
       (.is-entering) -- which started on the very frame React mounted the whole
       tree, so its first third was eaten by the mount and it read as choppy,
       and it never came from the centre the way the landing does. Same radial
       arrival as the jump now: the page is HELD invisible through the expensive
       mount frames, and the flight starts from the centre of the screen only
       once two clean frames have painted. A layout effect, not an effect,
       because the hold has to be on before the first paint. */
    let reduce = false;
    try { reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    if (reduce) return;
    const root = document.documentElement;
    root.classList.add("refresh-hold");
    let undo = () => {}, raf = 0, doneT = 0, tries = 0;
    const clear = () => root.classList.remove("sage-assemble", "refresh-hold");
    const fly = (n) => {
      /* Two spare frames between "the dashboard exists" and "it flies": the
         board mounts one frame late (see Late) and the flight must not start
         mid-mount, or its first beats drop and it reads as the old chop. */
      if (n > 0) { raf = requestAnimationFrame(() => fly(n - 1)); return; }
      root.classList.add("sage-assemble");
      undo = radialAssemble();
      root.classList.remove("refresh-hold");
      /* The beat. The sign-in landing has the flash of the jump to announce it;
         a refresh has nothing, and a flight with no impact reads as cards
         drifting in. One bloom out of the same centre the parts fly from. */
      try {
        const flash = document.createElement("div");
        flash.className = "refresh-flash";
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 750);
      } catch (e) {}
      doneT = setTimeout(() => { undo(); undo = () => {}; clear(); }, 1500);
    };
    const wait = () => {
      /* The session lands long before the store's data does on a real network,
         so the first thing on screen is the loading view, which has none of the
         flying parts in it -- holding through it costs nothing to look at. The
         old three-second give-up was shorter than a real cold load, which is
         why the arrival played in the harness and never at the desk: the hold
         cleared while the spinner was still up and the dashboard then walked
         on plain. Wait as long as the load takes, within reason. */
      if (document.querySelector(".hero, .card, .bp-hero, .fr-page")) { fly(2); return; }
      if (++tries > 1800) { clear(); return; }
      raf = requestAnimationFrame(wait);
    };
    wait();
    return () => { cancelAnimationFrame(raf); clearTimeout(doneT); undo(); clear(); };
  }, [session]);
  // The cinematic intro plays once per calendar day per user. null = not decided yet.
  const [introDone, setIntroDone] = useState(false);
  const [appModule, setAppModule] = useState("perf");
  /* Opens on the store this browser last worked in; see rememberView. Starting
     from "admin" here and correcting it a moment later would show the overview
     for a frame on every load. */
  const [view, setViewRaw] = useState(() => lastView() || "admin");
  const setView = useCallback((v) => {
    setViewRaw(v);
    rememberView(typeof v === "string" ? v : null);
  }, []);
  const [storeData, setStoreData] = useState(null);
  // What the server row said when this browser last read it. The email ingest writes
  // straight to the database, so without this an open tab keeps showing the tool as
  // it was when the store was opened and the auto-imports look like they never ran.
  const storeStampRef = useRef(null);
  const savingRef = useRef(false);
  const [storeLoadFailed, setStoreLoadFailed] = useState(false);
  /* The words the failure itself used. A screen that says "not loading" sends
     somebody reloading at a problem a reload cannot touch; the message the load
     actually raised is the one thing that tells them, or whoever they ask, what
     went wrong. */
  const [storeLoadError, setStoreLoadError] = useState("");
  const [storeMismatch, setStoreMismatch] = useState(null);
  const [adminData, setAdminData] = useState({});
  const [tab, setTab] = useState("board");
  useEffect(() => { try { window.__bgWake && window.__bgWake(4000); } catch (e) {} }, [tab, appModule]);
  // drawerOpen now lives in AppShell, which is the only thing that opens it.
  const [adminTab, setAdminTab] = useState("overview");
  const [dropActive, setDropActive] = useState(false);
  const [importLog, setImportLog] = useState([]);
  const [pendingChannels, setPendingChannels] = useState(null); // { ambiguous:[{rows,fileName}], ready:[] }
  const [wrongReport, setWrongReport] = useState(null); // { fileName } — wrong export pulled; show stop screen
  const [showHelp, setShowHelp] = useState(false); // Delivery Summary walkthrough, opened from the Help button
  const [importFlags, setImportFlags] = useState([]); // [{level,msg}] discrepancy warnings from the last import
  // The landing view is decided once when you sign in. Re-deciding it every time the
  // config saved was throwing you out of the store you were working in: editing a
  // standard at Driver's Mart wrote the config, the effect re-ran, reset the view to
  // "All Stores", and the activity guard then bounced you to the first store.
  const viewPicked = useRef(false);
  // which slice of the board is showing. Driven by the hero tiles.
  const [boardFilter, setBoardFilter] = useState(null); // null | cleared | attention | off | unassigned
  const [assocQuery, setAssocQuery] = useState("");
  const [focusAssoc, setFocusAssoc] = useState(null);
  const phone = usePhoneLayout();
  /* Coach, from a person's pop on the phone: the tool switch lands on the
     check-out sheet by default, so the tab to land on is held for applyTool. */
  const coachAfter = useRef(false);
  // Which day a Daily Activity import should land on. Reports are often pulled the
  // next morning, so the manager can aim an import at yesterday without renaming files.
  const [activityDay, setActivityDay] = useState(today());
  // Whether the dropped Daily Activity file is one day's numbers or a whole month's
  // cumulative pull. A month file is not a day and must never be filed as one.
  const [activityScope, setActivityScope] = useState("day");
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const fileRef = useRef(null);

  // Who is signed in? Preview returns a stand-in admin; the hosted site
  // reads the real Supabase session and its matching profile row.
  const refreshProfile = useCallback(async () => {
    const r = await withTimeout(authGetProfile());
    if (!r.timedOut && !r.error) {
      setSession(r.value);
      if (r.value) cachePut("profile", r.value); else cacheDel("profile");
      setAuthReady(true);
      return;
    }
    /* Slow or dead: the account the phone remembers, as of when it last
       answered. Without one, nothing to show but the truth and a retry. */
    const c = cacheGet("profile");
    if (c && c.value) { setSession(c.value); netSet(true, c.at); setAuthReady(true); return; }
    setBootStall(true);
  }, []);

  // Sign-in drops straight into the Performance dashboard. On the first sign-in of
  // a calendar day the cinematic intro plays as an OVERLAY on top of the already
  // loaded app and then dissolves away, rather than the app replacing it outright.
  // Swapping one full screen for another was the hard cut; a curtain lifting is not.
  useEffect(() => {
    if (!session || !session.active || entered) return;
    /* Straight away, in the same commit that lets the app in. The 240ms wait
       here was inherited from the cinematic that used to follow the sign-in
       handover, and against the arrival it is exactly the wrong shape: the app
       painted, the store started loading, and a quarter of a second later a
       full-screen animation dropped over the top of it. The arrival is not
       something that happens after the app loads, it is the thing the loading
       happens behind.

       And the arrival is NOT started from here. The session now lands in the
       middle of the jump — about 250ms in, while the mark is still gathering —
       because the dashboard is mounted under the streaks rather than after them.
       Setting introPlaying here mounted SageArrival at that moment and ran the
       whole landing on a dashboard nobody could see, a second before the streaks
       had finished. The jump hands over on its own clock; see landDashboard.

       The flag is still consumed, because a page RELOAD restores a session with
       no sign-in screen anywhere and must not be treated as an arrival. */
    signInPressed = false;
    setAppModule("perf");
    setEntered(true);
  }, [session, entered]);

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

  /* ---- the config a signed-out boot sees is not to be trusted ----
     Row-level security hides app_data from an unauthenticated read, and a hidden
     row is indistinguishable from a missing one: the boot concluded "brand new
     install" and ran the whole session on DEFAULT_CONFIG. That is why a fresh
     sign-in landed on a hero wearing the standard blue and the Sage logo, and a
     refresh — which boots with the session already in hand — wore the store's
     own. So a config adopted while signed out is marked provisional and fetched
     again the moment a session exists; the cruise absorbs the re-read the same
     way it absorbs everything else. */
  const cfgProvisional = useRef(false);
  const [cfgWave, setCfgWave] = useState(0);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  useEffect(() => {
    if (!session || !cfgProvisional.current) return;
    cfgProvisional.current = false;
    setCfgWave((w) => w + 1);
  }, [session]);
  useEffect(() => {
    (async () => {
      // Strict read. If this FAILS we must not proceed: a failed read used to look
      // identical to "no config yet", and the app would helpfully write DEFAULT_CONFIG
      // straight over the real one, wiping every store. Bail out and say so instead.
      const got = await withTimeout(loadStrict(CONFIG_KEY));
      const res = got.value || { ok: false };
      if (!res.ok) {
        /* Could not be read, or not in time. The setup the phone remembers
           stands in, unchanged and unsaved, until a read gets through; with
           nothing remembered the boot says so and offers to try again. */
        const c = cacheGet("shared:" + CONFIG_KEY);
        if (c && c.value) { netSet(true, c.at); setConfig(c.value); return; }
        setBootStall(true); return;
      }
      netSet(false);

      let cfg = res.value;

      if (cfg) {
        cachePut("shared:" + CONFIG_KEY, cfg);
        let dirty = false;
        /* The positions wear the site's own warm palette now. Only the colours
           nobody chose are rewritten — the seeded defaults and the old ramp — so
           a store that picked its own is left exactly as it set it. */
        for (const r of cfg.roles || []) {
          const warm = ROLE_COLOR_WARM[String(r.color || "").toUpperCase()];
          if (warm && warm !== r.color) { r.color = warm; dirty = true; }
        }
        if (cfg.approvedDomains === undefined) { cfg.approvedDomains = []; dirty = true; }
        if (cfg.holidays === undefined) { cfg.holidays = []; dirty = true; }
        // which roles appear on The Board. BDC agents don't sell units, so they're off.
        for (const r of cfg.roles || []) {
          if (r.onBoard === undefined) { r.onBoard = r.id !== "bdc"; dirty = true; }
          // coaching is built on cars sold, so it does not apply to BDC by default
          if (r.coaching === undefined) { r.coaching = r.id !== "bdc"; dirty = true; }
        }
        if (cfg.registrationOpen === undefined) { cfg.registrationOpen = true; dirty = true; }
        // Service to Sales was added later. Existing stores won't have it, so insert it
        // (right after Sales Associate) if it's missing. It behaves like Sales: on The
        // Board, coached, and lead-gated.
        if (Array.isArray(cfg.roles) && !cfg.roles.some((r) => r.id === "service")) {
          const svc = { id: "service", name: "Service to Sales", color: "#7E8B24", onBoard: true, coaching: true };
          const salesIdx = cfg.roles.findIndex((r) => r.id === "sales");
          if (salesIdx >= 0) cfg.roles.splice(salesIdx + 1, 0, svc);
          else cfg.roles.unshift(svc);
          dirty = true;
        }
        // Manager role added later too — for organizing people who aren't scored or tracked.
        if (Array.isArray(cfg.roles) && !cfg.roles.some((r) => r.id === "manager")) {
          cfg.roles.push({ id: "manager", name: "Manager", color: "#5B6874", onBoard: false, coaching: false, tracked: false });
          dirty = true;
        }
        if (cfg.users) { delete cfg.users; dirty = true; }
        if (dirty) await saveShared(CONFIG_KEY, cfg);
        setConfig(cfg);
        /* Signed in, so this is allowed: keep the public slice current even for
           a config that was saved before the slice existed. */
        if (sessionRef.current) saveShared(PUBLIC_STORES_KEY, publicSlice(cfg)).catch(() => {});
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
      if (sessionRef.current) {
        /* Genuinely new install, confirmed by an authenticated read: create it. */
        await saveShared(CONFIG_KEY, cfg);
      } else {
        /* Signed out, row invisible: run the login on defaults, write nothing,
           and re-read the moment a session exists. The group's own stores,
           domains and sign-up switch come from the public slice, so the
           account screen offers the real rooftops rather than the examples. */
        cfgProvisional.current = true;
        try {
          const pub = await loadShared(PUBLIC_STORES_KEY, null);
          if (pub && Array.isArray(pub.stores) && pub.stores.length) {
            cfg.stores = pub.stores.map((st) => ({ ...st }));
            if (Array.isArray(pub.approvedDomains)) cfg.approvedDomains = pub.approvedDomains;
            if (typeof pub.registrationOpen === "boolean") cfg.registrationOpen = pub.registrationOpen;
          }
        } catch (e) { /* the defaults stand */ }
      }
      setConfig(cfg);
    })().catch(() => setLoadErr(true));
  }, [cfgWave]); // eslint-disable-line

  useEffect(() => {
    if (!config || !session) return;
    (async () => {
      const accessible = session.role === "admin" ? config.stores : config.stores.filter((s) => (session.stores || []).includes(s.id));
      if (!viewPicked.current) {
        // First load: pull every accessible store, cache it, pick a starting view.
        const all = {};
        for (const s of accessible) {
          const got = await withTimeout(loadStrict(storeKey(s.id)));
          const r = got.value || { ok: false };
          let d = r.ok ? r.value : undefined;
          if (!r.ok) {
            /* Never let a failed read look like an empty store. The copy the
               phone remembers stands in where there is one; a salesperson's
               corner reads its own rows and goes on without; the desk, which
               works from this document, is told and offered a retry. */
            const c = cacheGet("store:" + s.id);
            if (c && c.value) { d = c.value; netSet(true, c.at); }
            else if (wantsFloor) continue;
            else { setLoadErr(true); return; }
          } else if (d) cachePut("store:" + s.id, d);
          if (!d) {
            const legacy = await loadStrict(`lpc:store:${s.id}:v1`);
            if (!legacy.ok) { setLoadErr(true); return; }
            d = legacy.value || emptyStoreData();
          }
          // Same check as the single-store load: a document that says it belongs
          // to another store never enters the cache, because the cache is read
          // straight onto the board without going through that path again.
          if (d.__storeId && d.__storeId !== s.id) {
            console.error("store document belongs to another store", { key: s.id, claims: d.__storeId });
            continue;
          }
          if (!d.__storeId) d.__storeId = s.id;   // only ever stamps a document that arrived without one
          all[s.id] = d;
        }
        setAdminData(all);
        // an admin opening the tool is what triggers the daily backup
        if (session.role === "admin") runAutoBackup(config, all, session.name).catch(() => {});
        viewPicked.current = true;
        /* ---- land where you were, not on the overview ----
           An admin opened on All Stores every time, which is the one view that is
           nobody's actual job: the numbers a manager acts on are a store's. So the
           last store worked in is remembered and opened again, and the overview is
           one click away rather than the front door.

           Only a store is remembered. "admin" and "combined" are not stored, so an
           admin who genuinely wants the overview gets it by asking for it each
           time rather than by being parked there for ever after one visit. */
        const remembered = lastView();
        const openable = remembered && accessible.some((x) => x.id === remembered) ? remembered : null;
        if (openable) {
          setView(openable);
          setStoreData(all[openable]);
        } else if (session.role === "overseer" && accessible.length > 1) {
          setView("combined");
        } else {
          const first = accessible[0]?.id;
          if (first) { setView(first); setStoreData(all[first]); }
          else if (session.role === "admin") setView("admin");
        }
        return;
      }
      // Later runs happen when the config or (more often) the auth session reference
      // changes -- e.g. a token refresh or tab focus. These must NOT reload or overwrite
      // the store being worked in: doing so was reverting fresh edits mid-save and then
      // the next save wrote the reverted copy back, wiping plates. Only fetch stores we
      // don't already have cached; never touch storeData.
      const missing = accessible.filter((s) => !adminData[s.id]);
      if (!missing.length) return;
      const add = {};
      for (const s of missing) {
        const r = await loadStrict(storeKey(s.id));
        if (!r.ok) continue;
        let d = r.value;
        if (!d) { const legacy = await loadStrict(`lpc:store:${s.id}:v1`); d = (legacy.ok && legacy.value) || emptyStoreData(); }
        if (d.__storeId && d.__storeId !== s.id) {
          console.error("store document belongs to another store", { key: s.id, claims: d.__storeId });
          continue;
        }
        if (!d.__storeId) d.__storeId = s.id;
        add[s.id] = d;
      }
      if (Object.keys(add).length) setAdminData((p) => ({ ...p, ...add }));
    })();
  }, [config, session]);

  useEffect(() => { setBoardFilter(null); setAssocQuery(""); setFocusAssoc(null); }, [view, tab, appModule]);

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

  /* ---- and it must also run when the SESSION turns up ----
     This was keyed on `view` alone, which worked only because view used to start
     at "admin" and change to a store once the session had landed: the change was
     what ran the load. Opening on the remembered store took that away. `view` is
     now the store from the first render, so it never changes, the effect never
     re-runs, and the early return above — taken on mount because there is no
     session yet — was the last word. The store never loaded and the screen sat on
     "Loading Holler Honda" for ever.

     `ready` rather than `session` itself, deliberately: it flips false to true
     exactly once, so a token refresh or a tab focus handing back a new session
     object cannot re-enter this and drop the store being worked in. That is the
     failure the comment below is about, and it is still guarded against. */
  const ready = !!session && !!config;
  /* True once a store has been "loading" long enough that it is not loading. */
  const [storeLoadStuck, setStoreLoadStuck] = useState(false);
  useEffect(() => {
    if (storeData || view === "admin" || view === "combined" || !ready) { setStoreLoadStuck(false); return undefined; }
    const t = setTimeout(() => setStoreLoadStuck(true), 15000);
    return () => clearTimeout(t);
  }, [storeData, view, ready]);
  /* ---- what the arrival is waiting for ----
     The jump's cruise holds until the screen it will land on is actually
     standing. "Standing" includes the failure screens on purpose: a store that
     answered with a mismatch or a failed load still has something honest to
     land on, and holding the tunnel for data that is never coming would just be
     a spinner with better art. The destination sign is the store's own name and
     brand colour, from config. */
  const [iconWave, setIconWave] = useState(0);
  const iconCache = useRef({});
  useEffect(() => {
    if (!jumpHold) { tellArrivalReady(false, null); return; }
    const atStore = view !== "admin" && view !== "combined";
    const store = atStore ? (config?.stores || []).find((x) => x.id === view) : null;
    /* The landing has to arrive COMPLETE: a store icon that pops in a beat
       after the page defeats the whole point of holding the tunnel. The icon is
       fetched during the cruise and the landing waits for it — bounded, so a
       broken image can never hold the jump. */
    let iconReady = true;
    const src = store && store.icon;
    if (src) {
      const st = iconCache.current[src];
      if (st !== "ok") {
        iconReady = false;
        if (!st) {
          iconCache.current[src] = "pending";
          const done = () => {
            if (iconCache.current[src] === "ok") return;
            iconCache.current[src] = "ok";
            setIconWave((w) => w + 1);
          };
          const img = new Image();
          img.onload = done; img.onerror = done;
          img.src = src;
          setTimeout(done, 1800);
        }
      }
    }
    const landable = !!session && !!config && iconReady
      && (!atStore || !!storeData || !!storeMismatch || storeLoadFailed);
    tellArrivalReady(landable, store
      ? { name: store.name, color: (store.brand && store.brand.primary) || "#2F7F72" }
      : null);
  }, [jumpHold, session, config, view, storeData, storeMismatch, storeLoadFailed, iconWave]);
  useEffect(() => {
    if (!config || view === "admin" || view === "combined" || !session) return;
    /* A load takes two round trips now (the document, then the split day rows), so
       switching stores mid-flight used to let the SLOWER, older store answer last and
       overwrite the newer one. The screen then showed one store's roster while the
       app believed it was in another, and the next save wrote it to the wrong key.
       That is how one store's people, ignore list and departures ended up merged into
       another. Anything that resolves after the store has moved on is dropped. */
    let dead = false;
    const want = view;
    (async () => {
      const cached = adminData[view];
      if (cached) {
        if (cached.__storeId && cached.__storeId !== view) {
          setStoreMismatch({ want: view, claims: cached.__storeId, found: describeDoc(cached) });
          setStoreData(null); setStoreLoadFailed(true);
          return;
        }
        setStoreData(cached); setStoreLoadFailed(false); setStoreMismatch(null); setTab("board"); return;
      }
      /* Drop the store we were showing BEFORE fetching the next one. Without this
         the board keeps rendering the previous store's roster under the new
         store's name for as long as the fetch takes — Driver's Mart's people
         under a Holler Honda header. It was invisible on a desk connection and
         plainly wrong on a phone, which is the only reason it survived this long.
         The null state is already handled: it draws the loading screen. */
      setStoreData(null);
      setStoreLoadFailed(false);
      setStoreMismatch(null);
      setStoreLoadError("");
      try {
        /* A request that never answers used to leave this screen loading for ever:
           there was no failure to catch, so nothing downstream ever ran. Twelve
           seconds is past any honest load and inside the stuck-screen watchdog,
           so a hung connection ends as a stated failure rather than a spinner. */
        const d = await Promise.race([
          loadStore(view, emptyStoreData(), true), // throw on a real load error
          new Promise((_, rej) => setTimeout(() => rej(new Error("The store took too long to answer (12s).")), 12000)),
        ]);
        if (dead || want !== view) return;
        try { storeStampRef.current = await loadStoreStamp(storeKey(want)); } catch (e) { storeStampRef.current = null; }
        if (dead || want !== view) return;
        /* The stamp is evidence, and this line used to destroy it.
           A save writes __storeId onto the document. The load then overwrote it
           with whatever key it had just read from — so a document belonging to
           one store, sitting in another store's row, was silently relabelled on
           the way in, and the save-side guard that exists to catch exactly this
           saw two matching ids and let it through.
           Check it instead. A document that says it belongs somewhere else is
           never rendered as this store's, because showing one store's people
           under another store's name is worse than showing nothing. */
        if (d.__storeId && d.__storeId !== want) {
          console.error("store document belongs to another store", { key: want, claims: d.__storeId });
          /* Keep a description of what was refused. Whether this row holds the OTHER
             store's people or this store's people wearing the wrong label is the whole
             question — the first needs a restore, the second needs one field corrected —
             and the document is only in hand here. Counts and a few names answer it at
             a glance; the document itself is still not rendered as this store's. */
          setStoreMismatch({ want, claims: d.__storeId, found: describeDoc(d) });
          setStoreData(null); setStoreLoadFailed(true);
          return;
        }
        setStoreMismatch(null);
        d.__storeId = want;   // only ever stamps a document that arrived without one
        setStoreData(d); setStoreLoadFailed(false); setStoreLoadError("");
      } catch (e) {
        if (dead || want !== view) return;
        console.error("store load failed", { key: want, error: e });
        // A failed load must NOT masquerade as an empty store, or the next save wipes it.
        setStoreLoadError(String((e && e.message) || e || "Unknown error"));
        setStoreData(emptyStoreData()); setStoreLoadFailed(true);
      }
      if (!dead && want === view) setTab("board");
    })();
    return () => { dead = true; };
  }, [view, ready]); // eslint-disable-line

  /* ---- Close out unanswered absences ----
     A day that has ended with a scheduled person showing no calls, no videos and no
     sign-in is an absence nobody got round to recording. Once the day is finished
     there is nothing left to wait for, so it is applied. Three conditions keep this
     honest: the day must be over, the schedule must have had them in, and the
     activity report must have run that day, because a missing import would
     otherwise mark the entire floor absent. Every one is written to the audit log
     under Auto close-out, and any of them can be undone by hand. */
  useEffect(() => {
    if (!config || !session || !storeData || view === "admin" || view === "combined") return;
    const t = today();
    const days = Object.keys(storeData.activity || {})
      .filter((d) => d < t && d.slice(0, 7) === ym())
      .sort();
    if (!days.length) return;
    const roster = (storeData.roster || []).filter((a) => a.roleId);
    const found = [];
    for (const d of days) {
      for (const a of roster) if (looksAbsent(storeData, a.id, d)) found.push({ id: a.id, name: a.name, d });
    }
    if (!found.length) return;
    const next = JSON.parse(JSON.stringify(storeData));
    next.daysOff = next.daysOff || {};
    next.daysOffAt = next.daysOffAt || {};
    const stamp = new Date().toISOString();
    for (const f of found) {
      const set = new Set(next.daysOff[f.id] || []);
      set.add(f.d);
      next.daysOff[f.id] = [...set].sort();
      next.daysOffAt[f.id] = stamp;
    }
    const detail = found.length <= 6
      ? found.map((f) => `${f.name} ${f.d}`).join(", ")
      : `${found.length} days across ${new Set(found.map((f) => f.id)).size} people`;
    persistStore(view, next, { action: "Auto close-out: marked day off, no activity", detail });
  }, [storeData, view, config, session]); // eslint-disable-line

  /* ---- Keep up with the email ingest ----
     The worker imports on its own schedule and writes to the database directly. A tab
     that has been open since this morning would otherwise show neither the numbers nor
     the upload history from any of it. Poll the row's timestamp, and only when it has
     actually moved pull the row down. */
  useEffect(() => {
    if (!config || !session || view === "admin" || view === "combined") return;
    let dead = false;
    const pull = async () => {
      if (dead || savingRef.current || document.hidden) return;
      try {
        const stamp = await loadStoreStamp(storeKey(view));
        if (!stamp || dead || stamp === storeStampRef.current) return;
        const fresh = await loadStore(view, null, true);
        if (!fresh || dead || savingRef.current) return;
        fresh.__storeId = view;
        storeStampRef.current = stamp;
        setStoreData(fresh);
        setAdminData((p) => (p[view] ? { ...p, [view]: fresh } : p));
      } catch (e) { /* a blip: the next tick tries again */ }
    };
    const t = setInterval(pull, 60000);
    const onShow = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { dead = true; clearInterval(t); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [view, config, session]); // eslint-disable-line

  const persistConfig = async (next, audit) => {
    setConfig(next); setSaving(true);
    await saveShared(CONFIG_KEY, next);
    saveShared(PUBLIC_STORES_KEY, publicSlice(next)).catch(() => {});
    if (audit) await appendAudit({ user: session?.name, ...audit });
    setSaving(false);
  };
  /* ---- One save at a time from this tab ----
     Every save is read-merge-write against a revision, which is the right way to
     handle other people. It is the wrong way to handle YOURSELF: tick two boxes in
     quick succession and this browser fires two of them at once, they collide on the
     revision, and the retries are spent racing a save this same tab is still making.
     That is the "someone else is saving this store" message appearing when nobody
     else is there. Queue them instead — the second waits for the first, sees its
     result, and lands first time. */
  const saveChain = useRef(Promise.resolve());
  /* Saves run one after another, and each one ships the whole store. Two taps
     in a row used to flicker: the first save came back and wrote the server's
     copy over the screen, undoing the second tap until its own save landed.
     Every save takes a number, and only the newest one is allowed to write
     what came back onto the screen. */
  const saveSeq = useRef(0);
  const persistStore = (storeId, next, audit) => {
    const seq = ++saveSeq.current;
    const run = () => persistStoreNow(storeId, next, audit, seq);
    const p = saveChain.current.then(run, run);
    saveChain.current = p.catch(() => {});
    return p;
  };
  const persistStoreNow = async (storeId, next, audit, seq = saveSeq.current) => {
    if (storeLoadFailed) {
      alert("This store's data didn't finish loading, so saving is paused to protect your records.\n\nReload the page, make sure everything is showing, then try again. If it keeps happening, use the Help button in the corner to report it.");
      return;
    }
    /* The last line of defence. Every loaded document knows which store it is, and a
       save that does not match is refused outright. A guard rather than a fix: if this
       ever fires, something upstream is wrong and writing anyway would corrupt two
       stores at once. */
    if (next && next.__storeId && next.__storeId !== storeId) {
      console.error("refused cross-store save", { belongsTo: next.__storeId, wouldWriteTo: storeId });
      alert("That change was NOT saved, on purpose.\n\nThe data on screen belongs to a different store than the one currently selected, which usually means a store was switched while it was still loading. Nothing was overwritten.\n\nReload the page and try again, and please report it with the Help button so it can be looked at.");
      return;
    }
    const looksEmpty = (o) => !o || (!(o.roster || []).length && !Object.keys(o.months || {}).length && !Object.keys(o.activity || {}).length && !(o.plateRegistry || []).length);
    const prior = adminData[storeId] || storeData;
    if (prior && !looksEmpty(prior) && looksEmpty(next)) {
      alert("That change was blocked because it would have wiped this store's records. Nothing was lost.\n\nReload the page and try again. If it happens twice, use the Help button in the corner to report it, because that means something is wrong.");
      return;
    }
    // Keep the saved blob small. Snapshots are by far the biggest bloat (each is
    // roughly a full copy of the store), and every save ships the whole blob, so a
    // pile of them is what pushed writes past the database statement timeout. Cap
    // them hard on EVERY save, so the first save after this permanently shrinks it.
    // Snapshots are full copies of the store and the single biggest bloat in the saved
    // blob; keep only the most recent one so writes stay well under the DB timeout.
    if (next && Array.isArray(next.snapshots) && next.snapshots.length > 1) {
      next.snapshots = next.snapshots.slice(0, 1);
    }
    setStoreData(next); setSaving(true); savingRef.current = true;
    setAdminData((p) => ({ ...p, [storeId]: next }));

    /* Activity days go to their own rows first. They are the contended part, and
       writing them separately means an import and a manager editing anything else
       never touch the same row. Done before the document so that if the document
       write loses a race and retries, the day data is already safely stored. */
    const prevDoc = adminData[storeId] || storeData;
    try { await saveActivityDays(storeId, next, prevDoc); } catch (e) { console.error("day rows", e); }

    // Compare and swap. The merge runs inside the loop, so if somebody saves while
    // we are mid-flight we fold into THEIR document and try again rather than
    // flattening it. Whoever loses the race loses nothing.
    next.__storeId = storeId;
    const res = await saveStoreCAS(storeKey(storeId), (server) => mergeAgainstServer(next, server));
    const ok = res.ok;
    if (ok) {
      const merged = res.value || next;
      if (seq === saveSeq.current) {
        setStoreData(merged);
        setAdminData((p) => ({ ...p, [storeId]: merged }));
      }
      if (res.conflictsResolved) console.info("save merged around", res.conflictsResolved, "other save(s)");
    }
    setSaving(false); savingRef.current = false;
    if (!ok) {
      alert("That change could NOT be saved, so it will reappear on refresh. Your other work is untouched and nothing was overwritten.\n\nWhat the database said:\n" + (lastSaveError || "unknown") + "\n\nTry once more. If it happens again, use the Help button in the corner: it sends this message along with what you were doing.");
      return;
    }
    // Refresh the TV row so every casted screen picks this up on its next poll.
    // Failing this must never fail the save, so it is deliberately swallowed.
    if (config) publishBoard(config, storeId, next);
    try { storeStampRef.current = await loadStoreStamp(storeKey(storeId)); } catch (e) {}
    if (audit) await appendAudit({ user: session?.name, store: storeId, ...audit });
  };

  // Someone else logged a plate out, or marked one back in. Take their plate fields
  // into this browser's copy without writing anything back, so the screen keeps up
  // with the log instead of showing a stale one until somebody refreshes.
  const adoptRemotePlates = useCallback((storeId, plates, plateRegistry) => {
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    setStoreData((prev) => {
      if (!prev) return prev;
      /* The tracker's poller is keyed to the store that is SELECTED, and that changes
         the instant somebody picks another store — a second or more before the new
         document has finished loading. Until this check existed, the plates that
         arrived in that window were written straight onto the store still on screen:
         one dealership's plates showing under another dealership's name, and saved
         there by the next thing anybody touched. The document says which store it
         is; anything else is not ours to write to. */
      if (prev.__storeId && prev.__storeId !== storeId) return prev;
      if (same(prev.plates, plates) && same(prev.plateRegistry, plateRegistry)) return prev;
      return { ...prev, plates: plates || {}, plateRegistry: plateRegistry || [] };
    });
    setAdminData((p) => {
      const cur = p[storeId];
      if (!cur || (cur.__storeId && cur.__storeId !== storeId)) return p;
      if (same(cur.plates, plates) && same(cur.plateRegistry, plateRegistry)) return p;
      return { ...p, [storeId]: { ...cur, plates: plates || {}, plateRegistry: plateRegistry || [] } };
    });
  }, []);

  // Keep a rolling set of restore points so a bad import is never fatal.
  const snapshotStore = (data, reason) => {
    const copy = JSON.parse(JSON.stringify({
      roster: data.roster, months: data.months, activity: data.activity,
      plates: data.plates, restrictions: data.restrictions, aliases: data.aliases,
      stars: data.stars, goals: data.goals, baselines: data.baselines, qualified: data.qualified,
      excluded: data.excluded, departed: data.departed, daysOff: data.daysOff, daysOffAt: data.daysOffAt, statsExcluded: data.statsExcluded, plateRegistry: data.plateRegistry,
    }));
    const t = new Date().toISOString();
    const snaps = data.snapshots || [];
    snaps.unshift({ t, by: session?.name || "-", reason, data: copy });
    data.snapshots = snaps.slice(0, 1);
    return t;   // so an upload can point back at the exact state before it
  };

  // Apply already-typed report entries. Ambiguous delivery files are resolved before we get here.
  const applyEntries = async (entries) => {
    // The picked date drives BOTH the activity day AND the month that everything else
    // (Delivery Summary and the other month-to-date reports) lands in, so a report can
    // be seeded into a past month, not only the current one.
    const monthScope = activityScope === "month";
    const pickDay = (activityDay && activityDay <= today()) ? activityDay : today();
    // A whole-month import is anchored to the first of that month for record-keeping,
    // but nothing is written into the per-day activity history.
    const actDay = monthScope ? pickDay.slice(0, 7) + "-01" : pickDay;
    const month = actDay.slice(0, 7); const day = actDay;
    /* The date picker above is the DAILY ACTIVITY picker, and it must govern the
       activity report alone. Every other report is month-to-date and lands the
       day it is uploaded -- but each one used to be ticked under the picker's
       day, so uploading Video with "Yesterday" selected filed the tick under
       yesterday and today's checklist sat at "waiting" over a report that had
       plainly landed. When seeding a PAST month the anchor day stands, because
       "today" is not in that month and its checklist reads the whole month. */
    const tickDayFor = (type) => (type === "activity" || month !== today().slice(0, 7)) ? day : today();
    try { console.log("[LPC import] activityDay=" + activityDay + " actDay=" + actDay + " month=" + month + " today=" + today() + " types=" + JSON.stringify((entries || []).map((e) => e && e.type))); } catch (e) {}
    let next = JSON.parse(JSON.stringify(storeData));
    const snapT = snapshotStore(next, "Before import");
    if (!next.months[month]) next.months[month] = { stats: {}, imports: {}, names: {} };
    const M = next.months[month];
    // A month written by an older build can exist without one of these, and the
    // pipeline already hardens them the same way (see api/ingest.mjs).
    M.stats = M.stats || {}; M.names = M.names || {}; M.imports = M.imports || {};
    if (!M.imports[day]) M.imports[day] = {};
    const log = []; const importedFiles = [];

    // Capture the channel unit totals BEFORE this import so we can flag a suspicious
    // swing afterward (e.g. a Phone file dropped into the Internet slot, or yesterday's
    // file re-pulled with almost nothing in it).
    const priorTotals = channelTotals(M.stats);
    const importedChannels = new Set();

    const aliases = next.aliases || {};
    const canon = (k) => aliases[k] || k; // a renamed person folds into their existing record

    for (const { rows, type, fileName } of entries) {
      const tickDay = tickDayFor(type);
      /* ---- The store's own line, which is not a person and never becomes one ----
         The Delivery Summary exports twice: one row per user, and one row for the
         store. Only the store row counts a delivery once -- the people rows credit
         a car to the salesperson and again to whoever set the appointment -- so it
         is filed beside the month's people rather than among them. Nothing about
         the roster changes; this is what the board gets checked against. */
      if (type === "store-rollup") {
        const roll = parseStoreRollup(rows);
        if (!roll) { log.push({ ok: false, msg: `${fileName} looked like a store roll-up but its one row could not be read, so it was skipped.` }); continue; }
        M.stated = {
          deliveries: roll.deals, sold: roll.sold, opps: roll.opps,
          storeName: roll.storeName, day: tickDay, at: new Date().toISOString(),
          file: fileName, source: "roll-up",
        };
        if (!M.imports[tickDay]) M.imports[tickDay] = {};
        M.imports[tickDay]["store-rollup"] = true;
        log.push({ ok: true, msg: `${fileName} → ${roll.deals} deliveries at ${roll.storeName}. Filed as the store's own count; no person was changed.` });
        importedFiles.push("Store roll-up (1)");
        next.importLog = [{ id: uid(), t: new Date().toISOString(), type, label: "Store roll-up",
          file: fileName, count: 1, skipped: 0, by: session?.name || "Import", snapT, day: null },
          ...(next.importLog || [])].slice(0, 200);
        continue;
      }
      // The PDF Delivery Summary is one grid holding all four channels, so it has
      // its own reader. Everything else is the familiar column-per-metric export.
      const raw = type === "delivery-summary" ? parseDeliverySummaryRows(rows) : parseReport(rows, type);
      // fold every incoming name through the alias map, and drop anything on the
      // exclusion list. Reports contain roll-up rows like "Team A" that are not
      // people, and letting them through skews every average on the board.
      // Roll-up rows that are not people, plus anyone who has left the store. Both
      // have to be kept out or the import quietly puts them back on the roster.
      const excluded = new Set([...(next.excluded || []).map(norm), ...departedNames(next)]);
      const parsed = {};
      let skipped = 0;
      for (const [k, v] of Object.entries(raw)) {
        if (excluded.has(k)) { skipped++; continue; }
        const c = canon(k);
        parsed[c] = { ...(parsed[c] || {}), ...v };
      }

      /* ---- Nobody joins this store's books by turning up in a file ----

         Adding an unrecognised name is how a store fills itself in from its first
         report, and it is also how one misfiled report put a whole dealership
         onto somebody else's floor with its cars attached, where it sat for a
         fortnight with nothing on any screen looking wrong.

         So an unknown name is held instead — held, not dropped. The figures are
         parked exactly as they arrived and folded in the moment somebody says the
         person works here. Dropping them would punish the ordinary case, a new
         hire whose first report lands before anybody adds them, and a tool that
         loses a real salesperson's first week to guard against a rare mistake has
         made a bad trade.

         A store with nobody on it yet takes the lot, because that IS the first
         import and a queue of forty names over an empty screen is a worse first
         five minutes than the risk. */
      const knownHere = new Set([
        ...(next.roster || []).map((a) => norm(a.name)),
        ...(next.departed || []).map((d) => norm(d && d.name)),
      ]);
      const openDoor = admitsEveryone(next);
      const heldNow = [];
      if (!openDoor) {
        for (const key of Object.keys(parsed)) {
          if (knownHere.has(key)) continue;
          const rec = parsed[key];
          heldNow.push(rec.displayName || key);
          /* Parked in the shape it would have been written in, so claiming them
             later is a fold rather than a re-import. A day report and a month
             report do not use the same field names, and parking one as the other
             would hand somebody back an empty week. */
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
                uploadedAt: new Date().toISOString(),
              }, at: new Date().toISOString(), file: fileName }
            : { monthKey: month, rec, at: new Date().toISOString(), file: fileName });
          delete parsed[key];
        }
      }
      if (heldNow.length) {
        log.push({ ok: false, msg: `${fileName} → ${heldNow.length} ${heldNow.length === 1 ? "name is" : "names are"} not on this store's people list, so ${heldNow.length === 1 ? "it was" : "they were"} held rather than added: ${
          heldNow.slice(0, 6).join(", ")}${heldNow.length > 6 ? `, +${heldNow.length - 6} more` : ""}. Their figures are kept and are waiting under People. Say whether they work here and they will be folded in.` });
      }

      M.names[type] = Object.keys(parsed);
      /* The combined Delivery Summary already ticks every per-channel box in
         M.imports. It never did the same for M.names, and M.names is what the
         per-associate "incomplete file" check reads. So for every store on the PDF
         rather than the per-channel CSVs, the delivery half of that check has been
         silently skipped: names.delivery was never written, so delivery never
         counted as a required report for anybody. Write it here too. */
      if (type === "delivery-summary") M.names.delivery = Object.keys(parsed);
      if (type === "delivery-summary") ["internet", "phone", "showroom", "campaign"].forEach((c) => importedChannels.add(c));
      else if (type.startsWith("delivery-")) importedChannels.add(type.split("-")[1]);
      else if (type === "delivery") importedChannels.add("internet");
      const label = type === "delivery-summary" ? "Delivery Summary (all channels)"
        : REPORTS[type]?.label || LEADERBOARD_REPORTS[type]?.label || (type === "activity" ? "Daily Activity" : type);
      let count = 0;

      if (type === "activity" && monthScope) {
        // A cumulative month pull. Writing it into next.activity would make one file
        // look like a single day and wreck every per-day average, so it is stamped as
        // the month's own totals and the recap reads those instead of summing days.
        next.months[month] = next.months[month] || { stats: {}, imports: {} };
        next.months[month].stats = next.months[month].stats || {};
        const mWork = workingDaysInMonth(month);
        for (const [key, rec] of Object.entries(parsed)) {
          next.months[month].stats[key] = {
            ...(next.months[month].stats[key] || {}),
            apptShowedMTD: rec.actApptShow,
            apptScheduledMTD: rec.actApptScheduled,
            activityMTD: {
              days: mWork,
              calls: rec.actCalls, video: rec.actVideo, contacted: rec.actCallContacted,
              text: rec.actText, email: rec.actEmail,
              apptCreated: rec.actApptCreated, apptScheduled: rec.actApptScheduled,
              apptConfirmed: rec.actApptConfirmed, apptShow: rec.actApptShow,
              oppShowroom: rec.actOppShowroom, oppPhone: rec.actOppPhone,
              oppInternet: rec.actOppInternet, oppCampaign: rec.actOppCampaign,
              tasks: rec.actCompletedTasks, visits: rec.actVisits,
              uploadedAt: new Date().toISOString(),
            },
          };
          count++;
        }
        log.push({ ok: true, msg: `Filed as the month total for ${monthLabel(month)} · ${count} people. Per-day history for that month was not touched.` });
      } else if (type === "activity") {
        if (!next.activity) next.activity = {};
        // "Open Tasks" is a live backlog snapshot, so a report pulled for a past date
        // often comes back without it. Keep whatever was already recorded for that day
        // rather than blanking it, or backfilling would destroy a good task rate.
        const priorDay = next.activity[actDay] || {};
        let missingOpenTasks = 0;
        next.activity[actDay] = {};
        for (const [key, rec] of Object.entries(parsed)) {
          const priorPosted = priorDay[key]?.tasksPosted;
          const posted = rec.actOpenTasks != null ? rec.actOpenTasks : (priorPosted ?? null);
          if (rec.actOpenTasks == null) missingOpenTasks++;
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
            /* Customers this person was credited with seeing. The only figure in
               any export that credits a SECOND salesperson on a walk-in, so it is
               kept per day rather than only rolled into the month. */
            visits: rec.actVisits,
            uploadedAt: new Date().toISOString(),
          };
          // Deliberately NOT stamped onto the month totals. A day file only holds one
          // day, and the hourly auto-import runs on today, so stamping here would
          // overwrite a good month total with a single day's number.
          count++;
        }
        // Say so plainly rather than letting the task rate quietly go blank.
        if (missingOpenTasks > 0 && count > 0) {
          log.push({
            ok: true,
            msg: `Heads up: this report has no "Open Tasks" column, so task completion rate can't be worked out for ${actDay}. ` +
                 `DriveCentric only reports open tasks as they stand right now, so a report pulled for an earlier date leaves it out. ` +
                 `Everything else imported normally, and any task count already saved for that day was kept.`,
          });
        }
      }

      for (const [key, rec] of Object.entries(parsed)) {
        const prevStat = M.stats[key] || {};
        // Day-over-day trend: only move the baseline when this import is a NEW day.
        // Re-importing twice in one day must not compare a number against itself.
        const trend = { ...(prevStat.prevPct || {}) };
        const prevUnits = { ...(prevStat.prevUnits || {}) };
        const pctDay = { ...(prevStat.pctDay || {}) };
        const hist = JSON.parse(JSON.stringify(prevStat.pctHistory || {}));
        for (const ch of ["internet", "phone", "showroom", "campaign"]) {
          // Units trend is day-aware the same way the percentage trend is: a
          // re-import on the same day must not reset the baseline to itself.
          if (rec[ch + "Units"] == null) continue;
          const storedU = prevStat[ch + "Units"];
          const storedUDay = pctDay["u_" + ch];
          if (storedU != null && storedUDay && storedUDay !== tickDay) prevUnits[ch] = storedU;
          pctDay["u_" + ch] = tickDay;
        }
        for (const ch of ["internet", "phone", "showroom"]) {   // campaign has no pct by design
          if (rec[ch + "Pct"] == null) continue;
          const storedVal = prevStat[ch + "Pct"];
          const storedDay = pctDay[ch];
          if (storedVal != null && storedDay && storedDay !== tickDay) {
            trend[ch] = storedVal; // yesterday's figure becomes the comparison baseline
          }
          pctDay[ch] = tickDay;
          // running history, one point per day, so a real trend can be drawn
          hist[ch] = (hist[ch] || []).filter((p) => p.d !== tickDay);
          hist[ch].push({ d: tickDay, v: rec[ch + "Pct"] });
          hist[ch] = hist[ch].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-30);
        }
        M.stats[key] = { ...prevStat, ...rec, prevPct: trend, prevUnits, pctDay, pctHistory: hist, [`${type}Updated`]: tickDay };
        if (type !== "activity") count++;
      }

      if (!M.imports[tickDay]) M.imports[tickDay] = {};
      M.imports[tickDay][type] = true;
      // a full log of every upload, not just a tick for the day
      next.importLog = [
        { id: uid(), t: new Date().toISOString(), type, label, file: fileName, count, skipped,
          by: session?.name || "-", snapT, day: type === "activity" ? actDay : null },
        ...(next.importLog || []),
      ].slice(0, 200);
      // The Internet Delivery Summary is the same DriveCentric export that drives the
      // lead standards. Uploading it once should satisfy both checklists, not leave the
      // other one stuck as "waiting".
      if (type === "delivery-summary") {
        // One file satisfies every delivery checklist item.
        for (const k of ["delivery", "delivery-internet", "delivery-phone", "delivery-showroom", "delivery-campaign"]) {
          M.imports[tickDay][k] = true;
        }
      }
      if (type === "delivery-internet") M.imports[tickDay]["delivery"] = true;
      if (type === "delivery") M.imports[tickDay]["delivery-internet"] = true;
      importedFiles.push(`${label} (${count})`);
      log.push({ ok: true, msg: `${fileName} → ${label} · ${count} associates updated${skipped ? `, ${skipped} excluded row${skipped === 1 ? "" : "s"} skipped` : ""}.` });

      /* Only a store with nobody on it yet reaches this: everybody else's unknown
         names were held above. This is a new store filling itself in from its
         first report, which is the one case where a file may name the floor.

         The old guard here — "a store that recognises NOBODY in a file is being
         shown somebody else's report" — has gone, not because it was wrong but
         because it only fired on five or more strangers at once and let a
         handful through silently. Holding every unrecognised name is the same
         idea without the threshold. */
      if (openDoor) {
        const rosterKeys = new Set(next.roster.map((a) => norm(a.name)));
        for (const [key, rec] of Object.entries(parsed)) {
          if (excluded.has(key) || rosterKeys.has(key)) continue;
          next.roster.push({ id: uid(), name: rec.displayName, roleId: null, order: next.roster.length });
          rosterKeys.add(key);
        }
      }
    }

    setImportLog(log);
    // Sanity-check the shape of what just landed and warn (never block) on anything odd.
    const afterTotals = channelTotals(M.stats);
    const flags = analyzeImport(priorTotals, afterTotals, importedChannels);
    setImportFlags(flags);
    if (flags.length) {
      next.importLog = [
        { id: uid(), t: new Date().toISOString(), type: "flag", label: "Possible bad upload",
          file: flags.map((f) => f.msg).join(" · "), count: flags.length, skipped: 0,
          by: session?.name || "-", snapT: null, day: null },
        ...(next.importLog || []),
      ].slice(0, 200);
    }
    if (importedFiles.length) {
      // freeze the standards in force this month so past months stay judged under their own rules
      M.standardsSnapshot = JSON.parse(JSON.stringify(config.standards?.[view] || {}));
    }
    await persistStore(view, next, {
      action: "Imported reports",
      detail: importedFiles.join(", ") || "nothing usable",
    });
  };

  /* Ignoring from the board does exactly what the Roster tab's bulk action does:
     off the roster, figures with them, and on the excluded list so the next
     import cannot put them back. One path, so the two cannot drift. */
  const ignoreNames = (keys) => {
    if (!keys || !keys.length || !storeData) return;
    const names = (storeData.roster || []).filter((a) => keys.includes(norm(a.name))).map((a) => a.name);
    if (!names.length) return;
    // The one function that owns a standing. Doing it by hand here was the
    // fourth copy, and like two of the others it never wrote the stamp.
    const next = setPersonStatus(storeData, names, "ignored", { by: session?.name });
    persistStore(view, next, {
      action: "Ignored names from imports",
      detail: `${names.length}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? `, +${names.length - 8} more` : ""}`,
    });
  };

  const handleFiles = useCallback(async (fileList) => {
    if (!storeData || view === "admin") return;
    setImportFlags([]);
    const ready = []; const ambiguous = []; const log = [];

    for (const file of Array.from(fileList)) {
      // PDFs are read with the same mappers the email pipeline uses, so a manager
      // can backfill a missed day, or carry on when the automation is down.
      if (/\.pdf$/i.test(file.name)) {
        try {
          const lines = await extractPdfLinesInBrowser(file);
          /* Every one of these PDFs prints the dealership it belongs to at the
             top, and until now that was read and thrown away — the file went
             into whichever store the manager happened to be looking at. Drop a
             batch of reports in with one store's file among them and its people
             and figures land under another store's name, silently, looking
             exactly like a normal import. The email pipeline had the same fault
             from the other direction and it is what put Drivers Mart Winter
             Park's salespeople on Classic Mazda's dashboard.

             A heading naming no store at all is allowed through: a store may
             have been renamed, or not added yet, and the manager did choose this
             store deliberately. A heading naming a DIFFERENT store is refused,
             because there is no reading of that where they meant it. */
          const wrongStore = (parsedName) => {
            const other = reportBelongsElsewhere(config?.stores, parsedName, view);
            if (!other) return false;
            log.push({ ok: false, msg: `${file.name} is ${other.name}'s report, and you're in ${
              (config?.stores || []).find((x) => x.id === view)?.name || "another store"
            }. It was skipped. Switch stores and drop it there.` });
            return true;
          };
          const da = mapDailyActivityGrid(lines);
          if (da) {
            if (wrongStore(da.storeName)) continue;
            ready.push({ rows: da.rows, type: "activity", fileName: file.name }); continue;
          }
          const ds = mapDeliverySummaryGrid(lines);
          if (ds) {
            if (wrongStore(ds.storeName)) continue;
            ready.push({ rows: ds.rows, type: "delivery-summary", fileName: file.name }); continue;
          }
          log.push({ ok: false, msg: `${file.name} is a PDF, but its layout isn't a Daily Activity or Delivery Summary report, so it was skipped.` });
        } catch (e) {
          log.push({ ok: false, msg: `${file.name} couldn't be read. If it's a scan or a photo rather than a report exported from DriveCentric, there is no text in it to read.` });
        }
        continue;
      }
      const text = await file.text();
      const rows = (await loadPapa()).parse(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;
      const type = detectReportType(rows, file.name);
      if (type === "wrong-channel-report") {
        // A per-channel delivery report was pulled instead of the Delivery Summary.
        // Stop everything and show the manager exactly how to pull the right one.
        setWrongReport({ fileName: file.name });
        return;
      }
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
  }, [storeData, view, session, activityDay, config]); // eslint-disable-line


  const moveAssociate = async (name, targetName, roleId) => {
    if (!storeData) return;
    const next = JSON.parse(JSON.stringify(storeData));
    const list = next.roster;
    const from = list.findIndex((a) => a.name === name);
    if (from === -1) return;
    const roleChanged = list[from].roleId !== roleId;
    const [item] = list.splice(from, 1);
    if (roleChanged) item.updatedAt = new Date().toISOString();
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
    /* Stamped, because taking a restriction off is a deletion, and a deletion
       that is not written down cannot survive meeting another manager's copy —
       theirs still has it and an absence proves nothing. */
    next.restrictionsAt = next.restrictionsAt || {};
    next.restrictionsAt[assoc.id] = new Date().toISOString();
    if (restriction) next.restrictions[assoc.id] = restriction;
    else delete next.restrictions[assoc.id];
    await persistStore(view, next, {
      action: restriction ? "Confirmed off leads" : "Put back on leads",
      detail: restriction
        ? `${assoc.name}${restriction.until ? `, re-evaluate ${new Date(restriction.until).toLocaleDateString()}` : ", no re-eval date"}`
        : assoc.name,
    });
  };
  /* Waiting screens are held, not flashed: nothing shows for a load that finishes
     quickly, and once one does show it stays long enough to read. See useHeld. */
  const bootHeld = useHeld(!config || !authReady);
  const storeHeld = useHeld(!storeData);

  // --- phone-lead / online-lead queue: public sign-in intercept (before any auth) ---
  const queueParams = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const d = p.get("d"), t = p.get("t");
      const q = p.get("q"), o = p.get("o");
      if (q && d && t) return { store: q, date: d, token: t, variant: LEAD_VARIANTS.line };
      if (o && d && t) return { store: o, date: d, token: t, variant: LEAD_VARIANTS.online };
      return null;
    } catch { return null; }
  })();
  if (queueParams) {
    return <Shell><QueueSignIn store={queueParams.store} date={queueParams.date} token={queueParams.token} variant={queueParams.variant} /><Style /></Shell>;
  }
  // --- casted board: a TV pointed at this URL, no sign-in, read-only ---
  // ?qboard={storeId}&k=line|online|floor
  const qBoardParams = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const b = p.get("qboard");
      return b ? { store: b, kind: (p.get("k") || "line").toLowerCase() } : null;
    } catch { return null; }
  })();
  if (qBoardParams) return <Shell><QueueBoard storeId={qBoardParams.store} kind={qBoardParams.kind} /><Style /></Shell>;

  const boardParams = (() => {
    try {
      const b = new URLSearchParams(window.location.search).get("board");
      return b ? { store: b } : null;
    } catch { return null; }
  })();
  if (boardParams) return <React.Suspense fallback={null}><BoardScreen storeId={boardParams.store} /></React.Suspense>;
  // --- live floor: public sign-in intercept (before any auth) ---
  const floorParams = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const f = p.get("f"), d = p.get("d"), t = p.get("t"), tbl = p.get("tbl");
      if (f && d && t) return { store: f, date: d, token: t, tag: tbl };
      /* A TABLE TAG: an NFC sticker or QR on the table itself, written once and
         never rotated. It carries only WHERE -- who you are still comes from
         today's sign-in code, so a tag read off a table at home does nothing. */
      if (f && tbl) return { store: f, date: today(), token: null, tag: tbl };
      return null;
    } catch { return null; }
  })();
  if (floorParams) {
    return <Shell ground={false}><FloorSignIn store={floorParams.store} date={floorParams.date} token={floorParams.token} tag={floorParams.tag} /><Style /></Shell>;
  }
  const retryBoot = () => { setBootStall(false); setLoadErr(false); netSet(false); setCfgWave((w) => w + 1); setLinksWave((w) => w + 1); refreshProfile(); };
  if (loadErr || bootStall) return <Shell><BootStall onRetry={retryBoot} /><Style /></Shell>;
  /* ---- the sign-in screen is a LAYER, not a branch ----
     It used to be one of this component's early returns, which meant the app
     underneath it did not exist until the jump handed over — so the dashboard
     mounted after the streaks had gone, and the white flash had to sit there
     covering half a second of React. Measured at 407-519ms of blocked main
     thread, on top of the 1.2s it was before the stylesheet stopped being
     re-parsed on every branch change.

     Now the app renders as soon as the session arrives, about 250ms into the
     hold, with this layer over the top of it: the mount happens under the
     streaks, while there is something to look at, and the handover is a state
     flip onto a dashboard that has already been built.

     It has to be at a fixed position in every branch's output — always the second
     child of the same fragment — because React reconciles by index. The element
     at index 0 changes type as the app comes up and remounts; index 1 does not,
     so the sign-in screen carries on and the jump running inside it is never
     interrupted. Returning it as a branch of its own is exactly what would tear
     it down at the moment the session lands. */
  /* And not before the stored session has been read: config lands first, and
     for the beat between the two a returning person saw the sign-in screen
     flash up and vanish under their own arrival. The ground is what shows
     while the answer is on its way; a real sign-out still gets the screen. */
  const signInLayer = config && authReady && (!session || jumpHold) ? (
    <div className="signin-over" key="signin">
      <Login config={config}
        onJump={(v) => { setJumpHold(v); setHoldMount(v); }}
        onHandover={() => {
          const undo = landDashboard();
          /* And the tidying, once the landing is over and a render is free. */
          setTimeout(() => {
            undo();
            jumpOwnsEntrance = false;
            setJumpHold(false);
            setHoldMount(false);   // belt and braces: the gate must never outlive the jump
            setIntroDone(true);
          }, jumpShort ? 360 : ARRIVAL.assemble);
        }}
        onAuthed={async () => { await refreshProfile(); }} />
    </div>
  ) : null;
  const wrap = (node) => <React.Suspense fallback={<Shell><LoadingScreen /><Style /></Shell>}>{node}{signInLayer}</React.Suspense>;

  if (!config || !authReady || bootHeld) return wrap(<Shell>{bootHeld ? <LoadingScreen /> : null}<Style /></Shell>);

  const signOut = async () => {
    cacheDel("profile");
    await authSignOut();
    viewPicked.current = false;
    setSession(null); setEntered(false); setAppModule("perf");
  };

  /* Signed out, OR signed in a moment ago and still flying. The second half is
     not a nicety: the auth client signs the session in as soon as the password
     check passes, roughly 300ms after the press, and without this the sign-in
     screen would be pulled out from under its own arrival a quarter of the way
     into the first beat. The jump releases the hold on the frame the flash is
     covering, which is the only frame where swapping one screen for the other
     cannot be seen. */
  /* Nothing but the ground while there is no session: the sign-in screen itself
     is the layer above, and it is already on screen. */
  if (!session || holdMount) return wrap(<Shell><Style /></Shell>);

  // Signed in, but the admin hasn't granted a store yet (or the account was switched off).
  if (!session.active) {
    return wrap(<Shell><div className="login"><div className="login-card">
      <div className="login-logo"><SageMark word size={56} className="logo-anim" /></div>
      <h1 className="login-title">Account paused</h1>
      <p className="lf-note">This account has been deactivated. Contact your group admin.</p>
      <button className="lf-go lf-solo" onClick={signOut}><span>Sign out</span></button>
    </div></div><Style /></Shell>);
  }
  if (wantsFloor) {
    if (floorLinks === undefined) return wrap(<Shell><LoadingScreen /><Style /></Shell>);
    /* Keyed by the account, not by the phone. One key for the whole device
       meant the last store ANY account visited decided where the NEXT account
       landed: sign in as a manager, look at one store, sign in as a
       salesperson, and their corner opens at the manager's store. It only
       shows when somebody is linked at more than one rooftop, which is exactly
       the person this remembering exists for. */
    const homeKey = "lpcf:home:" + (session.id || "anon");
    let remembered = null;
    try {
      remembered = localStorage.getItem(homeKey);
      /* The old device-wide key is dropped rather than migrated. Carrying its
         value over would hand the first person to sign in after this ships the
         very store this is meant to stop them landing in. Losing it costs one
         sign-in at whichever rooftop is listed first, which homeLinkFor
         already handles. */
      localStorage.removeItem("lpcf:home");
    } catch (e) {}
    const home = homeLinkFor(floorLinks, remembered);
    if (home) {
      try { localStorage.setItem(homeKey, home.store); } catch (e) {}
      /* Their corner, through the account. The daily QR stays the second door
         into the very same screen. No ground: the phone routes draw their own. */
      return wrap(<Shell ground={false}>
        <AssociateRooms key={home.store + ":" + doorDay} config={config} store={home.store}
          date={doorDay} account={home.person_id} onSignOut={signOut} />
        <Style />
      </Shell>);
    }
    /* No link yet. Whether or not a manager has ticked the account, a person
       who asked for the floor has nowhere to go until they are joined to a
       name, and the manager dashboard is the wrong place to wait: it opens on
       whichever store the phone last saw, which reads as a glitch. They wait
       here, with their claim, until the join is made. */
    return wrap(<Shell><PendingScreen profile={session} onSignOut={signOut} config={config} onClaimed={refreshProfile} /><Style /></Shell>);
  }

  // The Tools chooser is gone. Signing in drops the person straight into the
  // Performance dashboard; the cinematic intro (below) covers the transition on the
  // first sign-in of the day. chooseModule stays for the in-app "Tools" button.
  const chooseModule = (mod) => {
    setAppModule(mod || "perf");
    if (mod === "activity" && view === "admin") {
      const first = (isAdmin ? config.stores : accessibleStores)[0];
      if (first) setView(first.id);
    }
    setEntered(true);
  };

  /* Switching tools was written out five times: once in each of the three
     topbars, once in the drawer and once in the bottom bar. They had drifted only
     in the ways you would expect (the board copy hardcoded its own value, the
     drawer copy closed itself on every branch) and were otherwise the same twelve
     lines. Five copies of a rule is five places for it to disagree, which is the
     same shape as the bug that made two modules dead ends. One function decides
     it now.

     chooseModule, just above, is deliberately not folded in: it runs at sign-in,
     sets `entered` and leaves the tab alone. Different job, similar shape.

     This is the first step of collapsing the three shells into one: agree on the
     behaviour before moving the markup. */
  /* ---- one tool leaves before the next arrives ----
     Jorge: "the old page should transition away element by element, then
     transition, then the next page would hit ... when the movement is side by
     side, elements should move side to side and pages should move side to side."

     So a switch is three beats, not one. The page leaves a block at a time in
     the direction of travel, the streaks cross, and only then does the new tool
     mount and come in from the other side. The old version fired the streaks
     over a page that was already changing underneath them, which is why it read
     as a flash on top of a cut rather than as a move.

     Driven through the document's class list rather than React state, and for
     the same reason the streaks are: the switch remounts a large tree, and the
     animation covering that mount must not be waiting in the same render queue.

     The timers are module-level so a second switch mid-move cancels the first
     rather than leaving the page half-exited. */
  const switchTool = (mod) => {
    if (mod === appModule) return;
    const root = document.documentElement;
    const dir = WARP_ORDER.indexOf(mod) >= WARP_ORDER.indexOf(appModule) ? "r" : "l";
    clearToolMove();
    root.classList.add("tool-move", "tool-dir-" + dir, "tool-exit");
    toolTimers.push(setTimeout(() => {
      /* Three beats in order, per Jorge: the page moves out FIRST, THEN the
         streaks cross on their own, THEN the new page slides in and lands.
         tool-exit stays on through the streak beat - its fill is what holds the
         departed page off screen - and comes off in the same breath the new
         tool arrives. */
      warpTo(appModule, mod);
      toolTimers.push(setTimeout(() => {
        root.classList.remove("tool-exit");
        root.classList.add("tool-enter");
        applyTool(mod);
        /* When the classes come off at the end of the move, the page's
           animation list will change from pageLand back to the base pageIn -
           and pageIn, being NEW to the list at that moment, would RESTART: a
           flash to transparent and a ten-pixel lift, a full second after the
           slide finished. Neutralised inline on this page instance just before
           the cleanup, which outranks the base rule for as long as this element
           lives. The next genuinely mounted page is a fresh element with no
           inline style, so its ordinary rise is untouched. */
        toolTimers.push(setTimeout(() => {
          document.querySelectorAll(".page, .board-page, .tab-page")
            .forEach((el) => { el.style.animation = "none"; });
        }, 640));
        /* The new page's cards must be marked in-view BEFORE their first paint:
           a card painted even one frame unmarked sits at translateY(20px), and
           the .8s transition then rises it - vertical motion inside a sideways
           move. The microtask runs after React's batched commit and before any
           paint; the rAF is the backstop, and rAF callbacks also run pre-paint.
           The double-rAF this replaces was the bug: its first frame PAINTED. */
        queueMicrotask(settleReveals);
        requestAnimationFrame(settleReveals);
        /* The last block starts 66ms in and runs 560ms, so the classes have to
           outlast 626ms or the animation is stripped off mid-landing and the
           block snaps the rest of the way. That snap is the "no landing" note. */
        toolTimers.push(setTimeout(clearToolMove, 700));
      }, 240));
    }, TOOL_EXIT));
  };

  const applyTool = (mod) => {
    // These four render their own shell and take no tab.
    if (mod === "board" || mod === "floor" || mod === "line" || mod === "online") {
      setAppModule(mod);
      return;
    }
    if (mod === "activity" && view === "admin") {
      const first = (isAdmin ? config.stores : accessibleStores)[0];
      if (first) setView(first.id);
    }
    setAppModule(mod);
    setTab(mod === "activity" ? (coachAfter.current ? "coaching" : "checkout") : "board");
    coachAfter.current = false;
  };


  /* The bar's centre button. Importing is the same act in every tool, so the
     button is always there and always means the same thing — but only two
     modules actually own an import screen. From the other four it lands on
     Performance's, which is where the files it wants would go anyway. */
  const goImport = () => {
    if (appModule === "perf" || appModule === "activity") { setTab("import"); return; }
    setAppModule("perf");
    setTab("import");
  };

  const isAdmin = session.role === "admin";
  const isOverseer = session.role === "overseer";
  const hasOverview = isAdmin || (isOverseer && (session.stores || []).length > 1);
  const accessibleStores = isAdmin ? config.stores : config.stores.filter((s) => (session.stores || []).includes(s.id));
  const currentStore = view !== "admin" ? config.stores.find((s) => s.id === view) : null;
  const overviewStores = isAdmin ? config.stores : accessibleStores;

  // "The Board" chosen from the splash: scope it to who's signed in.
  /* The store's headline figures as they stand on screen, so a manager saying
     "that is wrong" sends the number they were looking at rather than a
     description of it. By the time anybody reads the report the import may have
     run again, and then the one fact that mattered is gone. */
  const helpFigures = (() => {
    const M = storeData?.months?.[ym()];
    if (!M) return [];
    const out = [];
    const st = M.stats || {};
    const sum = (f) => Object.values(st).reduce((n, r) => n + (r?.[f] ?? 0), 0);
    const units = sum("internetUnits") + sum("phoneUnits") + sum("showroomUnits") + sum("campaignUnits");
    out.push({ label: `Units delivered, ${ym()}`, value: fmtNum(units) });
    for (const c of CHANNEL_LIST) {
      out.push({ label: `${c.label} units, ${ym()}`, value: fmtNum(sum(c.id + "Units")) });
    }
    const g = storeGoalFor(currentStore, ym());
    if (g) out.push({ label: "Goal to hit this month", value: fmtNum(g.bar) });
    out.push({ label: "People counted on the board", value: String(Object.keys(st).length) });
    return out;
  })();
  const helpCtx = `${appModule || "performance"} / ${tab || ""} at ${view || "no store"}`;
  const helpNode = (
    <>
      <HelpButton config={config} who={session && session.name} store={view}
        context={helpCtx} figures={helpFigures} />
      {helpOpen && <HelpPanel config={config} who={session && session.name} store={view}
        context={helpCtx} figures={helpFigures}
        onClose={() => setHelpOpen(false)} />}
    </>
  );

  if (appModule === "board") {
    return wrap(
      <AppShell entering={entering}
        session={session} isAdmin={isAdmin} isOverseer={isOverseer}
        onSignOut={signOut} onReplayIntro={replayIntro} onHelp={() => setHelpOpen(true)} help={helpNode}
        appModule="board" onToolChange={switchTool} onImport={goImport}>
        <div className="page">
          <BoardLauncher config={config} session={session}
            onLaunch={(storeId) => openLeaderboard(config, storeId)}
            onBack={signOut} />
        </div>
      </AppShell>
    );
  }

  // ---- Live Floor: its own self-contained module (walk-in / showroom queue) ----
  if (appModule === "floor" || appModule === "line" || appModule === "online") {
    return wrap(
      <FloorModule
        queue={appModule}
        config={config}
        session={session}
        accessibleStores={accessibleStores}
        currentStoreId={view !== "admin" && view !== "combined" ? view : null}
        isAdmin={isAdmin}
        onSaveConfig={persistConfig}
        onToolChange={switchTool}
        onImport={goImport}
        shell={{
          entering, session, isAdmin, isOverseer,
          onSignOut: signOut, onReplayIntro: replayIntro,
          onHelp: () => setHelpOpen(true), help: helpNode,
        }} />
    );
  }

  // The Import tab pulses until the day's uploads have landed, which replaces the
  // "all reports are in" chip that had nothing to say the rest of the day.
  const todayImports = storeData?.months?.[ym()]?.imports?.[today()] || {};
  const reportsDue = !!storeData && !(todayImports.appointment && todayImports.video);
  const activityDue = !!storeData && !todayImports.activity;

  // One description of the current tab set, shared by the desktop segmented control
  // and the mobile slide-out drawer so they can never drift apart. Which set applies
  // depends on the same context checks the render below uses.
  let navItems = null, navValue = null, navOnChange = null;
  if (view === "admin" && isAdmin) {
    navItems = [["overview", "Overview"], ["gm", "Summary"], ["access", "Access"], ["tickets", "Tickets"], ["audit", "Audit Log"], ["settings", "Stores"], ["backup", "Backup"]];
    navValue = adminTab; navOnChange = setAdminTab;
  } else if (view === "combined" && isOverseer) {
    navItems = [["board", "Combined Board"], ["gm", "Summary"]];
    navValue = tab === "board" || tab === "gm" ? tab : "board"; navOnChange = setTab;
  } else if (currentStore && storeData && isOverseer) {
    navItems = [["board", "Dashboard"], ["gm", "Summary"], ["history", "History"]];
    navValue = ["board", "gm", "history"].includes(tab) ? tab : "board"; navOnChange = setTab;
  } else if (currentStore && storeData) {
    if (appModule === "activity") {
      navItems = isAdmin
        ? [["checkout", "Check Out"], ["coaching", "Coaching"], ["plates", "License Plates"], ["import", "Import"], ["actstd", "Standards"]]
        : [["checkout", "Check Out"], ["coaching", "Coaching"], ["plates", "License Plates"], ["import", "Import"]];
      navValue = (isAdmin ? ["checkout", "coaching", "plates", "import", "actstd"] : ["checkout", "coaching", "plates", "import"]).includes(tab) ? tab : "checkout";
    } else {
      navItems = isAdmin
        ? [["board", "Dashboard"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["standards", "Targets"], ["roster", "People"]]
        : [["board", "Dashboard"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["roster", "People"]];
      navValue = (isAdmin ? ["board", "import", "gm", "history", "standards", "roster"] : ["board", "import", "gm", "history", "roster"]).includes(tab) ? tab : "board";
    }
    navOnChange = setTab;
  }

  return wrap(
    <AppShell entering={entering}
      session={session} isAdmin={isAdmin} isOverseer={isOverseer}
      onSignOut={signOut} onReplayIntro={replayIntro} onHelp={() => setHelpOpen(true)} help={helpNode}
      appModule={appModule} onToolChange={switchTool} onImport={goImport}
      corner={(isAdmin || session.role === "manager") && currentStore
        ? <AssistWatcher store={currentStore.id} meName={session.name} /> : null}
      brand={currentStore?.brand}
      navItems={navItems} navValue={navValue} navOnChange={navOnChange}
      storeData={storeData}
      storeName={currentStore?.name || (view === "admin" ? "All Stores" : view === "combined" ? "Combined" : "")}
      right={<>
        {saving && <span className="save-dot">Saving…</span>}
        {/* A picker with one entry is furniture. It only appears once there is
            actually somewhere else to go. */}
        {(() => {
          const showAll = isAdmin && appModule !== "activity";
          const showCombined = isOverseer && appModule !== "activity" && (session.stores || []).length > 1;
          const choices = accessibleStores.length + (showAll ? 1 : 0) + (showCombined ? 1 : 0);
          if (choices < 2) return null;
          return (
            <select className="view-select" value={view} onChange={(e) => setView(e.target.value)}>
              {/* Daily Activity is recorded per store, so there is no all-stores view of it */}
              {showAll && <option value="admin">All Stores</option>}
              {showCombined && <option value="combined">Combined (my stores)</option>}
              {accessibleStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          );
        })()}
      </>}>

      {view === "admin" && isAdmin ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["overview", "Overview"], ["gm", "Summary"], ["access", "Access"], ["tickets", "Tickets"], ["audit", "Audit Log"], ["settings", "Stores"], ["backup", "Backup"]]}
              value={adminTab} onChange={setAdminTab} />
          </nav>
          <div key={adminTab} className="page">
            {adminTab === "overview" && <AdminOverview config={config} adminData={adminData} onOpenStore={setView} />}
            {adminTab === "gm" && <GMSummary config={config} data={adminData} stores={config.stores} />}
            {adminTab === "access" && <AccessPanel config={config} session={session} onChange={persistConfig} />}
            {adminTab === "tickets" && <TicketsPanel config={config} onChange={persistConfig} />}
            {adminTab === "backup" && <RepairPanel config={config} />}
            {adminTab === "audit" && <AuditLog config={config} />}
            {adminTab === "settings" && <SettingsPanel config={config} onChange={persistConfig} />}
            {adminTab === "backup" && (
              <BackupPanel config={config} adminData={adminData} session={session}
                onRestoreAll={async (backup) => {
                  await saveShared(CONFIG_KEY, backup.config);
                  saveShared(PUBLIC_STORES_KEY, publicSlice(backup.config)).catch(() => {});
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
                  /* A rollback has to be able to undo a deletion, and the plate log
                     records deletions as tombstones — which would otherwise filter
                     the restored plates straight back out on the next merge. Lift the
                     mark from anything this restore point actually contains. */
                  restored.plateGone = { ...(current.plateGone || {}) };
                  restored.plateRegGone = { ...(current.plateRegGone || {}) };
                  for (const list of Object.values(snap.data?.plates || {}))
                    for (const p of list || []) if (p && p.id) delete restored.plateGone[p.id];
                  for (const r of snap.data?.plateRegistry || []) if (r && r.id) delete restored.plateRegGone[r.id];
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
        <NoAccessPanel session={session} config={config} onRecheck={refreshProfile} />
      ) : storeMismatch ? (
        /* This has to be tested BEFORE the loading branch. A mismatch sets storeData
           to null on purpose, so the banner further down — which renders inside the
           loaded board — could never be reached: the store simply appeared never to
           load, and the screen asked for a reload at a problem no reload can touch. */
        <StoreMismatch config={config} mismatch={storeMismatch} isAdmin={isAdmin} />
      ) : (!storeData || storeHeld) ? (
        /* A spinner with no end is the worst thing this screen can show: it says
           "wait" for ever and gives nobody, including whoever is asked about it
           later, anything to act on. After fifteen seconds it stops claiming to be
           loading and says what it knows. */
        storeLoadStuck
          ? <StoreStuck store={currentStore} detail={storeLoadError} onRetry={() => window.location.reload()} />
          : storeHeld ? <LoadingScreen label={`Loading ${currentStore?.name || "store"}`} /> : null
      ) : isOverseer ? (
        <>
          <nav className="seg-wrap no-print">
            <SegControl
              items={[["board", "Dashboard"], ["gm", "Summary"], ["history", "History"]]}
              value={["board", "gm", "history"].includes(tab) ? tab : "board"} onChange={setTab} />
            {(tab === "board" || !["gm", "history"].includes(tab)) &&
              <AssocSearch value={assocQuery} onChange={setAssocQuery} store={currentStore} />}
          </nav>
          <div key={view + tab} className="page">
            {(tab === "board" || !["gm", "history"].includes(tab)) && <Board config={config} store={currentStore} data={storeData} onMove={moveAssociate} onSetRestriction={setRestriction} readOnly
              query={assocQuery} focusName={focusAssoc} onFocus={setFocusAssoc} />}
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
                attentionId={activityDue ? "import" : null}
                renderExtra={(id) => (id === "import" ? <ImportBadge storeData={storeData} activity /> : null)} />
            ) : (
              <SegControl
                items={isAdmin
                  ? [["board", "Dashboard"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["standards", "Targets"], ["roster", "People"]]
                  : [["board", "Dashboard"], ["import", "Import"], ["gm", "Summary"], ["history", "History"], ["roster", "People"]]}
                value={(isAdmin
                  ? ["board", "import", "gm", "history", "standards", "roster"]
                  : ["board", "import", "gm", "history", "roster"]).includes(tab) ? tab : "board"}
                onChange={setTab}
                attentionId={reportsDue ? "import" : null}
                renderExtra={(id) => (id === "import" ? <ImportBadge storeData={storeData} /> : null)} />
            )}
            {appModule !== "activity" && tab === "board" &&
              <AssocSearch value={assocQuery} onChange={setAssocQuery} store={currentStore} />}
            {appModule === "activity" && (tab === "checkout" || !["coaching", "plates", "import", "actstd"].includes(tab)) &&
              <AssocSearch value={assocQuery} onChange={setAssocQuery} store={currentStore} />}
          </nav>
          <div key={view + tab + appModule} className="page">
            {storeLoadFailed && (
              <div className="load-warn">
                This store's data didn't load fully, so changes are paused to protect your records. Reload the page,
                confirm everything is showing, then continue.
                {storeLoadError ? <> The load reported: {storeLoadError}</> : null}
              </div>
            )}
            {appModule === "activity" ? (
              <>
                {(tab === "checkout" || !["coaching", "plates", "import", "actstd"].includes(tab)) && <CheckOutTracker config={config} store={currentStore} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} query={assocQuery} onCoach={() => setTab("coaching")} />}
                {tab === "coaching" && <CoachingPanel config={config} store={currentStore} data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} userName={session.name} />}
                {tab === "plates" && <PlateTracker data={storeData} onChange={(d, audit) => persistStore(view, d, audit)} userName={session.name} storeId={view} saving={saving} onRemote={adoptRemotePlates} />}
                {tab === "import" && <ImportPanel store={currentStore} config={config} data={storeData} log={importLog} dropActive={dropActive} setDropActive={setDropActive} onFiles={handleFiles} fileRef={fileRef} activity activityDay={activityDay} setActivityDay={setActivityDay} activityScope={activityScope} setActivityScope={setActivityScope} flags={importFlags} onHelp={() => setShowHelp(true)} onChange={(d, audit) => persistStore(view, d, audit)} />}
                {tab === "actstd" && isAdmin && <><ActivityStandardsEditor config={config} storeId={view} onChange={persistConfig} />
                  <ChecklistEditor config={config} storeId={view} onChange={persistConfig} /></>}
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
                    {/* A phone gets the Board as one screen: the site's hero and one
                        row a person, everything a tap into a pop. The desk keeps the
                        hero, the focus grid and the role cards. */}
                    {phone ? (
                      <BoardRoomPhone config={config} store={currentStore} data={storeData} session={session}
                        canSetGoal={isAdmin || session.role === "manager"} onSaveConfig={persistConfig}
                        onSetRestriction={setRestriction}
                        onCoach={() => { coachAfter.current = true; switchTool("activity"); }} />
                    ) : (<>
                    <StoreHero config={config} store={currentStore} data={storeData} session={session} onGoTab={setTab}
                      filter={boardFilter} onFilter={setBoardFilter} onFocus={setFocusAssoc}
                      canSetGoal={isAdmin || session.role === "manager"} onSaveConfig={persistConfig} />
                    {/* The delivery chart now lives inside the hero's rotating display. */}
                    <Board config={config} store={currentStore} data={storeData}
                      onMove={moveAssociate} onSetRestriction={setRestriction}
                      filter={boardFilter} onFilter={setBoardFilter} onClearFilter={() => setBoardFilter(null)}
                      query={assocQuery} focusName={focusAssoc} onFocus={setFocusAssoc}
                      onIgnore={ignoreNames} />
                    </>)}
                  </div>
                )}
                {/* The gutter the Dashboard has had all along. These four were
                    rendered straight into .page, which carries no padding, so they
                    ran edge to edge on anything wider than a laptop. */}
                {tab === "import" && <div className="tab-page"><ImportPanel store={currentStore} config={config} data={storeData} log={importLog} dropActive={dropActive} setDropActive={setDropActive} onFiles={handleFiles} fileRef={fileRef} activityDay={activityDay} setActivityDay={setActivityDay} activityScope={activityScope} setActivityScope={setActivityScope} flags={importFlags} onHelp={() => setShowHelp(true)} onChange={(d, audit) => persistStore(view, d, audit)} /></div>}
                {tab === "gm" && <div className="tab-page"><GMSummary config={config} data={{ [view]: storeData }} stores={[currentStore]} /></div>}
                {tab === "history" && <div className="tab-page"><HistoryPanel config={config} store={currentStore} data={storeData} /></div>}
                {tab === "standards" && isAdmin && <div className="tab-page"><TargetsEditor config={config} storeId={view} data={storeData} onChange={persistConfig} /></div>}
                {tab === "roster" && (
                  <div className="tab-page">
                    <StorePeoplePanel config={config} data={storeData} storeId={view}
                      storeName={currentStore?.name} allStores={accessibleStores}
                      onChange={(d, audit) => persistStore(view, d, audit)} userName={session.name} />
                  </div>
                )}
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
      {wrongReport && (
        <WrongReportStop fileName={wrongReport.fileName} onClose={() => setWrongReport(null)} />
      )}
      {showHelp && (
        <DeliveryGuideModal onClose={() => setShowHelp(false)} />
      )}
      {introPlaying && (
        <SageArrival
          onComplete={() => {
            setIntroDone(true);
            setIntroPlaying(false);
          }} />
      )}
    </AppShell>
  );
}














// The only fields the board draws. Anything not on this list never leaves the
// private store row, which is the whole point of publishing a separate one.

function buildBoardPayload(config, storeId, sdata) {
  const store = (config?.stores || []).find((s) => s.id === storeId);
  const onBoard = new Set((config?.roles || []).filter((r) => r.onBoard !== false).map((r) => r.id));
  const key = ym();
  const src = ((sdata && sdata.months) || {})[key]?.stats || {};
  const stats = {}; const roster = []; const ticker = [];
  const std = { ...DEFAULT_ACTIVITY_STANDARDS, ...(store?.activityStandards || {}) };
  const gone = departedNames(sdata);
  for (const a of (sdata && sdata.roster) || []) {
    if (!a.roleId || !onBoard.has(a.roleId)) continue;
    if (gone.has(norm(a.name))) continue;
    /* The id rides along for the phone: an account is linked to a roster id, and
       on a morning the floor is not open yet the board row is the only public
       place that can turn that id back into a name. */
    roster.push({ id: a.id, name: a.name, roleId: a.roleId });
    const s = src[norm(a.name)];
    if (s) {
      const keep = {};
      for (const f of BOARD_STAT_FIELDS) if (s[f] !== undefined) keep[f] = s[f];
      stats[norm(a.name)] = keep;
    }
    try {
      const { dir, len } = currentStreak(sdata, a, std);
      if (dir === "up" && len >= 3) ticker.push(`&#128293; ${a.name} is on a ${len}-day streak`);
    } catch (e) {}
  }
  const extras = phoneExtras(sdata, roster.map((r) => ((sdata && sdata.roster) || []).find((a) => a.name === r.name) || r), key, norm);
  /* Who can claim a name at sign-up: everyone still on the roster, whatever
     their role. The wall shows only the board roles, but a manager or a person
     with no role yet is still somebody who has to be able to say "that is me". */
  const people = (((sdata && sdata.roster) || []))
    .filter((a) => a && a.id && a.name && !gone.has(norm(a.name)))
    .map((a) => ({ id: a.id, name: a.name, roleId: a.roleId || null }));
  return {
    storeId,
    storeName: store?.name || "Store",
    icon: store?.icon || null,
    goals: extras.goals,
    off: extras.off,
    brand: store?.brand || DEFAULT_BRAND,
    thresholds: normThresholds(store?.thresholds),
    roles: (config?.roles || []).filter((r) => r.onBoard !== false).map((r) => ({ id: r.id })),
    boardDisplay: (sdata && sdata.boardDisplay) || null,
    ym: key,
    ticker,
    roster,
    people,
    departed: [...gone],
    months: { [key]: { stats } },
    updatedAt: new Date().toISOString(),
  };
}

// Publish the TV row. Called after every save so a casted screen never goes stale.
// A failure here must never fail the save, but it must not vanish either: a board
// row that never got written looks exactly like a board that was never opened.
async function publishBoard(config, storeId, sdata) {
  try {
    // Today's floor figures, in the one place a signed-out phone can read them.
    const t = today();
    const rows = ((sdata && sdata.activity) || {})[t];
    const store = (config?.stores || []).find((s2) => s2.id === storeId);
    const bar = (store?.activityStandards || {}).rockEdStars ?? DEFAULT_ACTIVITY_STANDARDS.rockEdStars;
    if (rows) {
      try {
        const key = floorStatsKey(storeId, t);
        const slim = slimFloorStats(withChannels(withRocked(sdata, t, rows, bar), sdata, t));
        /* The hours ride on this row and are cumulative, so what is already
           there has to be read back before it is written over: the whole point
           is that earlier hours survive an import that only knows about the
           totals as they stand now.

           Read with throwOnError, which is the difference between "there is
           nothing there" and "we could not find out". loadShared normally
           swallows a failed read and hands back the fallback, and a null
           fallback here means stampHours starts from scratch and the day's
           accumulated buckets are gone — silently, and unrecoverably, since an
           hour that was never recorded cannot be recovered. A read that failed
           is not evidence of an empty row.

           The cost of throwing is that this one publish is skipped. The board
           row is written many times a day and the next one puts it right; the
           hours would not have come back at all. */
        const prev = await loadShared(key, null, true);
        slim.__hours = stampHours(prev && prev.__hours, rows, new Date());
        await saveShared(key, slim);
      } catch (e) {}
    }
    const ok = await saveShared(boardKey(storeId), buildBoardPayload(config, storeId, sdata));
    if (!ok) console.error("board publish failed", boardKey(storeId), lastSaveError);
    return { ok, err: ok ? null : (lastSaveError || "unknown") };
  } catch (e) {
    console.error("board publish failed", boardKey(storeId), e);
    return { ok: false, err: (e && (e.message || e.code)) || String(e) };
  }
}


// Opens a standalone, auto-refreshing leaderboard in a new window sized for a TV.
async function openLeaderboard(config, storeId) {
  const w = window.open("", "lpc_leaderboard_" + storeId, "width=1600,height=900");
  /* Said on the page rather than in a message box: a blocked pop-up usually
     comes with the browser's own alert suppressed too, so the box nobody sees
     is the only thing that ever explained it. */
  if (!w) return false;
  // Publish the sanitized TV row first, so this window and any casted screen are
  // reading the exact same thing.
  let sdata = null;
  try { sdata = await loadStore(storeId); } catch (e) {}
  const board = buildBoardPayload(config, storeId, sdata || {});
  const pub = await publishBoard(config, storeId, sdata || {});
  if (!pub.ok) {
    alert("This board opened here, but it could NOT be published for the TVs.\n\nWhat the database said:\n" + pub.err
      + "\n\nA casted screen will keep showing whatever it already had. This is almost always a write-permission rule on the board keys. Use the Help button to report it with these details.");
  }
  const payload = {
    ...board,
    storeKey: boardKey(storeId),
    /* The other stores this screen could hand over to. On the window payload
       rather than in the published row: the row goes in the database and every
       board would then carry a copy of the group's store list for no reason. */
    siblings: (config?.stores || [])
      .filter((x) => x.id !== storeId)
      .map((x) => ({ id: x.id, name: x.name })),
    db: { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY },
    tokens: null,
  };
  w.document.open();
  const { LEADERBOARD_HTML } = await managerChunk();
  w.document.write(LEADERBOARD_HTML(payload));
  w.document.close();
  return true;
}

/* ---------------- Queue boards on a wall ----------------
   A screen showing who is up, in order, for one queue. Pointed at
   ?qboard={storeId}&k=line|online|floor and left alone: it reads the queue row,
   which is already readable without an account, refreshes every five seconds like
   the floor phones do, and reloads itself when a new build ships.

   Deliberately not the leaderboard. That board is about the month; this is about
   the next ten minutes, so it says one thing large: who is next. */
/* The three queues, in one table. All three answer the same question — who is
   next — over a different channel, and each carries its own colour and glyph
   everywhere it appears: this board, and the picker in the bottom bar. It was
   written out twice before, which is how a colour drifts. */
const QUEUE_TOOLS = [
  { id: "floor",  label: "Live Floor", glyph: "door",  accent: "#10B981", count: "on the floor" },
  { id: "line",   label: "Phone Line",   glyph: "phone", accent: "#5566F0", count: "in line" },
  { id: "online", label: "Online",     glyph: "globe", accent: "#8B5CF6", count: "in the queue" },
];
const queueTool = (id) => QUEUE_TOOLS.find((q) => q.id === id) || QUEUE_TOOLS[1];

function QueueBoard({ storeId, kind }) {
  const [row, setRow] = useState(null);
  const [board, setBoard] = useState(null);   // the published board row: names, month units
  const [err, setErr] = useState(false);
  useBuildWatchdog();

  const variant = queueTool(kind);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const d = kind === "floor"
          ? await loadRowIfChanged(FLOOR_TABLE, floorRowId(storeId, today()))
          : await loadRowIfChanged(QUEUE_TABLE, queueRowId(storeId, today(), kind === "online" ? "online" : "line"));
        if (dead) return;
        if (d === undefined) { setErr(true); return; }   // read failed: hold what is shown
        if (d === "same") { setErr(false); return; }
        setRow(d || null); setErr(false);
      } catch (e) { if (!dead) setErr(true); }
    };
    pull();

    /* A five second poll is for a phone in a pocket and wrong for a wall: a
       manager assigns somebody and the screen argues with the room for a few
       seconds. Postgres pushes the change instead, so the board turns over as the
       click happens. The poll stays underneath as a safety net, slowed right down,
       because a dropped socket must not leave a screen frozen for the afternoon. */
    const rowId = kind === "floor"
      ? floorRowId(storeId, today())
      : queueRowId(storeId, today(), kind === "online" ? "online" : "line");
    const table = kind === "floor" ? FLOOR_TABLE : QUEUE_TABLE;
    let channel = null;
    if (supabase) {
      try {
        channel = supabase.channel(`qb:${table}:${rowId}`)
          .on("postgres_changes",
            { event: "*", schema: "public", table, filter: `id=eq.${rowId}` },
            () => { if (!dead) pull(); })
          .subscribe();
      } catch (e) { /* no realtime: the poll below still carries it */ }
    }
    const t = setInterval(pull, channel ? 20000 : 5000);
    const nightly = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 4 && d.getMinutes() < 6) window.location.reload();
    }, 5 * 60 * 1000);
    return () => {
      dead = true; clearInterval(t); clearInterval(nightly);
      if (channel) { try { supabase.removeChannel(channel); } catch (e) {} }
    };
  }, [storeId, kind]);

  // The published board row carries this month's units, which is what decides the
  // top three. Read once a minute: it moves slowly and the queue does not.
  useEffect(() => {
    let dead = false;
    const pull = () => loadSharedIfChanged(boardKey(storeId), "board|" + storeId)
      .then((b) => { if (!dead && b && b !== "same") setBoard(b); }).catch(() => {});
    pull();
    const t = setInterval(pull, 60000);
    return () => { dead = true; clearInterval(t); };
  }, [storeId]);

  /* The store's top three for units this month. Ranked here rather than published,
     so the board and the leaderboard can never disagree about who is ahead. */
  const rank = useMemo(() => {
    const stats = ((board && board.months) || {})[board && board.ym] || null;
    if (!stats || !stats.stats) return {};
    const rows = Object.entries(stats.stats).map(([k, s]) => ({
      k, units: (s.internetUnits || 0) + (s.phoneUnits || 0) + (s.showroomUnits || 0) + (s.campaignUnits || 0),
    })).filter((r) => r.units > 0).sort((a, b) => b.units - a.units);
    const out = {};
    rows.slice(0, 3).forEach((r, i) => { out[r.k] = i + 1; });
    return out;
  }, [board]);

  const roster = (row && row.roster) || [];
  const entry = (id) => roster.find((r) => r.id === id) || null;
  const nameOf = (id) => (entry(id) || {}).label || "";
  const fullOf = (id) => (entry(id) || {}).name || (entry(id) || {}).label || "";
  const rankOf = (id) => rank[norm(fullOf(id))] || 0;
  const langsOf = (id) => ((entry(id) || {}).langs || []);

  const line = (row && row.line) || [];
  const waiting = line.filter((p) => p.status === "waiting" && !isTestId(p.id));
  const busy = line.filter((p) => p.status !== "waiting" && !isTestId(p.id));
  const next = waiting[0] || null;

  /* The way people actually get in the queue.
     A printed code goes stale the moment somebody reprints it, and on a wall there
     is a screen already showing the queue, so the code belongs there. It surfaces
     on its own every couple of minutes, holds long enough to be scanned from a few
     feet away, and goes again. Nobody has to be asked to put it up. */
  const signInUrl = (row && row.token)
    ? (kind === "floor"
        ? `${window.location.origin}${window.location.pathname}?f=${encodeURIComponent(storeId)}&d=${today()}&t=${encodeURIComponent(row.token)}`
        : queueSignInUrl(storeId, today(), row.token, kind === "online" ? "o" : "q"))
    : "";
  const [scan, setScan] = useState(false);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!signInUrl || pinned) return;
    let t1 = null, t2 = null;
    const cycle = () => {
      setScan(true);
      t2 = setTimeout(() => setScan(false), 22000);   // long enough to walk over and scan
    };
    t1 = setInterval(cycle, 150000);                   // every two and a half minutes
    return () => { clearInterval(t1); clearTimeout(t2); };
  }, [signInUrl, pinned]);
  const pod = waiting.slice(1, 4);
  const rest = waiting.slice(4, 9);

  const warmOf = (id) => { const r = rankOf(id); return r ? ` qb-warm qb-p${r}` : ""; };
  /* Languages, then earned strengths, then skills. A strength is set apart because
     it was earned rather than typed: it is the one thing on this wall that nobody
     can give themselves. */
  const tagPills = (id) => {
    const e = entry(id) || {};
    const l = e.langs || [], st = e.strengths || [], sk = e.skills || [];
    if (!l.length && !st.length && !sk.length) return null;
    const skillLabel = (t) => (DEFAULT_TAGS.find((x) => x.id === t) || {}).label || t;
    const strengthLabel = (t) => (STRENGTH_METRICS.find((x) => x.id === t) || {}).label || t;
    return (
      <span className="qb-langs">
        {l.map((x) => <span key={"l" + x} className="qb-lang" title={langName(x)}>{x}</span>)}
        {st.map((x) => <span key={"s" + x} className="qb-lang qb-strength">{strengthLabel(x)}</span>)}
        {sk.map((x) => <span key={"k" + x} className="qb-lang qb-skill">{skillLabel(x)}</span>)}
      </span>
    );
  };
  const avatar = (id, cls) => (
    <span className={"qb-av " + cls} style={{ background: `hsl(${hueFromName(fullOf(id))} 62% 62%)` }}>{initialsOf(fullOf(id))}</span>
  );
  const stepH = [150, 118, 92];

  return (
    <div className="qb" style={{ "--a": variant.accent }}>
      <div className="qb-hd">
        <span className="qb-tag"><span className="qb-live" /><PixIcon glyph={variant.glyph} size={22} /> {variant.label}</span>
        <span className="qb-store">{(row && row.storeName) || ""}</span>
        <span className="qb-hd-right">
          <span className="qb-pill"><b>{waiting.length}</b> {variant.count}</span>
          {next && <span className="qb-pill"><b>{qWaitLabel(qMinsSince(next.joinedAt))}</b> longest</span>}
        </span>
      </div>

      {err && <div className="qb-empty">Cannot reach the queue. This screen keeps trying on its own.</div>}
      {!err && !next && <div className="qb-empty">Nobody is up yet.</div>}

      {next && (
        <>
          <div className="qb-top">
            <div className={"qb-hero" + warmOf(next.id)}>
              <div className="qb-cap">Next up</div>
              <div className="qb-name">{nameOf(next.id)}</div>
              <div className="qb-sub">{qWaitLabel(qMinsSince(next.joinedAt))} waiting {tagPills(next.id)}</div>
            </div>
            <div className="qb-pod">
              {pod.map((p, i) => (
                <div key={p.id} className={"qb-col" + warmOf(p.id)}>
                  {avatar(p.id, "qb-av-md")}
                  <div className="qb-cnm">{nameOf(p.id)}</div>
                  <div className="qb-cw">{qWaitLabel(qMinsSince(p.joinedAt))}</div>
                  {tagPills(p.id)}
                  <div className="qb-step" style={{ height: stepH[i] }}>{i + 2}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="qb-strip">
            {rest.map((p, i) => (
              <div key={p.id} className={"qb-card" + warmOf(p.id)}>
                <div className="qb-chead">
                  {avatar(p.id, "qb-av-sm")}
                  <span className="qb-pos">{i + 5}</span>
                </div>
                <div className="qb-cnm qb-left">{nameOf(p.id)}</div>
                <div className="qb-crow">
                  <span className="qb-cw">{qWaitLabel(qMinsSince(p.joinedAt))}</span>
                  {tagPills(p.id)}
                </div>
              </div>
            ))}
            {waiting.length > 9 && <div className="qb-card qb-more">+{waiting.length - 9} more</div>}
          </div>
        </>
      )}

      {/* Tap or click the screen to hold the code up, tap again to release it. Useful
          at a shift change, when everybody needs it at once. */}
      {signInUrl && (
        <button className="qb-scan-toggle" onClick={() => { setPinned((v) => !v); setScan(!pinned); }}>
          {pinned ? "Hide the code" : "Show the code"}
        </button>
      )}

      {signInUrl && (scan || pinned) && (
        <div className={"qb-scan" + (pinned ? " qb-scan-pin" : "")}>
          <div className="qb-scan-card">
            <div className="qb-scan-cap">{variant.label}</div>
            <div className="qb-scan-title">Scan to check in</div>
            <div className="qb-scan-qr"><QueueQR url={signInUrl} cell={9} /></div>
            <div className="qb-scan-sub">Point a phone camera at the code</div>
          </div>
        </div>
      )}

      {busy.length > 0 && (
        <div className="qb-busy">
          <span className="qb-busy-lbl">Not available</span>
          {busy.slice(0, 8).map((p) => (
            <span key={p.id} className="qb-chip">
              <PixIcon glyph={p.status === "customer" ? "car" : p.status === "lunch" ? "lunch" : "away"} size={15} />
              {nameOf(p.id)}<i>{p.status === "customer" ? "with a customer" : p.status === "lunch" ? "lunch" : "away"}</i>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Casted board (kiosk) ----------------
   A TV is pointed at ?board=<storeId> and left alone. Because this is a real page
   and not a written-into popup, a reboot recovers on its own and a reload picks up
   whatever code is currently deployed. Nobody signs in: it reads the published
   board row with the anon key and nothing else. */

// Reload when a new build ships, so a screen that has been up for weeks is never
// running last month's layout. Vercel fingerprints its asset filenames, so a plain
// comparison against the served page is enough, no version endpoint needed.
function useBuildWatchdog() {
  useEffect(() => {
    const names = (nodes) => nodes.map((n) => String(n).split("/").pop()).filter(Boolean);
    const mine = names([...document.querySelectorAll('script[src],link[rel="stylesheet"]')]
      .map((n) => n.getAttribute("src") || n.getAttribute("href")).filter(Boolean));
    let dead = false;
    const check = async () => {
      if (dead || !mine.length) return;
      try {
        const res = await fetch(window.location.pathname + "?_build=" + Date.now(), { cache: "no-store" });
        if (!res.ok) return;
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        const theirs = names([...doc.querySelectorAll('script[src],link[rel="stylesheet"]')]
          .map((n) => n.getAttribute("src") || n.getAttribute("href")).filter(Boolean));
        if (theirs.length && theirs.some((n) => !mine.includes(n)) && !dead) window.location.reload();
      } catch (e) { /* offline: try again next time */ }
    };
    const build = setInterval(check, 10 * 60 * 1000);
    // A clean start every night. This is also what rolls the board onto a new month,
    // since the month it draws is fixed when the page loads.
    const nightly = setInterval(() => {
      const d = new Date();
      if (d.getHours() === 4 && d.getMinutes() < 6) window.location.reload();
    }, 5 * 60 * 1000);
    return () => { dead = true; clearInterval(build); clearInterval(nightly); };
  }, []);
}



/* ---------------- What a salesperson sees about themselves ----------------
   Two things they could never see before without asking a manager: what they are
   meant to get done today, and how they are actually doing. Both read from data
   the tool already holds. Nothing new is asked of anyone. */
/* Every one of these sheets is a full-screen overlay, so it belongs at the top of
   the document and nowhere else.

   Help is opened from inside My day, so its overlay was a position:fixed element
   nested inside .help-sheet. That sheet runs the helpUp entry animation with
   animation-fill-mode:both, and a filling transform animation leaves the computed
   transform as an identity matrix rather than none. Measured in the browser: the
   sheet reports transform matrix(1,0,0,1,0,0) forever after the animation ends, and
   ANY transform other than none makes an element the containing block for fixed
   descendants. So the Help overlay sized itself against the scrolled sheet instead
   of the screen and was clipped by the sheet's overflow, which is why it surfaced
   part-way up the checklist rather than rising from the bottom. A fixed probe in
   that position read top=-343 h=787 against an 844px viewport; with the animation
   removed it read top=0 h=844.

   The fill mode is fixed below too, but this portal is the guard that holds: it
   keeps working whatever transform, filter or containment an ancestor later grows. */
function Overlay({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.body);
}

/* ---- Floorside helpers ------------------------------------------------- */
/* Which field on the activity row each of the day's five numbers reads. Named
   here rather than inline so the one-number screen and the bands can never
   disagree about which figure they are drawing. */
const STAT_FIELD = {
  calls: "calls", video: "video", tasks: "tasks",
  appt: "apptScheduled", shown: "apptShow",
};
const shortDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${d.toLocaleDateString([], { month: "short" }).toUpperCase()}`;
};
const longDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
};

/* Three things worth knowing about the fortnight, worked out rather than
   written: the best run against the bar, the weakest weekday, and the days
   nothing was logged at all. Every one of them is silent when it has nothing
   true to say — a read-out that invents a finding stops being read. */
function SfWorthKnowing({ values, days, target }) {
  const rows = [];
  if (target > 0) {
    let run = 0, best = 0;
    for (const v of values) { if (v >= target) { run++; best = Math.max(best, run); } else run = 0; }
    if (best > 0) rows.push({ tone: "g", label: "Best run", text: `${best} day${best === 1 ? "" : "s"} straight at or over ${target}` });
  }
  // weakest weekday, only once a day of the week has turned up twice
  const byDow = {};
  values.forEach((v, i) => {
    const d = new Date(days[i] + "T12:00:00").getDay();
    (byDow[d] = byDow[d] || []).push(v);
  });
  const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let worst = null;
  for (const d of Object.keys(byDow)) {
    if (byDow[d].length < 2) continue;
    const avg = byDow[d].reduce((x, y) => x + y, 0) / byDow[d].length;
    if (!worst || avg < worst.avg) worst = { d: +d, avg };
  }
  if (worst) rows.push({ tone: "y", label: "Quietest", text: `${dowNames[worst.d]}s, ${Math.round(worst.avg)} on average` });

  const blanks = values.map((v, i) => (v <= 0 ? days[i] : null)).filter(Boolean);
  if (blanks.length === 1) rows.push({ tone: "r", label: "Nothing logged", text: shortDay(blanks[0]) });
  else if (blanks.length > 1) rows.push({ tone: "r", label: "Nothing logged", text: `${blanks.length} days` });

  if (!rows.length) return null;
  return (
    <div className="sf-worth">
      <div className="sf-worth-h">
        <h4>Worth knowing</h4>
        <span>last {values.length} days</span>
      </div>
      <div className="sf-worth-rows">
        {rows.map((r, i) => (
          <div key={i} className="sf-worth-row">
            <span className={"sf-worth-dot t-" + r.tone} />
            <span><b>{r.label}</b> &mdash; {r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyDay({ store, date, meId, meName, stats, std, config, updatedAt, monthStats, thresholds, list, variant, onClose, light = false }) {
  const LIST = (Array.isArray(list) && list.length) ? list : DEFAULT_CHECKLIST;
  /* Three of these tick themselves. If the report says the calls were made, asking
     someone to also tell us they were made is busywork, and worse, it invites a tick
     on a day the work did not happen. The hand-ticked ones are the things no report
     can see. */
  const a = stats || {};
  const autoFor = (c) => {
    if (!c.from) return null;
    const got = a[c.from] || 0;
    // Tasks are measured against what was actually posted that day, not a standard:
    // the pile is different every morning.
    const need = c.target === "__posted" ? (a.tasksPosted || 0) : c.target ? (std[c.target] || 0) : 1;
    return { got, need, done: need > 0 ? got >= need * 0.8 : got > 0, left: Math.max(0, need - got) };
  };

  const [ticks, setTicks] = useState(() => {
    const out = {};
    for (const c of LIST) {
      try { out[c.id] = localStorage.getItem(checklistKey(store, date, meId + ":" + c.id)) === "1"; }
      catch (e) { out[c.id] = false; }
    }
    return out;
  });
  const toggle = (c) => {
    if (c.from) return;                     // the reports own this one
    setTicks((p) => {
      const v = !p[c.id];
      try { localStorage.setItem(checklistKey(store, date, meId + ":" + c.id), v ? "1" : "0"); } catch (e) {}
      return { ...p, [c.id]: v };
    });
    buzz(10);
  };
  const isDone = (c) => (c.from ? !!(autoFor(c) || {}).done : !!ticks[c.id]);
  const doneCount = LIST.filter(isDone).length;

  // A quiet celebration the first time an automatic one lands, so the moment the
  // reports catch up is actually noticed rather than silently changing colour.
  const seen = useRef(null);
  const [pop, setPop] = useState(null);
  useEffect(() => {
    const now = LIST.filter((c) => c.from && isDone(c)).map((c) => c.id).join(",");
    if (seen.current !== null && now !== seen.current) {
      const fresh = LIST.find((c) => c.from && isDone(c) && !seen.current.includes(c.id));
      if (fresh) { setPop(fresh.id); buzz([18, 40, 18]); setTimeout(() => setPop(null), 1600); }
    }
    seen.current = now;
  }, [a.calls, a.video, a.tasks]); // eslint-disable-line

  const stamp = updatedAt ? new Date(updatedAt) : null;

  /* Closing rates, month to date. A single day of these means nothing: one showroom
     lead and one sale is not a hundred per cent. They come from the month stats the
     board already publishes for this store. */
  const closers = (() => {
    const s = (monthStats && monthStats[norm(meName)]) || null;
    if (!s) return [];
    // The same prevPct the wall reads its triangles from, off the same published row.
    const prev = s.prevPct || {};
    const one = (k, label, unitsF, pctF, leadsF) => ({
      k, label,
      units: s[unitsF] == null ? null : s[unitsF],
      leads: s[leadsF] == null ? null : s[leadsF],
      pct: s[pctF] == null ? null : s[pctF],
      prev: prev[k] == null ? null : prev[k],
    });
    return [
      one("showroom", "Showroom", "showroomUnits", "showroomPct", "showroomLeads"),
      one("phone", "Phone", "phonePct" in s ? "phoneUnits" : "phoneUnits", "phonePct", "phoneLeads"),
      one("internet", "Internet", "internetUnits", "internetPct", "internetLeads"),
    ].filter((c) => c.pct != null || (c.units != null && c.units > 0));
  })();

  /* These percentages are graded on the wall, so they are graded the same way in the
     salesperson's hand. Both the thresholds and the previous reading travel on the
     published board row, so this is not a second opinion about the numbers, it is the
     wall's own arithmetic re-run on the phone. Inventing a separate scale here would
     eventually put a green number on the TV and an amber one in their pocket, and
     nobody on the floor would know which to believe. */
  const thr = normThresholds(thresholds);
  const toneOf = (pct, ch) => {
    if (pct == null) return "dim";
    const t = thr[ch] || DEFAULT_THRESHOLDS[ch] || { green: 20, yellow: 10 };
    const v = pct * 100;
    return v >= t.green ? "g" : v >= t.yellow ? "y" : "r";
  };
  const TONE_MARK = { g: "check", y: "warn", r: "close", dim: "dot" };
  // Direction and distance since the previous report, in percentage points, with the
  // board's own 0.05pt deadband so a rounding wobble is never dressed up as a trend.
  const moveOf = (cur, prv) => {
    if (cur == null || prv == null) return { dir: "flat", delta: "" };
    const d = (cur - prv) * 100;
    if (d > 0.05) return { dir: "up", delta: "+" + d.toFixed(1) };
    if (d < -0.05) return { dir: "down", delta: d.toFixed(1) };
    return { dir: "flat", delta: "" };
  };

  /* The one channel worth naming today: furthest under its own bar, measured as a
     share of the bar so a 5% internet rate against 20 outranks a 28% showroom rate
     against 30. Silent when everything is at or over, because inventing something to
     fix on a good month is how a coaching tool stops being read. */
  const FOCUS_PLAY = {
    internet: "Send a personalized video on every new lead before you do anything else with it. It is the single biggest lever on this number.",
    phone: "Take the phone ups you are passing on, and get the appointment set before you hang up.",
    showroom: "Ask for the appointment before they leave the lot, and log the be-back the same day.",
  };
  const focus = (() => {
    const cand = closers
      .filter((c) => c.pct != null && thr[c.k] && thr[c.k].green > 0)
      .map((c) => ({ ...c, green: thr[c.k].green, share: (c.pct * 100) / thr[c.k].green }))
      .filter((c) => c.share < 1)
      .sort((x, y) => x.share - y.share)[0];
    if (!cand) return null;
    return { label: cand.label, pct: cand.pct, green: cand.green,
      tone: toneOf(cand.pct, cand.k), play: FOCUS_PLAY[cand.k] || "" };
  })();

  const tiles = [
    { k: "calls", label: "Calls", v: a.calls || 0, target: std.minCalls, tone: "a" },
    { k: "video", label: "Videos", v: a.video || 0, target: std.minVideos, tone: "b" },
    { k: "tasks", label: "Tasks done", v: a.tasks || 0, target: a.tasksPosted || null, tone: "c" },
    { k: "appt", label: "Appts set", v: a.apptScheduled || 0, target: null, tone: "d" },
    { k: "shown", label: "Appts shown", v: a.apptShow || 0, target: null, tone: "e" },
  ];

  /* Three screens, not one long scroll: where you are today, that same day as a
     list, and — new — any one of those five numbers on its own with its last ten
     days beside it. They share the frame the way in uses, so crossing from the
     queue into your day is a change of subject rather than a change of app. */
  const [view, setView] = useState("day");
  const [openK, setOpenK] = useState("calls");

  /* The activity rows are already one per store per day, so a fortnight of one
     person's numbers is a single query against keys we can name in advance.

     Read on the way in rather than when the one-number screen is opened: the
     same ten days are what say whether somebody has missed the standard three
     times in the last five, and that has to be known before the day is drawn
     rather than after they have tapped into it. */
  const [series, setSeries] = useState(null);
  useEffect(() => {
    if (!meName) return;
    let dead = false;
    loadMyDays(store, date, [norm(meName)]).then((d) => { if (!dead) setSeries(d); });
    return () => { dead = true; };
  }, [store, date, meName]);

  /* ---- three of the last five ----------------------------------------------
     Jorge: "if someone in the store keeps not getting to their goal I want it to
     flag it and make it obvious for them and they can't do anything in the app
     until they write down why they're not able to fix everything."

     What the block covers was settled by what a salesperson can actually reach.
     Summary, History, Standards and the Dashboard are manager screens they never
     see, so a block naming them would be a block on nothing while looking like
     one. What they have is the line and this panel, and the line stays open
     however far behind they are: locking somebody off the floor is the most
     expensive thing this app could do to a store, and it would land on whoever
     is already having the worst month. So the note stands in front of their own
     figures, and the way back to the line is on the same screen. */
  const whoKey = norm(meName || "");
  const [record, setRecord] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteErr, setNoteErr] = useState("");
  useEffect(() => {
    if (!meName) return;
    let dead = false;
    loadGoalRecord(store, date, norm(meName), meId)
      .then((r) => { if (!dead) setRecord(r); })
      /* A record that cannot be read must not become a block. Being shut out by a
         dropped connection, with no way to answer, is worse than a missed flag. */
      .catch(() => { if (!dead) setRecord({ notes: [], lift: null, signedIn: new Set(), failed: true }); });
    return () => { dead = true; };
  }, [store, date, meName, meId]);

  /* The same reading the manager's screen makes of the same days: which of them
     count, and which of those were under the bar. */
  const standing = series
    ? standingFor(series, { std, worked: (record && record.signedIn) || new Set() })
    : null;
  /* Not until both halves have landed: gating on a half-read record would flash a
     block at somebody who has already answered. */
  const owing = !!(standing && record && !record.failed
    && gatesMyDay("myday") && owesNote(record.notes, standing, record.lift));

  const saveNote = async () => {
    const note = makeNote(noteText, {
      forDay: standing.latestMiss, by: meId || "", name: meName || "", who: whoKey, id: meId || "",
      missed: standing.missed, of: standing.counted,
    });
    if (!note) return;
    setNoteSaving(true); setNoteErr("");
    try {
      await writeGoalNote(store, date, note);
      setRecord((r) => ({ ...(r || { lift: null, signedIn: new Set() }),
        notes: notesFor(addNote((r && r.notes) || [], note)) }));
      setNoteText(""); buzz([18, 40, 18]);
      /* And send it to somebody. The floor row is the RECORD — it is what clears
         the flag and what a manager reads back later — but a record nobody is
         prompted to open is the void this was built to avoid. A ticket is the one
         rail in this app that already reaches a person: it survives the browser
         being closed, it lands in the panel, and Supabase carries it out to
         whatever webhook the store has set. Jorge asked for the notes to come to
         him, and this is the route that already goes there.

         Deliberately after the note is saved, and deliberately unable to fail it.
         Somebody who has written their answer is owed their day back whether or
         not a notification went anywhere. */
      try {
        await saveTicket({
          id: uid() + Date.now().toString(36), at: note.at, kind: "standard", status: "open",
          store: store || "", from: meName || "Not given", reach: "",
          who: whoKey, forDay: note.forDay, missed: standing.missed, of: standing.counted,
          days: standing.days, bar: `${std.minCalls} calls and ${std.minVideos} videos a day`,
          body: note.text, context: `My day, ${meName || "unknown"}, ${date}`,
        });
      } catch (e) { /* the note stands either way */ }
    } catch (e) {
      setNoteErr((e && e.message) || "That did not save. Try again in a moment.");
    }
    setNoteSaving(false);
  };

  const spineItems = LIST.map((c) => {
    const auto = autoFor(c);
    return auto ? { got: auto.got, need: auto.need } : { got: 0, need: 0, done: isDone(c) };
  });
  const spine = (
    <SfSpine mode="day" items={spineItems} cap={`${doneCount} of ${LIST.length} done`} />
  );

  const openTile = tiles.find((t) => t.k === openK) || tiles[0];
  const dayValues = series ? series.map((d) => (d.row ? (d.row[STAT_FIELD[openK]] || 0) : 0)) : null;

  const bands = (
    <div className="sf-bands">
      {tiles.map((t) => {
        const p = t.target ? Math.min(100, Math.round(((t.v || 0) / t.target) * 100)) : null;
        const made = t.target ? t.v >= t.target : false;
        return (
          <button key={t.k} type="button" className="sf-band"
            onClick={() => { buzz(8); setOpenK(t.k); setView("one"); }}>
            <span className="sf-band-fig">
              <span className={"sf-band-dm" + (made ? " made" : "")}><DmNumber value={t.v} /></span>
            </span>
            <span className="sf-band-txt">
              <span className="sf-band-lbl">{t.label}</span>
              <span className="sf-band-of">
                {made ? <b>made it</b> : t.target ? `of ${t.target} · ${t.target - t.v} to go` : "no bar set"}
              </span>
              {p != null && <span className={"sf-meter" + (made ? " done" : "")}><i style={{ width: p + "%" }} /></span>}
            </span>
            <span className="sf-band-go"><PixIcon glyph="arrow" size={12} /></span>
          </button>
        );
      })}
    </div>
  );

  let inner;
  if (owing) {
    /* Their own figures and checklist are replaced by the record of what was
       missed and the box to answer in. Not made unopenable: being shut out of the
       one screen that would tell them why would be absurd, and the way back to
       the line is right here, because the floor is never blocked. */
    const missedRows = (series || [])
      .filter((d) => standing.days.includes(d.day))
      .sort((x, y) => String(y.day).localeCompare(String(x.day)));
    inner = (
      <SfScreen spine={spine} className="sf-v-owe">
        <button type="button" className="sf-back" onClick={onClose}>
          <PixIcon glyph="arrowleft" size={12} /><span>Back to the line</span>
        </button>
        <p className="sf-kicker">{longDay(date)}</p>
        <SfDisplay a={standing.missed + " of your last " + standing.counted}
          b="days missed the bar" />
        <p className="sf-sub">
          The bar is {std.minCalls} calls and {std.minVideos} videos in a day. Write down what is
          stopping you and this goes away. Nobody is being marked down for what you say here,
          and it is the only way anyone finds out what you are up against.
        </p>

        <div className="sf-owe-days">
          {missedRows.map((d) => {
            const r = d.row || {};
            return (
              <div key={d.day} className="sf-owe-day">
                <span className="sf-owe-d">{shortDay(d.day)}</span>
                <span className={"sf-owe-f" + ((Number(r.calls) || 0) < std.minCalls ? " under" : "")}>
                  {r.calls || 0}<small>/{std.minCalls} calls</small>
                </span>
                <span className={"sf-owe-f" + ((Number(r.video) || 0) < std.minVideos ? " under" : "")}>
                  {r.video || 0}<small>/{std.minVideos} videos</small>
                </span>
              </div>
            );
          })}
        </div>

        <div className="sf-owe-box">
          <label htmlFor="sf-owe-note">What is stopping you?</label>
          <textarea id="sf-owe-note" rows={4} value={noteText} maxLength={900}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={"No inventory in my segment, three days on the desk covering, phone system down\u2026"} />
          {noteErr ? <p className="sf-err">{noteErr}</p> : null}
          <button type="button" className="sf-owe-go" disabled={!noteText.trim() || noteSaving}
            onClick={saveNote}>
            {noteSaving ? "Saving\u2026" : "Send it and carry on"}
          </button>
          <p className="sf-owe-fine">
            Your manager reads this. Signing in, taking ups and logging a delivery all keep
            working. This screen is the only thing waiting on you.
          </p>
        </div>
      </SfScreen>
    );
  } else if (view === "one") {
    const peak = dayValues ? Math.max(...dayValues, 1) : 1;
    const CELLS = 7;
    const topIx = dayValues ? dayValues.indexOf(Math.max(...dayValues)) : -1;
    const pct = openTile.target ? Math.min(100, Math.round((openTile.v / openTile.target) * 100)) : null;
    inner = (
      <SfScreen spine={spine} className="sf-v-one">
        <button type="button" className="sf-back" onClick={() => setView("day")}>
          <PixIcon glyph="arrowleft" size={12} /><span>My day</span>
        </button>
        <p className="sf-kicker">{openTile.label} · last {SF_DAYS} days</p>
        <SfDisplay small a="Where the" b={openTile.label.toLowerCase() + " went"} />

        <div className="sf-one">
          <div className="sf-one-head">
            <span className="sf-one-v">
              {openTile.v}
              {openTile.target ? <small> / {openTile.target} today</small> : <small> today</small>}
            </span>
            {pct != null && <span className="sf-one-p">{pct}%</span>}
          </div>
          {pct != null && (
            <div className="sf-one-track">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} className={i < Math.round(pct / 10) ? "on" : ""} />
              ))}
            </div>
          )}
          {!dayValues ? (
            <p className="sf-one-wait">Reading the last {SF_DAYS} days&hellip;</p>
          ) : (
            <>
              <div className="sf-cols">
                {dayValues.map((v, i) => {
                  const filled = v <= 0 ? 0 : Math.max(1, Math.round((v / peak) * CELLS));
                  return (
                    <span key={i} className={"sf-col" + (i === topIx && v > 0 ? " top" : "")}>
                      {i === topIx && v > 0 && (
                        <span className="sf-col-call"><b>{v}</b>best day</span>
                      )}
                      {Array.from({ length: CELLS }, (_, r) => (
                        <span key={r} className={"sf-sq" + (r < filled ? "" : " off")} />
                      ))}
                    </span>
                  );
                })}
              </div>
              <div className="sf-axis">
                <span>{shortDay(series[0].day)}</span>
                <span>{shortDay(series[Math.floor(SF_DAYS / 2)].day)}</span>
                <span>{shortDay(series[SF_DAYS - 1].day)}</span>
              </div>
            </>
          )}
        </div>

        {dayValues && <SfWorthKnowing values={dayValues} days={series.map((d) => d.day)} target={openTile.target} />}
      </SfScreen>
    );
  } else if (view === "list") {
    inner = (
      <SfScreen spine={spine} className="sf-v-list">
        <button type="button" className="sf-back" onClick={() => setView("day")}>
          <PixIcon glyph="arrowleft" size={12} /><span>My day</span>
        </button>
        <p className="sf-kicker">{longDay(date)}</p>
        <SfDisplay a="Today's" b="list" />
        <p className="sf-sub">The top three tick themselves off the reports. The rest are yours, and nobody is graded on them.</p>
        <div className="sf-tasks">
          {LIST.map((c) => {
            const auto = autoFor(c);
            const done = isDone(c);
            return (
              <button key={c.id} type="button"
                className={"sf-task" + (done ? " on" : "") + (c.from ? " auto" : "") + (pop === c.id ? " pop" : "")}
                onClick={() => toggle(c)} aria-disabled={!!c.from}>
                <span className="sf-task-top">
                  <span className="sf-task-l">{c.label}</span>
                  <span className={"sf-task-c" + (done ? " good" : "")}>
                    {auto
                      ? (stats ? `${auto.got}/${auto.need}` : "waiting")
                      : (done ? <PixIcon glyph="check" size={13} /> : "tap")}
                  </span>
                </span>
                <span className="sf-task-h">{c.hint}</span>
              </button>
            );
          })}
        </div>
      </SfScreen>
    );
  } else {
    inner = (
      <SfScreen spine={spine} className="sf-v-day">
        <button type="button" className="sf-back" onClick={onClose}>
          <PixIcon glyph="arrowleft" size={12} /><span>Back to the line</span>
        </button>
        <p className="sf-kicker">{longDay(date)}</p>
        <SfDisplay a={meName ? meName.split(" ")[0] + "'s" : "My"} b="day" />

        <div className="sf-cap">
          <span>Today&rsquo;s work</span>
          <b>{tiles.filter((t) => t.target && t.v >= t.target).length} of {tiles.filter((t) => t.target).length} at the bar</b>
        </div>
        {!stats
          ? <p className="sf-sub">Today&rsquo;s numbers have not landed yet. They come in through the day.</p>
          : bands}

        {closers.length > 0 && (
          <>
            <div className="sf-cap"><span>Closing this month</span></div>
            <div className="sf-rates">
              {closers.map((c) => {
                const tn = toneOf(c.pct, c.k);
                const mv = moveOf(c.pct, c.prev);
                return (
                  <div key={c.k} className={"sf-rate sf-tone-" + tn}>
                    <span className="sf-rate-v">{c.pct == null ? "–" : Math.round(c.pct * 100) + "%"}</span>
                    <span className="sf-rate-l">
                      {c.label}<PixIcon className="sf-rate-mark" glyph={TONE_MARK[tn]} size={10} />
                    </span>
                    <span className="sf-rate-g">goal {(thr[c.k] || {}).green}%</span>
                    <span className={"sf-rate-m " + mv.dir}>
                      <PixIcon glyph={mv.dir === "up" ? "triup" : mv.dir === "down" ? "tridown" : "dot"} size={9} />
                      {mv.delta ? <i>{mv.delta}</i> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {focus && (
          <>
            <div className="sf-cap"><span>Start here</span></div>
            <div className={"sf-focus sf-tone-" + focus.tone}>
              <h4>{focus.label}</h4>
              <div className="sf-focus-n">{Math.round(focus.pct * 100)}% against a bar of {focus.green}%</div>
              <p>{focus.play}</p>
            </div>
          </>
        )}

        <button type="button" className="sf-jump" onClick={() => setView("list")}>
          Today&rsquo;s list<span>{doneCount} of {LIST.length}</span>
          <PixIcon glyph="arrow" size={13} />
        </button>

        <div className={"sf-stamp" + (stamp ? "" : " none")}>
          {stamp
            ? `Numbers as of ${stamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "No activity report has landed for today yet"}
        </div>
        {/* A salesperson's own figures. They are the person most likely to spot a
            wrong one — it is their day — and least likely to have anywhere to say
            so, which is how a wrong number gets lived with for a month. */}
        <HelpButton config={config} who={meName} store={store}
          context={`My day, ${meName || "unknown"}, ${date}`}
          figures={[
            { label: `Calls today`, value: String(stats?.calls ?? "\u2014") },
            { label: `Videos today`, value: String(stats?.video ?? "\u2014") },
            { label: `Texts today`, value: String(stats?.text ?? "\u2014") },
            { label: `Emails today`, value: String(stats?.email ?? "\u2014") },
            { label: `Tasks today`, value: String(stats?.tasks ?? "\u2014") },
            { label: `Ups credited today`, value: String(stats?.visits ?? "\u2014") },
            { label: `Units this month`, value: String(monthStats?.units ?? "\u2014") },
          ]}
          floating={false} />
      </SfScreen>
    );
  }

  return (
    <Overlay>
      <div className={"q-page sf sf-day-root mc-shell mc-day " + ((variant && variant.sf) || "") + (light ? " mc-light" : "")}
        role="dialog" aria-label="My day">
        <div className="mc-aurora" aria-hidden="true"><i /><i /><i /><i /><u /><u /></div>
        {inner}
      </div>
    </Overlay>
  );
}

/* ---------------- Help and tickets ----------------
   One button, everywhere, for everyone. A manager who cannot save and a salesperson
   whose name is missing from the line both end up in the same place, and neither has
   to know who to ask. */
function HelpButton({ config, who, store, context, figures, floating = true, dark = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={"help-fab" + (floating ? "" : " inline")} onClick={() => setOpen(true)}
        title="Get help, or say a number is wrong" aria-label="Get help, or say a number is wrong">
        <PixIcon glyph="question" size={floating ? 20 : 15} />
        {!floating && <span>Help</span>}
      </button>
      {open && <HelpPanel config={config} who={who} store={store} context={context} figures={figures} dark={dark}
        onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---- "This number is wrong" is not "I need help" ----

   They arrive through the same button because nobody wants to learn two, but they
   are different reports and mixing them loses both. Somebody who cannot sign in
   is stuck and wants an answer. Somebody looking at 84.5 where they know they
   sold 85 is not stuck at all — they are telling us the tool is lying, and that
   is worth more than a support request, because they are the only ones who can
   see it. A screen that only offers "get help" quietly teaches people that a
   wrong number is their problem to live with.

   The difference this makes is what gets captured. "The numbers are off" is
   unactionable and it is what you get if you ask an open question. So the form
   asks the three things that make it fixable — which figure, what it should say,
   and how they know — and takes the rest off the screen itself. */
function HelpPanel({ config, who, store, context, figures, onClose, dark = false }) {
  const s = (config && config.support) || {};
  const [tab, setTab] = useState("contact");
  const [what, setWhat] = useState("");
  const [name, setName] = useState(who || "");
  const [reach, setReach] = useState("");
  const [sent, setSent] = useState(null);   // null | "sending" | "ok" | "fail"
  // The wrong-number report
  const onScreen = Array.isArray(figures) ? figures.filter((f) => f && f.label) : [];
  const [which, setWhich] = useState("");
  const [shouldBe, setShouldBe] = useState("");
  const [basis, setBasis] = useState("");

  const picked = onScreen.find((f) => f.label === which) || null;
  const wrongReady = !!(which.trim() || what.trim());

  const baseTicket = () => ({
    id: uid() + Date.now().toString(36),
    at: new Date().toISOString(),
    from: name.trim() || "Not given",
    reach: reach.trim(),
    store: store || "",
    // What the app was doing when they hit the button, so a ticket does not
    // arrive as "it broke" with nothing to go on.
    context: context || "",
    page: (typeof window !== "undefined" && window.location ? window.location.pathname + window.location.search : ""),
    agent: (typeof navigator !== "undefined" ? navigator.userAgent : ""),
    status: "open",
  });

  const send = async () => {
    if (!what.trim()) return;
    setSent("sending");
    setSent((await saveTicket({ ...baseTicket(), kind: "problem", body: what.trim() })) ? "ok" : "fail");
  };

  const sendWrong = async () => {
    if (!wrongReady) return;
    setSent("sending");
    const t = {
      ...baseTicket(),
      kind: "figures",
      figure: which.trim(),
      /* Taken off the screen rather than typed. Somebody reporting a wrong number
         should not have to transcribe it correctly to be believed, and what they
         were looking at is the one fact that cannot be reconstructed later — by
         the time anybody reads this, the import may have run again. */
      shown: picked ? String(picked.value) : "",
      expected: shouldBe.trim(),
      basis: basis.trim(),
      /* Everything else that was on the screen at that moment, which is how a
         wrong figure usually gets traced: the one that is off is rarely off
         alone. */
      snapshot: onScreen.map((f) => ({ label: f.label, value: String(f.value) })),
      body: what.trim(),
    };
    setSent((await saveTicket(t)) ? "ok" : "fail");
  };

  return (
    <Overlay>
    <div className="help-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"help-sheet" + (dark ? " mc-tone" : "")} role="dialog" aria-label="Help">
        <div className="help-head">
          {/* The heading follows the tab. "Need a hand?" over a wrong-number form
              tells somebody they are asking for help, which is the framing that
              stops people reporting a bad figure at all: they do not need help,
              they are doing us one. */}
          <h3>{tab === "wrong" ? "Something look wrong?" : tab === "ticket" ? "Something broken?" : "Need a hand?"}</h3>
          <button className="btn-x md-x" onClick={onClose} aria-label="Close">
            <PixIcon glyph="close" size={19} />
          </button>
        </div>
        <div className="help-tabs">
          <button className={"help-tab help-tab-wrong" + (tab === "wrong" ? " on" : "")} onClick={() => setTab("wrong")}>
            A number's wrong
          </button>
          <button className={"help-tab" + (tab === "ticket" ? " on" : "")} onClick={() => setTab("ticket")}>Something's broken</button>
          <button className={"help-tab" + (tab === "contact" ? " on" : "")} onClick={() => setTab("contact")}>Contact</button>
        </div>

        {tab === "wrong" ? (
          <div className="help-body">
            {sent === "ok" ? (
              <div className="help-done">
                <PixIcon glyph="check" size={26} />
                <b>Flagged.</b>
                <p className="hint">
                  {s.name ? s.name.split(" ")[0] : "An administrator"} gets this with the figure you were looking at
                  and everything else on the screen beside it. Nothing about your day changes in the meantime;
                  the number stays as it is until somebody has looked.
                </p>
              </div>
            ) : (
              <>
                <p className="help-intro">
                  If a figure here does not match what you know happened, say so. You are the only one who can
                  see that, and it is worth telling us even when you are not stuck.
                </p>

                <label className="help-lbl">Which number?</label>
                {onScreen.length > 0 ? (
                  <select className="help-in" value={which} onChange={(e) => setWhich(e.target.value)}>
                    <option value="">Pick the one that looks wrong…</option>
                    {onScreen.map((f) => (
                      <option key={f.label} value={f.label}>{f.label}, showing {String(f.value)}</option>
                    ))}
                    <option value="__other">Something else on this screen</option>
                  </select>
                ) : (
                  <input className="help-in" value={which} onChange={(e) => setWhich(e.target.value)}
                    placeholder="e.g. my units for the month" />
                )}

                {which && which !== "__other" && picked && (
                  <div className="help-shown">
                    This screen is showing <b>{String(picked.value)}</b>
                  </div>
                )}

                <div className="help-row">
                  <span>
                    <label className="help-lbl">What should it be?</label>
                    <input className="help-in" value={shouldBe} onChange={(e) => setShouldBe(e.target.value)}
                      placeholder="If you know" />
                  </span>
                  <span>
                    <label className="help-lbl">How do you know?</label>
                    <input className="help-in" value={basis} onChange={(e) => setBasis(e.target.value)}
                      placeholder="e.g. DriveCentric says 12" />
                  </span>
                </div>

                <label className="help-lbl">Anything else worth knowing</label>
                <textarea className="help-area" rows={3} value={what} onChange={(e) => setWhat(e.target.value)}
                  placeholder="Optional. When you noticed it, whether it was right yesterday, anything odd that day." />

                <div className="help-row">
                  <span>
                    <label className="help-lbl">Your name</label>
                    <input className="help-in" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="So somebody can come back to you" />
                  </span>
                  <span>
                    <label className="help-lbl">Phone or email</label>
                    <input className="help-in" value={reach} onChange={(e) => setReach(e.target.value)} placeholder="Optional" />
                  </span>
                </div>

                <p className="hint">
                  Sent with it: {context ? context + ", " : ""}
                  {onScreen.length > 0
                    ? `and the ${onScreen.length} ${onScreen.length === 1 ? "figure" : "figures"} on this screen as they stand right now.`
                    : "and the page you are on."}
                </p>
                {sent === "fail" && <p className="sched-err">That did not send. Check the connection and try again.</p>}
                <button className="btn" disabled={!wrongReady || sent === "sending"} onClick={sendWrong}>
                  {sent === "sending" ? "Sending…" : "Flag it"}
                </button>
              </>
            )}
          </div>
        ) : tab === "contact" ? (
          <div className="help-body">
            <div className="help-person">
              <span className="help-avatar">{String(s.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
              <span>
                <b>{s.name || "Your administrator"}</b>
                {s.role && <span className="help-role">{s.role}</span>}
              </span>
            </div>
            {s.email && <a className="help-link" href={`mailto:${s.email}?subject=${encodeURIComponent("Sage help" + (store ? " (" + store + ")" : ""))}`}>{s.email}</a>}
            {s.phone && <a className="help-link" href={`tel:${String(s.phone).replace(/[^\d+]/g, "")}`}>{s.phone}</a>}
            {s.note && <p className="hint">{s.note}</p>}
            {!s.email && !s.phone && <p className="hint">No contact details have been set yet. Use Report a problem and it will still reach an administrator.</p>}
            <p className="hint">Reporting the problem here sends more detail than a message can, so it is usually the faster route.</p>
          </div>
        ) : (
          <div className="help-body">
            {sent === "ok" ? (
              <div className="help-done">
                <PixIcon glyph="check" size={26} />
                <b>Sent.</b>
                <p className="hint">{s.name ? s.name.split(" ")[0] : "Your administrator"} will see this with the page you were on and what you were doing. You can close this.</p>
              </div>
            ) : (
              <>
                <label className="help-lbl">What happened?</label>
                <textarea className="help-area" rows={4} value={what} onChange={(e) => setWhat(e.target.value)}
                  placeholder="What you were trying to do, and what the screen did instead." />
                <div className="help-row">
                  <span>
                    <label className="help-lbl">Your name</label>
                    <input className="help-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="So they know who to answer" />
                  </span>
                  <span>
                    <label className="help-lbl">Phone or email</label>
                    <input className="help-in" value={reach} onChange={(e) => setReach(e.target.value)} placeholder="Optional" />
                  </span>
                </div>
                {context && <p className="hint">This will include: {context}</p>}
                {sent === "fail" && <p className="sched-err">That did not send. Check the connection and try again, or use the Contact tab.</p>}
                <button className="btn" disabled={!what.trim() || sent === "sending"} onClick={send}>
                  {sent === "sending" ? "Sending..." : "Send it"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
    </Overlay>
  );
}



/* Where the phone app lives, once it does. Empty until then, and the Help row
   says the app is coming instead of pointing anywhere. */
const APP_STORE_LINKS = { ios: "", android: "" };

/* ---------------- Claim your name ----------------
   Which store, and which name on its roster. The roster comes from the store's
   published board row, which is readable with no account at all, so this works
   on the sign-up screen before there is one. A store whose board has never been
   opened has no published roster; the person still names the store and types
   their name, and the manager picks the roster name when they join them. */
function ClaimPicker({ config, value, onChange, onName }) {
  const stores = (config && config.stores) || [];
  const [roster, setRoster] = useState(null);
  const store = value && value.store ? value.store : "";
  useEffect(() => {
    if (!store) { setRoster(null); return; }
    let dead = false;
    setRoster(null);
    loadShared(`lpc:board:${store}:v1`, null).then((b) => {
      if (dead) return;
      const src = b && Array.isArray(b.people) ? b.people : (b && Array.isArray(b.roster) ? b.roster : []);
      const list = src.filter((r) => r && r.id && r.name);
      setRoster(list.slice().sort((a, b2) => String(a.name).localeCompare(String(b2.name))));
    }).catch(() => { if (!dead) setRoster([]); });
    return () => { dead = true; };
  }, [store]);
  return (
    <>
      <label className="lf-label">Your store</label>
      <select className="lf-in lf-sel" value={store} onChange={(e) => onChange({ store: e.target.value, person: null, name: "" })}>
        <option value="">Pick your store…</option>
        {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
      </select>
      {store && roster === null && <p className="lf-kindnote">Reading the roster…</p>}
      {store && roster && roster.length > 0 && (
        <>
          <label className="lf-label">Your name on the roster</label>
          <select className="lf-in lf-sel" value={value.person || ""}
            onChange={(e) => {
              const r = roster.find((x) => x.id === e.target.value) || null;
              onChange({ store, person: r ? r.id : null, name: r ? r.name : "" });
              if (r && onName) onName(r.name);
            }}>
            <option value="">Pick your name…</option>
            {roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </>
      )}
      {store && roster && roster.length === 0 && (
        <p className="lf-kindnote">This store has not published its roster yet. Type your name below and your manager will match it.</p>
      )}
    </>
  );
}

/* ---------------- Login (real accounts) ---------------- */
function Login({ config, onBack, onAuthed, onHandover, onJump }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [kind, setKind] = useState("associate");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [claim, setClaim] = useState({ store: "", person: null, name: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  /* The card's own 760ms deconstruction is gone with the handover it belonged
     to. The arrival takes the screen apart now, from the press, so there is
     nothing left here to run. */

  const domains = config.approvedDomains || [];
  const canRegister = config.registrationOpen && domains.length > 0;

  /* ---- the press starts the jump, and the network runs underneath it ----
     The jump used to wait for the sign-in call to come back, which is why it read
     as "loading first, then the animation". It starts on the press now, and the
     420ms hold and 520ms gather are spent while the request is in flight, so by
     the time the streaks are gone the answer is nearly always already here. Two
     things have to be true and are:

       if the sign-in FAILS, the jump is cancelled and the form comes back — the
       error is more important than the animation and arrives well inside the
       first beat

       if the sign-in is SLOW, the flash holds white until it lands rather than
       handing over to a screen that is not ready */
  const jumping = useRef(null);
  const markRef = useRef(null);
  const emailRef = useRef(null);
  const pwRef = useRef(null);
  /* null until a press finds the mark unfinished; see RUSH. */
  const [rushTyped, setRushTyped] = useState(null);
  const hurryBuild = (from) => {
    const t0 = (typeof performance !== "undefined" ? performance : Date).now();
    const step = () => {
      const now = (typeof performance !== "undefined" ? performance : Date).now();
      const p = Math.min(1, (now - t0) / RUSH);
      setRushTyped(from + (34 - from) * p);
      if (p < 1) rushRaf.current = requestAnimationFrame(step);
    };
    rushRaf.current = requestAnimationFrame(step);
  };
  /* ---- an autofill is typing too, as far as the mark is concerned ----
     A password manager sets both fields without React seeing a thing: no
     keystrokes, and in Chrome often no input event this component is mounted in
     time to hear. So `typed` stayed 0, the mark stayed dark, and the one piece of
     feedback this screen has did nothing for the people most likely to use it.

     The values are read back off the DOM instead of waited for — on mount, on
     the animation Chrome fires against :-webkit-autofill, and on a couple of
     ticks after that for the managers that fill late. Anything found is fed
     through the same rush the sign-in press uses, so the mark BUILDS to where the
     text is rather than snapping to it. */
  useEffect(() => {
    let done = false;
    const sync = () => {
      if (done) return;
      const e = emailRef.current, w = pwRef.current;
      const ev = e ? e.value : "", wv = w ? w.value : "";
      if (!ev && !wv) return;
      if (ev === email && wv === password) return;
      done = true;
      const was = Math.min(34, email.length + password.length);
      setEmail(ev); setPassword(wv);
      if (Math.min(34, ev.length + wv.length) > was) hurryBuild(was);
    };
    const onAnim = (ev) => { if (ev.animationName === "sageAutofill") sync(); };
    document.addEventListener("animationstart", onAnim, true);
    const ts = [0, 120, 400, 900].map((ms) => setTimeout(sync, ms));
    return () => {
      document.removeEventListener("animationstart", onAnim, true);
      ts.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line
  const rushRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(rushRaf.current), []);
  const heldRef = useRef(onJump);
  heldRef.current = onJump;
  const abortJump = () => {
    if (jumping.current) { jumping.current(); jumping.current = null; }
    if (heldRef.current) heldRef.current(false);
  };
  useEffect(() => () => { if (jumping.current) { jumping.current(); jumping.current = null; } }, []);

  const signIn = async () => {
    setErr(""); setOk("");
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    signInPressed = true;
    /* ---- put the keyboard away BEFORE anything is measured ----
       On a phone the press that starts all of this happens with the keyboard
       up, which means the viewport is roughly half the screen. The jump
       measures the window once, sizes its canvas to that, and centres itself
       in it — and then the keyboard leaves and the window doubles. The result
       is the animation sitting high on the screen and stopping in a hard line
       just past the middle, with the bottom half empty. Measured: --jy 230px
       against an 844px window, canvas 390x460 over a 390x844 screen.

       The canvas cannot be resized once it is running: it is handed to a
       worker, which owns it from then on. So the fix is to not measure a
       viewport that is about to change. Blur first, wait for the layout to
       settle, then start. The wait is a frame plus a beat — long enough for
       the keyboard's own animation to have handed the height back, short
       enough that nobody perceives it as a delay before the press responds. */
    try {
      const el = document.activeElement;
      if (el && typeof el.blur === "function") el.blur();
    } catch (e) {}
    await settleViewport();
    /* ---- hold the screen for the length of the jump ----
       The sign-in call is not the only thing that brings the session in: the
       client fires SIGNED_IN the moment it succeeds, the app's own auth listener
       refreshes the profile off that, and the session lands about 300ms after the
       press — a quarter of the way into the hold. The root would then swap to the
       dashboard, this component would unmount, and the jump's cleanup would take
       every beat class with it. Measured: beats gone at 255ms, dashboard already
       up. That is the whole animation, over before the gather, which is why it
       looked like nothing happened.

       So the jump says when it is running and the root keeps the sign-in screen
       on until it says otherwise. The session can arrive whenever it likes. */
    if (onJump) onJump(true);
    /* Before anything moves: tell the ground where the mark is, so the field's
       streaks leave along lines drawn from the logo rather than from the middle
       of the frame. Measured here because here is the only place that knows. */
    tellJumpOrigin(markRef.current);
    /* A saved password fills both fields at once, so the mark is barely started
       when the button is pressed. Finish it first, and push the whole jump back
       by exactly as long as that takes: the streaks have to leave a whole word. */
    const short = typed < 34;
    if (short) hurryBuild(typed);
    let authed = null;                       // null = still in flight
    let flashed = false;
    let handedOver = false;
    const handOver = () => {
      if (handedOver || !flashed || authed !== true) return;
      handedOver = true;
      /* This is the frame the white is covering, and it is a handful of class
         names: the dashboard has been mounted and laid out since the hold. */
      if (onHandover) onHandover();
    };
    jumping.current = runJump({
      lead: short ? RUSH : 0,
      onFlash: () => {
        /* Nothing to hand over to yet: hold the flash rather than dropping back
           onto a sign-in screen that has already taken itself apart. */
        if (authed === null) document.documentElement.classList.add("sage-flash-hold");
      },
      onDone: () => { flashed = true; handOver(); },
    });
    /* A THROW has to land here as well as a returned error. It is not a
       hypothetical: the flash holds white while it waits for an answer, so an
       exception escaping this call leaves a white screen with nothing behind it
       and no way back. Anything that is not a clean success puts the form back. */
    let res;
    try {
      res = await authSignIn(email.trim().toLowerCase(), password);
    } catch (e) {
      res = { error: "Couldn't reach sign-in. Check your connection and try again." };
    }
    if (!res || res.error) {
      abortJump();
      signInPressed = false;
      document.documentElement.classList.remove("sage-flash-hold");
      authed = false;
      setBusy(false); setErr((res && res.error) || "Sign-in didn't complete. Try again.");
      return;
    }
    authed = true;
    document.documentElement.classList.remove("sage-flash-hold");
    /* From here the only thing between the user and the page is the white, so
       nothing on this path is allowed to throw its way out of the handover. */
    /* Load the profile NOW, not at the handover. The screen is held for the rest
       of the jump either way, so the fetch costs nothing here and everything
       there: gating the swap on a round trip that only starts at the handover put
       the dashboard on screen most of a second after the flash had been asked
       for, which is far too late for the flash to cover it. By the time the white
       is up the session is already in hand and the swap is a state flip. */
    try { await onAuthed(); } catch (e) { console.error("profile load at handover", e); }
    handOver();
  };

  const signUp = async () => {
    setErr(""); setOk("");
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) { setErr("Enter a valid email."); return; }
    if (!name.trim()) { setErr("Enter your full name."); return; }
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== password2) { setErr("The two passwords do not match."); return; }
    // The very first account created becomes the admin, so it is not domain-gated.
    const domainOf = (addr) => String(addr).split("@")[1] || "";
    if (domains.length > 0 && !domains.includes(domainOf(e))) {
      setErr("Email must be on an approved company domain (" + domains.join(", ") + ").");
      return;
    }
    if (kind === "associate" && !claim.store && (config.stores || []).length > 0) { setErr("Pick your store."); return; }
    setBusy(true);
    const res = await authSignUp(e, password, name.trim(), kind, kind === "associate" ? claim : null);
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

  /* ---- the mark builds as the form is filled ----
     73 dots against 34 characters of email and password. Driven off the real
     input values rather than off keystrokes, so a password manager filling both
     fields in one go lands where a person typing them lands. */
  const typed = Math.min(34, email.length + password.length);
  /* While the hurry is running the count comes from it rather than from the
     fields, so the mark finishes drawing itself under its own steam. */
  const shownTyped = rushTyped === null ? typed : rushTyped;
  const revealed = Math.round((shownTyped / 34) * 73);
  const filled = Math.min(5, Math.round((shownTyped / 34) * 5));

  return (
    <div className="login">
      {/* The field belongs to this screen and lives as long as it does: held for
          the whole jump, gone with it at the handover, underneath the white. */}
      <SageField />
      <div className={"login-card " + (busy ? "login-busy" : "")}>
        <p className="login-eyebrow">{greetingFor()}</p>
        {/* No spinner here any more. Signing in used to swap the wordmark for a
            loading indicator, which is a different object appearing in the place
            of the thing you were looking at. The mark stays and goes to work
            instead: the same 73 dots, running a wave left to right. */}
        <div className="login-logo" ref={markRef}>
          {/* Still driven by `revealed` while signing in, because the hurry is
              what finishes the drawing — dropping it on press would snap the
              rest of the word in and there would be nothing to hurry. */}
          <SageMark word size={64} revealed={mode === "signin" ? revealed : undefined} />
        </div>

        {!AUTH_ENABLED && <p className="setup-note">This is a preview. Real sign-in works on the hosted site.</p>}

        {/* Each mode's fields live in a keyed container so switching modes
            remounts it and plays the entrance: the fields build up from below in
            the same vocabulary as everything else here. The mark above never
            moves — it belongs to all three. */}
        {mode === "signin" && (
          <div className="lf-mode" key="signin">
            <label className="lf-label">Work email</label>
            <input className="lf-in" ref={emailRef} value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              placeholder="you@company.com" autoComplete="username" />
            <label className="lf-label lf-label-row">
              Password
              {/* Inline on the label row, where the eye already is when the field
                  is the thing that went wrong. */}
              <button type="button" className="lf-forgot"
                onClick={() => { setMode("forgot"); setErr(""); setOk(""); }}>Forgot?</button>
            </label>
            <input className="lf-in" ref={pwRef} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && signIn()} placeholder="Your password" autoComplete="current-password" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            {/* The five dots fill on the same ratio the mark builds on, so the
                button and the mark are two readings of one thing. */}
            <button className="lf-go" onClick={signIn} disabled={busy}>
              <span>{busy ? "Signing in\u2026" : "Sign in"}</span>
              <span className="lf-dots">
                {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < filled ? "on" : ""} />)}
              </span>
            </button>
            <button className="lf-alt" onClick={() => { setMode("signup"); setErr(""); setOk(""); setPassword(""); }}>Create New Account</button>
            {onBack && <button className="btn-link" onClick={onBack}>&larr; Back to start</button>}
          </div>
        )}

        {/* ---- the other two modes speak the same vocabulary ----
            They were still bare <label> and <input>, which pick up the app's
            general bordered field, and a .btn wide where the sign-in has its
            pill. Two thirds of the way into somebody's first minute with the
            product they hit Create Account and the screen changed style under
            them. Same labels, same underline fields, same pill, same quiet
            secondary link — the only difference between the three modes is which
            fields are on screen. */}
        {mode === "signup" && (
          <div className="lf-mode" key="signup">
            <p className="lf-note">
              {canRegister
                ? "Create your account. What happens next depends on which of these you are."
                : "Create your account. Heads up: the very first account created becomes the group admin."}
            </p>
            {/* Asked first, because the answer changes what the rest of this
                screen is promising. */}
            <label className="lf-label">What do you do here</label>
            <div className="lf-kinds">
              {Object.entries(ACCOUNT_KINDS).map(([k, v]) => (
                <button key={k} type="button" className={"lf-kind" + (kind === k ? " on" : "")}
                  onClick={() => { setKind(k); setErr(""); }} aria-pressed={kind === k}>
                  {v.label}
                </button>
              ))}
            </div>
            <p className="lf-kindnote">
              {kind === "manager"
                ? "Your group admin grants you the stores you look after. You will see the dashboard once they do."
                : "You do not need the dashboard. Say which store and which name is yours; your manager joins the two with one tap, and then the line, your standards and your day show up on your phone."}
            </p>
            {kind === "associate" && (
              <ClaimPicker config={config} value={claim} onChange={(c) => { setClaim(c); setErr(""); }}
                onName={(nm) => { if (!name.trim()) setName(nm); }} />
            )}
            <label className="lf-label">Work email</label>
            <input className="lf-in" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              placeholder="you@company.com" autoComplete="username" />
            <label className="lf-label">Full name</label>
            <input className="lf-in" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="First Last" />
            <label className="lf-label">Password</label>
            <input className="lf-in" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              placeholder="At least 8 characters" autoComplete="new-password" />
            <label className="lf-label">Confirm password</label>
            <input className="lf-in" type="password" value={password2} onChange={(e) => { setPassword2(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && signUp()} placeholder="Repeat it" autoComplete="new-password" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="lf-go lf-solo" onClick={signUp} disabled={busy}>
              <span>{busy ? "Creating\u2026" : "Create account"}</span>
            </button>
            <button className="lf-alt" onClick={() => { setMode("signin"); setErr(""); setPassword(""); setPassword2(""); }}>Back to sign in</button>
          </div>
        )}

        {mode === "forgot" && (
          <div className="lf-mode" key="forgot">
            <p className="lf-note">Enter your email and we will send a link to set a new password.</p>
            <label className="lf-label">Work email</label>
            <input className="lf-in" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && forgot()} placeholder="you@company.com" />
            {err && <div className="login-err">{err}</div>}
            {ok && <div className="login-ok">{ok}</div>}
            <button className="lf-go lf-solo" onClick={forgot} disabled={busy}>
              <span>{busy ? "Sending\u2026" : "Send reset link"}</span>
            </button>
            <button className="lf-alt" onClick={() => { setMode("signin"); setErr(""); setOk(""); }}>Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Switching tools ----------------
   300ms of streaks in the tool you are going TO, travelling the way the eye just
   moved: right if the new tool sits right of the old one in the bar, left if it
   sits left. The outgoing screen unmounts and the new one mounts fresh, so its
   own entrance plays underneath.

   Written against the DOM rather than through React on purpose. A tool switch
   already unmounts and remounts a large tree, and putting 34 streaks through
   state at the same moment would put the animation in the same frame budget as
   the mount it is covering — which is exactly what it exists to hide.

   The hue is the tool's own accent, taken from the app rather than from the
   handoff's table. The handoff calls those "the existing pill colours" and lists
   values that are close to but not the same as the ones in this file; the pill
   the finger just left is the thing the eye is carrying, so the app's own value
   is the one that matches it. */
const WARP_ORDER = ["perf", "activity", "board", "floor", "line", "online"];
/* How long the outgoing page has to leave before the streaks cross. It is not a
   taste number: the last staggered block starts at 66ms and its exit runs 190ms,
   so anything below 256 cuts a block off mid-exit, and a block that vanishes
   halfway through leaving is exactly what reads as a flicker. */
const TOOL_EXIT = 260;
let toolTimers = [];
/* Cards fade up as they scroll into view, and until the observer has marked one
   it sits at opacity 0. A block that has just been animated into place has not
   been through that yet, so the frame after a move ended it could drop straight
   back out — a landing followed by a blink. Anything on screen when a move
   finishes is, by definition, in view: say so before letting go of it. */
function settleReveals() {
  if (typeof document === "undefined") return;
  const h = window.innerHeight || 0;
  document.querySelectorAll(".card:not(.is-in), .reveal:not(.is-in)").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < h && r.bottom > 0) el.classList.add("is-in");
  });
}
function clearToolMove() {
  toolTimers.forEach(clearTimeout);
  toolTimers = [];
  if (typeof document === "undefined") return;
  settleReveals();
  document.documentElement.classList.remove("tool-move", "tool-exit", "tool-enter", "tool-dir-r", "tool-dir-l");
}
const WARP_HUE = { perf: "#404E44", activity: "#404E44", board: "#404E44",
  floor: "#10B981", line: "#5566F0", online: "#8B5CF6" };

function warpTo(from, to) {
  if (typeof document === "undefined") return;
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) { /* no matchMedia is not a reason to skip it */ }
  const dir = WARP_ORDER.indexOf(to) >= WARP_ORDER.indexOf(from) ? "r" : "l";
  const hue = WARP_HUE[to] || "#404E44";
  const host = document.createElement("div");
  host.className = "warp warp-" + dir;
  const h = window.innerHeight;
  let html = "";
  for (let i = 0; i < 34; i++) {
    const len = 180 + ((i * 137) % 520);          // 180-700px
    const tall = 2 + ((i * 7) % 3);               // 2-4px
    const top = Math.round(((i * 617) % 1000) / 1000 * h);
    const delay = (i * 31) % 132;                 // 0-132ms
    html += `<i style="top:${top}px;width:${len}px;height:${tall}px;background:${hue};animation-delay:${delay}ms"></i>`;
  }
  host.innerHTML = html;
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 520);
}

/* ---------------- The arrival ----------------
   Press Sign in and the mark gathers, every dot of it stretches into a streak
   past the frame, a flash covers the snap, and the dashboard builds outward from
   the centre. 2.7 seconds, once a day.

   ---- what this replaces ----
   The app already played a cinematic on the first sign-in of each calendar day,
   keyed the same way, per device and per person. Jorge chose to replace it: two
   of them would be a minute of animation before anybody sees a number, and the
   old one ended by drawing a stand-in dashboard that this one does not need
   because it hands over to the real one.

   ---- why the streaks pin at the near end ----
   Each dot's wrapper is rotated to its own angle out of the mark's centre with
   the origin at the near end, and scaled along X. There is no translate: the
   near end stays exactly where the dot was, so nothing detaches from the mark
   and re-attaches somewhere else. The layer around them carries them off frame.

   ---- and why no will-change ----
   Straight from the handoff, which found it the expensive way: scaling a 10px
   dot to 177x with will-change made the browser hold every streak as a promoted
   layer at its full scaled extent. 1664ms stall against a 21ms median without.
   ------------------------------------------------------------------- */
/* The store this browser was last working in. Only stores: see the note where it
   is read. */
const LAST_VIEW_KEY = "lpc:last-view";
function lastView() {
  try { return localStorage.getItem(LAST_VIEW_KEY) || null; } catch (e) { return null; }
}
function rememberView(v) {
  if (!v || v === "admin" || v === "combined") return;
  try { localStorage.setItem(LAST_VIEW_KEY, v); } catch (e) {}
}

/* Wait for the window to stop changing size, up to a bound. Used before the
   jump measures anything: a keyboard leaving the screen is a resize, and the
   arrival is built from one measurement taken once. Resolves on the first
   quiet frame after a change, or after `cap` regardless, because a viewport
   that never settles must not hold the sign-in press. */
function settleViewport({ floor = 200, cap = 520 } = {}) {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    /* A floor, not just a quiet check. The keyboard does not begin leaving the
       instant it is told to — iOS animates it out over about a quarter of a
       second — so polling for "the height stopped changing" answers yes before
       it has started changing at all. First draft of this resolved at 80ms
       against a resize that arrived at 120ms and measured the short viewport
       anyway, which is the bug it was written to fix. */
    const t0 = Date.now();
    let done = false;
    let last = window.innerHeight;
    let quiet = 0;
    const finish = () => { if (done) return; done = true; clearInterval(iv); clearTimeout(to); resolve(); };
    const iv = setInterval(() => {
      const h = window.innerHeight;
      if (h !== last) { last = h; quiet = 0; return; }
      if (Date.now() - t0 < floor) return;
      /* Two quiet ticks past the floor, so a resize still in flight is not
         read as settled. */
      if (++quiet >= 2) finish();
    }, 40);
    const to = setTimeout(finish, cap);
  });
}

const ARRIVAL = { hold: 420, gather: 520, stretch: 880, flash: 420, assemble: 1400 };
/* The new arrival's clock. cruiseMin is the shortest stay in the tunnel even on
   an instant load, so the destination sign gets long enough on screen to be
   read. cruiseCap is the honest ceiling: if the store has not answered by then,
   the jump lands anyway — onto whatever screen the app has to show about it
   (the stuck screen, the mismatch panel), because a tunnel that never ends is a
   spinner with better art.

   The cap was 15 seconds, which was that spinner. Measured against a realistic
   store read: the streaks ran from 640ms to 4.8s while the sign-in screen sat
   there, and then every remaining beat fired in its designed 1.4s. Nothing
   after the tunnel was rushed — the tunnel overstayed by three times, and by
   contrast the rest looked hurried and messy. At 3s the arrival keeps its
   shape, and a store slower than that lands on the app's own loading state,
   which is a screen that says what is happening rather than art that does
   not. */
const JUMP_T = { ratchet: 620, reform: 840, streaks: 800, cruiseMin: 1400, cruiseCap: 3000, burst: 520 };

/* The jump is for the first sign-in of the day on this phone. Signing in again
   the same day (a switch, a sign-out and back) lands the short way, the quick
   fade reduced motion gets: the tunnel is an arrival, not a toll on every
   return. Decided once, at the press, and read by every beat after it. */
const JUMP_DAY_KEY = "lpc:jump:day";
let jumpShort = false;
function arrivalShort() {
  try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true; } catch (e) {}
  try { return localStorage.getItem(JUMP_DAY_KEY) === today(); } catch (e) { return false; }
}
function arrivalTaken() { try { localStorage.setItem(JUMP_DAY_KEY, today()); } catch (e) {} }

/* ---- what the jump is waiting for, and where it is going ----
   Told by the root, read by the engine each frame of the cruise. Module state
   for the same reason lastJumpOrigin is: the engine lives outside React so the
   handover cannot tear it down mid-flight. */
let arrivalReady = false;
let arrivalDest = null;   // { name, color } for the travel sign, or null
/* The engine announces its beats so the root can schedule the expensive work
   into the right one: the dashboard mounts during the CRUISE, which is the
   loading zone, instead of during the ratchet, which is the most watched
   moment of the whole animation. */
const JUMP_PHASE = "sage-jump-phase";
const tellPhase = (ph) => {
  try { document.dispatchEvent(new CustomEvent(JUMP_PHASE, { detail: ph })); } catch (e) {}
};
let activeEngineSend = null;   // set by runJump while a jump is flying
function tellArrivalReady(ready, dest) {
  arrivalReady = !!ready;
  if (dest !== undefined) arrivalDest = dest;
  if (activeEngineSend) {
    activeEngineSend({ type: "ready", ready: arrivalReady });
    activeEngineSend({ type: "dest", dest: arrivalDest });
  }
}
/* ---- every time, not once a day ----
   The handoff asked for the first sign-in of the day, like the morning round-up,
   and Jorge changed it: it plays on every arrival now. So there is no stored key
   and nothing to reset — which also means it plays on a page RELOAD, because a
   reload restores the session and that is an arrival as far as this app is
   concerned. That is the honest reading of "every time"; if a refresh at the
   desk should go straight in, the trigger moves from "a session appeared" to
   "the sign-in button was pressed" and this comment is where to start. */

/* ---- the jump runs ON the sign-in screen, not over it ----
   The first build of this was a fixed, opaque panel at z-index 9000 with its own
   360px copy of the wordmark at dead viewport centre. It painted over the sign-in
   screen the instant the button was pressed, so the form never faded, the dot
   field and the blobs never gathered, and the streaks fired from the middle of
   the frame off a mark that was neither the size nor in the place of the one the
   eye was on. Nothing of the sign-in screen ever left, because nothing of it was
   ever in the animation.

   So there is no overlay any more. The beats are classes on the document, and
   every rule they carry points at the real elements: the real form fades, the
   real dot field and the real blobs pull in and blow out, and the streaks are the
   real mark's own dots, where they sit, at the size they are. What is left here
   is only the clock.

   The white flash is the one piece that cannot live on this screen, because the
   sign-in screen is gone by the time it peaks: it is mounted at the root, where
   the ground is, for the same reason. */
/* ---- the hurry ----
   The handoff's first beat, and the one this file never had. A saved password
   fills both fields in one go, so the mark is nowhere near drawn when the button
   is pressed — and the streaks have to start from a finished mark, not half a
   word. So the build is rushed to the end first, and every beat after it is
   pushed back by the same 320ms. The table says as much: "Hurry | 0 | 320ms | Only
   if the form is not finished", and "add 320ms to every figure when the hurry runs
   first". */
const RUSH = 320;
/* ---- the arrival engine's core ----
   Every moving dot of the jump, drawn from one self-contained function. Self-
   contained is load-bearing: this function is stringified and run inside a
   Worker against an OffscreenCanvas, so the tunnel keeps flowing at full frame
   rate while the main thread mounts the dashboard — the "slow down in the
   middle of the animation" was exactly that mount freezing a main-thread
   canvas. It must not touch the DOM and must not reference anything outside
   its own arguments. The same function drives the main-thread fallback where
   OffscreenCanvas does not exist, so there is one copy of this math, ever.

   ctx: a 2d context (offscreen or not). world: geometry measured at the press.
   post(type, data): reports "phase" and "flash" back to the driver. */
function arrivalEngineCore(ctx, world, post) {
  const { W, H, dpr, T, FP, mk, field, tunnel, font } = world;
  const cx = W / 2, cy = H / 2;
  const maxR = Math.hypot(W, H) / 2 + 160;
  ctx.scale(dpr, dpr);
  const pow = (p, k) => Math.pow(Math.min(1, Math.max(0, p)), k);
  const ease = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  let phase = "ratchet", t0 = 0, lastNow = 0, cruiseT0 = 0, burstT0 = 0;
  let ready = false, dest = null, done = false;

  const drawTunnel = (dt, S) => {
    for (const q of tunnel) {
      if (q.wait > 0) { q.wait -= dt * Math.max(1, S * 0.6); continue; }
      if (q.r <= maxR) {
        q.r += (40 + q.r * 2.1) * S * q.v * dt;
        q.t = Math.max(0, q.r - (200 + q.size * 55));
      } else {
        q.t += (30 + q.t * 1.9) * S * q.v * dt * 1.7;
        if (q.t > maxR) {
          q.ang = Math.random() * Math.PI * 2; q.r = 2; q.t = 0;
          q.wait = Math.random() * 1.1; q.v = 0.55 + Math.random() * 0.9;
          continue;
        }
      }
      const ux = Math.cos(q.ang), uy = Math.sin(q.ang);
      const head = Math.min(q.r, maxR);
      ctx.globalAlpha = Math.min(0.85, q.r / 70);
      ctx.strokeStyle = q.tint; ctx.lineWidth = q.size; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + ux * q.t, cy + uy * q.t);
      ctx.lineTo(cx + ux * head, cy + uy * head);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawSign = (now, mode) => {
    if (!dest || !dest.name) return;
    let scale = 1, alpha = 1;
    if (mode === "cruise") {
      alpha = Math.min(1, (now - cruiseT0) / 400);
      scale = 0.82 + 0.18 * ease(Math.min(1, (now - cruiseT0) / 1600)) + 0.012 * Math.sin(now / 420);
    } else {
      const p = pow((now - burstT0) / (T.burst * 0.7), 1.6);
      scale = 1 + p * 1.9; alpha = Math.max(0, 1 - p);
    }
    if (alpha <= 0) return;
    const color = dest.color || "#2F7F72";
    ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 190);
    g.addColorStop(0, color + "3A"); g.addColorStop(1, color + "00");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 190, 0, 7); ctx.fill();
    ctx.font = "600 24px " + font;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(dest.name).width, padX = 26, h = 52, w = tw + padX * 2;
    ctx.shadowColor = color + "66"; ctx.shadowBlur = 26;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(dest.name, 0, 1);
    ctx.restore(); ctx.globalAlpha = 1;
  };

  const drawFieldDots = (pull) => {
    for (const d of field) {
      const x = cx + (d.x - cx) * (1 - pull), y = cy + (d.y - cy) * (1 - pull);
      ctx.globalAlpha = Math.min(1, 0.26 + pull * 0.8);
      ctx.fillStyle = d.tint;
      ctx.beginPath(); ctx.arc(x, y, d.size / 2, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const tick = (now) => {
    if (done) return;
    if (!t0) { t0 = now + (world.lead || 0); lastNow = now; }
    /* A long gap between frames means the thread was taken (only possible in
       the main-thread fallback). Hold the clocks rather than skipping. */
    const lost = now - lastNow;
    if (lost > 120) {
      const shift = lost - 16;
      t0 += shift; if (cruiseT0) cruiseT0 += shift; if (burstT0) burstT0 += shift;
    }
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;
    const t = now - t0;
    if (t < 0) return;   // the hurry's lead
    ctx.clearRect(0, 0, W, H);

    if (phase === "ratchet") drawFieldDots(0);
    else if (phase === "reform") drawFieldDots(ease(t / T.reform) * FP);
    else if (phase === "streaks") {
      const p = t / T.streaks;
      const mR = Math.hypot(W, H) / 2 + 120;
      for (const d of field) {
        /* Each dot on its own WIDE clock: departures scatter across half the
           beat, so the endings scatter just as far — nothing leaves or finishes
           in formation. */
        const pd = Math.min(1, Math.max(0, (p - d.jit * 0.5) / 0.5));
        const dx = d.x - cx, dy = d.y - cy, dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist, uy = dy / dist;
        const r0 = dist * (1 - FP);
        if (pd <= 0) {
          ctx.fillStyle = d.tint; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(cx + ux * r0, cy + uy * r0, d.size / 2, 0, 7); ctx.fill();
          continue;
        }
        const pFar = pow(Math.min(1, pd / 0.62), 1.7);
        const pNear = pow(Math.max(0, (pd - 0.38) / 0.62), 2.0);
        const rNear = r0 + pNear * (mR - r0), rFar = r0 + 2 + pFar * (mR - r0);
        if (rNear >= rFar) continue;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = d.tint; ctx.lineWidth = d.size; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + ux * rNear, cy + uy * rNear);
        ctx.lineTo(cx + ux * rFar, cy + uy * rFar);
        ctx.stroke();
      }
      if (p > 0.45) drawTunnel(dt, 0.6 * ((p - 0.45) / 0.55));
      /* the mark leaves the same way, each dot at its own moment */
      const mRk = mR;
      for (const d of mk) {
        const pd = Math.min(1, Math.max(0, (p - d.jit * 0.45) / 0.55));
        const dx = d.sx - cx, dy = d.sy - cy, dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist, uy = dy / dist;
        if (pd <= 0) {
          ctx.fillStyle = d.fill;
          ctx.beginPath(); ctx.arc(d.sx, d.sy, d.sr, 0, 7); ctx.fill();
          continue;
        }
        const pFar = pow(Math.min(1, pd / 0.55), 1.6);
        const pNear = pow(Math.max(0, (pd - 0.3) / 0.7), 2.0);
        const rNear = dist + pNear * (mRk - dist), rFar = dist + 2 + pFar * (mRk - dist);
        if (rNear >= rFar) continue;
        ctx.strokeStyle = d.fill; ctx.lineWidth = d.sr * 2; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx + ux * rNear, cy + uy * rNear);
        ctx.lineTo(cx + ux * rFar, cy + uy * rFar);
        ctx.stroke();
      }
    } else if (phase === "cruise") {
      drawTunnel(dt, 1);
      drawSign(now, "cruise");
    } else if (phase === "burst") {
      drawTunnel(dt, 1 + pow(t / T.burst, 1.6) * 7);
      drawSign(now, "burst");
    }

    if (phase === "ratchet" && mk.length && t <= T.ratchet) {
      const p = t / T.ratchet;
      for (const d of mk) {
        const w = p * 1.35 - d.delay * 0.35;
        const k = Math.max(0, Math.sin(Math.min(1, Math.max(0, w)) * Math.PI));
        ctx.fillStyle = d.fill;
        ctx.beginPath(); ctx.arc(d.hx + k * 2.5, d.hy, d.hr * (1 + k * 0.5), 0, 7); ctx.fill();
      }
    } else if (phase === "reform" && mk.length) {
      const p = t / T.reform;
      for (const d of mk) {
        const lp = easeInOut(Math.min(1, Math.max(0, (p - d.delay * 0.3) / 0.7)));
        const mx = (d.hx + d.sx) / 2, my = Math.max(d.hy, d.sy) + 90;
        const ix = (1 - lp) * (1 - lp) * d.hx + 2 * (1 - lp) * lp * mx + lp * lp * d.sx;
        const iy = (1 - lp) * (1 - lp) * d.hy + 2 * (1 - lp) * lp * my + lp * lp * d.sy;
        ctx.fillStyle = d.fill;
        ctx.beginPath(); ctx.arc(ix, iy, d.hr + (d.sr - d.hr) * lp, 0, 7); ctx.fill();
      }
    }

    if (phase === "ratchet" && t >= T.ratchet) { phase = "reform"; t0 = now; post("phase", "reform"); }
    else if (phase === "reform" && t >= T.reform) { phase = "streaks"; t0 = now; post("phase", "streaks"); }
    else if (phase === "streaks" && t >= T.streaks) { phase = "cruise"; t0 = now; cruiseT0 = now; post("phase", "cruise"); }
    else if (phase === "cruise") {
      const tc = now - cruiseT0;
      if ((ready && tc >= T.cruiseMin) || tc >= T.cruiseCap) {
        phase = "burst"; t0 = now; burstT0 = now; post("phase", "burst");
      }
    } else if (phase === "burst" && t >= T.burst) { done = true; post("flash"); }
  };

  return {
    tick,
    msg: (m) => {
      if (m.type === "ready") ready = !!m.ready;
      if (m.type === "dest") dest = m.dest;
      if (m.type === "stop") done = true;
    },
  };
}

function runJump({ onFlash, onDone, lead = 0 }) {
  /* The driver. Measures the world at the press, hands the drawing to
     arrivalEngineCore — inside a Worker with an OffscreenCanvas wherever the
     browser has one, so the tunnel keeps its frame rate while the main thread
     mounts the dashboard — and keeps for itself the two jobs a worker cannot
     do: choreographing the DOM (the card's fade, the clouds' pull and blow-out)
     and the flash handover. */
  const root = typeof document === "undefined" ? null : document.documentElement;
  if (!root) { onFlash(); onDone(); return () => {}; }
  jumpShort = arrivalShort();
  if (jumpShort) {
    tellPhase("cruise");
    const t = setTimeout(() => { onFlash(); onDone(); }, 180);
    return () => clearTimeout(t);
  }
  arrivalTaken();
  jumpOwnsEntrance = true;
  jumpLanded = false;

  const W = window.innerWidth, H = window.innerHeight;
  const cx = W / 2, cy = H / 2;
  lastJumpOrigin = { x: cx, y: cy };
  root.style.setProperty("--jx", cx + "px");
  root.style.setProperty("--jy", cy + "px");

  /* ---- the mark, measured where it actually sits ---- */
  const gWord = sageDots({ word: true });
  let mk = [];
  if (lastMarkEl) {
    const mr = lastMarkEl.getBoundingClientRect();
    const scale = Math.min(mr.width / gWord.w, mr.height / gWord.h) || 1;
    const ox = mr.left + (mr.width - gWord.w * scale) / 2;
    const oy = mr.top + (mr.height - gWord.h * scale) / 2;
    const gS = sageDots({ word: false });
    const seatScale = scale * 0.62;
    const seats = gS.dots.map((d) => ({
      x: cx + (d.x - gS.w / 2) * seatScale,
      y: cy + (d.y - gS.h / 2) * seatScale,
      r: d.r * seatScale,
    })).sort((a, b) => a.x - b.x || a.y - b.y);
    const home = gWord.dots.map((d) => ({ x: ox + d.x * scale, y: oy + d.y * scale, r: d.r * scale, fill: d.fill }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const spanX = (home[home.length - 1].x - home[0].x) || 1;
    mk = home.map((d, i) => {
      const seat = seats[Math.round((i * (seats.length - 1)) / (home.length - 1))] || { x: cx, y: cy, r: d.r };
      return { hx: d.x, hy: d.y, hr: d.r, fill: d.fill,
        sx: seat.x, sy: seat.y, sr: seat.r,
        delay: (d.x - home[0].x) / spanX, jit: Math.random() };
    });
  }

  /* ---- the field: the page's own grid, continued past every edge ---- */
  const field = [];
  {
    let i = 0;
    for (let y = GROUND_PITCH / 2; y < H; y += GROUND_PITCH)
      for (let x = GROUND_PITCH / 2; x < W; x += GROUND_PITCH) {
        const bright = i % 3 === 0;
        field.push({ x, y, size: bright ? 4.4 : 2.6, tint: GROUND_TINTS[i % GROUND_TINTS.length], jit: Math.random() });
        i++;
      }
    const padX = W * 0.5, padY = H * 0.5;
    for (let y = GROUND_PITCH / 2 - padY; y < H + padY; y += GROUND_PITCH)
      for (let x = GROUND_PITCH / 2 - padX; x < W + padX; x += GROUND_PITCH) {
        if (x > 0 && x < W && y > 0 && y < H) continue;
        const bright = i % 3 === 0;
        field.push({ x, y, size: bright ? 4.4 : 2.6, tint: GROUND_TINTS[i % GROUND_TINTS.length], jit: Math.random() });
        i++;
      }
  }

  /* ---- the tunnel: seeded mid-life so the sky starts in steady state ---- */
  const maxR = Math.hypot(W, H) / 2 + 160;
  const tunnel = [];
  {
    const n = Math.round((W * H) / 7800);
    for (let i = 0; i < n; i++) {
      const waiting = Math.random() < 0.18;
      const r = waiting ? 2 : Math.pow(Math.random(), 1.7) * maxR;
      tunnel.push({
        ang: Math.random() * Math.PI * 2, r,
        t: Math.max(0, r - (200 + Math.random() * 160)),
        wait: waiting ? Math.random() * 0.9 : 0,
        v: 0.55 + Math.random() * 0.9,
        size: 1.4 + Math.random() * 2.2,
        tint: GROUND_TINTS[Math.floor(Math.random() * GROUND_TINTS.length)],
      });
    }
  }

  const cv = document.createElement("canvas");
  cv.className = "sage-jump-canvas";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  document.body.appendChild(cv);
  root.classList.add("sage-cv");

  const card = document.querySelector(".login-card");
  const blobs = Array.from(document.querySelectorAll(".sg-blob")).map((el) => {
    const r = el.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    const dx = bx - cx, dy = by - cy, dist = Math.hypot(dx, dy) || 1;
    return { el, ux: dx / dist, uy: dy / dist };
  });
  const restoreDom = () => {
    if (card) { card.style.opacity = ""; card.style.transform = ""; }
    for (const b of blobs) { b.el.style.transform = ""; b.el.style.opacity = ""; }
  };
  const bodyFont = (() => {
    try { return getComputedStyle(document.body).fontFamily || "sans-serif"; }
    catch (e) { return "sans-serif"; }
  })();

  const world = { W, H, dpr, T: JUMP_T, FP: 0.5, mk, field, tunnel, font: bodyFont, lead };

  let flashing = false, stopped = false, raf = 0, domRaf = 0;
  let worker = null, engine = null;

  const toFlash = () => {
    if (flashing || stopped) return;
    flashing = true;
    activeEngineSend = null;
    restoreDom();
    root.classList.add("sage-beat-flash");
    root.classList.remove("sage-cv");
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    if (cv.parentNode) cv.parentNode.removeChild(cv);
    onFlash();
    let frames = 0;
    const painted = () => {
      if (stopped) return;
      if (++frames < 2) { requestAnimationFrame(painted); return; }
      setTimeout(() => { if (!stopped) onDone(); }, 20);
    };
    requestAnimationFrame(painted);
  };

  const onPost = (type, data) => {
    if (stopped) return;
    if (type === "phase") tellPhase(data);
    else if (type === "flash") toFlash();
  };

  /* Worker where the browser has one; the same core on the main thread where
     it does not. Either way the maths exists once. */
  let usingWorker = false;
  try {
    if (typeof OffscreenCanvas !== "undefined" && cv.transferControlToOffscreen && typeof Worker !== "undefined") {
      const off = cv.transferControlToOffscreen();
      const src = "let eng=null;self.onmessage=function(e){var m=e.data;" +
        "if(m.type==='init'){var ctx=m.canvas.getContext('2d');" +
        "var core=(" + arrivalEngineCore.toString() + ");" +
        "eng=core(ctx,m.world,function(t,d){self.postMessage({type:t,data:d});});" +
        "var loop=function(now){if(!eng)return;eng.tick(now);requestAnimationFrame(loop);};" +
        "requestAnimationFrame(loop);}else if(eng){eng.msg(m);}};";
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      worker.onmessage = (e) => onPost(e.data.type, e.data.data);
      worker.postMessage({ type: "init", canvas: off, world }, [off]);
      usingWorker = true;
    }
  } catch (e) { try { if (worker) worker.terminate(); } catch (e2) {} worker = null; usingWorker = false; }
  if (!usingWorker) {
    const ctx = cv.getContext("2d");
    engine = arrivalEngineCore(ctx, world, onPost);
    const loop = (now) => {
      if (stopped || flashing) return;
      engine.tick(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  activeEngineSend = (m) => {
    if (worker) worker.postMessage(m);
    else if (engine) engine.msg(m);
  };
  activeEngineSend({ type: "ready", ready: arrivalReady });
  activeEngineSend({ type: "dest", dest: arrivalDest });

  /* ---- the DOM's own choreography, on a matching clock ----
     The card's fade and the clouds' pull and blow-out are DOM work, which a
     worker cannot touch. They run here, done before the cruise begins — which
     is exactly why the dashboard mount was moved INTO the cruise: by then the
     main thread has nothing visual left to animate. */
  const ease3 = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  const pw = (p, k) => Math.pow(Math.min(1, Math.max(0, p)), k);
  const domT0 = performance.now() + lead;
  const R = JUMP_T.ratchet, F = JUMP_T.reform, S = JUMP_T.streaks;
  const domLoop = (now) => {
    if (stopped || flashing) return;
    const t = now - domT0;
    if (t >= R && t < R + F) {
      const k = ease3((t - R) / F);
      if (card) {
        card.style.opacity = String(Math.max(0, 1 - k * 1.15));
        card.style.transform = "scale(" + (1 - k * 0.08) + ")";
      }
      for (const b of blobs) {
        b.el.style.transform = "translate(" + (-b.ux * k * 150) + "px," + (-b.uy * k * 150) + "px) scale(" + (1 - k * 0.1) + ")";
        b.el.style.opacity = String(1 - k * 0.3);
      }
    } else if (t >= R + F && t < R + F + S) {
      const k = pw((t - R - F) / S, 1.8);
      const out = k * Math.max(W, H) * 0.75;
      if (card) card.style.opacity = "0";
      for (const b of blobs) {
        b.el.style.transform = "translate(" + (b.ux * (out - 150 * (1 - k))) + "px," + (b.uy * (out - 150 * (1 - k))) + "px) scale(" + (0.9 + k * 0.5) + ")";
        b.el.style.opacity = String(Math.max(0, 0.7 - k * 1.1));
      }
    } else if (t >= R + F + S) {
      if (card) card.style.opacity = "0";
      for (const b of blobs) b.el.style.opacity = "0";
      return;   // nothing left for the main thread to animate
    }
    domRaf = requestAnimationFrame(domLoop);
  };
  domRaf = requestAnimationFrame(domLoop);

  return () => {
    if (flashing) return;
    stopped = true;
    activeEngineSend = null;
    cancelAnimationFrame(raf); cancelAnimationFrame(domRaf);
    if (worker) { try { worker.postMessage({ type: "stop" }); worker.terminate(); } catch (e) {} worker = null; }
    if (engine) engine.msg({ type: "stop" });
    restoreDom();
    root.classList.remove("sage-cv", "sage-beat-flash");
    if (cv.parentNode) cv.parentNode.removeChild(cv);
    jumpOwnsEntrance = false;
    tellPhase("off");   // release the mount gate: this jump is not landing
  };
}

/* True from the press until the arrival has finished. The app has an entrance of
   its own — .lpc.is-entering, the bar dropping in from above and the cards rising
   from below — and it is keyed off the session appearing, which now happens in the
   middle of the jump. Both ran, with different origins and unrelated timings, and
   that is what made the landing read as segmented: nothing came from the centre
   because appBar comes from the top edge and appRise from the bottom. Out-ranking
   it in CSS is a losing game (.lpc.is-entering .hero is three classes), so the
   app's entrance simply does not start when the arrival owns the screen. */
let jumpOwnsEntrance = false;
/* True from the moment landDashboard reveals the app until the hold is released.
   The root's layout effect hides the app whenever the sign-in screen is up, and
   it re-runs when the session object changes identity — which, on real auth,
   happens more than once: SIGNED_IN fires again after the first profile load.
   Without this latch a re-run inside the landing window put jump-under BACK on
   a revealed app: the impact played out hidden, the flash faded over a bare
   ground, and the dashboard popped in plain a second and a half later. A white
   screen, made of two pieces of code both doing their job. */
let jumpLanded = false;

/* Set by the sign-in button and read where the session lands. A page RELOAD
   restores a session without anyone pressing anything, and there is no sign-in
   screen for the jump to start from — no mark to streak, no form to fade. Jorge's
   call: a refresh at the desk goes straight in. So the trigger is the press, not
   the session. */
let signInPressed = false;

function SageArrival({ onComplete }) {
  const done = useRef(onComplete);
  done.current = onComplete;
  /* Only the last beat is left here. Everything before it happened on the sign-in
     screen, which is gone by the time this mounts — that is what the flash is
     covering. The beat reaches the dashboard as a class on the document rather
     than as a prop threaded through six components that have no other reason to
     know about it. */
  /* A LAYOUT effect, not an ordinary one, and that is the whole difference
     between this landing and the stutter it replaced.

     The blocks have to be measured before they are first painted, and the old
     code waited a frame for it — held them at opacity 0, asked for a
     requestAnimationFrame, and measured in that. But the frame it was waiting for
     is the one the browser spends mounting the dashboard, and under that load it
     did not come back for a SECOND: measured in the built app, the page arrived
     at 2134ms and the blocks were still invisible at 3180ms. The screen recording
     is 1.2 seconds of a byte-identical frame — the white had faded, the streaks
     were gone, and nothing at all was moving. That is the stutter.

     A layout effect runs after the DOM is committed and before the browser
     paints, so layout is already there to be read and the animation is on the
     blocks the first time they are drawn. Nothing to hide, nothing to wait for,
     and once the animation has started it belongs to the compositor and runs
     however busy the main thread gets. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    /* The flash beat belongs to the sign-in screen's clock, which has stopped.
       Hand it over rather than letting the two overlap: .sage-assemble carries an
       identical saFlash shorthand, so the running flash is not restarted by the
       swap, it simply changes which rule is holding it. */
    /* Both: sage-assemble is what the dashboard's own rules key off, and
       sage-beat-assemble is what the GROUND decelerates on. Adding only the first
       left the ground with no landing at all — the field and the blobs snapped
       from full streak back to rest the moment the flash class came off, which is
       the opposite of coming out of lightspeed. */
    root.classList.add("sage-assemble", "sage-beat-assemble");
    root.classList.remove("sage-beat-flash");
    const reduce = jumpShort;
    let undo = () => {};
    if (!reduce) undo = radialAssemble();
    const t = setTimeout(() => done.current(), reduce ? 320 : ARRIVAL.assemble);
    return () => {
      clearTimeout(t);
      undo();
      jumpOwnsEntrance = false;
      root.classList.remove("sage-assemble", "sage-beat-assemble", "sage-beat-flash");
    };
  }, []);
  return null;
}

/* The flash is not a component. It is a static div in index.html, because the
   handover it covers is the moment the signed-out tree is replaced by the
   signed-in one and those two have different root components: React tears the
   whole subtree down between them, so anything mounted inside either one is
   destroyed by the very swap it was drawn to hide. It needs nothing from React
   anyway — the beats drive it through classes on the document element. */

function greetingFor(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const GROUND_PITCH = 44;
const GROUND_TINTS = ["rgba(46,58,50,0.34)", "rgba(120,150,120,0.44)", "rgba(110,150,160,0.42)",
  "rgba(160,158,110,0.40)", "rgba(120,130,170,0.38)"];

/* Where the jump's streaks radiate FROM. The field's own centre by default, and
   the sign-in mark once the sign-in screen has told it where the mark is: the
   whole point of the jump is that it starts at the logo, and a field flying out
   of the middle of the frame while the mark flies out of a point 250px above it
   gives the eye two vanishing points to choose between. One origin, everything
   on the same lines. */
const JUMP_ORIGIN = "sage-jump-origin";
/* Kept outside the component for the same reason the flash is kept outside React:
   the ground is torn down and rebuilt at the handover along with the rest of the
   signed-out tree, and a ground that came back not knowing where the mark was
   would land its streaks on different lines from the ones they left on. */
let lastJumpOrigin = null;
let lastMarkEl = null;
function tellJumpOrigin(el) {
  if (typeof document === "undefined" || !el) return;
  lastMarkEl = el;
  const r = el.getBoundingClientRect();
  lastJumpOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  /* Published on the document as well as broadcast, because the spark that marks
     the far end of the jump is a static element in index.html and has no other
     way to know where the vanishing point is. */
  const root = document.documentElement;
  root.style.setProperty("--jx", lastJumpOrigin.x + "px");
  root.style.setProperty("--jy", lastJumpOrigin.y + "px");
  document.dispatchEvent(new CustomEvent(JUMP_ORIGIN, { detail: lastJumpOrigin }));
}

/* ---------------- coming out of lightspeed ----------------
   The dashboard does not fade up and it does not scale up in place. It comes out
   of the point the streaks converged on: every block starts at that point, small,
   and flies out along its own line to where it belongs, the near ones landing
   first and the far ones sweeping out after them.

   That vector cannot be written in CSS. Each block's direction and distance
   depend on where it happens to sit relative to a point that moves with the
   sign-in mark, so each one is measured once, on the frame the dashboard mounts,
   and handed its own --rx/--ry/--rd. After that it is an ordinary composited
   transform like everything else here.

   Measured once and never again: this reads layout for every block in one pass
   before writing anything back, so it costs a single forced reflow rather than
   one per element. */
/* The phone pages are built from their own blocks, not .hero and .card, and
   they fly in the same way: the Board's hero and standings, Check Out's hero,
   tiles and groups, and the Live Floor page as one. */
const RADIAL_PARTS = ".topbar, .app-header, .seg-wrap, .hero, .card, .assoc-card, .empty, .sect-strip, .bp-hero, .bp-stand, .co-tools, .co-grp, .fr-page, .pl-miss, .cx-card, .sm-chs, .pe-card";

/* ---- the handover does no React work at all ----
   Everything the dashboard needs in order to appear is a class on the document
   and a transform on a handful of blocks — and the dashboard itself has been
   mounted and laid out since the hold. So the handover is done here, imperatively,
   rather than by setting state.

   It was state, and the cost was a single 490ms task measured right after the
   flash: changing anything on the root re-renders the whole app tree, and this
   tree is very large. The mount had already been moved under the streaks by then,
   so what was left was React reconciling a dashboard that was not changing. Now
   the frame that reveals it touches four class names and reads the geometry of six
   blocks, and the state is settled a second and a half later when a re-render
   costs nothing anyone can see. */
function landDashboard() {
  if (typeof document === "undefined") return () => {};
  jumpLanded = true;
  const root = document.documentElement;
  /* One style change: the app comes out of hiding, the sign-in layer goes, and the
     landing rules come on together. */
  root.classList.remove("jump-under", "sage-beat-flash");
  root.classList.add("sage-assemble", "sage-beat-assemble", "signin-gone");
  const undo = jumpShort ? () => {} : radialAssemble();
  return () => {
    undo();
    root.classList.remove("sage-assemble", "sage-beat-assemble", "signin-gone");
  };
}
function radialAssemble() {
  if (typeof document === "undefined") return () => {};
  const o = lastJumpOrigin || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const els = Array.from(document.querySelectorAll(RADIAL_PARTS));
  if (!els.length) return () => {};
  /* Read everything first. Interleaving reads and writes here is the classic way
     to turn one reflow into forty. */
  const plan = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    /* Anything not actually laid out is skipped. The section strip is
       display:none above phone width, so its rect is all zeros — it was being
       handed a vector to the top-left corner of the screen and, being the
       furthest "element" on the page, it set the scale that every other block's
       delay was measured against. One invisible element was compressing the
       whole stagger. */
    if (r.width < 1 || r.height < 1) continue;
    /* ---- every element flies, but nothing crosses the screen ----
       Two failed versions taught this shape. Letting every block fly the full
       94% of its vector sent below-the-fold cards raining across the viewport.
       Skipping the off-screen blocks instead meant most of a real board simply
       appeared, and the impact read as not happening at all. So the TRAVEL is
       capped: everything takes the same radial journey out of the centre's
       direction, and a block whose home is far away takes a short hop along
       that line rather than a screen-crossing flight. The radial identity is
       everywhere; the chaos is nowhere. */
    let dx = o.x - (r.left + r.width / 2);
    let dy = o.y - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const cap = Math.min(vw, vh) * 0.55;
    if (dist > cap) { dx = (dx / dist) * cap; dy = (dy / dist) * cap; }
    plan.push({ el, dx, dy, dist: Math.min(dist, cap) });
  }
  if (!plan.length) return () => {};
  const far = Math.max(1, ...plan.map((p) => p.dist));
  for (const p of plan) {
    p.el.style.setProperty("--rx", p.dx.toFixed(1) + "px");
    p.el.style.setProperty("--ry", p.dy.toFixed(1) + "px");
    /* Nearest out first, so the screen opens from the point rather than arriving
       as one sheet. Capped so the last block is not left behind. */
    p.el.style.setProperty("--rd", Math.round((p.dist / far) * 260) + "ms");
    p.el.classList.add("sa-radial");
    /* The shadows follow the landing rather than clicking in after it: none
       while a block is in flight, bloomed in over a breath the moment ITS OWN
       animation ends, each block on its own clock like everything else here. */
    p.onEnd = (e) => {
      if (e.target !== p.el || e.animationName !== "saRadial") return;
      p.el.classList.add("sa-shadowin");
    };
    p.el.addEventListener("animationend", p.onEnd);
  }
  return () => {
    for (const p of plan) {
      p.el.removeEventListener("animationend", p.onEnd);
      p.el.classList.remove("sa-radial", "sa-shadowin");
      p.el.style.removeProperty("--rx");
      p.el.style.removeProperty("--ry");
      p.el.style.removeProperty("--rd");
    }
  };
}

function buildField(w, h, origin) {
  const dots = [];
  const cx = origin ? origin.x : w / 2, cy = origin ? origin.y : h / 2;
  let i = 0;
  for (let y = GROUND_PITCH / 2; y < h; y += GROUND_PITCH) {
    for (let x = GROUND_PITCH / 2; x < w; x += GROUND_PITCH) {
      /* A third of them, not an eighth. The handoff's eighth is the number that
         keeps the cost down, and it left the frame nearly empty at the peak of
         the jump — the mark's 73 streaks against a field that had already faded
         out. A third still costs nothing to animate (they are transforms with no
         promoted layers) and it is the difference between flying through
         something and flying through nothing. */
      /* Bright is now only about SIZE. Every dot streaks — Jorge asked for the
         whole page to go, not a third of it — and the handoff's "only the bright
         minority needs its own streak" was a cost note, written against
         will-change promoting each one into its own layer. Without that these are
         ordinary composited transforms and the whole field is affordable, which
         is the difference between flying through weather and flying through a
         sprinkling. */
      const bright = i % 3 === 0;
      const dx = x - cx, dy = y - cy;
      dots.push({
        x, y, bright,
        size: bright ? 4.4 : 2.6,
        tint: GROUND_TINTS[i % GROUND_TINTS.length],
        /* Its own angle out of the centre, so in the jump every streak leaves
           along the line it is already on. */
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        dist: Math.hypot(dx, dy),
        dur: 2600 + ((i * 971) % 5000),
        delay: (i * 337) % 4200,
      });
      i++;
    }
  }
  return dots;
}

/* The blobs, and only the blobs. These are the layer the handoff says continues
   through the transition rather than being swapped, so they are mounted once at
   the root and outlive both screens. The dot field is the sign-in screen's; see
   SageField. */
function SageGround({ beat = "idle" }) {
  return (
    <div className={"sage-ground beat-" + beat} aria-hidden="true">
      <div className="sg-blobs">
        <i className="sg-blob b1" /><i className="sg-blob b2" />
        <i className="sg-blob b3" /><i className="sg-blob b4" />
      </div>
    </div>
  );
}

/* ---------------- The dot field ----------------
   The sign-in screen's, and nobody else's. The handoff builds it under "The
   sign-in screen" and its prototype keys the whole thing off whether that screen
   is visible — `signinVisible ? ... : "off"` — while saying of the BLOBS, and only
   the blobs, that they "live behind both the sign-in screen and the dashboard,
   the same layer continuing through the transition rather than being swapped".
   Two different lifetimes, and this file had given both of them the longer one.

   That cost more than tidiness. 660 dots left on the dashboard meant 660 dots
   decelerating out of full streak while React mounted the dashboard, and the
   landing was measurably the worse for it: stalls of 467-983ms with the field
   there against none at all without it. The choppy landing and the drift Jorge
   could see on the dashboard are the same mistake seen from two sides.

   Rendered by the sign-in screen, so it is held for the whole jump and goes with
   that screen at the handover, underneath the white. */
/* ---------------- the streaks, on a canvas ----------------
   The field is 660 dots, and for the length of the stretch each one is a streak
   the size of the screen. As DOM elements that cannot be drawn at frame rate and
   it is not close: measured in the built app, tapered with a gradient it managed
   23-38 frames with stalls up to a second, as pills 44-47, and only as flat
   rectangles did it run clean at 64. The taper is not the problem, the element
   count is — 660 large composited layers is simply too many to paint.

   So for the one beat that needs them, the streaks stop being elements. One
   canvas, one texture upload a frame, and each streak drawn as a spike: full dot
   width at the near end, tapering to a point at the far one, which is what a
   streak looks like and what a scaled dot never did. Paths are batched by colour,
   so a frame is five fills rather than six hundred and sixty.

   Only for the stretch. At rest the dots are ordinary elements with a CSS
   twinkle, which costs nothing and keeps the sign-in screen still. */
function SageStreaks({ dots, origin, w, h }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    /* Grouped once, so a frame sets fillStyle five times rather than 660. */
    /* The canvas takes over mid-move, so it has to start where the gather left
       the dots: pulled in toward the origin by the field layer's own scale.
       Starting from their resting places would snap the whole field outward on
       the frame the streaks begin. */
    const ox = origin ? origin.x : w / 2, oy = origin ? origin.y : h / 2;
    const G = 0.86;
    const byTint = new Map();
    for (const d of dots) {
      const a = (d.angle * Math.PI) / 180;
      const arr = byTint.get(d.tint) || [];
      arr.push({
        x: ox + (d.x - ox) * G, y: oy + (d.y - oy) * G,
        ux: Math.cos(a), uy: Math.sin(a), r: (d.size / 2) * G, dist: d.dist,
      });
      byTint.set(d.tint, arr);
    }
    const groups = [...byTint.entries()];
    const t0 = performance.now();
    let raf = 0;
    /* ---- and it keeps accelerating to the end ----
       The streaks used to stop. The beat ended, the canvas held its last frame,
       and a screen full of static lines sat there for the quarter second the
       flash and the mount took — motion halted and then the page landed, which is
       the stutter at the join. Nothing about the shape was wrong; it simply never
       left.

       So the curve never flattens (a power curve, not a smoothstep, which eases
       OUT at the end), the travel is far enough to carry every near end off the
       frame rather than only the far ends, and it runs past the beat into the
       flash, fading as it goes. Whatever is still on screen when the sign-in
       screen goes is under the white by then. */
    const RUN = ARRIVAL.stretch + 300;
    const draw = () => {
      const p = Math.min(1, (performance.now() - t0) / RUN);
      const e = Math.pow(p, 2.2);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
      for (const [tint, arr] of groups) {
        ctx.fillStyle = tint;
        ctx.beginPath();
        for (const d of arr) {
          /* The near end leaves too, so the field opens out of the origin
             instead of stretching from a standstill. */
          const lead = e * (90 + d.dist * 1.75);
          const len = e * (150 + d.dist * 2.4);
          const nx = d.x + d.ux * lead, ny = d.y + d.uy * lead;
          const fx = nx + d.ux * len, fy = ny + d.uy * len;
          const px = -d.uy * d.r, py = d.ux * d.r;
          ctx.moveTo(nx + px, ny + py);
          ctx.lineTo(nx - px, ny - py);
          ctx.lineTo(fx, fy);
        }
        ctx.fill();
      }
      if (p < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [dots, origin, w, h]);
  return <canvas ref={ref} className="sg-streaks" style={{ width: w, height: h }} aria-hidden="true" />;
}

/* Whether the jump is at the beat that needs the canvas. Read off the document
   because that is where the beats live; see runJump. */
function useStretching() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setOn(root.classList.contains("sage-beat-stretch")
      || root.classList.contains("sage-beat-flash"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return on;
}

function SageField() {
  const [size, setSize] = useState(() => ({
    w: typeof window === "undefined" ? 1440 : window.innerWidth,
    h: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const [origin, setOrigin] = useState(lastJumpOrigin);
  useEffect(() => {
    let t = null;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), 220);
    };
    const onOrigin = (e) => setOrigin(e.detail);
    window.addEventListener("resize", onResize);
    document.addEventListener(JUMP_ORIGIN, onOrigin);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener(JUMP_ORIGIN, onOrigin);
      clearTimeout(t);
    };
  }, []);
  /* Rebuilt when the origin arrives, and only then: once per sign-in, not once
     per render. Rebuilding it per render was the handoff's second performance
     note and it still holds. */
  const dots = useMemo(() => buildField(size.w, size.h, origin), [size.w, size.h, origin]);
  const stretching = useStretching();
  if (stretching) {
    return <SageStreaks dots={dots} origin={origin} w={size.w} h={size.h} />;
  }
  return (
    <div className="sg-field" aria-hidden="true">
      {dots.map((d, i) => (
        <i key={i} className={"sg-dot" + (d.bright ? " bright" : "")}
          style={{
            left: d.x, top: d.y, width: d.size, height: d.size, color: d.tint,
            animationDuration: d.dur + "ms", animationDelay: d.delay + "ms",
            /* Read by the jump; set here so nothing has to be measured later.
               --d carries how far this dot sits from the origin, so the ones near
               the logo travel less than the ones out at the corners and the whole
               field opens rather than sliding as a sheet. */
            "--a": d.angle + "deg",
            "--d": d.dist.toFixed(1),
          }} />
      ))}
    </div>
  );
}

/* ---------------- Waiting on approval ---------------- */
function PendingScreen({ profile, onSignOut, config = null, onClaimed = null }) {
  const first = (profile.name || "").split(" ")[0];
  const [claim, setClaim] = useState({ store: "", person: null, name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const storeName = (id) => (((config && config.stores) || []).find((st) => st.id === id) || {}).name || id;
  const claimed = profile.claim && profile.claim.store ? profile.claim : null;
  const sendClaim = async () => {
    if (!claim.store) { setErr("Pick your store."); return; }
    setBusy(true); setErr("");
    const r = await authClaimName(claim);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    if (onClaimed) onClaimed();
  };
  /* What they asked to be at sign-up, if the account carries it. Two people wait
     on this screen for opposite reasons and the old copy only described one of
     them: a salesperson was told to wait for store access they will never be
     given and do not need. */
  const wants = profile.wants || profile.requested_role || null;
  const isAssociate = wants === "associate";
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><SageMark word size={56} className="logo-anim" /></div>
        <h1 className="login-title">{isAssociate ? "One thing left" : "Almost there"}</h1>
        {/* The first screen after signing up, so it speaks the same language as
            the one they just left rather than the app's general chrome. */}
        <p className="lf-note">
          {isAssociate ? (claimed ? (<>
            You are in{first ? ", " + first : ""}. Your manager at <b>{storeName(claimed.store)}</b> has
            a note that this account is <b>{claimed.name || "you"}</b>; one tap from them and the line,
            your standards and your day are on this phone. This screen will let you through on its own.
          </>) : (<>
            Your account exists{first ? ", " + first : ""}. Say which store you work at and which
            name on the roster is yours. Your manager joins the two with one tap, and then the line,
            your standards and your day are on your phone.
          </>)) : (<>
            Your account exists{first ? ", " + first : ""}, but no store has been assigned to it yet.
            Your group admin needs to approve you and grant access. Once they do, sign in again and you are in.
          </>)}
        </p>
        {/* The one thing this screen can hand somebody that is useful to the
            person on the other end of the conversation. */}
        {isAssociate && !claimed && (
          <div className="lf-mode">
            <ClaimPicker config={config} value={claim} onChange={(c) => { setClaim(c); setErr(""); }} />
            {err && <div className="login-err">{err}</div>}
            <button className="lf-go lf-solo" onClick={sendClaim} disabled={busy}><span>{busy ? "Sending…" : "That's me"}</span></button>
          </div>
        )}
        <p className="lf-note lf-acctid">Account <b>{String(profile.id || "").slice(0, 8)}</b> · {profile.email || ""}</p>
        <button className={isAssociate && !claimed ? "lf-alt" : "lf-go lf-solo"} onClick={onSignOut}>{isAssociate && !claimed ? "Sign out" : <span>Sign out</span>}</button>
      </div>
    </div>
  );
}


/* ---------------- Check Out Tracker (Daily Activity) ---------------- */
/* ===== PHONE-LEAD QUEUE ("Phone Line") — v4 ===== */

const QUEUE_TABLE = "queue_public";
/* Tickets ride in the queue table. That table is already readable and writable
   without signing in, which matters: the people most likely to hit a problem are
   salespeople on a sign-in page who have no account at all. A ticket nobody can
   file is a ticket nobody sends. */
const TICKET_PREFIX = "ticket:";



const DEFAULT_CHECKLIST = [
  // The first three tick themselves from the reports.
  { id: "calls", label: "Calls", hint: "Work the list", from: "calls", target: "minCalls" },
  { id: "videos", label: "Videos", hint: "Vehicle named in the first 10 seconds", from: "video", target: "minVideos" },
  { id: "tasks", label: "Tasks", hint: "Clear your queue", from: "tasks", target: "__posted" },
  { id: "appts", label: "Confirm appointments", hint: "48 hours out, not the morning of" },
  { id: "followup", label: "Follow up yesterday's ups", hint: "Anyone who did not buy" },
  { id: "walk", label: "Walk the lot", hint: "Know the ground before a customer asks" },
];
const checklistKey = (store, date, id) => `lpcq:list:${store}:${date}:${id}`;


/* ---- The test identity ----
   There is no way to check what a salesperson actually sees without being one, and
   borrowing a real person's name puts a fake body in the rotation, takes a real up,
   and lands in their numbers.

   So every queue carries one extra identity that only appears when the address says
   `&test=1`. Nobody else can see it or pick it, it is skipped when assigning, and it
   is left out of every count the floor is judged on. It is deliberately visible in
   the manager list rather than hidden: an invisible fake person in a live queue is
   how somebody ends up wondering why the numbers do not add up. */
const TEST_ID = "__lpc_test__";

const isTestId = (id) => id === TEST_ID;

async function saveTicket(t) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(QUEUE_TABLE)
      .upsert({ id: TICKET_PREFIX + t.id, data: t }, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch (e) { console.error("saveTicket", e); return false; }
}

const QUEUE_ID_TABLE = "queue_identity";
const queueRowId = (store, date, kind) => (!kind || kind === "line" ? `${store}:${date}` : `${store}:${date}:${kind}`);


const QUEUE_SELF_FLAGS = ["lunch", "customer", "away"];
/* The phone room's people do not press "On a call". Being on a call is what a
   desk is for, so it is something the desk puts you in, not a state you step
   into from a button — the same reasoning the floor already uses for "with a
   guest". The status itself is untouched: assigning a call still sets it. The
   Online queue keeps its segment, because "on a lead" is a thing a person does
   step into and is being rethought separately. */
const LINE_SELF_FLAGS = ["lunch", "away"];

/* Phone Line and Online are the same lead-queue mechanic with different wording,
   accent, data slot, and close-rate channel. Phone Line's config is byte-identical
   to its current behavior so nothing about it changes. */
const LEAD_VARIANTS = {
  line: {
    kind: "line", dataKey: "queue", param: "q", label: "Phone Line", count: "in line",
    title1: "Get in", title2: "line", segFlag: "On a call",
    channel: "close_phone", closeLabel: "phone close", sf: "sf-line", mf: "mf-line", accent: "#5566F0",
    joinTitle: "Get in line", joinSub: "Type your name to log in and start getting in line.",
    ready1: "You're in line", wait: "In line", aheadSub: "ahead of you for the next call",
    upSub: "The next phone opportunity is yours.", custTitle: "On a call", custSub: "Back in line the moment your call wraps.",
    custFlag: "On a call", joinBtn: "Join the line", bannerLabel: "Phone Opportunities", bannerGlyph: "phone", leave: "Leave the line", empty: "Nobody's in line yet. Post the code, or add someone below.",
  },
  online: {
    kind: "online", dataKey: "queueOnline", param: "o", label: "Online", count: "in the queue",
    title1: "Get in", title2: "the queue", segFlag: "On a lead",
    channel: "close_internet", closeLabel: "online close", sf: "sf-online", mf: "mf-online", accent: "#8B5CF6",
    joinTitle: "Get in the queue", joinSub: "Type your name to log in and start getting in line.",
    ready1: "You're in the queue", wait: "In the queue", aheadSub: "ahead of you for the next lead",
    upSub: "The next online lead is yours.", custTitle: "On a lead", custSub: "Back in the queue when you wrap up.",
    custFlag: "On a lead", joinBtn: "Join the queue", bannerLabel: "Internet Lead Opportunities", bannerGlyph: "globe", leave: "Leave the queue", empty: "Nobody's in the queue yet. Post the code, or add someone below.",
  },
};

/* Live Floor is not a lead queue — it has its own row, its own history and its
   own wording — but from the salesperson's side it is the same act, so it needs
   the same shape to hand to the shared screens. */
const FLOOR_VARIANT = {
  kind: "floor", label: "Live Floor", count: "on the floor",
  title1: "Step onto", title2: "the floor",
  joinSub: "Type your name to log in and take your place on the floor.",
  joinBtn: "Join the floor", bannerGlyph: "door",
  ready1: "You're on the floor", aheadSub: "ahead of you for the next up",
  upSub: "The next customer through the door is yours.",
  custTitle: "With a customer", custSub: "Back on the floor when you are done.",
  custFlag: "With customer", segFlag: "Customer", leave: "Leave the floor",
  empty: "Nobody's on the floor yet. Post the code, or add someone below.",
};

const shortLabel = (name) => {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || "");
};
const qNormName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const qFirstToken = (s) => qNormName(s).split(" ")[0] || "";

const qNowIso = () => new Date().toISOString();
const qMinsSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const qWaitLabel = (m) => (m < 1 ? "just now" : m === 1 ? "1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`);

/* ---- Supabase access: the per-day line row (queue_public) ---- */
/* A read that FAILED and a row that does not exist are completely different
   things, and treating them the same is what made people vanish from the line:
   one flaky read came back as "nobody is in the queue", the screen emptied, and
   the next write saved that emptiness. undefined means the read failed and
   nothing should be concluded from it; null means the row genuinely is not there
   yet. Every caller below acts on that difference. */
async function loadQueueRow(store, date, kind) {
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.from(QUEUE_TABLE).select("data").eq("id", queueRowId(store, date, kind)).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  } catch (e) { console.error("loadQueueRow", e); return undefined; }
}
async function saveQueueRow(store, date, data, kind) {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(QUEUE_TABLE).upsert(
      { id: queueRowId(store, date, kind), store, qdate: date, data, updated_at: qNowIso() }, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch (e) { console.error("saveQueueRow", e); return false; }
}
/* Every change to a queue row is read-modify-write against a row with no
   revision to check, so two writers overlapping means one of them silently
   loses. That is exactly what made a person added to the line disappear a few
   seconds later: the roster sync had read the row before the add and wrote its
   copy back afterwards. Mutations for a given row now queue up behind each
   other, so each one reads what the one before it wrote. */
const qChains = new Map();
async function mutateQueueRow(store, date, fn, kind) {
  const key = `${store}|${date}|${kind || "line"}`;
  const run = async () => {
    let cur = await loadQueueRow(store, date, kind);
    if (cur === undefined) { await new Promise((z) => setTimeout(z, 400)); cur = await loadQueueRow(store, date, kind); }
    if (cur === undefined) throw new Error("The queue could not be read just now, so nothing was changed.");
    const next = fn(cur ? JSON.parse(JSON.stringify(cur)) : null);
    if (!next) return cur;                       // a mutator that changed nothing
    if (!(await saveQueueRow(store, date, next, kind))) throw new Error("The change could not be saved just now.");
    return next;
  };
  const prev = qChains.get(key) || Promise.resolve();
  const p = prev.then(run, run);
  qChains.set(key, p.catch(() => {}));
  return p;
}

/* ---- Supabase access: the persistent identity row (queue_identity), one per store ---- */
async function loadQueueIdentities(store) {
  if (!supabase) return {};
  try {
    const r = await withTimeout(supabase.from(QUEUE_ID_TABLE).select("data").eq("id", store).maybeSingle());
    if (r.timedOut) throw new Error("timed out");
    if (r.error) throw r.error;
    const { data, error } = r.value;
    if (error) throw error;
    const v = (data && data.data) || {};
    cachePut("ids:" + store, v);
    return v;
  } catch (e) {
    console.error("loadQueueIdentities", e);
    const c = cacheGet("ids:" + store);
    return c ? c.value : {};
  }
}
async function mutateQueueIdentities(store, fn) {
  const cur = await loadQueueIdentities(store);
  const next = fn(JSON.parse(JSON.stringify(cur || {})));
  if (!next) return cur;
  if (supabase) {
    try {
      const { error } = await supabase.from(QUEUE_ID_TABLE).upsert(
        { id: store, data: next, updated_at: qNowIso() }, { onConflict: "id" });
      if (error) throw error;
    } catch (e) { console.error("saveQueueIdentities", e); }
  }
  return next;
}

/* ---- PIN hashing (Web Crypto; plaintext never stored or sent) ---- */
const qRandSalt = () => {
  const a = new Uint8Array(8);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
};
async function qHashPin(pin, salt) {
  const enc = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await (window.crypto.subtle).digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function qFindByPin(identities, pin, exceptId) {
  for (const id of Object.keys(identities || {})) {
    if (exceptId && id === exceptId) continue;
    const rec = identities[id];
    if (!rec || !rec.h || !rec.s) continue;
    // eslint-disable-next-line no-await-in-loop
    if ((await qHashPin(pin, rec.s)) === rec.h) return id;
  }
  return null;
}

/* ---- fuzzy name matching against the published roster ({id,label,role}) ---- */
function qLev(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
function qRankRoster(typed, roster) {
  const t = qNormName(typed), tf = qFirstToken(t);
  return (roster || []).map((r) => {
    const lab = qNormName(r.label), lf = qFirstToken(lab);
    const d = Math.min(qLev(t, lab), qLev(tf, lf));
    return { ...r, d, firstEq: lf === tf };
  }).sort((a, b) => a.d - b.d);
}
function qResolveName(typed, roster) {
  const ranked = qRankRoster(typed, roster);
  if (!ranked.length) return { kind: "none", suggestions: [] };
  const exact = ranked.filter((r) => r.d === 0);
  const firstMatches = ranked.filter((r) => r.firstEq);
  if (exact.length === 1) return { kind: "one", person: exact[0] };
  if (firstMatches.length > 1) return { kind: "pick", people: firstMatches.slice(0, 6) };
  if (firstMatches.length === 1 && ranked[0].firstEq) return { kind: "one", person: firstMatches[0] };
  if (ranked[0].d <= 2) return { kind: "confirm", person: ranked[0] };
  return { kind: "none", suggestions: ranked.slice(0, 4) };
}

/* ---- QR renderer ----
   The encoder ships with the app. It used to be fetched from a CDN the first
   time anybody opened a sign-in code, which is a network call at exactly the
   wrong moment: a dealership that blocks cdnjs, a phone on a bad connection or
   a slow morning all turned the code into the words "QR unavailable", and the
   only way onto the floor is that square. Nothing to fetch now. */
function loadQRCode() {
  return Promise.resolve(qrcodeGen);
}
function queueSignInUrl(storeId, date, token, param = "q", test = false) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?${param}=${encodeURIComponent(storeId)}&d=${encodeURIComponent(date)}&t=${encodeURIComponent(token)}`
    + (test ? "&test=1" : "");
}



function QueueQR({ url, cell = 6 }) {
  const ref = useRef(null);
  useEffect(() => {
    let dead = false;
    loadQRCode().then((qrcode) => {
      if (dead || !ref.current) return;
      try {
        const qr = qrcode(0, "M"); qr.addData(url); qr.make();
        ref.current.innerHTML = qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
        const svg = ref.current.querySelector("svg");
        if (svg) { svg.style.width = "100%"; svg.style.height = "auto"; svg.removeAttribute("width"); svg.removeAttribute("height"); }
      } catch (e) { if (ref.current) ref.current.textContent = "QR error"; }
    }).catch(() => { if (ref.current) ref.current.textContent = "QR unavailable"; });
    return () => { dead = true; };
  }, [url, cell]);
  return <div ref={ref} className="q-qr" aria-label="Sign-in QR code" />;
}


/* =========================================================================
   QueueSignIn — salesperson phone page (curtain wipe between screens)
   ========================================================================= */
/* ---- salesperson-view dot-matrix atoms (shared by Phone Line + Live Floor) ----
   The status glyphs used to live here as a second, 7x7 bitmap table. They are
   drawn from the app's own 5x5 set now (see SF_GLYPH), so there is one grid in
   the app rather than two that drift. The LED numeral below stays 3x5, because a
   numeral is a typeface rather than an icon. */
// analog LED numeral: each digit is keyed by its value so it remounts and "flips" on change
// light haptic feedback where supported (no-op elsewhere)
/* Inside the phone app the WebView swallows vibrate, so the buzz is also sent
   to the shell, which turns it into a real haptic. */
/* When the press last ticked (see pressDown), so the click behind it stays quiet. */
let buzzTickAt = 0;
function buzz(pattern, tick) {
  /* a person can turn the buzz off on their own phone; the tap still does its work */
  try { if (localStorage.getItem("lpcf:pref:buzz") === "0") return; } catch (e) {}
  /* A short buzz on the click that follows a touch-down tick would say the
     same thing twice; the press already gave it. Patterns still play: they
     mean something (taken, sent, failed) beyond "that was a tap". */
  if (tick) buzzTickAt = Date.now();
  else if (typeof pattern === "number" && pattern <= 14 && Date.now() - buzzTickAt < 400) return;
  try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  nativePost("buzz", pattern);
}
// bridge to the native app shell (Expo WebView). No-op in a normal browser.
function nativePost(type, payload) {
  try {
    const w = typeof window !== "undefined" ? window : null;
    if (w && w.ReactNativeWebView && typeof w.ReactNativeWebView.postMessage === "function") {
      w.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
    }
  } catch (e) {}
}
const postToNativeShell = (payload) => nativePost("queue", payload);
function DmNumber({ value, up }) {
  const s = String(value);
  return (
    <div className={"dm" + (up ? " dm-up" : "")}>
      {s.split("").map((ch, i) => (
        <span className="dm-digit" key={`${i}-${ch}`}>
          {(LED_FONT[ch] || ["000", "000", "000", "000", "000"]).flatMap((r, ri) =>
            r.split("").map((b, ci) => <span key={`${ri}-${ci}`} className={"ld" + (b === "1" ? " on" : "")} />))}
        </span>
      ))}
    </div>
  );
}

/* The time on the ring itself. Full turn at an hour, which is long enough that a
   normal wait reads as part of a turn rather than pinning immediately. Ticks itself
   so the figure keeps moving between server updates. */
function RingTimer({ mins, cap = 60 }) {
  const [now, setNow] = useState(mins);
  useEffect(() => { setNow(mins); }, [mins]);
  useEffect(() => {
    const t = setInterval(() => setNow((m) => m + 1), 60000);
    return () => clearInterval(t);
  }, []);
  const frac = Math.min(1, Math.max(0, now / cap));
  const R = 50, C = 2 * Math.PI * R;
  return (
    <span className="sf-timer" aria-label={qWaitLabel(now)}>
      <svg viewBox="0 0 110 110">
        <circle className="sf-timer-bg" cx="55" cy="55" r={R} />
        <circle className="sf-timer-fg" cx="55" cy="55" r={R}
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <b>{qWaitLabel(now)}</b>
    </span>
  );
}

/* ==========================================================================
   FLOORSIDE — the salesperson's screens
   ==========================================================================
   The way in used to be the manager app's card chrome dropped onto a dark
   background: a titled panel, a text input, a submit button. It worked and it
   looked like every other form anyone has ever filled in.

   These screens are built around the one thing a person standing on a
   showroom floor is actually doing, which is waiting for their turn. So the
   queue itself is drawn — a spine of nodes down the right edge, one per
   person, theirs lit at their position — and the queue's own colour bleeds up
   from the floor of the screen, the same three pairs the manager's board and
   the bottom bar already use. Nothing here is tinted by two things at once.

   Both sign-in components (Phone Line / Online, and Live Floor) render these,
   so the layout exists once rather than twice.
   ========================================================================== */

/* How much of the screen the on-screen keyboard is covering, as a CSS variable.
   iOS does not shrink 100dvh when the keyboard opens — the fixed layer keeps its
   full height and the keyboard is drawn over the bottom of it — so a field
   anchored to the foot ends up underneath it, and the strip the fixed layer no
   longer covers shows through. visualViewport is the only thing that knows.
   Written to the element rather than held in state: this fires on every frame of
   the keyboard animation, and a re-render per frame would be the jank we are
   trying to avoid. */
function useKeyboardInset(ref) {
  useEffect(() => {
    const vv = typeof window !== "undefined" && window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      // under ~80px it is Safari's own toolbar moving, not a keyboard
      el.style.setProperty("--kb", (kb > 80 ? kb : 0) + "px");
    };
    const onChange = () => { if (!raf) raf = requestAnimationFrame(apply); };
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, [ref]);
}

/* The status glyphs, on the same 5x5 grid as every other icon in the app. They
   were the last 7x7 table left. */
/* The three statuses take the same glyphs the manager's board shows for them, so
   a rep and a manager looking at the same person see the same mark. "Back in" is
   a return to the rotation rather than a step forward, so it takes the swap. */
const SF_GLYPH = {
  /* waiting takes the dot, which is what the spine lights at your position — the
     same mark for the same idea in two places on one screen. */
  waiting: "dot", customer: "user", lunch: "lunch", away: "away",
  back: "swap", mine: "arrow", door: "door",
};
function SfIcon({ name, size = 26 }) {
  return <PixIcon glyph={SF_GLYPH[name] || "dot"} size={size} className="sf-ico" />;
}

/* The status selector.
   Where you stand is one of four mutually exclusive things, so it is one track
   with one indicator rather than a grid of tiles — five big buttons for four
   states read as a phone app from 2010, and "Back in" appearing and
   disappearing meant the row changed shape depending on where you already
   were. Here the shape never changes and the pill simply moves.

   Same mechanic as the bottom bar on the manager side: measured off the live
   segment rather than placed by index, because "On a call" is a wider word than
   "Away" and the labels differ per queue. */
function SfStatusSelect({ value, variant, flags, onPick }) {
  /* "Here" is always the first segment; the rest are whichever ways this queue
     lets you stand down. Live Floor has no "with customer" state of its own, so
     its track is three wide, not four. */
  const states = ["waiting", ...flags];
  const trackRef = useRef(null);
  const segRefs = useRef({});
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) { setPill(null); return; }
    const place = () => {
      const seg = segRefs.current[value];
      if (!seg) return;
      setPill({ x: seg.offsetLeft, w: seg.offsetWidth });
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, flags.length]);

  const label = (st) =>
    st === "waiting" ? "Here"
    : st === "lunch" ? "Lunch"
    : st === "away" ? "Away"
    : (variant.segFlag || variant.custFlag || "Busy");

  return (
    <div className="sf-seg" ref={trackRef} role="radiogroup" aria-label="Where you are">
      <span className="sf-seg-pill" aria-hidden="true"
        style={pill ? { opacity: 1, width: pill.w + "px", transform: `translateX(${pill.x}px)` } : { opacity: 0 }} />
      {states.map((st) => (
        <button key={st} type="button" role="radio" aria-checked={st === value}
          ref={(el) => { segRefs.current[st] = el; }}
          className={"sf-seg-btn" + (st === value ? " on" : "")}
          onClick={() => { if (st !== value) { buzz(12); onPick(st); } }}>
          <SfIcon name={st} size={22} />
          <span>{label(st)}</span>
        </button>
      ))}
    </div>
  );
}

/* The spine. Two meanings, one shape:
     queue mode — one node per person waiting, yours lit and larger
     day mode   — one node per checklist item, and the three that count
                  themselves draw a ring filled to how far along they are,
                  because a tick can only ever say yes or no.
   Both are real readings of real data. There is no decorative mode. */
function SfSpine({ mode = "queue", count = 0, pos = 0, items = null, cap = "" }) {
  let nodes;
  if (mode === "day" && items) {
    nodes = items.map((it, i) => {
      const frac = it.need > 0 ? Math.min(1, it.got / it.need) : (it.done ? 1 : 0);
      if (frac >= 1) return <span key={i} className="sfn done" />;
      if (frac <= 0) return <span key={i} className="sfn" />;
      const C = 2 * Math.PI * 5;
      return (
        <span key={i} className="sfn ring">
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="2" />
            <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="var(--a2)" strokeWidth="2"
              strokeLinecap="round" transform="rotate(-90 6.5 6.5)"
              strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - frac)).toFixed(1)} />
          </svg>
        </span>
      );
    });
  } else {
    /* A very long queue would draw a node every couple of pixels, so past 14 the
       spine shows the run you are in rather than every person in the building. */
    const n = Math.min(count, 14);
    const from = pos > n ? pos - n + 1 : 1;
    nodes = [];
    for (let i = 0; i < n; i++) {
      const at = from + i;
      nodes.push(<span key={at}
        className={"sfn" + (at === pos ? " mine" : at < pos ? " past" : "")} />);
    }
  }
  return (
    <div className="sf-spine" aria-hidden="true">
      {cap ? <span className="sf-spine-cap">{cap}</span> : null}
      <div className="sf-spine-track">{nodes}</div>
    </div>
  );
}

/* The screen frame every one of these shares: body on the left, spine on the
   right. The body scrolls; the spine does not. */
function SfScreen({ children, spine, className = "" }) {
  return (
    <div className={"sf-view " + className}>
      <div className="sf-body">{children}</div>
      {spine}
    </div>
  );
}

function SfMark({ variant }) {
  return (
    <span className="sf-mark">
      <PixIcon glyph={variant.bannerGlyph} size={13} /><span>{variant.label}</span>
    </span>
  );
}

/* A heading in two lines, the second one dimmed. Two words carry further than
   a sentence on a screen read at arm's length between customers. */
function SfDisplay({ a, b, small }) {
  return <h2 className={"sf-display" + (small ? " sm" : "")}>{a}<span className="sf-dim">{b}</span></h2>;
}

/* The PIN pad, on the screen.
   It used to be a text input, which means iOS throws its keyboard up, the page
   shifts under your thumb, and someone with a customer three feet away is
   aiming at a 9mm key. These are 44pt targets that never move, the field is
   readOnly so the OS keyboard stays down, and the digits land in cells drawn on
   the same dot grid as the rest of the app. */
function SfPad({ value, onChange, onSubmit, busy, max = 6, cells = 4, goGlyph = "check" }) {
  const push = (d) => { if (value.length < max) { onChange(value + d); buzz(8); } };
  const del = () => { if (value.length) { onChange(value.slice(0, -1)); buzz(8); } };
  const shown = Math.max(cells, value.length);
  return (
    <>
      <div className="sf-pin-cells">
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className={"sf-pin-cell" + (i < value.length ? " on" : "")}>
            {i < value.length ? <PixIcon glyph="dot" size={13} /> : null}
          </span>
        ))}
      </div>
      <div className="sf-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="sf-key" disabled={busy}
            onClick={() => push(d)}>{d}</button>
        ))}
        <button type="button" className="sf-key sf-key-word" disabled={busy || !value.length}
          onClick={del} aria-label="Delete a digit">Delete</button>
        <button type="button" className="sf-key" disabled={busy} onClick={() => push("0")}>0</button>
        <button type="button" className="sf-key sf-key-go" disabled={busy || value.length < 4}
          onClick={onSubmit} aria-label={goGlyph === "arrow" ? "Next" : "Done"}>
          <PixIcon glyph={goGlyph} size={18} />
        </button>
      </div>
    </>
  );
}

/* ---- ten days of one person's numbers -----------------------------------
   The activity rows are already one per day per store, keyed by date, so a
   fortnight is one query rather than a new table. This is the same row the
   panel already reads for today; it just reads nine more of them. */
const SF_DAYS = 10;
function lastDays(n, endISO) {
  const out = [];
  const d = endISO ? new Date(endISO + "T12:00:00") : new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d); x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}
/* ---- the four ways in -------------------------------------------------- */
/* Name, then one of: straight through, "did you mean", "which one of these",
   or "that PIN belongs to someone else". All four are the same screen with a
   different question, so they share the frame and differ only in the middle. */
function SfName({ variant, storeName, typed, setTyped, submit, msg, suggestions, onPick, spine }) {
  return (
    <SfScreen spine={spine} className="sf-v-name">
      <SfMark variant={variant} />
      <p className="sf-kicker">{storeName}</p>
      <SfDisplay a={variant.title1} b={variant.title2} />
      <p className="sf-sub">{variant.joinSub}</p>
      {msg ? <p className="sf-err">{msg}</p> : null}
      {suggestions && suggestions.length > 0 && (
        <div className="sf-names">
          <p className="sf-names-cap">Did you mean</p>
          {suggestions.map((p) => (
            <button key={p.id} type="button" className="sf-name" onClick={() => onPick(p)}>
              {p.label}{p.role ? <i>{p.role}</i> : null}
            </button>
          ))}
        </div>
      )}
      <div className="sf-field">
        <input className="sf-input" autoFocus placeholder="Your name" value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button type="button" className="sf-cta" disabled={!typed.trim()} onClick={submit}>Continue</button>
      </div>
    </SfScreen>
  );
}

function SfPin({ variant, who, pinMode, pin, setPin, pin2, setPin2, submitPin, msg, busy, onNotMe, spine }) {
  /* Creating a PIN needs it twice. One pad fills the first row, then the second.
     The stage is held rather than derived from pin.length: derived, it flipped to
     "again" the moment a fourth digit landed, which made a five or six digit PIN
     impossible to type. */
  const [stage, setStage] = useState(1);
  const creating = pinMode === "create";
  const val = stage === 2 ? pin2 : pin;
  const set = stage === 2 ? setPin2 : setPin;
  const go = () => {
    if (creating && stage === 1) { if (pin.length >= 4) { setStage(2); buzz(12); } return; }
    submitPin();
  };
  /* A hardware keyboard still works — a manager checking this on a laptop, and
     anyone using a Bluetooth keyboard, would otherwise have no way in. */
  useEffect(() => {
    const onKey = (e) => {
      if (busy) return;
      if (/^[0-9]$/.test(e.key)) { if (val.length < 6) set(val + e.key); }
      else if (e.key === "Backspace") { set(val.slice(0, -1)); }
      else if (e.key === "Enter" && val.length >= 4) { go(); }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <SfScreen spine={spine} className="sf-v-pin">
      <button type="button" className="sf-back" disabled={busy} onClick={onNotMe}>
        <PixIcon glyph="arrowleft" size={12} /><span>That&rsquo;s not me</span>
      </button>
      <p className="sf-kicker">{who} · {variant.label}</p>
      <SfDisplay
        a={creating ? "Set your" : "Enter your"}
        b={creating && stage === 2 ? "PIN again" : "PIN"} />
      {creating && stage === 1
        ? <p className="sf-sub">Four to six digits. You will use it every day.</p> : null}
      {msg ? <p className="sf-err">{msg}</p> : null}
      <SfPad value={val} onChange={set} busy={busy} onSubmit={go}
        goGlyph={creating && stage === 1 ? "arrow" : "check"} />
    </SfScreen>
  );
}

function SfAsk({ variant, question, lead, yes, no, yesLabel = "Yes, that's me", noLabel = "No", busy, spine, note }) {
  return (
    <SfScreen spine={spine} className="sf-v-ask">
      <SfMark variant={variant} />
      <p className="sf-kicker">{lead}</p>
      <SfDisplay a={question[0]} b={question[1]} />
      {note ? <p className="sf-sub">{note}</p> : null}
      <div className="sf-field">
        <button type="button" className="sf-cta" disabled={busy} onClick={yes}>{yesLabel}</button>
        <button type="button" className="sf-cta sf-cta-quiet" disabled={busy} onClick={no}>{noLabel}</button>
      </div>
    </SfScreen>
  );
}

function SfPickList({ variant, people, taken, countLabel, onPick, onBack, typed, spine }) {
  return (
    <SfScreen spine={spine} className="sf-v-pick">
      <button type="button" className="sf-back" onClick={onBack}>
        <PixIcon glyph="arrowleft" size={12} /><span>Back</span>
      </button>
      <SfDisplay a="Which one" b="is you?" />
      <p className="sf-sub">A few names are close to &ldquo;{typed}&rdquo;.</p>
      <div className="sf-names sf-names-tall">
        {people.map((p) => {
          const isIn = taken(p.id);
          return (
            <button key={p.id} type="button" className="sf-name" disabled={isIn} onClick={() => onPick(p)}>
              {p.label}
              {p.role ? <i>{p.role}</i> : null}
              {isIn ? <em>{countLabel}</em> : null}
            </button>
          );
        })}
      </div>
    </SfScreen>
  );
}

/* ---- the missed-standard record: the notes, the lifts, and who was here ----
   All three come off the day's floor rows, which is the only record a phone can
   both read and write. The store document is out of reach from a phone by
   design — `lpc:store:%` is gated on being signed in with that store — and a
   flag whose evidence one side cannot read would be two different answers about
   the same week wearing one name. See api/_goal-standing.mjs.

   Three weeks back rather than ten days: the note has to cover the most recent
   bad day, which can be a week old by the time a run of days off has passed
   over it, and one query with a date range costs the same either way. */
const GOAL_LOOKBACK = 21;
async function loadGoalRecord(store, endDay, whoKey, meId) {
  const days = lastDays(GOAL_LOOKBACK, endDay);
  const rows = await loadFloorDays(store, days[0], days[days.length - 1]);
  /* Read by the same code the manager's screen reads them with, so the two sides
     cannot come to different answers about the same fortnight. This picks one
     person out of it; that screen shows all of them. */
  const { signedIn, notes, lifts } = readFloorDays(rows);
  return {
    notes: notes[whoKey] || [],
    lift: lifts[whoKey] || null,
    /* Somebody who signed in and did nothing all day HAS worked, and that is a
       bad day rather than a day off. The figures alone cannot tell those apart. */
    signedIn: signedIn[meId] || new Set(),
  };
}

/* Append-only, like every other decision in this system: a note is added, never
   edited and never replaced. */
async function writeGoalNote(store, date, note) {
  return mutateFloorRow(store, date, (cur) => {
    const next = cur || { date, store, line: [], history: [] };
    next.goalNotes = addNote(next.goalNotes, note);
    return next;
  });
}

async function loadMyDays(store, endDay, nameKeys) {
  /* Back to the first of the month at least: the corner draws the month as a
     line, and ten days of a thirty-day month is a stub. Thirty at least as
     well, now that the closing sheet draws a thirty-day channel line — on the
     2nd of a month the month-so-far is two days, which answers nothing about
     whether somebody's closing has moved.

     Thirty keys instead of ten costs one stamp read of a few bytes each, in
     the request that was already going out; the values still come back only
     for the days whose stamp has moved, which for a past day is never. */
  const dayOfMonth = parseInt(String(endDay || "").slice(8, 10)) || 1;
  const days = lastDays(Math.max(30, dayOfMonth), endDay);
  if (!supabase) return null;
  const keys = days.map((d) => floorStatsKey(store, d));
  /* A day row holds the whole store's numbers for that day, and this asked for
     every day of the month to read one person's line out of each. On a floor of
     thirty that is close to a megabyte, per salesperson, every time the corner
     is opened, and all but today's rows are days that will never change again.

     So: ask for the stamps, which are a few bytes for the month, and ask for the
     rows only where the stamp has moved. What is kept is the one line that was
     wanted, not the day, so a month of it is a few kilobytes and it lives on the
     phone rather than being fetched again tomorrow. */
  const cacheKey = `lpcf:days:${store}:${(nameKeys || []).find(Boolean) || "?"}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}") || {}; } catch (e) { cache = {}; }
  try {
    const { data: stamps, error } = await supabase.from("app_data").select("key,updated_at").in("key", keys);
    if (error) throw error;
    const stampOf = {};
    for (const r of stamps || []) stampOf[r.key] = r.updated_at || "none";
    const need = keys.filter((k) => !cache[k] || cache[k].s !== (stampOf[k] || "missing"));
    if (need.length) {
      const { data, error: e2 } = await supabase.from("app_data").select("key,value").in("key", need);
      if (e2) throw e2;
      const got = {};
      for (const r of data || []) got[r.key] = r.value;
      for (const k of need) {
        const v = got[k];
        let row = null;
        if (v) for (const nk of nameKeys) { if (nk && v[nk]) { row = v[nk]; break; } }
        cache[k] = { s: stampOf[k] || "missing", r: row };
      }
      // Days that have scrolled out of the month are weight on the phone.
      const want = new Set(keys);
      for (const k of Object.keys(cache)) if (!want.has(k)) delete cache[k];
      try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (e) {}
    }
    return days.map((d, i) => ({ day: d, row: (cache[keys[i]] || {}).r || null }));
  } catch (e) { return null; }
}

/* ---- the fence, freeing a seat ----
   A seat whose person has left the lot is a seat nobody told the system
   about, and it is the one thing GPS is actually good for: the fence cannot
   see a desk — 10 to 40 metres of doubt, per the geofence module's own note —
   but it can see the lot.

   Deliberately narrower than the floor's watcher, which asks whether somebody
   is done for the DAY and carries a snooze, a ticket and a lock-screen
   question. This asks nothing. It frees the seat and stops, because a station
   is not a shift: somebody who drove to lunch has not signed out, and the seat
   should be available to whoever is here now either way.

   `settle` does the deciding, with the same two confirmations and the same
   dwell the floor uses, so a single bad reading at the edge of the lot cannot
   turf somebody out of their chair. */
function useSeatFence({ fence, active, onLeft }) {
  const state = useRef(null);
  const left = useRef(false);
  useEffect(() => {
    if (!active) { state.current = null; left.current = false; return undefined; }
    if (!fence || !Array.isArray(fence.ring) || fence.ring.length < 3) return undefined;
    if (typeof navigator === "undefined" || !navigator.geolocation) return undefined;
    let dead = false;
    const read = () => new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
      setTimeout(() => finish(null), 9000);
    });
    const check = async () => {
      if (dead || document.hidden || left.current) return;
      const reading = await read();
      if (dead || !reading) return;
      const next = settle(state.current, reading, fence, Date.now(), { confirmations: 2, dwellMs: 60 * 1000 });
      state.current = next;
      if (next.crossed === "left") { left.current = true; onLeft(); }
    };
    check();
    const t = setInterval(check, 75 * 1000);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { dead = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [active, fence]); // eslint-disable-line
}

/* ---- your day at the station ----
   The same record the desk sees, shown to the person it is about. It holds
   every sit today: which station, in and out, how long, and why it ended.

   It exists for two reasons and they are both practical. Somebody who can see
   the whole of what is kept about them does not have to wonder what else is;
   and a person who can see their own day has a reason to tap out properly,
   which is the behaviour every number in the later phases depends on.

   What it deliberately does NOT show is where anybody has been. The fence
   knows one thing — on the lot or not — and that shows up here only as the
   reason a sit ended. There is no trail to draw because none is kept. */
/* The day's hourly buckets, off the published board row.
   Slow on purpose: the buckets move once an hour at most, because that is how
   often the Delivery Summary lands, and loadSharedIfChanged makes nearly every
   poll a stamp check rather than a fetch of the day. */
function useStationHours(storeId, date, tag) {
  const [hours, setHours] = useState(null);
  useEffect(() => {
    if (!storeId || !date) return undefined;
    let dead = false;
    const read = () => loadSharedIfChanged(floorStatsKey(storeId, date), `${tag || "stn"}:${storeId}:${date}`)
      .then((v) => { if (!dead && v && v !== "same") setHours(v.__hours || null); })
      .catch(() => {});
    read();
    const t = setInterval(read, 300000);
    return () => { dead = true; clearInterval(t); };
  }, [storeId, date, tag]);
  return hours;
}

function MyStationDay({ row, meId, store, date, now = Date.now() }) {
  /* Told which store and day rather than reading them off the row. The row
     carries `store` only when the desk created it and its repair path did not
     backfill the field, so a row that came up any other way silently read
     nothing here while the desk, two screens away, attributed the same person
     fourteen opportunities. The row's own copy is the fallback, not the
     source. */
  const hours = useStationHours(store || (row && row.store), date || (row && row.date), "myday");
  const meKey = useMemo(() => {
    const r = ((row && row.roster) || []).find((x) => x && x.id === meId);
    return r && r.name ? norm(r.name) : null;
  }, [row, meId]);
  const day = useMemo(() => personDay(row, meId, hours, meKey, now),
    [row, meId, hours, meKey, now]);
  const sits = day.sits;
  if (!sits.length) return null;
  const at = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  const why = (s) => {
    if (!s.out) return "now";
    if (s.why === "lunch") return "lunch";
    if (s.why === "left") return "left the lot";
    if (s.why === "moved") return "moved seat";
    return "tapped out";
  };
  /* What arrived while they were in the chair. Only the counters worth a line:
     an opportunity is the thing the seat exists for and calls are the effort
     behind it, and four numbers on a phone row is a wall rather than a fact. */
  const got = (s) => {
    const bits = [];
    if (s.op) bits.push(`${s.op} phone ${s.op === 1 ? "opp" : "opps"}`);
    if (s.ca) bits.push(`${s.ca} ${s.ca === 1 ? "call" : "calls"}`);
    if (s.ap) bits.push(`${s.ap} ${s.ap === 1 ? "appt" : "appts"}`);
    return bits.join(" \u00b7 ");
  };
  const anyShort = sits.some((s) => !s.hours && s.min > 0);
  return (
    <div className="sf-stnday">
      <div className="sf-stnday-head">
        <span>Your day at the desks</span>
        <b>{day.min} min</b>
      </div>
      {sits.map((s, i) => (
        <div key={i} className={"sf-stnday-row" + (s.out ? "" : " on")}>
          <span className="sf-stnday-st">{s.st}</span>
          <span className="sf-stnday-time">{at(s.in)} &ndash; {s.out ? at(s.out) : "now"}</span>
          <span className="sf-stnday-min">{s.min}m</span>
          <span className="sf-stnday-why">{why(s)}</span>
          {got(s) && <span className="sf-stnday-got">{got(s)}</span>}
        </div>
      ))}
      {/* Said once, at the bottom, because a stretch with nothing next to it
          looks like the system lost the work rather than like the report
          arriving by the hour. It is the honest limit, not a hedge: the
          Delivery Summary carries counts and no timestamps. */}
      {anyShort && (
        <p className="sf-stnday-note">
          Counted by the hour, from the report that lands hourly. A stretch that
          did not cover most of an hour does not get one.
        </p>
      )}
    </div>
  );
}

/**
 * The rooms a salesperson's phone can be in.
 * -------------------------------------------------------------------------
 * A linked salesperson landed straight in the floor's shell and there was no
 * way out of it. The phone line has had a screen of its own the whole time —
 * the one behind the daily QR — and their account already identifies them for
 * it; nothing was joining the two.
 *
 * So this owns which room is showing and nothing else. Both shells are
 * unchanged and each still does its own work; the switch floats above them and
 * is drawn only when the store actually offers more than one, because a
 * segmented control with one segment is furniture.
 *
 * The choice is remembered per store rather than per phone. Somebody linked at
 * two rooftops works the phones at one and the floor at the other, and a
 * device-wide memory would keep sending them to the wrong one — the same
 * mistake the home-store key already had to be fixed for.
 */
/* The lock screen's one message. Reads both day rows whether or not that
   screen is showing, builds the v2 envelope (api/_live-standing.mjs), and
   posts it to the shell once per change. The two room screens used to post
   their own, whichever was on top; a person on both lines got two cards
   fighting, and the one underneath went stale. */
function useLiveStanding({ config, store, date, account, room }) {
  const list = roomListOf(config, store);
  const wantFloor = list.includes("floor"), wantLine = list.includes("line");
  const [floorRow, setFloorRow] = useState(undefined);
  const [queueRow, setQueueRow] = useState(undefined);
  /* Its own stamp tag, so this reader and the screen reading the same row
     never hand each other a "same". */
  const pullFloor = useCallback(async () => {
    if (!wantFloor) return;
    const got = await loadRowIfChanged(FLOOR_TABLE, floorRowId(store, date), "live|floor|" + store + "|" + date);
    if (got === undefined || got === "same") return;
    setFloorRow(got || null);
  }, [store, date, wantFloor]);
  const pullLine = useCallback(async () => {
    if (!wantLine) return;
    const got = await loadRowIfChanged(QUEUE_TABLE, queueRowId(store, date, "line"), "live|line|" + store + "|" + date);
    if (got === undefined || got === "same") return;
    setQueueRow(got || null);
  }, [store, date, wantLine]);
  const liveF = useLiveRow(FLOOR_TABLE, wantFloor ? floorRowId(store, date) : null, pullFloor);
  const liveL = useLiveRow(QUEUE_TABLE, wantLine ? queueRowId(store, date, "line") : null, pullLine);
  useEffect(() => {
    pullFloor(); pullLine();
    const t = setInterval(() => { pullFloor(); pullLine(); }, (liveF || !wantFloor) && (liveL || !wantLine) ? 30000 : 5000);
    return () => clearInterval(t);
  }, [pullFloor, pullLine, liveF, liveL, wantFloor, wantLine]);
  /* An offer runs out on its own clock, and a nudge ages out; neither writes
     the row, so the standing is looked at again every so often. */
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((k) => k + 1), 10000); return () => clearInterval(t); }, []);
  const env = useMemo(() => {
    if (!account || floorRow === undefined && wantFloor || queueRow === undefined && wantLine) return null;
    return liveEnvelope({ config, store, date, meId: account, floorRow: floorRow || null, queueRow: queueRow || null,
      lastRoom: room === "line" ? "line" : "floor" });
  }, [config, store, date, account, room, floorRow, queueRow, tick]);   // eslint-disable-line
  /* ---- a phone lane press the shell could not make itself ----
     The card's own intents act through /api/queue-action with the session the
     page handed the shell; when that is not possible the word comes back here.
     The page has the same session, and the same endpoint keeps the phone
     standard's gate in one place, so it goes the same way rather than being
     applied here without it. The floor's words are the floor screen's. */
  useEffect(() => {
    if (!account) return undefined;
    const on = async (e) => {
      const act = e && e.detail && e.detail.action;
      if (!/-(desk|line)$/.test(String(act || ""))) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetch("/api/queue-action", { method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ store, date, action: act }) });
        pullLine();
      } catch (err) { /* the row poll tells the truth either way */ }
    };
    window.addEventListener("lpc:action", on);
    return () => window.removeEventListener("lpc:action", on);
  }, [account, store, date, pullLine]);
  const last = useRef(null);
  useEffect(() => {
    if (!env) return;
    const key = JSON.stringify({ ...env, updatedAt: null });
    if (key === last.current) return;
    /* Gone is said once, and only after something was on: a phone that opens
       to an empty day has no card to take down. */
    if (env.status === "gone" && last.current === null) { last.current = key; return; }
    last.current = key;
    postToNativeShell(env);
  }, [env]);
}

function AssociateRooms({ config, store, date, account, onSignOut }) {
  const list = roomListOf(config, store);
  const key = `lpcf:room:${store}`;
  /* "Opens to" wins over the memory of the last room when it is set; the
     memory still runs underneath, for the day they set it back to Last. */
  const openTo = openToOf(store);
  const [want, setWant] = useState(() => {
    if (openTo === "line") return "line";
    if (openTo === "home" || openTo === "floor") return "floor";
    try { return localStorage.getItem(key) || null; } catch (e) { return null; }
  });
  const [tab, setTab] = useState(openTo === "floor" ? "floor" : "corner");
  const room = openRoom(config, store, want);
  /* Which rooms have been opened this visit: a room is built the first time
     it is looked at and kept from then on. Each remembers where it was
     scrolled to, so coming back lands where they left. */
  const seen = useRef({ floor: false, line: false });
  if (room) seen.current[room === "line" ? "line" : "floor"] = true;
  /* And the other one is built quietly a moment after the first has settled,
     so the first tap across is as quick as every tap after it. */
  const [warm, setWarm] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWarm(true), 2500); return () => clearTimeout(t); }, []);
  if (warm) { if (list.includes("line")) seen.current.line = true; if (list.includes("floor")) seen.current.floor = true; }
  const scrolls = useRef({ floor: 0, line: 0 });
  const pick = (r) => {
    if (r !== room) {
      try { scrolls.current[room === "line" ? "line" : "floor"] = window.scrollY; } catch (e) {}
      const back = scrolls.current[r === "line" ? "line" : "floor"] || 0;
      requestAnimationFrame(() => { try { window.scrollTo(0, back); } catch (e) {} });
    }
    setWant(r); try { localStorage.setItem(key, r); } catch (e) {}
  };
  useLiveStanding({ config, store, date, account, room });

  /* Both switched off. A real state — somebody has done it deliberately — and
     worth saying plainly rather than drawing an empty shell they will tap at. */
  if (!room) {
    return (
      <div className="ar-none">
        <div className="ar-none-h">Nothing to show yet</div>
        <p>This store has not turned on the floor or the phone line for its people. A manager can switch either on in the store&rsquo;s settings.</p>
        {onSignOut && <button type="button" className="btn" onClick={onSignOut}>Sign out</button>}
      </div>
    );
  }

  /* One bar at the foot for everywhere this phone can be. Home is the person's
     own corner, which lives inside the floor's shell, so a store with no floor
     has no corner either and the bar is just its one room — which is a bar
     with one button on it, so it is not drawn at all.

     The floor's own pill is suppressed while this is showing. Two pills at the
     foot, one of them a subset of the other, is how somebody ends up tapping
     the wrong one. */
  const tabs = [];
  if (list.includes("floor")) tabs.push("home", "floor");
  if (list.includes("line")) tabs.push("line");
  const active = room === "line" ? "line" : tab === "corner" ? "home" : "floor";
  const go = (t) => {
    buzz(8);
    if (t === "line") { pick("line"); return; }
    pick("floor");
    setTab(t === "home" ? "corner" : "floor");
  };
  const GLYPH = { home: "home", floor: "door", line: "phone" };
  const LABEL = { home: "Home", floor: "Live Floor", line: "Phone Line" };
  const net = useNet();

  return (
    <>
      {net.offline && (
        <div className="ar-net" role="status">
          <PixIcon glyph="warn" size={12} />
          <span>No connection{net.asOf ? ` · as of ${mcClock(new Date(net.asOf).toISOString()) || ""}` : ""}</span>
        </div>
      )}
      {/* Both rooms stay mounted once they have been opened, and a tab shows
          one of them. Switching used to rebuild the room from nothing: a
          refetch of its row, its identities and the setup, and the curtain
          over all of it, which on the lot was a second and a half of curtain
          for a screen the phone already had. Now it is the screen the phone
          already had. The hidden one is inert, so nothing in it can be
          tapped or focused, and it polls slowly until it is looked at. */}
      <div className="ar-room" hidden={room !== "line"} inert={room !== "line" ? "" : undefined}>
        {seen.current.line && (
          <QueueSignIn key={"line:" + store + ":" + date} store={store} date={date} token={null}
            variant={LEAD_VARIANTS.line} account={account} onSignOut={onSignOut} active={room === "line"} />)}
      </div>
      <div className="ar-room" hidden={room === "line"} inert={room === "line" ? "" : undefined}>
        {seen.current.floor && (
          <FloorSignIn key={"floor:" + store + ":" + date} store={store} date={date} token={null}
            account={account} onSignOut={onSignOut} tab={tab} onTab={setTab} active={room !== "line"} />)}
      </div>
      {tabs.length > 1 && (
        <div className="ar-bar" role="tablist" aria-label="Where to go">
          <span className="ar-ind" style={{ transform: `translateX(${tabs.indexOf(active) * 100}%)`,
            width: `calc((100% - 8px) / ${tabs.length})` }} />
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={active === t} aria-label={LABEL[t]}
              className={"ar-tab" + (active === t ? " on" : "")} onClick={() => go(t)}>
              <PixIcon glyph={GLYPH[t]} size={20} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The room, on the salesperson's own phone.
 * -------------------------------------------------------------------------
 * The line is the thing that matters LAST. A phone room with a free chair does
 * not need anybody queuing for a call — it needs them to go and sit down — so
 * this leads with the desks and lets the position in line take over only when
 * every one of them is taken, which is exactly what the rotation itself does.
 *
 * Four things it can say, in the order they matter to the person reading:
 *
 *   you are at one       where, and for how long
 *   one is yours         the rotation has offered them a chair, with the clock
 *                        on it. The strongest thing this screen ever says
 *   there are free ones  which numbers. Go and take one
 *   the room is full     who is in it, and now the line is the answer
 *
 * Selecting a desk from here is not built: that is the tag on the desk, and
 * until it exists the honest thing is to name the free ones and let them walk
 * over. What is drawn is what is known.
 */
/* =========================================================================
   The phone room, on their own phone
   -------------------------------------------------------------------------
   One screen with four lives: waiting on the cord, a desk coming free, the
   walk over, and the desk itself. The desks are a row at the top because
   they ARE the room; the panel that used to say the same thing in sentences
   at the foot of the screen is gone. Everything below the row is the same
   pieces the floor already uses: the dot-matrix digit, the PixIcons, the
   floor's two-line timers, and the flat tiles.
   ========================================================================= */
/* Two letters for a person on the cord: the same shorthand the floor's track
   uses for the people ahead of you. */
const sfInitials = (nm) =>
  String(nm || "").trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "·";

/* The desks, in one row above the hero: who is at each one, which is free,
   which is yours. A desk offered to somebody else carries their name, dim, so
   a chair that looks empty does not read as one you can take. */
function SfDeskRow({ seats, meId }) {
  return (
    <div className="sfd-row" role="list" aria-label="The desks">
      {seats.map((s) => {
        const mine = s.taken && s.id === meId;
        const open = !s.taken && (!s.offerTo || s.offerTo === meId);
        const who = mine ? "you" : s.taken ? stnFirst(s.label) : open ? "free" : stnFirst(s.offerLabel);
        /* only the desk offered to you beckons; a free desk nobody is being
           sent to is lit and still, so an open room is not six things bouncing */
        const cls = mine ? " you" : open && s.offerTo === meId ? " open" : open ? " free" : "";
        return (
          <span key={s.n} role="listitem" className={"sfd" + cls}>
            <b>{s.n}</b><em>{who}</em>
          </span>
        );
      })}
    </div>
  );
}

/* The cord. Everybody waiting rides it as a motion path, so a change of place
   is a slide along the curve rather than a redraw; you are the blue chip with
   your position in dots, the others wear the floor's sand. A newcomer runs in
   from the left end, bumps whoever they land behind, and settles. One pulse of
   light runs the cord from the tail, pausing at each person, out to the front
   of the line. The handset at the end stays dark until a desk is yours. */
const SF_CORD = "M 26 150 C 96 232, 190 40, 292 112";
const SF_CORD_STEP = 0.22;
const sfPct = (t) => `${(Math.max(0, Math.min(1, t)) * 100).toFixed(2)}%`;

/* The light along a line: from the tail, a stop at every person, as far as
   the front of the line, then again. The cord runs it as a dash offset, the
   tracks as a dot that travels; both hand in their stops as percent of the
   way along and a setter for one point along the way (and, for a light that
   fades in at the tail and out at the front, its opacity). A second light
   can run half a cycle behind.

   Driven by a frame loop rather than a Web Animation: WebKit would not
   repaint the cord's stroke while an animation moved it, so the light sat
   still on a phone. Returns the cancel. */
function lineLight(el, stops, apply, { fade = false, half = false, run = 14 } = {}) {
  if (!el || !stops.length) return undefined;
  const HOLD = 520, TAIL = 700;   // run: ms for one percent of the way
  const segs = [];
  let t = 0, from = 0;
  stops.forEach((st, i) => {
    segs.push({ t0: t, t1: t + (st - from) * run, a: from, b: st }); t = segs[segs.length - 1].t1;
    segs.push({ t0: t, t1: t + (i === stops.length - 1 ? TAIL : HOLD), a: st, b: st }); t = segs[segs.length - 1].t1;
    from = st;
  });
  const total = t || 1;
  let reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  if (reduce) { apply(stops[stops.length - 1], 1); return undefined; }
  const start = performance.now() - (half ? total / 2 : 0);
  const first = segs[0], last = segs[segs.length - 1];
  let raf;
  const tick = (now) => {
    const u = (now - start) % total;
    const sg = segs.find((g) => u < g.t1) || last;
    const k = sg.t1 > sg.t0 ? (u - sg.t0) / (sg.t1 - sg.t0) : 1;
    let op = 1;
    if (fade) {
      if (u < first.t1) op = first.t1 > 0 ? u / first.t1 : 1;
      else if (u >= last.t0) op = 1 - (u - last.t0) / (last.t1 - last.t0);
    }
    apply(sg.a + (sg.b - sg.a) * k, op);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/* The same light on a track: two dots that come in from the track's left
   edge and travel to the head of the line, a stop at every person on the
   way, the second half a cycle behind the first. The stops are where the
   pips stand, measured after layout. */
function useTrackLight(ref, key, pipSel) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    /* The rail's own dots only. A pip can carry "lt" too (light ink on a light
       tag), and taking those along shrank the person to a dot and rode them
       down the rail with the light. */
    const dots = [...el.querySelectorAll(":scope > s.lt")];
    const r = el.getBoundingClientRect();
    if (!dots.length || !r.width) return undefined;
    const stops = [...el.querySelectorAll(pipSel)]
      .map((p) => { const q = p.getBoundingClientRect(); return ((q.left + q.width / 2 - r.left) / r.width) * 100; })
      .map((x) => Math.max(0, Math.min(100, x))).sort((a, b) => a - b);
    /* The dots take their time: about three and a half seconds edge to edge,
       against the cord's light at under a second and a half. */
    const offs = dots.map((d, i) => lineLight(d, stops, (st, op) => {
      d.style.transform = `translateX(${((st / 100) * r.width).toFixed(1)}px)`;
      d.style.opacity = op.toFixed(2);
    }, { fade: true, half: i % 2 === 1, run: 34 }));
    return () => offs.forEach((off) => off && off());
  }, [key]);   // eslint-disable-line
}
function SfCord({ ahead, behind, pos, landed, lit }) {
  const youT = landed ? 0.975 : 0.8 - ahead.length * SF_CORD_STEP;
  const tOf = {};
  ahead.forEach((p, i) => { tOf[p.id] = youT + SF_CORD_STEP * (ahead.length - i); });
  behind.forEach((p, j) => { tOf[p.id] = youT - SF_CORD_STEP * (j + 1); });
  const litRef = useRef(null);
  const youRef = useRef(null);
  const pips = useRef({});
  const seen = useRef(null);
  const [ghosts, setGhosts] = useState([]);

  /* Who came and who went since the last render. Layout effect, so a newcomer
     is already moving before the first frame that would show them in place. */
  useLayoutEffect(() => {
    const all = [...ahead, ...behind];
    const prev = seen.current;
    if (prev) {
      const here = new Set(all.map((p) => p.id));
      const gone = [...prev.keys()].filter((id) => !here.has(id));
      if (gone.length) {
        setGhosts((g) => [...g, ...gone.map((id) => ({ id, ...prev.get(id) }))]);
        setTimeout(() => setGhosts((g) => g.filter((x) => !gone.includes(x.id))), 420);
      }
      const order = all.map((p) => p.id).sort((a, b) => tOf[a] - tOf[b]);
      all.filter((p) => !prev.has(p.id)).forEach((p) => {
        const el = pips.current[p.id];
        if (!el || !el.animate) return;
        const t = tOf[p.id];
        const k = order.indexOf(p.id);
        const nextId = order[k + 1];
        const nextEl = nextId ? pips.current[nextId] : null;
        const neighbour = nextEl || (nextId == null ? null : youRef.current);
        /* far enough to touch: two small chips, or a small one and you */
        const hitT = t + SF_CORD_STEP * (nextEl ? 0.64 : 0.56);
        const from = k === 0 ? 0 : t - SF_CORD_STEP * 0.6;
        const HIT = 560;                     // ms until contact; the run in does not slow before it hits
        el.animate([
          { offsetDistance: sfPct(from), opacity: 0, easing: "cubic-bezier(.35,.1,.7,.8)" },
          { offsetDistance: sfPct(hitT), opacity: 1, offset: HIT / 1400, easing: "cubic-bezier(.2,.8,.3,1)" },
          { offsetDistance: sfPct(t), opacity: 1 }], { duration: 1400 });
        const bumped = neighbour || (tOf[p.id] < youT ? youRef.current : null);
        if (bumped) {
          const lt = parseFloat(bumped.style.offsetDistance);
          if (!isNaN(lt)) bumped.animate([
            { offsetDistance: `${lt}%` },
            { offsetDistance: `${lt + 3.2}%`, offset: .2, easing: "cubic-bezier(.4,.6,.5,1)" },
            { offsetDistance: `${lt}%` }], { duration: 1000, delay: HIT - 30, easing: "cubic-bezier(.2,.8,.3,1)" });
        }
      });
    }
    const m = new Map();
    all.forEach((p) => m.set(p.id, { t: tOf[p.id], label: p.label }));
    seen.current = m;
  });

  /* The light: from the tail, a stop at every person, as far as the front of
     the line, then again. Rebuilt whenever anybody moves. Solid once landed. */
  const stops = Object.values(tOf).concat([youT]).map((t) => Math.max(0, Math.min(1, t)) * 100).sort((a, b) => a - b);
  const stopsKey = stops.map((s) => s.toFixed(1)).join(",");
  const gloRef = useRef(null);
  useEffect(() => (landed ? undefined : lineLight(litRef.current, stops, (st) => {
    const off = String(100 - st);
    litRef.current.style.strokeDashoffset = off;
    if (gloRef.current) gloRef.current.style.strokeDashoffset = off;
  })), [stopsKey, landed]);   // eslint-disable-line

  const oth = (p, extra) => (
    <span key={p.id} ref={(el) => { pips.current[p.id] = el; }} className={"sfc-oth" + (extra || "")}
      style={{ offsetDistance: sfPct(tOf[p.id]) }}>{sfInitials(p.label)}</span>
  );
  return (
    <div className={"sfc" + (landed ? " landed" : "")}>
      <svg viewBox="0 0 350 232" aria-hidden="true">
        <path className="sfc-cord" d={SF_CORD} />
        <path ref={gloRef} className="sfc-glo" d={SF_CORD} pathLength="100" />
        <path ref={litRef} className="sfc-lit" d={SF_CORD} pathLength="100" />
      </svg>
      <div className="sfc-pips">
        {ahead.map((p) => oth(p))}
        <span ref={youRef} className="sfc-you" style={{ offsetDistance: sfPct(youT) }}>
          <DmNumber value={landed ? 1 : pos} />
        </span>
        {behind.map((p) => oth(p))}
        {ghosts.map((g) => (
          <span key={"g" + g.id} className="sfc-oth gone" style={{ offsetDistance: sfPct(g.t) }}>{sfInitials(g.label)}</span>
        ))}
      </div>
      <div className={"sfc-desk" + (lit ? " lit" : "")}>
        <span className="sfc-shock" /><span className="sfc-shock d2" />
        <span className="sfc-ant" />
        <span className="sfc-face"><PixIcon glyph="phone" size={44} /></span>
      </div>
    </div>
  );
}

/* The floor's two-line timers, three wide. Every state has all three: the
   wait runs on the cord and freezes when a desk is offered, the desk clock
   starts when you sit, the day accumulates. */
function SfLineTimers({ onLine, atDesk, today }) {
  const fmt = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  };
  return (
    <div className="mcf-tmr sfl-tmr">
      <span><span className="v"><PixIcon glyph="arrowup" size={14} /> <b>{fmt(onLine)}</b></span><span className="l">ON THE LINE</span></span>
      <span><span className="v"><PixIcon glyph="clock" size={14} /> <b>{fmt(atDesk)}</b></span><span className="l">AT THE DESK</span></span>
      <span><span className="v"><PixIcon glyph="phone" size={14} /> <b>{fmt(today)}</b></span><span className="l">ON DESKS TODAY</span></span>
    </div>
  );
}

/* Flat tiles in the desk row's treatment: dim, the chosen one white. No track
   and no sliding pill. The options change shape with the state on purpose:
   at a desk, "here" and "away" mean nothing, so the tiles there are Lunch
   and Leave the desk. */
function SfTiles({ value, options, onPick }) {
  return (
    <div className="sft-row" role="radiogroup" aria-label="Where you are">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={o.key === value}
          className={"sft" + (o.key === value ? " on" : "")}
          onClick={() => { if (o.key !== value) { buzz(12); onPick(o.key); } }}>
          <SfIcon name={o.glyph || o.key} size={22} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function SfLineLive({ cfg, store, row, meId, me, onFlag, onRelease }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const plan = useMemo(() => stationPlanOf(cfg, store), [cfg, store]);
  const mode = stationModeOf(cfg, store);
  const board = useMemo(
    () => stationLine(plan, row, { now, offers: mode === "rotation" }),
    [plan, row, mode, now]);
  const st = me.status;
  const mine = board.seats.find((s) => s.taken && s.id === meId) || null;
  const offered = board.seats.find((s) => s.offerTo === meId) || null;
  const freeSeat = board.seats.find((s) => !s.taken && !s.offerTo) || null;
  const roster = (row && row.roster) || [];
  const labelOf = (p) => { const r = roster.find((x) => x && x.id === p.id); return (r && (r.label || r.name)) || p.label || ""; };
  /* The cord runs in desk order, not line order: the rotation is who the next
     desk goes to, and that is the thing a person on the cord is reading. */
  const waiting = board.waiting;
  const myIdx = waiting.findIndex((p) => p.id === meId);
  const ahead = (myIdx >= 0 ? waiting.slice(0, myIdx) : waiting).map((p) => ({ id: p.id, label: labelOf(p) }));
  const behind = (myIdx >= 0 ? waiting.slice(myIdx + 1) : []).map((p) => ({ id: p.id, label: labelOf(p) }));

  const kind = st !== "waiting" ? "off" : mine ? "seat" : offered ? "offer" : freeSeat ? "free" : "cord";
  /* The landing, when a desk is offered while the cord is up: you slide to
     the end, the handset lights, the cord drops away and the number falls out
     of the desk row. Opening the screen to an offer already standing skips
     straight to the number. */
  const [land, setLand] = useState(null);
  const prevKind = useRef(kind);
  useEffect(() => {
    const was = prevKind.current;
    prevKind.current = kind;
    if (kind === "offer" && was === "cord") {
      setLand("slide");
      const a = setTimeout(() => setLand("lit"), 800);
      const b = setTimeout(() => setLand("done"), 1350);
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    if (kind !== "offer") setLand(null);
    return undefined;
  }, [kind]);
  const landing = kind === "offer" && !!land && land !== "done";
  const cordUp = kind === "cord" || (kind === "offer" && !!land);

  const n = mine ? mine.n : offered ? offered.n : freeSeat ? freeSeat.n : null;
  const cap = mine ? "DESK" : offered ? "GO TO DESK" : "FREE DESK";
  const title = st === "lunch" ? "At lunch" : st === "away" ? "Away"
    : mine ? `You're at desk ${n}` : offered ? `Desk ${n} is yours` : freeSeat ? `Desk ${n} is free`
    : ahead.length === 0 ? "You're next for a desk" : "Waiting for a desk";

  const joined = me.joinedAt ? Date.parse(me.joinedAt) : now;
  const offerAt = offered ? now - (OFFER_MS - offered.offerLeftMs) : null;
  const seatAt = mine && mine.at ? Date.parse(mine.at) : null;
  const onLine = Math.max(0, (seatAt || offerAt || now) - joined);
  const atDesk = seatAt ? Math.max(0, now - seatAt) : 0;
  const today = sitsFor(row, meId).reduce((a, s) =>
    a + (s.in ? Math.max(0, (s.out ? Date.parse(s.out) : now) - Date.parse(s.in)) : 0), 0);

  const options = mine
    ? [{ key: "lunch", label: "Lunch" }, { key: "leave", glyph: "door", label: "Leave the desk" }]
    : [{ key: "waiting", label: "Here" }, ...LINE_SELF_FLAGS.map((k) => ({ key: k, label: k === "lunch" ? "Lunch" : "Away" }))];
  const pick = (k) => {
    if (k === "leave") onRelease("out");
    else if (mine && k === "lunch") onRelease("lunch", () => onFlag("lunch"));
    else onFlag(k);
  };

  return (
    <>
      <div className="sfl-top">
        <SfDeskRow seats={board.seats} meId={meId} />
        <div className="sfl-hero">
          {st !== "waiting" ? (
            <div className="sfl-stage"><div className="sfl-num"><span className="mcf-sticon"><SfIcon name={st} size={64} /></span></div></div>
          ) : (
            <>
              <div className={"sfl-stage" + (cordUp ? (land === "done" ? " drop" : "") : " off")}>
                {cordUp && (
                  <SfCord ahead={ahead} behind={behind} pos={ahead.length + 1}
                    landed={kind === "offer"} lit={land === "lit" || land === "done"} />
                )}
              </div>
              <div className={"sfl-stage" + (n == null || landing ? " off" : "")}>
                {n != null && !landing && (
                  <div className="sfl-num">
                    <div className="sfl-cap">{cap}</div>
                    <div className="sfl-big"><DmNumber value={n} /></div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <SfLineTimers onLine={onLine} atDesk={atDesk} today={today} />
        <div className="sfl-title">{title}</div>
      </div>
      <SfTiles value={mine ? null : st} options={options} onPick={pick} />
    </>
  );
}

function QueueSignIn({ store, date, token, variant = LEAD_VARIANTS.line, test = false,
  account = null, onSignOut = null, rooms = null, onRoom = null, active = true }) {
  const [row, setRow] = useState(undefined);
  const [identities, setIdentities] = useState(null);
  /* An account that a manager has joined to a name IS the identity, the same
     way it already is on the floor: no daily code, no name, no PIN. The QR
     stays the second door into this very screen for anybody without one. */
  const [meId, setMeId] = useState(() => {
    if (account) return account;
    try { return localStorage.getItem(`lpcq:${store}:${date}`) || null; } catch { return null; }
  });
  const [step, setStep] = useState("name");
  const [shown, setShown] = useState("loading");
  const [shownKey, setShownKey] = useState("loading");
  const [wiping, setWiping] = useState(false);
  const [held, setHeld] = useState(true);
  const holdT = useRef(null);
  const wipeT = useRef({ swap: null, end: null });
  /* The curtain's exit clears itself here, on its own effect, because the
     screen-change effect below re-runs the moment the first page is swapped
     in, and its cleanup would cancel the timer before it fired. */
  useEffect(() => {
    if (wiping !== "out") return undefined;
    const t = setTimeout(() => setWiping(false), 340);
    return () => clearTimeout(t);
  }, [wiping]);
  // Set the instant "Got it" is tapped, cleared when the data agrees. Without it the
  // overlay lingers for the round trip and people tap it again and again.
  const [tookIt, setTookIt] = useState(false);
  const [typed, setTyped] = useState(() => { try { return localStorage.getItem(`lpcq:name:${store}`) || ""; } catch { return ""; } });
  const [resolved, setResolved] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinMode, setPinMode] = useState("verify");
  const [switchTo, setSwitchTo] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [myDay, setMyDay] = useState(false);
  // The store's config (for standards and the support contact) and this person's own
  // numbers. Read only, and only their own row.
  const [cfg, setCfg] = useState(null);
  const [mine, setMine] = useState(null);
  const [mineAt, setMineAt] = useState(null);
  // The published board row carries this month's channel figures and is readable
  // without an account, which is the only way a sign-in page can get them.
  const [monthStats, setMonthStats] = useState(null);
  // The board's own grading thresholds ride on the same published row. My day colours
  // its percentages by these, so the wall and the phone can never disagree about
  // whether a number is green.
  const [boardThr, setBoardThr] = useState(null);
  useEffect(() => {
    let dead = false;
    loadShared(`lpc:board:${store}:v1`, null)
      .then((b) => {
        if (dead || !b) return;
        if (b.months) setMonthStats((b.months[b.ym] || {}).stats || null);
        setBoardThr(b.thresholds || null);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [store]);
  useEffect(() => { loadShared("lpc:config:v2", null).then(setCfg).catch(() => {}); }, []);
  // Needs to be in scope before the panel is built, not after.
  const std = { ...DEFAULT_ACTIVITY_STANDARDS, ...(((cfg && cfg.stores) || []).find((s) => s.id === store)?.activityStandards || {}) };

  /* A seat this person is holding, and the fence that frees it when their
     phone leaves the lot. Only watched while they actually hold one — a
     salesperson who is not at a station has nothing here to give up, and
     polling their location for no reason is the sort of thing that should
     never happen by accident. */
  const mySeat = stationOf(row, meId);
  const storeFence = ((cfg && cfg.stores) || []).find((x) => x.id === store)?.fence || null;
  useSeatFence({
    fence: storeFence,
    active: !!mySeat && !!meId,
    onLeft: () => {
      mutateQueueRow(store, date, (cur) => {
        const r = releasePerson(cur || {}, meId, qNowIso(), "left");
        return r.changed ? r.row : null;
      }, variant.kind === "online" ? "online" : null)
        .then((next) => { if (next) setRow(next); })
        .catch(() => {});
    },
  });

  const writes = useRef(0);
  const refetch = useCallback(async (force) => {
    if (writes.current > 0) return;            // a tap is still landing; its answer is the next read
    if (force === true) rowStamps.delete(QUEUE_TABLE + "|" + queueRowId(store, date, variant.kind));
    const got = await loadRowIfChanged(QUEUE_TABLE, queueRowId(store, date, variant.kind));
    if (got === undefined || got === "same") return;
    setRow(got || null);
  }, [store, date, variant.kind]);
  const mutateRow = useCallback((fn) => mutateQueueRow(store, date, fn, variant.kind), [store, date, variant.kind]);
  const commit = useCommit(setRow, mutateRow, refetch, writes);
  const live = useLiveRow(QUEUE_TABLE, queueRowId(store, date, variant.kind), refetch);
  /* Looked at: every five seconds, or thirty with the socket open. Not looked
     at (the other room is up): thirty, and a fresh read the moment it is. */
  useEffect(() => { refetch(); const t = setInterval(refetch, live || !active ? 30000 : 5000); return () => clearInterval(t); }, [refetch, live, active]);
  useEffect(() => { loadQueueIdentities(store).then(setIdentities); }, [store]);

  // Today's activity for this person only. The split day rows made this cheap: it
  // is one small row, not the whole store document.
  const meEntry = ((row && row.roster) || []).find((r) => r.id === meId) || null;
  const meLabel = (meEntry && meEntry.label) || "";
  // Reports are keyed by the full name, never the short label.
  const meFull = (meEntry && meEntry.name) || "";
  useEffect(() => {
    if ((!meFull && !meLabel) || !supabase) return;
    let dead = false;
    const pull = async () => {
      try {
        // The board prefix, not the store prefix: this page has no account. The
        // row is everybody's numbers for the day and is republished a few times
        // a day, so it is read only when its stamp has moved.
        const v = await loadSharedIfChanged(floorStatsKey(store, date), "mine|" + store + "|" + date);
        if (!dead && v && v !== "same") {
          const r = v[norm(meFull)] || v[norm(meLabel)] || null;
          setMine(r);
          if (r && r.uploadedAt) setMineAt(r.uploadedAt);
        }
      } catch (e) { /* the panel says so itself if nothing arrives */ }
    };
    pull();
    const t = setInterval(pull, 120000);
    return () => { dead = true; clearInterval(t); };
  }, [store, date, meFull, meLabel]);

  const isToday = date === today();
  /* A code is how somebody with no account gets in. Somebody who arrived
     through their own account has already been let in, and asking them for
     today's code would be asking them to find a poster. */
  const valid = isToday && (account ? !!row : !!(row && row.token && row.token === token));
  const line = (row && row.line) || [];
  const me = line.find((p) => p.id === meId) || null;
  // Filtered out entirely unless the address asked for it, so it cannot be picked
  // by accident by somebody scrolling the name list.
  const roster = ((row && row.roster) || []).filter((r) => !r.test || test);
  const iAmUp = (() => { if (!me || me.status !== "waiting") return false; const i = line.findIndex((p) => p.id === meId); return i >= 0 && line.slice(0, i).filter((p) => p.status === "waiting").length === 0; })();
  useEffect(() => { if (iAmUp) buzz([30, 60, 30]); }, [iAmUp]);
  const myIdx = me ? line.findIndex((p) => p.id === meId) : -1;
  const aheadCount = myIdx >= 0 ? line.slice(0, myIdx).filter((p) => p.status === "waiting").length : 0;
  const wasOn = useRef(false);
  useEffect(() => {
    /* An account holder's standing is posted by the rooms shell, both lanes
       in one message; this screen posts only for somebody in through the QR. */
    if (account) return;
    if (!me || myIdx < 0) {
      /* Off the line for the day: said once, so the shell takes the card down
         and stops asking anybody to reopen the app. */
      if (wasOn.current) { wasOn.current = false; postToNativeShell({ queue: variant.label, store: (row && row.storeName) || "", status: "gone", updatedAt: new Date().toISOString() }); }
      return;
    }
    wasOn.current = true;
    postToNativeShell({ queue: variant.label, store: (row && row.storeName) || "",
      rep: ((roster || []).find((r) => r.id === meId) || {}).label || "",
      position: myIdx + 1, ahead: aheadCount, status: iAmUp ? "up" : me.status, updatedAt: new Date().toISOString(),
      /* The rail the lock screen draws: everybody in line as initials and a hue,
         with you marked. Same shape the server sends (api/_queue-notify.mjs). */
      line: line.slice(0, 8).map((p) => { const nm = p.label || ((roster || []).find((r) => r.id === p.id) || {}).label || ((roster || []).find((r) => r.id === p.id) || {}).name || "";
        return { i: initialsOf(nm) || "\u00b7", h: hueFromName(nm), s: (p.status || "waiting") === "waiting" ? "w" : "x", me: p.id === meId }; }),
      nudge: !!(me.nudgedAt && qMinsSince(me.nudgedAt) < 10), table: me.table != null ? String(me.table) : null, since: me.statusAt || null });
  }, [me && me.status, myIdx, aheadCount, iAmUp, line.length, me && me.nudgedAt]); // eslint-disable-line

  const remember = (id) => {
    try {
      if (id) { localStorage.setItem(`lpcq:${store}:${date}`, id); localStorage.setItem(`lpcq:self:${store}`, id); }
      else localStorage.removeItem(`lpcq:${store}:${date}`);
    } catch {}
    setMeId(id);
  };

  useEffect(() => { if (meId && line.some((p) => p.id === meId)) setStep("done"); }, [meId, line]);

  // which screen should be visible right now (drives the curtain wipe)
  let screen;
  if (row === undefined || identities === null) screen = "loading";
  /* A stale code is a stale code; an account is never stale, so a line the
     desk has not opened is a plain word on home rather than a refusal. */
  else if (!isToday || (!valid && !account)) screen = "invalid";
  else if (step === "done" && me) screen = "done";
  /* Through the account door and not on the line: one button, no typing,
     the same screen the floor gives them. */
  else if (account && !me) screen = "home";
  else if (step === "pin" && switchTo) screen = "switch";
  else if (step === "pin" && selected) screen = "pin";
  else if (step === "pick") screen = "pick";
  else if (step === "confirm") screen = "confirm";
  else screen = "name";

  // curtain: on ANY screen change, sweep the panel across and swap content mid-sweep.
  // The sweep is 380ms and the swap sits under its middle: long enough to read as
  // a page turning, short enough that a tap never seems to be waiting on it.
  // A wipe should fire between EVERY page they touch — including flag changes on the
  // live screen (which don't change `screen`). Key it on screen + live status.
  const liveKey = (screen === "done" && me) ? `done:${me.status}${me.appt ? ":a" : ""}` : screen;
  useEffect(() => {
    if (liveKey === shownKey) return undefined;
    /* The curtain sat over the page while the line loaded, so the first page
       is already behind it: swap it in and let the curtain leave, rather than
       sweeping a second curtain in from the side. The line and the person
       resolve a beat apart, and the screen in between is not worth showing,
       so the curtain waits for the page to settle before it goes. */
    if (held) {
      if (screen === "loading") return undefined;
      setShown(screen); setShownKey(liveKey);
      clearTimeout(holdT.current);
      holdT.current = setTimeout(() => { setHeld(false); setWiping("out"); }, 140);
      return undefined;
    }
    // The PIN screen gets its own fun entrance (a spring pop) instead of the curtain.
    if (screen === "pin") { setShown("pin"); setShownKey(liveKey); return; }
    /* The timers live outside the effect on purpose. The swap changes
       shownKey, which re-runs this effect, and a cleanup that cleared both
       timers took the end of the wipe with it: the curtain's class stayed on,
       parked off screen, and no later change could start it again. So only
       the first change after a load ever wiped. */
    clearTimeout(wipeT.current.swap); clearTimeout(wipeT.current.end);
    setWiping(true);
    wipeT.current.swap = setTimeout(() => { setShown(screen); setShownKey(liveKey); }, 180);
    wipeT.current.end = setTimeout(() => setWiping(false), 380);
    return undefined;
  }, [liveKey, shownKey, screen]);
  useEffect(() => () => { clearTimeout(wipeT.current.swap); clearTimeout(wipeT.current.end); }, []);

  /* Getting on is the screen changing under the finger, not a wait for the
     row: you are on the line at once and the write lands behind that. */
  function joinAs(person) {
    try { localStorage.setItem(`lpcq:name:${store}`, person.label); } catch {}
    remember(person.id);
    commit((cur) => {
      if (!cur) return null;
      cur.line = cur.line || [];
      if (!cur.line.some((p) => p.id === person.id)) {
        cur.line.push({ id: person.id, label: person.label, joinedAt: qNowIso(), status: "waiting", statusAt: qNowIso() });
        cur.history = cur.history || [];
        cur.history.push({ t: qNowIso(), action: "signed-in", id: person.id, who: person.label, by: "self" });
      }
      return cur;
    });
    setStep("done"); setPin(""); setPin2(""); setBusy(false);
  }

  function submitName() {
    setMsg("");
    const r = qResolveName(typed, roster);
    setResolved(r);
    if (r.kind === "one") pickPerson(r.person);
    else if (r.kind === "confirm") setStep("confirm");
    else if (r.kind === "pick") setStep("pick");
    else { setStep("name"); setMsg("We couldn't find that name. Check the spelling, or tap a suggestion below."); }
  }
  function pickPerson(p) {
    setSelected(p); setSwitchTo(null); setMsg("");
    const hasPin = !!(identities && identities[p.id] && identities[p.id].h);
    setPinMode(hasPin ? "verify" : "create");
    setStep("pin");
  }

  async function submitPin() {
    if (!selected) return;
    if (!/^\d{4,6}$/.test(pin)) { setMsg("Your PIN is 4 to 6 digits."); return; }
    setBusy(true); setMsg("");
    const idents = identities || (await loadQueueIdentities(store));
    if (pinMode === "create") {
      if (pin !== pin2) { setMsg("The two PINs don't match."); setBusy(false); return; }
      const clash = await qFindByPin(idents, pin, selected.id);
      if (clash) { setMsg("That PIN is already taken by someone here. Pick a different one."); setBusy(false); return; }
      const salt = qRandSalt(); const h = await qHashPin(pin, salt);
      const nextIds = await mutateQueueIdentities(store, (cur) => { cur[selected.id] = { h, s: salt, label: selected.label, setAt: qNowIso() }; return cur; });
      setIdentities(nextIds);
      await joinAs(selected);
      return;
    }
    const rec = idents[selected.id];
    if (rec && (await qHashPin(pin, rec.s)) === rec.h) { await joinAs(selected); return; }
    const other = await qFindByPin(idents, pin, null);
    if (other && other !== selected.id) { setSwitchTo({ id: other, label: idents[other].label || "that person" }); setMsg(""); setBusy(false); return; }
    setMsg(`That PIN doesn't match ${selected.label}'s file. Try again, or see a manager to reset it.`);
    setBusy(false);
  }

  function setFlag(status) {
    if (!meId) return;
    // Back in line means the next turn should show the up-take overlay again.
    if (status === "waiting") setTookIt(false);
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      if (p) {
        cur.history = cur.history || [];
        if (status === "waiting") {
          const from = p.awayReason || (p.status !== "waiting" ? p.status : null);
          cur.history.push({ t: qNowIso(), action: "back", from, id: meId, who: p.label, by: "self" });
          p.awayReason = null;
        } else {
          p.awayReason = status;
          cur.history.push({ t: qNowIso(), action: status, id: meId, who: p.label, by: "self" });
        }
        p.status = status; p.statusAt = qNowIso();
      }
      return cur;
    });
  }
  /* Getting up from a desk, from the desk. The same release the lot fence
     runs; `why` is what the day's record says about it, and `then` is the
     state they get up into. */
  function releaseSeat(why = "out", then = null) {
    if (!meId) return;
    commit((cur) => {
      const r = releasePerson(cur || {}, meId, qNowIso(), why);
      return r.changed ? r.row : null;
    });
    if (then) then();
  }
  function leave() {
    if (!meId) return;
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      cur.line = (cur.line || []).filter((x) => x.id !== meId);
      if (p) { cur.history = cur.history || []; cur.history.push({ t: qNowIso(), action: "left", from: p.awayReason || null, id: meId, who: p.label, by: "self" }); }
      return cur;
    });
    remember(null);
    setStep("name");
  }

  /* ---------- render ---------- */
  const storeName = (row && row.storeName) || "Phone Line";

  // content is chosen by `shown`, which lags `screen` and swaps behind the curtain
  const eff = (shown === "done" && !me) ? (account ? "home" : "name") : shown;

  /* One spine for every screen on the way in: the queue as it stands right now,
     which is the thing the person is actually here to find out. */
  const pageRef = useRef(null);
  useKeyboardInset(pageRef);

  const spinePos = meId ? line.findIndex((p) => p.id === meId) + 1 : 0;
  const queueSpine = (
    <SfSpine mode="queue" count={Math.max(line.length, 1)} pos={spinePos}
      cap={line.length ? `${line.length} ${variant.count}` : "nobody yet"} />
  );

  let content;

  if (eff === "loading") {
    content = (
      <SfScreen spine={queueSpine} className="sf-v-wait">
        <div className="sf-loading" aria-label="Loading" />
      </SfScreen>
    );
  } else if (eff === "invalid") {
    content = (
      <SfScreen spine={queueSpine} className="sf-v-stale">
        <SfMark variant={variant} />
        <SfDisplay small a="This code" b="isn't for today" />
        <p className="sf-sub">Ask a manager to show today&rsquo;s code, and scan it again.</p>
      </SfScreen>
    );
  } else if (eff === "home") {
    /* Through the account door, not on the line yet: the floor's own home
       screen, in the line's clothes. The room's desks stand in for the
       floor's track, since who is at a desk is what they are joining. */
    const who = String(meFull || meLabel || "").split(/\s+/)[0];
    const open = !!row;
    const onCount = line.filter((p) => p.status === "waiting").length;
    const roomOn = open && roomInUse(cfg, store, row);
    const seats = roomOn ? stationLine(stationPlanOf(cfg, store), row, { now: Date.now(), offers: stationModeOf(cfg, store) === "rotation" }).seats : [];
    content = (
      <div className="sf-live mcf sf-off mcf-home">
        <div className="mcf-top">
          <div className="mcf-cap">{open ? (onCount ? `${onCount} ON THE LINE` : "NOBODY ON YET") : "LINE NOT OPEN"}</div>
          {roomOn ? <SfDeskRow seats={seats} meId={meId} /> : open ? <McTrack line={line} meId={null} roster={(row && row.roster) || []} /> : null}
          <div className="mcf-title">{open ? (who ? `Morning, ${who}` : "Morning") : "The line isn't open yet"}</div>
          <div className="mcf-sub">{open
            ? (onCount ? "Get on and take your place in the line." : "You would be first.")
            : "The desk opens the Phone Line to start the day. Your corner is ready meanwhile."}</div>
          {open && meEntry && (
            <button className="sf-go mcf-go" onClick={() => { buzz(10); joinAs({ id: meEntry.id, label: meEntry.label || meEntry.name || "" }); }}>
              Get me on
            </button>
          )}
          {open && !meEntry && (
            <div className="mcf-sub">Your name is not on today's roster. Ask the desk.</div>
          )}
        </div>
      </div>
    );
  } else if (eff === "done" && me) {
    const myPos = line.findIndex((p) => p.id === meId) + 1;
    const availableAhead = line.slice(0, myPos - 1).filter((p) => p.status === "waiting").length;
    const isNext = me.status === "waiting" && availableAhead === 0;
    const st = me.status;
    const title = st === "customer" ? variant.custTitle : st === "lunch" ? "At lunch" : st === "away" ? "Away" : isNext ? "You're up" : variant.ready1;
    const sub = st === "customer" ? variant.custSub
      : (st === "lunch" || st === "away") ? "You'll be passed until you tap back in."
      : isNext ? variant.upSub : `${availableAhead} ${variant.aheadSub}`;
    // the desk asked for them by name: loud while it is fresh, then just history
    const nudgeOn = me.nudgedAt && qMinsSince(me.nudgedAt) < 10;
    const mark = (
      <div className="sf-top">
        <span className="q-mark q-mark-live"><span className="sf-live-dot" />
          <PixIcon glyph={variant.bannerGlyph} size={18} /><span>{variant.label}</span></span>
      </div>
    );
    const nudge = nudgeOn && (
      <div className="sf-nudge"><PixIcon glyph="nudge" size={13} /> The desk is asking for you</div>
    );
    const links = (
      <div className="sf-links">
        <button type="button" className="sf-link" onClick={() => { buzz(10); setMyDay(true); }}>
          <SfIcon name="mine" size={14} /><span>My day</span>
        </button>
        <button type="button" className="sf-link sf-link-quiet" onClick={leave}>
          <SfIcon name="door" size={14} /><span>{variant.leave}</span>
        </button>
      </div>
    );
    /* A phone line with a room behind it is the room's screen: the desks, the
       cord, the desk that is yours. Without one it is the queue it always was. */
    const roomOn = variant.kind === "line" && roomInUse(cfg, store, row);
    content = roomOn ? (
      <div className={"sf-live sfl" + (st !== "waiting" ? " sf-off" : "")}>
        {/* No mark up here: the floor's screen has none, and the bar at the
            foot already says which room this is. */}
        {nudge}
        <SfLineLive cfg={cfg} store={store} row={row} meId={meId} me={me}
          onFlag={setFlag} onRelease={releaseSeat} />
        <div className="sf-actions">{links}</div>
        <MyStationDay row={row} meId={meId} store={store} date={date} />
      </div>
    ) : (
      <div className={"sf-live" + (st !== "waiting" ? " sf-off" : "")}>
        {mark}
        {nudge}
        <div className="sf-poswrap">
          <div className="sf-aura" />
          {/* The arc fills as the time passes, so a long wait has a shape before it has
              a number. The figure sits on a tab at the foot with no label: the line
              underneath already says whether it is a wait or a customer. */}
          <div className="sf-ringwrap">
          <RingTimer mins={qMinsSince(me.statusAt || me.joinedAt)} />
          <div className="sf-ring"><div className="sf-ringface">{st === "waiting" ? <DmNumber value={myPos} /> : <SfIcon name={st} size={74} />}</div></div>
          </div>
          <div className="sf-meta">
            <div className="sf-line-1">{title}</div>
            <div className="sf-line-2">{sub}</div>
          </div>
        </div>
        <div className="sf-actions">
          <SfStatusSelect value={st} variant={variant} flags={variant.kind === "line" ? LINE_SELF_FLAGS : QUEUE_SELF_FLAGS}
            onPick={setFlag} />
          {links}
        </div>
        <MyStationDay row={row} meId={meId} store={store} date={date} />
        {isNext && !tookIt && (
          <div className="sf-uptake">
            {/* The ring is wrapped around the number rather than dropped into
                the column: an absolutely positioned child of a centred flex
                column takes its static position from the column, which put the
                splash behind the words instead of coming off the figure it is
                supposed to be coming off. */}
            <div className="sf-upnum">
              <span className="sf-shock" />
              <span className="sf-shock d2" />
              <DmNumber value={1} up />
            </div>
            <h2>You're up</h2>
            <p>{variant.upSub}</p>
            <button className="sf-go" onClick={() => { buzz([20, 40, 20]); setTookIt(true); setFlag("customer"); }}>Got it</button>
          </div>
        )}
      </div>
    );
  } else if (eff === "switch" && selected && switchTo) {
    content = (
      <SfAsk variant={variant} spine={queueSpine}
        lead={`That PIN is on ${switchTo.label}'s file`}
        question={["Are you", switchTo.label + "?"]}
        note={`You picked ${selected.label}.`}
        busy={busy}
        yes={() => joinAs({ id: switchTo.id, label: switchTo.label })}
        no={() => { setSwitchTo(null); setPin(""); setMsg("No problem. Enter your own PIN."); }}
        noLabel="No, try again" />
    );
  } else if (eff === "pin" && selected) {
    content = (
      <SfPin variant={variant} spine={queueSpine} who={selected.label}
        pinMode={pinMode} pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2}
        submitPin={submitPin} msg={msg} busy={busy}
        onNotMe={() => { setStep("name"); setSelected(null); setPin(""); setPin2(""); setMsg(""); }} />
    );
  } else if (eff === "pick" && resolved && resolved.people) {
    content = (
      <SfPickList variant={variant} spine={queueSpine} typed={typed}
        people={resolved.people} countLabel={variant.count}
        taken={(id) => line.some((x) => x.id === id)}
        onPick={pickPerson}
        onBack={() => { setStep("name"); setMsg(""); }} />
    );
  } else if (eff === "confirm" && resolved && resolved.person) {
    content = (
      <SfAsk variant={variant} spine={queueSpine} lead="Did you mean"
        question={[resolved.person.label, resolved.person.role || "\u00a0"]}
        busy={busy}
        yes={() => pickPerson(resolved.person)}
        no={() => { setStep("name"); setMsg(""); }} />
    );
  } else {
    content = (
      <SfName variant={variant} spine={queueSpine} storeName={storeName}
        typed={typed} setTyped={setTyped} submit={submitName} msg={msg}
        suggestions={resolved && resolved.kind === "none" ? resolved.suggestions : null}
        onPick={pickPerson} />
    );
  }

  return (
    <div className={`q-page sf ${variant.sf}`} ref={pageRef}>
      <div className={"q-stage" + (eff === "pin" ? " q-stage-pin" : "")} key={eff + (eff === "done" && me ? ":" + me.status : "")}>{content}</div>
      <SageCurtain wiping={wiping} hold={held} />
      {/* Everyone gets a way out of a problem, including the people with no account. */}
      <HelpButton config={cfg} who={meLabel} store={store} context={`${variant.label} sign-in, ${store}, ${date}`} dark />
      {myDay && (
        <MyDay store={store} date={date} meId={meId} meName={meFull || meLabel} stats={mine} std={std} variant={variant}
          config={cfg} updatedAt={mineAt} monthStats={monthStats} thresholds={boardThr}
          list={(row && row.checklist) || null} onClose={() => setMyDay(false)} />
      )}
    </div>
  );
}




/* =========================================================================
   QueueTab — manager board
   ========================================================================= */
/* ============================================================
   FLUID UI ATOMS — a small shared kit so the salesperson view and both
   manager boards feel like one continuous, living system.
   Inspiration: dot-matrix LED numerals + breathing aura (reminder screen),
   bold color-fill leaderboard cards + avatar stack (progress screen).
   ============================================================ */
const LED_FONT = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "#": ["101", "111", "101", "111", "101"],
  ".": ["000", "000", "000", "000", "010"],
};
function LedNumber({ value, color = "#8fc0ff", cell = 8, gap = 3, dim = "rgba(255,255,255,.07)" }) {
  const chars = String(value).split("");
  return (
    <div className="led-num" style={{ display: "flex", gap: cell + 1 }} aria-label={String(value)}>
      {chars.map((ch, di) => {
        const rows = LED_FONT[ch];
        if (!rows) return <div key={di} style={{ width: cell }} />;
        return (
          <div key={di} className="led-digit" style={{ display: "grid", gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}>
            {rows.flatMap((r, ri) => r.split("").map((b, ci) => (
              <span key={ri + "-" + ci} className="led-dot" style={{ width: cell, height: cell, background: b === "1" ? color : dim, boxShadow: b === "1" ? `0 0 ${Math.round(cell * 1.1)}px ${color}` : "none" }} />
            )))}
          </div>
        );
      })}
    </div>
  );
}
// deterministic soft color from a name, for initials avatars
function hueFromName(s) {
  let h = 0; const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
function initialsOf(name) {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((p[0] || "")[0] || "").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase();
}






















const stnFirst = (nm) => String(nm || "").split(" ")[0];






/* ==========================================================================
   SMARTFLOOR — "Live Floor" walk-in / showroom queue (v1)
   --------------------------------------------------------------------------
   Self-governed floor "up" queue. Same sign-up as Phone Line (type name + PIN,
   reuse queue_identity), but driven by DriveCentric deal_events so nobody has
   to remember to flag themselves — the auto-flip that fixes the old human-only
   floor system.

   Storage:
     - floor_public  : per-day floor state row  (id = "<store>:<date>")
     - queue_identity : REUSED for PINs (shared with Phone Line)
     - deal_events    : read-only feed (authenticated read via RLS)

   The event engine keys off the SUBJECT event (seg 1), NOT the ALERT — the two
   "sold" events (ProspectSoldGeneral / Prospect Sold - Pending) share an identical
   ALERT+Description and only differ in the subject, and "Sales Appointment - Show"
   is only distinguishable from a plain visit by its subject.
   ========================================================================== */

const FLOOR_TABLE = "floor_public";
const floorRowId = (store, date) => `${store}:${date}`;



const FLOOR_SELF_FLAGS = ["lunch", "away"];
/* The floor has no "with a customer" segment of its own — being with somebody
   is something the desk or a check-in puts you in, not a button you press — so
   this only ever labels the ones it does have. */
const FLOOR_SEG = { segFlag: "With a guest" };








/* ---- Supabase access: per-day floor row (floor_public) ---- */
/* ---- a poll that costs a stamp, not a row ----
   Every phone on the floor and every board on the wall asked for the whole
   queue row every five seconds, all day: the line, the roster snapshot and the
   day's history, tens of kilobytes a time, most of it unchanged since the last
   ask. That was the egress bill. Now a poll reads updated_at (a few bytes) and
   fetches the row only when the stamp has moved. "same" means nothing changed;
   undefined means the read failed and the screen should hold what it has. */
const rowStamps = new Map();
async function loadRowIfChanged(table, id, tag) {
  if (!supabase) return undefined;
  const k = tag || (table + "|" + id);
  const read = async () => {
    const { data: s, error: e1 } = await supabase.from(table).select("updated_at").eq("id", id).maybeSingle();
    if (e1) throw e1;
    const stamp = s ? (s.updated_at || "none") : "missing";
    if (rowStamps.has(k) && rowStamps.get(k) === stamp) return "same";
    const { data, error } = await supabase.from(table).select("data,updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    rowStamps.set(k, data ? (data.updated_at || "none") : "missing");
    if (data) cachePut("row:" + table + "|" + id, data.data);
    return data ? data.data : null;
  };
  try {
    const r = await withTimeout(read());
    if (r.timedOut) throw new Error("timed out");
    if (r.error) throw r.error;
    netSet(false);
    return r.value;
  } catch (e) {
    console.error("poll", table, id, e);
    /* The first read of the day failing used to leave the screen on its
       curtain. The line as the phone last saw it stands in, marked as of
       when, and the next poll that works replaces it. A read that fails once
       something is on screen changes nothing: the screen keeps what it has. */
    const c = cacheGet("row:" + table + "|" + id);
    netSet(true, c ? c.at : null);
    if (!rowStamps.has(k) && c) return c.value;
    return undefined;
  }
}
/* Postgres pushes a change down a socket the moment it is written, so a phone in
   line learns it is up as the desk clicks rather than on the next poll. The poll
   underneath slows to a safety net once the socket is open and comes back to
   five seconds if it never opens or drops.

   The socket is a doorbell, not a delivery. A postgres_changes message carries
   whatever columns the publication names, and naming `data` there would push the
   whole floor row to every phone on the floor on every single change: twenty
   phones times a few hundred changes a day is the egress bill back again, worse
   than the polling it replaced. So the publication names only the id and the
   stamp (supabase-realtime-setup.sql), the message says "something moved", and
   the page does its own stamp-gated read, which is a few bytes when nothing that
   matters to it changed. Without the publication set up nothing breaks; the
   pages simply keep polling. */
function useLiveRow(table, id, onChange) {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    if (!supabase || !id) return undefined;
    let ch = null;
    try {
      ch = supabase.channel(`live:${table}:${id}`)
        .on("postgres_changes", { event: "*", schema: "public", table, filter: `id=eq.${id}` }, () => {
          try { cb.current(); } catch (e) {}
        })
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    } catch (e) { ch = null; }
    return () => { setLive(false); if (ch) { try { supabase.removeChannel(ch); } catch (e) {} } };
  }, [table, id]);
  return live;
}
async function loadFloorRow(store, date) {
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.from(FLOOR_TABLE).select("data").eq("id", floorRowId(store, date)).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  } catch (e) { console.error("loadFloorRow", e); return undefined; }
}
/* Same reasoning as the queue write: a refused write that reports success is worse
   than one that fails loudly, because the screen agrees with you for five seconds
   and then quietly disagrees. */
async function saveFloorRow(store, date, data) {
  if (!supabase) throw new Error("No database connection");
  const { error } = await supabase.from(FLOOR_TABLE).upsert(
    { id: floorRowId(store, date), store, fdate: date, data, updated_at: qNowIso() }, { onConflict: "id" });
  if (error) {
    console.error("saveFloorRow", error);
    throw new Error(error.message || error.hint || error.code || "write refused");
  }
  return true;
}
/* Serialised for the same reason the queue rows are: overlapping read-modify-
   writes on a row with no revision lose each other's changes. */
async function mutateFloorRow(store, date, fn) {
  const key = `floor|${store}|${date}`;
  const run = async () => {
    let cur = await loadFloorRow(store, date);
    if (cur === undefined) { await new Promise((z) => setTimeout(z, 400)); cur = await loadFloorRow(store, date); }
    if (cur === undefined) throw new Error("The floor could not be read just now, so nothing was changed.");
    const next = fn(cur ? JSON.parse(JSON.stringify(cur)) : null);
    if (!next) return cur;
    // Whoever moved up gets a stamp, so a phone's "last move" means that.
    stampLineMoves(cur, next, qNowIso());
    await saveFloorRow(store, date, next);
    return next;
  };
  const prev = qChains.get(key) || Promise.resolve();
  const p = prev.then(run, run);
  qChains.set(key, p.catch(() => {}));
  return p;
}

/* One tap, one frame. The screen takes the change the moment the finger
   lifts and the server hears about it afterwards. What the server hands back
   is applied only when no later tap is still in flight, so a slow write can
   never drag the screen back to a state the person has already moved past;
   the poll holds off for the same reason (`writes` is the count it checks).
   A write that fails buzzes and rereads, and the screen shows the truth.
   Nothing on the way is disabled while a round trip runs: the next tap is
   its own write, queued behind this one. */
function useCommit(setRow, mutate, refetch, writes) {
  return useCallback((fn) => {
    setRow((cur) => {
      if (!cur) return cur;
      const out = fn(JSON.parse(JSON.stringify(cur)));
      return out || cur;
    });
    writes.current++;
    return mutate(fn).then(
      (next) => { writes.current--; if (next && writes.current === 0) setRow(next); return next; },
      (e) => { writes.current--; console.error("write", e); buzz([40, 60, 40]); refetch(true); return null; });
  }, [setRow, mutate, refetch, writes]);
}

/* Several days at once, for the screen that looks back rather than at now.
   A claim can only be reconciled after the day's activity report has landed, and
   the report lands the next morning, so the thing a manager reviews is always
   yesterday and older — never the day they are standing in. */
async function loadFloorDays(store, fromDate, toDate) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from(FLOOR_TABLE)
      .select("fdate,data").eq("store", store)
      .gte("fdate", fromDate).lte("fdate", toDate)
      .order("fdate", { ascending: false }).limit(60);
    if (error) throw error;
    return (data || []).filter((r) => r && r.data).map((r) => ({ date: r.fdate, row: r.data }));
  } catch (e) { console.error("loadFloorDays", e); return []; }
}

/* =========================================================================
   FlyBy — the floor answering a table.
   A salesperson sitting with a guest asks for a manager from their phone; the
   ask rides in the same per-day floor row as the line, so it inherits the
   row's serialised writes, its RLS, and the webhook that already pushes queue
   changes to phones. Two kinds, on purpose and by name: a FlyBy is a swing-by
   to meet the guest, part of the process; a T.O. is "send somebody now".
   ========================================================================= */
const DEFAULT_FLOOR_PLAN = {
  /* Neutral on purpose. Every floor is different: no "delivery tables", no
     "new side" -- a store that wants those labels draws them. */
  zones: [
    { t: "showroom", x: 3, y: 6, w: 46, h: 88 },
    { t: "offices", x: 53, y: 52, w: 44, h: 42 },
  ],
  tables: [
    { n: "1", x: 5, y: 12 }, { n: "2", x: 15, y: 12 }, { n: "3", x: 25, y: 12 }, { n: "4", x: 35, y: 12 },
    { n: "5", x: 7, y: 38, r: 1 }, { n: "6", x: 18, y: 44, r: 1 }, { n: "7", x: 29, y: 39, r: 1 }, { n: "8", x: 40, y: 45, r: 1 },
    { n: "9", x: 9, y: 70, r: 1 }, { n: "10", x: 21, y: 74, r: 1 }, { n: "11", x: 33, y: 70, r: 1 },
    { n: "12", x: 56, y: 14 }, { n: "13", x: 68, y: 14 }, { n: "14", x: 80, y: 14 },
    { n: "O1", x: 58, y: 62 }, { n: "O2", x: 70, y: 62 }, { n: "O3", x: 82, y: 62 },
  ],
  doors: [{ x: 1.5, y: 44, main: 1 }],
};
/* The drawn plan is a store setting (it lives beside the fence); the default
   above stands in until a store draws its own. Older plans stored one `door`;
   they read as a doors list with that one door as the waiting door. */
function floorPlanOf(config, storeId) {
  const st = ((config && config.stores) || []).find((x) => x.id === storeId);
  const plan = (st && st.floorPlan && Array.isArray(st.floorPlan.tables) && st.floorPlan.tables.length)
    ? st.floorPlan : DEFAULT_FLOOR_PLAN;
  if (!plan.doors && plan.door) return { ...plan, doors: [{ ...plan.door, main: 1 }] };
  return plan;
}

const ASSIST_NOTES = ["Bring appraisal keys", "Payment objection", "Trade number", "Guest is leaving"];
const activeAssists = (row) => (((row && row.assists) || []).filter((a) => a && !a.doneAt));
const assistAge = (a) => Math.max(0, Math.floor((Date.now() - new Date(a.t).getTime()) / 1000));
const fmtAssistAge = (sec) => Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
function useAssistTick(on) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

/* One drawing of the floor, shared by the console and the phone's picker. */
function PlanMap({ plan, cls = "", deco, onTap, children }) {
  /* Rooms are not squares. A store longer than it is wide sets stretch on its
     plan and the room simply grows past the card's edge and scrolls; the
     percent coordinates stay relative to the WHOLE room, so nothing drawn in
     the editor ever moves when the shape changes. */
  const stretch = (plan && plan.stretch) || 1;
  return (
    <div className={"fbp-scroll " + cls}>
    <div className="fbp" style={stretch > 1 ? { width: (stretch * 100) + "%" } : undefined}>
      {(plan.zones || []).map((z, i) => (
        <div key={i} className="fbp-zone" style={{ left: z.x + "%", top: z.y + "%", width: z.w + "%", height: z.h + "%" }}>{z.t}</div>
      ))}
      {(plan.doors || (plan.door ? [{ ...plan.door, main: 1 }] : [])).map((d, i) => (
        <span key={"d" + i} className={"fbp-door" + (d.main ? " main" : "")}
          style={{ left: d.x + "%", top: d.y + "%" }}>DOOR</span>
      ))}
      {(plan.cars || []).map((c, i) => (
        <span key={"c" + i} className={"fbp-car" + (c.r90 ? " r90" : "")}
          style={{ left: c.x + "%", top: c.y + "%" }} aria-hidden="true"><PixIcon glyph="car" size={22} /></span>
      ))}
      {/* Stations call these seats and the floor calls them tables; the drawing
          is the same either way, and one map means one editor and one set of
          coordinates rather than a second copy that drifts. */}
      {(plan.seats || plan.tables || []).map((t) => {
        const d = deco ? deco(t) : {};
        return (
          <button key={t.n} type="button"
            className={"fbp-tbl" + (t.r ? " round" : "") + (t.s === "s" ? " sz-s" : t.s === "l" ? " sz-l" : "") + (d.cls ? " " + d.cls : "")}
            style={{ left: t.x + "%", top: t.y + "%" }}
            onMouseEnter={d.onHover || undefined} onMouseLeave={d.onLeave || undefined}
            onClick={onTap ? () => onTap(t) : undefined}>
            {d.flag ? <span className="fbp-flag">{d.flag}</span> : null}
            <span>{t.n}</span>
            {d.sub ? <span className="fbp-sub">{d.sub}</span> : null}
          </button>
        );
      })}
      {children}
    </div>
    </div>
  );
}

/* ---- the salesperson's side: two buttons, a where, and the chip that waits
   with you. Lives on the floor phone screen, under the status control. ---- */
function AssistBlock({ meId, meName, fence, plan, row, commit }) {
  const [open, setOpen] = useState(null);          // "fly" | "to" | null
  const [where, setWhere] = useState(null);        // table n, or "lot"
  const [note, setNote] = useState("");
  const mine = activeAssists(row).find((a) => a.byId === meId) || null;
  useAssistTick(!!mine);

  /* The refinement: a phone confidently outside the BUILDING outline defaults
     the pin to the lot. The building is its own ring on the store's fence
     (fence.building); without one drawn, nothing is guessed. The lot ring
     cannot answer this question -- the showroom is inside the lot. */
  const sheetFor = (kind) => {
    setOpen(kind); setWhere(null); setNote("");
    try {
      const bld = fence && fence.building && Array.isArray(fence.building.ring) ? { ring: fence.building.ring } : null;
      if (!bld || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        const v = readingVerdict({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, bld);
        if (v === "out") setWhere((w) => (w == null ? "lot" : w));
      }, () => {}, { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 });
    } catch (e) { /* no fix is not a reason to block the ask */ }
  };

  const send = () => {
    if (!open) return;
    const ask = { id: uid(), t: qNowIso(), kind: open, byId: meId, byName: meName,
      table: where === "lot" ? null : where, spot: where === "lot" ? "lot" : "floor",
      note: note || null };
    commit((cur) => {
      if (!cur) return null;
      // one live ask per person: a second press replaces, never stacks
      cur.assists = [ask, ...((cur.assists || []).filter((a) => !(a.byId === meId && !a.doneAt)))].slice(0, 40);
      return cur;
    });
    setOpen(null);
    buzz([15, 30, 15]);
  };
  const cancel = () => {
    if (!mine) return;
    const id = mine.id;
    commit((cur) => {
      if (!cur) return null;
      const x = (cur.assists || []).find((a) => a.id === id);
      if (x && !x.doneAt) { x.doneAt = qNowIso(); x.cancelled = true; }
      return cur;
    });
  };

  if (mine) {
    const age = assistAge(mine);
    return (
      <div className={"fba-chip" + (mine.claimedBy ? " ok" : "")}>
        <span className="fba-ring" aria-hidden="true" />
        <span className="fba-tx">
          <b>{mine.claimedBy ? `${mine.claimedBy} is on the way` : "Asking the floor"}</b>
          <i>{(mine.kind === "to" ? "T.O." : "FlyBy")} · {assistWhere(mine)}{mine.note ? ` · ${mine.note}` : ""}</i>
        </span>
        <span className="fba-age">{mine.claimedBy ? "" : fmtAssistAge(age)}</span>
        {!mine.claimedBy && <button type="button" className="fba-x" onClick={cancel} aria-label="Never mind">Never mind</button>}
      </div>
    );
  }

  return (
    <>
      <div className="fba-row">
        <button type="button" className="fba-btn fly" onClick={() => sheetFor("fly")}>
          <PixIcon glyph="bolt" size={22} /><b>FlyBy</b><span>Swing by, meet my guest</span>
        </button>
        <button type="button" className="fba-btn to" onClick={() => sheetFor("to")}>
          <PixIcon glyph="swap" size={22} /><b>T.O.</b><span>I need help now</span>
        </button>
      </div>
      {open && (
        <Overlay>
        <div className="fba-sheetwrap" onClick={() => setOpen(null)}>
          <div className="fba-sheet ask" onClick={(e) => e.stopPropagation()}>
            <div className="fba-cap">{open === "to" ? "T.O. · where are you?" : "FlyBy · where are you?"}</div>
            <PlanMap plan={plan} cls="mini"
              deco={(t) => ({ cls: where === t.n ? "sel" : "" })}
              onTap={(t) => setWhere(t.n)} />
            <button type="button" className={"fba-lot" + (where === "lot" ? " sel" : "")}
              onClick={() => setWhere(where === "lot" ? null : "lot")}>Out on the lot</button>
            <div className="fba-cap">Tell them why · optional</div>
            <div className="fba-notes">
              {ASSIST_NOTES.map((n) => (
                <button key={n} type="button" className={note === n ? "sel" : ""}
                  onClick={() => setNote(note === n ? "" : n)}>{n}</button>
              ))}
            </div>
            <div className="fba-send">
              <button type="button" className="fba-go" onClick={send}>{open === "to" ? "Send the T.O." : "Send the FlyBy"}</button>
              <button type="button" className="fba-back" onClick={() => setOpen(null)}>Back</button>
            </div>
          </div>
        </div>
        </Overlay>
      )}
    </>
  );
}

/* ---- the seat: one tap when you take a guest, and the map is true ---- */
function SeatBlock({ store, meId, plan, row, commit }) {
  const me = ((row && row.line) || []).find((p) => p.id === meId);
  const [open, setOpen] = useState(false);
  if (!me || me.status !== "customer") return null;
  const seat = (n) => {
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      if (p) p.table = n;
      return cur;
    });
    try { localStorage.setItem(`lpcf:seat:${store}`, String(n)); } catch (e) {}
    setOpen(false);
    buzz(12);
  };
  const remembered = (() => { try { return localStorage.getItem(`lpcf:seat:${store}`); } catch (e) { return null; } })();
  if (me.table && !open) {
    return (
      <div className="fba-seated">
        You two are at <b>{String(me.table).startsWith("O") ? "office " + String(me.table).slice(1) : "table " + me.table}</b>
        <button type="button" onClick={() => setOpen(true)}>Change</button>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="fba-seatask">
        <b>Where are you two sitting?</b>
        <span>One tap and the desk knows where to find you.</span>
        <div className="fba-seatrow">
          {remembered && <button type="button" className="fba-go" onClick={() => seat(remembered)}>
            {String(remembered).startsWith("O") ? "Office " + String(remembered).slice(1) : "Table " + remembered} again</button>}
          <button type="button" className={remembered ? "fba-back" : "fba-go"} onClick={() => setOpen(true)}>Pick on the map</button>
        </div>
      </div>
    );
  }
  /* The map takes the screen, the way the FlyBy's does: picking a table is
     the whole job for the moment, and a table you can hit with a customer
     standing next to you is not a 34px chip under the hero. */
  return (
    <Overlay>
    <div className="fba-sheetwrap" onClick={() => setOpen(false)}>
      <div className="fba-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="fba-cap">Tap your table</div>
        <PlanMap plan={plan} cls="mini"
          deco={(t) => ({ cls: String(me.table) === String(t.n) ? "sel" : "" })}
          onTap={(t) => seat(t.n)} />
        <div className="fba-send">
          <button type="button" className="fba-back" onClick={() => setOpen(false)}>Not now</button>
        </div>
      </div>
    </div>
    </Overlay>
  );
}











/* =========================================================================
   FloorSignIn — salesperson phone page for the walk-in floor.
   Mirrors QueueSignIn (name fuzzy-match + PIN, curtain wipe, reuse identities);
   the "done" screen adds the accidental-check-in self-reverse.
   ========================================================================= */
/* =========================================================================
   MyCorner - the salesperson's own home
   =========================================================================
   The first screen a signed-in salesperson lands on. Everything on it is a
   number that already exists somewhere a phone can read without an account:
   today from the split day row, the month from the board's published row,
   the last ten days from the same day rows the coaching bands read. Nothing
   here is typed by a thumb; the reports fill it, and the screen says when.

   The layout is the one settled in the drafts: the month calendar and the
   line beside the date, the units riding a pinned hero, the day's three
   standards under it, then the points read (lower wins), then the board.
   The Floor tab keeps the whole existing floor screen untouched. */
/* The line drawn as the walk to the door: it begins at the screen's left edge
   and runs right, whoever is up next largest at the front, you glowing at your
   spot, the people behind you trailing. Two dot streams carry the motion: one
   enters from the left and dies at the back of the line, one leaves your dot
   for the front. Their distances are pixels measured off the track, because
   only transform animations stay on the compositor. */
function McTrack({ line, meId, roster }) {
  const ref = useRef(null);
  const waiting = (line || []).filter((p2) => p2.status === "waiting");
  const meIdx = waiting.findIndex((p2) => p2.id === meId);
  const ahead = meIdx >= 0 ? waiting.slice(0, meIdx) : waiting;
  const behind = meIdx >= 0 ? waiting.slice(meIdx + 1) : [];
  const labelOf = (id) => {
    const r = (roster || []).find((x) => x.id === id);
    const nm = (r && (r.label || r.name)) || "";
    return nm.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "\u00b7";
  };
  /* The head of the line sits at the end of the rail: its edge a few points
     short of the rounded end, whatever size it is drawn at, and everyone
     behind steps back from there, --p percent of the rail; the CSS turns
     that into a place, with --edge the head's radius plus that gap. */
  const headL = (i) => i * 15;
  const youL = ahead.length * 15;
  const behindL = (k) => ahead.length * 15 + (k + 1) * 13;
  useTrackLight(ref, waiting.map((p2) => p2.id).join(","), ".mcf-pip, .mcf-you");
  return (
    <div className="mcf-track" ref={ref}>
      <s className="lt" /><s className="lt" />
      {ahead.map((p2, i) => (
        <span key={p2.id} className={"mcf-pip" + (i === 0 ? " hd" : "")} style={{ "--p": headL(i) }}>{labelOf(p2.id)}</span>
      ))}
      {behind.map((p2, k) => (
        <span key={p2.id} className="mcf-pip bh" style={{ "--p": behindL(k) }}>{labelOf(p2.id)}</span>
      ))}
      {meIdx >= 0 && <span className="mcf-you" style={{ "--p": youL }}>{labelOf(meId)}</span>}
    </div>
  );
}

/* Two clocks on one level: how long you have been on the floor, and how long
   since your place last changed. They tick themselves so the figures move
   between polls; only the text nodes change. */
function McTimers({ sinceOn, sinceMove }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const fmt = (iso) => {
    if (!iso) return "0:00";
    const t = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  };
  return (
    <div className="mcf-tmr">
      <span><span className="v"><PixIcon glyph="clock" size={14} /> <b>{fmt(sinceOn)}</b></span><span className="l">ON THE FLOOR</span></span>
      <span><span className="v"><PixIcon glyph="arrowup" size={14} /> <b>{fmt(sinceMove)}</b></span><span className="l">LAST MOVE</span></span>
    </div>
  );
}

const MC_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const mcMet = (got, need) => (need > 0 ? (got || 0) >= need * 0.8 : (got || 0) > 0);
const mcClock = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
};

/* The spine on the right edge: the three standards averaged into one fill,
   notched at each third, with the head carrying the temperature so a manager
   across the room reads the day from the color alone. */
function McSpine({ rows }) {
  const fr = rows.map((r) => r.need > 0 ? Math.min(1, (r.got || 0) / r.need) : ((r.got || 0) > 0 ? 1 : 0));
  const pct = fr.length ? Math.round((fr.reduce((a2, b2) => a2 + b2, 0) / fr.length) * 100) : 0;
  const temp = pct >= 100 ? "made" : pct < 34 ? "cold" : "warm";
  return (
    <div className={"mc-spine " + temp} aria-label={pct + " percent of the day"}>
      <span className="rt">{temp === "made" ? "DAY MADE" : pct + "%"}</span>
      <span className="sp">
        <u style={{ bottom: "33%" }} /><u style={{ bottom: "66%" }} />
        <i style={{ height: pct + "%" }} /><b style={{ bottom: pct + "%" }} />
      </span>
    </div>
  );
}

/* The line itself. An inline SVG rather than a library: it is one path, two
   axes worth of nothing, and a phone that should not download a chart engine
   to draw thirty numbers. */
function ChannelLine({ series, col, target = null }) {
  const pts = series.filter((p) => p.rate != null);
  if (pts.length < 2) {
    return <div className="mc-cline-none">Not enough of a run yet. This fills in as the days import.</div>;
  }
  const W = 280, H = 96, P = 4;
  const vals = pts.map((p) => p.rate).concat(series.map((p) => p.daily).filter((v) => v != null));
  const top = Math.max(target || 0, ...vals) * 1.12 || 1;
  const x = (i) => P + (i / (pts.length - 1)) * (W - P * 2);
  const y = (v) => H - P - (v / top) * (H - P * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(" ");
  const first = pts[0].rate, last = pts[pts.length - 1].rate;
  const move = Math.round((last - first) * 10) / 10;
  return (
    <div className="mc-cline">
      <svg viewBox={`0 0 ${W} ${H}`} className="mc-cline-svg" aria-hidden="true">
        {target != null && (
          <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} className="mc-cline-thr" />
        )}
        <path d={path} className="mc-cline-p" style={{ stroke: col }} />
        {series.map((p, i) => {
          if (p.daily == null) return null;
          /* Where the day itself sits against the running rate. */
          const idx = pts.findIndex((q) => q.day === p.day);
          if (idx < 0) return null;
          return <circle key={p.day} cx={x(idx)} cy={y(p.daily)} r="1.9" className="mc-cline-d" style={{ fill: col }} />;
        })}
        <circle cx={x(pts.length - 1)} cy={y(last)} r="3.4" className="mc-cline-now" style={{ fill: col }} />
      </svg>
      <div className="mc-cline-foot">
        <b style={{ color: col }}>{Math.round(last * 10) / 10}%</b>
        <span>
          {move === 0 ? "level over " : (move > 0 ? "up " : "down ") + Math.abs(move) + " points over "}
          {pts.length} day{pts.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mc-cline-note">
        The line is your month so far. The dots are single days, which swing on a
        handful of leads &mdash; the line is the answer, the dots are why.
      </div>
    </div>
  );
}

/* Text size, the person's own. Three steps, kept on the phone, applied as a
   zoom on the salesperson's screens: every size in them is in pixels, so a
   zoom is the one lever that moves the type and the buttons together. The
   manager's screens do not carry the class and are untouched. */
const TEXT_SIZES = [["1", "Normal"], ["1.15", "Large"], ["1.3", "Largest"]];
const textSizeOf = () => {
  try { const v = localStorage.getItem("lpcf:pref:text"); return TEXT_SIZES.some(([k]) => k === v) ? v : "1"; }
  catch (e) { return "1"; }
};
const applyTextSize = (v) => { try { document.documentElement.style.setProperty("--sftxt", v); } catch (e) {} };
if (typeof document !== "undefined") applyTextSize(textSizeOf());

/* Where the app opens, the person's own, per store: the room they were in
   last (the default, and what it always did), or always Home, the floor or
   the phone line. Per store because the same person works the phones at one
   rooftop and the floor at another. */
const OPEN_TO = [["last", "LAST"], ["home", "HOME"], ["floor", "FLOOR"], ["line", "LINE"]];
const openToOf = (store) => {
  try { const v = localStorage.getItem(`lpcf:pref:open:${store}`); return OPEN_TO.some(([k]) => k === v) ? v : "last"; }
  catch (e) { return "last"; }
};

function MyCorner({ store, date, me, meId, meFull, meLabel, mine, mineAt, std, cfg,
                    monthStats, boardThr, goals, off, days, offToday, offState, activityNow, onOffAnswer, onHelp,
                    line, myPos, availableAhead, toFloor, joinable = false, upsToday = 0, roster = [] }) {
  const [sheet, setSheet] = useState(null);   // "closing" | "board" | "sched" | null
  const [pickDay, setPickDay] = useState(null);
  /* Which channel's thirty days are open, inside the closing sheet. Null is the
     three bars; a key is one of them, expanded. */
  const [openCh, setOpenCh] = useState(null);
  const offDim = offToday && offState !== "in";

  const a = mine || {};
  const needCalls = std.minCalls || 0, needVideos = std.minVideos || 0;
  const needTasks = a.tasksPosted || 0;
  const rows = [
    { label: "Calls", got: a.calls || 0, need: needCalls, met: mcMet(a.calls, needCalls) },
    { label: "Videos", got: a.video || 0, need: needVideos, met: mcMet(a.video, needVideos) },
    { label: "Tasks", got: a.tasks || 0, need: needTasks, met: needTasks > 0 ? mcMet(a.tasks, needTasks) : (a.tasks || 0) > 0 },
  ];

  // The month, from the row the wall already publishes for this store.
  const ms = (monthStats && (monthStats[norm(meFull)] || monthStats[norm(meLabel)])) || null;
  const units = ms
    ? (ms.internetUnits || 0) + (ms.phoneUnits || 0) + (ms.showroomUnits || 0) + (ms.campaignUnits || 0)
    : null;
  const dayN = parseInt(date.slice(8, 10)), y = parseInt(date.slice(0, 4)), mo = parseInt(date.slice(5, 7));
  const daysInMonth = new Date(y, mo, 0).getDate();
  /* A projection off one or two days is a coin toss dressed as a number; the
     bar waits until the month has enough days to mean something. */
  const pace = units != null && dayN >= 3 ? Math.round((units / dayN) * daysInMonth * 10) / 10 : null;
  const goal = (goals && (goals[norm(meFull)] ?? goals[norm(meLabel)])) ?? null;
  const newU = ms && ms.newUnits != null ? ms.newUnits : null;
  const usedU = ms && ms.usedUnits != null ? ms.usedUnits : null;
  const scale = goal ? Math.max(goal, units || 0, pace || 0) : null;
  const pct = (v) => (scale ? Math.min(100, Math.round((v / scale) * 100)) : 0);
  const toGo = goal != null && units != null ? Math.max(0, Math.round((goal - units) * 10) / 10) : null;
  const offMine = (off && (off[norm(meFull)] || off[norm(meLabel)])) || [];

  // A clean day met every standard its report can grade. A missed worked day
  // costs one point; nobody can tap it away, only work it away.
  // The desk's arithmetic, not an approximation: a missed standard is a point.
  const graded = (r) => {
    if (!r) return null;
    const pd = pointsForDay(r, std);
    return pd.noData ? null : pd.points === 0;
  };
  const byDay = {};
  for (const d of (days || [])) byDay[d.day] = d.row;
  const monthPrefix = date.slice(0, 7);
  let points = 0, streak = 0;
  for (const d of (days || [])) {
    if (!d.row || !d.day.startsWith(monthPrefix) || d.day > date || d.day === date) continue;
    if (offMine.includes(d.day)) continue;
    const pd = pointsForDay(d.row, std);
    if (!pd.noData) points += pd.points;
  }
  for (let i = 1; i <= SF_DAYS; i++) {
    const dd = new Date(y, mo - 1, dayN - i);
    const k = dd.toISOString().slice(0, 10);
    const r = byDay[k];
    if (!r) continue;                      // a day off does not break a run
    if (graded(r)) streak++; else break;
  }
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(y, mo - 1, dayN - i);
    const k = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
    const r = byDay[k];
    const isOffDay = offMine.includes(k);
    week.push({ wd: "SMTWTFS"[dd.getDay()], today: i === 0, k, pts: r ? pointsForDay(r, std).points : 0,
      state: i === 0 ? "now" : (isOffDay ? "off" : (r ? (graded(r) ? "ok" : "bad") : "off")) });
  }

  // The calendar: a dot per day on its true weekday column, warmed by how much
  // the day's report carried. Only the days the phone can still read light up.
  const cal = [];
  const lead = new Date(y, mo - 1, 1).getDay();
  for (let i = 0; i < lead; i++) cal.push(null);
  let bestDay = null, bestScore = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const k = `${monthPrefix}-${String(d).padStart(2, "0")}`;
    const r = byDay[k];
    const score = r ? (r.units || 0) * 10 + Math.min(2, (r.calls || 0) / Math.max(1, needCalls)) : 0;
    if (r && score > bestScore) { bestScore = score; bestDay = d; }
    cal.push({ d, k, past: d <= dayN, r, score, isOff: offMine.includes(k) });
  }

  // The line, small: whoever is up, the dots behind them, you in green.
  const ahead = (line || []).slice(0, Math.max(0, myPos - 1));
  const headP = ahead[0] || null;
  const iAmUp = !!me && me.status === "waiting" && availableAhead === 0;
  const railRef = useRef(null);
  useTrackLight(railRef, me ? (line || []).slice(0, 8).map((p) => p.id).join(",") : "", ".mc-pip");

  /* ---- where the month stands against its pace ----
     The goal is set at the start of the month, and the pace to it follows the
     person's own schedule rather than the calendar: a day off is not a day
     behind. Expected today = goal spread evenly over the scheduled days, counted
     up to today. Behind, on, ahead is the units against that, a unit either way
     counting as on. No goal, no verdict. */
  const holidays = new Set(((cfg && cfg.holidays) || []).map((h) => (h && h.date) || h));
  const scheduled = (d) => { const k = `${monthPrefix}-${String(d).padStart(2, "0")}`; return !offMine.includes(k) && !holidays.has(k); };
  const workDays = []; for (let d = 1; d <= daysInMonth; d++) if (scheduled(d)) workDays.push(d);
  const workedSoFar = workDays.filter((d) => d <= dayN).length;
  const expectedBy = (d) => goal != null && workDays.length ? goal * (workDays.filter((w) => w <= d).length / workDays.length) : null;
  const expectedNow = expectedBy(dayN);
  const paceDiff = expectedNow != null && units != null ? Math.round((units - expectedNow) * 10) / 10 : null;
  const paceState = paceDiff == null ? "" : paceDiff < -1 ? "behind" : paceDiff > 1 ? "ahead" : "on";
  const paceLabel = paceState === "behind" ? "BEHIND PACE" : paceState === "ahead" ? "AHEAD OF PACE" : paceState === "on" ? "ON PACE" : "";
  const paceWord = paceState === "behind" ? `${Math.abs(paceDiff)} BEHIND` : paceState === "ahead" ? `${paceDiff} AHEAD` : paceState === "on" ? "ON PACE" : "";

  /* ---- the month as a line ----
     Cumulative units day by day from the daily rows, stretched so the last point
     is the month row's total (the two can disagree by a car when a report lands
     late). New and used are split by the month's own ratio, because the daily
     report does not say which was which. */
  const trail = (() => {
    const W = 330, H = 92;
    const total = units != null ? units : null;
    let cum = 0; const pts = [];
    for (let d = 1; d <= dayN; d++) {
      const k = `${monthPrefix}-${String(d).padStart(2, "0")}`;
      const r = byDay[k];
      cum += r ? (r.units || 0) : 0;
      pts.push({ d, v: cum });
    }
    const last = pts.length ? pts[pts.length - 1].v : 0;
    const k2 = total != null && last > 0 ? total / last : 1;
    for (const q of pts) q.v = total != null && last === 0 ? (q.d === dayN ? total : 0) : q.v * k2;
    const top = Math.max(goal || 0, total || 0, pace || 0, 1);
    const x = (d) => Math.round(((d - 1) / Math.max(1, daysInMonth - 1)) * W * 10) / 10;
    const y = (v) => Math.round((H - 6 - (v / top) * (H - 14)) * 10) / 10;
    const share = newU != null && usedU != null && (newU + usedU) > 0 ? newU / (newU + usedU) : (newU != null ? 1 : 0);
    const line1 = pts.map((q) => `${x(q.d)} ${y(q.v)}`);
    const newTop = pts.map((q) => `${x(q.d)} ${y(q.v * share)}`);
    const areaNew = pts.length ? `M${x(1)} ${y(0)} L${newTop.join(" L")} L${x(dayN)} ${y(0)} Z` : "";
    const areaUsed = pts.length ? `M${newTop.join(" L")} L${[...line1].reverse().join(" L")} Z` : "";
    const path = pts.length ? `M${line1.join(" L")}` : "";
    /* The pace as a step: flat across days off, climbing on scheduled days. */
    const pacePath = goal != null && workDays.length
      ? "M0 " + y(0) + " " + Array.from({ length: daysInMonth }, (_, i) => `L${x(i + 1)} ${y(expectedBy(i + 1))}`).join(" ")
      : "";
    return { W, H, x, y, areaNew, areaUsed, path, pacePath, hasUsed: share < 1, todayX: x(dayN), todayY: pts.length ? y(pts[pts.length - 1].v) : y(0), goalY: goal != null ? y(goal) : null, bottom: y(0) };
  })();

  const board = (() => {
    if (!monthStats) return null;
    const all = Object.entries(monthStats).map(([k, s2]) => ({
      k, units: (s2.internetUnits || 0) + (s2.phoneUnits || 0) + (s2.showroomUnits || 0) + (s2.campaignUnits || 0),
    })).filter((r) => r.units > 0 || r.k === norm(meFull) || r.k === norm(meLabel));
    all.sort((x2, y2) => y2.units - x2.units || x2.k.localeCompare(y2.k));
    const meIdx = all.findIndex((r) => r.k === norm(meFull) || r.k === norm(meLabel));
    return { all, meIdx };
  })();
  const title = (k) => k.split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
  const chColors = { internet: "#5B9BE8", phone: "#F09B3C", showroom: "#3DC383" };
  const closing = ms ? [
    { k: "internet", label: "Internet", pct: ms.internetPct, leads: ms.internetLeads, u: ms.internetUnits },
    { k: "phone", label: "Phone", pct: ms.phonePct, leads: ms.phoneLeads, u: ms.phoneUnits },
    { k: "showroom", label: "Showroom", pct: ms.showroomPct, leads: ms.showroomLeads, u: ms.showroomUnits },
  ].filter((c) => c.pct != null || c.u) : [];
  const prev = (ms && ms.prevPct) || {};
  const maxPct = Math.max(20, ...closing.map((c) => c.pct || 0));

  return (
    <div className={"mc" + (offDim ? " mc-off" : "")}>
      {offToday && offState !== "in" && (
        <div className="mc-offc">
          <b>{offState === "no2" ? "Enjoy it." : offState === "no1" && activityNow ? "Numbers are coming in." : "Day off today"}</b>
          {offState !== "no2" && <span className="hint">{offState === "no1" && activityNow ? "Working today after all?" : "Working anyway? Say so and the day starts counting. Your stats stay open either way."}</span>}
          {offState === "no2" && <span className="hint">Your stats stay open. The day is not counting.</span>}
          {(offState === "" || (offState === "no1" && activityNow)) && (
            <div className="mc-offb">
              <button type="button" className="yes" onClick={() => onOffAnswer(true)}>I&rsquo;m in today</button>
              <button type="button" className="no" onClick={() => onOffAnswer(false)}>Not today</button>
            </div>
          )}
          {offState === "no1" && !activityNow && <div className="mc-offb"><button type="button" className="yes" onClick={() => onOffAnswer(true)}>I&rsquo;m in after all</button></div>}
        </div>
      )}
      <div className="mc-aurora" aria-hidden="true"><i /><i /><i /><i /><u /><u /></div>
      <div className="mc-head">
        <button type="button" className="mc-calw" onClick={() => { buzz(8); setPickDay(null); setSheet("sched"); }} aria-label="The month">
          <div className="mc-calhead"><PixIcon glyph="calendar" size={14} /><span>{MC_MONTHS[mo - 1]}</span></div>
          <div className="mc-cal">
            {cal.map((c, i) => c === null
              ? <span key={"p" + i} />
              : <s key={c.d} className={
                  (c.d === dayN ? "today " : "") + (c.isOff ? "hol" : c.d === bestDay ? "best" : (c.r ? (c.score >= 10 ? "h3" : c.score >= 1.4 ? "h2" : "h1") : (c.past ? "" : "off")))
                } />)}
          </div>
        </button>
        <div className="mc-side">
          <span className="mc-date">{new Date(y, mo - 1, dayN).toLocaleDateString([], { weekday: "long" }).toUpperCase()}</span>
          {me && me.status === "waiting" && (
            <button type="button" className="mc-aheadlbl" onClick={() => { buzz(8); toFloor(); }}>{availableAhead === 0 ? "YOU ARE UP" : availableAhead + " AHEAD"}</button>
          )}
          {!me && joinable && (
            <button type="button" className="mc-qmini mc-qjoin" onClick={() => { buzz(8); toFloor(); }} aria-label="Get on the floor">
              <s className="hd" /><b>GET ON THE FLOOR</b>
            </button>
          )}
          {upsToday > 0 && <span className="mc-chip2"><PixIcon glyph="door" size={11} />{upsToday} {upsToday === 1 ? "UP" : "UPS"} TODAY</span>}
        </div>
        <div className="mc-corner">
          {mineAt && <span className="mc-asof"><s />AS OF {mcClock(mineAt) || ""}</span>}
          <button type="button" className="mc-help" onClick={onHelp} aria-label="Help"><PixIcon glyph="question" size={16} /></button>
        </div>
      </div>
      {/* ---- the rail ----
          The same line the floor tab draws, from the screen's edge to the door,
          everybody in their own colour and you lit. Tapping it goes to the floor. */}
      {me && (line || []).length > 0 && (
        <button type="button" className="mc-railw" onClick={() => { buzz(8); toFloor(); }} aria-label="The line">
          <span className={"mc-rail" + (iAmUp ? " up" : "")} ref={railRef}>
            <s className="lt" /><s className="lt" /><s className="lt" />
            {(line || []).slice(0, 8).map((p, i) => {
              const mine2 = p.id === meId;
              const step = Math.min(82, i * 13);   // the head at the rail's end, the rest 13% a step back; the CSS puts it there
              const lbl = p.label || ((roster || []).find((r) => r.id === p.id) || {}).label || ((roster || []).find((r) => r.id === p.id) || {}).name || "";
              return <i key={p.id || i} className={"mc-pip" + (i === 0 ? " hd" : "") + (mine2 ? " you" : "") + (mine2 && iAmUp ? " g" : "") + (p.status && p.status !== "waiting" ? " off" : "")}
                style={{ "--p": step,
                  background: mine2 ? undefined
                    : (p.status && p.status !== "waiting"
                        ? `hsl(${hueFromName(lbl)} 20% 33%)`      // off the line: quieter, still solid
                        : `hsl(${hueFromName(lbl)} 62% 46%)`) }}>{initialsOf(lbl)}</i>;
            })}
          </span>
          <em>DOOR</em>
        </button>
      )}
      <McSpine rows={rows} />

      <div className={"mc-hero" + (paceState ? " mc-" + paceState : "")}>
        {paceState && <i className="mc-glow" aria-hidden="true" />}
        <span className="mc-statecol">
          {paceLabel && <span className="mc-state">{paceLabel}</span>}
          {closing.length > 0 && (
            <button type="button" className="mc-icobtn" onClick={() => { buzz(8); setSheet("closing"); }} aria-label="Closing detail">
              <span className="mc-cbars">
                <i style={{ height: 4, background: chColors.internet }} />
                <i style={{ height: 8, background: chColors.phone }} />
                <i style={{ height: 12, background: chColors.showroom }} />
              </span>
            </button>
          )}
        </span>
        <div className="mc-hero-top">
          {units != null
            ? <span className="mc-units"><LedNumber value={units} color="#F2F6F2" cell={9} gap={4} dim="transparent" /></span>
            : <span className="mc-units mc-units-none">No month row yet</span>}
          <span className="mc-units-lbl">units<br />this month</span>
        </div>
        {units != null && (
          <>
            <div className="mc-trail">
              <svg viewBox={`0 0 ${trail.W} ${trail.H}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="mcgN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E4C98D" stopOpacity=".95" /><stop offset="1" stopColor="#E4C98D" stopOpacity=".35" /></linearGradient>
                  <linearGradient id="mcgU" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A9C4AC" stopOpacity=".95" /><stop offset="1" stopColor="#A9C4AC" stopOpacity=".35" /></linearGradient>
                </defs>
                <g className="grid"><line x1="0" y1={trail.H * .26} x2={trail.W} y2={trail.H * .26} /><line x1="0" y1={trail.H * .52} x2={trail.W} y2={trail.H * .52} /><line x1="0" y1={trail.H * .78} x2={trail.W} y2={trail.H * .78} /></g>
                {trail.pacePath && <path className="pace" d={trail.pacePath} />}
                {trail.areaNew && <path className="area" d={trail.areaNew} fill="url(#mcgN)" />}
                {trail.hasUsed && trail.areaUsed && <path className="area" d={trail.areaUsed} fill="url(#mcgU)" />}
                {trail.path && <path className="edge" d={trail.path} />}
                <line className="todayline" x1={trail.todayX} y1="4" x2={trail.todayX} y2={trail.H - 4} />
                <circle className="todaydot" cx={trail.todayX} cy={trail.todayY} r="4.5" />
                {trail.goalY != null && <circle className="goalring" cx={trail.W} cy={trail.goalY} r="4" />}
              </svg>
              <div className="mc-tl">
                <span>{MC_MONTHS[mo - 1]} 1</span>
                <span className="mid">{goal != null ? `GOAL ${goal}${toGo > 0 ? ` · ${toGo} TO GO` : " · MADE"}${paceWord ? ` · ${paceWord}` : ""}` : pace != null ? `PACE ${pace}` : ""}</span>
                <span>{MC_MONTHS[mo - 1]} {daysInMonth}</span>
              </div>
            </div>
            <div className="mc-legend">
              <span><s className="nw" />NEW {newU != null ? newU : units}</span>
              {usedU != null && <span><s className="us" />USED {usedU}</span>}
              {goal != null && <span><s className="pc" />PACE</span>}
            </div>
          </>
        )}
      </div>

      <div className="mc-cap mc-cap-t">TODAY</div>
      <div className="mc-card mc-today">
        {rows.map((r2) => (
          <div className={"mc-row" + (r2.met ? " met" : "")} key={r2.label}>
            <span className="mc-num"><LedNumber value={r2.got} color={r2.met ? "#1E8A4C" : "#D0821E"} cell={5.5} gap={2.5} dim="transparent" /></span>
            <span className="mc-tx">
              <b>{r2.label}</b>
              {r2.met
                ? <span className="mc-made"><PixIcon glyph="check" size={13} /><span>MADE IT</span></span>
                : <>
                    <span className="st">OF {r2.need}</span>
                    <span className="bar"><i style={{ width: Math.min(100, Math.round(((r2.got || 0) / Math.max(1, r2.need)) * 100)) + "%" }} /></span>
                  </>}
            </span>
          </div>
        ))}
      </div>

      <div className="mc-cap mc-cap-p">POINTS</div>
      <div className="mc-card mc-pts">
        <div className="mc-ptshead">
          <span className="mc-num"><LedNumber value={points} color="#F08A80" cell={6.5} gap={3} dim="transparent" /></span>
          <span className="mc-ptslbl">
            <b>this month so far</b>
            {streak > 0 && <span className="mc-streak">CLEAN {streak} DAY{streak === 1 ? "" : "S"} RUNNING</span>}
          </span>
        </div>
        <div className="mc-week">
          {week.map((w, i) => (
            <i key={i}>
              <span className={"c " + w.state}>{w.state === "ok" ? <PixIcon glyph="check" size={12} /> : w.state === "bad" ? "+" + w.pts : "\u00b7"}</span>
              <span className="wd">{w.wd}</span>
            </i>
          ))}
        </div>
        <div className="mc-list">
          {[
            { l: `${needCalls} calls`, d: (a.calls || 0) >= needCalls },
            { l: `${needVideos} video${needVideos === 1 ? "" : "s"}`, d: (a.video || 0) >= needVideos },
            { l: "RockEd", d: a.rocked === true },
            { l: "Tasks clear", d: needTasks > 0 ? (a.tasks || 0) >= needTasks : (a.tasks || 0) > 0 },
          ].map((it) => (
            <div className={"mc-li" + (it.d ? " done" : "")} key={it.l}>
              <span className="ck">{it.d && <PixIcon glyph="check" size={12} />}</span><span>{it.l}</span>
            </div>
          ))}
          <span className="mc-lifoot">Off today&rsquo;s report. Nothing here is ticked by hand.</span>
        </div>
      </div>

      {board && board.all.length > 1 && (
        <>
          <div className="mc-cap mc-cap-b">THE BOARD</div>
          <button type="button" className="mc-card mc-boardbtn mc-board" onClick={() => { buzz(8); setSheet("board"); }}>
            <div className="mc-pod">
              {board.all.slice(0, 3).concat(board.meIdx > 2 ? [board.all[board.meIdx]] : []).map((r2) => {
                const meRow = r2.k === norm(meFull) || r2.k === norm(meLabel);
                const rank = board.all.indexOf(r2) + 1;
                const nm2 = title(r2.k);
                return (
                  <div className={"mc-pd" + (meRow ? " me" : "")} key={r2.k}>
                    <span className="av" style={{ background: meRow ? "#E4C98D" : `hsl(${hueFromName(nm2)} 62% 46%)`, color: meRow ? "#15211B" : "#fff" }}>{initialsOf(nm2)}</span>
                    <b>{meRow ? "You" : nm2.split(" ")[0]}</b>
                    <span className="un">{r2.units}</span>
                    <span className="rk">{rank}{["ST", "ND", "RD"][rank - 1] || "TH"}</span>
                  </div>
                );
              })}
            </div>
            <span className="mc-boardsub">{board.meIdx >= 0 ? `you are ${board.meIdx + 1}${["st", "nd", "rd"][board.meIdx] || "th"} of ${board.all.length}` : `${board.all.length} on the board`}</span>
          </button>
        </>
      )}

      {sheet && (
        <Overlay><div className="mc-ov" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="mc-sheet">
            <div className="mc-sheet-head">
              <b>{sheet === "closing" ? "Closing" : sheet === "sched" ? new Date(y, mo - 1, 1).toLocaleDateString([], { month: "long" }) : "The board"}</b>
              <button type="button" className="mc-x" onClick={() => { setSheet(null); setOpenCh(null); }} aria-label="Close"><PixIcon glyph="close" size={14} /></button>
            </div>
            {sheet === "closing" && (
              <>
                <div className="mc-clrow">
                  {closing.map((c) => (
                    /* A button now. These have always looked tappable and done
                       nothing, which is worse than looking flat: the thirty-day
                       line is the thing somebody actually came here to ask for. */
                    <button type="button" key={c.k}
                      className={"mc-cl" + (openCh === c.k ? " on" : "")}
                      aria-expanded={openCh === c.k}
                      onClick={() => { buzz(8); setOpenCh(openCh === c.k ? null : c.k); }}>
                      <b style={{ color: chColors[c.k] }}>{c.pct != null ? c.pct + "%" : "\u00b7"}</b>
                      <span className="vb"><i style={{ height: Math.round(((c.pct || 0) / maxPct) * 100) + "%", background: chColors[c.k] }} /></span>
                      <span className="lb" style={{ color: chColors[c.k] }}>{c.label}</span>
                      {prev[c.k] != null && c.pct != null && (
                        <span className={"dl " + (c.pct >= prev[c.k] ? "up" : "dn")}>
                          <PixIcon glyph={c.pct >= prev[c.k] ? "triup" : "tridown"} size={9} /> {Math.abs(Math.round((c.pct - prev[c.k]) * 10) / 10)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {openCh && (
                  <div className="mc-clopen">
                    <div className="mc-clopen-head">
                      <b style={{ color: chColors[openCh] }}>
                        {(closing.find((c) => c.k === openCh) || {}).label} &middot; 30 days
                      </b>
                      <button type="button" className="mc-clopen-x" onClick={() => setOpenCh(null)}>Hide</button>
                    </div>
                    <ChannelLine series={channelSeries(days, openCh)} col={chColors[openCh]} />
                  </div>
                )}
                <div className="mc-clfoot">
                  {closing.map((c) => c.leads != null ? `${c.label.toLowerCase()} ${c.u || 0} of ${c.leads}` : null).filter(Boolean).join(" \u00b7 ")}
                </div>
              </>
            )}
            {sheet === "sched" && (
              <>
                <div className="mc-sc">
                  {"SMTWTFS".split("").map((c, i) => <b key={"w" + i}>{c}</b>)}
                  {cal.map((c, i) => c === null
                    ? <span key={"p" + i} />
                    : <s key={c.d} onClick={() => setPickDay(c.d)} className={
                        (pickDay === c.d ? "sel " : "") + (c.d === dayN ? "today " : "") + (c.isOff ? "hol" : c.d === bestDay ? "best" : (c.r ? (c.score >= 10 ? "h3" : c.score >= 1.4 ? "h2" : "h1") : (c.past ? "" : "off")))
                      } />)}
                </div>
                <div className="mc-legend mc-legend-sc">
                  <span><s className="best" />BEST DAY</span><span><s className="big" />BIG DAY</span><span><s className="hol" />OFF</span>
                </div>
                <div className="mc-scd">
                  {(() => {
                    if (!pickDay) return <span className="mc-scd-hint">Tap a day: its numbers and its hours.</span>;
                    const c = cal.find((x2) => x2 && x2.d === pickDay);
                    const r = c && c.r;
                    const lbl = `${MC_MONTHS[mo - 1]} ${pickDay}`;
                    if (c && c.isOff) return <><div className="mc-scr"><span>{lbl}</span><i /><span>DAY OFF</span></div><span className="mc-scd-hint">Scheduled off. Your stats stay open.</span></>;
                    if (!c || !c.past) return <><div className="mc-scr"><span>{lbl}</span><i /><span>SCHEDULED</span></div><span className="mc-scd-hint">Ahead of you. On the floor, RockEd by ten.</span></>;
                    if (!r) return <><div className="mc-scr"><span>{lbl}</span><i /><span>NO REPORT</span></div><span className="mc-scd-hint">Nothing the phone can still read for this day.</span></>;
                    const pd = pointsForDay(r, std);
                    return (
                      <>
                        <div className="mc-scr"><span>{lbl}{c.d === bestDay ? " \u00b7 BEST DAY" : ""}</span><i /><span>{pd.noData ? "\u00b7" : pd.points === 0 ? "CLEAN" : "+" + pd.points}</span></div>
                        <div className="mc-scr"><span>UNITS</span><i /><span>{r.units || 0}</span></div>
                        <div className="mc-scr"><span>CALLS \u00b7 VIDEOS</span><i /><span>{r.calls || 0} \u00b7 {r.video || 0}</span></div>
                        <div className="mc-scr"><span>TASKS</span><i /><span>{r.tasks || 0}{r.tasksPosted ? " / " + r.tasksPosted : ""}</span></div>
                        <div className="mc-scr"><span>ROCKED</span><i /><span>{r.rocked === true ? "YES" : r.rocked === false ? "NO" : "\u00b7"}</span></div>
                        {pd.missed.length > 0 && <span className="mc-scd-hint">Slipped on {pd.missed.join(", ")}. That is where the {pd.points === 1 ? "point" : "points"} came from.</span>}
                      </>
                    );
                  })()}
                </div>
              </>
            )}
            {sheet === "board" && board && (
              <div className="mc-hb mc-hb-full">
                {board.all.map((r2, i) => {
                  const meRow = r2.k === norm(meFull) || r2.k === norm(meLabel);
                  return (
                    <div className={"r" + (meRow ? " me" : "")} key={r2.k}>
                      <span className="rk">{i + 1}</span>
                      <span className="nm2">{meRow ? "You" : title(r2.k)}</span>
                      <span className="tk"><i style={{ width: Math.round((r2.units / Math.max(1, board.all[0].units)) * 100) + "%" }} /></span>
                      <span className="un">{r2.units}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div></Overlay>
      )}
    </div>
  );
}

/* account: the roster id this signed-in account is linked to, when the page was
   reached through the account door rather than a scanned code. The link is the
   identity and the day is always today, so there is no token to check, no name
   to type and no PIN; the corner is home whether or not they are on the line
   yet, and the floor tab is where they get on. */
function FloorSignIn({ store, date, token, tag = null, test = false, account = null, onSignOut = null, active = true,
  tab: tabFrom = null, onTab = null }) {
  const [row, setRow] = useState(undefined);
  const [identities, setIdentities] = useState(null);
  const [meId, setMeId] = useState(() => { if (account) return account; try { return localStorage.getItem(`lpcf:${store}:${date}`) || null; } catch { return null; } });
  /* The salesperson's home. Corner is the default room; the floor screen is one
     tap on the pill, and being up next drags the view there on its own because
     that overlay is the one thing that must never be missed. */
  /* Its own tab, unless somebody outside is holding it. When a salesperson's
     phone offers more than one room there is one bar at the foot for all of
     them, and it cannot be owned by one of the rooms it switches between. The
     QR door still reaches this screen on its own, and then the tab is its. */
  const [tabOwn, setTabOwn] = useState("corner");
  const tab = onTab ? tabFrom : tabOwn;
  const setTab = onTab || setTabOwn;
  const [step, setStep] = useState("name");
  const [shown, setShown] = useState("loading");
  const [shownKey, setShownKey] = useState("loading");
  const [wiping, setWiping] = useState(false);
  const [held, setHeld] = useState(true);
  const holdT = useRef(null);
  const wipeT = useRef({ swap: null, end: null });
  /* The curtain's exit clears itself here, on its own effect, because the
     screen-change effect below re-runs the moment the first page is swapped
     in, and its cleanup would cancel the timer before it fired. */
  useEffect(() => {
    if (wiping !== "out") return undefined;
    const t = setTimeout(() => setWiping(false), 340);
    return () => clearTimeout(t);
  }, [wiping]);
  // Set the instant "Got it" is tapped, cleared when the data agrees. Without it the
  // overlay lingers for the round trip and people tap it again and again.
  const [tookIt, setTookIt] = useState(false);
  const [typed, setTyped] = useState(() => { try { return localStorage.getItem(`lpcq:name:${store}`) || ""; } catch { return ""; } });
  const [resolved, setResolved] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinMode, setPinMode] = useState("verify");
  const [switchTo, setSwitchTo] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Same as Phone Line: somebody standing on the floor should be able to see their own
  // list and their own numbers without asking a manager for them.
  const [myDay, setMyDay] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [mine, setMine] = useState(null);
  const [mineAt, setMineAt] = useState(null);
  // The published board row carries this month's channel figures and is readable
  // without an account, which is the only way a sign-in page can get them.
  const [monthStats, setMonthStats] = useState(null);
  // The board's own grading thresholds ride on the same published row. My day colours
  // its percentages by these, so the wall and the phone can never disagree about
  // whether a number is green.
  const [boardThr, setBoardThr] = useState(null);
  const [boardExtra, setBoardExtra] = useState({ goals: {}, off: {} });
  /* The board's roster, ids and names, for the morning the floor row does not
     exist yet: an account knows its roster id and nothing else, and this is the
     one public place that turns the id back into a name. */
  const [boardRoster, setBoardRoster] = useState([]);
  /* The moments. The ticket prints when they leave, then files itself to the
     desk; a milestone takes the screen once; a scheduled day off asks whether
     they are working before the day starts counting; Help is one sheet. */
  const [days, setDays] = useState(null);
  const [ticket, setTicket] = useState(null);       // null | "printing" | "sending" | "sent" | "failed"
  const [mile, setMile] = useState(null);           // the unit count that just landed
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPanel, setHelpPanel] = useState(false);
  const [offState, setOffState] = useState(() => { try { return localStorage.getItem(`lpcf:offday:${store}:${date}`) || ""; } catch { return ""; } });
  /* The bars the browser draws around the page take their colour from this
     tag. The phone screens are the garden's dark ink, so the bars are too, and
     the light dashboard colour comes back when the screen is left. */
  useEffect(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m) return;
    const was = m.getAttribute("content");
    m.setAttribute("content", "#15211B");
    return () => { m.setAttribute("content", was || "#F5F5F7"); };
  }, []);
  /* The phone app is the app. Inside the native shell this row is not shown;
     in a browser it points at the store, or says the app is on its way. */
  const inNative = !!window.ReactNativeWebView;
  /* ---- the phone's push token ----
     The shell hands the page the phone's own token; the page holds the session
     and the store, so it does the registering. Once per token per store: the
     endpoint merges, so a repeat costs nothing but a round trip. */
  useEffect(() => {
    if (!account) return;
    let dead = false;
    const send = async (nat) => {
      const body = registrationBody(nat, store);
      if (!body) return;
      const k = `lpcf:dev:${store}:${body.device_id}:${body.apns_token || body.fcm_token}:${body.apns_pts_token || ""}:${body.activity_token || ""}`;
      try { if (localStorage.getItem(k) === "1") return; } catch (e) {}
      const r = await apiCall("/api/register-device", { method: "POST", body });
      if (dead) return;
      if (!r.error) { try { localStorage.setItem(k, "1"); } catch (e) {} }
      else console.error("register-device", r.error);
    };
    if (window.__lpcNative) send(window.__lpcNative);
    const on = (e) => send(e.detail || window.__lpcNative);
    window.addEventListener("lpc:native", on);
    return () => { dead = true; window.removeEventListener("lpc:native", on); };
  }, [account, store]);   // eslint-disable-line
  const [appOpen, setAppOpen] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const appLink = isIOS ? APP_STORE_LINKS.ios : APP_STORE_LINKS.android;
  useEffect(() => {
    let dead = false;
    loadShared(`lpc:board:${store}:v1`, null)
      .then((b) => {
        if (dead || !b) return;
        if (b.months) setMonthStats((b.months[b.ym] || {}).stats || null);
        setBoardThr(b.thresholds || null);
        setBoardExtra({ goals: b.goals || {}, off: b.off || {} });
        setBoardRoster(Array.isArray(b.roster) ? b.roster : []);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [store]);
  useEffect(() => { loadShared("lpc:config:v2", null).then(setCfg).catch(() => {}); }, []);
  const std = { ...DEFAULT_ACTIVITY_STANDARDS, ...(((cfg && cfg.stores) || []).find((s) => s.id === store)?.activityStandards || {}) };

  const writes = useRef(0);
  const refetch = useCallback(async (force) => {
    if (writes.current > 0) return;            // a tap is still landing; its answer is the next read
    if (force === true) rowStamps.delete(FLOOR_TABLE + "|" + floorRowId(store, date));
    const got = await loadRowIfChanged(FLOOR_TABLE, floorRowId(store, date));
    if (got === undefined || got === "same") return;
    setRow(got || null);
  }, [store, date]);
  const mutateRow = useCallback((fn) => mutateFloorRow(store, date, fn), [store, date]);
  const commit = useCommit(setRow, mutateRow, refetch, writes);
  const live = useLiveRow(FLOOR_TABLE, floorRowId(store, date), refetch);
  /* Looked at: every five seconds, or thirty with the socket open. Not looked
     at (the other room is up): thirty, and a fresh read the moment it is. */
  useEffect(() => { refetch(); const t = setInterval(refetch, live || !active ? 30000 : 5000); return () => clearInterval(t); }, [refetch, live, active]);
  useEffect(() => { loadQueueIdentities(store).then(setIdentities); }, [store]);

  const isToday = date === today();
  /* A table tag carries no daily token; it is valid only for a phone that is
     already signed in today, which is the whole security model: the tag says
     where, never who. */
  const valid = isToday && (account
    ? true
    : row && ((row.token && row.token === token) || (tag && meId && (row.line || []).some((p) => p.id === meId))));
  /* Tapping the tag on a table means one thing on a sales floor: I am sitting
     down here with a guest. So the tap flips the person to "with customer" AND
     seats them, in one write, once per open. A phone that is not signed in
     today falls through to the ordinary screens instead. */
  const tagDone = useRef(false);
  useEffect(() => {
    if (!tag || tagDone.current || !row || !meId) return;
    if (!(row.line || []).some((p) => p.id === meId)) return;
    tagDone.current = true;
    (async () => {
      try {
        const next = await mutateFloorRow(store, date, (cur) => {
          if (!cur) return null;
          const q = (cur.line || []).find((x) => x.id === meId);
          if (!q) return cur;
          if (q.status !== "customer") {
            cur.history = cur.history || [];
            cur.history.push({ t: qNowIso(), action: "checkin", id: q.id, who: q.label, by: "table-tag" });
            q.status = "customer"; q.statusAt = qNowIso(); q.awayReason = null; q.autoFlip = false;
          }
          q.table = tag;
          return cur;
        });
        if (next) setRow(next);
        try { localStorage.setItem(`lpcf:seat:${store}`, String(tag)); } catch (e) {}
        buzz([15, 30, 15]);
      } catch (e) { /* the poll corrects the screen either way */ }
    })();
  }, [tag, row ? 1 : 0, meId]); // eslint-disable-line
  const line = (row && row.line) || [];
  const me = line.find((p) => p.id === meId) || null;
  /* The phone should be felt, not only read: a change to where you stand or
     what you are doing buzzes once as it lands, and reaching the door buzzes
     the long pattern, so nobody has to watch the screen to know. The first
     reading is silent; that is the page finding out where you already were. */
  const myPlace = me ? (me.status || "waiting") + "|" + line.indexOf(me) : "";
  const lastPlace = useRef(myPlace);
  useEffect(() => {
    const was = lastPlace.current; lastPlace.current = myPlace;
    if (!was || !myPlace || was === myPlace) return;
    const [ws, wi] = was.split("|"); const [ns, ni] = myPlace.split("|");
    if (ns === "waiting" && ni === "0" && !(ws === "waiting" && wi === "0")) buzz([30, 60, 30]);
    else if (ws !== ns) buzz([14, 40, 14]);
    else buzz(8);
  }, [myPlace]);
  // Filtered out entirely unless the address asked for it, so it cannot be picked
  // by accident by somebody scrolling the name list.
  const roster = ((row && row.roster) || []).filter((r) => !r.test || test);
  const variant = FLOOR_VARIANT;
  const boardMe = account && meId ? boardRoster.find((r) => r && r.id === meId) || null : null;
  const meEntry = ((row && row.roster) || []).find((r) => r.id === meId)
    || (boardMe ? { id: boardMe.id, name: boardMe.name, label: shortLabel(boardMe.name) } : null);
  const meLabel = (meEntry && meEntry.label) || "";
  // Reports are keyed by the full name, never the short label.
  const meFull = (meEntry && meEntry.name) || "";
  // One small row, not the whole store, thanks to the per-day activity split.
  useEffect(() => {
    if ((!meFull && !meLabel) || !supabase) return;
    let dead = false;
    const pull = async () => {
      try {
        // The board prefix, not the store prefix: this page has no account. The
        // row is everybody's numbers for the day and is republished a few times
        // a day, so it is read only when its stamp has moved.
        const v = await loadSharedIfChanged(floorStatsKey(store, date), "mine|" + store + "|" + date);
        if (!dead && v && v !== "same") {
          const r = v[norm(meFull)] || v[norm(meLabel)] || null;
          setMine(r);
          if (r && r.uploadedAt) setMineAt(r.uploadedAt);
        }
      } catch (e) { /* the panel says so itself if nothing arrives */ }
    };
    pull();
    const t = setInterval(pull, 120000);
    return () => { dead = true; clearInterval(t); };
  }, [store, date, meFull, meLabel]);
  useEffect(() => {
    if (!meFull && !meLabel) return;
    let dead = false;
    loadMyDays(store, date, [norm(meFull || ""), norm(meLabel || "")]).then((d) => { if (!dead) setDays(d); }).catch(() => {});
    return () => { dead = true; };
  }, [store, date, meFull, meLabel, mineAt]);   // eslint-disable-line

  // A milestone is every fifth unit and the goal itself, seen once. The last
  // one celebrated is remembered per month so a reload never replays it.
  const myMonth = (monthStats && (monthStats[norm(meFull)] || monthStats[norm(meLabel)])) || null;
  const myUnits = myMonth ? (myMonth.internetUnits || 0) + (myMonth.phoneUnits || 0) + (myMonth.showroomUnits || 0) + (myMonth.campaignUnits || 0) : null;
  const myGoal = (boardExtra.goals[norm(meFull)] ?? boardExtra.goals[norm(meLabel)]) ?? null;
  useEffect(() => {
    if (myUnits == null || !meId) return;
    try {
      if (localStorage.getItem("lpcf:pref:mile") === "0") return;
      const k = `lpcf:mile:${store}:${date.slice(0, 7)}:${meId}`;
      const seen = parseFloat(localStorage.getItem(k) || "0");
      const marks = [];
      for (let m = 5; m <= Math.max(5, Math.floor(myUnits)); m += 5) marks.push(m);
      if (myGoal) marks.push(myGoal);
      const hit = marks.filter((m) => m > seen && myUnits >= m).sort((a2, b2) => b2 - a2)[0];
      if (hit) { setMile(hit); localStorage.setItem(k, String(hit)); buzz([20, 40, 20, 40, 60]); }
      else if (!localStorage.getItem(k)) localStorage.setItem(k, String(Math.floor(myUnits / 5) * 5));
    } catch (e) {}
  }, [myUnits, myGoal, meId]);   // eslint-disable-line
  const myOff = (boardExtra.off[norm(meFull)] || boardExtra.off[norm(meLabel)] || []);
  const offToday = myOff.includes(date);
  const activityNow = !!(mine && ((mine.calls || 0) > 0 || (mine.video || 0) > 0 || (mine.units || 0) > 0));
  const answerOff = async (working) => {
    let nextState = working ? "in" : (offState === "no1" && activityNow ? "no2" : "no1");
    setOffState(nextState);
    try { localStorage.setItem(`lpcf:offday:${store}:${date}`, nextState); } catch (e) {}
    buzz(12);
    if (nextState === "no2") {
      // Twice no, with numbers on the record: the facts go where a manager reads them.
      try {
        await mutateFloorRow(store, date, (cur) => {
          if (!cur) return null;
          cur.presence = cur.presence || { events: [], state: {} };
          if (!(cur.presence.events || []).some((e) => e.kind === "offday" && e.personId === meId)) {
            cur.presence.events.push(onOffDayWorked({ personId: meId, label: meLabel || meFull, at: Date.now(),
              activity: { calls: mine && mine.calls, video: mine && mine.video, units: mine && mine.units } }));
          }
          return cur;
        });
      } catch (e) {}
    }
  };
  // The ticket: print, then file to the desk, then good night.
  const startTicket = () => { if (!meId) return; buzz(10); setTicket("printing"); };
  /* Left from the lock screen, out on the road, with no page open to print a
     ticket or file the day's numbers. The desk got a stub at the time; this
     fills it in the next time the app is opened and shows the person the
     ticket they did not get to see. Once, and only for the day it happened on. */
  const [lateTicket, setLateTicket] = useState(null);
  useEffect(() => {
    if (me || ticket || lateTicket) return;
    const stub = ((row && row.checkouts) || []).find((c) => c && c.id === meId && c.partial);
    if (!stub) return;
    let dead = false;
    (async () => {
      const snap = { calls: mine && mine.calls, video: mine && mine.video, tasks: mine && mine.tasks,
        tasksPosted: mine && mine.tasksPosted, units: mine && mine.units, rocked: mine && mine.rocked,
        points: pointsForDay(mine || {}, std).points, asOf: mineAt || null };
      try {
        const next = await mutateFloorRow(store, date, (cur) => {
          if (!cur) return null;
          const c = (cur.checkouts || []).find((x) => x && x.id === meId && x.partial);
          if (!c) return null;
          Object.assign(c, snap); delete c.partial;
          return cur;
        });
        if (!dead && next) setRow(next);
      } catch (e) { /* the desk keeps the stub; this runs again next time */ }
      if (!dead) setLateTicket(stub.t || qNowIso());
    })();
    return () => { dead = true; };
  }, [row, me, meId, ticket, lateTicket]); // eslint-disable-line
  useEffect(() => {
    if (ticket !== "printing") return;
    const t = setTimeout(async () => {
      setTicket("sending");
      try {
        const snap = { calls: mine && mine.calls, video: mine && mine.video, tasks: mine && mine.tasks,
          tasksPosted: mine && mine.tasksPosted, units: mine && mine.units, rocked: mine && mine.rocked,
          points: pointsForDay(mine || {}, std).points, asOf: mineAt || null };
        await mutateFloorRow(store, date, (cur) => {
          if (!cur) return null;
          cur.checkouts = (cur.checkouts || []).filter((c) => c.id !== meId);
          cur.checkouts.push({ id: meId, who: meLabel || meFull, name: meFull || meLabel, t: qNowIso(), ...snap });
          return cur;
        });
        setTicket("sent");
      } catch (e) { setTicket("failed"); }
    }, 2700);
    return () => clearTimeout(t);
  }, [ticket]);   // eslint-disable-line
  const daysClean = (() => {
    if (!days) return 0;
    let n = 0;
    const sorted = days.slice().sort((a2, b2) => (a2.day < b2.day ? 1 : -1));
    for (const d of sorted) { if (d.day >= date) continue; if (!d.row) continue; if (myOff.includes(d.day)) continue;
      const pd = pointsForDay(d.row, std); if (pd.noData) continue; if (pd.points === 0) n++; else break; }
    return n;
  })();
  const iAmUp = (() => { if (!me || me.status !== "waiting") return false; const i = line.findIndex((p) => p.id === meId); return i >= 0 && line.slice(0, i).filter((p) => p.status === "waiting").length === 0; })();
  useEffect(() => { if (iAmUp) buzz([30, 60, 30]); }, [iAmUp]);
  const myIdx = me ? line.findIndex((p) => p.id === meId) : -1;
  const aheadCount = myIdx >= 0 ? line.slice(0, myIdx).filter((p) => p.status === "waiting").length : 0;
  const wasOn = useRef(false);
  useEffect(() => {
    /* An account holder's standing is posted by the rooms shell, both lanes
       in one message; this screen posts only for somebody in through the QR. */
    if (account) return;
    if (!me || myIdx < 0) {
      /* Off the line for the day: said once, so the shell takes the card down
         and stops asking anybody to reopen the app. */
      if (wasOn.current) { wasOn.current = false; postToNativeShell({ queue: variant.label, store: (row && row.storeName) || "", status: "gone", updatedAt: new Date().toISOString() }); }
      return;
    }
    wasOn.current = true;
    postToNativeShell({ queue: variant.label, store: (row && row.storeName) || "",
      rep: ((roster || []).find((r) => r.id === meId) || {}).label || "",
      position: myIdx + 1, ahead: aheadCount, status: iAmUp ? "up" : me.status, updatedAt: new Date().toISOString(),
      /* The rail the lock screen draws: everybody in line as initials and a hue,
         with you marked. Same shape the server sends (api/_queue-notify.mjs). */
      line: line.slice(0, 8).map((p) => { const nm = p.label || ((roster || []).find((r) => r.id === p.id) || {}).label || ((roster || []).find((r) => r.id === p.id) || {}).name || "";
        return { i: initialsOf(nm) || "\u00b7", h: hueFromName(nm), s: (p.status || "waiting") === "waiting" ? "w" : "x", me: p.id === meId }; }),
      nudge: !!(me.nudgedAt && qMinsSince(me.nudgedAt) < 10), table: me.table != null ? String(me.table) : null, since: me.statusAt || null });
  }, [me && me.status, myIdx, aheadCount, iAmUp, line.length, me && me.nudgedAt]); // eslint-disable-line

  const remember = (id) => {
    try {
      if (id) { localStorage.setItem(`lpcf:${store}:${date}`, id); localStorage.setItem(`lpcq:self:${store}`, id); }
      else localStorage.removeItem(`lpcf:${store}:${date}`);
    } catch {}
    setMeId(id);
  };

  useEffect(() => { if (meId && line.some((p) => p.id === meId)) setStep("done"); }, [meId, line]);

  /* ---- who you are, if the phone already knows ----
     A salesperson with an account and a link is already identified, so the name
     list and the PIN are two screens asking a question that has been answered.
     The session persists, so this happens once and every morning after is a scan
     and a tap.

     The name-and-PIN path stays exactly as it was underneath. It is what the
     podium uses, what somebody with no account uses, and what everybody uses on
     the morning the sign-in service is having a bad day. */
  const [knownAs, setKnownAs] = useState(account || undefined);   // undefined = still asking
  useEffect(() => {
    if (account) return;
    let dead = false;
    myFloorPerson(store).then((id) => { if (!dead) setKnownAs(id || null); });
    return () => { dead = true; };
  }, [store, account]);
  const accountPerson = knownAs
    ? ((row && row.roster) || []).find((r) => r.id === knownAs) || (account && meEntry ? meEntry : null)
    : null;

  let screen;
  if (row === undefined || identities === null || knownAs === undefined) screen = "loading";
  else if (!isToday || !valid) screen = "invalid";
  else if (step === "done" && me) screen = "done";
  /* Through the door and not on the line: the corner is still home. */
  else if (account && !me) screen = "home";
  else if (step === "pin" && switchTo) screen = "switch";
  else if (step === "pin" && selected) screen = "pin";
  else if (step === "pick") screen = "pick";
  else if (step === "confirm") screen = "confirm";
  /* Identified by their account, and not on the line yet: one button, no typing. */
  else if (accountPerson && step === "name") screen = "known";
  else screen = "name";

  // A wipe should fire between EVERY page they touch — including flag changes on the
  // live screen (which don't change `screen`). Key it on screen + live status.
  const liveKey = (screen === "done" && me) ? `done:${me.status}${me.appt ? ":a" : ""}` : screen;
  useEffect(() => {
    if (liveKey === shownKey) return undefined;
    /* The curtain sat over the page while the line loaded, so the first page
       is already behind it: swap it in and let the curtain leave, rather than
       sweeping a second curtain in from the side. The line and the person
       resolve a beat apart, and the screen in between is not worth showing,
       so the curtain waits for the page to settle before it goes. */
    if (held) {
      if (screen === "loading") return undefined;
      setShown(screen); setShownKey(liveKey);
      clearTimeout(holdT.current);
      holdT.current = setTimeout(() => { setHeld(false); setWiping("out"); }, 140);
      return undefined;
    }
    // The PIN screen gets its own fun entrance (a spring pop) instead of the curtain.
    if (screen === "pin") { setShown("pin"); setShownKey(liveKey); return; }
    /* The timers live outside the effect on purpose. The swap changes
       shownKey, which re-runs this effect, and a cleanup that cleared both
       timers took the end of the wipe with it: the curtain's class stayed on,
       parked off screen, and no later change could start it again. So only
       the first change after a load ever wiped. */
    clearTimeout(wipeT.current.swap); clearTimeout(wipeT.current.end);
    setWiping(true);
    wipeT.current.swap = setTimeout(() => { setShown(screen); setShownKey(liveKey); }, 180);
    wipeT.current.end = setTimeout(() => setWiping(false), 380);
    return undefined;
  }, [liveKey, shownKey, screen]);
  useEffect(() => () => { clearTimeout(wipeT.current.swap); clearTimeout(wipeT.current.end); }, []);

  /* ---- the door ----
     The morning scan is the moment worth checking that somebody is actually
     here, and the moment where getting it wrong costs the most: turn away
     somebody standing in the middle of the lot on their first morning and they
     will never trust the tool again, and will tell the floor why.

     So only a confident outside refuses. No fence drawn, no permission, no fix,
     or a fix too vague to argue with all let them on — the rule lives in
     doorCheck and is the same rule everywhere. The dishonest case is not lost by
     being lenient here; it is caught the same way it always was, by the day's
     record failing to back the claim up. */
  const [doorNote, setDoorNote] = useState(null);
  const storeFence = ((cfg && cfg.stores) || []).find((x) => x.id === store)?.fence || null;

  const readPosition = () => new Promise((resolve) => {
    if (!navigator.geolocation || !storeFence) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    /* A phone that never answers must not leave somebody staring at a spinner
       when they are trying to get onto the floor. */
    setTimeout(() => finish(null), 9000);
  });

  async function joinAs(person) {
    setBusy(true);
    setDoorNote(null);
    const reading = await readPosition();
    const door = doorCheck(reading, storeFence);
    if (!door.allow) {
      setDoorNote(door);
      setBusy(false);
      return;
    }
    try { localStorage.setItem(`lpcq:name:${store}`, person.label); } catch {}
    remember(person.id);
    commit((cur) => {
      if (!cur) return null;
      cur.line = cur.line || [];
      if (!cur.line.some((p) => p.id === person.id)) {
        cur.line.push({ id: person.id, label: person.label, joinedAt: qNowIso(), status: "waiting", statusAt: qNowIso() });
        cur.history = cur.history || [];
        /* How they got on is worth keeping. "Signed on from the lot" and "signed
           on with a phone that would not say" are the same event to everybody
           except the person reviewing an odd day later. */
        cur.history.push({ t: qNowIso(), action: "signed-in", id: person.id, who: person.label, by: "self",
          detail: door.why === "inside" ? "on the lot" : door.why });
      }
      return cur;
    });
    if (door.why !== "inside") setDoorNote(door);
    setStep("done"); setPin(""); setPin2(""); setBusy(false);
  }

  function submitName() {
    setMsg("");
    const r = qResolveName(typed, roster);
    setResolved(r);
    if (r.kind === "one") pickPerson(r.person);
    else if (r.kind === "confirm") setStep("confirm");
    else if (r.kind === "pick") setStep("pick");
    else { setStep("name"); setMsg("We couldn't find that name. Check the spelling, or tap a suggestion below."); }
  }
  function pickPerson(p) {
    setSelected(p); setSwitchTo(null); setMsg("");
    const hasPin = !!(identities && identities[p.id] && identities[p.id].h);
    setPinMode(hasPin ? "verify" : "create");
    setStep("pin");
  }
  async function submitPin() {
    if (!selected) return;
    if (!/^\d{4,6}$/.test(pin)) { setMsg("Your PIN is 4 to 6 digits."); return; }
    setBusy(true); setMsg("");
    const idents = identities || (await loadQueueIdentities(store));
    if (pinMode === "create") {
      if (pin !== pin2) { setMsg("The two PINs don't match."); setBusy(false); return; }
      const clash = await qFindByPin(idents, pin, selected.id);
      if (clash) { setMsg("That PIN is already taken by someone here. Pick a different one."); setBusy(false); return; }
      const salt = qRandSalt(); const h = await qHashPin(pin, salt);
      const nextIds = await mutateQueueIdentities(store, (cur) => { cur[selected.id] = { h, s: salt, label: selected.label, setAt: qNowIso() }; return cur; });
      setIdentities(nextIds);
      await joinAs(selected);
      return;
    }
    const rec = idents[selected.id];
    if (rec && (await qHashPin(pin, rec.s)) === rec.h) { await joinAs(selected); return; }
    const other = await qFindByPin(idents, pin, null);
    if (other && other !== selected.id) { setSwitchTo({ id: other, label: idents[other].label || "that person" }); setMsg(""); setBusy(false); return; }
    setMsg(`That PIN doesn't match ${selected.label}'s file. Try again, or see a manager to reset it.`);
    setBusy(false);
  }

  function setFlag(status) {
    if (!meId) return;
    // Back in line means the next turn should show the up-take overlay again.
    if (status === "waiting") setTookIt(false);
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      if (p) {
        cur.history = cur.history || [];
        if (status === "waiting") {
          const from = p.awayReason || (p.status !== "waiting" ? p.status : null);
          cur.history.push({ t: qNowIso(), action: "back", from, id: meId, who: p.label, by: "self" });
          p.awayReason = null;
        } else {
          p.awayReason = status;
          cur.history.push({ t: qNowIso(), action: status, id: meId, who: p.label, by: "self" });
        }
        p.status = status; p.statusAt = qNowIso();
      }
      return cur;
    });
  }
  // accidental check-in: reverse the auto-flip (within the store's window)
  function undoCheckin() {
    if (!meId) return;
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      if (p) {
        p.status = "waiting"; p.statusAt = qNowIso(); p.autoFlip = false; p.accidentalUntil = null;
        cur.history = cur.history || [];
        cur.history.push({ t: qNowIso(), action: "accidental-undo", id: meId, who: p.label, by: "self" });
      }
      return cur;
    });
  }
  function leave() {
    if (!meId) return;
    commit((cur) => {
      if (!cur) return null;
      const p = (cur.line || []).find((x) => x.id === meId);
      cur.line = (cur.line || []).filter((x) => x.id !== meId);
      if (p) { cur.history = cur.history || []; cur.history.push({ t: qNowIso(), action: "left", id: meId, who: p.label, by: "self" }); }
      return cur;
    });
    // Through the door the account stays who they are; only the line entry goes.
    remember(account || null);
    setStep("name");
  }

  /* ---- leaving the lot ----
     Somebody who drives off without pressing anything stays in line all
     evening, gets called for a customer who is not theirs, and keeps a card on
     their lock screen. So while they are on the floor the phone keeps an eye on
     the fence, and once it is properly convinced they have left (two clean
     readings a minute apart, the same rule the record uses) it asks: done for
     the day? Yes prints the ticket, whose Good night takes them off; No keeps
     them where they are and stays quiet for half an hour. No fence drawn or no
     fix and nothing is asked. This runs while the app is open or brought back
     to the front; the phone does not run pages in the background. */
  const [lotAsk, setLotAsk] = useState(false);
  const lotState = useRef(null);
  const lotSnooze = useRef(0);
  useEffect(() => {
    if (!me || !storeFence || !Array.isArray(storeFence.ring) || storeFence.ring.length < 3) { lotState.current = null; return undefined; }
    let dead = false;
    const check = async () => {
      if (dead || document.hidden || lotAsk || ticket || Date.now() < lotSnooze.current) return;
      const reading = await readPosition();
      if (dead || !reading) return;
      const next = settle(lotState.current, reading, storeFence, Date.now(), { confirmations: 2, dwellMs: 60 * 1000 });
      lotState.current = next;
      if (next.crossed === "left") { setLotAsk(true); buzz([14, 40, 14]); }
    };
    check();
    const t = setInterval(check, 75 * 1000);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { dead = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [!!me, storeFence, lotAsk, ticket]); // eslint-disable-line
  const lotLater = () => { buzz(8); setLotAsk(false); lotSnooze.current = Date.now() + 30 * 60 * 1000; };
  /* The phone app watches the same fence natively, which works with the app in
     a pocket. It is told the lot as one circle while somebody is on the floor
     and told to stop when they are off. When it notices the exit it either
     asks on the lock screen or, with the app in front, hands the question here. */
  useEffect(() => {
    if (!(typeof window !== "undefined" && window.ReactNativeWebView)) return undefined;
    const ring = storeFence && Array.isArray(storeFence.ring) && storeFence.ring.length >= 3 ? storeFence.ring : null;
    const circle = me && ring ? watchCircle(ring, 60) : null;
    if (circle) nativePost("fence", { on: true, lat: circle.lat, lng: circle.lng, radius: Math.max(150, circle.radius) });
    else nativePost("fence", { on: false });
    return undefined;
  }, [!!me, storeFence]); // eslint-disable-line
  useEffect(() => {
    const on = () => { if (me && !ticket) { setLotAsk(true); buzz([14, 40, 14]); } };
    window.addEventListener("lpc:lot", on);
    return () => window.removeEventListener("lpc:lot", on);
  }, [!!me, ticket]); // eslint-disable-line

  /* ---- the session, handed to the shell ----
     The Live Activity's buttons act through /api/queue-action, which needs the
     session only this page holds. So the page hands the shell its access token,
     where it is going, and the day, and again whenever the token is refreshed.
     The shell keeps it for the intents; nothing else reads it. */
  useEffect(() => {
    if (!(typeof window !== "undefined" && window.ReactNativeWebView) || !supabase) return;
    let dead = false;
    const hand = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (dead || !session) return;
        nativePost("session", { token: session.access_token, exp: session.expires_at || null,
          apiBase: window.location.origin, store, date });
      } catch (e) {}
    };
    hand();
    const { data } = supabase.auth.onAuthStateChange(() => hand());
    const t = setInterval(hand, 20 * 60 * 1000);
    return () => { dead = true; clearInterval(t); try { data && data.subscription && data.subscription.unsubscribe(); } catch (e) {} };
  }, [store, date]);

  /* ---- buttons on the lock screen ----
     The Live Activity's buttons run in the app and hand the page one word; the
     page does the thing with its own session, the same way its own buttons do.
     Lunch, away and back are the floor chips. Take is "I've got it". Pass puts
     you behind the next person, as a manager's decline does. FlyBy and T.O. are
     the two asks with no table named. Ack tells the desk you saw the nudge. */
  useEffect(() => {
    const on = async (e) => {
      const act = String((e && e.detail && e.detail.action) || "");
      if (!meId || !me) return;
      try {
        if (act === "lunch" || act === "away") await setFlag(act);
        else if (act === "back" || act === "done") await setFlag("waiting");
        else if (act === "take") { buzz([20, 40, 20]); setTookIt(true); await setFlag("customer"); }
        else if (act === "pass") {
          const next = await mutateFloorRow(store, date, (cur) => {
            if (!cur) return null;
            const idx = (cur.line || []).findIndex((x) => x.id === meId); if (idx < 0) return cur;
            const p = cur.line[idx];
            cur.history = cur.history || [];
            cur.history.push({ t: qNowIso(), action: "declined", id: meId, who: p.label, by: "self" });
            cur.line.splice(idx, 1);
            cur.line.push({ ...p, movedAt: qNowIso() });
            return cur;
          });
          if (next) setRow(next);
        }
        else if (act === "fly" || act === "to") {
          const ask = { id: uid(), t: qNowIso(), kind: act, byId: meId, byName: meFull || meLabel, table: me.table != null ? me.table : null, spot: "floor", note: null };
          const next = await mutateFloorRow(store, date, (cur) => {
            if (!cur) return null;
            cur.assists = [ask, ...((cur.assists || []).filter((a) => !(a.byId === meId && !a.doneAt)))].slice(0, 40);
            return cur;
          });
          if (next) setRow(next);
        }
        else if (act === "leave") { setLotAsk(false); await leave(); }
        else if (act === "cancel") {
          // Never mind, from the lock screen: the same withdrawal the page's
          // own Never mind writes, so the two cannot disagree.
          const next = await mutateFloorRow(store, date, (cur) => {
            if (!cur) return null;
            const open = (cur.assists || []).find((a) => a && a.byId === meId && !a.doneAt);
            if (!open) return null;
            open.doneAt = qNowIso(); open.cancelled = true;
            cur.history = cur.history || [];
            cur.history.push({ t: qNowIso(), action: "assist-cancelled", id: meId, who: me.label, by: "self" });
            return cur;
          });
          if (next) setRow(next);
        }
        else if (act === "with-guest") {
          /* Answering the desk with a reason. Honoured either way; where the
             row says they are not with a guest the day's record keeps that,
             plainly and without counting it. */
          const next = await mutateFloorRow(store, date, (cur) => {
            if (!cur) return null;
            const p = (cur.line || []).find((x) => x.id === meId); if (!p || !p.nudgedAt) return null;
            p.nudgedAt = null; cur.history = cur.history || [];
            const reallyWith = p.status === "customer";
            cur.history.push({ t: qNowIso(), action: "with-guest", id: meId, who: p.label, by: "self",
              ...(reallyWith ? {} : { unverified: true, wasStatus: p.status || "waiting" }) });
            return cur;
          });
          if (next) setRow(next);
        }
        else if (act === "ack") {
          const next = await mutateFloorRow(store, date, (cur) => {
            if (!cur) return null;
            const p = (cur.line || []).find((x) => x.id === meId); if (!p) return cur;
            p.nudgedAt = null; cur.history = cur.history || [];
            cur.history.push({ t: qNowIso(), action: "on-my-way", id: meId, who: p.label, by: "self" });
            return cur;
          });
          if (next) setRow(next);
        }
      } catch (err) { /* the row poll tells the truth either way */ }
    };
    window.addEventListener("lpc:action", on);
    return () => window.removeEventListener("lpc:action", on);
  }, [meId, me && me.status, me && me.table, store, date]); // eslint-disable-line

  const storeName = (row && row.storeName) || "Live Floor";
  const eff = (shown === "done" && !me) ? (account ? "home" : "name") : shown;
  /* The salesperson shell: pill, palette and moments. On the line, or through
     the door and about to be. */
  const inShell = (eff === "done" && !!me) || eff === "home";
  /* ---- dark or light ----
     Follows the phone unless the person says otherwise in the help sheet. */
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("lpcf:pref:theme") || "auto"; } catch (e) { return "auto"; } });
  const [textSize, setTextSize] = useState(textSizeOf);
  useEffect(() => { applyTextSize(textSize); }, [textSize]);
  const [, prefTick] = useState(0);
  const prefOn = (k) => { try { return localStorage.getItem(k) !== "0"; } catch (e) { return true; } };
  const flipPref = (k) => { try { localStorage.setItem(k, prefOn(k) ? "0" : "1"); } catch (e) {} buzz(8); prefTick((n) => n + 1); };
  const [sysLight, setSysLight] = useState(() => { try { return window.matchMedia("(prefers-color-scheme: light)").matches; } catch (e) { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(prefers-color-scheme: light)"); } catch (e) { return; }
    const on = (e) => setSysLight(e.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  const lightMode = theme === "light" || (theme === "auto" && sysLight);
  /* Remembered for the next cold start, so index.html can paint this ground
     before any of this has run. Without it the first paint is the browser's
     white and the dark shell arrives over the top of it, which is the flash. */
  useEffect(() => {
    try { localStorage.setItem("lpcf:ground", lightMode ? "light" : "dark"); } catch (e) {}
  }, [lightMode]);

  /* One spine for every screen on the way in: the queue as it stands right now,
     which is the thing the person is actually here to find out. */
  const pageRef = useRef(null);
  useKeyboardInset(pageRef);

  const spinePos = meId ? line.findIndex((p) => p.id === meId) + 1 : 0;
  const queueSpine = (
    <SfSpine mode="queue" count={Math.max(line.length, 1)} pos={spinePos}
      cap={line.length ? `${line.length} ${variant.count}` : "nobody yet"} />
  );

  let content;

  if (eff === "loading") {
    content = (
      <SfScreen spine={queueSpine} className="sf-v-wait">
        <div className="sf-loading" aria-label="Loading" />
      </SfScreen>
    );
  } else if (eff === "invalid") {
    content = (
      <SfScreen spine={queueSpine} className="sf-v-stale">
        <SfMark variant={variant} />
        <SfDisplay small a="This code" b="isn't for today" />
        <p className="sf-sub">Ask a manager to show today&rsquo;s code, and scan it again.</p>
      </SfScreen>
    );
  } else if (eff === "known" && accountPerson) {
    /* Scanned, and the phone already knows who is holding it. One tap. */
    const who = String(accountPerson.name || accountPerson.label || "").split(/\s+/)[0];
    content = (
      <SfScreen spine={queueSpine} className="sf-v-name">
        <SfMark variant={variant} />
        <SfDisplay small a="Morning," b={who} />
        <p className="sf-sub">
          {line.length ? `${line.length} ${variant.count} already on.` : "Nobody on yet. You would be first."}
        </p>
        {doorNote && !doorNote.allow && (
          <div className="sf-door sf-door-no">
            <b>Not on the lot yet</b>
            <span>{doorNote.note}</span>
          </div>
        )}
        <button className="sf-go" disabled={busy} onClick={() => { buzz(10); joinAs(accountPerson); }}>
          {busy ? "Checking\u2026" : "Get me on"}
        </button>
        {/* Somebody else's phone, or a link made against the wrong name. Rare, and
            impossible to recover from without a way back to the list. */}
        <button type="button" className="sf-link" onClick={() => { setKnownAs(null); setStep("name"); }}>
          Not {who}?
        </button>
      </SfScreen>
    );
  } else if (eff === "home") {
    /* Through the account door, not on the line yet. The corner needs no line;
       the floor tab is the way on, with the line drawn so they can see what they
       are joining, and a plain word when the desk has not opened the day. */
    const who = String(meFull || meLabel || "").split(/\s+/)[0];
    const open = !!row;
    const onCount = line.filter((p) => p.status === "waiting").length;
    content = (
      <div className="sf-live mcf sf-off mcf-home">
        <div className="mcf-top">
          <div className="mcf-cap">{open ? (onCount ? `${onCount} ON THE FLOOR` : "NOBODY ON YET") : "FLOOR NOT OPEN"}</div>
          {open && <McTrack line={line} meId={null} roster={(row && row.roster) || []} />}
          <div className="mcf-title">{open ? (who ? `Morning, ${who}` : "Morning") : "The floor isn't open yet"}</div>
          <div className="mcf-sub">{open
            ? (onCount ? "Get on and take your place in the line." : "You would be first.")
            : "The desk opens Live Floor to start the day. Your corner is ready meanwhile."}</div>
          {doorNote && !doorNote.allow && (
            <div className="sf-door sf-door-no">
              <b>Not on the lot yet</b>
              <span>{doorNote.note}</span>
            </div>
          )}
          {open && accountPerson && (
            <button className="sf-go mcf-go" disabled={busy} onClick={() => { buzz(10); joinAs({ id: accountPerson.id, label: accountPerson.label || shortLabel(accountPerson.name || "") }); }}>
              {busy ? "Checking\u2026" : "Get me on"}
            </button>
          )}
          {open && !accountPerson && (
            <div className="mcf-sub">Your name is not on today's roster. Ask the desk.</div>
          )}
        </div>
      </div>
    );
    if (tab === "corner") {
      content = (
        <MyCorner store={store} date={date} me={null} meId={meId} meFull={meFull} meLabel={meLabel}
          mine={mine} mineAt={mineAt} std={std} cfg={cfg} monthStats={monthStats} boardThr={boardThr}
          goals={boardExtra.goals} off={boardExtra.off} days={days}
          offToday={offToday} offState={offState} activityNow={activityNow} onOffAnswer={answerOff}
          onHelp={() => { buzz(8); setHelpOpen(true); }}
          line={line} myPos={0} availableAhead={0} joinable={open && !!accountPerson} toFloor={() => setTab("floor")}
          upsToday={((row && row.history) || []).filter((e) => e && e.id === meId && e.action === "assigned").length} roster={roster} />
      );
    }
  } else if (eff === "done" && me) {
    const myPos = line.findIndex((p) => p.id === meId) + 1;
    const availableAhead = line.slice(0, myPos - 1).filter((p) => p.status === "waiting").length;
    const isNext = me.status === "waiting" && availableAhead === 0;
    /* Said once, quietly, and never again. They are on the floor either way; this
       only explains why nothing was checked, so nobody thinks the fence is
       watching them when it is not. */
    const doorAside = doorNote && doorNote.allow && doorNote.why !== "inside" ? doorNote.note : null;
    const canUndo = me.status === "customer" && me.autoFlip && me.accidentalUntil && new Date(me.accidentalUntil) > new Date();
    const st = me.status;
    const title = st === "customer" ? "With a customer" : st === "lunch" ? "At lunch" : st === "away" ? "Out of the line" : isNext ? "You're up" : "You're on the floor";
    const sub = st === "customer" ? <>Holding your spot at <strong>#{myPos}</strong>{me.appt ? " for your appointment" : ""}. Tap below when they leave.</>
      : st === "away" ? "Still on the floor for the day, just not taking a turn. Tap Here when you want back in."
      : st === "lunch" ? "You'll be passed until you tap back in."
      : isNext ? "Head to the door. The next one is yours." : `${availableAhead} available ahead of you`;
    /* The desk asked for them. Loud while it is fresh, then it stops shouting:
       a banner that never goes away is a banner nobody reads. */
    const nudgedMins = me.nudgedAt ? qMinsSince(me.nudgedAt) : null;
    const nudgeOn = nudgedMins != null && nudgedMins < 10;
    content = (
      <div className={"sf-live mcf" + (st !== "waiting" ? " sf-off" : "")}>
        {nudgeOn && (
          <div className="sf-nudge"><PixIcon glyph="nudge" size={13} /> The desk is asking for you on the floor</div>
        )}
        {/* The floor's own picture of the line: the count of available people
            ahead in the dot matrix, the track drawn from the screen's edge to
            the door, and the two clocks the floor is actually run on. Standing
            down, the track steps aside for the status and its clock.

            A round dial was tried here and taken out again. It carried one
            duration and a position, and the floor is not run on either of
            those: it is run on who is between you and the door. The controls
            below it are the new ones and they stayed. */}
        {st === "waiting" ? (
          <div className="mcf-top">
            <span className="mcf-count"><LedNumber value={availableAhead} color="#E9CE96" cell={10} gap={4} dim="transparent" /></span>
            <div className="mcf-cap">TO THE DOOR</div>
            <McTrack line={line} meId={meId} roster={(row && row.roster) || []} />
            <McTimers sinceOn={me.joinedAt} sinceMove={me.movedAt || me.statusAt || me.joinedAt} />
            <div className="mcf-title">{title}</div>
          </div>
        ) : (
          <div className="mcf-top">
            <span className="mcf-sticon"><SfIcon name={st} size={64} /></span>
            <McTimers sinceOn={me.joinedAt} sinceMove={me.statusAt || me.joinedAt} />
            <div className="mcf-title">{title}</div>
            <div className="mcf-sub">{sub}</div>
          </div>
        )}
        <div className="sf-actions">
          {canUndo && <button className="sf-leave" onClick={() => { buzz(12); undoCheckin(); }} style={{ color: "var(--led)" }}>That is not my customer. Put me back in line.</button>}
          {st === "customer" && (
            <button type="button" className="sf-go mcf-go mcf-left" onClick={() => { buzz([14, 40, 14]); setFlag("waiting"); }}>
              <PixIcon glyph="check" size={16} /><span>Customer left, put me back in line</span>
            </button>
          )}
          {/* The segmented control the phone line uses. It was written to serve
              this screen too — its own comment says the floor's track is three
              wide rather than four — and was simply never wired in here. */}
          <SfStatusSelect value={st} variant={FLOOR_SEG} flags={FLOOR_SELF_FLAGS}
            onPick={setFlag} />
          <SeatBlock store={store} meId={meId} plan={floorPlanOf(cfg, store)} row={row} commit={commit} />
          <AssistBlock meId={meId} meName={meFull || meLabel}
            fence={storeFence} plan={floorPlanOf(cfg, store)} row={row} commit={commit} />
          <div className="sf-links">
            {/* The corner is the main page and already carries the day, so this
                goes back there rather than opening a second copy of it. */}
            <button type="button" className="sf-link" onClick={() => { buzz(10); setTab("corner"); }}>
              <SfIcon name="mine" size={14} /><span>Home</span>
            </button>
            <button type="button" className="sf-link sf-link-quiet" onClick={() => { buzz(10); startTicket(); }}>
              <SfIcon name="door" size={14} /><span>Leave the floor</span>
            </button>
          </div>
        </div>
        <MyStationDay row={row} meId={meId} store={store} date={date} />
        {isNext && !tookIt && (
          <div className="sf-uptake">
            {/* The ring is wrapped around the number rather than dropped into
                the column: an absolutely positioned child of a centred flex
                column takes its static position from the column, which put the
                splash behind the words instead of coming off the figure it is
                supposed to be coming off. */}
            <div className="sf-upnum">
              <span className="sf-shock" />
              <span className="sf-shock d2" />
              <DmNumber value={1} up />
            </div>
            <h2>You're up</h2>
            <p>Head to the door. The next one is yours.</p>
            <button className="sf-go" onClick={() => { buzz([20, 40, 20]); setTookIt(true); setFlag("customer"); }}>I've got it</button>
          </div>
        )}
        {doorAside && <p className="sf-door-aside">{doorAside}</p>}
      </div>
    );
    if (tab === "corner" && !(isNext && !tookIt)) {
      content = (
        <MyCorner store={store} date={date} me={me} meId={meId} meFull={meFull} meLabel={meLabel}
          mine={mine} mineAt={mineAt} std={std} cfg={cfg} monthStats={monthStats} boardThr={boardThr}
          goals={boardExtra.goals} off={boardExtra.off} days={days}
          offToday={offToday} offState={offState} activityNow={activityNow} onOffAnswer={answerOff}
          onHelp={() => { buzz(8); setHelpOpen(true); }}
          line={line} myPos={myPos} availableAhead={availableAhead} toFloor={() => setTab("floor")}
          upsToday={((row && row.history) || []).filter((e) => e && e.id === meId && e.action === "assigned").length} roster={roster} />
      );
    }
  } else if (eff === "switch" && selected && switchTo) {
    content = (
      <SfAsk variant={variant} spine={queueSpine}
        lead={`That PIN is on ${switchTo.label}'s file`}
        question={["Are you", switchTo.label + "?"]}
        note={`You picked ${selected.label}.`}
        busy={busy}
        yes={() => joinAs({ id: switchTo.id, label: switchTo.label })}
        no={() => { setSwitchTo(null); setPin(""); setMsg("No problem. Enter your own PIN."); }}
        noLabel="No, try again" />
    );
  } else if (eff === "pin" && selected) {
    content = (
      <SfPin variant={variant} spine={queueSpine} who={selected.label}
        pinMode={pinMode} pin={pin} setPin={setPin} pin2={pin2} setPin2={setPin2}
        submitPin={submitPin} msg={msg} busy={busy}
        onNotMe={() => { setStep("name"); setSelected(null); setPin(""); setPin2(""); setMsg(""); }} />
    );
  } else if (eff === "pick" && resolved && resolved.people) {
    content = (
      <SfPickList variant={variant} spine={queueSpine} typed={typed}
        people={resolved.people} countLabel={variant.count}
        taken={(id) => line.some((x) => x.id === id)}
        onPick={pickPerson}
        onBack={() => { setStep("name"); setMsg(""); }} />
    );
  } else if (eff === "confirm" && resolved && resolved.person) {
    content = (
      <SfAsk variant={variant} spine={queueSpine} lead="Did you mean"
        question={[resolved.person.label, resolved.person.role || "\u00a0"]}
        busy={busy}
        yes={() => pickPerson(resolved.person)}
        no={() => { setStep("name"); setMsg(""); }} />
    );
  } else {
    content = (
      <SfName variant={variant} spine={queueSpine} storeName={storeName}
        typed={typed} setTyped={setTyped} submit={submitName} msg={msg}
        suggestions={resolved && resolved.kind === "none" ? resolved.suggestions : null}
        onPick={pickPerson} />
    );
  }

  return (
    <div className={"q-page f-page sf sf-floor" + (inShell ? " mc-shell" : "") + (inShell && tab !== "corner" ? " mc-floor" : "") + (inShell && tab === "corner" && lightMode ? " mc-light" : "")} ref={pageRef}>
      <div className={"q-stage" + (eff === "pin" ? " q-stage-pin" : "")} key={eff + (eff === "done" && me ? ":" + me.status : "")}>{content}</div>
      {inShell && !onTab && (() => {
        const idx = line.findIndex((p2) => p2.id === meId);
        const upRoot = !!me && me.status === "waiting" && idx >= 0 && line.slice(0, idx).filter((p2) => p2.status === "waiting").length === 0;
        return (
          <div className="mc-pill" role="tablist">
            <span className="mc-ind" style={{ transform: tab === "corner" ? "translateX(0)" : "translateX(100%)" }} />
            <button type="button" role="tab" aria-selected={tab === "corner"} className={"mc-tab" + (tab === "corner" ? " on" : "")}
              onClick={() => { buzz(8); setTab("corner"); }} aria-label="Home"><PixIcon glyph="home" size={21} /></button>
            <button type="button" role="tab" aria-selected={tab !== "corner"} className={"mc-tab" + (tab !== "corner" ? " on" : "") + (upRoot ? " alert" : "")}
              onClick={() => { buzz(8); setTab("floor"); }} aria-label="The floor"><PixIcon glyph="door" size={21} /></button>
          </div>
        );
      })()}
      {eff === "done" && me && lotAsk && !ticket && (
        <div className="mc-lotov" onClick={(e) => { if (e.target === e.currentTarget) lotLater(); }}>
          <div className="mc-lot" role="dialog" aria-label="Leaving the lot">
            <PixIcon glyph="door" size={26} />
            <div className="mc-lot-h">Looks like you've left the lot</div>
            <p className="mc-lot-p">Done for the day? Your ticket prints and the desk takes you off the floor. If you only stepped out, you stay {me.status === "away" ? "on the floor" : "in line"}.</p>
            <button type="button" className="sf-go mcf-go mc-lot-go" onClick={() => { buzz([20, 40, 20]); setLotAsk(false); startTicket(); }}>Yes, I'm done for the day</button>
            <button type="button" className="mc-lot-no" onClick={lotLater}>No, I'm coming back</button>
          </div>
        </div>
      )}
      {lateTicket && (
        <div className="mc-tkov" onClick={(e) => { if (e.target === e.currentTarget) setLateTicket(null); }}>
          <div className="mc-tkwrap">
          <div className="mc-slot" />
          <div className="mc-tkt">
            <div className="mc-tk-h">{(row && row.storeName) || "Live Floor"} &middot; DAY CLOSED {mcClock(lateTicket)}</div>
            <div className="mc-tk-n">{(meFull || meLabel || "").toUpperCase()}</div>
            <div className="mc-tk-big">
              <span className="mc-tk-dm"><LedNumber value={myUnits != null ? myUnits : 0} color="#2A2418" cell={7} gap={3} dim="transparent" /></span>
              <span className="mc-tk-r">{myGoal != null && <>GOAL {myGoal}<br /></>}TODAY {mine && mine.units ? mine.units : 0}</span>
            </div>
            {[["CALLS", `${(mine && mine.calls) || 0} / ${std.minCalls || 0}`, (mine && mine.calls || 0) >= (std.minCalls || 0)],
              ["VIDEOS", `${(mine && mine.video) || 0} / ${std.minVideos || 0}`, (mine && mine.video || 0) >= (std.minVideos || 0)],
              ["TASKS", mine && mine.tasksPosted ? `${mine.tasks || 0} / ${mine.tasksPosted}` : String((mine && mine.tasks) || 0), mine && mine.tasksPosted ? (mine.tasks || 0) >= mine.tasksPosted : true],
              ["ROCKED", mine && mine.rocked === true ? "YES" : mine && mine.rocked === false ? "NO" : "\u00b7", mine && mine.rocked === true]].map(([l, v, ok]) => (
              <div className="mc-tk-row" key={l}><span>{l}</span><i /><span className={ok ? "ok" : ""}>{v}</span></div>
            ))}
            <div className="mc-tk-foot">
              <span className="mc-stamp">{daysClean > 0 ? `${daysClean} DAY${daysClean === 1 ? "" : "S"} CLEAN` : `${pointsForDay(mine || {}, std).points} PTS TODAY`}</span>
              <span className="mc-tk-note">ROCKED,<br />THEN HOME</span>
            </div>
            <div className="mc-bcode" />
            <button type="button" className="mc-tk-go" onClick={() => { buzz(10); setLateTicket(null); }}>Good night</button>
          </div>
          </div>
          <div className="mc-send done">YOUR DAY WENT ON THE TRACKER <PixIcon glyph="check" size={10} /></div>
        </div>
      )}
      {eff === "done" && me && ticket && (
        <div className="mc-tkov" onClick={(e) => { if (e.target === e.currentTarget && ticket !== "sending") setTicket(null); }}>
          <div className="mc-tkwrap">
          <div className="mc-slot" />
          <div className="mc-tkt">
            <div className="mc-tk-h">{(row && row.storeName) || "Live Floor"} &middot; DAY CLOSED {mcClock(new Date().toISOString())}</div>
            <div className="mc-tk-n">{(meFull || meLabel || "").toUpperCase()}</div>
            <div className="mc-tk-big">
              <span className="mc-tk-dm"><LedNumber value={myUnits != null ? myUnits : 0} color="#2A2418" cell={7} gap={3} dim="transparent" /></span>
              <span className="mc-tk-r">{myGoal != null && <>GOAL {myGoal}<br /></>}TODAY {mine && mine.units ? mine.units : 0}</span>
            </div>
            {[["CALLS", `${(mine && mine.calls) || 0} / ${std.minCalls || 0}`, (mine && mine.calls || 0) >= (std.minCalls || 0)],
              ["VIDEOS", `${(mine && mine.video) || 0} / ${std.minVideos || 0}`, (mine && mine.video || 0) >= (std.minVideos || 0)],
              ["TASKS", mine && mine.tasksPosted ? `${mine.tasks || 0} / ${mine.tasksPosted}` : String((mine && mine.tasks) || 0), mine && mine.tasksPosted ? (mine.tasks || 0) >= mine.tasksPosted : true],
              ["ROCKED", mine && mine.rocked === true ? "YES" : mine && mine.rocked === false ? "NO" : "\u00b7", mine && mine.rocked === true]].map(([l, v, ok]) => (
              <div className="mc-tk-row" key={l}><span>{l}</span><i /><span className={ok ? "ok" : ""}>{v}</span></div>
            ))}
            <div className="mc-tk-foot">
              <span className="mc-stamp">{daysClean > 0 ? `${daysClean} DAY${daysClean === 1 ? "" : "S"} CLEAN` : `${pointsForDay(mine || {}, std).points} PTS TODAY`}</span>
              <span className="mc-tk-note">ROCKED,<br />THEN HOME</span>
            </div>
            <div className="mc-bcode" />
            <button type="button" className="mc-tk-go" disabled={ticket !== "sent" && ticket !== "failed"}
              onClick={() => { buzz([20, 40, 20]); setTicket(null); leave(); }}>Good night</button>
          </div>
          </div>
          <div className={"mc-send" + (ticket === "sent" ? " done" : ticket === "failed" ? " fail" : "")}>
            {ticket === "sent" ? <>ON THE DAILY TRACKER <PixIcon glyph="check" size={10} /></>
              : ticket === "failed" ? "THE DESK DID NOT ANSWER. TRY AGAIN IN A MOMENT."
              : ticket === "printing" ? <><s /><s /><s />PRINTING</>
              : <><s /><s /><s />SENDING TO THE DESK</>}
          </div>
        </div>
      )}
      {inShell && mile != null && (
        <div className="mc-flash">
          <span className="bloom" />
          {[0, 1, 2, 3, 4, 5, 6].map((i2) => <span key={i2} className="burst" style={{ "--dx": Math.round(Math.cos(i2 * 0.9) * (110 + (i2 % 3) * 30)) + "px", "--dy": Math.round(Math.sin(i2 * 0.9) * (110 + (i2 % 3) * 30)) + "px", animationDelay: (i2 * 0.03) + "s" }}><PixIcon glyph="car" size={i2 % 2 ? 16 : 11} /></span>)}
          <span className="drv"><PixIcon glyph="car" size={14} /></span>
          <span className="mc-flash-dm"><LedNumber value={mile} color="#E9CE96" cell={9} gap={4} dim="transparent" /></span>
          <div className="mc-flash-t">{mile === myGoal ? "Goal made." : `Unit ${mile}.`}</div>
          <div className="mc-flash-s">{mile === myGoal ? "The month is yours with days to spare." : `${Math.max(0, new Date(parseInt(date.slice(0, 4)), parseInt(date.slice(5, 7)), 0).getDate() - parseInt(date.slice(8, 10)))} days left in the month.`}</div>
          <button type="button" className="mc-flash-b" onClick={() => { buzz(8); setMile(null); }}>Back to work</button>
        </div>
      )}
      {appOpen && (
        <Overlay><div className="mc-ov" onClick={(e) => { if (e.target === e.currentTarget) setAppOpen(false); }}>
          <div className="mc-sheet">
            <div className="mc-sheet-head"><b>The Sage app</b>
              <button type="button" className="mc-x" onClick={() => setAppOpen(false)} aria-label="Close"><PixIcon glyph="close" size={14} /></button></div>
            <p className="mc-steps-p">The Sage app is on its way to the App Store and Google Play. It is the way to carry your corner and the line, with a buzz when you are up. Until it lands, this page in your browser is the same screen.</p>
          </div>
        </div></Overlay>
      )}
      {/* The person's own sheet, in the corner's clothes: their card as the
          hero, then this phone, then reach, then the day. It was a list of
          hairlines that read as a different app from the cards above it. */}
      {inShell && helpOpen && (
        <Overlay><div className="mc-ov" onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="mc-sheet mc-you">
            <div className="mc-sheet-head"><b>You</b>
              <button type="button" className="mc-x" onClick={() => setHelpOpen(false)} aria-label="Close"><PixIcon glyph="close" size={14} /></button></div>
            <div className="mc-you-hero">
              <span className="mc-set-av" style={{ background: `hsl(${(String(meFull || meLabel).split("").reduce((h2, c2) => (h2 * 31 + c2.charCodeAt(0)) % 360, 0))} 62% 46%)` }}>{String(meLabel || meFull).trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</span>
              <span className="mc-you-who"><b>{meFull || meLabel}</b><span className="hint">{(row && row.storeName) || ""}{myGoal != null ? ` \u00b7 goal ${myGoal}` : ""}</span></span>
              <span className="mc-you-live">{account ? "LINKED" : "QR"}</span>
            </div>

            <div className="mc-cap">THIS PHONE</div>
            <div className="mc-card mc-you-card">
              <div className="mc-set-row">
                <span className="ic"><PixIcon glyph="search" size={16} /></span>
                <span>Text size<span className="hint">Every screen here, and the buttons with it</span></span>
                <span className="mc-seg3 txt" role="radiogroup" aria-label="Text size">
                  {TEXT_SIZES.map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={textSize === k} aria-label={l} className={textSize === k ? "on" : ""}
                      onClick={() => { try { localStorage.setItem("lpcf:pref:text", k); } catch (e) {} setTextSize(k); buzz(8); }}>A</button>
                  ))}
                </span>
              </div>
              <div className="mc-set-row stack">
                <span className="ic"><PixIcon glyph="star" size={16} /></span>
                <span>Look<span className="hint">{theme === "auto" ? "Follows the phone" : theme === "dark" ? "Dark, always" : "Light, always"}</span></span>
                <span className="mc-seg3 wide" role="radiogroup" aria-label="Look">
                  {[["auto", "AUTO"], ["dark", "DARK"], ["light", "LIGHT"]].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={theme === k} className={theme === k ? "on" : ""}
                      onClick={() => { try { localStorage.setItem("lpcf:pref:theme", k); } catch (e) {} setTheme(k); buzz(8); }}>{l}</button>
                  ))}
                </span>
              </div>
              {(() => {
                const rooms = roomListOf(cfg, store);
                const choices = OPEN_TO.filter(([k]) => k === "last" || (k === "line" ? rooms.includes("line") : rooms.includes("floor")));
                if (choices.length < 3) return null;
                const cur = openToOf(store);
                return (
                  <div className="mc-set-row stack">
                    <span className="ic"><PixIcon glyph="door" size={16} /></span>
                    <span>Opens to<span className="hint">{cur === "last" ? "The room you were in last" : cur === "home" ? "Home, every time" : cur === "floor" ? "The Live Floor, every time" : "The Phone Line, every time"}</span></span>
                    <span className="mc-seg3 wide" role="radiogroup" aria-label="Opens to">
                      {choices.map(([k, l]) => (
                        <button key={k} type="button" role="radio" aria-checked={cur === k} className={cur === k ? "on" : ""}
                          onClick={() => { try { localStorage.setItem(`lpcf:pref:open:${store}`, k); } catch (e) {} buzz(8); prefTick((n) => n + 1); }}>{l}</button>
                      ))}
                    </span>
                  </div>
                );
              })()}
              {[["lpcf:pref:buzz", "tap", "Haptics", "A buzz on every tap"],
                ["lpcf:pref:notif", "bolt", "Notifications", "Your turn, and the Live Activity"],
                ["lpcf:pref:streak", "flame", "Streak warnings", "When a day is about to break the run"],
                ["lpcf:pref:mile", "trophy", "Milestone moments", "The little celebrations"]].map(([k, g, l, h]) => (
                <button type="button" className="mc-set-row" key={k} role="switch" aria-checked={prefOn(k)} onClick={() => flipPref(k)}>
                  <span className="ic"><PixIcon glyph={g} size={16} /></span>
                  <span>{l}<span className="hint">{h}</span></span>
                  <span className={"mc-sw" + (prefOn(k) ? " on" : "")} aria-hidden="true" />
                </button>
              ))}
            </div>

            <div className="mc-cap">REACH</div>
            <div className="mc-card mc-you-card">
              <button type="button" className="mc-set-row" onClick={() => { setHelpOpen(false); setHelpPanel(true); }}>
                <span className="ic"><PixIcon glyph="doc" size={16} /></span>
                <span>Something looks wrong<span className="hint">Send a number or a ticket back with a note</span></span><span className="on"><PixIcon glyph="arrow" size={11} /></span></button>
              <button type="button" className="mc-set-row" onClick={() => { setHelpOpen(false); setHelpPanel(true); }}>
                <span className="ic"><PixIcon glyph="user" size={16} /></span>
                <span>Message {((cfg && cfg.support && cfg.support.name) || "the top").split(" ")[0]}<span className="hint">Straight to the top, not the desk</span></span><span className="on"><PixIcon glyph="arrow" size={11} /></span></button>
              {!inNative && (
                <button type="button" className="mc-set-row" onClick={() => { setHelpOpen(false); if (appLink) window.open(appLink, "_blank", "noopener"); else setAppOpen(true); }}>
                  <span className="ic"><PixIcon glyph="phone" size={16} /></span>
                  <span>Get the Sage app<span className="hint">{appLink ? (isIOS ? "On the App Store" : "On Google Play") : "Coming to your phone"}</span></span><span className="on"><PixIcon glyph="arrow" size={11} /></span></button>
              )}
              <div className="mc-set-row">
                <span className="ic"><PixIcon glyph="home" size={16} /></span>
                <span>{account ? "Your account" : "The second door"}<span className="hint">{account ? "Linked to your name on this floor. The daily QR still works too." : "The daily QR still signs you in"}</span></span><span className="on">LIVE</span></div>
            </div>

            <div className="mc-cap">THE DAY</div>
            <div className="mc-card mc-you-card">
              {me && <button type="button" className="mc-set-row mc-set-out" onClick={() => { setHelpOpen(false); startTicket(); }}>
                <span className="ic"><PixIcon glyph="door" size={16} /></span>
                <span>Leave the floor<span className="hint">Done for the day</span></span><span className="on"><PixIcon glyph="arrow" size={11} /></span></button>}
              {onSignOut && <button type="button" className="mc-set-row" onClick={() => { setHelpOpen(false); onSignOut(); }}>
                <span className="ic"><PixIcon glyph="swap" size={16} /></span>
                <span>Sign out<span className="hint">Somebody else's phone, or the wrong name</span></span><span className="on"><PixIcon glyph="arrow" size={11} /></span></button>}
            </div>
          </div>
        </div></Overlay>
      )}
      {helpPanel && <HelpPanel config={cfg} who={meLabel || meFull} store={store} context={`My Corner, ${store}, ${date}`} dark
        figures={mine ? [{ label: "Calls today", value: mine.calls }, { label: "Videos today", value: mine.video }, { label: "Tasks today", value: mine.tasks }, { label: "Units this month", value: myUnits }] : []}
        onClose={() => setHelpPanel(false)} />}
      <SageCurtain wiping={wiping} hold={held} />
      {/* Everyone gets a way out of a problem, including the people with no account. */}
      <HelpButton config={cfg} who={meLabel} store={store} context={`Live Floor sign-in, ${store}, ${date}`} dark />
      {myDay && (
        <MyDay store={store} date={date} meId={meId} meName={meFull || meLabel} stats={mine} std={std} variant={variant}
          config={cfg} updatedAt={mineAt} monthStats={monthStats} thresholds={boardThr}
          list={(row && row.checklist) || null} onClose={() => setMyDay(false)} light={lightMode} />
      )}
    </div>
  );
}

/* =========================================================================
   FloorBoard — the manager board. Runs the event engine while it's open.
   ========================================================================= */
/* =========================================================================
   The room on a phone.

   The manager's Live Floor on a phone is one screen: the drawn plan, the line
   under it as the same rail the salesperson sees while waiting, and the day's
   coverage. Everything else is a pop in the centre of the screen: a person,
   a table, an ask, the whole line, the schedule, the record, the sign-in
   code, the ups, the roster. Nothing scrolls off under a thumb.

   Desktop keeps the console and the lists. This is only ever rendered when the
   viewport is a phone's.
   ========================================================================= */
function usePhoneLayout() {
  const q = "(max-width: 700px)";
  const [on, setOn] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    if (m.addEventListener) m.addEventListener("change", f); else m.addListener(f);
    return () => { if (m.removeEventListener) m.removeEventListener("change", f); else m.removeListener(f); };
  }, []);
  return on;
}









/* The pop: the one card that answers a tap, in the centre, over a dimmed room. */
/* Where the last tap landed, so a pop can grow out from under the thumb
   rather than rise from the bottom of the screen. Read once, when the pop
   mounts; a pop opened by a key or a timer grows from its own centre. */
const frLastTap = { x: null, y: null, at: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => { frLastTap.x = e.clientX; frLastTap.y = e.clientY; frLastTap.at = Date.now(); }, { capture: true, passive: true });
}

/* The press. Every control gives under the finger the moment it is touched
   and springs back when it is let go: down in one frame, up on a short
   spring. Done here once, for every button, rather than in each control's
   CSS: a control's own transition list would otherwise have to name it, and
   animating the `scale` property composes with whatever transform placed
   the control. Small round things give more than wide bars, the way they do
   on the phone itself. A fingertip also gets its tick here, at touch-down,
   where the press is felt; the click-time buzzes that said the same thing
   stand down when a tick has just gone (see buzz). The tick waits a few
   frames and a finger that has moved by then is scrolling, not pressing, so
   it gets no tick and the press lets go. Reduced motion keeps the tick and
   skips the scale. */
const PRESS_SEL = 'button, [role="button"], a.btn';
let pressed = null;
function pressDown(e) {
  if (e.button != null && e.button !== 0) return;
  const el = e.target && e.target.closest ? e.target.closest(PRESS_SEL) : null;
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true" || !el.animate) return;
  if (el.closest('[draggable="true"], [data-nopress]')) return;
  if (pressed) pressUp();
  let reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (x) {}
  const w = el.offsetWidth || 0;
  const s = w < 60 ? "0.9" : w < 200 ? "0.96" : "0.975";
  let anim = null;
  if (!reduce) { try { anim = el.animate([{ scale: "1" }, { scale: s }], { duration: 70, easing: "ease-out", fill: "forwards" }); } catch (x) {} }
  const tick = e.pointerType === "touch" ? setTimeout(() => { if (pressed && pressed.el === el) buzz(6, true); }, 50) : null;
  pressed = { el, anim, s, tick, x: e.clientX, y: e.clientY };
}
function pressMove(e) {
  if (!pressed || pressed.x == null) return;
  if (Math.abs(e.clientX - pressed.x) > 8 || Math.abs(e.clientY - pressed.y) > 8) pressUp();
}
function pressUp() {
  if (!pressed) return;
  const { el, anim, s, tick } = pressed; pressed = null;
  if (tick) clearTimeout(tick);
  if (!anim) return;
  try { anim.cancel(); } catch (x) {}
  try { el.animate([{ scale: s }, { scale: "1.015", offset: 0.55 }, { scale: "1" }], { duration: 240, easing: "ease-out" }); } catch (x) {}
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", pressDown, { capture: true, passive: true });
  window.addEventListener("pointermove", pressMove, { capture: true, passive: true });
  window.addEventListener("pointerup", pressUp, { capture: true, passive: true });
  window.addEventListener("pointercancel", pressUp, { capture: true, passive: true });
}











   














/* Load pdf.js from a CDN the first time a PDF schedule is opened. Like the xlsx loader,
   this keeps the Vite build free of the dependency. */
let _pdfjsPromise = null;

function loadPdfJs() {
  /* Bundled, not fetched. This used to come from cdnjs at the moment a manager
     dropped a PDF in -- the same shape of dependency that once took out the QR
     library: a dealership that blocks the CDN, or a bad connection, and the
     import path just dies. The pipeline already ships pdfjs-dist as a real
     dependency; the app now ships the same build, split into its own chunk that
     only loads when a PDF actually arrives. */
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist/build/pdf"),
      import("pdfjs-dist/build/pdf.worker.min.js?url"),
    ]);
    const lib = pdfjs.default || pdfjs;
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })().catch((e) => { _pdfjsPromise = null; throw e; });
  return _pdfjsPromise;
}

































               











   

































// Working days gone by in this month, on the calendar. Sundays excluded.
// Pacing has to use this, not the number of reports imported: if you have only
// uploaded twice, elapsed is not 2, it is however many working days have actually
// passed. That mistake is what produced "24 days left" halfway through the month.
// Working days in a given month (Sundays excluded). For the month in progress this
// counts only the days gone by, so a per-day average is not diluted by days that
// have not happened yet.
function workingDaysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const t = today();
  const cap = (monthKey === t.slice(0, 7)) ? Number(t.slice(8, 10)) : lastDay;
  let n = 0;
  for (let d = 1; d <= cap; d++) if (new Date(y, m - 1, d).getDay() !== 0) n++;
  return n;
}

































/* ---- a wait worth showing, shown properly ----
   A loading screen that appears for 80ms and vanishes is a flicker, not
   information: the eye catches a flash of something and cannot read it, which is
   worse than a beat of nothing. Two rules, and they are opposites on purpose:

     do not show it at all until the wait has lasted long enough to be a wait
     once shown, keep it long enough to be read

   So a fast load shows nothing and a slow one shows a steady screen. Nothing in
   between flickers.

   The delay is deliberately long — most of a second. Jorge's rule for waiting is
   that motion is better than a screen: if something is taking a moment, slow the
   move down and let it settle rather than dropping a loading panel over it. So
   this is the last resort, for a wait long enough that showing nothing at all
   would look broken, and every ordinary wait finishes underneath it unseen. */
function useHeld(active, { delay = 500, hold = 280 } = {}) {
  const [on, setOn] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    let t = null;
    if (active) {
      if (on) return undefined;
      t = setTimeout(() => { shownAt.current = Date.now(); setOn(true); }, delay);
    } else if (on) {
      const left = Math.max(0, hold - (Date.now() - shownAt.current));
      t = setTimeout(() => setOn(false), left);
    }
    return () => clearTimeout(t);
  }, [active, on, delay, hold]);
  return on;
}




/* One curtain for the salesperson's phone: the app's own green, the Sage mark
   in the middle. It sits over the page while the line loads and slides away
   once the page is there, and it is the same curtain that sweeps between
   screens, so opening the app is one motion rather than three loaders. */
function SageCurtain({ wiping = false, hold = false }) {
  const cls = "q-curtain sage-curtain" + (hold ? " q-hold" : wiping === "out" ? " q-out" : wiping ? " q-wipe" : "");
  return (
    <div className={cls} aria-hidden="true">
      <span className="q-curtain-mark sage-curtain-mark"><SageMark plate={SAGE_PLATE} base={SAGE_BASE_REVERSED} cap={SAGE_CAP_REVERSED} size={84} radius={30} pad={16} /></span>
    </div>
  );
}

/* The boot could not get through and the phone remembers nothing to show
   instead. Said plainly, with the one thing they can do. On a phone it sits
   on the curtain; on a desk, on the loading screen's ground. */
function BootStall({ onRetry }) {
  const phone = usePhoneLayout();
  return (
    <>
      {phone ? <SageCurtain hold /> : <div className="loadscreen" />}
      <div className={"boot-stall" + (phone ? " phone" : "")} role="alert">
        <div className="boot-stall-h">Slow connection</div>
        <p>Sage can&rsquo;t reach its data right now. Check your signal, or try again.</p>
        <button type="button" onClick={onRetry}>Try again</button>
      </div>
    </>
  );
}

/* Loading for longer than a read should take: still the curtain, and a line
   under the mark that says so, so a stall reads as slow rather than broken. */
function LoadingScreen({ label = "Loading" }) {
  const phone = usePhoneLayout();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), SLOW_MS); return () => clearTimeout(t); }, []);
  if (phone) return <><SageCurtain hold />{slow && <div className="boot-slow">Slow connection, still trying</div>}</>;
  return (
    <div className="loadscreen">
      <div className="loadscreen-inner">
        <div className="loadscreen-logo"><Logo size={72} loading /></div>
        {label ? <div className="loadscreen-label">{slow ? "Slow connection, still trying" : label}</div> : null}
      </div>
    </div>
  );
}





















































/* ---------------- Shell + styles ---------------- */
/* The native build number, when the page is running inside the phone shell.
   The shell hands it over with the rest of __lpcNative, and it arrives either
   before this page loaded or on the lpc:native event afterwards, so both are
   listened for. On the web there is no build number and the stamp is just the
   site's own version, which is the whole truth there. */
function useNativeBuild() {
  const [b, setB] = useState(() => {
    try { return (window.__lpcNative && window.__lpcNative.build) || null; } catch (e) { return null; }
  });
  useEffect(() => {
    const on = (e) => {
      const d = (e && e.detail) || (typeof window !== "undefined" && window.__lpcNative) || {};
      if (d && d.build) setB(String(d.build));
    };
    on();
    window.addEventListener("lpc:native", on);
    return () => window.removeEventListener("lpc:native", on);
  }, []);
  return b;
}

function Shell({ children, entering, style, ground = true }) {
  const nativeBuild = useNativeBuild();
  /* The other half of the first-paint ground. This shell is the manager's app
     and the sign-in screen, both of which are light; the phone routes come
     through here with ground={false} and record their own, which may be dark.
     Gated on that flag so the two never fight over the key — the phone's
     effect runs first, being deeper in the tree, and an ungated write here
     would land on top of it. */
  useEffect(() => {
    if (!ground) return;
    try { localStorage.setItem("lpcf:ground", "light"); } catch (e) {}
  }, [ground]);
  return <div className={"lpc" + (entering ? " is-entering" : "")} style={style}>
      {/* A phone page sits fixed over the whole app, so under it the ground's
          drifting blobs, dot field and streaks would animate and composite for
          nobody. The phone routes ask for no ground at all. */}
      {ground && <div className="bg-live" aria-hidden="true"><div className="bg-live-inner" /></div>}
      {/* ---- the ground, mounted once and never again ----
          It used to live inside the sign-in screen and inside the arrival, which
          meant it was destroyed with each of them: the arrival's overlay faded
          and took the blobs and the dot field with it, so the last frame of the
          jump handed over to a different backdrop. That is the flicker at the
          end. One instance at the root, behind everything, for the whole life of
          the app — which is what the handoff meant by the same layer continuing
          through the join rather than being swapped at it. */}
      {ground && <SageGround />}
      {children}
      <div className="version-stamp" title="Build version">v{APP_VERSION}{nativeBuild ? ` \u00b7 build ${nativeBuild}` : ""}</div></div>;
}






/* ---------------- The stylesheet ----------------
   Appended to the head once, on load, and never touched again — rather than
   rendered as a <style> element inside whichever screen happens to be up.

   It was the second: every branch of this component rendered its own <Style />,
   so signing in tore down 353KB of CSS and mounted 353KB of identical CSS, and
   the browser reparsed all of it and recalculated every style on the page. That
   is a large part of the second-long block that the white flash at the end of the
   arrival was covering, and it was being paid on any branch change — every tool
   switch that swapped shells too.

   There is nothing dynamic in here to justify the cost: not one interpolation in
   353KB. So it goes in once and stays. */
const SAGE_CSS = `
/* ---- the safe areas, from either source ----
         In Safari and in the iOS shell the page reads the notch and the home
         bar itself through env(). Android's WebView does not report them
         reliably, so the phone shell measures its own insets, including the
         three-button bar, and sets --shell-inset-*; whichever is larger wins. */
:root { --sat:max(env(safe-area-inset-top, 0px), var(--shell-inset-top, 0px));
        --sab:max(env(safe-area-inset-bottom, 0px), var(--shell-inset-bottom, 0px)); }
:root {
        --bg: #F5F5F7; --card: #FFFFFF; --ink: #1D1D1F; --ink-2: #6E6E73; --ink-3: #AEAEB2;
        --line: rgba(0,0,0,.08); --green: #30B155; --red: #E5473C; --amber: #C77800; --lime: #C1D730;
        /* The interface accent. It was the old blue and is now the Garden green,
           in one place, because forty-odd rules point at it and a screen with two
           accents in it reads as two products. The name is kept so nothing has to
           be renamed to find it. */
        --blue: #567D61;
        --radius: 18px; --spring: cubic-bezier(.32,.72,.33,1);
        --shadow-1: 0 1px 2px rgba(0,0,0,.04), 0 2px 12px rgba(0,0,0,.05);
        --shadow-2: 0 4px 10px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.10);
        --shadow-3: 0 2px 6px rgba(16,32,52,.06), 0 22px 54px rgba(16,32,52,.14);
        /* One long, decelerating curve used everywhere so motion feels like it
           comes from the same hand. --spring stays for the snappier UI bits. */
        --ease: cubic-bezier(.22,1,.36,1);
        --ease-bloop: cubic-bezier(.34,1.56,.64,1);
        --font-ui: 'Geist', 'Sora', system-ui, -apple-system, 'Segoe UI', sans-serif;
        --font-display: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
        --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        /* Garden sage: the redesign's palette. Structure comes from these four
           greens, warmth from the sand pair, and the three series colors are
           reserved for chart data so they stay loud against the sage. */
        --p1: #A9C4AC; --p2: #6E9678; --p2d: #567D61; --p3: #2E4A38;
        --hA: #7FA98A; --hB: #55795F; --hC: #26382C;
        --sandHead: #F6E3C3; --sandCap: #EDE0BE; --sandTick: #E4C98D; --sandInk: #D0821E;
        --s1: #2E7DE0; --s2: #E88600; --s3: #17A054;
        /* The two video standards have no line on the chart to match, so they take
           the next two slots on the same scale: a violet and a teal, both clear of
           the three channel hues and of each other. */
        --s4: #8A4FA8; --s5: #0E8F8F;
      }
/* ---- Android's own idea of how big your text should be ----
         Chrome on Android inflates the type in blocks it decides are wide for the
         viewport — "font boosting". It is well meant and it is invisible during
         development, because it does not happen on a desktop at all: the first
         anybody knows is a salesperson holding a phone where one column of a card
         is a size nobody chose. 100% turns the boosting off while still honouring
         the text-size slider in the phone's own settings, which is the half of it
         worth keeping. Setting it to none would take that away too, and somebody who has
         turned their text up has a reason. */
/* No pinch or double-tap zoom anywhere: a screen that has been zoomed by
         accident is a screen somebody cannot find their way back from. Panning
         is untouched; anything that runs its own gestures (the floor plan)
         says touch-action:none on itself and keeps them. */
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; touch-action: pan-x pan-y;
  -webkit-tap-highlight-color: transparent; }
/* Display face on anything that carries hierarchy or a number worth reading
         across a room. Everything else stays on Inter, which holds up better in
         the dense tables. */
.section-title, .ac-name, .login-title, .plate-hist-title, .guide-title, .stop-title, .noaccess-title, .card h3, .role-header, .assoc-leads, .oyo-chan-rate, .ac-stat b, .stepper-value, .dr-tally b, .goalbox b, .drawer-store, .bl-title, .verdict, .badge  {
        font-family: var(--font-display); }
.card h3, .role-header  { letter-spacing:-.015em; }
/* One focus ring for the whole app, only when keyboarding. */
.lpc :focus-visible { outline:2px solid var(--blue); outline-offset:2px; border-radius:8px; }
.lpc :focus:not(:focus-visible) { outline:none; }
/* The browser's default body margin was leaving a strip down both sides, so
         the top bar stopped short of the corners. */
/* The safe areas above the status bar and below the home indicator are not
         part of the page's viewport, so Safari fills them with whatever colour
         the root element carries — white by default. Against a tinted page that
         read as a hard band cut across the top and bottom of the screen. Giving
         the root the app's own base colour makes the join disappear: the backdrop
         fades into --bg at its own edges anyway, so the bands now continue it.
         The theme-color meta in index.html does the same for Safari's own bar. */
html, body { margin:0; padding:0; background:var(--bg); }
/* Portalled overlays — the help sheet, the day screen — sit outside .lpc,
         which is where the app's face is set, so they were rendering in the
         browser's default serif. */
body { font-family: var(--font-ui); }
/* The salesperson screens are dark and fixed. Anything the fixed layer
         does not cover — and iOS uncovers a strip below it the moment the
         keyboard opens — showed the light --bg underneath as a white band. */
html:has(.q-page.sf), body:has(.q-page.sf) { background:#06090F; }
html:has(.q-page.sf.mc-shell), body:has(.q-page.sf.mc-shell) { background:#15211B; }
html:has(.q-page.sf.mc-floor), body:has(.q-page.sf.mc-floor) { background:#070A08; }
/* A page whose content is a full-screen fixed layer has nothing to scroll,
         but .lpc underneath is min-height:100vh with a bottom padding on top of
         it — there is no global border-box here — so the document scrolled by
         exactly that padding and drew a bar for it. */
html:has(.q-page.sf), body:has(.q-page.sf),
      html:has(.qb), body:has(.qb) { height:100%; overflow:hidden; }
.lpc { min-height: 100vh; background: var(--bg); color: var(--ink);
        font-family: var(--font-ui);
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
          radial-gradient(30% 30% at 70% 85%, color-mix(in srgb, var(--p2) 18%, transparent), transparent 72%),
          radial-gradient(26% 26% at 25% 92%, rgba(0,168,150,.13), transparent 72%),
          radial-gradient(24% 24% at 92% 42%, rgba(122,79,155,.10), transparent 74%);
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
/* The arc and the needle went with the old mark. What is left is the float,
         which belongs to the mark rather than to any part of it. */
/* Seven dots, one at a time, 150ms apart: the identity's own loading
         pattern, made of the same dot everything else here is made of. */
.sage-loading { display:inline-flex; align-items:center; }
.sage-loading i { display:block; border-radius:50%; background:#2F7F72; opacity:.22;
        animation: sageDot 1.05s ease-in-out infinite; }
@keyframes sageDot { 0%, 72%, 100% { opacity:.22; transform:scale(.86); }
        18% { opacity:1; transform:scale(1); } }
@keyframes logoFloat {
        0%, 100% { transform: translateY(0) scale(1); }
        50%      { transform: translateY(-3px) scale(1.015); }
      }
.lpc * { box-sizing: border-box; }
::selection { background: color-mix(in srgb, var(--p2) 20%, transparent); }
/* ---- store hero (manager landing) ---- */
.hero { position:relative; z-index:220; margin-bottom: 26px; --sp: #2A5E9B; --sd: #1D4674; --sa: #C1D730; }
/* small caps get real tracking. They were set tight and read as a smudge. */
@keyframes ringIn { from { stroke-dashoffset: var(--c); } to { stroke-dashoffset: 0; } }
/* inset pulls the label off the stroke. "Cleared" was touching the ring. */
@media (max-width: 860px) {
        .hero-health { flex-direction:column; align-items:flex-start; gap:14px; }
      }
/* ---- health block in the hero ---- */
.hero-health { display:flex; align-items:center; gap:22px; position:relative; z-index:2;
        transform: translate3d(0, calc(var(--px) * .6), 0); opacity: var(--pf); }
/* Closing rates on hover, same bloop as the dials. */
/* Wider than it was. The month block at the top carries a bar with three
         things marked on it, and at 300px the legend wrapped onto three lines and
         read as clutter rather than as a picture. */
/* Border-box, so the height cap means the whole panel rather than the part
         inside the padding — the difference is 28px, which is exactly how much of
         it still hung off the bottom. The width is the rendered width it always
         had (346 content + 32 padding + 2 border), so nothing reflows. */
.health-pop { position:absolute; right:0; top:calc(100% + 16px); width:560px; box-sizing:border-box; z-index:240;
        opacity:0; pointer-events:none; text-align:left;
        transform: translateY(-6px) scale(.9); transform-origin: top right;
        transition: opacity .16s ease, transform .38s var(--ease-bloop);
        background:#FFFFFF; border:1px solid rgba(0,0,0,.07); border-radius:16px;
        padding:14px 16px 12px; box-shadow: 0 18px 46px rgba(16,32,52,.3);
        /* Wide enough to hold the channels two-up rather than stacked, which is
           what took the panel past the bottom of the screen. A scrollbar in here
           was the wrong answer twice over: it hid the new-and-used split behind a
           gesture, and this is a thing you glance at. The cap stays as a floor for
           a genuinely tiny window, but nothing ordinary reaches it now. */
        max-height:var(--pop-max, min(88vh, 760px)); overflow-y:auto; overscroll-behavior:contain; }
.hero-health:hover .health-pop { opacity:1; transform: translateY(0) scale(1); }
/* The arrow belongs to the card, not to the panel. It used to hang off the
         panel's top edge, which a panel that scrolls its own contents would clip
         and then scroll away. */
.hero-health::after { content:""; position:absolute; right:42px; top:calc(100% + 10px);
        width:12px; height:12px; transform:rotate(45deg); background:#FFFFFF; z-index:241;
        opacity:0; pointer-events:none; transition:opacity .16s ease;
        border-left:1px solid rgba(0,0,0,.07); border-top:1px solid rgba(0,0,0,.07); border-radius:3px 0 0 0; }
.hero-health:hover::after { opacity:1; }
/* The month on the left, the rates on the right, with a rule between them
         rather than under the month. */
/* The store's own rate reads as a conclusion drawn from the rows above it,
         so it gets the rule and the weight rather than being a fourth row. */
/* Where the month lands, directly under where it stands. Quieter than the
         total: it is a projection, and it should not read like a fact. */
/* ---- The month, against the goal ---- */
/* The track is the whole goal, so the picture holds both numbers at once:
         how far along the store is, and where the line it is judged against sits. */
/* The number that counts as hitting: a full-height line, because it is the
         one thing on here that is not a matter of degree. */
/* Where a level month would be standing today. Deliberately lighter — it is
         a reference, not a rule, and a month is allowed to be uneven. */
/* The tone classes shared with the rows below set only a colour, and this
         rule comes after them in the sheet, so setting a colour here would win and
         the verdict would always read the same shade. Its own names instead. */
/* The multiplication, done where it is entered, so nobody has to trust that
         the popup did the same one they were doing in their head. */
/* A bare text node beside an element is an anonymous flex item, and the
         parent's gap does not always land between the two — which is how this
         first read "The number126". Spaced explicitly rather than relied upon. */
/* new vs used: one bar, because the two halves are shares of the same total
         and reading them as a split is the whole point of showing them */
/* ---- the "why, and who" row ---- */
/* Weakest standard: reversed to a mostly-orange tile with white text so it stands out. */
.hf-fix { background: linear-gradient(135deg, #F7973A, #E5661A); border-color: rgba(255,255,255,.3);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.38), 0 10px 26px -10px rgba(197,86,20,.55); }
.hf-fix { position:relative; }
.hf-pop { position:absolute; left:0; top:calc(100% + 12px); width:300px; z-index:240;
        opacity:0; pointer-events:none; text-align:left;
        transform: translateY(-6px) scale(.9); transform-origin: top left;
        transition: opacity .16s ease, transform .38s var(--ease-bloop);
        background:#FFFFFF; border:1px solid rgba(0,0,0,.07); border-radius:16px;
        padding:14px 16px 13px; box-shadow: 0 16px 42px rgba(31,54,86,.26); }
.hf-fix { position:relative; }
.hf-fix:hover, .hf-fix.popped { z-index:220; }
.hf-fix:hover .hf-pop { opacity:1; transform: translateY(0) scale(1); }
/* the card the manager was sent to, briefly haloed so they land on it */
.assoc-card.is-focused { animation: focusPing 2.4s var(--ease) both; border-radius:12px; }
@keyframes focusPing {
        0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--p2) 34%, transparent); background:color-mix(in srgb, var(--p2) 7%, transparent); }
        55%  { box-shadow: 0 0 0 7px color-mix(in srgb, var(--p2) 0%, transparent); background:color-mix(in srgb, var(--p2) 5%, transparent); }
        100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--p2) 0%, transparent); background:transparent; }
      }
.pod { cursor:pointer; text-align:left; font:inherit; color:inherit; }
/* ---- Top Performers as a strip rather than three big cards ---- */
.podium { margin-bottom:22px; }
/* min-width:0 is what actually stops the overflow: a flex item defaults to
         min-width:auto and refuses to shrink below its content, so a long name
         pushed the whole card past the right edge instead of ellipsing. */
.pod { flex:1 1 240px; min-width:0; display:flex; align-items:center; gap:11px; padding:11px 14px; border-radius:14px;
        background:rgba(255,255,255,.7); border:1px solid rgba(16,40,68,.06);
        transition: transform .35s var(--ease), box-shadow .35s var(--ease); }
.pod:hover { transform:translateY(-2px); }
/* ---- one roster card, roles divided inside it ---- */
/* A soft band of the role's own colour behind its header, so Sales, BDC,
         Managers and Service to Sales read as distinct territories inside the one
         card rather than an undifferentiated list. */
/* ---- the living backdrop ---- */
.bg-live { position:fixed; inset:-25%; z-index:-2; pointer-events:none;
        transform: translate3d(0, var(--bgy, 0px), 0); }
/* The colours carry their own saturation rather than a filter doing it. Even a
         STATIC filter on this layer costs a full re-filter on every raster, because
         the layer is being transformed every frame — measured, it halves the frame
         rate on its own. */
.bg-live-inner { position:absolute; inset:0;
        background:
          radial-gradient(26% 28% at 24% 22%, rgba(122,79,155,.31), transparent 70%),
          radial-gradient(24% 26% at 78% 56%, rgba(0,168,150,.31), transparent 70%),
          radial-gradient(22% 24% at 48% 92%, rgba(255,159,10,.24), transparent 72%),
          radial-gradient(20% 22% at 88% 16%, color-mix(in srgb, var(--p2) 26%, transparent), transparent 72%),
          radial-gradient(18% 20% at 8% 70%, rgba(193,215,48,.22), transparent 74%);
        opacity:.5; animation: bgMorph 16s ease-in-out infinite alternate;
        transition: opacity 1.4s var(--ease); }
/* Sitting on one view brings the colour up. It used to change the animation's
         DURATION as well, and that is what made the backdrop visibly CLICK every
         time you stopped scrolling: a running animation keeps its elapsed time, not
         its position, so cutting 26s to 7s teleports it to wherever 7s-worth of
         elapsed time lands — sometimes most of a cycle backwards, mid-scale and
         mid-rotation. Opacity is the one thing that can change here, because it
         transitions from where it actually is. */
.bg-idle .bg-live-inner { opacity:.95; }
/* Transform only. This layer covers the whole viewport, so an animated
         hue-rotate/saturate on it is a per-pixel shader pass over every frame the
         app ever draws — with the frosted surfaces on top re-blurring against a
         backdrop that never holds still, it was costing roughly two thirds of the
         frame budget on its own. The saturation is now a constant on the layer. */
/* At rest, nothing behind the glass moves. The idle class is the one the
         scroll parallax already sets; a page change lifts it for a few seconds. */
@media (min-width: 701px) {
        .bg-idle .lpc::before, .bg-idle .lpc::after, .bg-idle .bg-live-inner, .bg-idle .sg-blob,
        .bg-idle .qsel-pill::before { animation-play-state: paused; }
      }
@keyframes bgMorph {
        0%   { transform: translate3d(0,0,0) scale(1) rotate(0deg); }
        50%  { transform: translate3d(-2%,3%,0) scale(1.14) rotate(-6deg); }
        100% { transform: translate3d(4%,-5%,0) scale(1.28) rotate(11deg); }
      }
/* full-height accent. A border-left would be curved away by the border-radius
         and blend into the pale top/bottom borders, which made the colour stop short. */
@keyframes tileIn { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform:none; } }
/* the tiles are buttons: click one to see only those people on the board below */
.tile.picked { outline:2px solid var(--accent); outline-offset:1px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 10px 24px rgba(31,54,86,.14); }
@keyframes chipPulse { 0%,100% { opacity:.45; transform:scale(1); } 50% { opacity:1; transform:scale(1.25); } }
/* ---- store wizard ---- */
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
.wiz-preset.on { border-color:var(--blue); background:#fff; box-shadow: var(--shadow-1); }
.hol-chip.past { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.07); color:var(--ink-3); }
/* ---- hourly contact pattern on the coaching card ---- */
.hourly { position:relative; margin-top:22px; }
/* Locked until there is a fortnight of it: the shape is shown so the manager
         knows what is coming, but blurred so nobody coaches off two days of noise. */
.wiz-foot .btn:disabled { opacity:.45; cursor:default; }
/* ---- loading screen ---- */
/* ============ cinematic loading sequence ============ */
@keyframes lseqBgIn { to { opacity:1; } }
@keyframes lseqAurora { from { transform:translate(-3%,-2%) scale(1); } to { transform:translate(3%,2%) scale(1.08); } }
@keyframes lseqFill { to { opacity:.85; } }
@keyframes lseqLive { 0%,100%{opacity:.5;} 50%{opacity:1;} }
@keyframes lseqRowIn { to { opacity:1; transform:none; } }
@keyframes lseqWhoosh {
        0% { opacity:0; transform:translateY(14vh) scale(.08); }
        35% { opacity:1; }
        60% { transform:translateY(-1vh) scale(1.25); }
        100% { transform:translateY(0) scale(1); }
      }
@keyframes lseqHandoff { to { opacity:0; transform:scale(.55) translateY(-4vh); } }
@keyframes lseqStreak { 0%{opacity:0;transform:translate(-50%,30vh) scaleY(.3);} 45%{opacity:.9;} 100%{opacity:0;transform:translate(-50%,-6vh) scaleY(1.2);} }
@keyframes lseqArc { to { stroke-dashoffset:0; } }
@keyframes lseqNeedle { to { transform:rotate(0deg); } }
@keyframes lseqWordIn { to { opacity:1; transform:none; } }
@keyframes lseqWordOut { to { opacity:0; transform:translateY(-10px); } }
@keyframes lseqFillBar { to { width:100%; } }
@keyframes lseqBarShow { to { opacity:1; } }
@keyframes lseqBarHide { to { opacity:0; } }
/* The curtain lifts: the overlay blurs and pulls away, revealing the app that
         is already sitting underneath. Duration must match EXIT_MS in the component. */
@keyframes lseqOut {
        0%   { opacity:1; transform:scale(1);    filter:blur(0px); }
        100% { opacity:0; transform:scale(1.09); filter:blur(12px); }
      }
/* Loading state centered on screen — same vertical spot as the login logo, so a
         handoff from login reads as the form dissolving and leaving the speedometer. */
.loadscreen { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
        padding:24px; z-index:60; }
.loadscreen-inner { text-align:center; animation: loadFadeIn .45s var(--spring) both; }
.loadscreen-logo { display:flex; justify-content:center; margin-bottom:20px;
        filter: drop-shadow(0 10px 26px color-mix(in srgb, var(--p2) 28%, transparent)); }
@keyframes loadFadeIn { from { opacity:0; transform: scale(.94); } to { opacity:1; transform:none; } }
/* the speedometer needle + its gradient trail spin together */
.sage-loading i { animation: sageDot 1.05s ease-in-out infinite; }
/* The floor tools' loader, and its completion. The !important shorthand is
         load-bearing: each dot carries an inline animation-delay for the wave,
         and the finish has to override it or the pop would stagger over a
         second instead of landing as one beat. */
.floor-load.finish .sage-loading i { animation: sageDotDone .38s cubic-bezier(.2,.7,.3,1) both !important; }
@keyframes sageDotDone {
        0%   { opacity:.4; transform:scale(.9); }
        55%  { opacity:1;  transform:scale(1.18); }
        100% { opacity:1;  transform:scale(1); }
      }
.floor-load.finish { animation: floorLoadOut .22s ease .34s both; }
@keyframes floorLoadOut { to { opacity:0; } }
.loadscreen-label { margin-top:2px; font-size:12.5px; color:var(--ink-2); font-weight:600; letter-spacing:.03em; }
/* ---- board launcher ---- */
/* ---- welcome / backup / merge / channel prompt ---- */
/* colour-blind safety: never rely on colour alone */
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
        }
        /* Except while a tool or tab is sliding in: the incoming page starts up
           to 180px to the side, and with the phone pages running edge to edge
           that overhang made the document wider than the screen for half a
           second. Safari zooms out to fit a wider document and zooms back when
           it shrinks, which read as the whole app snapping narrow and then
           "fixing itself". Nobody is scrolling during the slide, so the clip
           costs nothing here. */
        .tool-move .lpc, .tab-move .lpc { overflow-x: clip; }
        .lpc::before, .lpc::after { display: none !important; }

        /* The phone keeps the desktop's colour.
           None of the three problems above was the gradient — they were the clip,
           the promoted layer and the looping animation — so the backdrop stays and
           only its motion goes. Two details are load-bearing:
             isolation stays isolate. .bg-live is z-index:-2, which paints behind
             .lpc's own children but in FRONT of .lpc's background only while .lpc
             is a stacking context. Setting isolation:auto here let the layer escape
             to the root and hide under .lpc's own paint, which is why the phone
             looked flat grey no matter what colour it was given.
             transform goes to none. translate3d(0, var(--bgy), 0) is the parallax,
             and a 3D transform permanently promotes a compositor layer that
             repaints on every scroll frame — the same jitter will-change caused.
             The parallax had nothing to grip on a phone anyway. */
        .bg-live { transform: none !important; }
        /* Held at bgMorph's 50% frame rather than its 0%: at 0% the blobs sit at
           their tightest, and a phone viewport is narrow enough that half of them
           fall off the sides. The mid frame is scaled 1.14 and nudged inward, so
           the colour actually reaches the screen. Opacity comes up to compensate
           for the animation never building — the desktop only looks as saturated
           as it does because bgMorph carries it to .95 while you sit still. */
        .bg-live-inner, .bg-idle .bg-live-inner {
          animation: none !important;
          opacity: 1;
          /* 2D deliberately — translate3d on a static element still asks for a
             compositor layer, which is the thing we removed from .bg-live above. */
          transform: translate(-2%, 3%) scale(1.14) rotate(-6deg);
          filter: saturate(1.25);   /* the rest of that same 50% frame */
        }

        /* no promoted layers anywhere. This is what was jittering. */
        .lpc, .lpc * { will-change: auto !important; }

        /* nothing loops forever behind a scrolling surface */
        .logo-anim, .qsel-pill::before, .dz-icon, .star-badge, .sage-loading i {
          animation: none !important;
        }
        /* leave the logo in its finished state rather than mid-sweep */

        /* the sticky blurred header was the other half of the jump */
        .topbar {
          position: static;
          backdrop-filter: none; -webkit-backdrop-filter: none;
          background: #FFFFFF;
          transform: none;
        }
        .topbar::after { display: none; }
        .version-stamp { backdrop-filter:none; -webkit-backdrop-filter:none; background:rgba(255,255,255,.85); }
        .card, .tile, .store-item, .wiz, .wiz-overlay, .bl-tile {
          backdrop-filter: none; -webkit-backdrop-filter: none;
        }
        .card, .tile, .store-item, .wiz { background: #FFFFFF; }

        /* hover lifts only ever stick on a touchscreen */
        .card:hover, .tile:hover, .store-item:hover, .bl-tile:hover { transform: none; }
      }
/* ---- small screens (layout only) ---- */
@media (max-width: 720px) {
        /* Navigation lives in the drawer now. */
        .seg-wrap { display:none !important; }
        /* The tool switcher moved into the drawer; account controls stay but tuck under the logo. */
        .topbar .tool-row { display:none; }
        .topbar { flex-wrap:wrap; gap:10px; }
        .brand { order:0; }
        .topbar-right .view-select { flex:1 1 140px; min-width:0; }
      }
/* ---- small screens (layout only) ---- */
@media (max-width: 640px) {
        .lpc { font-size:13.5px; padding-bottom:48px; }
        .topbar { padding:10px 14px; }
        .page, .print-area { padding-left:14px; padding-right:14px; }
        /* .board-page sits inside .page, so don't stack their side padding */
        .board-page { padding:18px 0 0; }

        /* only cards that actually hold a wide table become scroll containers */
        .card:has(table) { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        /* The roster's Tags cell holds a chip per skill. At 520px that column is
           about 120px wide, so eight chips stack eight deep and a row runs 450px
           tall. The table already scrolls sideways in its card — give it the room
           to do so, and keep the chips on one line. */

        /* store rows stack; every action stays on screen, no sideways swipe */
        .store-item-actions .btn-ghost, .store-item-actions .btn-x { flex:1 1 auto; text-align:center; }
        .row-actions { flex-wrap:wrap; }
        .pending-row .row-actions { margin-left:0; }
      }
/* ---- store list (reflows instead of a cramped table) ---- */
.btn-x.danger { color:var(--red); }
.btn-x.danger:hover { background:rgba(229,71,60,.1); }
/* ---- the morning round-up ----
         Two surfaces, one set of pieces. The strip lives on the board; the sheet
         is the same content given the whole screen once a day. Motion is the
         app's own: --ease-bloop for anything that arrives, --ease for anything
         that travels. */
@keyframes ruBloop { from { opacity:0; transform:translateY(14px) scale(.95); } to { opacity:1; transform:none; } }
/* From the middle, not the bottom: the sheet is a thing appearing where
         the eye already is, growing into place with a breath of overshoot. */
@keyframes ruSheetUp {
        0%   { transform:scale(.9); opacity:0; }
        60%  { transform:scale(1.015); opacity:1; }
        100% { transform:none; opacity:1; }
      }
@keyframes ruScrim { from { opacity:0; } to { opacity:1; } }
.ru-watch { color:var(--amber); }
/* --- the way back in, once the sheet has been read --- */
.ru-reopen { display:flex; align-items:center; gap:14px; width:100%; text-align:left;
        font:inherit; cursor:pointer; background:var(--card); border:1px solid var(--line);
        border-radius:14px; padding:11px 16px; margin-bottom:20px; box-shadow:var(--shadow-1);
        transition:transform .3s var(--ease-bloop), box-shadow .3s var(--ease), border-color .2s var(--ease);
        opacity:0; animation:ruBloop .5s var(--ease-bloop) .1s both; }
.ru-reopen:hover { transform:translateY(-2px); box-shadow:var(--shadow-2); border-color:color-mix(in srgb, var(--p2) 40%, transparent); }
.ru-reopen:active { transform:scale(.99); }
/* --- the once-a-day sheet --- */
/* Overlay portals this to document.body, which is OUTSIDE .lpc — and .lpc is
         where the app's font, size and ink are set. Anything here that did not name
         a face explicitly was inheriting the browser default, so the headings came
         out right and every line of body copy under them came out in Times. The
         sheet has to restate what it left behind. */
/* No backdrop blur: blurring the entire board is the single most
         expensive thing this overlay could ask for, and it lands at the exact
         moment the arrival is settling - that was the slowdown when the sheet
         appeared. A deeper tint reads as the same focus for none of the cost. */
/* The sheet is green under the head and white under everything else, so
         the head is not the only thing standing between the corner and the page.
         Squaring the head's own corner stopped it drawing a second curve, and
         the white kept showing anyway: whatever the last hairline is -- a
         composited layer rounding its clip differently, a subpixel of the entry
         animation -- it now has the head's own colour behind it rather than
         white, and there is nothing left to see. The body and the foot paint
         their own white on top, so only the head sits on green. */
/* Without overscroll-behavior a flick at either end of this list hands the
         scroll to the board underneath, so closing the sheet left the page sitting
         further down than it started. Same guard the help sheet already carries. */
/* Hidden, not auto: the sheet is designed to fit without scrolling, and
         with auto every entering block's 14px translate momentarily pushed the
         content past the container - a scrollbar flashing for the length of the
         stagger. Short screens, where the content genuinely cannot fit, get a
         real scrollbar with its gutter reserved so nothing shifts. */
/* Short windows AND phones scroll the sheet itself. The phone case was
         missing: a tall viewport on a narrow screen kept overflow hidden, so a
         flick found nothing to move inside the sheet and moved the page behind
         it instead. */
/* The head is the store's own hero in miniature: the same gradient sweep,
         the same identity, so the sheet reads as the store speaking rather than
         the app interrupting. */
/* The hero's own card, at the top of the sheet. The radius follows the
         sheet's corners rather than the hero's, because it is the sheet's edge
         it is sitting in. */
/* .s2-hero comes later in this stylesheet at the same specificity, so it
         was winning: the head took the hero's 24px radius inside a sheet clipped
         at 22px, and its overflow went visible. Named twice here so this one wins.

         The radius is zero, not the sheet's 22. Two rounded corners stacked on
         the same curve do not cancel out: each is antialiased, and the white
         behind shows through the head's own soft edge as a hairline arc. The
         sheet already clips at 22 with overflow:hidden, so the head is left
         square and cut by the sheet -- one curve, drawn once. Matching the
         radius instead would leave the same fringe, and any radius LARGER than
         the sheet's takes the green further in and shows white outright. */
/* On a phone the verdict was absolutely positioned straight through the
         store's name. It steps out of the corner and under the identity row. */
/* ---- the pace chart, in the Performance page's own vocabulary ---- */
@keyframes ru2Draw { to { stroke-dashoffset:0; } }
@keyframes ru2DotIn { to { opacity:1; } }
/* ---- yesterday's business: plain numbers ---- */
/* New and used carry their own plates, no direction: they are yesterday's
         facts, not judgements. */
/* ---- yesterday's activity with the week behind it ---- */
@keyframes ru2Bar { to { transform:scaleY(1); } }
@media (prefers-reduced-motion: reduce) {
        .ru-reopen:hover, .ru-reopen:active { transform:none; }
      }
/* ---- upload history ---- */
/* ---- coaching ---- */
.coach-row.on { border-color:var(--blue); background:#fff; box-shadow:var(--shadow-1); }
.coach-days.dim { opacity:.6; }
/* ---- coaching side-by-side ---- */
/* Sticky only where it earns its keep: beside an open card, where the list
         has a tall neighbour to stay level with. With nothing open the split is
         one column, and a sticky grid item is held by the grid container rather
         than by its own row, so on the way down the page the list slid over the
         panel underneath it -- which then painted on top of the last few rows,
         showed through them, and swallowed their clicks. */
@keyframes cardOpen {
        from { opacity:0; transform: translateY(10px) scale(.985); }
        to { opacity:1; transform: none; }
      }
/* ---- import: side-by-side checklist + dropzone ---- */
.import { display:flex; flex-direction:column; gap:32px; }
.import > .card { margin-bottom:0; padding:22px 22px 24px; }
.import-grid .checklist { max-width:none; margin:0; padding:22px 22px 24px; }
.import > .import-log, .import > .hint { margin-top:0; }
/* roomier checklist rows so the required/optional lists don't feel cramped */
.import .check { padding:9px 0; }
.import .check-group-label { margin:18px 0 6px; }
.import .check-group-label:first-of-type { margin-top:6px; }
.help-btn { float:right; margin-top:-2px; border:1px solid var(--line); background:#fff; color:var(--blue);
        font:inherit; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px; cursor:pointer; transition:all .15s ease; }
.help-btn:hover { background:var(--blue); color:#fff; border-color:var(--blue); }
/* ---- discrepancy flag banner ---- */
/* ---- delivery guide + wrong-report stop screen ---- */
/* One z-index only. There were two on this rule and the later one won, which
         put every modal underneath the top bar. */
.guide-modal.stop { border-top:6px solid #E5473C; }
.ac-bar.behind { background:#E5473C; }
.ac-bar.even { background:var(--blue); }
.ac-bar.ahead { background:#30B155; }
/* the benchmark line: where the top performers sit */
/* where the top performers sit. A bar reaching this line means parity with them. */
/* ---- own your outcome ---- */
.oyo-fill.good { background:linear-gradient(90deg,#30B155,#5FCB7E); }
.oyo-fill.behind { background:linear-gradient(90deg,#E5473C,#F0796F); }
/* where they SHOULD be by today: the gap between bar and mark is the whole story */
.oyo-stats .good b { color:#1E7A3C; }
.oyo-stats .behind b { color:#C13529; }
.oyo-lede.good { color:#1E7A3C; font-weight:600; }
.oyo-lede.behind { color:#C13529; font-weight:600; }
.oyo-chan-hist.good { color:#1E7A3C; }
.oyo-chan-hist.behind { color:#C13529; }
/* ---- pending approvals ---- */
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
/* .topstack is what sticks; the header inside it is static. See AppShell. */
.topbar { display:flex; align-items:center; justify-content:space-between;
        padding:12px 24px; background: rgba(255,255,255,.9); backdrop-filter: saturate(170%) blur(16px);
        -webkit-backdrop-filter: saturate(170%) blur(16px); border-bottom: 1px solid rgba(16,32,52,.07);
        box-shadow: 0 1px 0 rgba(16,32,52,.02), 0 8px 24px -18px rgba(16,32,52,.16);
        flex-wrap:wrap; gap:10px;
        transform: translateZ(0); will-change: backdrop-filter; backface-visibility: hidden; }
.topbar::after { content:""; position:absolute; left:0; right:0; top:100%; height:16px; pointer-events:none;
        background: linear-gradient(180deg, rgba(244,246,249,.85), rgba(244,246,249,0)); }
.brand { display:flex; gap:12px; align-items:center; }
.save-dot { font-size:12px; color:var(--ink-3); animation: pulse 1.2s ease infinite; }
.load-warn { background:#FDECEA; border:1px solid #F5B7B1; color:#B3372E; padding:12px 16px; border-radius:12px; margin-bottom:16px; font-weight:600; font-size:14px; }
.pix { display:inline-block; vertical-align:middle; flex:0 0 auto; }
@keyframes pulse { 50% { opacity:.4; } }
/* ---------- the page assembling itself ----------
         Every measurement here is taken from the real dashboard: .topbar is 12px/24px
         padding, .board-page is max-width 1440 with 32px gutters, .hero-band is 30px/34px
         with a 24px radius and the same gradient tokens. The point is that the last
         frame of this and the first frame of the app are the same picture. */
/* The cinematic's 200 lines of stand-in dashboard went with it. */
/* ---------- sign-in handover ----------
         One continuous move in three overlapping beats. Nothing waits its turn
         politely: the card comes apart while the wash is already blooming, and the
         app is already building before the wash has finished leaving. That overlap
         is the difference between fluid and clunky. */
@keyframes lgCard {
        0%   { transform:none; opacity:1; }
        100% { transform:scale(1.06); opacity:0; filter:blur(6px); }
      }
/* Each part leaves on its own vector and its own clock, so the card reads as
         coming apart rather than fading out in one piece. */
@keyframes lgPart {
        0%   { transform:none; opacity:1; filter:blur(0); }
        100% { transform:translate3d(var(--lgx,0), var(--lgy,14px), 0) scale(.94); opacity:0; filter:blur(3px); }
      }
/* The mark is the one thing that does not scatter. It lifts and holds while
         everything else clears, which is what makes the two screens feel like one. */
@keyframes lgMark {
        0%   { transform:none; opacity:1; }
        40%  { transform:translate3d(0,-14px,0) scale(1.1); opacity:1; }
        100% { transform:translate3d(0,-34px,0) scale(.72); opacity:0; }
      }
@keyframes lgWash {
        0%   { opacity:0; transform:scale(.28); }
        38%  { opacity:1; transform:scale(1.04); }
        100% { opacity:0; transform:scale(1.5); }
      }
/* ---------- the app assembling ----------
         Regions arrive in reading order rather than all at once, so the screen
         resolves the way the eye already scans it. */
.lpc.is-entering .topbar   { animation: appBar .52s var(--ease) both; }
.lpc.is-entering .seg-wrap { animation: appRise .54s var(--ease) both; animation-delay:.06s; }
.lpc.is-entering .hero     { animation: appHero .66s var(--ease-bloop) both; animation-delay:.10s; }
.lpc.is-entering .card { animation: appRise .58s var(--ease) both; animation-delay:.20s; }
.lpc.is-entering .card:nth-of-type(2) { animation-delay:.26s; }
.lpc.is-entering .card:nth-of-type(3) { animation-delay:.32s; }
.lpc.is-entering .card:nth-of-type(n+4) { animation-delay:.38s; }
@keyframes appBar {
        0%   { transform:translate3d(0,-100%,0); opacity:0; }
        100% { transform:none; opacity:1; }
      }
@keyframes appRise {
        0%   { transform:translate3d(0,18px,0) scale(.985); opacity:0; }
        100% { transform:none; opacity:1; }
      }
@keyframes appHero {
        0%   { transform:translate3d(0,26px,0) scale(.97); opacity:0; filter:blur(4px); }
        100% { transform:none; opacity:1; filter:blur(0); }
      }
@media (prefers-reduced-motion: reduce) {
        .lpc.is-entering .topbar,
        .lpc.is-entering .seg-wrap,
        .lpc.is-entering .hero,
        .lpc.is-entering .card {
          animation:none !important; }
      }
/* A fake person in a live queue must never be mistaken for a real one. */
/* ---- a queue on a wall ----
         Sized in vw and vh so one stylesheet serves a 32in screen in an office and a
         75in one in a showroom without a second layout. */
.qb { position:fixed; inset:0; z-index:400; background:#0B1622; color:#EAF2F8; overflow:hidden;
        font-family:var(--font-ui); display:flex; flex-direction:column; padding:3.8vh 3.1vw 4vh; }
.qb::before { content:""; position:absolute; width:75vw; height:75vw; left:-20vw; top:-55vh;
        border-radius:50%; pointer-events:none;
        background:radial-gradient(circle, color-mix(in srgb, var(--a) 24%, transparent) 0%, transparent 62%); }
.qb::after { content:""; position:absolute; inset:0; pointer-events:none; opacity:.32;
        background-image:radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px);
        background-size:1.6vw 1.6vw; mask-image:linear-gradient(180deg,#000,transparent 72%); }
.qb-hd { display:flex; align-items:center; gap:1.1vw; position:relative; z-index:2; }
.qb-tag { display:inline-flex; align-items:center; gap:.75vw; font-weight:700;
        font-size:clamp(15px,1.45vw,26px); color:var(--a); }
.qb-live { width:.8vw; height:.8vw; min-width:10px; min-height:10px; border-radius:50%; background:var(--a);
        box-shadow:0 0 1vw var(--a); animation:qbPulse 2.4s ease-in-out infinite; }
@keyframes qbPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.qb-store { color:rgba(234,242,248,.5); font-size:clamp(14px,1.32vw,24px); }
.qb-hd-right { margin-left:auto; display:flex; gap:.75vw; }
.qb-pill { display:inline-flex; align-items:center; gap:.55vw; padding:.9vh 1vw; border-radius:999px;
        background:rgba(255,255,255,.06); font-size:clamp(12px,1.13vw,20px); color:rgba(234,242,248,.72); }
.qb-pill b { color:#fff; font-family:var(--font-display); }
.qb-av { flex:0 0 auto; display:flex; align-items:center; justify-content:center;
        font-family:var(--font-display); font-weight:700; color:#0B1622; }
.qb-av-md { width:4.8vw; height:4.8vw; border-radius:1.45vw; font-size:1.75vw; }
.qb-av-sm { width:3.25vw; height:3.25vw; border-radius:1vw; font-size:1.25vw; }
.qb-cap { font-size:clamp(11px,1vw,18px); letter-spacing:.16em; text-transform:uppercase;
        color:rgba(234,242,248,.45); margin-bottom:.7vh; }
.qb-langs { display:inline-flex; gap:.35vw; }
.qb-lang { display:inline-flex; padding:.45vh .7vw; border-radius:999px; background:rgba(255,255,255,.11);
        font-size:clamp(10px,.94vw,17px); font-weight:700; letter-spacing:.05em; color:rgba(234,242,248,.9); }
/* Earned, so it gets the store's own colour. Nobody can give themselves one. */
.qb-strength { background:color-mix(in srgb, var(--a) 34%, transparent); color:#fff;
        letter-spacing:.02em; }
.qb-skill { background:rgba(255,255,255,.055); color:rgba(234,242,248,.62);
        font-weight:600; letter-spacing:.02em; }
/* Placement shows as warmth, not a badge: the queue colour still owns who is
         next, so the two never argue about what the screen is saying. */
.qb-warm .qb-av { box-shadow:0 0 0 .26vw color-mix(in srgb, var(--w2) 60%, transparent),
        0 0 2.8vw color-mix(in srgb, var(--w2) 42%, transparent); }
.qb-warm .qb-cnm, .qb-warm .qb-name { color:var(--w1); }
.qb-warm.qb-card { background:linear-gradient(180deg, color-mix(in srgb, var(--w2) 18%, transparent),
        color-mix(in srgb, var(--w2) 4%, transparent)); border-color:color-mix(in srgb, var(--w2) 40%, transparent); }
.qb-warm .qb-step { background:linear-gradient(180deg, color-mix(in srgb, var(--w2) 30%, transparent),
        color-mix(in srgb, var(--w2) 8%, transparent)); border-color:color-mix(in srgb, var(--w2) 42%, transparent); }
.qb-top { display:flex; align-items:flex-start; gap:2.75vw; margin-top:2.2vh; position:relative; z-index:2; }
.qb-hero { flex:0 0 35vw; }
.qb-name { font-family:var(--font-display); font-weight:700; letter-spacing:-.025em; line-height:.94;
        font-size:clamp(40px,6.5vw,118px); color:#fff; }
.qb-sub { margin-top:1.4vh; display:flex; gap:.8vw; align-items:center;
        font-size:clamp(13px,1.2vw,21px); color:rgba(234,242,248,.5); }
.qb-pod { flex:1; display:flex; align-items:flex-end; gap:1vw; height:37vh; }
.qb-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:1.1vh; }
.qb-cnm { font-size:clamp(14px,1.38vw,24px); font-weight:600; text-align:center; line-height:1.2; }
.qb-cw { font-size:clamp(11px,1vw,18px); color:rgba(234,242,248,.4); }
.qb-step { width:100%; border-radius:1vw 1vw 0 0; border:1px solid rgba(255,255,255,.09); border-bottom:0;
        background:rgba(255,255,255,.05); display:flex; align-items:flex-start; justify-content:center;
        padding-top:1.2vh; font-family:var(--font-display); font-weight:700;
        font-size:clamp(15px,1.56vw,27px); color:rgba(234,242,248,.45); }
.qb-strip { display:flex; gap:.8vw; margin-top:auto; position:relative; z-index:2; }
.qb-card { flex:1; background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.07);
        border-radius:1.25vw; padding:1.9vh 1vw; display:flex; flex-direction:column; gap:1.1vh; }
.qb-chead { display:flex; align-items:flex-start; justify-content:space-between; }
.qb-pos { font-family:var(--font-display); font-weight:700; font-size:clamp(13px,1.31vw,23px);
        color:rgba(234,242,248,.28); }
.qb-left { text-align:left; }
.qb-crow { display:flex; align-items:center; justify-content:space-between; gap:.5vw; }
.qb-more { flex:0 0 8vw; align-items:center; justify-content:center;
        color:rgba(234,242,248,.38); font-size:clamp(12px,1.25vw,22px); }
.qb-busy { display:flex; align-items:center; gap:.7vw; flex-wrap:wrap; padding-top:1.4vh; margin-top:1.8vh;
        border-top:1px solid rgba(255,255,255,.07); position:relative; z-index:2; }
.qb-busy-lbl { font-size:clamp(10px,.88vw,16px); letter-spacing:.12em; text-transform:uppercase;
        color:rgba(234,242,248,.3); }
.qb-chip { display:inline-flex; align-items:center; gap:.5vw; padding:.8vh .9vw; border-radius:999px;
        background:rgba(255,255,255,.05); font-size:clamp(11px,1.06vw,19px); color:rgba(234,242,248,.55); }
.qb-chip i { font-style:normal; font-size:.78em; color:rgba(234,242,248,.3); }
.qb-empty { margin:auto; font-size:clamp(18px,2.6vw,46px); color:rgba(234,242,248,.4); text-align:center; }
/* ---- scan to check in ----
         Arrives with the same overshoot everything else in the tool uses, sits over a
         dimmed board rather than replacing it, and leaves the same way. */
.qb-scan { position:absolute; inset:0; z-index:6; display:flex; align-items:center; justify-content:center;
        background:rgba(6,12,20,.72); backdrop-filter:blur(6px);
        animation:qbScanIn .34s cubic-bezier(.34,1.4,.64,1) both; }
@keyframes qbScanIn { from { opacity:0; } to { opacity:1; } }
.qb-scan-card { background:#fff; color:#101820; border-radius:2vw; padding:3.4vh 3vw;
        display:flex; flex-direction:column; align-items:center; gap:1.4vh;
        box-shadow:0 4vh 10vh -3vh rgba(0,0,0,.7);
        animation:qbScanPop .46s cubic-bezier(.34,1.5,.64,1) both; }
@keyframes qbScanPop {
        0%   { transform:scale(.72) translateY(3vh); opacity:0; }
        60%  { transform:scale(1.035) translateY(0); opacity:1; }
        100% { transform:scale(1); }
      }
.qb-scan-cap { font-size:clamp(11px,1vw,18px); font-weight:800; letter-spacing:.16em;
        text-transform:uppercase; color:var(--a); }
.qb-scan-title { font-family:var(--font-display); font-weight:700; letter-spacing:-.02em;
        font-size:clamp(22px,2.9vw,52px); }
.qb-scan-qr { width:26vh; max-width:34vw; }
.qb-scan-qr svg { display:block; width:100%; height:auto; }
.qb-scan-sub { font-size:clamp(12px,1.15vw,20px); color:#5A6472; }
/* held open on purpose: no pulse, nothing asking for attention */
.qb-scan-pin .qb-scan-card { animation-duration:.3s; }
.qb-scan-toggle { position:absolute; right:1.6vw; bottom:1.6vh; z-index:7; cursor:pointer;
        font-family:inherit; font-size:clamp(11px,.95vw,17px); font-weight:700;
        padding:.9vh 1.2vw; border-radius:999px; border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.06); color:rgba(234,242,248,.5); }
.qb-scan-toggle:hover { background:rgba(255,255,255,.12); color:rgba(234,242,248,.85); }
@media (prefers-reduced-motion: reduce) {
        .qb-scan, .qb-scan-card { animation:none !important; }
      }
.skill-chip.on { background:var(--blue); border-color:var(--blue); color:#fff; }
.skill-chip.earned { cursor:help; background:rgba(217,164,37,.16); border-color:rgba(217,164,37,.45);
        color:#8A6314; }
/* An empty field was reading as though it already held everyone's languages,
         because the uppercase rule was being applied to the placeholder too. */
.rp-row.on { background:rgba(210,64,44,.06); border-color:rgba(210,64,44,.3); }
.rp-row.on .md-box { border-color:#C0392B; }
.tk { padding:14px 16px; border-radius:14px; border:1px solid rgba(16,32,52,.1); background:#fff; }
/* ---- a report that a number is wrong ---- */
/* ---- who works here ---- */
/* ---- one position, one look ----
         The colour is the position's own, set under Settings and already drawn on
         the standards table, so this is that identity turning up again rather than
         a second one invented here. */
.role-badge.big { padding:6px 13px; }
.role-badge.big b { font-size:13.5px; }
/* Quiet, but never hidden until hover: half the people who use this screen
         are on an iPad on the floor, where there is no hover and a control that
         only appears for a mouse does not exist at all. */
/* No bar down the left-hand side. It was a second, louder copy of what the
         heading already says, and a hard vertical edge is not a shape this site
         uses anywhere else. The ring around the face is enough. */
/* No ring around the face either, for the same reason the bar went. These
         faces are the Live Floor's, and their fill is a hue off the person's own
         name — a warm ring around a teal circle is two palettes arguing on one
         30-pixel object. The heading carries the position; the row carries the
         person. */
/* ---- room at the edges ----
         The Dashboard sits in .board-page: 32px of gutter and a 1440 ceiling.
         Every other tab in this module was rendered bare into .page, which has no
         padding at all, so on a wide monitor a card ran from one edge of the glass
         to the other and its buttons finished hard against the right-hand side.
         The same gutter, under a name any tab can wear.

         Deliberately applied per tab rather than to .page itself: the activity
         module's tracker is a dense table that has always had the full width, and
         putting a 1440 ceiling on it would change a screen nobody asked about. */
.tab-page { padding:28px 32px 0; max-width:1440px; margin:0 auto; }
@media (max-width:900px) { .tab-page { padding:16px 16px 0; } }
/* ---- history: the figure and its move ---- */
.hist-move.up { color:#1E7A3C; }
.hist-move.down { color:#C13529; }
/* The trail. Small on purpose: it is a shape to be read across a row at a
         glance, not eight more numbers to take in. */
.hist-trail-h { white-space:nowrap; }
@media (max-width:1100px) { .hist-trail-h, .hist-table td:last-child { display:none; } }
/* The disclosure that holds the reasoning. Quiet enough to ignore, obvious
         enough to find on the day somebody needs it. */
/* ---- the chain: gap, mix, close rate, leads ----
         Four blocks and three arrows. The arrows are drawn by the container so
         the blocks stay plain, and they turn into a downward flow on a phone
         where four across would be four unreadable columns. */
.oyo-step-val.big { font-size:29px; color:var(--blue); }
/* Figures that say which channel they belong to, without a legend. */
/* Where the table below came from, stated as evidence rather than promised
         as a reassurance. */
.explain { margin:6px 0 0; }
.explain > summary { display:inline-flex; align-items:center; gap:6px; cursor:pointer;
        font-size:11.5px; font-weight:700; letter-spacing:.01em; color:var(--blue);
        list-style:none; padding:3px 0; }
.explain > summary::-webkit-details-marker { display:none; }
.explain > summary::before { content:"?"; display:inline-grid; place-items:center;
        width:15px; height:15px; border-radius:50%; font-size:10px; font-weight:800;
        background:color-mix(in srgb, var(--p2) 12%, transparent); color:var(--blue); }
.explain[open] > summary::before { content:"\\2212"; }
.explain > summary:hover { text-decoration:underline; }
.pp-folds .hint { margin:0 0 8px; max-width:78ch; }
.pp-stranger.on { background:color-mix(in srgb, var(--p2) 14%, transparent); }
/* A repair rather than a question or a fault, so its own colour: these are
         your people, and the tool is offering to put them back together. */
/* The door, on the sign-in screen. Only ever shown when there is something
         to say: standing on the lot with a good fix says nothing at all. */
.sf-door { display:block; margin:14px auto 0; max-width:30rem; padding:12px 16px; border-radius:14px;
        text-align:left; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16); }
.sf-door b { display:block; font-size:15px; margin-bottom:3px; }
.sf-door span { font-size:13px; opacity:.82; line-height:1.45; }
.sf-door-no { background:rgba(229,83,63,.16); border-color:rgba(229,83,63,.4); }
.sf-door-aside { margin-top:12px; font-size:12.5px; opacity:.7; text-align:center; }
/* .btn paints a solid blue with white text, so overriding a colour here
         changed nothing at all and "Not ours" sat next to "They left" looking
         exactly as harmless. These take somebody off a floor or out of a
         month; they should not read as the same kind of button. */
.btn.pp-danger { background:linear-gradient(180deg,#F0796B 0%,#D9463A 100%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 1px 2px rgba(68,16,16,.22), 0 6px 18px rgba(200,60,45,.24); }
.btn.pp-danger:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,.26), 0 2px 4px rgba(68,16,16,.2), 0 12px 26px rgba(200,60,45,.32); }
.pp-count.on { color:#0E7C55; background:rgba(15,179,126,.13); }
.pp-add .help-in { flex:1; min-width:170px; }
.pp-row.on { background:color-mix(in srgb, var(--p2) 12%, transparent); }
/* Quiet until you go for one. An outline and a glyph is enough to be found
         and not enough to shout, which is the right weight for something you do
         to a person twice a year. */
/* Open, and staying open: the one state in this row that is not momentary. */
.pp-act.on { background:color-mix(in srgb, var(--p2) 10%, transparent); border-color:color-mix(in srgb, var(--p2) 32%, transparent); color:#2A5E9B; }
.pp-act.on svg { opacity:1; }
/* The only one that takes a person's figures out of the store's books. It
         earns a colour; the other four do not. */
@media (max-width:760px) {
        /* The labels STAY. Dropping them to icons fits the row and turns four
           unlabelled marks into a guessing game, one of which takes a person's
           figures out of the store's books. The row already wraps on a phone, so
           they simply sit under the name with their names on them. */
      }
/* Waiting on a decision, not wrong yet — so amber rather than the red the
         unclaimed-figures card uses. One of those is a question, the other is a
         store counting cars it never sold. */
/* The account panel opens inside the person's row, so the row has to be
         allowed to grow rather than squeezing it into a flex column. */
.pp-acctbox .hint { margin:0 0 9px; }
.pp-acctbox .hint:last-child { margin:9px 0 0; }
/* The base select is drawn for the dark boards, which on this white card is
         a bordered control with no border: it read as a label rather than as
         something to open. */
/* Tagged with the element on purpose. The board's own .q-flag-sel is defined
         further down the sheet, at the same specificity, so a bare .pp-same loses
         to it and the control comes out with no border at all on a white card. */
/* Every other picker on this white card had the same problem, for the same
         reason: a white border on a white background. Position, languages and the
         account picker all read as plain text you had to discover were clickable. */
.pp-move .hint { margin:0 0 10px; }
.tk-snap-row.on { color:var(--ink); font-weight:700; }
/* ---------- help ---------- */
.help-fab { position:fixed; right:18px; bottom:18px; z-index:350; width:46px; height:46px;
        border-radius:999px; border:0; cursor:pointer; display:flex; align-items:center; justify-content:center;
        background:linear-gradient(135deg,#2A5E9B,#5566F0); color:#fff;
        box-shadow:0 14px 30px -12px color-mix(in srgb, var(--p2) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.25);
        transition:transform .16s var(--ease), box-shadow .2s var(--ease); }
.help-fab:hover { transform:translateY(-2px); box-shadow:0 20px 38px -12px color-mix(in srgb, var(--p2) 75%, transparent); }
.help-fab.inline { position:static !important; inset:auto !important; width:auto; height:auto;
        gap:8px; padding:11px 18px; border-radius:12px; font-family:inherit; font-size:13.5px;
        font-weight:700; margin-top:16px; align-self:flex-start; box-shadow:none;
        background:color-mix(in srgb, var(--p2) 10%, transparent); color:var(--blue); }
.help-fab.inline:hover { background:color-mix(in srgb, var(--p2) 18%, transparent); transform:none; }
/* The sign-in pages are a single column with the controls at the foot, so the
         floating button is lifted clear of them rather than sitting on top. */
/* Clear of the spine. The salesperson screens draw the queue down a 46px
         column on the right edge, and at right:18px the button landed on its
         label. */
.q-page .help-fab:not(.inline) { bottom:auto; top:18px; right:58px; width:40px; height:40px;
        background:rgba(255,255,255,.12); box-shadow:0 6px 18px -8px rgba(0,0,0,.5);
        backdrop-filter:blur(6px); }
.q-page .help-fab:hover { background:rgba(255,255,255,.2); }
/* No backdrop-filter here, deliberately. Blurring a full-screen scrim makes the
         browser re-blur everything behind it on every scrolled frame, which is what
         made the sheet drag under a finger. The scrim is simply darker instead.
         (This was not what mis-placed the Help panel: that was the sheet's own
         filling transform animation. See the Overlay component.) */
.help-back { position:fixed; inset:0; z-index:420; background:rgba(15,23,42,.62);
        display:flex; align-items:flex-end; justify-content:center;
        animation:helpIn .2s var(--ease) both; }
@keyframes helpIn { from { opacity:0; } to { opacity:1; } }
/* This panel is a white sheet inside a black app. Without pinning its own ink
         the salesperson view's light-on-dark colours bleed through and the headings
         come out white on white. */
.help-sheet, .help-sheet * { color:var(--ink); }
.help-sheet h3, .help-sheet b { color:var(--ink); }
.help-sheet .hint, .help-sheet .md-cap { color:var(--ink-3); }
/* A dot glyph draws with fill:currentColor, and the blanket pin above matches the
         svg itself rather than only its parent, so an icon meant to carry a tone colour
         was being repainted plain ink. These take the colour of the box they sit in. */
.help-sheet .md-box .pix, .help-sheet .md-x .pix { color:inherit; }
/* overscroll-behavior keeps a flick at the end of the list from handing the
         scroll to the page underneath, which on a phone reads as the sheet sticking. */
.help-sheet { width:min(560px, 100%); max-height:88vh; overflow-y:auto; overflow-x:hidden;
        overscroll-behavior:contain; -webkit-overflow-scrolling:touch; background:#fff;
        border-radius:22px 22px 0 0; padding:18px 20px 26px;
        box-shadow:0 -20px 60px -20px rgba(16,32,52,.5);
        /* "backwards", not "both". With "both" the animation keeps filling after it
           ends, so transform stays an identity matrix instead of returning to none,
           and this sheet silently becomes the containing block for every fixed child
           AND keeps a compositor layer alive under the scroller. "backwards" gives
           the same entry (the from-state applies before it starts, and the end state
           already matches the element's own transform:none / opacity:1) with neither
           side effect. Verified identical on screen. */
        animation:helpUp .32s cubic-bezier(.34,1.3,.64,1) backwards; }
@keyframes helpUp { from { transform:translateY(28px); opacity:0; } to { transform:none; opacity:1; } }
@media (min-width:700px) {
        .help-back { align-items:center; }
        .help-sheet { border-radius:22px; }
      }
.help-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.help-head h3 { font-size:19px; }
/* The sheet's close mark. Scoped to .md-x so the plain text .btn-x everywhere
         else in the manager tool is left exactly as it was. */
.help-sheet .md-x { display:flex; align-items:center; justify-content:center; flex:0 0 auto;
        width:36px; height:36px; padding:0; border-radius:11px; color:var(--ink-2);
        background:rgba(16,32,52,.05); transition:background .16s, color .16s; }
.help-sheet .md-x:hover { background:rgba(16,32,52,.1); color:var(--ink); }
.help-tabs { display:flex; gap:6px; background:rgba(16,32,52,.05); border-radius:12px; padding:4px; margin-bottom:14px; }
.help-tab { flex:1; font-family:inherit; font-size:13px; font-weight:700; padding:9px; border:0;
        border-radius:9px; background:none; color:var(--ink-2); cursor:pointer; }
/* First and widest, because it is the one people will not think to look for.
         Nobody arrives at a help button meaning to report a wrong number — they
         arrive meaning to give up on it. */
.help-tab-wrong { flex:1.35; }
.help-tab-wrong.on { color:#C13529; }
.help-intro { font-size:12.5px; color:var(--ink-2); line-height:1.5; margin:0 0 12px; }
.help-shown { margin-top:7px; font-size:12.5px; color:var(--ink-2);
        background:rgba(16,32,52,.05); padding:7px 10px; border-radius:9px; }
.help-shown b { font-family:var(--font-display); font-size:16px; color:var(--ink); letter-spacing:-.02em; }
.help-tab.on { background:#fff; color:var(--ink); box-shadow:0 3px 10px -6px rgba(16,32,52,.5); }
.help-body { display:flex; flex-direction:column; gap:10px; }
.help-person { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
.help-avatar { width:42px; height:42px; border-radius:999px; display:flex; align-items:center;
        justify-content:center; font-weight:800; color:#fff; background:linear-gradient(135deg,#2A5E9B,#5566F0); }
.help-person b { display:block; font-size:15px; }
.help-role { font-size:12px; color:var(--ink-3); }
.help-link { display:block; font-size:15px; font-weight:700; color:var(--blue); text-decoration:none;
        padding:11px 14px; border-radius:12px; background:color-mix(in srgb, var(--p2) 7%, transparent); }
.help-link:hover { background:color-mix(in srgb, var(--p2) 12%, transparent); }
.help-lbl { display:block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
        color:var(--ink-3); margin-bottom:5px; }
.help-area, .help-in { width:100%; box-sizing:border-box; font-family:inherit; font-size:14px;
        padding:11px 13px; border-radius:12px; border:1px solid rgba(16,32,52,.14); background:#fff; }
.help-row { display:flex; gap:10px; flex-wrap:wrap; }
.help-row > span { flex:1 1 180px; }
.help-done { display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center;
        padding:18px 0; color:#178A57; }
.help-done b { font-size:17px; color:var(--ink); }
/* ---------- my day ---------- */
.myday .md-cap { font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
        color:var(--ink-3); display:flex; justify-content:space-between; margin:2px 0 8px; }
/* An automatic item is not tappable, so it must not look tappable. */
/* The three automatic items wear the colour of their tile in the row above, so
         the eye ties "Calls" on the list to the Calls figure without reading either.
         These sit below the plain .md-item rules on purpose: they carry the same
         specificity, so the cascade only picks them because they come last. Moving
         this block up puts the green back on every ticked row.
         Named one class at a time: a substring match on "md-i" also catches "md-item". */
/* the moment the reports catch up */
@keyframes mdPop {
        0% { transform:scale(1); }
        35% { transform:scale(1.03); box-shadow:0 0 0 4px rgba(23,138,87,.18); }
        100% { transform:scale(1); }
      }
/* Each measure gets its own colour, the way the inspiration boards do, so the
         eye learns the tiles by position and hue rather than reading every label. */
/* Lift on hover only where there is a pointer. On a touch screen every tap
         counted as a hover, so a scrolled finger left a trail of tiles animating. */
/* Plain numerals here. The dot digits belong on the dark floor screens, where
         they read as a display; on a white panel of figures they only slow reading. */
/* closing rates.
         Graded exactly as the leaderboard grades them, and wearing the leaderboard's
         own pill colours, so a rep who checks their phone and then looks up at the TV
         sees the same verdict twice rather than two opinions. */
/* Three fixed columns left each tile about 100px on a phone, which the mark and
         the trend chip no longer fit inside. Same auto-fit grid as the stat tiles
         above it, so a narrow screen drops to two columns instead of crushing them. */
/* Start here: one bar, the store's bar marked on it, and what to do about it.
         Same grammar as the coaching sheet so the phone and the paper agree. */
/* the import stamp, matching the daily tracker's chip */
/* The board's light pill palette, value for value. */
/* The move since the last report. Same triangles, same 0.05pt deadband, same
         reading as the wall: up is the number climbing, not the person. */
.brand { position:relative; }
.brand-btn.on { box-shadow:0 0 0 3px color-mix(in srgb, var(--p2) 28%, transparent); }
.tool-thumb.ready { opacity:1; }
.tool-btn.on { color:var(--blue); }
/* ---- segmented control (sliding) ---- */
.seg-wrap { display:flex; padding:16px 24px 0; }
.seg { position:relative; display:inline-flex; gap:2px; background:rgba(118,118,128,.14); border-radius:12px; padding:3px;
        backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
        border:1px solid rgba(255,255,255,.5); max-width:100%; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
.seg::-webkit-scrollbar { display:none; }
.seg-thumb.ready { opacity:1; }
.seg-btn.active { color:var(--ink); }
/* A wave off the Import tab while the day's uploads are still outstanding.
         It stops the moment they land, and stops if you are already on the tab. */
/* Six waves, then a still ring. The notice stays; what stops is the one
         animation that would otherwise keep every frosted surface on the page
         re-blurring for as long as a report is outstanding. */
@keyframes segWave {
        0%   { transform:scale(1); opacity:.9; }
        70%,100% { transform:scale(1.28); opacity:0; }
      }
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
        padding:30px 32px 56px; max-width:1440px; margin:0 auto; }
/* No backdrop-filter here. A fixed, blurred element is a permanently compositing
         layer, which is a lot to pay for a version badge, and it fed the scroll shift. */
/* Left of the help button, not under it: the button is fixed at right:18px and
         46px wide, so a stamp in the same corner sat behind it. */
.version-stamp { position:fixed; right:74px; bottom:16px; z-index:20; pointer-events:none;
        font-size:10.5px; font-weight:600; letter-spacing:.06em; color:var(--ink-3);
        background:#F0F2F5; border:1px solid rgba(0,0,0,.06);
        padding:4px 9px; border-radius:20px;
        font-variant-numeric:tabular-nums; opacity:.7; }
.loading, .empty { padding:64px 24px; color:var(--ink-2); }
.noaccess-row b.mono { font-family:var(--font-mono); font-size:12px; }
/* ---- Frosting, and where it is worth paying for ----
         backdrop-filter re-blurs whatever is behind an element every time either
         one moves, and the living backdrop behind these never stops moving — so the
         blur can never be cached, and a page carrying two dozen cards was re-running
         it two dozen times a frame. Measured on this stylesheet, the repeated
         content surfaces alone were most of the cost of a scroll.

         What is behind them is a soft gradient, and the blur of a soft gradient is
         very nearly the gradient — so these keep the translucency, lose the blur,
         and carry a little more white to land in the same place. The frosted chrome
         (top bar, bottom bar, modals, drawers) keeps its real blur: there are only
         ever a few of those on screen, and they sit over CONTENT, where the blur is
         doing visible work. */
.card { background: rgba(255,255,255,.72); border:1px solid rgba(255,255,255,.7); border-radius:var(--radius);
        padding:22px 24px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85), 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(31,54,86,.07);
        margin-bottom:20px;
        transition: opacity .8s var(--ease), transform .8s var(--ease), box-shadow .4s var(--ease); }
/* Sections rise into place as they enter the viewport. Hover only deepens
         the shadow; lifting the card would fight the reveal's own transform. */
/* Colour arrives as a soft bloom out of the top-left corner rather than a
         bar down the edge. Same information, far less repetition down the page. */
.card { isolation:isolate; }
.card::after { content:""; position:absolute; inset:0; z-index:-1; pointer-events:none;
        border-radius:inherit;
        background: radial-gradient(108% 82% at 0% 0%, var(--tint, transparent), transparent 62%); }
.js-anim .card:not(.is-in) { opacity:0; transform: translateY(20px); }
/* And during a tool move the reveal TRANSITION is off entirely: if a card
         is ever marked late, it snaps into place inside the slide - invisible -
         instead of rising twenty pixels over most of a second. The vertical
         rise belongs to scrolling, never to a sideways move. */
.tool-move .card { transition: box-shadow .4s var(--ease); }
.card.is-in { opacity:1; transform:none; }
.card:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,.92), var(--shadow-3); }
/* ---- login ---- */
/* ---- the ground: blobs and a dot field, behind both screens ----
         One layer, continuing through the arrival rather than being swapped at
         the join. Fixed rather than absolute so it does not scroll away from the
         form on a short window. */
.sage-ground { position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
.sg-blobs { position:absolute; inset:0; }
/* Fixed, not absolute: the field is rendered by the sign-in screen now
         rather than by the ground, so it positions itself against the viewport
         instead of against a card that is 340px wide. Behind the form, above the
         blobs. */
/* z-index 0 is still a POSITIONED element, and positioned elements paint
         above the in-flow content of their stacking context — so the field was
         landing on top of the button and the labels rather than behind them. The
         card is given a layer of its own above it, which says the order outright
         instead of relying on document order to hold it. */
.sg-field { position:fixed; inset:0; z-index:0; pointer-events:none;
        /* The layer opens out of the same point the mark does. It used to scale
           about the middle of the viewport while the mark scaled about the logo,
           so the two sets of streaks were travelling on different lines even
           though each dot was aimed correctly. --jx/--jy are the mark's centre,
           measured on the press. */
        transform-origin: var(--jx, 50%) var(--jy, 50%); }
.sg-blob { position:absolute; display:block; border-radius:50%;
        animation: sgDrift 40s ease-in-out infinite alternate;
        /* Rasterised once and then only transformed. Without this each of the
           four is a large radial gradient repainted every frame it moves. */
        will-change: transform; }
/* The four clouds are light members of the Garden palette, so the sky the
         sign-in drifts under is the same sky the dashboard lands on. */
.sg-blob.b1 { width:760px; height:620px; left:-80px; top:-120px; animation-duration:34s;
        background: radial-gradient(circle at 40% 40%, rgba(203,220,205,0.62), transparent 68%); }
.sg-blob.b2 { width:820px; height:680px; right:-120px; bottom:-140px; animation-duration:52s;
        background: radial-gradient(circle at 55% 50%, rgba(206,219,209,0.58), transparent 68%); }
.sg-blob.b3 { width:620px; height:520px; right:60px; top:-180px; animation-duration:44s;
        background: radial-gradient(circle at 50% 50%, rgba(244,236,216,0.55), transparent 66%); }
.sg-blob.b4 { width:680px; height:560px; left:180px; bottom:-200px; animation-duration:38s;
        background: radial-gradient(circle at 50% 50%, rgba(222,233,224,0.50), transparent 68%); }
@keyframes sgDrift {
        from { transform: translate3d(0,0,0) scale(1); }
        to   { transform: translate3d(26px,18px,0) scale(1.12); }
      }
/* The field itself does not drift, and must not.
         It used to slide the whole sheet up to 26px over 28 seconds. The dots are
         handed to a canvas when the streaks start, and the canvas redraws them from
         their resting coordinates: it accounts for the gather's scale and knows
         nothing about the sheet's translate. So the field jumped by however far the
         drift had carried it at that instant, which is anywhere from nothing to the
         full 26px depending on where in the cycle somebody happened to sign in.
         A drift nobody asked for, at the one moment the eye is following the dots.
         The ambient motion lives where it costs nothing instead: the blobs behind
         drift on their own, and the bright third twinkles. */
.sg-dot { position:absolute; display:block; border-radius:50%; opacity:.26;
        background: currentColor;
        transform: translate(-50%,-50%); }
/* Only the bright third twinkles. The others are 2.6px at 0.26 opacity and
         nobody has ever seen one change; animating all 660 was two thirds of the
         cost of this screen for none of the effect. The handoff reached the same
         conclusion from the other direction when it cut the streaking dots to a
         third. */
.sg-dot.bright { animation: sgTwinkle 4s ease-in-out infinite alternate; }
@keyframes sgTwinkle { from { opacity:.26; } to { opacity:1; } }
/* ---- switching tools ----
         Three beats. The page leaves a block at a time in the direction of
         travel, the streaks cross, and the new tool arrives from the other side.
         Side to side, because the tools sit side by side in the bar. */
.tool-move .page > *, .tool-move .board-page > *, .tool-move .tab-page > * {
        will-change: auto; }
/* Out fast, in with weight. The exit is a flick — it is the part nobody
         needs to watch — and the arrival carries the inertia: each block comes in
         from the side, overshoots the resting point, and is pulled back, so it
         reads as having been thrown and stopped rather than placed. */
.tool-exit .page > *, .tool-exit .board-page > *, .tool-exit .tab-page > * {
        animation: toolOut .19s cubic-bezier(.5,0,.95,.35) both; }
.tool-enter .page > *, .tool-enter .board-page > *, .tool-enter .tab-page > * {
        animation: toolIn .56s cubic-bezier(.16,.86,.3,1) both; }
/* Element by element, and tighter than the first version: 22ms apart, so
         the blocks land in sequence without the last one arriving late. The last
         block's exit finishes at 66 + 190 = 256ms, which is what TOOL_EXIT is
         set from: swapping before that cut the last block mid-flight, and a
         block that disappears halfway through leaving is a flicker. */
.tool-move .page > *:nth-child(2), .tool-move .board-page > *:nth-child(2), .tool-move .tab-page > *:nth-child(2) { animation-delay:.022s; }
.tool-move .page > *:nth-child(3), .tool-move .board-page > *:nth-child(3), .tool-move .tab-page > *:nth-child(3) { animation-delay:.044s; }
.tool-move .page > *:nth-child(n+4), .tool-move .board-page > *:nth-child(n+4), .tool-move .tab-page > *:nth-child(n+4) { animation-delay:.066s; }
/* Going right: the old page leaves to the left and the new one comes in
         from the right. Going left, the mirror. */
.tool-dir-r { --tx-out:-64px; --tx-in:64px; --tx-slide:180px; }
.tool-dir-l { --tx-out:64px;  --tx-in:-64px; --tx-slide:-180px; }
@keyframes toolOut {
        from { opacity:1; transform:none; }
        to   { opacity:0; transform: translateX(var(--tx-out)); }
      }
/* The crash: past the resting point, squashed along the direction of
         travel at the moment of impact, then let go. */
/* A slide, full stop. No fade at all: the page arrives whole from the
         side it was sent from, and opacity never enters into it. */
@keyframes toolIn {
        0%   { opacity:1; transform: translateX(var(--tx-slide, var(--tx-in))) scaleX(1); }
        62%  { transform: translateX(calc(var(--tx-out) * .16)) scaleX(1.014); }
        82%  { transform: translateX(calc(var(--tx-in) * .045)) scaleX(.995); }
        92%  { transform: translateX(calc(var(--tx-out) * .015)) scaleX(1.001); }
        100% { opacity:1; transform:none; }
      }
/* Nothing that says "loading" belongs in the middle of a move. The new
         tool is fetching underneath, and a spinner appearing between the streaks
         and the page arriving is the join made visible — which is the one thing
         the whole sequence exists to hide. */
.tool-move .loadscreen, .tool-move .loading, .tool-move .sage-loading,
      .tab-move .loadscreen, .tab-move .loading, .tab-move .sage-loading { opacity:0 !important; }
/* Whole pages move too, not only their blocks. An animation rather than a
         transition: .page carries its own mount animation, and an animation wins
         over a transition on the same property, so a transition here would have
         been silently ignored on exactly the pages it was written for. */
/* No pageIn in these lists. On a tool switch the page is FRESHLY MOUNTED,
         so listing pageIn first does not preserve a running animation - it
         INTRODUCES one: a ten-pixel rise and a .38s fade running against the
         slide. That was the "still rising, still fading in" on the blocks that
         are not cards. The moved page slides; the rise belongs to ordinary
         mounts only. */
.tool-exit .page {
        animation: pageOut .26s cubic-bezier(.4,0,.9,.3) both; }
.tool-exit .board-page, .tool-exit .tab-page {
        animation: pageOut .26s cubic-bezier(.4,0,.9,.3) both; }
@keyframes pageOut {
        from { transform:none; opacity:1; }
        to   { transform: translateX(calc(var(--tx-out) * .35)); opacity:1; }
      }
/* And the same on the way in. This was the missing half: the page's own
         mount animation, pageIn, a lift from the bottom, was still running
         underneath blocks that were arriving from the side, so the page rose
         while its contents slid — two moves at once, in different directions,
         which is what read as a flicker rather than a landing. The whole page
         now travels the same axis as its blocks and decelerates into place with
         them. */
.tool-enter .page {
        animation: pageLand .56s cubic-bezier(.16,.86,.3,1) both; }
.tool-enter .board-page, .tool-enter .tab-page {
        animation: pageLand .56s cubic-bezier(.16,.86,.3,1) both; }
@keyframes pageLand {
        from { transform: translateX(calc(var(--tx-in) * .35)); opacity:1; }
        to   { transform:none; opacity:1; }
      }
@media (prefers-reduced-motion: reduce) {
        .tool-exit .page > *, .tool-enter .page > *, .tool-exit .board-page > *, .tool-enter .board-page > *,
        .tool-exit .tab-page > *, .tool-enter .tab-page > * { animation-duration:.14s !important; }
        .tool-exit .page, .tool-exit .board-page, .tool-exit .tab-page { animation:none !important; }
      }
/* ---- a section tab: the same move, smaller ----
         Two beats now, matching a tool switch: out, swap, in. It used to be one,
         and half a move is what a flicker IS — the old content vanished on the
         click and only the arriving half was drawn. */
.tab-exit .page > *, .tab-exit .board-page > *, .tab-exit .tab-page > * {
        animation: tabOut .14s cubic-bezier(.45,0,.9,.4) both; }
.tab-enter .page > *, .tab-enter .board-page > *, .tab-enter .tab-page > * {
        animation: tabIn .4s cubic-bezier(.16,.86,.3,1) both; }
.tab-move .page > *:nth-child(2), .tab-move .board-page > *:nth-child(2), .tab-move .tab-page > *:nth-child(2) { animation-delay:.016s; }
.tab-move .page > *:nth-child(3), .tab-move .board-page > *:nth-child(3), .tab-move .tab-page > *:nth-child(3) { animation-delay:.032s; }
.tab-move .page > *:nth-child(n+4), .tab-move .board-page > *:nth-child(n+4), .tab-move .tab-page > *:nth-child(n+4) { animation-delay:.048s; }
@keyframes tabOut {
        from { opacity:1; transform:none; }
        to   { opacity:0; transform: translateX(var(--tabx-out)); }
      }
/* Overshoots a little and is pulled back, so it lands rather than stops.
         No opacity step after the first: fading a block in while it is still
         travelling is what made the arrival read as a dissolve. */
@keyframes tabIn {
        0%   { opacity:0; transform: translateX(var(--tabx-in)); }
        34%  { opacity:1; }
        72%  { transform: translateX(calc(var(--tabx-in) * -.08)); }
        100% { opacity:1; transform:none; }
      }
/* Sideways only. The page's own mount animation lifts from the bottom,
         which is right when a page arrives and wrong when it slides one step
         along a strip. The whole page travels with its blocks instead, a third
         of their distance, so the move has a body under it and not only edges.
         All three page classes: naming only .page was why a board still jumped
         up from the bottom mid-slide. */
/* ---- why every one of these rules re-lists pageIn first ----
         .page carries its own mount animation. Replacing the animation on it for
         the length of a move CANCELS that one, and putting it back when the move
         ends starts it AGAIN from zero: the page fell to opacity 0 and lifted ten
         pixels off the bottom the instant the slide finished, every single time.
         That second, unasked-for mount is what read as a flicker at the end of a
         side-to-side move, and it is why the landing never landed.

         An animation is matched to the one it replaces BY NAME and position in
         the list, so keeping pageIn at index 0 and adding the move's animation
         after it means pageIn is never cancelled and never restarted; it is long
         finished by then and contributes nothing, while the move's animation sits
         later in the list and wins on the properties they share. */
/* ---- and pageIn is re-listed for .page ONLY ----
         Because .page is the only one that has it. Naming .board-page and
         .tab-page here did not preserve a running animation, it INTRODUCED one:
         pageIn starts from opacity 0, so the board faded in from transparent
         every time a tab was pressed, over the whole move. That is the flicker.
         The trick is only ever valid for an element that already carries the
         animation being re-listed. */
.tab-exit .page {
        animation: pageIn .38s var(--spring), tabPageOut .14s cubic-bezier(.45,0,.9,.4) both; }
.tab-enter .page {
        animation: pageIn .38s var(--spring), tabPageIn .42s cubic-bezier(.16,.86,.3,1) both; }
.tab-exit .board-page, .tab-exit .tab-page {
        animation: tabPageOut .14s cubic-bezier(.45,0,.9,.4) both; }
.tab-enter .board-page, .tab-enter .tab-page {
        animation: tabPageIn .42s cubic-bezier(.16,.86,.3,1) both; }
/* ---- and every one of these pins opacity ----
         .page is keyed on the tab, so React gives it a NEW element on every
         switch and pageIn starts fresh on it — the container fading up from
         nothing over the whole move, under blocks that are doing their own fade.
         Re-listing pageIn cannot preserve what was never running.

         Pinning opacity here is what settles it: these sit after pageIn in the
         list, so they win on opacity as well as transform for as long as they
         run, and pageIn is finished before they are. The container never fades,
         the blocks still do, and when the move classes come off pageIn is at
         index 0, already over, and does not restart. */
@keyframes tabPageOut {
        from { transform:none; opacity:1; }
        to   { transform: translateX(calc(var(--tabx-out) * .34)); opacity:1; }
      }
@keyframes tabPageIn {
        from { transform: translateX(calc(var(--tabx-in) * .34)); opacity:1; }
        to   { transform:none; opacity:1; }
      }
@media (prefers-reduced-motion: reduce) {
        .tab-move .page > *, .tab-move .board-page > *, .tab-move .tab-page > * { animation-duration:.12s !important; }
      }
/* ---- the streaks that cross between them ---- */
.warp { position:fixed; inset:0; z-index:8000; pointer-events:none; overflow:hidden; }
.warp i { position:absolute; display:block; border-radius:2px; opacity:0; }
/* Jorge's spec, verbatim: "if the button is selected on the right the
         streaks would start from the right of the screen and then end left
         screen and vice versa." So travelling right along the bar, the trails
         enter from the right edge and sweep across to the left. */
.warp-r i { right:-720px; animation: warpL .3s cubic-bezier(.4,0,.2,1) both; }
.warp-l i { left:-720px; animation: warpR .3s cubic-bezier(.4,0,.2,1) both; }
@keyframes warpR {
        0%   { transform: translateX(0);              opacity:0; }
        30%  {                                        opacity:.9; }
        100% { transform: translateX(calc(100vw + 760px)); opacity:0; }
      }
@keyframes warpL {
        0%   { transform: translateX(0);              opacity:0; }
        30%  {                                        opacity:.9; }
        100% { transform: translateX(calc(-100vw - 760px)); opacity:0; }
      }
/* ---- a metric card blooms from the dot that was pressed ---- */
.mdial-pop { transform-origin: bottom center; }
.mdial:hover .mdial-pop, .mdial.popped .mdial-pop {
        animation: mBloom .42s cubic-bezier(.34,1.5,.64,1) both; }
@keyframes mBloom {
        from { opacity:0; transform: translateX(-50%) scale(.24); }
        to   { opacity:1; transform: translateX(-50%) scale(1); }
      }
/* ---- a person's detail rises from their row, its cards behind it ---- */
/* The real class is .detail — the sheet a row opens into. */
.detail { animation: sheetRise .42s cubic-bezier(.34,1.4,.64,1) both; }
.detail > * { animation: saArrive .34s cubic-bezier(.34,1.4,.64,1) both; }
/* Used by the detail sheet's inner cards, and only there now: the arrival's
         landing flies its blocks out of a point instead (see saRadial), so this
         is no longer part of that sequence. */
@keyframes saArrive {
        from { opacity:0; transform: scale(.94); }
        to   { opacity:1; transform:none; }
      }
.detail > *:nth-child(1) { animation-delay:.06s; }
.detail > *:nth-child(2) { animation-delay:.12s; }
.detail > *:nth-child(3) { animation-delay:.18s; }
.detail > *:nth-child(n+4) { animation-delay:.24s; }
@keyframes sheetRise {
        from { opacity:0; transform: translateY(-10px) scaleY(.96); transform-origin: top center; }
        to   { opacity:1; transform:none; }
      }
/* ---- saving: one dot, pulsing ---- */
.save-dot { display:inline-flex; align-items:center; gap:7px; font-size:12px; color:var(--ink-3);
        animation:none; }
.save-dot::before { content:""; width:7px; height:7px; border-radius:50%; background:#2F7F72;
        animation: saveDot .9s ease-in-out infinite; }
@keyframes saveDot {
        0%, 100% { opacity:.25; transform:scale(.8); }
        50%      { opacity:1;   transform:scale(1.15); }
      }
@media (prefers-reduced-motion: reduce) {
        .warp, .detail, .detail > *, .mdial-pop { animation:none !important; }
        .save-dot::before { animation-duration:2.4s !important; }
      }
/* ---- the arrival ----
         Every selector below points at something that was already on the screen.
         There is no overlay and no second mark: the thing that gathers and flies
         apart is the sign-in screen itself. */
/* Hold: the form goes, the mark stays. It is the only thing that survives
         into the jump, so it is the only thing that does not fade. */
.sage-beat-stretch .login-card > *:not(.login-logo),
      .sage-beat-flash .login-card > *:not(.login-logo) {
        opacity:0; pointer-events:none; transition: opacity .42s ease; }
/* ---- the wave has to STOP, and .login-card is why this selector is long ----
         Pressing Sign in sets .login-busy, which runs markWork across the mark.
         .login-busy .login-logo circle and .sage-beat-stretch .login-logo
         circle have identical specificity and the login block is further down
         this sheet, so the wave won.

         That is not a cosmetic loss. A RUNNING ANIMATION beats a declared
         transform outright, whatever the specificity — so every streak rule below
         was silently ignored and the mark sat pulsing while the layer around it
         scaled. The whole jump had no mark in it. Adding .login-card takes this
         to four classes against three, the wave stops, and the transforms below
         are free to apply.

         It only shows up on the real press path: setting the beat classes by hand
         never sets .login-busy, so every harness run of this looked right. */
.sage-beat-stretch .login-card .login-logo circle, .sage-beat-flash .login-card .login-logo circle {
        animation: none;
        /* And the origin with it, for the same reason: the breathe sets it to
           center, further down this sheet, and a streak scaled about its middle
           grows out of both ends and detaches from the mark. It has to pivot on
           the near end. */
        transform-origin: left center; }
/* Nothing may clip the streaks: they leave the mark's box within about
         80ms and the frame within 900. */
.sage-beat-stretch .login, .sage-beat-flash .login { overflow: visible; }
.login-logo svg { overflow: visible; }
/* ---- the mark's own dots become the streaks ----
         Rotated to each dot's angle out of the middle of the mark, origin at the
         near end, scaled along X only. No translate in the stretch: the near end
         stays exactly where the dot was, so nothing detaches from the mark and
         re-attaches somewhere else.

         --a, --d and --dr are published by SageMark for every dot: its angle out
         of the centre, its distance from it and its radius, all in viewBox units.
         The length each streak has to travel is worked out from those, so the
         geometry is the mark's and the motion is the stylesheet's.

         The mark on this screen is small — 64px tall, sitting above centre — and
         that is deliberately where the streaks start, because that is where the
         logo is. A dot 300 user units long clears a 1440x900 frame from anywhere
         inside it, and the far ends are gone well before anything snaps. */
.login-logo circle { transform-box: fill-box; transform-origin: left center; }
/* ---- the whole lockup condenses as one ----
         The gather used to draw each dot in along its own radius, scaled by how
         far it sat from the middle of the lockup — and that middle falls inside
         the "a", so the S was always the thing furthest out and always the thing
         pulled hardest. Capping the distance helped and did not fix it: any
         per-dot pull distorts the word, because the letters are not equidistant
         from its centre.

         So there is no per-dot pull at all now. The mark condenses at ONE rate,
         as a single piece, toward the point the streaks come out of — which is
         its own centre, which is what the layer's scale already does. Each dot
         still squashes along its own axis by the same amount, priming the streak
         it is about to become, and that is uniform so it cannot distort anything. */
/* .login-busy also runs loginLogoRise on the wrapper; same collision, same
         cure, so the mark's layer can be scaled by the beats. */
.sage-beat-stretch .login-card .login-logo, .sage-beat-flash .login-card .login-logo {
        animation: none; }
.sage-beat-stretch .login-logo circle, .sage-beat-flash .login-logo circle {
        transform: rotate(var(--a)) scaleX(calc((900 + var(--d) * 2.4) / var(--dr) / 2));
        transition: transform .88s cubic-bezier(.6,0,.9,.24); }
.sage-beat-stretch .login-logo svg {
        transform: scale(2.6); transition: transform .88s cubic-bezier(.6,0,.9,.24); }
/* And out. The near end of every streak is pinned to its dot, so the layer
         is the only thing that can carry them off the frame — at 2.6 they were
         still anchored to the middle of the screen when the beat ended, and a
         starburst that stops is what reads as the stutter. It keeps going through
         the flash, which is under the white by then. */
.sage-beat-flash .login-logo svg {
        transform: scale(9); transition: transform .34s cubic-bezier(.5,0,.85,.4); }
/* ---- and then it stops being painted ----
         73 streaks, each the size of the screen and then some, are expensive to
         rasterise, and they carry on costing that for the whole flash even though
         the white is over them and their far ends left the frame long ago.
         Measured in the built app, it is not a rounding error: 505ms of blocked
         main thread with the mark still painting against 28-61ms with it hidden.
         That single number was most of the pause at the join.

         Hidden rather than faded, and 90ms late rather than at once: the white
         reaches full at 88ms, so this lands just behind it and nothing is seen to
         go. visibility, so the transition delay can hold it — display cannot be
         timed this way. */
.sage-beat-flash .login-logo {
        visibility:hidden; transition: visibility 0s linear .09s; }
/* The eyebrow is not part of the mark and should not fly with it. */
.sage-beat-stretch .login-eyebrow, .sage-beat-flash .login-eyebrow { opacity:0; }
/* ---- the flash across the snap ----
         At the root, above both screens: the handover it covers IS the moment one
         replaces the other, so mounted inside either it would be destroyed by the
         swap it exists to hide. */
/* ---- the arrival engine's canvas ----
         Above the sign-in layer (200), under the flash (9500). While it is up,
         the DOM copies of what it draws — the dot field and the mark — are
         hidden, so no dot ever exists twice. The form and the blobs stay DOM:
         the engine moves them directly. */
.sage-jump-canvas { position:fixed; inset:0; z-index:300; pointer-events:none; }
.sage-cv .sg-field, .sage-cv .login-logo svg { visibility:hidden; }
/* ---- the white lasts as long as what it is covering ----
         It used to be a fixed 420ms from the flash beat, and the thing it exists
         to hide is not fixed at all: mounting the dashboard took 680ms, so the
         white rose, fell, and was long gone before the page arrived. What you saw
         was the streaks stop, a flash, the flash clear to reveal the SAME stopped
         streaks, and then the page. That is the stutter at the join.

         So it rises and holds, and only starts to clear once the dashboard is
         actually there — .sage-assemble is added on the frame it mounts. Both
         rules fill forwards and the out starts from full, so the handover
         between them cannot show a seam however long the mount takes. */
@keyframes saFlashUp { 0% { opacity:0; } 26%, 100% { opacity:1; } }
@keyframes saFlashOut { from { opacity:1; } to { opacity:0; } }
/* ---- the ground goes with it: gathered in, blown out, then back to drifting ----
         Written as animations, with the field's own 28s drift kept first in every
         list. It has to be: the drift is an ANIMATION on transform, and an
         animation beats a declared transform and a transition alike, so the first
         version of these rules did nothing at all — the field sat still through
         the whole jump while the mark flew apart around it. Same trap as the page
         mount animation, same way out: keep the running one at index 0 so it is
         never cancelled, and put the beat's animation after it, where it wins. */
/* Nothing to preserve at index 0 any more: the field carries no animation of
         its own, so this introduces the only one it ever runs. */
@keyframes fieldGather { from { transform:none; } to { transform:scale(.86); } }
/* ---- the blobs part like cloud ----
         Each one moves OUT of the frame in the direction it already sits, rather
         than the four of them scaling together as one sheet. A sheet that grows
         is a zoom; four masses drifting apart and thinning is weather being
         pushed aside, which is what flying through it should look like.

         Written as animations with each blob's own 34-52s drift kept first in the
         list, for the same reason the field's rules are: sgDrift is an animation
         on transform, so a plain transform here would have been ignored outright.
         And the corner each one is pushed toward is the corner it lives in — see
         the .sg-blob geometry above. */
.sage-beat-stretch .sg-blob, .sage-beat-flash .sg-blob {
        animation: sgDrift 40s ease-in-out infinite alternate,
                   blobPart .88s cubic-bezier(.44,0,.7,.5) both; }
/* Each blob keeps its OWN drift duration alongside the new one. The
         shorthand above would otherwise reset all four to 40s, and changing a
         running animation's duration moves it to a different point on its own
         timeline — the blobs would jump before they parted. */
.sage-beat-stretch .sg-blob.b1, .sage-beat-flash .sg-blob.b1 { --bx:-38%; --by:-30%; animation-duration:34s,.88s; }
.sage-beat-stretch .sg-blob.b2, .sage-beat-flash .sg-blob.b2 { --bx: 38%; --by: 32%; animation-duration:52s,.88s; }
.sage-beat-stretch .sg-blob.b3, .sage-beat-flash .sg-blob.b3 { --bx: 34%; --by:-34%; animation-duration:44s,.88s; }
.sage-beat-stretch .sg-blob.b4, .sage-beat-flash .sg-blob.b4 { --bx:-34%; --by: 36%; animation-duration:38s,.88s; }
/* They thin, they do not disappear. At 0.14 and pushed 58% out, all four
         had left the frame by the peak of the jump and the ground under the
         streaks went flat white. Cloud that has been pushed aside is still
         cloud. */
@keyframes blobPart {
        from { transform: translate3d(0,0,0) scale(1); opacity:1; }
        to   { transform: translate3d(var(--bx,0), var(--by,0), 0) scale(1.5); opacity:.34; }
      }
/* And back in as the dashboard lands, on the same deceleration as the rest
         of the ground, so the weather closes over the join rather than snapping
         back into place after it. */
.sage-beat-assemble .sg-blob {
        animation: sgDrift 40s ease-in-out infinite alternate,
                   blobGather 1.3s cubic-bezier(.12,.78,.28,1) both; }
.sage-beat-assemble .sg-blob.b1 { animation-duration:34s,1.3s; }
.sage-beat-assemble .sg-blob.b2 { animation-duration:52s,1.3s; }
.sage-beat-assemble .sg-blob.b3 { animation-duration:44s,1.3s; }
.sage-beat-assemble .sg-blob.b4 { animation-duration:38s,1.3s; }
@keyframes blobGather {
        from { transform: translate3d(var(--bx,0), var(--by,0), 0) scale(1.5); opacity:.34; }
        to   { transform: translate3d(0,0,0) scale(1); opacity:1; }
      }
/* No stretch rules for the DOM field at all: at that beat it is not in the
         document, having handed the whole thing over to the canvas. */
/* ---- square corners for the length of the jump ----
         This one line is the difference between the arrival running and the
         arrival being a slideshow. A field dot is a 2.6px circle, and a circle is
         border-radius:50% — so a dot stretched eighty times along its own axis is
         a long thin ELLIPSE, and 660 large ellipses have to be rasterised every
         frame. Measured in the built app, three runs each: as shipped, 39-47
         frames with stalls of 667-883ms; with the radius dropped, 59-61 frames
         and not one stall over 200ms, against 82-85 frames with no field at all.
         Every stall came from the corners.

         Nothing is lost. At 2.6px tall the rounding was never visible, and it is
         only dropped while the dots are streaks; the idle field keeps its
         circles. This is the same cost the handoff hit from the other side, when
         it cut the streaking dots to a third to buy the frames back — the corners
         are the cheaper thing to give up, and they buy more. */
/* ---- a streak, not a stretched dot ----
         The handoff draws every streak as a pill, tapering to nothing at both
         ends, and a scaled square dot is a blunt dash instead. Neither shape can
         be afforded as 660 DOM elements though — measured in the built app,
         gradient-tapered it managed 23-38 frames a jump with stalls up to a
         second, as pills 44-47, and only as flat rectangles did it run clean.
         So for the beat that needs them the streaks are drawn on a canvas
         instead, properly tapered and at frame rate. See SageStreaks. */
.sg-streaks { position:fixed; left:0; top:0; z-index:0; pointer-events:none; }
/* The blobs stretch too, rather than merely swelling: pulled long along
         the direction of travel and left bright enough to be the colour the
         streaks are flying through. */
/* ---- and out the other side ----
         Coming out of lightspeed rather than cutting to a still page: the field
         and the blobs decelerate back to rest over the same window the dashboard
         lands in, so the last beat is one continuous move instead of a stop
         followed by a start. */
/* No landing rules for the field: it does not survive the handover, so
         there is nothing to bring back. Decelerating 660 dots out of full streak
         while React mounted the dashboard is what made the landing choppy —
         measured in the built app, stalls of 467-983ms with the field there and
         none at all without it. */
/* Only the bright eighth streaks. The rest ride the layer's own scale,
         which is what bought the density back. */
/* ---- the dashboard coming out of the jump ----
         Built outward from the middle of the FRAME. The first version had every
         element rise from below, which is the app's ordinary mount and reads as a
         page loading normally after an animation rather than as the end of one.
         The second oversized the page and shrank it back, which pulls everything
         INWARD — the opposite of assembling out of a centre — and, anchored at
         the page's own middle rather than the viewport's, dragged the top of the
         layout off the screen. That is the clipped nav.

         So: contracted toward one point and expanding away from it, with the
         origin at half the viewport height rather than half the page's. The page
         starts at scroll 0 when this runs, so 50vh from the top of the container
         is the middle of what the eye is looking at, whatever the page's own
         height turns out to be. Everything travels outward from there. */
/* ---- the dashboard comes out of the point the streaks left from ----
         Not a fade, and not a scale in place. Every block starts AT the vanishing
         point, small, and flies out along its own line to where it belongs — the
         near ones first, the far ones sweeping out behind them. Coming out of
         lightspeed rather than a page loading after an animation.

         --rx/--ry are the vector from the block to that point, measured once when
         the dashboard mounts (see radialAssemble); --rd is its turn, by distance.
         Held invisible until then, so nothing is seen sitting in its final place
         before it has been given its line.

         The page itself no longer moves. It used to scale out of the middle of
         the frame, and a parent transform would have scaled these vectors along
         with it — the blocks would have flown to the wrong places. */
/* No class holding the blocks invisible any more, because nothing is
         waiting: they are measured and given their lines in a layout effect,
         before the browser paints them for the first time. Anything that skips
         the radial pass — reduced motion, an empty selector — simply gets the
         blocks as they are, rather than a screen of nothing. */
/* The page holds still while its blocks fly. It has a mount animation of
         its own — pageIn, a lift from below — and it was running underneath the
         landing, so the whole layout drifted upward while every block inside it
         was travelling outward. Two movements, different directions, which is the
         choppiness. saStill sits after pageIn in the list and pins the properties
         they share; pageIn stays at index 0 so that dropping .sage-assemble at
         the end does not restart it. */
.sage-assemble .page, .sage-assemble .board-page, .sage-assemble .tab-page {
        animation: pageIn .38s var(--spring), saStill 1.5s linear both; }
@keyframes saStill { from, to { transform:none; opacity:1; filter:none; } }
/* The handoff's own landing spring, cubic-bezier(.34,1.6,.64,1) — the one it
         uses for every dot that lands. 1.6 overshoots: each block flies past
         where it belongs and is pulled back, which is what makes it read as
         having been thrown out of the point rather than eased into place. The
         curve it replaced had no overshoot at all. */
/* Born as a point at the centre, visible almost at once, so the whole
         journey out is watched rather than inferred; a 10% overshoot past home
         and a settle back is the impact. Staggered by distance (--rd), so the
         middle strikes first and the hit propagates outward. */
.sage-assemble .sa-radial {
        opacity:0;
        animation: saRadial .68s cubic-bezier(.16,0,.3,1) both;
        animation-delay: var(--rd, 0ms); }
/* No shadow while a block is in flight - a scaled shadow re-rasterising at
         the end is the "click" - and a soft bloom the moment it lands. */
.sage-assemble .sa-radial:not(.sa-shadowin) { box-shadow:none !important; }
.sa-radial.sa-shadowin { transition: box-shadow .45s ease; }
@keyframes saRadial {
        0%   { opacity:0; transform: translate3d(calc(var(--rx,0px) * .94), calc(var(--ry,0px) * .94), 0) scale(.10); }
        12%  { opacity:1; transform: translate3d(calc(var(--rx,0px) * .83), calc(var(--ry,0px) * .83), 0) scale(.20);
               animation-timing-function: cubic-bezier(.2,.7,.3,1); }
        66%  { opacity:1; transform: translate3d(calc(var(--rx,0px) * -.10), calc(var(--ry,0px) * -.10), 0) scale(1.06);
               animation-timing-function: cubic-bezier(.3,0,.4,1); }
        100% { opacity:1; transform: none; }
      }
/* A page reload holds every flying part invisible until the mount is done
         and the radial flight begins; each part's own animation then takes over. */
.refresh-hold :is(.topbar, .app-header, .seg-wrap, .hero, .card, .empty, .sect-strip, .bp-hero, .bp-stand, .co-tools, .co-grp, .fr-page, .pl-miss, .cx-card, .sm-chs, .pe-card) { opacity:0; }
.refresh-flash { position:fixed; inset:0; z-index:80; pointer-events:none;
        background:radial-gradient(circle at 50% 46%, rgba(255,255,255,.95), rgba(169,196,172,.35) 26%, transparent 46%);
        animation:refreshFlash .62s cubic-bezier(.2,.7,.3,1) both; }
@keyframes refreshFlash {
        0%   { opacity:0; transform:scale(.18); }
        16%  { opacity:1; }
        100% { opacity:0; transform:scale(2.4); }
      }
/* The whole page takes the hit: one breath out from the centre. */
.sage-assemble .lpc { animation: saBreath .34s cubic-bezier(.2,.6,.3,1) .12s both;
        transform-origin: var(--jx, 50%) var(--jy, 46%); }
@keyframes saBreath { from { transform: scale(1.022); } to { transform: none; } }
/* And the clouds settle back down around the landing - drifting in from
         above, slower than the furniture, the way cloud comes down around
         something arriving. The container carries ONLY the drop: putting
         opacity on it flattened all four blobs into one texture for the length
         of the animation, and the snap back to separate layers at the end was
         a visible click. Each blob fades itself instead, its own infinite
         drift kept at index 0 so it is never cancelled, and every clock here
         ends well before the landing classes come off - an animation cut
         mid-flight by the cleanup is the other click. */
/* The clouds do not fade AT ALL. Every faded version had the same tell:
         while a translucent cloud descends over the saturated living background,
         the region reads as the background's colour first and the cloud's pastel
         second - one colour switching to another. Full colour from the first
         frame, only the descent animating, and the white flash covers the mount.
         The blobs' own drifts are never touched, so nothing is cancelled. */
.sage-assemble .sg-blobs { animation: saCloudDrop 1.15s cubic-bezier(.16,.6,.22,1) .05s backwards; }
@keyframes saCloudDrop { from { transform: translateY(-190px) scale(1.05); } to { transform: none; } }
/* ---- the health ring's landing flourish ----
         Jorge's spec: when it lands it fills all the way up, empties back to
         zero, and then fills to the real percentage. ringIn is kept at index 0
         so the ordinary mount animation is never cancelled and restarted by the
         class flip - it finished under the streaks and simply holds - while
         saRing rides on top for exactly the landing window and hands back to
         the finished ringIn when the assemble classes come off. The old version
         swapped animations twice and snapped both times; that was the glitch. */
/* ---- the little light they come out of ----
         Sits at the vanishing point once the streaks have gone, swells, and is
         gone by the time the blocks have cleared it. */
/* Keyed to the assemble alone: under a held flash the spark would be
         invisible anyway, and it is the thing the blocks come out of, so it
         belongs on the far side of the white with them. */
@keyframes saSpark {
        0%   { opacity:0; transform: scale(.2); }
        18%  { opacity:1; transform: scale(2.6); }
        55%  { opacity:.9; transform: scale(5); }
        100% { opacity:0; transform: scale(13); }
      }
@keyframes saRing {
        0%   { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: var(--cc); }
        34%  { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: 0; }
        42%  { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: 0; }
        68%  { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: var(--cc); }
        74%  { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: var(--cc); }
        100% { stroke-dasharray: var(--cc) var(--cc); stroke-dashoffset: calc(var(--cc) - var(--c)); }
      }
@media (prefers-reduced-motion: reduce) {
        /* Everything collapses to a cross-fade. The order is kept; the movement
           goes. */
        .login-logo circle, .login-logo svg, .sg-field, .sg-dot,
        .sage-ground .sg-blobs { transition-duration:.18s !important; animation:none !important; }
        .sage-assemble .sa-radial  { animation-duration:.18s !important; animation-timing-function:linear !important; }

      }
/* ---- the sign-in layer ----
         Sits over the app rather than instead of it, so the dashboard can be
         mounting underneath while the streaks are still flying. Transparent: the
         ground belongs to the app's shell and shows straight through, which is
         also why there is only ever one set of blobs and they never jump at the
         handover. Everything else under it is hidden — visibility rather than
         display, so the layout is real and the blocks can be measured for their
         landing while they are still out of sight. */
.signin-over { position:fixed; inset:0; z-index:200; overflow:auto; }
html.jump-under .lpc > *:not(.sage-ground) { visibility:hidden; }
/* the stall is the one thing that has to show while the app is still
         under the jump: it is the reason nothing else has arrived */
html.jump-under .lpc > .boot-stall, html.jump-under .lpc > .boot-slow { visibility:visible; }
/* And it must not scroll either. The app underneath is hidden but still
         laid out, so it was giving the document a scrollbar on a screen with
         nothing scrollable on it — and a scrollbar shifts the centre of every
         fixed layer by its own width. */
html.jump-under, html.jump-under body { overflow:hidden; }
/* Gone the instant the handover happens, rather than when React next
         renders: the beats that were hiding the form come off at the same moment,
         and without this the sign-in form would reappear over the landing. */
html.signin-gone .signin-over { display:none; }
/* ---- centred, and centred on the actual middle ----
         Two things were off. It was top-aligned with 80px of padding, so on a
         tall screen the form sat high with the rest of the page empty under it —
         the handoff puts it centred on the ground. And the app is mounted behind
         this layer, hidden but still laid out, so the document had a scrollbar:
         that narrows the viewport by its own width and the fixed layer with it,
         which is why the form was a few pixels left of where it looked like it
         should be.

         margin:auto rather than align-items:center, because a tall form — the
         four-field sign-up on a short screen — has to be able to scroll instead
         of having its top cut off, and align-items:center cuts. */
.login { position:relative; z-index:1; display:flex; justify-content:center;
        padding-top:var(--sat); padding-bottom:var(--sab);
        /* border-box, because this sheet sets no global box-sizing and the
           padding was being ADDED to the 100%: an 980px box inside a 900px
           layer, which is what made the screen scroll and put the form 40px
           below the middle. */
        box-sizing:border-box; padding:40px 20px; min-height:100%; }
/* No card. The form sits on the ground, 340px wide, centred. */
.login-card { width:340px; margin:auto 0; position:relative; z-index:1;
        text-align:center; background:none; border:0; box-shadow:none; padding:26px 0;
        animation: loginIn .5s var(--spring); }
.login-eyebrow { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.16em;
        text-transform:uppercase; color:#6E6E76; margin:0 0 22px; }
@keyframes loginIn { from { opacity:0; transform: translateY(16px) scale(.97); } to { opacity:1; transform:none; } }
/* Signing in: the form and the card chrome gracefully fade out, leaving just the
         spinning speedometer and title — so the jump to the full loading screen is seamless. */
.login-card.login-busy { background:transparent; border-color:transparent; box-shadow:none; }
.login-card.login-busy .login-logo { animation: loginLogoRise .5s var(--spring) both; }
@keyframes loginLogoRise { from { transform: translateY(0); } to { transform: translateY(-4px) scale(1.05); } }
/* ---- the mark is alive on this screen ----
         Every dot carries --i, its own place in the mark's left-to-right order,
         so a wave can cross the wordmark without the stylesheet knowing anything
         about the pattern. Idle it breathes; signing in it runs, which is what
         replaced the spinner.

         Scale, never opacity: a dot the form has not reached yet is drawn at
         opacity 0, and animating opacity here would light up the part of the
         word that is meant to be still dark. */
.login-logo circle { transform-box: fill-box; transform-origin: center;
        /* Each dot fades up as the form reaches it rather than appearing on the
           keystroke. Straight from the handoff, which puts opacity 240ms ease on
           every dot of the build. */
        transition: opacity .24s ease; }
/* ---- one breath, not seventy-three ----
         This used to animate every circle's transform on its own offset, which
         means repainting the whole SVG every frame, forever, on a screen where
         nothing is happening. It is the same life for a seventy-third of the
         cost: one element, one composited transform.

         On the wrapper rather than the <svg>, because the jump drives the svg's
         transform and an animation would beat those outright. The rule that
         stops loginLogoRise during the beats stops this with it. */
.login-logo { animation: markBreathe 5.4s ease-in-out infinite; }
@keyframes markBreathe {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(.972); }
      }
/* Signing in: one pass of the wave every 1.15s, left to right across the
         word, so the wait has a direction instead of a spin. */
.login-busy .login-logo circle {
        animation: markWork 1.15s cubic-bezier(.4,0,.3,1) infinite;
        animation-delay: calc(var(--i) * 11ms); }
@keyframes markWork {
        0%, 62%, 100% { transform: scale(1); }
        24%           { transform: scale(1.34); }
      }
/* ---- underline fields ---- */
/* Two selectors deep: .login-card label already sets display:block at the
         same specificity, and the row would lose the coin toss. */
.login-card .lf-label { display:block; text-align:left; font-size:12px; font-weight:600;
        color:#7A7A80; margin:22px 0 0; }
.login-card .lf-label-row { display:flex; align-items:baseline; justify-content:space-between; }
.lf-forgot { background:none; border:0; padding:0; cursor:pointer; font:inherit;
        font-size:12px; font-weight:600; color:#6B8E5A; }
.lf-forgot:hover { text-decoration:underline; }
/* Same reason. The app's global input rule paints a bordered, rounded field
         and a focus ring around it; underline-only has to outrank both. */
.login-card input.lf-in { width:100%; box-sizing:border-box; background:none; border:0;
        border-bottom:1.5px solid #C9CBC9; border-radius:0; padding:0 0 9px; margin:6px 0 0;
        font-size:16px; color:#2E3A32; outline:none; box-shadow:none;
        transition: border-color .2s var(--ease); }
.login-card input.lf-in:focus { border:0; border-bottom:1.5px solid #2F7F72;
        outline:none; box-shadow:none; }
.login-card select.lf-sel { width:100%; box-sizing:border-box; background:none; border:0;
        border-bottom:1.5px solid #C9CBC9; border-radius:0; padding:0 0 9px; margin:6px 0 0;
        font:inherit; font-size:16px; color:#2E3A32; outline:none; box-shadow:none; appearance:auto; }
.login-card select.lf-sel:focus { border-bottom-color:#2F7F72; }
/* The only reliable notice a browser gives that it filled a field for you:
         it matches :-webkit-autofill, and starting an animation there fires an
         animationstart the screen can hear. The animation itself does nothing —
         it exists to be listened for. */
.login-card input.lf-in:-webkit-autofill { animation-name: sageAutofill; animation-duration: .01s; }
@keyframes sageAutofill { from { opacity:1; } to { opacity:1; } }
.login .lf-in::placeholder { color:#B4B6B4; }
/* ---- the button, and the five dots that fill with the mark ---- */
.lf-go { display:flex; align-items:center; justify-content:space-between; gap:14px;
        width:100%; margin-top:30px; padding:15px 22px; border:0; border-radius:999px; cursor:pointer;
        background:#2E3A32; color:#F1F2EE; font-family:inherit; font-size:15px; font-weight:600;
        box-shadow:0 6px 18px rgba(46,58,50,0.18);
        transition: background .2s var(--ease), transform .2s var(--ease), box-shadow .2s var(--ease); }
.lf-go:hover:not(:disabled) { background:#3A4A3E; transform:translateY(-1px);
        box-shadow:0 10px 26px rgba(46,58,50,0.24); }
.lf-go:disabled { opacity:.72; cursor:default; }
.lf-dots { display:inline-flex; gap:5px; }
.lf-dots i { width:5px; height:5px; border-radius:50%; background:rgba(241,242,238,.3);
        transition: background .3s var(--ease); }
.lf-dots i.on { background:#F1F2EE; }
/* ---- switching between sign in, create account and forgot ----
         The container remounts on each switch, so the fields build up from
         below — small, fast, the same physics as the arrival in miniature. Each
         direct child is staggered a beat behind the one above it. */
.lf-mode > * { animation: lfModeIn .3s var(--ease, cubic-bezier(.2,.7,.3,1)) both; }
.lf-mode > *:nth-child(2) { animation-delay:.03s; }
.lf-mode > *:nth-child(3) { animation-delay:.06s; }
.lf-mode > *:nth-child(4) { animation-delay:.09s; }
.lf-mode > *:nth-child(5) { animation-delay:.12s; }
.lf-mode > *:nth-child(6) { animation-delay:.15s; }
.lf-mode > *:nth-child(7) { animation-delay:.18s; }
.lf-mode > *:nth-child(n+8) { animation-delay:.21s; }
@keyframes lfModeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
/* The press is physical: the pill gives under the finger, and the ratchet
         through the mark reads as what the press set in motion. */
.lf-go:active:not(:disabled) { box-shadow:0 4px 12px rgba(46,58,50,.16); }
.lf-alt { display:block; width:100%; margin-top:26px; background:none; border:0; cursor:pointer;
        font:inherit; font-size:13px; color:#6E6E76; }
.lf-alt:hover { color:#2E3A32; }
/* Sign-in puts its label left and the five build dots right, which is what
         the space-between is for. Every other mode has only a label, and a label
         pushed to one edge of a full-width pill reads as a mistake. */
.lf-go.lf-solo { justify-content:center; }
/* The line of explanation above the fields. Same voice as the labels, one
         step quieter, and no card chrome around it. */
.lf-note { font-size:13px; line-height:1.5; color:#6E6E76; margin:0 0 4px; text-align:left; }
.login-card .login-title { font-size:22px; font-weight:700; letter-spacing:-.02em;
        color:#2E3A32; margin:0 0 10px; }
/* Scoped to this screen so the boxed versions elsewhere are untouched: on a
         page with no card and no borders, a filled green panel is the only piece
         of chrome in sight. */
.login-card .setup-note { font-size:13px; line-height:1.5; color:#6E6E76; margin:0 0 4px; text-align:left; }
.login-card .login-ok { background:none; padding:0; border-radius:0; color:#3F7A4C;
        font-size:12.5px; margin-top:12px; text-align:left; }
.login-card .login-err { text-align:left; }
@media (prefers-reduced-motion: reduce) {
        .sg-dot, .sg-field, .sg-blob, .login-logo circle { animation:none !important; }
      }
.login-logo { display:flex; justify-content:center; margin-bottom:12px; }
.login-card h2 { font-size:22px; font-weight:700; letter-spacing:-.02em; margin:0 0 2px; }
.login-card label { display:block; text-align:left; font-size:12px; font-weight:600; margin:16px 0 6px; color:var(--ink-2); }
.login-card select, .login-card input { width:100%; }
.login-err { color:var(--red); font-size:12.5px; margin-top:10px; }
.hint.center { text-align:center; }
/* ---- board ---- */
/* overflow stays visible so a dial's hover card can escape the card edge */
.role-header { display:flex; align-items:center; gap:8px; margin:0 0 12px; font-size:16px; font-weight:700; letter-spacing:-.01em; }
.assoc-card { border-bottom:1px solid rgba(0,0,0,.05); padding:10px 0 12px; transition: background .2s; border-radius:10px; }
/* :last-of-type, not :last-child — the "show the other N" button now sits
         after the cards, so no card is the last child any more and every divider
         came back. The button is a <button>, so the last div is still the last
         card. */
.assoc-card:last-of-type { border-bottom:none; }
/* ---- one line, and every column under the one above it ----
         It was a flex row with TWO auto margins in it — one before the dials and
         one before the lead count — so the free space split between them and the
         dials landed wherever the verdict's wording left them. "Nearing the
         limit" and "Below standard, room left" are different widths, so no two
         rows agreed and a manager could not read down a column of dials at all.

         Fixed tracks, so column four is under column four on every row whatever
         anybody's verdict says. The bar takes whatever is left, which on a
         desktop is most of the row. */
/* The drafts' row: fixed columns, packed left to right, so a manager reads
         DOWN a column instead of hunting for it on each line. The lead bar is a
         fixed 150px picture of the allowance, not a stretched track. */
/* the verdict fade bleeds in from the left edge; everything rides above it */
/* square, so a row runs edge to edge and starts at the rule above it
         rather than curving away from it */
.s2-rolecard .assoc-card:last-child .assoc-row .da-stripe { border-radius:0 0 13px 13px; }
/* Everything that identifies the person, in the first track. */
/* One line and one width, so they make a column rather than a ragged edge.
         The track is sized for the longest of them ("Below standard, room left"),
         and every pill fills it. */
.assoc-row .verdict { white-space:nowrap; width:100%; min-width:0; box-sizing:border-box;
        font-size:11.5px; padding:5px 8px; }
/* Six tracks need about 1200px. Below that the row wraps instead, with the
         bar on a line of its own under the name — still long, still first thing
         the eye lands on, and nothing is pushed off the right-hand edge. */
/* Under the draft's desk width the row wraps rather than scrolls: identity
         and verdict on the first line, the instruments on the second. */
@media (max-width: 1200px) {
        .assoc-row .verdict { width:196px; flex:0 0 196px; }
      }
.flag { font-size:11px; color:var(--amber); background:rgba(255,159,10,.14); padding:3px 9px; border-radius:20px; font-weight:600; }
.verdict { font-size:12px; font-weight:700; padding:5px 12px; border-radius:20px; min-width:118px; text-align:center;
        transition: transform .2s var(--spring); }
.verdict.sm { min-width:0; font-size:11px; padding:3px 9px; }
/* amber: below standard and closing on the cap */
/* blue: below standard but plenty of headroom, so nothing is paused yet */
/* In the row now, and long. A bar is a picture of exactly one thing — how
         much of the allowance is gone — and it was the smallest object on a row
         with room for it to be the largest. */
/* Both of these are spans so they can sit in the row's grid. An inline
         child ignores height:100%, which drew every bar as an empty track. */
.reasons { margin:9px 0 0 23px; font-size:12.5px; color:#C13529; animation: pageIn .3s var(--spring); }
.reason { display:inline-block; background:rgba(229,71,60,.10); border-radius:14px; padding:3px 10px; margin:2px 5px 0 0; font-weight:500; }
/* ---- scorecard dials: the 5-second read on every associate ---- */
/* A grid of fixed columns rather than a row of whatever fits. Every dial is
         88px, so column four sits under column four on every row and a manager
         can read down "Delivery" instead of hunting for it on each line. */
/* Two clusters side by side, each laying its own instruments out. It was a
         grid of fixed 80px columns, which gave a whole cluster one column and
         stacked its three instruments on top of each other. */
/* On the associate row the dials ride to the right of the name and stay
         together as one unit; the row itself wraps them if the screen is narrow. */
.mdial { width:88px; text-align:center; position:relative; }
/* Present for the column, not being graded. Quiet enough that the eye goes
         to the ones with a target on them. */
.mdial svg { display:block; width:88px; height:50px; overflow:visible;
        transition: transform .36s cubic-bezier(.34,1.56,.64,1); }
.mdial:hover { z-index:41; }
.mdial:hover svg { transform: scale(1.16); }
/* Wraps rather than truncates. "ENGAGED VIDEO 40%" does not fit an 88px
         column on one line, and "ENGAGED VIDE…" tells a manager less than two
         short lines do. Two lines of room is reserved on every dial so the
         labels sit on the same baseline whether they wrap or not. */
/* Hover card. The overshoot in the timing function is the "bloop". */
.mdial-pop { position:absolute; left:50%; bottom:calc(100% + 12px); width:262px; z-index:40;
        opacity:0; pointer-events:none; text-align:left;
        transform: translateX(-50%) scale(.88); transform-origin: bottom center;
        transition: opacity .16s ease, transform .36s cubic-bezier(.34,1.56,.64,1);
        background:rgba(255,255,255,.99); border:1px solid rgba(0,0,0,.07); border-radius:14px;
        padding:12px 14px 11px; box-shadow: 0 14px 38px rgba(31,54,86,.24); }
.mdial-pop::after { content:""; position:absolute; left:50%; top:100%; width:12px; height:12px;
        margin-left:-6px; margin-top:-6px; transform:rotate(45deg);
        background:#fff; border-right:1px solid rgba(0,0,0,.07); border-bottom:1px solid rgba(0,0,0,.07);
        border-radius:0 0 3px 0; }
.mdial:hover .mdial-pop { opacity:1; transform: translateX(-50%) scale(1); }
/* ---- grace period & recap ---- */
.reason.watch { background:rgba(255,159,10,.12); color:#8A5A00; }
.recap { --tint: rgba(193,215,48,.16); }
.grace-setting { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
.grace-setting input[type=number] { width:64px; }
/* ---- search ---- */
.seg-wrap { align-items:center; gap:16px; }
.search-icon .pix { display:block; }
/* Centred wording, with the padding kept equal on both sides so the text sits
         on the true centre of the box rather than off the magnifier. */
/* Section headings borrowed from Performance's .role-header so the two views
         read as one product: swatch, heading-weight name, count in a tinted pill,
         over a soft band of the section's own colour. */
/* The standard, under the list rather than over it. Numbers carry the weight;
         the rule behind them is said once, quietly, and nowhere else on the screen. */
/* Second, first, third, at three heights, the way a podium actually stands and
         the way the report image already draws it. The metals match the canvas. */
/* The first section sits directly under the table head, so it does not need
         the full separating gap that divides one section from the next. */
.plate-pick.on { background:var(--blue); border-color:var(--blue); color:#fff; }
/* ---- leaderboard ---- */
.leaderboard { --tint: rgba(193,215,48,.18); }
/* Not a graded row: a name and a picker, and the six-track grid would
         strand the picker in column three. */
/* ---- rank + star + incomplete + off leads ---- */
/* A cleared month used to look identical to a failing one apart from one small
         pill at the far end of the row. The people doing well are the ones a floor
         meeting is built on, so the row says so before anybody reads it. */
.assoc-card.pass { position:relative; }
.assoc-card.pass::before { content:""; position:absolute; left:-10px; top:6px; bottom:6px;
        width:3px; border-radius:2px; background:#30B155; opacity:.55; }
.assoc-card.pass .assoc-name { color:#12212F; font-weight:700; }
/* ---- and the row itself ----
         A wash that fades out before it reaches the figures, a gold edge instead
         of the green everybody clearing standard gets, and their lead bar in the
         same gold. Nothing moves position and nothing else changes size: it is
         the same row, wearing something. */
.assoc-card:has(.star-badge) {
        background:linear-gradient(100deg, rgba(240,188,60,.17), rgba(240,188,60,.05) 38%, transparent 62%); }
.assoc-card.pass:has(.star-badge)::before {
        opacity:1; width:4px; background:linear-gradient(180deg,#FFE595,#E0A100); }
.assoc-card:has(.star-badge) .gauge-fill {
        background:linear-gradient(90deg,#E0A100,#FFD166); }
.assoc-card:has(.star-badge) .assoc-name { color:#3E2C00; }
.assoc-card:has(.star-badge) .verdict-pass {
        background:linear-gradient(150deg,rgba(255,229,149,.55),rgba(240,188,60,.4)); color:#5A3B00; }
@keyframes starGlow {
        0%,100% { box-shadow: 0 0 0 0 rgba(240,188,60,0); }
        50%     { box-shadow: 0 0 0 3px rgba(240,188,60,.22); }
      }
.assoc-card.incomplete { opacity:.55; filter:grayscale(.75); }
.assoc-card.incomplete .verdict { visibility:hidden; }
@media (prefers-reduced-motion: reduce) { .detail { animation:none !important; } }
.assoc-card.is-restricted { opacity:1; filter:none; }
/* ---- auth extras ---- */
.btn-link { background:none; border:none; color:var(--p2d); font-weight:600; font-size:13px; cursor:pointer; margin-top:12px; display:inline-flex; align-items:center; gap:6px; }
/* ---- splash ---- */
.splash { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:40px 20px;
        background:radial-gradient(70% 90% at 50% 0%, rgba(136,198,234,.25), transparent 60%); }
/* ---- check out tracker ---- */
/* Check Out, Coaching and Plates were flush to the window edge; the rest of
         the app has always been inset. */
.checkout, .coaching, .plates { padding:30px 32px 56px; max-width:1440px; margin:0 auto; }
.plates .card { --tint: rgba(122,79,155,.09); }
.import .checklist { --tint: rgba(136,198,234,.16); }
/* The dot marks are boxes, not glyphs, so they need centring against the
         digits rather than resting on the baseline like the characters did. */
.streak { display:inline-flex; align-items:center; gap:2px; vertical-align:middle; }
/* Its own bubble rather than the browser's, so it appears at once, matches the
         rest of the tool, and arrives with the same small overshoot everything else
         does instead of blinking into place. */
/* An svg <text> now, not a <b> beside the ring, so these paint with fill.
         Leaving them on "color" silently did nothing and every count went black. */
.co-badge.yes { background:rgba(48,177,85,.14); color:#1E7A3C; }
.co-badge.no { background:rgba(229,71,60,.13); color:#C13529; }
.co-badge.dim { background:#F2F2F4; color:var(--ink-2); }
/* point system badges */
.pt-badge.dim { background:#F2F2F4; color:var(--ink-2); font-weight:600; }
.pt-badge.off { background:transparent; color:var(--ink-3); }
.streak { display:inline-flex; align-items:center; gap:1px; margin-left:6px; font-size:12px; vertical-align:middle; }
/* top offenders ranking */
/* schedule upload modal */
/* ---- the schedule room ----
         The wall calendar on a desk, one day at a time on a phone, and what the
         last upload put on the board behind both. */
.sr-seg button.on { background:#fff; color:var(--p3); }
.sr-head .btn-x { background:rgba(255,255,255,.18); color:#fff; border:0; }
.sr-savebar button.go { border-color:transparent; background:var(--p2d); color:#fff; }
.sr-day.blank { background:none; border-color:transparent; cursor:default; }
.sr-day.blank:hover { transform:none; }
.sr-day.today { border-color:var(--sandTick); background:color-mix(in srgb, var(--sandTick) 13%, #FAFBFA); }
.sr-day.sel { border-color:var(--p2d); box-shadow:0 0 0 2px color-mix(in srgb, var(--p2d) 26%, transparent); }
.sr-chip.more { background:none; border-color:transparent; color:var(--ink-3); }
.sr-prow.on .sr-pdot { background:var(--p2d); }
.sr-prow.on .sr-ptag { color:#1E7A3C; }
.sr-dbtn.today .sr-dd { color:var(--sandInk); }
.sr-col.off .sr-av { background:var(--ink-3); }
.sr-src th.bad { background:rgba(194,54,31,.13); color:#C13529; }
.sr-src .lbl { text-align:left; font:600 11.5px var(--font-ui); color:var(--ink);
        min-width:150px; padding:5px 10px; position:sticky; left:0; background:var(--card); }
.sr-src th.lbl { background:#FAFBFA; }
.sr-src td.off { background:rgba(194,54,31,.1); color:#C13529; }
@media (max-width: 860px) {
        /* a full-screen sheet: the backdrop's own inset would otherwise leave the
           month hanging off the bottom of the phone */
        .sr-head .btn-x { position:absolute; right:14px; top:14px; }
      }
/* Both sides stay side by side on a phone. Stacking them put twelve cards
         between the two columns, and seeing the swap is the whole point of this
         view, so the cards give up their avatar and their label instead. */
/* ---- the cross-check ----
         A reading screen, not a working one: the three figures at the top are
         the whole answer, and the lists under them are only there to name the
         difference when there is one. */
.xc-head .btn-x { background:rgba(255,255,255,.18); color:#fff; border:0; }
.xc-n.odd { color:#C13529; }
/* only the heading is a block; a bold number inside the sentence stays in it */
.dr-tally.g { background:rgba(48,177,85,.12); }
.dr-tally.g b { color:#1E7A3C; }
.dr-tally.g span { color:#1E7A3C; }
.dr-tally.r { background:rgba(229,71,60,.1); }
.dr-tally.r b { color:#C13529; }
.dr-tally.r span { color:#C13529; }
.dr-tally.d { background:rgba(0,0,0,.04); }
.dr-tally.d b { color:var(--ink-2); }
.dr-tally.d span { color:var(--ink-3); }
.dr-chip.g { background:rgba(48,177,85,.12); color:#1E7A3C; }
.dr-chip.d { background:rgba(0,0,0,.05); color:var(--ink-2); }
.sched-err { color:#C13529; font-size:13px; font-weight:600; margin:8px 0; }
/* ---- plate tracker ---- */
/* The status pill gets a column of its own and fills it, so Remove starts at
         the same x on every row and reads as a column rather than a ragged edge. */
.plate-check.out { background:rgba(255,159,10,.16); color:var(--amber); }
.plate-check.in { background:rgba(48,177,85,.14); color:#1E7A3C; }
/* How long a standing plate has been out. It is the number a manager is
         actually scanning this column for, so it gets its own weight rather than
         being read off the date. */
.plate-days.long { background:rgba(229,71,60,.12); color:#C13529; }
.plate-missing-row .btn { flex:0 0 auto; }
/* ---- activity standards stepper ---- */
/* ---- thresholds + check groups ---- */
.thr-dot.g { background:var(--green); }
.thr-dot.y { background:#E0A100; }
.setup-note { font-size:13px; color:var(--ink-2); margin:8px 0 6px; }
.login-ok { color:#1E7A3C; font-size:12.5px; margin-top:10px; background:rgba(48,177,85,.12); padding:8px 10px; border-radius:8px; }
/* ---- centralized BDC oversight ---- */
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
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
.detail { display:flex; flex-direction:column; gap:16px; margin:14px 0 0 23px;
        animation: detailIn .42s var(--ease-bloop) both; }
@keyframes detailIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
/* one bar per metric, 0 to target, the same language as the floor's
         delivery card so the two read as the same idea at two scales */
/* 132, not 148: at 390 the roster card leaves ~309px inside its padding, and
         two 148s plus the gap wanted 310 — one pixel short, so every bar dropped
         to its own row and four metrics became four rows of scrolling. */
/* the target, drawn ON the track so clearing it is visible rather than arithmetic */
/* the unit split: a proportion, so a bar rather than three numbers */
/* ---- badges ---- */
/* ---- import ---- */
.checklist { max-width:440px; }
.seg-opt.on { background:var(--surface, #fff); color:var(--ink-1); box-shadow:0 1px 3px rgba(0,0,0,.12); }
.check { display:flex; gap:11px; align-items:center; padding:6px 0; color:var(--ink-2); transition: color .3s; }
.check.done { color:#1E7A3C; font-weight:600; }
.check.done .check-box { background:var(--green); border-color:var(--green); color:#fff; transform: scale(1.05); }
.dropzone.active { border-color:var(--blue); background:rgba(10,132,255,.05); transform: scale(1.01); box-shadow: var(--shadow-2); }
.is-touch .dz-drop { display:none; }
.is-touch .dz-tap { display:inline; }
/* On touch the dropzone is really a big button, so make it read like one. */
.is-touch .dz-icon::before { content:"＋"; }
.is-touch .dz-icon { font-size:26px; animation:none; }
.is-touch .dz-icon > * { display:none; }
@keyframes dzBob { 0%,100% { transform: translateY(0); opacity:.85; } 50% { transform: translateY(4px); opacity:1; } }
.dropzone.active .dz-icon { animation-duration: 1s; }
/* ---- forms & buttons ---- */
input, select { border:1px solid rgba(16,40,68,.12); border-radius:11px; padding:9px 12px; font-size:13px; font-family:inherit;
        background:rgba(255,255,255,.82); color:var(--ink);
        box-shadow: inset 0 1px 2px rgba(16,40,68,.04);
        transition: border-color .25s var(--ease), box-shadow .25s var(--ease), background .25s var(--ease); outline:none; }
/* Selects kept the operating system's own chevron and metrics, so next to the
         app's inputs and pills they read as browser furniture dropped onto the page.
         One rule covers all of them: the native arrow goes, ours is drawn in the
         background, and the extra right padding is what stops a long store name
         running underneath it. */
select { appearance:none; -webkit-appearance:none; -moz-appearance:none;
        padding-right:34px; cursor:pointer;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1.4 1.6 6 6.2l4.6-4.6' fill='none' stroke='%234A5A6B' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 13px center; background-size:12px 8px; }
select::-ms-expand { display:none; }
input:hover, select:hover { background:rgba(255,255,255,.92); }
input:focus, select:focus { border-color:var(--p2); background:#fff;
        box-shadow:0 0 0 3.5px color-mix(in srgb, var(--p2) 22%, transparent); }
input[type=number] { width:84px; }
/* One filled button for the whole site, in the Garden palette every page
         now wears. It was a blue gradient left over from the old look, which is
         why converted pages kept sprouting a blue pill in the corner. */
.btn { background:var(--p2); color:#fff; border:none;
        border-radius:12px; padding:10px 20px; font-weight:600; font-size:13px; letter-spacing:.005em;
        cursor:pointer; box-shadow:0 5px 14px -6px color-mix(in srgb, var(--p2) 70%, transparent);
        transition: transform .28s var(--ease-bloop), box-shadow .28s var(--ease), background .2s; }
.btn:hover { background:var(--p2d); transform: translateY(-1.5px);
        box-shadow:0 10px 22px -8px color-mix(in srgb, var(--p2) 70%, transparent); }
.btn:active { transform: translateY(0); transition-duration:.09s; }
.btn:disabled { filter:grayscale(.35); opacity:.5; box-shadow:none; transform:none; cursor:default; }
.btn.wide { width:100%; margin-top:18px; padding:12px; border-radius:12px; font-size:14px; }
.btn.secondary { background:var(--card); color:var(--ink-2); border:1px solid var(--line);
        box-shadow:none; }
.btn.secondary:hover { background:var(--card); border-color:var(--p2); color:var(--p2d); box-shadow:none; }
/* ---- mobile slide-out drawer (hidden on desktop, shown under 720px) ---- */
.drawer-root.open { display:block; }
@keyframes scrimIn { to { opacity:1; } }
.drawer { position:absolute; top:0; right:0; height:100%; width:min(84vw, 340px);
        background:var(--card,#fff); box-shadow:-16px 0 48px rgba(0,0,0,.28); display:flex; flex-direction:column;
        transform:translateX(100%); animation:drawerIn .28s var(--spring) forwards; }
@keyframes drawerIn { to { transform:translateX(0); } }
.drawer-item.on { background:color-mix(in srgb, var(--p2) 10%, transparent); color:var(--blue); }
.btn-ghost.on { background:rgba(224,161,0,.14); border-color:transparent; color:#95600A; }
/* Red for everything, including Cancel, Crop, Move up and Download: a
         screen of ordinary actions read as a screen of warnings. Neutral now,
         with red kept for the ones that actually take something away. */
.btn-x { background:transparent; border:none; color:var(--ink-2); cursor:pointer; font-size:12px; font-weight:600;
        padding:4px 8px; border-radius:8px; transition: background .2s, color .2s; }
.btn-x:hover { background:color-mix(in srgb, var(--p2) 10%, transparent); color:var(--p2d); }
.btn-x.danger { color:var(--red); }
.btn-x.danger:hover { background:rgba(229,71,60,.08); color:var(--red); }
.hint { font-size:12px; color:var(--ink-2); line-height:1.45; }
/* ---- standards ---- */
/* ---- tables ---- */
.assoc-card.is-picked { background:color-mix(in srgb, var(--p2) 8%, transparent); }
.roster-table.wide { max-width:1060px; }
.row-actions { white-space:nowrap; }
.mono { font-size:12px; color:var(--ink-2); white-space:nowrap; font-variant-numeric: tabular-nums; }
/* ---- GM summary ---- */
/* ---- trends ---- */
/* ---- the trail, in the app's own furniture ----
         No grid and no numbered axis: the delivery chart on the dashboard draws
         neither, and this one reading like a stock dashboard was the only thing
         on the page that did. What it gains instead is the warm head the board
         wears, the four figures a manager reads a trail for in the dot numerals,
         one dashed rule for the average, and the last day marked and printed. */
/* Pulled out to the card's padding edge exactly: .card is padded 22/24 and
         .gm-card resets the top to 14, so the bleed is -14 and -24, not the -15
         and -17 it was guessed at -- seven pixels of card showed down each side
         of the band. The radius is the card's 18 less its 1px border, because
         the band sits inside that border, not on it. */
.tr-range.on { background:#fff; color:var(--blue); box-shadow:0 1px 4px rgba(31,54,86,.16); }
@keyframes tipIn { from { opacity:0; transform:translateX(-50%) scale(.92); } to { opacity:1; } }
/* ---- summary grouped by standard ---- */
.std-person.ok { background:rgba(48,177,85,.09); border-color:rgba(48,177,85,.2); }
/* ---- admin ---- */
.store-logo.placeholder { display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--ink-3);
        background:#F5F5F7; font-size:16px; }
/* traffic-light verdict chips on the store overview cards */
/* Every panel's heading in one voice: the dotted small-caps caption the
         redesigned pages use, rather than a 16px bold line that read as a
         different product from the card next to it. */
.card h3 { margin:0 0 9px; display:flex; align-items:center; gap:8px;
        font:700 9px var(--font-mono); letter-spacing:.1em; text-transform:uppercase;
        color:var(--ink-3); }
.card h3::after { content:""; flex:1; height:2px; opacity:.3;
        background:radial-gradient(circle, currentColor 1px, transparent 1.25px) 0 50% / 6px 2px; }
.card h3 .section-sub { margin-left:0; font:700 9px var(--font-mono);
        letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); opacity:.75; }
.card h3 .badge, .card h3 .tg-chip { text-transform:none; letter-spacing:0; }
/* the roll-up cap is desktop-inert: see the mobile block for .rolled */
/* ---------------- Delivery, flowing ---------------- */
@keyframes flowPop { from { opacity:0; transform:scale(.4) rotate(-8deg); } to { opacity:1; transform:none; } }
/* The plot is drawn in a 292-unit-wide viewBox, so its own width sets the
         scale for everything inside it — strokes, dashes, dot radii and label
         font sizes are all in user units. At full desktop card width that is a
         5.8x blow-up: a 570px-tall chart with 47px axis labels and 14px dashes,
         which is exactly where "oversized and laggy" came from. Capped at the
         width it was drawn for, so a desktop reads like a phone. */
/* Mondays, and the taller line for the 1st. Behind the data, quiet enough
         to give the strip a rhythm without competing with it. */
/* The all-channel view's scale. Quiet enough to sit behind three lines, present
         enough that the space between them means something. */
/* The halo is what lets a scale label sit at the left edge, where the lines
         also start, without either one becoming unreadable. */
/* ---- Drawing the lot ---- */
.fence { margin-top:12px; }
/* Tall enough to see a whole dealership at the zoom a manager traces at.
         Leaflet measures its container on creation, so this has to be a real
         height rather than something that resolves later. */
/* Leaflet draws its own controls and credit; keep them in this app's type. */
/* Once the card is wider than the chart wants to be, the chart moves beside
         the read-out rather than under it — otherwise capping its width leaves a
         card that is mostly empty on the right. */
@media (min-width: 780px) {
        /* 430 units rendered at up to 590px is the same density the phone reads at
           (292 units at ~330px), so this is a bigger chart rather than a magnified
           one — the labels and linework stay the size they already were. */
      }
@keyframes flowDraw { to { stroke-dashoffset:0; } }
/* the sheet a card bloops up */
/* Portaled to document.body, which is OUTSIDE .lpc — so it inherits the
         browser default serif instead of the app's face. Everything the shell
         normally provides has to be restated here. */
@keyframes bsFade { from { opacity:0; } to { opacity:1; } }
@keyframes bsPop { from { opacity:0; transform:scale(.86); } to { opacity:1; transform:none; } }
/* The mark that says a card opens something. Touch has no hover, so
         without it nothing distinguishes a card you can press from one you
         cannot — and a word would cost a line on every card that has one. */
/* pointer-events:auto, and a padded box around the glyph. It was
         unclickable twice over: the mark passed taps straight through, and on
         the hero it sat outside its own block's box, so what was underneath was
         the hero band rather than the health block the handler looks for. The
         glyph is 16px; the target it sits in is 40. */
/* The 40px box comes from padding on an absolutely positioned element, so
         it costs no layout — but the negative margin that used to go with it
         dragged the whole box 12px outside the card, which put the glyph hard
         into the corner and half off it. No margin: the box sits inside, and the
         glyph lands 14px in from the right and 12px up from the bottom. */
/* The hero's health block is a bare flex column, not a card with padding,
         so its mark hangs off the corner it is meant to sit inside. */
/* Once it is open the mark has done its job, and the block has grown to
         hold the panel — so it would otherwise drift down to sit beside it. */
/* The flow card's bottom-right corner is where its month labels sit, so it
         gets the room rather than the mark landing on top of them. */
/* ---- a tapped popup opens in flow, under what was tapped ----
         Not floated: see the comment on the touch handler. Nothing here
         positions anything, which is the entire point. */
.is-touch .health-pop, .is-touch .hf-pop, .is-touch .mdial-pop { display:none; }
.is-touch .popped .health-pop, .is-touch .popped .hf-pop, .is-touch .popped .mdial-pop {
        display:block; position:static; opacity:1; pointer-events:auto; transform:none;
        width:100%; max-width:none; min-width:0; margin-top:12px;
        max-height:none; overflow:visible;
        animation:popOpen .34s var(--ease-bloop) both; }
/* On a tap there is no card-to-panel gap to point across. */
.is-touch .hero-health::after { display:none; }
.is-touch .popped .health-pop::after, .is-touch .popped .hf-pop::after,
      .is-touch .popped .mdial-pop::after { display:none; }
/* Two motions, on purpose. The panel arrives with the bloop everything
         else in the app uses, and the card it hangs off settles at the same
         time — so the growth reads as one movement rather than content
         appearing and the layout jumping to catch up afterwards. */
@keyframes popOpen {
        from { opacity:0; transform:translateY(-10px) scale(.96); }
        60%  { opacity:1; }
        to   { opacity:1; transform:none; }
      }
.is-touch .popped { transition:box-shadow .4s var(--ease); }
.is-touch .hero-health.popped, .is-touch .hf-fix.popped { animation:cardSettle .46s var(--ease-bloop) both; }
@keyframes cardSettle { from { transform:scale(.985); } to { transform:none; } }
/* A dial is half the row, so its panel inherited half the row and the
         explanation came out as a narrow column that shoved the card sideways.
         The dial takes the full width while it is open — which is also the
         growth the card should have — and the gauge holds its own size inside. */
.is-touch .mdial.popped { width:100%; transition:width .4s var(--ease-bloop); }
.is-touch .mdial.popped svg { max-width:172px; margin-left:auto; margin-right:auto; }
.is-touch .mdial.popped .mdial-pop { margin-top:10px; }
/* ---- respect the OS "reduce motion" setting: everything holds still ---- */
@media (prefers-reduced-motion: reduce) {
        .is-touch .popped .health-pop, .is-touch .popped .hf-pop,
        .is-touch .popped .mdial-pop, .is-touch .popped { animation:none !important; }
        .lpc *, .lpc *::before, .lpc *::after {
          animation-duration: .001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .001ms !important;
          scroll-behavior: auto !important;
        }
        .lpc::before, .lpc::after { animation: none !important; transform: none !important; }
        /* leave the logo in its finished state rather than mid-sweep */
        .logo-anim { animation: none !important; transform: none !important; }
        /* hero holds its finished state instead of animating in */
        .sage-loading i, .wiz, .wiz-overlay, .bl-tile, .loadscreen-inner { animation: none !important; }
        /* the flow already refuses to cycle under reduce-motion; this is the
           draw-in and the pop that are pure decoration */
      }
@media print {
        .no-print, .topbar, .seg-wrap { display:none !important; }
        .lpc { background:#fff; padding:0; }
        .card { box-shadow:none; border:none; padding:0; margin-bottom:20px; }
        .lpc::before, .lpc::after { display:none !important; }
        .version-stamp { display:none; }
        .logo-anim, .dz-icon, .star-badge { animation:none !important; }
      }
/* =====================================================================
         MOBILE  —  one coherent pass at <=760px, replacing the scattered
         per-widget breakpoints. Phones get a native-style bottom bar, the hero
         reflows to a single column, tables stack, and popups tap open.
         ===================================================================== */
.botnav, .sect-strip { display:none; }
@media (max-width: 760px) {
        /* --- chrome --- */
        /* z-index stays at the desktop value. At 40 the hero (220), the hero band
           (240) and both pop cards (240) painted straight over the sticky header,
           so the store name and the greeting card collided while scrolling. It has
           to sit above page content but below the bottom bar (340), the help
           button (350) and every sheet (360+). */
        /* Inside the phone app the page runs under the clock; the header pads
           itself past that strip, which iOS keeps for its own taps, and the
           header's own blur continues up behind the clock. Zero in a browser. */
        .topbar { padding:calc(10px + var(--sat)) 14px 10px; gap:10px;
          background:rgba(255,255,255,.86); backdrop-filter:blur(18px) saturate(160%);
          -webkit-backdrop-filter:blur(18px) saturate(160%); box-shadow:0 1px 0 rgba(16,40,68,.08); }
        /* The <=720px block above still forces topbar-right onto its own
           full-width row. That was right when the hamburger and the account
           controls lived there, but the bottom bar replaced all of it and the
           row now holds only the store selector — so it cost a second header
           row, and every page started ~50px further down. One row again. */
        /* ...and the <=720px block also sets flex-wrap:wrap on the header itself,
           which is the other half of it: the store picker is capped at 62vw, so
           brand + picker overflowed one line and the picker dropped to a second
           row. Measured 85px of header at 320/360/390 against 56px at 430. One
           row, and the picker shrinks with an ellipsis instead of wrapping. */
        .topbar { flex-wrap:nowrap; }
        .topbar-right .view-select { flex:0 1 auto; min-width:0; text-overflow:ellipsis; }
        .topbar .tool-row { display:none; }   /* the tools live in the bar */
        /* The bar carries tools now, so every module has one and there is never a
           header without a way out. This used to need a class and a second rule. */
        .view-select { max-width:62vw; font-size:13px; }
        /* the bar measures 55px and now floats 9px clear of the bottom edge, so
           the help button clears 64px of it before the home-indicator inset. At
           bottom:18px it sat on top of the More tab and swallowed its taps. */
        .help-fab:not(.inline) { bottom:calc(76px + var(--sab)); }
        /* The sections moved to the chip strip, so the desktop tab control goes —
           but the associate search lives in this same row, and hiding the whole
           row took the only way to find a salesperson by name on a phone with it.
           Hide the control, keep the row, give the field the full width. */
        .seg-wrap .seg { display:none; }
        /* padding lives on the field, not the row, so the rows that hold only a
           hidden tab control (admin, Live Floor) collapse to nothing */
        .seg-wrap { padding:0; }
        .seg-wrap .search-top { margin:10px 14px 0; max-width:none; flex:1 1 auto; min-width:0; }

        /* --- page gets out of the way of the bar --- */
        .board, .import, .standards, .roster, .admin, .gm, .history, .access, .audit,
        .settings, .checkout, .coaching, .plates {
          padding:16px 14px calc(116px + var(--sab)); }
        /* --- cards are solid on a phone ---
           The desk's cards are translucent over the backdrop, which reads as
           depth on a wide screen and as washed-out on a phone in daylight. */
        .card { background:rgba(255,255,255,.97); }
        .assoc-card, .pp-row  { background:#fff; }
        /* --- Live Floor's tools, in a grid rather than a wrap ---
           Six controls of three different shapes wrapped into three ragged
           lines. Two columns of equal buttons, and the two copy links join
           them as buttons of the same size. */
        .mf .q-topline-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%; margin-left:0; }
        .mf .q-topline-actions > * { margin:0; width:100%; justify-content:center; text-align:center;
          min-height:44px; display:inline-flex; align-items:center; }

        /* --- the first five, then the rest on request --- */
        .assoc-card.rolled { display:none; }

        /* --- coaching: the card comes to you --- */
        /* The two-column split stacks on a phone, which put the card below the
           list you tapped from — off screen, and you had to hunt for it. */
        @keyframes coachUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }                 /* nothing to sit beside on a phone */
        /* The benchmark tiles are a grid that would stack five deep. One row that
           scrolls keeps "what the strongest do" readable in a glance. */

        /* --- the sections, as a chip strip --- */
        /* These used to be the bottom bar. They sit under the header now, above
           the page, and scroll rather than hide the fifth one behind "More". */
        .sect-strip { display:flex; gap:7px;
          padding:9px 14px 8px; overflow-x:auto; scrollbar-width:none;
          background:rgba(255,255,255,.86); backdrop-filter:blur(18px) saturate(160%);
          -webkit-backdrop-filter:blur(18px) saturate(160%);
          box-shadow:0 1px 0 rgba(16,40,68,.07); }
        .sect-strip::-webkit-scrollbar { display:none; }
        /* The header stack is an opaque white slab — it has to be, because it
           sticks and the page scrolls underneath it, and the blur that used to
           hide that is off on touch. Ending it on a straight edge cut a hard line
           across the top of a coloured page. This carries its white down another
           20px and fades it out, so the backdrop arrives gradually instead. */
        /* no position declaration here — .topstack is sticky, which is already a
           positioned ancestor, and re-declaring it relative would unstick it. */
        .sect-chip.on { color:#fff; background:var(--ink); border-color:var(--ink); }

        /* --- bottom bar: the tools ---
           The bar floats rather than sitting welded to the bottom edge. An
           edge-to-edge white strip with a hairline over it is what every app
           ships by default; lifted off the edge with its corners rounded, it
           reads as one of this app's own cards, and the backdrop's colour runs
           underneath it on all four sides. */
        /* The notch went with the welded bar. A bite cut in the top edge only
           works when the bar meets the page behind it — a floating bar has open
           air above it, so the notch became a grey tab sticking out of the top.
           The centre button's own halo already separates it from the row. */
        /* the pill that slides between tabs. It is measured around the GLYPH, not
           the whole button: a pill the full width of the tab is both too wide to
           read as a selection and too tight around the icon, and it crowds the
           label it sits behind. Around the glyph it has air on every side and the
           label below simply takes the accent colour. Placed from JS so it tracks
           where the glyph actually lands at each width. z-index 0 puts it under
           the buttons and over the bar; it takes no taps. */
        /* color-mix is Safari 16.2+. Older phones get the flat tint rather than
           no pill at all, which would leave the active tab unmarked. */
        @supports not (background: color-mix(in srgb, red 10%, transparent)) {
          .botnav-thumb { background:rgba(16,40,68,.07); }
        }
        @media (prefers-reduced-motion: reduce) { .botnav-thumb { transition:opacity .2s linear; } }
        .botnav-btn.on { color:var(--sp, var(--blue)); }
        /* holds an SVG now, not a character, so it needs a box rather than a
           font size or the row height drifts between glyphs. 17 rather than 21:
           the dot matrix is a dense glyph and at 21 the five bar icons were the
           heaviest thing on the screen, competing with the numbers they lead to. */
        .botnav-ico .pix { display:block; }
        /* the active glyph used to lift 2px to mark itself. The pill marks it now,
           and a lifted glyph inside a pill just sits off centre. */

        /* --- the centre verb --- */
        /* align-self:stretch is load-bearing: under align-items:flex-end the slot
           would collapse to height 0 and every negative top offset below would measure
           from the bar's BOTTOM edge, putting the button off the screen. */
        /* At -22 the 52px button ended at +30 inside a ~45px slot, and the label
           starts at +28 — so the circle and its shadow sat on the word. Lifted
           until there is real air between them. */
        .botnav-fab.ready { background:linear-gradient(145deg, var(--green), #1E8F45); }
        /* wider than the slot so "Imported" fits, which means it overhangs the
           buttons either side by ~6px — pointer-events:none keeps it from eating
           taps meant for Activity and Live Floor. */

        /* --- Up Next: three tools behind one tab ---
           Live Floor, Phone Line and Online are one question asked over three
           channels, and the bar had room to name only one of them. The tab opens
           the three instead of going anywhere, and each keeps the colour it wears
           on its own board — which is the whole reason they are worth telling
           apart at a glance. */
        /* 30px, not 8: the centre button and its halo stand ~28px proud of the
           bar's top edge, and at 8 the menu was laid straight over them — the
           navy disc showing through the white card looked like a mistake rather
           than a stack. This clears it, so the button sits in the gap. */
        @keyframes qpickIn {
          from { opacity:0; transform:translateY(10px) scale(.86); }
          to   { opacity:1; transform:none; }
        }
        @supports not (background: color-mix(in srgb, red 10%, transparent)) {
          .qpick-ico { background:rgba(16,40,68,.07); }
        }
        .qpick-btn.on { color:var(--qa); }
        .qpick-btn.on .qpick-ico { color:#fff; background:var(--qa);
          box-shadow:0 7px 16px -5px var(--qa); }
        /* the tab reads as pressed for as long as its menu is standing */
        .botnav-btn.open { color:var(--sp, var(--blue)); }
        /* The help button is z-index 350 — above the bar — so it would float over
           the open menu. :has is already load-bearing elsewhere in this sheet. */
        .lpc:has(.botnav-scrim) .help-fab:not(.inline) { opacity:0; pointer-events:none; }
        @media (prefers-reduced-motion: reduce) {
          .qpick, .botnav-scrim { animation:none; }
        }

        /* --- rhythm between the board's blocks ---
           Each of these carried its own desktop margin, and stacked on a phone
           they ended up shoulder to shoulder. One spacing rule for the lot. */
        .board > .hero { margin-bottom:18px; }
        .board > .ru-reopen, .board > .podium, .board > .recap  { margin-top:18px; }
        .board > .podium { margin-bottom:0; }

        /* --- hero reflows to one column --- */
        /* overflow:hidden is what made the closing-rate panel "hide in the
           bottom of the hero card". In flow the band simply grows to hold it. */
        .hero-health { flex-direction:column; align-items:stretch; gap:16px; transform:none !important; opacity:1 !important; }
        /* --- dials: bigger tap targets --- */
        /* Narrow screens wrap to two rows of two rather than one long scroll,
           and the columns still line up because the tracks are the same width. */
        /* On a phone the two clusters stop being columns and become one wrapping
           set: there is no room for a rule down the middle of a 390px screen,
           and the instruments matter more than the grouping does. */
        .mdial { width:calc(33.333% - 8px); }
        /* The cap sentence is what the bar and the pill under it already say. On a
           phone, where reading is the expensive part, the visual carries it. */
        /* Every rule that used to place these — centring the closing-rate card,
           anchoring a dial's card to the strip so it could not leave the screen,
           hiding arrows that pointed at the wrong dial — is gone. In flow there
           is nothing to place and nothing to escape. */

        /* The 23px indent lines the bar up under the desktop rank badge. On a
           phone the row wraps and there is no badge to line up with, so the
           indent just made the bar look off-centre in its card. */
        .gauge, .reasons { margin-left:0; }

        /* --- associate rows stack instead of spanning a wide line --- */
        /* Below this the six tracks cannot all fit, so the row goes back to
           wrapping: the bar takes a line of its own under the name. */
        .verdict { flex:0 0 auto; }

        /* --- podium stacks --- */
        /* flex-basis:auto was the whole bug: with the row switched to a column,
           auto sizes each card to its CONTENT, so a long name made the card
           wider than the row and it ran off the right edge.

           The width has to be set on the CROSS axis. Once the row is a column,
           flex-basis is the height, and align-items:stretch will not take a card
           below its min-content width — so neither flex:1 1 100% nor min-width:0
           alone does anything to how wide it is. An explicit width plus min-width:0
           is what actually lets the name ellipse instead of pushing. */
        .pod { flex:0 0 auto; width:100%; min-width:0; }

        /* --- the sheet takes the bottom of the screen rather than floating --- */
        .ru-reopen { padding:10px 13px; gap:10px; }
        .ru-reopen:hover { transform:none; box-shadow:var(--shadow-1); }

        /* --- upload history stacks; its six fixed columns need 643px and so
               dragged the whole page sideways on a phone --- */

        /* --- tables scroll rather than crush --- */

        /* --- the checkout tracker stops being a table --- */
        /* Eight columns on a 390px phone is not a narrow table, it is the wrong
           shape. Scrolling it sideways only hides the spill: the whole point of
           this screen is comparing people down a column, and you cannot compare
           what you have to swipe to reach. Each person becomes a card, which is
           the language the roster over in Performance already speaks.

           Done in CSS on the same markup rather than a second render tree, so
           there is one table to keep correct. Each cell carries the column name
           it lost when the header went. */
        /* min-width:0 on the grid item, or the card refuses to shrink below the
           table's min-content and quietly overflows its own column — the spill
           survives turning the table into cards otherwise. */
        /* .checkout-card lays its children out as a grid, so the table is a grid
           ITEM and carries min-width:auto — it refused to go below its own
           min-content (measured 520px inside a 362px card) and overflowed. This
           one declaration is what actually stops the spill; the card and split
           get it too so nothing upstream re-imposes it. */
        /* The outer card was spending 24px a side on padding and the person card
           inside it another 13, so every row was inset 37px from a 390px screen
           before any content started. The outer one is the one to give up: it is
           a container, and the cards inside it are the thing being read. */
        /* the label the column header used to carry */
        /* Placed, not auto-flowed. Left to itself the grid put Points last and
           pushed Texts and Emails onto separate rows, so the card read in an
           order nobody chose:
             name  ·  who it is, with the off-day control
             tasks calls videos  ·  the three that are graded, side by side
             texts emails        ·  the two that are not
             rocked             ·  the one control, full width for a thumb   */
        /* block, not flex: wrapping the button onto its own line depended on
           flex-basis behaviour that did not survive contact with the real cell
           (the name, a streak icon and one or two tags all live in here). A block
           cell and a block button is one line each, every time. */
        /* Right-aligning both put the label's right edge on the pill's right
           edge, which is not the same as centring it over the pill — the pill is
           the wider of the two. The cell shrinks to the pill and centres inside. */
        /* The five readings centre in their columns. Left-aligned they all sat
           hard against the start of a column that is much wider than the number
           in it, so the row read as drifting leftwards rather than as a set. */
        /* the dial is a block, so it needs the margins rather than the alignment */
        /* no explicit row: it lands under whatever the last row turned out to be,
           so a store without texts and emails simply has one row fewer */
        /* The tint band lives on the td, which has square corners and once ran
           out where the old last column used to. It moves onto the header itself,
           which is a rounded block the width of the card. */

        /* --- the toolbar --- */
        /* One line: which day, and whether the numbers are current. Everything
           else that was up here has somewhere better to be. */
        .checkout .gm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; }
        .checkout .gm-toolbar select { flex:0 0 auto; }          /* it is the bar's centre button */
        /* A monthly job does not need the most valuable strip on the screen, so it
           waits at the foot of the page where the rest of the month's admin is. */   /* the foot copy takes over */

        /* --- inside the card --- */
        /* Mark off sat between the name and the points, reading as though it
           belonged to neither. Its own line under the name, quiet, out of the way
           of the two things actually being read. */
        /* The tags sit after the name on a line that now belongs to the name
           alone, so they need room around them rather than a left margin sized
           for sitting mid-row. */

        /* --- the daily report --- */
        /* The title, the two actions and the close button were one row, so the
           title wrapped to three lines under the buttons and the close sat in the
           corner of nothing. Title and subtitle get the row; the actions get
           their own, full width and thumb-sized. */
        .dayreport-modal .dr-head-actions .btn { flex:1 1 0; min-width:0; justify-content:center;
          text-align:center; padding:10px 12px; }
        /* out of the button row and up beside the title, where a close belongs */
        .dayreport-modal .dr-head-actions .btn-x { position:absolute; top:14px; right:14px;
          flex:0 0 auto; width:30px; height:30px; display:flex; align-items:center;
          justify-content:center; padding:0; }
        /* The one thing on the card a manager actually presses, so it gets the
           size of a control rather than the size of a label. */
        /* the off-day control is a hover affordance on a desktop and there is no
           hover here, so it becomes a plain button on the card */
        /* The desktop version is a hover affordance parked with position:absolute
           and translateY(-50%). Taking away the absolute is not enough — the
           transform still lifts it half its own height, which is why it kept
           landing back on top of the name. Both have to go, and so does the
           pointer-events:none that hid it from taps. */

        /* --- trends: chart stays readable, controls stack --- */

        /* --- roster role bands a touch tighter --- */

        /* The parallax and the drift are both off on touch already. This used to
           damp the whole backdrop to .7 alongside them, which left the phone
           looking washed out next to the desktop — so the motion goes and the
           colour stays.

           The blobs are re-cut for the shape of the box, not restyled. Their radii
           are percentages of .bg-live, which on a desktop is a wide landscape
           rectangle and on a phone is a narrow portrait one — so 26% x 28% that
           reads as a soft circle at 1200px becomes a thin vertical smear at 390,
           with bare grey between. Same five colours, same five positions, widened
           and shortened until they are round again at this aspect. */
        .bg-live-inner {
          background:
            radial-gradient(52% 20% at 24% 22%, rgba(122,79,155,.26), transparent 70%),
            radial-gradient(48% 19% at 78% 56%, rgba(0,168,150,.26), transparent 70%),
            radial-gradient(44% 17% at 48% 92%, rgba(255,159,10,.20), transparent 72%),
            radial-gradient(40% 16% at 88% 16%, color-mix(in srgb, var(--p2) 22%, transparent), transparent 72%),
            radial-gradient(36% 14% at 8% 70%, rgba(193,215,48,.18), transparent 74%);
        }
      }
/* Two dials across, not three. There was already a rule for this at <=400,
         but it sat EARLIER in the sheet than the <=760 block that sets three, so
         it lost on source order at equal specificity — and a 430px phone never
         matched it in the first place. 520 covers every phone; a tablet between
         520 and 760 still gets three. */
@media (max-width: 520px) {
        .mdial { width:calc(50% - 7px); }
        /* The svg is a fixed 88px display:block, so in a half-width column it sat
           hard left while the label under it centred — the two read as unrelated.
           It fills the column now and the viewBox does the scaling. */
        .mdial svg { width:100%; height:auto; }
      }
/* "Performance" is the longest tool name and the only one that runs out of
         room: it needs 64px in a 62px button at 320. Nothing here is renamed to
         make it fit — the label just gets smaller on the narrowest phones. */
/* ================= Phone line — salesperson page ================= */
.q-page{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;
  background:radial-gradient(1200px 600px at 50% -10%, rgba(76,139,245,.18), transparent 60%), var(--bg,#0b1220);}
@keyframes qfade{from{opacity:0;}to{opacity:1;}}
@keyframes qpop{from{opacity:0;transform:translateY(14px) scale(.98);}to{opacity:1;transform:none;}}
/* live "you're in line" */
@keyframes qspin{to{transform:rotate(360deg);}}
/* ================= Phone line — manager board ================= */
.q-qr svg{display:block;}
/* coaching card — phone line block */
/* v3 additions */
/* PIN fields: label above, and stop the placeholder from being letter-spaced */
/* manager reorder arrows */
/* manager PIN panel */
/* v4: curtain wipe + custom line icons */
.q-stage{position:relative;z-index:1;width:100%;display:flex;justify-content:center;}
.q-curtain{position:fixed;inset:0;z-index:60;background:linear-gradient(120deg,#3b72e0 0%,#5a97ff 55%,#6ea0ff 100%);
  transform:translateX(-100%);pointer-events:none;display:flex;align-items:center;justify-content:center;box-shadow:0 0 60px rgba(0,0,0,.25);}
.q-curtain.q-wipe{animation:qcurtain .38s cubic-bezier(.76,0,.24,1) both;}
@keyframes qcurtain{0%{transform:translateX(-100%);}46%{transform:translateX(0);}54%{transform:translateX(0);}100%{transform:translateX(101%);}}
.q-curtain-mark{width:60px;height:60px;color:rgba(255,255,255,.92);opacity:0;}
.q-curtain.q-wipe .q-curtain-mark{animation:qmark .38s ease both;}
@keyframes qmark{0%,100%{opacity:0;transform:scale(.7);}42%,58%{opacity:1;transform:scale(1);}}
/* v5: center the status icon inside the position ring */
/* ===================== FLUID KIT (SmartFloor) ===================== */
/* A light runs across each pill, left to right, one after the other, the way a
   sequential indicator sweeps. The icon end lights first because that is where
   the eye lands. */
@keyframes qsweep{ 0%{ transform:translateX(-120%); } 34%,100%{ transform:translateX(120%); } }
.qsel-pill.on{ box-shadow:0 3px 12px -2px rgba(16,32,52,.5), 0 0 0 3px rgba(255,255,255,.75); }
/* breathing radial aura */
@keyframes auraBreathe{0%,100%{transform:scale(.9);opacity:.42;}50%{transform:scale(1.08);opacity:.72;}}
/* dot-matrix LED numerals */
.led-num{align-items:center;justify-content:center;}
.led-dot{border-radius:50%;display:block;transition:background .25s ease,box-shadow .25s ease;}
/* position display on the salesperson "done" screen */
/* opportunities leaderboard — color-fill cards */
/* manager "next up" hero + avatar stack */
/* The hand-off action, sitting on the same card as the name it hands over. Large
   target, right-hand side, out of the way of the text at every width. */
/* what each opportunity actually was, under the person who took it */
/* fluid line rows — smooth settle on reorder */
/* ============================================================
   MANAGER BOARDS — light, airy, colorful dashboard (Phone Line + Live Floor)
   Scoped under .mf. Sits on the app's light page (no dark surface); the
   elements themselves carry a wider palette and gentle motion for life.
   ============================================================ */
.mf{
  --a1:#10B981; --a2:#06C1B6; --glow:rgba(16,185,129,.35);
  --mfink:#17202E; --mfink2:#5E6B82; --mfink3:#98A2B3;
  --mfline:rgba(16,32,52,.08);
  --mffont:var(--font-ui);
  --mfmono:var(--font-mono);
  --c-blue:#3B6FD4; --c-blue-bg:#EEF3FF; --c-violet:#7C5CFF; --c-violet-bg:#F2EEFF;
  --c-amber:#B7791F; --c-amber-bg:#FFF6E6; --c-rose:#E5473C; --c-rose-bg:#FFEEF0;
  font-family:var(--mffont); color:var(--mfink);
}
.mf.mf-line{ --a1:#4C6FFF; --a2:#28B7F0; --glow:rgba(76,111,255,.3);
  /* The room has its own pair, deliberately separate from the accent. They do
     different jobs: --a1/--a2 tint small controls, which need to stay bright
     enough to read as tappable, while the room is a large filled field that at
     that brightness glares on a screen somebody sits in front of all day. Same
     blue family, two stops down. */
  --stn-a:#2B3A80; --stn-b:#215F80; }
/* ---- the phone stations ----
   Every colour here comes from --a1 / --a2 / --glow, which is why the room
   arrives blue without a blue variant being written for it: the Phone Line
   already sets that pair, and Live Floor sets the same two names to green. A
   literal here would be the one thing that broke that. */
.stn{ background:#fff; border:1px solid var(--mfline); border-radius:18px; padding:16px;
  box-shadow:0 1px 2px rgba(16,32,52,.04),0 12px 30px -20px rgba(16,32,52,.22); margin-top:14px; }
/* The room is the blue thing, not the desks. Inverted from the first draft
   for a reason worth keeping: what a manager scans this for is who is where,
   and an occupied seat now reads as a solid white chip on a coloured ground —
   the highest contrast on the card lands on the one piece of information the
   card exists to carry. Empty seats recede into the room instead of competing
   with it. */
.stn-map .fbp{ background:linear-gradient(140deg,var(--stn-a,var(--a1)),var(--stn-b,var(--a2))); border-radius:14px; }
.stn-map .fbp-zone{ border-color:rgba(255,255,255,.22); color:rgba(255,255,255,.5); }
.stn-map .fbp-tbl.stn-off{ background:rgba(255,255,255,.12); color:rgba(255,255,255,.78);
  border:1.5px dashed rgba(255,255,255,.48); }
.stn-map .fbp-tbl.stn-off:hover{ background:rgba(255,255,255,.18); border-style:solid;
  border-color:rgba(255,255,255,.7); color:#fff; }
.stn-map .fbp-tbl.stn-on{ background:#fff; border-color:transparent; color:var(--mfink);
  box-shadow:0 10px 26px -12px rgba(8,20,60,.45); }
.stn-map .fbp-tbl.stn-on .fbp-sub{ color:var(--mfink2); }
.stn-map .fbp-tbl.stn-on .fbp-flag{ background:color-mix(in srgb,var(--a1) 14%, #fff); color:var(--a1); }
/* Held: still theirs, but we have not heard from them. Greyed rather than
   dimmed, because a dimmed white chip on a blue ground just reads as further
   away, and this has to read as a different KIND of thing — the seat is taken
   and the person is not answering for it. */
.stn-map .fbp-tbl.stn-on.stn-held{ background:rgba(255,255,255,.62); color:var(--mfink2);
  box-shadow:0 6px 16px -10px rgba(8,20,60,.35); }
.stn-map .fbp-tbl.stn-on.stn-held .fbp-sub{ color:var(--mfink3); }
.stn-map .fbp-tbl.stn-on.stn-held .fbp-flag{ background:rgba(16,32,52,.08); color:var(--mfink2); }
/* Offered: free, but with a name on it. Read as a dashed chip that has
   brightened rather than as a taken one — the seat is still empty, and drawing
   it like an occupied chair would have a manager walk over to an empty desk.
   The pulse is what says the clock is running. */
/* An empty desk with a name on it. Still the free style — dashed, recessed —
   because it IS free; the name is a label, and drawing it like an occupied
   chair would have a manager walk over to nobody. */
.stn-map .fbp-tbl.stn-off.stn-own{ border-style:solid; border-color:rgba(255,255,255,.34); }
.stn-map .fbp-tbl.stn-off.stn-own .fbp-sub{ color:rgba(255,255,255,.62); font-weight:500; }
.stn-map .fbp-tbl.stn-off.stn-due{ background:rgba(255,255,255,.3); color:#fff;
  border-style:solid; border-color:rgba(255,255,255,.85);
  animation:stnDue 2.4s ease-in-out infinite; }
.stn-map .fbp-tbl.stn-off.stn-due .fbp-sub{ color:rgba(255,255,255,.92); }
.stn-map .fbp-tbl.stn-off.stn-due .fbp-flag{ background:#fff; color:var(--a1); font-weight:600; }
@keyframes stnDue{ 0%,100%{ box-shadow:0 0 0 0 rgba(255,255,255,.42); }
  50%{ box-shadow:0 0 0 7px rgba(255,255,255,0); } }
@media (prefers-reduced-motion: reduce){ .stn-map .fbp-tbl.stn-off.stn-due{ animation:none; } }
/* Who the room is waiting on, under the map. Reads without a tap, because the
   answer to "why is station 4 empty" is usually "it is Ana's, for ninety more
   seconds". */
/* The one panel that is not the room's blue. A warning that wears the same
   accent as everything else on the card is a warning nobody reads, and this is
   the only place on the screen where the answer is meant to cost a moment. */
/* Both classes, because .stn-pick sets the same properties further down this
   sheet and a single class would lose to it on source order alone. */
/* On a handset the title and the count fight over one row and the title wraps
   mid-phrase. They are two different readings anyway, so give them a line each
   rather than shrinking either. */
.stn-pick{ margin-top:12px; padding:12px 14px; border-radius:14px;
  background:color-mix(in srgb,var(--a1) 6%, #fff); border:1px solid color-mix(in srgb,var(--a1) 22%, transparent); }
/* The room switch on a salesperson's phone. Floats above whichever shell is
   showing rather than living inside either, so neither had to be reworked to
   gain it, and it is drawn only when the store offers more than one room. */
/* One bar at the foot for everywhere this phone can be: their corner, the
   floor, the phone room. Built to look like the pill the floor shell already
   had down there, because for a store with only the floor it is that pill —
   the same two buttons in the same place — and gains a third only when the
   store turns the phone line on.

   101 and not 60, which is where this started and where it was unreachable:
   the shell root itself is z-index 100 and creates a stacking context, so
   anything below that number is painted under the whole screen no matter what
   it sits above inside it. */
/* the strip that says the screen is the phone's memory, not the network */
.ar-net{ position:fixed; z-index:102; bottom:calc(env(safe-area-inset-bottom, 0px) + 82px); left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:7px; padding:7px 13px; border-radius:999px; background:rgba(31,42,34,.88); color:#E4C98D; white-space:nowrap;
  font:700 10.5px var(--sfmono, ui-monospace, monospace); letter-spacing:.1em; text-transform:uppercase; box-shadow:0 8px 24px -12px rgba(0,0,0,.6); pointer-events:none; }
.boot-stall{ position:fixed; z-index:70; left:50%; top:50%; transform:translate(-50%,-50%); width:min(320px, calc(100vw - 40px));
  background:#fff; color:#1F2A22; border-radius:18px; padding:20px 20px 18px; box-shadow:0 24px 60px -20px rgba(0,0,0,.45); text-align:center; }
.boot-stall.phone{ background:#0D130F; color:#EDF2EA; box-shadow:0 24px 60px -20px rgba(0,0,0,.8), inset 0 0 0 1px rgba(255,255,255,.08); }
.boot-stall-h{ font-size:17px; font-weight:800; letter-spacing:-.01em; }
.boot-stall p{ margin:8px 0 14px; font-size:13.5px; line-height:1.45; opacity:.75; }
.boot-stall button{ min-height:44px; padding:0 22px; border-radius:12px; border:0; background:#1F2A22; color:#fff; font-weight:700; font-size:14px; cursor:pointer; }
.boot-stall.phone button{ background:#8FD8AF; color:#12251B; }
.boot-slow{ position:fixed; z-index:61; left:0; right:0; top:calc(50% + 70px); text-align:center; color:rgba(255,255,255,.75);
  font:700 11px var(--sfmono, ui-monospace, monospace); letter-spacing:.14em; text-transform:uppercase; animation:loadFadeIn .45s both; }
.ar-bar{ position:fixed; z-index:101; left:50%; transform:translateX(-50%);
  bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);
  display:flex; padding:4px; border-radius:999px;
  background:rgba(6,10,8,.86); border:1px solid rgba(255,255,255,.13);
  backdrop-filter:blur(10px) saturate(140%); -webkit-backdrop-filter:blur(10px) saturate(140%);
  box-shadow:0 10px 24px -10px rgba(0,0,0,.7); }
.ar-ind{ position:absolute; left:4px; top:4px; bottom:4px; border-radius:999px;
  background:rgba(255,255,255,.15);
  transition:transform .38s cubic-bezier(.3,1.6,.4,1); will-change:transform; }
.ar-tab{ position:relative; display:grid; place-items:center; width:64px; height:44px;
  border:0; background:none; cursor:pointer; color:rgba(255,255,255,.42);
  transition:color .2s; }
.ar-tab.on{ color:#fff; }
@media (prefers-reduced-motion: reduce){ .ar-ind{ transition:none; } }
/* The bar floats, so the last card in the shell has to end above it. Padding on
   the scroll container was the first try and it does nothing: when the content
   is shorter than the screen there is nothing to scroll, and space added below
   the content does not move the content up. The clearance has to be on the
   column the cards are actually in.

   Only when the bar is drawn: a store with one room carries no gap for a
   control it does not have. */
.lpc:has(> .ar-bar) .q-page{ padding-bottom:72px; }
.lpc:has(> .ar-bar) .sf-live{ padding-bottom:74px; }
.lpc:has(> .ar-bar) .mc{ padding-bottom:104px; }
/* Both rooms switched off. Somebody did that deliberately, so it is said
   plainly rather than drawn as an empty shell they will tap at. */
.ar-none{ min-height:100dvh; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:12px; padding:32px 26px; text-align:center;
  background:#10141F; color:rgba(255,255,255,.8); }
.ar-none-h{ font-family:var(--mffont); font-size:19px; font-weight:600; color:#fff; }
.ar-none p{ margin:0; max-width:34ch; font-size:13.5px; line-height:1.55; color:rgba(255,255,255,.6); }
/* The phone room's own settings card. Two questions, and only the first of
   them actually differs between most stores. */
.prc-mode.on{ border-color:transparent; background:color-mix(in srgb,#4C6FFF 8%, #fff);
  box-shadow:0 0 0 1.5px #4C6FFF, 0 10px 24px -14px rgba(76,111,255,.5); }
.prc-mode.on b{ color:#2B44B8; }
/* ---- the room, at a desk ----
   The handset's view given the space it was short of. Same objects in the same
   order — the room, the rail beneath it, then the day — so a manager who moves
   between the two is looking at one design at two sizes. What the desk adds is
   the side panel, the stat chips, and the day drawn out rather than hidden
   behind a button. */
/* The room takes the width it was drawn for and the side panel takes what is
   left, rather than the two splitting evenly: the map is the thing being read
   and the panel is a caption on it. */
.sd-room .fbp-scroll{ border-radius:16px; }
.sd-room .fbp{ background:rgba(0,0,0,.16); border-radius:16px; }
/* Who is where, which is what the panel is for. One row per desk, in the
   room's own order, so the list and the map are read the same way round. */
.sd-w.on{ background:rgba(255,255,255,.14); }
.sd-w.held{ background:rgba(255,255,255,.06); }
/* An empty desk with a name on it, and an offered one, are both quieter than a
   person actually sitting there. */
.sd-wnm.dim{ font-weight:400; color:rgba(255,255,255,.46); }
.sd-w.held .sd-wnm{ color:rgba(255,255,255,.6); }
.sd-w.held .sd-wav{ opacity:.55; }
/* The panel opens inside the hero so the room does not jump down the page
   every time a seat is tapped. */
.sd-panel.warn{ background:color-mix(in srgb,#C77800 10%, #fff); }
.sd-panel.warn .sd-ptitle{ color:#8A5300; }
.sd-cov .fr-hours i.ok{ background:#1E8A4C; }
.sd-cov .fr-hours i.gap{ background:#C2361F; }
/* A narrow desk, and the iPad in portrait: the side panel drops under the room
   and the day's two readings stack rather than each getting half of nothing. */
@media (max-width:1100px){
  /* The desk list goes two-across when it is under the room rather than beside
     it, so six desks do not become six full-width rows. */
}
/* ---- the day so far ----
   A grid of stations against hours, drawn by how much of each hour the seat
   was staffed rather than whether it was used at all. Fifteen minutes of cover
   is not an hour of it and must not read the same, so the fill is a fraction
   and the cell carries it as a custom property. */
/* The fill is the accent at the cell's own fraction, over the empty ground, so
   an untouched hour is a faint tick rather than a hole in the grid. */
/* The room row carries the count, so the shade is a second telling of the
   same thing and does not need to be strong. Held light and the number dark,
   because white on a third-strength tint is the one cell that was hard to
   read. */
.mf.mf-online{ --a1:#8B5CF6; --a2:#C05CF0; --glow:rgba(139,92,246,.32); }
/* soft one-time entrance */
.mf > *{ animation:mfRise .5s cubic-bezier(.2,.8,.2,1) both; }
.mf > *:nth-child(2){ animation-delay:.04s; }
.mf > *:nth-child(3){ animation-delay:.08s; }
.mf > *:nth-child(4){ animation-delay:.12s; }
.mf > *:nth-child(5){ animation-delay:.16s; }
@keyframes mfRise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
/* banner */
/* stat strip -> white / softly tinted cards, big colored numbers */
/* buttons -> light pills */
.mf .btn{ background:#fff; border:1px solid var(--mfline); color:var(--mfink); border-radius:12px; font-family:var(--mffont); font-weight:500; box-shadow:0 1px 2px rgba(16,32,52,.05); transition:.15s; }
.mf .btn:hover{ transform:translateY(-1px); box-shadow:0 5px 14px rgba(16,32,52,.10); }
.mf .btn.btn-primary{ background:linear-gradient(90deg,var(--a1),var(--a2)); color:#fff; border-color:transparent; font-weight:600; box-shadow:0 12px 24px -12px var(--glow); }
.mf .btn.btn-primary:disabled{ box-shadow:none; }
.mf .btn-sm{ border-radius:10px; font-size:12px; }
/* opportunities leaderboard */
.mf .q-opps{ background:#fff; border:1px solid var(--mfline); border-radius:18px; box-shadow:0 1px 2px rgba(16,32,52,.04),0 10px 26px -20px rgba(16,32,52,.2); }
.mf .q-opps-head{ color:var(--mfink2); }
.mf .q-opps-total{ color:#fff; }
.mf .q-opps-empty{ color:var(--mfink3); }
.mf .lb-card{ background:#F6F7FB; border:1px solid var(--mfline); }
.mf .lb-fill{ opacity:.1 !important; }
.mf .lb-lead .lb-fill{ opacity:0 !important; }
.mf .lb-rank{ color:var(--mfink3); }
.mf .lb-nm{ color:var(--mfink); text-shadow:none; font-weight:700; }
.mf .lb-n{ color:var(--mfink); text-shadow:none; }
.mf .lb-crown{ color:var(--a1); opacity:1; }
.mf .lb-lead{ border-color:transparent; background:linear-gradient(120deg, color-mix(in srgb,var(--a1) 12%, #fff), #fff 70%); box-shadow:0 0 0 1.5px color-mix(in srgb,var(--a1) 55%, transparent), 0 14px 30px -16px var(--glow); }
/* next-up hero */
/* line rows -> white cards; next highlighted; off muted */
.mf .q-line{ display:flex; flex-direction:column; gap:9px; }
.mf .q-row{ background:#fff; border:1px solid var(--mfline); border-radius:16px; padding:11px 14px; align-items:center;
  box-shadow:0 1px 2px rgba(16,32,52,.05); transition:transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s, background .3s, border-color .3s; }
.mf .q-row:hover{ transform:translateY(-1px); box-shadow:0 8px 20px -8px rgba(16,32,52,.16); }
.mf .q-row.q-off{ opacity:.7; background:#FAFBFC; }
.mf .q-row.q-next{ border-color:transparent;
  background:linear-gradient(120deg, color-mix(in srgb,var(--a1) 12%, #fff), #fff 70%);
  box-shadow:0 0 0 1.5px color-mix(in srgb,var(--a1) 55%, transparent), 0 14px 30px -16px var(--glow); }
.mf .q-ord-b{ background:transparent; border:none; color:var(--mfink3); cursor:pointer; }
.mf .q-ord-b:hover:not(:disabled){ color:var(--mfink); }
.mf .q-ord-b:disabled{ opacity:.3; }
.mf .q-rank{ font-family:var(--mfmono); color:var(--mfink3); font-size:13px; min-width:18px; text-align:center; }
/* The round initials badge. Not scoped to the Live Floor any more: the People
   screen has been drawing the same span since it was written and getting a bare
   coloured rectangle, because the only rule for it lived under .mf. One rule, so
   a face looks the same wherever the app draws it. */
.mf .q-nm{ font-family:var(--mffont); font-weight:600; color:var(--mfink); font-size:15px; display:flex; align-items:center; }
.mf .q-next-tag{ background:linear-gradient(90deg,var(--a1),var(--a2)); color:#fff; font-family:var(--mfmono); font-size:10px; font-weight:600; letter-spacing:.06em; padding:2px 8px; border-radius:999px; margin-left:8px; }
.mf .q-meta{ margin-top:5px; display:flex; align-items:center; gap:8px; }
.mf .q-w{ font-family:var(--mfmono); font-size:12px; color:var(--mfink3); }
.mf .q-chip{ font-family:var(--mfmono); font-size:11px; border-radius:999px; padding:3px 10px; border:none; }
.mf .q-chip.q-waiting,.mf .q-chip.f-waiting{ background:var(--c-blue-bg); color:var(--c-blue); }
.mf .q-chip.q-customer,.mf .q-chip.f-customer{ background:var(--c-violet-bg); color:var(--c-violet); }
.mf .q-chip.q-lunch,.mf .q-chip.f-lunch{ background:var(--c-amber-bg); color:var(--c-amber); }
.mf .q-chip.q-away,.mf .q-chip.f-away{ background:var(--c-rose-bg); color:var(--c-rose); }
.mf .f-tag{ font-family:var(--mfmono); }
.mf .f-tag-appt{ background:var(--c-blue-bg); color:var(--c-blue); }
.mf .f-tag-prop{ background:var(--c-amber-bg); color:var(--c-amber); }
.mf .f-auto{ font-family:var(--mfmono); background:color-mix(in srgb,var(--a1) 14%, transparent); color:var(--a1); }
.mf .q-flag-sel{ background:#fff; border:1px solid var(--mfline); color:var(--mfink); border-radius:10px; font-family:var(--mffont); font-size:12px; padding:6px 8px; }
.mf .q-rm{ color:var(--c-rose); }
/* ---- the queue row on a tablet ----
   Between a phone and a desk the row has the desktop's contents and nowhere
   near its width, so everything that could wrap did: the name onto two lines,
   the status away from its own wait time, the buttons onto a second row. The
   row is a single scannable line or it is not doing its job — a manager reads
   down this list looking for one person.

   Two things give the width back. The "today" and "open" counts step out,
   because they are context rather than the thing being done, and they are on
   the person's own card either way. And the name and its status stop wrapping,
   with the name taking an ellipsis if somebody's is genuinely too long, which
   is the one place a truncation is better than a fold. */
@media (min-width:701px) and (max-width:1279px){
  .mf .q-row{ gap:10px; }
  .mf .q-who{ min-width:0; }
  .mf .q-nm{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mf .q-meta{ white-space:nowrap; flex-wrap:nowrap; }
  .mf .q-ups{ display:none; }
  .mf .q-row-actions{ flex-wrap:nowrap; flex:0 0 auto; }
  .mf .q-row-actions .btn{ white-space:nowrap; }
}
/* panels */
.mf .q-missing, .mf .f-unmatched, .mf .q-add{ background:#fff; border:1px solid var(--mfline); border-radius:16px; box-shadow:0 1px 2px rgba(16,32,52,.04); }
.mf .q-add{ padding:12px 16px; }
.mf .q-missing-head, .mf .f-unmatched-head{ font-family:var(--mffont); font-weight:600; color:var(--mfink); }
.mf .q-pin-name{ color:var(--mfink); }
.mf .q-qr-box{ background:#fff; }
.mf .q-missing-chip{ background:#fff; border:1px solid var(--mfline); border-radius:999px; color:var(--mfink2); }
.mf .q-missing-chip:hover{ border-color:var(--a1); color:var(--mfink); }
.mf .q-empty, .mf .muted{ color:var(--mfink3); }
.mf .f-warn{ background:var(--c-amber-bg); border:1px solid #F2D9A8; color:#7A5A12; }
.mf .f-warn strong{ color:#5E4610; }
@media (prefers-reduced-motion:reduce){ .mf > *{ animation:none; } }
/* use more of the screen + two-column lower region */
.checkout.mf{ max-width:min(1820px, 97vw); }
/* The sidebar costs the line list 370px plus a gap, and the list is the part
   with the work in it. At 1080 the split was too eager: an iPad in landscape is
   1180 and was handing Smart assign a column while squeezing every queue row
   into ~590px, which is where the names started wrapping onto two lines and the
   buttons onto two rows. Landscape was worse than portrait for that reason
   alone. 1280 is the width where both halves actually fit. */
/* Smart assign panel */
/* instrument cluster (Floor Health + gauges) */
.mf{ --mf-track:#EBEEF3; }
.ic{ display:grid; grid-template-columns:minmax(300px,360px) 1fr; gap:14px; align-items:stretch; margin-bottom:16px; }
@media (max-width:900px){ .ic{ grid-template-columns:1fr; } }
.ic-gauges{ display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
@media (min-width:1300px){ .ic-gauges{ grid-template-columns:repeat(4,1fr); } }
/* activity timeline */
/* Settings tab, brought into the light board theme */
.mf-settings .card{ background:#fff; border:1px solid var(--mfline); border-radius:20px; box-shadow:0 1px 2px rgba(16,32,52,.04),0 12px 30px -22px rgba(16,32,52,.2); padding:20px; margin-bottom:14px; }
.mf-settings .hint{ color:var(--mfink2); font-size:13px; line-height:1.5; }
/* ============================================================
   SALESPERSON VIEW — dark, fluid, responsive (Phone Line + Live Floor)
   Scoped under .q-page.sf so the manager app is untouched.
   ============================================================ */
.q-page.sf{
  --a1:#0FB37E; --a2:#0BC5C5; --led:#7CF0D0; --glow:rgba(15,179,126,.5); --ld-off:rgba(124,240,208,.14);
  --sfink:#EEF2F9; --sfink2:#9BA8BF; --sfink3:#5A6478; --sfcard:rgba(255,255,255,.045); --sfstroke:rgba(255,255,255,.09);
  --sffont:var(--font-ui);
  --sfmono:var(--font-mono);
  font-family:var(--sffont); color:var(--sfink); letter-spacing:-.005em; padding:0;
  background:radial-gradient(1000px 680px at 15% -10%, rgba(11,197,197,.05), transparent 60%), #06090F;
  position:fixed; inset:0; width:100%; height:100dvh; min-height:100dvh; border-radius:0; z-index:100;
  overflow-y:auto; overscroll-behavior:contain;
  scrollbar-width:none; -ms-overflow-style:none;
}
.q-page.sf::-webkit-scrollbar{ width:0; height:0; }
.q-page.sf.sf-line{ --a1:#5566F0; --a2:#37B6F0; --led:#9DC3FF; --glow:rgba(85,102,240,.5); --ld-off:rgba(157,195,255,.14); }
.q-page.sf.sf-online{ --a1:#8B5CF6; --a2:#C05CF0; --led:#D8B4FE; --glow:rgba(139,92,246,.5); --ld-off:rgba(216,180,254,.16); }
/* ============================================================
   FLOORSIDE — the way in, and the day
   ============================================================
   Full-bleed rather than a card on a background. The queue's accent bleeds up
   from the floor of the screen so a salesperson can tell which of the three
   they are standing in without reading the label, and the spine down the right
   edge draws the queue itself. */
/* The main stylesheet has no global border-box, so every width:100% below would
   otherwise add its own padding and border on top and run past the edge — which
   is exactly what the task list did, by 10px. Scoped to this subtree so nothing
   in the manager app moves. */
.q-page.sf, .q-page.sf *, .q-page.sf *::before, .q-page.sf *::after{ box-sizing:border-box; }
.q-page.sf::before{
  content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
  background:
    radial-gradient(96% 52% at 18% 100%, color-mix(in srgb, var(--a1) 88%, transparent), transparent 70%),
    radial-gradient(84% 44% at 92% 88%,  color-mix(in srgb, var(--a2) 66%, transparent), transparent 72%),
    radial-gradient(70% 34% at 52% 114%, color-mix(in srgb, var(--led) 40%, transparent), transparent 68%);
}
/* Safari 15 and older have no color-mix. A flat wash beats no ground at all. */
@supports not (background: color-mix(in srgb, red 10%, transparent)){
  .q-page.sf::before{ background:linear-gradient(0deg, var(--a1), transparent 62%); opacity:.5; }
}
.sf .q-stage{ align-items:stretch; min-height:100dvh; }
/* the frame: body left, spine right */
.sf-view{ display:flex; width:100%; min-height:100dvh; align-items:stretch; }
.sf-body{
  flex:1 1 auto; min-width:0; display:flex; flex-direction:column;
  padding:calc(18px + var(--sat)) 6px
          calc(26px + var(--sab) + var(--kb,0px)) 22px;
  /* --kb is the keyboard's height, measured off visualViewport. Growing the
     bottom padding lifts the field, and the transition is what makes it rise
     into place instead of jumping as the keyboard lands. */
  transition:padding-bottom .26s var(--ease);
}
/* .sf-body is a column flex container, so every child is shrinkable by default
   and a tall child gets squeezed instead of scrolling. Nothing in here shrinks. */
.sf-body > *{ flex:0 0 auto; }
/* ---- the spine ---- */
.sf-spine{
  flex:0 0 46px; display:flex; flex-direction:column; align-items:center;
  padding:calc(20px + var(--sat)) 0
          calc(26px + var(--sab) + var(--kb,0px));
  transition:padding-bottom .26s var(--ease);
}
/* the spine's label starts below the help button, which shares this corner */
.sf-spine-cap{ margin-top:46px; }
.sf-spine-cap{
  font-family:var(--sfmono); font-size:9px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--sfink3); writing-mode:vertical-rl; margin-bottom:12px; white-space:nowrap;
}
.sf-spine-track{
  flex:1 1 auto; width:1px; background:rgba(255,255,255,.09);
  display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:4px 0;
}
.sfn{
  width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.09); flex:0 0 auto; display:grid; place-items:center;
  transition:background .4s var(--ease), box-shadow .4s var(--ease), width .4s var(--ease-bloop), height .4s var(--ease-bloop);
}
.sfn.past, .sfn.done{ background:color-mix(in srgb, var(--a2) 45%, transparent); border-color:transparent; }
.sfn.ring{ width:13px; height:13px; background:transparent; border-color:transparent; }
.sfn.mine{
  width:15px; height:15px; background:var(--a2); border-color:transparent;
  box-shadow:0 0 0 4px color-mix(in srgb, var(--a2) 20%, transparent), 0 0 18px var(--a2);
}
/* ---- type ---- */
.sf-mark{
  display:inline-flex; align-items:center; gap:8px; align-self:flex-start;
  font-family:var(--sfmono); font-size:10px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--led); padding:6px 11px 6px 8px; border-radius:999px;
  background:color-mix(in srgb, var(--a1) 16%, transparent);
  border:1px solid color-mix(in srgb, var(--a2) 26%, transparent);
}
.sf-kicker{
  font-family:var(--sfmono); font-size:10px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--sfink3); margin:26px 0 0;
}
.sf-display{
  font-family:var(--sffont); font-size:clamp(32px,10vw,44px); line-height:.97;
  letter-spacing:-.045em; font-weight:660; margin:10px 0 0; color:var(--sfink);
}
.sf-display.sm{ font-size:clamp(27px,8vw,34px); }
.sf-display .sf-dim{ color:var(--sfink3); display:block; }
.sf-sub{ color:var(--sfink2); font-size:14px; margin:14px 0 0; max-width:28ch; }
.sf-err{
  color:#FFB4AE; font-size:13px; margin:14px 0 0; max-width:30ch;
  padding:10px 12px; border-radius:12px;
  background:rgba(239,106,114,.12); border:1px solid rgba(239,106,114,.28);
}
/* ---- the field at the foot ---- */
.sf-field{ margin-top:auto; padding-top:26px; padding-right:16px; display:flex; flex-direction:column; gap:10px; }
.sf-input{
  -webkit-appearance:none; appearance:none;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.09);
  border-radius:16px; padding:15px 17px; font-family:var(--sffont); font-size:17px;
  color:var(--sfink); width:100%; outline:none;
  transition:border-color .2s var(--ease), box-shadow .2s var(--ease);
}
.sf-input::placeholder{ color:var(--sfink3); }
/* The background is declared on all three states on purpose. The manager
   sheet carries input:hover and input:focus rules that set a white
   background, and a type-plus-pseudo-class selector outranks a bare class —
   so leaving any state's background unstated let the white through. */
.sf-input:hover{ background:rgba(255,255,255,.07); }
.sf-input:focus, .sf-input:focus-visible{
  background:rgba(255,255,255,.07); color:var(--sfink);
  border-color:var(--a2); box-shadow:0 0 0 4px color-mix(in srgb, var(--a2) 18%, transparent);
}
/* iOS paints its own yellow-white over an autofilled field, and there is no way
   to set the background of one — an inset shadow the full height of the box is
   the only thing that covers it. */
.sf-input:-webkit-autofill, .sf-input:-webkit-autofill:focus{
  -webkit-text-fill-color:var(--sfink);
  -webkit-box-shadow:0 0 0 60px #101722 inset;
  caret-color:var(--sfink);
}
.sf-cta{
  font-family:var(--sffont); font-size:16px; font-weight:650; letter-spacing:-.01em;
  color:#08101B; background:linear-gradient(140deg, var(--led), var(--a2));
  border:0; border-radius:16px; padding:16px; cursor:pointer; width:100%;
  transition:transform .3s var(--ease-bloop), opacity .2s var(--ease);
}
.sf-cta:disabled{ opacity:.45; }
.sf-cta-quiet{
  background:rgba(255,255,255,.06); color:var(--sfink);
  border:1px solid rgba(255,255,255,.1);
}
.sf-back{
  align-self:flex-start; display:inline-flex; align-items:center; gap:8px;
  font-family:var(--sffont); font-size:13px; font-weight:600; color:var(--sfink3);
  background:none; border:0; cursor:pointer; padding:6px 8px 6px 0;
}
.sf-back:active{ color:var(--sfink2); }
/* ---- a list of names ---- */
.sf-names{ margin-top:20px; padding-right:16px; display:flex; flex-direction:column; gap:8px; }
.sf-names-tall{ margin-top:22px; }
.sf-names-cap{
  font-family:var(--sfmono); font-size:9.5px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--sfink3); margin:0 0 4px;
}
.sf-name{
  display:flex; align-items:center; gap:9px; width:100%; text-align:left;
  font-family:var(--sffont); font-size:15.5px; font-weight:600; color:var(--sfink);
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.07);
  border-radius:15px; padding:14px 15px; cursor:pointer;
  transition:transform .3s var(--ease-bloop), border-color .2s var(--ease);
}
.sf-name:disabled{ opacity:.42; }
.sf-name i{ font-style:normal; font-size:11.5px; font-weight:600; color:var(--sfink3); }
.sf-name em{
  font-style:normal; margin-left:auto; font-family:var(--sfmono); font-size:9px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--led);
}
/* ---- the PIN pad ----
   Four cells that light as digits land, and a pad that owns the bottom third.
   The field is gone entirely, so iOS never puts its keyboard up and the layout
   never moves under a thumb. */
.sf-pin-cells{ display:flex; gap:10px; margin:26px 0 0; padding-right:16px; }
.sf-pin-cell{
  flex:0 0 auto; width:46px; height:58px; border-radius:14px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.09);
  display:grid; place-items:center; color:var(--led);
  transition:border-color .3s var(--ease), background .3s var(--ease);
}
.sf-pin-cell.on{
  border-color:color-mix(in srgb, var(--a2) 60%, transparent);
  background:color-mix(in srgb, var(--a1) 14%, transparent);
}
.sf-pad{
  margin-top:auto; padding-top:24px; padding-right:16px;
  display:grid; grid-template-columns:repeat(3,1fr); gap:9px;
}
/* Geist, like every other button in the app — the sweep rule above owns this and
   a local font-family here would be dead code. tabular-nums is what a keypad
   actually needs from its digits: without it the 1 is narrower than the 8 and
   the pad reads as slightly crooked. */
.sf-key{
  font-size:22px; font-weight:500; color:var(--sfink); font-variant-numeric:tabular-nums;
  background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.05);
  border-radius:16px; min-height:52px; cursor:pointer; display:grid; place-items:center;
  transition:transform .26s var(--ease-bloop), background .16s var(--ease);
}
.sf-key:active{ background:color-mix(in srgb, var(--a1) 26%, transparent); }
.sf-key:disabled{ opacity:.4; }
.sf-key-word{ font-size:12.5px; font-weight:650; letter-spacing:.02em; }
.sf-key-go{ color:#08101B; background:linear-gradient(140deg, var(--led), var(--a2)); border-color:transparent; }
/* ---- the day, the list, and one number ----
   The day screen is the same frame as the way in: body left, spine right, the
   queue's colour bleeding up from the floor. It arrives over the live screen as
   its own surface rather than as a sheet, because it is a place rather than a
   panel. */
.sf-day-root{ z-index:200; }
.sf-day-root .sf-view{ position:relative; z-index:1; }
.sf-cap{
  display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  margin:28px 0 12px; padding-right:16px;
  font-family:var(--sfmono); font-size:9.5px; letter-spacing:.2em; text-transform:uppercase;
  color:var(--sfink3);
}
.sf-cap b{ color:var(--sfink2); font-weight:600; letter-spacing:.1em; }
/* one band per number: the figure on the dot grid, the label, how far along */
.sf-bands{ padding-right:16px; }
.sf-band{
  display:flex; align-items:center; gap:14px; width:100%; text-align:left;
  padding:14px 0; background:none; border:0;
  border-bottom:1px solid rgba(255,255,255,.05); cursor:pointer; color:inherit;
  font-family:var(--sffont); transition:transform .3s var(--ease-bloop);
}
.sf-band:last-child{ border-bottom:0; }
.sf-band-fig{ flex:0 0 auto; }
.sf-band-dm{ --cell:5px; display:block; }
.sf-band-dm .ld{ background:var(--ld-off); }
.sf-band-dm .ld.on{ background:var(--led); box-shadow:none; }
.sf-band-dm.made .ld.on{ background:#3ECF6E; }
/* the digits animate in on the live screen, which is right there and wrong in a
   list of five that is read at a glance */
.sf-band-dm .dm-digit{ animation:none; }
.sf-band-txt{ flex:1 1 auto; min-width:0; }
.sf-band-lbl{ display:block; font-size:15px; font-weight:640; letter-spacing:-.015em; color:var(--sfink); }
.sf-band-of{
  display:block; font-family:var(--sfmono); font-size:10.5px; letter-spacing:.06em;
  font-variant-numeric:tabular-nums;
  color:var(--sfink3); margin-top:4px; text-transform:uppercase;
}
.sf-band-of b{ color:#4FD98A; font-weight:600; }
.sf-band-go{ flex:0 0 auto; opacity:.3; color:var(--sfink2); }
.sf-meter{ display:block; height:3px; border-radius:2px; background:rgba(255,255,255,.08); margin-top:10px; overflow:hidden; }
.sf-meter i{ display:block; height:100%; border-radius:2px; background:linear-gradient(90deg, var(--a1), var(--led)); }
.sf-meter.done i{ background:#3ECF6E; }
/* closing rates: three across, because comparing them is the point of them */
.sf-rates{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding-right:16px; }
.sf-rate{
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.06);
  border-radius:15px; padding:13px 11px; position:relative; overflow:hidden;
  display:flex; flex-direction:column;
}
.sf-rate::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:2px; background:var(--tone); }
.sf-tone-g{ --tone:#3ECF6E; }
.sf-tone-y{ --tone:#EFD75A; }
.sf-tone-r{ --tone:#EF6A72; }
.sf-tone-dim{ --tone:rgba(255,255,255,.14); }
.sf-rate-v{ font-size:23px; font-weight:680; letter-spacing:-.04em; line-height:1; color:var(--tone);
  font-variant-numeric:tabular-nums; }
.sf-rate-l{ display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:620; color:var(--sfink); margin-top:8px; }
.sf-rate-mark{ opacity:.85; }
.sf-rate-g{ font-family:var(--sfmono); font-size:9px; letter-spacing:.06em; color:var(--sfink3); margin-top:3px; text-transform:uppercase; }
.sf-rate-m{ font-family:var(--sfmono); font-size:9.5px; margin-top:7px; display:flex; align-items:center; gap:3px; }
.sf-rate-m.up{ color:#4FD98A; }
.sf-rate-m.down{ color:#FF8A80; }
.sf-rate-m.flat{ color:var(--sfink3); }
.sf-rate-m i{ font-style:normal; }
.sf-focus{
  margin-right:16px; border-radius:18px; padding:16px;
  background:linear-gradient(150deg, color-mix(in srgb, var(--tone) 17%, transparent), rgba(255,255,255,.03));
  border:1px solid color-mix(in srgb, var(--tone) 26%, transparent);
}
.sf-focus h4{ margin:0; font-size:16px; letter-spacing:-.025em; font-weight:650; color:var(--sfink); }
.sf-focus-n{ font-family:var(--sfmono); font-size:10.5px; letter-spacing:.06em; color:var(--sfink2); margin-top:5px; text-transform:uppercase; }
.sf-focus p{ margin:11px 0 0; font-size:13px; color:var(--sfink2); line-height:1.5; }
/* ---- the missed-standard gate ----
   Deliberately not styled as an alarm. Red edges and warning triangles on
   somebody's own phone read as a punishment, and a punishment is answered with
   the shortest thing that clears the screen. The point is to find out what is
   actually stopping them, so this is the same card the rest of the panel is made
   of, with the figures stated plainly and the box the only bright thing on it. */
/* Somebody behind the standard, and what they said. Not styled as an alarm and
   not styled as a fault: it sits in a list beside reports that something is
   broken, and this one is a person answering a question they were asked. */
.sf-owe-days{ display:flex; flex-direction:column; gap:8px; margin:18px 16px 0 0; }
.sf-owe-day{
  display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:14px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07);
}
.sf-owe-d{ font-family:var(--sfmono); font-size:10px; letter-spacing:.06em; color:var(--sfink3);
  text-transform:uppercase; min-width:52px; }
.sf-owe-f{ font-size:14px; font-weight:640; color:var(--sfink); font-variant-numeric:tabular-nums; }
.sf-owe-f small{ font-family:var(--sfmono); font-size:9.5px; letter-spacing:.05em; font-weight:400;
  color:var(--sfink3); margin-left:4px; text-transform:uppercase; }
.sf-owe-f.under{ color:#FFC46B; }
.sf-owe-box{ margin:20px 16px 0 0; }
.sf-owe-box label{ display:block; font-size:12px; font-weight:640; color:var(--sfink2);
  letter-spacing:-.01em; margin-bottom:8px; }
.sf-owe-box textarea{
  width:100%; box-sizing:border-box; resize:vertical; min-height:104px;
  font-family:var(--sffont); font-size:15px; line-height:1.45; color:var(--sfink);
  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
  border-radius:16px; padding:14px; outline:none;
}
.sf-owe-box textarea:focus{ border-color:var(--a2); background:rgba(255,255,255,.09); }
.sf-owe-box textarea::placeholder{ color:var(--sfink3); }
.sf-owe-go{
  display:block; width:100%; margin-top:12px; padding:15px 16px; border:0; border-radius:16px;
  font-family:var(--sffont); font-size:15px; font-weight:660; letter-spacing:-.015em;
  color:#0b0b10; background:var(--a2); cursor:pointer;
  transition:transform .3s var(--ease-bloop), opacity .2s linear;
}
.sf-owe-go:disabled{ opacity:.4; cursor:default; }
.sf-owe-fine{ margin:14px 0 0; font-size:12px; line-height:1.55; color:var(--sfink2);
  /* The panel's glow sits under the foot of this screen, and the dimmest ink on
     the palette disappears into it. This line is the one that says the floor is
     not blocked, so it is the last thing that should be hard to read. */
  background:rgba(6,8,14,.55); border-radius:12px; padding:11px 12px; }
.sf-jump{
  display:flex; align-items:center; gap:10px; width:100%; margin:22px 16px 0 0;
  font-family:var(--sffont); font-size:15px; font-weight:640; letter-spacing:-.015em;
  color:var(--sfink); background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.07); border-radius:16px; padding:15px 16px; cursor:pointer;
  transition:transform .3s var(--ease-bloop);
}
.sf-jump span{
  margin-left:auto; font-family:var(--sfmono); font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--sfink3);
}
.sf-stamp{
  font-family:var(--sfmono); font-size:9.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--sfink3); margin:22px 16px 0 0; padding-top:14px;
  border-top:1px solid rgba(255,255,255,.05);
}
.sf-stamp.none{ color:#C79A5A; }
/* ---- the list ---- */
.sf-tasks{ margin-top:20px; padding-right:16px; display:flex; flex-direction:column; gap:8px; }
.sf-task{
  display:block; width:100%; text-align:left; font-family:var(--sffont);
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.06);
  border-radius:15px; padding:13px 15px; cursor:pointer; color:inherit;
  transition:background .2s var(--ease), transform .3s var(--ease-bloop);
}
.sf-task:active{ transform:scale(.98); }
.sf-task.auto{ cursor:default; }
.sf-task.on{
  background:color-mix(in srgb, var(--a1) 13%, transparent);
  border-color:color-mix(in srgb, var(--a2) 24%, transparent);
}
.sf-task-top{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.sf-task-l{ font-size:14.5px; font-weight:630; letter-spacing:-.015em; color:var(--sfink); }
.sf-task.on .sf-task-l{ color:var(--led); }
.sf-task-h{ display:block; font-size:12px; color:var(--sfink3); margin-top:4px; }
.sf-task-c{
  flex:0 0 auto; font-family:var(--sfmono); font-size:10px; letter-spacing:.08em;
  font-variant-numeric:tabular-nums;
  text-transform:uppercase; color:var(--sfink3); display:inline-flex; align-items:center;
}
.sf-task-c.good{ color:#4FD98A; }
.sf-task.pop{ animation:sfPop .5s var(--ease-bloop); }
@keyframes sfPop{ 0%{ transform:scale(1); } 45%{ transform:scale(1.03); } 100%{ transform:scale(1); } }
/* ---- one number ----
   The single flooded surface in the whole flow, and it takes the QUEUE's colour
   rather than one of its own, so nothing here is ever tinted by two things at
   once. The chart is the dot grid again: a column per day, lit from the floor. */
.sf-one{
  margin:20px 16px 0 0; border-radius:24px; padding:16px 16px 18px;
  background:linear-gradient(158deg, var(--led), var(--a1));
  color:#070C13; overflow:hidden;
}
.sf-one-head{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.sf-one-v{ font-size:26px; font-weight:700; letter-spacing:-.04em; line-height:1;
  font-variant-numeric:tabular-nums; }
.sf-one-v small{ font-size:13px; font-weight:600; opacity:.58; letter-spacing:-.01em; }
.sf-one-p{ font-size:19px; font-weight:700; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
.sf-one-track{ display:flex; gap:4px; margin-top:11px; }
.sf-one-track i{ flex:1 1 0; height:3px; border-radius:2px; background:rgba(0,0,0,.19); }
.sf-one-track i.on{ background:#FFFFFF; }
.sf-one-wait{
  margin:20px 0 4px; font-family:var(--sfmono); font-size:10.5px;
  letter-spacing:.1em; text-transform:uppercase; color:rgba(0,0,0,.5);
}
/* height comes from the columns, not a fixed box: on a fixed height the columns
   sat on the floor of it and the callout, pinned above its column, floated clear
   of the tallest bar and landed on the progress track. */
.sf-cols{ display:flex; align-items:flex-end; gap:6px; margin-top:54px; }
.sf-col{
  flex:1 1 0; display:flex; flex-direction:column-reverse; gap:4px;
  align-items:center; position:relative;
}
/* a class, not a bare element selector: the callout lives inside the column too
   and would otherwise pick up the square's fill and 1:1 aspect ratio. */
.sf-sq{ width:100%; aspect-ratio:1; border-radius:5px; background:rgba(255,255,255,.52); }
.sf-sq.off{ background:rgba(0,0,0,.15); }
.sf-col.top .sf-sq{ background:#FFFFFF; }
.sf-col.top .sf-sq.off{ background:rgba(0,0,0,.15); }
.sf-col-call{
  position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%);
  background:#070C13; color:#FFFFFF; border-radius:11px; padding:5px 9px; white-space:nowrap;
  font-family:var(--sfmono); font-size:9px; letter-spacing:.06em; line-height:1.3; text-align:center;
}
.sf-col-call b{ display:block; font-family:var(--sffont); font-size:12px; letter-spacing:-.01em;
  font-variant-numeric:tabular-nums; }
.sf-axis{
  display:flex; justify-content:space-between; margin-top:10px;
  font-family:var(--sfmono); font-size:8.5px; letter-spacing:.06em; color:rgba(0,0,0,.52);
  font-variant-numeric:tabular-nums;
}
.sf-worth{
  margin:9px 16px 0 0; border-radius:18px; padding:15px 16px 16px;
  background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.06);
}
.sf-worth-h{ display:flex; flex-direction:column; align-items:flex-start; gap:1px; }
.sf-worth-h h4{ margin:0; font-size:15px; font-weight:650; letter-spacing:-.025em; color:var(--sfink); white-space:nowrap; }
.sf-worth-h span{ font-family:var(--sfmono); font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:var(--sfink3); }
.sf-worth-rows{ margin-top:13px; display:flex; flex-direction:column; gap:10px; }
.sf-worth-row{ display:flex; align-items:flex-start; gap:9px; font-size:12.5px; color:var(--sfink2); line-height:1.4; }
.sf-worth-row b{ font-weight:650; color:var(--sfink); }
.sf-worth-dot{ width:8px; height:8px; border-radius:50%; flex:0 0 auto; margin-top:5px; }
.sf-worth-dot.t-g{ background:#3ECF6E; }
.sf-worth-dot.t-y{ background:#EFD75A; }
.sf-worth-dot.t-r{ background:#EF6A72; }
/* .sf-loading, not .sf-wait: the live screen already owns .sf-wait for the label
   under its ring, and two rules for one name is how one of them quietly wins. */
.sf-loading{ margin:auto; text-align:center; color:var(--sfink2); }
.sf-loading p{ margin-top:14px; font-family:var(--sfmono); font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; }
/* very short screens: the pad keeps its targets, the heading gives way */
@media (max-height: 680px){
  .sf-display{ font-size:clamp(26px,7.5vw,32px); }
  .sf-pin-cell{ width:40px; height:50px; }
  .sf-key{ min-height:46px; font-size:20px; }
  .sf-kicker{ margin-top:16px; }
}
/* restyle the shared sign-in surfaces (name / pin / pick / confirm) */
/* dot-matrix primitives */
.sf .dm{ display:flex; gap:calc(var(--cell,12px)*.72); align-items:center; justify-content:center; perspective:600px; }
.sf .dm-digit{ display:grid; grid-template-columns:repeat(3,var(--cell,12px)); gap:calc(var(--cell,12px)*.44); transform-style:preserve-3d;
  animation:sfflip .5s cubic-bezier(.3,.7,.25,1) both; }
.sf .dm-digit:nth-child(2){ animation-delay:.05s; }
.sf .dm-digit:nth-child(3){ animation-delay:.1s; }
@keyframes sfflip{ 0%{ transform:rotateX(90deg); opacity:.25; filter:brightness(2.2); } 55%{ transform:rotateX(-9deg); } 100%{ transform:rotateX(0); opacity:1; filter:none; } }
.sf .ld{ width:var(--cell,12px); height:var(--cell,12px); border-radius:50%; background:transparent; }
.sf .ld.on{ background:var(--led); box-shadow:0 0 calc(var(--cell,12px)*.85) var(--led); }
/* the status glyphs are SVG on the 5x5 grid now, not a CSS grid of dots */
.sf .sf-ico{ display:block; color:var(--led); filter:drop-shadow(0 0 3px color-mix(in srgb, var(--led) 55%, transparent)); }
/* the hero "you're on the floor / in line" screen */
.sf-live{ width:100%; max-width:460px; display:flex; flex-direction:column; min-height:100dvh; padding:clamp(52px,8vh,70px) clamp(20px,6vw,26px) clamp(24px,5vh,34px); }
.sf-top{ display:flex; align-items:center; justify-content:space-between; }
.sf-live-dot{ width:7px; height:7px; border-radius:50%; background:var(--a1); box-shadow:0 0 8px var(--glow); }
.sf-poswrap{ position:relative; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.sf-aura{ position:absolute; width:min(82vw,340px); height:min(82vw,340px); border-radius:50%;
  background:radial-gradient(circle at 50% 45%, var(--glow), transparent 62%); opacity:.5; animation:sfbreathe 4.8s ease-in-out infinite; }
@keyframes sfbreathe{ 0%,100%{ transform:scale(.9); opacity:.4; } 50%{ transform:scale(1.08); opacity:.66; } }
.sf-ring{ position:relative; width:min(56vw,214px); height:min(56vw,214px); border-radius:50%; display:grid; place-items:center;
  background:linear-gradient(150deg,var(--a1),var(--a2)); z-index:1; }
.sf-ring::after{ content:""; position:absolute; inset:8px; border-radius:50%; background:#070b12; }
.sf-ringface{ position:relative; z-index:1; --cell:clamp(9px,3.3vw,14px); display:grid; place-items:center; }
.sf-off .sf-ring{ filter:saturate(.35) brightness(.72); }
.sf-off .sf-aura{ opacity:.14; animation:none; }
.sf-meta{ margin-top:clamp(20px,4vh,30px); text-align:center; z-index:1; }
.sf-line-1{ font-size:clamp(24px,6.5vw,27px); font-weight:600; letter-spacing:-.02em; }
.sf-line-2{ font-size:clamp(15px,4.4vw,17px); color:var(--sfink2); margin-top:8px; padding:0 10px; }
/* One face for the whole salesperson view. The mono was meant for figures only and
   had crept onto labels and buttons, which is why the screens read as three
   different apps stitched together. */
/* This is the authority on faces in here, and it beats anything a component
   sets on a button or an input: .sf button is more specific than a class on
   its own, and it sits later in the sheet. Anything that needs the mono face
   goes on the second line rather than declaring it locally, where the sweep
   would silently win. q-notme, q-kicker, q-muted, q-orbit and q-pin-in came off
   the list with the old sign-in markup they belonged to. */
.sf, .sf button, .sf input, .sf .q-mark, .sf-line-1, .sf-line-2{ font-family:var(--sffont); }
.sf-timer b, .sf .dm{ font-family:var(--sfmono); }
/* The queue's own mark, in the queue's own colour, on every screen. */
.q-mark{ display:inline-flex; align-items:center; gap:9px; margin-bottom:16px;
  padding:9px 17px; border-radius:999px; border:0;
  background:linear-gradient(90deg,var(--a1),var(--a2)); color:#03130d;
  font-family:var(--sffont); font-size:13.5px; font-weight:700; letter-spacing:.02em;
  box-shadow:0 8px 22px -12px var(--glow, rgba(25,197,143,.7)); }
.q-mark-live{ margin-bottom:0; }
.q-mark-live .sf-live-dot{ background:#03130d; box-shadow:none; }
/* The timer rides the ring. No label on it: the line below already says whether the
   time is a wait or a customer, and saying it twice only makes both harder to read. */
.sf-ringwrap{ position:relative; display:grid; place-items:center; }
.sf-timer{ position:absolute; inset:-22px; z-index:3; pointer-events:none; }
.sf-timer svg{ width:100%; height:100%; transform:rotate(-90deg); display:block; }
.sf-timer-bg{ fill:none; stroke:rgba(255,255,255,.06); stroke-width:5; }
.sf-timer-fg{ fill:none; stroke:#fff; stroke-width:5; stroke-linecap:round;
  filter:drop-shadow(0 0 8px rgba(255,255,255,.75))
         drop-shadow(0 0 18px color-mix(in srgb, var(--sfled,#19c58f) 70%, transparent));
  transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1); }
.sf-timer b{ position:absolute; left:50%; bottom:-13px; transform:translateX(-50%);
  background:#070b12; padding:4px 15px; border-radius:999px;
  border:1px solid rgba(255,255,255,.1);
  font-family:var(--sfmono); font-size:13px; font-weight:600; letter-spacing:.04em;
  color:#fff; white-space:nowrap; }
.sf-off .sf-timer-fg{ stroke:var(--sfink3); filter:none; }
.sf-actions{ display:flex; flex-direction:column; gap:2px; }
/* ---- My Corner ------------------------------------------------------------
   The salesperson home. Same ink and glow as the floor screens around it;
   sand for effort, garden green for made-it, red only where a point costs.
   Every animation is transform or opacity so the compositor carries it. */
/* The top clears the camera: the notch, the island, whatever the phone puts
   there, by the phone's own measure, with a floor for phones that report none. */
.mc{ width:min(430px, 100%); margin:0 auto; padding:max(28px, calc(14px + var(--sat))) 16px 84px; text-align:left; font-family:var(--font-ui);
  display:flex; flex-direction:column; gap:11px; }
.mc-head{ display:flex; gap:16px; align-items:flex-start; margin-top:4px; }
.mc-calhead{ display:flex; align-items:center; gap:6px; font-family:var(--sfmono);
  font-size:9.5px; font-weight:700; letter-spacing:.16em; color:#e8eef2; }
.mc-cal{ display:grid; grid-template-columns:repeat(7, 9px); gap:5px 6px; margin-top:7px; }
.mc-cal s{ width:9px; height:9px; border-radius:50%; background:rgba(232,238,242,.12); }
.mc-cal s.h1{ background:rgba(169,196,172,.38); }
.mc-cal s.h2{ background:rgba(169,196,172,.62); }
.mc-cal s.h3{ background:#a9c4ac; }
.mc-cal s.best{ background:#e4c98d; box-shadow:0 0 5px rgba(228,201,141,.55); }
.mc-cal s.today{ outline:1.5px solid rgba(242,246,242,.85); outline-offset:1.5px; }
.mc-cal s.off{ background:rgba(232,238,242,.05); }
.mc-cal s.hol{ background:transparent; box-shadow:inset 0 0 0 1.5px rgba(232,238,242,.3); }
.mc-calw{ border:0; background:none; padding:0; text-align:left; cursor:pointer; }
.mc-pacew{ position:relative; flex:1; display:flex; }
.mc-pace .tr{ position:relative; }
.mc-pace .tr i{ position:absolute; top:0; bottom:0; left:0; }
.mc-pace .tr i.nw{ background:#e4c98d; border-radius:999px 0 0 999px; }
.mc-pace .tr i.us{ background:#a9c4ac; border-radius:0 999px 999px 0; }
.mc-pacew .pm{ position:absolute; top:-3px; height:18px; width:3px; border-radius:2px; margin-left:-1px;
  background:#b8d2bb; box-shadow:0 0 6px rgba(169,196,172,.9); }
.mc-legend{ display:flex; gap:12px; margin-top:6px; position:relative; z-index:1;
  font-family:var(--sfmono); font-size:7.5px; font-weight:700; letter-spacing:.1em; color:rgba(237,242,234,.55); }
.mc-legend s{ display:inline-block; width:7px; height:7px; border-radius:2px; vertical-align:-1px; margin-right:4px; }
.mc-legend s.nw{ background:#e4c98d; }
.mc-legend s.us{ background:#a9c4ac; }
.mc-legend s.best{ background:#e4c98d; border-radius:50%; }
.mc-legend s.big{ background:#a9c4ac; border-radius:50%; }
.mc-legend s.hol{ background:transparent; box-shadow:inset 0 0 0 1.5px rgba(232,238,242,.35); border-radius:50%; }
.mc-legend-sc{ margin-top:12px; font-size:10px; }
.mc-list{ margin-top:8px; }
.mc-lifoot{ display:block; margin-top:9px; font-family:var(--sfmono); font-size:11px; letter-spacing:.09em;
  text-transform:uppercase; color:rgba(232,238,242,.34); }
.mc-li{ display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px dashed rgba(255,255,255,.1); font-size:12.5px; }
.mc-li:last-child{ border-bottom:0; }
/* These four are a scorecard, not a checklist. Calls and videos come off the
   day's report, RockEd off the manager's mark, tasks off what was posted; none
   of them is the salesperson's to tick, and the same rule holds in My day. But
   they were drawn as empty rounded boxes, which is a checkbox in every app
   anybody owns, so they invited a tap and did nothing back. A ring, filling to
   a disc when the mark is made, says the same thing without offering. */
.mc-li .ck{ width:19px; height:19px; border-radius:50%; border:1.5px solid rgba(255,255,255,.22); flex:0 0 auto;
  display:flex; align-items:center; justify-content:center; }
.mc-li.done .ck{ background:#3d8a62; border-color:#3d8a62; color:#eaf6ee; box-shadow:0 0 10px rgba(61,138,98,.5); }
.mc-li.done span:last-child{ opacity:.55; text-decoration:line-through; }
.mc-sc{ display:grid; grid-template-columns:repeat(7,1fr); gap:8px 0; justify-items:center; margin-top:8px; }
.mc-sc b{ font-family:var(--sfmono); font-size:8.5px; font-weight:700; color:rgba(237,242,234,.45); }
.mc-sc s{ display:block; width:15px; height:15px; border-radius:50%; background:rgba(237,242,234,.13); cursor:pointer;
  transition:transform .12s ease; }
.mc-sc s:active{ transform:scale(.8); }
.mc-sc s.h1{ background:rgba(169,196,172,.38); }
.mc-sc s.h2{ background:rgba(169,196,172,.62); }
.mc-sc s.h3{ background:#a9c4ac; }
.mc-sc s.best{ background:#e4c98d; box-shadow:0 0 6px rgba(228,201,141,.55); }
.mc-sc s.today{ outline:1.5px solid rgba(242,246,242,.85); outline-offset:1.5px; }
.mc-sc s.off{ background:rgba(237,242,234,.05); }
.mc-sc s.hol{ background:transparent; box-shadow:inset 0 0 0 1.5px rgba(232,238,242,.3); }
.mc-sc s.sel{ outline:2px solid #8fd8af; outline-offset:1.5px; }
.mc-scd{ margin-top:12px; border-top:1px solid rgba(255,255,255,.08); padding-top:10px; }
.mc-scr{ display:flex; align-items:baseline; gap:7px; font-family:var(--sfmono); font-size:11.5px; font-weight:600; padding:4.5px 0; }
.mc-scr i{ flex:1; border-bottom:2px dotted rgba(237,242,234,.2); }
.mc-scd-hint{ display:block; font-size:11px; color:rgba(237,242,234,.55); margin-top:6px; }
.mc-side{ flex:1; min-width:0; display:flex; flex-direction:column; gap:7px; }
.mc-date{ font-family:var(--sfmono); font-size:11px; font-weight:700; letter-spacing:.16em; color:#e8eef2; }
.mc-qmini{ display:flex; align-items:center; gap:6px; border:0; background:none; padding:0; cursor:pointer; }
.mc-qmini s{ width:11px; height:11px; border-radius:50%; background:rgba(232,238,242,.2); flex:0 0 auto; }
.mc-qmini s.hd{ width:17px; height:17px; border-radius:5px; background:rgba(232,238,242,.28);
  display:flex; align-items:center; justify-content:center; font-family:var(--sfmono);
  font-size:6.5px; font-weight:700; color:#e8eef2; }
.mc-qmini b{ font-family:var(--sfmono); font-size:8px; font-weight:700; letter-spacing:.12em;
  color:rgba(232,238,242,.55); margin-left:3px; }
.mc-asof{ display:inline-flex; align-items:center; gap:6px; font-family:var(--sfmono);
  font-size:9px; font-weight:700; letter-spacing:.13em; color:rgba(232,238,242,.5); }
.mc-asof s{ width:6px; height:6px; border-radius:50%; background:#e4c98d;
  box-shadow:0 0 7px rgba(228,201,141,.9); animation:mcRec 2.4s ease-in-out infinite; }
@keyframes mcRec{ 0%,100%{ opacity:.25; } 50%{ opacity:1; } }
.mc-hero{ position:sticky; top:6px; z-index:6; border-radius:15px; padding:13px 13px 11px;
  overflow:hidden; border:1px solid rgba(169,196,172,.28);
  background:linear-gradient(150deg, rgba(127,169,138,.3), rgba(46,74,56,.28) 60%), #203127;
  box-shadow:0 8px 20px -8px rgba(0,0,0,.55); }
.mc-hero::after{ content:""; position:absolute; inset:0; pointer-events:none; opacity:.05;
  background:repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px); }
.mc-hero-top{ display:flex; align-items:center; gap:12px; position:relative; z-index:1; }
.mc-units-lbl{ font-size:11px; font-weight:600; color:rgba(237,242,234,.65); line-height:1.25; }
.mc-units-none{ font-size:12px; color:rgba(237,242,234,.55); }
.mc-icobtn{ margin-left:auto; width:28px; height:28px; border-radius:50%;
  border:1px solid rgba(228,201,141,.5); background:rgba(228,201,141,.12); cursor:pointer;
  display:flex; align-items:center; justify-content:center; flex:0 0 auto;
  transition:transform .12s ease; }
.mc-cbars{ display:flex; align-items:flex-end; gap:2.5px; height:12px; }
.mc-cbars i{ display:block; width:3.5px; border-radius:2px; }
.mc-pace{ display:flex; align-items:center; gap:9px; margin-top:11px; position:relative; z-index:1; }
.mc-pace .nm{ font-size:10.5px; font-weight:600; color:rgba(237,242,234,.68); width:32px; }
.mc-pace .tr{ flex:1; height:12px; border-radius:999px; background:rgba(255,255,255,.1); overflow:hidden; }
.mc-pace .tr i{ display:block; height:100%; border-radius:999px; background:#e4c98d; }
.mc-pace .num{ font-family:var(--sfmono); font-size:11px; font-weight:700; color:#e4c98d; }
.mc-cap{ font-family:var(--sfmono); font-size:9px; font-weight:700; letter-spacing:.15em;
  color:rgba(237,242,234,.45); margin-top:3px; }
.mc-card{ background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.09);
  border-radius:15px; padding:12px 13px; color:#e8eef2; }
.mc-row{ display:flex; align-items:center; gap:12px; padding:8px 0; }
.mc-row + .mc-row{ border-top:1px solid rgba(255,255,255,.07); }
.mc-num{ min-width:44px; display:flex; justify-content:center; flex:0 0 auto; }
.mc-tx{ flex:1; min-width:0; }
.mc-tx b{ display:block; font-size:14px; font-family:var(--font-display); }
.mc-tx .st{ display:block; font-family:var(--sfmono); font-size:9px; font-weight:700;
  letter-spacing:.13em; color:rgba(232,238,242,.5); margin-top:2px; }
.mc-tx .bar{ display:block; height:4px; border-radius:999px; background:rgba(255,255,255,.1);
  margin-top:6px; overflow:hidden; }
.mc-tx .bar i{ display:block; height:100%; border-radius:999px;
  background:linear-gradient(90deg, #567d61, #a9c4ac); }
.mc-made{ position:relative; display:flex; align-items:center; gap:7px; margin-top:5px; height:19px;
  border-radius:7px; overflow:hidden; padding:0 9px; color:#bff0d6;
  font-family:var(--sfmono); font-size:9px; font-weight:700; letter-spacing:.17em;
  background:linear-gradient(90deg, rgba(61,195,131,.2), rgba(143,216,175,.4)); }
.mc-made::after{ content:""; position:absolute; top:0; bottom:0; width:46px; left:-60px;
  background:linear-gradient(100deg, transparent, rgba(255,255,255,.4), transparent);
  animation:mcShine 2.8s ease-in-out infinite; }
@keyframes mcShine{ 0%{ transform:translateX(0); } 60%,100%{ transform:translateX(330px); } }
.mc-ptshead{ display:flex; align-items:center; gap:12px; }
.mc-ptslbl b{ display:block; font-size:13.5px; font-family:var(--font-display); }
.mc-streak{ display:block; font-family:var(--sfmono); font-size:9px; font-weight:700;
  letter-spacing:.11em; color:#e4c98d; margin-top:2px; }
.mc-week{ display:flex; gap:4px; margin-top:9px; }
.mc-week i{ width:20px; text-align:center; font-style:normal; }
.mc-week .c{ display:flex; align-items:center; justify-content:center; width:18px; height:18px;
  margin:0 auto; border-radius:50%; font-family:var(--sfmono); font-size:9px; font-weight:700;
  overflow:hidden; }
.mc-week .c.ok{ background:rgba(94,200,140,.18); color:#8fd8af; }
.mc-week .c.bad{ background:rgba(216,72,60,.18); color:#f08a80; }
.mc-week .c.now{ border:1.5px dashed rgba(237,242,234,.4); color:rgba(237,242,234,.5); }
.mc-week .c.off{ color:rgba(237,242,234,.3); }
.mc-week .wd{ display:block; font-family:var(--sfmono); font-size:7px; font-weight:700;
  color:rgba(237,242,234,.4); margin-top:3px; }
.mc-boardbtn{ display:block; width:100%; text-align:left; cursor:pointer;
  transition:transform .12s ease; }
.mc-boardbtn:active{ transform:scale(.985); }
.mc-hb{ display:flex; flex-direction:column; gap:6px; }
.mc-hb .r{ display:flex; align-items:center; gap:8px; }
.mc-hb .rk{ width:16px; font-family:var(--sfmono); font-size:9px; font-weight:700;
  color:rgba(232,238,242,.45); }
.mc-hb .nm2{ width:96px; font-size:12px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.mc-hb .tk{ flex:1; height:11px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
.mc-hb .tk i{ display:block; height:100%; border-radius:999px; background:rgba(169,196,172,.55); }
.mc-hb .r.me .tk i{ background:#e4c98d; }
.mc-hb .un{ width:30px; text-align:right; font-family:var(--sfmono); font-size:10.5px; font-weight:700; }
.mc-boardsub{ display:block; margin-top:8px; font-family:var(--sfmono); font-size:9px;
  font-weight:700; letter-spacing:.12em; color:rgba(232,238,242,.55); }
/* These used to slide up from the bottom edge and sit against it, which is how
   a web page does a sheet and is exactly what this is not meant to feel like.
   They are cards now: they land in the middle of the screen, over a ground
   that is dimmed enough to disappear, with a shadow deep enough to say the
   card is above the page rather than part of it. */
.mc-ov{ position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center;
  padding:calc(var(--sat, env(safe-area-inset-top, 0px)) + 16px) 14px calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 16px);
  background:rgba(3,6,5,.88); animation:mcOvIn .2s ease-out both; }
@keyframes mcOvIn{ from{ opacity:0; } to{ opacity:1; } }
.mc-sheet{ width:min(430px,100%); background:#1a2820; border:1px solid rgba(228,201,141,.28);
  border-radius:24px; padding:18px 17px 20px; max-height:100%; overflow-y:auto;
  color:#e8eef2; box-shadow:0 32px 70px -20px rgba(0,0,0,.92), 0 0 0 1px rgba(0,0,0,.4);
  animation:mcSheet .3s cubic-bezier(.2,1.15,.35,1) both; will-change:transform,opacity; }
/* The pop: up from slightly small, with just enough overshoot to feel physical
   and not so much that it wobbles. No blur behind it; a blurred backdrop on a
   phone costs more than it is worth and this is dark enough without one. */
@keyframes mcSheet{ from{ opacity:0; transform:scale(.93); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce){
  .mc-ov, .mc-sheet{ animation-duration:.01ms; }
}
.mc-sheet-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.mc-sheet-head b{ font-size:16px; font-family:var(--font-display); }
.mc-x{ border:0; background:rgba(255,255,255,.1); color:#e8eef2; width:26px; height:26px;
  border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.mc-clrow{ display:flex; justify-content:space-around; align-items:flex-end; padding:6px 0 2px; }
.mc-cl{ text-align:center; width:72px; }
.mc-cl b{ display:block; font-family:var(--sfmono); font-size:14px; font-weight:700; }
.mc-cl .vb{ display:block; position:relative; height:110px; margin:6px auto; width:26px;
  border-radius:8px; background:rgba(255,255,255,.08); }
.mc-cl .vb i{ position:absolute; left:0; right:0; bottom:0; border-radius:8px; }
.mc-cl .lb{ display:block; font-size:10.5px; font-weight:600; }
.mc-cl .dl{ display:inline-flex; align-items:center; gap:4px; margin-top:4px;
  font-family:var(--sfmono); font-size:9px; font-weight:700; }
.mc-cl .dl.up{ color:#8fd8af; }
.mc-cl .dl.dn{ color:#f08a80; }
.mc-clfoot{ margin-top:10px; font-size:11px; color:rgba(237,242,234,.5); }
/* ---- the thirty-day channel line ----
   Lives inside the closing sheet, under whichever bar was pressed. The bar is
   a button now, so it needs the button reset the rest of this sheet's controls
   get, and a pressed state that reads as "this one is open" rather than as a
   tap that has already finished. */
.mc-cl{ appearance:none; background:transparent; border:0; padding:0; cursor:pointer;
  border-radius:12px; transition:background .18s ease, transform .18s var(--spring); }
.mc-cl:active{ transform:scale(.97); }
.mc-cl.on{ background:rgba(255,255,255,.06); }
.mc-clopen{ margin-top:12px; padding:12px; border-radius:14px;
  background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); }
.mc-clopen-head{ display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.mc-clopen-head b{ font-size:12.5px; font-weight:700; letter-spacing:.01em; }
.mc-clopen-x{ appearance:none; background:transparent; border:0; cursor:pointer;
  font-family:var(--sfmono); font-size:10.5px; color:rgba(237,242,234,.5); padding:2px 4px; }
.mc-cline{ margin-top:8px; }
.mc-cline-svg{ display:block; width:100%; height:96px; overflow:visible; }
.mc-cline-p{ fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
/* The single days, under the running line. Faint on purpose: they are the
   evidence, not the answer. */
.mc-cline-d{ opacity:.42; }
.mc-cline-now{ opacity:1; }
.mc-cline-thr{ stroke:rgba(237,242,234,.22); stroke-width:1; stroke-dasharray:3 4; }
.mc-cline-foot{ display:flex; align-items:baseline; gap:7px; margin-top:6px; }
.mc-cline-foot b{ font-family:var(--sfmono); font-size:17px; font-weight:700; }
.mc-cline-foot span{ font-size:11px; color:rgba(237,242,234,.6); }
.mc-cline-note{ margin-top:7px; font-size:12px; line-height:1.45; color:rgba(237,242,234,.42); }
.mc-cline-none{ font-size:11.5px; line-height:1.5; color:rgba(237,242,234,.5); padding:10px 0 2px; }
.mc-hb-full .r{ padding:3px 0; }
.mc-pill{ position:fixed; left:50%; transform:translateX(-50%); bottom:14px; z-index:50;
  display:flex; background:rgba(6,10,8,.85); border:1px solid rgba(255,255,255,.13);
  border-radius:999px; padding:4px; backdrop-filter:blur(6px);
  box-shadow:0 10px 24px -10px rgba(0,0,0,.7); }
.mc-ind{ position:absolute; left:4px; top:4px; bottom:4px; width:46px; border-radius:999px;
  background:rgba(228,201,141,.16);
  transition:transform .38s cubic-bezier(.3,1.6,.4,1); will-change:transform; }
.mc-tab{ position:relative; z-index:1; width:46px; border:0; background:none; border-radius:999px;
  padding:9px 0; cursor:pointer; color:rgba(237,242,234,.55); display:flex; align-items:center;
  justify-content:center; transition:transform .12s ease; }
.mc-tab.on{ color:#e4c98d; }
/* ---- the corner, round three ------------------------------------------------
   A's tones, the hero coloured by pace, the podium, the trail, and the ground
   breathing behind it all. Motion budget: the ground and the pace glow run
   always; everything else plays once on load or once when something changes. */
.q-page.sf.mc-shell{ --mc-geist:'Geist','Sora',system-ui,-apple-system,'Segoe UI',sans-serif; }
.mc{ position:relative; }
.mc > *:not(.mc-aurora):not(.mc-spine){ position:relative; z-index:1; }
.mc-aurora{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
.mc-aurora i{ position:absolute; width:520px; height:520px; border-radius:50%; opacity:.7; display:block; will-change:transform; }
.mc-aurora i:nth-child(1){ left:-140px; bottom:-120px; background:radial-gradient(closest-side,rgba(86,125,97,.9),rgba(86,125,97,.35) 40%,transparent 72%); animation:mcDrift1 18s ease-in-out infinite; }
.mc-aurora i:nth-child(2){ right:-180px; bottom:40px; background:radial-gradient(closest-side,rgba(46,74,56,.95),rgba(46,74,56,.4) 40%,transparent 72%); animation:mcDrift2 24s ease-in-out infinite; }
.mc-aurora i:nth-child(3){ left:60px; top:120px; width:340px; height:340px; background:radial-gradient(closest-side,rgba(228,201,141,.35),rgba(228,201,141,.12) 45%,transparent 72%); animation:mcDrift3 28s ease-in-out infinite; opacity:.35; }
.mc-aurora i:nth-child(4){ right:-120px; top:-140px; width:420px; height:420px; background:radial-gradient(closest-side,rgba(143,216,175,.45),rgba(143,216,175,.15) 45%,transparent 72%); animation:mcDrift4 26s ease-in-out infinite; opacity:.45; }
.mc-aurora u{ position:absolute; inset:-60px; display:block; will-change:transform,opacity; background:radial-gradient(circle,rgba(255,255,255,.16) 1px,transparent 1.6px) 0 0/22px 22px; opacity:.5; animation:mcGrid 30s linear infinite, mcBreathe 7s ease-in-out infinite; -webkit-mask:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent); mask:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent); }
.mc-aurora u:nth-child(6){ background-position:11px 11px; animation-delay:0s,-3.5s; -webkit-mask:radial-gradient(60% 40% at 30% 30%,#000,transparent 70%); mask:radial-gradient(60% 40% at 30% 30%,#000,transparent 70%); }
@keyframes mcDrift1{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(130px,-220px) scale(1.2); } }
@keyframes mcDrift2{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-170px,-140px) scale(.85); } }
@keyframes mcDrift3{ 0%,100%{ transform:translate(0,0); } 33%{ transform:translate(-60px,80px); } 66%{ transform:translate(70px,40px); } }
@keyframes mcDrift4{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-110px,160px) scale(1.2); } }
@keyframes mcGrid{ from{ transform:translate(0,0); } to{ transform:translate(22px,44px); } }
@keyframes mcBreathe{ 0%,100%{ opacity:.18; } 50%{ opacity:.6; } }
.mc > *:not(.mc-aurora):not(.mc-spine){ animation:mcRise .6s cubic-bezier(.2,.8,.3,1) both; }
.mc > *:nth-child(4){ animation-delay:.05s; }
.mc > *:nth-child(5),.mc > *:nth-child(6){ animation-delay:.12s; }
.mc > *:nth-child(7),.mc > *:nth-child(8){ animation-delay:.2s; }
.mc > *:nth-child(9),.mc > *:nth-child(10){ animation-delay:.28s; }
@keyframes mcRise{ from{ opacity:0; transform:translateY(14px); } }
/* head */
.mc-head{ align-items:flex-start; }
.mc-side{ gap:8px; }
.mc-corner{ display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex:0 0 auto; }
.mc-corner .mc-help{ position:static; }
.mc-corner .mc-asof{ white-space:nowrap; }
.mc-aheadlbl{ border:0; background:none; padding:0; text-align:left; cursor:pointer; font-family:var(--sfmono); font-size:11.5px; font-weight:700; letter-spacing:.14em; color:rgba(232,238,242,.6); }
.mc-chip2{ display:inline-flex; align-items:center; gap:6px; align-self:flex-start; padding:5px 9px; border-radius:9px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.06); font-family:var(--sfmono); font-size:10.5px; font-weight:700; letter-spacing:.12em; color:rgba(232,238,242,.75); }
.mc-chip2 .pix{ color:#E4C98D; }
/* the rail */
.mc-railw{ position:relative; display:block; width:auto; margin:-2px 30px 0 -18px; border:0; background:none; padding:0; text-align:left; cursor:pointer; }
.mc-rail{ position:relative; display:block; height:34px; border-radius:0 999px 999px 0; background:rgba(255,255,255,.07); overflow:hidden; }
/* the light along the line: dots in from the left edge, a stop at every
   person, as far as the head, then again; the phone room's cord's logic */
.mc-rail > s.lt, .mcf-track > s.lt, .fr-rail > s.lt{ position:absolute; left:-3px; top:50%; width:6px; height:6px; margin-top:-3px; border-radius:50%;
  background:rgba(143,216,175,.7); box-shadow:0 0 6px rgba(143,216,175,.7); opacity:0; pointer-events:none; }
.mc-rail.up{ background:rgba(143,216,175,.1); }
.mc-rail.up .lt{ background:#8FD8AF; box-shadow:0 0 10px rgba(143,216,175,1); }
.mc-pip{ position:absolute; top:50%; transform:translate(-50%,-50%); width:22px; height:22px; border-radius:50%; color:#fff; text-shadow:0 1px 1px rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; font-family:var(--sfmono); font-size:7px; font-weight:700; font-style:normal; left:calc(100% - var(--edge,19px) - var(--p,0) * 1%); transition:left .65s cubic-bezier(.3,1.3,.4,1); }
.mc-pip.hd{ width:30px; height:30px; font-size:9.5px; box-shadow:0 0 0 2px rgba(255,255,255,.35); }
/* Somebody off the line used to be drawn at 45% opacity, which on a dark
   ground reads as a smudge rather than a person and was never in the draft.
   They are drawn solid now, in a muted version of their own colour, so the
   rail is a row of people throughout and the ones not in the running are
   simply quieter. The colour is worked out where the pip is written, because
   the hue is. */
.mc-pip.you{ background:#E4C98D; color:#12251b; text-shadow:none; box-shadow:0 0 12px rgba(228,201,141,.95); }
.mc-pip.you::after{ content:""; position:absolute; inset:-2px; border-radius:50%; box-shadow:0 0 18px 4px rgba(228,201,141,.9); animation:mcGlowOp 2.4s ease-in-out infinite; will-change:opacity; pointer-events:none; }
.mc-pip.you.g{ background:#8FD8AF; box-shadow:0 0 12px rgba(143,216,175,.95); }
.mc-pip.you.g::after{ box-shadow:0 0 20px 4px rgba(143,216,175,.9); animation-duration:1.6s; }
.mc-railw > em{ position:absolute; right:-24px; top:50%; transform:translateY(-50%); font-family:var(--sfmono); font-size:9.5px; font-weight:700; letter-spacing:.16em; color:rgba(255,255,255,.55); writing-mode:vertical-rl; font-style:normal; }
/* hero: pace glow, CRT roll, the trail */
.mc-hero{ transition:box-shadow .6s, border-color .6s; }
.mc-hero::before{ content:""; position:absolute; left:0; right:0; top:-30%; height:26%; background:linear-gradient(180deg,transparent,rgba(255,255,255,.035) 35%,rgba(255,255,255,.11) 50%,rgba(0,0,0,.10) 62%,transparent); animation:mcCrt 7s linear infinite; z-index:1; pointer-events:none; will-change:transform; }
.mc-hero::after{ top:-3px; animation:mcScan .8s steps(3) infinite; will-change:transform; }
@keyframes mcCrt{ 0%{ transform:translateY(0); } 70%,100%{ transform:translateY(500%); } }
@keyframes mcScan{ from{ transform:translateY(0); } to{ transform:translateY(3px); } }
/* The glow is its own layer whose opacity breathes. Animating a box-shadow
   repaints the card every frame; fading a layer costs the compositor a blend. */
.mc-hero.mc-behind{ border-color:rgba(240,138,128,.6); }
.mc-hero.mc-on{ border-color:rgba(228,201,141,.65); }
.mc-hero.mc-ahead{ border-color:rgba(143,216,175,.65); }
.mc-glow{ position:absolute; inset:-1px; border-radius:inherit; pointer-events:none; z-index:0; will-change:opacity; animation:mcGlowOp 4s ease-in-out infinite; }
.mc-behind .mc-glow{ box-shadow:0 0 0 5px rgba(216,72,60,.11),0 17px 44px -13px rgba(216,72,60,.65); }
.mc-on .mc-glow{ box-shadow:0 0 0 5px rgba(228,201,141,.11),0 17px 44px -13px rgba(228,201,141,.6); }
.mc-ahead .mc-glow{ box-shadow:0 0 0 5px rgba(143,216,175,.11),0 17px 44px -13px rgba(143,216,175,.7); }
@keyframes mcGlowOp{ 0%,100%{ opacity:.75; } 50%{ opacity:1; } }
.mc-statecol{ position:absolute; right:12px; top:12px; z-index:2; display:flex; flex-direction:column; align-items:center; gap:12px; }
.mc-statecol .mc-icobtn{ margin:0; }
.mc-state{ font-family:var(--sfmono); font-size:10.5px; font-weight:700; letter-spacing:.14em; padding:4px 9px; border-radius:7px; white-space:nowrap; }
.mc-behind .mc-state{ background:rgba(216,72,60,.35); color:#FFD7D3; }
.mc-on .mc-state{ background:rgba(228,201,141,.25); color:#E4C98D; }
.mc-ahead .mc-state{ background:rgba(30,138,76,.4); color:#8FD8AF; }
.mc-trail{ position:relative; z-index:1; margin-top:10px; height:92px; }
.mc-trail svg{ width:100%; height:92px; overflow:visible; display:block; }
.mc-trail .grid line{ stroke:rgba(255,255,255,.07); stroke-width:1; }
.mc-trail .pace{ fill:none; stroke:rgba(255,255,255,.28); stroke-width:1.5; stroke-dasharray:3 5; }
.mc-trail .area{ transform-origin:left; animation:mcGrow 1.2s cubic-bezier(.2,.8,.3,1) both .3s; }
.mc-trail .edge{ fill:none; stroke:#fff; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.mc-trail .todayline{ stroke:rgba(228,201,141,.7); stroke-width:1.5; }
.mc-behind .mc-trail .todayline{ stroke:rgba(240,138,128,.7); }
.mc-ahead .mc-trail .todayline{ stroke:rgba(143,216,175,.7); }
.mc-trail .todaydot{ fill:#fff; transform-box:fill-box; transform-origin:center; animation:mcDot 2.4s ease-in-out infinite; }
@keyframes mcDot{ 50%{ transform:scale(1.33); } }
.mc-trail .goalring{ fill:none; stroke:#E4C98D; stroke-width:2; }
@keyframes mcGrow{ from{ transform:scaleX(0); } }
.mc-tl{ position:absolute; left:0; right:0; bottom:-14px; display:flex; justify-content:space-between; font-family:var(--sfmono); font-size:9.5px; font-weight:700; letter-spacing:.1em; color:rgba(237,242,234,.5); }
.mc-tl .mid{ color:#E4C98D; }
.mc-behind .mc-tl .mid{ color:#F08A80; }
.mc-ahead .mc-tl .mid{ color:#8FD8AF; }
.mc-hero .mc-legend{ margin-top:20px; }
.mc-legend s.pc{ background:transparent; border-top:1.5px dashed rgba(255,255,255,.6); height:0; border-radius:0; vertical-align:2px; }
.mc-tx .bar i{ transform-origin:left; animation:mcGrow 1.1s cubic-bezier(.2,.8,.3,1) both .3s; }
/* type: the card titles in Geist, one voice for the cards */
.mc-shell .mc-tx b, .mc-shell .mc-ptslbl b, .mc-shell .mc-pd b{ font-family:var(--mc-geist); font-weight:600; letter-spacing:-.005em; }
/* tones: today on sand paper */
.mc-cap-t{ color:#E4C98D; }
.mc-cap-p{ color:#F08A80; }
.mc-cap-b{ color:#A9C4AC; }
.mc-shell .mc-card.mc-today{ background:linear-gradient(160deg,#F6E3C3,#EDD6AC); border-color:#F6E3C3; color:#2A2418; }
.mc-today .mc-tx .st{ color:rgba(42,36,24,.55); }
.mc-today .mc-row + .mc-row{ border-top-color:rgba(42,36,24,.12); }
.mc-today .mc-tx .bar{ background:rgba(42,36,24,.12); }
.mc-today .mc-tx .bar i{ background:linear-gradient(90deg,#D0821E,#E8A93C); }
.mc-today .mc-made{ background:#1E8A4C; color:#fff; }
.mc-made::before{ content:""; position:absolute; inset:-3px 0 0 0; background:repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 3px); pointer-events:none; animation:mcScan .8s steps(3) infinite; will-change:transform; }
.mc-made::after{ width:auto; left:0; right:0; top:-120%; bottom:auto; height:120%; background:linear-gradient(180deg,transparent,rgba(255,255,255,.05) 35%,rgba(255,255,255,.22) 50%,rgba(0,0,0,.12) 62%,transparent); animation:mcCrt 5.5s linear infinite; will-change:transform; }
.mc-row:nth-child(2) .mc-made::after{ animation-delay:-2s; }
/* points, near black */
.mc-shell .mc-card.mc-pts{ background:#0B100D; border-color:rgba(240,138,128,.28); box-shadow:inset 0 0 0 1px rgba(240,138,128,.08); }
.mc-pts .mc-week .c.ok{ background:rgba(94,200,140,.28); }
.mc-pts .mc-week .c.bad{ background:#D8483C; color:#fff; }
.mc-pts .mc-li.done .ck{ background:#1E8A4C; border-color:#1E8A4C; }
.mc-week .c.now{ animation:mcBlink 3.2s ease-in-out infinite; }
@keyframes mcBlink{ 50%{ border-color:#E4C98D; color:#E4C98D; } }
.mc-spine .sp b::after{ content:""; position:absolute; inset:-2px; border-radius:50%; box-shadow:0 0 16px 3px rgba(143,216,175,.95); animation:mcGlowOp 2.4s ease-in-out infinite; will-change:opacity; }
/* the board, a podium */
.mc-shell .mc-card.mc-board{ background:rgba(169,196,172,.12); border-color:rgba(169,196,172,.35); }
.mc-pod{ display:flex; gap:7px; }
.mc-pd{ flex:1; min-width:0; text-align:center; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:8px 4px; background:rgba(0,0,0,.18); }
.mc-pd.me{ border-color:#E4C98D; background:rgba(228,201,141,.16); animation:mcLift 4s ease-in-out infinite; }
@keyframes mcLift{ 50%{ transform:translateY(-2px); } }
.mc-pd .av{ margin:0 auto 4px; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--sfmono); font-size:11px; font-weight:700; }
.mc-pd b{ display:block; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mc-pd .un{ display:block; font-family:var(--sfmono); font-size:13px; font-weight:700; }
.mc-pd .rk{ display:block; font-family:var(--sfmono); font-size:10px; font-weight:700; color:rgba(237,242,234,.45); }
@media (prefers-reduced-motion:reduce){ .mc *,.mc *::before,.mc *::after{ animation:none !important; } }
/* ---- light mode: the same page on paper ----
   The site's own ground rather than a map: soft sage and sand on paper. The
   hero takes the site's hero gradient, Today stays sand paper, Points goes ink
   so its chips still read, the board goes sage on white. */
.q-page.sf.mc-shell.mc-light{ background:#F1EEE4; --sfink:#1F2A22; --sfink2:#4A5A4E; --sfink3:#7E8A80; --sfcard:#FFFDF8; --sfstroke:rgba(31,42,34,.1); color:#1F2A22; }
.mc-light .mc-aurora i{ opacity:.45; }
.mc-light .mc-aurora i:nth-child(1){ background:radial-gradient(closest-side,#A9C4AC,transparent 70%); }
.mc-light .mc-aurora i:nth-child(2){ background:radial-gradient(closest-side,#CFDCCF,transparent 70%); }
.mc-light .mc-aurora i:nth-child(3){ background:radial-gradient(closest-side,rgba(228,201,141,.8),transparent 70%); opacity:.45; }
.mc-light .mc-aurora i:nth-child(4){ background:radial-gradient(closest-side,#B9D1BD,transparent 70%); opacity:.5; }
.mc-light .mc-aurora u{ background-image:radial-gradient(circle,rgba(31,42,34,.22) 1px,transparent 1.6px); }
.mc-light .mc-calhead,.mc-light .mc-date{ color:#1F2A22; }
.mc-light .mc-cal s{ background:rgba(31,42,34,.12); }
.mc-light .mc-cal s.h1{ background:rgba(86,125,97,.35); }
.mc-light .mc-cal s.h2{ background:rgba(86,125,97,.6); }
.mc-light .mc-cal s.h3{ background:#567D61; }
.mc-light .mc-cal s.best{ background:#D0821E; box-shadow:0 0 5px rgba(208,130,30,.5); }
.mc-light .mc-cal s.today{ outline-color:#1F2A22; }
.mc-light .mc-cal s.off{ background:rgba(31,42,34,.06); }
.mc-light .mc-cal s.hol{ box-shadow:inset 0 0 0 1.5px rgba(31,42,34,.3); }
.mc-light .mc-aheadlbl,.mc-light .mc-asof,.mc-light .mc-qmini b{ color:rgba(31,42,34,.6); }
.mc-light .mc-chip2{ border-color:rgba(31,42,34,.18); background:rgba(31,42,34,.05); color:rgba(31,42,34,.7); }
.mc-light .mc-chip2 .pix{ color:#D0821E; }
.mc-light .mc-help{ border-color:rgba(31,42,34,.25); color:rgba(31,42,34,.7); background:rgba(31,42,34,.04); }
.mc-light .mc-rail{ background:rgba(31,42,34,.1); }
.mc-light .mc-railw > em{ color:rgba(31,42,34,.5); }
.mc-light .mc-pip.you{ background:#1E8A4C; color:#fff; box-shadow:0 0 10px rgba(30,138,76,.6); }
.mc-light .mc-spine .rt{ color:#1E8A4C; }
.mc-light .mc-spine .sp{ background:rgba(31,42,34,.12); }
.mc-light .mc-spine .sp i{ background:linear-gradient(0deg,#567D61,#1E8A4C); }
.mc-light .mc-spine .sp b{ background:#1E8A4C; box-shadow:0 0 9px rgba(30,138,76,.7); }
.mc-light .mc-spine .sp u{ background:rgba(31,42,34,.25); }
.mc-light .mc-cap{ color:rgba(31,42,34,.5); }
.mc-light .mc-cap-t{ color:#D0821E; }
.mc-light .mc-cap-p{ color:#C2361F; }
.mc-light .mc-cap-b{ color:#567D61; }
.mc-shell.mc-light .mc-hero{ background:linear-gradient(150deg,#7FA98A,#55795F 55%,#26382C); border-color:transparent; color:#EDF2EA; box-shadow:0 18px 36px -18px rgba(38,56,44,.6); }
.mc-light .mc-hero.mc-behind{ box-shadow:0 0 0 4px rgba(194,54,31,.14),0 16px 40px -14px rgba(194,54,31,.55); }
.mc-light .mc-hero.mc-on{ box-shadow:0 0 0 4px rgba(208,130,30,.16),0 16px 40px -14px rgba(208,130,30,.5); }
.mc-light .mc-hero.mc-ahead{ box-shadow:0 0 0 4px rgba(30,138,76,.16),0 16px 40px -14px rgba(30,138,76,.55); }
.mc-shell.mc-light .mc-card{ background:#FFFDF8; border-color:rgba(31,42,34,.1); box-shadow:0 10px 24px -16px rgba(31,42,34,.35); color:#1F2A22; }
.mc-shell.mc-light .mc-card.mc-today{ background:linear-gradient(160deg,#F6E3C3,#EDD6AC); border-color:#EDD6AC; color:#2A2418; }
.mc-shell.mc-light .mc-card.mc-pts{ background:#15211B; color:#E8EEF2; border-color:#15211B; }
.mc-shell.mc-light .mc-card.mc-board{ background:rgba(169,196,172,.35); border-color:rgba(86,125,97,.3); }
.mc-light .mc-pd{ background:rgba(255,255,255,.55); border-color:rgba(31,42,34,.08); }
.mc-light .mc-pd.me{ background:#F6E3C3; border-color:#D0821E; }
.mc-light .mc-pd .rk,.mc-light .mc-boardsub{ color:rgba(31,42,34,.5); }
.mc-shell.mc-light .mc-offc{ background:#FFFDF8; color:#1F2A22; }
/* ---- My day, in the corner's clothes ----
   The same page, the same numbers, the same list. It just stopped being the
   only screen in the app still wearing the teal it was drafted in: the aurora
   ground, Geist on the titles, sand and mint for the accents, and the light
   look when the corner is in it. */
.sf-day-root.mc-day{ --a1:#56795F; --a2:#E4C98D; --led:#8FD8AF; --glow:rgba(143,216,175,.5); --ld-off:rgba(143,216,175,.14); background:#06090F; }
.sf-day-root.mc-day::before{ display:none; }
.mc-day .sf-view{ position:relative; z-index:1; }
.mc-day .sf-display, .mc-day .sf-one-v, .mc-day .sf-task-h, .mc-day .sf-band-txt b, .mc-day .sf-focus-n{ font-family:var(--mc-geist); letter-spacing:-.02em; }
.mc-day .sf-task, .mc-day .sf-rate, .mc-day .sf-jump, .mc-day .sf-owe-day{ background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.1); border-radius:18px; box-shadow:0 12px 28px -20px rgba(0,0,0,.8); }
.mc-day .sf-band{ border-bottom-color:rgba(255,255,255,.08); }
.mc-day .sf-one{ background:linear-gradient(160deg,#F6E3C3,#EDD6AC); color:#2A2418; }
.mc-day .sf-focus{ --tone:#8FD8AF; }
.mc-day .sf-meter i{ background:linear-gradient(90deg,#8FD8AF,#E4C98D); }
.mc-day .sf-stamp.none{ color:#E4C98D; }
.mc-day.mc-light{ background:#F1EEE4; --sfink:#1F2A22; --sfink2:#4A5A4E; --sfink3:#7E8A80; --sfcard:#FFFDF8; --sfstroke:rgba(31,42,34,.1); color:#1F2A22; }
.mc-day.mc-light .sf-task, .mc-day.mc-light .sf-rate, .mc-day.mc-light .sf-jump, .mc-day.mc-light .sf-owe-day{ background:#FFFDF8; border-color:rgba(31,42,34,.1); box-shadow:0 10px 24px -16px rgba(31,42,34,.35); }
.mc-day.mc-light .sf-band{ border-bottom-color:rgba(31,42,34,.08); }
.mc-day.mc-light .sf-meter{ background:rgba(31,42,34,.1); }
.mc-day.mc-light .sf-back, .mc-day.mc-light .sf-kicker{ color:var(--sfink2); }
.mc-day.mc-light .sf-focus{ background:rgba(143,216,175,.18); border-color:rgba(86,125,97,.3); }
.mc-day.mc-light .mc-aurora i{ opacity:.35; }
.mc-day.mc-light .mc-aurora u{ opacity:.25; background-image:radial-gradient(circle,rgba(31,42,34,.35) 1px,transparent 1.6px); }
.mc-light .mc-pill{ background:#15211B; border-color:#15211B; }
.mc-shell.mc-light .mc-sheet{ background:#FFFDF8; color:#1F2A22; border-top-color:#D0821E; }
.mc-light .mc-x{ background:rgba(31,42,34,.08); color:#1F2A22; }
.mc-light .mc-set-row{ border-bottom-color:rgba(31,42,34,.1); }
.mc-light .mc-set-row .hint{ color:rgba(31,42,34,.55); }
/* ---- Import on a phone: a light pass ---- */
.imp-ph .imp-row .when{ font-size:10px; }
.imp-ph > .explain, .imp-ph > details{ margin:12px; }
@media (max-width:700px){ .tab-page:has(> .imp-ph){ padding:10px 0 0; } }
/* ---- Targets on a phone: a light pass ---- */
.tg-ph .tg-tbl, .tg-ph .card{ margin:0 12px; border-radius:20px; }
@media (max-width:700px){ .tab-page:has(> .tg-ph){ padding:10px 0 0; } .tab-page:has(> .actstd-ph){ padding:10px 0 0; } }
/* ---- the floor, final ----------------------------------------------------- */
/* The approved layout breathes across the whole screen: the count, the line and
   the clocks center in the space above the actions, and the actions keep clear
   of the floating pill. */
.mcf .sf-actions{ width:min(430px,100%); margin:0 auto; }
.mcf, .mcf button{ font-family:var(--font-ui); }
.sf-live.mcf{ padding-top:max(clamp(52px,8vh,70px), calc(28px + var(--sat)));
  padding-bottom:calc(clamp(24px,5vh,34px) + 62px + var(--sab)); }
.mc-pill{ bottom:calc(14px + var(--sab)); }
.mc-tkov{ padding-top:var(--sat); }
.mc-offc{ margin-top:0; }
.mcf-top{ width:min(430px,100%); margin:0 auto; flex:1; display:flex; flex-direction:column;
  align-items:center; justify-content:center; padding:8px 0 18px; }
.mcf-cap{ font-family:var(--sfmono); font-size:11px; font-weight:700; letter-spacing:.22em;
  color:rgba(237,242,234,.55); margin-top:8px; }
.mcf-count{ display:flex; justify-content:center; }
.mcf-sticon{ margin-top:10px; opacity:.9; }
.mcf-track{ position:relative; align-self:stretch; height:34px; margin:12px 22px 0 calc(50% - 50vw);
  border-radius:0 999px 999px 0; background:rgba(255,255,255,.07); }
.mcf-pip{ position:absolute; top:50%; transform:translate(-50%,-50%); width:24px; height:24px;
  border-radius:50%; background:rgba(232,238,242,.24); color:#e8eef2; display:flex; align-items:center;
  justify-content:center; font-family:var(--sfmono); font-size:8px; font-weight:700;
  left:calc(100% - var(--edge,19px) - var(--p,0) * 1%);
  transition:left .65s cubic-bezier(.3,1.3,.4,1), width .5s ease, height .5s ease; }
.mcf-pip.hd{ width:30px; height:30px; font-size:9px; background:rgba(232,238,242,.34); }
.mcf-pip.bh{ width:20px; height:20px; font-size:7px; background:rgba(232,238,242,.16); }
.mcf-you{ position:absolute; top:50%; transform:translate(-50%,-50%); width:26px; height:26px;
  border-radius:50%; background:#8fd8af; color:#12251b; display:flex; align-items:center;
  justify-content:center; font-family:var(--sfmono); font-size:8.5px; font-weight:700;
  box-shadow:0 0 12px rgba(143,216,175,.95);
  left:calc(100% - var(--edge,19px) - var(--p,0) * 1%);
  transition:left .65s cubic-bezier(.3,1.3,.4,1); }
/* The pips ride on transform, not left: a change of place is then drawn by
   the compositor, in step with everything else on the screen, rather than laid
   out again on the main thread every frame of the spring, which is what made a
   line moving up stutter while the row behind it rendered. The rail is its own
   container so a place can still be said in the rail's width. --p is the step
   back from the head in percent; --edge is the head's radius plus its gap from
   the rounded end. Without container units the pips keep the left they had. */
@supports (width: 1cqw) {
  .mc-rail, .mcf-track { container-type:inline-size; }
  .mc-pip, .mcf-pip, .mcf-you { left:0; transform:translate(calc(100cqw - var(--edge,19px) - var(--p,0) * 1cqw - 50%), -50%); }
  .mc-pip, .mcf-you { transition:transform .65s cubic-bezier(.3,1.3,.4,1); }
  .mcf-pip { transition:transform .65s cubic-bezier(.3,1.3,.4,1), width .5s ease, height .5s ease; }
}
.mcf-tmr{ display:flex; gap:26px; margin-top:16px; }
.mcf-tmr > span{ display:flex; flex-direction:column; align-items:center; }
.mcf-tmr .v{ display:inline-flex; align-items:center; gap:6px; height:16px;
  font-family:var(--sfmono); font-size:13.5px; font-weight:700; color:rgba(237,242,234,.85); }
.mcf-tmr .l{ font-family:var(--sfmono); font-size:9px; font-weight:700; letter-spacing:.14em;
  color:rgba(237,242,234,.45); margin-top:4px; }
.mcf-title{ font-family:var(--font-display); font-size:26px; font-weight:700; margin-top:14px;
  color:#fff; text-align:center; letter-spacing:-.01em; }
.mcf-sub{ font-size:15px; color:rgba(237,242,234,.62); margin-top:5px; text-align:center; }
.mcf-home .mcf-top{ justify-content:center; }
.mcf-home .mcf-title{ margin-top:18px; }
.mcf-go{ margin-top:22px; width:min(320px, 100%); }
/* the line's own button wears the line's blue, as its join button always has */
.sf-line .mcf-go{ background:linear-gradient(135deg,var(--a1),var(--a2)); box-shadow:0 14px 30px -14px var(--glow); }
.mcf-home .sf-door{ margin-top:14px; }
.mc-qjoin s.hd{ background:#E9CE96; }
.mc-steps-p{ font-size:15px; line-height:1.5; color:rgba(237,242,234,.8); margin:6px 0 4px; }
.mc-qjoin b{ color:#E9CE96; }
/* ---- nothing paints that nobody sees --------------------------------------
   The phone pages sit fixed over the app's ground, so the ground's four
   drifting blobs, its dot field and its streaks were animating and
   compositing behind an opaque screen for nothing, so the phone routes mount
   no ground (see Shell). The pill's blur goes too: a backdrop blur is
   re-sampled every frame the content under it scrolls. */
.mc-pill{ backdrop-filter:none; background:rgba(6,10,8,.94); }
.mc-card{ contain:content; }
/* ---- the garden dark ------------------------------------------------------
   The shell wears the draft's palette end to end: the ink is the garden's,
   the glow at the foot of the screen is the garden's, the cards are the
   draft's card, and nothing on either tab is tinted by the old teal. */
.q-page.sf.mc-shell{
  /* One face for everything a salesperson reads: Space Grotesk carries the
     copy as well as the titles on the phone. The mono stays for caps, clocks
     and counts, which is its own job. */
  --font-ui: var(--font-display); --sffont: var(--font-display);
  --a1:#6E9678; --a2:#A9C4AC; --led:#8FD8AF; --glow:rgba(127,169,138,.38); --ld-off:rgba(143,216,175,.14);
  --sfink:#EDF2EA; --sfink2:#A7B3A9; --sfink3:#6E7A70; --sfcard:#1C2B23; --sfstroke:rgba(255,255,255,.09);
  background:radial-gradient(closest-side at 50% 112%, rgba(127,169,138,.42), rgba(127,169,138,.12) 55%, transparent 76%), #15211B; }
.mc-shell .mc-card, .mc-shell .fba-btn, .mc-shell .mc-offc{ background:#1C2B23; }
.mc-shell .mc-sheet{ background:#1A2820; }
.mc-shell .mc-hero{ background:linear-gradient(150deg, rgba(127,169,138,.3), rgba(46,74,56,.28) 60%), #203127; }
.mc-shell .sf-nudge{ background:rgba(228,201,141,.14); color:#E4C98D; }
.mc-shell .sf-link{ color:rgba(237,242,234,.7); }
.mc-shell .sf-link-quiet{ color:rgba(237,242,234,.42); }
.mc-shell .mcf-title{ color:#EDF2EA; }
.mc{ padding-right:44px; }
.mc-spine{ position:fixed; right:7px; top:max(126px, calc(112px + var(--sat))); bottom:82px; width:22px; z-index:7; display:flex;
  flex-direction:column; align-items:center; gap:8px; pointer-events:none; }
.mc-spine .rt{ font-family:var(--sfmono); font-size:8px; font-weight:700; letter-spacing:.18em;
  color:rgba(237,242,234,.42); writing-mode:vertical-rl; }
.mc-spine .sp{ position:relative; width:4px; flex:1; border-radius:999px; background:rgba(255,255,255,.11); }
.mc-spine .sp i{ position:absolute; left:0; right:0; bottom:0; border-radius:999px;
  background:linear-gradient(0deg,#567D61,#A9C4AC); transition:height .6s cubic-bezier(.2,.8,.2,1); }
.mc-spine .sp u{ position:absolute; left:-3px; right:-3px; height:2px; background:rgba(237,242,234,.3); }
.mc-spine .sp b{ position:absolute; left:50%; transform:translate(-50%,50%); width:10px; height:10px; border-radius:50%;
  background:#E9CE96; box-shadow:0 0 9px rgba(228,201,141,.95); transition:bottom .6s cubic-bezier(.2,.8,.2,1); }
.mc-spine.cold .sp i{ background:linear-gradient(0deg,#8A4A42,#F08A80); }
.mc-spine.cold .sp b{ background:#F08A80; box-shadow:0 0 9px rgba(240,138,128,.9); }
.mc-spine.made .rt{ color:#8FD8AF; }
.mc-spine.made .sp i{ background:linear-gradient(0deg,#567D61,#8FD8AF); }
.mc-spine.made .sp b{ background:#8FD8AF; box-shadow:0 0 11px rgba(143,216,175,1); }
/* The floor goes to deep black under the garden glow: it is read at arm's
   length across a showroom, so the ink drops to near black and every surface
   on it sits a step deeper, and the line and the title get the contrast. */
.q-page.sf.mc-shell.mc-floor{
  background:radial-gradient(closest-side at 50% 116%, rgba(127,169,138,.42), rgba(127,169,138,.1) 55%, transparent 76%), #070A08; }
.mc-floor .mcf-track{ background:#0D130F; box-shadow:inset 0 1px 0 rgba(255,255,255,.05); }
.mc-floor .mcf-pip{ background:#243229; }
.mc-floor .mcf-pip.hd{ background:#2E4034; }
.mc-floor .fba-btn{ background:#0B100D; border-color:rgba(255,255,255,.12); }
.mc-floor .fba-btn.fly{ border-color:rgba(232,169,60,.6); }
.mc-floor .fba-btn.to{ border-color:rgba(216,72,60,.6); }
.mc-floor .mcf-title{ color:#FFFFFF; }
.mc-floor .mcf-tmr .v{ color:#F2F6F2; }
.mc-floor .mcf-cap{ color:rgba(237,242,234,.62); }
.mc-floor .mc-pill{ background:rgba(3,5,4,.9); }
/* ---- reach ----------------------------------------------------------------
   Read at arm's length, tapped with a thumb: nothing smaller than 44px to
   hit, nothing smaller than 11px to read, and the numerals scale with it.
   The person's own text size rides on top as a zoom of the whole screen,
   the bar and the sheets included, so nothing they can tap stays small. */
.q-page.sf, .ar-bar, .fba-sheetwrap, .mc-ov{ zoom:var(--sftxt, 1); }
.mc{ gap:14px; padding-left:18px; padding-right:48px; }
.mc-calhead{ font-size:11.5px; }
.mc-cal{ grid-template-columns:repeat(7, 12px); gap:6px 8px; margin-top:9px; }
.mc-cal s{ width:12px; height:12px; }
.mc-date{ font-size:13px; }
.mc-qmini{ gap:7px; min-height:24px; }
.mc-qmini s{ width:14px; height:14px; }
.mc-qmini s.hd{ width:22px; height:22px; border-radius:6px; font-size:10px; }
.mc-qmini b{ font-size:11.5px; }
.mc-asof{ font-size:12px; }
.mc-asof s{ width:8px; height:8px; }
.mc-help{ width:40px; height:40px; }
.mc-hero{ padding:16px 15px 14px; }
.mc-units-lbl{ font-size:13.5px; }
.mc-icobtn{ width:42px; height:42px; }
.mc-cbars{ height:16px; gap:3px; }
.mc-cbars i{ width:4.5px; }
.mc-pace{ margin-top:14px; gap:10px; }
.mc-pace .nm{ font-size:12.5px; width:38px; }
.mc-pace .tr{ height:16px; }
.mc-pacew .pm{ height:22px; top:-3px; width:3.5px; }
.mc-pace .num{ font-size:13.5px; }
.mc-legend{ font-size:11px; gap:14px; margin-top:8px; }
.mc-legend s{ width:9px; height:9px; }
.mc-cap{ font-size:12px; }
.mc-card{ padding:14px 16px; border-radius:18px; }
.mc-row{ gap:14px; padding:11px 0; }
.mc-num{ min-width:58px; }
.mc-tx b{ font-size:17px; }
.mc-tx .st{ font-size:12px; margin-top:3px; }
.mc-tx .bar{ height:6px; margin-top:8px; }
.mc-made{ height:28px; font-size:11.5px; gap:9px; margin-top:7px; border-radius:9px; }
.mc-ptslbl b{ font-size:16.5px; }
.mc-streak{ font-size:12px; }
.mc-week{ gap:0; margin-top:12px; justify-content:space-between; padding:0 2px; }
.mc-week i{ width:auto; flex:0 0 auto; }
.mc-week .c{ width:32px; height:32px; font-size:12.5px; }
.mc-week .wd{ font-size:11px; margin-top:5px; }
.mc-list{ margin-top:10px; }
.mc-li{ padding:11px 0; font-size:15.5px; gap:12px; }
.mc-li .ck{ width:24px; height:24px; }
.mc-hb{ gap:9px; }
.mc-hb .rk{ font-size:12px; width:22px; }
.mc-hb .tk{ height:14px; }
.mc-hb .un{ font-size:12.5px; width:36px; }
.mc-hb .nm2{ font-size:14px; width:110px; }
.mc-boardsub{ font-size:12px; margin-top:10px; }
.mc-boardbtn{ min-height:44px; }
.mc-sheet{ padding:20px 19px 22px; }
.mc-sheet-head b{ font-size:19px; }
.mc-x{ width:36px; height:36px; }
.mc-cl b{ font-size:16px; }
.mc-cl .lb{ font-size:13px; }
.mc-cl .dl{ font-size:12px; }
.mc-cl .vb{ height:130px; width:30px; }
.mc-clfoot{ font-size:12.5px; }
.mc-sc{ gap:10px 0; margin-top:10px; }
.mc-sc b{ font-size:11.5px; }
.mc-sc s{ width:20px; height:20px; }
.mc-scr{ font-size:13px; padding:6px 0; }
.mc-scd-hint{ font-size:12.5px; }
.mc-offc b{ font-size:17px; }
.mc-offc .hint{ font-size:13px; }
.mc-offb button{ padding:11px 20px; font-size:13px; min-height:44px; }
.mc-spine{ width:26px; right:9px; }
.mc-spine .rt{ font-size:11px; }
.mc-spine .sp{ width:5px; }
.mc-spine .sp b{ width:13px; height:13px; }
.mc-pill{ padding:5px; }
.mc-ind{ left:5px; top:5px; bottom:5px; width:60px; }
.mc-tab{ width:60px; padding:12px 0; }
.mcf-cap{ font-size:11px; margin-top:10px; }
.mcf-track{ height:40px; margin-top:14px; }
.mcf-pip{ width:26px; height:26px; font-size:9px; }
.mcf-pip.hd{ width:34px; height:34px; font-size:10.5px; }
.mcf-track{ --edge:21px; }
.mcf-pip.bh{ width:22px; height:22px; font-size:9px; }
.mcf-you{ width:26px; height:26px; font-size:9px; }
.mcf-track > s.lt{ width:8px; height:8px; margin-top:-4px; left:-4px; }
.mcf-tmr{ gap:28px; margin-top:18px; }
.mcf-tmr .v{ font-size:14px; height:18px; gap:7px; }
.mcf-tmr .l{ font-size:10px; margin-top:4px; }
.mcf-title{ font-size:27px; margin-top:16px; }
.mcf-sub{ font-size:14px; }
.mcf .fba-row{ gap:10px; margin-top:12px; }
.mcf .fba-btn{ padding:18px 10px 15px; min-height:96px; gap:8px; }
.mcf .fba-btn b{ font-size:17px; }
.mcf .fba-btn span{ font-size:12px; }
.mcf .sf-links{ margin-top:14px; gap:18px; }
.mcf .sf-link{ font-size:14.5px; min-height:44px; white-space:nowrap; }
.mc-tk-h{ font-size:11.5px; }
.mc-tk-n{ font-size:17px; }
.mc-tk-row{ font-size:14px; padding:6px 0; }
.mc-tk-go{ padding:13px; font-size:14px; min-height:48px; }
.mc-send{ font-size:12px; }
.mc-flash-t{ font-size:30px; }
.mc-flash-s{ font-size:15px; }
.mc-flash-b{ padding:12px 26px; font-size:14px; min-height:48px; }
/* ---- the moments -------------------------------------------------------- */
.mc-shell .help-fab{ display:none; }
.mc-head{ position:relative; }
.mc-help{ position:absolute; top:-2px; right:-8px; width:26px; height:26px; border-radius:50%;
  border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); color:rgba(237,242,234,.8);
  cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform .12s ease; }
.mc-tab.alert{ color:#8fd8af; }
.mc-tab.alert svg, .mc-tab.alert span{ animation:mcRec 1.4s ease-in-out infinite; }
.mc-off > *:not(.mc-offc){ opacity:.32; }
.mc-offc{ border:1px solid rgba(228,201,141,.55); background:#1c2b23; border-radius:15px; padding:13px; margin-top:6px;
  animation:mcIn .3s ease-out backwards; }
@keyframes mcIn{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
.mc-offc b{ display:block; font-size:15px; font-family:var(--font-display); }
.mc-offc .hint{ display:block; font-size:11.5px; color:rgba(237,242,234,.65); margin-top:3px; }
.mc-offb{ display:flex; gap:8px; margin-top:11px; }
.mc-offb button{ border:0; border-radius:999px; padding:8px 16px; font-size:11px; font-weight:700; cursor:pointer; }
.mc-offb .yes{ background:#e4c98d; color:#2a2418; }
.mc-offb .no{ background:rgba(255,255,255,.1); color:#edf2ea; }
.mc-set-row{ display:flex; align-items:center; gap:10px; padding:14px 2px; min-height:44px; border-bottom:1px solid rgba(255,255,255,.07);
  font-size:15px; font-weight:600; width:100%; text-align:left; background:none; border-left:0; border-right:0; border-top:0;
  color:#e8eef2; cursor:pointer; }
.mc-set-row:last-child{ border-bottom:0; }
.mc-set-row .hint{ display:block; font-size:12px; font-weight:500; color:rgba(237,242,234,.5); margin-top:1px; }
.mc-set-row .on{ margin-left:auto; font-family:var(--sfmono); font-size:12px; font-weight:700; letter-spacing:.12em; color:#e4c98d;
  display:inline-flex; align-items:center; }
.mc-set-av{ width:40px; height:40px; border-radius:50%; color:#fff; display:flex; align-items:center; justify-content:center;
  font-family:var(--sfmono); font-size:12.5px; font-weight:700; flex:0 0 auto; }
.mc-set-out{ color:#f08a80; }
/* ---- the person's sheet, in the corner's clothes ----
   The hero card for the person, then cards for this phone, reach, the day,
   each row with a PixIcon tile. Switches are sand when on; the three-step
   choices are one small segment rather than a value that cycles on tap. */
.mc-you-hero{ display:flex; align-items:center; gap:12px; padding:14px; border-radius:16px; color:#EDF2EA;
  background:linear-gradient(150deg,#7FA98A,#55795F 55%,#26382C); box-shadow:0 14px 30px -18px rgba(38,56,44,.8); }
.mc-you-hero .mc-set-av{ width:44px; height:44px; font-size:13px; box-shadow:0 0 0 3px rgba(255,255,255,.22); }
.mc-you-who{ flex:1; min-width:0; }
.mc-you-who b{ display:block; font-family:var(--font-display); font-size:17px; letter-spacing:-.01em; }
.mc-you-who .hint{ display:block; font-size:12px; color:rgba(237,242,234,.72); margin-top:2px; }
.mc-you-live{ font-family:var(--sfmono); font-size:10px; font-weight:700; letter-spacing:.14em; padding:5px 9px; border-radius:8px;
  background:rgba(255,255,255,.16); flex:0 0 auto; }
.mc-you .mc-cap{ margin:16px 2px 8px; }
.mc-you .mc-you-card{ padding:2px 12px; }
.mc-you .mc-set-row{ gap:12px; padding:12px 0; min-height:52px; }
.mc-you .mc-set-row .ic{ width:34px; height:34px; border-radius:10px; background:rgba(255,255,255,.07); color:#e4c98d;
  display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
.mc-you .mc-set-row .ic .pix{ color:inherit; }
.mc-you .mc-set-row > span:not(.ic):not(.on):not(.mc-sw):not(.mc-seg3){ flex:1; min-width:0; }
.mc-you .mc-set-out .ic{ color:#f08a80; background:rgba(240,138,128,.12); }
.mc-seg3{ margin-left:auto; display:inline-flex; gap:2px; padding:3px; border-radius:10px; background:rgba(255,255,255,.07); flex:0 0 auto; }
.mc-seg3 button{ border:0; background:none; color:rgba(237,242,234,.6); font-family:var(--sfmono); font-size:10.5px; font-weight:700;
  letter-spacing:.06em; padding:0 9px; min-width:36px; height:30px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.mc-seg3 button.on{ background:#e4c98d; color:#1a2820; }
.mc-seg3.txt button{ font-family:var(--font-display); letter-spacing:0; min-width:32px; }
.mc-you .mc-set-row.stack{ flex-wrap:wrap; }
.mc-you .mc-set-row.stack .mc-seg3.wide{ flex:1 0 100%; margin-left:0; margin-top:4px; }
.mc-you .mc-set-row.stack .mc-seg3.wide button{ flex:1; }
.mc-seg3.txt button:nth-child(1){ font-size:11px; }
.mc-seg3.txt button:nth-child(2){ font-size:14px; }
.mc-seg3.txt button:nth-child(3){ font-size:18px; }
.mc-sw{ margin-left:auto; width:46px; height:28px; border-radius:14px; background:rgba(255,255,255,.14); position:relative; flex:0 0 auto;
  transition:background .25s; }
.mc-sw::after{ content:""; position:absolute; top:3px; left:3px; width:22px; height:22px; border-radius:50%; background:#EDF2EA;
  transition:transform .25s cubic-bezier(.3,1.3,.4,1), background .25s; }
.mc-sw.on{ background:#e4c98d; }
.mc-sw.on::after{ transform:translateX(18px); background:#1a2820; }
/* the help panel, when it opens from these screens, in the same dark */
.help-sheet.mc-tone{ background:#1a2820; border:1px solid rgba(228,201,141,.28); box-shadow:0 32px 70px -20px rgba(0,0,0,.92); }
.help-sheet.mc-tone, .help-sheet.mc-tone *{ color:#e8eef2; }
.help-sheet.mc-tone .hint, .help-sheet.mc-tone .help-role, .help-sheet.mc-tone .help-intro, .help-sheet.mc-tone .help-lbl{ color:rgba(237,242,234,.55); }
.help-sheet.mc-tone .help-tabs{ background:rgba(255,255,255,.07); }
.help-sheet.mc-tone .help-tab{ color:rgba(237,242,234,.62); }
.help-sheet.mc-tone .help-tab.on{ background:#e4c98d; color:#1a2820; box-shadow:none; }
.help-sheet.mc-tone .help-tab-wrong.on{ color:#1a2820; }
.help-sheet.mc-tone .help-in, .help-sheet.mc-tone .help-area, .help-sheet.mc-tone select.help-in{ background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); color:#e8eef2; }
.help-sheet.mc-tone .help-link{ color:#e4c98d; }
.help-sheet.mc-tone .md-x{ background:rgba(255,255,255,.1); color:#e8eef2; }
.help-sheet.mc-tone .btn{ background:#e4c98d; color:#1a2820; border-color:#e4c98d; }
/* The slot the ticket prints from sits under the phone's status bar, not
   behind it: the safe area is padding on the overlay so the paper comes out
   below the clock, on every phone. */
.mc-tkov{ position:fixed; inset:0; z-index:70; display:flex; flex-direction:column; background:rgba(6,10,8,.72);
  padding:calc(var(--sat, env(safe-area-inset-top, 0px)) + 6px) 0 16px; }
.mc-slot{ height:9px; margin:0 22px; background:#0a0f0c; border-radius:0 0 9px 9px; box-shadow:0 5px 12px rgba(0,0,0,.5); position:relative; z-index:2; flex:0 0 auto; }
.mc-tkt{ margin:0 16px; background:#f7eed9; color:#2a2418; border-radius:0 0 8px 8px; padding:15px 14px; position:relative;
  box-shadow:0 14px 34px -12px rgba(0,0,0,.7); animation:mcPrint 2.6s steps(22,end) both; }
@keyframes mcPrint{ from{ transform:translateY(-104%); } to{ transform:none; } }
.mc-tkt::after{ content:""; position:absolute; left:0; right:0; bottom:-1px; height:8px; transform:scaleY(-1);
  background:radial-gradient(circle at 6px 0px, #10160f 5px, transparent 5.5px) repeat-x; background-size:16px 8px; }
.mc-tk-h{ text-align:center; font-family:var(--sfmono); font-size:9px; font-weight:700; letter-spacing:.18em; }
.mc-tk-n{ text-align:center; font-size:15px; font-weight:700; margin-top:2px; font-family:var(--font-display); }
.mc-tk-big{ display:flex; align-items:center; justify-content:space-between; margin-top:12px; }
.mc-tk-dm .ld{ box-shadow:inset 0 1.5px 2.5px rgba(0,0,0,.7), inset 0 -1px 1px rgba(255,255,255,.25) !important; }
.mc-tk-dm .ld.on{ background:rgba(16,22,17,.82) !important; }
.mc-tk-r{ text-align:right; font-family:var(--sfmono); font-size:12px; font-weight:600; }
.mc-tk-row{ display:flex; align-items:baseline; gap:7px; font-family:var(--sfmono); font-size:12px; font-weight:600; padding:4.5px 0; }
.mc-tk-row i{ flex:1; border-bottom:2px dotted rgba(42,36,24,.35); }
.mc-tk-row .ok{ color:#1e7a46; }
.mc-tk-foot{ display:flex; justify-content:space-between; align-items:center; gap:14px; margin:12px 0 6px; }
.mc-stamp{ display:inline-block; border:3px solid #1e7a46; color:#1e7a46; transform:rotate(-4deg); padding:2px 10px;
  font-size:11px; font-weight:700; border-radius:7px; letter-spacing:.04em; }
.mc-tk-note{ font-family:var(--sfmono); font-size:10px; font-weight:600; letter-spacing:.1em; color:rgba(42,36,24,.55); text-align:right; }
.mc-bcode{ height:24px; margin-top:8px;
  background:repeating-linear-gradient(90deg,#2a2418 0 2px,transparent 2px 5px,#2a2418 5px 6px,transparent 6px 10px); }
.mc-tk-go{ margin-top:12px; width:100%; border:0; background:#2a2418; color:#f7eed9; border-radius:999px; padding:10px;
  font-size:12px; font-weight:700; cursor:pointer; }
.mc-tk-go:disabled{ opacity:.35; cursor:default; }
/* The ticket prints out of the slot. Anything still inside the printer is
   clipped, so the top of the receipt never shows above the slot mid-print, and
   a receipt taller than the screen scrolls instead of running under the edge. */
.mc-tkwrap{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; overflow-x:hidden; overflow-y:auto; padding-bottom:12px; }
.mc-tkwrap .mc-tkt{ flex:0 0 auto; }
/* the customer has gone: one button, said plainly */
.mcf .mcf-left{ margin:14px auto 0; display:flex; align-items:center; justify-content:center; gap:9px; }
/* leaving the lot */
.mc-lotov{ position:fixed; inset:0; z-index:72; display:flex; align-items:center; justify-content:center; background:rgba(3,6,5,.88); padding:0 14px; }
.mc-lot{ width:min(430px,100%); border-radius:24px; padding:24px 20px 18px; background:#101713; border:1px solid rgba(228,201,141,.24); color:#E8EEF2; text-align:center; box-shadow:0 32px 70px -20px rgba(0,0,0,.92); animation:mcSheet .3s cubic-bezier(.2,1.15,.35,1) both; will-change:transform,opacity; }
.mc-lot .pix{ color:#E4C98D; }
.mc-lot-h{ margin-top:10px; font-family:var(--mc-geist); font-size:21px; font-weight:600; letter-spacing:-.02em; }
.mc-lot-p{ margin:8px 0 0; font-size:14px; line-height:1.5; color:rgba(232,238,242,.72); }
.mc-lot .mc-lot-go{ margin-top:18px; width:100%; }
.mc-lot-no{ margin-top:10px; width:100%; border:0; background:none; color:rgba(232,238,242,.7); font:600 14px var(--font-ui); padding:12px; min-height:44px; cursor:pointer; }
.mc-light .mc-lot{ background:#FFFDF8; color:#1F2A22; border-color:rgba(31,42,34,.1); }
.mc-light .mc-lot-p{ color:#4A5A4E; }
.mc-light .mc-lot-no{ color:#4A5A4E; }
.mc-send{ display:flex; align-items:center; justify-content:center; gap:5px; margin-top:14px; font-family:var(--sfmono);
  font-size:9px; font-weight:700; letter-spacing:.14em; color:#e4c98d; text-align:center; padding:0 20px; }
.mc-send s{ width:6px; height:6px; border-radius:50%; background:#e4c98d; animation:mcSend 1s infinite; }
.mc-send s:nth-child(2){ animation-delay:.18s; }
.mc-send s:nth-child(3){ animation-delay:.36s; }
@keyframes mcSend{ 0%,100%{ opacity:.2; } 50%{ opacity:1; } }
.mc-send.done{ color:#8fd8af; }
.mc-send.fail{ color:#f08a80; }
.mc-flash{ position:fixed; inset:0; z-index:80; display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; padding:20px; color:#fff; overflow:hidden;
  background:linear-gradient(140deg,#7FA98A,#26382C); }
.mc-flash .bloom{ position:absolute; left:50%; top:42%; width:60px; height:60px; margin:-30px; border:2px solid rgba(255,255,255,.7);
  border-radius:50%; pointer-events:none; animation:mcBloom 1.1s ease-out both; }
@keyframes mcBloom{ from{ transform:scale(.2); opacity:.9; } to{ transform:scale(9); opacity:0; } }
.mc-flash .burst{ position:absolute; left:50%; top:40%; color:rgba(255,255,255,.8); animation:mcBurst 1.05s cubic-bezier(.15,.75,.3,1) both; }
@keyframes mcBurst{ 0%{ transform:translate(-50%,-50%) scale(.3); opacity:0; } 18%{ opacity:1; }
  100%{ transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity:0; } }
.mc-flash .drv{ position:absolute; left:12px; bottom:12px; color:rgba(255,255,255,.85); animation:mcDrive 10s linear 1.15s infinite; }
@keyframes mcDrive{ 0%{ transform:translate(0,0) rotate(0); } 22%{ transform:translate(calc(100vw - 48px),0) rotate(0); }
  25%{ transform:translate(calc(100vw - 48px),0) rotate(-90deg); } 47%{ transform:translate(calc(100vw - 48px),calc(-100vh + 48px)) rotate(-90deg); }
  50%{ transform:translate(calc(100vw - 48px),calc(-100vh + 48px)) rotate(180deg); } 72%{ transform:translate(0,calc(-100vh + 48px)) rotate(180deg); }
  75%{ transform:translate(0,calc(-100vh + 48px)) rotate(90deg); } 97%{ transform:translate(0,0) rotate(90deg); } 100%{ transform:translate(0,0) rotate(0); } }
.mc-flash-dm{ animation:mcPop .8s cubic-bezier(.18,1.5,.3,1) both; margin-bottom:26px; }
@keyframes mcPop{ 0%{ transform:scale(.3); opacity:0; } 60%{ transform:scale(1.12); opacity:1; } 100%{ transform:scale(1); } }
.mc-flash-t{ font-size:26px; font-weight:700; font-family:var(--font-display); animation:mcRise .5s .3s both; }
.mc-flash-s{ font-size:13px; opacity:.85; margin-top:6px; animation:mcRise .5s .45s both; }
.mc-flash-b{ margin-top:18px; border:1px solid rgba(255,255,255,.4); background:rgba(255,255,255,.14); color:#fff; border-radius:999px;
  padding:9px 20px; font-size:12px; font-weight:600; cursor:pointer; animation:mcRise .5s .6s both; }
@keyframes mcRise{ from{ transform:translateY(16px); opacity:0; } to{ transform:none; opacity:1; } }
@media (prefers-reduced-motion: reduce){
  .mc-asof s, .mc-made::after, .mc-sheet, .mc-ind, .mc-tab.alert svg, .mc-offc,
  .mc-tkt, .mc-send s, .mc-flash .bloom, .mc-flash .burst, .mc-flash .drv, .mc-flash-dm, .mc-flash-t, .mc-flash-s, .mc-flash-b{ animation:none; transition:none; }
}
/* ---- the status selector ----
   Four states, one track, one indicator. The grid of chunky tiles it replaces
   also changed shape depending on where you already stood — "Back in" swapped
   in for three buttons — so the controls moved under your thumb between
   glances. Nothing moves here except the pill. */
.sf-seg{
  position:relative; display:flex; width:100%; padding:4px; border-radius:17px;
  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.07);
}
.sf-seg-pill{
  position:absolute; left:0; top:4px; bottom:4px; border-radius:13px;
  background:linear-gradient(135deg, var(--a1), var(--a2));
  box-shadow:0 8px 20px -10px var(--a1);
  pointer-events:none;
  transition:transform .42s var(--ease-bloop), width .42s var(--ease-bloop), opacity .2s var(--ease);
}
@media (prefers-reduced-motion: reduce){ .sf-seg-pill{ transition:opacity .2s linear; } }
.sf-seg-btn{
  flex:1 1 0; min-width:0; position:relative; z-index:1;
  display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:12px 3px 10px; border:0; background:none; cursor:pointer;
  color:var(--sfink2); font-size:13px; font-weight:640; letter-spacing:-.01em;
  transition:color .25s var(--ease), transform .28s var(--ease-bloop);
}
.sf-seg-btn:disabled{ opacity:.6; }
.sf-seg-btn.on{ color:#04121C; }
.sf-seg-btn > span{ max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* the glyph follows the segment, not the queue's LED colour, and drops the glow
   it wears elsewhere — on a filled pill it would smear */
.sf-seg-btn .sf-ico{ color:currentColor; filter:none; }
/* ---- the two places left to go ----
   My day and leaving are not states, so they are not on the track. They read as
   links rather than as two more buttons the size of a status. */
.sf-links{ display:flex; gap:6px; margin-top:10px; }
.sf-link{
  flex:1 1 0; display:inline-flex; align-items:center; justify-content:center; gap:7px;
  background:none; border:0; cursor:pointer; padding:14px 8px; border-radius:13px;
  font-family:var(--sffont); font-size:15px; font-weight:620; color:var(--sfink2);
  transition:color .2s var(--ease), background .2s var(--ease), transform .28s var(--ease-bloop);
}
.sf-link:hover:not(:disabled){ color:var(--sfink); background:rgba(255,255,255,.05); }
.sf-link .sf-ico{ color:currentColor; filter:none; }
.sf-link-quiet{ color:var(--sfink3); }
.sf-link-quiet:hover:not(:disabled){ color:#FFC9C4; background:rgba(255,120,110,.1); }
/* the undo line on Live Floor, which is a sentence rather than a control */
.sf-leave{ background:none; border:none; color:var(--sfink3); font-family:var(--sfmono);
  font-size:12.5px; line-height:1.4; cursor:pointer; padding:10px 4px; transition:color .2s; }
.sf-leave:hover{ color:var(--sfink2); }
/* full-screen "you're up" takeover */
.sf-uptake{ position:absolute; inset:0; z-index:20; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
  padding:40px; background:linear-gradient(160deg,var(--a1),var(--a2)); animation:sfUpIn .5s cubic-bezier(.2,.85,.25,1) both; }
@keyframes sfUpIn{ from{ opacity:0; transform:scale(1.04); } to{ opacity:1; transform:none; } }
/* Centred on the number, because that is what it is coming off. Two rings half
   a cycle apart so it reads as something leaving the figure rather than one
   circle breathing. */
.sf-upnum{ position:relative; display:grid; place-items:center; margin-bottom:24px; }
.sf-shock{ position:absolute; left:50%; top:50%; width:min(52vw,200px); height:min(52vw,200px);
  transform:translate(-50%,-50%); border-radius:50%; border:2px solid rgba(255,255,255,.5);
  animation:sfShock 2s ease-out infinite; pointer-events:none; }
.sf-shock.d2{ animation-delay:1s; border-color:rgba(255,255,255,.34); }
@keyframes sfShock{
  0%{ transform:translate(-50%,-50%) scale(.42); opacity:.75; }
  100%{ transform:translate(-50%,-50%) scale(2.4); opacity:0; } }
@media (prefers-reduced-motion: reduce){ .sf-shock{ animation:none; opacity:.3; } }
.sf-uptake .dm{ --cell:clamp(12px,4.4vw,17px); --led:#fff; --ld-off:rgba(255,255,255,.3); position:relative; z-index:1; animation:sfThrob 1.3s ease-in-out infinite; }
.sf-uptake .dm .ld.on{ box-shadow:0 0 10px rgba(255,255,255,.6); }
@keyframes sfThrob{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.05); } }
.sf-uptake h2{ font-size:clamp(40px,13vw,54px); font-weight:700; letter-spacing:-.04em; color:#04140f; line-height:.95; }
.sf-uptake p{ margin-top:12px; font-size:clamp(15px,4.4vw,17px); font-weight:500; color:rgba(4,20,15,.78); max-width:340px; }
/* ---- The one tap that matters ----
   This screen exists to be tapped, once, by somebody who has just been told a
   customer is theirs and is already walking. It was a 110px pill in the middle of
   a full-screen panel: fine to aim at sitting down, mean at arm's length on the
   move. It now runs the width of the panel and stands 68px tall, which is a
   target a thumb finds without being aimed.

   The padding above it is part of the same idea. A finger that lands slightly
   high on a small button hits nothing at all and the screen just sits there;
   here the whole foot of the panel is the button. */
.sf-go{
  margin-top:32px; width:100%; max-width:420px; min-height:68px;
  background:#04140f; color:#fff; border:none; border-radius:18px;
  padding:20px 32px; font-family:var(--sffont); font-weight:700; font-size:18px;
  letter-spacing:-.01em; cursor:pointer; touch-action:manipulation;
  box-shadow:0 10px 28px -12px rgba(4,20,15,.75);
  transition:transform .12s var(--ease), box-shadow .18s var(--ease);
}
/* The press has to be felt as well as heard — a button this size with no travel
   reads as unresponsive on a phone that has not caught up yet. */
.sf-go:active{ transform:translateY(2px); box-shadow:0 4px 14px -8px rgba(4,20,15,.7); }
.sf-go:disabled{ opacity:.6; }
/* PIN screen — its own "something else fun" entrance (a spring pop, no curtain) */
.q-stage-pin{animation:qpinpop .58s cubic-bezier(.2,.9,.25,1.35) both;transform-origin:center 40%;}
/* The pop was written for a card sitting in the middle of a page. The PIN screen
   is the whole screen now, so scaling it scales the layout — the cells lighting
   as digits land is the feedback that matters here. */
.sf .q-stage-pin{ animation:none; }
@keyframes qpinpop{
  0%{opacity:0;transform:scale(.72) translateY(14px) rotate(-1.2deg);}
  55%{opacity:1;transform:scale(1.04) translateY(0) rotate(.4deg);}
  100%{opacity:1;transform:scale(1) translateY(0) rotate(0);}
}
@keyframes qpinglow{
  0%{box-shadow:0 0 0 0 rgba(120,150,255,0);}
  40%{box-shadow:0 0 0 6px rgba(120,150,255,.18);}
  100%{box-shadow:0 0 0 0 rgba(120,150,255,0);}
}
/* ===== SmartFloor / Live Floor — greens where the phone line runs blue ===== */
.f-page .q-curtain, .q-curtain.sage-curtain {background:linear-gradient(150deg,#7FA98A 0%,#55795F 55%,#26382C 100%);}
.q-curtain.q-hold{transform:none;animation:none;}
.q-curtain.sage-curtain{z-index:9000;}
.q-curtain.q-hold .q-curtain-mark{opacity:1;transform:none;animation:sageCurtainPulse 1.8s ease-in-out infinite;}
@keyframes sageCurtainPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.06);}}
.q-curtain.q-out{animation:qcurtainOut .32s cubic-bezier(.76,0,.24,1) both;}
@keyframes qcurtainOut{0%{transform:translateX(0);}100%{transform:translateX(101%);}}
.q-curtain.q-out .q-curtain-mark{animation:qmarkOut .32s ease both;}
@keyframes qmarkOut{0%{opacity:1;transform:scale(1);}100%{opacity:0;transform:scale(.7);}}
.sage-curtain-mark{width:auto;height:auto;display:grid;place-items:center;}
.sage-curtain-mark svg{display:block;filter:drop-shadow(0 12px 30px rgba(0,0,0,.35));}
@media (prefers-reduced-motion: reduce){ .q-curtain.q-hold .q-curtain-mark{animation:none;} }
/* Ups so far today. Quiet when somebody has had one, and quieter still when they
   have not — nobody should read this as an accusation, only as the fact a manager
   is currently having to guess at. */
.f-ups.none{color:var(--sfink3);background:rgba(255,255,255,.06);}
/* The morning-after review. Deliberately plain: nothing here is red until a
   manager makes it so, because the screen is showing facts, not accusations. */
/* ---- behind the standard, on the manager's side ----
   Same frame as the off-lot backlog: they sit next to each other and they are the
   same job, so looking like two different features would be a lie about how they
   are read. */
.ms-act .help-in{flex:1;min-width:220px;}
.mf .ms-foot{color:var(--mfink2);}
/* The manager's page is the light one, and every rule above is written for the
   dark surfaces this panel's frame came from. Same treatment the line rows get.

   The frame itself gets it too, which fixes the off-lot backlog next door at the
   same time: a card drawn as five per cent white on a white page is not a card. */
.mf .f-backlog{ background:#fff; border:1px solid var(--mfline); box-shadow:0 1px 2px rgba(16,32,52,.05); }
.mf .f-backlog-head p{ color:var(--mfink2); }
.mf .f-bl-row{ background:#F6F8FA; }
.mf .f-bl-date, .mf .f-bl-when{ color:var(--mfink2); }
.mf .ms-row{ background:#fff; border:1px solid var(--mfline); box-shadow:0 1px 2px rgba(16,32,52,.05); }
.mf .ms-row.ms-owes{ background:linear-gradient(160deg,var(--c-amber-bg),#fff 65%); border-color:#F2D9A8; }
.mf .ms-count, .mf .ms-note-m, .mf .ms-lift{ color:var(--mfink2); }
.mf .ms-state{ font-family:var(--mfmono); background:var(--c-blue-bg); color:var(--c-blue); letter-spacing:.04em; }
.mf .ms-state.owes{ background:#fff; color:var(--c-amber); border:1px solid #F2D9A8; }
.mf .ms-day{ background:#F6F8FA; }
.mf .ms-day b{ font-family:var(--mfmono); color:var(--mfink2); }
.mf .ms-note{ background:#F6F8FA; border-left:3px solid var(--c-blue); }
.mf .ms-empty{ color:#7A5A12; }
.f-phones .hint{margin:0 0 12px;font-size:12px;line-height:1.55;max-width:76ch;}
.f-claim-who .mono{font-size:11px;opacity:.7;}
/* ---- FlyBy: shared plan drawing ---- */
.fbp-scroll{overflow-x:auto;overflow-y:hidden;border-radius:14px;}
.fbp{position:relative;height:340px;min-width:100%;}
.fbp-zone{position:absolute;border:1px dashed rgba(255,255,255,.2);border-radius:12px;padding:4px 8px;
  font:600 9px var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.45);pointer-events:none;}
.fbp-tbl{position:absolute;width:52px;height:42px;border-radius:11px;border:1px solid rgba(255,255,255,.3);
  background:rgba(255,255,255,.1);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;
  cursor:pointer;font:700 13px var(--font-mono);padding:0;transition:transform .15s ease;}
.fbp-tbl.round{border-radius:50%;width:48px;height:48px;}
.fbp-tbl:hover{transform:scale(1.06);}
.fbp-tbl:focus-visible{outline:3px solid #37d3a3;outline-offset:2px;}
.fbp-sub{font:600 7.5px var(--font-ui);color:rgba(255,255,255,.7);line-height:1.1;}
.fbp-flag{position:absolute;top:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;
  font:700 9px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:99px;color:#fff;background:#8A5A10;}
.fbp-tbl.fly{background:#E8A93C;border-color:#fff;}
.fbp-tbl.to{background:#D8483C;border-color:#fff;}
.fbp-tbl.fly::after,.fbp-tbl.to::after{content:"";position:absolute;inset:-2px;border-radius:13px;pointer-events:none;border:3px solid rgba(232,169,60,.55);will-change:transform,opacity;animation:fbaRing 1.4s ease-in-out infinite;}
.fbp-tbl.to::after{border-color:rgba(216,72,60,.55);animation-duration:1s;}
@keyframes fbaRing{0%,100%{transform:scale(1);opacity:0;}50%{transform:scale(1.18);opacity:1;}}
.fbp-tbl.to .fbp-flag{background:#9E2417;}
.fbp-tbl.claimed{animation:none;box-shadow:0 0 0 4px rgba(143,227,179,.5);}
@media (prefers-reduced-motion: reduce){.fbp-tbl{animation:none !important;transition:none;}}
/* ---- the Console card on the manager board ---- */
.fbc .fbp-scroll{background:rgba(6,14,9,.25);margin:0 14px;border:1px solid rgba(255,255,255,.14);}
.fbc-lot.fly{background:#E8A93C;}
.fbc-lot.to{background:#D8483C;}
.fbc-lot.claimed{opacity:.75;box-shadow:0 0 0 3px rgba(143,227,179,.5);}
/* DmNumber's layout lives under .sf (the phone screens); the console redraws
   the same atoms at its own size. */
.fbc-clock .dm{display:flex;gap:4px;align-items:center;}
.fbc-clock .dm-digit{display:grid;grid-template-columns:repeat(3,4px);gap:1.6px;}
.fbc-clock .ld{width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.14);}
.fbc-clock .ld.on{background:#fff;}
@keyframes fbcBlink{50%{border-color:rgba(255,255,255,.6);}}
/* the wall read: same layout, everything turned up */
.fbc.disp .fbp{height:520px;}
.fbc.disp .fbp-tbl{width:78px;height:62px;font-size:17px;border-radius:15px;}
.fbc.disp .fbp-tbl.round{width:70px;height:70px;border-radius:50%;}
.fbc.disp .fbp-tbl.sz-s{width:54px;height:44px;font-size:14px;}
.fbc.disp .fbp-tbl.sz-s.round{width:48px;height:48px;border-radius:50%;}
.fbc.disp .fbp-tbl.sz-l{width:100px;height:76px;}
.fbc.disp .fbp-tbl.sz-l.round{width:88px;height:88px;border-radius:50%;}
.fbc.disp .fbp-sub{font-size:10px;}
.fbc.disp .fbp-zone{font-size:11px;}
/* ---- the door dock ---- */
.fbc-chip.first{box-shadow:0 0 0 5px rgba(143,227,179,.4);}
.fbc-chip.off{opacity:.55;border-style:dashed;}
.fbc-st.nudge{right:auto;left:-5px;background:#8A5A10;}
.fbp-tbl.moving{box-shadow:0 0 0 4px rgba(143,227,179,.6);border-style:dashed;}
/* ---- the hover card ---- */
/* ---- the seat, on the phone ---- */
.fba-seated{display:flex;align-items:center;gap:8px;margin-top:10px;background:#fff;border:1px solid rgba(34,49,38,.12);
  border-radius:13px;padding:12px 14px;font:500 14.5px var(--font-ui);color:#5A6B5E;}
.fba-seated b{color:#223126;}
.fba-seated button{margin-left:auto;border:1px solid rgba(34,49,38,.2);background:#fff;border-radius:99px;
  padding:9px 14px;font:600 13px var(--font-ui);color:#5A6B5E;cursor:pointer;}
.fba-seatask{margin-top:10px;background:#fff;border:1px solid rgba(34,49,38,.12);border-radius:15px;padding:12px 13px;}
.fba-seatask > b{display:block;font:700 16px var(--font-display);color:#223126;}
.fba-seatask > span{display:block;font:500 13.5px var(--font-ui);color:#8B988E;margin:3px 0 10px;}
.fba-seatask .fbp-scroll.mini{background:#E9EFE7;border:1px solid rgba(34,49,38,.12);margin-top:8px;}
.fba-seatask .fbp-scroll.mini .fbp{height:190px;}
.fba-seatask .fbp-scroll.mini .fbp-tbl{width:34px;height:27px;border-radius:8px;font-size:11px;background:#fff;
  border-color:rgba(34,49,38,.25);color:#5A6B5E;}
.fba-seatask .fbp-scroll.mini .fbp-tbl.round{width:31px;height:31px;}
.fba-seatask .fbp-scroll.mini .fbp-tbl.sel{background:#2E4A38;border-color:#2E4A38;color:#fff;}
.fba-seatask .fbp-scroll.mini .fbp-zone{border-color:rgba(86,125,97,.35);color:#8B988E;}
.fba-seatrow{display:flex;gap:8px;}
.fba-seatrow .fba-go{padding:13px 18px;flex:0 1 auto;font-size:15px;}
.fba-seatrow .fba-back{padding:13px 18px;font-size:15px;}
/* ---- the salesperson's side ---- */
.fba-row{display:flex;gap:8px;margin-top:10px;}
.fba-btn{flex:1;border-radius:17px;padding:16px 10px 13px;text-align:center;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:7px;background:rgba(255,255,255,.04);
  border:1.5px solid; transition:transform .12s ease;}
.fba-btn.fly{color:#e8a93c;border-color:rgba(232,169,60,.5);}
.fba-btn.to{color:#f08a80;border-color:rgba(216,72,60,.5);}
.fba-btn b{display:block;font:700 17px var(--font-display);}
.fba-btn span{font-size:12.5px;opacity:.7;}
.fba-chip{display:flex;align-items:center;gap:10px;margin-top:10px;background:#101512;color:#fff;border-radius:15px;padding:11px 13px;}
.fba-ring{width:26px;height:26px;border-radius:50%;border:3px solid #10B981;border-top-color:transparent;
  animation:fbaSpin 1.2s linear infinite;flex:0 0 auto;}
.fba-chip.ok .fba-ring{border-top-color:#10B981;animation:none;}
@keyframes fbaSpin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion: reduce){.fba-ring{animation:none;}}
.fba-tx b{display:block;font:700 14.5px var(--font-display);}
.fba-tx i{font-style:normal;font-size:12.5px;color:rgba(255,255,255,.65);}
.fba-age{margin-left:auto;font:700 14.5px var(--font-mono);color:#10B981;}
.fba-x{border:1px solid rgba(255,255,255,.3);background:transparent;color:rgba(255,255,255,.8);border-radius:99px;
  padding:8px 12px;font:600 12.5px var(--font-ui);cursor:pointer;flex:0 0 auto;}
/* ---- the pickers: where are you, and which table ----
   One sheet for both, in the floor's own dark: the screen it opens over is
   ink and sage, and a paper card dropped on it read as a different app. On a
   phone it is the whole screen, because picking a table is the whole job
   for the moment, and the tables are drawn to be hit with a customer
   standing next to you. */
.fba-sheetwrap{position:fixed;inset:0;z-index:120;background:rgba(7,10,8,.72);backdrop-filter:blur(10px);
  display:flex;align-items:flex-end;justify-content:center;}
.fba-sheet{width:min(420px,100%);background:#0D130F;border:1px solid rgba(255,255,255,.08);border-radius:22px 22px 0 0;
  padding:16px 16px 22px;color:#EDF2EA;}
.fba-cap{font:700 11px var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:rgba(237,242,234,.5);margin:8px 0 8px;}
.fba-sheet .fbp-scroll.mini{background:#070A08;border:1px solid rgba(255,255,255,.08);}
.fba-sheet .fbp-scroll.mini .fbp{height:200px;}
.fba-sheet .fbp-scroll.mini .fbp-zone{border-color:rgba(143,216,175,.28);color:rgba(237,242,234,.45);}
.fba-sheet .fbp-scroll.mini .fbp-tbl{width:34px;height:27px;border-radius:8px;font-size:11px;background:rgba(255,255,255,.09);
  border-color:rgba(255,255,255,.16);color:#EDF2EA;}
.fba-sheet .fbp-scroll.mini .fbp-tbl.round{width:31px;height:31px;}
.fba-sheet .fbp-scroll.mini .fbp-tbl.sel{background:#8fd8af;border-color:#8fd8af;color:#12251b;box-shadow:0 0 18px rgba(143,216,175,.55);}
.fba-lot{width:100%;margin-top:8px;border:1.5px dashed rgba(255,255,255,.22);background:rgba(255,255,255,.04);border-radius:12px;
  padding:9px 0;font:600 12px var(--font-ui);color:rgba(237,242,234,.75);cursor:pointer;}
.fba-lot.sel{background:#8fd8af;border-color:#8fd8af;color:#12251b;}
.fba-notes{display:flex;flex-wrap:wrap;gap:6px;}
.fba-notes button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:99px;padding:6px 11px;
  font:600 10.5px var(--font-ui);color:rgba(237,242,234,.8);cursor:pointer;}
.fba-notes button.sel{background:#8fd8af;border-color:#8fd8af;color:#12251b;}
.fba-send{display:flex;gap:8px;margin-top:14px;}
/* above the room bar: nothing else is tappable while picking, and a lone
   button spans the foot rather than sitting at one edge of it */
.fba-send > .fba-back:only-child{flex:1;}
.fba-go{flex:1;border:0;border-radius:99px;background:#8fd8af;color:#12251b;padding:14px 0;font:700 15px var(--font-display);cursor:pointer;}
.fba-back{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);border-radius:99px;padding:12px 20px;
  font:600 14px var(--font-ui);color:rgba(237,242,234,.8);cursor:pointer;}
@media (max-width:700px){
  .fba-sheetwrap{align-items:stretch;}
  .fba-sheet{width:100%;border-radius:0;border:0;display:flex;flex-direction:column;
    padding:calc(var(--sat, env(safe-area-inset-top, 0px)) + 18px) 16px calc(18px + var(--sab, env(safe-area-inset-bottom, 0px)));overflow-y:auto;}
  .fba-cap{font-size:12.5px;}
  /* the room is drawn wider than the phone and scrolls sideways, the way a
     stretched plan already does, so tables drawn a hand apart on the desk do
     not land on top of each other once they are big enough to hit */
  .fba-sheet .fbp-scroll.mini{flex:0 0 auto;}
  .fba-sheet .fbp-scroll.mini .fbp{height:min(520px,60dvh);min-width:190%;}
  /* the ask carries the lot and the reasons under the room, so its room is
     shorter: the send button has to be on the screen without a scroll */
  .fba-sheet.ask .fbp-scroll.mini .fbp{height:min(400px,42dvh);}
  .fba-sheet .fbp-scroll.mini .fbp-tbl{width:54px;height:42px;border-radius:12px;font-size:18px;font-weight:700;}
  .fba-sheet .fbp-scroll.mini .fbp-tbl.round{width:48px;height:48px;}
  .fba-sheet .fbp-scroll.mini .fbp-zone{font-size:12.5px;}
  .fba-sheet .fbp-scroll.mini .fbp-sub{font-size:11px;}
  .fba-lot{font-size:16px;padding:15px;}
  .fba-notes button{font-size:15px;padding:12px 15px;}
  .fba-send{margin-top:auto;padding-top:16px;}
  .fba-go{padding:17px 0;font-size:17px;}
  .fba-back{padding:15px 24px;font-size:16px;}
}
/* ---- the coverage rail ---- */
.fbc-mgr.floor{border-color:#8FE3B3;}
/* ---- the floor plan editor ---- */
.fpe-tbl.sel{background:#2E4A38;border-color:#2E4A38;color:#fff;}
.fpe-name.wide{width:200px;font:600 12.5px var(--font-ui);}
.fpe-bar .btn.secondary.on{background:#2E4A38;color:#fff;border-color:#2E4A38;}
.fpe-zone.sel{border-color:#2E4A38;border-style:solid;color:#2E4A38;background:rgba(46,74,56,.05);}
.fbp-door{position:absolute;font:700 8px var(--font-mono);letter-spacing:.14em;color:#fff;
  background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.5);border-radius:6px;
  padding:3px 6px;pointer-events:none;}
.fbp-door.main{background:rgba(255,255,255,.4);border-width:2px;font-weight:700;}
.fbp-car{position:absolute;color:rgba(255,255,255,.34);pointer-events:none;display:inline-flex;}
.fbp-car.r90{transform:rotate(90deg);}
.fpe-car.sel{color:#2E4A38;filter:drop-shadow(0 0 3px rgba(46,74,56,.5));}
.fpe-door.main{background:#2E4A38;color:#fff;border-color:#2E4A38;}
.fpe-door.sel{border-color:#2E4A38;box-shadow:0 0 0 3px rgba(46,74,56,.25);}
.fbp-tbl.sz-s{width:40px;height:32px;font-size:11px;}
.fbp-tbl.sz-s.round{width:36px;height:36px;}
.fbp-tbl.sz-l{width:76px;height:56px;}
.fbp-tbl.sz-l.round{width:66px;height:66px;}
/* ---- the corner prompt, anywhere in Sage ---- */
.aswatch-t.fly .aswatch-dot{background:#E8A93C;}
.aswatch-t.to .aswatch-dot{background:#D8483C;}
@keyframes ftoast{from{opacity:0;transform:translate(-50%,8px);}to{opacity:1;transform:translate(-50%,0);}}
/* settings */
/* ================= redesign foundation =================
         The shared vocabulary the page redesigns build on: the warm section
         header, the dotted-leader caption, the sand divider, the goal-tier
         glows, and the bloop popup machinery. Tokens live in :root above.
         Nothing in this block restyles an existing screen on its own; a class
         has to be worn before any of it draws. */
/* goal tiers: the glow is how "at goal" and "in trouble" are felt */
/* a pill that lives in a column takes its width from the column, never its text */
/* ---- bloops: popups that grow out of their anchor and shrink back into it.
         Hover drives them on a mouse; on touch a tap manager toggles .open, so the
         hover rules are gated off where hover would stick. ---- */
/* ---- the layer over the lens ----
         Portaled into .s2-hero, which carries no filter, and placed at the spot
         its marker holds inside the tube. */
/* .s2-ava sets position:relative and is defined further down this sheet,
         so at equal specificity it won and the lifted badge dropped into the
         grid at the foot of the card. Named against its parent so it wins. */
.bloopwin.port.r { transform:translate(-100%,6px) scale(.5); transform-origin:85% calc(100% + 26px); }
.bloopwin.port.dn { transform:translate(-50%,-6px) scale(.5); transform-origin:50% -22px; }
.bloopwin.port.dn.r { transform:translate(-100%,-6px) scale(.5); transform-origin:85% -22px; }
.bloopwin.port.on { opacity:1; pointer-events:auto; transform:translate(-50%,0) scale(1); }
.bloopwin.port.on.r { transform:translate(-100%,0) scale(1); }
.bloopwin.r { left:auto; right:-8px; transform:translate(0,6px) scale(.5); transform-origin:85% calc(100% + 26px); }
.bloopwin.dn { bottom:auto; top:calc(100% + 9px); transform-origin:50% -22px; transform:translate(-50%,-6px) scale(.5); }
.bloopwin.dn.r { transform:translate(0,-6px) scale(.5); transform-origin:85% -22px; }
/* A popup is see-through to the mouse so it never eats a click meant for
         the page under it. The calendar of days sold is the exception: its days
         are the point, so while it is showing it takes the pointer. Hovering it
         keeps the host hovered, since it is a child of the host. */
.bloop-host:hover > .bloopwin.r, .bloop-host:focus-within > .bloopwin.r { transform:translate(0,0) scale(1); }
/* the frosted layer behind a pinned bloop: out of focus, not dark, and it
         eats the next tap so a tap "anywhere" closes rather than chain-opening */
.popscrim.show { opacity:1; pointer-events:auto; }
.bloop-host.open > .bloopwin { opacity:1; pointer-events:auto; transform:translate(-50%,0) scale(1); z-index:46; }
.bloop-host.open > .bloopwin.r { transform:translate(0,0) scale(1); }
@media (hover: none) {
        /* hover sticks on touch: taps manage .open instead, and the pinned copy
           is a clone on <body> (see installBloopManager) so it can sit above the
           frost, which the app's isolated stacking context would otherwise cover */
        .bloop-host:hover > .bloopwin, .bloop-host:focus-within > .bloopwin,
        .bloop-host.open > .bloopwin { opacity:0; pointer-events:none; }
      }
/* ================= the Performance hero, redesigned =================
         One saturated Garden card that is the landing spot: identity and the
         day's controls up top, the month on the left, the instruments on the
         right, and the weakest standard and rotating display underneath. */
/* CRT glass: scanlines, a centre bulge, corner falloff */
/* ---- the analog bulge ----
         The light on the middle of the glass was only ever a highlight painted
         over a flat card. A real tube bows the picture itself, so the filter
         below pushes every pixel outward from the centre by the square of its
         distance, and the card is overscanned a touch so the bow never drags the
         edge inward and shows the page behind it. */
.lpc-glass { position:absolute; width:0; height:0; overflow:hidden; }
/* The card is two columns: everything it says, and a rail of everything you
         press. The rail is a fixed width so the head and the body underneath it
         both end at the same place, and the store's name gets the head to itself
         again. */
/* The tube stacks, like the card it replaced: wrapping the hero's children
         in it swallowed the 18px the hero used to put between the head and the
         body, and only the dashboard wants two columns. */
/* ---- the card's two columns ----
         A grid, not nested flex. Flex sizes a row's height from its items and an
         item's height from the row, and with the rail's own column in the middle
         of that the whole card resolved to one line tall. A grid track sizes to
         its content and asks nothing back. */
/* A filter makes its element a containing block, so anything inside that
         was fixed to the viewport is now fixed to the tube. Nothing in here is,
         but the popups are worth saying out loud: they are absolutely positioned
         against their own host, which still works, and they bow with everything
         else, which is the point. */
/* ---- the channel switch, on the Z axis ----
         The picture falls back into the tube, tips, and is thrown forward again,
         rather than only squashing in place. The card needs a perspective to
         fall into, which is on .hero, and the numbers change while it is dark so
         they are never seen crossing over. */
.hero { perspective:900px; }
@keyframes s2crt {
        0% { transform:none; filter:none; }
        10% { transform:translateZ(-70px) scaleY(.93); filter:brightness(1.7) saturate(1.5); }
        19% { transform:translateZ(-300px) scaleY(.05) rotateX(9deg); filter:brightness(3.4); }
        26% { transform:translateZ(-340px) scaleY(.03) rotateX(12deg); filter:brightness(2.6); }
        38% { transform:translateZ(70px) scaleY(1.08) rotateX(-5deg); filter:brightness(1.6) hue-rotate(10deg); }
        50% { transform:translateZ(-22px) scaleY(.985) rotateX(2deg); filter:brightness(1.2); }
        64% { transform:translateZ(8px) scaleY(1.004); filter:none; }
        100% { transform:none; filter:none; }
      }
/* The static does not fade off in a line, it crackles: every step is a
         different amount and a different offset, which is what stops it reading
         as a fade and starts it reading as interference. */
@keyframes s2noise {
        0%,100% { opacity:0; background-position:0 0, 0 0, 0 0; }
        8%  { opacity:.72; background-position:0 2px, 7px 0, 0 3px; }
        16% { opacity:.36; background-position:0 8px, 2px 0, 0 1px; }
        24% { opacity:1;   background-position:0 13px, 13px 0, 0 8px; }
        34% { opacity:.52; background-position:0 5px, 5px 0, 0 4px; }
        46% { opacity:.78; background-position:0 16px, 9px 0, 0 11px; }
        58% { opacity:.3;  background-position:0 9px, 3px 0, 0 6px; }
        72% { opacity:.12; background-position:0 18px, 6px 0, 0 2px; }
      }
/* ---- the rest of the sizzle ----
         A hot bar sweeping down as the tube re-locks, and the picture's colour
         coming apart into a red and a cyan before it settles. Both are clipped to
         the card, which the card itself is not: it lets its popups escape. */
.s2-rgb > i.r { background:#D8483C; }
.s2-rgb > i.c { background:#2FBFD0; }
@keyframes s2sweep {
        0% { opacity:0; transform:translateY(-140%); }
        26% { opacity:.95; }
        100% { opacity:0; transform:translateY(500%); }
      }
.s2-hero.s2-chswitch .s2-rgb > i.r { animation:s2splitR .80s linear; }
.s2-hero.s2-chswitch .s2-rgb > i.c { animation:s2splitC .80s linear; }
@keyframes s2split { 0%,100% { opacity:0; } 12% { opacity:.16; } 30% { opacity:.26; }
        55% { opacity:.11; } 80% { opacity:0; } }
@keyframes s2splitR { 0%,100% { transform:none; } 14% { transform:translateX(-7px); }
        34% { transform:translateX(11px); } 58% { transform:translateX(-4px); } }
@keyframes s2splitC { 0%,100% { transform:none; } 14% { transform:translateX(7px); }
        34% { transform:translateX(-11px); } 58% { transform:translateX(4px); } }
/* Two rows, both hard right: what you press, then what you read. In one
         row the calendar's three stacked lines set the height of the whole row
         and its last line dropped through the rule underneath it. */
/* On the dashboard the controls live in the card's own right-hand rail.
         Every other hero carries them in the head, and they belong on the same
         side there: hard right, one width, so they read as one column. */
/* what you read sits at the foot of the rail, so the two pressable things
         stay together at the top where the eye lands */
/* Finite, like the dots beside it: this button sits inside the .s2-tube's
         displacement filter, and anything that moves in there makes the browser
         re-run the filter over the whole hero every frame. Eight flashes to catch
         the eye, on a layer that fades, then the hero holds still. */
.s2-imp.done::after { display:none; }
.s2-imp.done { animation:none; }
.s2-imp.done .s2-imp-ico { background:#BFE6CE; color:#14683B; }
@keyframes s2flashOp { 0%,100% { opacity:0; } 50% { opacity:1; } }
.s2-names s.off { color:var(--ink-3); }
.s2-pdot.off { background:var(--ink-3); }
/* Dots, with room between them: at three and a half pixels apart they read
         as a texture rather than as days you could pick one out of. */
.s2-mc-grid i.p { background:rgba(255,255,255,.75); }
.s2-mc-grid i.t { background:var(--sandTick); box-shadow:0 0 8px var(--sandTick); transform:scale(1.25); }
.s2-mc-grid i.e { background:transparent; pointer-events:none; }
.s2-split .nw { background:#E8C87E; }
.s2-split .us { background:#9ECFAB; }
.s2-sw-grid > span.e { background:transparent; pointer-events:none; }
.s2-sw-grid > span.f { opacity:.35; pointer-events:none; }
.s2-sw-grid > span.sel { outline:2px solid var(--p3); outline-offset:1px; }
/* one sentence that wraps like a sentence, not a row of flex items each
         breaking on its own */
@keyframes s2vpulseOp { 0%,100% { opacity:0; } 30% { opacity:.6; } }
.s2-fchip.ok.on { background:#BFE6CE; color:#14683B; }
.s2-fchip.bad.on { background:#F9D2CB; color:#8E2517; }
.s2-fchip.dim.on { background:rgba(255,255,255,.85); color:var(--ink); }
@keyframes s2barup { from { transform:scaleY(0); } to { transform:scaleY(1); } }
.s2-hd.up { color:#7FE3AC; }
.s2-hd.dn { color:#FFB3A6; }
@keyframes s2dialrev { from { stroke-dasharray:0 100; } }
/* weakest standard and the rotating display, side by side */
/* The cards under the hero are positioned, so without a z-index of their own
         they paint over anything the hero pops downward. The order is set here
         once: the hero's instruments, then the weakest standard, then the
         rotating display, each above the one that follows it. */
.s2-slide.on { opacity:1; transform:none; pointer-events:auto; }
.s2-slide .card { border:0; box-shadow:none; padding:0; margin:0; background:none; }
.s2-dots i.on { background:var(--sandInk); }
@keyframes s2blink { to { visibility:hidden; } }
/* held: the light stops blinking and goes green, so it is obvious the
         display is waiting rather than broken */
.s2-rtag.held { color:var(--p2d); }
.s2-rtag.held::before { background:var(--p2); animation:none; }
.s2-ptag.now { background:var(--redbg, #FBE3E1); color:#A32517; }
.s2-ptag.soon { background:rgba(16,32,52,.06); color:var(--ink-2); }
/* ================= Daily Activity, redesigned =================
         The check-out sheet in the Garden language: the same hero identity card,
         the day's vitals as tiles on the green, the Biggest Loser podium in the
         shame colours, and the sheet itself split across three warm-headed
         shelves: on today, scheduled off but in anyway, and off. */
.da-chip.up { color:#1E8A4C; background:rgba(30,138,76,.12); }
.da-chip.dn { color:#C2361F; background:rgba(194,54,31,.1); }
/* the Biggest Loser podium wears the shame colours, not the trophy ones */
.da-pod.first { flex:1.35; background:linear-gradient(115deg,#F9DFD9,#FDF6F4 70%); border-color:rgba(163,37,23,.4); }
.da-medal.mx { background:rgba(16,32,52,.14); color:var(--ink-2); }
.da-pod.first .da-pname { font-size:13px; white-space:normal; }
.da-askbtn.on { background:rgba(30,138,76,.12); color:#1E8A4C; }
/* the sheet: one warm-headed card per shelf */
/* The cells take the width between them rather than crowding the left of
         a wide screen and leaving a hole in the middle. */
.da-qual.yes { background:rgba(30,138,76,.1); color:#1E8A4C; border-color:rgba(30,138,76,.4); }
.da-ptb.off { background:rgba(16,32,52,.05); color:var(--ink-3); width:auto; padding:7px 12px; }
/* putting somebody back on should be the loudest thing on the shelf */
/* the leaderboard modal: out of focus behind, not dark */
/* phone: identity and points on the first line, the sheet cells below */
@media (max-width:640px) {
        .da-offrow .da-ptb.off { display:none; }
      }
/* ================= the Summary, redesigned =================
         The same hero identity card, the month's verdict as tiles on the green,
         the three channels as panels with their recent months behind them, and
         the month-over-month table under a warm header. The printed page keeps
         its plain title instead of the hero. */
.sm-mval.dim { color:var(--ink-3); font-weight:500; }
.da-chip.dim { color:var(--ink-3); background:rgba(16,32,52,.06); }
.sm-page .card.gm-card { margin-top:14px; }
@media (max-width:760px) {
        /* the daily sheet's two-line wrap does not apply to the measure rows */
      }
/* ================= Performance page, draft alignment =================
         The round-up door, the three-channel chart in the spotlight, and the
         associate rows in the drafts' language. */
/* the delivery chart: three channel lines drawing themselves each rotation */
@keyframes s2draw { to { stroke-dashoffset:0; } }
/* Every instrument on the row sits on the same three rows: the figure, the
         instrument, the label. A dial has its figure inside it and leaves the
         first row empty, which is what puts APPT VIDEO level with INTERNET. */
/* channels, then a rule, then the standards */
/* The captions hang above the first row's instruments, so that row needs
         the room. Without it they climbed into the section header. */
.s2-rolecard .assoc-card.is-first .assoc-row { padding-top:24px; }
/* the channel cell: a column in that channel's own colour, drawn against
         the standard as a rule across it. Above the rule is above standard, and
         the rule is at the same height in all three so they read as one line. */
/* square across the top so the fill reads as a level in a vessel rather
         than a pill floating in one */
.s2g4-col.full i { border-radius:5px; }
/* the standard, dashed, the way the hero draws the cap on its own channel
         bars, so it reads as the mark to reach and not the rim of the vessel */
.s2g4-col.over s { opacity:.7; }
/* verdict pill: one width, never resized by its words */
.vpill.std { background:linear-gradient(90deg,#128A47,#22A85E); color:#fff;
        box-shadow:0 4px 12px -5px rgba(18,138,71,.6); }
.vpill.limit { background:rgba(201,138,0,.16); color:#95600A; box-shadow:0 4px 12px -6px rgba(176,119,0,.5); }
.vpill.stop { background:rgba(194,54,31,.14); color:#C13529; }
.vpill.room { background:color-mix(in srgb, var(--p2) 12%, transparent); color:#1D4674; }
.vpill.off { background:rgba(16,32,52,.08); color:var(--ink-2); }
.vpill.dim { background:#F2F2F4; color:var(--ink-2); }
.assoc-sub.waiting { color:var(--amber); }
/* Every pill in the hero head is one height, whatever it holds. This used
         to say .s2-chips > *, which was the pills themselves; they are now in two
         rows, and the rule was forcing both ROWS to 38px, so the calendar's three
         stacked lines overflowed straight through the rule beneath the head. */
/* in a fixed rail the text has to give, not the arrow at the end of it */
/* the goal, asked for where it is read */
/* ---- the board, in the drafts' language ----
         one warm-headed card per position, the bucket chips in the header, and
         the podium in the trophy colours. */
.s2-rolecard .assoc-card:last-child .assoc-row { border-radius:0 0 13px 13px; }
.s2-rolecard .assoc-card { position:relative; border:0; border-radius:0; box-shadow:none; margin:0; padding:0;
        background:none; }
/* The rule between two people picks up where the row's colour wash leaves
         off: nothing at the left edge, where the wash is strongest, and full
         grey by the point the wash has run out. */
.s2-rolecard .assoc-card::before { content:""; position:absolute; left:0; right:0; top:0; height:1px;
        pointer-events:none;
        background:linear-gradient(90deg, transparent 0, color-mix(in srgb, var(--line) 45%, transparent) 26%, var(--line) 55%); }
.s2-rolecard .assoc-card.is-first::before { display:none; }
.warmhead .s2-fchip.cleared { background:rgba(30,138,76,.12); color:#1E7A3C; }
.warmhead .s2-fchip.attention { background:rgba(201,138,0,.16); color:#8A5A10; }
.warmhead .s2-fchip.on { outline:2px solid currentColor; outline-offset:1px; }
/* the quiet strip under a row: the action, not a restatement */
/* the confirm, in the row rather than under it */
/* One glyph, not a sentence. The verdict pill beside it already says
         "Restrict leads"; spelling the action out again made the row's right
         side read twice and, on a tight desk, run past the card edge -- every
         child of this row is fixed-width on purpose, so the only honest fix is
         an action that takes no width worth arguing over. The words live in the
         tooltip and the aria label, and the form that opens says the rest. */
/* the re-evaluate form sits under the X that opened it, not across the room */
.s2-rowbtn.stop { border-color:rgba(194,54,31,.35); color:#C13529; }
.s2-rowbtn.go { border-color:rgba(30,138,76,.4); color:#1E7A3C; margin-left:auto; }
/* ---- the associate card ----
         fixed to the viewport so it opens where you are looking, out of focus
         behind rather than dark, growing from the row that was clicked */
@keyframes acpop { from { transform:scale(.35); opacity:0; } }
.acard.closing { animation:acout .24s cubic-bezier(.5,0,.75,.4) both; }
@keyframes acout { to { transform:scale(.35); opacity:0; } }
/* Five dials, sometimes six when a tier grades something outside them, in a
         card 340px wide: they wrap rather than run off the edge. */
/* ---- the floor tools' hero ----
         the Garden card, tinted with each tool's own accent so Live Floor, The
         Line and Online are told apart the moment they open */
.fh-name.empty { color:rgba(255,255,255,.6); font-size:20px; }
.fh-stack i.more { background:rgba(255,255,255,.28); }
/* the queue itself, as a warm-headed table rather than a stack of cards */
.mf .q-line.qtbl { background:var(--card); border:1px solid var(--line); border-radius:14px;
        overflow:hidden; padding:0; gap:0; display:block; }
.mf .q-line.qtbl .warmhead { border-radius:13px 13px 0 0; }
.mf .q-line.qtbl .q-row { border:0; border-top:1px solid var(--line); border-radius:0;
        box-shadow:none; margin:0; background:none; padding:9px 16px; }
.mf .q-line.qtbl .q-row:hover { background:color-mix(in srgb, var(--p2) 7%, transparent); }
.mf .q-line.qtbl .q-empty { padding:14px 16px; margin:0; }
/* ---- plates ----
         a steel hero, and every tag drawn as the plate it is */
/* a plate that never came back is the loudest thing on the page */
.plates .plate-missing-banner { border:0; color:#fff; border-radius:16px; padding:14px 18px;
        background:linear-gradient(150deg,#D14434,#A32517); box-shadow:0 16px 38px -18px rgba(163,37,23,.6); }
.plates .plate-missing-banner > b { color:#fff; }
.plates .plate-missing-banner, .plates .plate-missing-banner * { color:#fff; }
.plates .plate-missing-banner .platechip { color:#2A3540; }
.plates .plate-missing-banner .btn.secondary { color:#A32517; }
.plates .plate-missing-banner .btn.secondary { background:#fff; color:#A32517; border:0; }
.plates .plate-missing-banner .btn-quiet { color:rgba(255,255,255,.85); }
.plates .plate-missing-row { gap:10px; }
/* ---- imports ----
         the dropzone as a landing pad, and the flag as a card that reads like a
         note rather than a browser warning */
.import .dropzone, .imports .dropzone { border:2px dashed color-mix(in srgb, var(--p2) 50%, transparent);
        border-radius:18px; background:color-mix(in srgb, var(--p2) 6%, #fff);
        transition:transform .18s ease, background .18s ease; }
.import .dropzone:hover, .imports .dropzone:hover { transform:translateY(-2px);
        background:color-mix(in srgb, var(--p2) 10%, #fff); }
.import .dropzone.active, .imports .dropzone.active { border-style:solid;
        background:color-mix(in srgb, var(--p2) 14%, #fff); }
.import .dz-icon, .imports .dz-icon { color:var(--p2); }
/* a tool panel that opens over the page rather than pushing the queue down */
/* with the banner pill gone the tool's utilities sit to the right, so the
         hero is the first thing the page says */
.mf .q-topline-actions { margin-left:auto; }
/* the queue row, closer to the drafts: the state and the wait read as one
         quiet line under the name, and what they have already had today rides
         beside it as a fixed-width chip */
.mf .q-line.qtbl .q-meta { display:flex; align-items:center; gap:5px; font-size:9.5px; color:var(--ink-3); }
.mf .q-line.qtbl .q-state { font-weight:600; color:var(--facc, var(--p2)); }
.mf .q-line.qtbl .q-state.q-customer, .mf .q-line.qtbl .q-state.q-lunch,
      .mf .q-line.qtbl .q-state.q-away { color:var(--ink-2); }
.q-ups.none { opacity:.45; }
/* coverage by hour: one block an hour, read left to right */
.cov-tag.gap { background:rgba(194,54,31,.12); color:#C13529; }
.cov-tag.ok { background:rgba(30,138,76,.12); color:#1E7A3C; }
/* the desk asking for you, on your own screen */
.sf-nudge { display:flex; align-items:center; justify-content:center; gap:8px; margin:10px 14px 0;
        padding:10px 14px; border-radius:12px; font:700 12px var(--font-display); color:#4A3300;
        background:linear-gradient(140deg,#F2C14E,#E0A62B); box-shadow:0 6px 16px -8px rgba(224,166,43,.8);
        animation:sfNudge 1.6s ease-in-out infinite; }
@keyframes sfNudge { 0%,100% { transform:none; } 50% { transform:translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { .sf-nudge { animation:none; } }
/* Your day at the station. Quiet on purpose: it is a record to check,
         not a thing to act on, and the screen above it is where the acting
         happens. The open sit is the one somebody is looking for, so it is
         the only row that carries the accent. */
.sf-stnday { margin:14px 14px 0; padding:12px 13px; border-radius:14px;
        background:rgba(255,255,255,.045); border:1px solid rgba(255,255,255,.08); }
.sf-stnday-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px;
        font-family:var(--sfmono); font-size:10.5px; letter-spacing:.09em; text-transform:uppercase;
        color:rgba(237,242,234,.45); margin-bottom:9px; }
.sf-stnday-head b { font-size:13px; letter-spacing:0; text-transform:none; color:rgba(237,242,234,.85); }
.sf-stnday-row { display:grid; grid-template-columns:22px 1fr auto auto; gap:9px; align-items:baseline;
        padding:5px 0; border-top:1px solid rgba(255,255,255,.05); font-size:12.5px; color:rgba(237,242,234,.62); }
.sf-stnday-row:first-of-type { border-top:0; }
.sf-stnday-st { font-family:var(--sfmono); font-size:11px; color:rgba(237,242,234,.4);
        text-align:center; border-radius:5px; background:rgba(255,255,255,.06); }
.sf-stnday-time { font-variant-numeric:tabular-nums; }
.sf-stnday-min { font-family:var(--sfmono); font-size:11.5px; color:rgba(237,242,234,.8);
        font-variant-numeric:tabular-nums; }
.sf-stnday-why { font-family:var(--sfmono); font-size:10.5px; color:rgba(237,242,234,.34); }
.sf-stnday-row.on .sf-stnday-st { background:rgba(140,170,255,.22); color:#cfe0ff; }
/* What arrived while they were in the chair, on its own line under the
         times so a phone row does not become four numbers wide. */
.sf-stnday-got { grid-column:2 / -1; font-family:var(--sfmono); font-size:11px;
        color:rgba(190,215,255,.72); letter-spacing:.01em; margin-top:2px; }
.sf-stnday-note { margin:9px 0 0; font-size:10.5px; line-height:1.5;
        font-family:var(--sfmono); color:rgba(237,242,234,.34); }
/* The phone room, on their own phone: the desks as a row, the cord, the
         desk number, the floor's timers and the flat tiles. */
.sfl-top { width:min(430px,100%); margin:0 auto; display:flex; flex-direction:column;
        align-items:center; padding:0 0 18px; }
.sfd-row { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:6px;
        align-self:stretch; margin-top:4px; }
.sfd { display:flex; flex-direction:column; align-items:center; gap:1px; padding:7px 2px 6px;
        border-radius:10px; background:rgba(255,255,255,.09); border:1px solid transparent;
        transition:background .45s, box-shadow .45s, transform .45s cubic-bezier(.3,1.6,.4,1); }
.sfd b { font-family:var(--sfmono); font-size:14px; font-weight:600; color:rgba(237,242,234,.62); }
.sfd em { font-style:normal; font-family:var(--sfmono); font-size:10.5px; color:rgba(237,242,234,.42);
        max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sfd.open, .sfd.free { background:var(--led); box-shadow:0 0 14px var(--led); }
.sfd.open { animation:sfdBeckon 1.1s ease-in-out infinite; }
.sfd.you { background:#fff; box-shadow:0 0 14px rgba(255,255,255,.6); }
.sfd.open b, .sfd.free b, .sfd.you b, .sfd.open em, .sfd.free em, .sfd.you em { color:#0B1430; }
.sfd.open em, .sfd.free em, .sfd.you em { opacity:.7; }
@keyframes sfdBeckon { 50% { transform:translateY(-3px); box-shadow:0 0 22px var(--led); } }
.sfl-hero { position:relative; align-self:stretch; height:232px; margin-top:6px; }
.sfl-stage { position:absolute; inset:0;
        transition:opacity .45s cubic-bezier(.2,.8,.2,1), transform .45s cubic-bezier(.2,.8,.2,1); }
.sfl-stage.off { opacity:0; transform:scale(.96); pointer-events:none; }
.sfl-stage.drop { opacity:0; transform:translateY(26px) scale(.94); transition-duration:.32s; pointer-events:none; }
/* the cord is drawn at one size and scaled on a narrow phone, so the
         motion path and the picture never disagree */
.sfc { position:absolute; left:50%; top:0; width:350px; height:232px; margin-left:-175px; transform-origin:50% 0; }
@media (max-width:400px) { .sfc { transform:scale(.9); } }
.sfc > svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
.sfc-cord { fill:none; stroke:rgba(157,195,255,.24); stroke-width:3; stroke-linecap:round; }
/* the glow is a wider, fainter stroke underneath rather than a filter:
         WebKit does not repaint a filtered stroke while it moves */
.sfc-lit, .sfc-glo { fill:none; stroke:var(--led); stroke-width:3; stroke-linecap:round;
        stroke-dasharray:100 100; stroke-dashoffset:100; }
.sfc-glo { stroke-width:9; opacity:.28; }
.sfc.landed .sfc-lit, .sfc.landed .sfc-glo { stroke-dasharray:none; stroke-dashoffset:0; }
.sfc-you, .sfc-oth { position:absolute; left:0; top:0;
        offset-path:path("M 26 150 C 96 232, 190 40, 292 112"); offset-rotate:0deg; }
.sfc-you { width:46px; height:46px; border-radius:50%; display:grid; place-items:center;
        background:linear-gradient(160deg, var(--a1), var(--a2)); box-shadow:0 0 22px var(--glow); z-index:3;
        transition:offset-distance .9s cubic-bezier(.2,.8,.2,1); }
.sfc-you .dm { --cell:5px; --led:#fff; perspective:none; }
.sfc-oth { width:30px; height:30px; border-radius:50%; background:#E4C98D; color:#1F2A22;
        display:grid; place-items:center; font-family:var(--sfmono); font-size:9.5px; font-weight:700; z-index:2;
        box-shadow:0 0 12px rgba(228,201,141,.35);
        transition:offset-distance .9s cubic-bezier(.2,.8,.2,1), opacity .4s, transform .4s; }
.sfc-oth.gone { opacity:0; transform:scale(.5); }
/* the handset at the end of the cord, its antenna standing on the top
         right dot, dark until the desk is yours */
.sfc-desk { position:absolute; right:0; top:50%; transform:translateY(-50%);
        display:flex; flex-direction:column; align-items:center; z-index:2; }
.sfc-ant { width:2px; height:26px; border-radius:2px 2px 0 0; background:rgba(157,195,255,.12);
        transform:translateX(8.8px); margin-bottom:-1px; transition:background .4s, box-shadow .4s; }
.sfc-face { position:relative; width:44px; height:44px; display:grid; place-items:center;
        color:rgba(157,195,255,.28); transition:color .45s, filter .45s; }
.sfc-desk.lit .sfc-face { color:var(--led); filter:drop-shadow(0 0 8px var(--led)); }
.sfc-desk.lit .sfc-ant { background:var(--led); box-shadow:0 0 10px var(--led); }
.sfc-shock { position:absolute; left:50%; top:52%; width:120px; height:120px;
        transform:translate(-50%,-50%) scale(.3); border-radius:50%; border:2px solid rgba(255,255,255,.55);
        opacity:0; pointer-events:none; }
.sfc-desk.lit .sfc-shock { animation:sfcShock 1.6s ease-out 2; }
.sfc-desk.lit .sfc-shock.d2 { animation-delay:.5s; border-color:rgba(255,255,255,.35); }
@keyframes sfcShock { 0% { transform:translate(-50%,-50%) scale(.35); opacity:.8; }
        100% { transform:translate(-50%,-50%) scale(2.2); opacity:0; } }
/* the desk number, fallen out of the row above */
.sfl-num { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
        justify-content:center; gap:10px; }
.sfl-cap { font-family:var(--sfmono); font-size:10px; font-weight:600; letter-spacing:.24em; color:var(--led); }
.sfl-big .dm { --cell:22px; perspective:none; }
.sfl-big .dm-digit { animation:none; gap:8px; }
.sfl-big .ld.on { box-shadow:0 0 16px var(--led), 0 0 40px var(--glow);
        animation:sflSettle .7s cubic-bezier(.2,.8,.2,1) both; }
.sfl-big .ld:nth-child(n+4) { animation-delay:.07s; }
.sfl-big .ld:nth-child(n+7) { animation-delay:.14s; }
.sfl-big .ld:nth-child(n+10) { animation-delay:.21s; }
.sfl-big .ld:nth-child(n+13) { animation-delay:.28s; }
@keyframes sflSettle { from { opacity:0; transform:translateY(-70px) scale(.3); } to { opacity:1; transform:none; } }
.sfl-tmr { margin-top:6px; }
.sfl-title { font-family:var(--font-display); font-size:27px; font-weight:700; letter-spacing:-.02em;
        color:#fff; text-align:center; margin-top:10px; }
.sft-row { display:flex; gap:6px; }
.sft { flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:center; gap:5px;
        padding:12px 0 10px; border:1px solid transparent; border-radius:10px; background:rgba(255,255,255,.09);
        color:var(--sfink2); font-size:13.5px; font-weight:600; cursor:pointer;
        transition:background .3s, color .3s, box-shadow .3s, transform .28s cubic-bezier(.3,1.3,.4,1); }
.sft:disabled { opacity:.6; }
.sft.on { background:#fff; color:#0B1430; box-shadow:0 0 14px rgba(255,255,255,.35); }
.sft .sf-ico { color:currentColor; filter:none; }
@media (prefers-reduced-motion: reduce) {
        .sfc-lit, .sfc-you, .sfc-oth, .sfl-stage, .sfc-ant, .sfc-face, .sfc-shock, .sfl-big .ld, .sfd { animation:none !important; transition:none !important; } }
.sf-stnday-row.on .sf-stnday-why { color:#cfe0ff; }
/* ---- plates + smart assign, in the new card language ----
         the tables keep their markup; what changes is the shell around them,
         the head row, and the row rhythm, so they read like every other list */
.plates .card { border:1px solid var(--line); border-radius:14px; box-shadow:none;
        background:var(--card); }
.plates .card > h3 { display:flex; align-items:center; gap:9px; margin:-16px -16px 12px;
        padding:12px 16px; border-bottom:1px solid var(--line); border-radius:13px 13px 0 0;
        background:linear-gradient(90deg, var(--sandHead), rgba(246,227,195,0) 72%);
        font-family:var(--font-display); font-weight:700; font-size:14.5px; }
.plates .roster-table th { font:700 8.5px var(--font-mono); letter-spacing:.1em;
        text-transform:uppercase; color:var(--ink-3); border-bottom:1px solid var(--line); }
.plates .roster-table td { border-bottom:1px solid var(--line); font-size:12.5px; }
.plates .roster-table tr:last-child td { border-bottom:0; }
.plates .roster-table tbody tr:hover { background:color-mix(in srgb, var(--p2) 6%, transparent); }
.plates .plate-state-out { color:#C13529; font:700 10px var(--font-mono); }
.plates .plate-state-in { color:#1E7A3C; font:700 10px var(--font-mono); }
/* smart assign wears the same card and warm head as the queue beside it */
.mf .sa-card { background:var(--card); border:1px solid var(--line);
        border-radius:14px; overflow:hidden; }
.mf .sa-head { display:flex; align-items:center; gap:9px; padding:12px 16px;
        border-bottom:1px solid var(--line);
        background:linear-gradient(90deg, var(--sandHead), rgba(246,227,195,0) 72%);
        font-family:var(--font-display); font-weight:700; font-size:14.5px; }
.mf .sa-card .sa-sub, .mf .sa-card .sa-input, .mf .sa-card .sa-chips,
      .mf .sa-card .sa-list { margin-left:16px; margin-right:16px; }
.mf .sa-card .sa-list { margin-bottom:14px; }
/* opportunities: what is still open, and saying what happened to one */
.q-open.none { background:rgba(16,32,52,.06); color:var(--ink-2); }
/* ---- signing up: which of the two you are ----
         Off this screen's own palette rather than the dashboard's: the same ink
         as the sign-in pill when one is chosen, the same line as the fields when
         it is not, and the same radius as the button underneath. The choice does
         not carry its own explanation - the line below it does, and it changes
         with the choice, so the pills stay the width of their words. */
.lf-kinds { display:flex; gap:9px; margin:8px 0 2px; }
.lf-kind { flex:1; min-width:0; cursor:pointer; font:inherit; font-size:14px; font-weight:600;
        padding:11px 14px; border-radius:999px; border:1.5px solid #C9CBC9;
        background:none; color:#2E3A32;
        transition: background .2s var(--ease), border-color .2s var(--ease),
                    color .2s var(--ease), box-shadow .2s var(--ease), transform .2s var(--ease); }
.lf-kind:hover:not(.on) { border-color:#2E3A32; }
.lf-kind.on { background:#2E3A32; border-color:#2E3A32; color:#F1F2EE;
        box-shadow:0 6px 18px rgba(46,58,50,0.18); }
.lf-kindnote { font-size:13px; line-height:1.5; color:#6E6E76; margin:10px 0 0; text-align:left; }
.lf-acctid { font-size:12px; color:#8A8A90; margin-top:14px; }
.lf-acctid b { font-weight:600; color:#6E6E76; }
/* ---- imports, in the new card language ----
         a hero that says what this page is doing, the checklist and the history
         as warm-headed cards, and the dropzone as the landing pad between them */
/* The checklist is a list of short lines and the landing pad wants room to
         be landed on, but 300px was tight enough that "Delivery Summary" broke
         over two lines while the pad had space to spare. */
.import { gap:12px; }
.import .import-grid { align-items:stretch; grid-template-columns:1fr 1fr; gap:10px; }
.import .import-grid .imp-card { padding:0; }
.import .dropzone { min-height:0; }
@media (max-width:900px) { .import .import-grid { grid-template-columns:1fr; } }
/* the landing pad, full width and first: the only thing on the page
         anybody came here to use */
.import .dz2 { display:flex; flex-direction:column; align-items:center; gap:9px; text-align:center;
        padding:30px 24px; margin:0; min-height:0; max-width:none; }
.import .dz2 .dz2-t { font:700 15px var(--font-display); color:var(--ink); }
.import .dz2 .dz2-s { font-size:10.5px; color:var(--ink-2); max-width:380px; line-height:1.5; }
/* the two lists under it, in the drafts' plainer panel rather than a warm
         head: they are a checklist and a log, not a table of people */
.imp-panel .p-cap { display:flex; align-items:center; gap:7px; margin-bottom:6px;
        font:700 9px var(--font-mono); letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); }
.imp-row .ck { width:20px; height:20px; border-radius:7px; border:1.5px solid var(--line); flex:0 0 auto;
        display:flex; align-items:center; justify-content:center; color:#1E8A4C; }
.imp-row.done .ck { background:rgba(30,138,76,.12); border-color:#1E8A4C; }
.imp-row .when { margin-left:auto; font:600 9.5px var(--font-mono); color:var(--ink-3); flex:0 0 auto; }
.imp-chip.on { background:var(--p2); border-color:var(--p2); color:#fff; }
.up-hist .p-cap { margin-top:14px; }
@media (max-width:900px) { .import .import-grid { grid-template-columns:1fr; } }
/* on a phone the row runs out of width long before it runs out of things
         to say, so the timestamp drops to its own line under the name */
@media (max-width:640px) {
        .imp-row .when { margin-left:0; width:100%; padding-left:30px; }
        .up-hist .imp-row .when { width:auto; padding-left:0; margin-left:30px; }
      }
/* ---- History, in the new language ----
         The page is the five figures, month by month. The hero says where the
         store is, and every row says where one person is against the same five,
         with the last eight months as the hero card's own bars, smaller. */
.hist-move.up { color:#1E8A4C; }
.hist-move.down { color:#C2361F; }
.hist-move.flat { color:var(--ink-3); }
.hist-b.now i { background:var(--hc); }
/* the dashed cap, where the hero card puts it: the target, at 100% of a
         bar that runs to 120% */
/* the store list wears the same colour the store wears everywhere else */
/* the one filled button a panel gets, in the palette the rest of the app uses */
/* ---- Access, as rows rather than a table ---- */
.ac-store.on { border-color:var(--sp); color:var(--ink); }
.ac-store.on i { background:var(--sp); }
/* ---- tickets, in the console's language ---- */
.tk-count .hint { margin:2px 0 0; }
.tk-cnum.ok { color:#1E8A4C; }
.tk-cnum.r { color:#C2361F; }
/* ---- the audit log, as the same dense row as everywhere else ---- */
.tg-sub.on { background:var(--p2); border-color:var(--p2); color:#fff; }
/* ---- the group, one card per store, each in its own colours ---- */
/* ---- Coaching, in the new language ----
         The ceiling in the hero, and every row showing where somebody stands
         against it without having to be opened. */
/* ---- The Board picker, in the new language ----
         Each store in its own colours, with opening it, the TV link and
         publishing on the tile they belong to. */
/* one store: the same tile, wider, because there is nothing to choose between */
/* ---- Targets, in the new language ---- */
.tg-chip.ok { background:rgba(30,138,76,.12); color:#1E8A4C; }
.p-cap2 { display:flex; align-items:center; gap:8px; font:700 9px var(--font-mono);
        letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); margin-bottom:8px; }
.p-cap2 .tg-chip { text-transform:none; letter-spacing:0; }
.r-flex2 { flex:1; }
.targets .grace-label input { width:64px; border:1px solid var(--line); border-radius:9px;
        padding:6px 8px; font:600 12px var(--font-mono); color:var(--ink); background:var(--card); }
/* ---- People, in the new language ---- */
/* the standing options, opened under the person they belong to */
.toolsheet.wide { width:min(520px, 100%); }
.s2-pod.first { flex:1.35; background:linear-gradient(115deg,#F7E8C6,#FDFAF2 70%); border-color:#E4C98D;
        box-shadow:0 10px 26px -14px rgba(201,151,0,.55); }
.s2-pod.first .s2-podname { font-size:13px; }
/* ---- the Board on a phone ----
   The site's hero, phone-sized, then one row a person. Shares the pop and
   the row pieces with the room (.fr-*). ---- */
.bp-hero{ isolation:isolate; border-radius:24px; padding:20px 18px 20px; color:#fff; position:relative; overflow:hidden;
  background:linear-gradient(150deg,#7FA98A,#55795F 55%,#26382C); box-shadow:0 14px 30px -14px rgba(38,56,44,.5); }
.bp-hero::after{ content:""; position:absolute; inset:0; background:repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 1px,transparent 1px 3px); pointer-events:none; }
@keyframes bpBlink{ 0%,100%{ opacity:1; } 50%{ opacity:.25; } }
@keyframes bpSheen{ 0%{ bottom:-40%; } 100%{ bottom:100%; } }
@keyframes bpSheenDn{ 0%{ bottom:100%; } 100%{ bottom:-40%; } }
/* the standings */
.bp-stand{ background:#fff; border:1px solid var(--frline); border-radius:20px; margin-top:12px; overflow:hidden; box-shadow:0 8px 24px rgba(31,54,86,.06); }
.bp-filt button.on{ background:var(--frp2d); border-color:var(--frp2d); color:#fff; }
.bp-fivehead .pix{ color:var(--frink3); justify-self:center; }
/* the pops' own pieces */
/* the website's person card: room to breathe, and the desk's actions under it */
/* ---- the room on a phone: Live Floor, manager side ----
   One screen: plan, the line as the salesperson's rail, coverage. Every tap
   answers in a pop in the centre. The garden palette and the pix glyphs, and
   nothing else. ---- */
/* ---- Check Out on a phone ---- */
.co-day .pix{ color:var(--frsand); }
.co-ucap .pix{ color:var(--frsand); }
.co-dlt.up{ color:#8fd8af; }
.co-dlt.dn{ color:#F08A80; }
.co-tools{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:12px; }
.co-tools .fr-tool{ min-height:58px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; text-align:center !important; }
/* the three groups */
.co-grp{ margin-top:12px; border-radius:20px; overflow:hidden; }
.co-grp.co-gon{ background:#fff; border:1px solid var(--frline); box-shadow:0 8px 24px rgba(31,54,86,.06); }
.co-grp.co-gany{ background:#FFF6E3; border:1.5px solid var(--frsand); }
.co-grp.co-goff{ background:#2E4A38; color:#fff; padding:10px 14px 12px; }
.co-gh .pix{ color:var(--frp2d); }
.co-grp.co-gany .co-gh .pix{ color:var(--frsand2); }
.co-grp.co-goff .co-gh{ padding:0 0 8px; color:#fff; }
.co-grp.co-goff .co-gh .pix{ color:var(--frsand); }
.co-grp.co-gany .co-gn{ color:var(--frsand2); }
.co-grp.co-goff .co-gn{ color:rgba(255,255,255,.6); }
/* a row */
.co-grp.co-gany .co-row{ border-top-color:rgba(208,130,30,.25); }
.co-stk.dn{ color:var(--frgap); }
/* pops */
/* The ground is a fixed layer at z-index 0 that paints over anything not
   positioned above it, which on a phone read as the white cards being
   see-through. The phone pages sit above it. On a phone the Board's container
   also lost its phone padding to a later desktop rule, which inset it. */
.bp-page,.co-page,.fr-page{ position:relative; z-index:1; }
/* the page's button reset is more specific than the row and tile rules */
@media (max-width:700px){ .board-page{ padding:18px 0 0; } .tab-page:has(> .bp-page){ padding:10px 0 0; } }
/* ---- License Plates on a phone ---- */
.pl-mode .pix{ color:var(--frsand); }
.pl-tools .fr-tool.pri .pix{ color:#fff; }
.pl-tools .fr-tool.dk .pix{ color:var(--frsand); }
.pl-err.strip{ margin:12px 0 0; }
.pl-miss{ margin-top:12px; background:#fff; border:2px solid var(--frto, #D8483C); border-radius:18px; padding:10px 12px; box-shadow:0 0 0 5px rgba(216,72,60,.14); }
.pl-mh .pix{ color:#D8483C; }
.pl-pc.lt{ background:#fff !important; color:var(--frink2) !important; border:1.5px solid var(--frline) !important; }
.pl-pc.big{ font-size:15px !important; padding:8px 10px !important; min-width:88px; justify-content:center; }
.pl-hold .fr-av.sm{ width:34px; height:34px; font-size:11px; }
.pl-nm .fr-av.sm{ width:22px; height:22px; font-size:8px; }
.pl-since.ok{ color:var(--frok); }
/* pops */
.pl-facts b.long{ color:var(--frgap); }
.pl-ev i.in{ background:var(--frok); }
.pl-ev i.mv{ background:#2E7DE0; }
.pl-ev i.late{ background:var(--frgap); }
.pl-pk.on{ background:#15211B; border-color:#15211B; color:#fff; }
.pl-pk.new{ border-style:dashed; color:var(--frink3); }
.pl-pk.new.on{ color:#fff; border-style:solid; }
.pl-pr.on{ background:#E8F1EA; margin:0 -16px; padding:0 16px; width:calc(100% + 32px); }
.pl-pr .fr-av.sm{ width:32px; height:32px; font-size:11px; }
.pl-pr.static{ cursor:default; }
.pl-setup button.on{ border-color:var(--frp2d); background:#F3F6F2; }
.pl-add .fr-b.sm{ min-height:44px; padding:0 16px; font-size:14px; }
.pl-miss .co-say .co-on{ background:var(--frok) !important; border-color:var(--frok) !important; }
.fr-pop .pl-pr.static .co-say .co-on{ background:var(--frok); border-color:var(--frok); }
/* ---- Coaching on a phone ---- */
.cx-top .pix{ color:var(--frsand); }
.cx-tools .fr-tool.dk .pix{ color:var(--frsand); }
.cx-card .co-gh{ padding:11px 14px 6px; }
.cx-row .fr-av.sm{ width:36px; height:36px; font-size:11px; }
.cx-row.dim .cx-nm,.cx-row.dim .cx-un{ color:var(--frink3); }
.cx-pb i.ok{ background:var(--frok); }
.cx-pb i.warn{ background:var(--frthin); }
/* the sheet */
.cx-acts .fr-tool.pri .pix{ color:#fff; }
.cx-acts .fr-tool.on{ border-color:var(--frp2d); }
.cx-dots i.d{ background:var(--frok); }
.cx-pc.ok{ color:var(--frok); font-weight:700; }
.cx-pc.bad{ color:var(--frgap); font-weight:700; }
.cx-stats b.ok{ color:var(--frok); }
.cx-stats b.bad{ color:var(--frgap); }
.cx-ch.ok{ color:var(--frok); }
.cx-ch.bad{ color:var(--frgap); }
.cx-br.h{ border-top:0; padding:2px 0 4px; font:700 7.5px var(--font-mono); letter-spacing:.1em; text-transform:uppercase; color:var(--frink3); }
.cx-br.h span{ text-align:right; }
.cx-br.h span:first-child{ text-align:left; }
.cx-st2.ok{ background:#E3F3E9; color:var(--frok); }
.cx-st2.bad{ background:#FBE5E0; color:var(--frgap); }
.cx-tr i.behind{ background:var(--frgap); }
.cx-tr i.even{ background:var(--frthin); }
.cx-tr i.ahead{ background:var(--frok); }
.cx-hourly .hourly{ margin-top:4px; min-height:170px; }
.cx-hourly .hint{ font:500 11px/1.4 var(--font-ui); color:var(--frink3); margin:6px 0 0; }
/* ---- Summary on a phone ---- */
.sm-chs{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:12px; }
.sm-cv.ok{ color:var(--frok); }
.sm-cv.bad{ color:var(--frgap); }
.sm-ct b.ok{ color:var(--frok); }
.sm-ct b.bad{ color:var(--frgap); }
.sm-r3.h{ border-top:0; padding:4px 14px 6px; font:700 7.5px var(--font-mono); letter-spacing:.1em; text-transform:uppercase; color:var(--frink3); }
.sm-r3.h span{ text-align:right; }
.sm-r3.h span:first-child{ text-align:left; }
.sm-mv.dim{ color:var(--frink3); font-weight:600; }
.sm-mm.up{ background:#E3F3E9; color:var(--frok); }
.sm-mm.dn{ background:#FBE5E0; color:var(--frgap); }
.sm-p.ok{ border-color:#CFE7D6; }
.sm-p.ok em{ color:var(--frok); }
/* the desk's day-by-day chart, wearing the phone's clothes */
.sm-trend .card { background:none; border:0; box-shadow:none; padding:0; margin:0; }
.sm-trend .tr-range.on{ background:#15211B; border-color:#15211B; color:#fff; }
.sm-trend .tr-chip.on{ border-color:#2E7DE0; color:#2E7DE0; }
/* ---- History on a phone ---- */
.hs-five em.up{ color:#8fd8af; }
.hs-five em.dn{ color:#F08A80; }
/* ---- People on a phone ---- */
.pe-tools .fr-tool.pri .pix{ color:#fff; }
.pe-card{ margin-top:12px; }
.bp-page .pe-sel.on{ background:#15211B; border-color:#15211B; color:#fff; }
.bp-page .pe-ft.on{ background:var(--frp2d); border-color:var(--frp2d); color:#fff; }
.bp-page .pe-bulkb .fr-b.sm{ flex:1 1 auto; padding:0 10px; min-height:36px; }
.pe-row .fr-av.sm{ width:36px; height:36px; font-size:11px; }
.pe-tick.on{ background:var(--frp2d); border-color:var(--frp2d); }
/* the person's pop */
.pe-tiles .fr-tool.on{ border-color:var(--frp2d); background:#E8F1EA; }
.pe-selwrap.sm{ flex:1 1 100%; }
.pe-selwrap.sm select{ padding:7px 10px; font-size:12px; border-radius:10px; }
.bp-defn.pe-said.bad b{ color:var(--frgap); }
.bp-page.pe-phone .fr-b.sm{ border:1.5px solid var(--frline); }
.bp-page.pe-phone .fr-b.sm.warn{ border-color:#F1C9C5; }
/* the repair cards */
.bp-page .pe-missacts .fr-b.sm{ flex:1 1 auto; min-height:36px; }
.bp-page .pe-fixa .fr-b.sm{ min-height:32px; padding:0 10px; font-size:11.5px; }
/* folds and the log */
.pe-toggle .pix{ color:var(--frink3); }
.hs-row.empty .hs-nm,.hs-row.empty .hs-sub{ color:var(--frink3); }
.hs-c b.up{ color:var(--frok); }
.hs-c b.down{ color:var(--frgap); }
.hs-bars4 i.now{ opacity:1; }
.hs-vt span.p{ background:#E3F3E9; color:var(--frok); }
.hs-vt span.f{ background:#FBE5E0; color:var(--frgap); }
.hs-vt span.n{ background:var(--frpaper); color:var(--frink3); }
.hs-v small.up{ color:var(--frok); }
.hs-v small.down{ color:var(--frgap); }
.hs-bars i.now{ opacity:1; }
.fr-page,.fr-pop{ --frink:#15211B; --frsand:#E4C98D; --frsand2:#D0821E; --frfly:#E8A93C; --frto:#D8483C; --frok:#1E8A4C; --frthin:#C98A00; --frgap:#C2361F;
  --frline:#E1E5E0; --frpaper:#EEF1EC; --frink2:#5C6660; --frink3:#9AA39D; --frp2d:#567D61; }
.fr-page{ margin:-4px -4px 0; padding:0 0 8px; color:var(--frink); }
.fr-page *,.fr-pop *{ box-sizing:border-box; }
.fr-page button{ font-family:inherit; cursor:pointer; }
.fr-ask.fly{ background:var(--frfly); border-color:var(--frfly); color:var(--frink); }
.fr-ask.to{ background:var(--frto); border-color:var(--frto); color:var(--frink); }
.fr-ask.quiet{ background:#fff; color:#B4BBB6; border-color:var(--frline); }
/* the hero: the plan and the rail */
.fr-planin .fbp-scroll{ overflow:visible; border-radius:0; background:none; }
.fr-planin .fbp{ height:340px; }
.fr-planin .fbp-tbl.seated{ background:var(--frsand); border-color:var(--frsand); color:#2A2418; }
.fr-planin .fbp-tbl.seated .fbp-sub{ color:rgba(42,36,24,.75); }
.fr-planin .fbp-tbl.glow{ box-shadow:0 0 0 5px rgba(228,201,141,.28),0 0 22px rgba(228,201,141,.55); }
.fr-planin .fbp-tbl.glow::after{ content:""; position:absolute; inset:-2px; border-radius:13px; pointer-events:none; box-shadow:0 0 0 7px rgba(228,201,141,.16),0 0 30px rgba(228,201,141,.7); animation:mcGlowOp 2.2s ease-in-out infinite; will-change:opacity; }
.fr-planin .fbp-tbl.seated.longsit{ background:#D0821E; border-color:#D0821E; color:#fff; }
.fr-planin .fbp-tbl.moving{ outline:3px solid #fff; outline-offset:2px; }
.fr-planin .fbp-tbl.movetarget{ border-style:dashed; border-color:rgba(255,255,255,.7); }
.fr-planin .fbp-tbl:hover{ transform:none; }
/* the line: McTrack from the salesperson's screen, sized for a thumb */
.fr-pip.hd{ width:42px; height:42px; font-size:13px; background:rgba(232,238,242,.34); }
.fr-pip.tg.lt{ color:var(--frink); }
/* ---- the phone room, on a phone ----
   Built on the floor's own layout so a manager moving between the two rooms
   does not learn a second set of gestures. Only the colour changes: the hero
   wears the Phone Line's blue rather than the floor's green, and the accent
   that marks a caption follows it. */
.fr-page.qr{ --frsand2:#4C6FFF; --frsand:#8FA6FF; --frp2d:#5A72C0; }
.fr-page.qr .fr-hero{ background:linear-gradient(150deg,#5E79C8,#3A5296 55%,#1E2A50);
  box-shadow:0 14px 30px -14px rgba(30,42,80,.55); }
.fr-page.qr .fr-planin .fbp{ background:none; }
/* The one control the desk reaches for most, in the corner the floor keeps for
   its asks: who is up, and the tap that hands them the call. */
.qr-lrow.static{ background:none; border-bottom:1px solid var(--frline); border-radius:0; }
/* the lower card: coverage and the four tools */
.fr-tag.ok{ background:#E3F3E9; color:var(--frok); }
.fr-tag.gap{ background:#FBE5E0; color:var(--frgap); }
.fr-hours i.ok{ background:var(--frok); }
.fr-hours i.gap{ background:var(--frgap); }
.fr-hours i.ahead{ background:rgba(16,32,52,.07); }
.fr-tool .pix{ color:var(--frp2d); }
.fr-tool.asking{ border-color:var(--frsand); }
/* the pop */
@keyframes frIn{ from{ opacity:0; } }
@keyframes frUp{ from{ transform:scale(.3); opacity:0; } }
.fr-av.sm{ width:32px; height:32px; font-size:11px; }
.fr-av.fly{ background:var(--frfly); color:var(--frink); }
.fr-av.to{ background:var(--frto); color:var(--frink); }
.fr-tagp.lt{ color:var(--frink); }
.fr-st.in{ background:#E8F1EA; color:var(--frok); }
.fr-st.lunch{ background:#FFF3DE; color:var(--frthin); }
.fr-st.away{ background:#FBE5E0; color:var(--frgap); }
.fr-st.off{ background:#EEF0F2; color:#5C6660; }
.fr-b.warn{ color:var(--frto); border-color:#F1C9C5; background:#FFF3F2; }
.fr-b.seat,.fr-b.fly,.fr-b.to{ flex-direction:column; gap:4px; font:700 15px var(--font-display); color:var(--frink); }
.fr-b.seat{ background:var(--frsand); border-color:var(--frsand); }
.fr-b.fly{ background:var(--frfly); border-color:var(--frfly); }
.fr-b.to{ background:var(--frto); border-color:var(--frto); }
.fr-b.sm{ flex:0 0 auto; min-height:32px; padding:0 10px; font-size:12px; border-radius:10px; border-width:1.5px; }
/* lists inside the pop */
.fr-list.grid .fr-row{ grid-template-columns:12px 32px minmax(0,1fr) 30px 62px; height:64px; }
.fr-row.off{ background:#F3F6F2; }
.fr-row.sched{ grid-template-columns:30px minmax(0,1fr) auto; height:50px; }
.fr-row.rec{ grid-template-columns:30px minmax(0,1fr) 44px; height:52px; }
.fr-bighours i.ok{ background:var(--frok); }
.fr-bighours i.gap{ background:var(--frgap); }
.fr-bighours i.ahead{ background:rgba(16,32,52,.07); }
.fr-bighours i.now{ outline:2px solid var(--frink); outline-offset:2px; }
.fr-ic.up{ background:#E8F1EA; color:var(--frok); }
.fr-ic.mv{ background:#EAF2FF; color:#2E7DE0; }
.fr-ic.fly{ background:var(--frfly); color:var(--frink); }
.fr-ic.to{ background:var(--frto); color:var(--frink); }
.fr-ic.lunch{ background:#FFF3DE; color:var(--frthin); }
.fr-ic.warn{ background:#FBE5E0; color:var(--frgap); }
.fr-tabs button.on{ background:var(--frp2d); border-color:var(--frp2d); color:#fff; }
`;

let styleNode = null;
function ensureStyle() {
  if (typeof document === "undefined" || styleNode) return;
  styleNode = document.createElement("style");
  styleNode.setAttribute("data-sage", "");
  styleNode.textContent = SAGE_CSS;
  document.head.appendChild(styleNode);
}
/* At module load, so the sheet is in place before the first render rather than
   arriving with it. */
ensureStyle();

/* Kept as a component because a dozen call sites render it, and it is easier to
   read a screen that still says where its styles come from than to explain the
   absence. It mounts nothing. */
function Style() {
  ensureStyle();
  return null;
}
/* A second sheet under its own name, for rules that arrive with a later
   download (the manager's pages). Once per name. */
function ensureStyleNamed(id, css) {
  if (typeof document === "undefined" || document.getElementById("sage-css-" + id)) return;
  const el = document.createElement("style");
  el.id = "sage-css-" + id;
  el.textContent = css;
  document.head.appendChild(el);
}

/* What the manager's file (Manager.jsx) reads from here. */
export { ACCOUNT_KINDS, AUDIT_KEY, AUTH_ENABLED, BACKUP_INDEX_KEY, CHANNEL_LIST, CONFIG_KEY, DEFAULT_ACTIVITY_STANDARDS, DEFAULT_BRAND, DEFAULT_CHECKLIST, DEFAULT_FLOOR_PLAN, DEFAULT_TAGS, DEFAULT_TIERS, DmNumber, FLOOR_TABLE, GROUP_HOLIDAYS, KEEP_BACKUPS, LANG_NAMES, LEADERBOARD_REPORTS, LEAD_VARIANTS, LoadingScreen, Logo, Overlay, PIX, PUBLIC_STORES_KEY, PixIcon, PlanMap, QUEUE_TABLE, QUEUE_TOOLS, QueueQR, REPORTS, STORE_TZ, STRENGTH_METRICS, SUPABASE_ANON_KEY, SUPABASE_URL, Shell, Style, TEST_ID, TICKET_PREFIX, activeAssists, apiCall, appendAudit, assistAge, authResetPassword, backupMetaKey, backupStoreKey, currentStreak, dayIn, dayOfMonth, dayPoints, departedNames, departedOnFor, emptyStoreData, extractPdfLinesInBrowser, floorPlanOf, floorRowId, fmtAssistAge, fmtNum, frLastTap, greetingFor, hueFromName, initialsOf, isOff, isTestId, jumpOwnsEntrance, langName, lastDays, lastSaveError, loadActivityRows, loadFloorDays, loadFloorRow, loadPapa, loadPdfJs, loadQRCode, loadQueueIdentities, loadQueueRow, loadRowIfChanged, loadShared, loadStore, loadStoreStamp, looksAbsent, monthLabel, mutateFloorRow, mutateQueueIdentities, mutateQueueRow, normThresholds, publicSlice, publishBoard, qFirstToken, qLev, qMinsSince, qNormName, qNowIso, qWaitLabel, queueRowId, queueSignInUrl, queueTool, saveShared, saveStoreCAS, saveTicket, settleReveals, shortDay, shortLabel, stnFirst, today, uid, useAssistTick, useBuildWatchdog, useHeld, useLiveRow, usePhoneLayout, useStationHours, useTrackLight, ym, ensureStyleNamed };

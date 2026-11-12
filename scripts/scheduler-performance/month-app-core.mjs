import {projectWeekTimeline,projectMonthSchedule,describeTimelineTeam} from './week-timeline.mjs';
import {readWeekRows} from './week-rows.mjs';
import {displayDate} from './date-display.mjs';
import {bindAgendaDrag} from './shift-agenda-drag.mjs';
import {openShiftTransferCommand} from './shift-transfer-ui.mjs';
import {shiftAgendaEntries} from './shift-agenda.mjs';
import {historyClass,historyScale,scheduleMarker,scheduleKey} from './calendar-key.mjs';
import {openOffDayCommand} from './off-day-ui.mjs';
import {captureHapticAction as captureHaptic,feedback as hapticFeedback,cancelHaptics as cancelHaptic} from "./haptics.mjs";
import {intendedStatus,dayEditRecord} from "./day-edit-state.mjs";
import {createDayMotion,swipeIntent,swipeDirection} from "./day-motion.mjs";
import { quickRosterGroups, verifiedLow, calendarWarning, selectedScheduleRows } from "./mobile-roster.mjs";
import { openGeneration } from "./generation-ui.mjs";
import { teamsOnDay, membershipAt, assignedMembership, membershipMismatches, teamSnapshot, dayAbsence, absenceKind, absenceLabel } from "./team-model.mjs";
import { balanceMarkup, teamDayMarkup, openTeamEditor, peopleTeamsMarkup, personTeamLabel } from "./team-ui.mjs";
import { openScheduleImport } from "./import-ui.mjs";
import { weeklyHoursAudit, weeklyHoursText, hoursLabel, mondayOf } from "./weekly-hours.mjs";
import { timeLabel, displayTime, minute, employmentProblem } from "./shift-intervals.mjs";
import { addDays } from "../scheduler-proposal/model.mjs";
import {
  createPlanner,
  monthDays,
  validMonth,
  shiftMonth,
  recordedDay,
  monthSales,
  salesHeat,
  storeToday,
  calendarCells,
} from "./month-model.mjs";
import { storeRuleDraft, applyStoreRuleForm, effectiveExceptions } from "./store-editor.mjs";
import { assignmentSummary } from "./assignment-view.mjs";
import { dayDemand, historicalCalendar, historicalAverageText } from "./demand-context.mjs";
import { icon } from "./sage-icons.mjs";

const SIGNALS = new Set(["scheduler-view", "scheduler-hide"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
let popoverSequence=0;

/**
 * The editor, mounted into a root it is given. It reads nothing from the page it sits in:
 * the stores, the assignments, the clock and every way out arrive through `opts`, and
 * `dispose()` takes back everything it attached. It saves nothing; the planner it builds is
 * the page's own memory, as in the preview.
 *
 * opts: root, stores (each with explicit teams and memberships, which may be empty), assignmentForDay,
 * peopleForMonth(index, month) -> that month's people, for each new month draft (default: the store's people),
 * today(store) -> YYYY-MM-DD in that store's own time, index, embedded, keyTarget (where Escape is heard,
 * default the root), confirm(message), onSummary(detail), onClose(), onExit(), onError(error),
 * draftCodec({ verify(projection) }) -> the caller's own codec check, which `hydrateMonth` requires and this file never
 * replaces with a default.
 *
 * The draft bridge, on the returned handle: `exportMonth(month, index)` -> { projection, token }, a detached copy of
 * what that month would save and a submission token; `acknowledgeMonth(month, token, index)` moves that month's saved
 * baseline to exactly what the token was cut from (edits made after stay unsaved); `hydrateMonth(projection, index)`
 * takes a saved month in, refusing without changing anything; `draftStatus(index)` and `subscribeDraft(fn)`. Nothing
 * here saves, sends or reads from anywhere.
 */
export function mountMonthApp(opts) {
  if (!opts || typeof opts !== "object") throw new TypeError("mountMonthApp needs options");
  const { root, stores } = opts;
  if (!root || root.nodeType !== 1) throw new TypeError("mountMonthApp needs a root element");
  if (!Array.isArray(stores) || !stores.length) throw new TypeError("mountMonthApp needs at least one store");
  // Without explicit teams and memberships the planner invents placeholder teams (Oak, Pine) and people.
  for (const s of stores) if (!s || !Array.isArray(s.teams) || !Array.isArray(s.memberships)) throw new TypeError("every store needs explicit teams and memberships");
  if (typeof opts.assignmentForDay !== "function") throw new TypeError("mountMonthApp needs assignmentForDay");
  if (opts.draftCodec !== undefined && (opts.draftCodec === null || typeof opts.draftCodec !== "object" || typeof opts.draftCodec.verify !== "function")) throw new TypeError("draftCodec needs a verify function");
  // The connected app may lend a scoped in-memory draft. This grants no save or
  // publication capability, and the caller must still hold the original load.
  const localDraft = opts.localDraft === true && opts.strictHours === true
    && opts.requireMaterializedSources === true && typeof opts.isCurrent === "function" && opts.isCurrent() === true;
  if (opts.preview !== true && !localDraft) throw new Error("Live scheduler is not configured; explicit synthetic preview is required.");
  if (opts.strictHours === true && typeof opts.today !== "function") throw new TypeError("Strict planner needs an explicit store-local today() clock.");
  const startIndex = opts.index ?? 0;
  if (!Number.isInteger(startIndex) || !stores[startIndex]) throw new TypeError("index is not a store");
  // The store on screen; the clock below asks it for the date.
  let selected = startIndex;
  const clock = typeof opts.today === "function" ? opts.today : () => storeToday();
  // Each use asks the clock again, for the store on screen, so a store in another zone keeps its own date.
  const today = () => {
    const day = clock(stores[selected]);
    if (typeof day !== "string" || !ISO_DAY.test(day) || !validMonth(day.slice(0, 7)) || !monthDays(day.slice(0, 7)).includes(day)) throw new TypeError("today() must give a valid YYYY-MM-DD date");
    return day;
  };
  const hostWindow = root.ownerDocument.defaultView, hostDocument = root.ownerDocument;
  let scopeId;do{scopeId=`sage-scheduler-${++popoverSequence}`;}while(hostDocument.getElementById(`${scopeId}-shift-agenda-title`));
  const keyTarget = opts.keyTarget || root;
  let disposed = false, layoutObserver = null, sizeObserver = null;
  const cleanups = [], frames = new Set(), signals = {};
  let retireOwner = () => teardown();
  const alive = () => {
    if (disposed) return false;
    let current = true;
    try { current = !localDraft || opts.isCurrent() === true; } catch { current = false; }
    if (!current) { retireOwner(); return false; }
    return true;
  };
  const listen = (target, type, fn, options) => {
    const scoped = (...args) => { if (alive()) return fn(...args); };
    if (target === window && SIGNALS.has(type)) { signals[type] = scoped; return; }
    const real = target === window ? (type === "keydown" ? keyTarget : hostWindow) : target;
    real.addEventListener(type, scoped, options);
    cleanups.push(() => real.removeEventListener(type, scoped, options));
  };
  const requestAnimationFrame = fn => {
    const id = hostWindow.requestAnimationFrame(t => { frames.delete(id); if (!disposed) fn(t); });
    frames.add(id);
    return id;
  };
  // Lookups stay inside the root: another screen's #message or #sheet is never ours.
  const document = {
    querySelector: s => root.querySelector(s),
    querySelectorAll: s => root.querySelectorAll(s),
    getElementById: id => root.querySelector(`#${hostWindow.CSS.escape(id)}`),
    createElement: t => hostDocument.createElement(t),
    get documentElement() { return hostDocument.documentElement; },
    get activeElement() { return hostDocument.activeElement; },
    get fonts() { return hostDocument.fonts; },
  };
  // Where the preview told its parent page, the host is told by callback instead.
  let content;
  const window = {
    addEventListener: (type, fn, options) => listen(window, type, fn, options),
    confirm: message => (typeof opts.confirm === "function" ? Boolean(opts.confirm(message)) : hostWindow.confirm(message)),
    scrollBy: (...a) => content.scrollBy(...a),
    scrollTo: (...a) => content.scrollTo(...a),
    get scrollY() { return content.scrollTop; },
    parent: {
      dispatchEvent(event) {
        if (disposed) return false;
        if (event.type === "scheduler-summary" && typeof opts.onSummary === "function") opts.onSummary(event.detail);
        else if (event.type === "scheduler-close" && typeof opts.onClose === "function") opts.onClose();
        return true;
      },
    },
  };
  // Haptic events go to the document the editor is in, not the page that hosts it.
  const captureHapticAction = () => captureHaptic(hostDocument);
  const feedback = (name, token = captureHapticAction()) => hapticFeedback(name, token, hostDocument);
  const cancelHaptics = () => cancelHaptic(hostDocument);
  const PREVIEW = opts.preview === true;
  const rootClassName = root.className, hadHapticData = ["hapticMonth", "hapticDate", "hapticView"].map(k => [k, root.dataset[k]]);
  root.classList.add("scheduler-mounted");
  let ownsDayClass=false;const hadDayClass=root.classList.contains('scheduler-day-open');
  const acquireDayClass=()=>{if(ownsDayClass)return;ownsDayClass=true;root.classList.add('scheduler-day-open');};
  const releaseDayClass=()=>{if(!ownsDayClass)return;ownsDayClass=false;if(!hadDayClass)root.classList.remove('scheduler-day-open');};
  const barHeight = root.style.getPropertyValue("--month-bar-height");
  function teardown() {
    disposed = true;
    for (const off of cleanups.splice(0)) { try { off(); } catch {} }
    for (const id of frames) { try { hostWindow.cancelAnimationFrame(id); } catch {} }
    frames.clear();
    try { layoutObserver?.disconnect(); } catch {}
    try { sizeObserver?.disconnect(); } catch {}
    releaseDayClass();
    if (barHeight) root.style.setProperty("--month-bar-height", barHeight);
    else root.style.removeProperty("--month-bar-height");
    root.replaceChildren();
    root.className = rootClassName;
    for (const [k, v] of hadHapticData) { if (v === undefined) delete root.dataset[k]; else root.dataset[k] = v; }
  }
  try {
const planner = createPlanner(stores, { assignmentForDay: opts.assignmentForDay, explicitAssignmentForDay: opts.explicitAssignmentForDay, strictHours: opts.strictHours === true, requireMaterializedSources:opts.requireMaterializedSources===true }),
  app = root;
content=hostDocument.createElement('div');const dock=hostDocument.createElement('div');content.className='scheduler-scroll';dock.dataset.schedulerDock='';app.replaceChildren(content,dock);
// A month's draft takes its people when it is first made. Given `peopleForMonth`, each new draft gets that month's
// roster, whichever way it is reached (this screen, the off-day, import or team tools), so opening in one month
// and moving to another gives what opening in the other would. A draft that exists is never touched.
if (typeof opts.peopleForMonth === "function") {
  const setDraft = planner.drafts.set.bind(planner.drafts);
  planner.drafts.set = (key, draft) => {
    if (!planner.drafts.has(key)) {
      const at = key.indexOf(":");
      draft.store.people = structuredClone(opts.peopleForMonth(Number(key.slice(0, at)), key.slice(at + 1)));
    }
    return setDraft(key, draft);
  };
}
// team-ui.mjs is shared and read-only here; its one fictional-data sentence is dropped for real stores,
// and the probe fails if the wording ever changes and this stops matching.
const balancePanel = () => { const html = balanceMarkup(planner, selected, month); if (PREVIEW) return html;
  let live = html;
  for (const [was, now] of [["This is fictional daily store-sales opportunity,", "This is daily store-sales opportunity,"], ["inputs exist in this preview.", "inputs exist here."], ["these illustrative ranges", "these ranges"]]) live = live.replace(was, now);
  return live; };
const popoverOpeners=new Map();
listen(app,'click',e=>{const trigger=e.target.closest('[popovertarget]');if(trigger&&trigger.getAttribute('popovertargetaction')!=='hide')popoverOpeners.set(trigger.getAttribute('popovertarget'),trigger);},{capture:true});
function bindHistoryPopovers(root){
 for(const pop of root.querySelectorAll('[popover]')){
  if(pop.dataset.bound)continue;pop.dataset.bound='true';
  const original=pop.id;pop.dataset.popoverKey=original;const triggersForId=[...root.querySelectorAll('[popovertarget]')].filter(t=>t.getAttribute('popovertarget')===original);let unique;do{unique=`sage-scheduler-popover-${++popoverSequence}`;}while(hostDocument.getElementById(unique));pop.id=unique;for(const trigger of triggersForId)trigger.setAttribute('popovertarget',unique);
  const triggers=[...app.querySelectorAll(`[popovertarget="${pop.id}"]`)].filter(t=>t.getAttribute('popovertargetaction')!=='hide');
  for(const t of triggers){t.setAttribute('aria-controls',pop.id);t.setAttribute('aria-expanded','false');}
  pop.addEventListener('toggle',e=>{for(const t of triggers)t.setAttribute('aria-expanded',String(e.newState==='open'));if(e.newState==='open'){const target=pop.querySelector('h2')||pop.querySelector('input,button');if(target){if(target.tagName==='H2')target.tabIndex=-1;target.focus();}}});
  const close=pop.querySelector('[data-dismiss]');if(close)close.onclick=()=>{pop.hidePopover();(popoverOpeners.get(pop.id)||triggers[0])?.focus();};
 }
}
let dayHapticToken=null;
let quickEdit = false, localSettingsChanged=false;
let editorReturnScroll = null;
let mobileDaySession = null, restoringDayFocus = false,lastDayInput='keyboard';
listen(app,'pointerdown',e=>{lastDayInput=e.pointerType||'mouse';},{capture:true});
listen(app,'keydown',()=>{lastDayInput='keyboard';},{capture:true});
const embeddedPlanner = Boolean(opts.embedded);
let closeImport = () => {};
let closeOffDay = () => {}, lastOffDayUndo=null;
let closeGeneration = () => {};
const generationAnswers = new Map();
let generationDetour = null, absenceRecoveryNotice = null;
const generationKey = () => `${selected}:${month}`;
const returningToGeneration = () => generationDetour === generationKey();
function returnToGeneration() {
  if (!returningToGeneration()) return false;
  generationDetour = null;
  startGeneration();
  return true;
}
// Unapplied choices are local to a store/date and never enter coverage calculations.
const pendingAssignments = new Map();
const pendingSettings = new Map();
let leavingPreview=false;
listen(window,'pageshow',()=>{leavingPreview=false;});
// Unsaved means a month differs from what it was saved as (or began as). Marking a month reviewed is not part of what
// is saved, so it stays a change of this page until the page is closed.
const hasLocalDraft=()=>Boolean(directDirty||localSettingsChanged||planner.unsaved||pendingAssignments.size||pendingSettings.size||generationAnswers.size);
listen(window,'beforeunload',event=>{if(!leavingPreview&&hasLocalDraft()){event.preventDefault();event.returnValue='';}});
const pendingKey = day => `${selected}:${day}`;
const initialDay = () => month === today().slice(0,7) ? today() : month + "-01";
function updateSelection() {
  for (const button of app.querySelectorAll("[data-day]")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === selectedDay));
    button.removeAttribute("aria-controls");
  }
}
let editing = false, mode = "mixed", selectedDay = null, monthExpanded = false;
let timelineScroll={top:null,left:null,week:null};
let closeAgendaDrag=()=>{},closeShiftTransfer=()=>{},closeDirectShift=()=>{},directDirty=false,activeResize=null;
const CSS=hostWindow.CSS, matchMedia=hostWindow.matchMedia.bind(hostWindow), confirm=window.confirm;
let motionRows = [], historicalView=null;
let month = today().slice(0, 7);
const deliveredMarkup = r => `<span class="delivered-label">Delivered</span><span class="delivered-value">${r.state === "known" ? r.units : r.state === "future" ? "Pending" : r.state === "closed" ? "Closed" : "Unknown"}</span>${r.state === "future" ? '<span class="sr-only">Sales not yet available</span>' : ''}`;
const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dateLabel = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const monthLabel = (m) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const draft = () => planner.get(selected, month);
const rows = () => planner.rows(selected, month);
const fingerprint = (r) => JSON.stringify(r);
const markChanged = () => {
  planner.settingsChanged(selected,month);
  draft().accepted = false;
  draft().reviewFingerprint = null;
};
const staffing = row => {const result=assignmentSummary(draft().store.people, teamsOnDay(draft().store,row.record,row.day,mode), row.record, {...row,store:draft().store});return row.strictHours&&row.state==='open'&&row.minimumCoverage===null?{...result,covering:null,status:row.record?'Schedule conflict':'Needs schedule'}:result;};
const staffingMarkup = (s, expandable = false) => {
  if (s.status === "Closed") return `<span class="staff-closed">${icon("clock")}Store closed</span>`;
  const wrap = expandable ? "div" : "span";
  const memberState = id => s.conflicting.includes(id) ? "Conflict" : s.on.includes(id) ? "On" : s.vacation?.includes(id)?"Vacation":s.unavailable?.includes(id)?"Unavailable":s.off.includes(id) ? "Scheduled off" : "Unknown";
  const memberNames = t => `<span class="team-members" role="list" aria-label="${esc(t.name)} members">${[...new Set(t.ids)].map(id=>`<span class="team-member" role="listitem"><span>${esc(draft().store.people.find(p=>p.id===id)?.name || id)}</span><strong>${memberState(id)}</strong></span>`).join("")}</span>`;
  const person = p => `<span class="additional-person" data-person="${esc(p.id)}"><span>${esc(p.name)}</span><strong>${p.state}</strong></span>`;
  const people = s.additionalPeople || [], first = people.slice(0,3).map(person).join(""), rest = people.slice(3);
  const named = `<span class="additional-names">${first || "No additional people"}</span>${rest.length ? expandable ? `<details class="additional-more"><summary aria-expanded="false" aria-controls="${scopeId}-additional-remaining">${rest.length} more ${rest.length === 1 ? "person" : "people"}</summary><span id="${scopeId}-additional-remaining" class="additional-names">${rest.map(person).join("")}</span></details>` : `<span class="additional-preview-more">${rest.length} more ${rest.length === 1 ? "person" : "people"} in day details</span>` : ""}`;
  const counts = mode === "team" && !people.length ? "" : `<${wrap} class="staff-people"><span class="staff-group-title">${icon("users")}${mode === "mixed" ? "Additional people" : "People"}</span><span class="staff-counts">${[["on","On","check"],["off","Off","close"],["unknown","Unknown","question"],...(s.additional.vacation ? [["vacation","Vacation","close"]] : []),...(s.additional.unavailable ? [["unavailable","Unavailable","close"]] : []),...(s.additional.conflicts ? [["conflicts","Conflicting","warn"]] : [])].map(([key,label,glyph])=>`<span class="staff-count" data-count="${key}">${icon(glyph)}<strong>${s.additional[key]}</strong><span>${label}</span></span>`).join("")}</span>${named}</${wrap}>`;
  return `<${wrap} class="staffing-groups">${s.teams.length ? `<span class="staff-teams">${s.teams.map(t=>`<span class="staff-team" data-state="${t.state}"><span class="staff-team-name">${icon("users")}${esc(t.name)}</span><span class="staff-team-state">${icon(t.state === "On" ? "check" : t.state === "Off" ? "close" : t.state === "Unknown" ? "question" : "warn")}${t.state}</span>${expandable ? memberNames(t) : ""}</span>`).join("")}</span>` : ""}${counts}</${wrap}>`;
};
const statusIcon = status => status === "Scheduled" ? "check" : status === "Closed" ? "close" : status === "Hours unknown" ? "question" : status === "Low staff" ? "users" : "warn";
const statusMarkup = s => `<span class="staff-status ${(s.status === "Needs schedule" || s.status === "Schedule conflict") ? "needs-schedule" : s.status === "Low staff" ? "low-staff" : ""}">${icon(statusIcon(s.status))}<span class="status-label">${s.status}</span></span>`;
function syncCalendarLayout() {
  const font = parseFloat(hostWindow.getComputedStyle(document.documentElement).fontSize);
  app.classList.remove("delivered-grid-reflow");
  app.classList.toggle("stacked-workspace", app.clientWidth < 60 * font);
  app.classList.remove("calendar-list");
  const compact = app.clientWidth <= 700;
  app.classList.toggle("scheduler-narrow", app.clientWidth < 400);
  app.classList.toggle("scheduler-extra-narrow", app.clientWidth < 360);
  const inset = `${app.querySelector(".month-navigation")?.offsetHeight || 0}px`;
  if(app.style.getPropertyValue("--month-bar-height")!==inset)app.style.setProperty("--month-bar-height",inset);
  app.classList.toggle("compact-month", compact);
  app.classList.toggle("compact-reflow", compact && font >= 24);
  // Preserve readable single-line sales strips before keeping the desktop panes side by side.
  if (!compact && font >= 24) {
    const grid = app.querySelector(".month-days");
    const cellWidth = () => (grid.clientWidth - 6 * parseFloat(hostWindow.getComputedStyle(grid).columnGap)) / 7;
    if (cellWidth() < 7 * font) app.classList.add("stacked-workspace");
    if (cellWidth() < 7 * font) app.classList.add("delivered-grid-reflow");
  }
  for (const button of app.querySelectorAll("[data-day]")) {
    button.setAttribute("aria-label", `${dateLabel(button.dataset.day)}, ${button.dataset.status}. ${button.dataset.scheduleLabel}. ${button.dataset.salesLabel}.${editing ? ` ${button.dataset.historyLabel}.` : ''} Open day details.`);
  }
}
// WebKit's native backward focus scroll can ignore the sticky header inset.
listen(app,"focusin", event => {
  const target = event.target;
  if (restoringDayFocus || !app.classList.contains("compact-month") || !target.matches("[data-day]")) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== target) return;
    const rect = target.getBoundingClientRect(), nav = app.querySelector(".month-navigation").getBoundingClientRect();
    if (rect.top < nav.bottom + 4) window.scrollBy({top:rect.top - nav.bottom - 8, behavior:"instant"});
    else if (rect.bottom > hostWindow.innerHeight - 4) window.scrollBy({top:rect.bottom - hostWindow.innerHeight + 8, behavior:"instant"});
  });
});
listen(window,"resize", () => {syncCalendarLayout();if(hostWindow.innerWidth>700)closeMobileDay(false);});
document.fonts.ready.then(()=>{if(!disposed)syncCalendarLayout();});
layoutObserver = new hostWindow.MutationObserver(syncCalendarLayout);
layoutObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style"],
});
if(hostWindow.ResizeObserver){sizeObserver=new hostWindow.ResizeObserver(()=>{if(!disposed)syncCalendarLayout();});sizeObserver.observe(root);}
// render() recreates Schedule tools closed, so a tool must reopen its disclosure before it can take focus back.
function focusControl(el, options) {
  const tools = el?.closest?.(".schedule-tools");
  if (tools) tools.open = true;
  el?.focus(options);
}
function monthSchedulePreview(row,store){
 const view=projectMonthSchedule(row,store),record=row.record,teams=store.teams||[],order=teams.map(t=>t.id).sort(),groups=new Map();
 const add=(key,label,tone,warning,kind)=>{const previous=groups.get(key);groups.set(key,{id:key,label,tone,kind,warning:Boolean(warning||previous?.warning)});};
 for(const id of new Set([...(record?.on||[]),...(record?.shifts||[]).map(shift=>shift.personId)])){
  const member=assignedMembership(store,record,row.day,id),ids=Array.isArray(member?.teamIds)?[...new Set(member.teamIds)]:[],unknown=!member||!Array.isArray(member.teamIds)||member.unknown||ids.some(t=>!teams.some(x=>x.id===t));
  const warning=row.state!=='open'||!(record?.on||[]).includes(id)||(record?.off||[]).includes(id)||Boolean(row.conflicts?.[id]?.length)||Object.hasOwn(record?.unknownNotes||{},id)||Object.hasOwn(record?.absences||{},id);
  if(unknown)add(`person:${id}`,`${store.people.find(p=>p.id===id)?.name||`Unknown person (${id})`} · team unknown`,'neutral',true,'individual');
  else if(!ids.length)add(`person:${id}`,store.people.find(p=>p.id===id)?.name||`Unknown person (${id})`,'neutral',warning,'individual');
  else for(const teamId of ids){const team=teams.find(t=>t.id===teamId);add(`team:${teamId}`,team.name||teamId,String(order.indexOf(teamId)%5),warning,'team');}
 }
 const allOff=Boolean(record&&(store.people||[]).length&&(store.people||[]).every(person=>(record.off||[]).includes(person.id)));
 const state=row.state==='closed'?'Closed':row.state!=='open'?'Hours unknown':!record?'No plan':groups.size?'':allOff?'All off':'On unknown';
 const names=[...groups.values()].sort((a,b)=>(a.kind==='team'?0:1)-(b.kind==='team'?0:1)),unverified=view.unverified.length>0,remaining=Math.max(0,names.length-3);
 const compact=g=>g.kind==='team'?g.label.replace(/\s+team$/i,''):g.label;const chips=names.slice(0,3).map(g=>{const matching=names.filter(other=>compact(other)===compact(g)),short=matching.length>1?(matching.some(other=>other!==g&&other.label===g.label)?`${g.label} (${g.id||'unassigned'})`:g.label):compact(g);return `<span class="month-team-chip team-tone-${esc(g.tone)}">${esc(short)}${g.warning?' <b aria-hidden="true">!</b>':''}</span>`;}).join('');
 const label=[state,names.length?`Scheduled teams and individuals: ${names.map(g=>`${names.filter(other=>other.label===g.label).length>1?`${g.label} (${g.id||'unassigned'})`:g.label}${g.warning?' needs review':''}`).join(', ')}`:'',unverified?'Some shift times are unconfirmed':'',remaining?`${remaining} more ${remaining===1?'item':'items'}; open day schedule for details`:''].filter(Boolean).join('. ')||'No scheduled people';
 return {label,markup:`<span class="month-team-preview" aria-hidden="true">${state?`<span class="month-team-state">${esc(state)}</span>`:''}${chips}${unverified?'<span class="month-team-state">Times ?</span>':''}${remaining?`<span class="month-more">+${remaining}</span>`:''}</span>`};
}
function shiftAgendaMarkup(list) {
 const dow=new Date(selectedDay+'T12:00:00Z').getUTCDay(),start=addDays(selectedDay,-((dow+6)%7));
 const dates=Array.from({length:7},(_,i)=>addDays(start,i));
 const weekRows=readWeekRows(planner,selected,month,list,dates);
 const entries=weekRows.flatMap(({row,store})=>row?shiftAgendaEntries([row],store).map(e=>({...e,...describeTimelineTeam(store,row.record,row.day,e.id)})):[]);
 const card=e=>`<button type="button" class="shift-event" data-agenda-day="${esc(e.day)}" data-agenda-shift="${esc(e.id)}" aria-describedby="${scopeId}-agenda-instruction" aria-label="${esc(e.name)}, ${esc(e.hours)}, ${esc(e.teamLabel)}, ${esc(dateLabel(e.day))}${e.issues.length?`, needs review: ${esc(e.issues.join('; '))}`:''}. Open shift options"><strong>${esc(e.name)}</strong><span class="shift-event-hours">${esc(e.hours)} · ${esc(e.teamLabel)}</span>${e.issues.length?`<span class="shift-event-issue">Needs review: ${esc(e.issues.join('; '))}</span>`:''}</button>`;
 const dateButton=({day,row})=>`<button type="button" class="week-target ${day===selectedDay?'is-selected':''}" data-week-day="${esc(day)}" aria-label="${esc(dateLabel(day))}${!row?', outside supported dates':row.state==='closed'?', store closed':row.state==='unknown'?', store hours unknown':''}${entries.some(e=>e.day===day)?', explicit shifts':''}" aria-pressed="${day===selectedDay}" ${row?'':'disabled'}><span>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(day+'T12:00:00Z').getUTCDay()]}</span><strong>${Number(day.slice(-2))}</strong>${entries.some(e=>e.day===day)?'<i aria-label="Explicit shifts"></i>':''}</button>`;
 const rangeDate=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}), range=start.slice(0,4)!==dates[6].slice(0,4)?`${rangeDate(start)}, ${start.slice(0,4)} – ${rangeDate(dates[6])}, ${dates[6].slice(0,4)}`:start.slice(0,7)===dates[6].slice(0,7)?`${rangeDate(start)}–${Number(dates[6].slice(-2))}`:`${rangeDate(start)} – ${rangeDate(dates[6])}`;
 const miniCells=calendarCells(month),miniRows=Array.from({length:miniCells.length/7},(_,i)=>miniCells.slice(i*7,i*7+7));
 const miniMonth=`<span class="mini-month" aria-hidden="true">${miniRows.map(row=>`<span class="mini-week ${row.some(day=>day&&dates.includes(day))?'is-current':''}">${row.map(day=>`<i class="${day?'has-date':'outside'}"></i>`).join('')}</span>`).join('')}</span>`;
 const fullWeek=`Week of ${dateLabel(start)} through ${dateLabel(dates[6])}`;
 const canEditDay=weekRows.find(item=>item.day===selectedDay)?.row?.state==='open';
 const projected=projectWeekTimeline(weekRows),all=projected.flatMap(d=>d.events),frameStart=all.length?Math.max(0,Math.floor(Math.min(...all.map(e=>e.start))/60)*60-60):480,frameEnd=all.length?Math.min(1440,Math.ceil(Math.max(...all.map(e=>e.end))/60)*60+60):1080,initialLeft=Math.max(0,dates.indexOf(selectedDay)*150-100);
 const dayWidth=Math.max(150,...all.map(e=>e.lanes*75));
 const rules=Array.from({length:24},(_,h)=>`<i class="timeline-rule" style="top:calc(var(--timeline-hour) * ${h})" aria-hidden="true"></i>`).join('');
 const eventCard=e=>`<button type="button" class="shift-event timeline-event team-tone-${e.teamTone} ${e.issues.length?'has-issue':''}" data-agenda-day="${esc(e.day)}" data-agenda-shift="${esc(e.id)}" data-start="${e.start}" data-end="${e.end}" style="top:calc(var(--timeline-hour) * ${e.start/60});height:calc(var(--timeline-hour) * ${(e.end-e.start)/60});left:calc(${e.lane*100/e.lanes}% + 2px);width:calc(${100/e.lanes}% - 4px)" aria-describedby="${scopeId}-agenda-instruction" aria-label="${esc(e.name)}, ${displayTime(e.start)} to ${displayTime(e.end)}, ${esc(e.teamLabel)}, ${esc(dateLabel(e.day))}${e.issues.length?`, needs review: ${esc(e.issues.join('; '))}`:''}. ${e.intervalCount>1?'Moving this shift moves all intervals that day. ':''}Open shift options"><span class="timeline-event-content"><strong>${esc(e.name)}</strong><span class="timeline-event-time"><span>${displayTime(e.start)}</span><span>–${displayTime(e.end)}</span></span><span class="timeline-team">${esc(e.teamLabel)}</span>${e.issues.length?'<span class="timeline-warning" aria-hidden="true">! Review</span>':''}</span>${editing?'<span class="resize-edge resize-start" data-resize-edge="start" aria-hidden="true"></span><span class="resize-edge resize-end" data-resize-edge="end" aria-hidden="true"></span>':''}</button>`;
 const dateStatus=d=>d.state==='outside'?'Outside supported dates':d.state==='closed'?'Closed':d.state==='unknown'?'Hours unknown':d.noRecord?'Schedule not entered':'';
 const header=d=>{const source=weekRows.find(item=>item.day===d.day)?.store,actual=source?recordedDay(source,d.day,today()):null,actualLabel=actual?(actual.state==='known'?actual.units:actual.state==='future'?'Pending':actual.state==='closed'?'Closed':'Unknown'):null;return `<div class="timeline-day-head" aria-label="${esc(dateLabel(d.day))}${!editing&&actual?`, Delivered: ${esc(actualLabel)}`:''}"><strong>${esc(new Date(d.day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}))} ${Number(d.day.slice(-2))}</strong>${!editing&&actual?`<span>Delivered: ${esc(actualLabel)}</span>`:''}${dateStatus(d)?`<span>${esc(dateStatus(d))}</span>`:''}${d.off.length?`<span>Off: ${esc(d.off.join(', '))}</span>`:''}${d.unknown.length?`<span>Unknown: ${esc(d.unknown.join(', '))}</span>`:''}</div>`;};
 const unverified=projected.flatMap(d=>d.unverified.map(e=>({day:d.day,...e})));
 const untimed=weekRows.flatMap(({day,row,store})=>!row||!store?[]:[...new Set(row.record?.on||[])].filter(id=>!entries.some(e=>e.day===day&&e.id===id)).map(id=>({day,id,name:store.people.find(p=>p.id===id)?.name||`Unknown person (${id})`})));
 const selectedContext=weekRows.find(item=>item.day===selectedDay),otherStatuses=selectedContext?.row&&selectedContext.store?selectedScheduleRows(selectedContext.row,selectedContext.store).filter(p=>p.state!=='On'):[],selectedEntries=entries.filter(e=>e.day===selectedDay);
 const reviewCount=entries.filter(e=>e.issues.length||unverified.some(x=>x.day===e.day&&x.id===e.id)).length+untimed.length;
 const issues=entries.filter(e=>e.issues.length&&!unverified.some(x=>x.day===e.day&&x.id===e.id));
 return `<section id="week-schedule" class="shift-agenda schedule-week" ${monthExpanded?'hidden':''} aria-labelledby="${scopeId}-shift-agenda-title"><header class="week-heading"><div><h2 id="${scopeId}-shift-agenda-title"><span class="sr-only">${esc(fullWeek)}</span>${miniMonth}</h2><p class="week-eyebrow">${PREVIEW?(editing?'Editing · Preview':'Preview'):(editing?'Editing · Unsaved':'Schedule')}</p></div><label class="calendar-view-switch"><span class="sr-only">Calendar view</span><select data-view-switch aria-label="Calendar view"><option value="week" ${!monthExpanded?'selected':''}>Week view</option><option value="month" ${monthExpanded?'selected':''}>Month view</option></select></label></header><div class="week-strip" aria-label="Days this week">${weekRows.map(dateButton).join('')}</div><div class="timeline-scroll" tabindex="0" aria-label="Weekly shift time grid, scroll for times and days" data-week="${esc(start)}" data-frame-start="${frameStart}" data-frame-end="${frameEnd}" data-initial-left="${initialLeft}"><div class="timeline-grid" style="--timeline-day-width:${dayWidth}px"><div class="timeline-corner" aria-hidden="true"></div>${projected.map(header).join('')}<div class="timeline-axis" aria-hidden="true">${Array.from({length:24},(_,h)=>`<span style="top:calc(var(--timeline-hour) * ${h})">${displayTime(h*60)}</span>`).join('')}${all.length?`<i class="timeline-snap timeline-snap-before" style="top:calc(var(--timeline-hour) * ${frameStart/60})"></i><i class="timeline-snap timeline-snap-after" style="top:calc(var(--timeline-hour) * ${frameEnd/60})"></i>`:''}</div>${projected.map(d=>`<section class="timeline-column" data-grid-day="${esc(d.day)}" aria-label="${esc(dateLabel(d.day))}, ${esc(dateStatus(d)||'shift times')}" ${d.state==='outside'?'data-grid-disabled="true"':''}>${rules}${d.events.map(eventCard).join('')}</section>`).join('')}</div></div>${reviewCount?`<button type="button" id="timeline-review">${reviewCount} ${reviewCount===1?'shift needs':'shifts need'} review</button>`:''}${issues.length?`<details class="timeline-issues"><summary>Shifts needing review · ${issues.length}</summary>${issues.map(card).join('')}</details>`:''}${unverified.length||untimed.length?`<details class="timeline-unverified"><summary>Unverified times · not plotted · ${unverified.length+untimed.length}</summary>${unverified.map(card).join('')}${untimed.map(e=>`<p>${esc(dateLabel(e.day))} · ${esc(e.name)} · hours not specified</p>`).join('')}</details>`:''}<button type="button" id="schedule-edit-day" aria-label="Edit selected day" ${canEditDay?'':'disabled'}>Edit day</button><p id="${scopeId}-agenda-instruction" class="shift-agenda-instruction">Hold or drag · Tap for options</p><p id="agenda-drag-status" class="sr-only" role="status"></p></section>`;
}

function openMonthDay(day,opener){
 const row=rows().find(r=>r.day===day),store=draft().store,dialog=app.querySelector('#month-day-popup');if(!row||!dialog)return;
 const view=projectMonthSchedule(row,store),entries=shiftAgendaEntries([row],store).map(e=>({...e,...describeTimelineTeam(store,row.record,day,e.id)})),events=view.events;
 const start=events.length?Math.max(0,Math.floor(Math.min(...events.map(e=>e.start))/60)-1):0,end=events.length?Math.min(24,Math.ceil(Math.max(...events.map(e=>e.end))/60)+1):0;
 const axis=events.length?Array.from({length:end-start+1},(_,i)=>`<span style="top:${i*48}px">${start+i===24?'12:00 AM +1':displayTime((start+i)*60)}</span>`).join(''):'';
 const marks=events.map(e=>`<span class="month-pop-event team-tone-${esc(e.teamTone)}${e.issues.length?' has-issue':''}" style="top:${(e.start/60-start)*48}px;height:${(e.end-e.start)/60*48}px;left:${e.lane/e.lanes*100}%;width:${100/e.lanes}%" aria-hidden="true"><strong>${esc(e.name)}</strong><span>${displayTime(e.start)}–${displayTime(e.end)}</span><span>${esc(e.teamLabel)}</span></span>`).join('');
 const timeline=events.length?`<div class="month-pop-timeline" aria-hidden="true"><div class="month-pop-axis" style="height:${(end-start)*48}px">${axis}</div><div class="month-pop-column" style="height:${(end-start)*48}px">${marks}</div></div>`:'';
 const cards=entries.map(e=>`<button type="button" class="month-pop-shift month-selected-shift team-tone-${esc(e.teamTone)}" data-month-person="${esc(e.id)}"><strong>${esc(e.name)}</strong><span>${esc(e.hours)}</span><span>${esc(e.teamLabel)}</span>${e.issues.length?`<span>Needs review: ${esc(e.issues.join('; '))}</span>`:''}</button>`).join('');
 const untimed=view.unverified.map(id=>store.people.find(p=>p.id===id)?.name||`Unknown person (${id})`),statuses=selectedScheduleRows(row,store).filter(p=>p.state!=='On');
 const empty=row.state==='closed'?'Store closed':row.state!=='open'?'Store hours unknown':!view.recorded?'Schedule not recorded':entries.length?'':'No scheduled times';
 dialog.innerHTML=`<header class="month-pop-header"><h2 id="${scopeId}-month-pop-title">${esc(dateLabel(day))}</h2><button type="button" class="month-pop-close" aria-label="Close day schedule">${icon('close')}</button></header><div class="month-pop-body">${empty?`<p class="month-pop-state">${esc(empty)}</p>`:''}${timeline}${cards?`<div class="month-pop-list" aria-label="Scheduled shifts">${cards}</div>`:''}${untimed.length?`<p>Times unconfirmed: ${esc(untimed.join(', '))}</p>`:''}${statuses.length?`<div class="month-pop-statuses"><strong>Other statuses</strong>${statuses.map(p=>`<p>${esc(p.name)} · ${esc(p.state)}</p>`).join('')}</div>`:''}</div><footer><button type="button" class="month-pop-edit" ${row.state==='open'?'':'disabled'}>Edit day</button></footer>`;
 let restore=true;dialog.onclose=()=>{if(restore&&opener?.isConnected)opener.focus({preventScroll:true});};dialog.oncancel=e=>{e.preventDefault();dialog.close();};dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}};
 dialog.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dialog.close();return;}if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll('button:not([disabled]),[tabindex="0"]')].filter(el=>el.getClientRects().length);if(!items.length)return;const i=items.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&(i<0||i===items.length-1)){e.preventDefault();items[0].focus();}};
 dialog.querySelector('.month-pop-close').onclick=()=>dialog.close();dialog.querySelector('.month-pop-edit').onclick=()=>{restore=false;dialog.close();quickEdit=true;editing=true;render();daySheet(day);};
 for(const card of dialog.querySelectorAll('[data-month-person]'))card.onclick=()=>{restore=false;dialog.close();startShiftTransfer(day,card.dataset.monthPerson,null,opener);};
 dialog.showModal();dialog.querySelector('.month-pop-close').focus({preventScroll:true});
}
function render(focusId, announcement = "") {
  try { return renderNow(focusId, announcement); } finally { if (!disposed) { try { planner.observe(); } catch {} } }
}
function renderNow(focusId, announcement = "") {
  if (disposed) return;
  activeResize?.();activeResize=null;
  closeAgendaDrag(); closeAgendaDrag=()=>{};
  closeShiftTransfer(); closeShiftTransfer=()=>{};
  closeDirectShift(); closeDirectShift=()=>{};
  if(generationDetour && !returningToGeneration())generationDetour=null;
  closeOffDay();
  closeMobileDay(false);
  closeGeneration();
  closeImport();
  if (!selectedDay?.startsWith(month)) selectedDay = initialDay();
  Object.assign(app.dataset,{hapticMonth:month,hapticDate:selectedDay,hapticView:String(editing)+mode});
  app.classList.toggle("planning-workspace", editing);
  const dates = monthDays(month),
    list = rows(),
    d = draft(),
    issues = list.reduce((n, r) => n + r.issues.length, 0);
  const sales = monthSales(d.store, month, today());
  historicalView = historicalCalendar(d.store.history,month);
  const historicalDays=new Map(historicalView.days.map(d=>[d.day,d]));
  const heat = new Map(salesHeat(d.store, month, today()).map(r => [r.day, r]));
  const reviewed = d.accepted && d.reviewFingerprint === fingerprint(list);
  const byDay = new Map(list.map((r) => [r.day, r]));
  content.innerHTML = `<div class="toolbar">${embeddedPlanner?'':`<button id="preview-back" aria-label="Back to dashboard">${icon("arrowleft")}<span class="sr-only">Back to dashboard</span></button>`}<button id="workspace" aria-label="${editing?'Return to manager view':'Make Schedule'}" title="${editing?'Return to manager view':'Make Schedule'}" class="${editing?'':'primary'}">${icon(editing?"arrowleft":"calendar")}${editing?'<span>Done</span>':'<span class="sr-only">Make Schedule</span><span class="schedule-add" aria-hidden="true">+</span>'}</button></div>
 <div class="month-navigation"><nav class="period-control" aria-label="${monthExpanded?'Month':'Week'} navigation"><button type="button" id="previous" aria-label="Previous ${monthExpanded?'month':'week'}" ${(monthExpanded?month==='2014-01':!validMonth(addDays(selectedDay,-7).slice(0,7)))?'disabled':''}>${icon("arrowleft")}</button><button id="period-heading" popovertarget="month-picker" aria-label="Choose month, ${monthLabel(month)}">${monthLabel(month)}</button><button type="button" id="next" aria-label="Next ${monthExpanded?'month':'week'}" ${(monthExpanded?month==='2100-12':!validMonth(addDays(selectedDay,7).slice(0,7)))?'disabled':''}>${icon("arrow")}</button></nav><button id="today">Today</button></div>
 <div id="month-picker" class="scheduler-popover" popover role="dialog" aria-label="Choose month"><label>Month (YYYY-MM)<input id="month" type="text" maxlength="7" value="${month}" min="2014-01" max="2100-12" pattern="[0-9]{4}-[0-9]{2}" placeholder="YYYY-MM" required></label><button data-dismiss="month-picker">Done</button></div>

 ${editing ? `<nav class="schedule-tools editor-tools" aria-label="Schedule tools"><strong class="editing-indicator" aria-label="Editing draft">Editing</strong><button id="direct-add" aria-label="Add shift" title="Add shift"><span aria-hidden="true" class="direct-plus">+</span></button><button id="generate-month" aria-label="Generate month" title="Generate month">${icon('calendar')}</button><button id="import-schedule" aria-label="Import schedule" title="Import schedule">${icon('arrow')}</button><button id="off-day-tools" aria-label="Move or copy off-day" title="Move or copy off-day">${icon('roundup')}</button>${lastOffDayUndo?.index===selected?'<button id="off-day-undo" aria-label="Undo off-day change">Undo</button>':''}<button id="setup" aria-label="Schedule setup" title="Schedule setup" aria-expanded="false" >${icon('gear')}</button></nav><section id="editor-setup" class="panel" hidden aria-label="Schedule setup"><h2 tabindex="-1">Schedule setup</h2><div class="actions"><button id="teams">Teams</button><button id="people">${icon("users")}People</button><button id="rules">${icon("clock")}Store hours</button></div><button id="close-setup">Back to month</button></section>` : ""}
 <section id="generation-sheet" class="panel" hidden aria-label="Monthly schedule generation"></section>
 <section id="off-day-sheet" class="panel" hidden aria-label="Off-day operation"></section>
 <section id="shift-sheet" class="panel" hidden aria-label="Shift operation"></section>
 <section id="import-sheet" class="panel" hidden aria-label="Import schedule review"></section>
 <section id="settings-sheet" class="panel" hidden aria-label="Planning settings"></section>

 ${editing&&[...pendingAssignments.keys()].some(k=>k.startsWith(`${selected}:${month}`))?'<p class="month-pending" role="status">Pending day choices kept in this page. Open a date to apply or cancel.</p>':''}
 ${shiftAgendaMarkup(list)}
 <div class="schedule-layout"><section class="calendar-pane month-disclosure" ${monthExpanded?'':'hidden'} aria-label="Month calendar"><div class="month-controls"><label class="calendar-view-switch"><span class="sr-only">Calendar view</span><select data-view-switch aria-label="Calendar view"><option value="week">Week view</option><option value="month" selected>Month view</option></select></label></div><div class="calendar-context"><span>${editing ? "Shading: history · Numbers: coverage" : "Teams with scheduled people · Delivered: — pending · ? unknown"}</span></div>
 <p class="calendar-list-label">Day list · enlarged text</p><p class="sr-only" id="${scopeId}-day-plan-help">${monthLabel(month)}. Open this date’s daily plan.</p>
 <section class="month-days" aria-label="${monthLabel(month)} daily plans"><span class="calendar-swipe-strip" aria-hidden="true">${icon("arrowleft")}<span></span>${icon("arrow")}</span>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => `<span class="weekday-heading">${n}</span>`).join("")}${calendarCells(
   month,
 )
   .map((day) => {
     if (!day) return '<span class="calendar-blank" aria-hidden="true"></span>';
     const r = byDay.get(day),
       sales = heat.get(day), staff = staffing(r), history=historicalDays.get(day);
     const alert=calendarWarning(r,staff),warning=alert?.kind,mini=editing?null:monthSchedulePreview(r,d.store);
     return `<button class="month-day ${r.state} staff-${warning||'normal'} ${historyClass(history.level)} ${day===today()?'is-today':''}" id="day-${day}" data-day="${day}" data-status="${alert?.label||staff.status}" data-schedule-label="${esc(mini?mini.label:r.record?`${(r.record.on||[]).length} recorded on`:'Schedule not recorded')}" data-sales-label="${esc(`Delivered: ${sales.state==='known'?sales.units:sales.state==='future'?'pending':sales.state==='closed'?'closed':'unknown'}`)}" data-history-label="${esc(historyLabel(history))}" data-verified-low="${verifiedLow(r,staff)}" ${day===today()?'aria-current="date"':''} aria-pressed="${day===selectedDay}" aria-describedby="${scopeId}-day-plan-help"><span class="day-date"><span class="day-weekday">${names[new Date(day+'T12:00:00Z').getUTCDay()]} </span>${Number(day.slice(-2))}</span>${editing?`<span class="schedule-slot">${scheduleMarker(warning||(r.state==='closed'?'closed':r.state!=='open'?'unknown':null))}</span>`:mini.markup+(['Schedule conflict','Low staff'].includes(alert?.label)?'<span class="month-shift-warning" aria-hidden="true">!</span>':'')}<span class="day-coverage">${r.state==='open'?`${r.minimumCoverage===null?"Coverage unknown":`${r.minimumCoverage}/${r.required} coverage`}`:r.state==='closed'?'Closed':'Hours unknown'}</span><small class="day-sales sales-${sales.state}">${deliveredMarkup(sales)}</small>${r.override?'<span class="day-edited sr-only">Edited in this page</span>':''}</button>`;
   })
   .join("")}</section></section><section id="sheet" class="panel day-panel" tabindex="0" aria-label="Selected day roster"></section></div><dialog id="month-day-popup" aria-labelledby="${scopeId}-month-pop-title"></dialog>${embeddedPlanner?'<section id="mobile-day-dialog" class="embedded-day-page" role="region" aria-label="Selected day" hidden></section>':'<dialog id="mobile-day-dialog" aria-label="Selected day"></dialog>'}

 ${editing ? `<details class="month-review"><summary>Review month · ${issues ? `${issues} to resolve` : reviewed ? "Reviewed" : "Ready for review"}</summary>${balancePanel()}<div id="selected-week-audit">${weeklyAuditMarkup(selectedDay||month+"-01")}</div><div class="actions"><button id="accept" class="primary">${icon("check")}Mark reviewed</button><button id="reset">${icon("roundup")}Reset this draft</button></div></details>` : ""}

 ${editing ? `<p id="message" role="status">${esc(announcement)}</p>
 ${PREVIEW?`<details class="panel review"><summary>About this draft</summary><p>Connected month and roster viewing is separate from deliberate people and coverage editing. This is a fictional preview, not a published staff schedule.</p><p>Each store/month starts with a separate copy of fictional availability and store rules. Edits to those settings apply only inside that month’s draft; they are not automatically copied into other months. Returning to Performance keeps applied drafts while this page stays open. Reset affects assignments and settings only in the selected store/month. Dated team history remains until explicitly edited.</p><p>Weekly person limits run Monday–Sunday, including earlier dates from the previous month. Those dates use that month’s draft if one exists, otherwise fictional defaults. Editing an earlier month can change a later month’s boundary-week suggestions and invalidate its review; explicit overrides remain intact.</p><p>Six fictional stores have synthetic history from 1 Jan 2014 to 13 Oct 2026. Explicit NA is Closed, missing is Unknown, and zero means zero delivered cars. Ranges illustrate prior same-weekday counts, not validated forecasts. Future months reuse the available fictional history; there is no future observation.</p></details>`:`<details class="panel review"><summary>About this draft</summary><p>Nothing here is saved to the schedule. Changes stay in this page, and closing the editor discards them.</p></details>`}
 <details class="footer"><summary>Shift limits</summary><p>Manual On uses full store hours. Imported CSV shifts keep exact minutes. No overnight shifts, DST-change dates, breaks, appointments, overtime policy, database connection or publishing.</p></details>` : `<p id="message" role="status">${esc(announcement)}</p>`}<footer class="calendar-reference" aria-label="Calendar key and history"> ${editing?`<section class="month-history" aria-label="Historical delivery context"><div><strong>Historical average · matching months</strong><span>${historicalView.month.average===null?'Unavailable':`${historicalView.month.average.toFixed(1)} delivered`}</span></div><button id="sales-key" class="history-legend" popovertarget="sales-help" aria-label="Recent weekday pattern: quieter to busier sales. Open samples and calendar key"><span>Historical deliveries</span>${historyScale()}</button></section>`:`<button id="sales-key" class="history-legend" popovertarget="sales-help">Calendar key</button>`} <div id="sales-help" class="scheduler-popover" popover role="dialog" aria-label="Calendar key"><h2>Calendar key</h2>${editing?`<h3>Historical deliveries</h3>${historyScale()}`:''}<h3>Staffing</h3>${editing?scheduleKey():`<ul class="schedule-key"><li><span aria-hidden="true">▮</span><span>Each chip shows a team or person with scheduled work</span></li><li><span aria-hidden="true">+N</span><span>Additional teams or people</span></li><li><span>Times ?</span><span>Some assignment times are missing or unverified</span></li><li><span aria-hidden="true">!</span><span>Schedule conflict or low staff</span></li><li><span>Closed</span><span>Store closed</span></li><li><span>No plan</span><span>Schedule not recorded</span></li><li><span>Hours ?</span><span>Store hours unknown</span></li></ul>`}<details id="roster-options"><summary>Roster grouping</summary><label>Roster display mode<select id="mode">${["team","individual","mixed"].map(m=>`<option ${mode===m?"selected":""}>${m}</option>`).join("")}</select></label></details><p>Delivered = actual recorded total.</p><details><summary>How to read this</summary><p>Needs review: missing schedule, conflict or unconfirmed coverage. Low staff: confirmed coverage below the minimum. These markers do not describe sales.</p><p>${editing?'Hatching means too little history, not zero. ':''}In Delivered, 0 is recorded zero; Unknown is missing, Pending is not yet available, and Closed is a recorded closure.</p></details><button data-dismiss="sales-help">Close calendar key</button></div></footer>`;
  const calendarMeta=app.querySelector('.calendar-reference');app.querySelector('.month-disclosure').append(calendarMeta);
  dock.replaceChildren(content.querySelector('#workspace'));
  const previewBack=document.querySelector('#preview-back');
  if(previewBack)previewBack.onclick=()=>{
    if(hasLocalDraft()&&!window.confirm('Return to the preview dashboard and discard this page’s draft changes? Changes are only kept while this planner page stays open.'))return;
    leavingPreview=true;
    if(typeof opts.onExit==='function')opts.onExit();
  };
  const offButton=document.querySelector('#off-day-tools');if(offButton)offButton.onclick=()=>startOffDay(selectedDay||month+'-01');
  const undoButton=document.querySelector('#off-day-undo');if(undoButton)undoButton.onclick=()=>{try{if(lastOffDayUndo.index!==selected)throw Error('Return to the source store before undo.');if(hasPendingChoices())throw Error('Apply or cancel pending choices before undo.');const result=planner.undoOffDay(lastOffDayUndo);lastOffDayUndo=null;month=result.from.slice(0,7);selectedDay=result.from;render(undefined,'Off-day change undone. Original records restored.');daySheet(result.from);pulseOffDay(result.personId);}catch(error){document.querySelector('#message').textContent=error.message;document.querySelector('#message').scrollIntoView({block:'nearest'});}};
  const importButton = document.querySelector("#import-schedule");
  if(importButton) importButton.onclick = () => {
    if([...pendingAssignments.keys()].some(key=>key.startsWith(selected+':')) || [...pendingSettings.keys()].some(key=>key.startsWith(selected+':'))) { document.querySelector('#message').textContent='Apply or cancel your pending day and settings edits before importing.'; return; }
    closeImport();
    closeImport = openScheduleImport({host:document.querySelector('#import-sheet'),planner,index:selected,month,onApply:result=>{if(result.changed){selectedDay=result.firstDay;month=selectedDay.slice(0,7);}render('import-schedule',result.changed?`Applied reviewed source entries to ${result.changed} dates${PREVIEW?'':' in this page'}.${result.skipped?` ${result.skipped} entries skipped.`:''}`:`No changes. ${result.skipped||0} entries skipped; existing facts kept.`);},onClose:()=>importButton.focus()});
  }
  bindHistoryPopovers(app);
  document.querySelector("#month").onchange = (e) => {
    if (!validMonth(e.target.value)) {
      e.target.setCustomValidity(
        "Choose a month from January 2014 to December 2100.",
      );
      e.target.reportValidity();
      return;
    }
    const number=Number(selectedDay.slice(-2));
    month = e.target.value;selectedDay=monthDays(month)[Math.min(number,monthDays(month).length)-1];timelineScroll.left=null;
    render("period-heading");
  };
  for (const [id, delta] of [
    ["previous", -1],
    ["next", 1],
  ])
    document.getElementById(id).onclick = () => {
      if(monthExpanded){if((delta<0&&month==='2014-01')||(delta>0&&month==='2100-12'))return;const number=Number(selectedDay.slice(-2));const next=shiftMonth(month,delta);month=next;selectedDay=monthDays(next)[Math.min(number,monthDays(next).length)-1];}
      else {const next=addDays(selectedDay,delta*7);if(!validMonth(next.slice(0,7)))return;selectedDay=next;month=next.slice(0,7);}
      timelineScroll.left=null;render(id);
    };
  document.querySelector("#today").onclick = () => {
    selectedDay=today();month=selectedDay.slice(0,7);timelineScroll.left=null;
    render("today");
  };
  document.querySelector("#mode").onchange = e => { mode = e.target.value; render(); const options=document.querySelector("#roster-options"),help=app.querySelector('[data-popover-key="sales-help"]');if(options)options.open=true;if(help){help.showPopover();document.querySelector("#mode")?.focus();} };
  document.querySelector("#workspace").onclick = () => { quickEdit = false; editing = !editing; render("workspace"); };
  if(editing){
    document.querySelector("#direct-add").onclick=()=>openDirectShift(selectedDay);
    document.querySelector("#generate-month").onclick=startGeneration;
    const setup=document.querySelector('#editor-setup'),trigger=document.querySelector('#setup');
    trigger.onclick=()=>{closeGeneration();closeImport();setup.hidden=!setup.hidden;trigger.setAttribute('aria-expanded',String(!setup.hidden));if(!setup.hidden)setup.querySelector('h2').focus();};
    document.querySelector('#close-setup').onclick=()=>{setup.hidden=true;trigger.setAttribute('aria-expanded','false');focusControl(trigger);};
    setup.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();document.querySelector('#close-setup').click();}};
  }

  wireWeek();
  if(editing)document.querySelector('#teams').onclick=()=>{
    closeImport();
    document.querySelector('#editor-setup').hidden=true;document.querySelector('#setup').setAttribute('aria-expanded','false');
    if([...pendingAssignments.keys()].some(k=>k.startsWith(selected+':'))||[...pendingSettings.keys()].some(k=>k.startsWith(selected+':'))){document.querySelector('#message').textContent='Apply or cancel pending edits before changing teams.';return;}
    openTeamEditor({host:document.querySelector('#settings-sheet'),planner,index:selected,month,onDone:()=>render('teams',`Dated membership saved${PREVIEW?'':' in this page'}. Existing assignment teams remain until reviewed.`),onCancel:()=>{document.querySelector('#settings-sheet').hidden=true;focusControl(document.querySelector('#setup'));}});
  };

  if (editing) document.querySelector("#people").onclick = () => personSheet();
  if (editing) document.querySelector("#rules").onclick = () => storeSheet();
  document
    .querySelectorAll("[data-day]")
    .forEach((el) => (el.onclick = () => { if(editing){daySheet(el.dataset.day, undefined, hostWindow.innerWidth<=700||app.classList.contains("stacked-workspace"));}else{selectedDay=el.dataset.day;updateSelection();openMonthDay(selectedDay,el);} }));
  if (editing) document.querySelector("#reset").onclick = () => {
    if(!window.confirm("Reset this month’s assignments and settings? This cannot be undone."))return;
    for (const drafts of [pendingAssignments,pendingSettings]) for (const key of drafts.keys()) if (key.startsWith(`${selected}:${month}`)) drafts.delete(key);
    generationAnswers.delete(generationKey());generationDetour=null;absenceRecoveryNotice=null;
    planner.reset(selected, month);
    render("reset");
    document.querySelector("#message").textContent =
      "Only this store’s selected month was reset.";
  };
  if (editing) document.querySelector("#accept").onclick = () => {
    if (issues) {
      document.querySelector("#message").textContent =
        "Resolve coverage, availability and unknown status before marking this month reviewed.";
      feedback("refused");
      return;
    }
    localSettingsChanged=true;d.accepted = true;
    d.reviewFingerprint = fingerprint(list);
    render("accept","Month marked reviewed in this page.");feedback("taken");
  };
  // A neighboring-month edit can change the current hero's complete-week caps.
  for (const summaryMonth of new Set([month, today().slice(0, 7)])) {
    const summaryRows = summaryMonth === month ? list : planner.rows(selected, summaryMonth), summaryStore = summaryMonth === month ? d.store : planner.get(selected, summaryMonth).store;
    const statuses = summaryRows.map(r => assignmentSummary(summaryStore.people, [], r.record, r));
    window.parent.dispatchEvent(new CustomEvent("scheduler-summary", { detail: { store: summaryStore.id, month: summaryMonth, needs: statuses.filter(s=>s.status==="Needs schedule").length, low: statuses.filter(s=>s.status==="Low staff").length, conflicts: summaryRows.filter(r=>Object.keys(r.conflicts).length).length, ...(PREVIEW ? {} : { hoursUnknown: summaryRows.filter(r=>r.state!=="open"&&r.state!=="closed").length }) } }));
  }
  syncCalendarLayout();
  document.querySelector("#sheet").hidden = true;
  if (focusId) {
    if(editing&&["teams","people","rules"].includes(focusId))focusId="setup";
    const target = document.getElementById(focusId);
    focusControl(target?.disabled ? document.getElementById("period-heading") : target, {
      preventScroll: true,
    });
  }
}
const hasPendingChoices=()=>[...pendingAssignments.keys(),...pendingSettings.keys()].some(k=>k.startsWith(selected+':'));
function startShiftTransfer(from,personId,destination=null,opener=null){
 if(hasPendingChoices()){const message=app.querySelector('#message');message.textContent='Apply or cancel pending choices first.';message.tabIndex=-1;message.focus();return;}
 closeShiftTransfer();
 closeShiftTransfer=openShiftTransferCommand({host:app.querySelector('#shift-sheet'),planner,index:selected,from,personId,initialDestination:destination,hasPending:hasPendingChoices,onClose:()=>{closeShiftTransfer=()=>{};if(opener?.isConnected)opener.focus({preventScroll:true});else render();},onApply:result=>{closeShiftTransfer();closeShiftTransfer=()=>{};selectedDay=result.to;month=result.to.slice(0,7);render(undefined,`${result.personName}'s shift ${result.mode==='move'?'moved':'copied'} in this page.`);}});
}
function openDirectShift(day,start,original=null) {
 if(hasPendingChoices()){const message=app.querySelector('#message');message.textContent='Apply or cancel pending choices first.';message.focus();return;}

 closeShiftTransfer();closeDirectShift();const host=app.querySelector('#shift-sheet'),store=planner.context(selected,day).store;
 const background=[...content.children].filter(el=>el!==host).map(el=>[el,el.inert]),dock=document.querySelector('[data-scheduler-dock]'),dockInert=dock?.inert;
 for(const [el] of background)el.inert=true;if(dock)dock.inert=true;
 const backdrop=document.createElement('div');backdrop.className='direct-backdrop';backdrop.setAttribute('aria-hidden','true');content.append(backdrop);
 host.hidden=false;host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label',original?'Adjust shift':'Add shift');
 const sourceOriginal=original?{startMinute:original._originalStart??original.startMinute,endMinute:original._originalEnd??original.endMinute}:null;
 const choices=store.people.map(p=>`<option value="${esc(p.id)}" ${original?.personId===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
 host.innerHTML=`<button type="button" id="direct-close" aria-label="Close shift editor">${icon('close')}</button><h2 tabindex="-1">${original?'Adjust shift':'Add shift'}</h2><p>${esc(dateLabel(day))}</p><form id="direct-form"><label>Person<select id="direct-person" required ${original?'disabled':''}><option value="">Choose person</option>${choices}</select></label><label>Start<input id="direct-start" type="time" required value="${Number.isInteger(start)?timeLabel(start):original?timeLabel(original.startMinute):''}"></label><label>End<input id="direct-end" type="time" required value="${original?timeLabel(original.endMinute):''}"></label><p id="direct-error" role="alert"></p><p id="direct-review" role="status"></p><div class="shift-actions"><button type="button" id="direct-cancel">Cancel</button>${original?'<button type="button" id="direct-transfer">Move / Copy</button>':''}<button type="submit" id="direct-review-button">Review</button><button type="button" id="direct-apply" hidden>Apply</button></div></form>`;
 const $=q=>host.querySelector(q);let review=null,disposed=false,dirty=original?Boolean((Number.isInteger(start)&&start!==(original._originalStart??original.startMinute))||original.endMinute!==(original._originalEnd??original.endMinute)):Number.isInteger(start);directDirty=dirty;
 const dispose=()=>{if(disposed)return;disposed=true;directDirty=false;backdrop.remove();for(const [el,inert] of background)el.inert=inert;if(dock)dock.inert=dockInert;host.hidden=true;host.replaceChildren();host.removeAttribute('role');host.removeAttribute('aria-modal');host.removeAttribute('aria-label');};
 const close=()=>{if(dirty&&!confirm('Discard unapplied shift changes?'))return;dispose();app.querySelector(original?`[data-agenda-day="${CSS.escape(day)}"][data-agenda-shift="${CSS.escape(original.personId)}"]`:'#direct-add')?.focus({preventScroll:true});};
 closeDirectShift=dispose;$('#direct-cancel').onclick=close;$('#direct-close').onclick=close;backdrop.onclick=close;
 if(original)$('#direct-transfer').onclick=()=>{if(dirty&&!confirm('Discard unapplied shift changes?'))return;dispose();startShiftTransfer(day,original.personId,null,app.querySelector(`[data-agenda-day="${CSS.escape(day)}"][data-agenda-shift="${CSS.escape(original.personId)}"]`));};
 for(const input of host.querySelectorAll('input,select')){const changed=()=>{dirty=true;directDirty=true;review=null;$('#direct-review').textContent='';$('#direct-apply').hidden=true;$('#direct-review-button').hidden=false;};input.addEventListener('input',changed);input.addEventListener('change',changed);}
 $('#direct-form').onsubmit=e=>{e.preventDefault();$('#direct-error').textContent='';try{if(hasPendingChoices())throw Error('Apply or cancel pending choices first.');review=planner.reviewDirectShift({index:selected,day,personId:$('#direct-person').value,startMinute:minute($('#direct-start').value),endMinute:minute($('#direct-end').value),original:sourceOriginal});$('#direct-review').textContent=`${review.personName} · ${displayTime(review.startMinute)} to ${displayTime(review.endMinute)}. No changes applied yet.`;$('#direct-apply').hidden=false;$('#direct-review-button').hidden=true;$('#direct-apply').focus();}catch(error){$('#direct-error').textContent=error.message;$('#direct-error').tabIndex=-1;$('#direct-error').focus();}};
 $('#direct-apply').onclick=()=>{try{if(hasPendingChoices())throw Error('Apply or cancel pending choices first.');const result=planner.applyDirectShift(review);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)feedback('tick');dispose();selectedDay=result.day;month=result.day.slice(0,7);timelineScroll.left=null;render(undefined,`${result.personName} · ${displayTime(result.startMinute)} to ${displayTime(result.endMinute)} applied in this page.`);app.querySelector('#direct-add')?.focus({preventScroll:true});}catch(error){review=null;$('#direct-error').textContent=error.message;$('#direct-apply').hidden=true;$('#direct-review-button').hidden=false;$('#direct-error').focus();}};
 host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key==='Tab'){const items=[...host.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]),select:not([disabled])')].filter(el=>el.getClientRects().length);const i=items.indexOf(document.activeElement);if(items.length&&((e.shiftKey&&i<=0)||(!e.shiftKey&&i===items.length-1))){e.preventDefault();(e.shiftKey?items.at(-1):items[0]).focus();}}};
 $('h2').focus();
}
function wireDirectGrid(){
 for(const column of app.querySelectorAll('.timeline-column[data-grid-day]'))column.addEventListener('click',event=>{if(event.target.closest('.timeline-event')||column.dataset.gridDisabled==='true')return;const grid=app.querySelector('.timeline-scroll'),unit=parseFloat(hostWindow.getComputedStyle(grid).getPropertyValue('--timeline-hour'));const minuteAt=Math.max(0,Math.min(1425,Math.round((event.clientY-column.getBoundingClientRect().top)/unit*4)*15));openDirectShift(column.dataset.gridDay,minuteAt);});
 for(const edge of app.querySelectorAll('[data-resize-edge]')){let suppress=false;const silence=()=>{suppress=true;setTimeout(()=>{suppress=false;},250);},owner=edge.closest('.timeline-event');edge.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});owner.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},true);edge.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(hasPendingChoices()){const status=app.querySelector('#agenda-drag-status');if(status)status.textContent='Finish or discard the open review first.';return;}event.stopPropagation();const button=owner,grid=app.querySelector('.timeline-scroll'),startY=event.clientY,start=Number(button.dataset.start),end=Number(button.dataset.end),kind=edge.dataset.resizeEdge,unit=parseFloat(hostWindow.getComputedStyle(grid).getPropertyValue('--timeline-hour'));if(!Number.isFinite(unit)||unit<=0)return;let active=event.pointerType!=='touch',moved=false;const old=button.draggable,oldTop=button.style.top,oldHeight=button.style.height;button.draggable=false;const timer=event.pointerType==='touch'?setTimeout(()=>{active=true;edge.setPointerCapture(event.pointerId);},450):null;if(active)edge.setPointerCapture(event.pointerId);
 const stop=()=>{if(activeResize===stop)activeResize=null;clearTimeout(timer);if(edge.hasPointerCapture(event.pointerId))edge.releasePointerCapture(event.pointerId);button.draggable=old;button.style.top=oldTop;button.style.height=oldHeight;hostWindow.removeEventListener('keydown',escape,true);edge.removeEventListener('pointermove',move);edge.removeEventListener('pointerup',up);edge.removeEventListener('pointercancel',cancel);};const escape=e=>{if(e.key==='Escape'){e.preventDefault();silence();stop();button.focus({preventScroll:true});const status=app.querySelector('#agenda-drag-status');if(status)status.textContent='Resize canceled. Nothing changed.';}};hostWindow.addEventListener('keydown',escape,true);
 const move=e=>{if(!active&&Math.abs(e.clientY-startY)>8){stop();return;}if(active&&Math.abs(e.clientY-startY)>4){moved=true;e.preventDefault();const delta=Math.round((e.clientY-startY)/unit*4)*15,proposed=kind==='start'?Math.max(0,Math.min(end-15,start+delta)):Math.max(start+15,Math.min(1439,end+delta));button.style.top=`calc(var(--timeline-hour) * ${(kind==='start'?proposed:start)/60})`;button.style.height=`calc(var(--timeline-hour) * ${(kind==='start'?end-proposed:proposed-start)/60})`;const status=app.querySelector('#agenda-drag-status');if(status)status.textContent=`Proposed ${displayTime(kind==='start'?proposed:start)} to ${displayTime(kind==='end'?proposed:end)}. Release to review.`;}};
 const up=e=>{const delta=Math.round((e.clientY-startY)/unit*4)*15,next=kind==='start'?Math.max(0,Math.min(end-15,start+delta)):Math.max(start+15,Math.min(1439,end+delta));stop();if(!active||!moved||!delta)return;silence();e.preventDefault();e.stopPropagation();const original={personId:button.dataset.agendaShift,startMinute:start,endMinute:end};openDirectShift(button.dataset.agendaDay,kind==='start'?next:start,{...original,endMinute:kind==='end'?next:end,_originalStart:start,_originalEnd:end});};
 activeResize=stop;const cancel=()=>stop();edge.addEventListener('pointermove',move);edge.addEventListener('pointerup',up);edge.addEventListener('pointercancel',cancel);
 });}
}
function wireWeek(){
 for(const select of app.querySelectorAll('[data-view-switch]'))select.onchange=()=>{monthExpanded=select.value==='month';render();app.querySelector('[data-view-switch]')?.focus({preventScroll:true});};
 for(const button of app.querySelectorAll('[data-week-day]'))button.onclick=()=>{const day=button.dataset.weekDay;if(!validMonth(day.slice(0,7)))return;selectedDay=day;month=day.slice(0,7);timelineScroll.left=null;render();app.querySelector(`[data-week-day="${hostWindow.CSS.escape(day)}"]`)?.focus({preventScroll:true});};
 for(const button of app.querySelectorAll('[data-agenda-shift]'))button.onclick=()=>{if(editing&&button.dataset.start!==undefined)openDirectShift(button.dataset.agendaDay,undefined,{personId:button.dataset.agendaShift,startMinute:Number(button.dataset.start),endMinute:Number(button.dataset.end)});else startShiftTransfer(button.dataset.agendaDay,button.dataset.agendaShift,null,button);};
 if(editing)wireDirectGrid();
 const edit=app.querySelector('#schedule-edit-day');if(edit)edit.onclick=()=>{editing=true;quickEdit=true;render();daySheet(selectedDay);};
 const review=app.querySelector('#timeline-review');if(review)review.onclick=()=>{const list=app.querySelector('.timeline-issues,.timeline-unverified');if(list){list.open=true;list.querySelector('summary')?.focus();}};
 const grid=app.querySelector('.timeline-scroll');if(grid){const week=grid.dataset.week;if(timelineScroll.week!==week)timelineScroll={top:null,left:null,week};const start=Number(grid.dataset.frameStart),end=Number(grid.dataset.frameEnd),available=Math.max(1,grid.clientHeight-(grid.querySelector('.timeline-day-head')?.offsetHeight||0)),unit=Math.min(56,Math.max(24,available/Math.max(1,(end-start)/60+.3)));grid.style.setProperty('--timeline-hour',`${unit}px`);const column=grid.querySelector(`[data-grid-day="${hostWindow.CSS.escape(selectedDay)}"]`);grid.scrollTop=timelineScroll.top??Math.max(0,start*unit/60-unit*.15);const axisWidth=grid.querySelector('.timeline-axis')?.offsetWidth||72;grid.scrollLeft=timelineScroll.left??Math.max(0,(column?.offsetLeft||0)-axisWidth-Math.max(0,(grid.clientWidth-axisWidth-(column?.offsetWidth||0))/2));grid.addEventListener('scroll',()=>{timelineScroll={top:grid.scrollTop,left:grid.scrollLeft,week};},{passive:true});}
 closeAgendaDrag=bindAgendaDrag({app,scrollRoot:content,planner,index:selected,hasPending:hasPendingChoices,onDrop:({from,person,to})=>startShiftTransfer(from,person,to),onTimeDrop:editing?({from,person,start,end,proposedStart,proposedEnd})=>openDirectShift(from,proposedStart,{personId:person,startMinute:start,endMinute:proposedEnd,_originalStart:start,_originalEnd:end}):null});
}
function pulseOffDay(id){const row=[...document.querySelectorAll('[data-edit-person]')].find(e=>e.dataset.editPerson===id);if(row&&!hostWindow.matchMedia('(prefers-reduced-motion: reduce)').matches)row.animate([{opacity:.65},{opacity:1}],{duration:160,easing:'ease-out'});document.querySelector('.day-heading')?.focus();}
function startOffDay(from,personId){
 if(hasPendingChoices()){
  // The day editor's alert is empty, and so hidden by CSS, until it has text: judge the editor, not the alert's current box.
  const local=document.querySelector('#day-error'),inEditor=local&&!local.closest('[inert],[hidden],dialog:not([open])'),message=inEditor?local:document.querySelector('#message');
  message.textContent='Apply or cancel pending day and settings choices first.';message.tabIndex=-1;message.focus();message.scrollIntoView({block:'nearest'});return;}
 closeMobileDay(false);closeImport();closeGeneration();closeOffDay();
 closeOffDay=openOffDayCommand({host:document.querySelector('#off-day-sheet'),planner,index:selected,from,personId,hasPending:hasPendingChoices,onClose:()=>{render('off-day-tools');if(personId){daySheet(from);[...document.querySelectorAll('[data-off-person]')].find(e=>e.dataset.offPerson===personId)?.focus();}},onApply:undo=>{lastOffDayUndo=undo;month=undo.to.slice(0,7);selectedDay=undo.to;render(undefined,`${undo.mode==='move'?'Moved':'Copied'} ${undo.personName}'s off-day. ${undo.mode==='move'?'Source is Unknown. ':''}Undo is available until another edit.`);daySheet(undo.to);pulseOffDay(undo.personId);}});
}
function startGeneration() {
  // Eligibility, roles and comparable-store demand are fictional samples in the generator; a live store has none of them yet.
  if (!PREVIEW) { const note = document.querySelector("#message"); if (note) note.textContent = "Making a monthly draft is not available yet: this store’s eligibility, roles and comparable stores are not connected."; return; }
  if([...pendingAssignments.keys(),...pendingSettings.keys()].some(k=>k.startsWith(selected+":"))){document.querySelector("#message").textContent="Apply or cancel pending edits before generating a month.";return;}
  closeGeneration();closeImport();
  const key=generationKey();
  // A month change saves the raw inputs under the month being left, including unfinished fields.
  const visit=opener=>answers=>{generationAnswers.set(key,answers);generationDetour=key;opener();};
  closeGeneration=openGeneration({host:document.querySelector("#generation-sheet"),planner,index:selected,month,mode,initialAnswers:generationAnswers.get(key),onAnswers:answers=>generationAnswers.set(key,answers),onMonth:(value,answers)=>{generationAnswers.set(key,{...answers,fields:answers.fields.map(field=>field.name==='month'?{...field,value:month}:field)});generationDetour=null;month=value;selectedDay=null;render();startGeneration();},onApply:result=>{generationAnswers.delete(key);generationDetour=null;mode=result.mode;editing=true;render("generate-month",result.status==="covered"?"Draft applied${PREVIEW?'':' in this page'}. Review before use. Manual edits lock that date.":"Incomplete generated draft applied in this page. Resolve the visible gaps before marking reviewed.");},onClose:()=>{generationAnswers.delete(key);generationDetour=null;render('generate-month');},onPeople:visit(()=>personSheet()),onRules:visit(()=>storeSheet())});
}
const reduceDayMotion=hostWindow.matchMedia('(prefers-reduced-motion: reduce)');
const dayMotion=createDayMotion({getLive:()=>document.querySelector('#sheet'),getHost:()=>document.querySelector('#mobile-day-dialog'),getDay:()=>selectedDay,neighbor:(day,delta)=>{const next=addDays(day,delta);return next.startsWith(month)?next:null;},markup:day=>{const row=motionRows.find(r=>r.day===day);return dayViewMarkup(row,staffing(row));},commit:(day,focusId)=>{const token=dayHapticToken;dayHapticToken=null;const changed=day!==selectedDay;daySheet(day);if(changed)feedback('tick',token);const control=focusId&&document.getElementById(focusId);if(control&&!control.disabled)control.focus({preventScroll:true});},reduced:()=>reduceDayMotion.matches});
listen(reduceDayMotion,'change',()=>{if(reduceDayMotion.matches){if(mobileDaySession?.closing)closeMobileDay();else dayMotion.finish();}});
async function requestCloseMobileDay(){cancelHaptics();if(editing){closeMobileDay();return;}const session=mobileDaySession;if(!session||session.closing)return;session.closing=true;if(await dayMotion.leave(lastDayInput==='touch')&&mobileDaySession===session)closeMobileDay();}
function closeMobileDay(restore = true) {
  if(restore)cancelHaptics();dayHapticToken=null;
  if(!mobileDaySession)return;
  dayMotion.cancel();
  const session=mobileDaySession;mobileDaySession=null;
  const dialog=document.querySelector('#mobile-day-dialog'),sheet=document.querySelector('#sheet');
  restoringDayFocus=true;if(embeddedPlanner){dialog.hidden=true;for(const element of session.inert||[])element.inert=false;}else dialog?.close();releaseDayClass();
  if(sheet)document.querySelector('.schedule-layout')?.append(sheet);
  if(editing){const pending=[...pendingAssignments.keys()].some(k=>k.startsWith(`${selected}:${month}`));let note=app.querySelector('.month-pending');if(pending&&!note){note=document.createElement('p');note.className='month-pending';note.setAttribute('role','status');app.querySelector('.schedule-layout').before(note);}if(note){note.textContent=pending?'Pending day choices kept in this page. Open a date to apply or cancel.':'';note.hidden=!pending;}}
  if(restore){document.getElementById(`day-${selectedDay}`)?.focus({preventScroll:true});window.scrollTo({top:session.scrollY,left:0,behavior:'instant'});}
  requestAnimationFrame(()=>{if(restore)window.scrollTo({top:session.scrollY,left:0,behavior:'instant'});restoringDayFocus=false;});
}
function showMobileDay(sheet) {
  const dialog=document.querySelector('#mobile-day-dialog');
  if(!mobileDaySession){mobileDaySession={scrollY:editorReturnScroll??window.scrollY};editorReturnScroll=null;dialog.append(sheet);acquireDayClass();if(embeddedPlanner){mobileDaySession.inert=[...content.children,dock].filter(e=>e!==dialog&&!e.inert);for(const element of mobileDaySession.inert)element.inert=true;dialog.hidden=false;}else dialog.showModal();if(!editing)dayMotion.enter(lastDayInput==='touch');}
  dialog.oncancel=e=>{e.preventDefault();requestCloseMobileDay();};
  dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)requestCloseMobileDay();}};
  dialog.scrollTop=0;
}
function openSheet(html, openerId, isDay = false, focus = true, settingsId = "") {
  closeGeneration();
  const sheet = document.querySelector(isDay ? "#sheet" : "#settings-sheet");
  sheet.hidden = false;
  dayMotion.cancel();if(mobileDaySession)mobileDaySession.closing=false;
  sheet.innerHTML = html;
  bindHistoryPopovers(sheet);
  if(isDay&&hostWindow.innerWidth<=700&&(focus||mobileDaySession))showMobileDay(sheet);
  if (!isDay) {
    const setup=document.querySelector("#editor-setup");if(setup){setup.hidden=true;document.querySelector("#setup").setAttribute("aria-expanded","false");}
    closeImport();
    if(returningToGeneration()){
      const notice=document.createElement('p');notice.className='pending-note';notice.textContent='Your generation answers are kept. Apply or cancel these settings to return.';
      sheet.querySelector('h2').after(notice);
      sheet.querySelector('button.primary').textContent='Apply and return to generation';
      sheet.querySelector('[data-close]').textContent='Cancel settings and return to generation';
    }
    const key = `${selected}:${month}:${openerId}:${settingsId}`;
    sheet.dataset.pendingKey = key;
    const form = sheet.querySelector("form"), saved = pendingSettings.get(key);
    if (saved) for (const input of form.elements) {
      if (!input.name || input.name === "effective") continue;
      if (input.type === "checkbox") input.checked = (saved[input.name] || []).includes(input.value);
      else if (saved[input.name]) input.value = saved[input.name][0];
    }
    const holiday = form.querySelector('[name="editHoliday"]');
    if (holiday) for (const name of ["holiday","holidayState"]) form.querySelector(`[name="${name}"]`).disabled = !holiday.checked;
    const status = document.createElement("p"); status.id = "settings-status"; status.className = "pending-note"; status.setAttribute("role","status");
    form.append(status);
    if (saved) status.textContent = "Unapplied settings restored. Apply or cancel these settings.";
    form.addEventListener("input", () => {
      const values = {};
      for (const input of form.elements) {
        if (!input.name || input.name === "effective" || (input.type === "checkbox" && !input.checked)) continue;
        (values[input.name] ||= []).push(input.value);
      }
      pendingSettings.set(key, values);
      status.textContent = "Unapplied settings kept in this page while browsing. Lost on refresh.";
    });
  }
  const more = sheet.querySelector(".additional-more");
  if (more) more.addEventListener("toggle", () => more.querySelector("summary").setAttribute("aria-expanded", String(more.open)));
  sheet.querySelector("[data-close]").onclick = () => {
    if(isDay&&mobileDaySession){requestCloseMobileDay();return;}
    if (!isDay) { pendingSettings.delete(sheet.dataset.pendingKey); sheet.hidden = true; if(returnToGeneration())return; }
    focusControl(document.getElementById(!isDay&&editing?"setup":openerId || `day-${selectedDay}`));
  };
  sheet.onkeydown = e => {
    if(mobileDaySession&&e.key==='Tab'){
      const controls=[...sheet.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')].filter(el=>{
        if(!el.getClientRects().length||el.closest('[hidden],[inert]'))return false;
        // A nested summary can report geometry inside closed details but cannot take focus.
        for(let parent=el.parentElement;parent&&parent!==sheet;parent=parent.parentElement)if(parent.matches('details:not([open])')&&!parent.querySelector(':scope > summary')?.contains(el))return false;
        return true;
      });
      const first=controls[0],last=controls.at(-1);
      if(controls.length&&(e.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))||!e.shiftKey&&document.activeElement===last)){e.preventDefault();(e.shiftKey?last:first).focus();}
    }
    if (e.key === "Escape") {
      e.preventDefault();
      sheet.querySelector("[data-close]").click();
    }
  };
  if (focus) {
    const target = sheet.querySelector(isDay ? ".day-heading" : "h2");
    if (target) { target.tabIndex = -1; target.focus(); }
  }
  return sheet;
}
function historyLabel(d) {
  return historicalAverageText(d?.average);
}
function historyDayMarkup(day) {
  if(!editing)return '';
  const d=historicalView?.days.find(d=>d.day===day);if(!d)return '';
  return `<p class="day-history-context">${esc(historicalAverageText(d.average))}</p>`;
}
function dayDemandMarkup(row) {
  if (row.state !== "open" || (row.strictHours && row.minimumCoverage===null)) return "";
  const context=dayDemand(draft().store.history,row.day), estimate=context.estimate;
  const demandLinked=Boolean(estimate && row.rule.useCapacity && row.rule.capacity>0);
  return `<section class="day-demand" aria-label="Staffing suggestion"><h3>Suggested staffing: ${row.recommendationTarget}</h3><p>${demandLinked?'Capacity-adjusted suggestion':'Minimum-only suggestion'} · ${!estimate?'History insufficient':!row.rule.useCapacity?'Capacity adjustment off':'Entered capacity used'}. Not a forecast.</p><button type="button" id="suggest">Use suggestion</button><details><summary>Why this suggestion?</summary><p>${demandLinked?`Historical estimate and entered capacity of ${row.rule.capacity} cars per person, never below ${row.required}.`:`Configured minimum: ${row.required}. History-based staffing is unavailable without comparable history and enabled capacity.`}</p><p>${row.suggestions.length} eligible candidates: ${row.suggestions.map(id=>esc(draft().store.people.find(p=>p.id===id)?.name||id)).join(', ')||'None available'}. Availability and complete-week limits can leave gaps. Use suggestion adds pending choices, never removes manual choices.</p></details></section>`;
}
function mobileRosterMarkup(row,summary) {
  const groups=quickRosterGroups(draft().store.people,summary,row.record);
  const groupNames=items=>{const chunks=[];for(const item of items){const prior=chunks.at(-1);if(prior&&prior.team===item.team)prior.items.push(item);else chunks.push({team:item.team,items:[item]});}return chunks.map(g=>`<p>${g.team?`<strong class="roster-team">${icon("users")}${esc(g.team)}</strong> `:''}${g.items.map(p=>`${esc(p.name)}${p.note?` <small>(${esc(p.note)})</small>`:''}`).join(', ')}</p>`).join('');};
  return `<div class="mobile-quick-roster">${row.state==='closed'?'<p>Store closed</p>':row.state==='unknown'?'<p>Store hours unconfirmed</p>':''}${groups.filter(g=>g.label!=='Unconfirmed'||g.items.length).map(g=>`<section class="roster-group" data-roster-state="${g.label.toLowerCase()}" aria-label="${g.label}"><h3>${icon(g.label==='On'?'check':g.label==='Off'?'close':'question')}<span>${g.label}</span> <small class="roster-count">${g.items.length}</small></h3>${groupNames(g.items.slice(0,3))||'<p>None confirmed</p>'}${g.items.length>3?`<details><summary>${g.items.length-3} more ${g.label.toLowerCase()}</summary>${groupNames(g.items.slice(3))}</details>`:''}</section>`).join('')}</div>`;
}
function dayContext(row, summary) {
  if (row.state !== "open") return `<p class="day-coverage">${row.state === "closed" ? "Store closed" : "Confirm store hours before planning coverage"}</p>`;
  if(row.strictHours && row.minimumCoverage===null)return `<p class="day-coverage">Coverage unknown. Review missing or unconfirmed schedules.</p>`;
  return `<section class="coverage-summary" aria-label="Applied effective coverage"><h3>${editing ? "Applied coverage" : "Effective coverage"}</h3><dl><div><dt>Required</dt><dd>${row.required}</dd></div><div><dt>Eligible</dt><dd>${summary.covering}</dd></div><div><dt>Still needed</dt><dd>${Math.max(0,row.required-summary.covering)}</dd></div></dl><p>${displayTime(row.rule.open*60)} to ${displayTime(row.rule.close*60)} · ${summary.conflicting.length} conflicting · ${summary.unknown.length} unknown</p>${row.coverage?.some(s=>s.count<row.required) ? `<ul class="coverage-gaps">${row.coverage.filter(s=>s.count<row.required).map(s=>`<li>${displayTime(s.start)} to ${displayTime(s.end)}: ${s.count}/${row.required} covered</li>`).join("")}</ul>` : ""}${editing ? '<small>Coverage reflects applied assignments. Unapplied choices below do not count yet.</small>' : ''}</section>`;
}

function editorCoverage(row,summary) {
  if(row.state!=='open'||(row.strictHours&&row.minimumCoverage===null))return dayContext(row,summary);
  return `<section class="editor-coverage" aria-label="Applied coverage"><p><strong>${row.minimumCoverage}/${row.required} minimum coverage</strong> · ${displayTime(row.rule.open*60)} to ${displayTime(row.rule.close*60)}</p><p>${summary.conflicting.length} conflicting · ${summary.unknown.length} unknown. Applied assignments only.</p>${row.coverage?.some(s=>s.count<row.required)?`<details><summary>Coverage gaps</summary><ul>${row.coverage.filter(s=>s.count<row.required).map(s=>`<li>${displayTime(s.start)} to ${displayTime(s.end)}: ${s.count}/${row.required}</li>`).join('')}</ul></details>`:''}</section>`;
}
function editorRoster(row,summary) {
  const store=draft().store,teams=teamsOnDay(store,row.record,row.day,"mixed"),seen=new Set();
  const mismatches=new Map(membershipMismatches(store,row.record,row.day).map(m=>[m.id,m]));
  const person=p=>{
    const shifts=(row.record?.shifts||[]).filter(s=>s.personId===p.id),absence=dayAbsence(store,row.record,row.day,p.id),source=row.record?.absences?.[p.id]?.source,mismatch=mismatches.get(p.id);
    const conflict=row.conflicts[p.id]||[];
    const recurring=Array.isArray(p.off)&&p.off.includes(new Date(row.day+'T12:00:00Z').getUTCDay());
    const recorded=(row.record?.off||[]).includes(p.id);
    const cleared=absenceRecoveryNotice?.index===selected&&absenceRecoveryNotice.day===row.day&&absenceRecoveryNotice.revision===planner.revision&&absenceRecoveryNotice.ids.includes(p.id);
    const recovery=[recurring?'Recurring unavailability applies on this weekday. Review Setup → People before assigning work. Clearing this date does not change recurring availability.':'',recorded?'To change this absence to work: choose Unknown and Apply day to clear it first. Then, if available, choose On and Apply day. Clearing an absence does not assign work.':cleared?'Absence cleared. This person is still Unknown. If available, choose On and Apply day to assign work.':''].filter(Boolean).join(' ');
    const recoveryId=`${scopeId}-absence-recovery-${p.id}`;
    return `<div class="assignment-person" data-edit-person="${esc(p.id)}" data-has-shifts="${Boolean(shifts.length)}"><div class="person-identity"><strong>${esc(p.name)}</strong>${conflict.length?`<p class="person-conflict">${icon('warn')}${conflict.map(esc).join('; ')}</p>`:''}${absence?`<small>Applied: ${esc(absenceLabel(absence))}${source?` · ${esc(source.file||source.kind)}${source.line?`, line ${esc(source.line)}`:''}${source.transfer?` · ${source.transfer.mode==='copy'?'Copied':'Moved'} from ${esc(source.transfer.from)}`:''}`:''}</small>`:''}${shifts.length?`<small class="person-shifts">${shifts.map(s=>`${displayTime(s.startMinute)} to ${displayTime(s.endMinute)}`).join(', ')} · ${zoneLabel()}</small>`:''}${row.record?.unknownNotes?.[p.id]?`<small>${esc(typeof row.record.unknownNotes[p.id]==='string'?row.record.unknownNotes[p.id]:'Unknown assignment · '+(row.record.unknownNotes[p.id].source?.file||row.record.unknownNotes[p.id].source?.kind||'Unknown source'))}</small>`:''}</div><label class="person-status">Intended status<select data-status-person="${esc(p.id)}" aria-label="${esc(p.name)} intended status" ${recovery?`aria-describedby="${esc(recoveryId)}"`:""} required>${intendedStatus(row.record,p.id)===''?'<option value="">Resolve conflict</option>':''}${['On','Off','Unknown'].map(value=>`<option>${value}</option>`).join('')}</select></label>${recovery?`<p class="absence-recovery" id="${esc(recoveryId)}">${esc(recovery)}</p>`:""}<label class="absence-choice" hidden>Off reason<select data-absence="${esc(p.id)}" aria-label="${esc(p.name)} off reason">${['off','legacy-off','vacation','unavailable'].filter(kind=>kind!=='legacy-off'||absenceKind(row.record,p.id)==='legacy-off').map(kind=>`<option value="${kind}" ${kind===(absenceKind(row.record,p.id)||'off')?'selected':''}>${kind==='legacy-off'?'Unknown':absenceLabel(kind)}</option>`).join('')}</select></label>${['off','legacy-off'].includes(absenceKind(row.record,p.id))?`<button type="button" data-off-person="${esc(p.id)}" aria-label="Move or copy ${esc(p.name)} off-day">Move / copy off-day</button>`:''}<p class="team-exception" role="status"></p>${shifts.length?`<label class="check shift-removal" hidden><input type="checkbox" data-confirm-remove="${esc(p.id)}">Remove ${esc(p.name)}’s imported times when applying this day</label>`:''}${mismatch?`<p class="person-conflict">Assignment teams differ from current dated membership.</p><button type="button" data-review-membership="${esc(p.id)}">Review current teams for ${esc(p.name)}</button>`:''}</div>`;
  };
  const groups=teams.map((team,index)=>{const people=store.people.filter(p=>team.ids.includes(p.id)&&!seen.has(p.id));people.forEach(p=>seen.add(p.id));return {name:team.name,index,people,shared:team.ids.length-people.length};});
  const remaining=store.people.filter(p=>!seen.has(p.id));if(remaining.length)groups.push({name:'Additional people',people:remaining});
  return `<div class="editor-roster">${groups.map(g=>`<fieldset class="editor-team"><legend>${icon('users')}${esc(g.name)}</legend>${g.people.map(person).join('')}</fieldset>`).join('')}</div>`;
}

function editorDetails(row,summary) {
  const store=draft().store;
  return `<details class="day-details"><summary>Day details</summary><section><h3>Staffing suggestion</h3>${dayDemandMarkup(row)}</section><section><h3>Team actions</h3><p>Changes keep recorded absences and unresolved conflicts for individual review.</p>${teamsOnDay(store,row.record,row.day,"mixed").map((team,index)=>`<label class="team-bulk">${esc(team.name)} status<select data-team="${index}" aria-label="${esc(team.name)} team status"><option value="">Choose status</option><option>On</option><option>Off</option><option>Unknown</option></select></label>`).join('')}</section><section><h3>Hours &amp; sources</h3>${store.people.map(p=>{const shifts=(row.record?.shifts||[]).filter(s=>s.personId===p.id);return `<details class="person-evidence"><summary>${esc(p.name)}: hours &amp; sources</summary><p>${esc(personTeamLabel(store,p.id,row.day))}. Shared members appear once; team controls affect all their members.</p>${shifts.map(s=>`<p>${displayTime(s.startMinute)} to ${displayTime(s.endMinute)} · ${esc(displayDate(s.date))} · ${esc(s.timezone)}. Source: ${esc(s.source?.file||s.source?.kind||'CSV')}${s.source?.line?`, line ${esc(s.source.line)}`:''}.</p>`).join('')}${weeklyAuditMarkup(row.day,p.id)}</details>`;}).join('')}${teamDayMarkup(store,row.record,row.day,editing)}</section><section><h3>Applied roster &amp; sales</h3><div class="day-staffing">${staffingMarkup(summary,true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(store,row.day,today()))}</p></section>${historyDayMarkup(row.day)}</details>`;
}

function importedShifts(row) {
  const shifts=row.record?.shifts||[];
  return shifts.length ? `<section class="imported-shifts"><h3>Applied shift times</h3><ul>${shifts.map(s=>`<li>${esc(draft().store.people.find(p=>p.id===s.personId)?.name||s.personId)}: ${displayTime(s.startMinute)} to ${displayTime(s.endMinute)} · ${esc(displayDate(s.date))} · ${esc(s.timezone)}<small>Source: ${esc(s.source?.file||s.source?.kind||'CSV')}${s.source?.line?', line '+esc(s.source.line):''}</small></li>`).join('')}</ul><p>On keeps these exact times. Removing imported work requires explicit confirmation in the day editor.</p></section>` : '';
}
function dayHeader(day, row) {
  const smallWarning=!editing&&verifiedLow(row,staffing(row));
  return `<h2 id="selected-day-heading" class="day-heading" tabindex="-1">${dateLabel(day)}${smallWarning?` <span class="mobile-critical-warning">${icon("warn")}Below minimum: ${row.minimumCoverage}/${row.required}</span>`:""}</h2><nav class="day-actions" aria-label="Day actions"><button type="button" data-close aria-label="Back to month calendar"><span class="desktop-nav-label">Back to calendar</span><span class="mobile-nav-label">Back</span></button>${`<button type="button" id="day-previous" aria-label="Previous day" ${day===month+"-01" ? "disabled" : ""}>${icon("arrowleft")}</button><button type="button" id="day-next" aria-label="Next day" ${day===monthDays(month).at(-1) ? "disabled" : ""}>${icon("arrow")}</button>${!editing && row.state === "open" ? `<button type="button" id="edit-day" class="primary day-edit" aria-label="Edit day">${icon("calendar")}<span class="desktop-nav-label">Edit day</span><span class="mobile-nav-label">Edit</span></button>` : ""}`}</nav>`;
}
function bindDayActions(sheet, day) {
  for (const [id,delta] of [["day-previous",-1],["day-next",1]]) {
    const button=sheet.querySelector("#"+id);
    if(button)button.onclick=()=>{if(mobileDaySession&&!editing){dayHapticToken=captureHapticAction();dayMotion.navigate(delta,id,lastDayInput==='touch');return;}daySheet(addDays(day,delta)); const next=sheet.querySelector("#"+id); (next?.disabled ? sheet.querySelector(".day-heading") : next)?.focus();};
  }
  const edit=sheet.querySelector("#edit-day");
  if(edit)edit.onclick=()=>{editorReturnScroll=mobileDaySession?.scrollY??null;quickEdit=true;editing=true;render();daySheet(day);};
  const cancel=sheet.querySelector("#cancel-day");
  if(cancel)cancel.onclick=()=>{pendingAssignments.delete(pendingKey(day));if(quickEdit){editorReturnScroll=mobileDaySession?.scrollY??null;quickEdit=false;editing=false;render();daySheet(day);document.querySelector("#edit-day")?.focus();}else{daySheet(day);sheet.querySelector('.day-heading')?.focus();}};
}

function dayViewMarkup(r,summary){const day=r.day;return `${dayHeader(day, r)}${mobileRosterMarkup(r,summary)}<div class="desktop-roster day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p><details class="desktop-planning-detail"><summary>Coverage &amp; sources</summary><p>${statusMarkup(summary)}</p>${dayContext(r, summary)}${importedShifts(r)}${teamDayMarkup(draft().store,r.record,day,editing)}${r.issues.length ? `<ul class="issues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>` : ""}</details>${pendingAssignments.has(pendingKey(day)) ? '<p class="pending-note">Unapplied choices saved in this page. Open Edit day to continue.</p>' : ""}${historyDayMarkup(day)}`;}
function daySheet(day, openerId = `day-${day}`, focus = true) {
  closeImport();
  motionRows = rows();
  let r = motionRows.find((r) => r.day === day);
  if (!r) return;
  const changed = selectedDay !== day;
  selectedDay = day;app.dataset.hapticDate=day;
  const weekReview=document.querySelector('#selected-week-audit');
  if(changed&&weekReview){const wasOpen=weekReview.querySelector('details')?.open;weekReview.innerHTML=weeklyAuditMarkup(day);weekReview.querySelector('details').open=Boolean(wasOpen);}
  updateSelection();
  if (changed && document.querySelector("#message")) document.querySelector("#message").textContent = `${dateLabel(day)} roster shown.`;
  const summary = staffing(r);
  if (!editing) {
    const sheet = openSheet(dayViewMarkup(r,summary), openerId, true, focus);
    sheet.classList.remove('day-editor');
    bindDayActions(sheet,day);
    if(mobileDaySession){const host=document.querySelector('#mobile-day-dialog');let status=host.querySelector('.day-motion-status');if(!status){status=document.createElement('p');status.className='day-motion-status';status.setAttribute('role','status');host.append(status);}if(mobileDaySession.day&&mobileDaySession.day!==day)status.textContent=`${dateLabel(day)}. ${quickRosterGroups(draft().store.people,summary,r.record).map(g=>`${g.items.length} ${g.label.toLowerCase()}`).join(', ')}.`;mobileDaySession.day=day;}
    return;
  }
  const heading=`${dayHeader(day,r)}${editorCoverage(r,summary)}${r.issues.length?`<section class="editor-conflicts" aria-label="Resolve day issues"><h3>Resolve before review</h3><ul class="issues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></section>`:''}`;
  const sheet = openSheet(r.state==='open'
    ? `<form class="assignment-form"><div class="day-editor-content">${heading}${editorRoster(r,summary)}<p class="editor-note">On keeps imported times. ${opts.strictHours===true?'New work needs explicit shift times.':'New On uses full store hours.'} Back keeps pending choices in this page; Cancel restores this date’s applied choices.</p>${editorDetails(r,summary)}</div><div class="day-commit"><p class="pending-note" id="pending-status" role="status"></p><p id="day-error" role="alert"></p><div class="actions"><button class="primary">Apply day</button><button type="button" id="cancel-day">Cancel</button></div></div></form>`
    : `${heading}${dayDemandMarkup(r)}<p>${r.state==='closed'?'Store closed. Entered assignments remain visible and are excluded from coverage.':'Confirm store hours before planning coverage. Entered assignments retain their times; unknown duration remains unknown.'}</p>${importedShifts(r)}${teamDayMarkup(draft().store,r.record,day,editing)}<details class="applied-roster"><summary>Applied roster &amp; sales</summary><div class="day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p></details>${historyDayMarkup(day)}`,
    openerId,true,focus,
  );
  sheet.classList.toggle('day-editor',r.state==='open');
  if(focus&&hostWindow.innerWidth>700&&app.classList.contains('stacked-workspace'))sheet.scrollIntoView({block:'start',behavior:'instant'});
  bindDayActions(sheet,day);
  for(const button of sheet.querySelectorAll('[data-off-person]'))button.onclick=()=>startOffDay(day,button.dataset.offPerson);
  for(const button of sheet.querySelectorAll('[data-review-membership]'))button.onclick=()=>{
    if(pendingAssignments.has(pendingKey(day))){document.querySelector('#message').textContent='Apply or cancel day edits before reviewing membership.';return;}
    const id=button.dataset.reviewMembership,record=planner.record(selected,day);
    planner.setAssignment(selected,day,{...record,teamSnapshot:{...record?.teamSnapshot,...teamSnapshot(draft().store,day,[id])}});
    render(undefined,'Assignment team membership explicitly reviewed. Hours and absences unchanged.');daySheet(day);
  };
  if (r.state === "open") {
    const pending = pendingAssignments.get(pendingKey(day));
    const form=sheet.querySelector('form'),statusControls=[...form.querySelectorAll('[data-status-person]')];
    const initialStatus=id=>intendedStatus(r.record,id);
    for(const control of statusControls){const id=control.dataset.statusPerson;control.value=pending ? pending.on.includes(id)?'On':pending.off.includes(id)?'Off':'Unknown' : initialStatus(id);}
    if(pending?.absences)for(const select of form.querySelectorAll('[data-absence]'))select.value=pending.absences[select.dataset.absence]||'off';
    const syncPerson=control=>{control.dataset.intent=control.value;const person=control.closest('.assignment-person'),off=control.value==='Off',removes=control.value!=='On'&&person.dataset.hasShifts==='true';person.querySelector('.absence-choice').hidden=!off;const removal=person.querySelector('.shift-removal');if(removal){removal.hidden=!removes;if(!removes)removal.querySelector('input').checked=false;}};
    statusControls.forEach(syncPerson);
    const saveChoices=()=>{closeImport();pendingAssignments.set(pendingKey(day),{on:statusControls.filter(c=>c.value==='On').map(c=>c.dataset.statusPerson),off:statusControls.filter(c=>c.value==='Off').map(c=>c.dataset.statusPerson),unresolved:statusControls.filter(c=>!c.value).map(c=>c.dataset.statusPerson),absences:Object.fromEntries([...form.querySelectorAll('[data-absence]')].map(c=>[c.dataset.absence,c.value]))});sheet.querySelector('#pending-status').textContent='Pending choices kept for this date in this page. Not applied.';};
    if(pending){for(const id of pending.unresolved||[])form.querySelector(`[data-status-person="${id}"]`).value='';sheet.querySelector('#pending-status').textContent='Pending choices restored for this date.';}
    form.addEventListener('change',saveChoices);
    for(const control of statusControls)control.onchange=()=>{control.setCustomValidity('');syncPerson(control);};
    for(const select of form.querySelectorAll('[data-team]'))select.onchange=()=>{
      const team=teamsOnDay(draft().store,r.record,day,"mixed")[Number(select.dataset.team)];
      for(const id of team.ids){const control=form.querySelector(`[data-status-person="${id}"]`);if(!control)continue;
        const note=control.closest('.assignment-person').querySelector('.team-exception');
        if(control.value==='Off'||['vacation','unavailable'].includes(dayAbsence(draft().store,r.record,day,id))){note.textContent='Team change kept this absence. Resolve it here before assigning work.';continue;}
        if(!control.value){note.textContent='Team change kept this conflict. Choose the intended status here.';continue;}
        control.value=select.value;syncPerson(control);
      }
      select.value='';saveChoices();
    };
    form.onsubmit=e=>{
      e.preventDefault();const choices=pendingAssignments.get(pendingKey(day))||{on:statusControls.filter(c=>c.value==='On').map(c=>c.dataset.statusPerson),off:statusControls.filter(c=>c.value==='Off').map(c=>c.dataset.statusPerson)};
      const {on,off}=choices;
      const outsideEmployment=on.map(id=>({id,person:draft().store.people.find(p=>p.id===id)})).find(({person})=>employmentProblem(person,day));
      if(outsideEmployment){sheet.querySelector('#day-error').textContent=`${outsideEmployment.person?.name||outsideEmployment.id}: ${employmentProblem(outsideEmployment.person,day)}`;form.querySelector(`[data-status-person="${outsideEmployment.id}"]`)?.focus();feedback('refused');return;}
      const protectedOn=on.find(id=>!r.ids.includes(id)&&((r.record?.off||[]).includes(id)||['vacation','unavailable'].includes(dayAbsence(draft().store,r.record,day,id))));
      if(protectedOn){const input=form.querySelector(`[data-status-person="${protectedOn}"]`);input.setCustomValidity('Recorded absence: choose Unknown and apply to clear it explicitly before assigning work. Recurring unavailability must be resolved in People.');input.reportValidity();feedback('refused');return;}
      const removal=[...form.querySelectorAll('.shift-removal')].find(el=>!el.hidden&&!el.querySelector('input').checked);
      if(removal){sheet.querySelector('#day-error').textContent='Confirm removal of the displayed imported times, or choose On to keep them.';removal.querySelector('input').focus();feedback('refused');return;}
      const statuses=Object.fromEntries(statusControls.map(c=>[c.dataset.statusPerson,c.value])),reasons=Object.fromEntries([...form.querySelectorAll('[data-absence]')].map(c=>[c.dataset.absence,c.value])),confirmed=[...form.querySelectorAll('[data-confirm-remove]:checked')].map(c=>c.dataset.confirmRemove);
      let record;try{record=dayEditRecord(r.record,statuses,reasons,confirmed,draft().store.people.map(p=>p.id));planner.setAssignment(selected,day,record);}catch(error){sheet.querySelector('#day-error').textContent=error.message;feedback('refused');return;}
      pendingAssignments.delete(pendingKey(day));
      markChanged();absenceRecoveryNotice={index:selected,day,revision:planner.revision,ids:(r.record?.off||[]).filter(id=>statuses[id]==='Unknown')};editorReturnScroll=mobileDaySession?.scrollY??null;
      if(quickEdit)editing=false;quickEdit=false;
      render(undefined,`Saved ${dateLabel(day)} in this page.`);daySheet(day);feedback("taken");sheet.querySelector('.day-heading')?.focus();
    };
    const suggest=sheet.querySelector('#suggest');if(suggest)suggest.onclick=()=>{
      const suggestion=rows().find(row=>row.day===day).suggestions;
      for(const control of statusControls)if(suggestion.includes(control.dataset.statusPerson)&&control.value==='Unknown'){control.value='On';syncPerson(control);}
      saveChoices();
    };
  }
}
function weeklyAuditMarkup(day, personId) {
  const people=draft().store.people.filter(p=>!personId||p.id===personId);
  const audits=people.map(p=>({person:p,audit:weeklyHoursAudit(day,p.id,date=>planner.context(selected,date))}));
  return `<details class="weekly-hours-audit panel"><summary>Weekly hours · ${displayDate(mondayOf(day))} to ${displayDate(addDays(mondayOf(day),6))}</summary><p>Monday–Sunday · ${zoneLabel()}. Usual context is 40–50 hours, not a minimum. Below 40 does not automatically warn. Above 50 is an operational review prompt; it does not change assignments or eligibility.</p><ul>${audits.map(({person,audit})=>`<li><strong>${esc(person.name)}</strong>: ${esc(weeklyHoursText(audit))}${audit.confirmedCapConflicts.length?`<p>Separate confirmed hard-cap conflict: ${[...new Set(audit.confirmedCapConflicts.map(c=>hoursLabel(c.minutes)))].join(', ')}. Existing cap rules still apply.</p>`:''}${!audit.complete?`<p>Incomplete: ${esc([...new Set(audit.days.flatMap(d=>d.reasons))].join('; '))}. No within-range conclusion.</p>`:''}</li>`).join('')}</ul><p>Intervals are deduplicated per person, including split shifts and adjacent months. Break adjustments are unavailable${PREVIEW?' in this CSV preview':''}. These are scheduled interval hours, not paid or legal overtime hours; assigned hours do not establish availability.</p></details>`;
}
// The store's own zone; the preview's fictional stores are Eastern.
function zoneLabel() { return draft().store.timezone || "America/New_York"; }
function personSheet(id) {
  const store = draft().store,
    p = store.people.find((p) => p.id === id) || store.people[0];
  if (!p) { const note = document.querySelector("#message"); if (note) note.textContent = "No people are on this store’s roster."; return; }
  const sheet = openSheet(
    `<h2>People</h2>${weeklyAuditMarkup(selectedDay||month+"-01",id)}${peopleTeamsMarkup(store,selectedDay||month+"-01",planner.record(selected,selectedDay||month+"-01"))}<p class="people-team-label">${esc(personTeamLabel(store,p.id,selectedDay||month+"-01"))}</p><p>Availability and Monday–Sunday weekly limit for this store and month only. Other monthly drafts retain their own settings. Unapplied settings stay in this page while browsing. Cancel settings discards them.</p><label>Person<select id="person">${store.people.map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><form><div class="fields"><label>Available from (hour)<input name="start" type="number" min="0" max="23" required value="${p.start}"></label><label>Available until (hour)<input name="end" type="number" min="1" max="24" required value="${p.end}"></label><label>${PREVIEW?'Preview hard':'Hard'} weekly limit<input name="maxHours" type="number" min="0" max="168" required value="${p.maxHours}"></label></div><p>${p.maxHoursSource==='manager-confirmed'?'Manager-confirmed hard cap for this monthly draft.':(PREVIEW?'Unconfirmed preview setting, not established user policy. Existing preview cap enforcement remains active.':'Unconfirmed setting, not established policy. Existing cap enforcement remains active.')}</p><label class="check"><input type="checkbox" name="confirmCap" ${p.maxHoursSource==='manager-confirmed'?'checked':''}>Confirm this individual hard cap for this draft</label><fieldset><legend>Recurring unavailable weekdays</legend>${names.map((n, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${(p.off||[]).includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply changes</button><button type="button" data-close>Cancel settings</button></div></form>`,
    "people", false, true, id,
  );
  for(const button of sheet.querySelectorAll("[data-person-open]"))button.onclick=()=>personSheet(button.dataset.personOpen);
  sheet.querySelector("#person").onchange = (e) => personSheet(e.target.value);
  sheet.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (+f.get("start") >= +f.get("end")) {
      sheet.querySelector("#error").textContent =
        "Available until must be after available from.";feedback("refused");
      return;
    }
    pendingSettings.delete(sheet.dataset.pendingKey);
    Object.assign(p, {
      start: +f.get("start"),
      end: +f.get("end"),
      maxHours: +f.get("maxHours"),
      maxHoursSource: f.has("confirmCap") ? "manager-confirmed" : "preview-setting",
      off: f.getAll("off").map(Number),
    });
    markChanged();
    render("people", `Person availability saved${PREVIEW?"":" in this page"} for this month.`);feedback("taken");returnToGeneration();
  };
}
function storeSheet(effective = month + "-01") {
  const store = draft().store,
    r = storeRuleDraft(store.rules, effective),
    holiday = effective,
    exceptions = effectiveExceptions(store.rules, month);
  const sheet = openSheet(
    `<h2>Store sheet</h2><p>Entered rules, never inferred from historical staffing. Add a dated version; earlier dates keep their earlier rules. These edits apply only within this month’s draft, not other months. Saving the same effective date replaces that local draft version. Changing the effective date loads that date’s settings. Unapplied settings stay in this page while browsing. Cancel settings discards them.</p><form><div class="fields"><label>Effective from<input name="effective" type="date" min="${month}-01" max="${monthDays(month).at(-1)}" value="${effective}" required></label><label>Minimum people throughout open hours<input name="minimum" type="number" min="1" max="30" value="${r.minimum}" required></label><label>Store opens (hour)<input name="open" type="number" min="0" max="23" value="${r.open}" required></label><label>Store closes (hour)<input name="close" type="number" min="1" max="24" value="${r.close}" required></label><label>Delivered cars per person per full shift<input name="capacity" type="number" min="1" max="100" value="${r.capacity}" required></label></div><p><label class="check"><input type="checkbox" name="useCapacity" ${r.useCapacity ? "checked" : ""}>Use my capacity input alongside minimum coverage</label></p><fieldset><legend>Regular closed days</legend>${names.map((n, i) => `<label class="check"><input name="closedDays" type="checkbox" value="${i}" ${r.closedDays.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><h3>Holiday / special-day status</h3><p>Exceptions are exact dates within this monthly draft and update the rule governing that date, even when a later rule version exists. An explicit Open overrides a regular closed day.</p><p><label class="check"><input type="checkbox" name="editHoliday">Edit a special-day exception</label></p><p>Leave this unchecked to preserve existing exceptions when changing coverage.</p><div class="fields"><label>Date<input name="holiday" type="date" min="${effective}" max="${monthDays(month).at(-1)}" value="${holiday}" required disabled></label><label>Status<select name="holidayState" disabled>${["unknown", "closed", "open"].map((state) => `<option value="${state}" ${state === (exceptions[holiday] ?? "unknown") ? "selected" : ""}>${state[0].toUpperCase() + state.slice(1)}</option>`).join("")}</select></label></div><p>Existing entries: ${Object.entries(
      exceptions,
    )
      .filter(([day]) => day.startsWith(month + "-"))
      .map(([d, s]) => `${d}: ${s}`)
      .join(
        "; ",
      )}</p><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply dated local rule</button><button type="button" data-close>Cancel settings</button></div></form><details><summary>Rule versions</summary>${store.rules.map((r) => `<p>${r.effective}: ${r.open}:00 to ${r.close}:00, minimum ${r.minimum}</p>`).join("")}</details>`,
    "rules", false, true, effective,
  );
  sheet.querySelector('[name="effective"]').onchange = (e) => {
    if (!e.target.value || !e.target.validity.valid) return;
    storeSheet(e.target.value);
    document.querySelector('[name="effective"]').focus({ preventScroll: true });
  };
  sheet.querySelector('[name="editHoliday"]').onchange = (e) => {
    if (!e.target.checked) {
      const day = sheet.querySelector('[name="holiday"]').value;
      sheet.querySelector('[name="holidayState"]').value =
        exceptions[day] ?? "unknown";
    }
    for (const name of ["holiday", "holidayState"]) {
      sheet.querySelector(`[name="${name}"]`).disabled = !e.target.checked;
    }
  };
  sheet.querySelector('[name="holiday"]').onchange = (e) => {
    sheet.querySelector('[name="holidayState"]').value =
      exceptions[e.target.value] ?? "unknown";
  };
  sheet.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (+f.get("open") >= +f.get("close")) {
      sheet.querySelector("#error").textContent =
        "Store closes must be after store opens.";feedback("refused");
      return;
    }
    if (f.has("editHoliday") && f.get("holiday") < f.get("effective")) {
      sheet.querySelector("#error").textContent =
        "Special-day date must be on or after the rule’s effective date.";feedback("refused");
      return;
    }
    if (
      !String(f.get("effective")).startsWith(month + "-") ||
      (f.has("editHoliday") &&
        !String(f.get("holiday")).startsWith(month + "-"))
    ) {
      sheet.querySelector("#error").textContent =
        "Choose a date inside this month’s draft.";feedback("refused");
      return;
    }
    pendingSettings.delete(sheet.dataset.pendingKey);
    store.rules = applyStoreRuleForm(store.rules, f);feedback("taken");
    markChanged();
    render("rules", `Store hours saved${PREVIEW?"":" in this page"} from ${f.get("effective")}.${f.has("editHoliday") ? ` Special day ${f.get("holiday")}: ${f.get("holidayState")}, applied to the rule governing that date.` : ""}`);
    returnToGeneration();
  };
}
render();
listen(window,"scheduler-hide",()=>{activeResize?.();activeResize=null;closeAgendaDrag();closeAgendaDrag=()=>{};dayMotion.cancel();closeMobileDay(false);});
let hiddenForInvalidStore=false;
listen(window,"scheduler-view", event => { const detail=event.detail||{},hasStore=Object.hasOwn(detail,'store'),storeIndex=hasStore?stores.findIndex(s=>s.id===detail.store):-1;if(hasStore&&storeIndex<0){if(!root.hidden){root.hidden=true;hiddenForInvalidStore=true;}throw Error('Unknown scheduler store.');}if(hiddenForInvalidStore&&(!hasStore||storeIndex===selected)){root.hidden=false;hiddenForInvalidStore=false;}if(directDirty){if(hasStore&&storeIndex!==selected&&!root.hidden){root.hidden=true;hiddenForInvalidStore=true;}throw Error('Finish or cancel the open shift edit.');}if(hiddenForInvalidStore){root.hidden=false;hiddenForInvalidStore=false;}lastDayInput=detail.input||'keyboard';quickEdit=false; editing = false; const day=detail.day; if(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && validMonth(day.slice(0,7)) && monthDays(day.slice(0,7)).includes(day)){ month=day.slice(0,7); selectedDay=day; } if(storeIndex>=0)selected=storeIndex; render("workspace"); });
listen(window,"keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented) {
    const pop = document.querySelector(":popover-open");
    if (pop) { e.preventDefault(); pop.hidePopover(); (popoverOpeners.get(pop.id)||document.querySelector(`[popovertarget="${pop.id}"]`))?.focus(); return; }
    e.preventDefault();
    if (editing) { editing=false; quickEdit=false; render("workspace", "Returned to roster. Unapplied choices are kept in this page."); }
    else if (embeddedPlanner) { if (hasLocalDraft() && !window.confirm("Close the editor and discard this page’s unsaved changes?")) return; window.parent.dispatchEvent(new CustomEvent("scheduler-close")); }
    else document.getElementById(`day-${selectedDay}`)?.focus();
  }
});

let swipe = null;
// The period control is a separate gesture surface from the calendar grid and
// shift cards. A vertical gesture remains native scrolling; a tap remains a tap.
let periodGesture = null;
listen(app,'touchstart', event => {
  const control=event.target.closest('.period-control');
  if(event.touches.length!==1){if(periodGesture)periodGesture.control.style.removeProperty('--period-drag');periodGesture=null;return;}
  if(!control)return;
  const touch=event.touches[0];
  periodGesture={control,x:touch.clientX,y:touch.clientY,at:Date.now(),horizontal:false};
}, {passive:true});
listen(app,'touchmove', event => {
  if(!periodGesture)return;
  if(event.touches.length!==1){periodGesture.control.style.removeProperty('--period-drag');periodGesture=null;return;}
  const dx=event.touches[0].clientX-periodGesture.x,dy=event.touches[0].clientY-periodGesture.y;
  if(!periodGesture.horizontal&&swipeIntent(dx,dy)==='vertical'){periodGesture=null;return;}
  if(periodGesture.horizontal||swipeIntent(dx,dy)==='horizontal'){
    periodGesture.horizontal=true;
    if(event.cancelable)event.preventDefault();
    periodGesture.control.style.setProperty('--period-drag',`${Math.max(-12,Math.min(12,dx*.12))}px`);
  }
}, {passive:false});
listen(app,'touchcancel',()=>{if(periodGesture)periodGesture.control.style.removeProperty('--period-drag');periodGesture=null;},{passive:true});
listen(app,'touchend',event=>{
  const gesture=periodGesture;periodGesture=null;if(!gesture)return;
  gesture.control.style.removeProperty('--period-drag');
  if(!gesture.horizontal || !gesture.control.isConnected)return;
  const touch=event.changedTouches[0],delta=swipeDirection(touch.clientX-gesture.x,touch.clientY-gesture.y,Date.now()-gesture.at);
  if(delta){const button=gesture.control.querySelector(delta>0?'button:last-child':'button:first-child');if(button&&!button.disabled)button.click();}
},{passive:true});
const swipeSurface = target => target.closest(".month-days,#sheet");
listen(app,"touchstart", event => {
  dayHapticToken=captureHapticAction();
  lastDayInput='touch';swipe=null;if(event.touches.length!==1){dayMotion.release(false);return;}
  const target=event.target, touch=event.touches[0];
  if (editing || hostWindow.innerWidth>700 || event.touches.length!==1 || !swipeSurface(target) || target.closest("button,input,select,textarea,summary,a,[contenteditable]") || String(hostWindow.getSelection()).trim() || touch.clientX<24 || touch.clientX>hostWindow.innerWidth-24) return;
  const startOffset=swipeSurface(target).id==='sheet'&&mobileDaySession?dayMotion.begin():0;if(mobileDaySession)mobileDaySession.closing=false;
  swipe={startOffset,x:touch.clientX,y:touch.clientY,at:Date.now(),surface:swipeSurface(target),month,day:selectedDay,horizontal:false};
}, {passive:true});
listen(app,"touchmove", event => {
  if(!swipe)return;
  if(event.touches.length!==1 || String(hostWindow.getSelection()).trim()){cancelHaptics();dayMotion.release(false);swipe=null;return;}
  const dx=event.touches[0].clientX-swipe.x,dy=event.touches[0].clientY-swipe.y;
  if(!swipe.horizontal&&swipeIntent(dx,dy)==='vertical'){cancelHaptics();dayMotion.release(false);swipe=null;return;}
  if(swipe.horizontal||swipeIntent(dx,dy)==='horizontal'){swipe.horizontal=true;if(event.cancelable)event.preventDefault();if(swipe.surface.id==='sheet'&&mobileDaySession)dayMotion.drag(swipe.startOffset+dx);}
}, {passive:false});
listen(app,"touchcancel",()=>{cancelHaptics();swipe=null;dayMotion.release(false);},{passive:true});
listen(app,"touchend",event=>{
  const gesture=swipe;swipe=null;
  if(!gesture)return;
  if(!gesture.surface.isConnected || gesture.month!==month || gesture.day!==selectedDay || editing || !gesture.horizontal || String(hostWindow.getSelection()).trim() || Date.now()-gesture.at>1200){cancelHaptics();dayMotion.release(false);return;}
  const touch=event.changedTouches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
  const delta=swipeDirection(dx,dy,Date.now()-gesture.at);
  if(gesture.surface.id==="sheet" && selectedDay){if(!delta)cancelHaptics();dayMotion.release(Boolean(delta));}
  else if(!delta){cancelHaptics();return;}
  else {app.querySelector(delta>0?"#next":"#previous")?.click();}
},{passive:true});


  function dispose() {
    activeResize?.();activeResize=null;closeAgendaDrag(); closeShiftTransfer(); closeDirectShift();
    if (disposed) return;
    try { closeMobileDay(false); } catch {}
    for (const close of [closeImport, closeOffDay, closeGeneration]) { try { close(); } catch {} }
    try { dayMotion.cancel(); } catch {}
    // The host may have removed our document already (a frame taken out before its effect cleans up).
    try { cancelHaptics(); } catch {}
    pendingAssignments.clear(); pendingSettings.clear(); generationAnswers.clear();
    mobileDaySession = null;
    teardown();
  }
  retireOwner = dispose;
  return {
    get disposed() { return disposed; },
    // Whether anything has been changed in this page and not yet discarded, so a host can warn before it closes the editor.
    hasDraft() { return alive() && hasLocalDraft(); },
    // The draft bridge. Each answers a refusal ({ ok: false, reason }) rather than throwing, and none changes anything it refuses.
    exportMonth(month, index = selected) {
      if (!alive()) return { ok: false, reason: "disposed" };
      try { return { ok: true, ...planner.exportMonth(index, month) }; } catch(error) { return { ok: false, reason:error.code==='source-not-materialized'?error.code:'scope' }; }
    },
    reviewMaterialization(month,index=selected){
      if(!alive())return {ok:false,reason:'disposed'};
      if(directDirty||pendingAssignments.size||pendingSettings.size||generationAnswers.size)return {ok:false,reason:'pending-choices'};
      try{return {ok:true,review:planner.reviewMaterialization(index,month)};}catch{return {ok:false,reason:'source-unavailable'};}
    },
    applyMaterialization(review){
      if(!alive())return {ok:false,reason:'disposed'};
      if(directDirty||pendingAssignments.size||pendingSettings.size||generationAnswers.size)return {ok:false,reason:'pending-choices'};
      let result;try{result=planner.applyMaterialization(review);}catch{return {ok:false,reason:'source-review-changed'};}
      let rendered=true;try{render();}catch(error){rendered=false;try{opts.onError?.(error);}catch{}}
      return {ok:true,...result,rendered};
    },
    acknowledgeMonth(month, token, index = selected) {
      if (!alive()) return { ok: false, reason: "disposed" };
      try { return planner.acknowledgeMonth(index, month, token); } catch { return { ok: false, reason: "scope" }; }
    },
    hydrateMonth(projection, index = selected, expectedScope) {
      if (!alive()) return { ok: false, reason: "disposed" };
      if(directDirty||pendingAssignments.size||pendingSettings.size||generationAnswers.size)return {ok:false,reason:'pending-choices'};
      let out;
      try { out = planner.hydrateMonth(index, projection, opts.draftCodec ? (p) => opts.draftCodec.verify(p) : undefined, expectedScope); } catch { return { ok: false, reason: "refused" }; }
      if (out.ok) { try { render(); } catch {} }
      return out;
    },
    draftStatus(index = selected) {
      if (!alive()) return { ok: false, reason: "disposed" };
      return { ok: true, ...planner.draftStatus(index), pending: pendingAssignments.size + pendingSettings.size > 0 };
    },
    subscribeDraft(fn) { return !alive() ? () => {} : planner.subscribe(fn); },
    view(detail) { if (alive()) signals["scheduler-view"]?.({ detail: detail ?? {} }); },
    hide() { if (alive()) signals["scheduler-hide"]?.(); },
    dispose,
  };
  } catch (error) {
    teardown();
    if (typeof opts.onError === "function") opts.onError(error);
    throw error;
  }
}

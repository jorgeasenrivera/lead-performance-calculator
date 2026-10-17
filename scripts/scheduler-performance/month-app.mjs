import {historyClass,historyScale,scheduleMarker,scheduleKey} from './calendar-key.mjs';
import {openOffDayCommand} from './off-day-ui.mjs';
import {captureHapticAction,feedback,cancelHaptics,standaloneHaptics} from "./haptics.mjs";
standaloneHaptics();
import {intendedStatus,dayEditRecord} from "./day-edit-state.mjs";
import {createDayMotion,swipeIntent,swipeDirection} from "./day-motion.mjs";
import { quickRosterGroups, verifiedLow, calendarWarning } from "./mobile-roster.mjs";
import { openGeneration } from "./generation-ui.mjs";
import { teamsOnDay, membershipAt, membershipMismatches, teamSnapshot, dayAbsence, absenceKind, absenceLabel } from "./team-model.mjs";
import { balanceMarkup, teamDayMarkup, openTeamEditor, peopleTeamsMarkup, personTeamLabel } from "./team-ui.mjs";
import { openScheduleImport } from "./import-ui.mjs";
import { weeklyHoursAudit, weeklyHoursText, hoursLabel, mondayOf } from "./weekly-hours.mjs";
import { timeLabel } from "./shift-intervals.mjs";
import { fixtures, addDays } from "./model.mjs";
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
import { fixtureAssignments, assignmentSummary } from "./assignment-view.mjs";
import { dayDemand, monthDemand, historicalCalendar } from "./demand-context.mjs";
import { icon } from "./sage-icons.mjs";
const stores = fixtures(),
  planner = createPlanner(stores, { assignmentForDay: fixtureAssignments }),
  app = document.querySelector("#app");
const popoverOpeners=new Map();
app.addEventListener('click',e=>{const trigger=e.target.closest('[popovertarget]');if(trigger&&trigger.getAttribute('popovertargetaction')!=='hide')popoverOpeners.set(trigger.getAttribute('popovertarget'),trigger);},{capture:true});
function bindHistoryPopovers(root){
 for(const pop of root.querySelectorAll('[popover]')){
  if(pop.dataset.bound)continue;pop.dataset.bound='true';
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
app.addEventListener('pointerdown',e=>{lastDayInput=e.pointerType||'mouse';},{capture:true});
app.addEventListener('keydown',()=>{lastDayInput='keyboard';},{capture:true});
const embeddedPlanner = window.parent !== window;
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
window.addEventListener('beforeunload',event=>{if(localSettingsChanged||planner.revision||pendingAssignments.size||pendingSettings.size){event.preventDefault();event.returnValue='';}});
const pendingKey = day => `${selected}:${day}`;
const initialDay = () => month === today().slice(0,7) ? today() : month + "-01";
function updateSelection() {
  for (const button of app.querySelectorAll("[data-day]")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === selectedDay));
    button.setAttribute("aria-controls", "sheet");
  }
}
let editing = false, mode = "mixed", selectedDay = null;
let motionRows = [], historicalView=null;
let selected = 0,
  month = storeToday().slice(0, 7);
const today = () => storeToday();
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
  localSettingsChanged=true;
  draft().accepted = false;
  draft().reviewFingerprint = null;
};
const staffing = row => assignmentSummary(draft().store.people, teamsOnDay(draft().store,row.record,row.day,mode), row.record, {...row,store:draft().store});
const staffingMarkup = (s, expandable = false) => {
  if (s.status === "Closed") return `<span class="staff-closed">${icon("clock")}Store closed</span>`;
  const wrap = expandable ? "div" : "span";
  const memberState = id => s.conflicting.includes(id) ? "Conflict" : s.on.includes(id) ? "On" : s.vacation?.includes(id)?"Vacation":s.unavailable?.includes(id)?"Unavailable":s.off.includes(id) ? "Scheduled off" : "Unknown";
  const memberNames = t => `<span class="team-members" role="list" aria-label="${esc(t.name)} members">${[...new Set(t.ids)].map(id=>`<span class="team-member" role="listitem"><span>${esc(draft().store.people.find(p=>p.id===id)?.name || id)}</span><strong>${memberState(id)}</strong></span>`).join("")}</span>`;
  const person = p => `<span class="additional-person" data-person="${esc(p.id)}"><span>${esc(p.name)}</span><strong>${p.state}</strong></span>`;
  const people = s.additionalPeople || [], first = people.slice(0,3).map(person).join(""), rest = people.slice(3);
  const named = `<span class="additional-names">${first || "No additional people"}</span>${rest.length ? expandable ? `<details class="additional-more"><summary aria-expanded="false" aria-controls="additional-remaining">${rest.length} more ${rest.length === 1 ? "person" : "people"}</summary><span id="additional-remaining" class="additional-names">${rest.map(person).join("")}</span></details>` : `<span class="additional-preview-more">${rest.length} more ${rest.length === 1 ? "person" : "people"} in day details</span>` : ""}`;
  const counts = mode === "team" && !people.length ? "" : `<${wrap} class="staff-people"><span class="staff-group-title">${icon("users")}${mode === "mixed" ? "Additional people" : "People"}</span><span class="staff-counts">${[["on","On","check"],["off","Off","close"],["unknown","Unknown","question"],...(s.additional.vacation ? [["vacation","Vacation","close"]] : []),...(s.additional.unavailable ? [["unavailable","Unavailable","close"]] : []),...(s.additional.conflicts ? [["conflicts","Conflicting","warn"]] : [])].map(([key,label,glyph])=>`<span class="staff-count" data-count="${key}">${icon(glyph)}<strong>${s.additional[key]}</strong><span>${label}</span></span>`).join("")}</span>${named}</${wrap}>`;
  return `<${wrap} class="staffing-groups">${s.teams.length ? `<span class="staff-teams">${s.teams.map(t=>`<span class="staff-team" data-state="${t.state}"><span class="staff-team-name">${icon("users")}${esc(t.name)}</span><span class="staff-team-state">${icon(t.state === "On" ? "check" : t.state === "Off" ? "close" : t.state === "Unknown" ? "question" : "warn")}${t.state}</span>${expandable ? memberNames(t) : ""}</span>`).join("")}</span>` : ""}${counts}</${wrap}>`;
};
const statusIcon = status => status === "Scheduled" ? "check" : status === "Closed" ? "close" : status === "Hours unknown" ? "question" : status === "Low staff" ? "users" : "warn";
const statusMarkup = s => `<span class="staff-status ${(s.status === "Needs schedule" || s.status === "Schedule conflict") ? "needs-schedule" : s.status === "Low staff" ? "low-staff" : ""}">${icon(statusIcon(s.status))}<span class="status-label">${s.status}</span></span>`;
function syncCalendarLayout() {
  const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
  app.classList.remove("delivered-grid-reflow");
  app.classList.toggle("stacked-workspace", app.clientWidth < 60 * font);
  app.classList.remove("calendar-list");
  const compact = app.clientWidth <= 700;
  const inset = `${app.querySelector(".month-navigation")?.offsetHeight || 0}px`;
  if(document.documentElement.style.getPropertyValue("--month-bar-height")!==inset)document.documentElement.style.setProperty("--month-bar-height",inset);
  app.classList.toggle("compact-month", compact);
  app.classList.toggle("compact-reflow", compact && font >= 24);
  // Preserve readable single-line sales strips before keeping the desktop panes side by side.
  if (!compact && font >= 24) {
    const grid = app.querySelector(".month-days");
    const cellWidth = () => (grid.clientWidth - 6 * parseFloat(getComputedStyle(grid).columnGap)) / 7;
    if (cellWidth() < 7 * font) app.classList.add("stacked-workspace");
    if (cellWidth() < 7 * font) app.classList.add("delivered-grid-reflow");
  }
  for (const button of app.querySelectorAll("[data-day]")) {
    if (compact) button.setAttribute("aria-label", `${dateLabel(button.dataset.day)}, ${button.dataset.status}. ${button.dataset.historyLabel}. Open day details.`);
    else button.setAttribute("aria-label", `${dateLabel(button.dataset.day)}, ${button.dataset.status}. ${button.dataset.historyLabel}. Show day roster.`);
  }
}
// WebKit's native backward focus scroll can ignore the sticky header inset.
app.addEventListener("focusin", event => {
  const target = event.target;
  if (restoringDayFocus || !app.classList.contains("compact-month") || !target.matches("[data-day]")) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== target) return;
    const rect = target.getBoundingClientRect(), nav = app.querySelector(".month-navigation").getBoundingClientRect();
    if (rect.top < nav.bottom + 4) window.scrollBy({top:rect.top - nav.bottom - 8, behavior:"instant"});
    else if (rect.bottom > innerHeight - 4) window.scrollBy({top:rect.bottom - innerHeight + 8, behavior:"instant"});
  });
});
window.addEventListener("resize", () => {syncCalendarLayout();if(innerWidth>700)closeMobileDay(false);});
document.fonts.ready.then(syncCalendarLayout);
new MutationObserver(syncCalendarLayout).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style"],
});
function render(focusId, announcement = "") {
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
  app.innerHTML = `<div class="toolbar"><button id="workspace" class="primary">${icon(editing?"arrowleft":"calendar")}${editing ? "Return to manager view" : "Make Schedule"}</button></div>
 <div class="month-navigation"><button id="previous" ${month === "2014-01" ? "disabled" : ""} aria-label="Previous month">${icon("arrowleft")}</button><button id="period-heading" popovertarget="month-picker" aria-label="Choose month, ${monthLabel(month)}">${monthLabel(month)}</button><button id="next" ${month === "2100-12" ? "disabled" : ""} aria-label="Next month">${icon("arrow")}</button><button id="today">Today</button></div>
 <div id="month-picker" class="scheduler-popover" popover role="dialog" aria-label="Choose month"><label>Month (YYYY-MM)<input id="month" type="text" maxlength="7" value="${month}" min="2014-01" max="2100-12" pattern="[0-9]{4}-[0-9]{2}" placeholder="YYYY-MM" required></label><button data-dismiss="month-picker">Done</button></div>

 ${editing ? `<div class="editor-tools" role="group" aria-label="Schedule tools, scroll horizontally for more"><button id="generate-month" class="${list.some(r=>r.ids.length)?'':'primary'}">${generationAnswers.has(generationKey())?'Resume generation':'Generate month'}</button><button id="import-schedule">Import</button><button id="off-day-tools">Move / copy off-day</button>${lastOffDayUndo?.index===selected?'<button id="off-day-undo">Undo off-day change</button>':''}<button id="setup" aria-expanded="false" aria-controls="editor-setup">Setup</button></div><section id="editor-setup" class="panel" hidden aria-label="Schedule setup"><h2 tabindex="-1">Schedule setup</h2><div class="actions"><button id="teams">Teams</button><button id="people">${icon("users")}People</button><button id="rules">${icon("clock")}Store hours</button></div><button id="close-setup">Back to month</button></section>` : ""}
 <section id="generation-sheet" class="panel" hidden aria-label="Monthly schedule generation"></section>
 <section id="off-day-sheet" class="panel" hidden aria-label="Off-day operation"></section>
 <section id="import-sheet" class="panel" hidden aria-label="Import schedule review"></section>
 <section id="settings-sheet" class="panel" hidden aria-label="Planning settings"></section>

 ${editing&&[...pendingAssignments.keys()].some(k=>k.startsWith(`${selected}:${month}`))?'<p class="month-pending" role="status">Pending day choices kept in this page. Open a date to apply or cancel.</p>':''}
 <div class="schedule-layout"><section class="calendar-pane" aria-label="Month calendar"><div class="calendar-context"><span>${icon("calendar")}${editing ? "Plan by date" : "Month"}</span><button id="selected-roster">${icon("users")}Selected day</button></div>
 <p class="calendar-list-label">Day list · enlarged text</p><p class="sr-only" id="day-plan-help">${monthLabel(month)}. Open this date’s daily plan.</p>
 <section class="month-days" aria-label="${monthLabel(month)} daily plans"><span class="calendar-swipe-strip" aria-hidden="true">${icon("arrowleft")}<span></span>${icon("arrow")}</span>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => `<span class="weekday-heading">${n}</span>`).join("")}${calendarCells(
   month,
 )
   .map((day) => {
     if (!day) return '<span class="calendar-blank" aria-hidden="true"></span>';
     const r = byDay.get(day),
       sales = heat.get(day), staff = staffing(r), history=historicalDays.get(day);
     const alert=calendarWarning(r,staff),warning=alert?.kind;
     return `<button class="month-day ${r.state} staff-${warning||'normal'} ${historyClass(history.level)} ${day===today()?'is-today':''}" id="day-${day}" data-day="${day}" data-status="${alert?.label||staff.status}" data-history-label="${esc(historyLabel(history))}" data-verified-low="${verifiedLow(r,staff)}" ${day===today()?'aria-current="date"':''} aria-describedby="day-plan-help"><span class="day-date"><span class="day-weekday">${names[new Date(day+'T12:00:00Z').getUTCDay()]} </span>${Number(day.slice(-2))}</span><span class="schedule-slot">${scheduleMarker(warning||(r.state==='closed'?'closed':r.state!=='open'?'unknown':null))}</span><span class="day-coverage">${r.state==='open'?`${r.minimumCoverage}/${r.required} coverage`:r.state==='closed'?'Closed':'Hours unknown'}</span><small class="day-sales sales-${sales.state}">${deliveredMarkup(sales)}</small>${r.override?'<span class="day-edited sr-only">Edited in this page</span>':''}</button>`;
   })
   .join("")}</section></section><section id="sheet" class="panel day-panel" aria-label="Selected day roster"></section></div>${embeddedPlanner?'<section id="mobile-day-dialog" class="embedded-day-page" role="region" aria-labelledby="selected-day-heading" hidden></section>':'<dialog id="mobile-day-dialog" aria-labelledby="selected-day-heading"></dialog>'}

 ${editing ? `<details class="month-review"><summary>Review month · ${issues ? `${issues} to resolve` : reviewed ? "Reviewed" : "Ready for review"}</summary>${balanceMarkup(planner,selected,month)}<div id="selected-week-audit">${weeklyAuditMarkup(selectedDay||month+"-01")}</div><div class="actions"><button id="accept" class="primary">${icon("check")}Mark reviewed</button><button id="reset">${icon("roundup")}Reset this draft</button></div></details>` : ""}
 <details class="demo-options"><summary>Roster display</summary><label>Roster display mode<select id="mode">${["team","individual","mixed"].map(m=>`<option ${mode===m?"selected":""}>${m}</option>`).join("")}</select></label></details>

 ${editing ? `<p id="message" role="status">${esc(announcement)}</p>
 <details class="panel review"><summary>About this draft</summary><p>Connected month and roster viewing is separate from deliberate people and coverage editing. This is a fictional preview, not a published staff schedule.</p><p>Each store/month starts with a separate copy of fictional availability and store rules. Edits to those settings apply only inside that month’s draft; they are not automatically copied into other months. Returning to Performance keeps applied drafts while this page stays open. Reset affects assignments and settings only in the selected store/month. Dated team history remains until explicitly edited.</p><p>Weekly person limits run Monday–Sunday, including earlier dates from the previous month. Those dates use that month’s draft if one exists, otherwise fictional defaults. Editing an earlier month can change a later month’s boundary-week suggestions and invalidate its review; explicit overrides remain intact.</p><p>Six fictional stores have synthetic history from 1 Jan 2014 to 13 Oct 2026. Explicit NA is Closed, missing is Unknown, and zero means zero delivered cars. Ranges illustrate prior same-weekday counts, not validated forecasts. Future months reuse the available fictional history; there is no future observation.</p></details>
 <details class="footer"><summary>Shift limits</summary><p>Manual On uses full store hours. Imported CSV shifts keep exact minutes. No overnight shifts, DST-change dates, breaks, appointments, overtime policy, database connection or publishing.</p></details>` : `<p id="message" role="status">${esc(announcement)}</p>`}<footer class="calendar-reference" aria-label="Calendar key and history"> <section class="month-history" aria-label="Historical delivery context"><div><strong>${new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',timeZone:'UTC'})} history</strong><span>${historicalView.month.range?`${historicalView.month.range.low}–${historicalView.month.range.high} delivered`:'Full-month range unavailable'}</span></div><button id="sales-key" class="history-legend" popovertarget="sales-help" aria-label="Recent weekday pattern: quieter to busier sales. Open samples and calendar key"><span>Historical deliveries</span>${historyScale()}</button></section> <div id="sales-help" class="scheduler-popover" popover role="dialog" aria-label="Calendar key"><h2>Calendar key</h2><h3>Historical deliveries</h3>${historyScale()}<h3>Staffing</h3>${scheduleKey()}<p>Delivered = actual recorded total.</p><details><summary>How to read this</summary><p>Needs review: missing schedule, conflict or unconfirmed coverage. Low staff: confirmed coverage below the minimum. These markers do not describe sales.</p><p>Hatching means too little history, not zero. In Delivered, 0 is recorded zero; Unknown is missing, Pending is not yet available, and Closed is a recorded closure.</p></details><details><summary>Method &amp; samples</summary><p>Color: average of up to eight known matching weekdays before ${historicalView.cutoff}; at least four required. Missing and closed observations are excluded; zero is included.</p><p>Samples and scale are fixed before this month. Scale: 0–${historicalView.ceiling??'unknown'}, using the highest observed sample range. It may change between months. Old history may not reflect current conditions. No forecast, traffic or hourly demand is inferred.</p>${monthDemandMarkup(d.store)}</details><button data-dismiss="sales-help">Close calendar key</button></div></footer>`;
  const offButton=document.querySelector('#off-day-tools');if(offButton)offButton.onclick=()=>startOffDay(selectedDay||month+'-01');
  const undoButton=document.querySelector('#off-day-undo');if(undoButton)undoButton.onclick=()=>{try{if(lastOffDayUndo.index!==selected)throw Error('Return to the source store before undo.');if(hasPendingChoices())throw Error('Apply or cancel pending choices before undo.');const result=planner.undoOffDay(lastOffDayUndo);lastOffDayUndo=null;month=result.from.slice(0,7);selectedDay=result.from;render(undefined,'Off-day change undone. Original records restored.');daySheet(result.from);pulseOffDay(result.personId);}catch(error){document.querySelector('#message').textContent=error.message;document.querySelector('#message').scrollIntoView({block:'nearest'});}};
  const importButton = document.querySelector("#import-schedule");
  if(importButton) importButton.onclick = () => {
    if([...pendingAssignments.keys()].some(key=>key.startsWith(selected+':')) || [...pendingSettings.keys()].some(key=>key.startsWith(selected+':'))) { document.querySelector('#message').textContent='Apply or cancel your pending day and settings edits before importing.'; return; }
    closeImport();
    closeImport = openScheduleImport({host:document.querySelector('#import-sheet'),planner,index:selected,month,onApply:result=>{if(result.changed){selectedDay=result.firstDay;month=selectedDay.slice(0,7);}render('import-schedule',result.changed?`Applied reviewed source entries to ${result.changed} dates.${result.skipped?` ${result.skipped} entries skipped.`:''}`:`No changes. ${result.skipped||0} entries skipped; existing facts kept.`);},onClose:()=>importButton.focus()});
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
    selectedDay = null;
    month = e.target.value;
    render("period-heading");
  };
  for (const [id, delta] of [
    ["previous", -1],
    ["next", 1],
  ])
    document.getElementById(id).onclick = () => {
      selectedDay = null;
      month = shiftMonth(month, delta);
      render(id);
    };
  document.querySelector("#today").onclick = () => {
    month = today().slice(0, 7);
    render("period-heading");
    daySheet(today(), "period-heading");
  };
  document.querySelector("#mode").onchange = e => { mode = e.target.value; render(); document.querySelector(".demo-options").open = true; document.querySelector("#mode").focus(); };
  document.querySelector("#workspace").onclick = () => { quickEdit = false; editing = !editing; render("workspace"); };
  if(editing){
    document.querySelector("#generate-month").onclick=startGeneration;
    const setup=document.querySelector('#editor-setup'),trigger=document.querySelector('#setup');
    trigger.onclick=()=>{closeGeneration();closeImport();setup.hidden=!setup.hidden;trigger.setAttribute('aria-expanded',String(!setup.hidden));if(!setup.hidden)setup.querySelector('h2').focus();};
    document.querySelector('#close-setup').onclick=()=>{setup.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();};
    setup.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();document.querySelector('#close-setup').click();}};
  }
  document.querySelector("#selected-roster").onclick = () => daySheet(selectedDay);
  if(editing)document.querySelector('#teams').onclick=()=>{
    closeImport();
    document.querySelector('#editor-setup').hidden=true;document.querySelector('#setup').setAttribute('aria-expanded','false');
    if([...pendingAssignments.keys()].some(k=>k.startsWith(selected+':'))||[...pendingSettings.keys()].some(k=>k.startsWith(selected+':'))){document.querySelector('#message').textContent='Apply or cancel pending edits before changing teams.';return;}
    openTeamEditor({host:document.querySelector('#settings-sheet'),planner,index:selected,month,onDone:()=>render('teams','Dated membership saved. Existing assignment teams remain until reviewed.'),onCancel:()=>{document.querySelector('#settings-sheet').hidden=true;document.querySelector('#setup').focus();}});
  };

  if (editing) document.querySelector("#people").onclick = () => personSheet();
  if (editing) document.querySelector("#rules").onclick = () => storeSheet();
  document
    .querySelectorAll("[data-day]")
    .forEach((el) => (el.onclick = () => { daySheet(el.dataset.day, undefined, innerWidth<=700); document.querySelector("#message").textContent = `${dateLabel(el.dataset.day)} roster shown${editing ? "; editing workspace" : ""}.`; }));
  if (editing) document.querySelector("#reset").onclick = () => {
    if(!confirm("Reset this month’s assignments and settings? This cannot be undone."))return;
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
    window.parent.dispatchEvent(new CustomEvent("scheduler-summary", { detail: { store: summaryStore.id, month: summaryMonth, needs: statuses.filter(s=>s.status==="Needs schedule").length, low: statuses.filter(s=>s.status==="Low staff").length, conflicts: summaryRows.filter(r=>Object.keys(r.conflicts).length).length } }));
  }
  syncCalendarLayout();
  daySheet(selectedDay, undefined, false);
  if (focusId) {
    if(editing&&["teams","people","rules"].includes(focusId))focusId="setup";
    const target = document.getElementById(focusId);
    (target?.disabled ? document.getElementById("period-heading") : target)?.focus({
      preventScroll: true,
    });
  }
}
const hasPendingChoices=()=>[...pendingAssignments.keys(),...pendingSettings.keys()].some(k=>k.startsWith(selected+':'));
function pulseOffDay(id){const row=[...document.querySelectorAll('[data-edit-person]')].find(e=>e.dataset.editPerson===id);if(row&&!matchMedia('(prefers-reduced-motion: reduce)').matches)row.animate([{opacity:.65},{opacity:1}],{duration:160,easing:'ease-out'});document.querySelector('.day-heading')?.focus();}
function startOffDay(from,personId){
 if(hasPendingChoices()){const local=document.querySelector('#day-error'),message=local?.getClientRects().length?local:document.querySelector('#message');message.textContent='Apply or cancel pending day and settings choices first.';message.tabIndex=-1;message.focus();return;}
 closeMobileDay(false);closeImport();closeGeneration();closeOffDay();
 closeOffDay=openOffDayCommand({host:document.querySelector('#off-day-sheet'),planner,index:selected,from,personId,hasPending:hasPendingChoices,onClose:()=>{render('off-day-tools');if(personId){daySheet(from);[...document.querySelectorAll('[data-off-person]')].find(e=>e.dataset.offPerson===personId)?.focus();}},onApply:undo=>{lastOffDayUndo=undo;month=undo.to.slice(0,7);selectedDay=undo.to;render(undefined,`${undo.mode==='move'?'Moved':'Copied'} ${undo.personName}'s off-day. ${undo.mode==='move'?'Source is Unknown. ':''}Undo is available until another edit.`);daySheet(undo.to);pulseOffDay(undo.personId);}});
}
function startGeneration() {
  if([...pendingAssignments.keys(),...pendingSettings.keys()].some(k=>k.startsWith(selected+":"))){document.querySelector("#message").textContent="Apply or cancel pending edits before generating a month.";return;}
  closeGeneration();closeImport();
  const key=generationKey();
  const visit=opener=>answers=>{generationAnswers.set(key,answers);generationDetour=key;opener();};
  closeGeneration=openGeneration({host:document.querySelector("#generation-sheet"),planner,index:selected,month,mode,initialAnswers:generationAnswers.get(key),onMonth:value=>{generationDetour=null;month=value;selectedDay=null;render();startGeneration();},onApply:result=>{generationAnswers.delete(key);generationDetour=null;mode=result.mode;editing=true;render("generate-month",result.status==="covered"?"Draft applied. Review before use. Manual edits lock that date.":"Incomplete generated draft applied in this page. Resolve the visible gaps before marking reviewed.");},onClose:()=>{generationAnswers.delete(key);generationDetour=null;render('generate-month');},onPeople:visit(()=>personSheet()),onRules:visit(()=>storeSheet())});
}
const reduceDayMotion=matchMedia('(prefers-reduced-motion: reduce)');
const dayMotion=createDayMotion({getLive:()=>document.querySelector('#sheet'),getHost:()=>document.querySelector('#mobile-day-dialog'),getDay:()=>selectedDay,neighbor:(day,delta)=>{const next=addDays(day,delta);return next.startsWith(month)?next:null;},markup:day=>{const row=motionRows.find(r=>r.day===day);return dayViewMarkup(row,staffing(row));},commit:(day,focusId)=>{const token=dayHapticToken;dayHapticToken=null;const changed=day!==selectedDay;daySheet(day);if(changed)feedback('tick',token);const control=focusId&&document.getElementById(focusId);if(control&&!control.disabled)control.focus({preventScroll:true});},reduced:()=>reduceDayMotion.matches});
reduceDayMotion.addEventListener('change',()=>{if(reduceDayMotion.matches){if(mobileDaySession?.closing)closeMobileDay();else dayMotion.finish();}});
async function requestCloseMobileDay(){cancelHaptics();if(editing){closeMobileDay();return;}const session=mobileDaySession;if(!session||session.closing)return;session.closing=true;if(await dayMotion.leave(lastDayInput==='touch')&&mobileDaySession===session)closeMobileDay();}
function closeMobileDay(restore = true) {
  if(restore)cancelHaptics();dayHapticToken=null;
  if(!mobileDaySession)return;
  dayMotion.cancel();
  const session=mobileDaySession;mobileDaySession=null;
  const dialog=document.querySelector('#mobile-day-dialog'),sheet=document.querySelector('#sheet');
  restoringDayFocus=true;if(embeddedPlanner){dialog.hidden=true;for(const element of session.inert||[])element.inert=false;}else dialog?.close();document.documentElement.classList.remove('day-modal-open');
  if(sheet)document.querySelector('.schedule-layout')?.append(sheet);
  if(editing){const pending=[...pendingAssignments.keys()].some(k=>k.startsWith(`${selected}:${month}`));let note=app.querySelector('.month-pending');if(pending&&!note){note=document.createElement('p');note.className='month-pending';note.setAttribute('role','status');app.querySelector('.schedule-layout').before(note);}if(note){note.textContent=pending?'Pending day choices kept in this page. Open a date to apply or cancel.':'';note.hidden=!pending;}}
  if(restore){document.getElementById(`day-${selectedDay}`)?.focus({preventScroll:true});window.scrollTo({top:session.scrollY,left:0,behavior:'instant'});}
  requestAnimationFrame(()=>{if(restore)window.scrollTo({top:session.scrollY,left:0,behavior:'instant'});restoringDayFocus=false;});
}
function showMobileDay(sheet) {
  const dialog=document.querySelector('#mobile-day-dialog');
  if(!mobileDaySession){mobileDaySession={scrollY:editorReturnScroll??window.scrollY};editorReturnScroll=null;dialog.append(sheet);document.documentElement.classList.add('day-modal-open');if(embeddedPlanner){mobileDaySession.inert=[...app.children].filter(e=>e!==dialog&&!e.inert);for(const element of mobileDaySession.inert)element.inert=true;dialog.hidden=false;}else dialog.showModal();if(!editing)dayMotion.enter(lastDayInput==='touch');}
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
  if(isDay&&innerWidth<=700&&(focus||mobileDaySession))showMobileDay(sheet);
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
    document.getElementById(!isDay&&editing?"setup":openerId || `day-${selectedDay}`)?.focus();
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
  return d?.estimate?`Recent weekday average ${d.average.toFixed(1)} delivered; observed range ${d.estimate.low} to ${d.estimate.high}; ${d.count} samples`:`Recent weekday history unavailable; ${d?.count||0} samples`;
}
function historyDayMarkup(day) {
  const d=historicalView?.days.find(d=>d.day===day);if(!d)return '';
  const id='history-evidence-'+day;
  return `<div class="day-history-context"><button popovertarget="${id}">${d.estimate?`History: ${d.estimate.low}–${d.estimate.high} delivered`:'Insufficient history'} ${icon('question')}</button><div id="${id}" popover class="scheduler-popover" role="dialog" aria-label="Historical weekday evidence"><h2>${dateLabel(day)}: history</h2><p>${d.estimate?`Average ${d.average.toFixed(1)} · range ${d.estimate.low}–${d.estimate.high} delivered`:'Insufficient history'} · ${d.count} samples.</p><details><summary>Samples &amp; method</summary><p>${d.first?`${d.first}–${d.last}. Latest sample: ${d.daysSinceComparable} days before this date.`:'No comparable recorded days.'}</p><p>Up to eight known matching weekdays before ${historicalView.cutoff}; at least four required. Samples and scale stay fixed for this month. Zero counts; missing and closed observations do not.</p><p>Range: observed minimum–maximum, not a confidence interval or forecast. Color uses the average, not the midpoint. No holiday, traffic or hourly adjustment. Synthetic history through 13 Oct 2026; old samples may not reflect current conditions.</p></details><button type="button" popovertarget="${id}" popovertargetaction="hide">Close history</button></div></div>`;
}
function monthDemandMarkup(store) {
  const context=monthDemand(store.history,month);
  return `<h3>Prior matching months</h3><p>${context.range?`${context.range.low}–${context.range.high} delivered across ${context.range.months} complete months.`:'Fewer than two complete months: no full-month range.'}</p>${context.comparable.length?`<ul>${context.comparable.map(r=>`<li>${monthLabel(r.month)}: ${r.total??'Unknown'} delivered${r.unknown?' (partial)':''}; ${r.known} known, ${r.closed} closed, ${r.unknown} missing days.</li>`).join('')}</ul>`:'<p>No prior matching months.</p>'}<p>Latest three prior matching calendar months, separate from the recent weekday samples. Partial totals are not a complete month; no busy-month ranking is inferred. Synthetic preview history ends 13 Oct 2026.</p>`;
}
function dayDemandMarkup(row) {
  if (row.state !== "open") return "";
  const context=dayDemand(draft().store.history,row.day), estimate=context.estimate;
  const demandLinked=Boolean(estimate && row.rule.useCapacity && row.rule.capacity>0);
  return `<section class="day-demand" aria-label="Staffing suggestion"><h3>Suggested staffing: ${row.recommendationTarget}</h3><p>${demandLinked?'Capacity-adjusted suggestion':'Minimum-only suggestion'} · ${!estimate?'History insufficient':!row.rule.useCapacity?'Capacity adjustment off':'Entered capacity used'}. Not a forecast.</p><button type="button" id="suggest">Use suggestion</button><details><summary>Why this suggestion?</summary><p>${demandLinked?`Upper illustrative range and entered capacity of ${row.rule.capacity} cars per person, never below ${row.required}.`:`Configured minimum: ${row.required}. History-based staffing is unavailable without comparable history and enabled capacity.`}</p><p>Illustrative historical range: ${estimate?`${estimate.low} to ${estimate.high} delivered cars`:'Unknown, fewer than four comparable days'}. ${context.count} prior known same-weekday samples${context.first?`, ${context.first} through ${context.last}`:''}. Latest prior fixture observation: ${context.historyThrough||'Unknown'}.</p><p>Up to eight prior known same weekdays, at least four required. Missing and closed records are excluded; recorded zero remains zero. No hourly or role demand is inferred.</p><p>${row.suggestions.length} eligible candidates: ${row.suggestions.map(id=>esc(draft().store.people.find(p=>p.id===id)?.name||id)).join(', ')||'None available'}. Availability and complete-week limits can leave gaps. Use suggestion adds pending choices, never removes manual choices.</p></details></section>`;
}
function mobileRosterMarkup(row,summary) {
  const groups=quickRosterGroups(draft().store.people,summary,row.record);
  const groupNames=items=>{const chunks=[];for(const item of items){const prior=chunks.at(-1);if(prior&&prior.team===item.team)prior.items.push(item);else chunks.push({team:item.team,items:[item]});}return chunks.map(g=>`<p>${g.team?`<strong class="roster-team">${icon("users")}${esc(g.team)}</strong> `:''}${g.items.map(p=>`${esc(p.name)}${p.note?` <small>(${esc(p.note)})</small>`:''}`).join(', ')}</p>`).join('');};
  return `<div class="mobile-quick-roster">${row.state==='closed'?'<p>Store closed</p>':row.state==='unknown'?'<p>Store hours unconfirmed</p>':''}${groups.filter(g=>g.label!=='Unconfirmed'||g.items.length).map(g=>`<section class="roster-group" data-roster-state="${g.label.toLowerCase()}" aria-label="${g.label}"><h3>${icon(g.label==='On'?'check':g.label==='Off'?'close':'question')}<span>${g.label}</span> <small class="roster-count">${g.items.length}</small></h3>${groupNames(g.items.slice(0,3))||'<p>None confirmed</p>'}${g.items.length>3?`<details><summary>${g.items.length-3} more ${g.label.toLowerCase()}</summary>${groupNames(g.items.slice(3))}</details>`:''}</section>`).join('')}</div>`;
}
function dayContext(row, summary) {
  if (row.state !== "open") return `<p class="day-coverage">${row.state === "closed" ? "Store closed" : "Confirm store hours before planning coverage"}</p>`;
  return `<section class="coverage-summary" aria-label="Applied effective coverage"><h3>${editing ? "Applied coverage" : "Effective coverage"}</h3><dl><div><dt>Required</dt><dd>${row.required}</dd></div><div><dt>Eligible</dt><dd>${summary.covering}</dd></div><div><dt>Still needed</dt><dd>${Math.max(0,row.required-summary.covering)}</dd></div></dl><p>${row.rule.open}:00 to ${row.rule.close}:00 · ${summary.conflicting.length} conflicting · ${summary.unknown.length} unknown</p>${row.coverage?.some(s=>s.count<row.required) ? `<ul class="coverage-gaps">${row.coverage.filter(s=>s.count<row.required).map(s=>`<li>${timeLabel(s.start)} to ${timeLabel(s.end)}: ${s.count}/${row.required} covered</li>`).join("")}</ul>` : ""}${editing ? '<small>Coverage reflects applied assignments. Unapplied choices below do not count yet.</small>' : ''}</section>`;
}

function editorCoverage(row,summary) {
  if(row.state!=='open')return dayContext(row,summary);
  return `<section class="editor-coverage" aria-label="Applied coverage"><p><strong>${row.minimumCoverage}/${row.required} minimum coverage</strong> · ${row.rule.open}:00 to ${row.rule.close}:00</p><p>${summary.conflicting.length} conflicting · ${summary.unknown.length} unknown. Applied assignments only.</p>${row.coverage?.some(s=>s.count<row.required)?`<details><summary>Coverage gaps</summary><ul>${row.coverage.filter(s=>s.count<row.required).map(s=>`<li>${timeLabel(s.start)} to ${timeLabel(s.end)}: ${s.count}/${row.required}</li>`).join('')}</ul></details>`:''}</section>`;
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
    const recoveryId=`absence-recovery-${p.id}`;
    return `<div class="assignment-person" data-edit-person="${esc(p.id)}" data-has-shifts="${Boolean(shifts.length)}"><div class="person-identity"><strong>${esc(p.name)}</strong>${conflict.length?`<p class="person-conflict">${icon('warn')}${conflict.map(esc).join('; ')}</p>`:''}${absence?`<small>Applied: ${esc(absenceLabel(absence))}${source?` · ${esc(source.file||source.kind)}${source.line?`, line ${esc(source.line)}`:''}${source.transfer?` · ${source.transfer.mode==='copy'?'Copied':'Moved'} from ${esc(source.transfer.from)}`:''}`:''}</small>`:''}${shifts.length?`<small class="person-shifts">${shifts.map(s=>`${timeLabel(s.startMinute)} to ${timeLabel(s.endMinute)}`).join(', ')} · America/New_York</small>`:''}${row.record?.unknownNotes?.[p.id]?`<small>${esc(typeof row.record.unknownNotes[p.id]==='string'?row.record.unknownNotes[p.id]:'Unknown assignment · '+(row.record.unknownNotes[p.id].source?.file||row.record.unknownNotes[p.id].source?.kind||'Unknown source'))}</small>`:''}</div><label class="person-status">Intended status<select data-status-person="${esc(p.id)}" aria-label="${esc(p.name)} intended status" ${recovery?`aria-describedby="${esc(recoveryId)}"`:""} required>${intendedStatus(row.record,p.id)===''?'<option value="">Resolve conflict</option>':''}${['On','Off','Unknown'].map(value=>`<option>${value}</option>`).join('')}</select></label>${recovery?`<p class="absence-recovery" id="${esc(recoveryId)}">${esc(recovery)}</p>`:""}<label class="absence-choice" hidden>Off reason<select data-absence="${esc(p.id)}" aria-label="${esc(p.name)} off reason">${['off','legacy-off','vacation','unavailable'].filter(kind=>kind!=='legacy-off'||absenceKind(row.record,p.id)==='legacy-off').map(kind=>`<option value="${kind}" ${kind===(absenceKind(row.record,p.id)||'off')?'selected':''}>${kind==='legacy-off'?'Unknown':absenceLabel(kind)}</option>`).join('')}</select></label>${['off','legacy-off'].includes(absenceKind(row.record,p.id))?`<button type="button" data-off-person="${esc(p.id)}" aria-label="Move or copy ${esc(p.name)} off-day">Move / copy off-day</button>`:''}<p class="team-exception" role="status"></p>${shifts.length?`<label class="check shift-removal" hidden><input type="checkbox" data-confirm-remove="${esc(p.id)}">Remove ${esc(p.name)}’s imported times when applying this day</label>`:''}${mismatch?`<p class="person-conflict">Assignment teams differ from current dated membership.</p><button type="button" data-review-membership="${esc(p.id)}">Review current teams for ${esc(p.name)}</button>`:''}<details class="person-evidence"><summary>${esc(p.name)}: hours &amp; sources</summary><p>${esc(personTeamLabel(store,p.id,row.day))}. Shared members appear once; team controls affect all their members.</p>${shifts.map(s=>`<p>${timeLabel(s.startMinute)} to ${timeLabel(s.endMinute)} · ${esc(s.date)} · ${esc(s.timezone)}. Source: ${esc(s.source?.file||s.source?.kind||'CSV')}${s.source?.line?`, line ${esc(s.source.line)}`:''}.</p>`).join('')}${weeklyAuditMarkup(row.day,p.id)}</details></div>`;
  };
  const groups=teams.map((team,index)=>{const people=store.people.filter(p=>team.ids.includes(p.id)&&!seen.has(p.id));people.forEach(p=>seen.add(p.id));return {name:team.name,index,people,shared:team.ids.length-people.length};});
  const remaining=store.people.filter(p=>!seen.has(p.id));if(remaining.length)groups.push({name:'Additional people',people:remaining});
  return `<div class="editor-roster">${groups.map(g=>`<fieldset class="editor-team"><legend>${icon('users')}${esc(g.name)}</legend>${g.index!==undefined?`<label class="team-bulk">Team status<select data-team="${g.index}" aria-label="${esc(g.name)} team status"><option value="">Choose status</option><option>On</option><option>Off</option><option>Unknown</option></select></label>${g.shared?`<p>${g.shared} shared members shown in an earlier group; this team control also includes them.</p>`:''}`:''}${g.people.map(person).join('')}</fieldset>`).join('')}</div>`;
}

function importedShifts(row) {
  const shifts=row.record?.shifts||[];
  return shifts.length ? `<section class="imported-shifts"><h3>Applied shift times</h3><ul>${shifts.map(s=>`<li>${esc(draft().store.people.find(p=>p.id===s.personId)?.name||s.personId)}: ${timeLabel(s.startMinute)} to ${timeLabel(s.endMinute)} · ${esc(s.date)} · ${esc(s.timezone)}<small>Source: ${esc(s.source?.file||s.source?.kind||'CSV')}${s.source?.line?', line '+esc(s.source.line):''}</small></li>`).join('')}</ul><p>On keeps these exact times. Removing imported work requires explicit confirmation in the day editor.</p></section>` : '';
}
function dayHeader(day, row) {
  const smallWarning=!editing&&verifiedLow(row,staffing(row));
  return `<h2 id="selected-day-heading" class="day-heading" tabindex="-1">${dateLabel(day)}${smallWarning?` <span class="mobile-critical-warning">${icon("warn")}Below minimum: ${row.minimumCoverage}/${row.required}</span>`:""}</h2><nav class="day-actions" aria-label="Day actions"><button type="button" data-close aria-label="${editing?'Back to month':'Month calendar'}"><span class="desktop-nav-label">${editing?'Back to month':'Month calendar'}</span><span class="mobile-nav-label">${editing?'Back':'Calendar'}</span></button>${`<button type="button" id="day-previous" aria-label="Previous day" ${day===month+"-01" ? "disabled" : ""}>${icon("arrowleft")}</button><button type="button" id="day-next" aria-label="Next day" ${day===monthDays(month).at(-1) ? "disabled" : ""}>${icon("arrow")}</button>${!editing && row.state === "open" ? `<button type="button" id="edit-day" class="primary day-edit" aria-label="Edit day">${icon("calendar")}<span class="desktop-nav-label">Edit day</span><span class="mobile-nav-label">Edit</span></button>` : ""}`}</nav>`;
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

function dayViewMarkup(r,summary){const day=r.day;return `${dayHeader(day, r)}${mobileRosterMarkup(r,summary)}<div class="desktop-roster day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p><div class="desktop-planning-detail"><p>${statusMarkup(summary)}</p>${dayContext(r, summary)}${importedShifts(r)}${teamDayMarkup(draft().store,r.record,day,editing)}${r.issues.length ? `<ul class="issues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>` : ""}</div>${pendingAssignments.has(pendingKey(day)) ? '<p class="pending-note">Unapplied choices saved in this page. Open Edit day to continue.</p>' : ""}${historyDayMarkup(day)}`;}
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
    bindDayActions(sheet,day);
    if(mobileDaySession){const host=document.querySelector('#mobile-day-dialog');let status=host.querySelector('.day-motion-status');if(!status){status=document.createElement('p');status.className='day-motion-status';status.setAttribute('role','status');host.append(status);}if(mobileDaySession.day&&mobileDaySession.day!==day)status.textContent=`${dateLabel(day)}. ${quickRosterGroups(draft().store.people,summary,r.record).map(g=>`${g.items.length} ${g.label.toLowerCase()}`).join(', ')}.`;mobileDaySession.day=day;}
    return;
  }
  const sheet = openSheet(
    `${dayHeader(day, r)}${editorCoverage(r,summary)}${r.issues.length ? `<section class="editor-conflicts" aria-label="Resolve day issues"><h3>Resolve before review</h3><ul class="issues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul></section>` : ""}${dayDemandMarkup(r)}${
      r.state === "open"
        ? `<form class="assignment-form">${editorRoster(r,summary)}<p class="editor-note">On keeps imported times. New On uses full store hours. Back keeps pending choices in this page; Cancel restores this date’s applied choices.</p><p class="pending-note" id="pending-status" role="status"></p><p id="day-error" role="alert"></p><div class="actions"><button class="primary">Apply day</button><button type="button" id="cancel-day">Cancel</button></div></form>`
        : `<p>${r.state === "closed" ? "Store closed. Entered assignments remain visible and are excluded from coverage." : "Confirm store hours before planning coverage. Entered assignments retain their times; unknown duration remains unknown."}</p>`
    }${r.state!=="open"?importedShifts(r):""}${teamDayMarkup(draft().store,r.record,day,editing)}<details class="applied-roster"><summary>Applied roster &amp; sales</summary><div class="day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p></details>${historyDayMarkup(day)}`,
    openerId, true, focus,
  );
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
      const protectedOn=on.find(id=>!r.ids.includes(id)&&((r.record?.off||[]).includes(id)||['vacation','unavailable'].includes(dayAbsence(draft().store,r.record,day,id))));
      if(protectedOn){const input=form.querySelector(`[data-status-person="${protectedOn}"]`);input.setCustomValidity('Recorded absence: choose Unknown and apply to clear it explicitly before assigning work. Recurring unavailability must be resolved in People.');input.reportValidity();feedback('refused');return;}
      const removal=[...form.querySelectorAll('.shift-removal')].find(el=>!el.hidden&&!el.querySelector('input').checked);
      if(removal){sheet.querySelector('#day-error').textContent='Confirm removal of the displayed imported times, or choose On to keep them.';removal.querySelector('input').focus();feedback('refused');return;}
      const statuses=Object.fromEntries(statusControls.map(c=>[c.dataset.statusPerson,c.value])),reasons=Object.fromEntries([...form.querySelectorAll('[data-absence]')].map(c=>[c.dataset.absence,c.value])),confirmed=[...form.querySelectorAll('[data-confirm-remove]:checked')].map(c=>c.dataset.confirmRemove);
      let record;try{record=dayEditRecord(r.record,statuses,reasons,confirmed,draft().store.people.map(p=>p.id));}catch(error){sheet.querySelector('#day-error').textContent=error.message;feedback('refused');return;}
      planner.setAssignment(selected,day,record);pendingAssignments.delete(pendingKey(day));
      markChanged();absenceRecoveryNotice={index:selected,day,revision:planner.revision,ids:(r.record?.off||[]).filter(id=>statuses[id]==='Unknown')};editorReturnScroll=mobileDaySession?.scrollY??null;
      if(quickEdit)editing=false;quickEdit=false;
      render(undefined,`Saved ${dateLabel(day)} in this page.`);daySheet(day);feedback("taken");sheet.querySelector('.day-heading')?.focus();
    };
    sheet.querySelector('#suggest').onclick=()=>{
      const suggestion=rows().find(row=>row.day===day).suggestions;
      for(const control of statusControls)if(suggestion.includes(control.dataset.statusPerson)&&control.value==='Unknown'){control.value='On';syncPerson(control);}
      saveChoices();
    };
  }
}
function weeklyAuditMarkup(day, personId) {
  const people=draft().store.people.filter(p=>!personId||p.id===personId);
  const audits=people.map(p=>({person:p,audit:weeklyHoursAudit(day,p.id,date=>planner.context(selected,date))}));
  return `<details class="weekly-hours-audit panel"><summary>Weekly hours · ${mondayOf(day)} to ${addDays(mondayOf(day),6)}</summary><p>Monday–Sunday · America/New_York. Usual context is 40–50 hours, not a minimum. Below 40 does not automatically warn. Above 50 is an operational review prompt; it does not change assignments or eligibility.</p><ul>${audits.map(({person,audit})=>`<li><strong>${esc(person.name)}</strong>: ${esc(weeklyHoursText(audit))}${audit.confirmedCapConflicts.length?`<p>Separate confirmed hard-cap conflict: ${[...new Set(audit.confirmedCapConflicts.map(c=>hoursLabel(c.minutes)))].join(', ')}. Existing cap rules still apply.</p>`:''}${!audit.complete?`<p>Incomplete: ${esc([...new Set(audit.days.flatMap(d=>d.reasons))].join('; '))}. No within-range conclusion.</p>`:''}</li>`).join('')}</ul><p>Intervals are deduplicated per person, including split shifts and adjacent months. Break adjustments are unavailable in this CSV preview. These are scheduled interval hours, not paid or legal overtime hours; assigned hours do not establish availability.</p></details>`;
}
function personSheet(id = "p0") {
  const store = draft().store,
    p = store.people.find((p) => p.id === id);
  const sheet = openSheet(
    `<h2>People</h2>${weeklyAuditMarkup(selectedDay||month+"-01",id)}${peopleTeamsMarkup(store,selectedDay||month+"-01",planner.record(selected,selectedDay||month+"-01"))}<p class="people-team-label">${esc(personTeamLabel(store,p.id,selectedDay||month+"-01"))}</p><p>Availability and Monday–Sunday weekly limit for this store and month only. Other monthly drafts retain their own settings. Unapplied settings stay in this page while browsing. Cancel settings discards them.</p><label>Person<select id="person">${store.people.map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><form><div class="fields"><label>Available from (hour)<input name="start" type="number" min="0" max="23" required value="${p.start}"></label><label>Available until (hour)<input name="end" type="number" min="1" max="24" required value="${p.end}"></label><label>Preview hard weekly limit<input name="maxHours" type="number" min="0" max="168" required value="${p.maxHours}"></label></div><p>${p.maxHoursSource==='manager-confirmed'?'Manager-confirmed hard cap for this monthly draft.':'Unconfirmed preview setting, not established user policy. Existing preview cap enforcement remains active.'}</p><label class="check"><input type="checkbox" name="confirmCap" ${p.maxHoursSource==='manager-confirmed'?'checked':''}>Confirm this individual hard cap for this draft</label><fieldset><legend>Recurring unavailable weekdays</legend>${names.map((n, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${(p.off||[]).includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply changes</button><button type="button" data-close>Cancel settings</button></div></form>`,
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
    render("people", "Person availability saved for this month.");feedback("taken");returnToGeneration();
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
    render("rules", `Store hours saved from ${f.get("effective")}.${f.has("editHoliday") ? ` Special day ${f.get("holiday")}: ${f.get("holidayState")}, applied to the rule governing that date.` : ""}`);
    returnToGeneration();
  };
}
render();
window.addEventListener("scheduler-hide",()=>{dayMotion.cancel();closeMobileDay(false);});
window.addEventListener("scheduler-view", event => { lastDayInput=event.detail?.input||'keyboard';quickEdit=false; editing = false; const day=event.detail?.day; if(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && validMonth(day.slice(0,7)) && monthDays(day.slice(0,7)).includes(day)){ month=day.slice(0,7); selectedDay=day; } const storeIndex=stores.findIndex(s=>s.id===event.detail.store); if(storeIndex>=0)selected=storeIndex; render("workspace"); if (selectedDay?.startsWith(month)) daySheet(selectedDay); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented) {
    const pop = document.querySelector(":popover-open");
    if (pop) { e.preventDefault(); pop.hidePopover(); (popoverOpeners.get(pop.id)||document.querySelector(`[popovertarget="${pop.id}"]`))?.focus(); return; }
    e.preventDefault();
    if (editing) { editing=false; quickEdit=false; render("workspace", "Returned to roster. Unapplied choices are kept in this page."); }
    else if (embeddedPlanner) window.parent.dispatchEvent(new CustomEvent("scheduler-close"));
    else document.getElementById(`day-${selectedDay}`)?.focus();
  }
});

let swipe = null;
const swipeSurface = target => target.closest(".month-days,#sheet");
app.addEventListener("touchstart", event => {
  dayHapticToken=captureHapticAction();
  lastDayInput='touch';swipe=null;if(event.touches.length!==1){dayMotion.release(false);return;}
  const target=event.target, touch=event.touches[0];
  if (editing || innerWidth>700 || event.touches.length!==1 || !swipeSurface(target) || target.closest("button,input,select,textarea,summary,a,[contenteditable]") || String(getSelection()).trim() || touch.clientX<24 || touch.clientX>innerWidth-24) return;
  const startOffset=swipeSurface(target).id==='sheet'&&mobileDaySession?dayMotion.begin():0;if(mobileDaySession)mobileDaySession.closing=false;
  swipe={startOffset,x:touch.clientX,y:touch.clientY,at:Date.now(),surface:swipeSurface(target),month,day:selectedDay,horizontal:false};
}, {passive:true});
app.addEventListener("touchmove", event => {
  if(!swipe)return;
  if(event.touches.length!==1 || String(getSelection()).trim()){cancelHaptics();dayMotion.release(false);swipe=null;return;}
  const dx=event.touches[0].clientX-swipe.x,dy=event.touches[0].clientY-swipe.y;
  if(!swipe.horizontal&&swipeIntent(dx,dy)==='vertical'){cancelHaptics();dayMotion.release(false);swipe=null;return;}
  if(swipe.horizontal||swipeIntent(dx,dy)==='horizontal'){swipe.horizontal=true;if(event.cancelable)event.preventDefault();if(swipe.surface.id==='sheet'&&mobileDaySession)dayMotion.drag(swipe.startOffset+dx);}
}, {passive:false});
app.addEventListener("touchcancel",()=>{cancelHaptics();swipe=null;dayMotion.release(false);},{passive:true});
app.addEventListener("touchend",event=>{
  const gesture=swipe;swipe=null;
  if(!gesture)return;
  if(!gesture.surface.isConnected || gesture.month!==month || gesture.day!==selectedDay || editing || !gesture.horizontal || String(getSelection()).trim() || Date.now()-gesture.at>1200){cancelHaptics();dayMotion.release(false);return;}
  const touch=event.changedTouches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
  const delta=swipeDirection(dx,dy,Date.now()-gesture.at);
  if(gesture.surface.id==="sheet" && selectedDay){if(!delta)cancelHaptics();dayMotion.release(Boolean(delta));}
  else if(!delta){cancelHaptics();return;}
  else {const next=shiftMonth(month,delta);if(validMonth(next)){selectedDay=null;const token=dayHapticToken;month=next;render(delta>0?"next":"previous");feedback("tick",token);}}
},{passive:true});

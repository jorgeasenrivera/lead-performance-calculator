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
import { fixtureAssignments, teamsFor, assignmentSummary } from "./assignment-view.mjs";
import { dayDemand, monthDemand } from "./demand-context.mjs";
import { icon } from "./sage-icons.mjs";
const stores = fixtures(),
  planner = createPlanner(stores, { assignmentForDay: fixtureAssignments }),
  app = document.querySelector("#app");
let quickEdit = false;
// Unapplied choices are local to a store/date and never enter coverage calculations.
const pendingAssignments = new Map();
const pendingSettings = new Map();
const pendingKey = day => `${selected}:${day}`;
const initialDay = () => month === today().slice(0,7) ? today() : month + "-01";
function updateSelection() {
  for (const button of app.querySelectorAll("[data-day]")) {
    button.setAttribute("aria-pressed", String(button.dataset.day === selectedDay));
    button.setAttribute("aria-controls", "sheet");
  }
}
let editing = false, mode = "mixed", selectedDay = null;
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
  draft().accepted = false;
  draft().reviewFingerprint = null;
};
const staffing = row => assignmentSummary(draft().store.people, teamsFor(draft().store.people, mode), row.record, row);
const staffingMarkup = (s, expandable = false) => {
  if (s.status === "Closed") return `<span class="staff-closed">${icon("clock")}Store closed</span>`;
  const wrap = expandable ? "div" : "span";
  const memberState = id => s.conflicting.includes(id) ? "Conflict" : s.on.includes(id) ? "On" : s.off.includes(id) ? "Off" : "Unknown";
  const memberNames = t => `<span class="team-members" role="list" aria-label="${esc(t.name)} members">${[...new Set(t.ids)].map(id=>`<span class="team-member" role="listitem"><span>${esc(draft().store.people.find(p=>p.id===id)?.name || id)}</span><strong>${memberState(id)}</strong></span>`).join("")}</span>`;
  const person = p => `<span class="additional-person" data-person="${esc(p.id)}"><span>${esc(p.name)}</span><strong>${p.state}</strong></span>`;
  const people = s.additionalPeople || [], first = people.slice(0,3).map(person).join(""), rest = people.slice(3);
  const named = `<span class="additional-names">${first || "No additional people"}</span>${rest.length ? expandable ? `<details class="additional-more"><summary aria-expanded="false" aria-controls="additional-remaining">${rest.length} more ${rest.length === 1 ? "person" : "people"}</summary><span id="additional-remaining" class="additional-names">${rest.map(person).join("")}</span></details>` : `<span class="additional-preview-more">${rest.length} more ${rest.length === 1 ? "person" : "people"} in day details</span>` : ""}`;
  const counts = mode === "team" ? "" : `<${wrap} class="staff-people"><span class="staff-group-title">${icon("users")}${mode === "mixed" ? "Additional people" : "People"}</span><span class="staff-counts">${[["on","On","check"],["off","Off","close"],["unknown","Unknown","question"],...(s.additional.conflicts ? [["conflicts","Conflicting","warn"]] : [])].map(([key,label,glyph])=>`<span class="staff-count" data-count="${key}">${icon(glyph)}<strong>${s.additional[key]}</strong><span>${label}</span></span>`).join("")}</span>${named}</${wrap}>`;
  return `<${wrap} class="staffing-groups">${s.teams.length ? `<span class="staff-teams">${s.teams.map(t=>`<span class="staff-team" data-state="${t.state}"><span class="staff-team-name">${icon("users")}${esc(t.name)}</span><span class="staff-team-state">${icon(t.state === "On" ? "check" : t.state === "Off" ? "close" : t.state === "Unknown" ? "question" : "warn")}${t.state}</span>${expandable ? memberNames(t) : ""}</span>`).join("")}</span>` : ""}${counts}</${wrap}>`;
};
const statusIcon = status => status === "Scheduled" ? "check" : status === "Closed" ? "close" : status === "Hours unknown" ? "question" : status === "Low staff" ? "users" : "warn";
const statusMarkup = s => `<span class="staff-status ${(s.status === "Needs schedule" || s.status === "Schedule conflict") ? "needs-schedule" : s.status === "Low staff" ? "low-staff" : ""}">${icon(statusIcon(s.status))}<span class="status-label">${s.status}</span></span>`;
function syncCalendarLayout() {
  const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
  app.classList.remove("delivered-grid-reflow");
  app.classList.toggle("stacked-workspace", app.clientWidth < 60 * font);
  app.classList.toggle("calendar-list", app.clientWidth < 7 * 8 * font);
  const compact = app.clientWidth <= 700;
  const inset = `${app.querySelector(".month-navigation")?.offsetHeight || 0}px`;
  if(document.documentElement.style.getPropertyValue("--month-bar-height")!==inset)document.documentElement.style.setProperty("--month-bar-height",inset);
  app.classList.toggle("compact-month", compact);
  app.classList.toggle("compact-reflow", compact && font >= 24);
  // Preserve readable single-line sales strips before keeping the desktop panes side by side.
  if (!compact && !editing) {
    const grid = app.querySelector(".month-days");
    const cellWidth = () => (grid.clientWidth - 6 * parseFloat(getComputedStyle(grid).columnGap)) / 7;
    if (cellWidth() < 7 * font) app.classList.add("stacked-workspace");
    if (cellWidth() < 7 * font) app.classList.add("delivered-grid-reflow");
  }
  for (const button of app.querySelectorAll("[data-day]")) {
    if (compact) button.setAttribute("aria-label", `${dateLabel(button.dataset.day)}, ${button.dataset.status}. Open day details.`);
    else button.setAttribute("aria-label", `${dateLabel(button.dataset.day)}, ${button.dataset.status}. Show day roster.`);
  }
}
// WebKit's native backward focus scroll can ignore the sticky header inset.
app.addEventListener("focusin", event => {
  const target = event.target;
  if (!app.classList.contains("compact-month") || !target.matches("[data-day]")) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== target) return;
    const rect = target.getBoundingClientRect(), nav = app.querySelector(".month-navigation").getBoundingClientRect();
    if (rect.top < nav.bottom + 4) window.scrollBy({top:rect.top - nav.bottom - 8, behavior:"instant"});
    else if (rect.bottom > innerHeight - 4) window.scrollBy({top:rect.bottom - innerHeight + 8, behavior:"instant"});
  });
});
window.addEventListener("resize", syncCalendarLayout);
document.fonts.ready.then(syncCalendarLayout);
new MutationObserver(syncCalendarLayout).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style"],
});
function render(focusId, announcement = "") {
  if (!selectedDay?.startsWith(month)) selectedDay = initialDay();
  app.classList.toggle("planning-workspace", editing);
  const dates = monthDays(month),
    list = rows(),
    d = draft(),
    issues = list.reduce((n, r) => n + r.issues.length, 0);
  const sales = monthSales(d.store, month, today());
  const heat = new Map(salesHeat(d.store, month, today()).map(r => [r.day, r]));
  const reviewed = d.accepted && d.reviewFingerprint === fingerprint(list);
  const byDay = new Map(list.map((r) => [r.day, r]));
  app.innerHTML = `<div class="toolbar"><button id="workspace" class="primary">${icon(editing?"arrowleft":"calendar")}${editing ? "Return to manager view" : "Make Schedule"}</button><button id="sales-key" popovertarget="sales-help">Sales key</button></div>
 <div class="month-navigation"><button id="previous" ${month === "2014-01" ? "disabled" : ""} aria-label="Previous month">${icon("arrowleft")}</button><button id="period-heading" popovertarget="month-picker" aria-label="Choose month, ${monthLabel(month)}">${monthLabel(month)}</button><button id="next" ${month === "2100-12" ? "disabled" : ""} aria-label="Next month">${icon("arrow")}</button><button id="today">Today</button></div>
 <div id="month-picker" class="scheduler-popover" popover role="dialog" aria-label="Choose month"><label>Month (YYYY-MM)<input id="month" type="text" maxlength="7" value="${month}" min="2014-01" max="2100-12" pattern="[0-9]{4}-[0-9]{2}" placeholder="YYYY-MM" required></label><button data-dismiss="month-picker">Done</button></div>
 <div id="sales-help" class="scheduler-popover" popover role="dialog" aria-label="Sales key"><h2>Sales key</h2><div class="heat-legend"><span>Recorded sales</span><span class="heat-scale"><span>Fewer</span>${[0,1,2,3,4].map(n=>`<i class="heat-${n}" aria-hidden="true"></i>`).join("")}<span>More</span></span><small>Only the sales strip uses sales shading. Missing is Unknown, zero means zero deliveries, and Closed is a recorded closure. Pending means future sales are not yet available. Unknown means no known sales record.</small></div><p>On touchscreens, swipe the calendar heading or arrow strip to browse months; swipe day details to browse dates. Buttons work too. Swipes are off while editing.</p><h3>Calendar icons</h3><ul class="icon-key">${[["warn","Needs schedule or conflict (red)"],["users","Low staff (orange)"],["check","Scheduled / On"],["close","Closed / Off"],["question","Unknown"],["trophy","Best recorded sales"]].map(([glyph,label])=>`<li>${icon(glyph)}<span>${label}</span></li>`).join("")}</ul><p>Staffing colors do not describe sales. Invalid assignments stay visible but do not count toward coverage.</p><h3>This month</h3><p>${sales.known} recorded · ${sales.closed} Closed · ${sales.unknown} unknown · ${sales.future} future days.</p><p>${sales.best ? `Best recorded: ${sales.bestDays.map(r=>dateLabel(r.day)).join("; ")}, ${sales.best.units} cars each.` : "No recorded best day."}</p><p>No sales goal is entered. Dates use America/New_York; fictional history ends 13 Oct 2026. Planning ranges are estimates, not observed sales.</p><button data-dismiss="sales-help">Close sales key</button></div>
 ${editing ? `<div class="workspace-intro"><h2>People &amp; coverage</h2><p>Choose a date, set who is on or off, then apply that day. Coverage counts unique eligible people across full store hours.</p></div><div class="editor-tools"><button id="people">${icon("users")}People</button><button id="rules">${icon("clock")}Store hours</button><span>${issues ? `${issues} to resolve` : reviewed ? "Reviewed locally" : "Ready for manager"}</span></div>` : ""}
 <section id="settings-sheet" class="panel" hidden aria-label="Planning settings"></section>
 ${editing ? monthDemandMarkup(d.store) : ""}
 <div class="schedule-layout"><section class="calendar-pane" aria-label="Month calendar"><div class="calendar-context"><span>${icon("calendar")}${editing ? "Plan by date" : "Month"}</span><button id="selected-roster">${icon("users")}Selected day</button></div>
 <p class="sr-only" id="day-plan-help">${monthLabel(month)}. Open this date’s daily plan.</p>
 <section class="month-days" aria-label="${monthLabel(month)} daily plans"><span class="calendar-swipe-strip" aria-hidden="true">${icon("arrowleft")}<span></span>${icon("arrow")}</span>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => `<span class="weekday-heading">${n}</span>`).join("")}${calendarCells(
   month,
 )
   .map((day) => {
     if (!day) return '<span class="calendar-blank" aria-hidden="true"></span>';
     const r = byDay.get(day),
       sales = heat.get(day), staff = staffing(r);
     return `<button class="month-day ${r.state} staff-${staff.status === "Needs schedule" || staff.status === "Schedule conflict" ? "needs" : staff.status === "Low staff" ? "low" : "normal"} ${day === today() ? "is-today" : ""}" id="day-${day}" data-day="${day}" data-status="${staff.status}" ${day === today() ? 'aria-current="date"' : ""} aria-describedby="day-plan-help"><span class="day-date"><span class="day-weekday">${names[new Date(day + "T12:00:00Z").getUTCDay()]} </span>${Number(day.slice(-2))}${day === today() ? "<small>Today</small>" : ""}</span>${statusMarkup(staff)}<span class="day-staffing">${staffingMarkup(staff)}</span>${editing ? `<span class="day-coverage">${r.state === "open" ? `${r.ids.length} assigned · ${r.eligibleIds.length} eligible / ${r.required} needed` : r.state === "closed" ? "Closed" : "Unknown hours"}</span>` : ""}<small class="day-sales sales-${sales.state} ${sales.level === null ? "" : "heat-" + sales.level}">${deliveredMarkup(sales)}</small>${sales.best ? `<span class="best-day">${icon("trophy")}${sales.bestLabel}</span>` : ""}${editing && r.override ? "<small>Edited</small>" : ""}${r.issues.length ? `<span class="day-issue">${icon("warn")}${r.issues.length} to resolve</span>` : ""}</button>`;
   })
   .join("")}</section></section><section id="sheet" class="panel day-panel" aria-label="Selected day roster"></section></div>

 <details class="demo-options"><summary>Demo options</summary><label>Fixture assignment mode<select id="mode">${["team","individual","mixed"].map(m=>`<option ${mode===m?"selected":""}>${m}</option>`).join("")}</select></label><p>Fictional display only. No live access or publishing.</p></details>

 ${editing ? `<div class="actions"><button id="accept" class="primary">${icon("check")}Mark reviewed</button><button id="reset">${icon("roundup")}Reset this draft</button><p id="message" role="status">${announcement ? esc(announcement) : reviewed ? "Manager review recorded for this month in this page only." : ""}</p></div>
 <details class="panel review"><summary>Draft scope and proposed defaults</summary><p>Connected month and roster viewing is separate from deliberate people and coverage editing. This is a fictional preview, not a published staff schedule.</p><p>Each store/month starts with a separate copy of fictional availability and store rules. Edits to those settings apply only inside that month’s draft; they are not automatically copied into other months. Returning to Performance keeps applied drafts while this page stays open. Reset affects only the selected store/month.</p><p>Weekly person limits run Monday–Sunday, including earlier dates from the previous month. Those dates use that month’s draft if one exists, otherwise fictional defaults. Editing an earlier month can change a later month’s boundary-week suggestions and invalidate its review; explicit overrides remain intact.</p><p>Six fictional stores have synthetic history from 1 Jan 2014 to 13 Oct 2026. Explicit NA is Closed, missing is Unknown, and zero means zero delivered cars. Ranges illustrate prior same-weekday counts, not validated forecasts. Future months reuse the available fictional history; there is no future observation.</p></details>
 <p class="footer">Full store-hour shifts only. No appointments, inferred historical staffing, partial shifts, breaks, overtime policy, database connection or publishing.</p>` : `<p id="message" role="status">${esc(announcement)}</p>`}`;
  for (const pop of document.querySelectorAll("[popover]")) {
    const trigger = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener("toggle", e => { trigger.setAttribute("aria-expanded", String(e.newState === "open")); if (e.newState === "open") pop.querySelector("input,button")?.focus(); });
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", pop.id);
    pop.querySelector("[data-dismiss]").onclick = () => { pop.hidePopover(); trigger.focus(); };
  }
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
  document.querySelector("#workspace").onclick = () => { quickEdit = false; editing = !editing; render("workspace"); if (selectedDay?.startsWith(month)) daySheet(selectedDay); };
  document.querySelector("#selected-roster").onclick = () => { document.querySelector(".day-heading")?.focus(); };
  if (editing) document.querySelector("#people").onclick = () => personSheet();
  if (editing) document.querySelector("#rules").onclick = () => storeSheet();
  document
    .querySelectorAll("[data-day]")
    .forEach((el) => (el.onclick = () => { daySheet(el.dataset.day, undefined, false); document.querySelector("#message").textContent = `${dateLabel(el.dataset.day)} roster shown${editing ? "; editing workspace" : ""}.`; }));
  if (editing) document.querySelector("#reset").onclick = () => {
    for (const drafts of [pendingAssignments,pendingSettings]) for (const key of drafts.keys()) if (key.startsWith(`${selected}:${month}`)) drafts.delete(key);
    planner.reset(selected, month);
    render("reset");
    document.querySelector("#message").textContent =
      "Only this store’s selected month was reset.";
  };
  if (editing) document.querySelector("#accept").onclick = () => {
    if (issues) {
      document.querySelector("#message").textContent =
        "Resolve coverage, availability and unknown status before marking this month reviewed.";
      return;
    }
    d.accepted = true;
    d.reviewFingerprint = fingerprint(list);
    render("accept");
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
    const target = document.getElementById(focusId);
    (target?.disabled ? document.getElementById("period-heading") : target)?.focus({
      preventScroll: true,
    });
  }
}
function openSheet(html, openerId, isDay = false, focus = true, settingsId = "") {
  const sheet = document.querySelector(isDay ? "#sheet" : "#settings-sheet");
  sheet.hidden = false;
  sheet.innerHTML = html;
  if (!isDay) {
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
    if (!isDay) { pendingSettings.delete(sheet.dataset.pendingKey); sheet.hidden = true; }
    document.getElementById(openerId || `day-${selectedDay}`)?.focus();
  };
  sheet.onkeydown = e => {
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
function monthDemandMarkup(store) {
  const context = monthDemand(store.history, month);
  return `<section class="month-demand" aria-label="Monthly demand context"><h3>${icon("calendar")}Month demand context</h3><p>${context.range ? `Comparable full-month sales: <strong>${context.range.low} to ${context.range.high} deliveries</strong>` : "Comparable full-month range unavailable"}. Fictional history, not a forecast of this month.</p><details><summary>Comparable months &amp; uncertainty</summary>${context.comparable.length ? `<ul>${context.comparable.map(r=>`<li>${monthLabel(r.month)}: ${r.total ?? "Unknown"} recorded deliveries · ${r.known} recorded / ${r.closed} closed / ${r.unknown} unknown days${r.unknown ? " (partial total)" : ""}.</li>`).join("")}</ul>` : "No prior same-calendar-month observations."}<p>Latest three prior observed instances of this calendar month. A range requires two complete months; partial totals never stand in for complete months. Daily estimates use prior same weekdays, not monthly totals divided into hours. Synthetic history ends 13 Oct 2026; no live history connection.</p></details></section>`;
}
function dayDemandMarkup(row) {
  if (row.state !== "open") return "";
  const context=dayDemand(draft().store.history,row.day), estimate=context.estimate;
  const demandLinked=Boolean(estimate && row.rule.useCapacity && row.rule.capacity>0);
  return `<section class="day-demand" aria-label="Illustrative demand and staffing suggestion"><h3>Busyness estimate</h3><p class="demand-range">${estimate ? `${estimate.low} to ${estimate.high} delivered cars` : "Unavailable: fewer than four comparable days"}</p><p>Fictional estimate, not actual sales.</p><dl class="suggested-coverage"><div><dt>Suggested staffing</dt><dd>${row.recommendationTarget}</dd></div><div><dt>Applied eligible</dt><dd>${row.eligibleIds.length}</dd></div><div><dt>Gap to suggestion</dt><dd>${Math.max(0,row.recommendationTarget-row.eligibleIds.length)}</dd></div></dl><p>${demandLinked ? `Uses the upper estimate and your entered capacity of ${row.rule.capacity} cars per person per full shift, never below the configured minimum of ${row.required}.` : `Minimum-only suggestion (${row.required}). ${!estimate ? "History is insufficient." : "Capacity adjustment is off."} History-based staffing is unavailable until comparable history and an enabled capacity input are present.`}</p><details><summary>Estimate basis &amp; candidate people</summary><p>${context.count} prior known same-weekday samples${context.first ? `, ${context.first} through ${context.last}; latest comparable is ${context.daysSinceComparable} days before this date` : ""}. ${context.historyThrough ? `Latest prior fixture observation: ${context.historyThrough}.` : "No prior fixture observations."}</p><p>Minimum and maximum of up to eight prior known same weekdays; at least four are required. This is an illustrative range, not a calibrated forecast or confidence interval. Missing and closed observations are excluded; recorded zero remains zero. Older history is not made current by planning a future month.</p><p>${row.suggestions.length} eligible candidate${row.suggestions.length===1?"":"s"}: ${row.suggestions.map(id=>esc(draft().store.people.find(p=>p.id===id)?.name || id)).join(", ") || "None available"}. Availability and complete-week limits can leave the suggestion unfilled. Use suggestion adds candidates to unapplied choices; it does not remove manual choices or publish a schedule.</p><p>No hourly or role demand is inferred from daily deliveries. Configured minimum coverage remains the hard rule.</p></details></section>`;
}
function dayContext(row, summary) {
  if (row.state !== "open") return `<p class="day-coverage">${row.state === "closed" ? "Store closed" : "Confirm store hours before planning coverage"}</p>`;
  return `<section class="coverage-summary" aria-label="Applied effective coverage"><h3>${editing ? "Applied coverage" : "Effective coverage"}</h3><dl><div><dt>Required</dt><dd>${row.required}</dd></div><div><dt>Eligible</dt><dd>${summary.covering}</dd></div><div><dt>Still needed</dt><dd>${Math.max(0,row.required-summary.covering)}</dd></div></dl><p>${row.rule.open}:00 to ${row.rule.close}:00 · ${summary.conflicting.length} conflicting · ${summary.unknown.length} unknown</p>${editing ? '<small>Coverage reflects applied assignments. Unapplied choices below do not count yet.</small>' : ''}</section>`;
}

function dayHeader(day, row) {
  return `<h2 class="day-heading" tabindex="-1">${dateLabel(day)}</h2><nav class="day-actions" aria-label="Day actions"><button type="button" data-close>Month calendar</button>${`<button type="button" id="day-previous" aria-label="Previous day" ${day===month+"-01" ? "disabled" : ""}>${icon("arrowleft")}</button><button type="button" id="day-next" aria-label="Next day" ${day===monthDays(month).at(-1) ? "disabled" : ""}>${icon("arrow")}</button>${!editing && row.state === "open" ? `<button type="button" id="edit-day" class="primary">${icon("calendar")}Edit day</button>` : ""}`}</nav>`;
}
function bindDayActions(sheet, day) {
  for (const [id,delta] of [["day-previous",-1],["day-next",1]]) {
    const button=sheet.querySelector("#"+id);
    if(button)button.onclick=()=>{daySheet(addDays(day,delta)); const next=sheet.querySelector("#"+id); (next?.disabled ? sheet.querySelector(".day-heading") : next)?.focus();};
  }
  const edit=sheet.querySelector("#edit-day");
  if(edit)edit.onclick=()=>{quickEdit=true;editing=true;render();daySheet(day);};
  const cancel=sheet.querySelector("#cancel-day");
  if(cancel)cancel.onclick=()=>{pendingAssignments.delete(pendingKey(day));quickEdit=false;editing=false;render();daySheet(day);document.querySelector("#edit-day")?.focus();};
}

function daySheet(day, openerId = `day-${day}`, focus = true) {
  let r = rows().find((r) => r.day === day);
  if (!r) return;
  const changed = selectedDay !== day;
  selectedDay = day;
  updateSelection();
  if (changed && document.querySelector("#message")) document.querySelector("#message").textContent = `${dateLabel(day)} roster shown.`;
  const summary = staffing(r);
  if (!editing) {
    const sheet = openSheet(`${dayHeader(day, r)}<div class="day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p><p>${statusMarkup(summary)}</p>${dayContext(r, summary)}${r.issues.length ? `<ul class="issues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>` : ""}${pendingAssignments.has(pendingKey(day)) ? '<p class="pending-note">Unapplied choices saved in this page. Open Edit day to continue.</p>' : ""}`, openerId, true, focus);
    bindDayActions(sheet,day);
    return;
  }
  const sheet = openSheet(
    `${dayHeader(day, r)}${dayContext(r, summary)}${dayDemandMarkup(r)}${
      r.state === "open"
        ? `<form class="assignment-form"><fieldset class="team-fields"><legend>Teams</legend>${teamsFor(draft().store.people, mode).map((t,i)=>`<label>${t.name}<select data-team="${i}"><option value="">Set status</option><option>On</option><option>Off</option><option>Unknown</option></select></label>`).join("")}</fieldset><fieldset class="people-assignments"><legend>People for ${dateLabel(day)}</legend>${draft().store.people.map(p => `<div class="assignment-person"><div><strong>${esc(p.name)}</strong><small>${r.conflicts[p.id]?.map(esc).join("; ") || (summary.on.includes(p.id) ? "Eligible" : summary.off.includes(p.id) ? "Confirmed off" : "Unknown")}</small></div><label class="check"><input type="checkbox" name="assigned" value="${p.id}" ${r.ids.includes(p.id) ? "checked" : ""} aria-label="${esc(p.name)} on">On</label><label class="check"><input type="checkbox" name="off" value="${p.id}" ${summary.off.includes(p.id)?"checked":""} aria-label="${esc(p.name)} confirmed off">Off</label></div>`).join("")}</fieldset><p>Unchecked people remain unknown. Mark on or confirmed off, not both. Browsing keeps unapplied choices in this page. Cancel discards this date’s choices. Conflicts remain visible after applying.</p><p class="pending-note" id="pending-status" role="status"></p><div class="actions"><button class="primary">Apply day override</button><button type="button" id="suggest">Use suggestion</button><button type="button" id="cancel-day">Cancel edits</button></div></form>`
        : `<p>${r.state === "closed" ? "Confirmed closed. No shifts or forecast." : "No staffing suggestion until the store status is confirmed."}</p>`
    }<details class="applied-roster"><summary>Applied roster &amp; sales</summary><div class="day-staffing">${staffingMarkup(summary, true)}</div><p class="recorded-day">${deliveredMarkup(recordedDay(draft().store, day, today()))}</p></details>${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}`,
    openerId, true, focus,
  );
  bindDayActions(sheet,day);
  if (r.state === "open") {
    const pending = pendingAssignments.get(pendingKey(day));
    if (pending) for (const box of sheet.querySelectorAll('input[type="checkbox"]')) box.checked = pending[box.name === "assigned" ? "on" : "off"].includes(box.value);
    const saveChoices = () => {
      const form = new FormData(sheet.querySelector("form"));
      pendingAssignments.set(pendingKey(day), {on:form.getAll("assigned"),off:form.getAll("off")});
      sheet.querySelector("#pending-status").textContent = "Unapplied choices · Kept while browsing · Lost on refresh";
    };
    sheet.querySelector("form").addEventListener("change", saveChoices);
    if (pending) sheet.querySelector("#pending-status").textContent = "Unapplied choices restored for this date.";
    sheet.querySelectorAll("[data-team]").forEach(select => select.onchange = () => {
      const team = teamsFor(draft().store.people, mode)[Number(select.dataset.team)];
      for (const id of team.ids) {
        sheet.querySelector(`[name="assigned"][value="${id}"]`).checked = select.value === "On";
        sheet.querySelector(`[name="off"][value="${id}"]`).checked = select.value === "Off";
      }
    });
    sheet.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const values = new FormData(e.target), on = values.getAll("assigned"), off = values.getAll("off");
      if (on.some(id => off.includes(id))) { e.target.querySelector("[name=assigned]").setCustomValidity("A person cannot be both on and off."); e.target.reportValidity(); e.target.onchange = () => e.target.querySelector("[name=assigned]").setCustomValidity(""); return; }
      pendingAssignments.delete(pendingKey(day));
      planner.setAssignment(selected, day, { on, off });
      markChanged();
      if (quickEdit) editing=false;
      quickEdit=false;
      render(undefined, `Saved ${dateLabel(day)} in this page.`);
      daySheet(day);
      document.querySelector(".day-heading")?.focus();
    };
    sheet.querySelector("#suggest").onclick = () => {
      const suggestion = rows().find(row => row.day === day).suggestions;
      sheet.querySelectorAll('[name="assigned"]').forEach(box => {
        const off = sheet.querySelector(`[name="off"][value="${box.value}"]`);
        if (suggestion.includes(box.value) && !off.checked) box.checked = true;
      });
      saveChoices();
    };
  }
}
function personSheet(id = "p0") {
  const store = draft().store,
    p = store.people.find((p) => p.id === id);
  const sheet = openSheet(
    `<h2>Person sheet</h2><p>Availability and Monday–Sunday weekly limit for this store and month only. Other monthly drafts retain their own settings. Unapplied settings stay in this page while browsing. Cancel settings discards them.</p><label>Person<select id="person">${store.people.map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${p.name}</option>`).join("")}</select></label><form><div class="fields"><label>Available from (hour)<input name="start" type="number" min="0" max="23" required value="${p.start}"></label><label>Available until (hour)<input name="end" type="number" min="1" max="24" required value="${p.end}"></label><label>Maximum weekly hours<input name="maxHours" type="number" min="0" max="168" required value="${p.maxHours}"></label></div><fieldset><legend>Days off</legend>${names.map((n, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${p.off.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply to local proposal</button><button type="button" data-close>Cancel settings</button></div></form>`,
    "people", false, true, id,
  );
  sheet.querySelector("#person").onchange = (e) => personSheet(e.target.value);
  sheet.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (+f.get("start") >= +f.get("end")) {
      sheet.querySelector("#error").textContent =
        "Available until must be after available from.";
      return;
    }
    pendingSettings.delete(sheet.dataset.pendingKey);
    Object.assign(p, {
      start: +f.get("start"),
      end: +f.get("end"),
      maxHours: +f.get("maxHours"),
      off: f.getAll("off").map(Number),
    });
    markChanged();
    render("people", "Person availability saved for this month.");
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
        "Store closes must be after store opens.";
      return;
    }
    if (f.has("editHoliday") && f.get("holiday") < f.get("effective")) {
      sheet.querySelector("#error").textContent =
        "Special-day date must be on or after the rule’s effective date.";
      return;
    }
    if (
      !String(f.get("effective")).startsWith(month + "-") ||
      (f.has("editHoliday") &&
        !String(f.get("holiday")).startsWith(month + "-"))
    ) {
      sheet.querySelector("#error").textContent =
        "Choose a date inside this month’s draft.";
      return;
    }
    pendingSettings.delete(sheet.dataset.pendingKey);
    store.rules = applyStoreRuleForm(store.rules, f);
    markChanged();
    render("rules", `Store hours saved from ${f.get("effective")}.${f.has("editHoliday") ? ` Special day ${f.get("holiday")}: ${f.get("holidayState")}, applied to the rule governing that date.` : ""}`);
  };
}
render();
window.addEventListener("scheduler-view", event => { quickEdit=false; editing = false; const day=event.detail?.day; if(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && validMonth(day.slice(0,7)) && monthDays(day.slice(0,7)).includes(day)){ month=day.slice(0,7); selectedDay=day; const storeIndex=stores.findIndex(s=>s.id===event.detail.store); if(storeIndex>=0)selected=storeIndex; } render("workspace"); if (selectedDay?.startsWith(month)) daySheet(selectedDay); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented) {
    const pop = document.querySelector(":popover-open");
    if (pop) { e.preventDefault(); pop.hidePopover(); document.querySelector(`[popovertarget="${pop.id}"]`).focus(); return; }
    e.preventDefault();
    if (editing) { editing=false; quickEdit=false; render("workspace", "Returned to roster. Unapplied choices are kept in this page."); }
    else document.getElementById(`day-${selectedDay}`)?.focus();
  }
});

let swipe = null;
const swipeSurface = target => target.closest(".month-days,#sheet");
app.addEventListener("touchstart", event => {
  swipe=null;
  const target=event.target, touch=event.touches[0];
  if (editing || innerWidth>700 || event.touches.length!==1 || !swipeSurface(target) || target.closest("button,input,select,textarea,summary,a,[contenteditable]") || String(getSelection()).trim() || touch.clientX<24 || touch.clientX>innerWidth-24) return;
  swipe={x:touch.clientX,y:touch.clientY,at:Date.now(),surface:swipeSurface(target),month,day:selectedDay,horizontal:false};
}, {passive:true});
app.addEventListener("touchmove", event => {
  if(!swipe)return;
  if(event.touches.length!==1 || String(getSelection()).trim()){swipe=null;return;}
  const dx=event.touches[0].clientX-swipe.x,dy=event.touches[0].clientY-swipe.y;
  if(Math.abs(dy)>12 && Math.abs(dy)>Math.abs(dx)){swipe=null;return;}
  if(Math.abs(dx)>10 && Math.abs(dx)>Math.abs(dy)*2){swipe.horizontal=true;event.preventDefault();}
}, {passive:false});
app.addEventListener("touchcancel",()=>swipe=null,{passive:true});
app.addEventListener("touchend",event=>{
  const gesture=swipe;swipe=null;
  if(!gesture || !gesture.surface.isConnected || gesture.month!==month || gesture.day!==selectedDay || editing || !gesture.horizontal || String(getSelection()).trim() || Date.now()-gesture.at>1200)return;
  const touch=event.changedTouches[0],dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
  if(Math.abs(dx)<60 || Math.abs(dx)<Math.abs(dy)*2)return;
  const delta=dx<0?1:-1;
  if(gesture.surface.id==="sheet" && selectedDay){const day=addDays(selectedDay,delta);if(day.startsWith(month))daySheet(day);}
  else {const next=shiftMonth(month,delta);if(validMonth(next)){selectedDay=null;month=next;render(delta>0?"next":"previous");}}
},{passive:true});

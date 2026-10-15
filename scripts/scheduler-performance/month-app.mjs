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
import { icon } from "./sage-icons.mjs";
const stores = fixtures(),
  planner = createPlanner(stores),
  app = document.querySelector("#app");
let editing = false, mode = "mixed";
let selected = 0,
  month = storeToday().slice(0, 7);
const today = () => storeToday();
const salesLabel = (r) =>
  r.state === "known"
    ? `${r.units}`
    : r.state === "future"
      ? "Sales not yet available"
      : r.state === "closed"
        ? "Sales record: Closed"
        : "Unknown";
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
const assignment = day => Object.hasOwn(draft().assignments || {}, day) ? draft().assignments[day] : fixtureAssignments(day);
const staffing = row => assignmentSummary(draft().store.people, teamsFor(draft().store.people, mode), row.state === "closed" ? null : assignment(row.day), row);
const staffingText = s => s.status === "Closed" ? "Store closed" : [...s.teams.map(t => `${t.name}: ${t.state}`), ...(mode === "team" ? [] : [ `${mode === "mixed" ? "Additional people" : "People"}: ${s.additional.on} on · ${s.additional.off} off · ${s.additional.unknown} unknown`])].join(" · ");
const statusMarkup = s => `<span class="staff-status ${s.status === "Needs schedule" ? "needs-schedule" : s.status === "Low staff" ? "low-staff" : ""}">${icon(s.status === "Scheduled" ? "check" : "warn")}${s.status}</span>`;
function syncCalendarLayout() {
  const font = parseFloat(getComputedStyle(document.documentElement).fontSize);
  app.classList.toggle("calendar-list", app.clientWidth < 7 * 8 * font);
}
window.addEventListener("resize", syncCalendarLayout);
new MutationObserver(syncCalendarLayout).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["style"],
});
function render(focusId, announcement = "") {
  const dates = monthDays(month),
    list = rows(),
    d = draft(),
    issues = list.reduce((n, r) => n + r.issues.length, 0);
  const sales = monthSales(d.store, month, today());
  const heat = new Map(salesHeat(d.store, month, today()).map(r => [r.day, r]));
  const reviewed = d.accepted && d.reviewFingerprint === fingerprint(list);
  const byDay = new Map(list.map((r) => [r.day, r]));
  app.innerHTML = `<div class="notice">Fictional draft · Lost on refresh · Nothing published</div>
 <div class="toolbar"><label>Store<select id="store">${stores.map((s, i) => `<option value="${i}" ${i === selected ? "selected" : ""}>${s.name}</option>`).join("")}</select></label><label>Month<input id="month" type="month" value="${month}" min="2014-01" max="2100-12" pattern="[0-9]{4}-[0-9]{2}" placeholder="YYYY-MM" required></label><button id="today">${icon("calendar")}Today</button>${editing ? `<button id="people">${icon("users")}People</button><button id="rules">${icon("clock")}Store hours</button>` : ""}<label>Fixture assignment mode<select id="mode">${["team","individual","mixed"].map(m=>`<option ${mode===m?"selected":""}>${m}</option>`).join("")}</select></label><button id="workspace" class="primary">${icon(editing?"arrowleft":"calendar")}${editing ? "Return to manager view" : "Make Schedule"}</button></div><h2>${editing ? "Monthly editing workspace" : "Manager schedule"}</h2>
 <div class="month-navigation"><button id="previous" ${month === "2014-01" ? "disabled" : ""} aria-label="Previous month">${icon("arrowleft")}</button><h1 id="period-heading" aria-live="polite">${monthLabel(month)}</h1><button id="next" ${month === "2100-12" ? "disabled" : ""} aria-label="Next month">${icon("arrow")}</button></div>
 <div class="month-summary" aria-label="Month summary"><span><strong id="recorded-total">${sales.total ?? (sales.future === dates.length ? "Not yet available" : "Unknown")}</strong> Units Delivered <small>(${sales.known} days)</small></span><span>${editing ? (issues ? `${issues} to resolve` : reviewed ? "Reviewed locally" : "Ready for manager") : "Saved fictional assignments"}</span></div>
 <div class="heat-legend" aria-label="Recorded sales shading"><span>Recorded sales</span><span class="heat-scale"><span>Fewer</span>${[0,1,2,3,4].map(n=>`<i class="heat-${n}" aria-hidden="true"></i>`).join("")}<span>More</span></span><small>Known sales only. Missing, closed and future dates stay separate.</small></div>
 <section id="sheet" class="panel" hidden aria-label="${editing ? "Editing sheet" : "Day details"}"></section>
 <p class="sr-only" id="day-plan-help">${monthLabel(month)}. Open this date’s daily plan.</p>
 <section class="month-days" aria-label="${monthLabel(month)} daily plans">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => `<span class="weekday-heading">${n}</span>`).join("")}${calendarCells(
   month,
 )
   .map((day) => {
     if (!day) return '<span class="calendar-blank" aria-hidden="true"></span>';
     const r = byDay.get(day),
       sales = heat.get(day), staff = staffing(r);
     return `<button class="month-day ${r.state} sales-${sales.state} ${sales.level === null ? "" : "heat-" + sales.level} ${day === today() ? "is-today" : ""}" id="day-${day}" data-day="${day}" ${day === today() ? 'aria-current="date"' : ""} aria-describedby="day-plan-help"><span class="day-date"><span class="day-weekday">${names[new Date(day + "T12:00:00Z").getUTCDay()]} </span>${Number(day.slice(-2))}${day === today() ? "<small>Today</small>" : ""}</span><span class="day-staffing">${editing ? (r.state === "open" ? `${r.ids.length} ${r.override ? "assigned" : "suggested"} / ${r.required} needed` : r.state === "closed" ? "Closed" : "Unknown hours") : esc(staffingText(staff))}</span>${statusMarkup(staff)}<small class="day-sales">${sales.state === "known" ? `Units Delivered: ${sales.units}` : sales.state === "future" ? "Sales not yet available" : sales.state === "closed" ? "Sales record: Closed" : "Sales unknown"}</small>${sales.best ? `<span class="best-day">${icon("trophy")}${sales.bestLabel}</span>` : ""}${editing && r.override ? "<small>Edited</small>" : ""}${editing && r.issues.length ? `<span class="day-issue">${icon("warn")}${r.issues.length} to resolve</span>` : ""}</button>`;
   })
   .join("")}</section>
 <details class="month-glance"><summary>Month details</summary><p>${sales.known} recorded days · ${sales.closed} recorded Closed · ${sales.unknown} missing · ${sales.future} future.</p><p>${sales.best ? `Best recorded ${sales.bestDays.length > 1 ? "days (tied)" : "day"}: ${sales.bestDays.map(r=>dateLabel(r.day)).join("; ")}, ${sales.best.units} cars each.` : "No recorded best day."} No sales goal is entered, so no goal-based pace is shown.</p><p>Today uses America/New_York. Fictional history ends 13 Oct 2026. Future sales are unavailable; planning ranges are estimates.</p></details>
 ${editing ? `<div class="actions"><button id="accept" class="primary">${icon("check")}Mark reviewed</button><button id="reset">${icon("roundup")}Reset this draft</button><p id="message" role="status">${announcement ? esc(announcement) : reviewed ? "Manager review recorded for this month in this page only." : ""}</p></div>
 <details class="panel review"><summary>Draft scope and proposed defaults</summary><p>The monthly planning period and ability to plan future months follow Jorge’s correction. The layout and remaining UI defaults are proposals for review, not approved Claude choices. The original five-option artifact is unavailable.</p><p>Each store/month starts with a separate copy of fictional availability and store rules. Edits to those settings apply only inside that month’s draft; they are not automatically copied into other months. Returning to Performance keeps applied drafts while this page stays open. Reset affects only the selected store/month.</p><p>Weekly person limits run Monday–Sunday, including earlier dates from the previous month. Those dates use that month’s draft if one exists, otherwise fictional defaults. Editing an earlier month can change a later month’s boundary-week suggestions and invalidate its review; explicit overrides remain intact.</p><p>Six fictional stores have synthetic history from 1 Jan 2014 to 13 Oct 2026. Explicit NA is Closed, missing is Unknown, and zero means zero delivered cars. Ranges illustrate prior same-weekday counts, not validated forecasts. Future months reuse the available fictional history; there is no future observation.</p></details>
 <p class="footer">Full store-hour shifts only. No appointments, inferred historical staffing, partial shifts, breaks, overtime policy, database connection or publishing.</p>` : `<p id="message" role="status">${esc(announcement)}</p>`}`;
  document.querySelector("#store").onchange = (e) => {
    selected = Number(e.target.value);
    render("store");
  };
  document.querySelector("#month").onchange = (e) => {
    if (!validMonth(e.target.value)) {
      e.target.setCustomValidity(
        "Choose a month from January 2014 to December 2100.",
      );
      e.target.reportValidity();
      return;
    }
    month = e.target.value;
    render("month");
  };
  for (const [id, delta] of [
    ["previous", -1],
    ["next", 1],
  ])
    document.getElementById(id).onclick = () => {
      month = shiftMonth(month, delta);
      render(id);
    };
  document.querySelector("#today").onclick = () => {
    month = today().slice(0, 7);
    render("today");
    daySheet(today(), "today");
  };
  document.querySelector("#mode").onchange = e => { mode = e.target.value; render("mode"); };
  document.querySelector("#workspace").onclick = () => { editing = !editing; render("workspace"); };
  if (editing) document.querySelector("#people").onclick = () => personSheet();
  if (editing) document.querySelector("#rules").onclick = () => storeSheet();
  document
    .querySelectorAll("[data-day]")
    .forEach((el) => (el.onclick = () => daySheet(el.dataset.day)));
  if (editing) document.querySelector("#reset").onclick = () => {
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
  const statuses = list.map(staffing);
  window.parent.dispatchEvent(new CustomEvent("scheduler-summary", { detail: { store: d.store.id, month, needs: statuses.filter(s=>s.status==="Needs schedule").length, low: statuses.filter(s=>s.status==="Low staff").length } }));
  syncCalendarLayout();
  if (focusId) {
    const target = document.getElementById(focusId);
    (target?.disabled ? document.getElementById("month") : target)?.focus({
      preventScroll: true,
    });
  }
}
function openSheet(html, openerId) {
  const sheet = document.querySelector("#sheet");
  sheet.hidden = false;
  sheet.innerHTML = html;
  sheet.querySelector("[data-close]").onclick = () => {
    sheet.hidden = true;
    document.getElementById(openerId)?.focus();
  };
  sheet.onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      sheet.querySelector("[data-close]").click();
    }
  };
  const focus = sheet.querySelector(editing ? "input,select,button" : "h2");
  if (!editing && focus) focus.tabIndex = -1;
  focus?.focus();
  sheet.scrollIntoView({ block: "start" });
  return sheet;
}
function daySheet(day, openerId = `day-${day}`) {
  let r = rows().find((r) => r.day === day);
  if (!r) return;
  const summary = staffing(r);
  if (!editing) {
    openSheet(`<h2>${dateLabel(day)}</h2><p class="day-staffing">${esc(staffingText(summary))}</p><p class="recorded-day">Units Delivered: ${salesLabel(recordedDay(draft().store, day, today()))}</p><p>${statusMarkup(summary)}</p><button type="button" data-close>Back to month</button>`, openerId);
    return;
  }
  if (assignment(day)) r = { ...r, ids: summary.on };
  const sheet = openSheet(
    `<h2>${dateLabel(day)}</h2><p class="day-staffing">${esc(staffingText(summary))}</p><p class="recorded-day">Units Delivered: ${salesLabel(recordedDay(draft().store, day, today()))}</p><p><span class="badge ${r.state}">${r.state}</span></p>${
      r.state === "open"
        ? `<h3>Planning range</h3><div class="range">${r.estimate ? `${r.estimate.low} to ${r.estimate.high}` : "Unknown"}<small>delivered cars</small></div><p>${r.estimate?.reason || "Insufficient known history."}</p><p><strong>${r.required} people needed</strong> · ${r.rule.open}:00–${r.rule.close}:00. Minimum ${r.rule.minimum}${r.rule.useCapacity ? `; entered capacity ${r.rule.capacity} cars per full shift` : "; capacity adjustment off"}. Rule effective ${r.rule.effective}.</p><p>Assigned: ${r.ids.map((id) => esc(draft().store.people.find((p) => p.id === id)?.name || id)).join(", ") || "Nobody yet"}.</p><form><fieldset><legend>Teams</legend>${teamsFor(draft().store.people, mode).map((t,i)=>`<label>${t.name}<select data-team="${i}"><option value="">Set team status</option><option>On</option><option>Off</option><option>Unknown</option></select></label>`).join("")}</fieldset><fieldset><legend>Manager assignments for this date</legend>${draft()
            .store.people.map(
              (p) =>
                `<label class="check"><input type="checkbox" name="assigned" value="${p.id}" ${r.ids.includes(p.id) ? "checked" : ""}>${p.name} on</label><label class="check"><input type="checkbox" name="off" value="${p.id}" ${summary.off.includes(p.id)?"checked":""}>${p.name} confirmed off</label>`,
            )
            .join(
              "",
            )}</fieldset><p>Unchecked people remain unknown. Mark on or confirmed off, not both. Closing discards unsaved choices. Conflicts remain visible after applying.</p><div class="actions"><button class="primary">Apply day override</button><button type="button" id="suggest">Use suggestion</button><button type="button" data-close>Back to month</button></div></form>`
        : `<p>${r.state === "closed" ? "Confirmed closed. No shifts or forecast." : "No staffing suggestion until the store status is confirmed."}</p><button type="button" data-close>Back to month</button>`
    }${r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}`,
    openerId,
  );
  if (r.state === "open") {
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
      draft().assignments ??= {};
      draft().assignments[day] = { on, off };
      draft().overrides[day] = on;
      markChanged();
      render(`day-${day}`, `Assignments updated for ${dateLabel(day)}. Review the visible warnings.`);
    };
    sheet.querySelector("#suggest").onclick = () => {
      const saved = draft().overrides[day];
      delete draft().overrides[day];
      const suggestion = rows().find(row => row.day === day).ids;
      if (saved !== undefined) draft().overrides[day] = saved;
      sheet.querySelectorAll('[name="assigned"]').forEach(box => box.checked = suggestion.includes(box.value));
      sheet.querySelectorAll('[name="off"]').forEach(box => box.checked = false);
    };
  }
}
function personSheet(id = "p0") {
  const store = draft().store,
    p = store.people.find((p) => p.id === id);
  const sheet = openSheet(
    `<h2>Person sheet</h2><p>Availability and Monday–Sunday weekly limit for this store and month only. Other monthly drafts retain their own settings. Closing the sheet discards unsaved edits.</p><label>Person<select id="person">${store.people.map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${p.name}</option>`).join("")}</select></label><form><div class="fields"><label>Available from (hour)<input name="start" type="number" min="0" max="23" required value="${p.start}"></label><label>Available until (hour)<input name="end" type="number" min="1" max="24" required value="${p.end}"></label><label>Maximum weekly hours<input name="maxHours" type="number" min="0" max="168" required value="${p.maxHours}"></label></div><fieldset><legend>Days off</legend>${names.map((n, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${p.off.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply to local proposal</button><button type="button" data-close>Close sheet</button></div></form>`,
    "people",
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
    `<h2>Store sheet</h2><p>Entered rules, never inferred from historical staffing. Add a dated version; earlier dates keep their earlier rules. These edits apply only within this month’s draft, not other months. Saving the same effective date replaces that local draft version. Changing the effective date reloads the rules for that date and discards unsaved sheet edits. Closing also discards unsaved edits.</p><form><div class="fields"><label>Effective from<input name="effective" type="date" min="${month}-01" max="${monthDays(month).at(-1)}" value="${effective}" required></label><label>Minimum people throughout open hours<input name="minimum" type="number" min="1" max="30" value="${r.minimum}" required></label><label>Store opens (hour)<input name="open" type="number" min="0" max="23" value="${r.open}" required></label><label>Store closes (hour)<input name="close" type="number" min="1" max="24" value="${r.close}" required></label><label>Delivered cars per person per full shift<input name="capacity" type="number" min="1" max="100" value="${r.capacity}" required></label></div><p><label class="check"><input type="checkbox" name="useCapacity" ${r.useCapacity ? "checked" : ""}>Use my capacity input alongside minimum coverage</label></p><fieldset><legend>Regular closed days</legend>${names.map((n, i) => `<label class="check"><input name="closedDays" type="checkbox" value="${i}" ${r.closedDays.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><h3>Holiday / special-day status</h3><p>Exceptions are exact dates within this monthly draft and update the rule governing that date, even when a later rule version exists. An explicit Open overrides a regular closed day.</p><p><label class="check"><input type="checkbox" name="editHoliday">Edit a special-day exception</label></p><p>Leave this unchecked to preserve existing exceptions when changing coverage.</p><div class="fields"><label>Date<input name="holiday" type="date" min="${effective}" max="${monthDays(month).at(-1)}" value="${holiday}" required disabled></label><label>Status<select name="holidayState" disabled>${["unknown", "closed", "open"].map((state) => `<option value="${state}" ${state === (exceptions[holiday] ?? "unknown") ? "selected" : ""}>${state[0].toUpperCase() + state.slice(1)}</option>`).join("")}</select></label></div><p>Existing entries: ${Object.entries(
      exceptions,
    )
      .filter(([day]) => day.startsWith(month + "-"))
      .map(([d, s]) => `${d}: ${s}`)
      .join(
        "; ",
      )}</p><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply dated local rule</button><button type="button" data-close>Close sheet</button></div></form><details><summary>Rule versions</summary>${store.rules.map((r) => `<p>${r.effective}: ${r.open}:00 to ${r.close}:00, minimum ${r.minimum}</p>`).join("")}</details>`,
    "rules",
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
    store.rules = applyStoreRuleForm(store.rules, f);
    markChanged();
    render("rules", `Store hours saved from ${f.get("effective")}.${f.has("editHoliday") ? ` Special day ${f.get("holiday")}: ${f.get("holidayState")}, applied to the rule governing that date.` : ""}`);
  };
}
render();
window.addEventListener("scheduler-view", () => { editing = false; render("workspace"); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented) {
    e.preventDefault();
    window.parent.dispatchEvent(new Event("scheduler-close"));
  }
});

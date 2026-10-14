import { fixtures, nextWeek, addDays, propose } from "./model.mjs";
import { storeRuleDraft, ruleFromForm } from "./store-editor.mjs";
const stores = fixtures();
let selected = 0,
  start = nextWeek(new Date().toISOString().slice(0, 10)),
  overrides = {},
  accepted = false;
const decisions = Array(5).fill("Not reviewed");
const app = document.querySelector("#app");
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
function render() {
  const store = stores[selected],
    rows = propose(store, start, overrides),
    issues = rows.reduce((n, r) => n + r.issues.length, 0);
  app.innerHTML = `<p class="eyebrow">SAGE / SCHEDULE / ISOLATED PROPOSAL</p><div class="notice"><strong>Fictional data only. Proposed defaults for review.</strong><br>No schedule is published. Changes last only in this page. The manager makes the final decision.</div>
 <h1>Build next week together.</h1><p class="muted">Plan coverage first. Use delivered-car ranges as context, then review each person’s hours.</p>
 <div class="toolbar"><label>Fictional store<select id="store">${stores.map((s, i) => `<option value="${i}" ${i === selected ? "selected" : ""}>${s.name}</option>`).join("")}</select></label><label>Week beginning Monday<input id="week" type="date" value="${start}" step="7" min="2014-01-06"></label><button id="people">Person sheet</button><button id="rules">Store sheet</button></div>
 <h2>${dateLabel(start)} to ${dateLabel(addDays(start, 6))}</h2>
 <section class="summary" aria-label="Week summary"><article><small>Review status</small><strong>${accepted ? "Reviewed locally" : issues ? "Needs input" : "Ready for manager"}</strong></article><article><small>Open-day assignments</small><strong>${rows.reduce((n, r) => n + r.ids.length, 0)}</strong><small>Full store-hour shifts only in this prototype</small></article><article><small>Items to resolve</small><strong>${issues}</strong><small>Availability, coverage and unknown store status</small></article></section>
 <section class="panel" id="sheet" hidden aria-label="Editing sheet"></section>
 <p class="history">Synthetic history: 1 Jan 2014 to 13 Oct 2026 for all six stores. No real workbook or report connection. Explicit NA means Closed; missing means Unknown; 0 means zero delivered cars.</p>
 <section class="days" aria-label="Proposed week">${rows.map((r) => `<article class="day"><header><h3>${dateLabel(r.day)}</h3><span class="badge ${r.state}">${r.state === "open" ? "Open" : r.state === "closed" ? "Closed" : "Unknown"}</span></header>${r.state === "open" ? `<div class="range">${r.estimate ? `${r.estimate.low} to ${r.estimate.high}` : "Unknown"} <small>delivered cars</small></div><p class="muted">${r.estimate?.reason ?? "Not enough known history."}</p><p><strong>${r.required} people suggested</strong> · ${r.rule.open}:00 to ${r.rule.close}:00<br><small>Minimum ${r.rule.minimum}${r.rule.useCapacity ? `; entered capacity ${r.rule.capacity} delivered cars per full shift` : "; capacity adjustment off"}. Rule effective ${r.rule.effective}.</small></p><div>${r.ids.map((id) => `<span class="person">${esc(store.people.find((p) => p.id === id)?.name ?? id)}</span>`).join("") || '<span class="muted">No assignments</span>'}</div><details><summary>Manager override${r.override ? " · edited" : ""}</summary><p class="muted">Choose people for the full store shift. Conflicts remain visible.</p>${store.people.map((p) => `<label class="check"><input type="checkbox" data-day="${r.day}" value="${p.id}" ${r.ids.includes(p.id) ? "checked" : ""}>${p.name}</label>`).join("")}<button data-reset="${r.day}">Use suggestion</button></details>` : `<p>${r.state === "closed" ? "Confirmed closed in entered store rules. No shifts or delivery forecast." : "No staffing suggestion until the store’s status is confirmed."}</p>`}${r.issues.length ? `<ul class="issues">${r.issues.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</section>
 <div class="actions"><button class="primary" id="accept">Mark reviewed locally</button><button id="reset">Reset fictional example</button><span id="message" role="status">${accepted ? "Manager review recorded in this page only." : ""}</span></div>
 <section class="panel review"><h2>Five proposed defaults, your decision</h2><p>The original Claude five-option artifact is unavailable. These are reversible proposals, not approved Claude choices. Review choices remain in this page only and are not submitted.</p>${["Use the existing Schedule area (represented here only)", "Start on the next full Monday-to-Sunday week, with explicit dates and week selection", "Separate person and store sheets", "Show Closed distinctly from Unknown", "Use entered minimum coverage and optional capacity; allow manager overrides"].map((s, i) => `<label class="decision">${s}<select aria-label="Decision ${i + 1}">${["Not reviewed", "Approve", "Adjust", "No"].map((v) => `<option ${decisions[i] === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`).join("")}</section>
 <p class="footer">Prototype limits: no appointments, weather, market inputs, historical staffing inference, employee app integration, partial shifts, breaks, overtime policy or publishing. The range illustrates prior same-weekday delivery counts; it is not a validated prediction interval.</p>`;
  document.querySelectorAll(".decision select").forEach(
    (el, i) =>
      (el.onchange = () => {
        decisions[i] = el.value;
      }),
  );
  document.querySelector("#store").onchange = (e) => {
    selected = Number(e.target.value);
    overrides = {};
    accepted = false;
    render();
  };
  document.querySelector("#week").onchange = (e) => {
    if (!e.target.validity.valid || !e.target.value) {
      e.target.reportValidity();
      return;
    }
    start = e.target.value;
    overrides = {};
    accepted = false;
    render();
  };
  document.querySelector("#people").onclick = () => personSheet();
  document.querySelector("#rules").onclick = () => storeSheet();
  document.querySelector("#accept").onclick = () => {
    if (issues)
      document.querySelector("#message").textContent =
        "Resolve the listed conflicts and unknown store status before marking reviewed.";
    else {
      accepted = true;
      render();
    }
  };
  document.querySelector("#reset").onclick = () => {
    stores.splice(0, stores.length, ...fixtures());
    overrides = {};
    accepted = false;
    render();
  };
  document.querySelectorAll("[data-day]").forEach(
    (el) =>
      (el.onchange = () => {
        const day = el.dataset.day;
        overrides[day] = [
          ...document.querySelectorAll(`[data-day="${day}"]:checked`),
        ].map((e) => e.value);
        accepted = false;
        render();
        const detail = [...document.querySelectorAll(".day")]
          .find((e) => e.textContent.includes(dateLabel(day)))
          ?.querySelector("details");
        if (detail) {
          detail.open = true;
          detail.querySelector(`input[value="${el.value}"]`)?.focus();
        }
      }),
  );
  document.querySelectorAll("[data-reset]").forEach(
    (el) =>
      (el.onclick = () => {
        delete overrides[el.dataset.reset];
        accepted = false;
        render();
      }),
  );
}
function openSheet(html, openerId) {
  const sheet = document.querySelector("#sheet");
  sheet.hidden = false;
  sheet.innerHTML = html;
  sheet.scrollIntoView({ block: "nearest" });
  sheet.querySelector("input,select,button")?.focus();
  sheet.querySelector("[data-close]").onclick = () => {
    sheet.hidden = true;
    document.getElementById(openerId).focus();
  };
  sheet.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      sheet.querySelector("[data-close]").click();
    }
  };
  return sheet;
}
function personSheet(id = "p0") {
  const store = stores[selected],
    p = store.people.find((p) => p.id === id);
  const sheet = openSheet(
    `<h2>Person sheet</h2><p>Availability and weekly limit for the selected fictional store. Reset returns to the example. Closing the sheet discards unsaved edits.</p><label>Person<select id="person">${store.people.map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${p.name}</option>`).join("")}</select></label><form><div class="fields"><label>Available from (hour)<input name="start" type="number" min="0" max="23" required value="${p.start}"></label><label>Available until (hour)<input name="end" type="number" min="1" max="24" required value="${p.end}"></label><label>Maximum weekly hours<input name="maxHours" type="number" min="0" max="168" required value="${p.maxHours}"></label></div><fieldset><legend>Days off</legend>${names.map((n, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${p.off.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply to local proposal</button><button type="button" data-close>Close sheet</button></div></form>`,
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
    accepted = false;
    render();
    document.querySelector("#people").focus();
  };
}
function storeSheet(effective = start) {
  const store = stores[selected],
    r = storeRuleDraft(store.rules, effective),
    holiday = addDays(effective, 2);
  const sheet = openSheet(
    `<h2>Store sheet</h2><p>Entered rules, never inferred from historical staffing. Add a dated version; earlier weeks keep their earlier rules. Saving the same effective date replaces that local draft version. Changing the effective date reloads the rules for that date and discards unsaved sheet edits. Closing also discards unsaved edits.</p><form><div class="fields"><label>Effective from<input name="effective" type="date" value="${effective}" required></label><label>Minimum people throughout open hours<input name="minimum" type="number" min="1" max="30" value="${r.minimum}" required></label><label>Store opens (hour)<input name="open" type="number" min="0" max="23" value="${r.open}" required></label><label>Store closes (hour)<input name="close" type="number" min="1" max="24" value="${r.close}" required></label><label>Delivered cars per person per full shift<input name="capacity" type="number" min="1" max="100" value="${r.capacity}" required></label></div><p><label class="check"><input type="checkbox" name="useCapacity" ${r.useCapacity ? "checked" : ""}>Use my capacity input alongside minimum coverage</label></p><fieldset><legend>Regular closed days</legend>${names.map((n, i) => `<label class="check"><input name="closedDays" type="checkbox" value="${i}" ${r.closedDays.includes(i) ? "checked" : ""}>${n}</label>`).join("")}</fieldset><h3>Holiday / special-day status</h3><p>Example closure on 23 Oct and unconfirmed status on 21 Oct are fictional. An explicit Open overrides a regular closed day.</p><p><label class="check"><input type="checkbox" name="editHoliday">Edit a special-day exception</label></p><p>Leave this unchecked to preserve existing exceptions when changing coverage.</p><div class="fields"><label>Date<input name="holiday" type="date" value="${holiday}" required disabled></label><label>Status<select name="holidayState" disabled>${["unknown", "closed", "open"].map((state) => `<option value="${state}" ${state === (r.holidays[holiday] ?? "unknown") ? "selected" : ""}>${state[0].toUpperCase() + state.slice(1)}</option>`).join("")}</select></label></div><p>Existing entries: ${Object.entries(
      r.holidays,
    )
      .map(([d, s]) => `${d}: ${s}`)
      .join(
        "; ",
      )}</p><p role="alert" id="error"></p><div class="actions"><button class="primary">Apply dated local rule</button><button type="button" data-close>Close sheet</button></div></form><details><summary>Rule versions</summary>${store.rules.map((r) => `<p>${r.effective}: ${r.open}:00 to ${r.close}:00, minimum ${r.minimum}</p>`).join("")}</details>`,
    "rules",
  );
  sheet.querySelector('[name="effective"]').onchange = (e) => {
    if (!e.target.value || !e.target.validity.valid) return;
    storeSheet(e.target.value);
  };
  sheet.querySelector('[name="editHoliday"]').onchange = (e) => {
    if (!e.target.checked) {
      const day = sheet.querySelector('[name="holiday"]').value;
      sheet.querySelector('[name="holidayState"]').value =
        r.holidays[day] ?? "unknown";
    }
    for (const name of ["holiday", "holidayState"]) {
      sheet.querySelector(`[name="${name}"]`).disabled = !e.target.checked;
    }
  };
  sheet.querySelector('[name="holiday"]').onchange = (e) => {
    sheet.querySelector('[name="holidayState"]').value =
      r.holidays[e.target.value] ?? "unknown";
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
    const rule = ruleFromForm(store.rules, f);
    store.rules = store.rules
      .filter((r) => r.effective !== rule.effective)
      .concat(rule)
      .sort((a, b) => a.effective.localeCompare(b.effective));
    accepted = false;
    render();
    document.querySelector("#rules").focus();
  };
}
render();

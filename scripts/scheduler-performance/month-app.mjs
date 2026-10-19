import { standaloneHaptics } from "./haptics.mjs";
import { fixtures } from "./model.mjs";
import { fixtureAssignments } from "./assignment-view.mjs";
import { seedTeams } from "./team-model.mjs";
import { mountMonthApp } from "./month-app-core.mjs";

// The preview page: fictional stores (given the fictional Oak and Pine teams outright, since the editor refuses to invent them), the page's own window as the way in and out. The editor itself
// lives in month-app-core.mjs so the live app can mount the same one with real stores.
standaloneHaptics();
const embedded = window.parent !== window;
const handle = mountMonthApp({
  root: document.querySelector("#app"),
  stores: fixtures().map(store => ({ ...store, ...seedTeams(store) })),
  assignmentForDay: fixtureAssignments,
  embedded,
  keyTarget: window,
  onSummary: detail => window.parent.dispatchEvent(new CustomEvent("scheduler-summary", { detail })),
  onClose: () => window.parent.dispatchEvent(new CustomEvent("scheduler-close")),
  onExit: () => window.location.assign(new URL("../", window.location.href)),
});
window.addEventListener("scheduler-view", event => handle.view(event.detail));
window.addEventListener("scheduler-hide", () => handle.hide());

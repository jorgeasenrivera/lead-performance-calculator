import React from "react";
import { createRoot } from "react-dom/client";
import LeadPerformanceCalculator from "./LeadPerformanceCalculator.jsx";
import { installReporter, reportVital } from "./report.js";
import { onINP, onLCP, onCLS } from "web-vitals/attribution";
import { injectSpeedInsights } from "@vercel/speed-insights";

/* Before anything else can go wrong: what does is sent to the error feed. */
installReporter();

/* And how fast it felt, to the vitals feed: the slowest tap on the page
   (INP), the first screen's paint (LCP), anything that jumped (CLS), each
   with the room and the build it happened in. Vercel's Speed Insights gets
   the same numbers by route, for the dashboard; ours carry the room. Nothing
   is measured in development. */
if (import.meta.env.PROD) {
  onINP(reportVital, { reportAllChanges: false });
  onLCP(reportVital);
  onCLS(reportVital);
  try { injectSpeedInsights(); } catch (e) { /* the dashboard's script is optional */ }
}

/* ---- the app's files stay on the phone ----
   A worker (src/sw.js) keeps this build's files so Sage opens with no signal
   and a deploy is not a fresh download over the lot. It is not an install
   prompt: there is no manifest on purpose, because the phone app is the app
   and this site is not to be copied to a home screen as a stand-in for it.

   A new build installs beside the running one and waits. It is let in before
   the first touch of a fresh open, or on the way to the background, never
   under a thumb, and the page reloads onto it once it has taken over. Not
   registered in development, where the files change under it. */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  /* Has this person started doing anything yet? A build that has finished
     installing before the first touch is taken AT ONCE: nothing is mid-shift,
     the reload lands on a screen they have only just opened, and the boot
     curtain covers it. After the first touch it waits for the background,
     which is the rule this has always had and the right one.

     This is the fix for something that cost a day of confusion. The only
     moment a new build used to be let in was on the way to the background,
     and the reload then happened off-screen, so the build a person actually
     SAW was always the one before last. Force quitting did not help: a hard
     kill fires no backgrounding, so the update sat waiting and the next open
     served the old page out of the cache again. Every change shipped reached
     the phone a launch late, and two of them looked like they had not worked
     at all. */
  let touched = false;
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(ev, () => { touched = true; }, { once: true, passive: true, capture: true });
  }
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    /* Some webviews resolve register() with no registration at all. Nothing
       below has anything to watch, then. */
    if (!reg) return;
    const letIn = () => { if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING"); };
    /* ASK, rather than wait to be told, and this is the other half of the bug.
       The browser begins its update check inside register(), and on a phone
       that already has most of the build the new worker can be installed and
       waiting before that promise even resolves: measured on the built app at
       441 ms after a reload. A listener attached afterwards hears nothing, for
       ever, and the build waits for a backgrounding that a force quit never
       sends. So this LOOKS. It costs a reference check every 400 ms for the
       first minute of an untouched app, and unlike an event handler it cannot
       miss the moment it is waiting for. */
    const look = setInterval(() => {
      if (touched) return clearInterval(look);
      if (reg.waiting) { clearInterval(look); letIn(); }
    }, 400);
    setTimeout(() => clearInterval(look), 60000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { letIn(); reg.update().catch(() => {}); } });
    /* And ask on the way IN as well as on the way out. The browser checks the
       worker script on its own, but as a courtesy rather than on any schedule
       to rely on: a build nobody looks for is a build nobody gets. */
    reg.update().catch(() => {});
    /* The page reloads onto the new build only when one has taken over from
       another; the very first install has nothing to reload onto. */
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) window.location.reload(); had = true; });
  }).catch(() => { /* a browser without it starts from the network, as before */ });
}

/* Inside the phone app the strips above and below the page take the page's
   own colour. The page already says what that is, in its theme-color meta, and
   this tells the shell every time it changes. Nothing happens in a browser. */
(function tellShellTheColour() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const shell = window.ReactNativeWebView;
  if (!meta || !shell || typeof shell.postMessage !== "function") return;
  const post = () => { try { shell.postMessage(JSON.stringify({ type: "theme", payload: meta.getAttribute("content") })); } catch (e) {} };
  post();
  new MutationObserver(post).observe(meta, { attributes: true, attributeFilter: ["content"] });
})();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LeadPerformanceCalculator />
  </React.StrictMode>
);

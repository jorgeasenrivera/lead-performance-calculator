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
  /* Two moments, and neither of them is in the middle of a session.
     -----------------------------------------------------------------------
     Adopting a new build means reloading, because the page that is running IS
     the old build. There is no way around the reload. The whole question is
     WHEN it is paid.

     Paid at the start of an open, before a pixel is drawn, it costs almost
     nothing. Paid after the app has booted, it costs the entire boot. That is
     handled below the app itself, where the page asks once, first, whether a
     build is already waiting from last time.

     Paid on the way to the background, it costs nothing at all, because
     nobody is looking. That is here.

     What is NOT done any more is taking a build in the middle of an open, and
     two attempts at that failed before the reason was clear. Measured on the
     built app: the new worker finished installing 266 ms in, which looked
     early enough to be free. It was not, because location.reload() is held
     until the page it was called on finishes loading, and that page was busy
     booting the app; the navigation did not commit until 1301 ms and the whole
     boot before it was thrown away. Every open that followed a deploy cost
     3.2 seconds against a normal 2.0, and that is what Jorge felt on the
     18th of September. Backing the deadline off did not help either, because
     the build kept arriving inside it. The cost was never the waiting. The
     cost is reloading a page that has already booted.

     So: a build that installs during an open is left alone. It is taken on the
     way out, or failing that at the start of the next open, and both of those
     are free. Late by one open at worst, and never slow. */
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    /* Some webviews resolve register() with no registration at all. Nothing
       below has anything to watch, then. This crashed the admin store in #367:
       a setInterval closing over reg threw on its next tick. */
    if (!reg) return;
    const letIn = () => { if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING"); };
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

/* ---- a build waiting from last time is taken before a pixel is drawn ----
   The reload that adopting costs is paid either way. Paid here it is a page
   that has drawn nothing; paid after the app has booted it is the whole boot
   thrown away, which measured 1.2 seconds on every open that followed a
   deploy. So the question is asked once, first, and only of a page that is
   already controlled: a first-ever visit has nothing to swap onto.

   It never blocks. getRegistration resolves off the phone in a millisecond or
   two, and if it is slow, throws, or the swap does not happen, the timer draws
   the app anyway. */
let drawn = false;
const draw = () => {
  if (drawn) return;
  drawn = true;
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <LeadPerformanceCalculator />
    </React.StrictMode>
  );
};
let asking = false;
try {
  if ("serviceWorker" in navigator && import.meta.env.PROD && navigator.serviceWorker.controller) {
    asking = true;
    setTimeout(draw, 300);
    navigator.serviceWorker.getRegistration().then((reg) => {
      /* Waiting means installed last time and never taken. Take it: the
         controllerchange above reloads, and this page never draws. */
      if (reg && reg.waiting) { reg.waiting.postMessage("SKIP_WAITING"); return; }
      draw();
    }).catch(draw);
  }
} catch (e) { asking = false; }
if (!asking) draw();

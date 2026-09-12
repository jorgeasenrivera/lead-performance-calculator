import React from "react";
import { createRoot } from "react-dom/client";
import LeadPerformanceCalculator from "./LeadPerformanceCalculator.jsx";
import { installReporter } from "./report.js";

/* Before anything else can go wrong: what does is sent to the error feed. */
installReporter();

/* ---- the app's files stay on the phone ----
   A worker (src/sw.js) keeps this build's files so Sage opens with no signal
   and a deploy is not a fresh download over the lot. It is not an install
   prompt: there is no manifest on purpose, because the phone app is the app
   and this site is not to be copied to a home screen as a stand-in for it.

   A new build installs beside the running one and waits. It is let in when
   the app goes to the background or at the next open, never mid-shift, and
   the page reloads onto it once it has taken over. Not registered in
   development, where the files change under it. */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    const letIn = () => { if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING"); };
    if (reg.waiting) letIn();                                    // an update that arrived last time: now
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => { if (w.state === "installed" && document.hidden) letIn(); });
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { letIn(); reg.update().catch(() => {}); } });
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

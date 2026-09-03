import React from "react";
import { createRoot } from "react-dom/client";
import LeadPerformanceCalculator from "./LeadPerformanceCalculator.jsx";

/* ---- no home-screen copies ----
   The phone app is the app. This site is not to be installed from a browser
   as a stand-in for it, so nothing is registered here, and a worker that an
   earlier build did register is taken back out on the next open. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
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

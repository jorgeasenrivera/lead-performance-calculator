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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LeadPerformanceCalculator />
  </React.StrictMode>
);

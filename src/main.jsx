import React from "react";
import { createRoot } from "react-dom/client";
import LeadPerformanceCalculator from "./LeadPerformanceCalculator.jsx";

/* ---- the home screen ----
   The service worker is what lets a phone put Sage on its home screen and open
   it full screen. It caches only the shell and the hashed build files; see
   public/sw.js. Registered after the first paint so it never competes with it,
   and only on a real build: the dev server has no /sw.js to register. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
/* Chrome offers an install prompt of its own; keep it so the Help sheet can
   raise it on request instead of the browser deciding when to interrupt. */
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__lpcInstall = e; });

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LeadPerformanceCalculator />
  </React.StrictMode>
);

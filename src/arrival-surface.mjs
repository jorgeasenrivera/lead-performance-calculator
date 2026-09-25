import { ARRIVAL_CSS } from "./arrival-style.mjs";

let active = null;
let releaseHoverHold = null;

/** Lives outside the replaced React subtree, but is disposed by the login owner. */
export function openArrivalSurface(reduced) {
  active?.dispose();
  releaseHoverHold?.();
  const root = document.documentElement;
  const app = document.getElementById("root"), wasInert = app?.inert;
  if (app) app.inert = true;
  const style = document.createElement("style");
  style.textContent = ARRIVAL_CSS;
  document.body.append(style);
  root.classList.add("sage-flight-owned");
  root.classList.toggle("sage-flight-reduce", reduced);
  const before = root.getBoundingClientRect().width;
  root.classList.add("sage-flight-lock", "sage-flight-hover-hold");
  root.style.setProperty("--arrival-scrollbar-width", Math.max(0, root.getBoundingClientRect().width - before) + "px");
  const scan = document.createElement("div");
  scan.className = "sage-arrival-scan"; scan.setAttribute("aria-hidden", "true");
  const destination = document.createElement("div");
  destination.className = "sage-arrival-destination"; destination.setAttribute("aria-hidden", "true");
  const name = document.createElement("span"); destination.append(name);
  const panel = document.createElement("section");
  panel.className = "sage-arrival-wait"; panel.hidden = true;
  panel.innerHTML = '<article><h1 tabindex="-1">Preparing your dashboard</h1><p></p><button class="primary" type="button">Try again</button></article>';
  const heading = panel.querySelector("h1"), explanation = panel.querySelector("p"), retry = panel.querySelector("button");
  retry.onclick = () => window.location.reload();
  document.body.append(scan, destination, panel);
  let disposed = false, scanDone = reduced, scanStarted = false, assemblyDone = false, complete = null;
  let assemblyTimer = 0, scanTimer = 0, recovery = false;
  const finish = () => {
    if (disposed || !assemblyDone || !scanDone || !complete) return;
    const fn = complete; complete = null; fn();
  };
  const scanEnd = event => {
    if (event.animationName !== "sageArrivalScan") return;
    if (event.type === "animationcancel") console.warn("[Sage arrival] Finishing scan was cancelled.");
    scanDone = true; clearTimeout(scanTimer); finish();
  };
  scan.addEventListener("animationend", scanEnd);
  scan.addEventListener("animationcancel", scanEnd);
  const surface = {
    phase(phase) {
      if (disposed) return;
      if (phase === "cruise" && !recovery) surface.covered();
      if (["burst", "waiting", "off"].includes(phase)) destination.dataset.state = phase === "burst" ? "exit" : "hidden";
      if (phase === "waiting") surface.wait(false);
    },
    destination(value) {
      if (disposed || !panel.hidden || reduced) return;
      name.textContent = typeof value === "string" ? value : "";
      destination.dataset.state = name.textContent ? "show" : "hidden";
    },
    recovery(failed) { recovery = !!failed; if (recovery) surface.wait(true); },
    wait(failed) {
      if (disposed) return;
      failed = failed || recovery;
      panel.hidden = false; retry.hidden = !failed;
      root.classList.add("sage-arrival-waiting");
      panel.classList.toggle("no-flight", reduced || !document.querySelector(".sage-jump-canvas"));
      heading.textContent = failed ? "Connection interrupted" : "Preparing your dashboard";
      explanation.textContent = failed ? "Your dashboard has not opened. Check your connection, then try again." : "Your store is taking a little longer to arrive. We'll open it when it's ready.";
      if (failed) heading.focus({ preventScroll: true });
    },
    covered() { panel.hidden = true; root.classList.remove("sage-arrival-waiting"); },
    startScan() {
      if (disposed || reduced || scanStarted) return;
      scanStarted = true; root.classList.add("sage-flight-scan");
      scanTimer = setTimeout(() => {
        console.warn("[Sage arrival] Finishing scan exceeded its completion window.");
        scanDone = true; finish();
      }, 2800);
    },
    afterLanding(fn, delay) {
      complete = fn;
      assemblyTimer = setTimeout(() => { assemblyDone = true; finish(); }, delay);
    },
    dispose() {
      if (disposed) return;
      disposed = true; complete = null;
      clearTimeout(assemblyTimer); clearTimeout(scanTimer);
      scan.removeEventListener("animationend", scanEnd); scan.removeEventListener("animationcancel", scanEnd);
      root.classList.remove("sage-flight-owned", "sage-flight-reduce", "sage-flight-lock", "sage-flight-scan", "sage-arrival-waiting");
      if (app) app.inert = wasInert;
      // A parked pointer must not open a tooltip as the destination lands.
      // One genuine input releases it, without a delayed background timer.
      const releaseHover = () => {
        root.classList.remove("sage-flight-hover-hold");
        for (const type of ["pointermove", "pointerdown", "keydown"]) window.removeEventListener(type, releaseHover);
        if (releaseHoverHold === releaseHover) releaseHoverHold = null;
      };
      releaseHoverHold = releaseHover;
      for (const type of ["pointermove", "pointerdown", "keydown"]) window.addEventListener(type, releaseHover, { once: true });
      root.style.removeProperty("--arrival-scrollbar-width");
      style.remove(); scan.remove(); destination.remove(); panel.remove();
      if (active === surface) active = null;
    },
  };
  active = surface;
  return surface;
}

export function startArrivalScan() { active?.startScan(); }
export function finishArrivalLanding(fn, delay) {
  if (active) active.afterLanding(fn, delay);
  else setTimeout(fn, delay);
}

/** Called after React commits the destination, never by a mutation observer. */
export function prepareArrivalSurface(onReady) {
  let cancelled = false, finished = false, frame = 0;
  const prepared = () => {
    if (cancelled || finished) return;
    finished = true; clearTimeout(limit);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { if (!cancelled) onReady(); }); });
  };
  // A broken font or image may use its fallback. It must not strand sign-in.
  const limit = setTimeout(prepared, 1800);
  const images = [...document.querySelectorAll(".s2-hero img,.bp-hero img,.topbar img")];
  Promise.allSettled([document.fonts?.ready, ...images.map(img => img.decode?.())]).then(prepared);
  return () => { cancelled = true; clearTimeout(limit); cancelAnimationFrame(frame); };
}

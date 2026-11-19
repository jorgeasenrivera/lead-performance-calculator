/* The motion kit.
   -------------------------------------------------------------------------
   One set of speeds and curves for every screen, so a sheet, a tap, a number
   and a row that changes rank all move as if the same hand drew them. Jorge
   picked the "Fun" level on the demo page on 18 November: a real spring with
   about 7% overshoot on arrival, a calmer spring for travel, and an exit that
   leaves the way the thing came in, a little quicker than it arrived.

   It lives in its own file so the two big files only call into it. The rooms
   (Home, Live Floor, Phone Line) keep their own locked clocks and curves, as
   docs/sheets/rooms.html says; nothing here touches .sf, .mc-tab, .mcf or .ar.

   A switch, for comparing: ?motion=off on any address turns the kit off on
   that phone until ?motion=on, and the app moves as it did before. */
import kitCSS from "./motion-kit.css?inline";

export const MK = {
  tap: 110, move: 380, stage: 560,
  /* ζ for the pop, and the glide is the same spring with more damping. */
  zeta: 0.64,
  pop: "cubic-bezier(.34,1.3,.64,1)",
  glide: "cubic-bezier(.22,1,.36,1)",
  exit: "cubic-bezier(.4,0,.7,.2)",
  on: false,
};

/* A damped spring sampled over normalised time; it settles by t = 1. CSS
   linear() draws it exactly where the browser has it; the cubic-bezier above
   is the nearest single curve for the ones that do not. */
export function springPoints(z, n = 48) {
  z = Math.min(z, 0.97);
  const w = 6.5 / z, wd = w * Math.sqrt(1 - z * z), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
    out.push(i === n ? 1 : x);
  }
  return out;
}
export const toLinear = (pts) => "linear(" + pts.map((v) => +v.toFixed(4)).join(", ") + ")";

/* Reduced motion, from the phone or from Sage's own switch. Read every time,
   because either can change while the app is open. */
export function calm() {
  if (typeof window === "undefined") return true;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  } catch (e) { /* an old WebView without matchMedia moves */ }
  return document.documentElement.classList.contains("sage-signal-reduce");
}

/* One door for the kit's own animations, so reduced motion is honoured in one
   place: under it, anything that would travel becomes a short fade, or nothing. */
export function mkAnimate(el, frames, o = {}) {
  if (!el || typeof el.animate !== "function") return null;
  if (calm()) {
    if (!o.calmFade) return null;
    const f = o.calmFade === "out" ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }];
    try { return el.animate(f, { duration: 140, easing: "ease", fill: o.fill || "none" }); } catch (e) { return null; }
  }
  try {
    return el.animate(frames, { duration: o.dur || MK.move, easing: o.ease || MK.pop, delay: o.delay || 0, fill: o.fill || "none" });
  } catch (e) { return null; }
}

/* The landing: a figure that has just changed gives a small bounce. */
export function mkLand(el) {
  if (!MK.on || !el) return;
  mkAnimate(el, [{ transform: "scale(1.14)" }, { transform: "scale(1)" }], { dur: MK.move });
}

function wanted() {
  try {
    const q = new URLSearchParams(window.location.search).get("motion");
    if (q === "off" || q === "on") localStorage.setItem("sage:motion", q);
    return localStorage.getItem("sage:motion") !== "off";
  } catch (e) { return true; }
}

/* ---- leaving the way it came ----
   Sheets and pop-ups are portals straight onto <body>, so when React closes
   one it is simply gone, which is the vanish the sweep found. The kit keeps a
   copy for the length of the exit: the same pixels, inert and untouchable,
   slid or shrunk back the way the sheet arrived, then removed. React's own
   tree is never touched. */
const EXITS = [
  /* Centred pop-ups shrink back where they grew from. */
  { box: ".mc-ov, .fsw-ov, .fr-pop, .ru-scrim", panel: ".mc-sheet, .fsw-sheet, .fr-sheet, .ru-sheet", kind: "pop" },
  /* Bottom sheets slide back down. */
  { box: ".help-back, .fba-sheetwrap", panel: ".help-sheet, .fba-sheet", kind: "sheet" },
  /* My day is a page pushed over Home; Back slides it off the way it came. */
  { box: ".sf-day-root", panel: null, kind: "push" },
];
const EXIT_BOX = EXITS.map((e) => e.box).join(", ");
const scrolled = new WeakMap();

function copyScroll(from, to) {
  const a = [from, ...from.querySelectorAll("*")], b = [to, ...to.querySelectorAll("*")];
  if (a.length !== b.length) return;
  for (let i = 0; i < a.length; i++) { const y = scrolled.get(a[i]); if (y) b[i].scrollTop = y; }
}

function ghost(node) {
  const spec = EXITS.find((e) => node.matches(e.box));
  if (!spec || !document.body) return;
  const g = node.cloneNode(true);
  g.setAttribute("data-mk-ghost", "");
  g.setAttribute("aria-hidden", "true");
  try { g.inert = true; } catch (e) { /* older engines: pointer-events below still holds */ }
  g.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  document.body.appendChild(g);
  copyScroll(node, g);
  const panel = spec.panel ? g.querySelector(spec.panel) : null;
  let lead;
  if (calm()) {
    lead = mkAnimate(g, [], { calmFade: "out", fill: "forwards" });
  } else if (spec.kind === "push") {
    lead = mkAnimate(g, [{ transform: "none" }, { transform: "translateX(100%)" }], { dur: 300, ease: MK.exit, fill: "forwards" });
  } else {
    const dur = spec.kind === "sheet" ? 380 : 260;
    lead = mkAnimate(g, [{ opacity: 1 }, { opacity: 0 }], { dur, ease: "ease-in", fill: "forwards" });
    if (panel) {
      const to = spec.kind === "sheet" ? "translateY(100%)" : "scale(.9)";
      mkAnimate(panel, [{ transform: "none", opacity: 1 }, { transform: to, opacity: spec.kind === "sheet" ? 1 : 0 }], { dur, ease: MK.exit, fill: "forwards" });
    }
  }
  const done = () => g.remove();
  if (lead) { lead.onfinish = done; lead.oncancel = done; setTimeout(done, 700); } else done();
}

function watchExits() {
  /* A sheet's scroll position does not survive cloneNode, so the last one
     seen inside an overlay is kept for the copy. */
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(EXIT_BOX)) scrolled.set(t, t.scrollTop);
  }, { capture: true, passive: true });
  new MutationObserver((records) => {
    if (!MK.on) return;
    for (const r of records) {
      /* Opened again before the copy finished leaving: the copy goes now. */
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && !n.hasAttribute("data-mk-ghost") && n.matches(EXIT_BOX)) {
          document.querySelectorAll("body > [data-mk-ghost]").forEach((g) => g.remove());
        }
      }
      for (const n of r.removedNodes) {
        if (n.nodeType === 1 && !n.hasAttribute("data-mk-ghost") && n.matches(EXIT_BOX)) ghost(n);
      }
    }
  }).observe(document.body, { childList: true });
}

/* ---- rows that change rank hop to their new place ----
   Every list below keeps its rows keyed, so when the order changes React moves
   the same nodes. The kit remembers where each row sat and, when a row lands
   somewhere new in the same list, plays it from the old place to the new one.
   A row that climbs lifts a little on the way. Rows that only appear or leave
   are not this; they arrive with the list. */
const LISTS = [
  ".s2-rolecard", ".s2-podium", ".bp-stand", ".s2-slide",
].join(", ");
const ROWS = ":scope > :is(.s2-person, .s2-pod, .bp-row, .assoc-card)";
const seen = new WeakMap();

function measure(list) {
  const rows = [...list.querySelectorAll(ROWS)];
  rows.forEach((r, i) => seen.set(r, { top: r.offsetTop, i }));
  return rows;
}
function hop(list) {
  const rows = [...list.querySelectorAll(ROWS)];
  const before = rows.map((r) => seen.get(r));
  const tops = rows.map((r) => r.offsetTop); // all reads, then all writes
  rows.forEach((r, i) => {
    const was = before[i];
    seen.set(r, { top: tops[i], i });
    if (!was || was.i === i) return;
    const dy = was.top - tops[i];
    if (!dy || Math.abs(dy) > 2400) return;
    const up = dy > 0;
    mkAnimate(r, up
      ? [{ transform: `translateY(${dy}px)` }, { transform: `translateY(${dy * 0.5}px) scale(1.03)`, offset: 0.35 }, { transform: "none" }]
      : [{ transform: `translateY(${dy}px)` }, { transform: "none" }], { dur: MK.stage + 80 });
    if (up) r.style.zIndex = "2", setTimeout(() => { r.style.zIndex = ""; }, MK.stage + 100);
  });
}
/* ---- menus that close in place ----
   The room picker is drawn inside the tab bar, not on <body>, so its copy goes
   back where it stood; it is positioned absolutely, so nothing around it moves. */
const IN_PLACE = ".qpick";
function ghostInPlace(node, parent, next) {
  /* A menu taking its place ends the picker at once: two menus are never on
     screen together, even for the length of a fade. */
  if (!parent.isConnected || document.querySelector(".drawer-root.open")) return;
  const g = node.cloneNode(true);
  g.setAttribute("data-mk-ghost", "");
  g.setAttribute("aria-hidden", "true");
  try { g.inert = true; } catch (e) { /* pointer-events in the stylesheet still holds */ }
  g.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  g.removeAttribute("id");
  parent.insertBefore(g, next && next.parentNode === parent ? next : null);
  const a = calm()
    ? mkAnimate(g, [], { calmFade: "out", fill: "forwards" })
    : mkAnimate(g, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.9)" }], { dur: 220, ease: MK.exit, fill: "forwards" });
  const done = () => g.remove();
  if (a) { a.onfinish = done; a.oncancel = done; setTimeout(done, 500); } else done();
}

/* ---- the desk's menu drawer ----
   It is always in the page and opens by a class, so closing it was display:none
   in one frame. The kit holds it on screen with mk-closing while it slides back
   down, then lets it go. */
function watchDrawer(el) {
  if (el.__mk) return;
  el.__mk = true;
  let open = el.classList.contains("open"), timer = 0;
  new MutationObserver(() => {
    const now = el.classList.contains("open");
    if (now === open) return;
    open = now;
    clearTimeout(timer);
    if (now) {
      el.classList.remove("mk-closing");
      document.querySelectorAll(IN_PLACE + "[data-mk-ghost]").forEach((g) => g.remove());
      return;
    }
    if (calm()) return;
    el.classList.add("mk-closing");
    timer = setTimeout(() => el.classList.remove("mk-closing"), 400);
  }).observe(el, { attributes: true, attributeFilter: ["class"] });
}

function watchLists() {
  const pending = new Set();
  let frame = 0;
  document.querySelectorAll(".drawer-root").forEach(watchDrawer);
  new MutationObserver((records) => {
    if (!MK.on) return;
    for (const r of records) {
      const t = r.target;
      if (t.nodeType !== 1) continue;
      if (t.matches(LISTS)) pending.add(t);
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(LISTS)) measure(n);
        else if (n.querySelectorAll) n.querySelectorAll(LISTS).forEach(measure);
        if (n.matches(".drawer-root")) watchDrawer(n);
        else if (n.querySelectorAll) n.querySelectorAll(".drawer-root").forEach(watchDrawer);
        if (n.matches(IN_PLACE) && !n.hasAttribute("data-mk-ghost")) t.querySelectorAll(":scope > [data-mk-ghost]").forEach((g) => g.remove());
      }
      for (const n of r.removedNodes) {
        if (n.nodeType === 1 && !n.hasAttribute("data-mk-ghost") && n.matches(IN_PLACE)) ghostInPlace(n, t, r.nextSibling);
      }
    }
    if (pending.size && !frame) {
      /* Before paint, after React has finished the batch. */
      frame = 1;
      queueMicrotask(() => { frame = 0; pending.forEach(hop); pending.clear(); });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

let installed = false;
export function installMotionKit() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  if (!wanted()) return;
  MK.on = true;
  if (window.CSS && CSS.supports && CSS.supports("animation-timing-function", "linear(0, 1)")) {
    MK.pop = toLinear(springPoints(MK.zeta));
    MK.glide = toLinear(springPoints(Math.min(0.95, MK.zeta + 0.24)));
  }
  const root = document.documentElement;
  root.classList.add("mk-on");
  root.style.setProperty("--mk-pop", MK.pop);
  root.style.setProperty("--mk-glide", MK.glide);
  const style = document.createElement("style");
  style.setAttribute("data-motion-kit", "");
  style.textContent = kitCSS;
  document.head.appendChild(style);
  const start = () => { watchExits(); watchLists(); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
}

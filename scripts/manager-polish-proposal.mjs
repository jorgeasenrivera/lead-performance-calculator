/** Isolated approval study. Real Sage components, fictional local data only.
 * The Vite transform changes an in-memory copy, never either application file. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath } from "./manager-performance.mjs";

export function replaceExactlyOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Proposal anchor changed: " + before.slice(0, 90));
  return source.replace(before, after);
}

export function arrivalBoundaryTransform(source) {
  const before = 'const wrap = (node) => <React.Suspense fallback={<Shell><LoadingScreen /><Style /></Shell>}><RoomBoundary name="app">{node}{jumpHold && !holdMount && session && <ArrivalPrepared ready={arrivalDestinationReady && !loadErr && !bootStall && (wantsFloor || view === "admin" || view === "combined" || !!storeData || !!storeMismatch)} identity={wantsFloor ? floorLinks : storeData} />}</RoomBoundary>{signInLayer}</React.Suspense>;';
  const original = before.slice('const wrap = (node) => '.length, -1);
  const destination = original.replace('{signInLayer}', '');
  // A slow destination may show its fallback, but must not hide its login owner.
  return replaceExactlyOnce(source, before,
    'const wrap = (node) => window.__SAGE_POLISH ? <>'+destination+'{signInLayer}</> : '+original+';');
}

export function slowManagerImport(source) {
  const imports = [...source.matchAll(/import\("(\.\/Manager-[\w-]+\.js)"\)/g)];
  if (imports.length !== 1) throw new Error("Slow-manager anchor changed.");
  return replaceExactlyOnce(source, imports[0][0], 'import("'+imports[0][1]+'?study-lag=1")');
}

// One owner per card. Reversing captures the painted pose before cancelling,
// rather than snapping to the fully open pose and starting a second animation.
export function createStudyCardMotion(el, origin, onClose, env = window) {
  const doc = el.ownerDocument, root = doc.documentElement;
  const media = env.matchMedia("(prefers-reduced-motion: reduce)");
  const children = [...el.querySelectorAll(":scope > *")];
  const originals = new Map([el, ...children].map(k => [k, {transform:k.style.transform, opacity:k.style.opacity, animation:k.style.animation, transformOrigin:k.style.transformOrigin}]));
  let animations = [], timer = 0, generation = 0, phase = "opening", closed = false, disposed = false;
  const reduced = () => media.matches || root.classList.contains("sage-study-reduce");
  const own = a => {animations.push(a);a.finished.catch(()=>{});return a;};
  const cancel = () => { ++generation; env.clearTimeout(timer); timer = 0; animations.forEach(a => a.cancel()); animations = []; };
  const pose = () => [el, ...children].map(k => ({k, transform:env.getComputedStyle(k).transform, opacity:env.getComputedStyle(k).opacity}));
  const pin = rows => rows.forEach(({k,transform,opacity}) => {k.style.transform=transform;k.style.opacity=opacity;});
  const label = value => {phase=value;el.dataset.studyCardMotion=value;};
  const rest = () => {el.style.transform="none";el.style.opacity="1";children.forEach(k=>{k.style.transform=originals.get(k).transform;k.style.opacity="1";});};
  const finish = () => {
    cancel();
    if (phase === "closing") {if (!closed) {closed=true;label("closed");onClose();}}
    else {rest();label("open");}
  };
  el.style.animation="none";
  el.style.transformOrigin="0 0";
  const r = el.getBoundingClientRect(), a = origin?.rect;
  const from = a?.width && a?.height && r.width && r.height
    ? `translate(${(a.left-r.left).toFixed(1)}px, ${(a.top-r.top).toFixed(1)}px) scale(${(a.width/r.width).toFixed(4)}, ${(a.height/r.height).toFixed(4)})`
    : "translateY(12px) scale(.98)";
  const play = (frames, duration, easing, onDone) => {
    const token=generation;
    const lead=own(el.animate(frames,{duration,easing,fill:"both"}));
    // The watchdog only bounds a lost completion, it never chooses the normal end.
    timer=env.setTimeout(()=>{if (!disposed && token===generation) onDone();},duration+120);
    lead.finished.then(()=>{if (!disposed && token===generation) onDone();},()=>{});
  };
  const close = () => {
    if (disposed || closed || phase === "closing") return;
    const current=pose(); // all reads, then all writes
    pin(current);cancel();label("closing");
    if (reduced() || doc.hidden || typeof el.animate!=="function") {finish();return;}
    // Shorter departure, still decelerated. A fast close starts at the current
    // matrix and content opacity, not at an invented fully visible frame.
    play([{transform:current[0].transform,opacity:current[0].opacity},{transform:from,opacity:0}],200,"cubic-bezier(.4,0,.22,1)",finish);
    for (const {k,opacity} of current.slice(1)) own(k.animate([{opacity},{opacity:0}],{duration:120,easing:"ease-out",fill:"both"}));
  };
  const preference = () => {if (reduced() && (phase==="opening" || phase==="closing")) finish();};
  const visibility = () => {if (doc.hidden && (phase==="opening" || phase==="closing")) finish();};
  const observer = new env.MutationObserver(preference);
  observer.observe(root,{attributes:true,attributeFilter:["class"]});
  media.addEventListener("change",preference);doc.addEventListener("visibilitychange",visibility);
  label("opening");
  if (reduced() || doc.hidden || typeof el.animate!=="function") finish();
  else {
    play([{transform:from},{transform:"none"}],320,"cubic-bezier(.16,.78,.24,1)",finish);
    for (const k of children) own(k.animate([{opacity:0},{opacity:0,offset:.18},{opacity:1}],{duration:240,easing:"ease-out",fill:"both"}));
  }
  return {close,dispose() {
    disposed=true;cancel();observer.disconnect();media.removeEventListener("change",preference);doc.removeEventListener("visibilitychange",visibility);
    for (const [k,style] of originals) Object.assign(k.style,style);
    delete el.dataset.studyCardMotion;
  }};
}

export function createStudyCount(target, options, env = window) {
  const {from=0,ms=640,delay=0,decimals=0,onValue} = options;
  const doc=env.document, root=doc.documentElement, media=env.matchMedia("(prefers-reduced-motion: reduce)");
  let raf=0, start=null, last=from, done=false;
  const reduced=()=>media.matches || root.classList.contains("sage-study-reduce");
  const remove=()=>{env.cancelAnimationFrame(raf);raf=0;observer.disconnect();media.removeEventListener("change",change);doc.removeEventListener("visibilitychange",change);};
  const finish=()=>{if (done) return;done=true;remove();if (last!==target) {last=target;onValue(target);}};
  const tick=t=>{
    raf=0;if (done) return;
    if (start===null) start=t;
    const elapsed=t-start-delay;
    const p=Math.min(1,Math.max(0,elapsed/Math.max(1,ms)));
    const f=10**decimals, value=Math.round((from+(target-from)*(1-(1-p)**3))*f)/f;
    if (value!==last) {last=value;onValue(value);}
    if (p===1) finish();else raf=env.requestAnimationFrame(tick);
  };
  const change=()=>{
    if (done) return;
    if (reduced() || doc.hidden || from===target) {finish();return;}
    // No polling loop and no RAF work under the lightspeed cover.
    if (!root.classList.contains("jump-under") && !raf && start===null) raf=env.requestAnimationFrame(tick);
  };
  const observer=new env.MutationObserver(change);
  observer.observe(root,{attributes:true,attributeFilter:["class"]});
  media.addEventListener("change",change);doc.addEventListener("visibilitychange",change);change();
  return ()=>{done=true;remove();};
}

export function withinTabTransform(source) {
  const cardStart='function AssocCard({ a, stats, ev, data, config, thresholds, origin, onClose, actions = null }) {\n';
  source=replaceExactlyOnce(source,cardStart,createStudyCardMotion.toString()+'\n'+cardStart+'  const studyMotion = useRef(null);\n  const studyClose = useRef(onClose); studyClose.current = onClose;\n');
  source=replaceExactlyOnce(source,'  const grew = useRef(null);\n  const shut = () => {','  const grew = useRef(null);\n  const shut = () => {\n    if (window.__SAGE_POLISH) { if (studyMotion.current) studyMotion.current.close(); else studyClose.current(); return; }');
  source=replaceExactlyOnce(source,'    const el = boxRef.current;\n    if (!el || !origin) return;','    const el = boxRef.current;\n    if (window.__SAGE_POLISH && el) {\n      const motion = createStudyCardMotion(el, origin, () => studyClose.current());\n      studyMotion.current = motion;\n      return () => { motion.dispose(); studyMotion.current = null; };\n    }\n    if (!el || !origin) return;');
  source=replaceExactlyOnce(source,'function useCountUp(target, ms = 1000, delay = 150, decimals = 0) {\n  const [v, setV] = useState(0);\n  useEffect(() => {',createStudyCount.toString()+'\nfunction useCountUp(target, ms = 1000, delay = 150, decimals = 0) {\n  const [v, setV] = useState(0);\n  const displayed = useRef(0), counted = useRef(false);\n  useEffect(() => {\n    if (window.__SAGE_POLISH) {\n      const first = !counted.current; counted.current = true;\n      return createStudyCount(target || 0, {from:displayed.current, ms:Math.min(ms, first ? 640 : 320), delay:first ? Math.min(delay,160) : 0, decimals, onValue:value => {displayed.current=value;setV(value);}});\n    }');
  return source;
}

export function proposalTransform(source) {
  const swaps = [
    ['<div className="bp-hero">\n        {updatedAt', '<div className="bp-hero">\n        {window.__SAGE_POLISH && <h2 className="sage-bp-store" title={store.name}>{store.name}</h2>}\n        {updatedAt'],
    ['className="fr-acts ac-acts"', 'className={window.__SAGE_POLISH ? "fr-acts sage-perf-actions" : "fr-acts ac-acts"}'],
    ['defaultValue={r.green} key={"g" + r.id + r.green}', 'aria-label={window.__SAGE_POLISH ? r.long + ", green threshold, percent" : undefined} defaultValue={r.green} key={"g" + r.id + r.green}'],
    ['defaultValue={r.yellow} key={"y" + r.id + r.yellow}', 'aria-label={window.__SAGE_POLISH ? r.long + ", yellow threshold, percent" : undefined} defaultValue={r.yellow} key={"y" + r.id + r.yellow}'],
    ['defaultValue={store?.graceDays ?? 10}\n              onBlur', 'aria-label={window.__SAGE_POLISH ? "Monthly grace period, days" : undefined} defaultValue={store?.graceDays ?? 10}\n              onBlur'],
    ['Grace days: how long a new hire is judged on effort before results count.', '{window.__SAGE_POLISH ? "Monthly grace: colours stay off during the first days of each month." : "Grace days: how long a new hire is judged on effort before results count."}'],
    ['<div className="hs-head"><span />{HIST_FIVE.map((f) => <i key={f.k} style={{ background: f.col }} />)}</div>', '<div className="hs-head"><span />{HIST_FIVE.map((f) => window.__SAGE_POLISH ? <span key={f.k} style={{ color: f.col }}>{shortLabel(f)}</span> : <i key={f.k} style={{ background: f.col }} />)}</div>'],
  ];
  for (const [before, after] of swaps) source = replaceExactlyOnce(source, before, after);
  return withinTabTransform(source);
}

export const polishCSS = `
/* The hierarchy changes. The store's colour, artwork and data stay Sage's. */
.sage-polish .s2-hero { border:1px solid rgba(255,255,255,.22); box-shadow:0 14px 28px -18px rgba(18,34,26,.5); }
.sage-polish .s2-store { font-size:26px; letter-spacing:-.035em; }
.sage-polish .s2-head { padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,.22); }
.sage-polish .s2-right { padding-left:22px; border-left:1px solid rgba(255,255,255,.22); }
.sage-polish .bp-hero { border:1px solid rgba(255,255,255,.22); box-shadow:0 12px 22px -15px rgba(18,34,26,.55); }
.sage-polish .sage-bp-store { font:700 12px/1.25 var(--font-display); color:#fff; margin:0 110px 16px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sage-polish .bp-five { padding-top:10px; }
.sage-polish .bp-upd i { animation:none; background:#E4C98D; box-shadow:none; }
.sage-polish .bp-goal, .sage-polish .bp-left, .sage-polish .bp-tl { color:rgba(255,255,255,.87); }
.sage-polish .s2-scap { color:var(--ink); }
.sage-polish .s2-hero .s2-cap, .sage-polish .s2-hero .s2-scap { color:rgba(255,255,255,.88); }
.sage-polish .s2-hero .s2-tube { filter:none; }
.sage-polish .sec-cap { color:var(--ink); letter-spacing:.10em; }
.sage-polish .page .card { box-shadow:0 3px 10px -7px rgba(18,34,26,.25); }
.sage-polish .page button { transition:transform 130ms cubic-bezier(.2,.8,.2,1), background-color 160ms ease, color 160ms ease; }
.sage-polish .page button:active { transform:translateY(1px); }
.sage-polish button:focus-visible, .sage-polish input:focus-visible { outline:3px solid #267D62; outline-offset:3px; }
.sage-polish .co-upd i, .sage-polish .s2-imp::after { animation:none; }
.sage-polish .sage-perf-actions { box-sizing:border-box; min-width:0; width:100%; flex:0 1 auto; justify-content:stretch; }
.sage-polish .sage-perf-actions .fr-b { box-sizing:border-box; min-width:0; white-space:normal; border:2px solid #D4DFD3; background:#fff; color:#15211B; }
.sage-polish .sage-perf-actions .fr-b.pri { background:#567D61; border-color:#567D61; color:#fff; }
.sage-polish .sage-perf-actions .fr-b.warnpri { background:#B8332B; border-color:#B8332B; color:#fff; }
.sage-polish .tg-in input { min-height:44px; width:64px; box-sizing:border-box; font-size:16px; font-weight:700; }
.sage-polish .grace-label input { min-height:44px; font-size:16px; }
.sage-polish .tg-row { min-height:64px; }
.sage-polish .tg-hint { color:rgba(255,255,255,.9); font-size:12px; line-height:1.5; }
.sage-polish .hs-head { grid-template-columns:minmax(72px,1fr) repeat(5,minmax(0,1fr)); column-gap:5px; }
.sage-polish .hs-head > span:not(:first-child) { font:700 10px/1.25 var(--font-ui); text-align:center; overflow-wrap:anywhere; color:#15211B !important; }
.sage-polish .hs-row { grid-template-columns:minmax(72px,1fr) repeat(5,minmax(0,1fr)); column-gap:5px; }
/* The app owns exit, swap and entry. Hold mount effects off for this page's
   whole life, including nested sections, so cleanup cannot start them again.
   Login keeps its own approved choreography. */
.sage-polish.sage-polish-switch:where(:not(.sage-assemble):not(.jump-under):not(.sage-preparing):not(.refresh-hold)) :is(.page,.board-page,.tab-page),
.sage-polish.sage-polish-switch:where(:not(.sage-assemble):not(.jump-under):not(.sage-preparing):not(.refresh-hold)) :is(.page,.board-page,.tab-page) > *,
.sage-polish.sage-polish-switch:where(:not(.sage-assemble):not(.jump-under):not(.sage-preparing):not(.refresh-hold)) .page :is(.hero,.co-gon,.s2-hero) { animation:none !important; }
/* Move only the outer foreground, never both it and its nested sections.
   Direction and the swap still come from Sage's actual tool/tab state. */
@media(prefers-reduced-motion:no-preference) {
.sage-polish.sage-polish-switch:not(.sage-study-reduce):is(.tool-exit,.tab-exit) :is(.page,.board-page:not(.page .board-page),.tab-page:not(.page .tab-page)) {
  animation:sagePolishOut .14s cubic-bezier(.4,0,.9,.3) both !important;
}
.sage-polish.sage-polish-switch:not(.sage-study-reduce):is(.tool-enter,.tab-enter) :is(.page,.board-page:not(.page .board-page),.tab-page:not(.page .tab-page)) {
  animation:sagePolishIn .34s cubic-bezier(.16,.78,.24,1) both !important;
}
}
@keyframes sagePolishOut { from {opacity:1;transform:none} to {opacity:0;transform:translateX(var(--tabx-out,var(--tx-out,0px)))} }
@keyframes sagePolishIn { from {opacity:1;transform:translateX(var(--tabx-in,var(--tx-in,0px)))} to {opacity:1;transform:none} }
@media(max-width:600px) {
  .sage-polish .s2-store { font-size:22px; }
  .sage-polish .s2-right { padding-left:0; border-left:0; }
  .sage-polish .tg-in input { width:64px; }
  .sage-polish .tg-row { row-gap:10px; }
  .sage-polish .hs-c { min-width:0; }
}
@media(prefers-reduced-motion:reduce) {
  .sage-polish .page button { transition:none; }
  .sage-polish .page button:active { transform:none; }
}
.sage-polish.sage-study-reduce .page button { transition:none; }
.sage-polish.sage-study-reduce .page button:active { transform:none; }
.sage-polish.sage-study-reduce.sage-polish-switch :is(.page,.board-page,.tab-page) { animation:none !important; }
@media(prefers-reduced-motion:reduce) {
  .sage-polish.sage-polish-switch :is(.page,.board-page,.tab-page) { animation:none !important; }
}
`;

export function installProposal(proposed, css) {
  if (!["127.0.0.1", "localhost"].includes(location.hostname) || parent === window) return;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => installProposal(proposed, css), {once:true});
    return;
  }
  window.__SAGE_POLISH = proposed;
  let probeInstalled = false;
  const enableProbe = () => { if (!probeInstalled) { probeInstalled = true; installArrivalProbe(); } };
  if (new URLSearchParams(location.search).get("trace") === "1") enableProbe();
  const root = document.documentElement;
  const style = document.createElement("style");
  style.textContent = proposed ? css : "";
  if (proposed) root.classList.add("sage-polish");
  let signInTimer, loginAttempted = false, animations = [], manualReduce = false;
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const report = (status) => parent.postMessage({type:"sage-polish-status", status}, location.origin);
  const stop = () => { animations.forEach(a => a.cancel()); animations = []; };
  const travel = (direction = 0) => {
    stop();
    if (!proposed || manualReduce || media.matches || document.hidden) return;
    if (root.matches(".jump-under,.sage-assemble,.sage-preparing,.refresh-hold,.tool-move,.tab-move")) return;
    const page = document.querySelector(".page");
    if (!page) return;
    root.classList.add("sage-polish-switch");
    // Read all geometry first, then write. Bound the effect to visible groups.
    const candidates = [page.querySelector(".s2-hero,.bp-hero,.hero"), ...page.children];
    const unique = [...new Set(candidates.filter(Boolean))].filter(el =>
      !candidates.some(other => other && other !== el && other.contains(el)));
    const visible = unique.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).slice(0, 6);
    for (const [index, el] of visible.entries()) {
      animations.push(el.animate([
        {transform:direction ? "translateX(" + direction * 24 + "px)" : "translateY(16px)", opacity:.72},
        {transform:"translate(0,0)", opacity:1}
      ], {duration:340, delay:Math.min(index * 24, 96), easing:"cubic-bezier(.16,.78,.24,1)"}));
    }
    report(direction ? (direction > 0 ? "From right" : "From left") + ": 340 ms, then still" : "Replay: header and visible sections land together");
  };
  const ensureStyle = () => { if (document.body.lastElementChild !== style) document.body.appendChild(style); };
  const fillDemo = () => {
    if (loginAttempted) return;
    const email = document.querySelector('.login-card input[placeholder="you@company.com"]');
    const password = document.querySelector('.login-card input[placeholder="Your password"]');
    const button = document.querySelector(".login-card .lf-go");
    if (!email || !password || !button || button.disabled) return;
    loginAttempted = true;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
    set.call(email,"demo@sageonline.app"); email.dispatchEvent(new Event("input", {bubbles:true}));
    set.call(password,"demo"); password.dispatchEvent(new Event("input", {bubbles:true}));
    signInTimer = setTimeout(() => button.click(), 150);
  };
  const observer = new MutationObserver(() => { ensureStyle(); fillDemo(); });
  observer.observe(document.body, {childList:true, subtree:true});
  ensureStyle(); fillDemo();
  // Observe the real transition state, not button names or guessed RAF delays.
  // The microtask runs before paint, including navigation from a card shortcut.
  const phases = new MutationObserver(() => {
    if (!root.matches(".tool-move,.tab-move")) return;
    stop();
    if (proposed && !root.classList.contains("sage-polish-switch")) root.classList.add("sage-polish-switch");
  });
  phases.observe(root, {attributes:true, attributeFilter:["class"]});
  const reduce = () => { stop(); root.classList.toggle("sage-study-reduce", manualReduce || media.matches); };
  media.addEventListener("change", reduce);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type === "sage-polish-replay") travel();
    if (event.data?.type === "sage-polish-trace" && event.data.value) enableProbe();
    if (event.data?.type === "sage-polish-reduce") { manualReduce = !!event.data.value; reduce(); report(manualReduce || media.matches ? "Reduced motion: no travel" : "Motion enabled"); }
  });
  let readyFrame = 0;
  if (new URLSearchParams(location.search).get("compare") === "1") {
    const deadline = performance.now() + 30000;
    let quiet = 0;
    const ready = () => {
      const page = document.querySelector(".page,.board-page,.tab-page");
      if (page &&
          !root.matches(".jump-under,.sage-assemble,.sage-preparing,.refresh-hold,.tool-move,.tab-move") &&
          !document.querySelector(".signin-over,.refresh-flash") &&
          !page.getAnimations({subtree:true}).some(a => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity)) {
        if (++quiet >= 2) { parent.postMessage({type:"sage-polish-ready"},location.origin); return; }
      } else quiet = 0;
      if (performance.now() < deadline) readyFrame = requestAnimationFrame(ready);
    };
    readyFrame = requestAnimationFrame(ready);
  }
  window.addEventListener("pagehide", () => { stop(); cancelAnimationFrame(readyFrame); clearTimeout(signInTimer); observer.disconnect(); phases.disconnect(); media.removeEventListener("change", reduce); }, {once:true});
  report(proposed ? "Proposed polish, fictional store" : "Current design, same fictional store");
}

// Study only: observe the real arrival without driving or extending its clock.
export function installArrivalProbe() {
  const root = document.documentElement;
  const output = document.createElement("pre");
  output.hidden = true; output.id = "sage-arrival-trace";
  document.body.appendChild(output);
  let frame = 0, started = 0, last = 0, previous = "", rows = [], events = [], enabled = true;
  const selectors = [".sage-flash", ".refresh-flash", ".signin-over", ".lpc", ".page", ".page > :first-child", ".board-page > :first-child", ".tab-page > :first-child", ".hero", ".s2-hero", ".bp-hero", ".topbar"];
  const ids = new WeakMap(); let nextId = 0;
  const sample = () => {
    const parts = selectors.map(selector => {
      const el = document.querySelector(selector);
      if (!el) return {selector, missing:true};
      if (!ids.has(el)) ids.set(el, ++nextId);
      const s = getComputedStyle(el);
      return {selector, id:ids.get(el), width:Math.round(el.getBoundingClientRect().width), classes:el.className,
        opacity:Number(Number(s.opacity).toFixed(2)), visibility:s.visibility, display:s.display,
        hiddenAncestor:!!el.closest('[style*="display: none"]'),
        animation:s.animationName, play:s.animationPlayState, radial:el.classList.contains("sa-radial"),
        transform:s.transform === "none" ? "none" : "moving"};
    });
    const state = {classes:root.className, gutter:innerWidth-root.clientWidth, parts};
    const key = JSON.stringify(state);
    if (key !== previous && rows.length < 300) {
      rows.push({ms:Math.round(performance.now()-started), ...state}); previous = key;
    }
    output.textContent=JSON.stringify({rows, events});
  };
  const tick = time => {
    if (time-last >= 80) { sample(); last=time; }
    if (time-started < 12000 && !document.hidden) frame=requestAnimationFrame(tick);
    else stop();
  };
  const begin = () => {
    cancelAnimationFrame(frame); started=performance.now(); last=0; previous=""; rows=[]; events=[];
    output.textContent="Recording"; sample(); frame=requestAnimationFrame(tick);
    observer.observe(root, {attributes:true, attributeFilter:["class"]});
  };
  document.addEventListener("click", event => {
    if (enabled && event.target.closest?.(".login-card .lf-go,.topbar button,nav button,.seg button,.sect-strip button")) begin();
  }, true);
  for (const type of ["animationstart", "animationend", "animationcancel"]) {
    document.addEventListener(type, event => {
      if (!started || events.length >= 300 || !event.target.matches?.(selectors.join(","))) return;
      events.push({ms:Math.round(performance.now()-started), type, name:event.animationName, classes:event.target.className});
    }, true);
  }
  const observer = new MutationObserver(() => { if (started) sample(); });
  const stop = () => {
    cancelAnimationFrame(frame); observer.disconnect();
    if (started) output.textContent=JSON.stringify({rows, events});
    started=0;
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "sage-polish-trace") return;
    enabled = !!event.data.value; if (!enabled) stop();
  });
  window.addEventListener("pagehide", () => {stop(); observer.disconnect();}, {once:true});
}

// Switching the comparison is a document replacement, not a Sage navigation.
// Retain the painted frame until the replacement reports its actual readiness.
export function installComparison() {
  let active = document.querySelector("#app"), pending = null, timeout = 0;
  let mode = "proposed";
  const status = document.querySelector("#status");
  const trace = document.querySelector("#trace");
  const reduce = document.querySelector("#reduce");
  const send = (frame, type, value) => frame?.contentWindow.postMessage({type,value},location.origin);
  const discard = () => { clearTimeout(timeout); pending?.remove(); pending=null; };
  const press = () => document.querySelectorAll("header button[aria-pressed]").forEach(b => b.setAttribute("aria-pressed",String(b.id===mode)));
  for (const id of ["current","proposed"]) document.getElementById(id).onclick = () => {
    discard();
    if (mode === id) { status.textContent="Ready"; return; }
    const frame = document.createElement("iframe");
    frame.title=active.title; frame.style.gridArea="1/1"; frame.style.visibility="hidden"; frame.inert=true;
    pending=frame; status.textContent="Preparing "+id+", keeping this view visible";
    frame.onload=() => send(frame,"sage-polish-reduce",reduce.checked);
    frame.src="/app?mode="+id+"&compare=1"+(trace.checked ? "&trace=1" : "");
    active.parentElement.appendChild(frame);
    timeout=setTimeout(() => { discard(); status.textContent="Comparison did not load. Your previous view is still here."; },30000);
  };
  document.querySelector("#replay").onclick=() => send(active,"sage-polish-replay");
  document.querySelector("#signin").onclick=() => {
    discard();
    active.src="/app?mode="+mode+"&signin=1"+(new URLSearchParams(location.search).get("slow")==="1" ? "&slow=1" : "")+(trace.checked ? "&trace=1" : "");
    status.textContent="Full demo sign-in, then store landing";
  };
  reduce.onchange=() => {send(active,"sage-polish-reduce",reduce.checked);send(pending,"sage-polish-reduce",reduce.checked);};
  trace.onchange=() => {send(active,"sage-polish-trace",trace.checked);send(pending,"sage-polish-trace",trace.checked);};
  active.onload=() => send(active,"sage-polish-reduce",reduce.checked);
  window.addEventListener("message",event => {
    if (event.origin!==location.origin) return;
    if (pending && event.source===pending.contentWindow && event.data?.type==="sage-polish-ready") {
      clearTimeout(timeout);
      const old=active; active=pending; pending=null;
      mode=new URL(active.src).searchParams.get("mode");
      old.remove(); active.id="app"; active.style.visibility=""; active.inert=false;
      press(); status.textContent=mode==="proposed" ? "Proposed polish, fictional store" : "Current design, same fictional store";
    } else if (event.source===active.contentWindow && event.data?.type==="sage-polish-status") status.textContent=event.data.status;
  });
  window.addEventListener("pagehide",discard,{once:true});
}

export function proposalPage() {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sage | Manager polish study</title>
<style>@font-face{font-family:Space;src:url('/fonts/space-grotesk-latin.woff2')}*{box-sizing:border-box}body{margin:0;background:#EDEFE9;color:#152B20;font:14px Space,system-ui}header{padding:16px 22px;background:#152B20;color:white;display:flex;align-items:center;flex-wrap:wrap;gap:12px}header b{font-size:20px;margin-right:auto}button,select{font:inherit;border:1px solid #BCD0BF;border-radius:9px;padding:9px 13px;cursor:pointer}button[aria-pressed=true]{background:#E4C98D;color:#152B20;border-color:#E4C98D}label{display:flex;align-items:center;gap:6px}button:focus-visible,select:focus-visible{outline:3px solid #DBA63F;outline-offset:3px}.note{padding:10px 22px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:#fff;border-bottom:1px solid #CAD4C9}.note span{margin-right:auto}main{padding:18px;overflow:auto}iframe{display:block;border:0;width:100%;height:900px;background:white;margin:auto;box-shadow:0 8px 28px #152B2020;border-radius:12px}body[data-device=phone] iframe{width:390px;height:844px}body[data-device=tablet] iframe{width:768px;height:1024px}details{max-width:1440px;margin:20px auto;background:white;padding:18px;border-radius:14px}summary{font-weight:700;cursor:pointer}.decision{padding:16px 0;border-bottom:1px solid #E0E6DD;display:flex;align-items:center;gap:14px}.decision p{flex:1;margin:0}.decision strong{display:block;margin-bottom:5px}#export{white-space:pre-wrap}small{opacity:.8} @media(max-width:600px){header{padding:12px}main{padding:6px}body[data-device=phone] iframe{width:min(390px,100%)}.decision{flex-wrap:wrap}}</style></head><body data-device="desktop">
<header><b>SAGE / Manager polish</b><button id="current" aria-pressed="false">Current</button><button id="proposed" aria-pressed="true">Proposed</button><select id="device" aria-label="Preview size"><option value="desktop">Desktop</option><option value="phone">Phone, 390 px</option><option value="tablet">Tablet, 768 px</option></select><button id="replay">Replay page motion</button><button id="signin">Replay full sign-in</button><label><input id="reduce" type="checkbox">Reduce page motion</label></header>
<div class="note"><span>Approval study only. Fictional people and figures. Lightspeed artwork and timing retained. No production writes.</span><label><input id="trace" type="checkbox">Record transition</label><small id="status" role="status">Loading Sage</small></div>
<main><div class="frame-stack" style="display:grid"><iframe id="app" style="grid-area:1/1" title="Sage manager dashboard proposal" src="/app?mode=proposed"></iframe></div>
<details open><summary>Manager polish decisions</summary>
${[
  ["1. Dashboard character and flow","Sharper store identity and section contrast, unwarped text, quieter surfaces. One brief directional landing instead of competing entrances. No repeated lightspeed or blinking prompts."],
  ["2. Associate actions","Give the lead restriction and coaching actions their own full-width layout. Fix the mobile overflow without hiding content."],
  ["3. Targets controls","Larger inputs with metric-specific accessible names. Keep all five metrics and their thresholds visible."],
  ["4. Monthly grace wording","Explain that colours are held during the start of each month, not a new hire's first days."],
  ["5. History labels","Name the five metrics above the phone's rows, so colour is not the only way to recognise a column."],
  ["6. Associate card motion","Dashboard: open a person's card, then close it quickly. It returns from its actual position with a short settle, not a jump to fully open first. Repeated closes have one owner. Reduce page motion also stops this travel."],
  ["7. Number updates","Dashboard podium and month recap: first counts settle sooner. Updated numbers continue from the displayed value instead of restarting at zero. Hidden pages and Reduce Motion show the final number without counting."]
].map(([title,reason], i) => `<div class="decision"><p><strong>${title}</strong>${reason}</p><select data-decision="${i}" aria-label="Decision for ${title}"><option value="pending">Not decided</option><option>Approve</option><option>Adjust</option><option>Keep current</option></select></div>`).join("")}
<p>Try Dashboard, Summary, History and Targets in Sage's own navigation. Replay full sign-in to check the lightspeed-to-store join. Arrival follows your system's Reduce Motion setting. Record transition adds a temporary diagnostic probe, off by default. Decisions stay in this browser only.</p><button id="copy">Show my decisions</button><pre id="export" aria-live="polite"></pre></details></main>
<script>const choices=JSON.parse(localStorage.getItem('sage-manager-polish-decisions')||'{}');document.querySelectorAll('[data-decision]').forEach(s=>{s.value=choices[s.dataset.decision]||'pending';s.onchange=()=>{choices[s.dataset.decision]=s.value;localStorage.setItem('sage-manager-polish-decisions',JSON.stringify(choices))}});document.querySelector('#device').onchange=e=>document.body.dataset.device=e.target.value;document.querySelector('#copy').onclick=()=>document.querySelector('#export').textContent=Object.entries(choices).map(([i,v])=>(Number(i)+1)+': '+v).join('\n')||'No decisions yet';(${installComparison.toString()})();</script></body></html>`;
}

export async function buildProposal() {
  process.env.VITE_SUPABASE_URL = "http://127.0.0.1:5433";
  process.env.VITE_SUPABASE_ANON_KEY = "mock-anon-key";
  const {build} = await import("vite");
  return build({build:{outDir:"dist-harness/manager-polish"}, plugins:[{
    name:"sage-manager-polish-proposal", enforce:"pre",
    transform(source, id) {
      const file = id.replace(/\\/g,"/");
      if (file.endsWith("/src/Manager.jsx")) return proposalTransform(source);
      if (file.endsWith("/src/LeadPerformanceCalculator.jsx")) return arrivalBoundaryTransform(source);
    }
  }]});
}

export async function serveProposal(root = "dist-harness/manager-polish", port = 49214) {
  root = path.resolve(root);
  const html = await fs.readFile(path.join(root,"index.html"),"utf8");
  const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  const bundle = entry ? await fs.readFile(path.join(root,entry.slice(1)),"utf8") : "";
  if (!bundle.includes("http://127.0.0.1:5433")) throw new Error("Proposal requires a local mock build, never a live backend.");
  const mime = {".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".woff2":"font/woff2", ".json":"application/json"};
  const server = http.createServer(async (req,res) => {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || "")) {res.writeHead(403).end(); return;}
    if (!["GET","HEAD"].includes(req.method)) {res.writeHead(405).end(); return;}
    try {
      const url = new URL(req.url,"http://127.0.0.1");
      let bytes, type = "text/html";
      if (url.pathname === "/") {
        bytes = proposalPage();
        if (url.searchParams.get("slow") === "1") bytes = bytes
          .replace("No production writes.", "No production writes. Slow manager download test (3.5 s).");
      }
      else if (url.pathname === "/app") {
        const proposed = url.searchParams.get("mode") === "proposed";
        // Run before the module so JSX and CSS agree on the selected mode.
        const setup = `<script>window.__SAGE_POLISH=${proposed};const d=new Date();localStorage.setItem('lpc:roundup:sage-demo:'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),'1');window.addEventListener('error',e=>{const show=()=>{const p=document.createElement('pre');p.hidden=true;p.className='sage-study-error';p.textContent=String(e.error?.stack||e.message).slice(0,2400);document.body.appendChild(p)};if(document.body)show();else document.addEventListener('DOMContentLoaded',show,{once:true})});</script>`;
        // Only the disposable loopback app's known auth key is reset, not all
        // browser storage, decisions, or any real preview's session.
        const fresh = url.searchParams.get("signin") === "1" ? `<script>localStorage.removeItem('lpc-auth');</script>` : "";
        const runtime = `<script>${installArrivalProbe.toString()};(${installProposal.toString()})(${proposed},${JSON.stringify(polishCSS)});</script>`;
        bytes = html.replace("<head>","<head>"+fresh+setup).replace("</body>",runtime+"</body>");
      } else {
        if (url.pathname === "/sw.js" || url.pathname.startsWith("/_vercel/")) {res.writeHead(204).end();return;}
        const file = assetPath(root, req.url);
        if (!file) {res.writeHead(403).end();return;}
        if (/^\/assets\/Manager-[\w-]+\.js$/.test(url.pathname) && url.searchParams.get("study-lag") === "1") {
          await new Promise(resolve => setTimeout(resolve, 3500));
        }
        bytes = await fs.readFile(file); type = mime[path.extname(file)] || "application/octet-stream";
        const from = new URL(req.headers.referer || "http://localhost/");
        // Keep the entry's canonical URL. Adding a query there evaluates it a
        // second time when Manager imports the shared exports from that entry.
        if (url.pathname === entry && from.pathname === "/app" && from.searchParams.get("slow") === "1") {
          const source = bytes.toString("utf8");
          bytes = slowManagerImport(source);
        }
      }
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"connect-src 'self' http://127.0.0.1:5433 ws://127.0.0.1:5433"});
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {res.writeHead(404).end();}
  });
  await new Promise((resolve,reject) => {server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--build")) await buildProposal();
  await serveProposal();
  console.log("Sage manager approval study: http://127.0.0.1:49214/");
}

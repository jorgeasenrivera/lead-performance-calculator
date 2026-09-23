/** Proposal only. The actual built app, with disposable mock auth and preview
 * overrides. Nothing from this file is imported by the application build. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath } from "./manager-performance.mjs";

export const commonMotionCSS = `
html { scrollbar-gutter:stable; }
html.comparison-lock, html.comparison-lock body { overflow:hidden !important; }
html.comparison-lock .lpc, html.comparison-lock .lpc * { pointer-events:none !important; }
html.comparison-hover-hold :is(.bloopwin,.fbc-hover,.tr-tip,[role="tooltip"]) { visibility:hidden !important; }
`;

// Preserve the animation name and list ordering, including the underlying
// cardIn. Swapping names would reintroduce the cleanup flash fixed in #414.
export const tighterMotionCSS = `
@keyframes saRadial {
  0% { opacity:0; transform:translate3d(calc(var(--rx,0px) * .65),calc(var(--ry,0px) * .65),0) scale(.42); }
  12% { opacity:1; transform:translate3d(calc(var(--rx,0px) * .49),calc(var(--ry,0px) * .49),0) scale(.58); animation-timing-function:cubic-bezier(.16,.72,.26,1); }
  78% { opacity:1; transform:translate3d(calc(var(--rx,0px) * -.015),calc(var(--ry,0px) * -.015),0) scale(1.012); animation-timing-function:cubic-bezier(.3,0,.4,1); }
  100% { opacity:1; transform:none; }
}
@keyframes saBreath { from { transform:scale(1.008); } to { transform:none; } }
`;

export function installMotionComparison(variant, css) {
  if (location.hostname !== "127.0.0.1" || window.parent === window) return;
  const root = document.documentElement;
  const style = document.createElement("style");
  style.id = "motion-comparison-overrides";
  style.textContent = css;
  // The app mounts its own stylesheet later. Keep our keyframes after it.
  const ensureStyle = () => {
    if (document.body.lastElementChild !== style) document.body.appendChild(style);
  };
  ensureStyle();
  let started = false, locked = false, landed = false, settled = false;
  let start = 0, raf = 0, watchdog = 0, signInTimer = 0;
  let sample, lastPhase = "", loginAttempted = false;
  const layoutWidth = () => document.body.getBoundingClientRect().width;
  const report = (status) => parent.postMessage({ type:"sage-motion-status", variant, status, sample }, location.origin);
  const publish = () => {
    let out = document.getElementById("motion-comparison-evidence");
    if (!out) { out = document.createElement("pre"); out.hidden = true; out.id = "motion-comparison-evidence"; document.body.appendChild(out); }
    out.textContent = JSON.stringify(sample);
  };
  const releaseHover = () => { if (settled) root.classList.remove("comparison-hover-hold"); };
  window.addEventListener("pointermove", releaseHover, { passive:true });
  window.addEventListener("pointerdown", releaseHover, { passive:true });
  window.addEventListener("keydown", releaseHover);
  const finish = (status) => {
    if (!started) return;
    started = false; settled = true; locked = false;
    clearTimeout(watchdog); cancelAnimationFrame(raf);
    root.classList.remove("comparison-lock");
    sample.status = status;
    sample.finishedAtMs = Math.round(performance.now() - start);
    sample.widthAfter = layoutWidth();
    publish(); report(status);
  };
  const tick = () => {
    if (!started) return;
    const c = root.classList;
    if (c.contains("sage-assemble")) landed = true;
    const active = c.contains("jump-under") || c.contains("sage-assemble") || c.contains("sage-preparing") || !!document.querySelector(".sage-jump-canvas");
    const phase = c.contains("sage-preparing") ? "Preparing under cover" : c.contains("sage-assemble") ? "Landing" : lastPhase || "Signing in";
    const width = layoutWidth();
    sample.widthMin = Math.min(sample.widthMin, width);
    sample.widthMax = Math.max(sample.widthMax, width);
    if (landed && getComputedStyle(root).overflowY !== "hidden") sample.unlockedLandingFrames++;
    if (document.hidden) sample.backgrounded = true;
    if (sample.phase !== phase) { sample.phase = phase; report(phase); }
    if (landed && !active) { finish("Ready to replay"); return; }
    // Reduced Motion has no full tunnel. Completion follows the real layer,
    // not an extra cinematic delay introduced by the proposal.
    if (!active && !document.querySelector(".signin-over") && document.querySelector(".s2-hero") && performance.now() - start > 100) {
      finish("Ready to replay"); return;
    }
    raf = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (started) return;
    start = performance.now(); started = true; settled = false; landed = false; locked = true; lastPhase = "";
    sample = { variant, status:"playing", reducedMotion:matchMedia("(prefers-reduced-motion: reduce)").matches,
      widthMin:layoutWidth(), widthMax:layoutWidth(), unlockedLandingFrames:0, backgrounded:false };
    root.classList.add("comparison-lock", "comparison-hover-hold");
    report("Signing in"); raf = requestAnimationFrame(tick);
    watchdog = setTimeout(() => finish("Playback stopped after 20 seconds. Replay to try again."), 20000);
  };
  document.addEventListener("sage-jump-phase", (event) => { lastPhase = String(event.detail); });
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (button && (button.matches(".login-card .lf-go") || button.textContent.trim() === "Replay intro")) begin();
  }, true);
  const fillDemo = () => {
    if (loginAttempted) return;
    const email = document.querySelector('.login-card input[placeholder="you@company.com"]');
    const password = document.querySelector('.login-card input[placeholder="Your password"]');
    const button = document.querySelector(".login-card .lf-go");
    if (!email || !password || !button || button.disabled) return;
    loginAttempted = true;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(email, "demo@sageonline.app"); email.dispatchEvent(new Event("input", { bubbles:true }));
    set.call(password, "demo"); password.dispatchEvent(new Event("input", { bubbles:true }));
    // Give React its state commit before the ordinary Sign in handler reads it.
    signInTimer = setTimeout(() => button.click(), 150);
  };
  const observer = new MutationObserver(() => { ensureStyle(); fillDemo(); });
  observer.observe(document.body, { childList:true, subtree:true });
  fillDemo();
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "sage-motion-landing") return;
    if (!settled || locked) return;
    const sage = document.querySelector("button.brand-btn");
    if (!sage) { report("Use Full replay to see the arrival again."); return; }
    sage.click();
    requestAnimationFrame(() => {
      const replay = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Replay intro");
      if (replay) replay.click(); else report("Use Full replay to see the arrival again.");
    });
  });
  window.addEventListener("pagehide", () => {
    observer.disconnect(); clearTimeout(signInTimer); clearTimeout(watchdog); cancelAnimationFrame(raf);
    root.classList.remove("comparison-lock", "comparison-hover-hold");
  }, { once:true });
  report("Loading the actual Sage sign-in");
}

export function comparisonPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sage | Lightspeed comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e8ede8;color:#1e3329;font:14px system-ui,sans-serif}main{height:100dvh;display:flex;flex-direction:column}header{padding:14px 20px;background:#f8faf7;border-bottom:1px solid #b9c9bd}h1{font-size:18px;letter-spacing:-.4px;margin:0 0 4px}p{margin:5px 0;color:#526358;font-size:13px;line-height:1.45}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}button,select{font:inherit;border:1px solid #b6c8ba;border-radius:8px;background:#fff;color:#21392c;padding:9px 12px;cursor:pointer}button[aria-pressed=true]{background:#284b38;color:#fff;border-color:#284b38}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #ba7510;outline-offset:2px}.status{font-size:12px;margin-left:auto;color:#536257}iframe{width:100%;flex:1;min-height:0;border:0;background:#eef2ee}.details{position:relative}details{font-size:12px;margin-top:9px}summary{cursor:pointer;width:max-content}fieldset{border:0;padding:9px 0 0;margin:0}label{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:5px 0}select{padding:6px 8px;font-size:12px}#decisions{font-size:12px;color:#345040}.compact header{padding:8px 12px}.compact h1,.compact .intro,.compact details{display:none}.compact .controls{margin:0}.hint{font-size:12px;margin:6px 0 0;color:#617466}@media(max-width:540px){header{padding:10px 12px}h1{font-size:16px}.status{margin-left:0;flex-basis:100%}button{padding:8px 10px}.intro{font-size:12px}}
</style></head><body><main><header><h1>Sage, arriving at lightspeed</h1>
<p class="intro">A motion comparison, not a redesign. Real Sage screens with fictional store data. Your live site is untouched.</p>
<div class="controls"><button id="a" aria-pressed="true">A · Current motion, repaired</button><button id="b" aria-pressed="false">B · Tighter landing</button><button id="replay">Full replay</button><button id="landing" disabled>Landing only</button><button id="compact">More room</button><span class="status" id="status" role="status">Choose a version to begin</span></div>
<p class="hint intro" id="description">A keeps the existing outward flight and rebound. Scrolling waits until the landing finishes; hover cards wait for your pointer.</p>
<details><summary>What changes, and your decisions</summary><p>Both versions keep the Sage mark, tunnel, white cover, colors and dashboard. B travels less, starts less miniature, and settles with a much smaller rebound. No new animation library.</p>
<fieldset><label>1. Scrollbar and hover interruption repair <select id="repair"><option value="Not decided">Not decided</option><option>Approve</option><option>Adjust</option><option>Keep current</option></select></label><label>2. Tighter landing <select id="motion"><option value="Not decided">Not decided</option><option>Approve B</option><option>Adjust B</option><option>Keep A motion</option></select></label></fieldset><p id="decisions">Choices stay on this page only. Tell me your decisions in our chat.</p>
<p>Full replay runs the actual mock sign-in. Landing only isolates the dashboard entrance, without the tunnel or login cover. The demo's daily round-up is marked read so it does not cover the comparison. Reduce Motion follows your device setting. Only one version runs at a time. This page is not an FPS benchmark or an iPhone approval.</p><pre id="evidence" style="white-space:pre-wrap"></pre></details></header><iframe id="preview" title="Actual Sage application, fictional data"></iframe></main>
<script>
const frame=document.querySelector('#preview'),status=document.querySelector('#status');let variant='A',run=0;
function play(next){variant=next;document.querySelector('#a').setAttribute('aria-pressed',String(next==='A'));document.querySelector('#b').setAttribute('aria-pressed',String(next==='B'));document.querySelector('#landing').disabled=true;status.textContent='Loading '+next;document.querySelector('#evidence').textContent='';document.querySelector('#description').textContent=next==='A'?'A keeps the existing outward flight and rebound. Scrolling waits until the landing finishes; hover cards wait for your pointer.':'B keeps the same tunnel and white cover. The dashboard travels a shorter distance and lands with a smaller rebound.';frame.src='/app?variant='+next+'&run='+(++run);}
document.querySelector('#a').onclick=()=>play('A');document.querySelector('#b').onclick=()=>play('B');document.querySelector('#replay').onclick=()=>play(variant);
document.querySelector('#landing').onclick=()=>{document.querySelector('#landing').disabled=true;frame.contentWindow.postMessage({type:'sage-motion-landing'},location.origin)};
document.querySelector('#compact').onclick=()=>{const small=document.body.classList.toggle('compact');document.querySelector('#compact').textContent=small?'Show notes':'More room'};
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='sage-motion-status')return;status.textContent=event.data.variant+' · '+event.data.status;document.querySelector('#landing').disabled=event.data.status!=='Ready to replay';if(event.data.sample?.status!=='playing')document.querySelector('#evidence').textContent=JSON.stringify(event.data.sample,null,2)});
for(const id of ['repair','motion'])document.querySelector('#'+id).onchange=()=>{document.querySelector('#decisions').textContent='Repair: '+document.querySelector('#repair').value+'. Motion: '+document.querySelector('#motion').value+'. Tell me these choices in chat; nothing has been applied.'};
</script></body></html>`;
}

export async function serveMotionComparison(root, port) {
  root = path.resolve(root);
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  const bundle = entry ? await fs.readFile(path.join(root, entry.slice(1)), "utf8") : "";
  if (!bundle.includes("http://127.0.0.1:5433")) throw new Error("Comparison requires a build against the local mock, never a live backend.");
  const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".woff2":"font/woff2", ".json":"application/json" };
  const server = http.createServer(async (req, res) => {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || "")) { res.writeHead(403).end(); return; }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let bytes, type = "text/html";
      if (url.pathname === "/") bytes = comparisonPage();
      else if (url.pathname === "/app") {
        const variant = url.searchParams.get("variant") === "B" ? "B" : "A";
        const css = commonMotionCSS + (variant === "B" ? tighterMotionCSS : "");
        // This server owns a fresh loopback origin. Remove only its mock auth,
        // before the app module starts, so every replay is an ordinary login.
        const reset = '<script>localStorage.removeItem("lpc-auth");const d=new Date();localStorage.setItem("lpc:roundup:sage-demo:"+d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"),"1");</script>';
        const inject = `<script>(${installMotionComparison.toString()})(${JSON.stringify(variant)},${JSON.stringify(css)});</script>`;
        bytes = html.replace("<head>", "<head>" + reset).replace("</body>", inject + "</body>");
      } else {
        // A proposal must not install a worker that outlives the local server.
        if (url.pathname === "/sw.js" || url.pathname.startsWith("/_vercel/")) { res.writeHead(204).end(); return; }
        const file = assetPath(root, req.url);
        if (!file) { res.writeHead(403).end(); return; }
        bytes = await fs.readFile(file); type = mime[path.extname(file)] || "application/octet-stream";
      }
      res.writeHead(200, { "Content-Type":type, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve,reject) => { server.once("error",reject);server.listen(port,"127.0.0.1",resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[3] || 49210);
  await serveMotionComparison(process.argv[2] || "dist", port);
  console.log(`Sage motion comparison: http://127.0.0.1:${port}/`);
}

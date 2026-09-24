/** Isolated proposal. Source transforms live only inside this build, never in src/. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath } from "./manager-performance.mjs";
import { commonMotionCSS, destinationMotionCSS } from "./motion-compare.mjs";

export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Arrival proposal source changed: " + before.slice(0, 90));
  return source.replace(before, after);
}

/** A second, disposable study. Every point starts in the real logo or ground.
 * Perspective, not extra particles, supplies acceleration. Self-contained so
 * the exact same function runs in the existing worker and its fallback. */
export function lightspeedStudyEngine(ctx, world, post) {
  const { W, H, dpr, mk, field } = world;
  const cx = W / 2, cy = H / 2, far = Math.hypot(W,H) * .7;
  const clamp = p => Math.max(0,Math.min(1,p));
  const smooth = p => { p=clamp(p); return p*p*(3-2*p); };
  const ease = p => 1-Math.pow(1-clamp(p),3);
  ctx.scale(dpr,dpr);
  const ground = ctx.createRadialGradient(cx,cy,0,cx,cy,far);
  ground.addColorStop(0,'#294B3B'); ground.addColorStop(.4,'#152B22'); ground.addColorStop(1,'#0B1712');
  const palette = ['#d4ebd6','#92bfa6','#eef5dd','#739e86'];
  const points = field.filter(d => d.x>0 && d.x<W && d.y>0 && d.y<H).map((d,i) => ({
    x:d.x-cx,y:d.y-cy,r:d.size/2,color:d.tint,light:palette[i%4],z:1,
    depth:.72+(i%7)*.13,seed:((i*73)%997)/997,mark:false,
  }));
  for (const d of mk) points.push({x:d.hx-cx,y:d.hy-cy,r:d.hr,color:d.fill,
    sx:d.sx-cx,sy:d.sy-cy,sr:d.sr,light:palette[2],z:1,depth:1.15,seed:d.jit,mark:true});
  // Build exposure colors once, not a new color string for every star/frame.
  const ramps=new Map();
  for(const p of points){
    const key=p.color+p.light;
    if(!ramps.has(key)){
      const parse=c=>c.startsWith('#')?[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16),1]:c.match(/[\d.]+/g).map(Number);
      const from=parse(p.color),to=parse(p.light);
      ramps.set(key,Array.from({length:33},(_,i)=>'rgba('+from.map((n,j)=>n+(to[j]-n)*i/32).join(',')+')'));
    }
    p.ramp=ramps.get(key);
  }
  let start=null,last=null,phase='ratchet',ready=false,done=false,painted=false,cruiseStart=0,exitStart=0;
  let frames=0,drawTotal=0,drawMax=0,previousDraw=null,gaps=0;
  const setPhase = next => { if(phase!==next){phase=next;post('phase',next);} };
  const finish = () => { if(done)return; done=true; post('metrics',{particles:points.length,frames,drawAverageMs:frames?drawTotal/frames:0,drawMaxMs:drawMax,frameGapsOver25Ms:gaps}); post('flash'); };
  const tick = now => {
    if(done)return;
    if(phase==='waiting'){if(ready){exitStart=now;last=now;setPhase('burst');}else return;}
    if(start===null){start=now+(world.lead||0);last=now;}
    const elapsed=now-start,dt=Math.min(.035,Math.max(0,(now-last)/1000)); last=now;
    if(elapsed<0)return;
    const stamp=typeof performance!=='undefined'?performance.now():now;
    if(previousDraw!==null && now-previousDraw>25)gaps++;
    previousDraw=now;
    // A short anticipation is followed by a fast departure, not three separate
    // eased animations restarting from zero speed.
    if(elapsed>=140 && phase==='ratchet')setPhase('reform');
    if(elapsed>=880 && phase==='reform')setPhase('streaks');
    if(elapsed>=1600 && phase==='streaks'){cruiseStart=now;setPhase('cruise');}
    if(phase==='cruise' && ready && now-cruiseStart>=360){exitStart=now;setPhase('burst');}
    if(phase==='cruise' && now-cruiseStart>=2600){setPhase('waiting');return;}
    const gather=smooth((elapsed-140)/740), launch=clamp((elapsed-880)/720);
    const exit=phase==='burst'?clamp((now-exitStart)/520):0;
    const exposure=smooth((elapsed-300)/780);
    const velocity=(.06+Math.pow(launch,2.6)*1.45)*(1+exit*3.4);
    ctx.clearRect(0,0,W,H);
    ctx.globalAlpha=exposure;ctx.fillStyle=ground;ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=1;
    for(const p of points){
      let x=p.x,y=p.y,r=p.r;
      if(p.mark){x+=(p.sx-x)*gather;y+=(p.sy-y)*gather;r+=(p.sr-r)*gather;}
      else {x*=1-gather*.14;y*=1-gather*.14;}
      if(launch>0){
        p.z-=dt*velocity*p.depth;
        // Recycle the same point on its original ray. No random direction
        // changes, spokes through the centre, or particle allocations in flight.
        if(p.z<.08){p.z=2.3+p.seed*.2;}
      }
      const zoom=1/Math.max(.08,p.z),distance=Math.hypot(x,y)||1;
      const head=distance*zoom;
      if(head>far*1.65)continue;
      const shutter=(.006+launch*.095)*(1+exit*.6);
      const tail=distance/Math.max(.08,p.z+velocity*p.depth*shutter);
      const ux=x/distance,uy=y/distance;
      const alpha=clamp((2.3-p.z)/1.3)*(p.mark?1:.4+.6*exposure);
      const width=Math.min(4.5,Math.max(.65,r*(.5+zoom*.25)));
      ctx.globalAlpha=alpha;
      ctx.strokeStyle=p.ramp[Math.round(exposure*32)];
      ctx.fillStyle=ctx.strokeStyle;
      if(head-tail<2){ctx.beginPath();ctx.arc(cx+x*zoom,cy+y*zoom,Math.max(.6,r*Math.min(1.4,zoom)),0,7);ctx.fill();}
      else {
        // Two nested line segments are a tapered exposure, without blur,
        // shadow filters, extra canvases or hundreds of DOM layers.
        ctx.lineCap='round';
        for(let layer=0;layer<2;layer++){
          const a=tail+(head-tail)*layer*.32;
          ctx.globalAlpha=alpha*(layer===0?.25:.94);
          ctx.lineWidth=width*(1-layer*.55);
          ctx.beginPath();ctx.moveTo(cx+ux*a,cy+uy*a);ctx.lineTo(cx+ux*head,cy+uy*head);ctx.stroke();
        }
      }
    }
    ctx.globalAlpha=1;
    if(!painted){painted=true;post('paint');}
    frames++;
    const cost=(typeof performance!=='undefined'?performance.now():now)-stamp;
    drawTotal+=cost;drawMax=Math.max(drawMax,cost);
    if(exit>=1)finish();
  };
  return {tick,msg:m=>{if(m.type==='ready')ready=!!m.ready;if(m.type==='stop')done=true;}};
}

export function transformArrival(source) {
  let out = source.replace(/\r\n/g, "\n");
  const swap = (a, b) => { out = replaceOnce(out, a, b); };
  swap("const JUMP_T = { ratchet: 620, reform: 840, streaks: 800, cruiseMin: 1400, cruiseCap: 3000, burst: 520 };",
    "const JUMP_T = { ratchet: 120, reform: 720, streaks: 620, cruiseMin: 360, cruiseCap: 2600, burst: 420 };");
  // Keep the actual mark and dot field. Remove the sideways kick and hanging
  // arc so the first movement is already travelling towards the destination.
  swap("ctx.arc(d.hx + k * 2.5, d.hy, d.hr * (1 + k * 0.5), 0, 7)", "ctx.arc(d.hx, d.hy, d.hr, 0, 7)");
  swap("const mx = (d.hx + d.sx) / 2, my = Math.max(d.hy, d.sy) + 90;", "const mx = (d.hx + d.sx) / 2, my = (d.hy + d.sy) / 2;");
  swap("const seatScale = scale * 0.62;", "const seatScale = scale * 0.46;");
  swap("if (t >= R && t < R + F) {\n      const k = ease3((t - R) / F);", "if (t >= 0 && t < R + F) {\n      const k = ease3(t / (R + F));");
  swap("if (p > 0.45) drawTunnel(dt, 0.6 * ((p - 0.45) / 0.55));", "if (p > 0.2) drawTunnel(dt, 0.15 + 0.85 * easeInOut((p - 0.2) / 0.8));");
  swap("drawTunnel(dt, 1);", "drawTunnel(dt, 1 + 0.65 * ease(Math.min(1, (now - cruiseT0) / 650)));");
  swap("drawTunnel(dt, 1 + pow(t / T.burst, 1.6) * 7);", "drawTunnel(dt, 1.65 + pow(t / T.burst, 1.6) * 6);");
  swap("q.t = Math.max(0, q.r - (200 + q.size * 55));", "q.t = Math.max(q.r * 0.25, q.r - (40 + q.r * 0.48) * Math.min(1.3, S));");
  // One cached gradient, the existing particles, no blur or extra canvas.
  // The changing exposure makes their depth readable against Sage's own green.
  swap("  const drawTunnel = (dt, S) => {", `  const flightGround = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  flightGround.addColorStop(0, '#294B3B');
  flightGround.addColorStop(0.5, '#152B22');
  flightGround.addColorStop(1, '#0B1712');
  let exposure = 0;
  const tones = new Map(), frameTones = new Map();
  const lightTone = (color) => {
    if (!exposure) return color;
    if (frameTones.has(color)) return frameTones.get(color);
    let rgba = tones.get(color);
    if (!rgba) {
      rgba = color.startsWith('#') ? [parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),1] : color.match(/[\\d.]+/g).map(Number);
      tones.set(color,rgba);
    }
    const target = [201,232,208,0.82];
    const mixed = rgba.map((n,i) => n + (target[i] - n) * exposure);
    const result = 'rgba(' + mixed.join(',') + ')';
    frameTones.set(color,result); return result;
  };
  const drawTunnel = (dt, S) => {`);
  swap("    ctx.clearRect(0, 0, W, H);", `    ctx.clearRect(0, 0, W, H);
    exposure = phase === 'reform' ? easeInOut(Math.min(1,t / T.reform)) : ['streaks','cruise','burst'].includes(phase) ? 1 : 0;
    frameTones.clear();
    if (exposure) { ctx.globalAlpha = exposure; ctx.fillStyle = flightGround; ctx.fillRect(0,0,W,H); ctx.globalAlpha = 1; }`);
  const engineStart = out.indexOf("function arrivalEngineCore(");
  const engineEnd = out.indexOf("/* A pair of frames",engineStart);
  const engine = out.slice(engineStart,engineEnd).replaceAll("= d.tint;", "= lightTone(d.tint);").replaceAll("= q.tint;", "= lightTone(q.tint);").replaceAll("= d.fill;", "= lightTone(d.fill);");
  out = out.slice(0,engineStart) + engine + out.slice(engineEnd);
  // The original hid the real logo while the engine was still waiting for
  // the 320 ms hurry lead. Exchange the two only after a canvas frame exists.
  swap('  root.classList.add("sage-cv");', '  cv.style.opacity = "0";');
  swap('  let ready = false, dest = null, done = false;', '  let ready = false, dest = null, done = false, firstPaint = false;');
  swap('    if (phase === "ratchet" && t >= T.ratchet)', '    if (!firstPaint) { firstPaint = true; post("paint"); }\n    if (phase === "ratchet" && t >= T.ratchet)');
  swap('    if (type === "phase") tellPhase(data);', '    if (type === "paint") { cv.style.opacity = "1"; root.classList.add("sage-cv"); }\n    else if (type === "phase") tellPhase(data);');
  swap('    root.classList.remove("sage-cv", "sage-beat-flash", "sage-cover-active");\n    if (cv.parentNode) cv.parentNode.removeChild(cv);',
    '    root.classList.remove("sage-cv", "sage-beat-flash", "sage-cover-active");\n    if (cv.parentNode && !root.classList.contains("proposal-waiting")) cv.parentNode.removeChild(cv);');
  swap("&& (!atStore || !!storeData || !!storeMismatch || storeLoadFailed);",
    "&& (!atStore || (!!storeData && !storeMismatch && !storeLoadFailed));");
  swap("let arrivalReady = false;", "let arrivalReady = false;\nlet proposalDataReady = false;\ndocument.addEventListener('sage-proposal-screen-ready', () => tellArrivalReady(proposalDataReady));");
  swap("  arrivalReady = !!ready;", "  proposalDataReady = !!ready;\n  arrivalReady = !!ready && window.__sageProposalScreenReady === true;");
  swap("    if (done) return;\n    if (!t0)", "    if (done) return;\n    if (phase === 'waiting') { if (ready) { done = true; post('flash'); } return; }\n    if (!t0)");
  swap("      if ((ready && tc >= T.cruiseMin) || tc >= T.cruiseCap) {\n        phase = \"burst\"; t0 = now; burstT0 = now; post(\"phase\", \"burst\");\n      }",
    "      if (ready && tc >= T.cruiseMin) {\n        phase = 'burst'; t0 = now; burstT0 = now; post('phase', 'burst');\n      } else if (tc >= T.cruiseCap) { phase = 'waiting'; post('phase', 'waiting'); }");
  swap("0.82 + 0.18 * ease(Math.min(1, (now - cruiseT0) / 1600)) + 0.012 * Math.sin(now / 420)",
    "0.94 + 0.06 * ease(Math.min(1, (now - cruiseT0) / 600))");
  swap('    const t = setTimeout(() => { onFlash(); onDone(); }, 180);\n    return () => { clearTimeout(t); jumpOwnsEntrance = false; tellPhase("off"); };',
    `    let stopped = false;
    const started = performance.now();
    const t = setInterval(() => {
      if (stopped) return;
      if (arrivalReady) { stopped = true; clearInterval(t); onFlash(); onDone(); }
      else if (performance.now() - started > 500) tellPhase("waiting");
    }, 60);
    return () => { stopped = true; clearInterval(t); jumpOwnsEntrance = false; tellPhase("off"); };`);
  // A preview toggle only strengthens the device setting. It cannot disable it.
  swap('  jumpShort = arrivalShort();', '  jumpShort = arrivalShort() || window.__sageProposalReduce === true;');
  // The saved draft keeps its engine and timings. The study is opt-in per
  // iframe and cannot enter a production build.
  swap('function arrivalEngineCore(ctx, world, post) {',
    'function arrivalEngineCore(ctx, world, post) {\n  if (world.study) return (' + lightspeedStudyEngine.toString() + ')(ctx, world, post);');
  swap('const world = { W, H, dpr, T: JUMP_T,', 'const world = { study:window.__sageProposalStudy === true, W, H, dpr, T: JUMP_T,');
  swap('cv.className = "sage-jump-canvas";\n  const dpr = Math.min(2, window.devicePixelRatio || 1);', 'cv.className = "sage-jump-canvas";\n  const dpr = Math.min(window.__sageProposalStudy ? 1.5 : 2, window.devicePixelRatio || 1);');
  swap('    else if (type === "flash") toFlash();', '    else if (type === "metrics") document.dispatchEvent(new CustomEvent("sage-study-metrics",{detail:data}));\n    else if (type === "flash") toFlash();');
  swap('        card.style.transform = "scale(" + (1 - k * 0.08) + ")";', '        card.style.transform = window.__sageProposalStudy ? "scale(" + (1 + Math.pow(k,3) * 1.7) + ") translateY(" + (k*k*90) + "px)" : "scale(" + (1 - k * 0.08) + ")";');
  return out;
}

export async function buildArrivalPrototype() {
  process.env.VITE_SUPABASE_URL = "http://127.0.0.1:5433";
  process.env.VITE_SUPABASE_ANON_KEY = "mock-anon-key";
  const { build } = await import("vite");
  return build({ build:{ outDir:"dist-harness/arrival-prototype" }, plugins:[{
    name:"sage-isolated-arrival-proposal", enforce:"pre",
    transform(source, id) {
      if (id.replace(/\\/g,"/").endsWith("/src/LeadPerformanceCalculator.jsx")) return transformArrival(source);
    },
  }] });
}

/** Runs before the app. Only this proposal origin's fictional caches are reset. */
export function installScenario(scenario, reduce, study = false) {
  if (location.hostname !== "127.0.0.1" || parent === window) return;
  window.__sageProposalReduce = reduce;
  window.__sageProposalStudy = study;
  localStorage.removeItem("lpc-auth");
  for (const key of Object.keys(localStorage)) if (key.startsWith("lpc:cache:")) localStorage.removeItem(key);
  const d = new Date();
  localStorage.setItem("lpc:roundup:sage-demo:" + d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"), "1");
  const original = window.fetch.bind(window);
  let slowUntil = 0;
  const announce = (state) => document.dispatchEvent(new CustomEvent("sage-proposal-request", { detail:state }));
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
    const method = (init.method || input.method || "GET").toUpperCase();
    if (url.origin !== "http://127.0.0.1:5433" || method !== "GET" || !url.pathname.endsWith("/app_data") || !url.searchParams.get("key")?.includes("lpc:store:")) return original(input, init);
    const signal = init.signal || input.signal;
    announce("requested");
    // Delay the initial connection window, not every sequential follow-up read.
    if (scenario === "slow" && !slowUntil) slowUntil = Date.now() + 4000;
    const delay = scenario === "slow" ? Math.max(0, slowUntil - Date.now()) : scenario === "interrupted" ? 2200 : 0;
    if (delay) await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason || new DOMException("Aborted", "AbortError")); return; }
      const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
      signal?.addEventListener("abort", abort, { once:true });
    });
    if (scenario === "interrupted") {
      announce("interrupted");
      return new Response(JSON.stringify({ message:"Preview: simulated interrupted connection" }), { status:503, headers:{"Content-Type":"application/json"} });
    }
    try { const response = await original(input, init); announce(response.ok ? "received" : "failed"); return response; }
    catch (error) { announce("failed"); throw error; }
  };
}

export const arrivalCSS = commonMotionCSS + destinationMotionCSS + `
.proposal-wait { position:fixed; inset:0; z-index:9400; display:grid; place-items:center; padding:28px;
  background:radial-gradient(ellipse at center,rgba(11,23,18,.97) 0,rgba(11,23,18,.90) 25%,rgba(11,23,18,.22) 80%); color:#e5efdf;
  animation:proposalWaitIn .42s ease-out both; }
.proposal-wait[hidden] { display:none; }
.proposal-wait article { width:min(440px,100%); text-align:center; }
.proposal-wait img { width:66px; height:66px; object-fit:contain; margin-bottom:20px; }
.proposal-wait h1 { font-size:clamp(23px,4vw,32px); line-height:1.16; letter-spacing:-1px; margin:0 0 12px; outline:none; }
.proposal-wait p { font-size:15px; line-height:1.5; color:#c0d3c6; margin:0 auto 24px; max-width:340px; }
.proposal-wait button { font:inherit; border:1px solid #b5c7b8; border-radius:12px; background:#fff; color:#284333; padding:12px 18px; cursor:pointer; }
.proposal-wait button:focus-visible { outline:3px solid #a96b13; outline-offset:3px; }
.proposal-wait button.primary { background:#d9ebbd; border-color:#d9ebbd; color:#162b1d; margin-right:8px; }
.proposal-wait article { animation:proposalWaitText .6s cubic-bezier(.16,1,.3,1) both; }
.proposal-waiting .sage-jump-canvas { visibility:visible; }
.proposal-reduce .proposal-wait { background:#152b22; animation:none; }
.proposal-wait.no-flight { background:#152b22; }
.proposal-reduce .proposal-wait article { animation:none; }
@keyframes proposalWaitIn { from{opacity:0} to{opacity:1} }
@keyframes proposalWaitText { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
@media(prefers-reduced-motion:reduce){.proposal-wait{background:#152b22;animation:none}.proposal-wait article{animation:none}}
.proposal-reduce .comparison-scan { display:none; }
.proposal-reduce .sage-assemble .lpc, .proposal-reduce .sage-assemble .lpc * { animation:none !important; }
`;

export const studyCSS = `
/* Same settled dashboard, a stronger common perspective on the way in. */
@keyframes saRadial {
  0% { opacity:0; transform:translate3d(calc(var(--rx,0px) * .46),calc(var(--ry,0px) * .46),0) scale(.54); animation-timing-function:cubic-bezier(.12,.76,.19,1); }
  20% { opacity:1; }
  78% { opacity:1; transform:translate3d(calc(var(--rx,0px) * -.012),calc(var(--ry,0px) * -.012),0) scale(1.012); animation-timing-function:cubic-bezier(.3,0,.4,1); }
  100% { opacity:1; transform:none; }
}
.sage-assemble .sa-radial { --rd:0ms !important; }
.proposal-study .login-card { transform-origin:50% 0%; }
.proposal-study .proposal-wait button { margin-top:5px; margin-bottom:5px; }
@media(prefers-reduced-motion:reduce){@keyframes saRadial {from{opacity:0;transform:none}to{opacity:1;transform:none}}}
`;

export function installArrivalPreview(css) {
  if (location.hostname !== "127.0.0.1" || parent === window) return;
  const root = document.documentElement;
  if (window.__sageProposalStudy) root.classList.add("proposal-study");
  if (window.__sageProposalReduce) root.classList.add("proposal-reduce");
  const style = document.createElement("style"); style.textContent = css;
  const scan = document.createElement("div"); scan.className = "comparison-scan"; scan.setAttribute("aria-hidden","true"); document.body.append(scan);
  const panel = document.createElement("section"); panel.className = "proposal-wait"; panel.hidden = true;
  panel.innerHTML = '<article><h1 tabindex="-1">Preparing your dashboard</h1><p>Your store is taking a little longer to arrive.</p><button class="primary" hidden>Restore connection &amp; retry</button><button class="cancel">Cancel preview</button></article>';
  document.body.append(panel);
  const heading = panel.querySelector("h1"), explanation = panel.querySelector("p"), retry = panel.querySelector(".primary");
  const send = (type, detail) => parent.postMessage({type, detail}, location.origin);
  retry.onclick = () => send("sage-arrival-retry");
  panel.querySelector(".cancel").onclick = () => send("sage-arrival-cancel");
  let started = 0, raf = 0, signed = false, preparing = false, prepared = false, landed = false, finished = false, failed = false, waiting = false;
  let lastStatus = "", timer = 0, auto = 0, safety = 0;
  const sample = { phases:[], storeRequests:0, dataReceived:false, preparedAt:null, landingAt:null, widthMin:null, widthMax:0, unlockedLandingFrames:0, reduced:window.__sageProposalReduce || matchMedia("(prefers-reduced-motion: reduce)").matches };
  document.addEventListener("sage-study-metrics",e=>{sample.drawing=e.detail;});
  const status = (text) => {
    if (text === lastStatus) return;
    lastStatus = text; sample.phases.push({text, ms:Math.round(performance.now() - (started || performance.now()))});
    send("sage-arrival-status", {text, sample});
  };
  const showWait = (error = false) => {
    if (finished) return;
    waiting = true; panel.hidden = false; root.classList.add("proposal-waiting");
    panel.classList.toggle("no-flight",!document.querySelector(".sage-jump-canvas"));
    heading.textContent = error ? "Connection interrupted" : "Preparing your dashboard";
    explanation.textContent = error ? "Your dashboard has not opened. Restore the demo connection to try again." : "Your store is taking a little longer to arrive. We'll open it when it's ready.";
    retry.hidden = !error;
    if (!panel.dataset.focused) { heading.focus({preventScroll:true}); panel.dataset.focused = "true"; }
    status(error ? "Interrupted safely. No dashboard revealed." : "Waiting for the dashboard. No blank reveal.");
  };
  const ensureStyle = () => { if (document.body.lastElementChild !== style) document.body.append(style); };
  const prepare = async () => {
    const hero = document.querySelector(".s2-hero,.bp-hero");
    if (!hero || preparing || prepared || failed || finished) return;
    preparing = true;
    // Wait for essential text and visible header imagery, never all page images.
    await document.fonts.ready;
    const images = [...document.querySelectorAll(".s2-hero img,.bp-hero img,.topbar img")];
    await Promise.all(images.map(img => img.decode?.().catch(() => {}) ));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    preparing = false;
    if (!hero.isConnected || !hero.getBoundingClientRect().height || failed || finished) return;
    prepared = true; sample.preparedAt = Math.round(performance.now() - started);
    window.__sageProposalScreenReady = true;
    document.dispatchEvent(new Event("sage-proposal-screen-ready"));
  };
  document.addEventListener("sage-proposal-request", e => {
    if (e.detail === "requested") sample.storeRequests++;
    if (e.detail === "received") sample.dataReceived = true;
    if (["interrupted","failed"].includes(e.detail)) { failed = true; if (waiting) showWait(true); }
  });
  document.addEventListener("sage-jump-phase", e => {
    const labels = {ratchet:"Logo dots gather",reform:"Logo becomes the launch point",streaks:"Background dots become lightspeed",cruise:"Preparing the destination",burst:"Dashboard ready. Arriving"};
    if (e.detail === "waiting") showWait(failed);
    else if (labels[e.detail]) status(labels[e.detail]);
  });
  const tick = () => {
    if (finished) return;
    const width = document.body.getBoundingClientRect().width;
    sample.widthMin = Math.min(sample.widthMin ?? width, width); sample.widthMax = Math.max(sample.widthMax,width);
    const c = root.classList;
    if (c.contains("sage-cover-active") && prepared) { panel.hidden = true; root.classList.remove("proposal-waiting"); }
    if (c.contains("sage-assemble")) {
      if (!landed) { landed = true; sample.landingAt = Math.round(performance.now() - started); status("Landing on the prepared dashboard"); }
      if (getComputedStyle(root).overflowY !== "hidden") sample.unlockedLandingFrames++;
    }
    const reducedDone = sample.reduced && prepared && !document.querySelector(".signin-over") && !c.contains("jump-under");
    if ((landed && !c.contains("sage-assemble") && !c.contains("sage-preparing")) || reducedDone) {
      finished = true; clearTimeout(safety); panel.hidden = true;
      root.classList.remove("comparison-lock","proposal-waiting");
      sample.totalMs = Math.round(performance.now() - started);
      status("Ready. Try another connection."); observer.disconnect(); return;
    }
    raf = requestAnimationFrame(tick);
  };
  const fill = () => {
    if (signed) return;
    const email = document.querySelector('.login-card input[placeholder="you@company.com"]');
    const password = document.querySelector('.login-card input[placeholder="Your password"]');
    const button = document.querySelector(".login-card .lf-go");
    if (!email || !password || !button || button.disabled) return;
    signed = true;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
    set.call(email,"demo@sageonline.app"); email.dispatchEvent(new Event("input",{bubbles:true}));
    set.call(password,"demo"); password.dispatchEvent(new Event("input",{bubbles:true}));
    auto = setTimeout(() => {
      started = performance.now(); root.classList.add("comparison-lock","comparison-hover-hold");
      status("Signing in"); button.click(); raf = requestAnimationFrame(tick);
      safety = setTimeout(() => { if (!finished) { failed = true; showWait(true); } },12000);
    },650);
  };
  const observer = new MutationObserver(() => { ensureStyle(); fill(); prepare(); });
  observer.observe(document.body,{childList:true,subtree:true}); ensureStyle(); fill();
  const hover = () => { if (finished) root.classList.remove("comparison-hover-hold"); };
  for (const name of ["pointermove","pointerdown","keydown"]) window.addEventListener(name,hover,{passive:true});
  // A module or mock that never opens still leaves a visible exit.
  timer = setTimeout(() => { if (!signed) { failed = true; showWait(true); } },12000);
  window.addEventListener("pagehide",() => { observer.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(auto); clearTimeout(safety); },{once:true});
  status("Loading the actual Sage sign-in");
}

export function arrivalPage(study = false) {
  const title = study ? "Lightspeed study" : "Saved arrival draft";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sage | ${title}</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:#213c2c;font:14px system-ui,sans-serif}main{height:100dvh;display:flex;flex-direction:column}header{padding:12px 18px;background:#f7faf6;border-bottom:1px solid #c5d2c7}h1{font-size:18px;margin:0 0 4px;letter-spacing:-.4px}p{font-size:12px;color:#54675a;line-height:1.5;margin:4px 0}.controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}button,select{font:inherit;padding:9px 12px;border:1px solid #b6c8ba;background:white;border-radius:9px;color:#284333;cursor:pointer}button[aria-pressed=true]{background:#284b38;color:white}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #a96b13;outline-offset:2px}#status{font-size:12px;margin-left:auto}iframe{width:100%;min-height:0;flex:1;border:0;background:#eef2ee}details{font-size:12px;margin-top:9px}summary{cursor:pointer;width:fit-content}details label{display:flex;gap:12px;align-items:center;margin-top:8px}select{font-size:12px;padding:6px}pre{white-space:pre-wrap;max-height:180px;overflow:auto;font-size:11px}.compact h1,.compact .intro,.compact details{display:none}.compact header{padding:7px 12px}.compact .controls{margin:0}#empty{margin:auto;text-align:center;padding:30px}#empty strong{font-size:22px;display:block;margin-bottom:10px}[hidden]{display:none!important}@media(max-width:540px){header{padding:10px}#status{margin-left:0;flex-basis:100%}button{padding:8px 10px}h1{font-size:16px}}
</style></head><body><main><header><h1>${title}</h1><p class="intro">${study ? "The login becomes the flight. Your dashboard is the destination." : "Preserved draft, with the extra recovery label removed."} Fictional data only. <a href="${study ? "/" : "/study"}">${study ? "Open saved draft" : "Open lightspeed study"}</a></p><div class="controls"><button data-mode="fast" aria-pressed="false">Fast</button><button data-mode="slow" aria-pressed="false">Slow</button><button data-mode="interrupted" aria-pressed="false">Interrupted</button><button id="replay">Replay</button><button id="cancel">Cancel</button><button id="compact">More room</button><span id="status" role="status">Choose Fast to begin</span></div>
<details><summary>What to look for, and your decisions</summary><p>Fast: the actual dashboard prepares during the jump. Slow: its store request takes four extra seconds. Interrupted: that request fails. No fixed timer can reveal an unfinished dashboard.</p><label><input id="reduce" type="checkbox"> Preview reduced motion (your device preference is always respected)</label><label>1. Shorter launch and unified landing <select><option>Not decided</option><option>Approve</option><option>Adjust</option></select></label><label>2. Waiting and connection recovery <select><option>Not decided</option><option>Approve</option><option>Adjust</option></select></label><label>3. One soft CRT scan on arrival <select><option>Not decided</option><option>Approve</option><option>Remove the scan</option></select></label><p>Choices stay here. Tell me in chat before anything goes into the live app. Retry restores the simulated connection and starts a new preview. This does not measure an older computer or guarantee a frame rate. A real iPhone check is still needed.</p><pre id="evidence"></pre></details></header><div id="empty"><strong>Your store is the destination.</strong><p>Choose a connection above to see the full sign-in.</p></div><iframe id="preview" hidden title="Sage arrival proposal with fictional data"></iframe></main><script>
const frame=document.querySelector('#preview'),status=document.querySelector('#status'),empty=document.querySelector('#empty');let scenario='fast',run=0;
function play(next){scenario=next;for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===next));empty.hidden=true;frame.hidden=false;status.textContent='Opening '+next;document.querySelector('#evidence').textContent='';frame.src='/app?study=${Number(study)}&scenario='+next+'&reduce='+Number(document.querySelector('#reduce').checked)+'&run='+(++run)}
function cancel(){frame.src='about:blank';frame.hidden=true;empty.hidden=false;status.textContent='Preview stopped. Nothing changed.'}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>play(b.dataset.mode);
document.querySelector('#replay').onclick=()=>play(scenario);document.querySelector('#cancel').onclick=cancel;document.querySelector('#compact').onclick=()=>{const c=document.body.classList.toggle('compact');document.querySelector('#compact').textContent=c?'Show notes':'More room'};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow)return;if(e.data?.type==='sage-arrival-status'){status.textContent=e.data.detail.text;document.querySelector('#evidence').textContent=JSON.stringify(e.data.detail.sample,null,2)}if(e.data?.type==='sage-arrival-retry')play('fast');if(e.data?.type==='sage-arrival-cancel')cancel()});
</script></body></html>`;
}

export async function serveArrivalPrototype(root, port) {
  root = path.resolve(root);
  const html = await fs.readFile(path.join(root,"index.html"),"utf8");
  const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  const bundle = entry ? await fs.readFile(path.join(root,entry.slice(1)),"utf8") : "";
  if (!bundle.includes("http://127.0.0.1:5433") || !bundle.includes("sage-proposal-screen-ready")) throw new Error("Arrival requires the isolated proposal build against the local mock.");
  const mime = {".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".woff2":"font/woff2",".json":"application/json"};
  const server = http.createServer(async (req,res) => {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || "")) { res.writeHead(403).end(); return; }
    if (!["GET","HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const url = new URL(req.url,"http://127.0.0.1"); let body, type = "text/html";
      if (url.pathname === "/" || url.pathname === "/study") body = arrivalPage(url.pathname === "/study");
      else if (url.pathname === "/app") {
        const scenario = ["slow","interrupted"].includes(url.searchParams.get("scenario")) ? url.searchParams.get("scenario") : "fast";
        const study = url.searchParams.get("study") === "1";
        body = html.replace("<head>",`<head><script>(${installScenario.toString()})(${JSON.stringify(scenario)},${url.searchParams.get("reduce") === "1"}${study ? ",true" : ""});</script>`)
          .replace("</body>",`<script>(${installArrivalPreview.toString()})(${JSON.stringify(arrivalCSS + (study ? studyCSS : ""))});</script></body>`);
      } else {
        if (url.pathname === "/sw.js" || url.pathname.startsWith("/_vercel/")) { res.writeHead(204).end(); return; }
        const file = assetPath(root,req.url); if (!file) { res.writeHead(403).end(); return; }
        body = await fs.readFile(file); type = mime[path.extname(file)] || "application/octet-stream";
      }
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}); res.end(req.method === "HEAD" ? undefined : body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve,reject) => { server.once("error",reject); server.listen(port,"127.0.0.1",resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--build")) await buildArrivalPrototype();
  else { await serveArrivalPrototype("dist-harness/arrival-prototype",49211); console.log("Sage arrival proposal: http://127.0.0.1:49211/"); }
}

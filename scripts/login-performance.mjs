/** Local-only sign-in recorder. Build against the mock, start the mock, then run
 * node scripts/login-performance.mjs dist 49178. Sign out before recording.
 * Unlike the manager probe, this starts at the press and timestamps every phase.
 * It changes no app code, login state, daily mark, or animation preference.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath } from "./manager-performance.mjs";

export function summarizeLoginTrace(sample) {
  const frames = sample.frames.map((f) => f.ms).sort((a, b) => a - b);
  const reveal = sample.events.find((e) => e.name === "dashboard-revealed");
  const landingTasks = reveal ? sample.longTasks.filter((t) => t.at >= reveal.at) : [];
  return {
    validForegroundSample: !sample.hidden,
    revealedAtMs: reveal?.at ?? null,
    frameMedianMs: frames.length ? frames[Math.floor(frames.length / 2)] : null,
    frameMaxMs: frames.length ? frames[frames.length - 1] : null,
    landingTaskMaxMs: landingTasks.length ? Math.max(...landingTasks.map((t) => t.ms)) : null,
    // These are main-thread frame opportunities, not worker or display FPS.
    mainThreadGapsOver50ms: sample.frames.filter((f) => f.ms > 50).length,
  };
}

export function installLoginProbe(summarize) {
  const out = document.createElement("pre");
  out.id = "login-performance-results";
  out.hidden = true;
  document.body.appendChild(out);
  let sample = null, start = 0, raf = 0, timeout = 0, last = 0;
  let phase = "press", classes = "", canvas = false, hero = false, revealed = false, roundup = false;
  const observers = [];
  const round = (n) => Math.round(n * 10) / 10;
  const event = (name, detail) => {
    if (sample && sample.events.length < 100) sample.events.push({ at: round(performance.now() - start), name, ...detail });
  };
  const publish = () => { out.textContent = JSON.stringify(sample || { status: "waiting for Sign in" }); };
  const finish = (status) => {
    if (!sample || sample.status !== "recording") return;
    sample.status = status;
    cancelAnimationFrame(raf); clearTimeout(timeout);
    sample.summary = summarize(sample);
    publish();
  };
  const cover = () => {
    const el = document.querySelector(".sage-flash");
    if (!el) return { exists: false };
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return { exists: true, width: round(r.width), height: round(r.height), opacity: s.opacity,
      position: s.position, background: s.backgroundColor, animation: s.animationName };
  };
  const tick = (now) => {
    if (!sample || sample.status !== "recording") return;
    if (last && sample.frames.length < 2400) sample.frames.push({ at: round(now - start), ms: round(now - last), phase });
    last = now;
    const c = document.documentElement.className;
    if (c !== classes) { classes = c; event("root-classes", { classes: c }); }
    const hasCanvas = !!document.querySelector(".sage-jump-canvas");
    if (hasCanvas !== canvas) {
      canvas = hasCanvas;
      event(canvas ? "tunnel-mounted" : "tunnel-removed", { cover: cover() });
    }
    if (!hero && document.querySelector(".s2-tube")) { hero = true; event("hero-mounted"); }
    if (!revealed && hero && !document.documentElement.classList.contains("jump-under")
      && !document.documentElement.classList.contains("refresh-hold")) {
      revealed = true; phase = "landing"; event("dashboard-revealed", { cover: cover() });
    }
    if (!roundup && document.querySelector('[role="dialog"][aria-label="Your round-up"]')) {
      roundup = true; event("round-up-opened");
    }
    if (document.hidden) sample.hidden = true;
    raf = requestAnimationFrame(tick);
  };
  document.addEventListener("sage-jump-phase", (e) => {
    if (!sample || sample.status !== "recording") return;
    phase = String(e.detail); event("phase", { phase });
  });
  document.addEventListener("visibilitychange", () => {
    if (sample?.status === "recording" && document.hidden) sample.hidden = true;
  });
  for (const type of ["longtask", "long-animation-frame"]) {
    try {
      const obs = new PerformanceObserver((list) => {
        if (!sample || sample.status !== "recording") return;
        for (const entry of list.getEntries()) {
          if (entry.startTime < start) continue;
          const row = { at: round(entry.startTime - start), ms: round(entry.duration) };
          if (type === "longtask" && sample.longTasks.length < 200) sample.longTasks.push(row);
          if (type === "long-animation-frame" && sample.longFrames.length < 200) {
            row.renderMs = entry.renderStart ? round(entry.startTime + entry.duration - entry.renderStart) : null;
            row.scripts = Array.from(entry.scripts || []).slice(0, 8).map((s) => ({
              function: s.sourceFunctionName, invoker: s.invoker, ms: round(s.duration),
              forcedLayoutMs: round(s.forcedStyleAndLayoutDuration || 0),
            }));
            sample.longFrames.push(row);
          }
        }
      });
      obs.observe({ type }); observers.push(obs);
    } catch { /* Unsupported timing APIs stay absent, not a zero-cost claim. */ }
  }
  document.addEventListener("click", (e) => {
    const button = e.target.closest?.(".login-card button");
    if (!button || button.textContent.trim() !== "Sign in") return;
    // A new attempt gets its own record, including retries after a failed login.
    cancelAnimationFrame(raf); clearTimeout(timeout);
    start = performance.now(); last = 0; phase = "press"; classes = "";
    canvas = false; hero = false; revealed = false; roundup = false;
    sample = { status: "recording", hidden: document.hidden, viewport: [innerWidth, innerHeight],
      events: [], frames: [], longTasks: [], longFrames: [],
      supportedTiming: PerformanceObserver.supportedEntryTypes || [] };
    event("sign-in-pressed"); publish();
    raf = requestAnimationFrame(tick);
    timeout = setTimeout(() => finish(revealed ? "complete" : "no dashboard within 15 seconds"), 15000);
  }, true);
  window.addEventListener("pagehide", () => {
    finish("page left"); observers.forEach((o) => o.disconnect());
  }, { once: true });
  publish();
}

export async function serveLoginProbe(root, port) {
  root = path.resolve(root);
  const html = await fs.readFile(path.join(root, "index.html"), "utf8");
  const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  const bundle = entry ? await fs.readFile(path.join(root, entry.slice(1)), "utf8") : "";
  if (!bundle.includes("http://127.0.0.1:5433")) throw new Error("Build against the local mock before running this recorder.");
  const inject = `<script>(${installLoginProbe.toString()})(${summarizeLoginTrace.toString()});</script>`;
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const file = assetPath(root, req.url);
      if (!file) { res.writeHead(403).end(); return; }
      let bytes = await fs.readFile(file);
      if (file === path.join(root, "index.html")) bytes = Buffer.from(bytes.toString().replace("</body>", inject + "</body>"));
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[3] || 49178);
  await serveLoginProbe(process.argv[2] || "dist", port);
  console.log(`Local sign-in recorder: http://127.0.0.1:${port}/`);
}

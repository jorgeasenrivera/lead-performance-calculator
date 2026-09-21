/**
 * Local-only manager landing probe. It serves an existing production build,
 * adding measurements to the page without changing the application bundle.
 * No dependency, no production telemetry, and no automatic sign-in.
 *
 * Build against the local mock, run the mock WITHOUT SALESPERSON=1, then:
 *   node scripts/manager-performance.mjs dist 49174
 * Sign in with the README's demo account. The JSON lives in the hidden
 * #manager-performance-results element, so it cannot disturb the layout.
 * Reload for another sample. Keep the tab foreground for frame measurements.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function installManagerProbe() {
  const result = document.createElement("pre");
  result.id = "manager-performance-results";
  result.hidden = true;
  document.body.appendChild(result);
  const sample = {
    status: "waiting for manager hero", cloneCount: 0, cloneMs: 0,
    frameIntervals: [], longTasks: [], hidden: document.hidden,
    viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent,
  };
  result.textContent = JSON.stringify(sample);
  const originalClone = Node.prototype.cloneNode;
  let started = 0, revealed = 0, lastFrame = 0, raf = 0, finished = false;
  let observer, longObserver;
  const round = (n) => Math.round(n * 100) / 100;
  const visibility = () => { if (document.hidden) sample.hidden = true; };
  document.addEventListener("visibilitychange", visibility);
  Node.prototype.cloneNode = function (...args) {
    if (!finished && this.nodeType === 1 && this.classList.contains("s2-tube")) {
      const t = performance.now();
      const copy = originalClone.apply(this, args);
      sample.cloneCount++;
      sample.cloneMs += performance.now() - t;
      return copy;
    }
    return originalClone.apply(this, args);
  };
  try {
    longObserver = new PerformanceObserver((list) => {
      if (!revealed || finished) return;
      for (const e of list.getEntries()) {
        if (e.startTime >= revealed) sample.longTasks.push(round(e.duration));
      }
    });
    longObserver.observe({ type: "longtask" });
    sample.longTaskSupported = true;
  } catch { sample.longTaskSupported = false; }
  function finish(reason) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    longObserver?.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    Node.prototype.cloneNode = originalClone;
    sample.status = reason;
    sample.cloneMs = round(sample.cloneMs);
    sample.mountToRevealMs = revealed ? round(revealed - started) : null;
    sample.heroText = document.querySelector(".s2-tube")?.textContent || null;
    sample.heroNodes = document.querySelectorAll(".s2-tube *").length;
    sample.domNodes = document.querySelectorAll("*").length;
    const frames = [...sample.frameIntervals].sort((a, b) => a - b);
    sample.frameMedianMs = frames.length ? frames[Math.floor(frames.length * 0.5)] : null;
    sample.frameP95Ms = frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))] : null;
    sample.frameMaxMs = frames.length ? frames[frames.length - 1] : null;
    result.textContent = JSON.stringify(sample);
  }
  function tick(t) {
    const root = document.documentElement;
    if (!revealed && !root.classList.contains("jump-under") && !root.classList.contains("refresh-hold")) {
      revealed = t;
      sample.status = "recording landing";
    }
    if (revealed) {
      if (lastFrame) sample.frameIntervals.push(round(t - lastFrame));
      lastFrame = t;
      if (t - revealed >= 2200) { finish("complete"); return; }
    }
    if (t - started >= 20000) { finish("reveal timeout"); return; }
    raf = requestAnimationFrame(tick);
  }
  observer = new MutationObserver(() => {
    if (started || !document.querySelector(".s2-tube")) return;
    started = performance.now();
    raf = requestAnimationFrame(tick);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function assetPath(root, url) {
  const pathname = decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
  if (pathname.includes("\\") || pathname.includes("\0")) return null;
  const resolved = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  const relative = path.relative(root, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : null;
}

export async function serveManagerProbe(root, port) {
  root = path.resolve(root);
  await fs.access(path.join(root, "index.html"));
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const server = http.createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const file = assetPath(root, req.url);
      if (!file) { res.writeHead(403).end(); return; }
      let bytes = await fs.readFile(file);
      if (file === path.join(root, "index.html")) {
        bytes = Buffer.from(bytes.toString().replace("</body>", `<script>(${installManagerProbe.toString()})();</script></body>`));
      }
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[3] || 49174);
  await serveManagerProbe(process.argv[2] || "dist", port);
  console.log(`Manager landing probe: http://127.0.0.1:${port}/ (local mock only)`);
}

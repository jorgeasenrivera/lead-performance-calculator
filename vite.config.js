import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* The service worker (src/sw.js) needs to know this build's files. After the
   bundle is written, the page is read back for the chunks it starts with,
   and the worker is written out with that list and a version that changes
   whenever any of them do — which is what makes the browser install the new
   build. Only the starting files are put away up front; the manager's PDF
   reader and the map are kept as they are first used. */
function sageWorker() {
  let outDir = "dist";
  return {
    name: "sage-worker",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
      const starts = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
      const precache = ["/", ...starts];
      const version = crypto.createHash("sha1").update(html + precache.join("\n")).digest("hex").slice(0, 12);
      const sw = fs.readFileSync(path.join("src", "sw.js"), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache));
      fs.writeFileSync(path.join(outDir, "sw.js"), sw);
    },
  };
}

// Every deploy stamps itself. Nobody has to remember to bump a number.
//  - the date comes from the build machine
//  - the short commit hash comes from Vercel when it builds from git
const d = new Date();
const stamp =
  d.getFullYear() +
  "." + String(d.getMonth() + 1).padStart(2, "0") +
  "." + String(d.getDate()).padStart(2, "0");
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
const version = stamp + (sha ? "." + sha : "");

export default defineConfig({
  plugins: [react(), sageWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      output: {
        /* The libraries change a few times a year; the app changes several times
           a day. Kept in one file they are re-downloaded on every deploy, which
           on a phone on a forecourt is the slowest part of opening Sage. Split
           out, a returning phone fetches only the app.

           The app itself is still one chunk. Splitting the manager's pages from
           the salesperson's would be the real win, and it needs the one big
           source file broken up first, which is its own job. */
        manualChunks: {
          vendor: ["react", "react-dom", "@supabase/supabase-js", "qrcode-generator"],
        },
      },
    },
  },
});

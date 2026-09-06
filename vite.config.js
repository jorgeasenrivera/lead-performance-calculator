import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
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

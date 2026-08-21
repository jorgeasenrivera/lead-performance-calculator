/**
 * The guard that makes the rest of this stick.
 * -------------------------------------------------------------------------
 * Three separate production faults in one week came from the same thing: a
 * piece of logic existing twice, in the app and on the server, with the two
 * copies quietly disagreeing.
 *
 *   the reader for the scheduled reports — the app knew the word "Visit" and
 *   the pipeline did not, so every emailed activity report was refused
 *
 *   FLOOR_STAT_FIELDS — the server kept the visit count and the app stripped
 *   it out, so the same report landed differently depending on how it arrived
 *
 *   BOARD_STAT_FIELDS — the app published the lead counts and the server did
 *   not, so a salesperson lost what their percentage was out of
 *
 * Each was found by a person noticing something wrong on a screen, weeks
 * later. This test finds the next one in about forty milliseconds.
 *
 * It is deliberately dumb. It does not understand the code; it lists the names
 * defined at the top level of the server files and of the app, and complains
 * about any name defined in both. A name in both places is not always a bug —
 * but it is always a second copy, and a second copy is the thing that keeps
 * costing us. Share it, or add it to KNOWN below with a reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = path.join(ROOT, "src/LeadPerformanceCalculator.jsx");

/* Names allowed to exist twice, each with the reason it is not worth sharing.
   Keep this list short. Every entry is a small bet that these two will never
   need to agree. */
const KNOWN = new Map([
  ["uid", "Two independent random id generators. Nothing ever compares one to the other, so there is nothing for them to disagree about."],
]);

const topLevelNames = (src) => {
  const out = new Set();
  for (const line of src.split("\n")) {
    let m = line.match(/^(?:export )?(?:async )?function (\w+)/);
    if (m) { out.add(m[1]); continue; }
    m = line.match(/^(?:export )?(?:const|let) (\w+) =/);
    if (m) out.add(m[1]);
  }
  return out;
};

const serverFiles = () => {
  const dirs = ["api", "workers"];
  const files = [];
  for (const d of dirs) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (/\.(mjs|js)$/.test(f)) files.push(path.join(full, f));
    }
  }
  return files;
};

test("nothing is defined in both the app and a server file", () => {
  const app = topLevelNames(fs.readFileSync(APP, "utf8"));
  const clashes = [];
  for (const file of serverFiles()) {
    const rel = path.relative(ROOT, file);
    for (const name of topLevelNames(fs.readFileSync(file, "utf8"))) {
      if (!app.has(name)) continue;
      if (KNOWN.has(name)) continue;
      clashes.push(`${name}  (${rel} and src/LeadPerformanceCalculator.jsx)`);
    }
  }
  assert.deepEqual(clashes, [],
    "These names are defined twice. Every production bug this test exists for looked\n" +
    "exactly like this. Move the definition into a file both sides import, or add it\n" +
    "to KNOWN in this test with the reason it is safe:\n  " + clashes.join("\n  "));
});

test("the shared files stay importable by the browser", async () => {
  /* The app imports these, so anything reaching for a Node built-in, an
     environment variable or a database client would break the build — and it
     would break it in the bundler, a long way from here. */
  const shared = ["api/_report-parsers.mjs", "api/_store-keys.mjs",
                  "api/_floor-presence.mjs", "api/_geofence.mjs"];
  for (const rel of shared) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const bad of [/from "node:/, /require\(/, /process\.env/, /createClient/]) {
      assert.ok(!bad.test(src), `${rel} reaches for something the browser has not got: ${bad}`);
    }
    await import(path.join(ROOT, rel));   // and it actually loads
  }
});

test("every name the app imports from a shared file is really exported", async () => {
  const src = fs.readFileSync(APP, "utf8");
  const rx = /import\s*\{([^}]+)\}\s*from\s*"(\.\.\/api\/[^"]+)"/g;
  let m, checked = 0;
  while ((m = rx.exec(src))) {
    const mod = await import(path.join(ROOT, "api", m[2].replace("../api/", "")));
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      assert.ok(name in mod, `${m[2]} does not export ${name}, which the app imports`);
      checked++;
    }
  }
  assert.ok(checked > 0, "no shared imports were found to check — has the app stopped importing them?");
});

test("no check reaches for a path on somebody's machine", () => {
  /* The first version of the routing test read ingest.mjs off disk by absolute
     path. It passed here and failed the moment it ran anywhere else, which is
     the one failure mode a suite must not have: a check that only works where
     it was written teaches people that the red build is normal. */
  const dir = path.join(ROOT, "test");
  const bad = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.mjs$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/["'`](\/(?:home|Users|tmp|var)\/[^"'`]*)["'`]/g)) bad.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(bad, [], "absolute paths in tests:\n  " + bad.join("\n  "));
});

test("no em dash in anything a person reads", () => {
  /* They were all over the writing on the screen. Comments keep them — nobody
     reads those on the site — and so do two things that are not writing at all:
     the dash a table shows where a figure is missing, and a regex that matches a
     dash character in a schedule. Both are checked for by shape below rather
     than exempted by line number, which would rot the first time anything moved.

     This is a style check, and it is here because the alternative is finding one
     of them on a screenshot again. */
  const files = ["src/LeadPerformanceCalculator.jsx", "src/FenceEditor.jsx",
                 "api/_people-status.mjs", "api/_report-parsers.mjs", "api/_store-keys.mjs",
                 "api/_store-month.mjs", "api/_floor-presence.mjs", "api/_geofence.mjs",
                 "api/_report-alert.mjs", "api/ingest.mjs", "api/link-person.mjs",
                 "api/floor-account.mjs", "api/register-device.mjs", "api/queue-changed.mjs"];
  const bad = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
    let inBlock = false;
    lines.forEach((line, i) => {
      let s = line;
      if (inBlock) {
        if (s.includes("*/")) { inBlock = false; s = s.split("*/").slice(1).join("*/"); }
        else return;
      }
      while (s.includes("/*")) {
        const [before, rest] = [s.slice(0, s.indexOf("/*")), s.slice(s.indexOf("/*") + 2)];
        if (rest.includes("*/")) s = before + rest.slice(rest.indexOf("*/") + 2);
        else { s = before; inBlock = true; break; }
      }
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*")) return;
      s = s.replace(/\s\/\/[^"'`]*$/, "");
      if (!s.includes("—")) return;
      // the "no figure" dash, on its own inside quotes
      if (/["'>]\s*—\s*["'<]/.test(s)) return;
      // a character class matching dashes
      if (/\[[^\]]*—[^\]]*\]/.test(s)) return;
      bad.push(`${rel}:${i + 1}  ${t.slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [], "em dashes in text somebody reads:\n  " + bad.join("\n  "));
});

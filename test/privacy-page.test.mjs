/* The privacy policy promises things the code has to keep true (C90).
   Each check here ties one sentence on the page to the code that makes it
   true, so a change to either one has to meet the other. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const page = read("public/privacy.html");
const sw = read("src/sw.js");
const vercel = JSON.parse(read("vercel.json"));
const migrations = fs.readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((f) => f.endsWith(".sql")).map((f) => read("supabase/migrations/" + f)).join("\n");

test("no blank is left to fill in", () => {
  /* The company's legal name is Jorge's to give. The page does not go live
     with a placeholder in it. */
  assert.equal(page.match(/\{\{[A-Z]+\}\}/g), null, "a {{BLANK}} is still on the page");
});

test("the house rules hold on the page", () => {
  assert.ok(!/[—–]/.test(page), "no em or en dashes");
  assert.ok(!/<script/i.test(page), "a plain page: nothing to run, so it opens anywhere");
});

test("the times it promises are the times the database deletes at", () => {
  const days = (fn) => {
    const m = migrations.match(new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?interval '(\\d+) days'`));
    return m && Number(m[1]);
  };
  assert.equal(days("prune_app_errors"), 90);
  assert.equal(days("prune_app_vitals"), 30);
  assert.equal(days("prune_device_tokens"), 90);
  assert.ok(page.includes("<b>Error reports:</b> 90 days."));
  assert.ok(page.includes("<b>Speed readings:</b> 30 days."));
  assert.ok(page.includes("<b>A device's notification details:</b> 90 days after"));
});

test("where you are is never sent, and the lot check says the same", () => {
  assert.ok(page.includes("Where you are is never sent or stored."));
  assert.ok(read("api/_geofence.mjs").includes("the caller keeps\n * the verdict and throws the coordinates away"),
    "the geofence module still promises to keep only the verdict");
});

test("the page is reachable at /privacy, even on a phone that has opened Sage", () => {
  assert.ok((vercel.rewrites || []).some((r) => r.source === "/privacy" && r.destination === "/privacy.html"));
  const pass = sw.indexOf('url.pathname === "/privacy"');
  assert.ok(pass > 0 && pass < sw.indexOf('req.mode === "navigate"'),
    "the worker lets the policy through before it answers page visits with the app");
});

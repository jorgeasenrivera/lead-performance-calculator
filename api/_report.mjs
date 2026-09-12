/**
 * The error feed: one row per crash, failed write or server fault.
 * -------------------------------------------------------------------------
 * Everything that goes wrong lands in public.app_errors through here, whether
 * it happened on a phone (via /api/client-error) or inside one of these
 * functions. The table is written only with the service role and read only by
 * the people and routines that look after the app; nothing in the browser can
 * touch it, because a row carries a stack.
 *
 * Two things make the feed usable rather than noisy. A fingerprint groups the
 * same fault from a hundred phones into one line: the message with its numbers
 * and ids blanked, plus the first frame of the stack with its build hash and
 * line numbers stripped, so the same bug in two builds is still one bug. And a
 * cap per device per ten minutes keeps one broken phone from writing the table
 * full.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, serviceKey } from "./_env.mjs";

export const SOURCES = ["web", "shell", "server"];
export const KINDS = ["error", "rejection", "render", "write", "api", "handler"];
export const RATE = { windowMinutes: 10, perDevice: 20 };
const LIMIT = { message: 500, stack: 4000, url: 300, build: 40, store: 60, person_id: 40, device_id: 120, ua: 300, screen: 60, extra: 2000 };

/* One line for one bug. Numbers, hex and long ids in the message become #, so
   "row 41 not found" and "row 42 not found" are the same fault. The frame is
   the first line of the stack that names a file, with the build's hash, the
   query string and the line:column taken off. */
export function fingerprintOf(kind, message, stack) {
  const msg = String(message || "").replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").trim().slice(0, 160);
  const line = String(stack || "").split("\n").map((s) => s.trim()).find((s) => /[\w/.-]+\.(m?js|jsx|ts|tsx)/.test(s)) || "";
  const frame = line
    .replace(/https?:\/\/[^/\s]+/g, "")           // the host
    .replace(/\?[^:)\s]*/g, "")                    // the query string
    .replace(/-[A-Za-z0-9_-]{6,}\.(m?js|css)/g, ".$1")   // the build hash in the file name
    .replace(/:\d+(:\d+)?\)?$/, "").replace(/:\d+:\d+/g, "")  // line and column
    .slice(0, 160);
  return createHash("sha1").update(kind + "|" + msg + "|" + frame).digest("hex").slice(0, 16);
}

const str = (v, n) => (v == null ? null : String(v).slice(0, n));

/* A report from a phone, checked and cut to size. Returns the row to insert,
   or why it was refused. Anything the phone says about who it is (store,
   person, device) is taken as a label, never as a right: the row cannot reach
   anybody and the table is not readable from the app. */
export function cleanReport(body, source = "web") {
  if (!body || typeof body !== "object") return { ok: false, why: "no body" };
  const kind = KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) return { ok: false, why: "unknown kind" };
  const message = str(body.message, LIMIT.message);
  if (!message) return { ok: false, why: "no message" };
  if (!SOURCES.includes(source) || source === "server") source = "web";
  let extra = null;
  if (body.extra && typeof body.extra === "object") {
    try { const s = JSON.stringify(body.extra); extra = s.length > LIMIT.extra ? { truncated: s.slice(0, LIMIT.extra) } : body.extra; } catch (e) { extra = null; }
  }
  const stack = str(body.stack, LIMIT.stack);
  return { ok: true, row: {
    source, kind, message, stack,
    url: str(body.url, LIMIT.url), build: str(body.build, LIMIT.build),
    store: str(body.store, LIMIT.store), person_id: str(body.person_id, LIMIT.person_id),
    device_id: str(body.device_id, LIMIT.device_id), ua: str(body.ua, LIMIT.ua), screen: str(body.screen, LIMIT.screen),
    extra, fingerprint: fingerprintOf(kind, message, stack),
  } };
}

/* The cap: this many rows from one device inside the window and the next is
   refused. Twenty in ten minutes is a phone in a loop, not a person. */
export function tooMany(recentFromDevice) { return Number(recentFromDevice) >= RATE.perDevice; }

function db() {
  const url = supabaseUrl(), key = serviceKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/* Write a row. Never throws and never waits on anything the caller needs:
   the feed must not be able to break the thing it watches. */
export async function reportError(row) {
  try {
    const c = db(); if (!c) return false;
    const { error } = await c.from("app_errors").insert(row);
    if (error) { console.error("app_errors insert", error.message || error); return false; }
    return true;
  } catch (e) { console.error("app_errors", e && e.message); return false; }
}

/* A fault inside one of these functions, as a row: the scope is the route. */
export function serverFault(scope, err, extra = null) {
  const message = String((err && (err.message || err.details)) || err || "unknown").slice(0, LIMIT.message);
  const stack = err && err.stack ? String(err.stack).slice(0, LIMIT.stack) : null;
  const row = { source: "server", kind: "handler", message, stack, url: "/api/" + scope,
    build: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null, extra: extra || null,
    fingerprint: fingerprintOf("handler", message, stack || scope) };
  return reportError(row);
}

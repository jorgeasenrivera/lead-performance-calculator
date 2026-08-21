/**
 * The handler itself, run end to end.
 * -------------------------------------------------------------------------
 * Every other test here imports a function out of the pipeline and calls it.
 * That leaves the handler body — the part that actually runs when a report
 * arrives — checked by nothing, and a whole day of reports went to a 500
 * because of it:
 *
 *   {"ok":false,"error":"squash is not defined"}
 *
 * Consolidating the readers moved a one-line helper into the shared module
 * under a different name. Two call sites in the handler kept the old name.
 * The module still loaded, every unit test still passed, and the first line
 * of the handler threw on every message for four hours.
 *
 * So this walks a real message all the way through: a raw MIME body in, a
 * fake Supabase behind fetch, and a written store row out. A name that does
 * not exist anywhere along that path now fails here rather than in the inbox.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/ingest.mjs";
import { storeKey } from "../api/_store-keys.mjs";

const SECRET = "test-secret";
const STORE = { id: "classic-mazda", name: "Classic Mazda" };

/* Supabase, in memory. The handler reaches it through fetch and nothing else,
   so this is the whole of it: a GET that answers from a Map, a POST that puts,
   and the conditional PATCH the CAS save uses. */
function fakeSupabase(seed) {
  const db = new Map(Object.entries(seed));
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const key = decodeURIComponent((u.searchParams.get("key") || "").replace(/^eq\./, ""));
    const method = opts.method || "GET";
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (method === "GET") return json(db.has(key) ? [{ value: db.get(key) }] : []);
    if (method === "POST") {
      for (const row of JSON.parse(opts.body)) db.set(row.key, row.value);
      return json([]);
    }
    if (method === "PATCH") {
      // The revision guard: the row only moves if it is still where we left it.
      const cur = db.get(key) || {};
      const want = u.searchParams.get("value->>rev") || "";
      const held = want === "is.null" ? cur.rev == null : String(cur.rev) === want.replace(/^eq\./, "");
      if (!held) return json([]);
      const next = JSON.parse(opts.body).value;
      db.set(key, next);
      return json([{ value: next }]);
    }
    throw new Error("unexpected " + method);
  };
  return { db, fetch };
}

/* One CSV attachment, in a body PostalMime will read. */
function message({ to, subject, filename, csv }) {
  const b = "b0undary";
  return Buffer.from([
    `From: reports@example.com`, `To: ${to}`, `Subject: ${subject}`,
    `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${b}"`, ``,
    `--${b}`, `Content-Type: text/plain`, ``, `report attached`, ``,
    `--${b}`, `Content-Type: text/csv; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`, ``, csv, ``,
    `--${b}--`, ``,
  ].join("\r\n"), "utf8");
}

function call(raw, headers = {}) {
  const req = {
    method: "POST",
    headers: { "x-ingest-secret": SECRET, ...headers },
    async *[Symbol.asyncIterator]() { yield raw; },
  };
  const out = {};
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  return handler(req, res).then(() => out);
}

const CSV = ["Delivery", "Name,Opportunities,Sold,Sold %,Units Delivered,Delivered %",
  "Fin Smith,110,7,6.4,5,4.5"].join("\n");

async function run(seed, msg) {
  const sb = fakeSupabase(seed);
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  globalThis.fetch = sb.fetch;
  process.env.INGEST_SECRET = SECRET;
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  try { return { out: await call(msg), db: sb.db }; }
  finally { globalThis.fetch = realFetch; process.env = env; }
}

const seeded = () => ({
  "lpc:config:v2": { stores: [STORE] },
  /* No roster yet, so the store takes everyone the report names rather than
     parking them for a manager to claim. */
  [storeKey(STORE.id)]: { roster: [], months: {}, rev: 3 },
});

// ---- the four hours of 500s: a real message, all the way through ----
test("a report addressed to a store is read, filed and written", async () => {
  const { out, db } = await run(seeded(), message({
    to: `lpc-classicmazda@hollercrmreports.com`,
    subject: "Daily Internet Delivery", filename: "delivery-internet.csv", csv: CSV,
  }));
  // A ReferenceError anywhere in the handler lands here as a 500, which is
  // exactly the shape the live failure took.
  assert.equal(out.code, 200, JSON.stringify(out.body));
  assert.equal(out.body.ok, true, JSON.stringify(out.body));
  assert.equal(out.body.stores[0].store, STORE.id, JSON.stringify(out.body.stores));
  const wrote = db.get(storeKey(STORE.id));
  assert.equal(wrote.rev, 4, "the save should have moved the revision on");
  assert.ok(JSON.stringify(wrote.months).includes("fin smith"), Object.keys(wrote.months));
});

// ---- and the address is what places a CSV, so mis-addressing must be refused ----
test("a CSV sent to an address that names no store is refused, not guessed", async () => {
  const { out } = await run(seeded(), message({
    to: "reports@hollercrmreports.com",
    subject: "Daily Internet Delivery", filename: "delivery-internet.csv", csv: CSV,
  }));
  assert.equal(out.code, 422, JSON.stringify(out.body));
  assert.equal(out.body.ok, false, JSON.stringify(out.body));
});

// ---- a message carrying nothing is not a failure ----
test("a message with no attachment is not an error", async () => {
  const { out } = await run(seeded(), Buffer.from(
    ["From: a@b.c", "To: lpc-classicmazda@hollercrmreports.com", "Subject: fyi",
     "Content-Type: text/plain", "", "no report today", ""].join("\r\n"), "utf8"));
  assert.equal(out.code, 200, JSON.stringify(out.body));
  assert.equal(out.body.ok, true, JSON.stringify(out.body));
});

// ---- the secret still guards the door ----
test("a request without the shared secret gets nowhere", async () => {
  const sb = fakeSupabase(seeded());
  const realFetch = globalThis.fetch;
  globalThis.fetch = sb.fetch;
  process.env.INGEST_SECRET = SECRET;
  try {
    const out = await call(Buffer.from("", "utf8"), { "x-ingest-secret": "wrong" });
    assert.equal(out.code, 401, JSON.stringify(out.body));
  } finally { globalThis.fetch = realFetch; }
});

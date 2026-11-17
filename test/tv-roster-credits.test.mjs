import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/ingest.mjs";
import { storeKey, boardKey } from "../api/_store-keys.mjs";

/* Every store, person and report here is fictional. These cover the people the
   TV board lost between DriveCentric and the wall: somebody who left mid-month,
   whose credits froze the day they were marked as gone, and somebody who dropped
   off a newer month-to-date report but kept an older number all month. */
const STORE = { id: "fictional-demo", name: "Fictional Demo Motors" };
const ym = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
const [Y, M] = ym.split("-").map(Number);
const period = (end) => `${M}/1/${Y} - ${M}/${end}/${Y}`;
const endDay = (end) => `${ym}-${String(end).padStart(2, "0")}`;
const delivered = (r) => (+r.internetUnits || 0) + (+r.phoneUnits || 0) + (+r.showroomUnits || 0) + (+r.campaignUnits || 0) + (+r.serviceUnits || 0);

// ---------- Service credits ----------
const head = (name) => `${name} Total Leads Total Ups Showroom Unsold In Showroom Be Backs Total Delivered/ F&I Closing %`;
const FOUR = ["Internet 10 0 0 0 1 10%", "Phone 8 0 0 0 1 12%", "Showroom 6 2 1 0 1.5 16%", "Campaign 4 0 0 0 0 0%"];
const block = (name, sources = FOUR, total = "3.5") => [head(name), ...sources,
  "New 10 0 0 0 1 10%", "Used 8 0 0 0 1 10%", ...(total === null ? [] : [`Total 28 2 1 0 ${total} 18%`])];
const report = (end, storeTotal, blocks) => ["Delivery Summary", period(end), head(STORE.name),
  "Internet 50 0 0 0 5 10%", "Phone 20 0 0 0 3 15%", "Showroom 20 8 3 1 2 10%", "Campaign 10 0 0 0 1 10%",
  `Total 100 8 3 1 ${storeTotal} 12%`, ...blocks.flat()];
// ---------- end to end through intake ----------
const lines = (texts) => texts.map((str, i) => ({ pg: 1, y: i * 16, parts: [{ str, x: 20 }] }));
function pdf(texts, revision = "") {
  const pages = Array.isArray(texts[0]) ? texts : [texts];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /CreationDate (D:20260101000000Z) /ModDate (D:20261231000000Z) >>"];
  for (const [page, values] of pages.entries()) {
    const content = values.map((text, i) => `BT /F1 8 Tf 20 ${2350 - i * 16} Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 2400] /Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + page * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let body = "%PDF-1.4\n", offsets = [0];
  for (const [i, value] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(body + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n% ${revision}\n`);
}
function mime(bytes, headers = [], filename = "fictional-summary.pdf") {
  return Buffer.from(["From: fictional-reports@example.invalid", "To: lpc-fictionaldemo@example.invalid", "Subject: Fictional Summary",
    ...headers, "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="fictional-boundary"', "",
    "--fictional-boundary", "Content-Type: text/plain", "", "Fictional report", "--fictional-boundary",
    "Content-Type: application/pdf", `Content-Disposition: attachment; filename="${filename}"`, "Content-Transfer-Encoding: base64", "",
    bytes.toString("base64"), "--fictional-boundary--", ""].join("\r\n"));
}
function database({ roster, departed = [], excluded = [] }) {
  const db = new Map([["lpc:config:v2", { stores: [STORE], roles: [{ id: "sales", onBoard: true }] }]]);
  db.set(storeKey(STORE.id), { rev: 1, roster: roster.map((name, i) => ({ id: `fictional-${i}`, name, roleId: "sales" })),
    departed: departed.map((name, i) => ({ id: `fictional-gone-${i}`, name, roleId: "sales", at: `${ym}-05T12:00:00.000Z` })),
    excluded, months: {} });
  db.set(boardKey(STORE.id), { storeName: STORE.name, roles: [{ id: "sales" }], roster: [], months: {} });
  return { db, requests: [], retries: 0, beforePatch: null, failArchives: false };
}
async function receive(state, bytes, headers = [], filename) {
  const savedFetch = globalThis.fetch;
  const names = ["INGEST_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const saved = names.map((name) => ({ name, exists: Object.hasOwn(process.env, name), value: process.env[name] }));
  process.env.INGEST_SECRET = "fictional-intake-secret";
  process.env.SUPABASE_URL = "http://127.0.0.1:5433";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-service-key";
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url), filter = parsed.searchParams.get("key") || "", method = options.method || "GET";
    const key = filter.replace(/^eq\./, "");
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (method === "GET") {
      if (filter.startsWith("like.")) return json([...state.db.keys()].filter((k) => k.startsWith(filter.slice(5).replace(/%$/, ""))).map((key) => ({ key })));
      return json(state.db.has(key) ? [{ value: structuredClone(state.db.get(key)) }] : []);
    }
    if (method === "PATCH") {
      if (state.beforePatch) { const effect = state.beforePatch; state.beforePatch = null; effect(); }
      const current = state.db.get(key), want = parsed.searchParams.get("value->>rev");
      const matches = want === "is.null" ? current?.rev == null : String(current?.rev) === want?.replace(/^eq\./, "");
      if (!matches) { state.retries++; return json([]); }
      const value = JSON.parse(options.body).value;
      state.db.set(key, value); state.requests.push({ method, key, value: structuredClone(value) });
      return json([{ value }]);
    }
    if (method === "POST") {
      for (const row of JSON.parse(options.body)) {
        if (state.failArchives && row.key.startsWith("lpc:reportfile:")) throw new Error("fictional archive failure");
        state.db.set(row.key, row.value); state.requests.push({ method, key: row.key, value: structuredClone(row.value) });
      }
      return json([]);
    }
    if (method === "DELETE") { state.db.delete(key); return json([]); }
    throw new Error(`unlisted fictional request ${method}`);
  };
  const raw = mime(bytes, headers, filename), output = {};
  const req = { method: "POST", headers: { "x-ingest-secret": "fictional-intake-secret" }, async *[Symbol.asyncIterator]() { yield raw; } };
  const res = { status(code) { output.code = code; return this; }, json(body) { output.body = body; return this; } };
  try { await handler(req, res); return output; }
  finally {
    globalThis.fetch = savedFetch;
    for (const old of saved) { if (old.exists) process.env[old.name] = old.value; else delete process.env[old.name]; }
  }
}


const store = (state) => state.db.get(storeKey(STORE.id));
const stats = (state) => store(state).months[ym].stats;
const wall = (state) => state.db.get(boardKey(STORE.id));
async function send(state, end, blocks) {
  const out = await receive(state, pdf(report(end, "60", blocks), `fictional-${end}-${blocks.length}`));
  assert.equal(out.code, 200, JSON.stringify(out.body));
  return out;
}
const FOUR_PEOPLE = ["Alex Example", "Bailey Example", "Casey Example", "Drew Example"];

// ---------- somebody who left mid-month ----------
test("a person who left keeps getting their month-to-date credits from newer reports", async () => {
  const state = database({ roster: FOUR_PEOPLE.slice(0, 3), departed: ["Drew Example"] });
  await send(state, 3, [block("Alex Example"), block("Bailey Example"), block("Casey Example"), block("Drew Example", FOUR, "4")]);
  assert.equal(delivered(stats(state)["drew example"]), 4);
  // A deal Drew sold before leaving is finalised later and credited on the 16th.
  await send(state, 16, [block("Alex Example"), block("Bailey Example"), block("Casey Example"), block("Drew Example", FOUR, "6")]);
  assert.equal(delivered(stats(state)["drew example"]), 6);
  assert.equal(stats(state)["drew example"].serviceUnits, 2.5);
});

test("a person who left is not put back on the roster or the wall by a report", async () => {
  const state = database({ roster: FOUR_PEOPLE.slice(0, 3), departed: ["Drew Example"] });
  await send(state, 16, [block("Alex Example"), block("Bailey Example"), block("Casey Example"), block("Drew Example", FOUR, "6")]);
  assert.deepEqual(store(state).roster.map((a) => a.name), FOUR_PEOPLE.slice(0, 3));
  assert.deepEqual(store(state).departed.map((d) => d.name), ["Drew Example"]);
  assert.equal(store(state).pendingPeople?.["drew example"], undefined, "a leaver is known here, not held");
  assert.deepEqual(wall(state).roster.map((a) => a.name), FOUR_PEOPLE.slice(0, 3));
  assert.equal(wall(state).months[ym].stats["drew example"], undefined);
});

test("a store's first import still never makes a leaver part of the floor", async () => {
  const state = database({ roster: [], departed: ["Drew Example"] });
  await send(state, 16, [block("Alex Example"), block("Bailey Example"), block("Casey Example"), block("Drew Example")]);
  assert.deepEqual(store(state).roster.map((a) => a.name), FOUR_PEOPLE.slice(0, 3));
  assert.equal(delivered(stats(state)["drew example"]), 3.5);
});

test("a name marked as not this store's still loses its figures, and an unknown name is still held", async () => {
  const state = database({ roster: FOUR_PEOPLE.slice(0, 3), excluded: ["Drew Example"] });
  await send(state, 16, [block("Alex Example"), block("Bailey Example"), block("Casey Example"), block("Drew Example"), block("Erin Example")]);
  assert.equal(stats(state)["drew example"], undefined);
  assert.equal(stats(state)["erin example"], undefined);
  assert.equal(delivered(store(state).pendingPeople["erin example"].months[ym]), 3.5);
});

// ---------- somebody a newer report no longer lists ----------
test("a person missing from a newer month-to-date report no longer keeps their older number", async () => {
  const state = database({ roster: FOUR_PEOPLE });
  await send(state, 3, FOUR_PEOPLE.map((name) => block(name)));
  await send(state, 16, FOUR_PEOPLE.slice(0, 3).map((name) => block(name)));
  const drew = stats(state)["drew example"];
  assert.equal(delivered(drew), 0);
  assert.equal(drew.internetPct, null);
  assert.equal(drew.deliverySummaryAbsent.through, endDay(16));
  assert.equal(drew.deliverySummaryAbsent.had.showroomUnits, 1.5, "the cleared figures are kept beside the zeros");
  assert.equal(delivered(wall(state).months[ym].stats["drew example"]), 0);
  assert.equal(delivered(stats(state)["alex example"]), 3.5);
});

test("back on a later report, the person's figures return and the record of the gap goes", async () => {
  const state = database({ roster: FOUR_PEOPLE });
  await send(state, 3, FOUR_PEOPLE.map((name) => block(name)));
  await send(state, 9, FOUR_PEOPLE.slice(0, 3).map((name) => block(name)));
  await send(state, 10, FOUR_PEOPLE.slice(0, 3).map((name) => block(name, FOUR, "4")));
  assert.equal(stats(state)["drew example"].deliverySummaryAbsent.had.showroomUnits, 1.5, "a second absence keeps the first record");
  await send(state, 16, FOUR_PEOPLE.map((name) => block(name, FOUR, "5")));
  assert.equal(delivered(stats(state)["drew example"]), 5);
  assert.equal(stats(state)["drew example"].deliverySummaryAbsent, undefined);
});

test("an older report arriving late, or one that leaves out more people than it lists, clears nobody", async () => {
  const state = database({ roster: FOUR_PEOPLE });
  await send(state, 16, FOUR_PEOPLE.map((name) => block(name)));
  await send(state, 9, FOUR_PEOPLE.slice(0, 3).map((name) => block(name)));
  assert.equal(delivered(stats(state)["drew example"]), 3.5);
  assert.equal(store(state).months[ym].deliverySummaryThrough, endDay(16));

  const six = [...FOUR_PEOPLE, "Frankie Example", "Gray Example", "Harper Example"];
  const big = database({ roster: six });
  await send(big, 3, six.map((name) => block(name)));
  await send(big, 16, six.slice(0, 3).map((name) => block(name)));
  for (const name of six.slice(3)) assert.equal(delivered(stats(big)[name.toLowerCase()]), 3.5, name);
});

test("a person who left is not cleared when a newer report stops listing them", async () => {
  const state = database({ roster: FOUR_PEOPLE.slice(0, 3), departed: ["Drew Example"] });
  await send(state, 3, FOUR_PEOPLE.map((name) => block(name)));
  await send(state, 16, FOUR_PEOPLE.slice(0, 3).map((name) => block(name)));
  assert.equal(delivered(stats(state)["drew example"]), 3.5);
  assert.equal(stats(state)["drew example"].deliverySummaryAbsent, undefined);
});

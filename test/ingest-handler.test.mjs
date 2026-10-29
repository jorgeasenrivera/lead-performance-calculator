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
import { storeKey, boardKey } from "../api/_store-keys.mjs";

const SECRET = "test-secret";
const STORE = { id: "classic-mazda", name: "Classic Mazda" };

/* Supabase, in memory. The handler reaches it through fetch and nothing else,
   so this is the whole of it: a GET that answers from a Map, a POST that puts,
   and the conditional PATCH the CAS save uses. */
function fakeSupabase(seed) {
  const db = new Map(Object.entries(seed));
  const writes = [];
  const fetch = async (url, opts = {}) => {
    if (opts.method && opts.method !== "GET") writes.push({ url, method: opts.method });
    const u = new URL(url);
    const key = (u.searchParams.get("key") || "").replace(/^eq\./, "");
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
  return { db, fetch, writes };
}

/* CSV attachments, in a body PostalMime will read. */
function message({ to, subject, filename, csv, mime = "text/csv", encoding = "8bit", attachments = [{ filename, csv, mime, encoding }] }) {
  const b = "b0undary";
  return Buffer.from([
    `From: reports@example.com`, `To: ${to}`, `Subject: ${subject}`,
    `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${b}"`, ``,
    `--${b}`, `Content-Type: text/plain`, ``, `report attached`, ``,
    ...attachments.flatMap(({ filename, csv, mime = "text/csv", encoding = "8bit" }) => [
      `--${b}`, `Content-Type: ${mime}; name="${filename}"`,
      `Content-Transfer-Encoding: ${encoding}`,
      `Content-Disposition: attachment; filename="${filename}"`, ``, csv, ``,
    ]),
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
  try { return { out: await call(msg), db: sb.db, writes: sb.writes }; }
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

// ---- the board row names everyone who can claim a name, not only the wall ----
test("a refreshed board row lists every roster person under people, whatever their role", async () => {
  const seed = seeded();
  seed[storeKey(STORE.id)] = {
    rev: 3, months: {},
    roster: [
      { id: "p-fin", name: "Fin Smith", roleId: "sales" },
      { id: "p-jo", name: "Jo Manager", roleId: "manager" },
      { id: "p-test", name: "Test Account", roleId: null },
      { id: "p-old", name: "Old Timer", roleId: "sales" },
    ],
    departed: [{ id: "p-old", name: "Old Timer" }],
  };
  /* A wall that has been opened once, so the pipeline refreshes it. */
  seed[boardKey(STORE.id)] = { storeId: STORE.id, roles: [{ id: "sales" }], roster: [], months: {} };
  const { out, db } = await run(seed, message({
    to: `lpc-classicmazda@hollercrmreports.com`,
    subject: "Daily Internet Delivery", filename: "delivery-internet.csv", csv: CSV,
  }));
  assert.equal(out.code, 200, JSON.stringify(out.body));
  const board = db.get(boardKey(STORE.id));
  assert.deepEqual(board.roster.map((r) => r.id), ["p-fin"], "the wall keeps the board roles only");
  assert.deepEqual(board.people.map((r) => r.id).sort(), ["p-fin", "p-jo", "p-test"], "everyone still on the roster can claim a name");
  assert.ok(!board.people.some((r) => r.id === "p-old"), "the departed cannot");
});

// The parser's rejection marker must never become an imported report type.
const wrongChannel = { filename: "Standard-Phone.csv", csv: CSV };
const delivery = { filename: "delivery-internet.csv", csv: CSV };
const addressed = attachments => message({
  to: "lpc-classicmazda@hollercrmreports.com", subject: "Daily Internet Delivery", attachments,
});

test("wrong-channel email leaves an empty store and all backend rows untouched", async () => {
  const seed = seeded();
  const { out, db, writes } = await run(seed, addressed([wrongChannel]));
  assert.equal(out.code, 422);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.failures[0].file, wrongChannel.filename);
  assert.match(out.body.failures[0].why, /Delivery Summary/);
  assert.deepEqual(out.body.skippedFiles, out.body.failures);
  assert.deepEqual(writes, []);
  assert.deepEqual(Object.fromEntries(db), seed);
});

test("wrong-channel email cannot clear existing figures or change import history", async () => {
  const prior = await run(seeded(), addressed([delivery]));
  assert.equal(prior.out.code, 200);
  const seed = Object.fromEntries(prior.db);
  const before = structuredClone(seed);
  const blank = { ...wrongChannel, csv: CSV.replace("110,7,6.4,5,4.5", "-,-,-,-,-") };
  const { out, db, writes } = await run(seed, addressed([blank]));
  assert.equal(out.code, 422);
  assert.equal(out.body.ok, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(Object.fromEntries(db), before);
});

for (const wrongFirst of [true, false]) {
  test(`mixed email keeps valid delivery and reports rejected attachment, wrong first=${wrongFirst}`, async () => {
    const bad = { ...wrongChannel, csv: CSV.replace("Fin Smith", "Rejected Person") };
    const attachments = wrongFirst ? [bad, delivery] : [delivery, bad];
    const { out, db } = await run(seeded(), addressed(attachments));
    assert.equal(out.code, 422);
    assert.equal(out.body.ok, false);
    assert.equal(out.body.error, "some attachments could not be filed");
    assert.equal(out.body.stores.length, 1);
    assert.equal(out.body.failures.length, 1);
    assert.equal(out.body.failures[0].file, bad.filename);
    const wrote = db.get(storeKey(STORE.id));
    assert.equal(wrote.rev, 4);
    assert.deepEqual(wrote.roster.map(p => p.name), ["Fin Smith"]);
    const month = Object.values(wrote.months)[0];
    assert.equal(month.stats["fin smith"].internetUnits, 5);
    assert.equal(month.stats["fin smith"].unitsDelivered, 5);
    assert.equal(month.stats["rejected person"], undefined);
    assert.equal(month.names["wrong-channel-report"], undefined);
    assert.equal(Object.values(month.imports)[0]["wrong-channel-report"], undefined);
    assert.deepEqual(wrote.importLog.map(l => l.type), ["delivery-internet"]);
    assert.ok(![...db.keys()].some(k => k.includes(bad.filename)), "rejected attachment is not archived as an accepted report");
  });
}

test("valid delivery-only email retains successful response and values", async () => {
  const { out, db } = await run(seeded(), addressed([delivery]));
  assert.equal(out.code, 200);
  assert.equal(out.body.ok, true);
  assert.deepEqual(out.body.skippedFiles, []);
  const month = Object.values(db.get(storeKey(STORE.id)).months)[0];
  assert.equal(month.stats["fin smith"].internetUnits, 5);
  assert.equal(month.stats["fin smith"].sold, 7);
  assert.equal(Object.values(month.imports)[0]["delivery-internet"], true);
});

// Exercise routing through the production handler, including its address fallback.
const NORTH = { id: "classic-mazda-north", name: "Classic Mazda North" };
const SOUTH = { id: "classic-mazda-south", name: "Classic Mazda South" };
for (const reverse of [false, true]) {
  for (const [label, stores, heading, expected] of [
    ["exact heading", [STORE, NORTH], "Classic Mazda", STORE.id],
    ["normalized ID", [{ ...STORE, name: "Harbor Motors" }, NORTH], "CLASSIC--MAZDA", STORE.id],
    ["suffix heading", [STORE, NORTH], "Classic Mazda North Monthly", NORTH.id],
    ["unique truncation", [NORTH], "Classic Mazda", NORTH.id],
    ["ambiguous truncation", [NORTH, SOUTH], "Classic Mazda", null],
    ["duplicate normalized name", [STORE, { id: "other", name: "Classic-Mazda" }], "Classic Mazda", null],
    ["name and ID conflict", [STORE, { id: "classicmazda", name: "Other Store" }], "Classic Mazda", null],
  ]) {
    test(`store roll-up ${label}, store order ${reverse ? "reversed" : "forward"}`, async () => {
      const ordered = reverse ? [...stores].reverse() : stores;
      const seed = { "lpc:config:v2": { stores: ordered } };
      for (const store of stores) seed[storeKey(store.id)] = { roster: [], months: {}, rev: 3 };
      const original = structuredClone(seed);
      const { out, db } = await run(seed, message({
        // This deliberately names a valid store even in ambiguous cases.
        to: `lpc-${stores[0].id}@example.test`, subject: "Store delivery",
        filename: "store.csv", csv: `Store,Deals Delivered\n${heading},7`,
      }));
      assert.equal(out.code, expected ? 200 : 422, JSON.stringify(out.body));
      if (expected) assert.deepEqual(out.body.stores.map((s) => s.store), [expected]);
      for (const store of stores) {
        const key = storeKey(store.id);
        if (store.id !== expected) assert.deepEqual(db.get(key), original[key], "unselected store must not change");
        else assert.equal(Object.values(db.get(key).months)[0].stated.deliveries, 7);
      }
      if (!expected) assert.equal(db.size, Object.keys(seed).length, "refusal must not archive or write any rows");
    });
  }
}

const monthNow = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
function aliasSeed() {
  const seed = seeded();
  seed[storeKey(STORE.id)] = {
    rev: 3, roster: [{ id: "fin", name: "Fin Smith" }],
    aliases: { "finn smith": "fin smith", "f smith": "fin smith" },
    months: { [monthNow()]: { stats: { "fin smith": { opps: 999, sold: 999, unitsDelivered: 999, phoneUnits: 12, apptTotalCreated: 8 } } } },
  };
  return seed;
}
const deliveryMail = (rows, channel = "Internet") => message({
  to: "lpc-classicmazda@example.test", subject: `${channel} Delivery`, filename: "delivery.csv",
  csv: ["Delivery", "Name,Opportunities,Sold,Sold %,Units Delivered,Delivered %", ...rows].join("\n"),
});
const stat = (db) => db.get(storeKey(STORE.id)).months[monthNow()].stats["fin smith"];
for (const reverse of [false, true]) {
  test(`alias delivery adds credits only inside the report, order ${reverse}`, async () => {
    const rows = ["Fin Smith,100,4,0.04,2,0.02", "Finn Smith,50,3,0.06,1.5,0.03"];
    const mail = deliveryMail(reverse ? rows.reverse() : rows);
    const first = await run(aliasSeed(), mail);
    assert.equal(first.out.code, 200, JSON.stringify(first.out.body));
    const rec = stat(first.db);
    assert.equal(rec.displayName, "Fin Smith");
    assert.equal(rec.opps, 150);
    assert.equal(rec.sold, 7);
    assert.equal(rec.unitsDelivered, 3.5);
    assert.equal(rec.internetLeads, 150);
    assert.equal(rec.internetUnits, 3.5);
    assert.equal(rec.internetPct, 3.5 / 150);
    assert.equal(rec.deliveredPct, rec.internetPct);
    assert.equal(rec.soldPct, 7 / 150);
    assert.equal(rec.phoneUnits, 12, "other report channels remain intact");
    assert.equal(rec.apptTotalCreated, 8);
    const stored = first.db.get(storeKey(STORE.id));
    assert.deepEqual(stored.months[monthNow()].names["delivery-internet"], ["fin smith"]);
    assert.deepEqual(stored.roster, [{ id: "fin", name: "Fin Smith" }]);
    const repeated = await run(Object.fromEntries(first.db), mail);
    assert.equal(repeated.out.code, 200);
    assert.deepEqual(stat(repeated.db), rec, "repeated cumulative reports replace rather than double counts");
  });

  test(`alias counts preserve zero and unknown, order ${reverse}`, async () => {
    const rows = ["Fin Smith,0,,99,0,99", "Finn Smith,,,,,", "F Smith,,,,,"];
    const { out, db } = await run(aliasSeed(), deliveryMail(reverse ? rows.reverse() : rows));
    assert.equal(out.code, 200);
    const rec = stat(db);
    assert.equal(rec.opps, null);
    assert.equal(rec.unitsDelivered, null);
    assert.equal(rec.sold, null);
    assert.equal(rec.soldPct, null);
    assert.equal(rec.deliveredPct, null, "zero denominator is not a known rate");
    assert.equal(rec.internetPct, null);
  });

  test(`alias partial bases do not invent rates, order ${reverse}`, async () => {
    const rows = ["Fin Smith,10,1,10,1,10", "Finn Smith,,,,,"];
    const { out, db } = await run(aliasSeed(), deliveryMail(reverse ? rows.reverse() : rows));
    assert.equal(out.code, 200);
    assert.equal(stat(db).unitsDelivered, null);
    assert.equal(stat(db).opps, null);
    assert.equal(stat(db).internetPct, null);
  });

  test(`daily activity aliases preserve monthly delivery totals, order ${reverse}`, async () => {
    const rows = ["Fin Smith,10,2,1,0,,1.5,2,3", "Finn Smith,5,3,2,,,0.5,4,2"];
    const mail = message({ to: "lpc-classicmazda@example.test", subject: "Activity", filename: "activity.csv",
      csv: ["Activity", "Name,Calls,Call Contacted,Personalized Video,Text,Email,Units Delivered,Showroom,Open Tasks", ...(reverse ? rows.reverse() : rows)].join("\n") });
    const first = await run(aliasSeed(), mail);
    assert.equal(first.out.code, 200, JSON.stringify(first.out.body));
    const store = first.db.get(storeKey(STORE.id));
    const daily = Object.values(store.activity)[0]["fin smith"];
    assert.equal(daily.calls, 15);
    assert.equal(daily.contacted, 5);
    assert.equal(daily.video, 3);
    assert.equal(daily.text, null);
    assert.equal(daily.email, null);
    assert.equal(daily.units, 2);
    assert.equal(daily.oppShowroom, 6);
    assert.equal(daily.tasksPosted, 5);
    assert.equal(stat(first.db).unitsDelivered, 999);
    assert.equal(stat(first.db).opps, 999);
    assert.equal(stat(first.db).phoneUnits, 12);
    const repeated = await run(Object.fromEntries(first.db), mail);
    assert.equal(repeated.out.code, 200);
    const again = Object.values(repeated.db.get(storeKey(STORE.id)).activity)[0]["fin smith"];
    assert.equal(again.calls, 15);
    assert.equal(again.units, 2);
  });
}

test("excluded aliases do not contribute and single-person percentages stay as printed", async () => {
  const seed = aliasSeed();
  seed[storeKey(STORE.id)].excluded = ["Finn Smith"];
  const { out, db } = await run(seed, deliveryMail(["Fin Smith,100,4,4.01,2,2.01", "Finn Smith,50,3,6,1.5,3"]));
  assert.equal(out.code, 200);
  assert.equal(stat(db).opps, 100);
  assert.equal(stat(db).internetPct, 2.01);
  assert.equal(stat(db).soldPct, 4.01);
});

test("appointment aliases add counts without adding unsupported video rates", async () => {
  const { out, db } = await run(aliasSeed(), message({
    to: "lpc-classicmazda@example.test", subject: "Appointments", filename: "appointments.csv",
    csv: "Appointments\nName,Video Day of Appt %,Total Created,Total Scheduled,Total Show,Total Show %\nFin Smith,50,4,4,2,50\nFinn Smith,25,6,6,1,16.67",
  }));
  assert.equal(out.code, 200);
  assert.equal(stat(db).apptTotalCreated, 10);
  assert.equal(stat(db).apptTotalScheduled, 10);
  assert.equal(stat(db).apptTotalShow, 3);
  assert.equal(stat(db).apptShowPct, 0.3);
  assert.equal(stat(db).apptVideoDayPct, null);
});

test("a combined closing rate below one percent remains a fraction", async () => {
  const { out, db } = await run(aliasSeed(), deliveryMail(["Fin Smith,100,1,0.01,0.5,0.005", "Finn Smith,100,0,0,0.5,0.005"]));
  assert.equal(out.code, 200);
  assert.equal(stat(db).internetPct, 0.005);
  assert.equal(stat(db).soldPct, 0.005);
});

for (const channel of ["Phone", "Showroom", "Campaign"]) {
  test(`${channel} alias report keeps other monthly channels intact`, async () => {
    const { out, db } = await run(aliasSeed(), deliveryMail(["Fin Smith,20,2,0.1,1,0.05", "Finn Smith,10,1,0.1,0.5,0.05"], channel));
    assert.equal(out.code, 200);
    const rec = stat(db), key = channel.toLowerCase();
    assert.equal(rec[key + "Leads"], 30);
    assert.equal(rec[key + "Units"], 1.5);
    if (channel === "Campaign") assert.equal(rec.campaignPct, undefined);
    else assert.equal(rec[key + "Pct"], 0.05);
    assert.equal(rec.opps, 999);
    assert.equal(rec.unitsDelivered, 999);
  });
}

// A tiny ASCII PDF fixture, using the same printed rows as the parser fixtures.
// No extraction stub: the real handler must read the attachment with PDF.js.
function reportPdf(lines) {
  const content = lines.map((line, i) => `BT /F1 8 Tf 20 ${760 - i * 18} Td (${line.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const summaryBlock = (name, leads, units) => [
  `${name} Total Leads Total Ups Unsold In Showroom Be Backs Delivered F I Closing %`,
  `Internet ${leads} 0 0 0 ${units} 2%`,
];
for (const reverse of [false, true]) {
  test(`real PDF summary routes exact heading and aggregates aliases, order ${reverse}`, async () => {
    const seed = aliasSeed();
    seed["lpc:config:v2"].stores = reverse ? [NORTH, STORE] : [STORE, NORTH];
    seed[storeKey(NORTH.id)] = { roster: [], months: {}, rev: 3 };
    const people = [summaryBlock("Fin Smith", 100, 2), summaryBlock("Finn Smith", 50, 1.5), summaryBlock("F Smith", 0, 0)];
    const pdf = reportPdf([...summaryBlock("Classic Mazda", 150, 3), ...(reverse ? people.reverse() : people).flat()]);
    const mail = message({ to: "lpc-classicmazdanorth@example.test", subject: "Delivery Summary", filename: "summary.pdf",
      mime: "application/pdf", encoding: "base64", csv: pdf.toString("base64") });
    const { out, db } = await run(seed, mail);
    assert.equal(out.code, 200, JSON.stringify(out.body));
    assert.deepEqual(out.body.stores.map((s) => s.store), [STORE.id]);
    assert.equal(stat(db).internetLeads, 150);
    assert.equal(stat(db).internetUnits, 3.5);
    assert.equal(stat(db).internetPct, 3.5 / 150);
    assert.equal(stat(db).newUnits, null);
    assert.equal(db.get(storeKey(NORTH.id)).rev, 3);
    assert.equal(db.get(storeKey(STORE.id)).months[monthNow()].stated.deliveries, 3, "store totals never become employee-credit totals");
    const repeated = await run(Object.fromEntries(db), mail);
    assert.equal(repeated.out.code, 200);
    assert.equal(stat(repeated.db).internetUnits, 3.5);
  });
}

test("real PDF with an ambiguous heading writes nothing despite a valid addressed store", async () => {
  const seed = { "lpc:config:v2": { stores: [NORTH, SOUTH] },
    [storeKey(NORTH.id)]: { roster: [], months: {}, rev: 3 },
    [storeKey(SOUTH.id)]: { roster: [], months: {}, rev: 3 } };
  const pdf = reportPdf([...summaryBlock("Classic Mazda", 150, 3), ...summaryBlock("Fin Smith", 100, 2), ...summaryBlock("Finn Smith", 50, 1.5), ...summaryBlock("F Smith", 0, 0)]);
  const { out, db } = await run(seed, message({ to: "lpc-classicmazdanorth@example.test", subject: "Summary", filename: "summary.pdf",
    mime: "application/pdf", encoding: "base64", csv: pdf.toString("base64") }));
  assert.equal(out.code, 422, JSON.stringify(out.body));
  assert.match(out.body.failures[0].why, /ambiguous/, "the PDF must be read before its store is refused");
  assert.deepEqual(Object.fromEntries(db), seed);
});

for (const reverse of [false, true]) {
  for (const [label, first, second, units] of [
    ["zero plus known zero", "0", "0", 0],
    ["known plus absent", "1", "", null],
    ["zero plus absent", "0", "", null],
    ["known plus dash", "1", "-", null],
    ["known plus invalid", "1", "not-a-number", null],
    ["known plus infinity", "1", "Infinity", null],
    ["known plus exponent overflow", "1", "1e309", null],
    ["finite sum overflow", "1e308", "1e308", null],
    ["fractional credits", "0.5", "1.25", 1.75],
  ]) {
    test(`alias ${label} preserves completeness, order ${reverse}`, async () => {
      const rows = [`Fin Smith,10,1,0.1,${first},0.1`, `Finn Smith,10,1,0.1,${second},0.1`];
      const { out, db } = await run(aliasSeed(), deliveryMail(reverse ? rows.reverse() : rows));
      assert.equal(out.code, 200);
      const rec = stat(db);
      assert.equal(rec.unitsDelivered, units);
      assert.equal(rec.internetUnits, units);
      assert.equal(rec.internetPct, units == null ? null : units / 20);
      assert.equal(rec.deliveredPct, units == null ? null : units / 20);
      assert.equal(rec.opps, 20);
      assert.equal(rec.phoneUnits, 12);
    });
  }
  for (const [label, leads, units] of [
    ["overflowing denominator", "1e308", "1"],
    ["overflowing ratio", "1e-308", "1e308"],
    ["known zero denominator", "0", "0"],
  ]) {
    test(`alias ${label} cannot produce a finite-looking rate, order ${reverse}`, async () => {
      const rows = [`Fin Smith,${leads},1,0.1,${units},0.1`, `Finn Smith,${leads},1,0.1,0,0.1`];
      const { out, db } = await run(aliasSeed(), deliveryMail(reverse ? rows.reverse() : rows));
      assert.equal(out.code, 200);
      assert.equal(stat(db).internetPct, null);
      assert.equal(stat(db).deliveredPct, null);
      if (label === "overflowing denominator") assert.equal(stat(db).opps, null);
    });
  }
}

for (const reverse of [false, true]) {
  test(`incomplete daily alias task count cannot revive an older count, order ${reverse}`, async () => {
    const seed = aliasSeed();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    seed[storeKey(STORE.id)].activity = { [day]: { "fin smith": { tasksPosted: 99 } } };
    const rows = ["Fin Smith,10,2,1,5", "Finn Smith,5,3,2,"];
    const mail = message({ to: "lpc-classicmazda@example.test", subject: "Activity", filename: "activity.csv",
      csv: ["Activity", "Name,Calls,Call Contacted,Personalized Video,Open Tasks", ...(reverse ? rows.reverse() : rows)].join("\n") });
    const { out, db } = await run(seed, mail);
    assert.equal(out.code, 200);
    assert.equal(db.get(storeKey(STORE.id)).activity[day]["fin smith"].tasksPosted, null);
    assert.equal(stat(db).actOpenTasks, null);
    assert.equal(stat(db).unitsDelivered, 999);
  });
}

test("single-row missing task column retains the existing prior-count fallback", async () => {
  const seed = aliasSeed();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  seed[storeKey(STORE.id)].activity = { [day]: { "fin smith": { tasksPosted: 99 } } };
  const { out, db } = await run(seed, message({ to: "lpc-classicmazda@example.test", subject: "Activity", filename: "activity.csv",
    csv: "Activity\nName,Calls,Call Contacted,Personalized Video\nFin Smith,10,2,1" }));
  assert.equal(out.code, 200);
  assert.equal(db.get(storeKey(STORE.id)).activity[day]["fin smith"].tasksPosted, 99);
});

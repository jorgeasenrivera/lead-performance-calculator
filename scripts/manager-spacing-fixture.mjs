/* The spacing check's synthetic backend answers, in one place.
   Baseline build: the app reads config and store rows as app_data TABLE reads, and manager-spacing.mjs rewrote those responses in the browser (a second store, the
   store key and __storeId for it, the dock's rooms and imports). Candidate build: the app reads them through the sage_config_read and sage_store_read RPCs, which the
   old mock does not know (it answers [] to any unknown path), so none of those rewrites ever ran. This module keeps the table rewrite EXACTLY as it was and gives the two
   RPCs the same rewrite over the same backing rows. Nothing here talks to the network: the caller hands in how to read a row. */

export const BASE_STORE = "sage-demo";
export const SECOND_STORE = "spacing-demo-2";
export const CONFIG_KEY = "lpc:config:v2";
export const storeKey = (id) => `lpc:store:${id}:v2`;
/* The store argument, as strictly as the candidate's own fixture (scripts/shots-fixture.mjs STORE_ID). */
export const STORE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/* The rewrite of one app_data row. `second` is true when the request named the second store; `dock` returns the current dock fixture or null (read at call time, as the
   script's mutable variable was); `now` is the clock. This is the inline code of manager-spacing.mjs, moved, not changed. */
export function makeRowFixture({ second = false, dock = () => null, now = () => new Date() } = {}) {
  const dockFixture = () => dock();
  const addStore = (row) => row?.value?.stores ? { ...row, value: { ...row.value,
    stores: [...row.value.stores, { ...row.value.stores[0], id: 'spacing-demo-2', name: 'Second Fictional Store' }],
    standards: { ...row.value.standards, 'spacing-demo-2': row.value.standards?.['sage-demo'] } } }
    : second && row?.value ? { ...row, key: row.key?.replace('sage-demo', 'spacing-demo-2'), value: { ...row.value, __storeId: 'spacing-demo-2' } } : row;
  return (row) => {
    row = addStore(row);
    const d = dockFixture();
    if (!d || !row?.value) return row;
    if (row.value.stores) return { ...row, value: { ...row.value, stores: row.value.stores.map((st) => ({ ...st, rooms: { floor: true, line: d.rooms === 2 } })) } };
    if (row.value.months) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now()), month = day.slice(0, 7);
      const m = row.value.months[month] || {};
      return { ...row, value: { ...row.value, months: { ...row.value.months, [month]: { ...m, imports: { ...m.imports, [day]: d.done === 2 ? { appointment: true, video: true, activity: true } : d.done === 1 ? { appointment: true } : {} } } } } };
    }
    return row;
  };
}

/* Table path: which request is for the second store, and where it is really sent (the second store's rows live under the first store's id in the mock). */
export function tablePlan(url) {
  const second = url.includes(SECOND_STORE);
  return { second, fetchUrl: second ? url.replaceAll(SECOND_STORE, BASE_STORE) : url };
}
/* The body of a table response, array or single, through the row rewrite. */
export const rewriteBody = (data, fixture) => (Array.isArray(data) ? data.map(fixture) : fixture(data));

const error = (status, code, message) => ({ status, json: { code, message, details: "", hint: "" } });
/* The candidate's two reads. Returns { status, json } for a call this module answers, or null for any other function (the caller passes it on untouched).
   Shapes as the candidate fixture serves them: config { value }, store { value, updated_at, activity: {} } or null for no row. */
export async function answerRpc({ name, bodyText, readRow, dock = () => null, now = () => new Date() }) {
  if (name === "sage_config_read") {
    const row = await readRow(CONFIG_KEY);
    const out = row ? makeRowFixture({ second: false, dock, now })(row) : null;
    return { status: 200, json: { value: out ? out.value : null } };
  }
  if (name === "sage_store_read") {
    let args; try { args = JSON.parse(bodyText || "null"); } catch (e) { args = undefined; }
    if (!args || typeof args !== "object" || Array.isArray(args) || typeof args.p_store !== "string" || !STORE_ID.test(args.p_store)) return error(400, "22023", "store required");
    const second = args.p_store === SECOND_STORE;
    const row = await readRow(storeKey(second ? BASE_STORE : args.p_store));
    if (!row) return { status: 200, json: null };
    const out = makeRowFixture({ second, dock, now })(row);
    return { status: 200, json: { value: out.value, updated_at: out.updated_at || null, activity: {} } };
  }
  return null;
}

/* ---- the NEW RPC route only; the table route above is exactly as it was ---- */
/* The one origin these reads may touch. Anything else is refused when the routes are installed. */
export const MOCK_ORIGIN = "http://127.0.0.1:5433";
/* Fixed reasons, the only text a failed read or header fetch leaves behind. */
export const FAILURES = ["bad-origin", "read-redirect", "read-status", "read-shape", "read-error", "header-redirect", "header-status", "header-error"];
export const LATCH_CAP = 1000;
class Refused extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const statusOf = (res) => (res && typeof res.status === "function" ? res.status() : NaN);
const classify = (status, prefix) => (status >= 300 && status < 400 ? `${prefix}-redirect` : `${prefix}-status`);

/* Reads one backing app_data row through the context's request client: this exact origin, no redirects, HTTP 200 and an array of rows. A missing row is ONLY a successful
   empty array; an error status, a redirect, a non-array, a row of another key, more than one row, or an unreadable body all refuse. */
export async function readAppDataRow(context, key, origin = MOCK_ORIGIN) {
  if (origin !== MOCK_ORIGIN) throw new Refused("bad-origin");
  const u = new URL(`${origin}/rest/v1/app_data`); u.searchParams.set("select", "key,value,updated_at"); u.searchParams.set("key", `eq.${key}`);
  if (u.origin !== MOCK_ORIGIN) throw new Refused("bad-origin");
  let res, rows;
  try { res = await context.request.get(u.toString(), { maxRedirects: 0, failOnStatusCode: false, timeout: 15000 }); } catch (e) { throw new Refused("read-error"); }
  const status = statusOf(res);
  if (status !== 200) throw new Refused(classify(status, "read"));
  try { rows = await res.json(); } catch (e) { throw new Refused("read-error"); }
  if (!Array.isArray(rows) || rows.length > 1) throw new Refused("read-shape");
  if (rows.length === 0) return undefined;
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || row.key !== key) throw new Refused("read-shape");
  return row;
}

/* Registers both routes on a Playwright browser context. `dock` is a getter for the script's dock variable. `readRow(key)` reads one backing app_data row; by default it is
   readAppDataRow above. A NEW-RPC read or header fetch that cannot be trusted aborts that request (the app sees a failed request, never an invented empty row) and is recorded
   in the returned controller's refusal latch (see below). */
export async function installSpacingRoutes(context, { dock = () => null, now = () => new Date(), readRow, origin = MOCK_ORIGIN, log = (line) => console.error(line) } = {}) {
  if (origin !== MOCK_ORIGIN) throw new Refused("bad-origin");
  /* The refusal latch: one saturating counter per fixed word, nothing else kept. It cannot grow past FAILURES.length x LATCH_CAP and holds no text from any request. */
  const counts = Object.fromEntries(FAILURES.map((w) => [w, 0]));
  const fail = (reason) => { const w = FAILURES.includes(reason) ? reason : "read-error"; counts[w] = Math.min(counts[w] + 1, LATCH_CAP); try { log(`spacing-fixture: ${w}`); } catch (e) {} };
  const read = readRow || ((key) => readAppDataRow(context, key, origin));
  await context.route(`${origin}/rest/v1/app_data?**`, async (route) => {
    const { second, fetchUrl } = tablePlan(route.request().url());
    const response = await route.fetch({ url: fetchUrl });
    const data = await response.json();
    await route.fulfill({ response, json: rewriteBody(data, makeRowFixture({ second, dock, now })) });
  });
  await context.route(`${origin}/rest/v1/rpc/*`, async (route) => {
    const req = route.request();
    const url = req.url();
    const m = /\/rest\/v1\/rpc\/([a-z_]+)(?:\?.*)?$/.exec(url);
    if (req.method() !== "POST" || !m) return route.fallback();
    if (!url.startsWith(`${origin}/rest/v1/rpc/`)) { fail("bad-origin"); return route.abort("failed"); }
    let answer;
    try { answer = await answerRpc({ name: m[1], bodyText: req.postData() || "", readRow: read, dock, now }); }
    catch (e) { fail(e && FAILURES.includes(e.reason) ? e.reason : "read-error"); return route.abort("failed"); }
    if (!answer) return route.fallback();
    let response;
    try { response = await route.fetch({ maxRedirects: 0 }); } catch (e) { fail("header-error"); return route.abort("failed"); }   // the mock's own headers (CORS included) carry the answer
    const status = statusOf(response);
    if (status !== 200) { fail(classify(status, "header")); return route.abort("failed"); }
    return route.fulfill({ response, status: answer.status, json: answer.json });
  });
  const refusals = () => ({ total: FAILURES.reduce((n, w) => n + counts[w], 0), counts: { ...counts } });
  return {
    refusals,
    /* The final verdict of a run: any refusal, however the browser recovered afterwards, fails it. The message uses the fixed words and counts only. */
    assertNoRefusals() {
      const r = refusals();
      if (r.total > 0) throw new Error(`spacing fixture refused ${r.total} request(s): ${FAILURES.filter((w) => r.counts[w] > 0).map((w) => `${w}=${r.counts[w]}`).join(", ")}`);
    },
  };
}

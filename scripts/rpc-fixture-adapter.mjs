/* The RPC half of the manager fixtures that read config and store rows.

   The candidate build reads config and the store through the sage_config_read and sage_store_read RPCs. The mock does not know them (it answers 200 [] to any unknown
   path), so the table rewrite each script does in its own app_data route never ran, and the app saw `undefined` for both. This module answers those two reads and nothing
   else. It does NOT carry a copy of any script's rewrite: it calls the script's own, unchanged app_data callback, through a route object that offers only the three
   members that callback uses (request().url(), fetch({url}), fulfill({response, json})). Anything else the callback touches is refused. So the dock, the thresholds and
   rates, the freshness stamp and importStamp, and the second store are exactly what the table path gives, in the same order, read at call time.

   The network is touched in exactly two ways, both to the exact loopback origin below, both with redirects off and the explicit READ_TIMEOUT_MS: a GET for each backing
   read, and one real POST per answered request, which is route.fetch re-sending the intercepted RPC so that the mock's own reply headers (CORS included) carry the answer.
   Every refusal is one fixed word, counted and kept until the script's terminal check; no request text is kept. */

export const ORIGIN = 'http://127.0.0.1:5433';
export const BASE_STORE = 'sage-demo';
export const SECOND_STORE = 'spacing-demo-2';
export const CONFIG_KEY = 'lpc:config:v2';
/* The only two stores any of these scripts reads. Not a pattern: an unlisted store is refused, so a script that starts reading another one fails loudly. */
export const ALLOWED_STORES = Object.freeze([BASE_STORE, SECOND_STORE]);

/* Limits from the contract, not from what the demo happens to weigh today. Each has a test one over the line. */
export const MAX_BACKING_BYTES = 4194304;   // one backing response, 4 MiB
export const MAX_LIST_ROWS = 512;           // rows in the app_data listing the activity is read from
export const MAX_RPC_BODY_BYTES = 256;      // an RPC request body: {"p_store":"spacing-demo-2"} is about 30
export const READ_TIMEOUT_MS = 15000;
export const LATCH_CAP = 1000;

export const WORDS = Object.freeze([
  'bad-origin', 'bad-request', 'store-not-allowed',
  'read-redirect', 'read-status', 'read-shape', 'read-size', 'read-error',
  'legacy-error',
  'header-redirect', 'header-status', 'header-error',
  'respond-error', 'handler-error',
]);

export class Refusal extends Error {
  constructor(word) { super(word); this.word = word; }
}
/* The callback reached for something it was not offered, or used what it was offered in a way it was not shown to. */
class CapabilityError extends Refusal {
  constructor(what) { super('legacy-error'); this.what = what; }
}

/* Realm-agnostic: the callback may run in another vm context in tests. */
const isPlain = (v) => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
const storeKey = (id) => `lpc:store:${id}:v2`;
function validDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/* ---- the request gate: everything is decided before any backing read ---- */
export function parseRpcRequest({ method, url, bodyText }) {
  if (method !== 'POST') return { kind: 'pass' };
  let u;
  try { u = new URL(url); } catch (e) { return { kind: 'refuse', word: 'bad-request' }; }
  if (u.origin !== ORIGIN) return { kind: 'refuse', word: 'bad-origin' };
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u.pathname);
  if (!m) return { kind: 'pass' };
  const name = m[1];
  if (name !== 'sage_config_read' && name !== 'sage_store_read') return { kind: 'pass' };   // every other function is passed on untouched
  if (u.search !== '' || u.hash !== '') return { kind: 'refuse', word: 'bad-request' };
  if (typeof bodyText !== 'string' || Buffer.byteLength(bodyText, 'utf8') > MAX_RPC_BODY_BYTES) return { kind: 'refuse', word: 'bad-request' };
  if (name === 'sage_config_read') {
    return bodyText === '' || bodyText === '{}' ? { kind: 'config' } : { kind: 'refuse', word: 'bad-request' };
  }
  let args;
  try { args = JSON.parse(bodyText); } catch (e) { return { kind: 'refuse', word: 'bad-request' }; }
  const keys = isPlain(args) ? Object.keys(args) : [];
  if (keys.length !== 1 || keys[0] !== 'p_store' || typeof args.p_store !== 'string') return { kind: 'refuse', word: 'bad-request' };
  if (!ALLOWED_STORES.includes(args.p_store)) return { kind: 'refuse', word: 'store-not-allowed' };
  return { kind: 'store', id: args.p_store };
}

/* ---- one bounded read of the backing app_data rows ----
   { key } reads one row (eq filter); { list: true } reads the table as the mock serves it. The reply must be HTTP 200 from this exact origin with no redirect, within the
   size cap, and an array of rows each with a string key. A missing row is ONLY a successful empty array. */
export async function readBacking(context, query) {
  const u = new URL(`${ORIGIN}/rest/v1/app_data`);
  u.searchParams.set('select', 'key,value,updated_at');
  if (query.key !== undefined) u.searchParams.set('key', `eq.${query.key}`);
  if (u.origin !== ORIGIN) throw new Refusal('bad-origin');
  let res;
  try { res = await context.request.get(u.toString(), { maxRedirects: 0, failOnStatusCode: false, timeout: READ_TIMEOUT_MS }); }
  catch (e) { throw new Refusal('read-error'); }
  const status = res && typeof res.status === 'function' ? res.status() : NaN;
  if (status >= 300 && status < 400) throw new Refusal('read-redirect');
  if (status !== 200) throw new Refusal('read-status');
  if (typeof res.headers === 'function') {
    let declared;
    try { declared = Number(res.headers()['content-length']); } catch (e) { declared = NaN; }
    if (Number.isFinite(declared) && declared > MAX_BACKING_BYTES) throw new Refusal('read-size');
  }
  let buf;
  try { buf = await res.body(); } catch (e) { throw new Refusal('read-error'); }
  if (!buf || typeof buf.length !== 'number') throw new Refusal('read-error');
  if (buf.length > MAX_BACKING_BYTES) throw new Refusal('read-size');
  let rows;
  try { rows = JSON.parse(Buffer.from(buf).toString('utf8')); } catch (e) { throw new Refusal('read-error'); }
  if (!Array.isArray(rows)) throw new Refusal('read-shape');
  if (query.list) { if (rows.length > MAX_LIST_ROWS) throw new Refusal('read-size'); }
  else if (rows.length > 1) throw new Refusal('read-shape');                          // more than one row for one key: never pick one
  const seen = new Set();
  for (const r of rows) {
    if (!isPlain(r) || typeof r.key !== 'string' || seen.has(r.key)) throw new Refusal('read-shape');   // malformed, or a duplicated identity
    seen.add(r.key);
  }
  if (query.key !== undefined && rows.length === 1 && rows[0].key !== query.key) throw new Refusal('read-shape');
  return rows;
}

/* ---- the script's own callback, run against a route that offers only what it uses ---- */
function legacyUrl(filter) {
  const u = new URL(`${ORIGIN}/rest/v1/app_data`);
  u.searchParams.set('select', 'key,value,updated_at');
  u.searchParams.set('key', filter);
  return u.toString();
}

async function runLegacy(appDataRoute, requestUrl, serve) {
  /* The callback decides `second` from the URL and sends the first store's rows for it; this is its own rule, restated only so the one fetch it may make can be checked. */
  const second = requestUrl.includes(SECOND_STORE);
  const expectedFetchUrl = second ? requestUrl.replaceAll(SECOND_STORE, BASE_STORE) : requestUrl;
  let fetched = 0, fulfilled = 0, input, output;
  const offered = {
    request: () => ({ url: () => requestUrl }),
    fetch: async (opts) => {
      if (!isPlain(opts) || Object.keys(opts).length !== 1 || opts.url !== expectedFetchUrl || fetched++ > 0) throw new CapabilityError('fetch');
      input = await serve();
      return { json: async () => input };
    },
    fulfill: async (opts) => {
      if (!isPlain(opts) || Object.keys(opts).length !== 2 || !('response' in opts) || !('json' in opts) || fulfilled++ > 0) throw new CapabilityError('fulfill');
      output = opts.json;
    },
  };
  const refuse = (what) => () => { throw new CapabilityError(what); };
  const route = new Proxy(offered, {
    get(target, prop) {
      if (prop === 'request' || prop === 'fetch' || prop === 'fulfill') return target[prop];
      throw new CapabilityError('get');
    },
    has: refuse('has'), set: refuse('set'), deleteProperty: refuse('delete'), defineProperty: refuse('define'),
    ownKeys: refuse('keys'), getOwnPropertyDescriptor: refuse('descriptor'), getPrototypeOf: refuse('prototype'),
  });
  try { await appDataRoute(route); }
  catch (e) { throw e instanceof Refusal ? e : new CapabilityError('callback'); }
  if (fetched !== 1 || fulfilled !== 1) throw new CapabilityError('count');
  if (!Array.isArray(input) || !Array.isArray(output) || output.length !== input.length) throw new Refusal('read-shape');
  return output;
}

const rowOk = (r, key) => isPlain(r) && r.key === key && isPlain(r.value)
  && (r.updated_at === undefined || r.updated_at === null || typeof r.updated_at === 'string');

/* The rows the script's callback is about to rewrite are checked FIRST, exactly as the backing store served them. The second store's rewrite spreads a row's value into a new
   object, which would turn an array or a string into a plain object with numbered keys and let it pass every check that comes after; so a selected row whose value is not an
   object is refused before the callback is given anything. The callback itself is not touched. */
function rawOne(rows, key) {
  if (rows.length === 1 && !rowOk(rows[0], key)) throw new Refusal('read-shape');
  return rows;
}
const BASE_ACT_PREFIX = `lpc:store:${BASE_STORE}:act:`;
const BASE_ACT_EXACT = new RegExp(`^lpc:store:${BASE_STORE}:act:(\\d{4}-\\d{2}-\\d{2})$`);
function rawActivity(rows) {
  const days = new Set();
  for (const r of rows) {
    if (!r.key.startsWith(BASE_ACT_PREFIX)) continue;
    const m = BASE_ACT_EXACT.exec(r.key);
    if (!m || !validDay(m[1]) || !isPlain(r.value) || days.has(m[1])) throw new Refusal('read-shape');
    days.add(m[1]);
  }
  return rows;
}

/* config: always { value }, null inside when there is no row (the SQL builds { value: v } either way). */
async function answerConfig(context, appDataRoute) {
  const out = await runLegacy(appDataRoute, legacyUrl(`eq.${CONFIG_KEY}`), async () => rawOne(await readBacking(context, { key: CONFIG_KEY }), CONFIG_KEY));
  if (out.length === 0) return { value: null };
  if (!rowOk(out[0], CONFIG_KEY)) throw new Refusal('read-shape');
  return { value: out[0].value };
}

/* The activity is read from the same callback, over the listing, and kept only for rows whose TRANSFORMED key is exactly this store's act key for a real calendar day.
   A key that starts like one but is not, a malformed row, or two rows for one day refuses the whole answer; nothing is picked. */
function collectActivity(rows, id) {
  const prefix = `lpc:store:${id}:act:`;
  const exact = new RegExp(`^lpc:store:${id}:act:(\\d{4}-\\d{2}-\\d{2})$`);
  const days = {};
  for (const r of rows) {
    if (!isPlain(r) || typeof r.key !== 'string') throw new Refusal('read-shape');
    if (!r.key.startsWith(prefix)) continue;
    const m = exact.exec(r.key);
    if (!m || !validDay(m[1]) || !isPlain(r.value) || Object.prototype.hasOwnProperty.call(days, m[1])) throw new Refusal('read-shape');
    days[m[1]] = r.value;
  }
  return days;
}

/* store: null when there is no row (the SQL returns NULL), else { value, updated_at, activity }. */
async function answerStore(context, appDataRoute, id) {
  const one = await runLegacy(appDataRoute, legacyUrl(`eq.${storeKey(id)}`), async () => rawOne(await readBacking(context, { key: storeKey(BASE_STORE) }), storeKey(BASE_STORE)));
  if (one.length === 0) return null;
  if (!rowOk(one[0], storeKey(id))) throw new Refusal('read-shape');
  const listing = await runLegacy(appDataRoute, legacyUrl(`like.lpc:store:${id}:act:*`), async () => rawActivity(await readBacking(context, { list: true })));
  return { value: one[0].value, updated_at: one[0].updated_at ?? null, activity: collectActivity(listing, id) };
}

/* The mock's own CORS headers ride on a real reply: route.fetch re-sends the intercepted POST to the mock (a real POST, not a GET), no redirects, explicit timeout; then the answer takes its place. */
async function respond(route, json) {
  let response;
  try { response = await route.fetch({ maxRedirects: 0, timeout: READ_TIMEOUT_MS }); } catch (e) { throw new Refusal('header-error'); }
  const status = response && typeof response.status === 'function' ? response.status() : NaN;
  if (status >= 300 && status < 400) throw new Refusal('header-redirect');
  if (status !== 200) throw new Refusal('header-status');
  try { await route.fulfill({ response, status: 200, json }); } catch (e) { throw new Refusal('respond-error'); }
}

async function handle(route, context, appDataRoute) {
  const req = route.request();
  const posted = req.postData();
  const parsed = parseRpcRequest({ method: req.method(), url: req.url(), bodyText: posted === null || posted === undefined ? '' : posted });
  if (parsed.kind === 'pass') return route.fallback();
  if (parsed.kind === 'refuse') throw new Refusal(parsed.word);
  const answer = parsed.kind === 'config' ? await answerConfig(context, appDataRoute) : await answerStore(context, appDataRoute, parsed.id);
  return respond(route, answer);
}

/* Registers the RPC route. `appDataRoute` is the script's own app_data callback, the same function it registered for the table route.
   The returned controller keeps the latch for the whole run: any refusal, and any request still unfinished, fails assertNoRefusals(), whenever it happened. */
export async function installRpcAdapter(context, { appDataRoute, log = (line) => console.error(line) } = {}) {
  if (!context || typeof context.route !== 'function' || !context.request || typeof context.request.get !== 'function') {
    throw new TypeError('rpc fixture: a browser context with route and request is required');
  }
  if (typeof appDataRoute !== 'function') throw new TypeError('rpc fixture: the script\'s app_data callback is required');
  const counts = Object.fromEntries(WORDS.map((w) => [w, 0]));
  let inflight = 0;
  const latch = (word) => {
    const w = WORDS.includes(word) ? word : 'handler-error';
    counts[w] = Math.min(counts[w] + 1, LATCH_CAP);
    try { log(`rpc-fixture: ${w}`); } catch (e) { /* the count above is the record */ }
  };
  await context.route(`${ORIGIN}/rest/v1/rpc/*`, async (route) => {
    inflight++;
    try { await handle(route, context, appDataRoute); }
    catch (e) {
      latch(e instanceof Refusal ? e.word : 'handler-error');
      try { await route.abort('failed'); } catch (e2) { latch('respond-error'); }
    } finally { inflight--; }
  });
  const refusals = () => ({ total: WORDS.reduce((n, w) => n + counts[w], 0), counts: { ...counts }, inflight });
  return {
    refusals,
    /* Called once, after the script's cleanup and before any success message. It counts everything since the route was installed, including a refusal during screenshots,
       context or browser cleanup, and it fails a request that has not settled; nothing is excused by when it happened. */
    assertNoRefusals() {
      const r = refusals();
      if (r.total > 0 || r.inflight > 0) {
        const parts = WORDS.filter((w) => r.counts[w] > 0).map((w) => `${w}=${r.counts[w]}`);
        if (r.inflight > 0) parts.push(`unsettled=${r.inflight}`);
        throw new Error(`rpc fixture refused or left unsettled ${r.total + r.inflight} request(s): ${parts.join(', ')}`);
      }
    },
  };
}

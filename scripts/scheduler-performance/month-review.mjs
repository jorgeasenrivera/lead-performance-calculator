/**
 * The month review, as one pure provider.
 * -------------------------------------------------------------------------
 * "Reviewed" has always meant: the whole rows of the month, as the planner
 * computes them, are the same as when somebody marked it reviewed. This file
 * makes that definition something the editor and a server can both compute from
 * the same explicit input, without a second copy of the algorithm.
 *
 * It does not review anything itself. It builds a planner from explicit, strictly
 * validated input through the planner's public API (createPlanner, get, rows) and
 * returns the rows that planner returns. Issues, coverage, forecast, eligibility
 * and neighbouring weeks are therefore the planner's own, unchanged.
 *
 * What the rows depend on, all of it carried in the input and nothing assumed:
 *   - the store as the planner started with it (people, rules, history, policy,
 *     timezone, and the teams and memberships that seed team snapshots);
 *   - the current ordered teams and memberships;
 *   - for the month and for every neighbouring month in its Monday to Sunday span,
 *     that month's own draft: its store copy and its overrides. A month with no
 *     draft resolves to the base store with no overrides, as it does today;
 *   - the base assignment for every day of the span, written out, null where
 *     there is none. There is no fallback to a function or a fixture.
 *
 * Fingerprints. `legacyFingerprint` is exactly `JSON.stringify(rows)`, the value the
 * editor has always compared, so nothing existing changes. It depends on the key
 * order of the objects it was built from, so a server cannot rely on it. The
 * `digest` is a new, versioned value (`month-review/1`) over key-sorted rows,
 * hashed by an implementation the caller supplies and this file checks.
 *
 * Nothing here fetches, writes, reads a clock or touches storage.
 */
import { createPlanner, monthDays, validMonth } from "./month-model.mjs";
import { validDate } from "./shift-intervals.mjs";

export const REVIEW_DEFINITION = "month-review/1";

// Every bound is a refusal, not a truncation: input that is too large is an error.
export const LIMITS = Object.freeze({
  people: 500, rules: 200, history: 20000, teams: 200, memberships: 20000,
  holidays: 400, overridesPerMonth: 62, shiftsPerRecord: 64, idsPerRecord: 500,
  string: 2000, key: 200, chars: 4000000, depth: 12, nodes: 600000, work: 4000000,
});

export class ReviewInputError extends Error {
  constructor(code, detail) {
    super(`Month review input refused: ${code}${detail ? ` (${detail})` : ""}.`);
    this.name = "ReviewInputError";
    this.code = code;
  }
}
const refuse = (code, detail) => { throw new ReviewInputError(code, detail); };

/* ------------------------------------------------------------------ the span */

const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const dow = (day) => new Date(day + "T12:00:00Z").getUTCDay();
const add = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// The complete Monday to Sunday weeks that cover a month, which is what the planner reads.
export function reviewSpan(month) {
  // The planner's own range, so a month it cannot hold is refused here by name.
  if (!validMonth(month)) refuse("scope", "month");
  const days = monthDays(month);
  const from = add(days[0], -((dow(days[0]) + 6) % 7));
  const to = add(days.at(-1), 6 - ((dow(days.at(-1)) + 6) % 7));
  const all = [];
  for (let d = from; d <= to; d = add(d, 1)) all.push(d);
  return Object.freeze({ from, to, days: Object.freeze(all), months: Object.freeze([...new Set(all.map((d) => d.slice(0, 7)))]) });
}

/* ---------------------------------------------------------------- validation */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Plain JSON only, bounded in depth and size, copied and frozen. Anything else is refused.
function frozenJson(value, where) {
  let nodes = 0, chars = 0;
  const text = (str, path) => {
    if (str.length > LIMITS.string) refuse("string too long", path);
    chars += str.length;
    if (chars > LIMITS.chars) refuse("too large", where);
    return str;
  };
  const walk = (v, depth, path) => {
    if (++nodes > LIMITS.nodes) refuse("too large", where);
    if (depth > LIMITS.depth) refuse("too deep", path);
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") { if (!Number.isFinite(v)) refuse("not finite", path); return v; }
    if (typeof v === "string") return text(v, path);
    if (Array.isArray(v)) {
      // Only a plain, dense array with no other properties. The length is checked before any
      // element is touched, so a huge sparse array is refused at once, not after it is walked.
      if (Object.getPrototypeOf(v) !== Array.prototype) refuse("not plain", path);
      if (v.length > LIMITS.nodes - nodes) refuse("too large", path);
      if (Object.keys(v).length !== v.length) refuse("not a plain array", path);
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const desc = Object.getOwnPropertyDescriptor(v, i);
        if (!desc || !("value" in desc)) refuse("not a plain array", `${path}[${i}]`);
        out.push(walk(desc.value, depth + 1, `${path}[${i}]`));
      }
      return Object.freeze(out);
    }
    if (typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) refuse("not plain", path);
      const out = {};
      for (const key of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(key)) refuse("forbidden key", `${path}.${key}`);
        if (key.length > LIMITS.key) refuse("key too long", path);
        text(key, path);
        const desc = Object.getOwnPropertyDescriptor(v, key);
        if (!("value" in desc)) refuse("accessor", `${path}.${key}`);
        out[key] = walk(desc.value, depth + 1, `${path}.${key}`);
      }
      return Object.freeze(out);
    }
    return refuse("not JSON", `${path} (${typeof v})`);
  };
  return walk(value, 0, where);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const need = (cond, code, detail) => { if (!cond) refuse(code, detail); };
const keysOnly = (obj, allowed, required, where) => {
  need(isObj(obj), "shape", where);
  for (const k of Object.keys(obj)) need(allowed.includes(k), "unknown key", `${where}.${k}`);
  for (const k of required) need(Object.hasOwn(obj, k), "missing", `${where}.${k}`);
};
const num = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const isDay = (v) => typeof v === "string" && validDate(v);
const stringArray = (v, max, where) => { need(Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string"), "shape", where); };

function validateTeams(teams, where) {
  need(Array.isArray(teams) && teams.length <= LIMITS.teams, "shape", `${where}.teams`);
  teams.forEach((t, i) => { keysOnly(t, ["id", "name"], ["id", "name"], `${where}.teams[${i}]`); need(typeof t.id === "string" && typeof t.name === "string", "shape", `${where}.teams[${i}]`); });
}
function validateMemberships(memberships, where) {
  need(Array.isArray(memberships) && memberships.length <= LIMITS.memberships, "shape", `${where}.memberships`);
  memberships.forEach((m, i) => {
    const w = `${where}.memberships[${i}]`;
    keysOnly(m, ["storeId", "personId", "teamIds", "from", "to", "source", "unknown"], ["storeId", "personId", "teamIds", "from", "to"], w);
    need(typeof m.storeId === "string" && typeof m.personId === "string" && isDay(m.from) && isDay(m.to), "shape", w);
    stringArray(m.teamIds, LIMITS.teams, `${w}.teamIds`);
    if (Object.hasOwn(m, "unknown")) need(typeof m.unknown === "boolean", "shape", `${w}.unknown`);
    if (Object.hasOwn(m, "source")) need(isObj(m.source), "shape", `${w}.source`);
  });
}

function validateStore(store, storeId, where, { timezoneOptional }) {
  keysOnly(store, ["id", "name", "timezone", "people", "rules", "history", "planningPolicy", "teams", "memberships"],
    ["id", "people", "rules", "history", "teams", "memberships"], where);
  need(store.id === storeId, "scope", `${where}.id does not match the scope store`);
  if (Object.hasOwn(store, "name")) need(typeof store.name === "string", "shape", `${where}.name`);
  if (Object.hasOwn(store, "timezone")) need(typeof store.timezone === "string" && store.timezone.length <= 64, "shape", `${where}.timezone`);
  else need(timezoneOptional, "missing", `${where}.timezone`);

  need(Array.isArray(store.people) && store.people.length <= LIMITS.people, "shape", `${where}.people`);
  const ids = new Set();
  store.people.forEach((p, i) => {
    const w = `${where}.people[${i}]`;
    keysOnly(p, ["id", "name", "off", "start", "end", "maxHours", "teamIds"], ["id", "name", "off", "start", "end", "maxHours"], w);
    if (Object.hasOwn(p, "teamIds")) stringArray(p.teamIds, LIMITS.teams, `${w}.teamIds`);
    need(typeof p.id === "string" && p.id && !ids.has(p.id) && typeof p.name === "string", "shape", w);
    ids.add(p.id);
    // Unknown availability is carried as null, never filled in.
    need(p.off === null || (Array.isArray(p.off) && p.off.length <= 7 && p.off.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)), "shape", `${w}.off`);
    need(numOrNull(p.start) && numOrNull(p.end) && numOrNull(p.maxHours), "shape", w);
  });

  need(Array.isArray(store.rules) && store.rules.length <= LIMITS.rules, "shape", `${where}.rules`);
  store.rules.forEach((r, i) => {
    const w = `${where}.rules[${i}]`;
    keysOnly(r, ["effective", "open", "close", "minimum", "useCapacity", "capacity", "closedDays", "holidays"], ["effective", "closedDays", "holidays"], w);
    need(isDay(r.effective), "shape", `${w}.effective`);
    for (const k of ["open", "close", "minimum", "capacity"]) if (Object.hasOwn(r, k)) need(numOrNull(r[k]), "shape", `${w}.${k}`);
    if (Object.hasOwn(r, "useCapacity")) need(typeof r.useCapacity === "boolean", "shape", `${w}.useCapacity`);
    need(Array.isArray(r.closedDays) && r.closedDays.length <= 7 && r.closedDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), "shape", `${w}.closedDays`);
    need(isObj(r.holidays) && Object.keys(r.holidays).length <= LIMITS.holidays && Object.entries(r.holidays).every(([d, s]) => isDay(d) && typeof s === "string" && s.length <= 20), "shape", `${w}.holidays`);
  });

  need(Array.isArray(store.history) && store.history.length <= LIMITS.history, "shape", `${where}.history`);
  store.history.forEach((h, i) => {
    const w = `${where}.history[${i}]`;
    keysOnly(h, ["day", "state", "units"], ["day", "state", "units"], w);
    need(isDay(h.day) && ["known", "unknown", "closed"].includes(h.state) && numOrNull(h.units), "shape", w);
  });

  if (Object.hasOwn(store, "planningPolicy") && store.planningPolicy !== null) {
    const p = store.planningPolicy;
    keysOnly(p, ["people", "requiredRoles"], ["people", "requiredRoles"], `${where}.planningPolicy`);
    need(isObj(p.people) && Object.keys(p.people).length <= LIMITS.people, "shape", `${where}.planningPolicy.people`);
    for (const [id, entry] of Object.entries(p.people)) {
      keysOnly(entry, ["eligible", "roles"], [], `${where}.planningPolicy.people.${id}`);
      if (Object.hasOwn(entry, "eligible")) need(typeof entry.eligible === "boolean", "shape", `${where}.planningPolicy.people.${id}.eligible`);
      if (Object.hasOwn(entry, "roles")) stringArray(entry.roles, 50, `${where}.planningPolicy.people.${id}.roles`);
    }
    need(isObj(p.requiredRoles) && Object.values(p.requiredRoles).every(Number.isFinite), "shape", `${where}.planningPolicy.requiredRoles`);
  }
  validateTeams(store.teams, where);
  validateMemberships(store.memberships, where);
}

const RECORD_KEYS = ["on", "off", "shifts", "teamSnapshot", "absences", "unknownNotes", "generation", "generationLocks"];
const SHIFT_KEYS = ["storeId", "personId", "date", "endDate", "startMinute", "endMinute", "timezone", "role", "source", "teamIds", "teamSource"];
// A day's record is the planner's own value. Every key is named, and each key the planner reads
// has the type it reads: an unknown key or a wrong type is refused here, not left to fail inside the planner.
function validateRecord(record, where) {
  if (Array.isArray(record)) { stringArray(record, LIMITS.idsPerRecord, where); return; }
  keysOnly(record, RECORD_KEYS, [], where);
  for (const k of ["on", "off", "generationLocks"]) if (Object.hasOwn(record, k)) stringArray(record[k], LIMITS.idsPerRecord, `${where}.${k}`);
  if (Object.hasOwn(record, "shifts")) {
    need(Array.isArray(record.shifts) && record.shifts.length <= LIMITS.shiftsPerRecord, "shape", `${where}.shifts`);
    record.shifts.forEach((s, i) => {
      const w = `${where}.shifts[${i}]`;
      keysOnly(s, SHIFT_KEYS, ["personId"], w);
      for (const k of ["storeId", "personId", "date", "endDate", "timezone", "role"]) if (Object.hasOwn(s, k)) need(typeof s[k] === "string", "shape", `${w}.${k}`);
      // An imported shift with a time that could not be read carries null, and the planner reports it as an issue.
      for (const k of ["startMinute", "endMinute"]) if (Object.hasOwn(s, k)) need(s[k] === null || num(s[k]), "shape", `${w}.${k}`);
      if (Object.hasOwn(s, "teamIds")) stringArray(s.teamIds, LIMITS.teams, `${w}.teamIds`);
      if (Object.hasOwn(s, "teamSource")) need(isObj(s.teamSource), "shape", `${w}.teamSource`);
      if (Object.hasOwn(s, "source")) need(isObj(s.source), "shape", `${w}.source`);
    });
  }
  for (const k of ["teamSnapshot", "absences", "unknownNotes"]) {
    if (!Object.hasOwn(record, k)) continue;
    need(isObj(record[k]) && Object.keys(record[k]).length <= LIMITS.idsPerRecord && Object.values(record[k]).every(isObj), "shape", `${where}.${k}`);
  }
  if (Object.hasOwn(record, "generation")) {
    const g = record.generation;
    keysOnly(g, ["unlocked", "signatures"], [], `${where}.generation`);
    if (Object.hasOwn(g, "unlocked")) stringArray(g.unlocked, LIMITS.idsPerRecord, `${where}.generation.unlocked`);
    if (Object.hasOwn(g, "signatures")) need(isObj(g.signatures) && Object.values(g.signatures).every((x) => typeof x === "string"), "shape", `${where}.generation.signatures`);
  }
}

// Time is bounded as well as size: the planner looks up memberships once per assigned person per day.
function boundWork(input) {
  const count = (r) => (r === null ? 0 : Array.isArray(r) ? r.length : (r.on?.length || 0) + (r.off?.length || 0) + (r.shifts?.length || 0));
  let ids = 0;
  for (const r of Object.values(input.base)) ids += count(r);
  for (const d of Object.values(input.months)) for (const r of Object.values(d.overrides)) ids += count(r);
  const memberships = Math.max(input.baseStore.memberships.length, input.teamState.memberships.length,
    ...Object.values(input.months).map((d) => d.store.memberships.length));
  need(ids * Math.max(memberships, 1) <= LIMITS.work, "too much work", `${ids} assignments against ${memberships} memberships`);
}

/**
 * Check and freeze a review input. Returns an immutable copy or throws ReviewInputError.
 * Missing context is an error, never a default: every span day, every needed month,
 * and the teams and memberships must be present.
 */
export function validateReviewInput(raw) {
  const input = frozenJson(raw, "input");
  keysOnly(input, ["definition", "scope", "baseStore", "teamState", "months", "base"], ["definition", "scope", "baseStore", "teamState", "months", "base"], "input");
  need(input.definition === REVIEW_DEFINITION, "definition", String(input.definition));
  keysOnly(input.scope, ["storeId", "month"], ["storeId", "month"], "scope");
  need(typeof input.scope.storeId === "string" && STORE_ID.test(input.scope.storeId), "scope", "storeId");
  const span = reviewSpan(input.scope.month);

  validateStore(input.baseStore, input.scope.storeId, "baseStore", { timezoneOptional: true });
  keysOnly(input.teamState, ["teams", "memberships"], ["teams", "memberships"], "teamState");
  validateTeams(input.teamState.teams, "teamState");
  validateMemberships(input.teamState.memberships, "teamState");

  need(isObj(input.months), "shape", "months");
  need(Object.hasOwn(input.months, input.scope.month), "missing", `months.${input.scope.month} (the scope month's own draft)`);
  for (const [month, draft] of Object.entries(input.months)) {
    need(validMonth(month), "scope", `months.${month} is not a month the planner can hold`);
    need(span.months.includes(month), "unknown key", `months.${month} is outside the span`);
    keysOnly(draft, ["store", "overrides"], ["store", "overrides"], `months.${month}`);
    validateStore(draft.store, input.scope.storeId, `months.${month}.store`, { timezoneOptional: false });
    need(isObj(draft.overrides) && Object.keys(draft.overrides).length <= LIMITS.overridesPerMonth, "shape", `months.${month}.overrides`);
    for (const [day, record] of Object.entries(draft.overrides)) {
      need(isDay(day) && day.startsWith(month + "-"), "shape", `months.${month}.overrides.${day}`);
      validateRecord(record, `months.${month}.overrides.${day}`);
    }
  }

  need(isObj(input.base), "shape", "base");
  const baseDays = Object.keys(input.base);
  for (const day of baseDays) need(span.days.includes(day), "unknown key", `base.${day} is outside the span`);
  for (const day of span.days) need(Object.hasOwn(input.base, day), "missing", `base.${day} (every span day needs an explicit entry, null if none)`);
  for (const day of span.days) if (input.base[day] !== null) validateRecord(input.base[day], `base.${day}`);
  boundWork(input);
  return input;
}

/* ------------------------------------------------------------------ hydrate */

// A planner built only from the input, through the public API. Nothing is inherited.
export function hydrateReviewPlanner(validInput) {
  const v = validInput;
  const planner = createPlanner([structuredClone(v.baseStore)], {
    assignmentForDay: (day) => (v.base[day] === undefined || v.base[day] === null ? null : structuredClone(v.base[day])),
  });
  planner.teamState[0] = structuredClone(v.teamState);
  for (const [month, d] of Object.entries(v.months)) {
    const draft = planner.get(0, month);
    draft.store = structuredClone(d.store);
    draft.overrides = structuredClone(d.overrides);
  }
  return planner;
}

/* ------------------------------------------------------------- serialization */

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
};
// Key order cannot change what this string says; array order always does.
export const canonicalJson = (value) => JSON.stringify(sortKeys(value));

const VECTORS = Object.freeze([
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["Jos\u00e9", "24c2ab65b7adab7e070ba05a00a3f3ae074e28b8bcdd59735b7107e7a538a551"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ["a".repeat(1000), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"],
  ["b".repeat(55), "eb2c86e932179f4ba13fe8715a26124b77d6bad290b9b4c1cc140cf633300c19"], ["b".repeat(56), "a5fc6e203a4c2b657d0d153885932414b2ffc6a93f0f8bf8b3183315e5a7212c"], ["b".repeat(64), "a0fab1377f49a759b57f63318262ebe89fabfc990e8e93ceac2984561482b9d4"],
  ["\u20acuro \u20ac", "2e081e9a5a8e37543db37255db9f09463f1e03150f04b0c28ef56c4c7377db15"],
]);
const HEX = /^[0-9a-f]{64}$/;
// The hash is the caller's, because this file has none of its own. It is checked against known answers
// (short, long, non-ASCII, and either side of the block boundaries), and every answer it gives later
// must be 64 lowercase hex and the same on a second ask.
function trusted(sha256) {
  if (typeof sha256 !== "function") refuse("hash", "a sha256 implementation is required");
  // A hash that throws is the caller's fault and is reported the same way as a wrong one.
  const ask = (text) => { try { return sha256(text); } catch { refuse("hash", "the supplied sha256 threw"); } };
  for (const [text, want] of VECTORS) if (ask(text) !== want) refuse("hash", "the supplied sha256 gave a wrong answer");
  return (text) => {
    const a = ask(text);
    if (typeof a !== "string" || !HEX.test(a) || ask(text) !== a) refuse("hash", "the supplied sha256 gave an unusable or unstable answer");
    return a;
  };
}

const deepFreeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };

/**
 * The review of one month, recomputed from the input alone.
 * `sha256` is optional; without it the digests are null and everything else is returned.
 */
export function reviewMonth(raw, { sha256 } = {}) {
  const input = validateReviewInput(raw);
  const hash = sha256 === undefined ? null : trusted(sha256);
  const { month } = input.scope;
  const span = reviewSpan(month);
  let rows;
  try { rows = hydrateReviewPlanner(input).rows(0, month); }
  catch (e) { if (e instanceof ReviewInputError) throw e; refuse("planner", String(e && e.message).slice(0, 120)); }
  const openIssues = rows.reduce((n, r) => n + r.issues.length, 0);
  const canonical = canonicalJson({ definition: REVIEW_DEFINITION, scope: input.scope, span: { from: span.from, to: span.to }, rows });
  return deepFreeze({
    definition: REVIEW_DEFINITION,
    scope: input.scope,
    span: { from: span.from, to: span.to },
    rows,
    openIssues,
    legacyFingerprint: JSON.stringify(rows),
    canonical,
    digest: hash ? hash(canonical) : null,
    inputDigest: hash ? hash(canonicalJson(input)) : null,
  });
}

/**
 * Does a client's claim match what the provider recomputes from the same input?
 * The claim carries only a definition and a digest. A claim that brings its own
 * rows, issue count or fingerprint is refused: only recomputed values count.
 */
export function verifyReview(raw, claim, { sha256 } = {}) {
  if (!isObj(claim) || Object.keys(claim).some((k) => !["definition", "digest"].includes(k))) return { ok: false, reason: "claim" };
  if (claim.definition !== REVIEW_DEFINITION) return { ok: false, reason: "definition" };
  if (typeof claim.digest !== "string" || !/^[0-9a-f]{64}$/.test(claim.digest)) return { ok: false, reason: "claim" };
  let review;
  try { review = reviewMonth(raw, { sha256: trusted(sha256) }); }
  catch (e) { if (e instanceof ReviewInputError) return { ok: false, reason: e.code }; throw e; }
  // The rows stay with the caller that holds the input; a match says only that, and how many issues.
  return review.digest === claim.digest ? { ok: true, digest: review.digest, openIssues: review.openIssues } : { ok: false, reason: "digest" };
}

/* ------------------------------------------------------------------- export */

/**
 * The input for a live planner, for the editor to hand to the provider.
 * `stores` and `assignmentForDay` are what the planner was created with, and `stores[index]` must
 * be the object it was given, unchanged. The base store must carry its teams and memberships
 * explicitly: with none, the planner would seed its own placeholders, and a review built on
 * those is refused here. Like `rows()`, this creates the month's draft if there is none yet.
 */
export function exportReviewInput({ planner, stores, index = 0, storeId, month, assignmentForDay }) {
  need(planner && typeof planner.get === "function" && planner.drafts instanceof Map, "shape", "planner");
  need(Array.isArray(stores) && stores[index], "missing", "stores[index]");
  need(typeof assignmentForDay === "function", "missing", "assignmentForDay");
  const base = stores[index];
  need(Array.isArray(base.teams) && Array.isArray(base.memberships), "missing", "baseStore.teams and memberships must be explicit");
  const span = reviewSpan(month);
  planner.get(index, month);
  const months = {};
  for (const m of span.months) {
    const draft = planner.drafts.get(`${index}:${m}`);
    if (draft) months[m] = { store: draft.store, overrides: draft.overrides };
  }
  const baseByDay = {};
  for (const day of span.days) {
    // The planner reads any falsy answer as "no assignment", so the input says null for it.
    const value = assignmentForDay(day, index);
    baseByDay[day] = value ? value : null;
  }
  const exported = validateReviewInput({
    definition: REVIEW_DEFINITION,
    scope: { storeId, month },
    baseStore: base,
    teamState: planner.teamState[index],
    months,
    base: baseByDay,
  });
  // The export proves itself: rebuilt from the input, the planner must give the live planner's exact
  // rows. State the input cannot carry (a base store changed after the planner was made, for one)
  // shows up here as a refusal instead of a review that quietly differs.
  need(reviewMonth(exported).legacyFingerprint === JSON.stringify(planner.rows(index, month)), "parity", "the rebuilt planner does not match the live planner");
  return exported;
}

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
import { createPlanner, monthDays } from "./month-model.mjs";
import { validDate } from "./shift-intervals.mjs";

export const REVIEW_DEFINITION = "month-review/1";

// Every bound is a refusal, not a truncation: input that is too large is an error.
export const LIMITS = Object.freeze({
  people: 500, rules: 200, history: 20000, teams: 200, memberships: 20000,
  holidays: 400, overridesPerMonth: 62, shiftsPerRecord: 64, idsPerRecord: 1000,
  string: 2000, depth: 12, nodes: 600000,
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

const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
const STORE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const dow = (day) => new Date(day + "T12:00:00Z").getUTCDay();
const add = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// The complete Monday to Sunday weeks that cover a month, which is what the planner reads.
export function reviewSpan(month) {
  if (typeof month !== "string" || !MONTH.test(month)) refuse("scope", "month");
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
  let nodes = 0;
  const walk = (v, depth, path) => {
    if (++nodes > LIMITS.nodes) refuse("too large", where);
    if (depth > LIMITS.depth) refuse("too deep", path);
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") { if (!Number.isFinite(v)) refuse("not finite", path); return v; }
    if (typeof v === "string") { if (v.length > LIMITS.string) refuse("string too long", path); return v; }
    if (Array.isArray(v)) return Object.freeze(v.map((x, i) => walk(x, depth + 1, `${path}[${i}]`)));
    if (typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) refuse("not plain", path);
      const out = {};
      for (const key of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(key)) refuse("forbidden key", `${path}.${key}`);
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
    keysOnly(p, ["id", "name", "off", "start", "end", "maxHours"], ["id", "name", "off", "start", "end", "maxHours"], w);
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

// A day's record is the planner's own value. Its known parts are checked and the rest is bounded JSON.
function validateRecord(record, where) {
  if (Array.isArray(record)) { stringArray(record, LIMITS.idsPerRecord, where); return; }
  need(isObj(record), "shape", where);
  for (const k of ["on", "off"]) if (Object.hasOwn(record, k)) stringArray(record[k], LIMITS.idsPerRecord, `${where}.${k}`);
  if (Object.hasOwn(record, "shifts")) {
    need(Array.isArray(record.shifts) && record.shifts.length <= LIMITS.shiftsPerRecord && record.shifts.every(isObj), "shape", `${where}.shifts`);
  }
  for (const k of ["teamSnapshot", "absences", "unknownNotes"]) if (Object.hasOwn(record, k)) need(isObj(record[k]), "shape", `${where}.${k}`);
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

const VECTORS = Object.freeze([["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]]);
// The hash is the caller's, because this file has none of its own. It is checked against known answers every time.
function trusted(sha256) {
  if (typeof sha256 !== "function") refuse("hash", "a sha256 implementation is required");
  for (const [text, want] of VECTORS) if (sha256(text) !== want) refuse("hash", "the supplied sha256 gave a wrong answer");
  return sha256;
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
  const rows = hydrateReviewPlanner(input).rows(0, month);
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
  return review.digest === claim.digest ? { ok: true, review } : { ok: false, reason: "digest" };
}

/* ------------------------------------------------------------------- export */

/**
 * The input for a live planner, for the editor to hand to the provider.
 * `stores` and `assignmentForDay` are what the planner was created with. The base
 * store must carry its teams and memberships explicitly: with none, the planner
 * would seed its own placeholders, and a review built on those is refused here.
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
    const value = assignmentForDay(day, index);
    baseByDay[day] = value === undefined ? null : value;
  }
  return validateReviewInput({
    definition: REVIEW_DEFINITION,
    scope: { storeId, month },
    baseStore: base,
    teamState: planner.teamState[index],
    months,
    base: baseByDay,
  });
}

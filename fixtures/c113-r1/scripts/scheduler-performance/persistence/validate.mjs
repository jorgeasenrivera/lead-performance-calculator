// Structural validation of a month draft before it is written and after it is
// read. The model checks people, rules and shifts when it displays them and
// turns a bad value into "unknown"; a stored copy has to be refused instead,
// because nobody is looking at it when it is read back.
//
// Only structure and references are checked here. Business conflicts (a shift
// outside availability, weekly hours over the cap, overlapping shifts, too few
// people) stay with the model, which already reports them to the manager and
// which this module must not duplicate. Likewise DST-change dates: the model
// flags them on read, and this module does not rebuild its time zone logic.
//
// Pure: results are data. No clock, no storage, no imports from the model.
import { validStoreId, validMonth, validDate } from './identity.mjs';

// Two nesting limits, on purpose. `jsonDepth` bounds a whole draft (and the small
// objects inside meta, audit detail and membership sources), counted from that
// value's own root. `canonicalDepth` bounds anything the canonical writer or a
// snapshot is asked to copy by default, which includes the envelope around a
// draft. A draft inside an envelope sits one level deeper, so 8 + 1 stays well
// inside 12. In both, the root is level 0 and a value deeper than the limit is
// refused: 8 levels of objects below a draft root are accepted and a ninth is not.
export const LIMITS = Object.freeze({
  people: 100, rules: 200, holidays: 400, teams: 100, memberships: 1000,
  shiftsPerDay: 200, idsPerDay: 200, days: 31, jsonDepth: 8, canonicalDepth: 12, nodes: 250000, text: 80, problems: 50,
});
export const STORE_TIMEZONE = 'America/New_York';
// Keys that would rewrite an object's prototype if a map were ever merged.
export const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const PERSON_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const TEAM_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ABSENCE_KINDS = ['off', 'vacation', 'unavailable', 'unknown'];

// THE one gatekeeper for data that will be checked, stored or handed back.
//
// It copies a value into fresh, ordinary objects and arrays and reads every
// property exactly once, as a data property, so what was checked is exactly what
// is kept: no later JSON.stringify can run a toJSON hook, no getter can answer
// differently the second time, and nothing the caller holds is shared with the
// result. Everything that is not plain data is refused rather than interpreted:
//   - prototypes other than Object.prototype, null (objects) or Array.prototype
//   - accessors, hidden (non-enumerable) properties, symbol keys, functions
//   - arrays with holes or with any property that is not an element
//   - undefined, NaN, Infinity, bigint, symbol, Date, Map and class instances
//   - key names that would rewrite a prototype
// -0 is copied as 0, which is how the canonical writer spells it.
// A Proxy is read through its own traps once per property like any other object;
// the guarantee is "validated data equals emitted data", not that a hostile
// Proxy is detectable.
const problem = (path, code, message) => ({ path, code, message });
const INDEX = /^(0|[1-9]\d*)$/;

function copyValue(value, path, depth, state) {
  if (depth > state.maxDepth) throw problem(path, 'too-deep', `Nested more than ${state.maxDepth} levels.`);
  if (++state.nodes > state.maxNodes) throw problem(path, 'too-large', 'Too many values to copy.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw problem(path, 'non-finite', 'Use a finite number.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) throw problem(path, 'undefined-value', 'Leave the key out instead of setting it to undefined.');
  if (typeof value !== 'object') throw problem(path, 'not-plain-json', 'Use plain JSON values only.');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw problem(path, 'not-plain-json', 'Use a plain array.');
    const keys = Reflect.ownKeys(value);
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    let elements = 0;
    for (const key of keys) {
      if (typeof key === 'symbol') throw problem(path, 'symbol-key', 'Symbol keys are not allowed.');
      if (key === 'length') continue;
      if (!INDEX.test(key) || Number(key) >= length) throw problem(`${path}.${key}`, 'array-extra-property', 'An array can hold elements and nothing else.');
      elements++;
    }
    if (elements !== length) throw problem(path, 'sparse-array', 'Arrays cannot have holes.');
    const out = [];
    for (let i = 0; i < length; i++) {
      const at = `${path}[${i}]`, d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d) throw problem(at, 'sparse-array', 'Arrays cannot have holes.');
      if (!('value' in d)) throw problem(at, 'accessor-property', 'Use plain values, not getters.');
      if (!d.enumerable) throw problem(at, 'non-enumerable-property', 'Hidden elements are not allowed.');
      out.push(copyValue(d.value, at, depth + 1, state));
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw problem(path, 'not-plain-json', 'Use a plain object.');
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw problem(path, 'symbol-key', 'Symbol keys are not allowed.');
    const at = `${path}.${key}`;
    if (FORBIDDEN_KEYS.includes(key)) throw problem(at, 'forbidden-key', 'This key name is not allowed.');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!('value' in d)) throw problem(at, 'accessor-property', 'Use plain values, not getters.');
    if (!d.enumerable) throw problem(at, 'non-enumerable-property', 'Hidden properties are not allowed.');
    if (d.value === undefined && state.dropUndefined) continue;
    out[key] = copyValue(d.value, at, depth + 1, state);
  }
  return out;
}

export function plainSnapshot(value, { maxDepth = LIMITS.canonicalDepth, maxNodes = LIMITS.nodes, path = '$', dropUndefined = false } = {}) {
  try { return { ok: true, value: copyValue(value, path, 0, { maxDepth, maxNodes, nodes: 0, dropUndefined }) }; }
  catch (found) {
    if (found && typeof found.code === 'string') return { ok: false, problems: [found] };
    throw found;
  }
}

// Depth of data that is already a snapshot, without copying it again.
export function depthProblem(value, maxDepth, path = '$', depth = 0) {
  if (depth > maxDepth) return problem(path, 'too-deep', `Nested more than ${maxDepth} levels.`);
  if (value === null || typeof value !== 'object') return null;
  for (const [key, child] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    const bad = depthProblem(child, maxDepth, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
    if (bad) return bad;
  }
  return null;
}

// Kept for the small objects (meta, detail, membership sources) that only need a yes or no.
export function plainJsonProblem(value, path = '$', depth = 0) {
  const result = plainSnapshot(value, { maxDepth: LIMITS.jsonDepth - depth, path });
  return result.ok ? null : result.problems[0];
}

function exactKeys(value, required, optional, path, out) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) out.push(problem(`${path}.${key}`, 'missing-key', `Missing ${key}.`));
  for (const key of Object.keys(value)) if (!allowed.has(key)) out.push(problem(`${path}.${key}`, 'unknown-key', `${key} is not a stored field.`));
}
const weekdays = list => Array.isArray(list) && list.every(d => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(list).size === list.length;
const uniqueStrings = (list, ok) => Array.isArray(list) && list.every(ok) && new Set(list).size === list.length;
const nameKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const textOk = (value, max = LIMITS.text) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);

function checkPeople(people, out) {
  const ids = new Set();
  if (!Array.isArray(people) || people.length > LIMITS.people) {
    out.push(problem('store.people', 'people-count', `Use a list of up to ${LIMITS.people} people.`));
    return ids;
  }
  people.forEach((person, i) => {
    const at = `store.people[${i}]`;
    if (!isObject(person)) return out.push(problem(at, 'not-object', 'A person is an object.'));
    exactKeys(person, ['id', 'name', 'start', 'end', 'off', 'maxHours'], ['maxHoursSource', 'teamIds'], at, out);
    if (typeof person.id !== 'string' || !PERSON_ID.test(person.id)) out.push(problem(`${at}.id`, 'bad-person-id', 'Use a person id of letters, digits, . : _ or -.'));
    else if (ids.has(person.id)) out.push(problem(`${at}.id`, 'duplicate-person', 'Two people share an id.'));
    else ids.add(person.id);
    if (!textOk(person.name)) out.push(problem(`${at}.name`, 'bad-name', 'Use a name of 1 to 80 characters.'));
    // null means "not known yet", which the model also reads as unknown.
    for (const key of ['start', 'end']) {
      const v = person[key];
      if (v !== null && !(Number.isFinite(v) && v >= 0 && v <= 24)) out.push(problem(`${at}.${key}`, 'bad-hour', 'Use an hour from 0 to 24, or null if unknown.'));
    }
    if (Number.isFinite(person.start) && Number.isFinite(person.end) && person.end <= person.start) out.push(problem(`${at}.end`, 'bad-availability', 'Availability must end after it starts.'));
    if (person.off !== null && !weekdays(person.off)) out.push(problem(`${at}.off`, 'bad-days-off', 'Days off are unique weekdays from 0 to 6, or null if unknown.'));
    if (person.maxHours !== null && !(Number.isFinite(person.maxHours) && person.maxHours >= 0 && person.maxHours <= 168)) out.push(problem(`${at}.maxHours`, 'bad-max-hours', 'Use weekly hours from 0 to 168, or null if unknown.'));
    if (Object.hasOwn(person, 'maxHoursSource') && !textOk(person.maxHoursSource, 40)) out.push(problem(`${at}.maxHoursSource`, 'bad-source', 'Use a short text.'));
    if (Object.hasOwn(person, 'teamIds') && !uniqueStrings(person.teamIds, id => typeof id === 'string' && TEAM_ID.test(id))) out.push(problem(`${at}.teamIds`, 'bad-team-ids', 'Use a list of team ids.'));
  });
  return ids;
}

function checkRules(rules, out) {
  if (!Array.isArray(rules) || rules.length > LIMITS.rules) return out.push(problem('store.rules', 'rule-count', `Use up to ${LIMITS.rules} dated rules.`));
  const seen = new Set();
  let holidays = 0;
  rules.forEach((rule, i) => {
    const at = `store.rules[${i}]`;
    if (!isObject(rule)) return out.push(problem(at, 'not-object', 'A rule is an object.'));
    exactKeys(rule, ['effective', 'open', 'close', 'minimum', 'capacity', 'useCapacity', 'closedDays', 'holidays'], [], at, out);
    if (!validDate(rule.effective)) out.push(problem(`${at}.effective`, 'bad-date', 'Use a real date, YYYY-MM-DD.'));
    else if (seen.has(rule.effective)) out.push(problem(`${at}.effective`, 'duplicate-rule', 'Two rules take effect on the same date.'));
    else seen.add(rule.effective);
    const hour = v => Number.isFinite(v) && v >= 0 && v <= 24;
    if (!hour(rule.open) || !hour(rule.close)) out.push(problem(`${at}.open`, 'bad-hour', 'Store hours are from 0 to 24.'));
    else if (rule.close <= rule.open) out.push(problem(`${at}.close`, 'bad-hours', 'The store must close after it opens.'));
    if (!Number.isInteger(rule.minimum) || rule.minimum < 1 || rule.minimum > LIMITS.people) out.push(problem(`${at}.minimum`, 'bad-minimum', 'Use a minimum of 1 or more people.'));
    if (!Number.isFinite(rule.capacity) || rule.capacity < 0 || rule.capacity > 1000) out.push(problem(`${at}.capacity`, 'bad-capacity', 'Use a capacity from 0 to 1000.'));
    if (typeof rule.useCapacity !== 'boolean') out.push(problem(`${at}.useCapacity`, 'bad-flag', 'Use true or false.'));
    if (!weekdays(rule.closedDays)) out.push(problem(`${at}.closedDays`, 'bad-closed-days', 'Closed days are unique weekdays from 0 to 6.'));
    if (!isObject(rule.holidays)) return out.push(problem(`${at}.holidays`, 'bad-holidays', 'Holidays are a map of date to state.'));
    for (const [day, state] of Object.entries(rule.holidays)) {
      holidays++;
      if (FORBIDDEN_KEYS.includes(day) || !validDate(day)) out.push(problem(`${at}.holidays.${day}`, 'bad-date', 'Use a real date, YYYY-MM-DD.'));
      else if (validDate(rule.effective) && day < rule.effective) out.push(problem(`${at}.holidays.${day}`, 'holiday-before-effective', 'A special day belongs to the rule in force on that date.'));
      if (!['open', 'closed', 'unknown'].includes(state)) out.push(problem(`${at}.holidays.${day}`, 'bad-state', 'Use open, closed or unknown.'));
    }
  });
  if (holidays > LIMITS.holidays) out.push(problem('store.rules', 'holiday-count', `Use up to ${LIMITS.holidays} special days.`));
}

function checkTeams(teams, memberships, storeId, people, out, warnings) {
  const teamIds = new Set();
  if (!Array.isArray(teams) || teams.length > LIMITS.teams) out.push(problem('store.teams', 'team-count', `Use up to ${LIMITS.teams} teams.`));
  else {
    const names = new Set();
    teams.forEach((team, i) => {
      const at = `store.teams[${i}]`;
      if (!isObject(team)) return out.push(problem(at, 'not-object', 'A team is an object.'));
      exactKeys(team, ['id', 'name'], [], at, out);
      if (typeof team.id !== 'string' || !TEAM_ID.test(team.id)) out.push(problem(`${at}.id`, 'bad-team-id', 'Use a team id of lowercase letters, digits, - or _.'));
      else if (teamIds.has(team.id)) out.push(problem(`${at}.id`, 'duplicate-team', 'Two teams share an id.'));
      else teamIds.add(team.id);
      const key = nameKey(team.name);
      if (!textOk(team.name, 60) || key === 'none' || key.includes('|')) out.push(problem(`${at}.name`, 'bad-team-name', 'Use a team name of up to 60 characters, not "none" and without |.'));
      else if (names.has(key)) out.push(problem(`${at}.name`, 'duplicate-team-name', 'Two teams share a name.'));
      else names.add(key);
    });
  }
  if (!Array.isArray(memberships) || memberships.length > LIMITS.memberships) return out.push(problem('store.memberships', 'membership-count', `Use up to ${LIMITS.memberships} membership entries.`));
  const byPerson = new Map();
  memberships.forEach((entry, i) => {
    const at = `store.memberships[${i}]`;
    if (!isObject(entry)) return out.push(problem(at, 'not-object', 'A membership is an object.'));
    exactKeys(entry, ['storeId', 'personId', 'teamIds', 'from', 'to'], ['unknown', 'source', 'membershipBasis', 'date'], at, out);
    if (entry.storeId !== storeId) out.push(problem(`${at}.storeId`, 'wrong-store', 'This membership belongs to another store.'));
    if (!people.has(entry.personId)) out.push(problem(`${at}.personId`, 'unknown-person', 'This person is not in the store.'));
    if (!uniqueStrings(entry.teamIds, id => typeof id === 'string') || entry.teamIds.some(id => !teamIds.has(id))) out.push(problem(`${at}.teamIds`, 'unknown-team', 'Use known teams in this store.'));
    if (!validDate(entry.from) || !validDate(entry.to) || entry.to < entry.from) out.push(problem(`${at}.from`, 'bad-range', 'Use a valid inclusive date range.'));
    if (Object.hasOwn(entry, 'unknown') && typeof entry.unknown !== 'boolean') out.push(problem(`${at}.unknown`, 'bad-flag', 'Use true or false.'));
    if (Object.hasOwn(entry, 'date') && !validDate(entry.date)) out.push(problem(`${at}.date`, 'bad-date', 'Use a real date, YYYY-MM-DD.'));
    for (const key of ['source', 'membershipBasis']) {
      if (!Object.hasOwn(entry, key)) continue;
      const bad = isObject(entry[key]) ? plainJsonProblem(entry[key], `${at}.${key}`) : problem(`${at}.${key}`, 'not-object', 'Use an object.');
      if (bad) out.push(bad);
    }
    if (typeof entry.personId === 'string') byPerson.set(entry.personId, [...(byPerson.get(entry.personId) || []), entry]);
  });
  // Layering is the model's own mechanism: every person starts with a
  // 2014 to 2100 entry and a single-day change is added after it, and the entry
  // later in the list wins (team-model membershipAt takes the last match). So
  // overlap is not an error. List order is therefore meaning, and is kept.
  for (const [personId, entries] of byPerson) {
    const layered = entries.some((a, i) => entries.slice(i + 1).some(b => a.from <= b.to && b.from <= a.to));
    if (layered) warnings.push(problem(`store.memberships:${personId}`, 'membership-order-significant', 'Overlapping membership entries: the later entry in the list wins, so list order must be kept.'));
  }
}

function checkRecord(value, day, ctx, out) {
  const at = `overrides.${day}`;
  if (Array.isArray(value)) {
    // The older shape: a bare list of the people who are on.
    if (value.length > LIMITS.idsPerDay || !uniqueStrings(value, id => typeof id === 'string')) out.push(problem(at, 'bad-record', 'Use a list of unique person ids.'));
    else for (const id of value) if (!ctx.people.has(id)) out.push(problem(at, 'unknown-person', `Person ${id} is not in the store.`));
    return;
  }
  if (!isObject(value)) return out.push(problem(at, 'bad-record', 'A day record is an object or a list of person ids.'));
  exactKeys(value, [], ['on', 'off', 'shifts', 'absences', 'unknownNotes', 'teamSnapshot', 'generation', 'generationLocks', 'breaksKnown'], at, out);
  const lists = {};
  for (const key of ['on', 'off', 'generationLocks']) {
    if (!Object.hasOwn(value, key)) continue;
    if (!Array.isArray(value[key]) || value[key].length > LIMITS.idsPerDay || !uniqueStrings(value[key], id => typeof id === 'string')) { out.push(problem(`${at}.${key}`, 'bad-list', 'Use a list of unique person ids.')); continue; }
    lists[key] = value[key];
    for (const id of value[key]) if (!ctx.people.has(id)) out.push(problem(`${at}.${key}`, 'unknown-person', `Person ${id} is not in the store.`));
  }
  if (lists.on && lists.off && lists.on.some(id => lists.off.includes(id))) out.push(problem(at, 'on-and-off', 'A person cannot be both on and off the same day.'));
  if (Object.hasOwn(value, 'breaksKnown') && typeof value.breaksKnown !== 'boolean') out.push(problem(`${at}.breaksKnown`, 'bad-flag', 'Use true or false.'));
  if (Object.hasOwn(value, 'shifts')) {
    if (!Array.isArray(value.shifts) || value.shifts.length > LIMITS.shiftsPerDay) out.push(problem(`${at}.shifts`, 'shift-count', `Use up to ${LIMITS.shiftsPerDay} shifts a day.`));
    else value.shifts.forEach((shift, i) => {
      const s = `${at}.shifts[${i}]`;
      if (!isObject(shift)) return out.push(problem(s, 'not-object', 'A shift is an object.'));
      exactKeys(shift, ['storeId', 'personId', 'date', 'endDate', 'startMinute', 'endMinute', 'timezone'], ['role', 'source', 'teamIds', 'teamSource'], s, out);
      if (shift.storeId !== ctx.storeId) out.push(problem(`${s}.storeId`, 'wrong-store', 'This shift belongs to another store.'));
      if (!ctx.people.has(shift.personId)) out.push(problem(`${s}.personId`, 'unknown-person', 'This person is not in the store.'));
      if (shift.date !== day) out.push(problem(`${s}.date`, 'wrong-day', 'A shift is stored under its own date.'));
      if (shift.endDate !== day) out.push(problem(`${s}.endDate`, 'overnight', 'Overnight shifts are not supported.'));
      if (shift.timezone !== STORE_TIMEZONE) out.push(problem(`${s}.timezone`, 'bad-timezone', `Only ${STORE_TIMEZONE} is supported.`));
      const m = v => Number.isInteger(v);
      if (!m(shift.startMinute) || !m(shift.endMinute) || shift.startMinute < 0 || shift.endMinute > 1439 || shift.endMinute <= shift.startMinute) out.push(problem(`${s}.startMinute`, 'bad-interval', 'Use an increasing same-day interval in whole minutes, ending by 23:59.'));
      if (Object.hasOwn(shift, 'role') && !textOk(shift.role, 40)) out.push(problem(`${s}.role`, 'bad-role', 'Use a short role name.'));
      if (Object.hasOwn(shift, 'teamIds') && !uniqueStrings(shift.teamIds, id => typeof id === 'string')) out.push(problem(`${s}.teamIds`, 'bad-team-ids', 'Use a list of team ids.'));
      for (const key of ['source', 'teamSource']) {
        if (!Object.hasOwn(shift, key)) continue;
        const bad = isObject(shift[key]) ? plainJsonProblem(shift[key], `${s}.${key}`) : problem(`${s}.${key}`, 'not-object', 'Use an object.');
        if (bad) out.push(bad);
      }
    });
  }
  for (const key of ['absences', 'unknownNotes', 'teamSnapshot']) {
    if (!Object.hasOwn(value, key)) continue;
    const map = value[key], bad = plainJsonProblem(map, `${at}.${key}`);
    if (bad || !isObject(map)) { out.push(bad || problem(`${at}.${key}`, 'not-object', 'Use a map keyed by person id.')); continue; }
    for (const id of Object.keys(map)) if (!ctx.people.has(id)) out.push(problem(`${at}.${key}.${id}`, 'unknown-person', `Person ${id} is not in the store.`));
    if (key === 'absences') for (const [id, absence] of Object.entries(map)) if (!isObject(absence) || !ABSENCE_KINDS.includes(absence.kind)) out.push(problem(`${at}.absences.${id}`, 'bad-absence', 'An absence has a kind of off, vacation, unavailable or unknown.'));
  }
  if (Object.hasOwn(value, 'generation')) {
    const bad = plainJsonProblem(value.generation, `${at}.generation`);
    if (bad || !isObject(value.generation)) out.push(bad || problem(`${at}.generation`, 'not-object', 'Use an object.'));
  }
}

// snapshot: a draft ALREADY copied by plainSnapshot, so every value in it is plain data.
// draft: { storeId, month, store: { people, rules, teams, memberships, timezone? }, overrides }
// expect: { storeId, month }, what the caller believes it is holding.
// On success the result carries `value`, the snapshot that was checked.
export function validateSnapshot(draft, expect = {}) {
  const out = [], warnings = [];
  if (!isObject(draft)) return { ok: false, problems: [problem('$', 'not-object', 'A draft is an object.')], warnings };
  exactKeys(draft, ['storeId', 'month', 'store', 'overrides'], [], '$', out);
  if (!validStoreId(draft.storeId)) out.push(problem('storeId', 'bad-store-id', 'Use a valid store id.'));
  if (!validMonth(draft.month)) out.push(problem('month', 'bad-month', 'Use a month from 2014-01 to 2100-12.'));
  if (expect.storeId !== undefined && draft.storeId !== expect.storeId) out.push(problem('storeId', 'identity-mismatch', 'This draft belongs to a different store.'));
  if (expect.month !== undefined && draft.month !== expect.month) out.push(problem('month', 'identity-mismatch', 'This draft belongs to a different month.'));
  if (!isObject(draft.store)) out.push(problem('store', 'not-object', 'The store settings are an object.'));
  else {
    exactKeys(draft.store, ['people', 'rules', 'teams', 'memberships'], ['timezone'], 'store', out);
    if (Object.hasOwn(draft.store, 'timezone') && draft.store.timezone !== STORE_TIMEZONE) out.push(problem('store.timezone', 'bad-timezone', `Only ${STORE_TIMEZONE} is supported.`));
    const people = checkPeople(draft.store.people, out);
    checkRules(draft.store.rules, out);
    checkTeams(draft.store.teams, draft.store.memberships, draft.storeId, people, out, warnings);
    if (!isObject(draft.overrides)) out.push(problem('overrides', 'not-object', 'Overrides are a map of date to day record.'));
    else {
      const days = Object.keys(draft.overrides);
      if (days.length > LIMITS.days) out.push(problem('overrides', 'day-count', `A month has at most ${LIMITS.days} days.`));
      for (const day of days) {
        // The model keeps a day's override in the draft for that day's own month.
        if (!validDate(day) || !(validMonth(draft.month) && day.startsWith(`${draft.month}-`))) { out.push(problem(`overrides.${day}`, 'day-outside-month', 'Use a real date inside this draft month.')); continue; }
        checkRecord(draft.overrides[day], day, { storeId: draft.storeId, people }, out);
      }
    }
  }
  // A draft may nest 8 levels below its own root (the envelope around it may nest 12).
  const deep = depthProblem(draft, LIMITS.jsonDepth);
  if (deep) out.push(deep);
  const ok = out.length === 0;
  return { ok, problems: out.slice(0, LIMITS.problems), warnings, ...(ok ? { value: draft } : {}) };
}

// The entry point for a draft of unknown origin: one strict snapshot, then the structural checks on exactly that snapshot. The returned
// `value` is what was checked, detached from the input.
export function validateDraft(draft, expect = {}) {
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return { ok: false, problems: [problem('$', 'not-object', 'A draft is an object.')], warnings: [] };
  const snapshot = plainSnapshot(draft);
  if (!snapshot.ok) return { ok: false, problems: snapshot.problems, warnings: [] };
  return validateSnapshot(snapshot.value, expect);
}

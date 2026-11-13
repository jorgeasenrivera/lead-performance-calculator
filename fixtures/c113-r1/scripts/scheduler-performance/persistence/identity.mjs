// Identity for persisted scheduler data.
//
// A store is named by its id and never by its position in a list. The list can
// be reordered, filtered or extended between a save and a load, and a position
// that moved would attach one store's draft to another store. Every key below is
// built from the id, the month and a server-style revision, and nothing else.
//
// Pure: no clock, no storage, no environment. Dates are checked with integer
// arithmetic so no Date object is ever built.

// Lowercase only, to agree with the store column check in the drafted sales
// history migration (#464) rather than the looser pattern in api/_floor-access.
export const STORE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const FIRST_MONTH = '2014-01';
export const LAST_MONTH = '2100-12';
export const KINDS = Object.freeze(['draft', 'published']);

export const validStoreId = value => typeof value === 'string' && STORE_ID_PATTERN.test(value);
export const validKind = value => KINDS.includes(value);
export const validRev = (value, min = 1) => Number.isSafeInteger(value) && value >= min;

export const validMonth = value =>
  typeof value === 'string'
  && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)
  && value >= FIRST_MONTH && value <= LAST_MONTH;

const daysIn = (year, month) =>
  month === 2 ? ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;

export function validDate(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const year = +parts[1], month = +parts[2], day = +parts[3];
  return value >= `${FIRST_MONTH}-01` && value <= `${LAST_MONTH}-31`
    && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

// The month before or after, or null when that month is outside the supported
// range. Weekly hour caps cross month edges, so a published month depends on
// both neighbours.
export function shiftMonthBy(month, delta) {
  if (!validMonth(month) || !Number.isSafeInteger(delta)) return null;
  const index = +month.slice(0, 4) * 12 + (+month.slice(5, 7) - 1) + delta;
  const result = `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
  return validMonth(result) ? result : null;
}
export const adjacentMonths = month =>
  validMonth(month) ? { prev: shiftMonthBy(month, -1), next: shiftMonthBy(month, 1) } : null;

export function identityProblems({ storeId, month } = {}) {
  const problems = [];
  if (!validStoreId(storeId)) problems.push({ path: 'storeId', code: 'bad-store-id', message: 'Use a store id of lowercase letters, digits, - or _, up to 64 characters.' });
  if (!validMonth(month)) problems.push({ path: 'month', code: 'bad-month', message: 'Use a month from 2014-01 to 2100-12.' });
  return problems;
}

function assertIdentity(identity) {
  const problems = identityProblems(identity);
  if (problems.length) throw new TypeError(problems.map(p => p.message).join(' '));
}

// Store ids cannot contain "/", so the separator is unambiguous.
export function monthKey(storeId, month) {
  assertIdentity({ storeId, month });
  return `${storeId}/${month}`;
}
export function versionId(kind, storeId, month, rev) {
  if (!validKind(kind) || !validRev(rev)) throw new TypeError('Use a kind of draft or published and a revision of 1 or more.');
  return `${monthKey(storeId, month)}/${kind}/${rev}`;
}
export function parseVersionId(id) {
  if (typeof id !== 'string') return null;
  const parts = id.split('/');
  if (parts.length !== 4) return null;
  const parsed = { storeId: parts[0], month: parts[1], kind: parts[2], rev: Number(parts[3]) };
  if (identityProblems(parsed).length || !validKind(parsed.kind) || !validRev(parsed.rev)) return null;
  return versionId(parsed.kind, parsed.storeId, parsed.month, parsed.rev) === id ? parsed : null;
}

// Position is only ever a lookup into the list the caller holds right now.
// A duplicate id makes the list ambiguous, so it is refused rather than guessed.
export function storeIdOf(store) {
  return validStoreId(store?.id) ? store.id : null;
}
export function duplicateStoreIds(stores) {
  const seen = new Set(), repeated = new Set();
  for (const store of stores || []) {
    const id = storeIdOf(store);
    if (id === null) continue;
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated].sort();
}
export function indexOfStore(stores, storeId) {
  if (!Array.isArray(stores) || duplicateStoreIds(stores).length) return -1;
  return stores.findIndex(store => storeIdOf(store) === storeId);
}
export function keyForIndex(stores, index, month) {
  if (!Array.isArray(stores) || !Number.isInteger(index) || index < 0 || index >= stores.length) throw new TypeError('Unknown store position.');
  if (duplicateStoreIds(stores).length) throw new TypeError('Two stores share an id.');
  const id = storeIdOf(stores[index]);
  if (id === null) throw new TypeError('The store at this position has no valid id.');
  return monthKey(id, month);
}

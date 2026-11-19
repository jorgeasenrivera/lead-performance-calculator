// Browser-safe metadata. Month payloads are the adjacent static JSON files.
export const clock = Object.freeze({ now: '2026-09-22T16:00:00.000Z', timeZone: 'America/New_York' });
export const stores = Object.freeze([
  Object.freeze({ id: 'fictional-a', name: 'Fictional Store Alpha' }),
  Object.freeze({ id: 'fictional-b', name: 'Fictional Store Beta' }),
]);
export const payloadIds = Object.freeze(['alpha-september', 'alpha-september-corrected', 'alpha-september-all-held', 'beta-september', 'alpha-october', 'beta-october']);
export const dayCases = Object.freeze([
  { id: 'conflict', date: '2026-09-15', status: 'conflict', count: null },
  { id: 'coverage-held', date: '2026-09-16', status: 'incomplete', count: null },
  { id: 'missing', date: '2026-09-17', status: 'missing', count: null },
  { id: 'positive', date: '2026-09-18', status: 'provisional', count: 7, split: [4, 3], easternAsOf: 'Sep 18, 2026, 6:00 PM EDT' },
  { id: 'known-zero', date: '2026-09-19', status: 'provisional', count: 0, split: [0, 0], easternAsOf: 'Sep 19, 2026, 6:00 PM EDT' },
  { id: 'split-unavailable', date: '2026-09-20', status: 'provisional', count: 5, split: [null, null], easternAsOf: 'Sep 20, 2026, 6:00 PM EDT' },
  { id: 'receipt-only', date: '2026-09-21', status: 'provisional', count: 3, split: [null, null], easternAsOf: 'Sep 21, 2026, 6:00 PM EDT', asOfBasis: 'report_received' },
  { id: 'today', date: '2026-09-22', status: 'provisional', count: 2, split: [1, 1], easternAsOf: 'Sep 22, 2026, 11:30 AM EDT' },
  { id: 'future', date: '2026-09-23', status: 'missing', count: null },
]);
export const httpErrors = Object.freeze({
  unauthorized: { status: 401, body: { error: 'sign in first' } },
  forbidden: { status: 403, body: { error: 'not one of your stores' } },
  unavailable: { status: 503, body: { error: 'daily deliveries unavailable' } },
});

export function malformedCases(base) {
  const changed = (fn) => { const body = structuredClone(base); fn(body); return { status: 200, body }; };
  return {
    'invalid-json': { status: 200, rawBody: '{"storeId":' },
    'wrong-store': changed((p) => { p.storeId = p.storeId === 'fictional-a' ? 'fictional-b' : 'fictional-a'; }),
    'wrong-month': changed((p) => { p.month = '2026-10'; }),
    'missing-days': changed((p) => { delete p.days; }),
    'truncated-days': changed((p) => { p.days.pop(); }),
    'duplicate-day': changed((p) => { p.days[0] = structuredClone(p.days[1]); }),
    'string-count': changed((p) => { p.days[17].count = '7'; }),
    'negative-count': changed((p) => { p.days[17].count = -1; }),
    'held-with-count': changed((p) => { p.days[15].count = 7; }),
    'missing-asof': changed((p) => { p.days[17].asOf = null; }),
    'invalid-asof-basis': changed((p) => { p.days[17].asOf.basis = 'browser_fetch'; }),
    'invalid-split': changed((p) => { p.days[17].vehicles = { new: 4, used: 4 }; }),
    'half-split': changed((p) => { p.days[17].vehicles = { new: 4, used: null }; }),
    'unexpected-private-field': changed((p) => { p.days[17].reason = 'synthetic_private_diagnostic'; }),
  };
}

import { parseStoreRollup } from './_report-parsers.mjs';

/* Offline candidate based on a repository fixture, not proof of a live report.
   It must not be used to publish a board until the source and its authority are
   independently established and the server publication boundary is in place. */
function rollupCandidateDate(month, day, year) {
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
const norm = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';

export function parseRollupCandidate(rows, stores, requestedStoreId, today) {
  if (!Array.isArray(rows) || !Array.isArray(stores) || typeof requestedStoreId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestedStoreId) || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null;
  const nonempty = rows.filter(row => Array.isArray(row) && row.some(v => String(v ?? '').trim() !== ''));
  if (nonempty.length !== 3 || nonempty.some(row => !Array.isArray(row))) return null;
  const [title, header, values] = nonempty;
  if (title.length !== 2 || norm(title[0]) !== 'delivery summary' || typeof title[1] !== 'string') return null;
  const range = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(title[1]);
  if (!range) return null;
  const start = rollupCandidateDate(range[1], range[2], range[3]), end = rollupCandidateDate(range[4], range[5], range[6]);
  if (!start || !end || start !== today.slice(0, 7) + '-01' || end !== today) return null;
  const labels = header.map(norm);
  const storeColumns = labels.reduce((a, x, i) => x === 'store' ? [...a, i] : a, []);
  const dealColumns = labels.reduce((a, x, i) => x === 'deals delivered' ? [...a, i] : a, []);
  if (storeColumns.length !== 1 || dealColumns.length !== 1 || labels.some(x => ['user', 'name', 'salesperson'].includes(x))) return null;
  const rawCount = values[dealColumns[0]];
  if (typeof rawCount !== 'string' || !/^(0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)$/.test(rawCount.trim())) return null;
  const parsed = parseStoreRollup(nonempty);
  if (!parsed || !Number.isSafeInteger(parsed.deals) || parsed.deals < 0) return null;
  const matches = stores.filter(s => s && norm(s.name) && norm(s.name) === norm(parsed.storeName));
  if (matches.length !== 1 || matches[0].id !== requestedStoreId) return null;
  return { status:'unverified', source:'store-rollup', storeId:requestedStoreId, periodStart:start, periodEnd:end, deliveries:parsed.deals };
}

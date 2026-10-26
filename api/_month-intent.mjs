/* Monthly imports are snapshots of individual reported fields. A later upload
   does not make a stale tab authoritative for every other field in the month.
   Compare the caller's loaded baseline, its intended value and the current row.
   Absence, null and explicit zero remain different; arrays are atomic values. */
import { isDeepStrictEqual } from './_value-equality.mjs';

const absent = globalThis.Symbol('absent');
const object = v => v !== absent && v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => v === absent ? absent : globalThis.structuredClone(v);
const field = (v, k) => object(v) && Object.hasOwn(v, k) ? v[k] : absent;
function conflict(reason) {
  const error = new Error(`Monthly data changed while this page was open (${reason}). Reload the store and review the import before trying again. Nothing in the store row was saved.`);
  error.code = 'MONTH_IMPORT_CONFLICT';
  throw error;
}
function reconcile(base, intended, current, path = []) {
  if (isDeepStrictEqual(base, intended)) return copy(current);
  if (isDeepStrictEqual(base, current) || isDeepStrictEqual(intended, current)) return copy(intended);
  // A reported aggregate and its metadata describe one snapshot. Never merge
  // independently changed pieces into a synthetic source observation.
  const snapshot = path.length === 2 && ['stated','reportInputs'].includes(path[1]);
  if (!snapshot && (object(base) || base === absent) && object(intended) && object(current)) {
    const out = {};
    for (const k of new Set([...Object.keys(base === absent ? {} : base), ...Object.keys(intended), ...Object.keys(current)])) {
      const value = reconcile(field(base,k), field(intended,k), field(current,k), [...path,k]);
      if (value !== absent) Object.defineProperty(out,k,{value,writable:true,enumerable:true,configurable:true});
    }
    return out;
  }
  conflict('the same reported field has another change');
}

export function reconcileMonths(baseline, intended, current, reportedFields = [], { rowAbsentAtLoad = false } = {}) {
  if (!current) {
    // Only an authoritative "no row" at load makes creating it the intent. A row
    // that was loaded and is gone now was removed by somebody else; a stale copy
    // must not bring it back. No provenance means refuse, never guess.
    if (baseline && rowAbsentAtLoad !== true) conflict('the loaded store row is no longer present');
    return copy(intended.months);
  }
  if (!baseline || typeof baseline !== 'object') conflict('loaded baseline is unavailable');
  if ((baseline.__storeId && intended.__storeId && baseline.__storeId !== intended.__storeId) ||
      (baseline.__storeId && current.__storeId && baseline.__storeId !== current.__storeId)) conflict('store identity changed');
  // An import explicitly reasserts reported fields even when their values equal
  // the loaded baseline. Ordinary saves have no such mask. Do not silently
  // discard a reported value because another writer changed it in the meantime.
  const at = (document,path) => path.reduce((v,k)=>field(v,k),field(document,'months'));
  for (const path of reportedFields) {
    if (!Array.isArray(path) || !path.length || !path.every(k=>typeof k === 'string')) conflict('invalid reported field');
    const before=at(baseline,path),after=at(intended,path),server=at(current,path);
    if (!isDeepStrictEqual(before,server) && !isDeepStrictEqual(after,server)) conflict('a reported field has another change');
  }
  if (reportedFields.length || !isDeepStrictEqual(baseline.months,intended.months)) {
    // A name/eligibility change may retarget an imported record. Require reload
    // instead of applying the old intent to a newly mapped or excluded person.
    for (const k of ['aliases','roster','departed','excluded','statsExcluded']) {
      const empty = k === 'aliases' ? {} : [];
      if (!isDeepStrictEqual(baseline[k] ?? empty,current[k] ?? empty)) conflict('people attribution changed');
    }
  }
  const result = reconcile(field(baseline,'months'),field(intended,'months'),field(current,'months'));
  return result === absent ? undefined : result;
}

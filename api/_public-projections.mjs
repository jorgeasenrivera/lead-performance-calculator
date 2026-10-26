/* Positive public schema shared by browser and ingest. Unknown nested fields
   never inherit public visibility merely because an older row carried them. */
import { BOARD_STAT_FIELDS, FLOOR_STAT_FIELDS } from './_store-keys.mjs';
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = v => typeof v === 'string' ? v : undefined;
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const scalars = (v, fields, pick = text) => Object.fromEntries(fields.flatMap(k => { const x = pick(object(v)[k]); return x === undefined ? [] : [[k, x]]; }));
const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const channels = ['internet', 'phone', 'showroom', 'campaign'];
const numericMap = v => Object.fromEntries(Object.entries(object(v)).flatMap(([k, x]) => number(x) === undefined ? [] : [[k, x]]));
const people = v => Array.isArray(v) ? v.map(p => scalars(p, ['id','name','roleId'])) : [];
function stats(v) {
  const out = scalars(v, BOARD_STAT_FIELDS.filter(k => !['prevPct','prevUnits'].includes(k)), number);
  for (const k of ['prevPct','prevUnits']) if (v?.[k]) out[k] = scalars(v[k], channels, number);
  return out;
}
export function publicBoard(input) {
  const v = object(input);
  const out = scalars(v, ['storeId','storeName','icon','ym','updatedAt']);
  if (v.icon === null) out.icon = null;
  out.brand = scalars(v.brand, ['primary','deep','accent'], x => typeof x === 'string' && /^#[0-9a-f]{3,8}$/i.test(x) ? x : undefined);
  out.thresholds = Object.fromEntries([...channels,'apptVideoDayPct','engagedVideoPct'].flatMap(k => Object.hasOwn(object(v.thresholds),k) ? [[k,scalars(v.thresholds[k],['green','yellow'],number)]] : []));
  // Older thresholds can also be a single green/yellow pair.
  Object.assign(out.thresholds, scalars(v.thresholds,['green','yellow'],number));
  out.boardDisplay = { ...scalars(v.boardDisplay,['style','bg']), ...scalars(v.boardDisplay,['squeeze','pad','tscale'],number) };
  if (Array.isArray(v.boardDisplay?.rotate)) out.boardDisplay.rotate = strings(v.boardDisplay.rotate);
  out.roles = Array.isArray(v.roles) ? v.roles.map(r => scalars(r,['id'])) : [];
  out.roster = people(v.roster); out.people = people(v.people);
  out.departed = strings(v.departed);
  out.goals = numericMap(v.goals);
  out.ticker = strings(v.ticker).map(s => s.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;'));
  out.months = {};
  for (const [month, row] of Object.entries(object(v.months))) if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    out.months[month] = { stats: Object.fromEntries(Object.entries(object(row?.stats)).map(([name, value]) => [name,stats(value)])) };
  }
  return out;
}
export function publicDirectory(v) {
  return { stores: Array.isArray(v?.stores) ? v.stores.map(s=>scalars(s,['id','name'])) : [], approvedDomains: strings(v?.approvedDomains), registrationOpen: v?.registrationOpen === true, ...scalars(v,['at']) };
}
export function publicDay(v) {
  const out = Object.create(null);
  for (const [person, row] of Object.entries(object(v))) {
    if (person === '__hours') continue;
    out[person] = { ...scalars(row,FLOOR_STAT_FIELDS.filter(k=>!['mtd','rocked','uploadedAt'].includes(k)),number), ...scalars(row,['uploadedAt']) };
    if (typeof row?.rocked === 'boolean') out[person].rocked = row.rocked;
    if (row?.mtd) out[person].mtd = scalars(row.mtd,['iu','il','pu','pl','su','sl'],number);
  }
  out.__hours = {};
  for (const [hour, bucket] of Object.entries(object(v?.__hours))) if (/^\d{2}$/.test(hour) && +hour < 24) {
    out.__hours[hour] = Object.fromEntries(Object.entries(object(bucket)).map(([person, counters]) => [person,scalars(counters,['op','ca','ct','ap'],number)]));
  }
  return out;
}

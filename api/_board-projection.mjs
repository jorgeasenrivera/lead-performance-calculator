import { BOARD_STAT_FIELDS } from './_store-keys.mjs';
import { verifiedBoardCount } from './_board-provenance.mjs';

/* Offline projection only: the caller must obtain config and store data under
   the same publication transaction. This helper does not grant access or write. */
export function projectBoard({ config, storeId, data, month, today, updatedAt, defaults, normalizeThresholds, streak }) {
  if (!storeId || !/^\d{4}-\d{2}$/.test(month || '') || !data || !config || !defaults || typeof normalizeThresholds !== 'function' || typeof streak !== 'function') throw new Error('incomplete board projection input');
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const safeName = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[<>\u0000-\u001f\u007f]/.test(value) && !['__proto__','constructor','prototype'].includes(value.trim().toLowerCase());
  const norm = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validId(storeId) || !Array.isArray(config.stores) || !Array.isArray(config.roles)) throw new Error('invalid board projection input');
  const store = config.stores.find(s => s && s.id === storeId);
  if (!store) throw new Error('store not found in config');
  const roles = config.roles.filter(r => r && validId(r.id) && r.onBoard !== false).map(r => ({id:r.id}));
  const allowed = new Set(roles.map(r => r.id));
  const gone = new Set((Array.isArray(data.departed) ? data.departed : []).filter(a => a && safeName(a.name)).map(a => norm(a.name)));
  const sourceRoster = Array.isArray(data.roster) ? data.roster : [];
  const people = sourceRoster.filter(a => a && validId(a.id) && safeName(a.name) && (!a.roleId || validId(a.roleId)) && !gone.has(norm(a.name))).map(a => ({id:a.id,name:a.name,roleId:a.roleId || null}));
  const roster = people.filter(a => a.roleId && allowed.has(a.roleId));
  const source = data.months?.[month] || {};
  const [year, mon] = month.split('-').map(Number);
  if (mon < 1 || mon > 12) throw new Error('invalid month');
  const nextMonth = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0,7);
  const goals = {}, off = {};
  const stats = {}, ticker = [];
  const std = { ...defaults.activityStandards, ...(store.activityStandards || {}) };
  for (const person of roster) {
    const k = norm(person.name), values = source.stats?.[k];
    if (values) {
      const keep = {};
      for (const field of BOARD_STAT_FIELDS) {
        if (values[field] === undefined) continue;
        if (field === 'prevPct' || field === 'prevUnits') {
          const nested = values[field];
          if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            keep[field] = Object.fromEntries(['internet', 'phone', 'showroom', 'campaign']
              .filter(k => nested[k] === null || (typeof nested[k] === 'number' && Number.isFinite(nested[k]))).map(k => [k, nested[k]]));
          }
        } else if (values[field] === null || (typeof values[field] === 'number' && Number.isFinite(values[field]))) keep[field] = values[field];
      }
      stats[k] = keep;
    }
    const actual = sourceRoster.find(a => a && a.id === person.id);
    const goalRow = data.goals?.[person.id];
    const goal = goalRow?.byMonth?.[month] ?? goalRow?.monthly;
    if (typeof goal === 'number' && Number.isFinite(goal) && goal >= 0) goals[k] = goal;
    const days = data.daysOff?.[person.id];
    if (Array.isArray(days)) {
      const allowedDays = days.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10) === d && (d.slice(0,7) === month || d.slice(0,7) === nextMonth)).sort();
      if (allowedDays.length) off[k] = allowedDays;
    }
    try { const run = streak(data, actual, std); if (run.dir === 'up' && Number.isSafeInteger(run.len) && run.len >= 3) ticker.push(`&#128293; ${person.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} is on a ${run.len}-day streak`); } catch {}
  }
  const total = verifiedBoardCount(source.boardCountEvidence, storeId, month, today);
  const rawBrand = store.brand || defaults.brand || {};
  const fallbackBrand = {primary:'#2A5E9B',deep:'#1D4674',accent:'#C1D730'};
  const brand = Object.fromEntries(Object.keys(fallbackBrand).map(k => [k, /^#[0-9a-f]{6}$/i.test(rawBrand[k] || '') ? rawBrand[k] : fallbackBrand[k]]));
  const normalized = normalizeThresholds(store.thresholds);
  const thresholds = Object.fromEntries(['internet','phone','showroom','apptVideoDayPct','engagedVideoPct'].map(k => [k, Object.fromEntries(['green','yellow'].filter(v => typeof normalized[k]?.[v] === 'number' && Number.isFinite(normalized[k][v])).map(v => [v, normalized[k][v]]))]));
  const icon = typeof store.icon === 'string' && store.icon.length <= 6000000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(store.icon) ? store.icon : null;
  const rawDisplay = data.boardDisplay;
  const display = rawDisplay && typeof rawDisplay === 'object' && !Array.isArray(rawDisplay) ? Object.fromEntries(['tscale','squeeze','pad','style','bg','rotate'].filter(k => { const v = rawDisplay[k]; return (['tscale','squeeze','pad'].includes(k) && typeof v === 'number' && Number.isFinite(v)) || (k === 'style' && ['classic','bars'].includes(v)) || (k === 'bg' && ['navy','store'].includes(v)) || (k === 'rotate' && Array.isArray(v) && v.every(validId)); }).map(k => [k,rawDisplay[k]])) : null;
  const safeUpdatedAt = typeof updatedAt === 'string' && updatedAt.length <= 40 && Number.isFinite(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : null;
  const current = {stats};
  if (total !== null) current.storeTotal = total;
  return {storeId,storeName:safeName(store.name) ? store.name : 'Store',icon,goals,off,
    brand,thresholds,roles,
    boardDisplay:display,ym:month,ticker,roster,people,departed:[...gone],
    months:{[month]:current},updatedAt:safeUpdatedAt};
}

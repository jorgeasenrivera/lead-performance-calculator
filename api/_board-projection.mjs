import { BOARD_STAT_FIELDS } from './_store-keys.mjs';
import { phoneExtras } from './_phone-rows.mjs';
import { verifiedBoardCount } from './_board-provenance.mjs';

/* Offline projection only: the caller must obtain config and store data under
   the same publication transaction. This helper does not grant access or write. */
export function projectBoard({ config, storeId, data, month, today, updatedAt, defaults, normalizeThresholds, streak }) {
  if (!storeId || !/^\d{4}-\d{2}$/.test(month || '') || !data || !config || !defaults || typeof normalizeThresholds !== 'function' || typeof streak !== 'function') throw new Error('incomplete board projection input');
  const norm = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const store = (config.stores || []).find(s => s.id === storeId);
  if (!store) throw new Error('store not found in config');
  const roles = (config.roles || []).filter(r => r.onBoard !== false).map(r => ({id:r.id}));
  const allowed = new Set(roles.map(r => r.id));
  const gone = new Set((data.departed || []).map(a => norm(a.name)));
  const people = (data.roster || []).filter(a => a && a.id && a.name && !gone.has(norm(a.name))).map(a => ({id:a.id,name:a.name,roleId:a.roleId || null}));
  const roster = people.filter(a => a.roleId && allowed.has(a.roleId));
  const source = data.months?.[month] || {};
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
    const actual = (data.roster || []).find(a => a && a.id === person.id);
    try { const run = streak(data, actual, std); if (run.dir === 'up' && run.len >= 3) ticker.push(`&#128293; ${person.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} is on a ${run.len}-day streak`); } catch {}
  }
  const extras = phoneExtras(data, roster, month, norm);
  const total = verifiedBoardCount(source.boardCountEvidence, storeId, month, today);
  const rawBrand = store.brand || defaults.brand || {};
  const fallbackBrand = {primary:'#2A5E9B',deep:'#1D4674',accent:'#C1D730'};
  const brand = Object.fromEntries(Object.keys(fallbackBrand).map(k => [k, /^#[0-9a-f]{6}$/i.test(rawBrand[k] || '') ? rawBrand[k] : fallbackBrand[k]]));
  const normalized = normalizeThresholds(store.thresholds);
  const thresholds = Object.fromEntries(['internet','phone','showroom','apptVideoDayPct','engagedVideoPct'].map(k => [k, Object.fromEntries(['green','yellow'].filter(v => typeof normalized[k]?.[v] === 'number' && Number.isFinite(normalized[k][v])).map(v => [v, normalized[k][v]]))]));
  const rawDisplay = data.boardDisplay;
  const display = rawDisplay && typeof rawDisplay === 'object' && !Array.isArray(rawDisplay) ? Object.fromEntries(['tscale','squeeze','pad','style','bg','rotate'].filter(k => { const v = rawDisplay[k]; return (['tscale','squeeze','pad'].includes(k) && typeof v === 'number' && Number.isFinite(v)) || (['style','bg'].includes(k) && typeof v === 'string') || (k === 'rotate' && Array.isArray(v) && v.every(id => typeof id === 'string')); }).map(k => [k,rawDisplay[k]])) : null;
  const current = {stats};
  if (total !== null) current.storeTotal = total;
  return {storeId,storeName:store.name || 'Store',icon:store.icon || null,goals:extras.goals,off:extras.off,
    brand,thresholds,roles,
    boardDisplay:display,ym:month,ticker,roster,people,departed:[...gone],
    months:{[month]:current},updatedAt};
}

// The Dashboard's schedule counts, taken from what the planner itself confirms.
// The planner calls somebody on only from an explicit working day and off only
// from an explicit day off. Not being listed off is not the same as being on, so
// one person it cannot place makes the whole day unknown, and an unknown day
// shows "Today's schedule" with no numbers rather than a guess.
import { STORE_TIME_ZONE } from './scheduler-calendar-model.mjs';
import { createLegacyScheduleResolver, editorStore, zonedToday } from './scheduler-editor-adapter.mjs';

export function confirmedStaffing(store, data, day) {
  try {
    if (!store || !data || typeof day !== 'string') return null;
    const timezone = store.timezone || STORE_TIME_ZONE;
    const copied = structuredClone(data), scoped = editorStore(store, copied, timezone);
    // Somebody not yet hired or already gone that day is neither on nor off.
    const people = scoped.people.filter((p) => !(p.hiredAt && day < p.hiredAt) && !(p.departedAt && day > p.departedAt));
    if (!people.length) return null;
    const resolver = createLegacyScheduleResolver({
      stores: [scoped],
      snapshots: [{ storeId: store.id, revision: Number.isSafeInteger(data.rev) ? data.rev : 'unversioned', data: copied }],
      startDate: '2014-01-01', endDate: '2100-12-31',
    });
    const record = resolver.explicitAssignmentForDay(day, 0)?.record;
    if (!record) return null;
    const on = new Set(record.on || []), off = new Set(record.off || []);
    let onCount = 0, offCount = 0;
    for (const p of people) {
      const isOn = on.has(p.id), isOff = off.has(p.id);
      if (isOn === isOff) return null;
      if (isOn) onCount++; else offCount++;
    }
    return { on: onCount, off: offCount };
  } catch {
    return null;
  }
}

export function confirmedStaffingToday(store, data, now = new Date()) {
  const day = zonedToday(store?.timezone || STORE_TIME_ZONE, now);
  return day ? confirmedStaffing(store, data, day) : null;
}

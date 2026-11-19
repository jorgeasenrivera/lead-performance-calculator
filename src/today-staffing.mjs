// The Dashboard's schedule counts, taken from what the planner itself confirms.
// The planner calls somebody on only from an explicit working day and off only
// from an explicit day off. Not being listed off is not the same as being on, so
// one person it cannot place makes the whole day unknown, and an unknown day
// shows "Today's schedule" with no numbers rather than a guess.
import { STORE_TIME_ZONE } from './scheduler-calendar-model.mjs';
import { createLegacyScheduleResolver, editorStore, zonedToday } from './scheduler-editor-adapter.mjs';

// Who the planner confirms on, who it has explicitly off, and the counts when
// every person that day is one or the other. With the calendar off, the lists
// under the schedule control are drawn from this too: explicit days off, and
// nobody called on unless the planner says so.
export function staffingFor(store, data, day) {
  try {
    if (!store || !data || typeof day !== 'string') return null;
    const timezone = store.timezone || STORE_TIME_ZONE;
    const copied = structuredClone(data), scoped = editorStore(store, copied, timezone);
    // Somebody not yet hired or already gone that day is neither on nor off.
    const people = scoped.people.filter((p) => !(p.hiredAt && day < p.hiredAt) && !(p.departedAt && day > p.departedAt));
    const resolver = createLegacyScheduleResolver({
      stores: [scoped],
      snapshots: [{ storeId: store.id, revision: Number.isSafeInteger(data.rev) ? data.rev : 'unversioned', data: copied }],
      startDate: '2014-01-01', endDate: '2100-12-31',
    });
    const record = resolver.explicitAssignmentForDay(day, 0)?.record;
    if (!record) return null;
    const onIds = new Set(record.on || []), offIds = new Set(record.off || []);
    const on = new Set(), off = new Set();
    let known = people.length > 0;
    for (const p of people) {
      const isOn = onIds.has(p.id), isOff = offIds.has(p.id);
      if (isOn === isOff) { known = false; continue; }
      (isOn ? on : off).add(p.id);
    }
    return { day, on, off, counts: known ? { on: on.size, off: off.size } : null };
  } catch {
    return null;
  }
}

export function confirmedStaffing(store, data, day) {
  return staffingFor(store, data, day)?.counts ?? null;
}

export function confirmedStaffingToday(store, data, now = new Date()) {
  const day = zonedToday(store?.timezone || STORE_TIME_ZONE, now);
  return day ? confirmedStaffing(store, data, day) : null;
}

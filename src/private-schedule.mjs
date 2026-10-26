/* Only an explicit publication is a schedule. Absence is never zero days off. */
export function reviewedSchedule(data, month) {
  const people = Object.create(null);
  for (const a of data?.roster || []) {
    if (!a?.id || Object.hasOwn(people, a.id)) throw new Error('Invalid roster identity');
    people[a.id] = { offDates: [...new Set((data.daysOff?.[a.id] || []).filter(d => typeof d === 'string' && d.startsWith(month + '-')))].sort() };
  }
  return { ...people };
}
export function ownSchedule(result, { store, month, person }) {
  if (result?.store !== store || result?.month !== month || result?.subject !== person) return { state: 'unavailable', offDates: null };
  if (result.state !== 'published') return { state: 'unpublished', offDates: null };
  const entry = result.people?.[person];
  if (!Array.isArray(entry?.offDates) || Object.keys(result.people).length !== 1
      || entry.offDates.some(d => typeof d !== 'string' || !d.startsWith(month + '-'))) return { state: 'unavailable', offDates: null };
  return { state: 'published', offDates: entry.offDates.slice(), revision: result.revision };
}
/* No disk cache. Every request rechecks account approval at the database. */
export function watchOwnSchedule({ read, identity, emit, interval = 2000, timers = globalThis, visibility = globalThis.document }) {
  let stopped = false, generation = 0, busy = false, controller = null;
  const clear = state => emit({ state, offDates: null });
  clear('loading');
  const refresh = async () => {
    if (stopped || busy || visibility?.hidden) return;
    busy = true; const ticket = ++generation;
    const requestController = new AbortController(); controller = requestController; let timeout;
    try {
      const result = await Promise.race([read(requestController.signal), new Promise((_, reject) => { timeout = timers.setTimeout(() => { requestController.abort(); reject(new Error('schedule read timed out')); }, 4000); })]);
      if (stopped || ticket !== generation) return;
      if (result.error) clear(result.error.code === '42501' ? 'forbidden' : 'unavailable');
      else emit(ownSchedule(result.data, identity));
    } catch { if (!stopped && ticket === generation) clear('unavailable'); }
    finally { timers.clearTimeout(timeout); if (ticket === generation) busy = false; }
  };
  const onVisibility = () => { generation++; controller?.abort(); busy = false; clear('loading'); if (!visibility?.hidden) refresh(); };
  visibility?.addEventListener?.('visibilitychange', onVisibility);
  const handle = timers.setInterval(refresh, interval);
  refresh();
  return () => { stopped = true; generation++; controller?.abort(); timers.clearInterval(handle); visibility?.removeEventListener?.('visibilitychange', onVisibility); };
}

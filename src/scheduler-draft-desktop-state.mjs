// Presentation only. The binding and editor remain the sources of save state.
export function monthName(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return 'Selected month';
  return new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(`${month}-01T12:00:00Z`));
}
export function nearbyMonths(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return [];
  const date = new Date(`${month}-01T12:00:00Z`);
  return [0, -1, 1].map(offset => {
    const d = new Date(date); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7);
  }).filter(m => m >= '2014-01' && m <= '2100-12');
}
export function draftMonthView(snapshot, month) {
  const entry = snapshot?.months?.find(m => m.month === month);
  const state = entry?.controller;
  const base = {label: monthName(month), action: 'save', canAct: false, canRead: false};
  if (!snapshot?.active) return {...base, message: 'Waiting for the current editor and sign-in.'};
  if (!entry) return {...base, message: 'Draft has not been loaded.', canRead: true};
  if (entry.operation) return {...base, message: entry.operation === 'load' ? 'Loading draft…' : 'Saving this month’s draft…'};
  if (state?.status === 'uncertain') return {...base, action: 'retry', canAct: true,
    message: 'Save outcome unknown. Retry the same save before starting another.'};
  if (state?.status === 'conflict') return {...base,
    message: 'Another draft changed. Your edits are still here. Review recovery options.'};
  if (!entry.loadAccepted) return {...base, canRead: !entry.awaitingAcknowledgement,
    message: entry.error ? 'Draft could not be applied. Your editor has been kept unchanged. Review recovery options.' : 'Draft has not been loaded.'};
  if (entry.error || state?.error) return {...base, canAct: true,
    message: 'Draft was not saved. Your edits are still here. Try saving again.'};
  if (snapshot.editor?.pending) return {...base, canAct: true,
    message: 'Apply or cancel pending choices before saving.'};
  const dirty = snapshot.editor?.dirtyMonths.includes(month);
  if (dirty) return {...base, canAct: true, message: 'This month has unsaved edits.'};
  if (state?.draftRev === 0) return {...base, canAct: true, message: 'No saved draft exists for this month.'};
  return {...base, message: `Draft revision ${state?.draftRev} saved. This does not publish a schedule.`};
}
export function recoveryBlocked(snapshot) {
  return snapshot?.months?.some(m => m.operation || ['saving', 'uncertain'].includes(m.controller?.status)) === true;
}

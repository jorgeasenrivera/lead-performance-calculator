import { addDays, weekday, ruleFor } from '../scheduler-proposal/model.mjs';
import { shiftProblem, localInterval, unionMinutes, STORE_TIMEZONE } from './shift-intervals.mjs';

export const WEEKLY_WARNING_MINUTES = 3000;
export const mondayOf = day => addDays(day, -((weekday(day) + 6) % 7));
export const hoursLabel = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Read-only scheduled interval audit, not availability, paid time or legal overtime.
// Breaks are not imported by the bounded CSV format. Their absence is not proof
// of no breaks; interval totals stay labelled as such and completeness stays false.
export function weeklyHoursAudit(day, personId, resolveDay) {
  const start = mondayOf(day), days = [], caps = [];
  const storeId = resolveDay(day)?.store?.id;
  let knownMinutes = 0;
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(start, offset), context = resolveDay(date);
    const { store, record } = context || {}, reasons = [], intervals = [];
    const person = store?.people?.find(p => p.id === personId);
    const shifts = (record?.shifts || []).filter(s => s.personId === personId);
    const assigned = shifts.length > 0 || (record?.on || []).includes(personId);
    if (!store || store.id !== storeId || (store.timezone && store.timezone !== STORE_TIMEZONE)) {
      days.push({ date, knownMinutes: 0, reasons: ['Store identity or timezone unknown'] });
      continue;
    }
    if (!person || !record) reasons.push('Assignment data missing');
    else if (record.unknownNotes?.[personId]) reasons.push('Assignment status unknown');
    else if (!assigned && !(record.off || []).includes(personId)) reasons.push('Assignment status unknown');
    if (shifts.length) {
      for (const shift of shifts) {
        if (shiftProblem(shift, store, date)) reasons.push('Shift duration or identity unknown');
        else intervals.push([shift.startMinute, shift.endMinute]);
      }
    } else if (assigned) {
      const rule = ruleFor(store.rules, date);
      if (Number.isInteger(rule?.open * 60) && Number.isInteger(rule?.close * 60) && rule.open >= 0 && rule.close <= 24 && rule.close > rule.open && localInterval(date,rule.open*60,rule.close*60,store.timezone||STORE_TIMEZONE).ok) intervals.push([rule.open * 60, rule.close * 60]);
      else reasons.push('Shift duration unknown');
    }
    if (assigned && record?.breaksKnown !== true) reasons.push('Break information unavailable');
    const minutes = unionMinutes(intervals);
    knownMinutes += minutes;
    days.push({ date, knownMinutes: minutes, reasons: [...new Set(reasons)] });
    if (Number.isFinite(person?.maxHours)) caps.push({ date, minutes: person.maxHours * 60, confirmed: person.maxHoursSource === 'manager-confirmed' });
  }
  const complete = days.every(d => !d.reasons.length);
  return { storeId, personId, timezone: STORE_TIMEZONE, start, end: addDays(start, 6), knownMinutes, complete, days,
    warning: knownMinutes > WEEKLY_WARNING_MINUTES, excessMinutes: Math.max(0, knownMinutes - WEEKLY_WARNING_MINUTES),
    caps, confirmedCapConflicts: caps.filter(cap => cap.confirmed && knownMinutes > cap.minutes) };
}

export function weeklyHoursText(audit) {
  const total = `${audit.complete ? '' : 'At least '}${hoursLabel(audit.knownMinutes)} entered scheduled interval hours`;
  return `${total}${audit.warning ? `; ${hoursLabel(audit.excessMinutes)} above the 50:00 operational threshold${audit.complete ? '' : ' in known intervals'}` : audit.complete ? '; no above-50 warning' : '; full-week total incomplete'}.`;
}

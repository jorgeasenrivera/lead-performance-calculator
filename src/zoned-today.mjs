// Today, in the store's own time zone, that moves on at midnight there.
//
// A Dashboard left open overnight, or a phone tab the browser put to sleep,
// keeps rendering yesterday unless something tells it the day changed. Timers
// in a sleeping tab are paused or throttled, so the timer alone is not enough:
// waking the tab checks the day again, and the schedule control also reads the
// day afresh at the moment it is pressed (see SchedulerCalendarEntry).
import { useEffect, useState } from 'react';
import { zonedToday } from './scheduler-editor-adapter.mjs';

const HOUR = 3600000;

// How long until the day in `timezone` turns over, read from the wall clock
// there. A day with a clock change is an hour longer or shorter than the wall
// clock says, so the wait is capped at an hour and the caller checks again,
// rather than trusting the estimate across a change.
export function msToNextZonedDay(timezone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
    const n = (type) => Number(parts.find((p) => p.type === type)?.value);
    const elapsed = ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + now.getMilliseconds();
    if (!Number.isFinite(elapsed)) return HOUR;
    return Math.max(1000, Math.min(HOUR, 86400000 - elapsed + 500));
  } catch {
    return HOUR;
  }
}

export function useZonedToday(timezone) {
  const [day, setDay] = useState(() => zonedToday(timezone, new Date()));
  useEffect(() => {
    let timer = 0;
    const check = () => { const next = zonedToday(timezone, new Date()); setDay((prev) => (prev === next ? prev : next)); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { check(); arm(); }, msToNextZonedDay(timezone, new Date())); };
    const wake = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') { check(); arm(); } };
    check(); arm();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
    if (typeof window !== 'undefined') { window.addEventListener('focus', wake); window.addEventListener('pageshow', wake); }
    return () => {
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
      if (typeof window !== 'undefined') { window.removeEventListener('focus', wake); window.removeEventListener('pageshow', wake); }
    };
  }, [timezone]);
  return day;
}

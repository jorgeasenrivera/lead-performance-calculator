import {localInterval, stableLocalDate, STORE_TIMEZONE} from './shift-intervals.mjs';

// Legacy `on` records use store closing hour 24. This is scheduled wall-time
// accounting only, never permission to generate/import an explicit 24:00 shift.
// Midnight-ending transition dates remain unknown pending manual review.
export function knownLegacyStoreInterval(day, start, end, timezone) {
  if (end !== 1440) return localInterval(day, start, end, timezone).ok;
  return timezone === STORE_TIMEZONE && Number.isInteger(start) && start >= 0
    && start < end && stableLocalDate(day, timezone);
}

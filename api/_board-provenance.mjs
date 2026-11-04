/* A report is usable as a store count only when its actual scope is known.
   Import time and the month it was filed under are not report-period evidence.
   This checks shape and scope only; the status marker is not authentication. */
function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(day + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function verifiedBoardCount(report, storeId, month, today) {
  if (!report || report.status !== 'verified' || report.source !== 'store-rollup' || report.storeId !== storeId || !storeId) return null;
  if (!/^\d{4}-\d{2}$/.test(month) || !validDay(today) || !validDay(report.periodStart) || !validDay(report.periodEnd)) return null;
  if (today.slice(0, 7) !== month || report.periodStart !== month + '-01' || report.periodEnd !== today) return null;
  if (!Number.isSafeInteger(report.deliveries) || report.deliveries < 0) return null;
  return report.deliveries;
}

/* Candidate syntax for synthetic fixtures only. The actual report syntax is not
   established; callers must not treat this as evidence about a real report. */
export function parseSyntheticReportPeriod(lines) {
  const matches = (lines || []).map(line => /^Report period: (\d{4}-\d{2}-\d{2}) to\x20(\d{4}-\d{2}-\d{2})$/.exec(String(line).trim())).filter(Boolean);
  if (matches.length !== 1) return null;
  const [, periodStart, periodEnd] = matches[0];
  if (!validDay(periodStart) || !validDay(periodEnd) || periodStart > periodEnd) return null;
  return { periodStart, periodEnd };
}

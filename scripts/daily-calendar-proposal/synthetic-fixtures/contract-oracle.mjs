// A fixture/test oracle, not proposed production validation or component state code.
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const nonnegative = (n) => Number.isFinite(n) && n >= 0;
const canonical = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;

export function assertPublicMonth(payload, expected) {
  const fail = (message) => { throw new Error(`Invalid synthetic endpoint response: ${message}`); };
  if (!sameKeys(payload, ['storeId', 'month', 'days'])) fail('month shape');
  if (payload.storeId !== expected.storeId || payload.month !== expected.month) fail('request identity');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month)) fail('month');
  const [year, month] = payload.month.split('-').map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Array.isArray(payload.days) || payload.days.length !== length) fail('full calendar coverage');
  payload.days.forEach((day, index) => {
    if (!sameKeys(day, ['date', 'status', 'count', 'vehicles', 'asOf'])) fail('day shape');
    if (day.date !== `${payload.month}-${String(index + 1).padStart(2, '0')}`) fail('ordered unique dates');
    if (!sameKeys(day.vehicles, ['new', 'used'])) fail('vehicle shape');
    if (!['provisional', 'missing', 'incomplete', 'conflict'].includes(day.status)) fail('public status');
    const unknownSplit = day.vehicles.new === null && day.vehicles.used === null;
    if (day.status !== 'provisional') {
      if (day.count !== null || !unknownSplit || day.asOf !== null) fail('unknown carries a value');
      return;
    }
    if (!nonnegative(day.count)) fail('provisional count');
    if (!sameKeys(day.asOf, ['timestamp', 'basis']) || !canonical(day.asOf.timestamp)
      || !['report_sent', 'report_received'].includes(day.asOf.basis)) fail('provisional as-of');
    if (!unknownSplit && !(nonnegative(day.vehicles.new) && nonnegative(day.vehicles.used)
      && day.vehicles.new + day.vehicles.used === day.count)) fail('vehicle split');
  });
  return payload;
}

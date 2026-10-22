// Local wall-clock minutes. This bounded preview rejects overnight and DST-change dates.
export const STORE_TIMEZONE = 'America/New_York';
export const storeTimezone = store => store.timezone || STORE_TIMEZONE;
export function validDate(day) {
  return typeof day === 'string' && /^(20\d{2}|2100)-(0[1-9]|1[0-2])-\d{2}$/.test(day) && day >= '2014-01-01' && day <= '2100-12-31' && Number.isFinite(new Date(day + 'T12:00:00Z').getTime()) && new Date(day + 'T12:00:00Z').toISOString().slice(0,10) === day;
}
export function minute(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h,m] = value.split(':').map(Number); return h*60+m;
}
export const timeLabel = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export function stableLocalDate(day, timezone) {
  if (!validDate(day) || timezone !== STORE_TIMEZONE) return false;
  const format = new Intl.DateTimeFormat('en-US',{timeZone:timezone,timeZoneName:'longOffset'});
  const offset = date => format.formatToParts(date).find(p=>p.type==='timeZoneName').value;
  return offset(new Date(day+'T05:00:00Z')) === offset(new Date(new Date(day+'T05:00:00Z').getTime()+24*3600000));
}
export function shiftProblem(shift, store, day) {
  if (shift.storeId !== store.id) return 'Store identity does not match.';
  if (shift.date !== day || !validDate(day) || !validDate(shift.endDate)) return 'Use a real date with a four-digit year.';
  if (shift.timezone !== storeTimezone(store)) return 'Timezone does not match the store.';
  if (shift.endDate !== day) return 'Overnight shifts are not supported in this preview.';
  if (!stableLocalDate(day, shift.timezone)) return 'DST-change dates or this timezone are not supported.';
  if (!Number.isInteger(shift.startMinute) || !Number.isInteger(shift.endMinute) || shift.startMinute < 0 || shift.endMinute >= 1440 || shift.endMinute <= shift.startMinute) return 'Enter an increasing same-day HH:MM interval.';
  return null;
}
export function personIntervals(record, id, rule) {
  const shifts=(record?.shifts || []).filter(s=>s.personId===id);
  return shifts.length ? shifts.map(s=>[s.startMinute,s.endMinute]) : (record?.on || []).includes(id) && rule ? [[rule.open*60,rule.close*60]] : [];
}
export function unionMinutes(intervals) {
  let end=-Infinity,total=0;
  for(const [a,b] of [...intervals].sort((a,b)=>a[0]-b[0])) { if(Number.isFinite(a)&&Number.isFinite(b)&&b>a){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);} }
  return total;
}
export function coverageSegments(rule, record, eligibleIds) {
  const start=rule.open*60,end=rule.close*60;
  const intervals=eligibleIds.flatMap(id=>personIntervals(record,id,rule).map(([a,b])=>({id,start:Math.max(start,a),end:Math.min(end,b)}))).filter(s=>s.end>s.start);
  const points=[...new Set([start,end,...intervals.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
  return points.slice(0,-1).map((a,i)=>({start:a,end:points[i+1],count:new Set(intervals.filter(s=>s.start<=a&&s.end>=points[i+1]).map(s=>s.id)).size}));
}

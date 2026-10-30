// Same-day local minutes. Transition crossings require review, never payroll inference.
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
const localFormat = new Intl.DateTimeFormat('en-CA',{timeZone:STORE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const wallAt = instant => {
  const p=Object.fromEntries(localFormat.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
  return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
};
const dateOffsets=new Map(),intervalCache=new Map();
function instants(day,minute) {
  const midnight=Date.parse(day+'T00:00:00Z'),wall=midnight+minute*60000;
  if(!dateOffsets.has(day)){
    // Enumerate offsets around the date, then round-trip each candidate. This
    // detects both occurrences of a fold and zero occurrences of a gap.
    const offsets=new Set();
    for(let h=-24;h<=48;h++){const t=midnight+h*3600000;offsets.add(wallAt(t)-t);}
    if(dateOffsets.size>=128)dateOffsets.delete(dateOffsets.keys().next().value);
    dateOffsets.set(day,[...offsets]);
  }
  return dateOffsets.get(day).map(offset=>wall-offset).filter(t=>wallAt(t)===wall).sort((a,b)=>a-b);
}
export function localInterval(day,startMinute,endMinute,timezone) {
  const fail=reason=>({ok:false,reason,elapsedMinutes:null});
  if(!validDate(day)||timezone!==STORE_TIMEZONE)return fail('Date or timezone is outside the supported preview.');
  if(!Number.isInteger(startMinute)||!Number.isInteger(endMinute)||startMinute<0||endMinute>=1440||endMinute<=startMinute)return fail('Enter an increasing same-day HH:MM interval.');
  const key=day+':'+startMinute+':'+endMinute;
  if(intervalCache.has(key))return {...intervalCache.get(key)};
  const a=instants(day,startMinute),b=instants(day,endMinute);
  let result;
  if(!a.length||!b.length)result=fail('Nonexistent local time requires manual review.');
  else if(a.length!==1||b.length!==1)result=fail('Ambiguous local time requires manual review.');
  else {
    const elapsedMinutes=(b[0]-a[0])/60000,offset=wallAt(a[0])-a[0];
    let crossing=elapsedMinutes!==endMinute-startMinute;
    // Check every minute of the actual interval, including endpoints. No
    // transition may be hidden inside otherwise unique endpoint mappings.
    for(let t=a[0];!crossing&&t<=b[0];t+=60000)if(wallAt(t)-t!==offset)crossing=true;
    result=crossing?{ok:false,reason:'DST-crossing interval requires manual review.',elapsedMinutes}:{ok:true,reason:null,elapsedMinutes};
  }
  if(intervalCache.size>=512)intervalCache.delete(intervalCache.keys().next().value);
  intervalCache.set(key,Object.freeze(result));return {...result};
}
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
  return localInterval(day,shift.startMinute,shift.endMinute,shift.timezone).reason;
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

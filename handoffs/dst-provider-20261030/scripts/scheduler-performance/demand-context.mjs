import { forecast, weekday } from '../scheduler-proposal/model.mjs';
import { monthDays } from './month-model.mjs';
const known = row => row.state === 'known' && Number.isInteger(row.units) && row.units >= 0;
// Provenance for the existing illustrative range, not a new forecasting policy.
export function dayDemand(history, day) {
  const prior = history.filter(r => r.day < day).sort((a,b)=>a.day.localeCompare(b.day));
  const samples = prior.filter(r=>known(r) && weekday(r.day)===weekday(day)).slice(-8);
  return { estimate:forecast(prior.filter(r=>r.state!=='known'||known(r)),day), count:samples.length,
    first:samples[0]?.day ?? null, last:samples.at(-1)?.day ?? null,
    historyThrough:prior.at(-1)?.day ?? null,
    daysSinceComparable:samples.length ? Math.round((Date.parse(day)-Date.parse(samples.at(-1).day))/86400000) : null };
}
export function monthDemand(history, month) {
  monthDays(month);
  const periods=[...new Set(history.filter(r=>r.day.slice(5,7)===month.slice(5) && r.day.slice(0,7)<month).map(r=>r.day.slice(0,7)))].sort().slice(-3);
  const comparable=periods.map(period=>{
    const records=new Map(history.filter(r=>r.day.startsWith(period+'-')).map(r=>[r.day,r]));
    const dates=monthDays(period), observed=dates.map(d=>records.get(d));
    const recorded=observed.filter(r=>r&&known(r)),closed=observed.filter(r=>r?.state==='closed').length;
    return {month:period,total:recorded.length?recorded.reduce((n,r)=>n+r.units,0):null,known:recorded.length,closed,unknown:dates.length-recorded.length-closed,days:dates.length};
  });
  const complete=comparable.filter(r=>!r.unknown && r.total!==null);
  return {comparable,range:complete.length>=2?{low:Math.min(...complete.map(r=>r.total)),high:Math.max(...complete.map(r=>r.total)),months:complete.length}:null};
}

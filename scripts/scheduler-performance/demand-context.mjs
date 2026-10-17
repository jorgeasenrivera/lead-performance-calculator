import { forecast, weekday } from '../scheduler-proposal/model.mjs';
import { monthDays } from './month-model.mjs';
const known = row => row.state === 'known' && Number.isInteger(row.units) && row.units >= 0;
// Provenance for the existing illustrative range, not a new forecasting policy.
export function dayDemand(history, day) {
  const prior = history.filter(r => r.day < day).sort((a,b)=>a.day.localeCompare(b.day));
  const samples = prior.filter(r=>known(r) && weekday(r.day)===weekday(day)).slice(-8);
  return { average:samples.length>=4?samples.reduce((n,r)=>n+r.units,0)/samples.length:null, estimate:forecast(prior.filter(r=>r.state!=='known'||known(r)),day), count:samples.length,
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

// Descriptive rendering of the existing ranges. This never feeds scheduling or coverage.
export function historicalCalendar(history, month) {
  const days=monthDays(month).map(day=>({day,...dayDemand(history,day)}));
  const supported=days.filter(d=>d.estimate),ceiling=supported.length?Math.max(...supported.map(d=>d.estimate.high)):null;
  return {month:monthDemand(history,month),ceiling,supported:supported.length,days:days.map(d=>{
    const average=d.average;
    // Anchor at real zero and the observed upper range, rather than amplifying tiny differences.
    const level=average===null?null:ceiling===0?0:Math.min(4,Math.floor(average/ceiling*4));
    return {...d,level};
  })};
}

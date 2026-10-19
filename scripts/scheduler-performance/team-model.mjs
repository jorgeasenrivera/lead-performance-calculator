import { validDate } from './shift-intervals.mjs';
const unique = ids => [...new Set(ids)].sort();
export function seedTeams(store) {
  const people=store.people||[];
  const fixtureMembership={p0:['oak'],p1:['oak'],p2:['pine'],p3:['pine'],p4:[],p5:[]};
  return {teams:structuredClone(store.teams||[{id:'oak',name:'Oak team'},{id:'pine',name:'Pine team'}]),memberships:structuredClone(store.memberships||people.map(p=>({storeId:store.id,personId:p.id,teamIds:p.teamIds||fixtureMembership[p.id]||[],unknown:!p.teamIds&&!Object.hasOwn(fixtureMembership,p.id),from:'2014-01-01',to:'2100-12-31',source:{kind:p.teamIds||Object.hasOwn(fixtureMembership,p.id)?'fictional default':'unknown membership'}})))};
}
export function membershipAt(store,personId,day) {
  const entry=(store.memberships||[]).filter(m=>m.storeId===store.id&&m.personId===personId&&m.from<=day&&m.to>=day).at(-1);
  return entry?{...structuredClone(entry),teamIds:unique(entry.teamIds)}:{storeId:store.id,personId,teamIds:[],from:day,to:day,source:{kind:'unknown membership'},unknown:true};
}
export function validateMembership(store,entry) {
  if(entry.storeId!==store.id||!store.people.some(p=>p.id===entry.personId))throw Error('Choose a person in this store.');
  if(!validDate(entry.from)||!validDate(entry.to)||entry.to<entry.from)throw Error('Choose a valid inclusive date range.');
  if(!Array.isArray(entry.teamIds)||entry.teamIds.some(id=>!store.teams.some(t=>t.id===id)))throw Error('Choose known teams in this store.');
  return {...structuredClone(entry),teamIds:unique(entry.teamIds)};
}
export const sameTeams = (a,b) => JSON.stringify(unique(a||[]))===JSON.stringify(unique(b||[]));
export function teamSnapshot(store,day,personIds) {
  return Object.fromEntries(unique(personIds).map(id=>[id,{...membershipAt(store,id,day),date:day}]));
}
export const assignedMembership = (store,record,day,id) => record?.teamSnapshot?.[id]||membershipAt(store,id,day);
export function teamsOnDay(store,record,day,mode='mixed') {
  if(mode==='individual')return [];
  return (store.teams||[]).map(t=>({...t,ids:[...new Set(store.people.filter(p=>assignedMembership(store,record,day,p.id).teamIds.includes(t.id)).map(p=>p.id))]})).filter(t=>t.ids.length);
}
export function absenceKind(record,id) { return record?.off?.includes(id)?record.absences?.[id]?.kind||'off':null; }
export const absenceLabel = kind => ({off:'Scheduled off','legacy-off':'Off, reason unknown (legacy)',vacation:'Vacation',unavailable:'Unavailable',unknown:'Unknown'}[kind]||'Unknown');
export function dayAbsence(store,record,day,id) {
  const kind=absenceKind(record,id);if(kind)return kind;
  const p=store.people.find(p=>p.id===id),weekday=new Date(day+'T12:00:00Z').getUTCDay();
  return Array.isArray(p?.off)&&p.off.includes(weekday)?'unavailable':record?.on?.includes(id)?null:'unknown';
}
export function membershipMismatches(store,record,day) {
  return Object.entries(record?.teamSnapshot||{}).filter(([id,m])=>(!sameTeams(m.teamIds,membershipAt(store,id,day).teamIds)||Boolean(m.unknown)!==Boolean(membershipAt(store,id,day).unknown))).map(([id,original])=>({id,original,current:membershipAt(store,id,day)}));
}

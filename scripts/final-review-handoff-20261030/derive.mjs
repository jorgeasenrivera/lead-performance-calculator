// Local review material only, not a persistence/publication request or authority.
export const VERSION='sage-final-review-material/1';
function snapshot(value,depth=0,budget={n:0}){
 if(depth>40||++budget.n>300000)throw Error('Review material exceeds limits');
 if(value===null||['string','boolean','undefined'].includes(typeof value))return value;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite number');return value;}
 if(typeof value!=='object')throw Error('Plain data required');
 const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
 if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error('Plain data required');
 const out=array?[]:{};
 for(const key of Reflect.ownKeys(value)){
  if(array&&key==='length')continue;
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(typeof key!=='string'||!d.enumerable||!('value' in d))throw Error('Enumerable data properties required');
  if(array&&!/^(0|[1-9]\d*)$/.test(key))throw Error('Array indices required');
  Object.defineProperty(out,key,{value:snapshot(d.value,depth+1,budget),enumerable:true,writable:false,configurable:false});
 }
 if(array&&out.length!==value.length)throw Error('Sparse array');
 if(array)for(let i=0;i<out.length;i++)if(!Object.hasOwn(out,i))throw Error('Sparse array');
 return Object.freeze(out);
}
// Tagged exact encoding preserves undefined, negative zero, property and interval order.
function encode(x){if(x===undefined)return ['undefined'];if(x===null)return ['null'];if(typeof x==='number')return ['number',Object.is(x,-0)?'-0':String(x)];if(typeof x!=='object')return [typeof x,x];return [Array.isArray(x)?'array':'object',Object.keys(x).map(k=>[k,encode(x[k])])];}
const key=x=>JSON.stringify(encode(x));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function deriveFinalReview(material,{enabled=false}={}){
 if(!enabled)return {version:VERSION,state:'disabled',publicationAuthorized:false};
 const preserved=snapshot(material),issues=[];
 const issue=(path,code)=>issues.push({path,code});
 const result=preserved?.result,context=preserved?.context,p=result?.proposal;
 if(!object(context)||!object(p)||typeof context.storeId!=='string'||!context.storeId||context.storeId!==p.storeId||context.month!==result.month||context.month!==p.month||!/^\d{4}-(0[1-9]|1[0-2])$/.test(context.month)||!Number.isSafeInteger(context.principalEpoch)||context.principalEpoch<0||context.timezone!=='America/New_York'||!Array.isArray(result.people)||result.people.some(x=>!object(x)||typeof x.id!=='string'||!x.id)||new Set(result.people.map(x=>x.id)).size!==result.people.length||!object(p.records)||!Array.isArray(p.days))throw Error('Explicit scoped review material required');
 const ids=new Set(result.people.map(x=>x.id)),projection=result.people.map(x=>({personId:x.id,days:[]})),proposedOff=[];
 const states=new Map();
 for(const detail of p.days){if(!object(detail)||!dateOK(detail.day)||!detail.day.startsWith(context.month+'-')||states.has(detail.day))throw Error('Unique scoped day details required');states.set(detail.day,detail);}
 for(const [date,r] of Object.entries(p.records)){
  const at='records.'+date,detail=states.get(date);
  if(!dateOK(date)||!date.startsWith(context.month+'-')||!detail||!['open','closed','unknown'].includes(detail.state)||!object(r)||!Array.isArray(r.on)||!Array.isArray(r.off)||!Array.isArray(r.shifts)){issue(at,'record-or-day-state-unresolved');continue;}
  if(['absences','unknownNotes','teamSnapshot'].some(k=>Object.hasOwn(r,k)&&!object(r[k]))){issue(at,'metadata-unresolved');continue;}
  if(new Set(r.on).size!==r.on.length||new Set(r.off).size!==r.off.length||[...r.on,...r.off,...r.shifts.map(x=>x?.personId),...Object.keys(r.absences||{}),...Object.keys(r.unknownNotes||{}),...Object.keys(r.teamSnapshot||{})].some(id=>!ids.has(id))){issue(at,'person-reference-unresolved');continue;}
  for(const person of projection){
   const id=person.personId,path=at+'.'+id,shifts=r.shifts.filter(x=>x.personId===id),on=r.on.includes(id),off=r.off.includes(id),unknown=Object.hasOwn(r.unknownNotes||{},id),hasAbsence=Object.hasOwn(r.absences||{},id),absence=r.absences?.[id];
   let status,intervals=[];
   if((on||shifts.length)&&(off||unknown||hasAbsence||detail.state!=='open')||unknown&&(off||hasAbsence)){issue(path,'conflicting-state');continue;}
   if(shifts.length){
    if(!on){issue(path,'shift-without-assignment');continue;}
    status='working';let end=-Infinity;
    for(const s of shifts){intervals.push([s.startMinute,s.endMinute]);if(s.storeId!==context.storeId||s.personId!==id||s.date!==date||s.endDate!==date||s.timezone!==context.timezone||!Number.isFinite(s.startMinute)||!Number.isFinite(s.endMinute)||s.startMinute<0||s.endMinute>1440||s.endMinute<=s.startMinute||s.startMinute<end)issue(path,'interval-scope-or-order-unresolved');if(!Number.isInteger(s.startMinute)||!Number.isInteger(s.endMinute)||s.endMinute===1440)issue(path,'temporal-publication-unsupported');end=s.endMinute;}
   }else if(on){issue(path,'working-intervals-missing');continue;}
   else if(hasAbsence||off){
    if(!off||!object(absence)||!['off','vacation','unavailable','unknown'].includes(absence.kind)||!object(absence.source)||typeof absence.source.kind!=='string'||!absence.source.kind){issue(path,'explicit-absence-kind-and-provenance-required');continue;}
    status=absence.kind;
    if(status==='off')proposedOff.push({storeId:context.storeId,month:context.month,date,personId:id,kind:'off',absence});
   }else if(unknown)status='unknown';
   else if(detail.state==='closed')status='closed';
   else if(detail.state==='unknown')status='unknown';
   else {status='unentered';issue(path,'person-day-unentered');}
   if(status==='unknown')issue(path,'unknown-day');
   if(r.teamSnapshot?.[id]?.unknown===true)issue(path,'unknown-membership');
   person.days.push({date,status,timezone:context.timezone,intervals});
  }
 }
 for(const date of states.keys())if(!Object.hasOwn(p.records,date))issue('days.'+date,'record-missing');
 const count=new Date(Date.UTC(Number(context.month.slice(0,4)),Number(context.month.slice(5)),0)).getUTCDate();
 if(states.size!==count)issue('days','incomplete-month');
 // Keep complete diagnostics in preserved; coverage and other policy issues remain visible.
 if(p.status!=='covered')issue('proposal','incomplete-proposal');
 return snapshot({version:VERSION,state:'derived',trusted:false,publicationAuthorized:false,preserved,materialKey:key(preserved),proposedOff,projection,issues});
}
export function matchesFinalReview(derived,current){try{return derived?.version===VERSION&&derived.state==='derived'&&derived.materialKey===key(snapshot(current));}catch{return false;}}

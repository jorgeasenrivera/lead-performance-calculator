import {validDate} from '../scripts/scheduler-performance/persistence/identity.mjs';
import {createReportedAuthAdapter} from './reported-auth.mjs';
export const MANUAL_SCHEDULER_ENABLED = false;
const failure=message=>Object.assign(Error(message),{manualSafe:true});
// Explicit source switch stays false. No runtime setting or live pilot is changed.
export function createManualClient(client,{fetchImpl=fetch,timeoutMs=4000}={}){
 const auth=createReportedAuthAdapter(client);
 return {auth,dispose:()=>auth.dispose(),async send(body,{signal}={}){
  const epoch=auth.getSnapshot().principalEpoch,abort=new AbortController();
  const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)abort.abort();
  const timer=setTimeout(cancel,timeoutMs);
  try{
   const token=await auth.getAccessToken({expectedEpoch:epoch,signal:abort.signal});if(!token)throw failure('Schedule access unavailable.');
   const r=await fetchImpl('/api/scheduler-manual',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal});
   if(!r.ok)throw Object.assign(failure(r.status===403?'Schedule access is not approved.':r.status===409?'The schedule changed. Reload and review it again.':r.status===422?'Review is incomplete. Check assignments, hours, limits and boundary weeks.':'Schedule unavailable. Your changes have not been confirmed.'),{definite:[400,401,403,409,413,422].includes(r.status)});
   let result;try{result=await r.json();}catch{throw failure('Schedule response could not be confirmed.');}if(auth.getSnapshot().principalEpoch!==epoch||abort.signal.aborted)throw failure('Schedule access changed.');return result;
  }catch(error){if(error?.manualSafe)throw error;throw failure('Schedule response could not be confirmed.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }};
}

// The server remains authoritative. Reject malformed display data before rendering.
export function ownScheduleResult(result,month){
 const fields=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
 const fail=()=>{throw failure('Schedule response could not be confirmed.');};
 if(!fields(result,['version','revision','days'])||result.version!=='scheduler-own/2'||!Number.isSafeInteger(result.revision)||result.revision<0||!Array.isArray(result.days)||result.days.length>31)fail();
 const seen=new Set();
 for(const d of result.days){
  if(!fields(d,['date','status','intervals','timezone'])||!validDate(d.date)||!d.date.startsWith(month+'-')||seen.has(d.date)||d.timezone!=='America/New_York'||!['working','off','vacation','unavailable','unknown','closed','unentered'].includes(d.status)||!Array.isArray(d.intervals)||d.intervals.length>200)fail();
  seen.add(d.date);
  if((d.status==='working')!==!!d.intervals.length)fail();
  for(const p of d.intervals)if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<0||p[1]>1440||p[1]<=p[0])fail();
 }
 if(result.revision===0&&result.days.length)fail();
 return {ok:true,revision:result.revision,schedule:result.days};
}

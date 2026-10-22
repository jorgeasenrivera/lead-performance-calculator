import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createManualClient,ownScheduleResult} from './scheduler-manual-client.mjs';
import {addManualShift,removeManualShift,markManualOff} from './scheduler-manual-model.mjs';
import {validateDraft} from '../scripts/scheduler-performance/persistence/validate.mjs';
import ManualSetup from './scheduler-manual-setup.jsx';
import {registerLeaveGuard} from './scheduler-load-context.mjs';
import {createRefresh} from '../scripts/scheduler-delivery-local/refresh.mjs';
const time=m=>Number.isInteger(m)?`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`:`${m} minutes after midnight`;
const noSubscription=()=>()=>{};
const emptyAuth=Object.freeze({principalEpoch:0,disposed:true});
const getEmptyAuth=()=>emptyAuth;
function useClient(client){
 const [session,setSession]=useState(null);
 useEffect(()=>{
  const api=createManualClient(client);setSession({client,api});
  return()=>api.dispose();
 },[client]);
 const auth=session?.api.auth;
 const snapshot=useSyncExternalStore(auth?.subscribe||noSubscription,auth?.getSnapshot||getEmptyAuth,getEmptyAuth);
 return session?.client===client&&!snapshot.disposed?{api:session.api,epoch:snapshot.principalEpoch}:null;
}
export function ManualManagerEntry({client,storeId,store,data,isOff}){
 const session=useClient(client);
 if(!session||session.api.auth.getSnapshot().disposed)return <p>Loading schedule access…</p>;
 const {api,epoch}=session;
 return <ManualManager key={`${storeId}:${epoch}`} api={api} epoch={epoch} storeId={storeId} store={store} data={data} isOff={isOff}/>;
}
function ManualManager({api,epoch,storeId,store,data,isOff}){
 const [setup,setSetup]=useState(false);
 const [month,setMonth]=useState(''),[draft,setDraft]=useState(null),[rev,setRev]=useState(0),[dirty,setDirty]=useState(false),[review,setReview]=useState(null),[notice,setNotice]=useState('Choose a month to load its saved settings.'),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[day,setDay]=useState(''),[person,setPerson]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[replace,setReplace]=useState(false),[role,setRole]=useState('');
 const alive=useRef(true),generation=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{
  if(!dirty&&!pending)return;
  const warn=e=>{e.preventDefault();e.returnValue='';};
  const stop=registerLeaveGuard(()=>pending?false:globalThis.confirm('Discard unsaved schedule changes?'));
  window.addEventListener('beforeunload',warn);return()=>{stop();window.removeEventListener('beforeunload',warn);};
 },[dirty,pending]);
 const scope={storeId,month};
 async function execute(command){
  const ticket=++generation.current;setBusy(true);setNotice('Working…');
  try{
   const result=await api.send(command);if(!alive.current||ticket!==generation.current)return;
   if(command.action==='load'){
    const r=result?.result;if(r?.kind!=='draft'||!Number.isSafeInteger(r.revision))throw Error('Invalid schedule response.');
    if(r.schedule&&!validateDraft(r.schedule,scope).ok)throw Error('Invalid saved schedule.');
    setDraft(r.schedule);setRev(r.revision);setDirty(false);setReview(null);setNotice(r.schedule?'Draft loaded. Changes stay private until published.':'No saved month settings. Existing hours and availability must be configured before scheduling.');
   }else if(command.action==='save'){
    const head=result?.result?.head;if(!Number.isSafeInteger(head?.draftRev)||head.draftRev<=rev)throw Error('Save was not confirmed.');
    setRev(head.draftRev);setDirty(false);setReview(null);setNotice('Draft saved. Staff cannot see these changes yet.');
   }else if(command.action==='review'){
    if(result?.version!=='scheduler-manual-review/1'||result.draftRevision!==rev||!/^[a-f0-9]{64}$/.test(result.contextId)||!Array.isArray(result.days))throw Error('Review was not confirmed.');
    setReview(result);setNotice('Review ready. Check the schedule below, then publish.');
   }else{
    const head=result?.result?.head;if(!Number.isSafeInteger(head?.publishedRev))throw Error('Publication was not confirmed.');
    setRev(head.draftRev);setReview(null);setNotice(`Published revision ${head.publishedRev}. Staff delivery has not been measured here.`);
   }
   setPending(null);
  }catch(error){if(alive.current&&ticket===generation.current){setNotice(error.message);if(['save','publish'].includes(command.action)&&!error.definite)setPending(command);else setPending(null);}}
  finally{if(alive.current&&ticket===generation.current)setBusy(false);}
 }
 function edit(fn){try{setDraft(fn(draft));setDirty(true);setReview(null);setNotice('Unsaved draft changes.');}catch(e){setNotice(e.message);}}
 const locked=busy||!!pending;
 if(setup)return <ManualSetup api={api} epoch={epoch} store={store} data={data} isOff={isOff} month={month} onClose={()=>{setSetup(false);setDraft(null);setReview(null);setNotice('Setup closed. Load the month to enter shifts.');}}/>;
 return <section className="panel" aria-label="Manual schedule">
  <h3>Make schedule</h3><label>Month <input type="month" value={month} disabled={locked||dirty} onChange={e=>{generation.current++;setMonth(e.target.value);setDay('');setDraft(null);setReview(null);}}/></label>
  <button type="button" className="btn" disabled={!month||locked||dirty} onClick={()=>execute({action:'load',...scope})}>Load month</button>
  <button type="button" className="btn" disabled={!month||locked||dirty} onClick={()=>setSetup(true)}>Set up hours, people and teams</button>
  <p role="status">{notice}</p>
  {pending&&<button type="button" className="btn" disabled={busy} onClick={()=>execute(pending)}>Retry the same request</button>}
  {draft&&<>
   <p>Saved draft revision {rev}. Times use {draft.store.timezone}. Enter each open day as shifts or off for every person. Save before leaving this screen.</p>
   <fieldset disabled={locked}><legend>Add an individual shift</legend>
    <label>Date <input type="date" value={day} min={`${month}-01`} max={`${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()}`} onChange={e=>setDay(e.target.value)}/></label>
    <label>Person <select value={person} onChange={e=>setPerson(e.target.value)}><option value="">Choose a person</option>{draft.store.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Start <input type="time" value={start} onChange={e=>setStart(e.target.value)}/></label><label>End <input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label>Configured shift role, if required <input value={role} maxLength={40} onChange={e=>setRole(e.target.value)}/></label>
    <label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>Replace this person’s recorded absence on this date</label>
    <button type="button" className="btn" disabled={!day||!person||!start||!end} onClick={()=>edit(d=>addManualShift(d,{day,personId:person,start,end,role,replaceAbsence:replace}))}>Add shift</button>
    <button type="button" className="btn" disabled={!day||!person} onClick={()=>edit(d=>markManualOff(d,day,person))}>Mark off</button>
   </fieldset>
   <ul>{Object.entries(draft.overrides).sort().flatMap(([date,r])=>(r.shifts||[]).map((s,i)=><li key={`${date}:${i}`}>{date}: {draft.store.people.find(p=>p.id===s.personId)?.name} {time(s.startMinute)}–{time(s.endMinute)} {s.role||''} <button type="button" disabled={locked} onClick={()=>edit(d=>removeManualShift(d,date,i))}>Remove this shift</button></li>))}</ul>
   <ul>{Object.entries(draft.overrides).sort().flatMap(([date,r])=>(r.off||[]).map(id=><li key={`${date}:off:${id}`}>{date}: {draft.store.people.find(p=>p.id===id)?.name} {r.absences?.[id]?.kind||'off'}</li>))}</ul>
   <button type="button" className="btn" disabled={locked||!dirty} onClick={()=>execute({action:'save',...scope,draft,baseRev:rev,requestId:crypto.randomUUID()})}>Save private draft</button>
   <button type="button" className="btn" disabled={locked||!dirty} onClick={()=>execute({action:'load',...scope})}>Discard local changes and reload</button>
   <button type="button" className="btn" disabled={locked||dirty} onClick={()=>execute({action:'review',...scope,requestId:crypto.randomUUID()})}>Review for publication</button>
   {review&&<><h4>Ready to publish</h4>{review.days.map(p=><div key={p.personId}><b>{draft.store.people.find(x=>x.id===p.personId)?.name}</b><ul>{p.days.map(d=><li key={d.date}>{d.date}: {d.status} {d.intervals.map(([a,b])=>`${time(a)}–${time(b)}`).join(', ')}</li>)}</ul></div>)}<button type="button" className="btn" disabled={locked||dirty} onClick={()=>execute({action:'publish',...scope,contextId:review.contextId,requestId:crypto.randomUUID()})}>Publish this reviewed schedule</button></>}
  </>}
 </section>;
}
export function OwnPublishedSchedule({client,storeId,month}){
 const session=useClient(client);
 if(!session||session.api.auth.getSnapshot().disposed)return <p>Loading schedule access…</p>;
 const {api,epoch}=session;
 return <OwnScheduleSession key={`${storeId}:${month}:${epoch}`} api={api} storeId={storeId} month={month}/>;
}
function OwnScheduleSession({api,storeId,month}){
 const [state,setState]=useState({status:'loading'});
 useEffect(()=>{
  setState({status:'loading'});
  const controller=createRefresh({read:async(scope,options)=>{const result=await api.send({action:'own',...scope},options);return ownScheduleResult(result,scope.month);},render:setState});
  controller.select({storeId,month});
  const visibility=()=>controller.foreground(document.visibilityState==='visible');
  const online=()=>controller.reconnect();visibility();document.addEventListener('visibilitychange',visibility);window.addEventListener('online',online);
  return()=>{controller.dispose();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',online);};
 },[api,storeId,month]);
 if(state.status!=='ready')return <p role="status">{state.status==='loading'?'Loading your published schedule…':'Your published schedule is unavailable.'}</p>;
 return <section aria-label="My published schedule"><h3>My published schedule</h3><p>Revision {state.revision}</p>{!state.revision?<p>No schedule published yet.</p>:<ul>{state.schedule.map(d=><li key={d.date}>{d.date}: {d.status} {d.intervals.map(([a,b])=>`${time(a)}–${time(b)}`).join(', ')} {d.timezone}</li>)}</ul>}</section>;
}

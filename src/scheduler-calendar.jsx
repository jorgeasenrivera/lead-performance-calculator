import {Component,lazy,Suspense,useId,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import css from './scheduler-calendar.css?inline';
import {calendarCells,monthText,STORE_TIME_ZONE} from './scheduler-calendar-model.mjs';
import {createLegacyScheduleResolver,editorStore,zonedToday} from './scheduler-editor-adapter.mjs';
import {currentReportedAuth,registerLeaveGuard,trustedFor} from './scheduler-load-context.mjs';
import {useReportedMonth} from './use-reported-month.mjs';
import {createLocalManualDraftConnection,createPilotDraftConnection,manualDraftView} from './scheduler-manual-setup.mjs';
import {validMonth} from '../scripts/scheduler-performance/month-model.mjs';
import {timeLabel} from '../scripts/scheduler-performance/shift-intervals.mjs';

const Editor=lazy(()=>import('./scheduler-editor.jsx'));
const EMPTY=Object.freeze({principalEpoch:null,sessionReady:false,disposed:true});
const NO_AUTH={subscribe:()=>()=>{},getSnapshot:()=>EMPTY,getAccessToken:()=>Promise.resolve(null)};
const listeners=new Set(),entries=new Map(),guard={current:null};
let state=Object.freeze({open:false,visible:false,props:null}),owner=null,container=null,authOff=null;
const snapshot=()=>state;
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const publish=next=>{state=Object.freeze(next);for(const fn of [...listeners])fn();};
const valid=props=>{
  if(!props)return false;
  const auth=currentReportedAuth(),s=auth?.getSnapshot();
  return Boolean(auth && s?.sessionReady===true && s.disposed!==true
    && props.principalEpoch===s.principalEpoch && props.canOpenStore?.(props.store.id)===true
    && trustedFor(props.data,props.store.id,auth).ok);
};
function closePlan(){
  // Hide and retire synchronously before a sign-in or navigation schedules React.
  if(container){container.style.visibility='hidden';container.setAttribute('inert','');}
  guard.current?.retire?.();guard.current=null;authOff?.();authOff=null;
  if(!state.open)return;
  publish({open:false,visible:false,props:null});
  const entry=[...entries.values()].at(-1);
  if(entry)queueMicrotask(()=>{if(!state.open)entry.focus();});
}
function requestClose(){
  const message=guard.current?.hasUnconfirmedSave?.()?'A save request may already have completed. Close and clear its local recovery state?':'Close the editor and discard this page’s unsaved changes?';
  if(guard.current?.hasDraft() && !window.confirm(message))return false;
  closePlan();return true;
}
function openPlan(props){
  if(!valid(props) || entries.get(props.entryId)?.storeId!==props.store.id)return;
  if(!owner){
    container=document.createElement('div');container.dataset.schedulerPlannerHost='';document.body.appendChild(container);
    owner=createRoot(container);owner.render(<PlannerHost/>);
  }
  if(state.open && valid(state.props) && state.props?.store.id===props.store.id){
    container.style.visibility='';container.removeAttribute('inert');publish({...state,visible:true});return;
  }
  if(state.open)closePlan();
  container.style.visibility='';container.removeAttribute('inert');
  const auth=currentReportedAuth();authOff?.();authOff=auth.subscribe(()=>{if(!valid(state.props))closePlan();});
  publish({open:true,visible:true,props});
}
function attach(id,entry){
  entries.set(id,entry);
  if(!state.open)return;
  if(state.props.store.id!==entry.storeId || !valid(state.props)){closePlan();return;}
  container.style.visibility='';container.removeAttribute('inert');
  publish({...state,visible:true});
}
function detach(id){
  entries.delete(id);
  if(!state.open || entries.size)return;
  // The app owner, auth boundary or confirmed navigation retires the draft.
  // A responsive entry swap only hides it, with no timer that could lose edits.
  if(container){container.style.visibility='hidden';container.setAttribute('inert','');}
  publish({...state,visible:false});
}

class EditorBoundary extends Component{
  constructor(props){super(props);this.state={failed:false};}
  static getDerivedStateFromError(){return{failed:true};}
  render(){return this.state.failed?<p role="alert">The editor could not open. Close it and try again.</p>:this.props.children;}
}

function PlannerHost(){
  const view=useSyncExternalStore(subscribe,snapshot,snapshot);
  const auth=currentReportedAuth()||NO_AUTH;
  useSyncExternalStore(auth.subscribe,auth.getSnapshot,auth.getSnapshot);
  const close=useRef(null);
  const session=useRef(null),[draft,setDraft]=useState(null),[sourceReview,setSourceReview]=useState(null);
  const props=view.props;
  const connection=useMemo(()=>view.open&&valid(props)?createLocalManualDraftConnection({
    selection:{mode:import.meta.env.MODE,calendarFlag:import.meta.env.VITE_SCHEDULER_CALENDAR,draftFlag:import.meta.env.VITE_SCHEDULER_DRAFT_LOCAL,origin:window.location.origin},
    auth,fetchImpl:window.fetch.bind(window),requestId:()=>window.crypto.randomUUID(),
  })||createPilotDraftConnection({
    selection:{mode:import.meta.env.MODE,calendarFlag:import.meta.env.VITE_SCHEDULER_CALENDAR,pilotFlag:import.meta.env.VITE_SCHEDULER_DRAFT_PILOT,pilotStoreId:import.meta.env.VITE_SCHEDULER_DRAFT_PILOT_STORE_ID,storeId:props?.store?.id,origin:window.location.origin},
    auth,fetchImpl:window.fetch.bind(window),requestId:()=>window.crypto.randomUUID(),
  }):null,[view.open,props?.key,auth]);
  const current=s=>Boolean(s&&session.current===s&&!s.closed&&valid(s.props));
  const refresh=()=>{
    const s=session.current;if(!current(s))return;
    const month=s.api.currentViewMonth();if(!validMonth(month))return;
    setDraft({...manualDraftView(s.binding.getSnapshot(),month,s.errors.get(month)),key:s.props.key});
    if(s.review&&s.review.month!==month)s.review=null;
    setSourceReview(previous=>previous&&previous.month!==month?null:previous);
  };
  const run=(kind)=>{
    const s=session.current;if(!current(s))return;
    const month=s.api.currentViewMonth();if(!validMonth(month))return;
    s.errors.delete(month);s.requested.add(month);s.review=null;setSourceReview(null);
    let action;try{action=s.binding[kind](month);}catch(error){s.errors.set(month,error?.code||'unavailable');}
    refresh();
    Promise.resolve(action).catch(error=>{if(current(s))s.errors.set(month,error?.code||'unavailable');}).finally(()=>{if(current(s))refresh();});
  };
  const ready=api=>{
    if(!connection||!valid(props))return;
    let binding;try{binding=api.connectDraft(connection);}catch{setDraft({key:props.key,message:'Draft connection unavailable.',canLoad:false,canSave:false,canRetry:false,canReview:false});return;}
    const s={api,binding,props,closed:false,errors:new Map(),requested:new Set(),review:null};session.current=s;
    const off=binding.subscribe(refresh);refresh();
    const month=api.currentViewMonth();if(validMonth(month))run('load');
    return()=>{if(s.closed)return;s.closed=true;s.review=null;off();s.errors.clear();s.requested.clear();if(session.current===s){session.current=null;setDraft(null);setSourceReview(null);}};
  };
  const summary=()=>{
    const s=session.current;if(!current(s))return;
    const month=s.api.currentViewMonth();refresh();
    // The editor summary also emits today's month. Read its actual view, and
    // make at most one automatic read for each visible month in this lifetime.
    if(validMonth(month)&&!s.requested.has(month))run('load');
  };
  const reviewSources=()=>{
    const s=session.current;if(!current(s))return;
    const month=s.api.currentViewMonth();if(!validMonth(month))return;
    if(!manualDraftView(s.binding.getSnapshot(),month,s.errors.get(month)).canReview)return;
    const checked=s.api.reviewMaterialization(month);
    if(checked?.ok!==true){s.errors.set(month,checked?.reason||'source-review-unavailable');refresh();return;}
    s.review={key:s.props.key,month,token:checked.review};setSourceReview(s.review);
  };
  const includeSources=()=>{
    const s=session.current,r=s?.review;if(!current(s)||!r||r.key!==s.props.key||r.month!==s.api.currentViewMonth())return;
    if(!manualDraftView(s.binding.getSnapshot(),r.month,s.errors.get(r.month)).canReview)return;
    s.review=null;
    const result=s.api.applyMaterialization(r.token);setSourceReview(null);
    if(result?.ok!==true)s.errors.set(r.month,result?.reason||'source-review-changed');else s.errors.delete(r.month);
    refresh();
  };
  useLayoutEffect(()=>{
    if(!view.open)return;
    const off=registerLeaveGuard(()=>{
      const message=guard.current?.hasUnconfirmedSave?.()?'A save request may already have completed. Leave and clear its local recovery state?':'Leave this page and discard its unsaved changes?';
      if(guard.current?.hasDraft() && !window.confirm(message))return false;
      closePlan();return true;
    },closePlan);
    const before=event=>{if(guard.current?.hasDraft()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',before);
    return()=>{off();window.removeEventListener('beforeunload',before);};
  },[view.open]);
  const lease=useMemo(()=>({isCurrent:()=>valid(props)}),[props]);
  if(!view.open || !props || !valid(props))return null;
  const shown=connection&&draft?.key===props.key?draft:null;
  return <ScheduleDialog hidden={!view.visible} closeRef={close} onClose={requestClose} storeName={props.store.name}
    draft={shown} onDraftAction={run} onReviewSources={reviewSources} sourceReview={sourceReview?.key===props.key?sourceReview:null}
    onIncludeSources={includeSources} onCancelSources={()=>{if(session.current)session.current.review=null;setSourceReview(null);}} people={props.data.roster}>
    <EditorBoundary key={props.key}>
      <Suspense fallback={<p role="status">Opening the planner.</p>}>
        <Editor {...props} preview={false} localDraft={true} lease={lease} guardRef={guard} onClose={closePlan}
          draftCodec={connection?.codec} onReady={ready} onSummary={summary} onDraftStatus={refresh}
          onBoundaryTab={()=>close.current?.focus()}/>
      </Suspense>
    </EditorBoundary>
  </ScheduleDialog>;
}

function ScheduleDialog({hidden,closeRef,onClose,storeName,children,draft,onDraftAction,onReviewSources,sourceReview,onIncludeSources,onCancelSources,people}){
  const box=useRef(null);
  useLayoutEffect(()=>{
    const was=document.body.style.overflow;document.body.style.overflow='hidden';
    const old=new Map();
    const hold=node=>{if(node!==container && node.nodeType===1 && !node.hasAttribute('inert')){old.set(node,true);node.setAttribute('inert','');}};
    [...document.body.children].forEach(hold);
    const observer=new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)hold(node);});
    observer.observe(document.body,{childList:true});
    const key=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();onClose();}
      if(event.key==='Tab' && document.activeElement===closeRef.current && event.shiftKey){
        event.preventDefault();box.current?.querySelector('iframe')?.focus();
      }
    };
    window.addEventListener('keydown',key,true);closeRef.current?.focus();
    return()=>{observer.disconnect();window.removeEventListener('keydown',key,true);document.body.style.overflow=was;for(const node of old.keys())if(node.isConnected)node.removeAttribute('inert');};
  },[]);
  useLayoutEffect(()=>{if(!hidden && !box.current?.contains(document.activeElement))closeRef.current?.focus();},[hidden]);
  return createPortal(<div className="sc-scrim" style={hidden?{display:'none'}:undefined} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <style>{css}</style>
    <section className="sc-planner-dialog" ref={box} role="dialog" aria-modal="true" aria-label={`${storeName}, schedule`}>
      <header className="sc-dialog-bar"><h2>{storeName}</h2><span>{draft?'Local draft':'Not saved'}</span><button type="button" ref={closeRef} className="sc-close" onClick={onClose}>Close</button></header>
      {draft&&<div className="sc-draft-controls" data-draft-state={draft.phase}>
        <p role="status" aria-live="polite">{draft.month?monthText(draft.month)+': ':''}{draft.message}</p>
        <button type="button" disabled={!draft.canLoad} onClick={()=>onDraftAction('load')}>Load draft</button>
        <button type="button" disabled={!draft.canSave} onClick={()=>onDraftAction('save')}>Save draft</button>
        {draft.canRetry&&<button type="button" onClick={()=>onDraftAction('retry')}>Retry same save</button>}
        <button type="button" disabled={!draft.canReview} onClick={onReviewSources}>Review existing schedule</button>
      </div>}
      {draft&&sourceReview&&<section className="sc-source-review" aria-label="Review existing schedule facts">
        <h3>Include these recorded facts in this draft?</h3><p>These are the source facts captured when you opened the store. No working hours are inferred. This does not save the draft.</p>
        <ul>{sourceReview.token.dates.map(date=>{const r=sourceReview.token.records[date],name=id=>people?.find(p=>p.id===id)?.name||id;
          return <li key={date}><strong>{date}</strong><div>Off: {(r.off||[]).map(name).join(', ')||'None recorded'}</div>
            <div>Unknown: {Object.keys(r.unknownNotes||{}).map(name).join(', ')||'None recorded'}</div>
            <div>Working intervals: {(r.shifts||[]).map(s=>name(s.personId)+' '+timeLabel(s.startMinute)+' to '+timeLabel(s.endMinute)).join(', ')||'None supplied'}</div></li>;
        })}</ul>
        <button type="button" onClick={onIncludeSources}>Include reviewed facts</button><button type="button" onClick={onCancelSources}>Cancel</button>
      </section>}
      <div className="sc-planner-body">{children}</div>
    </section>
  </div>,container);
}

export function SchedulerCalendarEntry({store,data,principalEpoch=null,canOpenStore,layout='panel'}){
  const auth=currentReportedAuth()||NO_AUTH;
  const identity=useSyncExternalStore(auth.subscribe,auth.getSnapshot,auth.getSnapshot);
  const button=useRef(null),id=useId();
  const [entryError,setEntryError]=useState(false);
  const timezone=store?.timezone||STORE_TIME_ZONE;
  const today=zonedToday(timezone,new Date()),month=today?.slice(0,7);
  const trusted=Boolean(store && identity.sessionReady===true && principalEpoch===identity.principalEpoch
    && canOpenStore?.(store.id)===true && trustedFor(data,store.id,auth).ok);
  const reported=useReportedMonth({auth,storeId:store?.id||null,loadedStoreId:trusted?store.id:null,month:month||null,active:trusted});
  useLayoutEffect(()=>{
    attach(id,{storeId:store?.id,focus:()=>button.current?.focus()});
    return()=>detach(id);
  },[id,store?.id]);
  useLayoutEffect(()=>{if(!trusted && state.open && state.props?.store.id===store?.id)closePlan();},[trusted,store?.id]);
  const open=()=>{
    if(!trusted || !today)return;
    try{
      const copied=structuredClone(data),scoped=editorStore(store,copied,timezone);
      const resolver=createLegacyScheduleResolver({stores:[scoped],snapshots:[{storeId:store.id,revision:Number.isSafeInteger(data.rev)?data.rev:'unversioned',data:copied}],startDate:'2014-01-01',endDate:'2100-12-31'});
      setEntryError(false);
      openPlan({store,data,timezone,now:()=>new Date(),principalEpoch,canOpenStore,dataEpoch:identity.principalEpoch,entryId:id,
        explicitAssignmentForDay:resolver.explicitAssignmentForDay,key:JSON.stringify([store.id,identity.principalEpoch,Date.now()])});
    }catch{setEntryError(true);}
  };
  return <div className="sc-entry" data-layout={layout} data-delivery-status={reported.status}>
    <style>{css}</style>
    <button type="button" ref={button} className="sc-toggle" aria-haspopup="dialog" disabled={!trusted || !today} onClick={open}
      title={trusted?'Open schedule':'This sign-in’s store data is not ready.'}>
      <span>{month?monthText(month):'Calendar'}</span><span className="sc-entry-map" aria-hidden="true">{month?calendarCells(month).map((day,i)=><i key={day||i} className={!day?'blank':day===today?'today':''}>{day?Number(day.slice(-2)):''}</i>):null}</span>
      <span>Calendar</span>
    </button>
    {entryError&&trusted?<p role="status">The schedule inputs need review.</p>:null}
  </div>;
}

export default SchedulerCalendarEntry;

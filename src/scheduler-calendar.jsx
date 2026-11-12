import {Component,lazy,Suspense,useId,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import css from './scheduler-calendar.css?inline';
import {calendarCells,monthText,STORE_TIME_ZONE} from './scheduler-calendar-model.mjs';
import {createLegacyScheduleResolver,editorStore,zonedToday} from './scheduler-editor-adapter.mjs';
import {currentReportedAuth,registerLeaveGuard,trustedFor} from './scheduler-load-context.mjs';
import {useReportedMonth} from './use-reported-month.mjs';

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
  if(guard.current?.hasDraft() && !window.confirm('Close the editor and discard this page’s unsaved changes?'))return false;
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
  useLayoutEffect(()=>{
    if(!view.open)return;
    const off=registerLeaveGuard(()=>{
      if(guard.current?.hasDraft() && !window.confirm('Leave this page and discard its unsaved changes?'))return false;
      closePlan();return true;
    },closePlan);
    const before=event=>{if(guard.current?.hasDraft()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',before);
    return()=>{off();window.removeEventListener('beforeunload',before);};
  },[view.open]);
  const props=view.props;
  const lease=useMemo(()=>({isCurrent:()=>valid(props)}),[props]);
  if(!view.open || !props || !valid(props))return null;
  return <ScheduleDialog hidden={!view.visible} closeRef={close} onClose={requestClose} storeName={props.store.name}>
    <EditorBoundary key={props.key}>
      <Suspense fallback={<p role="status">Opening the planner.</p>}>
        <Editor {...props} preview={false} localDraft={true} lease={lease} guardRef={guard} onClose={closePlan}
          onBoundaryTab={()=>close.current?.focus()}/>
      </Suspense>
    </EditorBoundary>
  </ScheduleDialog>;
}

function ScheduleDialog({hidden,closeRef,onClose,storeName,children}){
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
      <header className="sc-dialog-bar"><h2>{storeName}</h2><span>Not saved</span><button type="button" ref={closeRef} className="sc-close" onClick={onClose}>Close</button></header>
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

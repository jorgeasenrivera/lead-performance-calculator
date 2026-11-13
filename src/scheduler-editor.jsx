// The accepted scheduler uses a private frame and an explicit current host lease.
// Synthetic preview remains separate. No draft transport is enabled by default.
import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import css from '../scripts/scheduler-performance/planner.css?inline';
import shared from '../scripts/scheduler-performance/shared-system.css?inline';
import {mountMonthApp} from '../scripts/scheduler-performance/month-app-core.mjs';
import {editorProps} from './scheduler-editor-adapter.mjs';
import {createSchedulerDraftBinding} from './scheduler-draft-binding.mjs';
import {draftError} from './scheduler-draft-transport.mjs';
import {validMonth} from '../scripts/scheduler-performance/month-model.mjs';

const reasons={activation:'The connected scheduler is not available yet.','not-ready':'This store’s people are still loading.',principal:'This sign-in’s store data is not ready.',timezone:'The store’s time zone is unavailable.',store:'This store cannot be opened.',roster:'This roster needs review.',assignments:'The schedule source is unavailable.'};
const FRAME=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}html,body,#app{min-height:100%;} ${css}</style><style>${shared}</style></head><body><main id="app"></main></body></html>`;

export default function SchedulerEditor({store,data,timezone,now,principalEpoch,dataEpoch,explicitAssignmentForDay,
  preview=false,localDraft=false,lease=null,day,title='Schedule editor',onClose,onError,onSummary,confirm,guardRef,draftCodec,onDraftChange,onBoundaryTab,onReady,onDraftStatus}) {
  const [loaded,setLoaded]=useState(null), [failed,setFailed]=useState(null), frameRef=useRef(null), mounted=useRef(null), latest=useRef({});
  latest.current={onClose,onError,onSummary,confirm,now,draftCodec,onDraftChange,onBoundaryTab,onReady,onDraftStatus};
  const identity=JSON.stringify([store?.id,principalEpoch,dataEpoch,timezone,preview,localDraft]);
  // Capture one input snapshot per scope. Ordinary dashboard refreshes must not
  // replace a manager's open draft. Closing and reopening captures fresh inputs.
  const built=useMemo(()=>(preview===true || (localDraft===true && lease?.isCurrent?.()===true))?editorProps({store,data,timezone,principalEpoch,dataEpoch,explicitAssignmentForDay,
    now:()=>{const n=latest.current.now;return typeof n==='function'?n():n;}}):{ok:false,reason:'activation'},
    [identity,data?.__storeId]); // intentionally retain same-scope data and resolver

  useLayoutEffect(()=>{
    if(!built.ok || !loaded || loaded.identity!==identity || !loaded.frame.isConnected)return;
    const frame=loaded.frame, doc=frame.contentDocument;
    let handle=null,unsubscribe=null,api=null,offKeyboard=null,binding=null,bindingOwner=null,offBinding=null,bindingAttention=false,offStatus=null;
    const requestClose=()=>{if(!handle || handle.disposed || mounted.current?.handle!==handle)return false;const message=bindingAttention?'A save request may already have completed. Close and clear its local recovery state?':'Discard the unsaved schedule changes?';if(api.hasDraft() && !(latest.current.confirm?latest.current.confirm(message):frame.contentWindow.confirm(message)))return false;latest.current.onClose?.();return true;};
    try {
      handle=mountMonthApp({...built,root:doc.getElementById('app'),preview:preview===true,localDraft:localDraft===true,isCurrent:()=>lease?.isCurrent?.()===true,embedded:true,keyTarget:doc,requireMaterializedSources:true,
        confirm:message=>latest.current.confirm?latest.current.confirm(message):frame.contentWindow.confirm(message),
        onClose:()=>bindingAttention?requestClose():latest.current.onClose?.(),onSummary:detail=>latest.current.onSummary?.(detail),
        onError:error=>latest.current.onError?.(error),
        ...(latest.current.draftCodec?{draftCodec:{verify:p=>latest.current.draftCodec.verify(p)}}:{})});
      const viewMonth=()=>{const month=doc.getElementById('app')?.dataset.hapticMonth;return validMonth(month)?month:null;};
      api={hasDraft:()=>!handle.disposed&&(handle.hasDraft()||bindingAttention),hasUnconfirmedSave:()=>!handle.disposed&&bindingAttention,
        currentViewMonth:viewMonth,requestClose,retire:()=>{if(mounted.current?.api===api)mounted.current.readyOff?.();offBinding?.();binding?.dispose();bindingAttention=false;handle.dispose();},
        reviewMaterialization:(...args)=>handle.reviewMaterialization(...args),applyMaterialization:(...args)=>handle.applyMaterialization(...args),
        exportMonth:(...args)=>handle.exportMonth(...args),acknowledgeMonth:(...args)=>handle.acknowledgeMonth(...args),
        hydrateMonth:(...args)=>handle.hydrateMonth(...args),draftStatus:(...args)=>handle.draftStatus(...args),
        // Private host connection only. No client, token or network operation is
        // created until the caller supplies the existing scoped transport.
        connectDraft({auth,transport}={}){
          const principal=auth?.getSnapshot?.();
          if(handle.disposed || mounted.current?.api!==api || handle.draftStatus().ok!==true
            || principal?.sessionReady!==true || principal.disposed || principal.principalEpoch!==principalEpoch)throw draftError('inactive');
          if(binding?.getSnapshot().active){
            if(bindingOwner.auth===auth && bindingOwner.transport===transport)return binding;
            throw draftError('already-connected');
          }
          offBinding?.();binding?.dispose();bindingAttention=false;
          binding=createSchedulerDraftBinding({auth,transport,getEditor:()=>mounted.current?.api,
            storeId:built.stores[0].id,index:0,lifetime:identity});
          offBinding=binding.subscribe(()=>{const s=binding.getSnapshot();bindingAttention=s.active&&s.months.some(e=>['save','retry'].includes(e.operation)||e.awaitingAcknowledgement||e.controller.status==='uncertain');});
          bindingOwner={auth,transport};
          return binding;
        }};
      mounted.current={identity,handle,api};
      unsubscribe=handle.subscribeDraft(event=>{binding?.onDraftChange(event);latest.current.onDraftChange?.(event);});
      const boundaryKey=event=>{
        if(event.key!=='Tab' || !latest.current.onBoundaryTab)return;
        if([...doc.querySelectorAll('[role="dialog"]')].some(node=>node.getClientRects().length))return;
        const targets=[...doc.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')]
          .filter(node=>!node.disabled && node.getClientRects().length);
        if((event.shiftKey && doc.activeElement===targets[0]) || (!event.shiftKey && doc.activeElement===targets.at(-1))){event.preventDefault();latest.current.onBoundaryTab(event.shiftKey);}
      };
      doc.addEventListener('keydown',boundaryKey,true);offKeyboard=()=>doc.removeEventListener('keydown',boundaryKey,true);
      const status=()=>queueMicrotask(()=>{if(mounted.current?.api===api&&!handle.disposed)latest.current.onDraftStatus?.();});
      doc.addEventListener('input',status);doc.addEventListener('change',status);
      offStatus=()=>{doc.removeEventListener('input',status);doc.removeEventListener('change',status);};
      if(day)handle.view({day,store:built.stores[0].id});
    } catch(error) {binding?.dispose();handle?.dispose();if(mounted.current?.handle===handle)mounted.current=null;setFailed(identity);latest.current.onError?.(error);}
    return ()=>{if(mounted.current?.handle===handle)mounted.current.readyOff?.();offBinding?.();binding?.dispose();bindingAttention=false;offStatus?.();offKeyboard?.();unsubscribe?.();handle?.dispose();if(mounted.current?.handle===handle)mounted.current=null;};
  },[built,loaded,identity]);
  useLayoutEffect(()=>{
    const api=mounted.current?.api||null;
    if(guardRef)guardRef.current=api;
    let done=false;const release=api?latest.current.onReady?.(api):null;
    const readyOff=()=>{if(done)return;done=true;if(typeof release==='function')release();};
    if(mounted.current?.api===api)mounted.current.readyOff=readyOff;
    return ()=>{readyOff();if(guardRef?.current===api)guardRef.current=null;};
  },[guardRef,built,loaded,identity]);

  if(!built.ok)return <p role="status">{reasons[built.reason]||'The schedule inputs need review.'}</p>;
  if(failed===identity)return <p role="alert">The editor could not open. Close it and try again.</p>;
  return <iframe ref={frameRef} key={identity} title={title} srcDoc={FRAME} onLoad={event=>{if(event.currentTarget===frameRef.current)setLoaded({identity,frame:event.currentTarget});}}
    style={{border:0,width:'100%',height:'100%',minHeight:0,background:'transparent'}}/>;
}

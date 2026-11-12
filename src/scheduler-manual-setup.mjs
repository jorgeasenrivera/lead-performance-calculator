// Adapt the existing authenticated draft transport without changing its retry/codec semantics.
import {createSchedulerDraftTransport} from './scheduler-draft-transport.mjs';
import {schedulerDraftCodec} from './scheduler-draft-codec.mjs';

// This is a local integration selector, never server authorization. Normal
// production builds and non-loopback origins cannot create this connection.
export function localManualDraftSelected({mode,calendarFlag,draftFlag,origin}={}){
 if(mode!=='scheduler-local-test'||calendarFlag!=='1'||draftFlag!=='1')return false;
 try{const u=new URL(origin);return u.origin===origin&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);}catch{return false;}
}
export function createLocalManualDraftConnection({selection,auth,fetchImpl,requestId,timeoutMs}={}){
 if(!localManualDraftSelected(selection))return null;
 return Object.freeze({auth,codec:schedulerDraftCodec,transport:createSchedulerDraftTransport({auth,codec:schedulerDraftCodec,fetchImpl:manualDraftFetch(fetchImpl),requestId,timeoutMs})});
}

// Only status scalars leave the binding here. Drafts and submission tokens stay
// in their existing private owners, including a command awaiting a retry.
export function manualDraftView(snapshot,month,error=null){
 const entry=snapshot?.months?.find(e=>e.month===month),s=entry?.controller;
 const pending=snapshot?.editor?.pending===true,dirty=snapshot?.editor?.dirtyMonths?.includes(month)===true;
 const busy=Boolean(entry?.operation),uncertain=s?.status==='uncertain',conflict=s?.status==='conflict';
 const issue=error||entry?.error||s?.error||null;
 let message='Draft not loaded.';
 if(s?.status==='loading')message='Loading draft.';
 else if(busy)message='Saving this draft.';
 else if(uncertain)message='Save not confirmed. Your changes are kept in this window.';
 else if(entry?.awaitingAcknowledgement&&['saved','dirty'].includes(s?.status))message='Save confirmed for the submitted draft. Local changes still need review.';
 else if(conflict)message='Another draft was saved. Your changes are still here. Close and reopen to load the latest draft.';
 else if(issue==='source-not-materialized')message='Review the existing schedule facts before saving.';
 else if(issue?.startsWith('source-'))message='The existing schedule facts need another review. No save was attempted.';
 else if(issue==='pending-editor-controls'||issue==='pending-choices')message='Finish or cancel the open form before saving.';
 else if(issue)message=entry?.loadAccepted?'Save not completed. Your changes are still here.':'Draft not loaded. Your changes are still here.';
 else if(pending)message='Changes in the open form are not saved.';
 else if(dirty)message='Local changes are not saved.';
 else if(s?.status==='absent')message='No saved draft. Changes are local to this window.';
 else if(s?.status==='saved'&&!entry.awaitingAcknowledgement)message='Draft saved for this month.';
 else if(s?.status==='ready')message='Draft loaded for this month.';
 const otherPending=snapshot?.months?.some(e=>e.month!==month&&(['save','retry'].includes(e.operation)||e.awaitingAcknowledgement||e.controller.status==='uncertain'))===true;
 if(otherPending)message+=' Another month has a save that needs review.';
 const active=snapshot?.active===true,blocked=busy||pending||uncertain||conflict||Boolean(entry?.awaitingAcknowledgement);
 return Object.freeze({message,month,phase:s?.status||'idle',revision:s?.draftRev??null,
  canLoad:active&&!entry?.loadAccepted&&!blocked&&!dirty,
  canSave:active&&entry?.loadAccepted===true&&!blocked&&(dirty||s?.status==='absent'),
  canRetry:active&&uncertain&&!busy&&entry?.awaitingAcknowledgement===true,
  canReview:active&&entry?.loadAccepted===true&&!blocked,busy,pending,dirty,issue});
}

export function manualDraftFetch(fetchImpl=fetch){
 return (url,init)=>{
  if(url!=='/api/scheduler'||init.method!=='POST')throw Error('Invalid draft route.');
  const r=JSON.parse(init.body);let command;
  if(r.op==='read'&&r.input?.kind==='draft')command={action:'load',storeId:r.storeId,month:r.month};
  else if(r.op==='save')command={action:'save',storeId:r.storeId,month:r.month,requestId:r.requestId,draft:r.input.draft,baseRev:r.input.baseRev};
  else throw Error('Invalid draft action.');
  return fetchImpl('/api/scheduler-manual',{...init,mode:'same-origin',body:JSON.stringify(command)});
 };
}

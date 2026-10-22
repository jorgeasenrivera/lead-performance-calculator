import React,{useMemo,useSyncExternalStore} from 'react';
import SchedulerDraftDesktop from './scheduler-draft-desktop.jsx';
import {schedulerDraftCodec} from './scheduler-draft-codec.mjs';
import {createSchedulerDraftTransport} from './scheduler-draft-transport.mjs';
import {currentReportedAuth,loadedUnder} from './scheduler-load-context.mjs';
import {STORE_TIME_ZONE} from './scheduler-calendar-model.mjs';
import {manualDraftFetch} from './scheduler-manual-setup.mjs';
const empty=Object.freeze({disposed:true,principalEpoch:null}),snapshot=()=>empty,subscribe=()=>()=>{};
export default function ManualSetup({api,epoch,store,data,isOff,month,onClose}){
 const sourceAuth=currentReportedAuth();
 const identity=useSyncExternalStore(sourceAuth?.subscribe||subscribe,sourceAuth?.getSnapshot||snapshot,snapshot);
 const stamp=loadedUnder(data);
 const transport=useMemo(()=>createSchedulerDraftTransport({auth:api.auth,codec:schedulerDraftCodec,fetchImpl:manualDraftFetch(),requestId:()=>crypto.randomUUID()}),[api]);
 // A separate auth adapter's numeric epoch is not evidence of this document's origin.
 if(identity.disposed||stamp?.storeId!==store.id||data?.__storeId!==store.id||stamp.epoch!==identity.principalEpoch)return <section><p role="alert">Reload this store before opening schedule setup.</p><button type="button" onClick={onClose}>Back to manual schedule</button></section>;
 return <section><p>Set People, Store hours and Teams for this month and its boundary weeks. Save each month explicitly. Missing settings block publication.</p>
  <SchedulerDraftDesktop store={store} data={data} isOff={isOff} timezone={STORE_TIME_ZONE} day={`${month}-01`}
   principalEpoch={epoch} dataEpoch={epoch} auth={api.auth} transport={transport} draftCodec={schedulerDraftCodec} onClose={onClose}/>
 </section>;
}

import {originalC113} from './_scheduler-c113.mjs';
import {createDraftOnlyScheduler} from './_scheduler-draft-only.mjs';
import {createSchedulerPgTransportFromEnv,createDraftPermissionFor} from './_scheduler-pg-transport.mjs';
import {SchedulerError} from './_scheduler-store.mjs';
// Call once from an explicitly enabled server entrypoint; default endpoint stays dormant.
export function createDraftOnlySchedulerServer({enabled=false,env=process.env,identityDb,c113=originalC113,now,Pool}={}){
 if(enabled!==true)throw new SchedulerError('storage-not-configured');
 const transport=createSchedulerPgTransportFromEnv({env,Pool});
 try{return Object.freeze({handler:createDraftOnlyScheduler({identityDb,c113,now,transport,draftPermissionFor:createDraftPermissionFor(transport)}),close:()=>transport.close()});}
 catch{void transport.close().catch(()=>{});throw new SchedulerError('storage-not-configured');}
}

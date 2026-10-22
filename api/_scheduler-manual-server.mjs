// Explicit injected server composition; never configures a client or opens a pool.
import {originalC113} from './_scheduler-c113.mjs';
import {createSchedulerIdentityReader} from './_scheduler-authorization.mjs';
import {createDraftOnlyScheduler} from './_scheduler-draft-only.mjs';
import {createPublicationV2} from './_scheduler-publication-v2.mjs';
import {createSourceCapture} from '../scripts/scheduler-source-capture/adapter.mjs';
import {assembleManualSource} from '../scripts/scheduler-manual/contract.mjs';
import {createManualSchedulerHandler} from './scheduler-manual.mjs';
export function createManualSchedulerServer({enabled=false,identityDb,transport,capturePort,draftPermissionFor,publishPermissionFor,now}={}){
 if(enabled!==true||typeof capturePort?.context!=='function'||typeof publishPermissionFor!=='function')throw Error('storage-not-configured');
 const identity=createSchedulerIdentityReader(identityDb);
 const draftHandler=createDraftOnlyScheduler({identityDb,c113:originalC113,transport,draftPermissionFor,now});
 const publication=createPublicationV2({enabled:true,identity,transport,capturedContextFor:capturePort.context});
 const capture=createSourceCapture({enabled:true,port:capturePort,assemble:assembleManualSource});
 return createManualSchedulerHandler({enabled:true,identity,draftHandler,publication,capture,grantFor:publishPermissionFor,now});
}

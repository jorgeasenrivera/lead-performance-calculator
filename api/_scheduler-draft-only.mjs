import {createHash} from 'node:crypto';
import {createSchedulerIdentityReader,createAuthorizedSchedulerHandler} from './_scheduler-authorization.mjs';
import {createSchedulerContract} from './_scheduler-contract.mjs';
import {SchedulerError} from './_scheduler-store.mjs';

// Server-only factory. No client, credential, endpoint or feature activation.
// The dependency names are explicit draft actions, never implicit role grants.
export function createDraftOnlyScheduler({identityDb,draftPermissionFor,c113,transport,now}){
 const unavailable=()=>{throw new SchedulerError('storage-not-configured');};
 const base=createSchedulerContract({c113,sha256:x=>createHash('sha256').update(x).digest('hex'),reviewProvider:{REVIEW_DEFINITION:'month-review/1',validateReviewInput:unavailable,verifyReview:unavailable,reviewMonth:unavailable,reviewSpan:unavailable,canonicalJson:unavailable}});
 const contract={...base,validateRequest(request){
  if(!request || !(request.op==='save'||(request.op==='read'&&request.input?.kind==='draft')))throw new SchedulerError('forbidden');
  return base.validateRequest(request);
 }};
 return createAuthorizedSchedulerHandler({identity:createSchedulerIdentityReader(identityDb),storeScope:"explicit-draft-pilot",contract,c113,transport,now,
  grantFor:async authority=>{
   if(typeof draftPermissionFor!=='function')return false;
   const permission=authority.action==='save'?'draft-save':authority.action==='read'&&authority.readKind==='draft'?'draft-read':null;
   if(!permission)return false;
   return await draftPermissionFor(Object.freeze({actorId:authority.actorId,storeId:authority.storeId,permission}))===true;
  }});
}

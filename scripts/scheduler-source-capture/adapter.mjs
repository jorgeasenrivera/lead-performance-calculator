// Injected trusted capture port only. No environment, driver, route or live grants.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {originalC113 as c113} from '../../api/_scheduler-c113.mjs';
import {INPUT_BINDING_VERSION,CONTEXT_CAPABILITY} from '../../api/_scheduler-contract.mjs';
import {assignmentResolver,monthPeople} from '../../src/scheduler-editor-adapter.mjs';
import {storeKey,actKey} from '../../api/_store-keys.mjs';
import {isOff} from './legacy-absence.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
import {preparePublication} from '../scheduler-delivery-relational/context.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function assembleSource(raw,{explicitManual=false}={}){
 const copied=c113.plainSnapshot(raw,{maxDepth:24});if(!copied.ok)fail('SOURCE_INPUTS_INVALID');
 const x=copied.value,scope=x.scope;
 if(x.version!=='scheduler-source-snapshot/1'||!c113.validStoreId(scope?.storeId)||!c113.validMonth(scope?.month)||!Number.isSafeInteger(x.epoch)||x.epoch<1)fail('SOURCE_INPUTS_INVALID');
 const supplement=x.supplement;if(!supplement)fail('SOURCE_INPUTS_MISSING');
 if(!exact(supplement,['version','baseStore','teamState','months'])||supplement.version!=='scheduler-source-inputs/1')fail('SOURCE_INPUTS_INVALID');
 const source=x.rows?.[storeKey(scope.storeId)];if(!source||!Array.isArray(source.roster))fail('SOURCE_INPUTS_MISSING');
 const data=structuredClone(source),span=review.reviewSpan(scope.month);
 // Split day rows win, exactly as loadStore; never treat failed reads as absent rows.
 for(const day of span.days)if(Object.hasOwn(x.rows,actKey(scope.storeId,day))){data.activity={...(data.activity||{}),[day]:x.rows[actKey(scope.storeId,day)]};}
 const peopleFor=monthPeople(data),assign=assignmentResolver(data,{isOff,peopleFor});
 const roster=data.roster.filter(p=>p?.roleId).map(p=>({id:p.id,name:p.name}));
 const identities=people=>people.map(p=>({id:p.id,name:p.name})).sort((a,b)=>a.id.localeCompare(b.id));
 if(!Array.isArray(supplement.baseStore?.people)||!isDeepStrictEqual(identities(supplement.baseStore.people),identities(explicitManual?peopleFor(scope.month):roster)))fail('SOURCE_ROSTER_MISMATCH');
 const head=x.heads?.[scope.month];if(!head?.draft_rev)fail('SOURCE_DRAFT_MISSING');
 const complete=store=>{if(!Array.isArray(store?.rules)||!store.rules.length||store.timezone!=='America/New_York'||!Array.isArray(store.people)||store.people.some(p=>!Array.isArray(p.off)||![p.start,p.end,p.maxHours].every(Number.isFinite)))fail('SOURCE_INPUTS_INCOMPLETE');};
 complete(supplement.baseStore);
 const text=(month,kind,rev)=>{if(!rev)return null;const found=x.versions.filter(v=>v.month===month&&v.kind===kind&&v.rev===rev&&v.store_id===scope.storeId);if(found.length!==1)fail('SOURCE_INPUTS_INVALID');return found[0].version_text;};
 const months={};
 for(const month of span.months){const rev=x.heads[month]?.draft_rev||0;if(!rev)continue;
  const decoded=c113.deserializeVersion(text(month,'draft',rev),{storeId:scope.storeId,month,kind:'draft',rev});if(!decoded.ok)fail('SOURCE_INPUTS_INVALID');complete(decoded.draft.store);
  if(!isDeepStrictEqual(identities(decoded.draft.store.people),identities(peopleFor(month))))fail('SOURCE_ROSTER_MISMATCH');
  const extra=supplement.months?.[month];
  if(!exact(extra,['history','planningPolicy'])||!Array.isArray(extra.history))fail('SOURCE_INPUTS_MISSING');
  months[month]={store:{...decoded.draft.store,id:scope.storeId,history:extra.history,planningPolicy:extra.planningPolicy},overrides:decoded.draft.overrides};
 }
 if(explicitManual&&span.months.some(month=>!months[month]))fail('SOURCE_INPUTS_MISSING');
 if(!Object.hasOwn(supplement.baseStore,'planningPolicy')||!Array.isArray(supplement.baseStore.history))fail('SOURCE_INPUTS_MISSING');
 const input={definition:'month-review/1',scope,baseStore:supplement.baseStore,teamState:supplement.teamState,months,base:Object.fromEntries(span.days.map(day=>[day,explicitManual?null:assign(day)]))};
 let reviewed;try{reviewed=review.reviewMonth(input,{sha256:hash});}catch{fail('SOURCE_INPUTS_INVALID');}
 if(reviewed.openIssues!==0)fail('SOURCE_REVIEW_ISSUES');
 const calendar=c113.adjacentMonths(scope.month),adjacent=Object.fromEntries(['prev','next'].map(side=>[side,calendar[side]===null?null:x.heads[calendar[side]]?.draft_rev||0]));
 const snapshot={scope,head:{draftRev:head.draft_rev,publishedRev:head.published_rev},draftText:text(scope.month,'draft',head.draft_rev),publishedText:text(scope.month,'published',head.published_rev),prevAuditHash:head.last_audit_hash,auditRevision:head.audit_revision,adjacentNow:adjacent,neighborDraftTexts:Object.fromEntries(['prev','next'].map(side=>[side,text(calendar[side],'draft',adjacent[side])])),reviewInput:input,
 reviewBinding:{version:INPUT_BINDING_VERSION,scope,inputVersion:{id:'source-generation:'+scope.storeId,revision:x.epoch},inputDigest:reviewed.inputDigest,draftRev:head.draft_rev,publishedRev:head.published_rev,adjacent,sources:Object.fromEntries(['baseStore','teamState','baseAssignments','history','planningPolicy'].map(k=>[k,{id:'source-generation:'+scope.storeId+':'+k,revision:x.epoch}]))}};
 return {raw:x,snapshot,review: {definition:reviewed.definition,digest:reviewed.digest}};
}
export function createSourceCapture({enabled=false,port,assemble=assembleSource}={}){
 if(enabled!==true||typeof port?.snapshot!=='function'||typeof port?.register!=='function')fail('CAPTURE_DISABLED');
 return Object.freeze({async capture({scope,actor,now,requestId}){
  if(!c113.validStoreId(scope?.storeId)||!c113.validMonth(scope?.month))fail('SOURCE_INPUTS_INVALID');
  const assembled=assemble(await port.snapshot(scope));
  if(!isDeepStrictEqual(assembled.raw.scope,scope))fail('SOURCE_INPUTS_INVALID');
  const txid='capture:'+hash(review.canonicalJson(assembled.raw));
  assembled.snapshot.contextTransaction={id:txid,capabilities:{[CONTEXT_CAPABILITY]:true},register:async({bindingDigest})=>{
   if(!isDeepStrictEqual(await port.snapshot(scope),assembled.raw))fail('SOURCE_CONFLICT');
   return {registered:true,transactionId:txid,bindingDigest};
  }};
  const prepared=await preparePublication({request:{op:'publish',...scope,requestId,input:{draftRev:assembled.snapshot.head.draftRev,review:assembled.review}},actor,now,snapshot:assembled.snapshot,sourceEpoch:assembled.raw.epoch});
  const id=await port.register(assembled.raw,prepared.contextText);if(id!==prepared.contextId)fail('SOURCE_CONFLICT');
  return prepared;
 }});
}

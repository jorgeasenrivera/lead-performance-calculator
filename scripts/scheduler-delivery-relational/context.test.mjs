import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preparePublication} from './context.mjs';
import {originalC113 as c113} from '../../api/_scheduler-c113.mjs';
import {INPUT_BINDING_VERSION,CONTEXT_CAPABILITY} from '../../api/_scheduler-contract.mjs';
import * as provider from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(day){
 const scope={storeId:'pilot-a',month:day.slice(0,7)},actor={id:'00000000-0000-4000-8000-000000000001'},now='2026-10-22T17:30:00Z';
 const next=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const closed={open:9.01,close:16.99,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{}};
 const store={timezone:'America/New_York',people:[{id:'a',name:'Fake',start:9,end:17,off:[],maxHours:40}],rules:[{...closed,effective:'2014-01-01'},{...closed,effective:day,closedDays:[]},{...closed,effective:next}],teams:[],memberships:[{storeId:scope.storeId,personId:'a',teamIds:[],from:'2014-01-01',to:'2100-12-31',unknown:false}]};
 const draft={...scope,store,overrides:{[day]:{on:['a'],off:[]}}};
 const saved=c113.planDraftSave({...scope,draft,baseRev:0,head:null,actor,at:now,prevAuditHash:null});assert.equal(saved.ok,true);
 const enriched={...store,id:scope.storeId,history:[]};
 const reviewInput={definition:'month-review/1',scope,baseStore:enriched,teamState:{teams:[],memberships:store.memberships},months:{[scope.month]:{store:enriched,overrides:draft.overrides}},base:Object.fromEntries(provider.reviewSpan(scope.month).days.map(d=>[d,null]))};
 const review=provider.reviewMonth(reviewInput,{sha256:hash});assert.equal(review.openIssues,0,'legacy provider without planningPolicy admits this input');
 const snapshot={scope,head:{draftRev:1,publishedRev:0},draftText:saved.plan.ops[0].text,publishedText:null,prevAuditHash:saved.plan.auditEntry.hash,auditRevision:1,adjacentNow:{prev:0,next:0},neighborDraftTexts:{prev:null,next:null},reviewInput,
 reviewBinding:{version:INPUT_BINDING_VERSION,scope,inputVersion:{id:'fixture',revision:1},inputDigest:review.inputDigest,draftRev:1,publishedRev:0,adjacent:{prev:0,next:0},sources:Object.fromEntries(['baseStore','teamState','baseAssignments','history','planningPolicy'].map(k=>[k,{id:'fixture-'+k,revision:1}]))},contextTransaction:{id:'fixture',capabilities:{[CONTEXT_CAPABILITY]:true},register:async x=>({registered:true,transactionId:'fixture',bindingDigest:x.bindingDigest})}};
 return {request:{op:'publish',...scope,requestId:'fake',input:{draftRev:1,review:{definition:review.definition,digest:review.digest}}},actor,now,snapshot,sourceEpoch:1};
}
for(const day of ['2026-03-08','2026-11-01'])test('legacy on without policy rejects DST transition '+day,async()=>{await assert.rejects(preparePublication(fixture(day)),/publication-context-rejected/);});
for(const day of ['2026-03-09','2026-11-02'])test('legacy on without policy preserves fractional hours on stable date '+day,async()=>{const result=await preparePublication(fixture(day));assert.deepEqual(result.context.projection[0].days.find(x=>x.date===day).intervals,[[9.01*60,16.99*60]]);});

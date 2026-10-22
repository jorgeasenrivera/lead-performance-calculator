import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as original from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review.mjs';
import * as extended from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const month='2026-10',store={id:'pilot-a',timezone:'America/New_York',people:[{id:'a',name:'Synthetic a',start:9,end:17,off:[],maxHours:40}],rules:[{effective:'2014-01-01',open:9,close:17,minimum:1,capacity:8,useCapacity:false,closedDays:[0,1,2,3,4,5,6],holidays:{}}],history:[],teams:[],memberships:[]};
const input={definition:'month-review/1',scope:{storeId:'pilot-a',month},baseStore:store,teamState:{teams:[],memberships:[]},months:{[month]:{store,overrides:{}}},base:Object.fromEntries(original.reviewSpan(month).days.map(d=>[d,null]))};
test('legacy review input produces identical full result under provenance extension',()=>{assert.deepEqual(extended.reviewMonth(input,{sha256:hash}),original.reviewMonth(input,{sha256:hash}));});
test('People Apply provenance is preserved and digest-bound without changing cap value',()=>{
 const annotated=structuredClone(input);annotated.months[month].store.people[0].maxHoursSource='manager-confirmed';
 const result=extended.validateReviewInput(annotated);assert.equal(result.months[month].store.people[0].maxHoursSource,'manager-confirmed');assert.equal(result.months[month].store.people[0].maxHours,40);
 const reviewed=extended.reviewMonth(annotated,{sha256:hash});assert.equal(reviewed.openIssues,0);assert.notEqual(reviewed.inputDigest,extended.reviewMonth(input,{sha256:hash}).inputDigest);
 annotated.months[month].store.people[0].maxHoursSource='preview-setting';assert.notEqual(extended.reviewMonth(annotated,{sha256:hash}).inputDigest,reviewed.inputDigest);
 for(const value of [null,3,'','x'.repeat(41)]){annotated.months[month].store.people[0].maxHoursSource=value;assert.throws(()=>extended.validateReviewInput(annotated));}
});

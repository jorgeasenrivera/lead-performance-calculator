import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRollupCandidate} from '../api/_board-rollup-candidate.mjs';
import {verifiedBoardCount} from '../api/_board-provenance.mjs';
const stores=[{id:'demo',name:'Demo Motors'}], today='2026-08-27';
const good=[['Delivery Summary','8/1/2026 - 8/27/2026'],['Store','Sold','Deals Delivered'],['Demo Motors','7','4']];
const read=(rows=good,ss=stores,id='demo',day=today)=>parseRollupCandidate(rows,ss,id,day);
test('fixture-shaped store roll-up yields an explicitly unverified candidate',()=>{
 const candidate=read();assert.deepEqual(candidate,{status:'unverified',source:'store-rollup',storeId:'demo',periodStart:'2026-08-01',periodEnd:today,deliveries:4});
 assert.equal(verifiedBoardCount(candidate,'demo','2026-08',today),null, 'an unverified candidate cannot become a board count');
});
test('rejects mismatched stores, ambiguous scope, fractional or malformed counts',()=>{
 for(const rows of [
  [['Delivery Summary','8/2/2026 - 8/27/2026'],good[1],good[2]],
  [['Delivery Summary','8/1/2026 - 8/26/2026'],good[1],good[2]],
  [['Delivery Summary','2/30/2026 - 8/27/2026'],good[1],good[2]],
  [good[0],good[1],['Other Motors','7','4']],
  [good[0],good[1],['Demo Motors','7','3.5']],
  [good[0],good[1],['Demo Motors','7','4junk']],
  [good[0],['User','Store','Deals Delivered'],['Alex','Demo Motors','4']],
  [good[0],['Store','Deals Delivered','Deals Delivered'],['Demo Motors','4','4']],
  [...good,['Another Store','7','3']],
 ]) assert.equal(read(rows),null);
 assert.equal(read(good,[...stores,{id:'other',name:'Demo Motors'}]),null);
 assert.equal(read(good,stores,'other'),null);
 assert.equal(read(good,stores,{private:'hidden'}),null);
});

test('offline end-to-end projection withholds candidate until a simulated verification step',async()=>{
 const {projectBoard}=await import('../api/_board-projection.mjs');
 const candidate=read(), month='2026-08';
 const config={stores:[{id:'demo',name:'Demo Motors'}],roles:[{id:'sales'}]};
 const data={roster:[{id:'a',name:'Alex Demo',roleId:'sales'}],months:{[month]:{stats:{'alex demo':{internetUnits:0.5,phoneUnits:2}},boardCountEvidence:candidate}}};
 const args={config,storeId:'demo',data,month,today,updatedAt:'2026-08-27T15:00:00Z',defaults:{activityStandards:{},brand:{}},normalizeThresholds:()=>({}),streak:()=>({dir:null,len:0})};
 const withheld=projectBoard(args);assert.equal(withheld.months[month].storeTotal,undefined);assert.equal(withheld.months[month].stats['alex demo'].internetUnits,0.5);
 // This models a separate trusted verification; no production verifier exists yet.
 const verified=structuredClone(data);verified.months[month].boardCountEvidence.status='verified';
 const board=projectBoard({...args,data:verified});assert.equal(board.months[month].storeTotal,4);assert.equal(board.months[month].stats['alex demo'].internetUnits,0.5);
});

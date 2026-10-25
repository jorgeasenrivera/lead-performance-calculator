import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAgainstServer} from '../api/_store-merge.mjs';
import {reconcileMonths} from '../api/_month-intent.mjs';

const copy=v=>structuredClone(v);
const base=()=>({__storeId:'synthetic',rev:1,roster:[],months:{'2026-05':{stats:{person:{internetUnits:1,phoneUnits:2,campaignUnits:0.5}},imports:{},names:{}},'2026-04':{stats:{person:{internetUnits:7}}}}});
const units=d=>d.months['2026-05'].stats.person;
const merge=(b,n,s)=>mergeAgainstServer(copy(n),copy(s),{baseline:b});
test('different channel edits combine, caller inputs unchanged, other month and fractions survive',()=>{
 const b=base(),n=copy(b),s=copy(b);units(n).phoneUnits=9;units(s).internetUnits=8;
 const before=JSON.stringify([b,n,s]);const out=merge(b,n,s);
 assert.equal(units(out).phoneUnits,9);assert.equal(units(out).internetUnits,8);assert.equal(units(out).campaignUnits,0.5);assert.deepEqual(out.months['2026-04'],b.months['2026-04']);assert.equal(JSON.stringify([b,n,s]),before);
});
test('unchanged monthly intent preserves current imported values despite newer client log',()=>{
 const b=base(),n=copy(b),s=copy(b);units(s).internetUnits=8;n.importLog=[{id:'skew',t:'2099-01-01'}];n.restrictions={p:{why:'training'}};
 const out=merge(b,n,s);assert.equal(units(out).internetUnits,8);assert.deepEqual(out.restrictions,n.restrictions);
});
test('same field concurrent disagreement fails explicitly without mutating inputs',()=>{
 const b=base(),n=copy(b),s=copy(b);units(n).phoneUnits=9;units(s).phoneUnits=4;
 const before=JSON.stringify([b,n,s]);assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});assert.equal(JSON.stringify([b,n,s]),before);
});
test('same intended value already present is accepted',()=>{const b=base(),n=copy(b),s=copy(b);units(n).phoneUnits=9;units(s).phoneUnits=9;assert.equal(units(merge(b,n,s)).phoneUnits,9);});
test('zero, null and deletion remain distinct and unchanged missing fields do not clear server values',()=>{
 const b=base(),n=copy(b),s=copy(b);units(n).phoneUnits=0;units(s).internetUnits=null;units(s).showroomUnits=4;
 const out=merge(b,n,s);assert.equal(units(out).phoneUnits,0);assert.equal(units(out).internetUnits,null);assert.equal(units(out).showroomUnits,4);
 delete units(n).phoneUnits;const deleted=merge(b,n,s);assert.equal(Object.hasOwn(units(deleted),'phoneUnits'),false);
 units(s).phoneUnits=0;assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
});
test('missing baseline cannot overwrite existing row, but initial row creation is permitted',()=>{
 const n=base();assert.throws(()=>merge(null,n,base()),{code:'MONTH_IMPORT_CONFLICT'});assert.deepEqual(reconcileMonths(null,n,null),n.months);
 assert.throws(()=>reconcileMonths(n,n,null),{code:'MONTH_IMPORT_CONFLICT'});
});
test('new partial month merges disjoint fields and rejects conflicting new fields',()=>{
 const b=base(),n=copy(b),s=copy(b);n.months['2026-06']={stats:{person:{phoneUnits:0}}};s.months['2026-06']={stats:{person:{internetUnits:8}}};
 assert.deepEqual(merge(b,n,s).months['2026-06'].stats.person,{phoneUnits:0,internetUnits:8});s.months['2026-06'].stats.person.phoneUnits=2;assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
});
test('report arrays are atomic and conflicting metadata is not silently paired',()=>{
 const b=base(),n=copy(b),s=copy(b);n.months['2026-05'].names.phone=['one'];s.months['2026-05'].names.phone=['two'];assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
});
test('aggregate metadata and split stay one snapshot instead of mixing concurrent observations',()=>{
 const b=base();b.months['2026-05'].stated={deliveries:53,at:'old',vehicles:{new:35,used:30}};
 const n=copy(b),s=copy(b);n.months['2026-05'].stated.at='new';s.months['2026-05'].stated.vehicles.used=31;
 assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
});
test('changed identity mapping blocks monthly intent before reattribution',()=>{
 for(const field of ['aliases','roster','departed','excluded','statsExcluded']){
  const b=base(),n=copy(b),s=copy(b);units(n).phoneUnits=9;s[field]=field==='aliases'?{person:'different'}:['different'];assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
 }
});
test('whole-month removal conflicts with intervening import instead of deleting it',()=>{
 const b=base(),n=copy(b),s=copy(b);delete n.months['2026-05'];units(s).internetUnits=8;assert.throws(()=>merge(b,n,s),{code:'MONTH_IMPORT_CONFLICT'});
});
test('explicit equal-to-baseline report values conflict with another writer, unlike untouched fields',()=>{
 const b=base(),n=copy(b),s=copy(b);units(s).phoneUnits=4;
 assert.equal(units(merge(b,n,s)).phoneUnits,4);
 assert.throws(()=>mergeAgainstServer(n,s,{baseline:b,reportedFields:[['2026-05','stats','person','phoneUnits']]}),{code:'MONTH_IMPORT_CONFLICT'});
});
test('reported null does not silently clear a concurrent value and missing unrelated fields stay untouched',()=>{
 const b=base();units(b).phoneUnits=null;const n=copy(b),s=copy(b);units(s).phoneUnits=4;units(s).showroomUnits=0;
 assert.throws(()=>mergeAgainstServer(n,s,{baseline:b,reportedFields:[['2026-05','stats','person','phoneUnits']]}),{code:'MONTH_IMPORT_CONFLICT'});
 units(s).phoneUnits=null;const out=mergeAgainstServer(n,s,{baseline:b,reportedFields:[['2026-05','stats','person','phoneUnits']]});assert.equal(units(out).phoneUnits,null);assert.equal(units(out).showroomUnits,0);
});
test('reported unchanged values still reject changed identity',()=>{
 const b=base(),n=copy(b),s=copy(b);s.aliases={person:'someoneelse'};
 assert.throws(()=>mergeAgainstServer(n,s,{baseline:b,reportedFields:[['2026-05','stats','person','phoneUnits']]}),{code:'MONTH_IMPORT_CONFLICT'});
});

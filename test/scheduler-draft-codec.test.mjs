import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulerDraftCodec as codec} from '../src/scheduler-draft-codec.mjs';
import {createPlanner} from '../scripts/scheduler-performance/month-model.mjs';
import {editorStore} from '../src/scheduler-editor-adapter.mjs';
import {originalC113} from '../api/_scheduler-c113.mjs';
const scope={storeId:'synthetic-store',month:'2026-10'};
const fixture=()=>createPlanner([editorStore({id:scope.storeId},{roster:[{id:'a',name:'Synthetic',roleId:'sales'}]},'America/New_York')],{assignmentForDay:()=>null});
test('actual editor projection round-trips pinned C113 with unknown availability and provenance',()=>{
 const p=fixture();p.setAssignment(0,'2026-10-20',{on:[],off:['a'],unknownNotes:{a:{source:'synthetic unknown'}},generationLocks:['a']});
 const projection=p.exportMonth(0,scope.month).projection;
 const raw=codec.encode(projection,scope);assert.deepEqual(raw,projection);assert.equal(raw.store.people[0].off,null);
 assert.equal(originalC113.validateDraft(raw,scope).ok,true);
 assert.deepEqual(codec.decode(raw,scope),projection);
 const fresh=fixture();assert.equal(fresh.hydrateMonth(0,raw,codec.verify,scope).ok,true);
 assert.deepEqual(fresh.exportMonth(0,scope.month).projection,projection);
});
for(const [name,change] of [
 ['wrong month',v=>v.month='2026-11'],['wrong store',v=>v.storeId='other-store'],
 ['unknown availability annotation',v=>v.store.people[0].invented='unknown'],
 ['unknown person provenance',v=>v.overrides['2026-10-20']={unknownNotes:{missing:{source:'unknown'}}}],
 ['legacy absence kind',v=>v.overrides['2026-10-20']={absences:{a:{kind:'legacy-off'}}}],
 ['unsupported timezone',v=>v.store.timezone='UTC'],['undefined',v=>v.store.people[0].off=undefined],
]) test(`actual codec refuses ${name} without mutating editor`,()=>{
 const p=fixture(),before=p.exportMonth(0,scope.month).projection,bad=structuredClone(before);change(bad);
 assert.throws(()=>codec.encode(bad,scope),{code:'unsupported-data'});assert.deepEqual(p.exportMonth(0,scope.month).projection,before);
});

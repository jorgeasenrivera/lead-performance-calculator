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
]) test(`actual codec refuses ${name} without mutating its input`,()=>{
 const bad=structuredClone(fixture().exportMonth(0,scope.month).projection);change(bad);
 for(const method of ['encode','decode']){
  const before=structuredClone(bad);
  assert.throws(()=>codec[method](bad,scope),{code:'unsupported-data'});
  assert.deepEqual(bad,before,`${method} must not mutate the rejected input`);
 }
 // verify derives scope from the document itself; it cannot enforce an external scope.
 if(!['wrong month','wrong store'].includes(name)){
  const before=structuredClone(bad);assert.throws(()=>codec.verify(bad),{code:'unsupported-data'});assert.deepEqual(bad,before);
 }
});
test('scope gate and verify self-scope are distinct; returned data is detached',()=>{
 const input=structuredClone(fixture().exportMonth(0,scope.month).projection);
 for(const invalid of [null,{}, {storeId:'',month:scope.month},{storeId:scope.storeId,month:'2026-13'}]){
  assert.equal(codec.validateScope(invalid),false);
  for(const method of ['encode','decode'])assert.throws(()=>codec[method](input,invalid),{code:'unsupported-data'});
 }
 for(const field of ['storeId','month']){
  const other={...input,[field]:field==='storeId'?'other-store':'2026-11'};
  assert.deepEqual(codec.verify(other),other);
  for(const method of ['encode','decode'])assert.throws(()=>codec[method](other,scope),{code:'unsupported-data'});
 }
 for(const invalid of [null,{}, {...input,month:'2026-13'},{...input,storeId:''}])assert.throws(()=>codec.verify(invalid),{code:'unsupported-data'});
 for(const method of ['encode','decode','verify']){
  const value=structuredClone(input),out=codec[method](value,scope);value.store.people[0].name='Changed after call';
  assert.equal(out.store.people[0].name,'Synthetic');assert.notEqual(out.store.people,value.store.people);
 }
});

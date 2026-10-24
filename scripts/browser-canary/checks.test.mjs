import test from 'node:test';
import assert from 'node:assert/strict';
import {checkArguments,checkSandbox} from './checks.mjs';
const good=[['Namespace sandbox','Yes'],['PID namespaces','Yes'],['Network namespaces','Yes'],['Seccomp-BPF sandbox','Yes']];
test('requires all Chromium sandbox verdicts, not outer Seccomp alone',()=>{
 assert.ok(checkSandbox(good));
 for(let i=0;i<good.length;i++) {
  assert.throws(()=>checkSandbox(good.filter((_,j)=>i!==j)));
  assert.throws(()=>checkSandbox(good.map((r,j)=>i===j?[r[0],'No']:r)));
 }
 assert.throws(()=>checkSandbox([['Seccomp','2']]));
});
test('rejects disabling flags and missing process arguments',()=>{
 checkArguments(['/chromium','--headless','--enable-automation']);
 for(const x of ['no-sandbox','disable-setuid-sandbox','disable-namespace-sandbox','disable-seccomp-filter-sandbox','disable-gpu-sandbox','single-process']) assert.throws(()=>checkArguments(['/chromium',`--${x}`]));
 assert.throws(()=>checkArguments([]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workedAnyway,isOff} from './legacy-absence.mjs';
const day='2026-10-06',id='a';
const fixture=()=>({roster:[{id,name:'Fake Person'}],daysOff:{a:[day]}});
test('extracted function bodies exactly match candidate app source',async()=>{
 const source=await readFile(new URL('../../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
 for(const [fn,end] of [[workedAnyway,'/* Is there a schedule on file'],[isOff,'// Points for one person']]){
  const start=source.indexOf('function '+fn.name+'(');assert.equal(fn.toString(),source.slice(start,source.indexOf(end,start)).trim());
 }
});
test('off precedence and actual work semantics remain unchanged',()=>{
 const data=fixture();assert.equal(isOff(data,id,day),true);assert.equal(workedAnyway(data,'missing',day),false);
 for(const metric of ['texts','emails','tasks']){data.activity={[day]:{'fake person':{[metric]:100}}};assert.equal(isOff(data,id,day),true);}
 for(const metric of ['calls','video']){data.activity={[day]:{'fake person':{[metric]:1}}};assert.equal(isOff(data,id,day),false);data.forcedOff={a:[day]};assert.equal(isOff(data,id,day),true);delete data.forcedOff;}
 for(const key of ['queue','queueOnline','floor']){const d=fixture();d[key]={[day]:{line:[{id}]}};assert.equal(isOff(d,id,day),false);}
 const d=fixture();d.daysOff={};assert.equal(isOff(d,id,day),false);
});

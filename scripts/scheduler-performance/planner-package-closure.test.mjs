import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {posix} from 'node:path';

/* The built planner page loads plain ES modules from dist-harness/scheduler-performance/planner.
   One relative import with no copy is a 404 for that module and a white screen, and nothing in
   the source tree notices. legacy-store-interval.mjs was exactly that.

   build.mjs imports vite, so this test does not run the build. It reads the copy steps out of
   build.mjs, rebuilds the output file set and the build's own path rewrite, then follows every
   relative import in the files the page would load, including ones reached only through other
   modules and the generation worker. No dependencies, no output written. */

const here=new URL('.',import.meta.url),read=p=>readFileSync(new URL(p,here),'utf8');
const build=read('build.mjs');

// Output name -> {from, rewritten}. A file the build writes with writeFile gets the model.mjs path
// rewrite; a file it copies with cp is verbatim.
function plannerOutputs(text){
 const out=new Map();
 for(const m of text.matchAll(/for \(const name of \[([^\]]*)\]\)\s*await cp\("scripts\/(scheduler-performance|scheduler-proposal)\/" \+ name, planner \+ "\/" \+ name\)/g))
  for(const [,name] of m[1].matchAll(/"([\w.-]+\.mjs)"/g))out.set(name,{from:`../${m[2]}/${name}`,rewritten:false});
 for(const m of text.matchAll(/cp\("scripts\/scheduler-performance\/([\w.-]+\.mjs)",\s*planner \+ "\/([\w.-]+\.mjs)"\)/g))out.set(m[2],{from:m[1],rewritten:false});
 for(const m of text.matchAll(/writeFile\(\s*planner\s*\+\s*"\/([\w.-]+\.mjs)"/g))out.set(m[1],{from:m[1],rewritten:true});
 return out;
}
// Same shapes the browser resolves: static import/export-from, import(), and new URL(..., import.meta.url).
const specifiers=src=>[...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map(m=>m[1]);
const REWRITE=['../scheduler-proposal/model.mjs','./model.mjs'];

function closure(outputs,entries){
 const missing=new Map(),seen=new Set(),queue=[...entries];
 while(queue.length){
  const name=queue.pop();if(seen.has(name))continue;seen.add(name);
  const meta=outputs.get(name);
  if(!meta){missing.set(name,'(entry)');continue;}
  let src=read(meta.from);
  if(meta.rewritten)src=src.replace(REWRITE[0],REWRITE[1]); // the build replaces the first occurrence only
  for(const spec of specifiers(src)){
   const target=posix.normalize(spec);
   // The page's directory is flat: anything that is not a sibling file cannot be served.
   if(target.includes('/')||!outputs.has(target)){if(!missing.has(target))missing.set(target,`${name} imports ${spec}`);continue;}
   queue.push(target);
  }
 }
 return {seen,missing};
}

test('the build script is readable the way this test expects',()=>{
 const outputs=plannerOutputs(build);
 assert.ok(outputs.size>=20,`found ${outputs.size} planner modules in build.mjs`);
 for(const name of ['app.mjs','model.mjs','month-model.mjs','shift-intervals.mjs','generation-worker.mjs'])assert.ok(outputs.has(name),name);
 assert.equal(outputs.get('app.mjs').from,'month-app.mjs');
 assert.equal(outputs.get('model.mjs').from,'../scheduler-proposal/model.mjs');
 assert.ok(/<script type="module" src="app\.mjs"/.test(build),'the planner page still loads app.mjs');
 for(const [name,{from}] of outputs)assert.ok(existsSync(new URL(from,here)),`${name} is built from a file that exists`);
});

test('every file the build writes with the path rewrite has a rewrite call in build.mjs',()=>{
 // The closure below assumes the rewrite happens. Count the calls so a removed one cannot hide.
 const outputs=plannerOutputs(build);
 const needs=[...outputs].filter(([,m])=>m.rewritten&&read(m.from).includes(REWRITE[0])).map(([name])=>name);
 const calls=build.match(/\.replace\(\s*"\.\.\/scheduler-proposal\/model\.mjs",\s*"\.\/model\.mjs",?\s*\)/g)||[];
 assert.ok(needs.length>=5,`rewritten modules found: ${needs.join(', ')}`);
 assert.ok(calls.length>=needs.length,`${calls.length} rewrite calls for ${needs.length} modules (${needs.join(', ')})`);
});

test('every relative import reachable from the planner page is part of the built planner output',()=>{
 const outputs=plannerOutputs(build),{seen,missing}=closure(outputs,['app.mjs']);
 assert.deepEqual([...missing],[],'modules the page would request but the build does not copy');
 // The worker is reached through new URL(), not an import. The walk must have followed it.
 assert.ok(seen.has('generation-worker.mjs')&&seen.has('generation.mjs'),'worker and what it imports are checked');
 // Reached only through other modules (month-model and weekly-hours), never from app.mjs itself.
 assert.ok(seen.has('legacy-store-interval.mjs'));
 assert.ok(!specifiers(read('month-app.mjs')).some(s=>s.endsWith('legacy-store-interval.mjs')),'transitive on purpose');
});

test('the check fails when a transitive module is left out of the copy list',()=>{
 const without=build.replace(' "legacy-store-interval.mjs",','');
 assert.notEqual(without,build);
 const {missing}=closure(plannerOutputs(without),['app.mjs']);
 assert.ok(missing.has('legacy-store-interval.mjs'));
 assert.match(missing.get('legacy-store-interval.mjs'),/^(month-model|weekly-hours)\.mjs imports/);
});

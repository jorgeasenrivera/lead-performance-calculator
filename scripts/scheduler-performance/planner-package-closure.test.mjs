import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {readFile as fsReadFile,writeFile as fsWriteFile,mkdir as fsMkdir,cp as fsCp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';

/* The built planner page loads plain ES modules from dist-harness/scheduler-performance/planner.
   A relative import with no copy is a 404 for that module and a white screen, and nothing in the
   source tree notices. legacy-store-interval.mjs was exactly that.

   build.mjs imports vite, so it cannot be imported here. Instead this test cuts out the planner
   packaging block (from `const planner = ...` to just before the planner index.html is written),
   runs that exact text against a temporary output folder with Node's own fs, and then checks the
   files that actually landed there. Comments, loops and rewrites are therefore judged by what they
   do, not by what the text looks like. Reads are confined to this repository and writes to the
   temporary folder. No dependencies, no browser, nothing outside the temp folder is written. */

const root=resolve(new URL('../../',import.meta.url).pathname);
const buildText=readFileSync(new URL('build.mjs',import.meta.url),'utf8');
const made=[];
after(()=>{for(const dir of made)rmSync(dir,{recursive:true,force:true});});

const START='const planner = outDir + "/planner";';
const END=/await writeFile\(\s*planner \+ "\/index\.html"/g;
function packagingBlock(text){
 const start=text.indexOf(START),ends=[...text.matchAll(END)];
 assert.ok(start>=0&&text.indexOf(START,start+1)<0,'one planner packaging block starts in build.mjs');
 // The page is written twice: first as created, then again after finalizing. The first is the end of packaging.
 assert.ok(ends.length>=1&&ends[0].index>start,'the planner index.html is first written after packaging starts');
 const finalize=text.indexOf('finalizeHtml(plannerHtml');
 assert.ok(finalize<0||ends[0].index<finalize,'packaging ends before the planner page is finalized');
 return text.slice(start,ends[0].index);
}
const inside=(base,p)=>{const r=relative(base,resolve(p));return r===''||(!r.startsWith('..')&&!isAbsolute(r));};

// Runs the block against a fresh temp folder and returns that folder's planner directory.
async function packagePlanner(text=buildText){
 const out=mkdtempSync(resolve(tmpdir(),'planner-closure-'));made.push(out);
 const src=p=>{const a=isAbsolute(p)?p:resolve(root,p);assert.ok(inside(root,a),`read outside the repository: ${p}`);return a;};
 const dst=p=>{const a=resolve(p);assert.ok(inside(out,a),`write outside the temp folder: ${p}`);return a;};
 const io={
  readFile:(p,...r)=>fsReadFile(src(p),...r),
  writeFile:(p,...r)=>fsWriteFile(dst(p),...r),
  mkdir:(p,...r)=>fsMkdir(dst(p),...r),
  cp:(from,to,...r)=>fsCp(src(from),dst(to),...r),
 };
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('outDir','readFile','writeFile','mkdir','cp',packagingBlock(text))(out,io.readFile,io.writeFile,io.mkdir,io.cp);
 return resolve(out,'planner');
}

// What the browser would resolve: static import/export-from, import(), and new URL(..., import.meta.url).
const specifiers=src=>[...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map(m=>m[1]);
// Named imports and re-exports, with the module they come from. Namespace and side-effect imports have no names.
function namedImports(src){
 const found=[];
 for(const m of src.matchAll(/\b(?:import|export)\s*([^'";]*?)\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
  const clause=m[1],names=[];
  const braces=clause.match(/\{([^}]*)\}/);
  if(braces)for(const part of braces[1].split(',')){const n=part.trim().split(/\s+as\s+/)[0].trim();if(n)names.push(n);}
  const head=clause.replace(/\{[^}]*\}/,'').replace(/,/g,' ').trim();
  if(/^import\b/.test(m[0])&&head&&!head.startsWith('*')&&!/^\*/.test(head))names.push('default');
  if(names.length)found.push({spec:m[2],names});
 }
 return found;
}
function exportsOf(src){
 const names=new Set();let wildcard=/\bexport\s*\*\s*from\b/.test(src)&&!/\bexport\s*\*\s*as\b/.test(src);
 for(const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g))names.add(m[1]);
 for(const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g))for(const part of m[1].split(',')){const n=part.trim().split(/\s+as\s+/).pop().trim();if(n)names.add(n);}
 for(const m of src.matchAll(/\bexport\s*\*\s*as\s+([\w$]+)\s*from/g))names.add(m[1]);
 if(/\bexport\s+default\b/.test(src))names.add('default');
 return {names,wildcard};
}

// Follows every relative reference from the entry modules over the files that really landed.
function inspect(dir,entries){
 const problems=[],seen=new Set(),queue=entries.map(e=>resolve(dir,e));
 while(queue.length){
  const file=queue.pop();if(seen.has(file))continue;seen.add(file);
  if(!existsSync(file)){problems.push(`missing: ${relative(dir,file)}`);continue;}
  const src=readFileSync(file,'utf8'),here=relative(dir,file);
  for(const spec of specifiers(src)){
   const target=resolve(dirname(file),spec);
   if(!inside(dir,target)){problems.push(`${here} imports ${spec}, which is outside the built planner folder`);continue;}
   if(!existsSync(target)){problems.push(`${here} imports ${spec}, which was not built`);continue;}
   queue.push(target);
  }
  for(const {spec,names} of namedImports(src)){
   const target=resolve(dirname(file),spec);
   if(!inside(dir,target)||!existsSync(target)||!/\.m?js$/.test(target))continue;
   const {names:have,wildcard}=exportsOf(readFileSync(target,'utf8'));
   for(const n of names)if(!have.has(n)&&!wildcard)problems.push(`${here} imports { ${n} } from ${spec}, which does not export it`);
  }
 }
 return {problems,seen:new Set([...seen].map(f=>relative(dir,f)))};
}
const ENTRY=['app.mjs'];

// Cuts the planner packaging block of a changed copy of build.mjs, so a control can show that the
// defect it models is the reason the check fails and not some other difference.
function mutate(text,from,to){const next=text.replace(from,to);assert.notEqual(next,text,`control target found: ${String(from).slice(0,60)}`);return next;}
const LOOP=/  for \(const name of \["haptics\.mjs"[^\n]*\n/;
const WEEKLY=/await writeFile\(planner\+"\/weekly-hours\.mjs",\(await readFile\("scripts\/scheduler-performance\/weekly-hours\.mjs","utf8"\)\)\.replace\("\.\.\/scheduler-proposal\/model\.mjs","\.\/model\.mjs"\)\);/;
const GENERATION=/\.replace\("\.\.\/scheduler-proposal\/model\.mjs","\.\/model\.mjs"\)\);\n  await writeFile\(planner\+"\/weekly-hours\.mjs"/;

test('the planner packaging block is found and runs, and the page still starts from app.mjs',async()=>{
 const dir=await packagePlanner();
 for(const name of ['app.mjs','model.mjs','month-model.mjs','shift-intervals.mjs','generation-worker.mjs'])assert.ok(existsSync(resolve(dir,name)),`${name} was built`);
 assert.ok(/<script type="module" src="app\.mjs"/.test(buildText),'the planner page still loads app.mjs');
});

test('everything app.mjs and the generation worker reach, directly or through other modules, was built',async()=>{
 const dir=await packagePlanner(),{problems,seen}=inspect(dir,ENTRY);
 assert.deepEqual(problems,[]);
 // The worker is reached through new URL(), not an import. The walk must have followed it.
 assert.ok(seen.has('generation-worker.mjs')&&seen.has('generation.mjs'),'worker and what it imports were checked');
 // Reached only through month-model and weekly-hours, never from app.mjs itself.
 assert.ok(seen.has('legacy-store-interval.mjs'));
 assert.ok(!specifiers(readFileSync(resolve(dir,'app.mjs'),'utf8')).some(s=>s.endsWith('legacy-store-interval.mjs')),'transitive on purpose');
 // Nothing built may still point at the source tree.
 for(const name of seen)assert.ok(!/\.\.\/scheduler-proposal\//.test(readFileSync(resolve(dir,name),'utf8')),`${name} has no source-tree import left`);
});

test('every named import in the built planner is exported by the file it names',async()=>{
 const dir=await packagePlanner(),{problems,seen}=inspect(dir,ENTRY);
 assert.deepEqual(problems.filter(p=>p.includes('does not export')),[]);
 // Guard against a vacuous pass: the parser must see real named imports and real exports.
 const sample=namedImports(readFileSync(resolve(dir,'month-model.mjs'),'utf8'));
 assert.ok(sample.some(i=>i.names.includes('ruleFor')),'month-model.mjs imports ruleFor');
 assert.ok(exportsOf(readFileSync(resolve(dir,'model.mjs'),'utf8')).names.has('ruleFor'),'model.mjs exports ruleFor');
 assert.ok(seen.size>=20);
});

// Controls: each defect the independent review named, applied to a copy of the real block.
test('control: a copy list commented out entirely is caught',async()=>{
 const dir=await packagePlanner(mutate(buildText,LOOP,m=>'  // '+m.trimStart()));
 const {problems}=inspect(dir,ENTRY);
 assert.ok(problems.some(p=>/was not built|missing/.test(p)),problems.join('\n'));
});
test('control: the one name this fix added, taken out again, is caught and attributed to the importer',async()=>{
 const dir=await packagePlanner(mutate(buildText,' "legacy-store-interval.mjs",',''));
 const {problems}=inspect(dir,ENTRY);
 assert.ok(problems.some(p=>/^(month-model|weekly-hours)\.mjs imports \.\/legacy-store-interval\.mjs/.test(p)),problems.join('\n'));
});
test('control: weekly-hours without its path rewrite is caught even if another file is rewritten twice',async()=>{
 let text=mutate(buildText,WEEKLY,'await writeFile(planner+"/weekly-hours.mjs",await readFile("scripts/scheduler-performance/weekly-hours.mjs","utf8"));');
 text=mutate(text,GENERATION,'.replace("../scheduler-proposal/model.mjs","./model.mjs").replace("../scheduler-proposal/model.mjs","./model.mjs"));\n  await writeFile(planner+"/weekly-hours.mjs"');
 const dir=await packagePlanner(text);
 const {problems}=inspect(dir,ENTRY);
 assert.ok(problems.some(p=>/^weekly-hours\.mjs imports \.\.\/scheduler-proposal\/model\.mjs/.test(p)),problems.join('\n'));
});
test('control: a name imported from a built file that does not export it is caught',async()=>{
 const dir=await packagePlanner(),{problems:before}=inspect(dir,ENTRY);assert.deepEqual(before,[]);
 await fsWriteFile(resolve(dir,'shift-intervals.mjs'),readFileSync(resolve(dir,'shift-intervals.mjs'),'utf8').replace('export function localInterval','function localInterval'));
 const {problems}=inspect(dir,ENTRY);
 assert.ok(problems.some(p=>/\{ localInterval \} from \.\/shift-intervals\.mjs, which does not export it/.test(p)),problems.join('\n'));
});

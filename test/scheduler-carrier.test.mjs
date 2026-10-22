import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {verifyCarrier as verify,protectedPaths,hash} from '../scripts/scheduler-carrier/verify.mjs';
const root=new URL('../',import.meta.url),bytes=readFileSync(new URL('../scripts/scheduler-carrier/runtime.json',import.meta.url));
const read=p=>readFileSync(new URL(p,root));
const paths=protectedPaths(root);
const verifyCarrier=(bytes,read,files=paths)=>verify(bytes,read,files);
test('reviewed carrier source matches exact enumerated manifest',()=>assert.equal(verifyCarrier(bytes,read),191));
for(const path of ['package.json','package-lock.json','src/Manager.jsx','src/LeadPerformanceCalculator.jsx','api/_scheduler-pg-transport.mjs','api/scheduler-manual.mjs','src/scheduler-manual-client.mjs','vercel.json','scripts/scheduler-manual/policy.sql'])test('refuses changed carrier '+path,()=>assert.throws(()=>verifyCarrier(bytes,p=>p===path?Buffer.concat([read(p),Buffer.from(' ') ]):read(p))));
test('refuses missing source',()=>assert.throws(()=>verifyCarrier(bytes,p=>{if(p==='api/scheduler-manual.mjs')throw Error('missing');return read(p);} )));
for(const kind of ['drop','add','duplicate','unsafe','pending','hash'])test('refuses manifest '+kind,()=>{
 const m=JSON.parse(bytes);
 if(kind==='drop')delete m.files['package.json'];
 if(kind==='add')m.files['src/unreviewed.mjs']='0'.repeat(64);
 if(kind==='unsafe')m.files['../escape']='0'.repeat(64);
 if(kind==='pending')m.files['package.json']='PENDING';
 if(kind==='hash')m.files['package.json']='0'.repeat(64);
 const damaged=kind==='duplicate'?bytes.toString().replace('"version":','"version":"duplicate", "version":'):JSON.stringify(m);
 assert.throws(()=>verifyCarrier(damaged,read));
});
test('missing required pinned fixture fails instead of successful skips',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sage-required-fixture-'));
 try{
  execFileSync('git',['init','--quiet',dir]);
  const result=spawnSync(process.execPath,['--test',new URL('./scheduler-draft-binding.test.mjs',import.meta.url).pathname],{cwd:dir,encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/Required exact bridge fixture/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('historical manifest verifier stays byte-identical to candidate',()=>{
 const file='.github/workflows/manager-spacing.yml';
 // Exact inline verifier from candidate 2861377737f2e04a1d7d462793010f2f2e6085c1; no additional history fixture required.
 const extract=s=>s.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0];
 assert.equal(hash(extract(read(file).toString())),'78ec9a9f007f87d54452cc7e637d00756ab5189e06f6d8bef5a51f51f1ad7e6c');
});

for(const file of ['scheduler-editor.yml','scheduler-integration.yml'])test('exact synthetic workflow admission '+file,()=>{
 const text=read('.github/workflows/'+file).toString();
 const expressions=[...text.matchAll(/    if: >-\n([\s\S]*?)    runs-on:/g)].map(m=>m[1].trim());assert.ok(expressions.length);
 const repo='jorgeasenrivera/lead-performance-calculator';
 for(const expr of expressions)for(const [head,base,same,want] of [
 ['claude/scheduler-editor-runtime','claude/scheduler-live-integration',true,true],
 ['claude/scheduler-editor-runtime','main',true,false],
 ['codex/scheduler-published-delivery-local','main',true,true],
 ['codex/scheduler-published-delivery-local','claude/scheduler-live-integration',true,false],
 ['codex/scheduler-published-delivery-local','main',false,false],
 ['unreviewed','main',true,false],
 ])assert.equal(runInNewContext(expr,{github:{repository:repo,event_name:'pull_request',head_ref:head,base_ref:base,event:{pull_request:{head:{repo:{full_name:same?repo:'other/repository'}}}}}}),want,head+' -> '+base);
 assert.match(text,/contents: read/);assert.match(text,/branches: \[claude\/scheduler-live-integration, main\]/);
});

test('refuses new unlisted application/API source and missing listed source',()=>{
 assert.throws(()=>verifyCarrier(bytes,read,[...paths,'api/unreviewed.mjs']),/unlisted or missing/);
 assert.throws(()=>verifyCarrier(bytes,read,[...paths,'src/unreviewed.jsx']),/unlisted or missing/);
 assert.throws(()=>verifyCarrier(bytes,read,paths.filter(p=>p!=='api/scheduler-manual.mjs')),/unlisted or missing/);
});

test('on-disk source discovery refuses an added route without manifest edits',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sage-carrier-tree-'));
 try{
  for(const path of paths){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),'');}
  const url=pathToFileURL(dir+'/');assert.equal(verifyCarrier(bytes,read,protectedPaths(url)),191);
  writeFileSync(join(dir,'api/unreviewed.mjs'),'export default ()=>{}');
  assert.throws(()=>verifyCarrier(bytes,read,protectedPaths(url)),/unlisted or missing/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {POLICY,validateEvent,runtimeFor,verifyRouted,sealBuild,verifyBuild,verifyServedBuild} from '../scripts/manager-spacing-runtime.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(extra=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spacing-route-')),definition=path.join(dir,'definition');fs.mkdirSync(definition);
 const git=(...args)=>execFileSync('git',['-C',definition,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const write=(name,value)=>{const f=path.join(definition,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);};
 git('init','-q');git('config','user.name','Spacing test');git('config','user.email','spacing@example.invalid');
 write('.gitignore','node_modules\ndist\n.env.local\n');write('package.json','{"dependencies":{},"devDependencies":{}}');write('package-lock.json','{"packages":{}}');write('src/Manager.jsx','historical');
 for(const name of ['scripts/scheduler-current-runtime/verify.mjs','scripts/scheduler-current-runtime/manifest.json','scripts/scheduler-current-runtime/main-579727d.manifest.json','test/scheduler-current-runtime.test.mjs'])write(name,'frozen '+name);
 const manifest=sha('historical')+'  src/Manager.jsx\n';write(POLICY.manifest.path,manifest);git('add','.');git('commit','-qm','base');
 const base={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 write('src/Manager.jsx','current');write('src/hero.css','hero');git('add','.');git('commit','-qm','source');
 const current={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 for(const file of POLICY.qualification)write(file,'reviewed '+file);if(extra)write('src/unreviewed.jsx','unreviewed');git('add','.');git('commit','-qm','definition');const head=git('rev-parse','HEAD');
 const merge=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-p',base.commit,'-p',head,'-m','synthetic event');
 const currentRoot=path.join(dir,'current'),historicalRoot=path.join(dir,'historical'),eventRoot=path.join(dir,'event');
 for(const [root,commit]of [[currentRoot,current.commit],[historicalRoot,base.commit],[eventRoot,merge]])git('worktree','add','--quiet','--detach',root,commit);
 const policy={...POLICY,base,current,historical:base,manifest:{path:POLICY.manifest.path,sha256:sha(manifest)}};
 const event={repository:{full_name:POLICY.repository},number:521,pull_request:{head:{repo:{full_name:POLICY.repository},ref:POLICY.branch,sha:head},base:{repo:{full_name:POLICY.repository},ref:'main',sha:base.commit}}};
 const env={GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:POLICY.repository,GITHUB_REF:'refs/pull/521/merge',GITHUB_SHA:merge,VITE_SUPABASE_URL:'http://127.0.0.1:5433',VITE_SUPABASE_ANON_KEY:'mock-anon-key',VITE_SCHEDULER_CALENDAR:'0',VITE_SCHEDULER_DRAFT_LOCAL:'0',VITE_SCHEDULER_DRAFT_PILOT:'0',SCHEDULER_DRAFT_PILOT_ENABLED:'0'};
 return{dir,git,definition,currentRoot,historicalRoot,eventRoot,policy,event,env,head,run(name='current',changes={}){return verifyRouted({runtimeRoot:name==='current'?currentRoot:historicalRoot,definitionRoot:definition,eventRoot,event,env,caseName:name,...changes},policy);},close(){fs.rmSync(dir,{recursive:true,force:true});}};
}
test('separate historical and current checkouts qualify exact immutable runtime bytes',()=>{const f=fixture();try{const old=f.run('historical'),current=f.run();assert.equal(old.runtimeCommit,f.policy.historical.commit);assert.equal(current.runtimeCommit,f.policy.current.commit);assert.notEqual(old.runtimeTree,current.runtimeTree);assert.equal(old.caseName,'historical-search');assert.equal(current.caseName,'current-hero');assert.equal(current.definitionCommit,f.head);}finally{f.close();}});
test('routing rejects unknown cases and cross-wired checkout sources',()=>{const f=fixture();try{assert.throws(()=>runtimeFor('legacy'),/explicit runtime/);assert.throws(()=>f.run('historical',{runtimeRoot:f.currentRoot}),/served runtime commit/);assert.throws(()=>f.run('current',{runtimeRoot:f.historicalRoot}),/served runtime commit/);}finally{f.close();}});
test('event admission keeps the exact repository, branch, base and OFF gates',()=>{const f=fixture();try{
 for(const [name,mutate]of [
  ['event type',(e,v)=>v.GITHUB_EVENT_NAME='push'],['repository',(e,v)=>v.GITHUB_REPOSITORY='other/repo'],['event repo',e=>e.repository.full_name='other/repo'],['PR',e=>e.number=512],
  ['fork head',e=>e.pull_request.head.repo.full_name='other/repo'],['fork base',e=>e.pull_request.base.repo.full_name='other/repo'],['head branch',e=>e.pull_request.head.ref='main'],['base branch',e=>e.pull_request.base.ref='other'],['base commit',e=>e.pull_request.base.sha='f'.repeat(40)],['head identity',e=>e.pull_request.head.sha='short'],
  ['calendar gate',(e,v)=>v.VITE_SCHEDULER_CALENDAR='1'],['local save',(e,v)=>v.VITE_SCHEDULER_DRAFT_LOCAL='1'],['pilot save',(e,v)=>v.VITE_SCHEDULER_DRAFT_PILOT='1'],['server pilot',(e,v)=>v.SCHEDULER_DRAFT_PILOT_ENABLED='1'],['real service',(e,v)=>v.VITE_SUPABASE_URL='https://example.invalid'],['real key',(e,v)=>v.VITE_SUPABASE_ANON_KEY='different'],
 ]){const e=structuredClone(f.event),v={...f.env};mutate(e,v);assert.throws(()=>validateEvent(e,v,f.policy),name);}
 }finally{f.close();}});
test('a qualification head cannot smuggle in any application change',()=>{const f=fixture(true);try{assert.throws(()=>f.run(),/qualification changes only/);}finally{f.close();}});
test('definition and event identities do not substitute arbitrary current trees',()=>{const f=fixture();try{
 assert.throws(()=>f.run('current',{env:{...f.env,GITHUB_SHA:'f'.repeat(40)}}),/actual event checkout/);
 assert.throws(()=>f.run('current',{env:{...f.env,GITHUB_REF:'refs/heads/main'}}),/merge event ref/);
 const wrong=structuredClone(f.policy);wrong.current.tree='f'.repeat(40);assert.throws(()=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event:f.event,env:f.env,caseName:'current'},wrong),/immutable hero source tree/);
 const changed=structuredClone(f.event);changed.pull_request.head.sha='f'.repeat(40);assert.throws(()=>f.run('current',{event:changed}),/definition checkout/);
 }finally{f.close();}});
test('changed, extra, missing and linked consumed inputs are refused',()=>{const f=fixture();try{
 const p=path.join(f.currentRoot,'src/Manager.jsx'),original=fs.readFileSync(p);
 fs.writeFileSync(p,'tampered');assert.throws(()=>f.run(),/input (size|hash)/);fs.writeFileSync(p,original);
 const extra=path.join(f.currentRoot,'src/extra.jsx');fs.writeFileSync(extra,'extra');assert.throws(()=>f.run(),/complete consumed source inventory/);fs.unlinkSync(extra);
 fs.unlinkSync(p);assert.throws(()=>f.run(),/complete consumed source inventory/);fs.writeFileSync(p,original);
 fs.unlinkSync(p);fs.symlinkSync(path.join(f.definition,'src/Manager.jsx'),p);assert.throws(()=>f.run(),/source symlink/);fs.unlinkSync(p);fs.writeFileSync(p,original);
 }finally{f.close();}});
test('ignored build configuration cannot change services or override flags',()=>{const f=fixture();try{
 const p=path.join(f.currentRoot,'.env.local');fs.writeFileSync(p,'VITE_SUPABASE_URL=https://example.invalid\n');assert.throws(()=>f.run(),/existing synthetic build fixture/);fs.unlinkSync(p);
 const other=path.join(f.currentRoot,'.env.production');fs.writeFileSync(other,'VITE_SCHEDULER_CALENDAR=1');assert.throws(()=>f.run(),/unreviewed build configuration/);fs.unlinkSync(other);
 }finally{f.close();}});
test('the frozen manifest and physical definition bytes remain independent checks',()=>{const f=fixture();try{
 const q=path.join(f.definition,POLICY.qualification[1]),old=fs.readFileSync(q);fs.writeFileSync(q,'mutated');assert.throws(()=>f.run(),/checkout qualification bytes/);fs.writeFileSync(q,old);
 const p=path.join(f.definition,POLICY.manifest.path),manifest=fs.readFileSync(p);fs.writeFileSync(p,'rehash');assert.throws(()=>f.run(),/historical manifest remains unchanged/);fs.writeFileSync(p,manifest);
 }finally{f.close();}});
test('workflow routes both engines to frozen runtime directories and unmodified assertions',()=>{
 const source=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 assert.match(source,/engine: \[chromium, webkit\]/);assert.ok(source.includes(POLICY.historical.commit)&&source.includes(POLICY.current.commit));
 assert.match(source,/path: spacing-definition/);assert.match(source,/path: spacing-event/);assert.match(source,/manager-spacing-runtime\.mjs before-install/);assert.match(source,/manager-spacing-runtime\.mjs post-measure/);
 assert.match(source,/DRIVERS="\$GITHUB_WORKSPACE\/spacing-definition\/scripts"/);assert.match(source,/node "\$DRIVERS\/manager-spacing\.mjs"/);assert.match(source,/path: manager-spacing-proof\//);
 assert.match(source,/permissions:\s*contents: read/);assert.doesNotMatch(source,/pull_request_target|secrets\.|permissions:\s*write-all/);
});

test('fresh build seal rejects changed, missing, extra and linked outputs and wrong source',()=>{
 const f=fixture();try{
  const dist=path.join(f.currentRoot,'dist');fs.mkdirSync(dist);fs.writeFileSync(path.join(dist,'index.html'),'synthetic entry');
  const evidence=f.run(),sealed=sealBuild(f.currentRoot,evidence);verifyBuild(f.currentRoot,sealed,evidence);
  fs.writeFileSync(path.join(dist,'extra.js'),'extra');assert.throws(()=>verifyBuild(f.currentRoot,sealed,evidence),/sealed build bytes and inventory/);fs.unlinkSync(path.join(dist,'extra.js'));
  fs.writeFileSync(path.join(dist,'index.html'),'changed');assert.throws(()=>verifyBuild(f.currentRoot,sealed,evidence),/sealed build bytes and inventory/);fs.unlinkSync(path.join(dist,'index.html'));
  assert.throws(()=>verifyBuild(f.currentRoot,sealed,evidence),/sealed build bytes and inventory/);
  fs.symlinkSync(path.join(f.currentRoot,'src/Manager.jsx'),path.join(dist,'index.html'));assert.throws(()=>verifyBuild(f.currentRoot,sealed,evidence),/regular build output/);fs.unlinkSync(path.join(dist,'index.html'));fs.writeFileSync(path.join(dist,'index.html'),'synthetic entry');
  assert.throws(()=>verifyBuild(f.currentRoot,{...sealed,runtimeCommit:'f'.repeat(40)},evidence),/build runtime commit/);
  assert.throws(()=>verifyBuild(f.currentRoot,{...sealed,flags:{}},evidence),/build flags/);
 }finally{f.close();}
});
test('HTTP source binding rejects a wrong server, changed bytes and unsafe paths',async()=>{
 const outputs=[{path:'index.html',bytes:4,sha256:sha('real')}],seen=[];
 const good=async url=>{seen.push(url);return new Response('real',{status:200});};
 await verifyServedBuild({outputs},good);assert.deepEqual(seen,['http://127.0.0.1:5178/index.html']);
 await assert.rejects(()=>verifyServedBuild({outputs},async()=>new Response('fake',{status:200})),/served hash/);
 await assert.rejects(()=>verifyServedBuild({outputs},async()=>new Response('real',{status:404})),/served output/);
 await assert.rejects(()=>verifyServedBuild({outputs:[{...outputs[0],path:'../private'}]},good),/safe build path/);
});

test('physical historical verifier and manifest assets cannot drift behind a frozen Git head',()=>{
 const f=fixture();try{for(const name of ['scripts/scheduler-current-runtime/verify.mjs','scripts/scheduler-current-runtime/manifest.json','scripts/scheduler-current-runtime/main-579727d.manifest.json','test/scheduler-current-runtime.test.mjs']){
  const p=path.join(f.definition,name),before=fs.readFileSync(p);fs.writeFileSync(p,'changed');assert.throws(()=>f.run(),/preserved qualification checkout bytes/);fs.writeFileSync(p,before);
 }}finally{f.close();}
});
test('the unchanged provider is authenticated before any of its code executes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spacing-provider-'));try{
  fs.mkdirSync(path.join(root,'scheduler-current-runtime'));fs.copyFileSync(new URL('../scripts/manager-spacing-runtime.mjs',import.meta.url),path.join(root,'helper.mjs'));
  const marker=path.join(root,'executed');fs.writeFileSync(path.join(root,'scheduler-current-runtime/verify.mjs'),"import fs from 'node:fs';fs.writeFileSync("+JSON.stringify(marker)+",'bad');");
  assert.throws(()=>execFileSync(process.execPath,[path.join(root,'helper.mjs')],{stdio:'pipe'}),/frozen verifier provider before import/);assert.equal(fs.existsSync(marker),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

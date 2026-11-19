import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY,DUET_STORE_CARD_POLICY,ROOMS_HINT_POLICY,DUET_COPY_POLICY,PEOPLE_SCHEDULER_COPY_POLICY,STORE_HERO_LAYOUT_POLICY,MANAGER_PAGES_POLICY,STORE_ROOM_VISIBILITY_POLICY,MOTION_KIT_POLICY,policyForPullRequest,validateEvent,runtimeFor,verifyRouted,sealBuild,verifyBuild,verifyServedBuild} from '../scripts/manager-spacing-runtime.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(extra=false,withSnapshot=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spacing-route-')),definition=path.join(dir,'definition');fs.mkdirSync(definition);
 const git=(...args)=>execFileSync('git',['-C',definition,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const write=(name,value)=>{const f=path.join(definition,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);};
 git('init','-q');git('config','user.name','Spacing test');git('config','user.email','spacing@example.invalid');
 write('.gitignore','node_modules\ndist\n.env.local\n');write('package.json','{"dependencies":{},"devDependencies":{}}');write('package-lock.json','{"packages":{}}');write('src/Manager.jsx','historical');
 for(const name of ['scripts/scheduler-current-runtime/verify.mjs','scripts/scheduler-current-runtime/manifest.json','scripts/scheduler-current-runtime/main-579727d.manifest.json','test/scheduler-current-runtime.test.mjs'])write(name,'frozen '+name);
 const manifest=sha('historical')+'  src/Manager.jsx\n';write(POLICY.manifest.path,manifest);git('add','.');git('commit','-qm','base');
 const priorBase={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 if(withSnapshot){write('vercel.json','{"syntheticBase":"current"}\n');git('add','.');git('commit','-qm','current base');}
 const base={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 write('src/Manager.jsx','current');write('src/hero.css','hero');git('add','.');git('commit','-qm','source');
 const current={commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
 for(const file of POLICY.qualification)write(file,'reviewed '+file);if(extra)write('src/unreviewed.jsx','unreviewed');git('add','.');git('commit','-qm','definition');const head=git('rev-parse','HEAD');
 const merge=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-p',base.commit,'-p',head,'-m','synthetic event');
 const currentRoot=path.join(dir,'current'),historicalRoot=path.join(dir,'historical'),eventRoot=path.join(dir,'event');
 for(const [root,commit]of [[currentRoot,current.commit],[historicalRoot,priorBase.commit],[eventRoot,merge]])git('worktree','add','--quiet','--detach',root,commit);
 const policy={...POLICY,base,current,historical:priorBase,eventBaseSnapshot:withSnapshot?priorBase:undefined,manifest:{path:POLICY.manifest.path,sha256:sha(manifest)}};
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

test('the exact observed PR snapshot is recorded separately from the consumed current base',()=>{
 const f=fixture(false,true);try{
  const event=structuredClone(f.event);event.pull_request.base.sha=f.policy.eventBaseSnapshot.commit;const original=JSON.stringify(event);
  for(const name of ['historical','current']){
   const result=f.run(name,{event});assert.equal(result.baseCommit,f.policy.base.commit);assert.equal(result.baseTree,f.policy.base.tree);
   assert.equal(result.baseRef,'main');assert.equal(result.eventBaseCommit,f.policy.eventBaseSnapshot.commit);assert.equal(result.eventBaseTree,f.policy.eventBaseSnapshot.tree);assert.equal(result.eventBaseKind,'pinned-pr-snapshot');
  }
  assert.equal(JSON.stringify(event),original,'qualification never rewrites the event');
  assert.equal(f.run().eventBaseKind,'current-base','a fresh current-base event remains supported');
 }finally{f.close();}
});
test('a pinned snapshot requires the current-base synthetic merge and cannot qualify a head-only checkout',()=>{
 const f=fixture(false,true);try{
  const event=structuredClone(f.event);event.pull_request.base.sha=f.policy.eventBaseSnapshot.commit;
  assert.throws(()=>f.run('current',{event,eventRoot:f.definition,env:{...f.env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/521/head'}}),/stale event snapshot requires an exact current-base merge checkout/);
  assert.equal(f.run('current',{eventRoot:f.definition,env:{...f.env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/521/head'}}).eventBaseKind,'current-base');
 }finally{f.close();}
});
test('unknown event bases, snapshot trees, branch refs, heads and checkout identities refuse',()=>{
 const f=fixture(false,true);try{
  const event=structuredClone(f.event);event.pull_request.base.sha=f.policy.eventBaseSnapshot.commit;
  for(const [label,mutate]of [
   ['unknown base',e=>e.pull_request.base.sha='f'.repeat(40)],['unreviewed source as base',e=>e.pull_request.base.sha=f.policy.current.commit],
   ['wrong base ref',e=>e.pull_request.base.ref='other'],['wrong head ref',e=>e.pull_request.head.ref='other'],['wrong head',e=>e.pull_request.head.sha=f.policy.current.commit],
  ]){const changed=structuredClone(event);mutate(changed);assert.throws(()=>f.run('current',{event:changed}),label);}
  for(const ref of ['refs/pull/521/head','refs/pull/522/merge','refs/heads/main'])assert.throws(()=>f.run('current',{event,env:{...f.env,GITHUB_REF:ref}}),/merge event ref/);
  assert.throws(()=>f.run('current',{event,env:{...f.env,GITHUB_SHA:f.head}}),/actual event checkout/);
  const policy={...f.policy,eventBaseSnapshot:{...f.policy.eventBaseSnapshot,tree:'f'.repeat(40)}};
  assert.throws(()=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env:f.env,caseName:'current'},policy),/immutable PR event snapshot tree/);
 }finally{f.close();}
});
test('a matching old snapshot cannot replace, reorder or extend the exact current-base merge parents',()=>{
 const f=fixture(false,true);try{
  const event=structuredClone(f.event);event.pull_request.base.sha=f.policy.eventBaseSnapshot.commit;
  const tree=f.git('rev-parse','HEAD^{tree}'),original=execFileSync('git',['-C',f.eventRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  for(const parents of [[f.policy.eventBaseSnapshot.commit,f.head],[f.head,f.policy.base.commit],[f.policy.current.commit,f.head],[f.policy.base.commit,f.head,f.policy.eventBaseSnapshot.commit]]){
   const wrong=f.git('commit-tree',tree,...parents.flatMap(p=>['-p',p]),'-m','wrong synthetic merge');execFileSync('git',['-C',f.eventRoot,'update-ref','HEAD',wrong]);
   assert.throws(()=>f.run('current',{event,env:{...f.env,GITHUB_SHA:wrong}}),/exact merge parents/);
  }
  execFileSync('git',['-C',f.eventRoot,'update-ref','HEAD',original]);
  const policy={...f.policy,eventBaseSnapshot:f.policy.current},other=structuredClone(event);other.pull_request.base.sha=f.policy.current.commit;
  assert.throws(()=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event:other,env:f.env,caseName:'current'},policy),/pinned snapshot is the exact parent of the current base/);
 }finally{f.close();}
});
test('the snapshot exception cannot admit a changed merge tree or changed served source',()=>{
 const f=fixture(false,true);try{
  const event=structuredClone(f.event);event.pull_request.base.sha=f.policy.eventBaseSnapshot.commit;
  const input=path.join(f.definition,'src/Manager.jsx'),bytes=fs.readFileSync(input);fs.writeFileSync(input,'changed merge input');f.git('add','src/Manager.jsx');
  const wrong=f.git('commit-tree',f.git('write-tree'),'-p',f.policy.base.commit,'-p',f.head,'-m','changed merge tree');fs.writeFileSync(input,bytes);f.git('read-tree',f.head);
  execFileSync('git',['-C',f.eventRoot,'update-ref','HEAD',wrong]);assert.throws(()=>f.run('current',{event,env:{...f.env,GITHUB_SHA:wrong}}),/event introduces no source drift/);
  const actual=f.git('commit-tree',f.git('rev-parse','HEAD^{tree}'),'-p',f.policy.base.commit,'-p',f.head,'-m','current merge');execFileSync('git',['-C',f.eventRoot,'update-ref','HEAD',actual]);
  fs.writeFileSync(path.join(f.currentRoot,'src/Manager.jsx'),'changed served source');assert.throws(()=>f.run('current',{event,env:{...f.env,GITHUB_SHA:actual}}),/input (size|hash)/);
 }finally{f.close();}
});

test('the diagnostic qualifies the two exact mock identities and refuses case or content substitution',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const observer=workflow.match(/const observerSource = String.raw`([\s\S]*?)`;/)[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const legacy=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8').match(/const observerSource = String.raw`([\s\S]*?)`;/)[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 assert.equal(observer.split("if(process.env.SAGE_CORS_TRACE==='1')")[0],legacy.split("if(process.env.SAGE_CORS_TRACE==='1')")[0],'all metadata filters and pass-through instrumentation remain unchanged');
 const entries={historical:"console.log('HISTORICAL_SYNTHETIC_ENTRY');\n",current:"console.log('CURRENT_SYNTHETIC_ENTRY');\n"};
 const hashes={historical:'4eb28e662bcaf0b1d3f206f4066f3dab6d59007f960071f376d9fe638fb0c1ba',current:'5eb2b29d000f8882acfde50930b3893def42f3a0c89ce303ec2368b00bf4f2a3'};
 for(const [name,hash]of Object.entries(hashes))assert.ok(observer.includes("['"+name+"','"+hash+"']"),'independent frozen '+name+' identity');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spacing-mock-trace-'));try{
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'manager-runtime-qualification'));
  const preload=path.join(dir,'observer.cjs'),entry=path.join(dir,'scripts/mock-supabase.mjs'),trace=path.join(dir,'manager-runtime-qualification/cors-trace.ndjson');
  // Only this nonnetwork unit fixture substitutes tiny entry hashes. The
  // production workflow keeps both independently verified mock hashes.
  fs.writeFileSync(preload,observer.replace(hashes.historical,sha(entries.historical)).replace(hashes.current,sha(entries.current)));
  const run=(name)=>execFileSync(process.execPath,['--require',preload,entry],{cwd:dir,env:{...process.env,ROUTED_HERO:'true',SAGE_CORS_TRACE:'1',SAGE_CORS_TRACE_PATH:trace,SPACING_RUNTIME_CASE:name},encoding:'utf8',stdio:'pipe'});
  for(const name of ['historical','current']){
   fs.writeFileSync(entry,entries[name]);fs.writeFileSync(trace,'');const output=run(name);assert.ok(output.includes(name.toUpperCase()+'_SYNTHETIC_ENTRY'));
   const marker=JSON.parse(fs.readFileSync(trace,'utf8').trim());assert.equal(marker.kind,'observer-start');assert.equal(marker.source,'mock');
  }
  fs.writeFileSync(entry,entries.current);assert.throws(()=>run('historical'),/frozen diagnostic entry/);
  fs.writeFileSync(entry,entries.historical);assert.throws(()=>run('current'),/frozen diagnostic entry/);
  assert.throws(()=>run('unknown'),/qualified diagnostic mock case/);
  fs.writeFileSync(entry,entries.historical+'\n');assert.throws(()=>run('historical'),/frozen diagnostic entry/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the Calendar runner selects the installed Chromium and preserves WebKit and missing-binary refusal',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const script=workflow.match(/      - name: Exercise the current Calendar entry with saving disabled[\s\S]*?        run: \|\n([\s\S]*?)      - name: Recheck both source/)[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 assert.match(script,/chromium\.executablePath\(\)/);assert.match(script,/fs\.accessSync\(binary,fs\.constants\.X_OK\)/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spacing-browser-runner-'));try{
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'node_modules/playwright'),{recursive:true});
  const binary=path.join(dir,'bundled chromium'),marker=path.join(dir,'entry.json');fs.writeFileSync(binary,'synthetic executable fixture\n',{mode:0o755});
  fs.writeFileSync(path.join(dir,'node_modules/playwright/index.js'),'exports.chromium={executablePath(){return process.env.FIXTURE_BROWSER_PATH;}};\n');
  fs.writeFileSync(path.join(dir,'scripts/probe-scheduler-integration.mjs'),"import fs from 'node:fs';fs.writeFileSync(process.env.ENTRY_MARKER,JSON.stringify({engine:process.env.FEEL_BROWSER,binary:process.env.FEEL_CHROME||null}));\n");
  const env={...process.env,ENTRY_MARKER:marker,FIXTURE_BROWSER_PATH:binary};delete env.FEEL_CHROME;
  const run=engine=>execFileSync('sh',['-e','-c',script],{cwd:dir,env:{...env,FEEL_BROWSER:engine},stdio:'pipe'});
  run('chromium');assert.deepEqual(JSON.parse(fs.readFileSync(marker)),{engine:'chromium',binary});fs.unlinkSync(marker);
  run('webkit');assert.deepEqual(JSON.parse(fs.readFileSync(marker)),{engine:'webkit',binary:null});fs.unlinkSync(marker);
  env.FIXTURE_BROWSER_PATH=path.join(dir,'missing');assert.throws(()=>run('chromium'));assert.equal(fs.existsSync(marker),false,'the entry never runs after a missing binary');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('the parity route preserves the previous qualification and shares only the immutable historical case',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 assert.equal(policyForPullRequest(521),POLICY);assert.equal(policyForPullRequest(524),PARITY_POLICY);
 for(const number of [523,525,'524',undefined])assert.throws(()=>policyForPullRequest(number),/unqualified pull request/);
 assert.deepEqual(runtimeFor('historical',PARITY_POLICY),runtimeFor('historical',POLICY));
 assert.notEqual(runtimeFor('current',PARITY_POLICY).commit,runtimeFor('current',POLICY).commit);
 assert.match(PARITY_POLICY.current.tree,/^[0-9a-f]{40}$/);assert.match(PARITY_POLICY.base.tree,/^[0-9a-f]{40}$/);
 for(const policy of [POLICY,PARITY_POLICY]){
  assert.match(caller,new RegExp('number == '+policy.pullRequest+" && github.head_ref == '"+policy.branch+"'"));
  assert.ok(runner.includes(policy.current.commit),'each exact source checkout selects its matching policy');
 }
});

test('the parity route requires the reviewed repository, branch, base and merge event',()=>{
 const f=fixture();try{
  const event=structuredClone(f.event),policy={...PARITY_POLICY,base:f.policy.base,current:f.policy.current,historical:f.policy.historical,manifest:f.policy.manifest};
  event.number=524;event.pull_request.head.ref=policy.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/524/merge'};
  const check=(overrides={})=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(check().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>check({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/524/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>check({event:f.event}),/qualified pull request/);
  assert.throws(()=>check({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  for(const mutate of [
   e=>e.pull_request.head.repo.full_name='other/repo',
   e=>e.pull_request.base.repo.full_name='other/repo',
   e=>e.pull_request.head.ref=POLICY.branch,
   e=>e.pull_request.base.sha=f.policy.current.commit,
  ]){const bad=structuredClone(event);mutate(bad);assert.throws(()=>check({event:bad}));}
 }finally{f.close();}
});


test('the service totals route selects only #527 and pins separate historical and reviewed current inputs',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const policy=SERVICE_TOTALS_POLICY;
 assert.equal(policyForPullRequest(527),policy);assert.throws(()=>policyForPullRequest('527'),/unqualified pull request/);
 assert.equal(runtimeFor('historical',policy),POLICY.historical);
 assert.notEqual(runtimeFor('current',policy).commit,PARITY_POLICY.current.commit);
 assert.match(policy.current.tree,/^[0-9a-f]{40}$/);assert.match(policy.base.tree,/^[0-9a-f]{40}$/);
 assert.match(caller,/number == 527 && github.head_ref == 'claude\/project-thread-i2fcpc' && github.base_ref == 'main'/);
 assert.ok(runner.includes("number == 527 && '"+policy.current.commit+"'"));
 const f=fixture();try{
  const local={...policy,base:f.policy.base,current:f.policy.current,historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=527;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/527/merge'};
  const assertRoute=(overrides={})=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},local);
  assert.equal(assertRoute().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>assertRoute({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/527/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>assertRoute({event:{...event,number:524}}),/qualified pull request/);
  assert.throws(()=>assertRoute({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  for(const mutate of [
   e=>e.pull_request.head.repo.full_name='other/repo',
   e=>e.pull_request.base.repo.full_name='other/repo',
   e=>e.pull_request.head.ref='codex/review-copy',
   e=>e.pull_request.base.sha=f.policy.current.commit,
  ]){const wrong=structuredClone(event);mutate(wrong);assert.throws(()=>assertRoute({event:wrong}));}
 }finally{f.close();}
});


test('the People Service route pins its own source and shares only the immutable historical case',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const policy=PEOPLE_SERVICE_POLICY, number=policy.pullRequest;
 assert.equal(policyForPullRequest(number),policy);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.notEqual(runtimeFor('current',policy).commit,old.current.commit);
  assert.equal(runtimeFor('historical',policy),old.historical);
 }
 assert.deepEqual(policy.current.parents,['5e013fc694b31f21b4d7c68ef834b18dd61cb28d',policy.base.commit]);
 assert.deepEqual(policy.current.definitionChanges,['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs','test/manager-spacing-runtime.test.mjs']);
 assert.ok(caller.includes("number == "+number+" && github.head_ref == '"+policy.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+number+" && '"+policy.current.commit+"'"));
 const f=fixture();try{
  const local={...policy,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=number;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+number+'/merge'};
  const verify=(overrides={},scope=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},scope);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+number+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [
   e=>e.number=SERVICE_TOTALS_POLICY.pullRequest,
   e=>e.pull_request.head.repo.full_name='other/repo',
   e=>e.pull_request.base.repo.full_name='other/repo',
   e=>e.pull_request.head.ref=SERVICE_TOTALS_POLICY.branch,
   e=>e.pull_request.base.sha=f.policy.current.commit,
  ]){const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));}
 }finally{f.close();}
});


test('Duet #531 checks distinguish #527 on the same branch and retain historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=DUET_STORE_CARD_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.equal(p.branch,SERVICE_TOTALS_POLICY.branch);
 assert.notEqual(p.pullRequest,SERVICE_TOTALS_POLICY.pullRequest);
 assert.deepEqual(p.current.parents,['c66d16532145c736b85d1cbee6b391f84587e75e',p.base.commit]);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=527,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});

test('the Rooms copy checks use the exact current app, keeping independent historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=ROOMS_HINT_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=529,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});


test('Duet #535 copy checks verify exact current source while retaining all historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=DUET_COPY_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.notEqual(p.branch,SERVICE_TOTALS_POLICY.branch);
 assert.notEqual(p.pullRequest,SERVICE_TOTALS_POLICY.pullRequest);
 assert.ok(p.current.parents.length >= 1 && p.current.parents.length <= 2);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=527,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});


test('the People/Scheduler copy checks use the exact current app, keeping independent historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=PEOPLE_SCHEDULER_COPY_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=529,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});


test('Sage #538 layout checks verify exact current source while retaining all historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=STORE_HERO_LAYOUT_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.notEqual(p.branch,SERVICE_TOTALS_POLICY.branch);
 assert.notEqual(p.pullRequest,SERVICE_TOTALS_POLICY.pullRequest);
 assert.ok(p.current.parents.length >= 1 && p.current.parents.length <= 2);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=527,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});


test('Manager Pages and motion kit use the current Pages lanes in Chromium and WebKit',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=MANAGER_PAGES_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 const steps=runner.split('      - name: ');
 const heat=steps.find(s=>s.startsWith('Exercise Manager Pages navigation'));
 const plain=steps.find(s=>s.startsWith('Exercise the current Calendar entry'));
 const pagesWhen="matrix.runtime == 'current' && (github.event.pull_request.number == "+n+" || github.event.pull_request.number == "+MOTION_KIT_POLICY.pullRequest+")";
 assert.ok(heat.includes("if: "+pagesWhen));
 assert.ok(heat.includes("PROBE_SCHEDULER_FLAG: '0'")&&heat.includes("PROBE_MANAGER_PAGES: '1'"));
 assert.ok(heat.includes('/manager-pages-integration')&&plain.includes('/hero-integration'));
 assert.ok(heat.includes('node scripts/probe-scheduler-integration.mjs')&&plain.includes('node scripts/probe-scheduler-integration.mjs'));
 assert.ok(!plain.includes('PROBE_MANAGER_PAGES'));
 assert.ok(steps.indexOf(heat)<steps.findIndex(s=>s.startsWith('Recheck both source')));
 assert.ok(runner.includes("MANAGER_PAGES_CURRENT: $"+"{{ "+pagesWhen+" }}"));
 assert.ok(runner.includes('NAV_DRIVERS="$DRIVERS"'));
 for(const driver of ['manager-viewports','color-phone','search-keyboard','manager-selector','manager-spacing'])
  assert.ok(runner.includes('node "$NAV_DRIVERS/'+driver+'.mjs"'));
 for(const driver of ['hero-freshness','hero-bars','room-hero-colors'])
  assert.ok(runner.includes('node "$DRIVERS/'+driver+'.mjs"')||runner.includes('"$DRIVERS/'+driver+'.mjs"'));

 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=529,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});

test('Sage Rooms visibility checks verify exact current source while retaining all historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=STORE_ROOM_VISIBILITY_POLICY,n=p.pullRequest;
 assert.equal(p.base.commit,'855d6d8f1c6c55fe71fa8329aad197b07cf4486d');
 assert.equal(p.current.tree,'86ea8a8d285dc64bd5d6558c3dbcb4f987ed451e');
 assert.deepEqual(p.current.parents,['c2ed0bd5f14d165d7fda138a647eb00e398314aa']);
 assert.equal(policyForPullRequest(n),p);
 assert.notEqual(p.branch,SERVICE_TOTALS_POLICY.branch);
 assert.notEqual(p.pullRequest,SERVICE_TOTALS_POLICY.pullRequest);
 assert.ok(p.current.parents.length >= 1 && p.current.parents.length <= 2);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=527,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});


test('the motion kit checks use the exact current app, keeping independent historical lanes',()=>{
 const caller=fs.readFileSync(new URL('../.github/workflows/manager-spacing.yml',import.meta.url),'utf8');
 const runner=fs.readFileSync(new URL('../.github/workflows/manager-hero-spacing.yml',import.meta.url),'utf8');
 const p=MOTION_KIT_POLICY,n=p.pullRequest;
 assert.equal(policyForPullRequest(n),p);
 assert.ok(caller.includes("number == "+n+" && github.head_ref == '"+p.branch+"' && github.base_ref == 'main'"));
 assert.ok(runner.includes("number == "+n+" && '"+p.current.commit+"'"));
 assert.match(runner,/engine: \[chromium, webkit\]/);
 assert.match(runner,/runtime: \[historical, current\]/);
 assert.match(runner,/node "\$DRIVERS\/manager-spacing\.mjs"/);
 for(const old of [POLICY,PARITY_POLICY,SERVICE_TOTALS_POLICY,PEOPLE_SERVICE_POLICY]){
  assert.equal(policyForPullRequest(old.pullRequest),old);
  assert.equal(runtimeFor('historical',p),old.historical);
  assert.notEqual(runtimeFor('current',p).commit,old.current.commit);
 }
 const f=fixture();try{
  const local={...p,base:f.policy.base,current:{...f.policy.current,parents:[f.policy.base.commit]},historical:f.policy.historical,manifest:f.policy.manifest};
  const event=structuredClone(f.event);event.number=n;event.pull_request.head.ref=local.branch;
  const env={...f.env,GITHUB_REF:'refs/pull/'+n+'/merge'};
  const verify=(overrides={},policy=local)=>verifyRouted({runtimeRoot:f.currentRoot,definitionRoot:f.definition,eventRoot:f.eventRoot,event,env,caseName:'current',...overrides},policy);
  assert.equal(verify().runtimeCommit,f.policy.current.commit);
  assert.throws(()=>verify({eventRoot:f.definition,env:{...env,GITHUB_SHA:f.head,GITHUB_REF:'refs/pull/'+n+'/head'}}),/requires an exact merge checkout/);
  assert.throws(()=>verify({runtimeRoot:f.historicalRoot}),/served runtime commit/);
  assert.throws(()=>verify({},{...local,current:{...local.current,parents:[f.policy.current.commit]}}),/exact source anchor parents/);
  for(const change of [e=>e.number=529,e=>e.pull_request.head.ref='other/branch',e=>e.pull_request.head.repo.full_name='other/repo',
      e=>e.pull_request.base.repo.full_name='other/repo',e=>e.pull_request.base.sha=f.policy.current.commit]){
   const wrong=structuredClone(event);change(wrong);assert.throws(()=>verify({event:wrong}));
  }
 }finally{f.close();}
});

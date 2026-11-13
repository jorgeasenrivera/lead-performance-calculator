import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE as FIXED_SOURCE, SOURCE_TREE as FIXED_TREE, BASE as FIXED_BASE, CURRENT_SOURCE, CURRENT_SOURCE_TREE, CURRENT_BASE, CURRENT_BASE_TREE, CURRENT_QUALIFICATION, PRESERVED_MANIFESTS, REPOSITORY, BRANCH, QUALIFICATION, HARNESS_CORRECTION, BASELINES, git, sourceRecords, verifyCandidate, verifySource, verifyBaselines } from '../scripts/scheduler-current-runtime/verify.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let root, head, merge, event, env, SOURCE, SOURCE_TREE, BASE, policy;
const identity = {GIT_AUTHOR_NAME:'Synthetic runtime check', GIT_AUTHOR_EMAIL:'synthetic@example.invalid', GIT_COMMITTER_NAME:'Synthetic runtime check', GIT_COMMITTER_EMAIL:'synthetic@example.invalid'};
function commit(tree, parents) {
  return execFileSync('git', ['-C', root, 'commit-tree', tree, ...parents.flatMap(p => ['-p', p])], {input:'Synthetic qualification control\n',env:{...process.env,...identity}}).toString().trim();
}
function verify(e = event, variables = env) { return verifyCandidate({root, event:e, env:variables},policy); }
function editEvent(f) { const next = structuredClone(event); f(next); return next; }
function control(path, change, assertion) {
  const file = resolve(root, path), bytes = readFileSync(file);
  try { change(file, bytes); assertion(); } finally { rmSync(file,{force:true}); writeFileSync(file, bytes); }
}
before(() => {
  root = mkdtempSync(resolve(tmpdir(), 'sage-current-runtime-'));
  git(root, 'init', '-q');
  // Deliberately small synthetic Git history, independent of checkout depth.
  // These are fixture bytes, never an application or database qualification.
  const fixture = {
    '.gitignore':'node_modules/\ndist/\n.env*\n',
    'src/Manager.jsx':'// synthetic manager\n', 'src/main.jsx':'// synthetic entry\n',
    'api/scheduler.mjs':'// synthetic unavailable endpoint\n',
    'package.json':'{"dependencies":{},"devDependencies":{}}\n', 'package-lock.json':'{"packages":{}}\n',
    'native/App.js':'// synthetic wrapper\n','index.html':'<p>synthetic</p>\n',
    'scripts/mock-supabase.mjs':'// synthetic mock\n','scripts/demo-seed.mjs':'// synthetic data\n',
    'scripts/search-runtime.sha256':'synthetic historical manifest\n',
    'vercel.json':JSON.stringify({git:{deploymentEnabled:{[BRANCH]:false}}})+'\n',
    '.github/workflows/manager-spacing.yml':'name: synthetic historical case\n',
  };
  for (const [path,bytes] of Object.entries(fixture)) {
    mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),bytes);
  }
  git(root,'add','.'); BASE=commit(git(root,'write-tree').toString().trim(),[]);
  writeFileSync(resolve(root,'src/main.jsx'),'// synthetic reviewed entry\n');git(root,'add','.');
  SOURCE_TREE=git(root,'write-tree').toString().trim();SOURCE=commit(SOURCE_TREE,[BASE]);
  policy={sourceCommit:SOURCE,sourceTree:SOURCE_TREE,baseCommit:BASE,baseTree:git(root,'rev-parse',BASE+'^{tree}').toString().trim()};
  for (const path of QUALIFICATION) {
    mkdirSync(dirname(resolve(root,path)),{recursive:true});copyFileSync(resolve(sourceRoot,path),resolve(root,path));
  }
  writeFileSync(resolve(root,QUALIFICATION[1]),JSON.stringify({version:'scheduler-current-runtime/1',...policy,files:sourceRecords(root,SOURCE)},null,2)+'\n');
  git(root,'add','--',...QUALIFICATION);
  const tree = git(root,'write-tree').toString().trim();
  head = commit(tree,[SOURCE]); merge = commit(tree,[BASE,head]);
  git(root,'update-ref','HEAD',merge);
  event = {number:512,repository:{full_name:REPOSITORY},pull_request:{head:{sha:head,ref:BRANCH,repo:{full_name:REPOSITORY}},base:{sha:BASE,ref:'main',repo:{full_name:REPOSITORY}}}};
  env = {GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:merge,GITHUB_REF:'refs/pull/512/merge'};
});
after(() => {if(root)rmSync(root,{recursive:true,force:true});});

test('exact synthetic merge records actual checkout and head, while freezing the consumed source',()=>{
  const result=verify(); assert.equal(result.sourceCommit,SOURCE);assert.equal(result.sourceTree,SOURCE_TREE);
  assert.equal(result.headCommit,head);assert.equal(result.checkoutCommit,merge);assert.notEqual(head,merge);
  assert.equal(result.consumedFiles,12);
});
test('exact head checkout is also bound to Actions checkout identity',()=>{
  git(root,'update-ref','HEAD',head);
  try {assert.equal(verify(event,{...env,GITHUB_SHA:head,GITHUB_REF:'refs/pull/512/head'}).checkoutCommit,head);}
  finally {git(root,'update-ref','HEAD',merge);}
});
test('wrong event, repository, PR, fork, branches, base and checkout are refused',()=>{
  for(const variables of [{...env,GITHUB_EVENT_NAME:'push'},{...env,GITHUB_REPOSITORY:'other/repo'},{...env,GITHUB_SHA:head},{...env,GITHUB_REF:'refs/heads/main'}])assert.throws(()=>verify(event,variables));
  for(const mutate of [e=>e.number=513,e=>e.repository.full_name='other/repo',e=>e.pull_request.head.repo.full_name='fork/repo',e=>e.pull_request.base.repo.full_name='fork/repo',e=>e.pull_request.head.ref='codex/unprotected',e=>e.pull_request.base.ref='other',e=>e.pull_request.base.sha=SOURCE])assert.throws(()=>verify(editEvent(mutate)));
});
test('synthetic merge requires exact base and head parents',()=>{
  const wrong=commit(git(root,'rev-parse',head+'^{tree}').toString().trim(),[SOURCE,head]);git(root,'update-ref','HEAD',wrong);
  try {assert.throws(()=>verify(event,{...env,GITHUB_SHA:wrong}),/exact base and head/);}
  finally {git(root,'update-ref','HEAD',merge);}
});
test('runtime changes in source, API, packages, native, public and mock inputs are refused',()=>{
  for(const path of ['src/Manager.jsx','api/scheduler.mjs','package.json','package-lock.json','native/App.js','index.html','scripts/mock-supabase.mjs','scripts/demo-seed.mjs'])control(path,(file,bytes)=>writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')])),()=>assert.throws(()=>verify(),/runtime (size|hash)/));
});
test('missing, extra and ignored relevant files, symlinks and environment config are refused',()=>{
  control('src/main.jsx',file=>rmSync(file),()=>assert.throws(()=>verify(),/inventory/));
  for(const path of ['src/extra-runtime.js','scripts/extra-runtime.mjs','.env.production','.npmrc']){
    writeFileSync(resolve(root,path),'synthetic extra\n');try {assert.throws(()=>verify(),/inventory/);}finally {rmSync(resolve(root,path));}
  }
  control('src/main.jsx',file=>{rmSync(file);symlinkSync('Manager.jsx',file);},()=>assert.throws(()=>verify(),/symlink/));
});
test('enabled deployment and scheduler flags are refused',()=>{
  control('vercel.json',(file,bytes)=>{const data=JSON.parse(bytes);data.git.deploymentEnabled[BRANCH]=true;writeFileSync(file,JSON.stringify(data));},()=>assert.throws(()=>verify(),/deployment disabled/));
  for(const flag of ['VITE_SCHEDULER_CALENDAR','VITE_SCHEDULER_DRAFT_LOCAL','VITE_SCHEDULER_DRAFT_PILOT','SCHEDULER_DRAFT_PILOT_ENABLED'])for(const value of ['1','true'])assert.throws(()=>verify(event,{...env,[flag]:value}),/remains OFF/);
});
test('a changed manifest cannot bless current bytes or a different freeze',()=>{
  control(QUALIFICATION[1],(file,bytes)=>{const data=JSON.parse(bytes);data.files.pop();writeFileSync(file,JSON.stringify(data));},()=>assert.throws(()=>verify(),/qualification matches PR head/));
  // Commit the altered manifest to prove that head identity alone cannot bless it.
  control(QUALIFICATION[1],(file,bytes)=>{
    const data=JSON.parse(bytes);data.files[0].sha256='0'.repeat(64);writeFileSync(file,JSON.stringify(data));git(root,'add','--',QUALIFICATION[1]);
  },()=>{
    const badHead=commit(git(root,'write-tree').toString().trim(),[SOURCE]);git(root,'update-ref','HEAD',badHead);
    try {assert.throws(()=>verify(editEvent(e=>e.pull_request.head.sha=badHead),{...env,GITHUB_SHA:badHead,GITHUB_REF:'refs/pull/512/head'}),/manifest derives/);}
    finally {git(root,'update-ref','HEAD',merge);git(root,'read-tree',head);}
  });
});
test('a head containing an application change cannot use the qualification-only exception',()=>{
  control('src/main.jsx',(file,bytes)=>{writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));git(root,'add','--','src/main.jsx');},()=>{
    const badHead=commit(git(root,'write-tree').toString().trim(),[SOURCE]);
    try {assert.throws(()=>verify(editEvent(e=>e.pull_request.head.sha=badHead)),/qualification-only head delta/);}
    finally {git(root,'read-tree',head);}
  });
});
test('a synthetic merge with correct parents but changed consumed base inputs is refused',()=>{
  control('src/main.jsx',(file,bytes)=>{writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));git(root,'add','--','src/main.jsx');},()=>{
    const badMerge=commit(git(root,'write-tree').toString().trim(),[BASE,head]);git(root,'update-ref','HEAD',badMerge);
    try {assert.throws(()=>verify(event,{...env,GITHUB_SHA:badMerge}),/runtime (size|hash)/);}
    finally {git(root,'update-ref','HEAD',merge);git(root,'read-tree',head);}
  });
});
test('historical baselines remain exact and missing baseline checkouts refuse',()=>{
  assert.equal(Object.keys(BASELINES).length,8);assert.throws(()=>verifyBaselines(root));
});
function untracedMeasurementCommands(workflow){
  let commands=workflow.slice(workflow.indexOf('        run: |',workflow.indexOf('      - name: Measure before and after')),workflow.indexOf('      - uses: actions/upload-artifact@v4'));
  const guard='if [ "$FEEL_BROWSER" = "webkit" ] && [ "${SAGE_CORS_TRACE:-0}" = "1" ]; then';
  for(const [plain,traced] of [
    ['SALESPERSON=1 node scripts/mock-supabase.mjs > mock.log 2>&1 &','SALESPERSON=1 node --require "$RUNNER_TEMP/manager-cors-observer.cjs" scripts/mock-supabase.mjs > mock.log 2>&1 &'],
    ['node scripts/hero-bars.mjs','node --require "$RUNNER_TEMP/manager-cors-observer.cjs" scripts/hero-bars.mjs'],
  ]){
    const exact='          '+guard+'\n            '+traced+'\n          else\n            '+plain+'\n          fi';
    assert.equal(commands.split(exact).length-1,1,'one exact explicit diagnostic command with unchanged program arguments');
    commands=commands.replace(exact,'          '+plain);
  }
  return commands;
}
test('workflow preserves historical verification, measurement commands, image and driver',()=>{
  const current=readFileSync(resolve(sourceRoot,QUALIFICATION[0]),'utf8');
  const commands=untracedMeasurementCommands(current);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(commands),'23ad82ad007736b02f029fdabf5efe125ba16f0e5d478066f1a1c0ac9ab47338');
  for(const text of ['sha256sum --check scripts/search-runtime.sha256','mcr.microsoft.com/playwright:v1.63.0-noble','npm i --no-save playwright@1.63.0','engine: [chromium, webkit]'])assert.ok(current.includes(text));
  for(const commit of Object.values(BASELINES))assert.ok(current.includes('ref: '+commit));
  assert.equal(sha(readFileSync(resolve(sourceRoot,'scripts/search-runtime.sha256'))),'5cc466b968535b7544c0885c91ca68fcdc718c50bd31df87d58478082e35c78c');
});
test('production wrapper binds the exact reviewed source and has no fixture or CLI policy override',()=>{
  const manifest=JSON.parse(readFileSync(resolve(sourceRoot,QUALIFICATION[1])));
  assert.equal(manifest.sourceCommit,FIXED_SOURCE);assert.equal(manifest.sourceTree,FIXED_TREE);assert.equal(manifest.baseCommit,FIXED_BASE);
  assert.equal(manifest.files.length,2089);
  const original=manifest.files.find(row=>row.path===HARNESS_CORRECTION.path);
  assert.deepEqual({mode:original.mode,blob:original.blob,bytes:original.bytes,sha256:original.sha256},HARNESS_CORRECTION.original);
  const corrected=readFileSync(resolve(sourceRoot,HARNESS_CORRECTION.path));
  assert.equal(corrected.length,HARNESS_CORRECTION.corrected.bytes);assert.equal(createHash('sha256').update(corrected).digest('hex'),HARNESS_CORRECTION.corrected.sha256);
  assert.throws(()=>verifySource({root,event,env}),/nominated immutable base/);
  const source=readFileSync(resolve(sourceRoot,QUALIFICATION[2]),'utf8');
  assert.match(source,/const evidence = verifySource\(/);assert.doesNotMatch(source,/process\.env\.(?:SOURCE|BASE|POLICY|SKIP)/);
});

currentMainQualificationTests();
function currentMainQualificationTests() {
  let dir, source, base, priorBase, candidate, synthetic, input, variables, fixed;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const makeCommit = (tree, parents) => execFileSync('git', ['-C', dir, 'commit-tree', tree, ...parents.flatMap(parent=>['-p',parent])], {input:'Synthetic new-main qualification control\n',env:{...process.env,...identity}}).toString().trim();
  const stage = () => {git(dir,'add','.');return git(dir,'write-tree').toString().trim();};
  const check = (e=input,v=variables) => verifyCandidate({root:dir,event:e,env:v},fixed);
  const change = (path, mutate, checkFailure) => {
    const file=resolve(dir,path), original=readFileSync(file);
    try {mutate(file,original);checkFailure();}
    finally {rmSync(file,{force:true});writeFileSync(file,original);git(dir,'read-tree',candidate);git(dir,'update-ref','HEAD',synthetic);}
  };
  before(()=>{
    dir=mkdtempSync(resolve(tmpdir(),'sage-new-main-runtime-'));git(dir,'init','-q');
    const files={
      '.gitignore':'node_modules/\ndist/\n.env*\n',
      'src/LeadPerformanceCalculator.jsx':'// synthetic original core\n',
      'src/Manager.jsx':'// synthetic manager\n',
      'scripts/scheduler-performance/build.mjs':'// synthetic original boundary\n',
      'scripts/hero-bars.mjs':'// synthetic reviewed settled harness\n',
      'scripts/mock-supabase.mjs':'// synthetic mock\n',
      'api/scheduler.mjs':'// synthetic default-OFF endpoint\n',
      'package.json':'{"dependencies":{},"devDependencies":{}}\n',
      'package-lock.json':'{"packages":{}}\n',
      'index.html':'<p>synthetic</p>\n',
      'vercel.json':JSON.stringify({git:{deploymentEnabled:{[BRANCH]:false}}})+'\n',
      [QUALIFICATION[1]]:'synthetic preserved old current manifest\n',
      'scripts/search-runtime.sha256':'synthetic preserved historical manifest\n',
      [CURRENT_QUALIFICATION[0]]:'name: synthetic prior workflow\n',
      [CURRENT_QUALIFICATION[2]]:'// synthetic prior verifier\n',
      [CURRENT_QUALIFICATION[3]]:'// synthetic prior tests\n',
    };
    for(const [path,bytes] of Object.entries(files)){mkdirSync(dirname(resolve(dir,path)),{recursive:true});writeFileSync(resolve(dir,path),bytes);}
    priorBase=makeCommit(stage(),[]);
    writeFileSync(resolve(dir,'src/LeadPerformanceCalculator.jsx'),'// synthetic landed signup core\n');
    writeFileSync(resolve(dir,'test/signup-copy.test.mjs'),'// synthetic landed signup test\n');
    base=makeCommit(stage(),[priorBase]);
    writeFileSync(resolve(dir,'src/LeadPerformanceCalculator.jsx'),'// synthetic combined signup and scheduler core\n');
    writeFileSync(resolve(dir,'scripts/scheduler-performance/build.mjs'),'// synthetic exact combined source boundary\n');
    const tree=stage();source=makeCommit(tree,[base]);
    fixed={sourceCommit:source,sourceTree:tree,baseCommit:base,baseTree:git(dir,'rev-parse',base+'^{tree}').toString().trim(),qualification:CURRENT_QUALIFICATION,
      preservedManifests:Object.fromEntries(Object.keys(PRESERVED_MANIFESTS).map(path=>[path,sha(readFileSync(resolve(dir,path)))]))};
    for(const path of CURRENT_QUALIFICATION){mkdirSync(dirname(resolve(dir,path)),{recursive:true});copyFileSync(resolve(sourceRoot,path),resolve(dir,path));}
    writeFileSync(resolve(dir,CURRENT_QUALIFICATION[1]),JSON.stringify({version:'scheduler-current-runtime/1',sourceCommit:source,sourceTree:tree,baseCommit:base,baseTree:fixed.baseTree,files:sourceRecords(dir,source)},null,2)+'\n');
    candidate=makeCommit(stage(),[source]);synthetic=makeCommit(git(dir,'write-tree').toString().trim(),[base,candidate]);git(dir,'update-ref','HEAD',synthetic);
    input={number:512,repository:{full_name:REPOSITORY},pull_request:{head:{sha:candidate,ref:BRANCH,repo:{full_name:REPOSITORY}},base:{sha:base,ref:'main',repo:{full_name:REPOSITORY}}}};
    variables={GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:synthetic,GITHUB_REF:'refs/pull/512/merge'};
  });
  after(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
  test('new-main qualification freezes the combined source and records actual head, merge and preserved manifests',()=>{
    const result=check();assert.equal(result.sourceCommit,source);assert.equal(result.baseCommit,base);assert.equal(result.headCommit,candidate);assert.equal(result.checkoutCommit,synthetic);
    assert.deepEqual(result.checkoutParents,[base,candidate]);assert.deepEqual(result.preservedManifests,fixed.preservedManifests);assert.deepEqual(result.harnessCorrections,[]);
    assert.ok(sourceRecords(dir,source).some(row=>row.path==='test/signup-copy.test.mjs'),'landed signup regression is consumed');
    git(dir,'update-ref','HEAD',candidate);try{assert.equal(check(input,{...variables,GITHUB_SHA:candidate,GITHUB_REF:'refs/pull/512/head'}).checkoutCommit,candidate);}finally{git(dir,'update-ref','HEAD',synthetic);}
  });
  test('an exact historical event snapshot is recorded separately without replacing the consumed merge base',()=>{
    const e=structuredClone(input);e.pull_request.base.sha=priorBase;
    const snapshotPolicy={...fixed,eventBaseCommit:priorBase,eventBaseTree:git(dir,'rev-parse',priorBase+'^{tree}').toString().trim()};
    const unchanged=JSON.stringify(e),result=verifyCandidate({root:dir,event:e,env:variables},snapshotPolicy);
    assert.equal(JSON.stringify(e),unchanged,'the event remains unchanged');assert.equal(result.eventBaseCommit,priorBase);assert.equal(result.eventBaseTree,snapshotPolicy.eventBaseTree);
    assert.equal(result.baseCommit,base);assert.equal(result.baseTree,fixed.baseTree);assert.deepEqual(result.checkoutParents,[base,candidate]);
    assert.throws(()=>verifyCandidate({root:dir,event:e,env:variables},{...snapshotPolicy,eventBaseTree:'0'.repeat(40)}),/immutable event base tree/);
    git(dir,'update-ref','HEAD',candidate);
    try{assert.throws(()=>verifyCandidate({root:dir,event:e,env:{...variables,GITHUB_SHA:candidate,GITHUB_REF:'refs/pull/512/head'}},snapshotPolicy),/historical event base requires/);}finally{git(dir,'update-ref','HEAD',synthetic);}
  });
  test('historical event snapshots require exact current-base merge parents, ref, Actions SHA and consumed inputs',()=>{
    const e=structuredClone(input);e.pull_request.base.sha=priorBase;
    const snapshotPolicy={...fixed,eventBaseCommit:priorBase,eventBaseTree:git(dir,'rev-parse',priorBase+'^{tree}').toString().trim()};
    const snapshot=(event=e,env=variables)=>verifyCandidate({root:dir,event,env},snapshotPolicy);
    for(const parents of [[priorBase,candidate],[candidate,base]]){
      const wrong=makeCommit(git(dir,'rev-parse',candidate+'^{tree}').toString().trim(),parents);git(dir,'update-ref','HEAD',wrong);
      try{assert.throws(()=>snapshot(e,{...variables,GITHUB_SHA:wrong}),/exact base and head/);}finally{git(dir,'update-ref','HEAD',synthetic);}
    }
    for(const env of [{...variables,GITHUB_SHA:candidate},{...variables,GITHUB_REF:'refs/pull/512/head'}])assert.throws(()=>snapshot(e,env));
    const unknown=structuredClone(e);unknown.pull_request.base.sha=source;assert.throws(()=>snapshot(unknown),/nominated immutable base event/);
    change('src/LeadPerformanceCalculator.jsx',(file,bytes)=>{writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));git(dir,'add','--','src/LeadPerformanceCalculator.jsx');},()=>{
      const wrong=makeCommit(git(dir,'write-tree').toString().trim(),[base,candidate]);git(dir,'update-ref','HEAD',wrong);
      assert.throws(()=>snapshot(e,{...variables,GITHUB_SHA:wrong}),/runtime (size|hash)/);
    });
  });
  test('new-main qualification refuses old or wrong bases, events, forks, branches and checkout identities',()=>{
    for(const mutate of [e=>e.pull_request.base.sha=priorBase,e=>e.pull_request.base.sha=source,e=>e.pull_request.head.repo.full_name='fork/repo',e=>e.pull_request.head.ref='codex/unguarded',e=>e.pull_request.base.ref='release',e=>e.number=513]){const e=structuredClone(input);mutate(e);assert.throws(()=>check(e));}
    for(const env of [{...variables,GITHUB_EVENT_NAME:'push'},{...variables,GITHUB_SHA:candidate},{...variables,GITHUB_REF:'refs/heads/main'}])assert.throws(()=>check(input,env));
    const wrong=makeCommit(git(dir,'rev-parse',candidate+'^{tree}').toString().trim(),[priorBase,candidate]);git(dir,'update-ref','HEAD',wrong);
    try{assert.throws(()=>check(input,{...variables,GITHUB_SHA:wrong}),/exact base and head/);}finally{git(dir,'update-ref','HEAD',synthetic);}
    for(const key of ['sourceTree','baseTree'])assert.throws(()=>verifyCandidate({root:dir,event:input,env:variables},{...fixed,[key]:'0'.repeat(40)}),/immutable (source|base) tree/);
  });
  test('new-main qualification refuses changed signup, combined pins, API, package, mock and settled harness inputs',()=>{
    for(const path of ['src/LeadPerformanceCalculator.jsx','src/Manager.jsx','test/signup-copy.test.mjs','scripts/scheduler-performance/build.mjs','api/scheduler.mjs','package.json','package-lock.json','scripts/mock-supabase.mjs','scripts/hero-bars.mjs'])change(path,(file,bytes)=>writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')])),()=>assert.throws(()=>check(),/runtime (size|hash)/));
  });
  test('new-main qualification refuses missing, extra, ignored, symlinked and build configuration inputs',()=>{
    change('test/signup-copy.test.mjs',file=>rmSync(file),()=>assert.throws(()=>check(),/inventory/));
    change('src/Manager.jsx',file=>{rmSync(file);symlinkSync('LeadPerformanceCalculator.jsx',file);},()=>assert.throws(()=>check(),/symlink/));
    for(const path of ['src/extra.js','scripts/unreviewed.mjs','.env.production','.npmrc']){writeFileSync(resolve(dir,path),'synthetic unexpected input\n');try{assert.throws(()=>check(),/inventory/);}finally{rmSync(resolve(dir,path));}}
  });
  test('new-main qualification refuses manifest self-blessing even when committed to the PR head',()=>{
    change(CURRENT_QUALIFICATION[1],(file,bytes)=>{const data=JSON.parse(bytes);data.files[0].sha256='0'.repeat(64);writeFileSync(file,JSON.stringify(data));git(dir,'add','--',CURRENT_QUALIFICATION[1]);},()=>{
      const wrong=makeCommit(git(dir,'write-tree').toString().trim(),[source]);git(dir,'update-ref','HEAD',wrong);
      const e=structuredClone(input);e.pull_request.head.sha=wrong;
      assert.throws(()=>check(e,{...variables,GITHUB_SHA:wrong,GITHUB_REF:'refs/pull/512/head'}),/manifest derives/);
    });
  });
  test('new-main qualification refuses changed consumed merge inputs and application changes in qualification heads',()=>{
    change('test/signup-copy.test.mjs',(file,bytes)=>{writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));git(dir,'add','--','test/signup-copy.test.mjs');},()=>{
      const tree=git(dir,'write-tree').toString().trim(),wrongMerge=makeCommit(tree,[base,candidate]);git(dir,'update-ref','HEAD',wrongMerge);
      assert.throws(()=>check(input,{...variables,GITHUB_SHA:wrongMerge}),/runtime (size|hash)/);
      const wrongHead=makeCommit(tree,[source]),e=structuredClone(input);e.pull_request.head.sha=wrongHead;
      assert.throws(()=>check(e),/qualification-only head delta/);
    });
  });
  test('new-main qualification preserves both historical manifests and refuses enabled deployment or scheduler flags',()=>{
    change(QUALIFICATION[1],(file,bytes)=>writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')])),()=>assert.throws(()=>check(),/preserved historical manifest/));
    change(QUALIFICATION[1],(file,bytes)=>{writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')]));git(dir,'add','--',QUALIFICATION[1]);},()=>{
      const wrongMerge=makeCommit(git(dir,'write-tree').toString().trim(),[base,candidate]);git(dir,'update-ref','HEAD',wrongMerge);
      assert.throws(()=>check(input,{...variables,GITHUB_SHA:wrongMerge}),/preserved historical manifest/,'correct merge parents cannot bless changed historical qualification bytes');
    });
    change('scripts/search-runtime.sha256',(file,bytes)=>writeFileSync(file,Buffer.concat([bytes,Buffer.from('\n')])),()=>assert.throws(()=>check(),/runtime (size|hash)/));
    change('vercel.json',(file,bytes)=>{const data=JSON.parse(bytes);data.git.deploymentEnabled[BRANCH]=true;writeFileSync(file,JSON.stringify(data));},()=>assert.throws(()=>check(),/deployment disabled/));
    for(const flag of ['VITE_SCHEDULER_CALENDAR','VITE_SCHEDULER_DRAFT_LOCAL','VITE_SCHEDULER_DRAFT_PILOT','SCHEDULER_DRAFT_PILOT_ENABLED'])assert.throws(()=>check(input,{...variables,[flag]:'1'}),/remains OFF/);
  });
  test('current production case pins all 2090 reviewed inputs without requiring deep history in ordinary unit checkouts',()=>{
    const manifestBytes=readFileSync(resolve(sourceRoot,CURRENT_QUALIFICATION[1])),manifest=JSON.parse(manifestBytes);
    assert.deepEqual([manifest.sourceCommit,manifest.sourceTree,manifest.baseCommit,manifest.baseTree],[CURRENT_SOURCE,CURRENT_SOURCE_TREE,CURRENT_BASE,CURRENT_BASE_TREE]);
    // The production CLI derives every record from its immutable Git source.
    // Ordinary npm-test checkouts are shallow; synthetic histories above prove
    // the derivation and refusal behavior without requiring extra fetched refs.
    assert.equal(sha(manifestBytes),'1d3310fa0c341cd06be6fc8fc4cb406f1af9bba37fa0185c09573134ed0b8dc4');assert.equal(manifest.files.length,2090);
    assert.equal(manifest.files.find(row=>row.path==='src/LeadPerformanceCalculator.jsx').sha256,'85a62b1206adc4d41ee9557581214c600b1efb793a2c4d6a78a22c0e36e358af');
    assert.equal(manifest.files.find(row=>row.path==='scripts/scheduler-performance/build.mjs').sha256,'6e0712d6dac71bfa1f40e3ae903f85e987b827bb1b486a65785c9c7fd93558a5');
    assert.ok(manifest.files.some(row=>row.path==='test/signup-copy.test.mjs'));
    for(const [path,expected] of Object.entries(PRESERVED_MANIFESTS))assert.equal(sha(readFileSync(resolve(sourceRoot,path))),expected);
    const workflow=readFileSync(resolve(sourceRoot,CURRENT_QUALIFICATION[0]),'utf8');
    assert.ok(workflow.includes("if [ '${{ steps.runtime.outputs.case_name }}' != 'current-95ad3f93' ] && [ '${{ steps.runtime.outputs.case_name }}' != 'current-main-579727d' ]; then"));
    assert.match(workflow,/matrix.engine == 'webkit' && steps.runtime.outputs.case_name == 'current-main-579727d'/);
    assert.ok(workflow.includes("if: always() && matrix.engine == 'webkit' && (steps.runtime.outputs.case_name == 'current-95ad3f93' || steps.runtime.outputs.case_name == 'current-main-579727d')"));
    assert.throws(()=>verifySource({root:dir,event:input,env:variables}),/nominated immutable base/,'synthetic fixture cannot override production identities');
  });
}

test('CI checks out into an owned child without any Git trust exception',()=>{
  const workflow=readFileSync(resolve(sourceRoot,QUALIFICATION[0]),'utf8');
  assert.match(workflow,/defaults:\n      run:\n        working-directory: spacing-runtime/);
  assert.match(workflow,/fetch-depth: 50\n          path: spacing-runtime\n          set-safe-directory: false/);
  for(const path of Object.keys(BASELINES))assert.ok(workflow.includes('path: spacing-runtime/'+path+'\n          set-safe-directory: false'));
  assert.equal((workflow.match(/set-safe-directory: false/g)||[]).length,9);
  assert.doesNotMatch(workflow,/safe\.directory|(?:chown|chmod)\b|--user|--privileged/);
  const artifactBlock=workflow.slice(workflow.indexOf('      - uses: actions/upload-artifact@v4'));
  for(const path of ['manager-runtime-qualification','manager-spacing','manager-selector','search-keyboard','color-phone','hero-bars','manager-viewports','room-hero-colors','hero-freshness','hero-freshness-before'])assert.ok(artifactBlock.includes('spacing-runtime/'+path+'/'));
  const program=workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1].split('\n').map(line=>line.slice(10)).join('\n');
  for(const path of Object.keys(BASELINES))mkdirSync(resolve(root,path,'.git'),{recursive:true});
  execFileSync(process.execPath,['--input-type=module'],{cwd:root,input:program});
  const ownership=JSON.parse(readFileSync(resolve(root,'manager-runtime-qualification/ownership.json')));
  assert.equal(ownership.repositories.length,9);assert.ok(ownership.repositories.every(r=>r.checkoutUid===process.getuid()&&r.gitUid===process.getuid()));
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module'],{cwd:root,input:program.replace('const uid = process.getuid();','const uid = process.getuid() + 1;'),stdio:['pipe','pipe','pipe']}),/Command failed/,'a mismatched process owner refuses before Git');
});

actionTraceTests();
function actionTraceTests(){
  const workflow=readFileSync(resolve(sourceRoot,QUALIFICATION[0]),'utf8');
  const observerText=workflow.match(/const observerSource = String.raw`([\s\S]*?)`;/)[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  const prep=workflow.match(/node --input-type=module <<'CORSPREP'\n([\s\S]*?)\n          CORSPREP/)[1].split('\n').map(line=>line.slice(10)).join('\n');
  let api;
  before(async()=>{
    const {createRequire}=await import('node:module');
    const file=resolve(root,'trace-tool/observer-under-test.cjs');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,observerText);
    api=createRequire(import.meta.url)(file);
  });
  test('trace metadata has a strict allowlist and cannot emit credentials, cookies, bodies or raw URLs',()=>{
    const secret='DO_NOT_EMIT_credential_cookie_body';
    const input=Object.freeze({authorization:secret,apikey:secret,cookie:secret,'set-cookie':secret,origin:'http://127.0.0.1:5178',referer:'http://127.0.0.1:5181/private?token='+secret,'access-control-request-headers':'authorization,cookie,x-client-info,'+secret});
    const output=api.safe({kind:'request',source:'browser',...api.headers(input),...api.cors({'set-cookie':secret,'access-control-allow-origin':'*','access-control-allow-headers':'authorization,cookie,'+secret,'access-control-allow-methods':'POST,'+secret}),body:secret,authorization:secret,cookie:secret,url:'https://example.invalid/'+secret,failure:secret});
    const json=JSON.stringify(output);assert.ok(!json.includes(secret));assert.ok(!json.includes('cookie'));assert.ok(!json.includes('private'));
    assert.equal(output.origin,'http://127.0.0.1:5178');assert.equal(output.referrer,'http://127.0.0.1:5181');assert.deepEqual(output.requestedHeaders,['authorization','x-client-info']);assert.deepEqual(output.allowedMethods,['POST']);
    assert.equal(api.safe({origin:'http://user:'+secret+'@127.0.0.1:5178/'}).origin,'other');
    assert.equal(api.location('https://external.invalid/'+secret).origin,'other');assert.equal(api.safe({origin:api.location('null').origin}).origin,'opaque-null');
  });
  test('mock observer preserves OPTIONS, POST and response objects and logs only safe preflight metadata',async()=>{
    const {EventEmitter}=await import('node:events');const seen=[],calls=[],secret='DO_NOT_EMIT_mock_body';
    const original=function(...args){calls.push(args);const server=new EventEmitter();server.on('request',args[0]);return server;};
    const http={createServer:original};const restore=api.createObserver(row=>seen.push(row)).installMock(http);let handled=0;
    const handler=(req,res)=>{handled++;assert.equal(req.headers.authorization,secret);res.emit('finish');};
    const options={fixture:true},server=http.createServer(handler,options);assert.equal(calls[0][0],handler);assert.equal(calls[0][1],options);
    for(const method of ['OPTIONS','POST']){
      const req={url:'/rest/v1/app_data?on_conflict=key&hidden='+secret,method,headers:Object.freeze({authorization:secret,cookie:secret,origin:'http://127.0.0.1:5181','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'})};
      Object.defineProperty(req,'body',{get(){throw new Error('observer must not read a body');}});
      const res=new EventEmitter();res.statusCode=method==='OPTIONS'?204:201;res.getHeaders=()=>({'access-control-allow-origin':'*','access-control-allow-methods':'*','access-control-allow-headers':'authorization,content-type','set-cookie':secret});
      server.emit('request',req,res);
    }
    restore();assert.equal(http.createServer,original);assert.equal(handled,2);
    assert.deepEqual(seen.filter(x=>x.kind==='mock-response').map(x=>x.status),[204,201]);assert.ok(seen.every(x=>x.origin==='http://127.0.0.1:5181'));
    assert.ok(!JSON.stringify(seen).includes(secret));assert.ok(!JSON.stringify(seen).includes('cookie'));
  });
  test('actual ServerResponse writeHead-only CORS headers are captured without parsing raw wire data',async()=>{
    const {EventEmitter}=await import('node:events');const {ServerResponse}=await import('node:http');const rows=[];
    const http={createServer:handler=>{const server=new EventEmitter();server.on('request',handler);return server;}};
    api.createObserver(row=>rows.push(row)).installMock(http);
    const explicit=Object.freeze({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type','Set-Cookie':'DO_NOT_EMIT_writeHead_cookie'});
    const server=http.createServer((req,res)=>{assert.equal(res.writeHead(204,'No Content',explicit),res);assert.equal(Object.keys(res.getHeaders()).length,0,'real Node does not cache writeHead-only headers');res.emit('finish');});
    const req={method:'OPTIONS',url:'/rest/v1/app_data',headers:{origin:'http://127.0.0.1:5181'},httpVersionMajor:1,httpVersionMinor:1};
    server.emit('request',req,new ServerResponse(req));
    const result=rows.find(row=>row.kind==='mock-response');assert.equal(result.status,204);assert.equal(result.allowOrigin,'*');assert.deepEqual(result.allowedMethods,['OPTIONS','POST']);assert.deepEqual(result.allowedHeaders,['authorization','content-type']);assert.ok(!JSON.stringify(rows).includes('DO_NOT_EMIT'));
    const invalid=http.createServer((request,response)=>response.writeHead(201,{'x-invalid':'\n'}));
    assert.throws(()=>invalid.emit('request',{...req,method:'POST'},new ServerResponse(req)),error=>error.code==='ERR_INVALID_CHAR','original writeHead errors are not replaced or swallowed');
    assert.doesNotMatch(observerText,/\._header\b|rawHeaders/);
  });
  test('browser observer preserves requests/responses/errors and correlates late completion with the originating navigation',async()=>{
    const {EventEmitter}=await import('node:events');const seen=[],forwarded=[],secret='DO_NOT_EMIT_browser_body';
    const page=new EventEmitter();page.current='http://127.0.0.1:5178/';page.url=()=>page.current;
    const frame={page:()=>page,url:()=>page.current,parentFrame:()=>null};page.mainFrame=()=>frame;
    const context=new EventEmitter();let registered;context.route=function(...args){registered=args;return Promise.resolve('route-result');};context.newPage=async()=>page;
    const browser={newContext:async options=>{forwarded.push(options);return context;},close:async options=>{forwarded.push(options);return 'closed';}};
    const engine={launch:async options=>{forwarded.push(options);return browser;}};const originalLaunch=engine.launch;const restore=api.createObserver(row=>seen.push(row)).installBrowser(engine);
    const launchOptions=Object.freeze({headless:true}),contextOptions=Object.freeze({serviceWorkers:'block'});assert.equal(await engine.launch(launchOptions),browser);assert.equal(await browser.newContext(contextOptions),context);assert.equal(await context.newPage(),page);
    const req={url:()=> 'http://127.0.0.1:5433/rest/v1/app_data?on_conflict=key&secret='+secret,headers:()=>Object.freeze({authorization:secret,cookie:secret,origin:'http://127.0.0.1:5178',referer:'http://127.0.0.1:5178/private?'+secret}),method:()=> 'POST',frame:()=>frame,isNavigationRequest:()=>false,failure:()=>({errorText:'access control checks '+secret})};
    const response={headers:()=>({'access-control-allow-origin':'*','set-cookie':secret}),status:()=>201};
    const fetchOptions={postData:secret},fulfillOptions={response,json:{body:secret}},requestCalls=[];
    const route={request:()=>req,fetch:async value=>{requestCalls.push(value);return response;},fulfill:async value=>{requestCalls.push(value);return 'fulfilled';}};
    context.emit('request',req);
    const handler=async observed=>{assert.equal(observed.request(),req);assert.equal(await observed.fetch(fetchOptions),response);page.current='http://127.0.0.1:5181/';page.emit('framenavigated',frame);assert.equal(await observed.fulfill(fulfillOptions),'fulfilled');};
    const routeOptions={times:5};assert.equal(await context.route('synthetic-pattern',handler,routeOptions),'route-result');assert.equal(registered[0],'synthetic-pattern');assert.equal(registered[2],routeOptions);await registered[1](route,req);
    assert.equal(requestCalls[0],fetchOptions);assert.equal(requestCalls[1],fulfillOptions);
    const originalErrors=[];page.on('pageerror',error=>originalErrors.push(error));const error=new Error('access control checks '+secret);page.emit('pageerror',error);assert.equal(originalErrors[0],error);assert.throws(()=>assert.deepEqual(originalErrors,[]),'the real no-error guard still fails');
    context.emit('requestfailed',req);const closeOptions={reason:secret};assert.equal(await browser.close(closeOptions),'closed');assert.deepEqual(forwarded,[launchOptions,contextOptions,closeOptions]);
    const late=seen.find(x=>x.kind==='route-fulfill-done');assert.equal(late.phase,'candidate');assert.equal(late.origin,'http://127.0.0.1:5178');assert.equal(late.ownerNav,0);assert.equal(late.currentNav,1);assert.equal(late.pageOrigin,'http://127.0.0.1:5181');
    assert.equal(seen.find(x=>x.kind==='page-error').pagePhase,'baseline');assert.ok(!('phase' in seen.find(x=>x.kind==='page-error')),'current page is not assumed to own a late error');assert.equal(late.phaseBasis,'origin');assert.equal(seen.find(x=>x.kind==='request-failed').failure,'access-control');assert.ok(!JSON.stringify(seen).includes(secret));restore();assert.equal(engine.launch,originalLaunch);
    const rejection=new Error('DO_NOT_EMIT_original_rejection');route.fetch=async()=>{throw rejection;};await assert.rejects(()=>registered[1](route,req),value=>value===rejection);
    route.fetch=async()=>response;const fulfillRejection=new Error('synthetic fulfill failure');route.fulfill=async()=>{throw fulfillRejection;};await assert.rejects(()=>registered[1](route,req),value=>value===fulfillRejection);
  });
  test('telemetry failures never swallow or replace real request errors',async()=>{
    const {EventEmitter}=await import('node:events');let fault=0,handled=0;const http={createServer:handler=>{const server=new EventEmitter();server.on('request',handler);return server;}};
    api.createObserver(()=>{throw new Error('synthetic sink failure');},()=>fault++).installMock(http);
    const server=http.createServer(()=>handled++);server.emit('request',{url:'/rest/v1/app_data',method:'POST',headers:{}},new EventEmitter());assert.equal(handled,1);assert.ok(fault>0);
  });
  test('a recovered mock sink permanently marks the diagnostic partial without changing requests',async()=>{
    const {EventEmitter}=await import('node:events');let first=true,handled=0;const rows=[];
    const http={createServer:handler=>{const server=new EventEmitter();server.on('request',handler);return server;}};
    api.createObserver(row=>{if(first){first=false;throw new Error('one synthetic lost record');}rows.push(row);}).installMock(http);
    const server=http.createServer((req,res)=>{handled++;res.emit('finish');});
    for(let n=0;n<2;n++){const res=new EventEmitter();res.statusCode=201;res.getHeaders=()=>({});server.emit('request',{url:'/rest/v1/app_data',method:'POST',headers:{}},res);}
    assert.equal(handled,2);assert.ok(rows.length>0);assert.ok(rows.every(row=>row.incomplete===true),'later successful mock records cannot claim completeness');
  });
  test('trace limits mark incompleteness while every real request still reaches the handler',async()=>{
    const {EventEmitter}=await import('node:events');const rows=[];let handled=0;
    const http={createServer:handler=>{const server=new EventEmitter();server.on('request',handler);return server;}};
    api.createObserver(row=>rows.push(row)).installMock(http);const server=http.createServer((req,res)=>{handled++;res.emit('finish');});
    const req={url:'/rest/v1/app_data',method:'POST',headers:{}};
    for(let n=0;n<10010;n++){const res=new EventEmitter();res.statusCode=201;res.getHeaders=()=>({});server.emit('request',req,res);}
    assert.equal(handled,10010);assert.ok(rows.some(row=>row.kind==='observer-incomplete'));assert.ok(rows.length<=20001);
  });
  test('preparation emits a hash-bound observer without writing or altering ambient Node options',()=>{
    const dir=resolve(root,'trace-tool/prep');mkdirSync(dir,{recursive:true});
    const pkg=resolve(root,'node_modules/playwright');mkdirSync(pkg,{recursive:true});
    writeFileSync(resolve(pkg,'package.json'),JSON.stringify({name:'synthetic-playwright-fixture',version:'1.63.0',exports:{'.':{require:'./index.cjs',import:'./index.mjs'},'./package.json':'./package.json'}}));
    writeFileSync(resolve(pkg,'index.cjs'),'module.exports={webkit:{synthetic:true}};\n');
    writeFileSync(resolve(pkg,'index.mjs'),"import driver from './index.cjs';export const webkit=driver.webkit;\n");
    const envFile=resolve(dir,'env.out');writeFileSync(envFile,'');const clean={...process.env};assert.ok(!clean.NODE_OPTIONS,'fixture requires unchanged empty Node options');
    execFileSync(process.execPath,['--input-type=module'],{cwd:root,input:prep,env:{...clean,NODE_OPTIONS:'--no-warnings',RUNNER_TEMP:dir,GITHUB_ENV:envFile}});
    const generated=readFileSync(resolve(dir,'manager-cors-observer.cjs'),'utf8');assert.equal(generated,observerText);
    const record=JSON.parse(readFileSync(resolve(root,'manager-runtime-qualification/cors-observer.json')));assert.equal(record.diagnosticOnly,true);assert.equal(record.sha256,createHash('sha256').update(observerText).digest('hex'));
    const envText=readFileSync(envFile,'utf8');assert.ok(envText.includes('SAGE_CORS_TRACE=1\n'));assert.ok(!envText.includes('NODE_OPTIONS'));assert.equal(process.env.NODE_OPTIONS,clean.NODE_OPTIONS);
    assert.throws(()=>execFileSync(process.execPath,['--require',resolve(dir,'manager-cors-observer.cjs'),resolve(root,'scripts/mock-supabase.mjs')],{cwd:root,env:{...clean,SAGE_CORS_TRACE:'1',SAGE_CORS_TRACE_PATH:resolve(root,'manager-runtime-qualification/cors-trace.ndjson')},stdio:['pipe','pipe','pipe']}),/frozen diagnostic entry/,'a different entry never gains an observer');
  });
  test('documented per-command require activates both observers and preserves ambient options and script arguments',()=>{
    const clean={...process.env},dir=resolve(root,'trace-tool/prep'),trace=resolve(root,'manager-runtime-qualification/cors-trace.ndjson');
    // Unit-only entry hashes substitute tiny nonnetwork programs. Production
    // constants remain fixed and the separate wrong-entry refusal stays intact.
    const entryText="import assert from 'node:assert/strict';assert.equal(process.env.NODE_OPTIONS,'--no-warnings');assert.deepEqual(process.argv.slice(2),['synthetic-argument']);console.log('SYNTHETIC_ENTRY_OK');\n";
    const entryHash=createHash('sha256').update(entryText).digest('hex');
    const fixture=observerText.replace(HARNESS_CORRECTION.corrected.sha256,entryHash).replace('5eb2b29d000f8882acfde50930b3893def42f3a0c89ce303ec2368b00bf4f2a3',entryHash);
    const preload=resolve(dir,'unit-entry-observer.cjs');writeFileSync(preload,fixture);writeFileSync(trace,'');
    for(const entry of ['mock-supabase.mjs','hero-bars.mjs']){
      const file=resolve(root,'scripts',entry);writeFileSync(file,entryText);
      const output=execFileSync(process.execPath,['--require',preload,file,'synthetic-argument'],{cwd:root,env:{...clean,NODE_OPTIONS:'--no-warnings',SAGE_CORS_TRACE:'1',SAGE_CORS_TRACE_PATH:trace},encoding:'utf8'});
      assert.ok(output.includes('SYNTHETIC_ENTRY_OK'));
    }
    const markers=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(markers.map(row=>[row.kind,row.source]),[['observer-start','mock'],['observer-start','browser']]);
    assert.ok(markers.every(row=>row.incomplete===false));
    writeFileSync(trace,'');
    const output=execFileSync(process.execPath,[resolve(root,'scripts/hero-bars.mjs'),'synthetic-argument'],{cwd:root,env:{...clean,NODE_OPTIONS:'--no-warnings',SAGE_CORS_TRACE:'1',SAGE_CORS_TRACE_PATH:trace},encoding:'utf8'});
    assert.ok(output.includes('SYNTHETIC_ENTRY_OK'));assert.equal(readFileSync(trace,'utf8'),'','without --require the entry runs but no activation sentinel exists');
  });
  test('diagnostic summary reports partial/unknown metadata and never replaces the real measurement outcome',()=>{
    const summary=workflow.match(/node --input-type=module <<'CORSSUMMARY'\n([\s\S]*?)\n          CORSSUMMARY/)[1].split('\n').map(line=>line.slice(10)).join('\n');
    const clean={...process.env};assert.ok(!clean.NODE_OPTIONS,'fixture requires unchanged empty Node options');const dir=resolve(root,'trace-tool/prep'),trace=resolve(root,'manager-runtime-qualification/cors-trace.ndjson');
    writeFileSync(trace,[{kind:'observer-start',source:'mock'},{kind:'observer-start',source:'browser'},{kind:'mock-response',source:'mock',incomplete:true,authorization:'DO_NOT_EMIT_summary_secret'}].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const run=()=>execFileSync(process.execPath,['--input-type=module'],{cwd:root,input:summary,env:{...clean,RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:resolve(dir,'summary.out'),MEASUREMENT_OUTCOME:'failure'},encoding:'utf8'});
    const output=run();assert.ok(!output.includes('DO_NOT_EMIT'));const report=JSON.parse(output.split('\n').find(line=>line.startsWith('CORS_TRACE_REPORT ')).slice('CORS_TRACE_REPORT '.length));
    assert.equal(report.collection,'partial');assert.equal(report.mockCompleteness,'unknown-background-source');assert.equal(report.measurementOutcome,'failure');assert.equal(report.diagnosticOnly,true);
    writeFileSync(trace,'');let empty=run();assert.ok(empty.includes('"collection":"not-activated"'));assert.ok(empty.includes('"mock":false,"browser":false'));assert.ok(!empty.includes('"collection":"observed-snapshot"'));
    writeFileSync(trace,JSON.stringify({kind:'observer-start',source:'browser'})+'\n');empty=run();assert.ok(empty.includes('"collection":"not-activated"'),'one missing observer cannot qualify collection');
    writeFileSync(trace,[{kind:'observer-start',source:'mock'},{kind:'observer-start',source:'browser'}].map(row=>JSON.stringify(row)).join('\n')+'\n');empty=run();assert.ok(empty.includes('"collection":"no-observations"'),'activation alone is not event collection');
    writeFileSync(trace,'not JSON');const missing=run();assert.ok(missing.includes('missing-or-invalid'));assert.ok(missing.includes('"measurementOutcome":"failure"'));
  });
  test('diagnostic uses only explicit Node preloads and binds frozen inputs and real driver identity',()=>{
    assert.match(workflow,/if: matrix.engine == 'webkit' && steps.runtime.outputs.case_name == 'current-95ad3f93'/);
    assert.ok(observerText.includes(HARNESS_CORRECTION.corrected.sha256));assert.ok(observerText.includes('5eb2b29d000f8882acfde50930b3893def42f3a0c89ce303ec2368b00bf4f2a3'));
    assert.doesNotMatch(prep,/NODE_OPTIONS/);assert.match(prep,/assert\.equal\(esm\.webkit, require\('playwright'\)\.webkit/);
    const clean={...process.env};assert.ok(!clean.NODE_OPTIONS,'fixture requires unchanged empty Node options');
    assert.doesNotMatch(workflow,/NODE_OPTIONS=/);
    assert.throws(()=>untracedMeasurementCommands(workflow.replace('scripts/hero-bars.mjs\n          else','scripts/other.mjs\n          else')),/one exact explicit diagnostic command/);
    assert.throws(()=>untracedMeasurementCommands(workflow.replace('--require "$RUNNER_TEMP/manager-cors-observer.cjs" scripts/hero-bars.mjs','--import "$RUNNER_TEMP/manager-cors-observer.cjs" scripts/hero-bars.mjs')),/one exact explicit diagnostic command/);
    assert.doesNotMatch(observerText,/postData\(|\.body\(|response\.json\(|req\.on\(['"]data|disable-web-security|setExtraHTTPHeaders|route\.abort|unroute/);
  });
}


fixtureSettlementTests();
function fixtureSettlementTests(){
  const hero=readFileSync(resolve(sourceRoot,'scripts/hero-bars.mjs'),'utf8');
  const helper=hero.slice(hero.indexOf('function createFixtureSettlement('),hero.indexOf('\nconst engine ='));
  const create=Function('assert',helper+'\nreturn createFixtureSettlement;')(assert);
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const request=(suffix='app_data?on_conflict=key')=>({url:()=> 'http://127.0.0.1:5433/rest/v1/'+suffix});
  test('fixture settlement waits for delayed real fetch and fulfill and forwards each unchanged call once',async t=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),fetch=deferred(),fulfill=deferred(),calls=[];
    const settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
    const req=request(),response={json:async()=>({synthetic:true})},fetchOptions={url:'synthetic-original'},fulfillOptions={response,json:{synthetic:true}};
    const route={request:()=>req,fetch:async options=>{calls.push(['fetch',options]);return fetch.promise;},fulfill:async options=>{calls.push(['fulfill',options]);return fulfill.promise;}};
    const receiver={synthetic:true},extra={argument:true};
    const handler=settlement.track(async function(actual,arg){assert.equal(this,receiver);assert.equal(actual,route);assert.equal(arg,extra);const value=await actual.fetch(fetchOptions);assert.equal(value,response);await value.json();return actual.fulfill(fulfillOptions);});
    context.emit('request',req);const work=handler.call(receiver,route,extra);let transitioned=false;
    const wait=settlement.wait().then(()=>{transitioned=true;});await tick();assert.equal(transitioned,false);
    fetch.resolve(response);await tick();assert.equal(transitioned,false);assert.deepEqual(calls,[['fetch',fetchOptions],['fulfill',fulfillOptions]]);
    context.emit('requestfinished',req);await tick();assert.equal(transitioned,false,'browser completion does not release an active route callback');
    fulfill.resolve('original-result');assert.equal(await work,'original-result');await wait;assert.equal(transitioned,true);
    assert.equal(settlement.evidence().pendingRequests,0);assert.equal(settlement.evidence().pendingRoutes,0);assert.equal(settlement.evidence().failed,false);
  });
  test('an aborted browser request retains its active callback and sticky failure',async t=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),gate=deferred(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
    const req=request();context.emit('request',req);const work=settlement.track(async()=>gate.promise)({request:()=>req});
    context.emit('requestfailed',req);let outcome='pending';const wait=settlement.wait().then(()=>{outcome='passed';},error=>{outcome='failed';throw error;});const rejected=assert.rejects(wait,/Fixture request failed/);
    await tick();assert.equal(outcome,'pending');assert.equal(settlement.evidence().pendingRoutes,1);
    gate.resolve();await work;await rejected;assert.equal(outcome,'failed');assert.equal(settlement.evidence().failedRequests,1);
    await assert.rejects(()=>settlement.wait(),/Fixture request failed/,'a later wait never clears the earlier failure');
  });
  test('settlement rechecks a new relevant request across the browser/event turn',async t=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),req=request('profiles?select=*');let turns=0,transitioned=false;
    const settlement=create(context,async()=>{if(++turns===1)context.emit('request',req);});t.after(()=>settlement.dispose());
    const wait=settlement.wait().then(()=>{transitioned=true;});await tick();assert.equal(transitioned,false);
    context.emit('requestfinished',req);await wait;assert.ok(turns>=2);assert.equal(transitioned,true);
  });
  test('a late route callback starting another request cannot release the transition',async t=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),gate=deferred(),first=request(),second=request('profiles?select=*');
    const settlement=create(context,async()=>{});t.after(()=>settlement.dispose());context.emit('request',first);
    const work=settlement.track(async()=>{await gate.promise;context.emit('requestfinished',first);context.emit('request',second);})({request:()=>first});
    let transitioned=false;const wait=settlement.wait().then(()=>{transitioned=true;});gate.resolve();await work;await tick();assert.equal(transitioned,false);
    context.emit('requestfinished',second);await wait;assert.equal(transitioned,true);
  });
  test('route rejections preserve their exact identity and remain failed, including falsy values',async t=>{
    const {EventEmitter}=await import('node:events');
    for(const error of [new Error('synthetic route rejection'),null]){
      const context=new EventEmitter(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
      await assert.rejects(()=>settlement.track(async()=>{throw error;})({request:()=>request()}),actual=>actual===error);
      await assert.rejects(()=>settlement.wait(),actual=>actual===error);assert.equal(settlement.evidence().failed,true);
    }
  });
  test('unfinished callback and browser-turn waits fail their bounded deadline without navigation',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');
    for(const holdRoute of [true,false]){
      const context=new EventEmitter(),gate=deferred(),settlement=create(context,holdRoute?async()=>{}:()=>gate.promise);t.after(()=>settlement.dispose());
      const work=holdRoute?settlement.track(async()=>gate.promise)({request:()=>request()}):null;
      let navigated=false;const wait=settlement.wait().then(()=>{navigated=true;});const rejected=assert.rejects(wait,/deadline/);
      t.mock.timers.tick(20000);await rejected;assert.equal(navigated,false);assert.equal(settlement.evidence().failed,true);
      gate.resolve();if(work)await work;await tick();
      await assert.rejects(()=>settlement.wait(),/deadline/,'timeout remains a failure after work eventually finishes');
    }
  });
  test('only the two real localhost fixture endpoints participate, and disposal removes listeners',async()=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),settlement=create(context,async()=>{});
    for(const url of ['https://external.invalid/rest/v1/app_data','http://127.0.0.1:5433/auth/v1/token','http://127.0.0.1:54330/rest/v1/profiles'])context.emit('request',{url:()=>url});
    await settlement.wait();assert.equal(settlement.evidence().requests,0);settlement.dispose();
    for(const name of ['request','requestfinished','requestfailed'])assert.equal(context.listenerCount(name),0);
  });

  const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
  test('a fresh quiet interval is required at every transition even after earlier settlement',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');const context=new EventEmitter(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
    for(let n=0;n<2;n++){
      let passed=false;const wait=settlement.wait().then(()=>{passed=true;});await flush();
      t.mock.timers.tick(499);await flush();assert.equal(passed,false);
      t.mock.timers.tick(1);await wait;assert.equal(passed,true);
    }
    assert.equal(settlement.evidence().quietMs,500);assert.equal(settlement.evidence().quietWindows,2);
  });
  test('work starting after the earlier browser turn resets quiet and blocks navigation until both leases settle',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');const context=new EventEmitter(),gate=deferred(),req=request();let turns=0,work;
    const settlement=create(context,async()=>{if(++turns===1)setTimeout(()=>{context.emit('request',req);work=settlement.track(async()=>gate.promise)({request:()=>req});},23);});t.after(()=>settlement.dispose());
    let navigated=false;const wait=settlement.wait().then(()=>{navigated=true;});await flush();
    t.mock.timers.tick(23);await flush();assert.equal(navigated,false);
    t.mock.timers.tick(477);await flush();assert.equal(navigated,false,'the original quiet deadline cannot pass late active work');
    context.emit('requestfinished',req);await flush();assert.equal(navigated,false,'route completion is independently required');
    gate.resolve();await work;await flush();
    t.mock.timers.tick(499);await flush();assert.equal(navigated,false);t.mock.timers.tick(1);await wait;
    assert.equal(navigated,true);assert.ok(settlement.evidence().quietResets>=1);assert.ok(turns>=2);
  });
  test('short request and route activity restarts quiet even when the sets return to empty immediately',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');
    for(const kind of ['request','route']){
      const context=new EventEmitter(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());let passed=false;
      const wait=settlement.wait().then(()=>{passed=true;});await flush();t.mock.timers.tick(499);
      if(kind==='request'){const req=request();context.emit('request',req);context.emit('requestfinished',req);}
      else await settlement.track(async()=>{} )({request:()=>request()});
      await flush();t.mock.timers.tick(1);await flush();assert.equal(passed,false);
      t.mock.timers.tick(499);await wait;assert.equal(passed,true);assert.ok(settlement.evidence().quietResets>=1);
    }
  });
  test('an unmatched browser request never gains fabricated completion from quiet or a finished callback',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');const context=new EventEmitter(),req=request(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
    context.emit('request',req);await settlement.track(async()=>{} )({request:()=>req});
    context.emit('requestfinished',request());
    let passed=false;const wait=settlement.wait().then(()=>{passed=true;});const rejected=assert.rejects(wait,/deadline/);
    t.mock.timers.tick(20000);await rejected;assert.equal(passed,false);assert.equal(settlement.evidence().pendingRequests,1);assert.equal(settlement.evidence().pendingRoutes,0);assert.equal(settlement.evidence().failed,true);
  });
  test('continuous late activity retains the original overall deadline and first request failure',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const {EventEmitter}=await import('node:events');const context=new EventEmitter(),settlement=create(context,async()=>{});t.after(()=>settlement.dispose());
    const wait=settlement.wait(),rejected=assert.rejects(wait,/deadline/);await flush();
    for(let n=0;n<40;n++){t.mock.timers.tick(499);const req=request();context.emit('request',req);context.emit('requestfinished',req);await flush();}
    t.mock.timers.tick(40);await rejected;assert.equal(settlement.evidence().failed,true);
    const secondContext=new EventEmitter(),second=create(secondContext,async()=>{}),gate=deferred(),req=request();t.after(()=>second.dispose());secondContext.emit('request',req);
    const work=second.track(async()=>gate.promise)({request:()=>req});secondContext.emit('requestfailed',req);
    let original;const stopped=second.wait().catch(error=>{original=error;});t.mock.timers.tick(20000);await stopped;assert.match(original.message,/Fixture request failed/);
    gate.resolve();await work;await assert.rejects(()=>second.wait(),error=>error===original);
  });

  test('the actual final scenario drains before the unchanged page-error assertion, including late errors',async t=>{
    const {EventEmitter}=await import('node:events');const context=new EventEmitter(),gate=deferred(),errors=[];
    const settlement=create(context,async()=>{errors.push('synthetic late page error');});t.after(()=>settlement.dispose());
    const req=request();context.emit('request',req);const work=settlement.track(async()=>gate.promise)({request:()=>req});
    const fragment=hero.slice(hero.lastIndexOf(' await settlement.wait();\n assert.deepEqual(errors,[]);'),hero.indexOf('\n}finally'));
    assert.equal(fragment,' await settlement.wait();\n assert.deepEqual(errors,[]);');
    const finish=Object.getPrototypeOf(async function(){}).constructor('settlement','assert','errors',fragment);
    const completed=finish(settlement,assert,errors);const rejected=assert.rejects(completed,/deep-equal/);await tick();assert.deepEqual(errors,[]);
    context.emit('requestfinished',req);gate.resolve();await work;await rejected;assert.deepEqual(errors,['synthetic late page error']);
  });
}


harnessQualificationTests();
function harnessQualificationTests(){
  test('only the independently pinned original and corrected harness may differ in the complete inventory',t=>{
    const dir=mkdtempSync(resolve(tmpdir(),'sage-harness-qualification-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));git(dir,'init','-q');
    const write=(path,bytes)=>{mkdirSync(dirname(resolve(dir,path)),{recursive:true});writeFileSync(resolve(dir,path),bytes);};
    const makeCommit=(tree,parents)=>execFileSync('git',['-C',dir,'commit-tree',tree,...parents.flatMap(p=>['-p',p])],{input:'Synthetic exact harness control\n',env:{...process.env,...identity}}).toString().trim();
    const tree=()=>git(dir,'write-tree').toString().trim();
    const path='scripts/hero-bars.mjs',original='// synthetic immutable original harness\n',corrected='// synthetic independently reviewed settlement harness\n';
    for(const [p,bytes] of Object.entries({'src/main.jsx':'// synthetic base\n',[path]:original,'scripts/search-runtime.sha256':'synthetic untouched historical manifest\n','vercel.json':JSON.stringify({git:{deploymentEnabled:{[BRANCH]:false}}})+'\n'}))write(p,bytes);
    git(dir,'add','.');const base=makeCommit(tree(),[]);write('src/main.jsx','// synthetic reviewed app\n');git(dir,'add','.');const sourceTree=tree(),source=makeCommit(sourceTree,[base]);
    const rules={sourceCommit:source,sourceTree,baseCommit:base,baseTree:git(dir,'rev-parse',base+'^{tree}').toString().trim()};
    const records=sourceRecords(dir,source),record=records.find(row=>row.path===path),pick=({mode,blob,bytes,sha256})=>({mode,blob,bytes,sha256});
    for(const p of QUALIFICATION)write(p,readFileSync(resolve(sourceRoot,p)));
    write(QUALIFICATION[1],JSON.stringify({version:'scheduler-current-runtime/1',...rules,files:records},null,2)+'\n');write(path,corrected);git(dir,'add','.');const candidate=makeCommit(tree(),[source]);
    rules.harnessCorrection={path,original:pick(record),corrected:{mode:'100644',blob:git(dir,'rev-parse',candidate+':'+path).toString().trim(),bytes:Buffer.byteLength(corrected),sha256:createHash('sha256').update(corrected).digest('hex')}};
    const merged=makeCommit(tree(),[base,candidate]);git(dir,'update-ref','HEAD',merged);
    const e={number:512,repository:{full_name:REPOSITORY},pull_request:{head:{sha:candidate,ref:BRANCH,repo:{full_name:REPOSITORY}},base:{sha:base,ref:'main',repo:{full_name:REPOSITORY}}}},v={GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:REPOSITORY,GITHUB_SHA:merged,GITHUB_REF:'refs/pull/512/merge'};
    const check=(policy=rules,event=e,variables=v)=>verifyCandidate({root:dir,event,env:variables},policy);
    const result=check();assert.equal(result.consumedFiles,records.length);assert.ok(records.some(row=>row.path===path));assert.ok(!QUALIFICATION.includes(path),'head delta admission must not exclude the harness from inventory');
    assert.deepEqual(result.harnessCorrections,[{path,sourceCommit:source,original:rules.harnessCorrection.original,corrected:rules.harnessCorrection.corrected}]);
    assert.equal(readFileSync(resolve(dir,QUALIFICATION[1]),'utf8'),JSON.stringify({version:'scheduler-current-runtime/1',sourceCommit:source,sourceTree,baseCommit:base,baseTree:rules.baseTree,files:records},null,2)+'\n');
    for(const side of ['original','corrected'])for(const [field,value] of [['bytes',0],['sha256','0'.repeat(64)],['blob','0'.repeat(40)]]){
      const altered=structuredClone(rules);altered.harnessCorrection[side][field]=value;
      assert.throws(()=>check(altered),new RegExp('independent .*'+side+' harness identity'));
    }
    const wrongPath=structuredClone(rules);wrongPath.harnessCorrection.path='src/main.jsx';assert.throws(()=>check(wrongPath),/qualification-only head delta/);
    write(path,corrected+'\n');assert.throws(()=>check(),/checkout harness matches exact PR head/);write(path,corrected);
    write('src/main.jsx','// unreviewed application\n');assert.throws(()=>check(),/runtime (size|hash)/);write('src/main.jsx','// synthetic reviewed app\n');
    write('scripts/extra-harness.mjs','// extra\n');assert.throws(()=>check(),/inventory/);rmSync(resolve(dir,'scripts/extra-harness.mjs'));
    rmSync(resolve(dir,path));assert.throws(()=>check());write(path,corrected);
    // Even a committed changed harness cannot bless itself through checkout/head equality.
    write(path,corrected+'// unreviewed\n');git(dir,'add',path);const changed=makeCommit(tree(),[candidate]);git(dir,'update-ref','HEAD',changed);
    const altered=structuredClone(e);altered.pull_request.head.sha=changed;
    assert.throws(()=>check(rules,altered,{...v,GITHUB_SHA:changed,GITHUB_REF:'refs/pull/512/head'}),/independent reviewed corrected harness identity/);
    git(dir,'update-ref','HEAD',merged);git(dir,'read-tree',candidate);write(path,corrected);
    assert.equal(check().consumedFiles,records.length);
    const sourceText=readFileSync(resolve(sourceRoot,QUALIFICATION[2]),'utf8'),baseline=sourceText.slice(sourceText.indexOf('export function verifyBaselines'),sourceText.indexOf('function installedDependencies'));
    assert.ok(baseline.includes('verifyFiles(dir, sourceRecords(dir, commit))'));assert.doesNotMatch(baseline,/harnessCorrection|reviewedHarness/,'historical baselines never inherit the candidate correction');
  });
  test('the settlement plumbing removes to exactly the original hero source with every original assertion',()=>{
    let source=readFileSync(resolve(sourceRoot,'scripts/hero-bars.mjs'),'utf8');
    const begin=source.indexOf('function createFixtureSettlement('),end=source.indexOf('const engine =');source=source.slice(0,begin)+source.slice(end);
    source=source.replace(/const settlement = createFixtureSettlement\(context, async \(\) => \{\n  await page.evaluate\(\(\) => undefined\);\n  await new Promise\(resolve => setImmediate\(resolve\)\);\n\}\);\n/,'');
    assert.equal((source.match(/settlement.track\(async route => \{/g)||[]).length,2);
    source=source.replaceAll('settlement.track(async route => {','async route => {').replaceAll('}));\n','});\n');
    for(const line of ['  await settlement.wait();\n','   await settlement.wait();\n',' await settlement.wait();\n']){assert.ok(source.includes(line));source=source.replace(line,'');}
    source=source.replace('JSON.stringify({engine,results,errors,settlement:settlement.evidence()},null,2));settlement.dispose();','JSON.stringify({engine,results,errors},null,2));');
    const expected='1d6a3dfae95dd348eb98dc09b2e7fe2371f2297b9bf40c92e739f49a7ddb0972';
    assert.equal(createHash('sha256').update(source).digest('hex'),expected);
    assert.notEqual(createHash('sha256').update(source.replace('assert.deepEqual(errors,[]);','assert.ok(true);')).digest('hex'),expected,'the no-error assertion cannot disappear in normalization');
  });
}

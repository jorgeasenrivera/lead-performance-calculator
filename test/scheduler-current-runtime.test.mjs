import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE as FIXED_SOURCE, SOURCE_TREE as FIXED_TREE, BASE as FIXED_BASE, REPOSITORY, BRANCH, QUALIFICATION, BASELINES, git, sourceRecords, verifyCandidate, verifySource, verifyBaselines } from '../scripts/scheduler-current-runtime/verify.mjs';

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
test('workflow preserves historical verification, measurement commands, image and driver',()=>{
  const current=readFileSync(resolve(sourceRoot,QUALIFICATION[0]),'utf8');
  const commands=current.slice(current.indexOf('        run: |',current.indexOf('      - name: Measure before and after')),current.indexOf('      - uses: actions/upload-artifact@v4'));
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
  assert.throws(()=>verifySource({root,event,env}),/nominated immutable base/);
  const source=readFileSync(resolve(sourceRoot,QUALIFICATION[2]),'utf8');
  assert.match(source,/const evidence = verifySource\(/);assert.doesNotMatch(source,/process\.env\.(?:SOURCE|BASE|POLICY|SKIP)/);
});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,readdirSync,mkdirSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// The reused provider executes only after its independently frozen bytes pass.
const provider=new URL('./scheduler-current-runtime/verify.mjs',import.meta.url);
assert.ok(lstatSync(provider).isFile()&&!lstatSync(provider).isSymbolicLink(),'regular frozen verifier provider');
assert.equal(createHash('sha256').update(readFileSync(provider)).digest('hex'),'ab1803f8088fcfb0e3a5e30ee4288afd136e881f15938a0b5cef7b64bf285530','frozen verifier provider before import');
const {sourceRecords,verifyBaselines,QUALIFICATION,CURRENT_QUALIFICATION}=await import(provider.href);

export const POLICY=Object.freeze({
 repository:'jorgeasenrivera/lead-performance-calculator',pullRequest:521,branch:'codex/scheduler-combined-webkit-proof',
 base:{commit:'720e28ed0a2e108bcfb71e440004cc971c38ca6e',tree:'083e5a7fe8e6c0968441ba011c638866ed018995'},
 eventBaseSnapshot:{commit:'4540534c1fe51a4fde6fb7a4cc6c48f68379ad67',tree:'82789729c1741d0c9ef6421e677c5e9bb7748178'},
 current:{commit:'2a26e49ba54f96bf6db7f65a926f114b44cc0cfb',tree:'adcf4b228621bf446c4593d40103d0205dce705f'},
 historical:{commit:'710cc8d78d0363856df2f9000162923859434b73',tree:'cb676324c5c3b1fd7cbbc90e6d93745bdc52855e'},
 qualification:['.github/workflows/manager-spacing.yml','.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs','test/manager-spacing-runtime.test.mjs'],
 manifest:{path:'scripts/search-runtime.sha256',sha256:'5cc466b968535b7544c0885c91ca68fcdc718c50bd31df87d58478082e35c78c'},
});
const roots=new Set(['.claude','api','download','fixtures','infra','native','public','scripts','src','supabase','test','workers']);
const flags=['VITE_SCHEDULER_CALENDAR','VITE_SCHEDULER_DRAFT_LOCAL','VITE_SCHEDULER_DRAFT_PILOT','SCHEDULER_DRAFT_PILOT_ENABLED'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const file=(root,name)=>{const p=resolve(root,name);assert.ok(lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink(),'regular input: '+name);return readFileSync(p);};

export function validateEvent(event,env,policy=POLICY){
 assert.equal(env.GITHUB_EVENT_NAME,'pull_request','pull request only');assert.equal(env.GITHUB_REPOSITORY,policy.repository,'repository');
 assert.equal(event.repository?.full_name,policy.repository,'event repository');assert.equal(event.number,policy.pullRequest,'qualified pull request');
 const pr=event.pull_request;assert.equal(pr?.head?.repo?.full_name,policy.repository,'same repository head');assert.equal(pr?.base?.repo?.full_name,policy.repository,'same repository base');
 assert.equal(pr?.head?.ref,policy.branch,'qualified branch');assert.equal(pr?.base?.ref,'main','main target');
 assert.ok(pr?.base?.sha===policy.base.commit||Boolean(policy.eventBaseSnapshot&&pr?.base?.sha===policy.eventBaseSnapshot.commit),'exact reviewed base or pinned PR event snapshot');
 assert.match(pr?.head?.sha||'',/^[0-9a-f]{40}$/,'full head identity');
 for(const name of flags)assert.equal(env[name],'0','scheduler remains OFF: '+name);
 assert.equal(env.VITE_SUPABASE_URL,'http://127.0.0.1:5433','synthetic SDK endpoint');assert.equal(env.VITE_SUPABASE_ANON_KEY,'mock-anon-key','synthetic SDK key');return pr;
}
export function runtimeFor(name,policy=POLICY){assert.ok(name==='historical'||name==='current','explicit runtime case');return policy[name];}

function entries(root,commit){return git(root,'ls-tree','-rz',commit).split('\0').filter(Boolean).map(row=>{const i=row.indexOf('\t');return {path:row.slice(i+1),entry:row.slice(0,i)};});}
function verifyPreservedQualification(root,commit,policy){
 const committed=entries(root,commit);
 for(const name of new Set([...QUALIFICATION,...CURRENT_QUALIFICATION])){
  if(policy.qualification.includes(name))continue;
  const row=committed.find(row=>row.path===name);
  if(!row){assert.equal(existsSync(resolve(root,name)),false,'no extra historical qualification file: '+name);continue;}
  assert.match(row.entry,/^100644 blob [0-9a-f]{40}$/,'regular preserved qualification file');
  assert.ok(file(root,name).equals(execFileSync('git',['-C',root,'show',commit+':'+name])),'preserved qualification checkout bytes: '+name);
 }
}
function verifyDefinition(root,pr,policy){
 assert.equal(git(root,'rev-parse','HEAD'),pr.head.sha,'definition checkout');
 assert.equal(git(root,'rev-parse',policy.current.commit+'^{tree}'),policy.current.tree,'immutable hero source tree');
 assert.equal(git(root,'rev-parse',policy.base.commit+'^{tree}'),policy.base.tree,'immutable base tree');
 if(pr.base.sha!==policy.base.commit){
  assert.equal(git(root,'rev-parse',pr.base.sha+'^{tree}'),policy.eventBaseSnapshot.tree,'immutable PR event snapshot tree');
  assert.deepEqual(git(root,'show','-s','--format=%P',policy.base.commit).split(' '),[pr.base.sha],'pinned snapshot is the exact parent of the current base');
 }
 git(root,'merge-base','--is-ancestor',policy.base.commit,policy.current.commit);git(root,'merge-base','--is-ancestor',policy.current.commit,pr.head.sha);
 const changed=git(root,'diff','--name-only',policy.current.commit,pr.head.sha).split('\n').filter(Boolean).sort();
 assert.deepEqual(changed,[...policy.qualification].sort(),'qualification changes only');
 const source=entries(root,policy.current.commit),head=entries(root,pr.head.sha),q=new Set(policy.qualification);
 assert.deepEqual(head.filter(r=>!q.has(r.path)),source.filter(r=>!q.has(r.path)),'all non-qualification paths, modes and blobs remain frozen');
 for(const name of policy.qualification){const row=head.find(r=>r.path===name);assert.ok(row&&/^100644 blob [0-9a-f]{40}$/.test(row.entry),'regular qualification file: '+name);assert.ok(file(root,name).equals(execFileSync('git',['-C',root,'show',pr.head.sha+':'+name])),'checkout qualification bytes: '+name);}
 assert.equal(sha(file(root,policy.manifest.path)),policy.manifest.sha256,'historical manifest remains unchanged');
}
function actualInputs(root,omitted){
 const found=[];
 function walk(name){if(omitted.has(name))return;const stat=lstatSync(resolve(root,name));assert.ok(!stat.isSymbolicLink(),'no source symlink: '+name);if(stat.isDirectory()){for(const child of readdirSync(resolve(root,name)).sort())walk(name+'/'+child);}else found.push(name);}
 for(const name of readdirSync(root).sort()){
  if(name==='.env.local'){assert.equal(file(root,name).toString(),'VITE_SUPABASE_URL=http://127.0.0.1:5433\nVITE_SUPABASE_ANON_KEY=mock-anon-key\n','only the existing synthetic build fixture');continue;}
  assert.ok(!name.startsWith('.env')&&name!=='.npmrc','no unreviewed build configuration: '+name);
  if(roots.has(name))walk(name);else if(name!=='.git'&&lstatSync(resolve(root,name)).isFile()&&!name.toLowerCase().endsWith('.md')&&!omitted.has(name))found.push(name);
 }return found.sort();
}
export function verifyInputFiles(root,records,policy=POLICY){
 const omit=new Set([...QUALIFICATION,...CURRENT_QUALIFICATION,...policy.qualification]);
 assert.deepEqual(actualInputs(root,omit),records.map(r=>r.path).filter(p=>!omit.has(p)).sort(),'complete consumed source inventory');
 for(const row of records){if(omit.has(row.path))continue;const bytes=file(root,row.path);assert.equal((lstatSync(resolve(root,row.path)).mode&0o111)?'100755':'100644',row.mode,'input mode: '+row.path);assert.equal(bytes.length,row.bytes,'input size: '+row.path);assert.equal(sha(bytes),row.sha256,'input hash: '+row.path);}
}
export function verifyRouted({runtimeRoot,definitionRoot,eventRoot,event,env,caseName},policy=POLICY){
 const pr=validateEvent(event,env,policy),runtime=runtimeFor(caseName,policy);verifyDefinition(definitionRoot,pr,policy);
 const eventCommit=git(eventRoot,'rev-parse','HEAD');assert.equal(eventCommit,env.GITHUB_SHA,'actual event checkout');
 if(eventCommit===pr.head.sha){assert.equal(pr.base.sha,policy.base.commit,'stale event snapshot requires an exact current-base merge checkout');assert.ok(['refs/pull/'+policy.pullRequest+'/head','refs/heads/'+policy.branch].includes(env.GITHUB_REF),'head event ref');}
 else{assert.equal(env.GITHUB_REF,'refs/pull/'+policy.pullRequest+'/merge','merge event ref');assert.deepEqual(git(eventRoot,'show','-s','--format=%P','HEAD').split(' '),[policy.base.commit,pr.head.sha],'exact merge parents');}
 assert.equal(git(eventRoot,'rev-parse','HEAD^{tree}'),git(definitionRoot,'rev-parse','HEAD^{tree}'),'event introduces no source drift');
 assert.equal(git(runtimeRoot,'rev-parse','HEAD'),runtime.commit,'served runtime commit');assert.equal(git(runtimeRoot,'rev-parse','HEAD^{tree}'),runtime.tree,'served runtime tree');
 const records=sourceRecords(runtimeRoot,runtime.commit),definitionRecords=sourceRecords(definitionRoot,policy.current.commit);
 verifyPreservedQualification(runtimeRoot,runtime.commit,policy);verifyPreservedQualification(definitionRoot,policy.current.commit,policy);
 verifyInputFiles(runtimeRoot,records,policy);verifyInputFiles(definitionRoot,definitionRecords,policy);
 if(caseName==='historical')execFileSync('sha256sum',['--check',resolve(definitionRoot,policy.manifest.path)],{cwd:runtimeRoot});
 return{caseName:caseName==='historical'?'historical-search':'current-hero',runtimeCommit:runtime.commit,runtimeTree:runtime.tree,definitionCommit:pr.head.sha,definitionTree:git(definitionRoot,'rev-parse','HEAD^{tree}'),heroSource:policy.current.commit,heroSourceTree:policy.current.tree,baseRef:pr.base.ref,baseCommit:policy.base.commit,baseTree:policy.base.tree,eventBaseCommit:pr.base.sha,eventBaseTree:pr.base.sha===policy.base.commit?policy.base.tree:policy.eventBaseSnapshot.tree,eventBaseKind:pr.base.sha===policy.base.commit?'current-base':'pinned-pr-snapshot',eventCommit,eventTree:git(eventRoot,'rev-parse','HEAD^{tree}'),consumedFiles:records.length,flags:Object.fromEntries(flags.map(k=>[k,'0'])),historicalManifestSha256:policy.manifest.sha256};
}
function dependencies(root){const p=JSON.parse(file(root,'package.json')),lock=JSON.parse(file(root,'package-lock.json')),result={};for(const name of [...Object.keys(p.dependencies||{}),...Object.keys(p.devDependencies||{})]){const actual=JSON.parse(readFileSync(resolve(root,'node_modules',name,'package.json'))).version;assert.equal(actual,lock.packages['node_modules/'+name].version,'locked installed dependency: '+name);result[name]=actual;}assert.equal(JSON.parse(readFileSync(resolve(root,'node_modules/playwright/package.json'))).version,'1.63.0','exact browser driver');return result;}
function buildFiles(root){
 const rows=[];function walk(name){for(const child of readdirSync(resolve(root,name)).sort()){const p=name+'/'+child,stat=lstatSync(resolve(root,p));assert.ok(!stat.isSymbolicLink(),'regular build output');if(stat.isDirectory())walk(p);else{assert.ok(stat.isFile());const bytes=readFileSync(resolve(root,p));rows.push({path:p.slice(5),bytes:bytes.length,sha256:sha(bytes)});}}}walk('dist');return rows;
}
export function sealBuild(root,evidence){
 const outputs=buildFiles(root);assert.ok(outputs.length>0,'nonempty build');return {runtimeCommit:evidence.runtimeCommit,runtimeTree:evidence.runtimeTree,flags:evidence.flags,command:'npm run build',outputs};
}
export function verifyBuild(root,sealed,evidence){
 assert.equal(sealed.runtimeCommit,evidence.runtimeCommit,'build runtime commit');assert.equal(sealed.runtimeTree,evidence.runtimeTree,'build runtime tree');assert.deepEqual(sealed.flags,evidence.flags,'build flags');assert.deepEqual(buildFiles(root),sealed.outputs,'sealed build bytes and inventory');
}
export async function verifyServedBuild(sealed,request=fetch){
 for(const row of sealed.outputs){assert.ok(!row.path.startsWith('/')&&!row.path.split('/').includes('..'),'safe build path');const response=await request('http://127.0.0.1:5178/'+row.path);assert.equal(response.status,200,'served output: '+row.path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,row.bytes,'served size: '+row.path);assert.equal(sha(bytes),row.sha256,'served hash: '+row.path);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const stage=process.argv[2];assert.ok(['before-install','after-install','after-build','before-measure','post-measure'].includes(stage),'explicit verification stage');
 const runtimeRoot=process.cwd(),definitionRoot=resolve(runtimeRoot,'../spacing-definition'),eventRoot=resolve(runtimeRoot,'../spacing-event');
 const evidence=verifyRouted({runtimeRoot,definitionRoot,eventRoot,event:JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)),env:process.env,caseName:process.env.SPACING_RUNTIME_CASE});
 evidence.stage=stage;evidence.baselines=verifyBaselines(runtimeRoot);if(stage!=='before-install')evidence.dependencies=dependencies(runtimeRoot);
 const buildFile=resolve(runtimeRoot,'manager-runtime-qualification/build-inputs.json');
 if(stage==='after-build'){mkdirSync('manager-runtime-qualification',{recursive:true});writeFileSync(buildFile,JSON.stringify(sealBuild(runtimeRoot,evidence),null,2)+'\n');}
 if(stage==='before-measure'||stage==='post-measure'){const sealed=JSON.parse(readFileSync(buildFile));verifyBuild(runtimeRoot,sealed,evidence);if(stage==='before-measure')await verifyServedBuild(sealed);evidence.buildOutputs=sealed.outputs.length;evidence.buildManifestSha256=sha(readFileSync(buildFile));}
 mkdirSync('manager-runtime-qualification',{recursive:true});writeFileSync('manager-runtime-qualification/'+stage+'.json',JSON.stringify(evidence,null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'runtime_sha='+evidence.runtimeCommit+'\ncase_name='+evidence.caseName+'\n');console.log(JSON.stringify(evidence));
}

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
// The two-parent source anchor keeps the reviewed Sage application and
// current shared-main changes intact. Only these two CI files may follow it.
export const PARITY_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:524,branch:'codex/scheduler-hero-calendar-parity-20261117',
 base:{commit:'08211512bde8ef541ecad2d5a603cd37e83dc8da',tree:'feef1f5c29f3d839afdb3528074b74159a7c6b85'},
 current:{commit:'f404e7c998f32cbd063bfd6bbf6b54ddb3b26cec',tree:'8df21db3c305d9551b11dc88a6cbf7f569d76842',
  parents:['5d508b86be1e35f7f25b144b85fe7800d1105bda','08211512bde8ef541ecad2d5a603cd37e83dc8da'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Current application bytes are the reviewed Service-total PR, not the historical fixture.
export const SERVICE_TOTALS_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:527,branch:'claude/project-thread-i2fcpc',
 base:{commit:'7221c4fc7110e327c916624a9b1f7fe284f37791',tree:'f971d61e51a8e3d8ce9cf7701c186a277681634f'},
 current:{commit:'c6b6d4164b3eda7f4d1a25400e74151f06b545be',tree:'3fb6726cd47554607ed68c709b484ca4360b7fba'},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Qualify the actual reviewed People application tree composed on live main with no source substitution.
export const PEOPLE_SERVICE_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:529,branch:'codex/people-service-credits',
 base:{commit:'f4b8f22453d10c5d342b2947a10d8fa94ba7f70e',tree:'8e1bc7ba7f0132280733340fff13f0ce46a46d95'},
 current:{commit:'de5d6fb07fdc54d1f7cc7a8bdaa1523d5cf1e002',tree:'5a1a5b35f06ae52e0c75f750fcedbb30c781ff56',
  parents:['5e013fc694b31f21b4d7c68ef834b18dd61cb28d','f4b8f22453d10c5d342b2947a10d8fa94ba7f70e'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs','test/manager-spacing-runtime.test.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual Duet #531 app composed on the pinned main, independently of the frozen historical run.
export const DUET_STORE_CARD_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:531,branch:'claude/project-thread-i2fcpc',
 base:{commit:'636521e003481b823ae4d73543868c52cb69977b',tree:'b5bc508dc7d0b76e25fb23c0a9619510894c9fdb'},
 current:{commit:'a54a60e05806d43d1d5cd18c46152eed7b6678c5',tree:'33f6afd1be2257734434e8050973a64d8f792360',parents:['c66d16532145c736b85d1cbee6b391f84587e75e','636521e003481b823ae4d73543868c52cb69977b']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual approved Rooms copy app, independently of the frozen historical run.
export const ROOMS_HINT_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:533,branch:'codex/rooms-live-floor-hint',
 base:{commit:'2b2fda912107e2071cc0a2e281bfe3cd2cfb61d1',tree:'6202d0a287825ccb761689ba576ba6510acc5952'},
 current:{commit:'b75e10f7b50674554d65f78f8ef647192e3b0b63',tree:'9f8203c52df7eb1a95d2cf038372961d8938f2da',parents:['c60cfe15f9971c16cdc4d54e0b4d97b8e2a91438','2b2fda912107e2071cc0a2e281bfe3cd2cfb61d1'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual Duet #535 wording-only source on pinned main, independently of the frozen historical run.
export const DUET_COPY_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:535,branch:'claude/project-thread-gfqvq0',
 base:{commit:'733812f44a2032f93fefa169dbb33d6ee9c590b9',tree:'7dee4483d90723163600ed9a417a6f1f2e295508'},
 current:{commit:'57406343a43422fe5cab78553b5affa640b3c873',tree:'fcbff90eaead98199cf1ba1071c2a6b664287390',parents:['d5cd927050f359e4ebeb0b75ed2306ee51206ed1']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual approved People/Scheduler copy app, independently of the frozen historical run.
export const PEOPLE_SCHEDULER_COPY_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:536,branch:'codex/people-scheduler-copy',
 base:{commit:'8d3da0f732b5f2003e880f3cff6e1114f3a0d740',tree:'b74b410d0ab9e29d76e57984676bf3ce42c9f3a8'},
 current:{commit:'d13813fefa9d5fd244431b9dde60dce324b56c8f',tree:'c3794223c3ed1e963dc02ad8c24eb7a8aa2f464d',parents:['8d3da0f732b5f2003e880f3cff6e1114f3a0d740']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual Sage #538 store-hero source on pinned main, independently of the frozen historical run.
export const STORE_HERO_LAYOUT_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:538,branch:'claude/project-thread-khhfx0',
 base:{commit:'58360cf8721f9a7ed0bbad30233e38cec29f561a',tree:'cc833f3c029b55f92244c9ca3f8044eb8d9dd703'},
 current:{commit:'0a017c582e0136c3252edf7ae189f66f11b389c7',tree:'263c8a4e4d1925d4d65717b45dafc90a1f857031',parents:['480b3b27a08f430fc785a180708be314e8993966'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual approved Calendar app, independently of the frozen historical run.
export const MANAGER_PAGES_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:540,branch:'codex/manager-pages-pix-20261118',
 base:{commit:'50d65152638e5967247a0526d58a52f1d1f8361f',tree:'b27daff3119c85ab058f9eb22dba1f10e9547881'},
 current:{commit:'eb62d2cce4513190f9f79c87791d589f684d1a80',tree:'053d4efb6f5a92f209b703d822b42a0d2fe8b60d',parents:['4b89c0bb88482f11864828bc1bcb008427b4c807','50d65152638e5967247a0526d58a52f1d1f8361f'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify this exact Rooms source while retaining the frozen historical runtime.
export const STORE_ROOM_VISIBILITY_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:541,branch:'claude/sage-view-toggles-n72trw',
 base:{commit:'855d6d8f1c6c55fe71fa8329aad197b07cf4486d',tree:'c0fe6ddbc916856d44fb08dc9f4b1795a6b002eb'},
 current:{commit:'7b78216aab20993a84392d3911ddfe1eaa0a0bf0',tree:'86ea8a8d285dc64bd5d6558c3dbcb4f987ed451e',parents:['c2ed0bd5f14d165d7fda138a647eb00e398314aa']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Verify the actual approved motion kit app, independently of the frozen historical run.
export const MOTION_KIT_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:543,branch:'claude/project-thread-iu4k4x',
 base:{commit:'ad34b191a69e5d86276d0ef383d5c60e42d3a2b3',tree:'3b144282c36d7960848e10f7d71037aae66c9ed4'},
 current:{commit:'4e83e4ac0d9aed152b44f1a6cd67e7dab83b5fa0',tree:'846ae3e1147795fbb72efe3b7eed8b2387274905',parents:['7fad21f2cf6e5d6e1d4e531a2cf36472741aac9d'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs','test/manager-spacing-runtime.test.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
// Qualify the exact Dashboard/Today source separately from the frozen historical runtime.
export const DASHBOARD_TODAY_POLICY=Object.freeze({
 repository:POLICY.repository,pullRequest:542,branch:'claude/sage-dashboard-people-scheduler-8ntqy6',
 base:{commit:'deb8df18768767701b55ba024be476e681ed4d65',tree:'dce88532c1d63aa06315157be9a023a68088e7cc'},
 current:{commit:'45871c92eff7787e648dcc6d51eb2741f3a260f0',tree:'49b6c37c1f6cbca557c1aad72c9c621eb45bc114',parents:['8c9e4ac4e86f52d8a4e20051052f608fe4e3defb'],
  definitionChanges:['.github/workflows/manager-hero-spacing.yml','scripts/manager-spacing-runtime.mjs']},
 historical:POLICY.historical,qualification:POLICY.qualification,manifest:POLICY.manifest,
 requireMerge:true,
});
export function policyForPullRequest(number){
 if(number===DASHBOARD_TODAY_POLICY.pullRequest)return DASHBOARD_TODAY_POLICY;
 if(number===STORE_ROOM_VISIBILITY_POLICY.pullRequest)return STORE_ROOM_VISIBILITY_POLICY;
 if(number===POLICY.pullRequest)return POLICY;
 if(number===PARITY_POLICY.pullRequest)return PARITY_POLICY;
 if(number===SERVICE_TOTALS_POLICY.pullRequest)return SERVICE_TOTALS_POLICY;
 if(number===PEOPLE_SERVICE_POLICY.pullRequest)return PEOPLE_SERVICE_POLICY;
 if(number===MOTION_KIT_POLICY.pullRequest)return MOTION_KIT_POLICY;
 if(number===MANAGER_PAGES_POLICY.pullRequest)return MANAGER_PAGES_POLICY;
 if(number===STORE_HERO_LAYOUT_POLICY.pullRequest)return STORE_HERO_LAYOUT_POLICY;
 if(number===PEOPLE_SCHEDULER_COPY_POLICY.pullRequest)return PEOPLE_SCHEDULER_COPY_POLICY;
 if(number===DUET_COPY_POLICY.pullRequest)return DUET_COPY_POLICY;
 if(number===DUET_STORE_CARD_POLICY.pullRequest)return DUET_STORE_CARD_POLICY;
 if(number===ROOMS_HINT_POLICY.pullRequest)return ROOMS_HINT_POLICY;
 throw new Error('unqualified pull request');
}
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
 if(policy.current.parents)assert.deepEqual(git(root,'show','-s','--format=%P',policy.current.commit).split(' '),policy.current.parents,'exact source anchor parents');
 if(pr.base.sha!==policy.base.commit){
  assert.equal(git(root,'rev-parse',pr.base.sha+'^{tree}'),policy.eventBaseSnapshot.tree,'immutable PR event snapshot tree');
  assert.deepEqual(git(root,'show','-s','--format=%P',policy.base.commit).split(' '),[pr.base.sha],'pinned snapshot is the exact parent of the current base');
 }
 git(root,'merge-base','--is-ancestor',policy.base.commit,policy.current.commit);git(root,'merge-base','--is-ancestor',policy.current.commit,pr.head.sha);
 const changed=git(root,'diff','--name-only',policy.current.commit,pr.head.sha).split('\n').filter(Boolean).sort();
 assert.deepEqual(changed,[...(policy.current.definitionChanges??policy.qualification)].sort(),'qualification changes only');
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
 if(eventCommit===pr.head.sha){assert.ok(!policy.requireMerge,'this route requires an exact merge checkout');assert.equal(pr.base.sha,policy.base.commit,'stale event snapshot requires an exact current-base merge checkout');assert.ok(['refs/pull/'+policy.pullRequest+'/head','refs/heads/'+policy.branch].includes(env.GITHUB_REF),'head event ref');}
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
 const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
 const evidence=verifyRouted({runtimeRoot,definitionRoot,eventRoot,event,env:process.env,caseName:process.env.SPACING_RUNTIME_CASE},policyForPullRequest(event.number));
 evidence.stage=stage;evidence.baselines=verifyBaselines(runtimeRoot);if(stage!=='before-install')evidence.dependencies=dependencies(runtimeRoot);
 const buildFile=resolve(runtimeRoot,'manager-runtime-qualification/build-inputs.json');
 if(stage==='after-build'){mkdirSync('manager-runtime-qualification',{recursive:true});writeFileSync(buildFile,JSON.stringify(sealBuild(runtimeRoot,evidence),null,2)+'\n');}
 if(stage==='before-measure'||stage==='post-measure'){const sealed=JSON.parse(readFileSync(buildFile));verifyBuild(runtimeRoot,sealed,evidence);if(stage==='before-measure')await verifyServedBuild(sealed);evidence.buildOutputs=sealed.outputs.length;evidence.buildManifestSha256=sha(readFileSync(buildFile));}
 mkdirSync('manager-runtime-qualification',{recursive:true});writeFileSync('manager-runtime-qualification/'+stage+'.json',JSON.stringify(evidence,null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'runtime_sha='+evidence.runtimeCommit+'\ncase_name='+evidence.caseName+'\n');console.log(JSON.stringify(evidence));
}

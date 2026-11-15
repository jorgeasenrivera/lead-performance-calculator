import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {buildDemo} from '../demo-seed.mjs';
import {finalizeHtml,MAIN_POLICY} from '../scheduler-performance/html-finalize.mjs';
import contract from './runtime.json' with {type:'json'};
import combined from './combined.json' with {type:'json'};

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const RUNTIME_INVENTORY_SHA='a6556e8ed8784874ae7fde7a53dc7fea0baf35be08d74af7ac2f08bbad708153';
const DEFINITION_INVENTORY_SHA='1fb44cf5ee6932d78661e773704bbc44bda6ee1a21994944304f08a44b974ff8';
const OWN='scripts/scheduler-current-host-preview/build.mjs';
const COMBINED_CONTRACT_SHA='59839ac1e700a7ee03f75883221e0409005a3faf9f38f283e457ad27b45cbd72';
const DEPENDENCIES=realpathSync(path.join(ROOT,'node_modules'));
const within=(parent,file)=>{const relative=path.relative(parent,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const digest=records=>sha(JSON.stringify(records));
export function assertFixtureContract(value){
 assert.deepEqual(Object.keys(value).sort(),['definition','files','fixtureDate','historicalGuardSha256','manager','subject','tree','version'],'Fixture metadata changed');
 assert.equal(value.version,'current-host-fixture/1');
 assert.equal(value.fixtureDate,'2026-11-15T16:00:00Z','Fixture date changed');
 assert.equal(value.manager,'4d6b8199b2e2030c7ffc0ee3b0c54e72e558887216d1dc1a6bd8fb17a42a0b00');
 assert.equal(value.historicalGuardSha256,'29503dece524a14f6f1ebca2ecad0e9363dffc45a80279cc3d3e820572b6b654');
 assert.equal(value.subject,'6812fa3567cfdd9b6aa6664b2d48b6b0648c15bb');assert.equal(value.tree,'b3ef18086f4617d086a07fa0b4ed4349a7f38be9');
 const seen=new Set();for(const row of [...value.files,...value.definition]){assert.deepEqual(Object.keys(row),['path','bytes','sha256']);assert.match(row.path,/^[A-Za-z0-9_.\/-]+$/);assert.ok(!row.path.startsWith('/')&&!row.path.split('/').includes('..')&&!seen.has(row.path),'Unsafe or duplicate fixture path');seen.add(row.path);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);assert.match(row.sha256,/^[0-9a-f]{64}$/);}
 assert.equal(digest(value.files),RUNTIME_INVENTORY_SHA,'Immutable runtime inventory changed');
 // This verifier is the reviewed trust root, so its own row cannot self-pin.
 assert.equal(digest(value.definition.filter(row=>row.path!==OWN)),DEFINITION_INVENTORY_SHA,'Reviewed fixture definition changed');
}
export function assertCombinedContract(value){
 const paths=['scripts/probe-scheduler-integration.mjs','scripts/scheduler-performance/month-app-core.mjs','scripts/scheduler-performance/planner.css'];
 assert.deepEqual(value.files.map(row=>row.path),paths,'Combined case must contain exactly the reviewed Week paths');
 for(const row of value.files){assert.deepEqual(Object.keys(row),['path','bytes','sha256','previousSha256']);assert.match(row.sha256,/^[0-9a-f]{64}$/);assert.match(row.previousSha256,/^[0-9a-f]{64}$/);const original=contract.files.find(x=>x.path===row.path);if(original)assert.equal(row.previousSha256,original.sha256,'Original hero runtime binding changed');}
 assert.equal(digest(value),COMBINED_CONTRACT_SHA,'Combined source or provenance changed');
}
const heroRows=new Map([...contract.files,...contract.definition].map(row=>[row.path,row]));
const combinedRows=new Map([...contract.files,...combined.files,...contract.definition].map(row=>[row.path,row]));
const selectedRows=scope=>{assert.ok(scope==='hero'||scope==='combined','Unknown current-host case');return scope==='hero'?heroRows:combinedRows;};
export function assertFixtureSelection(selection){
 assert.deepEqual(selection,{calendar:'1',draft:'0',pilot:'0',url:'',key:''},'Current-host fixture must be isolated and unsaved.');
}
export function verifyFixtureBytes(file,bytes,scope='combined'){
 const row=selectedRows(scope).get(file);assert.ok(row,'Unqualified current-host input: '+file);
 assert.equal(bytes.length,row.bytes,'Current-host input size changed: '+file);
 assert.equal(sha(bytes),row.sha256,'Current-host input hash changed: '+file);
}
export function verifyLoadedInput(id,root=ROOT,scope='combined'){
 const virtuals=['\0current-host-fixture','\0vite/preload-helper','\0vite/preload-helper.js','\0vite/modulepreload-polyfill','\0vite/modulepreload-polyfill.js','\0commonjsHelpers.js','\0commonjs-dynamic-modules','__vite-browser-external','\0__vite-browser-external?commonjs-proxy'];
 if(virtuals.includes(id))return;
 const file=(id.startsWith('\0')?id.slice(1):id).split('?')[0];
 if(path.isAbsolute(file)&&(within(path.join(root,'node_modules'),file)||within(DEPENDENCIES,file)))return;
 assert.ok(!id.startsWith('\0'),'Unknown virtual input');
 assert.ok(path.isAbsolute(file),'Unknown external input: '+JSON.stringify(id));
 const relative=path.relative(root,file);assert.ok(!relative.startsWith('..'),'Input outside current-host root');
 assert.ok(selectedRows(scope).has(relative),'Extra current-host module: '+relative);
}
async function publicFiles(root,dir='public'){
 const out=[];for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const file=dir+'/'+entry.name;if(entry.isDirectory())out.push(...await publicFiles(root,file));else{assert.ok(entry.isFile(),'Non-regular public input');out.push(file);}}return out.sort();
}
export async function verifyCurrentHost(root=ROOT,scope='combined'){
 assertFixtureContract(contract);
 assertCombinedContract(combined);
 assert.equal(contract.manager,'4d6b8199b2e2030c7ffc0ee3b0c54e72e558887216d1dc1a6bd8fb17a42a0b00');
 for(const row of selectedRows(scope).values()){const info=await fs.lstat(path.join(root,row.path));assert.ok(info.isFile()&&!info.isSymbolicLink(),'Non-regular current-host input');verifyFixtureBytes(row.path,await fs.readFile(path.join(root,row.path)),scope);}
 assert.deepEqual(await publicFiles(root),contract.files.filter(row=>row.path.startsWith('public/')).map(row=>row.path).sort(),'Public fixture inventory changed');
}
export async function buildCurrentHostPreview(){
 const root=ROOT,outDir=path.join(root,'dist-harness/scheduler-current-host');
 await verifyCurrentHost(root);
 const selection={calendar:'1',draft:'0',pilot:'0',url:'',key:''};assertFixtureSelection(selection);
 const demo=buildDemo(new Date(contract.fixtureDate)),fixture=JSON.stringify({store:demo.storeConfig,data:demo.storeData});
 const loaded=new Set();
 const qualify=()=>({name:'qualified-current-host-modules',transform(code,id){verifyLoadedInput(id,root);if(path.isAbsolute(id)&&!id.includes('/node_modules/'))loaded.add(id.split('?')[0]);}});
 await build({root,configFile:false,envDir:false,envPrefix:'__CURRENT_HOST_NO_ENV_',publicDir:false,logLevel:'warn',
  worker:{plugins:()=>[qualify()]},
  plugins:[{name:'exact-current-host-fixture',
   resolveId(id){if(id==='virtual:current-host-fixture')return '\0current-host-fixture';},
   load(id){if(id==='\0current-host-fixture')return 'export default '+fixture+';';},
   transformIndexHtml:{order:'pre',handler(html){const entry='<script type="module" src="/src/main.jsx"></script>';assert.equal(html.split(entry).length,2,'Current host HTML entry changed');return html.replace(entry,'<script type="module" src="/scripts/scheduler-current-host-preview/entry.jsx"></script>');}},
  },qualify(),react()],
  define:{__APP_VERSION__:JSON.stringify('synthetic-current-host'),
   'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(selection.url),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(selection.key),
   'import.meta.env.VITE_SCHEDULER_CALENDAR':JSON.stringify(selection.calendar),'import.meta.env.VITE_SCHEDULER_DRAFT_LOCAL':JSON.stringify(selection.draft),'import.meta.env.VITE_SCHEDULER_DRAFT_PILOT':JSON.stringify(selection.pilot),'import.meta.env.VITE_SCHEDULER_DRAFT_PILOT_STORE_ID':JSON.stringify('')},
  build:{outDir,emptyOutDir:true,target:'es2022'},
 });
 for(const row of contract.files.filter(row=>row.path.startsWith('public/'))){const target=path.join(outDir,row.path.slice(7));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,row.path),target);}
 const html=await fs.readFile(path.join(outDir,'index.html'),'utf8');await fs.writeFile(path.join(outDir,'index.html'),finalizeHtml(html.replace(/<script>([\s\S]*?)<\/script>/g,''),MAIN_POLICY));
 await verifyCurrentHost(root);
 const outputs=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else{assert.ok(entry.isFile());const bytes=await fs.readFile(file);outputs.push({path:path.relative(outDir,file),bytes:bytes.length,sha256:sha(bytes)});}}}await walk(outDir);
 await fs.writeFile(path.join(outDir,'CURRENT-HOST-MANIFEST.json'),JSON.stringify({contract:'synthetic-current-host/1',case:'combined',subject:combined.subject,subjectTree:combined.tree,originalHero:combined.acceptedHeroSource,week:combined.week,selection,fixtureSource:'scripts/demo-seed.mjs',fixtureDate:contract.fixtureDate,fixtureSha256:sha(fixture),loaded:[...loaded].map(file=>path.relative(root,file)).sort(),outputs:outputs.sort((a,b)=>a.path.localeCompare(b.path)),limits:['Synthetic auth and in-memory data/storage; no hosted login, backend, save or publication proof.','No exact Nov6 pixel identity, physical phone or warm-session claim.']},null,2)+'\n');
 console.log('Exact current-host synthetic preview built; historical contract and production source unchanged.');
}
if(process.argv[1]?.endsWith('/scheduler-current-host-preview/build.mjs'))await buildCurrentHostPreview();

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import contract from '../scripts/scheduler-current-host-preview/runtime.json' with {type:'json'};
import {verifyCurrentHost,verifyFixtureBytes,verifyLoadedInput,assertFixtureSelection,assertFixtureContract} from '../scripts/scheduler-current-host-preview/build.mjs';
import {historicalManagerFixture,HISTORICAL_MANAGER_SHA,CURRENT_MANAGER_SHA} from '../scripts/scheduler-performance/historical-manager-fixture.mjs';
import {patchManager,MANAGER_SHA} from '../scripts/scheduler-performance/build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('historical Manager approval and every inverse fixture anchor retain exact bytes',async()=>{
 const current=await fs.readFile(path.join(root,'src/Manager.jsx'),'utf8'),historical=historicalManagerFixture(current);
 assert.equal(sha(current),CURRENT_MANAGER_SHA);assert.equal(sha(historical),HISTORICAL_MANAGER_SHA);assert.equal(MANAGER_SHA,HISTORICAL_MANAGER_SHA);
 assert.throws(()=>patchManager(current),/Re-review entry points/);assert.doesNotThrow(()=>patchManager(historical));
 for(const changed of [current+'\n',current.replace('layout="panel"','layout="compact"'),current.replace('return null;','return undefined;')])assert.throws(()=>historicalManagerFixture(changed),/input changed/);
 assert.equal(await fs.readFile(path.join(root,'src/Manager.jsx'),'utf8'),current);
 const builder=await fs.readFile(path.join(root,'scripts/scheduler-performance/build.mjs'),'utf8'),start=builder.indexOf('export function patchManager('),end=builder.indexOf('export async function buildPreview()',start);
 assert.equal(sha(builder.slice(start,end)),contract.historicalGuardSha256,'historical guard and transform body unchanged');
});

test('current host qualifies immutable accepted runtime and separate definition inputs',async()=>{
 assert.equal(contract.subject,'6812fa3567cfdd9b6aa6664b2d48b6b0648c15bb');assert.equal(contract.tree,'b3ef18086f4617d086a07fa0b4ed4349a7f38be9');
 await verifyCurrentHost(root);
 for(const row of contract.files)assert.doesNotThrow(()=>verifyLoadedInput(path.join(root,row.path),root));
 assert.doesNotThrow(()=>verifyLoadedInput(path.join(root,'scripts/scheduler-current-host-preview/entry.jsx'),root));
 assert.ok(contract.files.some(row=>row.path==='scripts/scheduler-performance/generation-worker.mjs'));
});

test('changing or rehashing manifest rows cannot rebind the accepted runtime',()=>{
 for(const mutate of [value=>value.files[0].sha256='f'.repeat(64),value=>value.files.pop(),value=>value.files.push({...value.files[0],path:'src/extra.jsx'}),value=>value.definition.find(row=>row.path.endsWith('/entry.jsx')).sha256='f'.repeat(64)]){const changed=structuredClone(contract);mutate(changed);assert.throws(()=>assertFixtureContract(changed),/inventory changed|definition changed/);}
 const duplicate=structuredClone(contract);duplicate.files.push(duplicate.files[0]);assert.throws(()=>assertFixtureContract(duplicate),/duplicate fixture path/);
 assert.throws(()=>assertFixtureContract({...contract,fixtureDate:'2026-12-15T16:00:00Z'}),/Fixture date changed/);
 assert.throws(()=>assertFixtureContract({...contract,unreviewed:true}),/Fixture metadata changed/);
});

test('current host refuses changed and extra loaded source instead of historical fallback',async()=>{
 const bytes=await fs.readFile(path.join(root,'src/Manager.jsx'));
 assert.throws(()=>verifyFixtureBytes('src/Manager.jsx',Buffer.concat([bytes,Buffer.from('\n')])),/size changed/);
 const changed=Buffer.from(bytes);changed[0]^=1;assert.throws(()=>verifyFixtureBytes('src/Manager.jsx',changed),/hash changed/);
 assert.throws(()=>verifyLoadedInput(path.join(root,'src/unreviewed.jsx'),root),/Extra current-host module/);
 assert.throws(()=>verifyLoadedInput('/unreviewed/module.jsx',root),/outside current-host root/);
 assert.throws(()=>verifyLoadedInput('\0unreviewed'),/Unknown virtual/);
});

test('missing source and extra public payload cannot qualify a current-host fixture',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sage-current-host-'));
 try{
  for(const row of [...contract.files,...contract.definition]){const to=path.join(dir,row.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(root,row.path),to);}
  await verifyCurrentHost(dir);
  await fs.unlink(path.join(dir,'src/Manager.jsx'));await assert.rejects(verifyCurrentHost(dir),/ENOENT/);
  await fs.copyFile(path.join(root,'src/Manager.jsx'),path.join(dir,'src/Manager.jsx'));
  await fs.writeFile(path.join(dir,'public/unreviewed.json'),'{}');await assert.rejects(verifyCurrentHost(dir),/Public fixture inventory changed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('synthetic current host refuses any saving, credential or external-service selection',()=>{
 const allowed={calendar:'1',draft:'0',pilot:'0',url:'',key:''};assert.doesNotThrow(()=>assertFixtureSelection(allowed));
 for(const[key,value]of [['calendar','0'],['draft','1'],['pilot','1'],['url','https://example.invalid'],['key','credential']])assert.throws(()=>assertFixtureSelection({...allowed,[key]:value}),/isolated and unsaved/);
});

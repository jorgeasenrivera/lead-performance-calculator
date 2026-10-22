import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {originalC113} from '../api/_scheduler-c113.mjs';
import {createDraftOnlySchedulerServer} from '../api/_scheduler-draft-server.mjs';
const pins={
'audit-entry.mjs':'4955fe594bb3736c0525f3c9975dfd43f53b4bc14394b6ced1a9dd0cc1b06300',
'cas.mjs':'35de09c8e30a22272b61c051d45464fae5be0c076f1b30fe7fba7484d40929e6',
'deserialize.mjs':'2d7a0c11148bbb90317805f750e792e5ae427a8eeafe4a26ba0ce985c1126ac8',
'envelope.mjs':'c7df30414b4a37190c5bbf1e160cee877eefffb4fc54cdba4a4ea10c09a141e9',
'identity.mjs':'2c5839019f28c8675d8f8e23e8d8eca5f0d72fcf41c40fa5e6a49a56b0accd1e',
'publish-plan.mjs':'fbe774b576f3661c8b5db56d5be46a71a4929e4816827bc9fdad49e98695a0ba',
'serialize.mjs':'5867e828fedf730c79b62d218af8ca8da3c3827f28e9b109cb142c3d04a55905',
'validate.mjs':'bbdc8c822079691649c7cf5a7bfb364b2ab82ea85e3d8ce34827be1e6170e7ad'};
test('runtime C113 import graph uses exact reviewed original bytes',()=>{for(const [name,pin] of Object.entries(pins)){const bytes=fs.readFileSync(new URL('../scripts/scheduler-performance/persistence/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),pin,name);}assert.equal(typeof originalC113.deserializeVersion,'function');});
test('explicit server composition defaults to pinned real codec without connecting',async()=>{
 let connects=0;class Pool{on(){}async end(){}async connect(){connects++;throw Error('must not connect');}}
 const server=createDraftOnlySchedulerServer({enabled:true,env:{SCHEDULER_DATABASE_URL:'postgresql://scheduler_runtime.dydfevdnpppvxgdptiwv:synthetic@synthetic.pooler.supabase.com:6543/postgres'},identityDb:{auth:{getUser(){}},from(){}},Pool});
 assert.equal(typeof server.handler,'function');assert.equal(connects,0);await server.close();
});

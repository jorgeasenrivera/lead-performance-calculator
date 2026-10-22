import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicationV2} from '../../api/_scheduler-publication-v2.mjs';
const scope={storeId:'pilot-a',month:'2026-10'},id='00000000-0000-4000-8000-000000000002';
const make=(data,over={})=>createPublicationV2({enabled:true,identity:{verifyToken:async()=>({id})},capturedContextFor:async()=>null,transport:{capabilities:{'scheduler-publication/2':true},rpc:async()=>({data,error:null})},...over});
test('disabled default never reaches dependency callbacks',()=>assert.throws(()=>createPublicationV2(),{code:'storage-not-configured'}));
test('own-reader accepts only narrow versioned payload',async()=>{const data={version:'scheduler-own/2',revision:0,days:[]};assert.deepEqual(await make(data).own('fake',scope),data);for(const invalid of [{...data,draft:'secret'}, {...data,days:[{date:'2026-10-05',status:'off',intervals:[[540,1020]],timezone:'America/New_York'}]}, {...data,days:[{date:'2026-11-01',status:'off',intervals:[],timezone:'America/New_York'}]}])await assert.rejects(make(invalid).own('fake',scope),{code:'storage-unavailable'});});
test('identity and transport exceptions produce fixed errors',async()=>{await assert.rejects(make(null,{identity:{verifyToken:async()=>{throw Error('private synthetic marker');}}}).own('fake',scope),{message:'storage-unavailable'});await assert.rejects(make(null,{transport:{capabilities:{'scheduler-publication/2':true},rpc:async()=>{throw Error('private synthetic marker');}}}).own('fake',scope),{message:'storage-unavailable'});});
test('request cannot select another employee or draft',async()=>{for(const extra of [{personId:'b'},{kind:'draft'},{actorId:id}])await assert.rejects(make(null).own('fake',{...scope,...extra}),{code:'invalid-request'});});

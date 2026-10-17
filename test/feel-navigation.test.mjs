import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchFeelReloads} from '../scripts/feel-navigation.mjs';
const request=()=>({url:()=> 'http://127.0.0.1:5433/rest/v1/floor_public?select=updated_at'});
const advance=async(t,ms)=>{t.mock.timers.tick(ms);await Promise.resolve();};
test('reload waits for delayed mock completion and a fresh quiet window',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const page=new EventEmitter(),settle=watchFeelReloads(page,{quietMs:10,timeoutMs:100}),r=request();let done=false;
 const pending=settle().then(()=>{done=true;});page.emit('request',r);await advance(t,10);assert.equal(done,false);page.emit('requestfinished',r);await advance(t,5);assert.equal(done,false);await advance(t,5);await pending;assert.equal(done,true);
});
test('a new mock request resets the quiet window and failed requests remain reported',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const page=new EventEmitter(),settle=watchFeelReloads(page,{quietMs:10,timeoutMs:100}),r=request(),errors=[];page.on('pageerror',e=>errors.push(e));let done=false;
 const pending=settle().then(()=>{done=true;});await advance(t,5);page.emit('request',r);page.emit('pageerror','fixture failure');page.emit('requestfailed',r);await advance(t,5);assert.equal(done,false);await advance(t,10);await pending;assert.deepEqual(errors,['fixture failure']);
});
test('a mock request that never finishes blocks reload with a bounded failure',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout']});const page=new EventEmitter(),settle=watchFeelReloads(page,{quietMs:10,timeoutMs:30});page.emit('request',request());const rejected=assert.rejects(settle(),/did not settle/);
 for(let i=0;i<3;i++)await advance(t,10);await rejected;
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomProjection} from '../api/_room-projection.mjs';
test('own room projection preserves shared coordination and excludes peers private records',()=>{
 const row={store:'alpha',date:'2026-10-24',token:'private-token',presence:{events:[{kind:'offday'}]},off:{self:['2026-10-24']},roster:[{id:'self',name:'Synthetic',off:['secret']}],line:[{id:'self',status:'waiting',nudgedAt:'now'},{id:'peer',status:'waiting',nudgedAt:'private'}],history:[{id:'self',action:'signed-in'},{id:'peer',action:'private'}],assists:[{id:'a',byId:'self',note:'own'},{id:'b',byId:'peer',note:'peer'}],goalNotes:[{id:'self',text:'own'},{id:'peer',text:'peer'}],stations:{1:{id:'peer',seen:'now',off:'secret'}}};
 const out=roomProjection(row,'self');assert.equal(out.token,undefined);assert.equal(out.presence,undefined);assert.equal(out.off,undefined);assert.equal(out.line[0].nudgedAt,'now');assert.equal(out.line[1].nudgedAt,undefined);assert.equal(out.history.length,1);assert.equal(out.assists.length,1);assert.equal(out.goalNotes.length,1);assert.equal(out.stations[1].seen,'now');assert.equal(out.stations[1].off,undefined);assert.equal(out.roster[0].off,undefined);
 const wall=roomProjection(row);assert.equal(wall.history.length,0);assert.equal(wall.assists.length,0);assert.equal(wall.line[0].nudgedAt,undefined);
});
test('unknown nested values in scalar fields are excluded',()=>{const out=roomProjection({store:{off:'secret'},line:[{id:'p',label:{off:'secret'}}],roster:[{id:'p',langs:['en',{off:'secret'}]}]},'p');assert.equal(out.store,undefined);assert.equal(out.line[0].label,undefined);assert.deepEqual(out.roster[0].langs,['en']);});

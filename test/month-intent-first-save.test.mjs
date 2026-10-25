import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAgainstServer} from '../api/_store-merge.mjs';

// A first save has to be told apart from a save into a row that was deleted since load.
// Provenance is explicit: only an authoritative "no row" at load permits creating the row.
const copy=v=>structuredClone(v);
const empty=()=>({roster:[],months:{},__storeId:'synthetic'});
const withMonth=()=>{const d=empty();d.months['2026-05']={stats:{person:{internetUnits:3}},imports:{},names:{}};return d;};
const loaded=()=>({__storeId:'synthetic',rev:1,roster:[],months:{'2026-05':{stats:{person:{internetUnits:1,phoneUnits:2}},imports:{},names:{}}}});
const units=d=>d.months['2026-05'].stats.person;
const save=(baseline,next,server,flag)=>mergeAgainstServer(copy(next),server,{baseline,reportedFields:[],...(flag===undefined?{}:{rowAbsentAtLoad:flag})});

test('first save: row absent at load and still absent creates it, including its month',()=>{
 const out=save(empty(),withMonth(),null,true);
 assert.equal(units(out).internetUnits,3);
});
test('row loaded as existing and absent now is refused, even when the baseline looks empty',()=>{
 assert.throws(()=>save(empty(),withMonth(),null,false),{code:'MONTH_IMPORT_CONFLICT'});
 assert.throws(()=>save(empty(),withMonth(),null),{code:'MONTH_IMPORT_CONFLICT'});
 const n=copy(loaded());units(n).phoneUnits=9;
 assert.throws(()=>save(loaded(),n,null,false),{code:'MONTH_IMPORT_CONFLICT'});
});
test('provenance is strict: anything but true is treated as unknown and refused',()=>{
 for(const flag of [undefined,false,0,1,'true','yes',null,{}]) assert.throws(()=>save(empty(),withMonth(),null,flag),{code:'MONTH_IMPORT_CONFLICT'},String(flag));
});
test('absent at load, created concurrently: independent fields merge, same-field disagreement refuses',()=>{
 const next=withMonth(),server=empty();server.rev=1;server.months['2026-05']={stats:{person:{phoneUnits:4}},imports:{},names:{}};
 const out=save(empty(),next,server,true);
 assert.equal(units(out).internetUnits,3);assert.equal(units(out).phoneUnits,4);
 server.months['2026-05'].stats.person.internetUnits=8;
 assert.throws(()=>save(empty(),next,server,true),{code:'MONTH_IMPORT_CONFLICT'});
});
test('the mark never lets a save overwrite a row that exists: it only applies when there is no row',()=>{
 const n=copy(loaded());units(n).phoneUnits=9;const s=copy(loaded());units(s).phoneUnits=4;
 assert.throws(()=>save(loaded(),n,s,true),{code:'MONTH_IMPORT_CONFLICT'});
});
test('no baseline at all and no row still creates, as before',()=>{
 assert.equal(units(save(null,withMonth(),null)).internetUnits,3);
});

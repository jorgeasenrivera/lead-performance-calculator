import test from 'node:test';import assert from 'node:assert/strict';import {quickRosterGroups,verifiedLow,calendarWarning} from './mobile-roster.mjs';
const people=['a','b','c','d'].map(id=>({id,name:id.toUpperCase()}));
test('quick view groups once, teams first, and shared members never duplicate',()=>{const summary={on:['a','b','c'],off:['d'],unavailable:['d'],unknown:[],conflicting:[],teams:[{name:'One',ids:['a','b']},{name:'Two',ids:['b']} ]};const g=quickRosterGroups(people,summary,{on:['a','b','c'],off:['d']});assert.deepEqual(g[0].items.map(x=>x.id),['a','b','c']);assert.deepEqual(g[1].items.map(x=>x.id),['d']);assert.equal(g[0].items[2].team,null);});
test('individual display has no artificial team label and unknown/conflict never become off',()=>{const g=quickRosterGroups(people,{on:['a'],off:['b'],unavailable:[],unknown:['c'],conflicting:['d'],teams:[]},{on:['a','d','missing'],off:['b']});assert.ok(g.every(g=>g.items.every(x=>x.team===null)));assert.deepEqual(g[1].items.map(x=>x.id),['b']);assert.deepEqual(g[2].items.map(x=>x.id),['d','c','missing']);});
test('only fully confirmed, conflict-free coverage below the existing minimum gets a quick warning',()=>{const row={state:'open',record:{on:[],off:['a']},minimumCoverage:0,required:2},summary={unknown:[],conflicting:[]};assert.equal(verifiedLow(row,summary),true);assert.equal(verifiedLow({...row,record:null},summary),false);assert.equal(verifiedLow(row,{...summary,unknown:['a']}),false);assert.equal(verifiedLow(row,{...summary,conflicting:['a']}),false);assert.equal(verifiedLow({...row,minimumCoverage:2},summary),false);assert.equal(verifiedLow({...row,state:'closed'},summary),false);});
test('an invalid entered person cannot produce a verified low-staff warning',()=>{assert.equal(verifiedLow({state:'open',record:{on:['unknown-id']},minimumCoverage:0,required:2,conflicts:{'unknown-id':['Unknown person']}},{unknown:[],conflicting:[]}),false);});

test('calendar warning priority keeps conflicts and incomplete coverage distinct from confirmed low staffing',()=>{
 const row={state:'open',record:{on:[],off:['a']},minimumCoverage:0,required:2},summary={status:'Low staff',unknown:[],conflicting:[]};
 assert.deepEqual(calendarWarning(row,summary),{kind:'low',label:'Low staff'});
 assert.deepEqual(calendarWarning(row,{...summary,unknown:['a']}),{kind:'needs',label:'Coverage unconfirmed'});
 assert.deepEqual(calendarWarning({...row,state:'closed',conflicts:{a:['Closed']}},summary),{kind:'needs',label:'Schedule conflict'});
 assert.deepEqual(calendarWarning(row,{...summary,status:'Needs schedule'}),{kind:'needs',label:'Needs schedule'});
 for(const status of ['Closed','Hours unknown','Scheduled']) assert.equal(calendarWarning({...row,state:'closed'},{...summary,status}),null);
});

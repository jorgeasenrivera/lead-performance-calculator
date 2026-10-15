import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentSummary, fixtureAssignments, teamsFor } from './assignment-view.mjs';
const people = Array.from({length:6},(_,i)=>({id:`p${i}`,start:9,end:17}));
const row = { state:'open',eligibleIds:people.map(p=>p.id),rule:{open:9,close:17,minimum:2} };
test('mixed counts deduplicate members and retain unknown people',()=>{
 const s=assignmentSummary(people,teamsFor(people,'mixed'),{on:['p0','p0','p1','p4'],off:['p2','p3']},row);
 assert.deepEqual(s.on,['p0','p1','p4']);
 assert.deepEqual(s.additional,{on:1,off:0,unknown:1,conflicts:0});
 assert.deepEqual(s.teams.map(t=>t.state),['On','Off']);
 assert.equal(s.status,'Scheduled');
});
test('incomplete teams are partly on and unknown is never off',()=>{
 const s=assignmentSummary(people,teamsFor(people,'team'),{on:['p0'],off:[]},row);
 assert.deepEqual(s.teams.map(t=>t.state),['Partly on','Unknown']);
 assert.equal(s.off.length,0);assert.equal(s.unknown.length,5);assert.equal(s.status,'Low staff');
});
test('unscheduled, empty saved schedule, unknown hours and closure are distinct',()=>{
 assert.equal(assignmentSummary(people,[],null,row).status,'Needs schedule');
 assert.equal(assignmentSummary(people,[],{on:[],off:[]},row).status,'Low staff');
 assert.equal(assignmentSummary(people,[],null,{...row,state:'closed'}).status,'Closed');
 assert.equal(assignmentSummary(people,[],null,{...row,state:'unknown'}).status,'Hours unknown');
 assert.equal(fixtureAssignments('2026-11-01'),null);
});
test('a partial full-day shift does not meet minimum throughout store hours',()=>{
 assert.equal(assignmentSummary([{id:'p0',start:12,end:17}],[],{on:['p0']},{state:'open',rule:{open:9,close:17,minimum:1}}).status,'Low staff');
});
test('overlapping teams do not double-count unique people or additional individuals',()=>{
 const s=assignmentSummary(people,[{name:'A',ids:['p0','p1']},{name:'B',ids:['p1','p2']}],{on:['p0','p1','p2','p4','p4'],off:['p3']},row);
 assert.equal(s.on.length,4);assert.equal(s.covering,4);assert.deepEqual(s.additional,{on:1,off:1,unknown:1,conflicts:0});
});

test('missing evaluated eligibility cannot claim safe coverage',()=>{
 const s=assignmentSummary(people,[],{on:['p0','p1']},{state:'open',rule:row.rule});
 assert.equal(s.covering,0);assert.equal(s.status,'Low staff');assert.equal(s.conflicting.length,2);
});
test('an incomplete team is not a made-up store coverage minimum',()=>{
 const s=assignmentSummary(people,teamsFor(people,'team'),{on:['p0','p1'],off:[]},{...row,issues:[]});
 assert.equal(s.teams[0].state,'Partly on');assert.equal(s.covering,2);assert.equal(s.status,'Scheduled');
});
for (const count of [0,1,3,4]) test(`additional names preserve unique states and exclude teams (${count} people)`,()=>{
 const named=people.map((p,i)=>({...p,name:`Person ${i}`}));named.push(named[4]);
 const s=assignmentSummary(named,[{name:'A',ids:people.slice(0,6-count).map(p=>p.id)},{name:'Overlap',ids:['p0']}],{on:['p0','p1','p2','p4','p4'],off:['p3']},{...row,eligibleIds:['p0','p1','p4']});
 assert.equal(s.additionalPeople.length,count);assert.equal(new Set(s.additionalPeople.map(p=>p.id)).size,count);
 assert.deepEqual(s.additionalPeople.map(p=>p.state),['Conflict','Off','On','Unknown'].slice(4-count));
 assert.ok(s.additionalPeople.every(p=>p.name===`Person ${p.id.slice(1)}`));
});

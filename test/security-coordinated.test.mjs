import { selfRoomCommand } from '../api/_self-room-command.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicBoard, publicDay, publicDirectory } from '../api/_public-projections.mjs';
import { reviewedSchedule, ownSchedule, watchOwnSchedule } from '../src/private-schedule.mjs';
import { mayManageAccounts, staffMayUse } from '../api/_floor-access.mjs';
const identity = { store:'alpha',month:'2026-10',person:'p1' };
const result = {state:'published',store:'alpha',month:'2026-10',subject:'p1',revision:1,people:{p1:{offDates:[]}}};
test('pending linked participation is not approved management',()=>{
 const p={active:true,pending:true,role:'manager',stores:['alpha']};
 assert.equal(staffMayUse({profile:p,linkedStores:['alpha']},'alpha'),true);
 assert.equal(mayManageAccounts(p,'alpha'),false);
 for(const p of [{active:true,pending:false,role:'manager',stores:[]},{active:true,pending:false,role:'overseer',stores:['alpha']},{active:false,pending:false,role:'admin',stores:[]}]) assert.equal(mayManageAccounts(p,'alpha'),false);
 assert.equal(mayManageAccounts({active:true,pending:false,role:'manager',stores:['alpha']},'alpha'),true);
});
test('public board removes root and nested private fields while retaining display data',()=>{
 const b=publicBoard({storeId:'alpha',icon:null,off:{p1:['2026-10-03']},unknown:'private',brand:{primary:'#123456',off:['x']},boardDisplay:{style:'dark',tscale:1,off:['x']},thresholds:{apptVideoDayPct:{green:75,yellow:50,off:1}},people:[{id:'p1',name:'Synthetic',roleId:'sales',off:['x']}],months:{'2026-10':{stats:{synthetic:{internetUnits:.5,prevPct:{internet:30,off:7},off:['x']}}}},goals:{synthetic:10,private:{off:1}}});
 assert.equal(b.icon,null);assert.equal(b.months['2026-10'].stats.synthetic.internetUnits,.5);
 assert.deepEqual(b.thresholds.apptVideoDayPct,{green:75,yellow:50});
 assert.deepEqual(b.goals,{synthetic:10});assert.equal(JSON.stringify(b).includes('"off"'),false);assert.equal('unknown' in b,false);
});
test('public day normalizes historic nested hour and MTD buckets',()=>{
 const d=publicDay(JSON.parse('{"synthetic":{"calls":4,"mtd":{"iu":0.5,"off":[1]},"off":[1]},"__hours":{"00":{"synthetic":{"op":1,"off":[1]}},"bad":{"off":[1]}},"__proto__":{"calls":3}}'));
 assert.equal(Object.getPrototypeOf(d),null);assert.equal(d.synthetic.mtd.iu,.5);assert.deepEqual(d.__hours,{'00':{synthetic:{op:1}}});assert.equal(JSON.stringify(d).includes('"off"'),false);
});
test('public directory keeps the special global key payload independent of store parsing',()=>assert.deepEqual(publicDirectory({stores:[{id:'alpha',name:'Alpha',off:[1]}],registrationOpen:true,off:[1]}),{stores:[{id:'alpha',name:'Alpha'}],approvedDomains:[],registrationOpen:true}));
test('reviewed schedule preserves explicit zero off days and canonicalizes dates',()=>assert.deepEqual(reviewedSchedule({roster:[{id:'p1'},{id:'p2'}],daysOff:{p1:['2026-10-20','2026-10-01','2026-10-20']}},'2026-10'),{p1:{offDates:['2026-10-01','2026-10-20']},p2:{offDates:[]}}));
test('own reader rejects foreign subject, store and extra people',()=>{
 assert.deepEqual(ownSchedule(result,identity),{state:'published',offDates:[],revision:1});
 for(const patch of [{subject:null},{subject:'p2'},{store:'bravo'},{month:'2026-11'},{people:{p1:{offDates:[]},p2:{offDates:[]}}}]) assert.equal(ownSchedule({...result,...patch},identity).state,'unavailable');
 assert.equal(ownSchedule({...result,state:'unpublished'},identity).offDates,null);
});
test('unmount invalidates pending private response',async()=>{
 let resolve;const events=[];
 const stop=watchOwnSchedule({read:()=>new Promise(r=>resolve=r),identity,emit:r=>events.push(r),interval:999999,visibility:null});
 stop();resolve({data:result});await new Promise(r=>setImmediate(r));
 assert.deepEqual(events,[{state:'loading',offDates:null}]);
});
test('authorization refusal clears private schedule instead of serving prior data',async()=>{
 const events=[];const stop=watchOwnSchedule({read:async()=>({error:{code:'42501'}}),identity,emit:r=>events.push(r),interval:999999,visibility:null});
 await new Promise(r=>setImmediate(r));stop();assert.equal(events.at(-1).state,'forbidden');assert.equal(events.at(-1).offDates,null);
});

test('phone-line generic status preserves seated-person refusal',()=>{
 const row={roster:[{id:'p1',name:'Synthetic'}],line:[{id:'p1',status:'waiting'}],stations:{'1':{id:'p1',label:'Synthetic',at:'2026-10-24T10:00:00Z'}},history:[]};
 const args={room:'line',row,personId:'p1',action:'status',input:{status:'lunch'},now:'2026-10-24T10:01:00Z',store:'alpha',config:{stores:[{id:'alpha'}]}};
 assert.equal(selfRoomCommand(args).changed,false);
 assert.equal(selfRoomCommand({...args,row:{...row,stations:{}}}).row.line[0].status,'lunch');
});

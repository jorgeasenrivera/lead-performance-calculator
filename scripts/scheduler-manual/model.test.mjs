import test from 'node:test';
import assert from 'node:assert/strict';
import {addManualShift,removeManualShift,markManualOff} from '../../src/scheduler-manual-model.mjs';
import {MANUAL_SCHEDULER_ENABLED} from '../../src/scheduler-manual-client.mjs';
import handler from '../../api/scheduler-manual.mjs';
const draft=()=>({storeId:'pilot-a',month:'2026-10',store:{timezone:'America/New_York',people:[{id:'a',name:'Fake',start:9,end:17,off:[],maxHours:40}],rules:[],teams:[],memberships:[]},overrides:{}});
const shift={day:'2026-10-05',personId:'a',start:'09:00',end:'12:00'};
test('manual shift times are explicit; splits preserved; invalid intervals rejected',()=>{const d=draft(),first=addManualShift(d,shift),second=addManualShift(first,{...shift,start:'13:00',end:'17:00'});assert.equal(d.overrides['2026-10-05'],undefined);assert.equal(second.overrides[shift.day].shifts.length,2);assert.equal(removeManualShift(second,shift.day,0).overrides[shift.day].shifts[0].startMinute,780);for(const end of ['08:00','09:00','24:00'])assert.throws(()=>addManualShift(d,{...shift,end}));assert.throws(()=>addManualShift(d,{...shift,day:'2026-11-01'}));});
test('recorded vacation needs explicit replacement and off does not silently remove shifts',()=>{let d=markManualOff(draft(),shift.day,'a');d.overrides[shift.day].absences.a.kind='vacation';assert.throws(()=>addManualShift(d,shift));d=addManualShift(d,{...shift,replaceAbsence:true});assert.equal(d.overrides[shift.day].absences.a,undefined);assert.throws(()=>markManualOff(d,shift.day,'a'));});
test('application switch and public endpoint remain disabled',async()=>{assert.equal(MANUAL_SCHEDULER_ENABLED,false);const res={setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await handler({},res);assert.equal(res.statusCode,503);});

test('explicit configured role is retained without approving an account or granting a role',()=>{const d=addManualShift(draft(),{...shift,role:'sales'});assert.equal(d.overrides[shift.day].shifts[0].role,'sales');assert.throws(()=>addManualShift(draft(),{...shift,role:'x'.repeat(41)}));assert.throws(()=>markManualOff(draft(),'2026-11-01','a'));assert.throws(()=>markManualOff(draft(),shift.day,'other'));});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterHours } from './roster-hours.mjs';
const store={id:'fictional',timezone:'America/New_York'},day='2026-11-07';
const shift=(startMinute,endMinute,extra={})=>({storeId:'fictional',personId:'a',date:day,endDate:day,timezone:'America/New_York',startMinute,endMinute,...extra});
test('shows verified split intervals in 12-hour order without mutating input',()=>{const record={shifts:[shift(780,1020),shift(540,720)]},before=JSON.stringify(record);assert.equal(rosterHours(record,'a','On',store,day),'On · 9:00 AM–12:00 PM, 1:00 PM–5:00 PM');assert.equal(JSON.stringify(record),before);});
test('unknown, absent and invalid hours never become scheduled hours',()=>{assert.equal(rosterHours({shifts:[]},'a','On',store,day),'On · hours not specified');assert.equal(rosterHours({shifts:[shift(540,1020,{timezone:'UTC'})]},'a','On',store,day),'On · hours unverified');assert.equal(rosterHours({shifts:[shift(540,1020)]},'a','Off',store,day),'Off');});
test('a partial invalid split retains valid times and marks the remaining hours unverified',()=>{assert.equal(rosterHours({shifts:[shift(540,720),shift(780,1020,{timezone:'UTC'})]},'a','Conflict',store,day),'Conflict · 9:00 AM–12:00 PM · some hours unverified');});

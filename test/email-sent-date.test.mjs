import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEmailSentDate,activityDateConflict} from '../api/_email-sent-date.mjs';
const now=Date.parse('2026-12-01T00:00:00Z');
const parse=value=>parseEmailSentDate([{key:'date',value}],now);
test('sender instant maps to Eastern day across midnight and daylight-saving transitions',()=>{
 for(const [value,day] of [
  ['Sun, 08 Mar 2026 04:59:59 +0000','2026-03-07'],['Sun, 08 Mar 2026 05:00:00 +0000','2026-03-08'],
  ['Sun, 08 Mar 2026 01:59:59 -0500','2026-03-08'],['Sun, 08 Mar 2026 03:00:00 -0400','2026-03-08'],
  ['Sun, 01 Nov 2026 01:30:00 -0400','2026-11-01'],['Sun, 01 Nov 2026 01:30:00 -0500','2026-11-01'],
  ['Mon, 02 Nov 2026 04:59:59 +0000','2026-11-01'],['Mon, 02 Nov 2026 05:00:00 +0000','2026-11-02'],
 ]) assert.equal(parse(value).day,day,value);
});
test('missing, duplicate, conflicting, malformed and future Date headers are refused',()=>{
 assert.equal(parseEmailSentDate([],now).ok,false);
 const v='Sun, 01 Nov 2026 01:30:00 -0400';
 assert.equal(parseEmailSentDate([{key:'date',value:v},{key:'DATE',value:v}],now).reason,'duplicate Date headers');
 assert.equal(parseEmailSentDate([{key:'date',value:v},{key:'date',value:'Sun, 01 Nov 2026 01:30:00 -0500'}],now).ok,false);
 for(const value of ['Sun, 01 Nov 2026 01:30:00','Sun, 32 Nov 2026 01:30:00 -0400','Mon, 01 Nov 2026 01:30:00 -0400','Sun, 01 Nov 2026 25:30:00 -0400','Sun, 01 Nov 2026 01:30:00 -0460','Sun, 01 Nov 2026 01:30:60 -0400','Sun, 01 Nov 2026 01:30:00 EST','Sun, 01 Nov 2026 01:30:00 -0400 extra','Fri, 01 Jan 2027 00:00:00 +0000']) assert.equal(parse(value).ok,false,value);
});
test('delayed processing and repeated parsing keep the sender day and instant',()=>{
 const headers=[{key:'date',value:'Mon, 02 Nov 2026 04:59:59 +0000'}];
 const a=parseEmailSentDate(headers,Date.parse('2026-11-02T06:00:00Z'));
 const b=parseEmailSentDate(headers,Date.parse('2026-11-05T06:00:00Z'));
 assert.deepEqual(a,b);assert.equal(a.day,'2026-11-01');assert.equal(a.sentAt,'2026-11-02T04:59:59.000Z');
});
test('date-shaped filename or subject conflicts are reported, never substituted',()=>{
 assert.equal(activityDateConflict('2026-11-01','activity-2026-11-01.csv','Daily Activity'),false);
 assert.equal(activityDateConflict('2026-11-01','activity-2026-11-02.csv','Daily Activity'),true);
 assert.equal(activityDateConflict('2026-11-01','activity.csv','Report 11-02-2026'),true);
 assert.equal(activityDateConflict('2026-11-01','activity-2026-11-99.csv'),true);
 assert.equal(activityDateConflict('2026-11-01','activity.csv','Daily Activity'),false);
});

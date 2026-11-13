import test from 'node:test';
import assert from 'node:assert/strict';
import {displayDate,displayMonth,displayPeriod} from './date-display.mjs';
test('formats valid US display dates across leap and year boundaries without changing source strings',()=>{
 const dates=['2024-02-29','2026-12-31','2027-01-01'];
 assert.deepEqual(dates.map(displayDate),['02/29/2024','12/31/2026','01/01/2027']);
 assert.deepEqual(dates,['2024-02-29','2026-12-31','2027-01-01']);
 assert.equal(displayPeriod('2026-12-31 to 2027-01-01'),'12/31/2026 to 01/01/2027');
 assert.equal(displayMonth('2026-11'),'11/2026');
});
test('leaves malformed and unknown source values unchanged',()=>{
 assert.equal(displayDate('2026-02-29'),'2026-02-29');
 assert.equal(displayDate('Unknown'),'Unknown');
 assert.equal(displayMonth('2026-13'),'2026-13');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deliveryRoutes} from './delivery-routing.mjs';
const source=readFileSync(new URL('../../src/Manager.jsx',import.meta.url),'utf8');
const phone=s=>s.slice(s.indexOf('function BoardRoomPhone('),s.indexOf('function StoreHero('));
test('preview consolidates daily surfaces while preserving monthly values and pace context verbatim',()=>{
 const transformed=deliveryRoutes(source),p=phone(transformed),original=phone(source);
 const context=original.slice(original.indexOf('        <div className="bp-ask">'),original.indexOf('        {canSetGoal && (',original.indexOf('        <div className="bp-ask">')));
 assert.ok(p.includes(context));assert.doesNotMatch(p,/Sold by day|className="bp-swg"|data-daily-unavailable="phone-best-day"/);
 for(const cls of ['bp-l1','bp-l2'])assert.ok(p.includes('className="'+cls+'"'));
 assert.equal((p.match(/data-delivered-route onClick={openDelivered}/g)||[]).length,2);
 assert.ok(p.includes('saved.k===\'month\'?\'Month summary\''));
 assert.equal(transformed.slice(0,transformed.indexOf('function BoardRoomPhone(')),source.slice(0,source.indexOf('function BoardRoomPhone(')));
 assert.equal(transformed.slice(transformed.indexOf('function StoreHero(')),source.slice(source.indexOf('function StoreHero(')));
});
test('route transform refuses drift instead of silently retaining duplicate day detail',()=>{
 assert.throws(()=>deliveryRoutes(source.replace('data-daily-unavailable="phone-calendar"','data-changed="phone-calendar"')),/boundary/);
 assert.throws(()=>deliveryRoutes(source.replace('>Sold by day</button>','>Changed</button>')),/boundary/);
});

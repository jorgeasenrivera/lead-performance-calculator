import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../src/leaderboard-template.mjs', import.meta.url), 'utf8');
function block(begin, end) {
  const a = src.indexOf(begin), b = src.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return src.slice(a, b);
}

test('Eastern month follows daylight saving and not the device timezone', () => {
  const code = block('  function easternMonth(){', '  function render(store){');
  for (const [at, expected] of [['2026-03-01T04:59:59Z', '2026-02'], ['2026-03-01T05:00:00Z', '2026-03'], ['2026-07-01T03:59:59Z', '2026-06'], ['2026-07-01T04:00:00Z', '2026-07']]) {
    const clock = class extends Date { constructor() { super(at); } };
    assert.equal(vm.runInNewContext(code + '\neasternMonth()', { Intl, Date: clock }), expected);
  }
});

test('older overlapping poll cannot replace a newer poll or a store handover', async () => {
  const code = block('  var requestEpoch = 0,', '  /* ---------- rotating through more than one store');
  const pending = [], rendered = [];
  const ctx = { CFG: { storeKey: 'a' }, HANDING: false, SWITCHING: false, LAST: { version: 0 },
    getStore: () => new Promise(resolve => pending.push(resolve)), tooDifferent: () => false,
    newlySold: () => [], document: { getElementById: () => ({ classList: { add(){}, remove(){} } }) },
    renderStore(row) { rendered.push(row.version); ctx.LAST = row; }, congratulate() {} };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const a = ctx.loop(), b = ctx.loop();
  pending[1]({version: 2}); await b;
  pending[0]({version: 1}); await a;
  assert.deepEqual(rendered, [2]);
  const c = ctx.loop(); ctx.CFG.storeKey = 'b';
  pending[2]({version: 3}); await c;
  assert.deepEqual(rendered, [2]);
  ctx.HANDING = true; await ctx.loop(); assert.equal(pending.length, 3);
});

test('a missing current month does not render invented zero sales', () => {
  const code = block('  function render(store){', '    // CFG.roles already excludes');
  const root = { innerHTML: '' };
  const ctx = { document: { getElementById: () => root }, easternMonth: () => '2026-07', CAR_ROW: 1 };
  vm.createContext(ctx); vm.runInContext(code + '\n}', ctx);
  ctx.render({ months: { '2026-06': { stats: {} } } });
  assert.match(root.innerHTML, /No data yet/);
  assert.doesNotMatch(root.innerHTML, /total-num|Units Delivered/);
});

function publisherRow(units, ym = '2026-07', storeId = 'demo') {
  return {storeId,ym,roster:[{id:'a',name:'Alex Jones',roleId:'sales'}],months:{[ym]:{stats:{'alex jones':{internetUnits:units}}}}};
}
test('large-drop check accepts publisher-shaped rows and ignores month or store changes',()=>{
 const code=block('  function tooDifferent(prev, next){','  // Who sold since the last good refresh');
 const ctx={norm:s=>s.trim().toLowerCase().replace(/\s+/g,' ')};vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.equal(ctx.tooDifferent(publisherRow(20),publisherRow(0)),true);
 assert.equal(ctx.tooDifferent(publisherRow(20),publisherRow(10)),false);
 assert.equal(ctx.tooDifferent(publisherRow(20),publisherRow(0,'2026-08')),false);
 assert.equal(ctx.tooDifferent(publisherRow(20),publisherRow(0,'2026-07','other')),false);
});

test('large correction is held once and accepted when the same current-store figures repeat',async()=>{
 const loop=block('  var requestEpoch = 0,','  /* ---------- rotating through more than one store');
 const check=block('  function tooDifferent(prev, next){','  // Who sold since the last good refresh');
 const rendered=[], note={textContent:'',classList:{on:false,add(){this.on=true;},remove(){this.on=false;}}};
 let row=publisherRow(0);const ctx={CFG:{storeKey:'k'},HANDING:false,SWITCHING:false,LAST:publisherRow(20),norm:s=>s.trim().toLowerCase(),getStore:async()=>row,
 newlySold:()=>[],document:{getElementById:()=>note},renderStore(s){rendered.push(s);ctx.LAST=s;},congratulate(){},Date,Intl};
 vm.createContext(ctx);vm.runInContext(check+loop,ctx);
 await ctx.loop();assert.equal(rendered.length,0);assert.equal(note.classList.on,true);assert.match(note.textContent,/large change/i);
 await ctx.loop();assert.equal(rendered.length,1);assert.equal(rendered[0].months['2026-07'].stats['alex jones'].internetUnits,0);
});

test('a failed current-store poll shows last successful check and older responses cannot clear it',async()=>{
 const loop=block('  var requestEpoch = 0,','  /* ---------- rotating through more than one store');
 const pending=[],note={textContent:'',classList:{on:false,add(){this.on=true;},remove(){this.on=false;}}};
 const ctx={CFG:{storeKey:'a'},HANDING:false,SWITCHING:false,LAST:publisherRow(3),norm:s=>s.toLowerCase(),getStore:()=>new Promise(r=>pending.push(r)),tooDifferent:()=>false,newlySold:()=>[],document:{getElementById:()=>note},renderStore(){note.classList.remove('on');},congratulate(){},Date,Intl};
 vm.createContext(ctx);vm.runInContext(loop,ctx);ctx.lastGoodKey='a';ctx.lastGoodAt=new Date('2026-07-08T12:00:00Z');
 const old=ctx.loop(), fresh=ctx.loop();pending[1]({__err:'offline'});await fresh;assert.equal(note.classList.on,true);assert.match(note.textContent,/Last successful check:.*ET/);
 pending[0](publisherRow(4));await old;assert.equal(note.classList.on,true);
 const retry=ctx.loop();pending[2](publisherRow(4));await retry;assert.equal(note.classList.on,false);
});

test('only a successful rendered row records and clears current-store staleness',()=>{
 const code=block('  function renderStore(s){','  /* ---------- display tuning ----------');
 const note={classList:{on:true,remove(){this.on=false;}}};
 const ctx={CFG:{storeKey:'demo'},SWITCHING:false,LAST:null,lastGoodKey:null,lastGoodAt:null,heldDrop:null,Date,
 document:{getElementById:()=>note},applyDisp(){},render(){},wireTuner(){}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.renderStore({__err:'offline'});assert.equal(note.classList.on,true);assert.equal(ctx.lastGoodAt,null);
 ctx.renderStore(publisherRow(2));assert.equal(note.classList.on,false);assert.equal(ctx.lastGoodKey,'demo');assert.ok(ctx.lastGoodAt instanceof Date);
});

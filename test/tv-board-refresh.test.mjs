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

test('repeated large drop remains held until data returns to the trusted range',async()=>{
 const loop=block('  var requestEpoch = 0,','  /* ---------- rotating through more than one store');
 const check=block('  function tooDifferent(prev, next){','  // Who sold since the last good refresh');
 const rendered=[], note={textContent:'',classList:{on:false,add(){this.on=true;},remove(){this.on=false;}}};
 let row=publisherRow(0);const ctx={CFG:{storeKey:'k'},HANDING:false,SWITCHING:false,LAST:publisherRow(20),norm:s=>s.trim().toLowerCase(),getStore:async()=>row,
 newlySold:()=>[],document:{getElementById:()=>note},renderStore(s){rendered.push(s);ctx.LAST=s;},congratulate(){},Date,Intl};
 vm.createContext(ctx);vm.runInContext(check+loop,ctx);ctx.displayedByStore.set('k',ctx.LAST);ctx.lastGoodKey='k';
 await ctx.loop();assert.equal(rendered.length,0);assert.equal(note.classList.on,true);assert.match(note.textContent,/large change/i);
 await ctx.loop();assert.equal(rendered.length,0);assert.equal(note.classList.on,true);
 row=publisherRow(19);await ctx.loop();assert.equal(rendered.length,1);assert.equal(rendered[0].months['2026-07'].stats['alex jones'].internetUnits,19);
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
 const note={textContent:'',classList:{on:true,add(){this.on=true;},remove(){this.on=false;}}};
 const ctx={CFG:{storeKey:'demo'},SWITCHING:false,LAST:null,lastGoodKey:null,lastGoodAt:null,displayedByStore:new Map(),lastCheckByStore:new Map(),heldByStore:new Set(),failedByStore:new Set(['demo']),Date,publicationProblem:()=>null,
 document:{getElementById:()=>note},applyDisp(){},render(){},wireTuner(){},showStatus(){}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.renderStore({__err:'offline'});assert.equal(note.classList.on,true);assert.equal(ctx.lastGoodAt,null);
 ctx.renderStore(publisherRow(2));assert.equal(ctx.failedByStore.has('demo'),false);assert.equal(ctx.lastGoodKey,'demo');assert.ok(ctx.lastGoodAt instanceof Date);
});

test('publication age is distinct from a successful network check',()=>{
 const code=block('  function publicationProblem(row, now){','  async function loop(){');
 const ctx={Date,Number};vm.createContext(ctx);vm.runInContext(code,ctx);
 const now=Date.parse('2026-07-08T12:00:00Z');
 assert.match(ctx.publicationProblem({updatedAt:'2026-07-08T11:59:00Z'},now),/Report freshness is not verified/);
 assert.match(ctx.publicationProblem({updatedAt:'2026-07-08T11:59:00Z',sourceVerified:true,sourceAsOf:'2026-07-08T11:59:00Z'},now),/Report freshness is not verified/, 'untrusted payload flags do not establish verification');
 assert.match(ctx.publicationProblem({updatedAt:'2026-07-08T09:59:00Z'},now),/Board last published:.*ET/);
 assert.match(ctx.publicationProblem({updatedAt:'2026-07-08T12:10:00Z'},now),/unavailable/);
 assert.match(ctx.publicationProblem({},now),/unavailable/);
 assert.match(ctx.publicationProblem({updatedAt:'2026-02-30T11:59:00Z'},now),/unavailable/);
 assert.match(ctx.publicationProblem({updatedAt:'2026-07-08T11:59:00'},now),/unavailable/);
});

test('successful read of an old publication keeps a stale notice visible',()=>{
 const age=block('  function publicationProblem(row, now){','  async function loop(){');
 const render=block('  function renderStore(s){','  /* ---------- display tuning ----------');
 const note={textContent:'',classList:{on:false,add(){this.on=true;},remove(){this.on=false;}}};
 const ctx={CFG:{storeKey:'demo'},SWITCHING:false,LAST:null,lastGoodKey:null,lastGoodAt:null,displayedByStore:new Map(),lastCheckByStore:new Map(),heldByStore:new Set(),failedByStore:new Set(),Date,Number,
 document:{getElementById:()=>note},applyDisp(){},render(){},wireTuner(){},showStatus(){note.textContent=ctx.currentFreshness;note.classList.add('on');}};
 vm.createContext(ctx);vm.runInContext(age+render,ctx);
 ctx.renderStore({...publisherRow(2),updatedAt:'2020-01-01T00:00:00Z'});
 assert.equal(note.classList.on,true);assert.match(note.textContent,/Board last published/);assert.equal(ctx.lastGoodKey,'demo');
 ctx.renderStore({...publisherRow(3),updatedAt:new Date().toISOString()});assert.equal(note.classList.on,true);assert.match(note.textContent,/Report freshness is not verified/);
});

test('rotation A to B to A cannot bypass A’s held large-drop baseline',async()=>{
 const check=block('  function tooDifferent(prev, next){','  // Who sold since the last good refresh');
 const next=block('  async function nextStore(){','  /* The tail of loop(), reusable:');
 const keyA='lpc:board:a:v1',keyB='lpc:board:b:v1', shown=[];
 const ctx={CFG:{storeId:'a',storeKey:keyA},HOME:{id:'a'},ROT_I:0,HANDING:false,SWITCHING:false,requestEpoch:0,storeShownAt:0,Date,
 displayedByStore:new Map([[keyA,publisherRow(20,'2026-07','a')]]),heldByStore:new Set(),failedByStore:new Set(),rotaList:()=>['a','b'],norm:s=>s.trim().toLowerCase(),
 getStoreByKey:async key=>key===keyB?publisherRow(3,'2026-07','b'):publisherRow(0,'2026-07','a'),
 driveTo(_name,swap){swap();ctx.HANDING=false;},renderStore(row){shown.push(row.storeId);ctx.displayedByStore.set(ctx.CFG.storeKey,row);},startScroll(){},showStatus(){ctx.warning='A store has a large change that needs verification.';}};
 vm.createContext(ctx);vm.runInContext(check+next,ctx);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'b');assert.deepEqual(shown,['b']);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'b');assert.deepEqual(shown,['b']);assert.match(ctx.warning,/large change/);assert.equal(ctx.displayedByStore.get(keyA).months['2026-07'].stats['alex jones'].internetUnits,20);
});

test('a successful refresh of another store does not clear a held store warning',()=>{
 const render=block('  function renderStore(s){','  /* ---------- display tuning ----------');
 const ctx={CFG:{storeKey:'b'},SWITCHING:false,LAST:null,lastGoodKey:null,lastGoodAt:null,displayedByStore:new Map(),lastCheckByStore:new Map(),heldByStore:new Set(['a']),failedByStore:new Set(),Date,
 publicationProblem:()=> 'Report freshness is not verified.', document:{getElementById:()=>({classList:{remove(){}}})},applyDisp(){},render(){},wireTuner(){},showStatus(){ctx.message=ctx.currentFreshness+(ctx.heldByStore.size?' A store has a large change that needs verification.':'');}};
 vm.createContext(ctx);vm.runInContext(render,ctx);ctx.renderStore(publisherRow(3,'2026-07','b'));
 assert.match(ctx.message,/A store has a large change/);assert.equal(ctx.heldByStore.has('a'),true);
});

test('a held B does not stall A to B to C rotation and is retried',async()=>{
 const check=block('  function tooDifferent(prev, next){','  // Who sold since the last good refresh');
 const next=block('  async function nextStore(){','  /* The tail of loop(), reusable:');
 const keys=['a','b','c'].map(x=>'lpc:board:'+x+':v1'),requests=[],shown=[];
 const ctx={CFG:{storeId:'a',storeKey:keys[0]},HOME:{id:'a'},ROT_I:0,HANDING:false,SWITCHING:false,requestEpoch:0,storeShownAt:0,Date,
 displayedByStore:new Map([[keys[0],publisherRow(20,'2026-07','a')],[keys[1],publisherRow(20,'2026-07','b')]]),heldByStore:new Set(),failedByStore:new Set(),rotaList:()=>['a','b','c'],norm:s=>s.trim().toLowerCase(),
 getStoreByKey:async key=>{requests.push(key);return key===keys[1]?publisherRow(0,'2026-07','b'):publisherRow(key===keys[0]?20:3,'2026-07',key===keys[0]?'a':'c');},
 driveTo(_name,swap){swap();ctx.HANDING=false;},renderStore(row){shown.push(row.storeId);ctx.displayedByStore.set(ctx.CFG.storeKey,row);},startScroll(){},showStatus(){}};
 vm.createContext(ctx);vm.runInContext(check+next,ctx);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'a');assert.equal(ctx.heldByStore.has(keys[1]),true);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'c');assert.deepEqual(shown,['c']);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'a');await ctx.nextStore();assert.equal(ctx.CFG.storeId,'a');
 assert.deepEqual(requests,[keys[1],keys[2],keys[0],keys[1]]);assert.equal(ctx.heldByStore.has(keys[1]),true);
});

test('status retains connection, source freshness and held-store warnings together',()=>{
 const code=block('  function showStatus(){','  // The import is scheduled hourly.');
 const note={textContent:'',classList:{add(){},remove(){}}};
 const ctx={document:{getElementById:()=>note},failedByStore:new Set(['b']),currentFreshness:'Report freshness is not verified.',heldByStore:new Set(['b']),lastGoodKey:'a',lastGoodAt:new Date('2026-07-08T12:00:00Z'),CFG:{storeKey:'a'}};
 vm.createContext(ctx);vm.runInContext(code,ctx);ctx.showStatus();
 assert.match(note.textContent,/Cannot refresh/);assert.match(note.textContent,/Report freshness is not verified/);assert.match(note.textContent,/large change/);assert.match(note.textContent,/Last successful check/);
});

test('a failure for B survives successful A and clears only when B succeeds',async()=>{
 const next=block('  async function nextStore(){','  /* The tail of loop(), reusable:');
 const render=block('  function renderStore(s){','  /* ---------- display tuning ----------');
 const keys=['a','b','c'].map(x=>'lpc:board:'+x+':v1');let bFails=true;
 const ctx={CFG:{storeId:'a',storeKey:keys[0]},HOME:{id:'a'},ROT_I:0,HANDING:false,SWITCHING:false,requestEpoch:0,storeShownAt:0,Date,
 displayedByStore:new Map(),lastCheckByStore:new Map(),heldByStore:new Set(),failedByStore:new Set(),lastGoodAt:null,lastGoodKey:null,rotaList:()=>['a','b','c'],tooDifferent:()=>false,
 getStoreByKey:async key=>key===keys[1]&&bFails?{__err:'offline'}:publisherRow(3,'2026-07',key===keys[0]?'a':key===keys[1]?'b':'c'),
 driveTo(_name,swap){swap();ctx.HANDING=false;},startScroll(){},showStatus(){},publicationProblem:()=>null,document:{getElementById:()=>null},applyDisp(){},render(){},wireTuner(){}};
 vm.createContext(ctx);vm.runInContext(next+render,ctx);
 await ctx.nextStore();assert.equal(ctx.failedByStore.has(keys[1]),true);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'c');assert.equal(ctx.failedByStore.has(keys[1]),true);
 await ctx.nextStore();assert.equal(ctx.CFG.storeId,'a');assert.equal(ctx.failedByStore.has(keys[1]),true);
 bFails=false;await ctx.nextStore();assert.equal(ctx.CFG.storeId,'b');assert.equal(ctx.failedByStore.has(keys[1]),false);
});

test('removing a store clears only its rotation issues and preserves its baseline',()=>{
 const prune=block('  function pruneRotationIssues(){','  function drawRota(rl, sibs){');
 const home='lpc:board:a:v1',b='lpc:board:b:v1',c='lpc:board:c:v1';
 const ctx={HOME:{key:home},DISP:{rotate:['c']},failedByStore:new Set([b,c]),heldByStore:new Set([b,c]),displayedByStore:new Map([[b,publisherRow(20,'2026-07','b')]]),showStatus(){}};
 vm.createContext(ctx);vm.runInContext(prune,ctx);ctx.pruneRotationIssues();
 assert.equal(ctx.failedByStore.has(b),false);assert.equal(ctx.failedByStore.has(c),true);assert.equal(ctx.heldByStore.has(b),false);assert.equal(ctx.heldByStore.has(c),true);assert.equal(ctx.displayedByStore.has(b),true);
});

test('unchecking a failed rotated store removes only its warning',()=>{
 const code=block('  function pruneRotationIssues(){','  function wireTuner(){');
 const a='lpc:board:a:v1',b='lpc:board:b:v1',c='lpc:board:c:v1',button={getAttribute:()=> 'b'};
 const rl={innerHTML:'',querySelectorAll:()=>[button]};
 const ctx={HOME:{id:'a',key:a},CFG:{storeId:'a'},lastGoodKey:a,HANDING:false,DISP:{rotate:['b','c']},failedByStore:new Set([b,c]),heldByStore:new Set([b]),requestEpoch:0,ROT_I:0,showStatus(){},wireTuner(){},loop(){}};
 vm.createContext(ctx);vm.runInContext(code,ctx);ctx.drawRota(rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);button.onclick();
 assert.deepEqual(ctx.DISP.rotate,['c']);assert.equal(ctx.failedByStore.has(b),false);assert.equal(ctx.failedByStore.has(c),true);assert.equal(ctx.heldByStore.has(b),false);
});

test('a verified empty sibling list removes stale rotation warnings',()=>{
 const code=block('  function pruneRotationIssues(){','  function wireTuner(){');
 const a='lpc:board:a:v1',b='lpc:board:b:v1',rl={innerHTML:''};
 const ctx={HOME:{id:'a',key:a},CFG:{storeId:'a'},lastGoodKey:a,HANDING:false,DISP:{rotate:['b']},failedByStore:new Set([b]),heldByStore:new Set([b]),requestEpoch:0,showStatus(){}};
 vm.createContext(ctx);vm.runInContext(code,ctx);ctx.drawRota(rl,[]);
 assert.equal(ctx.DISP.rotate.length,0);assert.equal(ctx.failedByStore.has(b),false);assert.equal(ctx.heldByStore.has(b),false);assert.match(rl.innerHTML,/only store/);
});

test('late failed response cannot restore a warning after its store is removed',async()=>{
 const next=block('  async function nextStore(){','  /* The tail of loop(), reusable:');
 const home='lpc:board:a:v1',b='lpc:board:b:v1';let resolve;
 const ctx={CFG:{storeId:'a',storeKey:home},HOME:{id:'a'},ROT_I:0,HANDING:false,requestEpoch:0,storeShownAt:0,Date,
 displayedByStore:new Map(),lastCheckByStore:new Map(),heldByStore:new Set(),failedByStore:new Set(),rotaList:()=>['a','b'],getStoreByKey:()=>new Promise(r=>{resolve=r;}),startScroll(){},showStatus(){},finishHandover(){ctx.HANDING=false;}};
 vm.createContext(ctx);vm.runInContext(next,ctx);const pending=ctx.nextStore();
 ctx.requestEpoch++;resolve({__err:'offline'});await pending;
 assert.equal(ctx.failedByStore.has(b),false);assert.equal(ctx.HANDING,false);assert.equal(ctx.CFG.storeId,'a');
});

function cancellationHarness(mode){
 const loop=block('  var requestEpoch = 0,','  /* ---------- rotating through more than one store');
 const finish=block('  function finishHandover(){','  /* The convoy.');
 const drive=block('  function driveTo(label, swap){','  async function nextStore(){');
 const next=block('  async function nextStore(){','  // Reuse only the last displayed row');
 const held=block('  function renderHeldStore(s, key){','  /* The tail of loop(), reusable:');
 const rota=block('  function pruneRotationIssues(){','  function wireTuner(){');
 const keys=['a','b','c'].map(x=>'lpc:board:'+x+':v1'),shown=[],timers=[];let resolveFetch;
 const note={textContent:'',classList:{add(){},remove(){}}},root={classList:{add(){},remove(){}}};
 const button={getAttribute:()=> 'c'},rl={innerHTML:'',querySelectorAll:()=>[button]};
 const ctx={CFG:{storeId:'b',storeKey:keys[1],storeName:'B'},HOME:{id:'a',key:keys[0],name:'A'},ROT_I:1,HANDING:false,pendingHomeRefresh:false,SWITCHING:false,storeShownAt:0,Date,Intl,
  DISP:{rotate:['b','c']},LAST:publisherRow(3,'2026-07','b'),lastGoodKey:keys[1],
  rotaList:()=>['a',...ctx.DISP.rotate],norm:s=>s.toLowerCase(),tooDifferent:()=>false,newlySold:()=>[],
  getStoreByKey:()=>mode==='fetch'?new Promise(r=>{resolveFetch=r;}):Promise.resolve(publisherRow(4,'2026-07','c')),
  getStore:async()=>publisherRow(2,'2026-07','a'),
  document:{getElementById:id=>id==='root'?root:note,createElement:()=>({remove(){}}),body:{appendChild(){}}},
  pix:()=>'',setTimeout(fn,ms){timers.push({fn,ms});},startScroll(){},wireTuner(){},tsizeMine:()=>null,applyDisp(){},congratulate(){},render(row){shown.push(row.storeId);},
  renderStore(row){shown.push(row.storeId);ctx.LAST=row;ctx.lastGoodKey=ctx.CFG.storeKey;}};
 vm.createContext(ctx);vm.runInContext(loop+finish+drive+next+held+rota,ctx);ctx.lastGoodKey=keys[1];
 return {ctx,keys,shown,timers,rl,button,resolve:row=>resolveFetch(row)};
}

test('rotation removal during a pending fetch refreshes home after cancellation',async()=>{
 const h=cancellationHarness('fetch'),p=h.ctx.nextStore();assert.equal(h.ctx.HANDING,true);
 h.ctx.drawRota(h.rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);h.button.onclick();
 assert.equal(h.ctx.CFG.storeId,'a');assert.equal(h.ctx.pendingHomeRefresh,true);assert.deepEqual(h.shown,[]);
 h.resolve(publisherRow(4,'2026-07','c'));await p;await new Promise(setImmediate);
 assert.equal(h.ctx.HANDING,false);assert.equal(h.ctx.pendingHomeRefresh,false);assert.deepEqual(h.shown,['a']);
});

test('rotation removal during active animation refreshes home when animation ends',async()=>{
 const h=cancellationHarness('animation');await h.ctx.nextStore();assert.equal(h.ctx.HANDING,true);assert.equal(h.ctx.CFG.storeId,'c');
 h.ctx.drawRota(h.rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);h.button.onclick();
 assert.equal(h.ctx.CFG.storeId,'a');assert.equal(h.ctx.pendingHomeRefresh,true);
 h.timers.find(t=>t.ms===1250).fn();assert.deepEqual(h.shown,[]);
 h.timers.find(t=>t.ms===3600).fn();await new Promise(setImmediate);
 assert.equal(h.ctx.HANDING,false);assert.equal(h.ctx.pendingHomeRefresh,false);assert.deepEqual(h.shown,['a']);
});

test('rotation removal after the animation swap still returns home at completion',async()=>{
 const h=cancellationHarness('animation');await h.ctx.nextStore();
 h.timers.find(t=>t.ms===1250).fn();assert.deepEqual(h.shown,['c']);assert.equal(h.ctx.lastGoodKey,h.keys[2]);
 h.ctx.drawRota(h.rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);h.button.onclick();
 assert.equal(h.ctx.CFG.storeId,'a');assert.equal(h.ctx.pendingHomeRefresh,true);
 h.timers.find(t=>t.ms===3600).fn();await new Promise(setImmediate);
 assert.deepEqual(h.shown,['c','a']);assert.equal(h.ctx.HANDING,false);
});

test('cancelled handover displays the last home row if the new home row is held',async()=>{
 const h=cancellationHarness('fetch'),checked=new Date('2026-07-01T12:00:00Z');
 h.ctx.displayedByStore.set(h.keys[0],publisherRow(20,'2026-07','a'));h.ctx.lastCheckByStore.set(h.keys[0],checked);
 h.ctx.tooDifferent=(prev,next)=>prev.months['2026-07'].stats['alex jones'].internetUnits===20 && next.months['2026-07'].stats['alex jones'].internetUnits===0;
 h.ctx.getStore=async()=>publisherRow(0,'2026-07','a');
 const p=h.ctx.nextStore();h.ctx.drawRota(h.rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);h.button.onclick();
 h.resolve(publisherRow(4,'2026-07','c'));await p;await new Promise(setImmediate);
 assert.deepEqual(h.shown,['a']);assert.equal(h.ctx.LAST.months['2026-07'].stats['alex jones'].internetUnits,20);
 assert.equal(h.ctx.lastGoodAt,checked);assert.equal(h.ctx.heldByStore.has(h.keys[0]),true);
});

test('cancelled handover restores cached home while its refresh is offline',async()=>{
 const h=cancellationHarness('fetch'),checked=new Date('2026-07-01T12:00:00Z');
 h.ctx.displayedByStore.set(h.keys[0],publisherRow(20,'2026-07','a'));h.ctx.lastCheckByStore.set(h.keys[0],checked);
 h.ctx.getStore=async()=>({__err:'offline'});
 const p=h.ctx.nextStore();h.ctx.drawRota(h.rl,[{id:'b',name:'B'},{id:'c',name:'C'}]);h.button.onclick();
 h.resolve(publisherRow(4,'2026-07','c'));await p;await new Promise(setImmediate);
 assert.deepEqual(h.shown,['a']);assert.equal(h.ctx.lastGoodAt,checked);assert.equal(h.ctx.failedByStore.has(h.keys[0]),true);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../src/leaderboard-template.mjs',import.meta.url),'utf8');
function block(begin,end){const a=src.indexOf(begin),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);}
test('long-running board uses current Eastern month across standard and daylight time',()=>{
 const code=block('  function easternMonth(){','  function render(store){');
 for(const [at,month] of [['2026-03-01T04:59:59Z','2026-02'],['2026-03-01T05:00:00Z','2026-03'],['2026-07-01T03:59:59Z','2026-06'],['2026-07-01T04:00:00Z','2026-07']]){
  const Clock=class extends Date{constructor(){super(at);}};
  assert.equal(vm.runInNewContext(code+'\neasternMonth()', {Intl,Date:Clock}),month);
 }
});
test('missing current month does not display invented zero sales',()=>{
 const code=block('  function render(store){','    // CFG.roles already excludes'),root={innerHTML:''};
 const ctx={document:{getElementById:()=>root},easternMonth:()=> '2026-07',CAR_ROW:0};
 vm.createContext(ctx);vm.runInContext(code+'\n}',ctx);ctx.render({months:{'2026-06':{stats:{}}}});
 assert.match(root.innerHTML,/No data yet/);assert.doesNotMatch(root.innerHTML,/total-num|Units Delivered/);
});
test('an open board redraws at Eastern rollover on its existing clock without fetching',()=>{
 const code=block('  var LAST = null;','  // Data is pulled every 15 minutes.');
 let month='2026-06',ticks=0,fetches=0;const rendered=[];
 const ctx={easternMonth:()=>month,HANDING:false,tick(){ticks++;},render(row){rendered.push([month,row]);},getStore(){fetches++;}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const row={months:{'2026-06':{stats:{}}}};ctx.LAST=row;
 ctx.clockTick();assert.equal(rendered.length,0);
 month='2026-07';ctx.HANDING=true;ctx.clockTick();assert.equal(rendered.length,0);
 ctx.HANDING=false;ctx.clockTick();assert.equal(rendered.length,1);assert.equal(rendered[0][0],'2026-07');assert.equal(rendered[0][1],row);
 ctx.clockTick();assert.equal(rendered.length,1);assert.equal(fetches,0);assert.equal(ticks,4);
});
test('a stalled board response body times out and a later request can succeed',async()=>{
 const code=block('  function withTimeout(promise, ms){','  // keep the session alive');let calls=0;
 const ctx={setTimeout:fn=>setTimeout(fn,5),DB:{url:'https://example.invalid',anonKey:'fixture'},TOK:null,CFG:{storeKey:'fictional'},fetch:async()=>({ok:true,status:200,json:()=>++calls===1?new Promise(()=>{}):Promise.resolve([{value:{version:2}}])})};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.match((await ctx.getStore()).__err,/Retrying/);assert.equal((await ctx.getStore()).version,2);
});
test('a stalled token response body times out without replacing credentials',async()=>{
 const code=block('  function withTimeout(promise, ms){','  // keep the session alive');
 const ctx={setTimeout:fn=>setTimeout(fn,5),DB:{url:'https://example.invalid',anonKey:'fixture'},TOK:{access:'old',refresh:'old-refresh'},CFG:{tokens:{url:'https://example.invalid',anonKey:'fixture'}},fetch:async()=>({ok:true,json:()=>new Promise(()=>{})})};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 assert.equal(await ctx.refreshToken(),false);assert.equal(ctx.TOK.access,'old');assert.equal(ctx.TOK.refresh,'old-refresh');
});

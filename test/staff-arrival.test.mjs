import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Production effect closures with synthetic state, not a mounted React/device test.
const source=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const between=(start,end)=>{const a=source.indexOf(start); assert.ok(a>=0);const b=source.indexOf(end,a);assert.ok(b>a);return source.slice(a,b);};
const pick=between('  useEffect(() => {\n    if (!config || !session || cfgProvisional.current) return;', '\n  useEffect(() => { setBoardFilter');
const load=between('  useEffect(() => {\n    if (!config || view === "admin"', '\n  /* ---- Close out unanswered absences');
const gate=between('  useEffect(() => {\n    if (!jumpHold)', '\n  useEffect(() => {\n    if (!config || view === "admin"');
const old='arrivalFailed = loadErr || bootStall || (!!storeLoadFailed && !storeMismatch);';
const proposed='arrivalFailed = loadErr || bootStall || (!wantsFloor && !!storeLoadFailed && !storeMismatch);';
assert.ok(gate.includes(proposed));
function harness(){
 const reads=[];
 const c={config:{stores:[{id:'manager-store',name:'Synthetic'}]},session:{id:'staff',role:'associate',wants:'associate',active:true,stores:[]},cfgProvisional:{current:false},viewPicked:{current:false},viewPickInFlight:{current:false},configSubject:'staff',configSubjectRef:{current:'staff'},wantsFloor:true,view:'manager-store',adminData:{},initialViewReady:false,storeData:null,storeLoadFailed:false,storeMismatch:null,ready:true,jumpHold:true,floorLinks:[{store:'staff-store',person_id:'synthetic'}],arrivalDestinationReady:true,loadErr:false,bootStall:false,arrivalFailed:false,arrivalSurfaceReady:true,iconWave:0,iconCache:{current:{}},useEffect:f=>f(),lastView:()=> 'manager-store',setAdminData:v=>c.adminData=v,setView:v=>c.view=v,setStoreData:v=>c.storeData=v,setInitialViewReady:v=>c.initialViewReady=v,installBaseline(){},setStoreLoadFailed:v=>c.storeLoadFailed=v,setStoreMismatch:v=>c.storeMismatch=v,setStoreLoadError(){},setTab(){},emptyStoreData:()=>({}),loadMark:()=>0,loadStore:async(id)=>{reads.push(id);throw Error('synthetic denied');},setTimeout(){},console:{error(){}},tellArrivalReady:v=>c.landable=v,activeEngineSend:m=>c.recovery=m.failed};
 const floorLine=source.match(/  const wantsFloor = (.*);/)[1];
 c.wantsFloor=new Function('session',`return ${floorLine}`)(c.session);
 return {c,reads,run:code=>new Function('c',`with(c){${code}}`)(c)};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('retained manager view and denied read do not block healthy staff arrival',async()=>{
 const h=harness();h.run(pick);await tick();assert.equal(h.c.initialViewReady,true);assert.equal(h.c.view,'manager-store');
 h.run(load);await tick();assert.deepEqual(h.reads,['manager-store']);assert.equal(h.c.storeLoadFailed,true);
 h.run(gate.replace(proposed,old));assert.equal(h.c.landable,true);assert.equal(h.c.arrivalFailed,true);assert.equal(h.c.recovery,true);
 h.run(gate);assert.equal(h.c.landable,true);assert.equal(h.c.arrivalFailed,false);
});
for(const wantsFloor of [true,false])for(const loadErr of [true,false])for(const bootStall of [true,false])test(`failure gate floor=${wantsFloor} configFailure=${loadErr} linksFailure=${bootStall}`,()=>{
 const h=harness();Object.assign(h.c,{wantsFloor,loadErr,bootStall,storeLoadFailed:true});h.run(gate);assert.equal(h.c.arrivalFailed,loadErr||bootStall||!wantsFloor);
});
test('manager store mismatch remains a landable warning',()=>{const h=harness();Object.assign(h.c,{wantsFloor:false,storeLoadFailed:true,storeMismatch:{want:'manager-store'}});h.run(gate);assert.equal(h.c.arrivalFailed,false);assert.equal(h.c.landable,true);});

test('pending staff destination remains unready',()=>{const h=harness();h.c.arrivalDestinationReady=false;h.run(gate);assert.equal(h.c.landable,false);});

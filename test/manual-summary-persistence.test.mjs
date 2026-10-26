import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySummaryStated} from '../api/_summary-stated.mjs';
import {reconcileMonths} from '../api/_month-intent.mjs';
const source=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const start=source.indexOf('  const applyEntries = async (entries) => {');
assert.ok(start>=0);
const body=source.slice(start,source.indexOf('\n  };',start)+5);
const at='2026-10-26T12:00:00.000Z';
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[at]));} }
async function apply(stated,{existing,concurrent,disjoint=false,rows={fictional:{displayName:'Fictional',internetUnits:0.5}}}={}) {
 const baseline={__storeId:'fictional',roster:[],months:{'2026-10':{stats:{},imports:{},names:{},...(existing?{stated:existing}:{})}}};
 let saved,mask; const proof={synthetic:true};
 const ctx={Date:FixedDate,activityScope:'day',activityDay:'2026-10-26',today:()=> '2026-10-26',console:{log(){}},absenceProof:()=>proof,storeData:baseline,view:'fictional',session:{id:'synthetic',name:'Synthetic'},takeRestorePoint:async()=> 'synthetic-restore',channelTotals:()=>({}),applySummaryStated,parseDeliverySummaryRows:()=>rows,departedNames:()=>[],norm:x=>String(x).toLowerCase(),admitsEveryone:()=>true,uid:()=> 'synthetic-id',setImportLog(){},analyzeImport:()=>[],setImportFlags(){},config:{},persistStore:async(id,next,audit,base,reported,gotProof)=>{assert.deepEqual(base,baseline);assert.equal(gotProof,proof);mask=reported;const current=structuredClone(baseline);if(disjoint)current.months['2026-10'].stats.other={internetUnits:3};if(concurrent)current.months['2026-10'].stated=concurrent;next.months=reconcileMonths(base,next,current,reported);saved=JSON.parse(JSON.stringify(next));}};
 const fn=new Function('ctx',`with(ctx){${body}; return applyEntries;}`)(ctx);
 await fn([{rows:[],type:'delivery-summary',fileName:'synthetic.pdf',stated}]);
 return {saved,mask};
}
test('manual PDF queue preserves mapper aggregate',()=>assert.match(source,/ready\.push\(\{ rows: ds\.rows, stated: ds\.stated, type: "delivery-summary"/));
for(const total of [0,7])test(`actual apply + reconciliation + JSON roundtrip preserves explicit total ${total} and fractions independently`,async()=>{
 const stated={total,units:{internet:total,phone:null},leads:{internet:0},vehicles:{new:0,used:total}};
 const {saved,mask}=await apply(stated);const m=saved.months['2026-10'];
 assert.equal(m.stated.deliveries,total);assert.deepEqual(m.stated.vehicles,stated.vehicles);assert.equal(m.stated.units.phone,null);assert.equal(m.stats.fictional.internetUnits,0.5);assert.equal(m.stated.file,'synthetic.pdf');assert.equal(m.stated.at,at);assert.ok(mask.some(p=>p.join('.')==='2026-10.stated'));
});
test('unknown total and orphan stock do not manufacture zero authority',async()=>{
 const {saved,mask}=await apply({total:null,vehicles:{new:4}});assert.equal(Object.hasOwn(saved.months['2026-10'],'stated'),false);assert.equal(mask.some(p=>p[1]==='stated'),false);
});
test('roll-up authority retained while stock enrichment matches email',async()=>{
 const existing={deliveries:9,source:'roll-up',file:'roll.csv'};
 const {saved}=await apply({total:0,vehicles:{new:0,used:3}},{existing});
 assert.deepEqual(saved.months['2026-10'].stated,{...existing,vehicles:{new:0,used:3}});
});
test('explicit reassertion equal to baseline rejects concurrent changed aggregate',async()=>{
 const stated={total:0,units:{internet:0},leads:{internet:null}};const m={};applySummaryStated(m,stated,{day:'2026-10-26',at,file:'synthetic.pdf'});
 await assert.rejects(apply(stated,{existing:m.stated,concurrent:{...m.stated,deliveries:6}}),e=>e.code==='MONTH_IMPORT_CONFLICT');
});

test('aggregate import retains disjoint concurrent employee update',async()=>{
 const {saved}=await apply({total:4},{disjoint:true});assert.equal(saved.months['2026-10'].stats.other.internetUnits,3);assert.equal(saved.months['2026-10'].stated.deliveries,4);
});

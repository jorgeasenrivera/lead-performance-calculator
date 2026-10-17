import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {sharedCore,sharedManager} from './shared-transform.mjs';import {inertOutside} from './shared-motion.mjs';
const core=readFileSync(new URL('../../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8'),manager=readFileSync(new URL('../../src/Manager.jsx',import.meta.url),'utf8');
test('shared preview preserves the complete approved arrival driver',()=>{const start=core.indexOf('function runJump('),end=core.indexOf('/* True from the press',start);assert.ok(start>0&&end>start);assert.ok(sharedCore(core).includes(core.slice(start,end)));});
test('shared transforms refuse changed ownership boundaries',()=>{assert.throws(()=>sharedCore(core.replace('const PRESS_SEL =','const ALTERED_PRESS =')),/boundary/);assert.throws(()=>sharedManager(manager.replace('function FrPop({','function OtherPop({')),/boundary/);});
test('overlapping modal inert ownership restores original state only after the final owner',()=>{const body={children:[]},branch={children:[],parentElement:body},surface={children:[],parentElement:branch},other={inert:false,tagName:'MAIN',parentElement:body},already={inert:true,tagName:'ASIDE',parentElement:body};body.children=[branch,other,already];branch.children=[surface];globalThis.document={body};try{const a=inertOutside(surface),b=inertOutside(surface);assert.equal(other.inert,true);a();a();assert.equal(other.inert,true);b();assert.equal(other.inert,false);assert.equal(already.inert,true);}finally{delete globalThis.document;}});
test('avatar label ink preserves hue and selects readable contrast',async()=>{const {readableInk}=await import('./shared-motion.mjs');assert.equal(readableInk('#EB6834'),'#15211B');assert.equal(readableInk('#6C5CE7'),'#fff');assert.equal(readableInk('#33a346'),'#15211B');assert.equal(readableInk('hsl(120 52% 42%)'),'#15211B');assert.throws(()=>readableInk('transparent'),/Unsupported/);});

test('relative type scales font sizes and pixel line heights without scaling layout',async()=>{const {relativeTypography}=await import('./shared-transform.mjs');assert.equal(relativeTypography('.x{font:600 12px/18px sans-serif;padding:12px;font-size:clamp(14px,2vw,20px);line-height:24px}'),'.x{font:600 0.75rem/1.125rem sans-serif;padding:12px;font-size:clamp(0.875rem,2vw,1.25rem);line-height:1.5rem}');assert.equal(relativeTypography('.x{font-size:.5px}'),'.x{font-size:0.03125rem}');});

test('preview recap presentation and close never write a persisted seen marker',()=>{const transformed=sharedManager(manager);assert.ok(transformed.includes('recapPresented(seenKey, signalRecapSeen, null);'));assert.ok(transformed.includes('signalRecapSeen.add(seenKey);'));assert.ok(!transformed.includes('recapPresented(seenKey, signalRecapSeen, localStorage)'));assert.ok(!transformed.includes('localStorage.setItem(seenKey,'));});

test('press feedback cancels drag and disabled contacts, and releases once',async()=>{
 const {pressDown,pressMove,pressUp}=await import('./shared-motion.mjs');
 const element=({disabled=false,aria=false,inert=false}={})=>({disabled,dataset:{},getAttribute:()=>aria?'true':null,closest:()=>inert?{}:null});
 const down=(el,extra={})=>pressDown({target:{closest:()=>el},button:0,clientX:20,clientY:20,...extra});
 const el=element();down(el);assert.equal(el.dataset.sagePressed,'true');pressMove({clientX:29,clientY:20});assert.equal(el.dataset.sagePressed,undefined);
 down(el);pressUp();pressUp();assert.equal(el.dataset.sagePressed,undefined);
 el.getBoundingClientRect=()=>({left:0,right:40,top:0,bottom:40});down(el,{clientX:39});pressMove({clientX:41,clientY:20});assert.equal(el.dataset.sagePressed,undefined);assert.equal(el.dataset.sageCancelled,'true');pressUp();pressUp();assert.equal(el.dataset.sageCancelled,undefined);
 for(const blocked of[element({disabled:true}),element({aria:true}),element({inert:true})]){down(blocked);assert.equal(blocked.dataset.sagePressed,undefined);}
 down(el,{button:2});assert.equal(el.dataset.sagePressed,undefined);down(el);down(el,{isPrimary:false});assert.equal(el.dataset.sagePressed,undefined);
 let ticks=0;pressDown({target:{closest:()=>el},pointerType:'touch',clientX:20,clientY:20},()=>ticks++);pressUp();await new Promise(r=>setTimeout(r,65));assert.equal(ticks,0);
});

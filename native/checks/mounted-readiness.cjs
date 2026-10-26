const fs = require('fs');
const assert = require('assert/strict');
const path = require('node:path');
const { root, original, rejected, candidate } = require('./readiness-source.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
 const results=[];
 for(const [variant,s] of [['original',original],['rejected',rejected],['candidate',candidate]]) for(const scenario of ['late-ready','queued-before-ready','commit-order','remount','late-native-store','unmount','unmount-after-ready','strict-late-ready','collision','speculative-ready']) {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({path:root+'/node_modules/react/umd/react.development.js'});
  await page.addScriptTag({path:root+'/node_modules/react-dom/umd/react-dom.development.js'});
  const result=await page.evaluate(async ({code,scenario})=>{
   const {useState,useRef,useEffect,useLayoutEffect,useCallback}=React;
   const stats={adds:0,removes:0,reads:0,injections:[],renders:[]}; let listener,release,setReady,nativePending=null;
   const webRefs=[];
   const pause=()=>new Promise(r=>setTimeout(r,40));
   const waitUntil=async (condition,label)=>{
    const deadline=performance.now()+2000;
    while(!condition()){
     if(performance.now()>=deadline)throw new Error('Timed out waiting for '+label);
     await new Promise(resolve=>setTimeout(resolve,5));
    }
   };
   const SageLive={available:true,addActionListener(fn){stats.adds++;listener=fn;return {remove(){stats.removes++;listener=null;}};},pendingAction(){stats.reads++;if(scenario==='late-native-store'){const a=nativePending;nativePending=null;return Promise.resolve(a);}if(stats.reads===1)return new Promise(r=>release=r);return Promise.resolve(null);}};
   const webPort={injectJavaScript(js){stats.injections.push({committed:document.getElementById('root').textContent,js});}};
   const never=new Promise(()=>{});
   const Component=new Function('React','SageLive','webPort','webRefs','stats','expose','never','scenario','emit',`return function Component(){
    const {useState,useRef,useEffect,useLayoutEffect,useCallback}=React;
    const web=useRef(webPort); if(!webRefs.includes(web))webRefs.push(web);
    const [ready,setReady]=useState(false); expose(setReady);stats.renders.push(ready);
    ${code}
    useLayoutEffect(()=>{if(scenario==='commit-order' && ready)emit();},[ready]);
    if(scenario==='speculative-ready' && ready) throw never;
    return React.createElement('span',null,ready?'ready':'not-ready');
   }`)(React,SageLive,webPort,webRefs,stats,x=>setReady=x,never,scenario,()=>listener?.({action:'take-desk'}));
   let root=ReactDOM.createRoot(document.getElementById('root'));
   let element=React.createElement(React.Suspense,{fallback:React.createElement('span',null,'fallback')},React.createElement(Component));
   if(scenario==='strict-late-ready')element=React.createElement(React.StrictMode,null,element);
   ReactDOM.flushSync(()=>root.render(element));await pause();
   const initial={adds:stats.adds,removes:stats.removes,reads:stats.reads};
   if(scenario==='queued-before-ready'){release('take-desk');release=null;await pause();}
   if(scenario==='remount'){
    ReactDOM.flushSync(()=>root.unmount());webRefs.forEach(ref=>ref.current=null);
    root=ReactDOM.createRoot(document.getElementById('root'));
    ReactDOM.flushSync(()=>root.render(element));await pause();
   }
   if(scenario==='late-native-store')nativePending='take-desk';
   if(scenario==='unmount'){ReactDOM.flushSync(()=>root.unmount());webRefs.forEach(ref=>ref.current=null);}
   else if(scenario==='speculative-ready'){
    React.startTransition(()=>setReady(true));
    await waitUntil(()=>stats.renders.includes(true),'speculative ready render');
    if(document.getElementById('root').textContent!=='not-ready')throw new Error('Speculative render unexpectedly committed');
   }
   else {ReactDOM.flushSync(()=>setReady(true));await pause();}
   if(scenario==='unmount-after-ready'){ReactDOM.flushSync(()=>root.unmount());webRefs.forEach(ref=>ref.current=null);}
   if(scenario==='collision')listener({action:'take-desk'});
   if(release)release(scenario==='commit-order'?null:'take-desk');await pause();
   const beforeNewDelivery=stats.injections.length;
   if(scenario==='remount'){listener({action:'take-desk'});await pause();}
   const result={scenario,initial,final:structuredClone(stats),nativePending,beforeNewDelivery,committed:document.getElementById('root').textContent};
   if(scenario!=='unmount' && scenario!=='unmount-after-ready')ReactDOM.flushSync(()=>root.unmount());
   return result;
  },{code:s,scenario});
  results.push({variant,...result});await page.close();
 }
 await browser.close();
 const get=(v,s)=>results.find(r=>r.variant===v&&r.scenario===s);
 for(const v of ['original','rejected','candidate']){
  assert(get(v,'speculative-ready').final.renders.includes(true),'speculative probe must actually render ready');
  assert.equal(get(v,'speculative-ready').committed,'not-ready');
 }
 assert.equal(get('original','late-ready').final.injections.length,0);
 assert.equal(get('candidate','late-ready').final.injections.length,1);
 assert.equal(get('rejected','speculative-ready').final.injections[0].committed,'not-ready');
 for(const v of ['original','candidate']) {
  assert.equal(get(v,'late-ready').final.reads,2);
  assert.equal(get(v,'late-ready').final.adds,2);
  assert.equal(get(v,'late-ready').final.removes,1);
  assert.equal(get(v,'late-native-store').final.injections.length,1);
  assert.equal(get(v,'speculative-ready').final.injections.length,0);
  assert.equal(get(v,'queued-before-ready').final.injections.length,1);
  assert.equal(get(v,'commit-order').final.injections.length,1);
  assert.equal(get(v,'strict-late-ready').final.reads,3);
  assert.equal(get(v,'strict-late-ready').final.removes,2);
  assert.equal(get(v,'remount').beforeNewDelivery,0);
  assert.equal(get(v,'remount').final.injections.length,1);
  for(const s of ['unmount','unmount-after-ready'])assert.equal(get(v,s).final.injections.length,0);
 }
 assert.equal(get('candidate','strict-late-ready').final.injections.length,1);
 assert.equal(get('candidate','collision').final.injections.length,2);
 assert.equal(get('rejected','late-native-store').final.injections.length,0);
 const output={react:require(path.join(root,'node_modules/react/package.json')).version,renderer:'ReactDOM createRoot, development UMD',browser:process.env.CHROMIUM_EXECUTABLE || 'Playwright configured Chromium',scope:'Actual extracted hook code mounted in browser; native/WebView ports mocked; no network',results};
 if (process.env.READINESS_OUTPUT) fs.writeFileSync(process.env.READINESS_OUTPUT,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({variant:r.variant,scenario:r.scenario,initial:r.initial,reads:r.final.reads,adds:r.final.adds,removes:r.final.removes,injections:r.final.injections.length,committed:r.committed,injectedAt:r.final.injections.map(i=>i.committed),renders:r.final.renders})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

// Test-only composition. These are the real host components, not a sign-in or service fixture.
import React from 'react';
import {createRoot} from 'react-dom/client';
import seed from 'virtual:current-host-fixture';

// Existing host preferences are private to this fixture visit too.
const memory=new Map();
Object.defineProperty(window,'localStorage',{configurable:true,value:{get length(){return memory.size;},key:i=>[...memory.keys()][i]??null,getItem:key=>memory.get(String(key))??null,setItem:(key,value)=>memory.set(String(key),String(value)),removeItem:key=>memory.delete(String(key)),clear:()=>memory.clear()}});

async function start(){
 const [{AppShell,BoardRoomPhone,StoreHero,Board},{DEFAULT_TIERS,usePhoneLayout},{reportedAuthFor,beginLoad,acceptLoad}]=await Promise.all([
  import('../../src/Manager.jsx'),import('../../src/LeadPerformanceCalculator.jsx'),import('../../src/scheduler-load-context.mjs'),
 ]);
 const snapshot=Object.freeze({sessionReady:true,disposed:false,principalEpoch:1});
 const auth={getSnapshot:()=>snapshot,subscribe:()=>()=>{},getAccessToken:async()=>null};
 reportedAuthFor({},()=>auth);
 const {store,data}=seed;
 if(!acceptLoad(beginLoad(auth,store.id),auth,data).stamped)throw Error('Synthetic fixture load was not stamped.');
 const config={stores:[store],roles:[{id:'sales',name:'Sales Associate',onBoard:true,coaching:true},{id:'service',name:'Service to Sales',onBoard:true},{id:'manager',name:'Manager',onBoard:false}],standards:{[store.id]:{sales:{tiers:DEFAULT_TIERS},service:{tiers:DEFAULT_TIERS}}},holidays:[]};
 const noop=()=>{},session={role:'manager',name:'Jordan Lee',stores:[store.id],onboarded:true};
 const props={config,store,data,session,schedulerPrincipalEpoch:1,schedulerCanOpen:id=>id===store.id,canSetGoal:false,onSaveConfig:noop,onSetRestriction:noop,onCoach:noop,onGoTab:noop,onFilter:noop,onFocus:noop,onMove:noop,onIgnore:noop,onClearFilter:noop};
 function Preview(){
  const phone=usePhoneLayout();
  const stayInFixture=event=>{if(!event.target.closest('.sc-entry,.sc-scrim,button[aria-label="Close the round-up"]')){event.preventDefault();event.stopPropagation();}};
  return <div onClickCapture={stayInFixture}>
   <p role="note">Synthetic current-host preview. No live data is connected. Changes are not saved or published.</p>
   <AppShell session={session} appModule="perf" navItems={[["board","Dashboard"],["import","Import"],["gm","Summary"],["history","History"],["roster","People"]]} navValue="board" navOnChange={noop} onToolChange={noop} onSignOut={noop} onImport={noop} storeData={data} storeName={store.name} brand={store.brand}>
    <div className="page"><div className="board-page">{phone?<BoardRoomPhone {...props}/>:<><StoreHero {...props}/><Board {...props}/></>}</div></div>
   </AppShell>
  </div>;
 }
 createRoot(document.getElementById('root')).render(<Preview/>);
}
start().catch(error=>{document.getElementById('root').textContent='The synthetic preview could not open.';console.error(error);});

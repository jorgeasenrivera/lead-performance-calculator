// Test entry only: actual components, no production bootstrap or switch mutation.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ManualManagerEntry,OwnPublishedSchedule} from '../../src/scheduler-manual.jsx';
const fixture=await fetch('/fixture'+location.search,{redirect:'error'}).then(r=>{if(!r.ok)throw Error('fixture unavailable');return r.json();});
let session=fixture.session;const listeners=new Set();
const client={auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange:fn=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}}};
// A test-only sign-out button exercises the actual reported-auth invalidation.
function App(){return <><button onClick={()=>{session=null;for(const fn of listeners)fn('SIGNED_OUT',null);}}>Fixture sign out</button>{fixture.kind==='manager'?<ManualManagerEntry client={client} storeId="pilot-a" store={{id:'pilot-a'}} data={{}} isOff={()=>false}/>:<OwnPublishedSchedule client={client} storeId="pilot-a" month="2026-10"/>}</>;}
createRoot(document.getElementById('root')).render(<App/>);

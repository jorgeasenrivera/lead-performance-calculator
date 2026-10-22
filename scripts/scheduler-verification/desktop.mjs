// Opt-in local-only browser/HTTP/pg proof. Never imported by an application entrypoint.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {originalC113} from '../../api/_scheduler-c113.mjs';
import {createDraftOnlyScheduler} from '../../api/_scheduler-draft-only.mjs';
import {createSchedulerPgTransport,createDraftPermissionFor} from '../../api/_scheduler-pg-transport.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url)),root=process.env.SCHEDULER_POSTGRES_ROOT,bin=process.env.SCHEDULER_POSTGRES_BIN;
assert.match(root||'',/^\/tmp\/sage-scheduler-pg\.[A-Za-z0-9]+$/);assert.equal(fs.readFileSync(root+'/runner-marker','utf8'),root);
const sql=q=>execFileSync(bin+'/psql',['-X','-w','-At','-v','ON_ERROR_STOP=1','-h',root+'/socket','-U','scheduler_fixture','-d','scheduler_fixture','-c',q],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:root+'/home',LANG:'C'}}).trim();
assert.equal(sql('SHOW data_directory'),root+'/data');assert.equal(sql('SHOW listen_addresses'),'');
const actor='00000000-0000-4000-8000-000000000001',store='browser-synthetic';
sql(`UPDATE public.profiles SET role='admin',stores='{}',active=true,pending=false WHERE id='${actor}'; DELETE FROM scheduler_policy.pilot_scope; INSERT INTO scheduler_policy.pilot_scope(actor_id,approved_store_ids,enabled) VALUES('${actor}',ARRAY['${store}'],true); INSERT INTO scheduler_policy.draft_grants VALUES('${actor}','${store}','draft-read',true),('${actor}','${store}','draft-save',true);`);
const transport=createSchedulerPgTransport({pool:new Pool({host:root+'/socket',port:5432,user:'scheduler_runtime',database:'scheduler_fixture',password:'',ssl:false,max:1,connectionTimeoutMillis:3000,query_timeout:6000})});
const identityDb={auth:{getUser:async token=>({data:{user:token==='synthetic-token'?{id:actor}:null},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:actor,role:'admin',stores:[],active:true,pending:false},error:null})})})})};
const handler=createDraftOnlyScheduler({identityDb,transport,c113:originalC113,draftPermissionFor:createDraftPermissionFor(transport),now:()=> '2026-10-19T20:00:00.000Z'});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sage-draft-desktop-')),calls=[],errors=[],blocked=[],pages=[],responses=[];
let server,browser,dropNextSave=true;
try {
 fs.symlinkSync(path.join(repo,'node_modules'),path.join(dir,'node_modules'));
 fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><html><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
 fs.writeFileSync(path.join(dir,'main.jsx'),`import React from 'react';import {createRoot} from 'react-dom/client';
import Desktop from ${JSON.stringify(repo+'src/scheduler-draft-desktop.jsx')};
import {schedulerDraftCodec as codec} from ${JSON.stringify(repo+'src/scheduler-draft-codec.mjs')};
import {createSchedulerDraftTransport} from ${JSON.stringify(repo+'src/scheduler-draft-transport.mjs')};
let epoch=1;const listeners=new Set();const auth={getSnapshot:()=>({principalEpoch:epoch,disposed:false}),getAccessToken:async()=> 'synthetic-token',subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)}};
const transport=createSchedulerDraftTransport({auth,codec,fetchImpl:fetch,requestId:()=>crypto.randomUUID()});
window.fixture={transport,auth,invalidate:()=>{epoch++;for(const f of listeners)f()}};
createRoot(document.getElementById('root')).render(<Desktop auth={auth} transport={transport} draftCodec={codec} store={{id:'${store}',name:'Synthetic'}} data={{__storeId:'${store}',roster:[{id:'p',name:'Synthetic Person',roleId:'sales'}],daysOff:{}}} timezone="America/New_York" now={()=>new Date('2026-10-19T16:00:00Z')} principalEpoch={1} dataEpoch={1} confirm={()=>true}/>);`);
 await build({root:dir,configFile:false,logLevel:'error',plugins:[react()],build:{outDir:path.join(dir,'dist'),emptyOutDir:true}});
 server=http.createServer(async(req,res)=>{
  if(req.url==='/api/scheduler'){
   let text='';for await(const chunk of req)text+=chunk;
   const body=JSON.parse(text);calls.push({body,token:req.headers.authorization});
   const out={setHeader:(k,v)=>res.setHeader(k,v),status(n){this.code=n;return this},json(v){this.body=v;return this}};
   await handler({method:req.method,headers:req.headers,body},out);responses.push({op:body.op,status:out.code,error:out.body?.error});
   if(body.op==='save'&&out.code===200&&dropNextSave){dropNextSave=false;res.writeHead(200,{'content-type':'application/json'}).end('{"result":');return;}
   res.writeHead(out.code,{'content-type':'application/json'}).end(JSON.stringify(out.body));return;
  }
  const file=path.join(dir,'dist',new URL(req.url,'http://local').pathname==='/'?'index.html':new URL(req.url,'http://local').pathname);
  if(!file.startsWith(path.join(dir,'dist')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const pw=await import(pathToFileURL(process.env.FEEL_PLAYWRIGHT));browser=await pw.chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/'))return route.continue();blocked.push(u);return route.abort();});
 const a=await context.newPage(),b=await context.newPage();pages.push(a,b);for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 const ready=async p=>{await p.goto(origin);await p.getByRole('button',{name:'Save month draft',exact:true}).waitFor();await p.waitForFunction(()=>!document.querySelector('.sdd-primary').disabled);};
 await ready(a);await ready(b);assert.deepEqual([...new Set(calls.filter(c=>c.body.op==='read').map(c=>c.body.month))].sort(),['2026-09','2026-10','2026-11']);
 await a.getByRole('button',{name:'Save month draft',exact:true}).click();await a.getByRole('button',{name:'Retry same save',exact:true}).waitFor();
 await a.getByRole('button',{name:'Retry same save',exact:true}).click();await a.waitForFunction(()=>document.querySelector('.sdd-status').textContent.includes('Draft revision 1 saved'));
 const saves=calls.filter(c=>c.body.op==='save');assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);
 assert.equal(sql(`SELECT count(*) FROM scheduler_private.versions WHERE store_id='${store}'`),'1');
 assert.equal(sql(`SELECT count(*) FROM scheduler_private.audit WHERE store_id='${store}'`),'1');
 assert.equal(sql(`SELECT count(*) FROM scheduler_private.receipts WHERE store_id='${store}'`),'1');
 await b.getByRole('button',{name:'Save month draft',exact:true}).click();await b.waitForFunction(()=>document.querySelector('.sdd-status').textContent.includes('Another draft changed'));
 await b.getByRole('button',{name:'Recovery options',exact:true}).click();await b.getByRole('button',{name:'Discard local edits and reload',exact:true}).click();
 await b.waitForFunction(()=>document.querySelector('.sdd-status').textContent.includes('Draft revision 1 saved'));
 const frame=b.frameLocator('iframe');await frame.locator('#workspace').click();await frame.locator('summary',{hasText:'Schedule tools'}).click();
 await frame.locator('#setup').click();await frame.locator('#people').click();
 await frame.locator('input[name=start]').fill('9');await frame.locator('input[name=end]').fill('17');await frame.locator('input[name=maxHours]').fill('40');
 const pendingCalls=calls.length;assert.equal(await b.getByRole('button',{name:'Save month draft',exact:true}).isDisabled(),true);
 assert.equal(calls.length,pendingCalls,'pending form cannot be saved');
 await frame.getByRole('button',{name:'Apply changes',exact:true}).click();await b.getByRole('button',{name:'Save month draft',exact:true}).click();
 await b.waitForFunction(()=>document.querySelector('.sdd-status').textContent.includes('Draft revision 2 saved'));
 const submitted=calls.filter(c=>c.body.op==='save').at(-1).body.input.draft;
 assert.equal(submitted.store.people[0].start,9);assert.equal(submitted.store.people[0].maxHours,40);
 await b.reload();await b.waitForFunction(()=>document.querySelector('.sdd-status').textContent.includes('Draft revision 2 saved'));
 const reloadFrame=b.frameLocator('iframe');await reloadFrame.locator('#workspace').click();await reloadFrame.locator('summary',{hasText:'Schedule tools'}).click();await reloadFrame.locator('#setup').click();await reloadFrame.locator('#people').click();
 assert.equal(await reloadFrame.locator('input[name=start]').inputValue(),'9');assert.equal(await reloadFrame.locator('input[name=maxHours]').inputValue(),'40');
 const denied=await b.evaluate(async()=>{const t=window.fixture.transport;try{await t.send(t.prepareRead({storeId:'other-store',month:'2026-10'}),{expectedEpoch:1});return null}catch(e){return e.code}});assert.equal(denied,'forbidden');
 const before=calls.length;await a.evaluate(()=>window.fixture.invalidate());await a.waitForFunction(()=>!document.querySelector('iframe'));assert.equal(calls.length,before);
 assert.equal(sql(`SELECT draft_rev FROM scheduler_private.heads WHERE store_id='${store}' AND month='2026-10'`),'2');
 assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({desktop:'1440x1000 Chromium',passed:['real desktop load of three months','actual C113 save through HTTP and pg','truncated response after commit and exact replay','one version audit receipt','stale second editor conflict','explicit recovery and hydration','pending form blocks save','applied edit saves revision2 and reloads into controls','cross-store server denial','principal invalidation'],requests:calls.length,externalRequests:blocked.length,pageErrors:errors.length}));
} catch(error) {console.error(JSON.stringify({responses,errors,states:await Promise.all(pages.map(p=>p.locator('.sdd-status').textContent().catch(()=>null)))}));throw error;} finally {await browser?.close();if(server)await new Promise(r=>server.close(r));await transport.close();fs.rmSync(dir,{recursive:true,force:true});}

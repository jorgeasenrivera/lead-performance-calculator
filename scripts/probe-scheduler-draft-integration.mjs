// Actual local-only draft entry and HTTP refusal. No persistence replacement.
// Database success cases remain blocked until the reviewed local backend is available.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runFile=promisify(execFile);
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MOCK='http://127.0.0.1:5433';
const ENABLED=true;const manualRequests=[];
const EVIDENCE=path.resolve(process.env.PROBE_EVIDENCE_DIR||path.join(ROOT,'../app-draft-probe'));
fs.mkdirSync(EVIDENCE,{recursive:true});
const USER='00000000-0000-4000-8000-000000000001';
const SID='11111111-1111-4111-8111-111111111111';
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const session=sid=>({access_token:`${b64({alg:'none',typ:'JWT'})}.${b64({sub:USER,session_id:sid,exp:Math.floor(Date.now()/1000)+3600})}.x`,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'synthetic-refresh',user:{id:USER,email:'demo@sageonline.app',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}});
const results=[],attempted=[],blocked=[],errors=[],requests=[];
let browser,server,mock,page,step='startup';
let profilePatch=null,acceptDialogs=false;

const DB_MODE=process.env.SCHEDULER_DRAFT_PROBE_MODE||'unavailable';
if(!['unavailable','pilot-unavailable','postgres'].includes(DB_MODE))throw Error('Unknown draft probe mode');
let db,dbInput,pilotServer,ownerPool,pgModule,fault=null,faultReached=null,held=null,clusterVerified=false;
const issuedTokens=new Set(),httpOutcomes=new Map(),readPayloads=[];
const DB_CHECKS=["actual pilot calendar loads confirmed absence through established handler and real PostgreSQL", "actual edit save remount reload matches the response projection and passes host hydration verification", "independently verified committed response hold acknowledges only submitted changes", "commit then lost response retries identical command and creates no duplicate version or audit", "real competing request causes conflict while local changes remain and loser adds no history", "late committed response cannot mutate a successor after actual store authorization retirement"];
const schemaNames=['heads','versions','audit','receipts'];
async function databasePreflight(){
 const inputPath=process.env.SCHEDULER_DRAFT_PROBE_DATABASE_INPUT;
 assert.ok(inputPath&&path.isAbsolute(inputPath),'BLOCKED: explicit owned disposable database input is required');
 dbInput=JSON.parse(fs.readFileSync(inputPath,'utf8'));
 assert.equal(dbInput.version,'scheduler-dashboard-disposable-db/1');
 const owned=fs.realpathSync(dbInput.ownedRoot);
 assert.equal(owned,dbInput.ownedRoot);assert.ok(owned.startsWith('/workspace/')||owned.startsWith('/tmp/'));
 const stat=fs.statSync(owned);assert.equal(stat.uid,process.getuid());assert.equal(stat.mode&0o077,0);
 assert.equal(fs.readFileSync(path.join(owned,'SAGE-SYNTHETIC-DISPOSABLE'),'utf8').trim(),dbInput.nonce);
 assert.ok(typeof dbInput.nonce==='string'&&dbInput.nonce.length>=16);
 assert.ok(Number.isInteger(dbInput.port)&&dbInput.port>0&&dbInput.port<=65535);
 assert.match(dbInput.ownerRole,/^[a-z_][a-z0-9_-]{0,62}$/);assert.ok(path.isAbsolute(dbInput.pgBin));
 assert.equal(dbInput.cleanup,true,'Only an explicitly disposable cluster may be used');
 const backendHead=await runFile('git',['-C',dbInput.backendRoot,'rev-parse','HEAD']);
 const backendTree=await runFile('git',['-C',dbInput.backendRoot,'rev-parse','HEAD^{tree}']);
 assert.equal(backendHead.stdout.trim(),'4d2722e07e8a43e11f1eb6cab8d462dd6ed8c222');
 assert.equal(backendTree.stdout.trim(),'20aa8458d7c50168ff722493143e80157c516c0a');
 assert.equal((await runFile('git',['-C',dbInput.backendRoot,'status','--porcelain'])).stdout.trim(),'');
 assert.match((await runFile(path.join(dbInput.pgBin,'pg_ctl'),['--version'])).stdout,/^pg_ctl \(PostgreSQL\) 17\.11\s*$/);
 pgModule=await import('pg');
 const connection={host:path.join(owned,'socket'),port:dbInput.port,database:'postgres',user:dbInput.ownerRole,
  password:'',ssl:false,options:'',max:1,connectionTimeoutMillis:3000,query_timeout:6000};
 ownerPool=new pgModule.Pool(connection);
 const observed=await ownerPool.query("SELECT current_setting('server_version_num') AS version,current_setting('listen_addresses') AS listen,current_setting('data_directory') AS data");
 assert.equal(observed.rows[0].version,'170011');assert.equal(observed.rows[0].listen,'');
 assert.equal(fs.realpathSync(observed.rows[0].data),path.join(owned,'data'));
 const dataStat=fs.statSync(path.join(owned,'data'));assert.equal(dataStat.uid,process.getuid());clusterVerified=true;
 for(const table of schemaNames){
  const count=await ownerPool.query('SELECT count(*)::int AS n FROM scheduler_private.'+table+' WHERE store_id=$1',['sage-demo']);
  assert.equal(count.rows[0].n,0,'Synthetic store must start empty: '+table);
 }
 const {createDraftOnlySchedulerServer}=await import(pathToFileURL(path.join(ROOT,'api/_scheduler-draft-server.mjs')));
 class SocketPool extends pgModule.Pool{
  constructor(){super({...connection,user:'scheduler_runtime'});}
 }
 const syntheticAuth=async(input,init)=>{
  const u=new URL(typeof input==='string'?input:input.url),token=new Headers(init.headers).get('authorization')?.slice(7);
  assert.equal(u.origin,'https://dydfevdnpppvxgdptiwv.supabase.co');
  if(!issuedTokens.has(token))return new Response(JSON.stringify({message:'Synthetic token not issued'}),{status:401,headers:{'content-type':'application/json'}});
  const value=u.pathname==='/auth/v1/user'?{id:USER,aud:'authenticated',role:'authenticated'}
   :u.pathname==='/rest/v1/profiles'?{id:USER,role:'manager',stores:['sage-demo'],active:true,pending:false}:null;
  assert.ok(value,'Only synthetic Auth/profile routes are permitted');
  return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 };
 pilotServer=createDraftOnlySchedulerServer({enabled:true,Pool:SocketPool,fetchImpl:syntheticAuth,env:{
  SCHEDULER_DRAFT_PILOT_ACTOR_ID:USER,SCHEDULER_DRAFT_PILOT_STORE_ID:'sage-demo',
  SCHEDULER_SUPABASE_URL:'https://dydfevdnpppvxgdptiwv.supabase.co',SCHEDULER_SUPABASE_ANON_KEY:'synthetic-anon',
  SCHEDULER_DATABASE_URL:'postgresql://scheduler_runtime:synthetic@db.dydfevdnpppvxgdptiwv.supabase.co:5432/postgres?sslmode=verify-full'}});
 db={version:observed.rows[0].version,listen:observed.rows[0].listen,backendHead:backendHead.stdout.trim(),syntheticAuth:true,checks:[]};
}
async function stored(month){
 const heads=await ownerPool.query('SELECT draft_rev,published_rev,audit_revision FROM scheduler_private.heads WHERE store_id=$1 AND month=$2',['sage-demo',month]);
 const counts={};
 for(const table of ['versions','audit','receipts'])counts[table]=(await ownerPool.query('SELECT count(*)::int AS n FROM scheduler_private.'+table+' WHERE store_id=$1 AND month=$2',['sage-demo',month])).rows[0].n;
 const head=heads.rows[0]||{draft_rev:0,published_rev:0,audit_revision:0};let projection=null;
 if(Number(head.draft_rev)){
  const text=(await ownerPool.query("SELECT version_text FROM scheduler_private.versions WHERE store_id=$1 AND month=$2 AND kind='draft' AND rev=$3",['sage-demo',month,head.draft_rev])).rows[0].version_text;
  const {originalC113}=await import(pathToFileURL(path.join(ROOT,'api/_scheduler-c113.mjs')));
  const decoded=originalC113.deserializeVersion(text,{storeId:'sage-demo',month,kind:'draft',rev:Number(head.draft_rev)});
  assert.equal(decoded.ok,true);projection=decoded.draft;
 }
 return {revision:Number(head.draft_rev),published:Number(head.published_rev),auditRevision:Number(head.audit_revision),projection,counts};
}
async function routePilot(req,res,body){
 let tracked;try{
 const result={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await pilotServer.handler({method:req.method,headers:req.headers,body},result);
 if(body.op==='save'&&result.code===200){
  const observed=await stored(body.month);assert.ok(observed.revision>=result.body.result.head.draftRev);
  if(!result.body.replayed)assert.deepEqual(observed.projection,body.input.draft);
  db.checks.push({revision:observed.revision,counts:observed.counts,replayed:result.body.replayed,requestId:body.requestId});
  if(fault){
   const mode=fault;fault=null;tracked=faultReached={mode,body:JSON.stringify(body),observed,serverCompleted:false};
   if(mode==='drop'){res.destroy();return;}
   await new Promise(resolve=>{held=resolve;});
  }
 }
 if(body.op==='read'&&result.code===200)readPayloads.push(structuredClone(result.body));
 if(!res.destroyed)res.writeHead(result.code,result.headers).end(JSON.stringify(result.body));
 }finally{if(tracked)tracked.serverCompleted=true;}
}
async function waitFor(predicate,label){
 const until=Date.now()+12000;while(!predicate()){if(Date.now()>until)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,25));}
}
async function cleanupDatabase(){
 if(!dbInput)return;
 const cleanupErrors=[];
 try{await pilotServer?.close();}catch(e){cleanupErrors.push(e);}
 try{await ownerPool?.end();}catch(e){cleanupErrors.push(e);}
 if(!clusterVerified){if(cleanupErrors.length)throw cleanupErrors[0];return;}
 assert.equal(fs.readFileSync(path.join(dbInput.ownedRoot,'SAGE-SYNTHETIC-DISPOSABLE'),'utf8').trim(),dbInput.nonce);
 const ctl=path.join(dbInput.pgBin,'pg_ctl'),data=path.join(dbInput.ownedRoot,'data');
 await runFile(ctl,['-D',data,'stop','-m','fast','-w','-t','15']);
 let stopped=false;try{await runFile(ctl,['-D',data,'status']);}catch(e){assert.equal(e.code,3);stopped=true;}
 assert.equal(stopped,true);assert.equal(fs.existsSync(path.join(data,'postmaster.pid')),false);
 fs.rmSync(data,{recursive:true});fs.rmSync(path.join(dbInput.ownedRoot,'socket'),{recursive:true});
 if(db)db.cleanup='verified stopped; owned disposable data/socket removed';
 if(cleanupErrors.length)throw cleanupErrors[0];
}

const check=async(name,fn)=>{step=name;attempted.push(name);await fn();results.push(name);console.log('PASS '+name);};
const reachable=async()=>{try{await fetch(MOCK+'/auth/v1/user');return true;}catch{return false;}};
try{
  assert.ok(DB_MODE!=='pilot-unavailable'||process.env.SCHEDULER_DRAFT_PILOT_ENABLED!=='1','BLOCKED: pilot-unavailable requires the server activation flag OFF');
  if(DB_MODE==='postgres')await databasePreflight();
  assert.equal(await reachable(),false,'5433 must be free for this isolated mock');
  mock=spawn(process.execPath,['scripts/mock-supabase.mjs'],{cwd:ROOT,stdio:'ignore'});
  for(let i=0;i<60&&!await reachable();i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await reachable(),true,'local mock started');
  const {build}=await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  Object.assign(process.env,{VITE_SUPABASE_URL:MOCK,VITE_SUPABASE_ANON_KEY:'synthetic-anon',VITE_SCHEDULER_CALENDAR:'1',VITE_SCHEDULER_DRAFT_LOCAL:DB_MODE==='unavailable'?'1':'0',VITE_SCHEDULER_DRAFT_PILOT:DB_MODE==='unavailable'?'0':'1',VITE_SCHEDULER_DRAFT_PILOT_STORE_ID:'sage-demo'});
  const dist=path.join(EVIDENCE,'dist');
  await build({root:ROOT,mode:DB_MODE==='unavailable'?'scheduler-local-test':'scheduler-pilot-test',logLevel:'error',build:{outDir:dist,emptyOutDir:true}});
  const bundle=fs.readdirSync(path.join(dist,'assets')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(dist,'assets',f),'utf8')).join('\n');
  assert.ok(bundle.includes(MOCK));assert.ok(!bundle.includes('dydfevdnpppvxgdptiwv'));
  server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://local');let file=path.resolve(dist,'.'+decodeURIComponent(u.pathname));
    if(u.pathname==='/__probe-blank'){res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Synthetic auth event</title>');return;}
    if(!file.startsWith(dist+path.sep))file='';
    if(DB_MODE!=='unavailable'&&u.pathname==='/api/scheduler'){
      let body='';for await(const part of req)body+=part;
      const command=JSON.parse(body);manualRequests.push({action:command.op==='read'?'load':command.op,op:command.op,storeId:command.storeId,month:command.month,requestId:command.requestId,serializedBody:body,hasBearer:/^Bearer [^\s]+$/.test(req.headers.authorization||'')});
      try{if(DB_MODE==='postgres')await routePilot(req,res,command);else{const {default:disabled}=await import(pathToFileURL(path.join(ROOT,'api/scheduler.mjs')));const adapted={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(v){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return this;}};await disabled({method:req.method,headers:req.headers,body:command},adapted);}}catch(error){errors.push(String(error));if(!res.destroyed)res.writeHead(503,{'content-type':'application/json'}).end('{"error":"storage-unavailable"}');}return;
    }
    if(u.pathname==='/api/scheduler-manual'){
      let body='';for await(const part of req)body+=part;
      const command=JSON.parse(body);manualRequests.push({action:command.action,storeId:command.storeId,month:command.month,hasBearer:/^Bearer [^\s]+$/.test(req.headers.authorization||'')});
      await new Promise(resolve=>setTimeout(resolve,25));
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'}).end('{"error":"storage-not-configured"}');return;
    }
    if(u.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'}).end('{"error":"unavailable"}');return;}
    if(!file||!fs.existsSync(file)||fs.statSync(file).isDirectory()){
      if(path.extname(u.pathname)){res.writeHead(404).end();return;}
      file=path.join(dist,'index.html');
    }
    res.writeHead(200,{'content-type':({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const pw=await import(pathToFileURL(process.env.FEEL_PLAYWRIGHT||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
  const engine=process.env.FEEL_BROWSER==='webkit'?'webkit':'chromium';
  browser=await pw[engine].launch(engine==='chromium'?{executablePath:process.env.FEEL_CHROME||'/usr/bin/chromium'}:{});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base&&url.origin!==MOCK){blocked.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
    requests.push({method:request.method(),path:url.pathname,query:url.search});
    if(url.origin===MOCK&&url.pathname==='/auth/v1/token'){const issued=session(SID);issuedTokens.add(issued.access_token);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(issued)});}
    if(url.origin===MOCK&&url.pathname==='/rest/v1/profiles'&&request.method()==='GET'&&profilePatch){
      const response=await route.fetch(),body=await response.json();
      return route.fulfill({response,body:JSON.stringify(Array.isArray(body)?body.map(value=>({...value,...profilePatch})):{...body,...profilePatch})});
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/,socket=>{if(new URL(socket.url()).origin.replace(/^ws/,'http')!==MOCK)blocked.push(socket.url());socket.close();});
  page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));page.on('dialog',dialog=>acceptDialogs?dialog.accept():dialog.dismiss());
  const requestId=request=>{try{return JSON.parse(request.postData()||'{}').requestId;}catch{return null;}};
  page.on('requestfailed',request=>{const id=requestId(request);if(id)httpOutcomes.set(id,{outcome:'request-failed',reason:request.failure()?.errorText});});
  page.on('response',async response=>{const id=requestId(response.request());if(id){await response.finished();httpOutcomes.set(id,{outcome:'response-finished'});}});
  const announce=async event=>{
    const other=await context.newPage();await other.goto(base+'/__probe-blank');
    const incoming=event==='SIGNED_OUT'?null:session(SID);if(incoming)issuedTokens.add(incoming.access_token);
    await other.evaluate(([event,s])=>{if(s)localStorage.setItem('lpc-auth',JSON.stringify(s));else localStorage.removeItem('lpc-auth');const channel=new BroadcastChannel('lpc-auth');channel.postMessage({event,session:s});channel.close();},[event,incoming]);
    await other.close();
  };
  await check('real sign-in and trusted dashboard entry',async()=>{
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('input[type=email],input[autocomplete=username]').fill('demo@sageonline.app');await page.locator('input[type=password]').fill('x');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    const roundup=page.getByRole('button',{name:'Close the round-up',exact:true});
    await page.locator(ENABLED?'.sc-toggle:visible:enabled':'.s2-hero').first().waitFor({timeout:30000});
    await roundup.waitFor({state:'visible',timeout:6000}).catch(()=>{});
    if(await roundup.isVisible())await roundup.click();
    if(ENABLED)assert.equal(await page.locator('[data-delivery-status=unavailable]').count()>0,true,'absent counts remain unavailable');
    else assert.equal(await page.locator('.sc-toggle').count(),0,'flag OFF preserves existing entry');
  });


  if(DB_MODE==='postgres'){
    const planner=()=>page.frameLocator('iframe[title="Schedule editor"]');
    await check('actual pilot calendar loads confirmed absence through established handler and real PostgreSQL',async()=>{
      await page.locator('.sc-toggle:visible').first().click();await page.locator('.sc-planner-dialog').waitFor();
      await planner().locator('#app [data-view-switch]:visible').waitFor();
      await page.waitForFunction(()=>document.querySelector('[data-draft-state]')?.dataset.draftState==='absent');
      assert.equal(manualRequests.at(-1).op,'read');
      await page.getByRole('button',{name:'Review existing schedule',exact:true}).click();
      await page.getByRole('button',{name:'Include reviewed facts',exact:true}).click();
      await planner().locator('#workspace').click();await planner().locator('#setup').click();await planner().locator('#rules').click();
      const sheet=planner().locator('#settings-sheet');
      for(const [name,value]of[['open','9'],['close','17'],['minimum','1'],['capacity','4']])await sheet.locator('[name='+name+']').fill(value);
      await sheet.locator('button.primary').click();
    });
    const month=await planner().locator('#app').getAttribute('data-haptic-month');
    let personId;
    const edit=async state=>{
      await planner().locator('#schedule-edit-day:enabled').click();
      const control=planner().locator('[data-status-person]').first();personId=await control.getAttribute('data-status-person');
      await control.selectOption(state);await planner().locator('.day-commit button.primary').click();
    };
    const stateText=()=>planner().locator('.additional-person[data-person="'+personId+'"] strong');
    const saved=()=>page.waitForFunction(()=>document.querySelector('.sc-draft-controls')?.textContent.includes('Draft saved for this month.'));
    let first;
    await check('actual edit save remount reload matches the response projection and passes host hydration verification',async()=>{
      await edit('Off');await page.getByRole('button',{name:'Save draft',exact:true}).click();await saved();
      first=await stored(month);assert.equal(first.revision,1);assert.equal(first.counts.audit,1);assert.equal(first.published,0);
      await page.locator('.sc-close').click();await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
      await page.locator('.sc-toggle:visible').first().click();await planner().locator('#app').waitFor();
      await page.waitForFunction(()=>document.querySelector('[data-draft-state]')?.dataset.draftState==='ready');
      assert.equal(await stateText().innerText(),'Off');
      await page.getByRole('status').filter({hasText:'Draft loaded for this month.'}).waitFor();
      assert.deepEqual(readPayloads.at(-1).result.schedule,first.projection);
      // This status is reached only after the real binding re-exports the
      // hydrated editor and verifies exact projection equality internally.
      assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
    });
    await check('independently verified committed response hold acknowledges only submitted changes',async()=>{
      await edit('Unknown');fault='hold';faultReached=null;
      await page.getByRole('button',{name:'Save draft',exact:true}).click();await waitFor(()=>faultReached,'held committed save');
      assert.equal(faultReached.observed.revision,2);await edit('Off');held();held=null;
      await page.waitForFunction(()=>document.querySelector('.sc-draft-controls')?.textContent.includes('Local changes are not saved.'));
      assert.equal(await stateText().innerText(),'Off');assert.equal((await stored(month)).revision,2);
      await page.getByRole('button',{name:'Save draft',exact:true}).click();await saved();assert.equal((await stored(month)).revision,3);
    });
    await check('commit then lost response retries identical command and creates no duplicate version or audit',async()=>{
      await edit('Unknown');fault='drop';faultReached=null;
      await page.getByRole('button',{name:'Save draft',exact:true}).click();await waitFor(()=>faultReached,'lost committed response');
      await page.getByRole('button',{name:'Retry same save',exact:true}).waitFor({state:'visible'});
      const committed=await stored(month),body=faultReached.body;assert.equal(committed.revision,4);
      await page.getByRole('button',{name:'Retry same save',exact:true}).click();await saved();
      assert.equal(manualRequests.at(-1).serializedBody,body);assert.deepEqual(await stored(month),committed);
      assert.equal(db.checks.at(-1).replayed,true);
    });
    await check('real competing request causes conflict while local changes remain and loser adds no history',async()=>{
      const before=await stored(month),projection=structuredClone(before.projection);projection.store.people[0].name+=' concurrent';
      const token=[...issuedTokens].at(-1);
      const other=await fetch(base+'/api/scheduler',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify({op:'save',storeId:'sage-demo',month,requestId:'probe_competing_save',input:{baseRev:before.revision,draft:projection}})});
      assert.equal(other.status,200);const winner=await stored(month);await edit('Off');
      await page.getByRole('button',{name:'Save draft',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-draft-state]')?.dataset.draftState==='conflict');
      assert.equal(await stateText().innerText(),'Off');const after=await stored(month);assert.equal(after.revision,5);assert.equal(after.counts.audit,5);assert.deepEqual(after,winner);
    });
    await check('late committed response cannot mutate a successor after actual store authorization retirement',async()=>{
      acceptDialogs=true;await page.locator('.sc-close').click();acceptDialogs=false;
      await page.locator('.sc-toggle:visible').first().click();await planner().locator('#app').waitFor();
      await page.waitForFunction(()=>document.querySelector('[data-draft-state]')?.dataset.draftState==='ready');
      await edit('Off');fault='hold';faultReached=null;
      await page.getByRole('button',{name:'Save draft',exact:true}).click();await waitFor(()=>faultReached,'late committed response');
      profilePatch={role:'manager',stores:['another-store']};await announce('TOKEN_REFRESHED');
      await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
      profilePatch=null;await announce('TOKEN_REFRESHED');
      await page.locator('.sc-toggle:visible:enabled').first().waitFor();await page.locator('.sc-toggle:visible').first().click();
      await planner().locator('#app').waitFor();await page.waitForFunction(()=>document.querySelector('[data-draft-state]')?.dataset.draftState==='ready');
      await edit('Unknown');
      await page.waitForFunction(()=>document.querySelector('.sc-draft-controls')?.textContent.includes('Local changes are not saved.'));
      const before=await page.locator('.sc-draft-controls').innerText(),requestCount=manualRequests.length;
      const oldId=JSON.parse(faultReached.body).requestId;
      await waitFor(()=>httpOutcomes.has(oldId),'retired request browser settlement');
      held();held=null;await waitFor(()=>faultReached.serverCompleted,'retired handler completion');
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await stateText().innerText(),'Unknown');assert.equal(await page.locator('.sc-draft-controls').innerText(),before);
      assert.equal(manualRequests.length,requestCount);db.retiredRequest=httpOutcomes.get(oldId);
      await announce('SIGNED_OUT');await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
      assert.equal(await page.locator('.sc-draft-controls').count(),0);
    });
  }else{

  await check('actual calendar connects only in the explicitly selected local build',async()=>{
    await page.locator('.sc-toggle:visible').first().click();await page.locator('.sc-planner-dialog').waitFor();
    await page.frameLocator('iframe[title="Schedule editor"]').locator('#app [data-view-switch]:visible').waitFor();
    await page.locator('.sc-draft-controls').waitFor();
    await page.getByRole('status').filter({hasText:'Draft not loaded.'}).waitFor();
    assert.ok(manualRequests.length>0);assert.ok(manualRequests.every(r=>r.action==='load'&&r.storeId==='sage-demo'&&r.hasBearer));
    assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
    assert.doesNotMatch(await page.locator('.sc-draft-controls').innerText(),/Draft saved/);
  });
  const planner=()=>page.frameLocator('iframe[title="Schedule editor"]');
  await check('repeated load clicks share a request and unavailable never means empty',async()=>{
    const before=manualRequests.length;
    await page.getByRole('button',{name:'Load draft',exact:true}).evaluate(e=>{e.click();e.click();});
    await page.getByRole('button',{name:'Load draft',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(count=>document.querySelector('[data-draft-state]')?.dataset.draftState==='unavailable',before);
    assert.equal(manualRequests.length,before+1);
    assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  });
  await check('manager edits survive unavailable storage and responsive detach without a save claim',async()=>{
    await planner().locator('#workspace').click();await planner().locator('#setup').click();await planner().locator('#rules').click();
    const sheet=planner().locator('#settings-sheet');
    for(const [name,value]of[['open','9'],['close','17'],['minimum','1'],['capacity','4']])await sheet.locator(`[name=${name}]`).fill(value);
    await sheet.locator('button.primary').click();await planner().locator('#schedule-edit-day:enabled').click();
    const status=planner().locator('[data-status-person]').first(),personId=await status.getAttribute('data-status-person');await status.selectOption('Off');
    await planner().locator('.day-commit button.primary').click();
    const applied=()=>planner().locator(`.additional-person[data-person="${personId}"] strong`);
    assert.equal(await applied().innerText(),'Off');
    for(const width of [701,700,390,1280]){await page.setViewportSize({width,height:844});assert.equal(await applied().innerText(),'Off');}
    assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
    assert.equal(manualRequests.some(r=>r.action!=='load'),false);
    await page.locator('.sc-close').click();assert.equal(await page.locator('.sc-planner-dialog').isVisible(),true,'declining discard preserves the draft');
    assert.equal(await planner().locator('.timeline-event').count(),0,'no hours fabricated by local connection');
  });
  await check('active month follows actual editor view rather than the extra today summary',async()=>{
    await planner().locator('[data-view-switch]:visible').selectOption('month');
    const before=await planner().locator('#app').getAttribute('data-haptic-month');
    await planner().locator('#next').click();
    const month=await planner().locator('#app').getAttribute('data-haptic-month');assert.notEqual(month,before);
    await page.waitForFunction(month=>document.querySelector('[data-draft-state]')?.dataset.draftState==='unavailable'&&document.querySelector('.sc-draft-controls p')?.textContent.startsWith(new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'})),month);
    assert.equal(manualRequests.at(-1).month,month);
    assert.equal(manualRequests.some(r=>r.action!=='load'),false);
  });
  await check('store authorization retirement removes connection and attempted values',async()=>{
    profilePatch={role:'manager',stores:['another-store']};await announce('TOKEN_REFRESHED');
    await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
    assert.equal(await page.locator('.sc-draft-controls').count(),0);assert.equal(await page.locator('iframe[title="Schedule editor"]').count(),0);
    assert.equal(await page.locator('#root').getAttribute('inert'),null);
    await announce('SIGNED_OUT');assert.equal(manualRequests.some(r=>r.action!=='load'),false);
  });
  }
  assert.deepEqual(blocked,[],'all requests stayed on the selected local origins');assert.deepEqual(errors,[],'no browser exceptions');
  if(DB_MODE!=='postgres')console.log('BLOCKED database composition: unavailable-mode HTTP controls do not select a real database. No save/remount/reload, lost-response or conflict database pass is claimed.');
  process.exitCode=DB_MODE==='postgres'?0:2;
}catch(error){
  if(page){fs.writeFileSync(path.join(EVIDENCE,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(EVIDENCE,'failure.png')}).catch(()=>{});}
  fs.writeFileSync(path.join(EVIDENCE,'failure.txt'),String(error.stack||error));console.error('FAIL '+step+'\n'+String(error.stack||error));process.exitCode=String(error.message).startsWith('BLOCKED:')?2:1;
}finally{
  held?.();held=null;
  for(const cleanup of [()=>browser?.close(),()=>new Promise(r=>server?server.close(r):r()),()=>mock?.kill()]){
    try{await cleanup();}catch(error){errors.push('teardown: '+String(error));process.exitCode=1;}
  }
  try{await cleanupDatabase();}catch(error){process.exitCode=1;fs.writeFileSync(path.join(EVIDENCE,'cleanup-failure.txt'),String(error.stack||error));}
  if(db)fs.writeFileSync(path.join(EVIDENCE,'database.json'),JSON.stringify(db,null,2));
  fs.writeFileSync(path.join(EVIDENCE,'result.json'),JSON.stringify({enabled:ENABLED,localDraft:true,databaseComposition:DB_MODE==='postgres'&&process.exitCode===0?'passed':process.exitCode===1?'failed':'blocked',database:db||null,neverRun:DB_MODE!=='postgres'?['real database save/remount/reload','database lost-response replay','database concurrent conflict']:DB_CHECKS.filter(name=>!attempted.includes(name)),step,attempted,results,blocked,errors,requests,manualRequests},null,2));
}

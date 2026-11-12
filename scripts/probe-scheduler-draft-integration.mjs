// Actual local-only draft entry and HTTP refusal. No persistence replacement.
// Database success cases remain blocked until the reviewed local backend is available.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
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
const results=[],blocked=[],errors=[],requests=[];
let browser,server,mock,page,step='startup';
let profilePatch=null;
const check=async(name,fn)=>{step=name;await fn();results.push(name);console.log('PASS '+name);};
const reachable=async()=>{try{await fetch(MOCK+'/auth/v1/user');return true;}catch{return false;}};
try{
  assert.equal(await reachable(),false,'5433 must be free for this isolated mock');
  mock=spawn(process.execPath,['scripts/mock-supabase.mjs'],{cwd:ROOT,stdio:'ignore'});
  for(let i=0;i<60&&!await reachable();i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await reachable(),true,'local mock started');
  const {build}=await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  Object.assign(process.env,{VITE_SUPABASE_URL:MOCK,VITE_SUPABASE_ANON_KEY:'synthetic-anon',VITE_SCHEDULER_CALENDAR:'1',VITE_SCHEDULER_DRAFT_LOCAL:'1'});
  const dist=path.join(EVIDENCE,'dist');
  await build({root:ROOT,mode:'scheduler-local-test',logLevel:'error',build:{outDir:dist,emptyOutDir:true}});
  const bundle=fs.readdirSync(path.join(dist,'assets')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(dist,'assets',f),'utf8')).join('\n');
  assert.ok(bundle.includes(MOCK));assert.ok(!bundle.includes('dydfevdnpppvxgdptiwv'));
  server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://local');let file=path.resolve(dist,'.'+decodeURIComponent(u.pathname));
    if(u.pathname==='/__probe-blank'){res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Synthetic auth event</title>');return;}
    if(!file.startsWith(dist+path.sep))file='';
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
    if(url.origin===MOCK&&url.pathname==='/auth/v1/token')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session(SID))});
    if(url.origin===MOCK&&url.pathname==='/rest/v1/profiles'&&request.method()==='GET'&&profilePatch){
      const response=await route.fetch(),body=await response.json();
      return route.fulfill({response,body:JSON.stringify(Array.isArray(body)?body.map(value=>({...value,...profilePatch})):{...body,...profilePatch})});
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/,socket=>{if(new URL(socket.url()).origin.replace(/^ws/,'http')!==MOCK)blocked.push(socket.url());socket.close();});
  page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));page.on('dialog',dialog=>dialog.dismiss());
  const announce=async event=>{
    const other=await context.newPage();await other.goto(base+'/__probe-blank');
    await other.evaluate(([event,s])=>{if(s)localStorage.setItem('lpc-auth',JSON.stringify(s));else localStorage.removeItem('lpc-auth');const channel=new BroadcastChannel('lpc-auth');channel.postMessage({event,session:s});channel.close();},[event,event==='SIGNED_OUT'?null:session(SID)]);
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
  assert.deepEqual(blocked,[],'all requests stayed on the selected local origins');assert.deepEqual(errors,[],'no browser exceptions');
  console.log('BLOCKED database composition: PostgreSQL tools, pg and reviewed local backend are unavailable. No save/remount/reload, lost-response or conflict database pass is claimed.');
  process.exitCode=2;
}catch(error){
  if(page){fs.writeFileSync(path.join(EVIDENCE,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(EVIDENCE,'failure.png')}).catch(()=>{});}
  fs.writeFileSync(path.join(EVIDENCE,'failure.txt'),String(error.stack||error));console.error('FAIL '+step+'\n'+String(error.stack||error));process.exitCode=1;
}finally{
  fs.writeFileSync(path.join(EVIDENCE,'result.json'),JSON.stringify({enabled:ENABLED,localDraft:true,databaseComposition:'blocked',neverRun:['real database save/remount/reload','database lost-response replay','database concurrent conflict'],step,results,blocked,errors,requests,manualRequests},null,2));
  await browser?.close();await new Promise(r=>server?server.close(r):r());mock?.kill();
}

// Actual app entry with synthetic localhost data. No hosted service is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MOCK='http://127.0.0.1:5433';
const ENABLED=process.env.PROBE_SCHEDULER_FLAG!=='0';
const EVIDENCE=path.resolve(process.env.PROBE_EVIDENCE_DIR||path.join(ROOT,'../entry-probe'));
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
  Object.assign(process.env,{VITE_SUPABASE_URL:MOCK,VITE_SUPABASE_ANON_KEY:'synthetic-anon',VITE_SCHEDULER_CALENDAR:ENABLED?'1':'0'});
  const dist=path.join(EVIDENCE,'dist');
  await build({root:ROOT,logLevel:'error',build:{outDir:dist,emptyOutDir:true}});
  const bundle=fs.readdirSync(path.join(dist,'assets')).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(path.join(dist,'assets',f),'utf8')).join('\n');
  assert.ok(bundle.includes(MOCK));assert.ok(!bundle.includes('dydfevdnpppvxgdptiwv'));
  server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://local');let file=path.resolve(dist,'.'+decodeURIComponent(u.pathname));
    if(u.pathname==='/__probe-blank'){res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>Synthetic auth event</title>');return;}
    if(!file.startsWith(dist+path.sep))file='';
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
  if(ENABLED){
  await check('accepted editor opens through actual calendar entry',async()=>{
    await page.locator('.sc-toggle:visible').first().click();await page.locator('.sc-planner-dialog').waitFor();
    await page.frameLocator('iframe[title="Schedule editor"]').locator('#app [data-view-switch]:visible').waitFor();
    assert.match(await page.locator('.sc-dialog-bar').innerText(),/Not saved/);
    assert.equal(await page.locator('.sc-close').evaluate(e=>document.activeElement===e),true);
    assert.equal(await page.locator('#root').getAttribute('inert')!==null,true);
  });
  const planner=()=>page.frameLocator('iframe[title="Schedule editor"]');
  await check('actual roster and unknown hours stay honest',async()=>{
    const text=await planner().locator('#app').innerText();
    assert.match(text,/unknown|unverified|unavailable/i);assert.doesNotMatch(text,/Fictional|Stale Sam/);
    assert.equal(await planner().locator('.timeline-event').count(),0,'no invented full-day work');
    await page.screenshot({path:path.join(EVIDENCE,'desktop-entry.png')});
  });
  await check('responsive entry detach retains same editor',async()=>{
    const before=await planner().locator('#period-heading').innerText();
    for(const width of [701,700,390,1280,700,1280]){await page.setViewportSize({width,height:900});await page.waitForTimeout(150);assert.equal(await page.locator('iframe[title="Schedule editor"]').count(),1);assert.equal(await planner().locator('#period-heading').innerText(),before);}
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(EVIDENCE,'phone-entry.png')});
    const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(size.scroll<=size.width+1,'no horizontal page scroll');
  });
  await check('manager enters explicit local rules and Off without inventing work',async()=>{
    await page.setViewportSize({width:1280,height:900});
    await planner().locator('#workspace').click();await planner().locator('#setup').click();await planner().locator('#rules').click();
    const sheet=planner().locator('#settings-sheet');
    for(const [name,value] of [['open','9'],['close','17'],['minimum','1'],['capacity','4']])await sheet.locator(`[name=${name}]`).fill(value);
    for(const width of [700,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await sheet.locator('[name=open]').inputValue(),'9');}
    await page.locator('.sc-close').click();assert.equal(await page.locator('.sc-planner-dialog').isVisible(),true,'pending edits veto close when discard is declined');
    await sheet.locator('button.primary').click();await planner().locator('#schedule-edit-day:enabled').click();
    const status=planner().locator('[data-status-person]').first(),personId=await status.getAttribute('data-status-person');await status.selectOption('Off');
    await planner().locator('.day-commit button.primary').click();
    const applied=()=>planner().locator(`.additional-person[data-person="${personId}"] strong`);
    assert.equal(await applied().innerText(),'Off');
    assert.equal(await planner().locator('.timeline-event').count(),0,'entering rules and Off does not infer working shifts');
    await page.setViewportSize({width:390,height:844});await page.setViewportSize({width:1280,height:900});
    assert.equal(await applied().innerText(),'Off','applied local choice survives responsive crossing');
    await page.locator('.sc-close').click();assert.equal(await page.locator('.sc-planner-dialog').isVisible(),true,'applied unsaved draft also vetoes declined discard');
    assert.equal(requests.some(r=>r.path==='/api/scheduler-manual'||r.path==='/api/scheduler'),false,'no persistence activation');
  });
  await check('explicit close and reopen do not duplicate editor',async()=>{
    page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.accept());
    await page.locator('.sc-close').click();await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
    page.on('dialog',dialog=>dialog.dismiss());
    await page.locator('.sc-toggle:visible').first().click();await planner().locator('#app [data-view-switch]:visible').waitFor();assert.equal(await page.locator('iframe[title="Schedule editor"]').count(),1);
  });
  await check('same-session store revocation and inactive profile retire private editor and unlock app',async()=>{
    for(const revoked of [{role:'manager',stores:['another-store']},{active:false}]){
      profilePatch=revoked;await announce('TOKEN_REFRESHED');
      await page.locator('.sc-planner-dialog').waitFor({state:'detached'});
      assert.equal(await page.locator('#root').getAttribute('inert'),null);assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
      profilePatch=null;await announce('TOKEN_REFRESHED');
      await page.locator('.sc-toggle:visible:enabled').first().waitFor({timeout:30000});
      await page.locator('.sc-toggle:visible').first().click();await planner().locator('#app [data-view-switch]:visible').waitFor();
      assert.equal(await planner().locator('.timeline-event').count(),0,'retired local attempts do not resurface');
    }
  });
  await check('auth event retires editor synchronously without replay',async()=>{
    const writes=requests.filter(r=>['POST','PATCH','DELETE'].includes(r.method)&&!r.path.startsWith('/auth/')).length;
    await announce('SIGNED_OUT');
    await page.locator('.sc-planner-dialog').waitFor({state:'detached'});assert.equal(await page.locator('iframe[title="Schedule editor"]').count(),0);
    assert.equal(requests.filter(r=>['POST','PATCH','DELETE'].includes(r.method)&&!r.path.startsWith('/auth/')).length,writes);
  });
  }
  assert.deepEqual(blocked,[],'all traffic remains localhost');assert.deepEqual(errors,[],'no browser exceptions');
}catch(error){
  if(page){fs.writeFileSync(path.join(EVIDENCE,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(EVIDENCE,'failure.png')}).catch(()=>{});}
  fs.writeFileSync(path.join(EVIDENCE,'failure.txt'),String(error.stack||error));console.error('FAIL '+step+'\n'+String(error.stack||error));process.exitCode=1;
}finally{
  fs.writeFileSync(path.join(EVIDENCE,'result.json'),JSON.stringify({enabled:ENABLED,step,results,blocked,errors,requests},null,2));
  await browser?.close();await new Promise(r=>server?server.close(r):r());mock?.kill();
}

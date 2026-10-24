import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFileSync,writeFileSync,readdirSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {checkArguments,checkSandbox} from './checks.mjs';
const out='/evidence';
const result={at:new Date().toISOString(),scope:'synthetic capability only',status:'FAIL',phase:'runtime',unexpectedRequests:[],versions:{node:process.version,execPath:process.execPath},uid:process.getuid(),gid:process.getgid()};
let browser,server;
try {
 assert.equal(process.version,'v22.23.4');assert.equal(process.execPath,'/node/bin/node');assert.notEqual(process.getuid(),0);
 const pwuser=readFileSync('/etc/passwd','utf8').split('\n').find(s=>s.startsWith('pwuser:'))?.split(':');assert.ok(pwuser);assert.equal(process.getuid(),Number(pwuser[2]));assert.equal(process.getgid(),Number(pwuser[3]));
 result.versions.playwright=JSON.parse(readFileSync(new URL('./node_modules/playwright-core/package.json',import.meta.url),'utf8')).version;assert.equal(result.versions.playwright,'1.63.0');
 result.apparmor=readFileSync('/proc/self/attr/current','utf8').trim();
 assert.match(result.apparmor,/^docker-default \(enforce\)$/);
 result.interfaces=readdirSync('/sys/class/net');assert.deepEqual(result.interfaces,['lo']);
 result.capEff=readFileSync('/proc/self/status','utf8').match(/^CapEff:\s*(\w+)/m)?.[1];assert.equal(BigInt('0x'+result.capEff),0n);
 result.routes=readFileSync('/proc/net/route','utf8').trim();assert.equal(result.routes.split('\n').length,1);
 const profile=readFileSync('/input/seccomp.json');
 result.seccompSHA256=createHash('sha256').update(profile).digest('hex');assert.equal(result.seccompSHA256,'cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849');
 // No DNS or real provider destination. Absence of an interface/route is the primary isolation evidence.
 result.nodeNegative=await new Promise(resolve=>{const s=connect({host:'192.0.2.1',port:443});s.setTimeout(1500);s.on('connect',()=>{s.destroy();resolve('CONNECTED');});s.on('error',e=>resolve(e.code));s.on('timeout',()=>{s.destroy();resolve('TIMEOUT');});});
 assert.notEqual(result.nodeNegative,'CONNECTED');
 result.phase='build';
 const html='<!doctype html><meta charset="utf-8"><title>Synthetic capability canary</title><h1>Fictional store</h1><button id="publish">Publish sample</button><p id="status">Draft</p><script>document.querySelector("button").onclick=()=>document.querySelector("#status").textContent="Published sample"</script>';
 writeFileSync('/tmp/canary.html',html);
 let hits=0;server=createServer((req,res)=>{if(req.url!=='/'&&req.url!=='/favicon.ico'){res.writeHead(404);res.end();return;}hits++;res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'self'; base-uri 'none'; frame-src 'none'");res.end(html);});
 await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
 assert.match(await (await fetch('http://127.0.0.1:4173/')).text(),/Fictional store/);
 result.phase='sandbox-launch';
 browser=await chromium.launch({channel:'chromium',chromiumSandbox:true,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']});
 result.versions.chromium=browser.version();
 const session=await browser.newBrowserCDPSession();
 result.arguments=(await session.send('Browser.getBrowserCommandLine')).arguments;checkArguments(result.arguments);
 result.chromiumBinarySHA256=createHash('sha256').update(readFileSync(result.arguments[0])).digest('hex');
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:800,height:600}});
 let intentionalNegative=false;
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin==='http://127.0.0.1:4173')return route.continue();
  if(intentionalNegative&&u.href==='http://192.0.2.1:4173/')return route.continue();
  result.unexpectedRequests.push(u.origin+u.pathname);return route.abort('blockedbyclient');
 });
 await context.routeWebSocket('**/*',ws=>{result.unexpectedRequests.push('websocket:'+new URL(ws.url()).origin);ws.close();});
 const page=await context.newPage();result.phase='sandbox-verdict';
 await page.goto('chrome://sandbox');
 result.sandboxText=await page.locator('body').innerText();
 const rows=await page.locator('tr').evaluateAll(rows=>rows.map(r=>[...r.querySelectorAll('td')].map(c=>c.textContent)));
 result.sandbox=checkSandbox(rows);
 result.phase='visible-page';await page.goto('http://127.0.0.1:4173/');
 assert.equal(await page.locator('h1').innerText(),'Fictional store');assert.equal(await page.locator('#status').innerText(),'Draft');
 await page.locator('button').click();assert.equal(await page.locator('#status').innerText(),'Published sample');
 await page.screenshot({path:out+'/synthetic-page.png'});assert.ok(hits>=2);result.localRequests=hits;
 // Inspect actual child process flags as well; no environment or user data is read.
 result.processes=[];
 for(const pid of readdirSync('/proc').filter(x=>/^\d+$/.test(x)))try{
  const args=readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean);
  if(args[0]===result.arguments[0]||args.some(a=>/^--type=(renderer|zygote|gpu-process|utility)/.test(a))){checkArguments(args);result.processes.push({pid:Number(pid),args});}
 }catch(e){if(e.code!=='ENOENT'&&e.code!=='EACCES')throw e;}
 assert.ok(result.processes.some(p=>p.args.includes('--type=renderer')),'no renderer process evidence');
 result.phase='browser-network-negative';intentionalNegative=true;
 try{await page.goto('http://192.0.2.1:4173/',{timeout:3000});throw Error('External request unexpectedly succeeded');}
 catch(e){assert.match(e.message,/ERR_NETWORK_UNREACHABLE|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_TIMED_OUT|Timeout/);result.browserNegative=e.message.split('\n')[0];}
 intentionalNegative=false;assert.deepEqual(result.unexpectedRequests,[]);
 assert.ok(existsSync(out+'/synthetic-page.png'));result.phase='complete';result.status='PASS';
}catch(e){result.error=String(e.stack||e);process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));writeFileSync(out+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,phase:result.phase,error:result.error?.split('\n')[0]}));}

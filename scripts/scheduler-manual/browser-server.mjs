import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixtureSession} from './browser-fixture.mjs';
export async function serveManualFixture({dist,handler}){
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
   const origin=`http://127.0.0.1:${server.address().port}`;
   if(req.headers.host!==new URL(origin).host)return reply(400,{error:'host'});
   if(req.headers.origin&&req.headers.origin!==origin)return reply(403,{error:'origin'});
   const url=new URL(req.url,origin);
   if(url.pathname==='/api/scheduler-manual'){
    if(req.method!=='POST')return reply(405,{error:'method'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1048576)return reply(413,{error:'size'});}
    const adapter={setHeader:(k,v)=>res.setHeader(k,v),status:n=>{adapter.statusCode=n;return adapter;},json:value=>reply(adapter.statusCode||200,value)};
    return await handler({method:req.method,headers:req.headers,query:Object.fromEntries(url.searchParams),body},adapter);
   }
   if(req.method!=='GET')return reply(405,{error:'method'});
   if(url.pathname==='/fixture'){
    const kind=url.searchParams.get('kind');if(!['manager','employee','pending'].includes(kind))return reply(400,{error:'fixture'});
    return reply(200,{kind,session:fixtureSession(kind)});
   }
   const pathname=decodeURIComponent(url.pathname),file=path.resolve(dist,pathname==='/'?'index.html':'.'+pathname);
   if(!file.startsWith(path.resolve(dist)+path.sep))return reply(404,{error:'missing'});
   const body=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{if(!res.headersSent)reply(500,{error:'fixture-failed'});else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

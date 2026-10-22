import test from 'node:test';
import assert from 'node:assert/strict';
import {versionNumber,postgresPreflight} from './browser-postgres.mjs';
test('preflight requires non-root PG16 matching server and client versions',async()=>{
 assert.equal(versionNumber('postgres (PostgreSQL) 16.15 (Ubuntu)'),160015);
 for(const value of ['postgres (PostgreSQL) 17.11','psql 16.15','postgres (PostgreSQL) 15.1'])assert.throws(()=>versionNumber(value));
 const run=async(file,args)=>({stdout:file.endsWith('dpkg-query')?'/usr/lib/postgresql/16/bin/postgres\n':file+' (PostgreSQL) 16.15'});
 assert.deepEqual(await postgresPreflight({run,canonical:async x=>x,uid:1001}),{bin:'/usr/lib/postgresql/16/bin',version:160015,uid:1001});
 await assert.rejects(postgresPreflight({run,uid:0}),/non-root-required/);
 await assert.rejects(postgresPreflight({run:async()=>({stdout:''}),uid:1001}),/postgres-server-package-required/);
 await assert.rejects(postgresPreflight({run,canonical:async()=>'/other/postgres',uid:1001}),/unexpected-binary-location/);
 await assert.rejects(postgresPreflight({run:async(file,args)=>file.endsWith('psql')?{stdout:'psql (PostgreSQL) 16.14'}:run(file,args),canonical:async x=>x,uid:1001}),/postgres-tools-version-mismatch/);
});

import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {serveManualFixture} from './browser-server.mjs';
test('HTTP bridge refuses foreign origin, queries reach handler, and no mutation fixture route exists',async()=>{
 const dist=await mkdtemp('/tmp/sage-manual-http-');let calls=0;
 const server=await serveManualFixture({dist,handler:async(req,res)=>{calls++;assert.equal(req.query.bad,'1');return res.status(400).json({error:'invalid-request'});}});
 try{
  await writeFile(dist+'/index.html','synthetic');
  assert.equal((await fetch(server.url+'/api/scheduler-manual',{method:'POST',headers:{Origin:'https://invalid.example'},body:'{}'})).status,403);assert.equal(calls,0);
  assert.equal((await fetch(server.url+'/api/scheduler-manual?bad=1',{method:'POST',headers:{Origin:server.url},body:'{}'})).status,400);assert.equal(calls,1);
  assert.notEqual((await fetch(server.url+'/__fixture/setPending',{method:'POST',body:'true'})).status,200);
  assert.equal((await fetch(server.url+'/fixture?kind=unknown')).status,400);
  assert.equal((await fetch(server.url+'/api/scheduler-manual',{method:'POST',body:'x'.repeat(1048577)})).status,413);assert.equal(calls,1);
 }finally{await server.close();await rm(dist,{recursive:true});}
});

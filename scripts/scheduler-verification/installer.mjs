import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),root=process.env.SCHEDULER_POSTGRES_ROOT,bin=process.env.SCHEDULER_POSTGRES_BIN;
assert.match(root||'',/^\/tmp\/sage-scheduler-pg\.[A-Za-z0-9]+$/);assert.equal(fs.readFileSync(root+'/runner-marker','utf8'),root);
const env={PATH:process.env.PATH,HOME:root+'/home',LANG:'C'},args=['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',root+'/socket','-p','5432','-U','postgres','-d','scheduler_fixture'];
async function sql(q){return (await run(bin+'/psql',[...args,'-c',q],{env,timeout:20000,maxBuffer:1000000})).stdout.trim();}
const original=fs.readFileSync(new URL('../../supabase/reference/scheduler-failed-installation.sql',import.meta.url),'utf8'),revised=fs.readFileSync(new URL('../../supabase/reference/scheduler-draft-structure.sql',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'),'3352c45f69b13d78dd22cc3f4203e0912a20b69f8438dd4b5fa8c64325d6339d');
async function empty(){assert.equal(await sql("SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('scheduler_private','scheduler_gateway','scheduler_policy'))+(SELECT count(*) FROM pg_roles WHERE rolname IN ('scheduler_executor','scheduler_runtime'))+(SELECT count(*) FROM pg_policies WHERE policyname LIKE 'scheduler_draft_%')"),'0');}
test('non-superuser installer reproduces exact original SET ROLE failure and rollback',async()=>{
 assert.equal(await sql("SELECT current_user||':'||rolsuper||':'||rolcreaterole||':'||rolbypassrls FROM pg_roles WHERE rolname=current_user"),'postgres:false:true:true');
 assert.equal(await sql('SHOW createrole_self_grant'),'');await empty();
 await assert.rejects(sql(original),e=>/42501: must be able to SET ROLE "scheduler_executor"/.test(e.stderr));await empty();
});
test('unexpected self-grant setting fails closed without changing it',async()=>{
 await assert.rejects(sql("SET createrole_self_grant='set';"+revised),e=>/P0001: scheduler installer requires empty createrole_self_grant/.test(e.stderr));await empty();
});
test('membership alone is insufficient: new owner requires CREATE on gateway schema',async()=>{
 const withoutCreate=revised.replace('GRANT CREATE ON SCHEMA scheduler_gateway TO scheduler_executor;','');
 await assert.rejects(sql(withoutCreate),e=>/42501: permission denied for schema scheduler_gateway/.test(e.stderr));await empty();
});
test('failure after temporary grants and ownership transfer rolls all objects and memberships back',async()=>{
 const fault=revised.replace('REVOKE CREATE ON SCHEMA scheduler_gateway FROM scheduler_executor;',()=>"DO $$ BEGIN RAISE EXCEPTION 'synthetic-installer-fault';END $$;\nREVOKE CREATE ON SCHEMA scheduler_gateway FROM scheduler_executor;");
 await assert.rejects(sql(fault),e=>/P0001: synthetic-installer-fault/.test(e.stderr));await empty();
});
test('revised installer succeeds, preserves nonowner gateway boundary and leaves pilot disabled',async()=>{
 await sql(revised);
 assert.equal(await sql("SELECT bool_and(pg_get_userbyid(proowner)='scheduler_executor' AND prosecdef AND proconfig=ARRAY['search_path=\"\"']) FROM pg_proc WHERE pronamespace='scheduler_gateway'::regnamespace"),'t');
 assert.equal(await sql("SELECT count(*) FROM pg_proc WHERE pronamespace='scheduler_gateway'::regnamespace"),'5');
 assert.equal(await sql("SELECT has_schema_privilege('scheduler_executor','scheduler_gateway','CREATE')"),'f');
 assert.equal(await sql("SELECT pg_has_role(current_user,'scheduler_executor','SET')"),'f');
 assert.equal(await sql("SELECT pg_has_role(current_user,'scheduler_executor','USAGE')"),'f');
 assert.equal(await sql("SELECT bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreaterole) FROM pg_roles WHERE rolname IN ('scheduler_runtime','scheduler_executor')"),'t');
 assert.equal(await sql("SELECT bool_and(relowner<> 'scheduler_executor'::regrole) FROM pg_class WHERE relnamespace IN ('scheduler_private'::regnamespace,'scheduler_policy'::regnamespace)"),'t');
 assert.equal(await sql('SELECT (SELECT count(*) FROM scheduler_policy.pilot_scope)+(SELECT count(*) FROM scheduler_policy.draft_grants)'),'0');
 const memberships=await sql("SELECT COALESCE(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)),'[]') FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor WHERE r.rolname IN ('scheduler_runtime','scheduler_executor') OR m.rolname IN ('scheduler_runtime','scheduler_executor')");
 console.log('FINAL_MEMBERSHIPS '+memberships);
 for(const row of JSON.parse(memberships)){assert.equal(row.member,'postgres');assert.equal(row.admin,true);assert.equal(row.inherit,false);assert.equal(row.set,false);}
 for(const role of ['anon','authenticated','service_role'])assert.equal(await sql(`SELECT has_schema_privilege('${role}','scheduler_gateway','USAGE') OR has_schema_privilege('${role}','scheduler_private','USAGE') OR has_function_privilege('${role}','scheduler_gateway.scheduler_commit(jsonb,jsonb,jsonb,jsonb)','EXECUTE')`),'f');
});

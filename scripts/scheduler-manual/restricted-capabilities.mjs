// Trusted server pool only. No driver, environment, credential or pool creation.
const fail=code=>{throw Object.assign(Error(code),{code});};
const actor=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const store=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(x);
export function createRestrictedManualCapabilities({pool}={}){
 if(typeof pool?.connect!=='function')fail('storage-not-configured');
 async function one(text,values){
  let client;try{
   client=await pool.connect();await client.query('BEGIN');
   await client.query("SET LOCAL statement_timeout='5000ms';SET LOCAL lock_timeout='2000ms';SET LOCAL idle_in_transaction_session_timeout='8000ms'");
   const role=(await client.query("SELECT current_user AS role,session_user AS login,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
   if(role?.role!=='scheduler_runtime'||role.login!=='scheduler_runtime'||role.rolsuper!==false||role.rolbypassrls!==false)fail('storage-unavailable');
   const r=await client.query({text,values});
   if(r.rows?.length!==1||!Object.hasOwn(r.rows[0],'value'))fail('storage-unavailable');
   await client.query('COMMIT');return r.rows[0].value;
  }catch(e){
   if(e?.code==='P0001'&&e.message==='scheduler:forbidden')fail('forbidden');
   if(e?.code==='P0001'&&e.message==='capture:conflict')fail('conflict');
   fail('storage-unavailable');
  }finally{if(client)client.release(true);}
 }
 return Object.freeze({
  publishPermissionFor:async({actorId,storeId})=>{
   if(!actor(actorId)||!store(storeId))return false;
   const v=await one('SELECT scheduler_gateway.publication_permission_v1($1::uuid,$2::text) AS value',[actorId,storeId]);
   if(typeof v!=='boolean')fail('storage-unavailable');return v;
  },
  capturePortFor:({actorId,storeId,month})=>{
   if(!actor(actorId)||!store(storeId)||typeof month!=='string'||!/^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$/.test(month)||month<'2014-01')fail('invalid-request');
   const scope=s=>{if(s?.storeId!==storeId||s?.month!==month)fail('forbidden');};
   return Object.freeze({
    snapshot:s=>{scope(s);return one('SELECT scheduler_gateway.capture_snapshot_v2($1::uuid,$2::text,$3::text) AS value',[actorId,storeId,month]);},
    register:(expected,text)=>{scope(expected?.scope);return one('SELECT scheduler_gateway.register_capture_v2($1::uuid,$2::jsonb,$3::text) AS value',[actorId,JSON.stringify(expected),text]);},
    context:async id=>({contextText:await one('SELECT scheduler_gateway.capture_context_v2($1::uuid,$2::text,$3::text,$4::text) AS value',[actorId,storeId,month,id])}),
   });
  },
 });
}

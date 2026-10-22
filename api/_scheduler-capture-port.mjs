// Trusted injected query capability only. No pool, credentials, environment or grants.
// Deployment must supply an owner-isolated executor; never expose it as public RPC.
const fail=code=>{throw Object.assign(Error(code),{code});};
export function createSchedulerCapturePort({query}={}){
 if(typeof query!=='function')fail('storage-not-configured');
 async function one(text,values){
  let result;try{result=await query(text,values);}catch(e){
   if(e?.code==='P0001'&&['capture:conflict','manual-policy:conflict','manual-policy:idempotency-conflict'].includes(e.message))fail('conflict');
   fail('storage-unavailable');
  }
  if(!Array.isArray(result?.rows)||result.rows.length!==1||!Object.hasOwn(result.rows[0],'value'))fail('storage-unavailable');
  return result.rows[0].value;
 }
 return Object.freeze({
  snapshot:scope=>one('SELECT scheduler_private.capture_snapshot_v1($1::text,$2::text) AS value',[scope.storeId,scope.month]),
  register:(expected,text)=>one('SELECT scheduler_private.register_capture_v1($1::jsonb,$2::text) AS value',[JSON.stringify(expected),text]),
  context:async id=>({contextText:await one('SELECT context_text AS value FROM scheduler_private.publication_contexts_v2 WHERE context_id=$1::text',[id])}),
  // Owner maintenance only, never wired to the manager HTTP handler.
  putPolicy:({storeId,expected,replacement,requestId})=>one('SELECT scheduler_private.put_manual_policy_v1($1::text,$2::jsonb,$3::jsonb,$4::text) AS value',[storeId,expected===null?null:JSON.stringify(expected),JSON.stringify(replacement),requestId]),
 });
}

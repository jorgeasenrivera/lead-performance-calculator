import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, serviceKey, envGap } from './_env.mjs';
import { rowAddress, accountIsActive, storeDay } from './_floor-access.mjs';
import { roomProjection } from './_room-projection.mjs';
import { selfRoomCommand } from './_self-room-command.mjs';
import { stationGate, needsOverride } from './_station-gate.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST only'});
 let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'Bad JSON'});}
 const {store,room,date,action,input={},operationId}=b||{};
 const address=rowAddress(room,store,date);
 if(typeof store!=='string'||typeof date!=='string'||!address||!['floor','line','online'].includes(room)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||typeof operationId!=='string'||typeof action!=='string'||!uuid.test(String(operationId||''))||!input||typeof input!=='object'||Array.isArray(input))return res.status(400).json({error:'A supported command, date and operation ID are required'});
 const auth=String(req.headers.authorization||'');if(!auth.startsWith('Bearer '))return res.status(401).json({error:'Sign in first'});
 if(envGap())return res.status(503).json({error:'Room service unavailable'});
 const db=createClient(supabaseUrl(),serviceKey(),{auth:{persistSession:false}});
 try{
  const {data:who,error:authError}=await db.auth.getUser(auth.slice(7));if(authError||!who?.user)return res.status(401).json({error:'Sign in again'});
  const {data:profile,error:profileError}=await db.from('profiles').select('active').eq('id',who.user.id).maybeSingle();if(profileError)throw profileError;if(!accountIsActive(profile))return res.status(403).json({error:'Account inactive'});
  const {data:link,error:linkError}=await db.from('floor_people').select('person_id').eq('store',store).eq('user_id',who.user.id).maybeSingle();if(linkError)throw linkError;if(!link)return res.status(403).json({error:'Not linked to this store'});
  const {data:receipt,error:receiptError}=await db.rpc('sage_room_receipt',{p_actor:who.user.id,p_person:link.person_id,p_store:store,p_room:room,p_date:date,p_operation_id:operationId,p_request:{action,input}});
  if(receiptError)return res.status(receiptError.code==='42501'?403:receiptError.code==='22023'?409:500).json({error:'Room receipt unavailable'});
  if(receipt)return res.status(200).json({...receipt,row:roomProjection(receipt.row,link.person_id)});
  if(date!==storeDay())return res.status(400).json({error:'New room commands require today’s date'});
  const {data:cfg,error:cfgError}=await db.from('app_data').select('value').eq('key','lpc:config:v2').maybeSingle();if(cfgError||!cfg?.value)throw cfgError||new Error('Missing setup');
  const config=cfg.value,st=(config.stores||[]).find(s=>s.id===store);if(!st)return res.status(403).json({error:'Store unavailable'});
  const allowedTables=Array.isArray(st.floorPlan?.tables)&&st.floorPlan.tables.length?st.floorPlan.tables.map(t=>t.n):[...Array.from({length:14},(_,i)=>String(i+1)),'O1','O2','O3'];
  for(let attempt=0;attempt<3;attempt++){
   const {data:current,error}=await db.from(address.table).select('data,updated_at').eq('id',address.id).eq('store',store).eq(room==='floor'?'fdate':'qdate',date).maybeSingle();if(error)throw error;if(!current)return res.status(404).json({error:'Room unavailable'});
   let figures=null;
   if(['checkout','complete-checkout'].includes(action)){
    const {data:r,error:e}=await db.from('app_data').select('value').eq('key',`lpc:store:${store}:act:${date}`).maybeSingle();if(e)throw e;
    const person=(current.data.roster||[]).find(p=>p.id===link.person_id);figures=r?.value?.[norm(person?.name)]||null;
   }
   if(action==='take-desk'){
    const {data:r,error:e}=await db.from('app_data').select('value').eq('key',`lpc:store:${store}:v2`).maybeSingle();if(e||!r?.value)throw e||new Error('Missing figures');
    const person=(current.data.roster||[]).find(p=>p.id===link.person_id),month=date.slice(0,7);
    const gate=stationGate({stats:r.value.months?.[month]?.stats?.[norm(person?.name)]||null,standard:st.thresholds?.green??st.thresholds?.phone?.green??25,inGrace:Number(date.slice(8))<=(st.graceDays??10)});
    if(needsOverride(gate))return res.status(403).json({error:'The desk must approve this seat'});
   }
   const out=selfRoomCommand({room,row:current.data,personId:link.person_id,action,input,now:new Date().toISOString(),config,store,figures,standards:{minCalls:16,minVideos:2,...st.activityStandards},allowedTables});
   // Even a reducer no-op reaches the transaction for current authorization and replay checks.
   const {data:result,error:commitError}=await db.rpc('sage_room_commit',{p_actor:who.user.id,p_person:link.person_id,p_store:store,p_room:room,p_date:date,p_expected:current.updated_at,p_next:out.row,p_operation_id:operationId,p_request:{action,input}});
   if(!commitError)return res.status(200).json({...result,row:roomProjection(result.row,link.person_id)});
   if(commitError.code==='40001')continue;
   return res.status(commitError.code==='42501'?403:500).json({error:'Room command refused'});
  }
  return res.status(409).json({error:'Room changed. Try again.'});
 }catch(e){return res.status(e?.status===400?400:500).json({error:e?.status===400?e.message:'Room command unavailable'});}
}

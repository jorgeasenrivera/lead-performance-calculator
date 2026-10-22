// Adapt the existing authenticated draft transport without changing its retry/codec semantics.
export function manualDraftFetch(fetchImpl=fetch){
 return (url,init)=>{
  if(url!=='/api/scheduler'||init.method!=='POST')throw Error('Invalid draft route.');
  const r=JSON.parse(init.body);let command;
  if(r.op==='read'&&r.input?.kind==='draft')command={action:'load',storeId:r.storeId,month:r.month};
  else if(r.op==='save')command={action:'save',storeId:r.storeId,month:r.month,requestId:r.requestId,draft:r.input.draft,baseRev:r.input.baseRev};
  else throw Error('Invalid draft action.');
  return fetchImpl('/api/scheduler-manual',{...init,mode:'same-origin',body:JSON.stringify(command)});
 };
}

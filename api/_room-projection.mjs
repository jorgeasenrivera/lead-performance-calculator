/* Select fields at the privileged read boundary. Unknown fields stay private. */
const pick=(value,keys)=>Object.fromEntries(keys.flatMap(k=>{const v=value?.[k]; if(v===null||['string','number','boolean'].includes(typeof v))return [[k,v]]; if(['langs','skills','strengths'].includes(k)&&Array.isArray(v))return [[k,v.filter(x=>typeof x==='string')]]; return [];}));
const list=(value)=>Array.isArray(value)?value:[];
const own=(values,id,key='id')=>list(values).filter(x=>id&&x?.[key]===id);
export function roomProjection(row,person=null){
 if(!row)return null;
 const out=pick(row,['store','storeName','date']);
 out.roster=list(row.roster).map(p=>pick(p,['id','name','label','role','langs','skills','strengths','test']));
 out.line=list(row.line).map(p=>pick(p,['id','label','status','joinedAt','statusAt','movedAt','table',...(person&&p.id===person?['nudgedAt','awayReason','autoFlip','accidentalUntil']:[])]));
 out.checklist=list(row.checklist).map(x=>pick(x,['id','label','hint','from','target']));
 for(const key of ['stations','offers'])out[key]=Object.fromEntries(Object.entries(row[key]||{}).map(([k,v])=>[k,pick(v,key==='stations'?['id','label','at','seen']:['id','label','at','until'])]));
 out.sits=list(row.sits).map(x=>pick(x,x.id===person?['st','id','label','in','out','why']:['id','out']));
 out.assists=own(row.assists,person,'byId').map(x=>pick(x,['id','t','kind','byId','byName','table','spot','note','claimedBy','doneAt','cancelled']));
 out.checkouts=own(row.checkouts,person).map(x=>pick(x,['id','partial','who','name','t','calls','video','tasks','tasksPosted','units','rocked','points','asOf']));
 out.history=own(row.history,person).map(x=>pick(x,['id','t','action','from','who','by','detail','unverified','wasStatus']));
 out.goalNotes=own(row.goalNotes,person).map(x=>pick(x,['at','forDay','who','id','by','name','text','missed','of']));
 out.goalLifts=own(row.goalLifts,person).map(x=>pick(x,['at','forDay','who','id','by','why']));
 return out;
}

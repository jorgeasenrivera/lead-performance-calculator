import { validDate, minute, shiftProblem, storeTimezone } from './shift-intervals.mjs';
import { enteredMonth, validMonth } from './month-model.mjs';
const normalize = text => String(text).trim().normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
// Strict CSV: quoted commas/newlines and escaped quotes, with physical source line numbers.
export function csvRows(text) {
  if(text.length>100000)throw Error('Choose a CSV smaller than 100 KB.');
  text=text.replace(/^\uFEFF/,'');const rows=[];let cells=[],value='',quoted=false,closed=false,line=1,start=1;
  const cell=()=>{cells.push(value);value='';closed=false;};
  const row=()=>{cell();if(cells.some(c=>c.trim()))rows.push({line:start,cells});cells=[];start=line+1;if(rows.length>501)throw Error('Choose at most 500 schedule rows.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=c;if(c==='\n'||c==='\r'&&text[i+1]!=='\n')line++;}continue;}
    if(c==='"'){if(value||closed)throw Error(`Invalid quote on line ${line}.`);quoted=true;}
    else if(c===',')cell();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row();line++;}
    else {if(closed)throw Error(`Unexpected text after a quote on line ${line}.`);value+=c;}
  }
  if(quoted)throw Error('The CSV has an unfinished quoted cell.');
  if(value||cells.length||closed)row();return rows;
}
export function parseSchedule(text, file='schedule.csv') {
  const rows=csvRows(text);if(rows.length<2)throw Error('Add a header and at least one schedule row.');
  const headers=rows.shift().cells.map(normalize),allowed=['name','person id','date','end date','start','end','status','timezone'];
  if(new Set(headers).size!==headers.length || headers.some(h=>!allowed.includes(h)))throw Error('Use only Name, Person ID, Date, End Date, Start, End, Status and Timezone columns. Breaks and grids are unsupported.');
  if(!headers.includes('date')||!headers.includes('start')||!headers.includes('end')||(!headers.includes('name')&&!headers.includes('person id')))throw Error('Required columns: Name (or Person ID), Date, Start, End.');
  return rows.map(({line,cells},index)=>({index,source:{file,line},raw:Object.fromEntries(headers.map((h,i)=>[h,(cells[i]||'').trim()])),problem:cells.length!==headers.length?'Column count does not match the header.':null}));
}
export function importSnapshot(planner,index) {
  const store=planner.context(index,'2014-01-01').store;
  return JSON.stringify({revision:planner.revision,index,id:store.id,people:store.people,rules:store.rules,drafts:[...planner.drafts].filter(([key])=>key.startsWith(index+':'))});
}
const sameShift=(a,b)=>['storeId','personId','date','endDate','startMinute','endMinute','timezone'].every(k=>a[k]===b[k]);
export function reviewImport(planner,index,rows,choices={}) {
  const snapshot=importSnapshot(planner,index),candidates=new Map(),items=[];
  for(const row of rows){
    const raw=row.raw,context=planner.context(index,raw.date),store=context.store;
    const item={...row,storeId:store.id,personId:null,state:'blocked',messages:[]};items.push(item);
    if(row.problem)item.messages.push(row.problem);
    const exact=store.people.filter(p=>raw['person id'] ? p.id===raw['person id'] && (!raw.name || normalize(p.name)===normalize(raw.name)) : normalize(p.name)===normalize(raw.name||''));
    const selected=choices[row.index]?.personId;
    const person=Object.hasOwn(choices[row.index]||{},'personId') ? store.people.find(p=>p.id===selected) : exact.length===1 ? exact[0] : null;
    if(!person)item.messages.push('Choose a unique person in this store, or skip this row.');
    item.personId=person?.id;item.personName=person?.name;item.status=normalize(raw.status||'work');
    if(choices[row.index]?.skip){item.state='skipped';item.messages=[];continue;}
    if(!validDate(raw.date))item.messages.push('Use a real Date in YYYY-MM-DD, including the year.');
    const status=normalize(raw.status||'work');
    if(!['work','off'].includes(status))item.messages.push('Status must be work or off.');
    const zone=raw.timezone||storeTimezone(store);
    const endDate=raw['end date']||raw.date;
    if(zone!==storeTimezone(store))item.messages.push('Timezone does not match this store.');
    if(status==='off' && (raw.start||raw.end||endDate!==raw.date))item.messages.push('An off row must have blank times and the same end date.');
    const shift={storeId:store.id,personId:person?.id,date:raw.date,endDate,timezone:zone,startMinute:minute(raw.start||''),endMinute:minute(raw.end||''),source:row.source};
    if(status==='work'){const problem=shiftProblem(shift,store,raw.date);if(problem)item.messages.push(problem);}
    item.shift=status==='work'?shift:null;item.status=status;
    if(item.messages.length)continue;
    const record=structuredClone(candidates.get(raw.date)||context.record||{on:[],off:[]});record.on||=[];record.off||=[];record.shifts||=[];
    const existing=record.shifts.filter(s=>s.personId===person.id);
    if(status==='work' && existing.some(s=>sameShift(s,shift)) || status==='off' && record.off.includes(person.id)){item.state='duplicate';continue;}
    if(status==='off' && (record.on.includes(person.id)||existing.length))item.messages.push('Existing work conflicts with off. Keep it, or edit the day before importing.');
    if(status==='work' && record.off.includes(person.id))item.messages.push('This person is confirmed off. Edit the day first or skip this row.');
    if(status==='work' && record.on.includes(person.id)&&!existing.length)item.messages.push('A manual or fixture full-day assignment already exists. It will not be replaced.');
    if(status==='work' && existing.some(s=>shift.startMinute<s.endMinute && shift.endMinute>s.startMinute))item.messages.push('This interval overlaps an existing shift or another included row.');
    if(item.messages.length)continue;
    if(status==='work'){record.shifts.push(shift);record.on=[...new Set([...record.on,person.id])];}else record.off.push(person.id);
    candidates.set(raw.date,record);item.state='ready';
  }
  // A new interval can invalidate an existing shift under another month's cap.
  // Compare each affected date in its own monthly context, never choosing one cap for the week.
  const weekStart = day => { const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10); };
  const weeks=new Set([...candidates.keys()].map(weekStart)),affectedDays=new Set();
  for(const start of weeks)for(let offset=0;offset<7;offset++)affectedDays.add(new Date(new Date(start+'T12:00:00Z').getTime()+offset*86400000).toISOString().slice(0,10));
  const before=new Map(),after=new Map();
  for(const month of new Set([...affectedDays].map(d=>d.slice(0,7)).filter(validMonth))){
    for(const row of enteredMonth(month,day=>planner.context(index,day)))if(affectedDays.has(row.day))before.set(row.day,row);
    for(const row of enteredMonth(month,day=>{
      const context=planner.context(index,day);return {...context,record:candidates.get(day)||context.record};
    }))if(affectedDays.has(row.day))after.set(row.day,row);
  }
  const workItems=items.filter(i=>i.state==='ready'&&i.status==='work');
  for(const item of workItems){
    const reasons=after.get(item.raw.date)?.conflicts[item.personId]||[];
    if(reasons.length){item.state='blocked';item.messages.push(...reasons);}
  }
  for(const [day,row] of after)for(const [personId,reasons] of Object.entries(row.conflicts)){
    if(!before.get(day)?.ids.includes(personId))continue;
    const added=reasons.filter(reason=>!(before.get(day).conflicts[personId]||[]).includes(reason));
    if(!added.length)continue;
    for(const item of workItems.filter(i=>i.personId===personId&&weekStart(i.raw.date)===weekStart(day))){
      item.state='blocked';item.messages.push(`Existing assignment on ${day}: ${added.join('; ')}. Skip this row or resolve that assignment first.`);
    }
  }
  return {index,storeId:planner.context(index,'2014-01-01').store.id,snapshot,items,candidates,blocked:items.some(i=>i.state==='blocked'),applied:false};
}
export function applyImport(planner,review) {
  if(review.applied) return {changed:0,duplicate:true};
  if(importSnapshot(planner,review.index)!==review.snapshot)throw Error('The draft changed. Read and review the file again before applying.');
  if(review.blocked)throw Error('Resolve or skip every blocked row before applying.');
  // All validation precedes this synchronous, in-memory batch. No network or persistence.
  for(const [day,record] of review.candidates)planner.setAssignment(review.index,day,record);
  review.applied=true;return {changed:review.candidates.size,duplicate:review.candidates.size===0,firstDay:[...review.candidates.keys()].sort()[0]};
}

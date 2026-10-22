import {csvRows, parseSchedule} from './schedule-import.mjs';
import {validDate} from './shift-intervals.mjs';
import {nameKey} from './name-key.mjs';

const object = value => value && typeof value==='object' && !Array.isArray(value);
function scopeCheck(scope) {
  if(!scope?.storeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.month||''))throw Error('Choose a store and month before reviewing this source.');
}
function append(rows,raw,source,scope,problem=null,warnings=[]) {
  if(rows.length>=500)throw Error('This source expands beyond 500 person/date rows. Split it before review.');
  rows.push({index:rows.length,noAssertion:source.kind==='Team grid'&&source.originalCell==='',raw,source:{...source,storeId:scope.storeId,month:scope.month},scope:{...scope},membershipUnknown:true,problem,warnings});
}
export function legacyOffDays(text,file,scope) {
  scopeCheck(scope);if(text.length>100000)throw Error('Choose a source smaller than 100 KB.');
  const data=JSON.parse(text);
  if(!object(data))throw Error('Expected a saved off-days JSON object.');
  if(data.storeId && data.storeId!==scope.storeId || data.month && data.month!==scope.month)throw Error('Saved source store or month does not match this review.');
  if(Object.hasOwn(data,'off')&&Object.hasOwn(data,'daysOff'))throw Error('Choose one saved off-days source; off and daysOff cannot be combined implicitly.');
  const snapshot=object(data.off),off=snapshot?data.off:data.daysOff;
  if(!object(off))throw Error('Expected off or daysOff keyed by exact person ID.');
  const rows=[],warnings=['Only recorded off-days are known. Other dates, work hours and historical teams remain unknown. Legacy OFF/VAC does not identify vacation.'];
  for(const [id,dates] of Object.entries(off)) {
    if(!Array.isArray(dates)||dates.some(d=>typeof d!=='string'))throw Error('Each person ID must contain an array of dated off-days.');
    for(const date of dates)append(rows,{'person id':id,date,start:'',end:'',status:'legacy-off'},
      {file,line:rows.length+1,kind:'Legacy saved off-days',originalFile:typeof data.file==='string'?data.file:null,importedAt:typeof data.at==='string'?data.at:null,originalKind:typeof data.kind==='string'?data.kind:null,path:`${snapshot?'off':'daysOff'}.${id}`,absenceReason:'unknown'},scope,
      !validDate(date)||!date.startsWith(scope.month+'-')?'Date is invalid or outside the explicitly selected month. Split or correct this source; no dates are silently discarded.':null,warnings);
  }
  if(data.unmatched!==undefined && (!Array.isArray(data.unmatched)||data.unmatched.some(n=>typeof n!=='string')))throw Error('Saved unmatched identities must be a list of names.');
  for(const name of data.unmatched||[])append(rows,{name,date:'',start:'',end:'',status:'unknown'},{file,line:rows.length+1,kind:'Legacy unresolved identity'},scope,'Saved unmatched identity has no recoverable dates. Resolve in the source or explicitly skip.',warnings);
  if(!rows.length)throw Error('No recorded off-days or unresolved identities in this source.');
  return rows;
}
function gridDate(value) {
  if(validDate(value))return value;
  const us=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(us)return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  const words=value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const month=words?months.findIndex(m=>nameKey(words[1])===m||nameKey(words[1])===m.slice(0,3)):-1;
  return month>=0?`${words[3]}-${String(month+1).padStart(2,'0')}-${words[2].padStart(2,'0')}`:value;
}
function time(value) {
  const m=value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if(m && +m[1]>=1 && +m[1]<=12 && +(m[2]||0)<60)return `${String(+m[1]%12+(/pm/i.test(m[3])?12:0)).padStart(2,'0')}:${m[2]||'00'}`;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim())?value.trim():null;
}
export function teamGrid(text,file,scope) {
  scopeCheck(scope);const input=csvRows(text),header=input[0]?.cells.map(nameKey)||[];
  if(header[0]!=='date')throw Error('The bounded grid starts with Date, then optional Day / Store hours, Team A / Team B columns, and a legend to their right.');
  const teams=header.flatMap((h,column)=>/^team [a-z0-9]$/.test(h)?[{column,name:input[0].cells[column].trim(),key:h}]:[]);
  if(!teams.length||new Set(teams.map(t=>t.key)).size!==teams.length)throw Error('Use unique Team A style schedule columns.');
  const end=Math.max(...teams.map(t=>t.column));
  if(header.slice(1,end+1).some(h=>!['day','store hours',''].includes(h)&&!teams.some(t=>t.key===h)))throw Error('Unsupported columns inside the schedule grid.');
  const legends=new Map();let active=null;
  for(const row of input.slice(1)) {
    const cells=row.cells.slice(end+1).map(v=>v.trim());
    const heads=cells.flatMap((v,i)=>header[end+1+i]!=='notes'&&/^team [a-z0-9](?:\s|$)/i.test(v)?[{i,match:v.match(/^(team [a-z0-9])(?:\s+(.*))?$/i)}]:[]);
    if(heads.length>1)throw Error('Side-by-side or multiple legend headings require a simpler source for review.');
    if(heads.length){
      const {i,match}=heads[0],key=nameKey(match[1]);
      if(!teams.some(t=>t.key===key)||legends.has(key))throw Error('Unknown or repeated legend team.');
      active={key,column:end+1+i};legends.set(key,[]);
      if(match[2])legends.get(key).push({name:match[2],line:row.line});
      if(cells.slice(i+1).some(Boolean))throw Error('Ambiguous names beside a legend heading. Put each person on a separate legend row.');
    }else if(active){
      const names=row.cells.slice(active.column).filter((_,i)=>header[active.column+i]!=='notes').map(v=>v.trim()).filter(Boolean);
      if(names.length>1)throw Error('Ambiguous legend row. Use one exact person name per row.');
      if(names.length)legends.get(active.key).push({name:names[0],line:row.line});
    }
  }
  const rows=[];
  for(const row of input.slice(1)) {
    if(!row.cells[0]?.trim()){
      if(teams.some(t=>row.cells[t.column]?.trim()))throw Error('A team assignment row is missing its date.');
      continue;
    }
    const date=gridDate(row.cells[0].trim()),notes=header.indexOf('notes'),note=notes>=0?(row.cells[notes]||'').trim():'';
    for(const team of teams){
      const cell=(row.cells[team.column]||'').trim(),parts=cell.split(/\s*[-–]\s*/),start=parts.length===2?time(parts[0]):null,endTime=parts.length===2?time(parts[1]):null;
      const status=/^off$/i.test(cell)?'off':/^(vac|vacation)$/i.test(cell)?'vacation':start&&endTime?'work':'unknown';
      const members=legends.get(team.key)||[];
      for(const member of members.length?members:[{name:'',line:null}]){
        const problem=!validDate(date)||!date.startsWith(scope.month+'-')?'Grid date is invalid or outside the selected month.':!members.length?'No unambiguous member legend for this team.':cell&&status==='unknown'?'Unrecognized grid value. Correct it or explicitly skip; hours will not be inferred.':null;
        append(rows,{name:member.name,date,start:start||'',end:endTime||'',status,team:team.name},
          {file,line:row.line,column:team.column+1,legendLine:member.line,kind:'Team grid',originalCell:cell,originalDate:row.cells[0],storeHours:row.cells[header.indexOf('store hours')]||null,note:note||null},scope,problem,
          [...(note?['Unapplied source note: '+note]:[]),'Grid membership applies only to each reviewed date. Store-hours and notes cells do not create assignments.',...(cell?[]:['Blank team cell: working assignment and hours unknown.'])]);
      }
    }
  }
  if(!rows.length)throw Error('No dated team rows in this grid.');return rows;
}
export function parseCompatibleSchedule(text,file,format,scope) {
  return format==='legacy'?legacyOffDays(text,file,scope):format==='grid'?teamGrid(text,file,scope):parseSchedule(text,file);
}

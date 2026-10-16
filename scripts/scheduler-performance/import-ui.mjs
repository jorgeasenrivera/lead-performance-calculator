import { parseSchedule, reviewImport, applyImport, importSnapshot } from './schedule-import.mjs';
import { storeTimezone } from './shift-intervals.mjs';
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function openScheduleImport({host,planner,index,onApply,onClose}) {
  let generation=0,closed=false,rows=null,review=null,choices={},snapshot='';
  const store=planner.context(index,'2014-01-01').store;
  host.hidden=false;
  host.innerHTML=`<h2 tabindex="-1">Import schedule</h2><p>Choose a CSV, review people and exact times, then apply to this page’s draft. Existing assignments stay in place.</p><p><strong>${esc(store.name)} · ${esc(storeTimezone(store))}</strong></p><label>Schedule CSV<input id="schedule-file" type="file" accept=".csv,text/csv"></label><details><summary>CSV format and limits</summary><p>Required: Name or Person ID, Date, Start, End. Optional: End Date, Status, Timezone. Dates need a four-digit year; times use 24-hour HH:MM. Status is work (default) or off. Off rows need blank times. An omitted timezone uses this store’s timezone.</p><pre>Name,Date,Start,End,Status\nAlex 1,2026-11-04,09:15,16:45,work</pre><p>CSV only, up to 100 KB and 500 rows. No Excel workbooks, grids, PDFs, breaks, overnight shifts or DST-change dates. No shift is inferred from a blank cell. Resolve blocked rows in the source file or explicitly skip them.</p></details><p id="import-status" role="status">Nothing has been changed.</p><div id="import-review"></div><div class="actions"><button id="apply-import" class="primary" disabled>Apply to draft</button><button id="cancel-import">Cancel import</button></div>`;
  const status=host.querySelector('#import-status'),apply=host.querySelector('#apply-import'),panel=host.querySelector('#import-review');
  const cancel=()=>{closed=true;generation++;rows=null;review=null;host.hidden=true;host.innerHTML='';};
  const stale=()=>closed||!host.isConnected||snapshot!==importSnapshot(planner,index);
  const draw=()=>{
    if(stale()){status.textContent='The draft changed. Choose the file again to review it.';apply.disabled=true;return;}
    review=reviewImport(planner,index,rows,choices);
    panel.innerHTML=`<h3>Review ${review.items.length} source rows</h3>${review.items.map(item=>`<section class="import-row" aria-label="Source line ${item.source.line}"><h4>Line ${item.source.line} · ${esc(item.source.file)}</h4><p>${esc(item.raw.name||item.raw['person id']||'No person')} · ${esc(item.raw.date)}${item.raw['end date']?` to ${esc(item.raw['end date'])}`:''}</p><p>${item.status==='off'?'Off':`${esc(item.raw.start||'Missing start')} to ${esc(item.raw.end||'Missing end')}`} · ${esc(item.raw.timezone||storeTimezone(store))}</p><label>Match person for line ${item.source.line}<select data-person="${item.index}"><option value="">Choose a person</option>${store.people.map(p=>`<option value="${esc(p.id)}" ${p.id===item.personId?'selected':''}>${esc(p.name)} (${esc(p.id)})</option>`).join('')}</select></label><label class="check"><input type="checkbox" data-skip="${item.index}" ${item.state==='skipped'?'checked':''}>Skip line ${item.source.line}</label><p><strong>${{ready:'Ready to add',duplicate:'Already present, no change',blocked:'Needs review',skipped:'Skipped'}[item.state]}</strong>${item.messages.length?`: ${item.messages.map(esc).join(' ')}`:''}</p></section>`).join('')}`;
    const count=review.items.filter(i=>i.state==='ready').length;
    status.textContent=review.blocked?'Resolve or skip the flagged rows. Nothing has been changed.':`${count} new rows; ${review.items.filter(i=>i.state==='duplicate').length} already present; ${review.items.filter(i=>i.state==='skipped').length} skipped. Review before applying.`;
    apply.disabled=review.blocked;apply.textContent=count?'Apply reviewed rows to draft':'Done without changes';
    for(const select of panel.querySelectorAll('[data-person]'))select.onchange=()=>{const id=select.dataset.person;choices[id]={...choices[id],personId:select.value};draw();panel.querySelector(`[data-person="${id}"]`)?.focus();};
    for(const input of panel.querySelectorAll('[data-skip]'))input.onchange=()=>{const id=input.dataset.skip;choices[id]={...choices[id],skip:input.checked};draw();panel.querySelector(`[data-skip="${id}"]`)?.focus();};
  };
  host.querySelector('#schedule-file').onchange=async event=>{
    const token=++generation,file=event.target.files[0];rows=null;review=null;choices={};panel.innerHTML='';apply.disabled=true;
    if(!file){status.textContent='Choose a CSV to review.';return;}
    snapshot=importSnapshot(planner,index);status.textContent='Reading CSV locally…';
    try{
      if(!/\.csv$/i.test(file.name))throw Error('This preview reads explicit CSV rows only. Export the schedule to the shown CSV format.');
      if(file.size>100000)throw Error('Choose a CSV smaller than 100 KB.');
      const text=await file.text();if(closed||token!==generation)return;
      rows=parseSchedule(text,file.name);draw();
    }catch(error){if(!closed&&token===generation)status.textContent=error.message;}
  };
  apply.onclick=()=>{
    if(apply.disabled||!review||closed)return;apply.disabled=true;
    try{const result=applyImport(planner,review);cancel();onApply(result);}catch(error){status.textContent=error.message;}
  };
  host.querySelector('#cancel-import').onclick=()=>{cancel();onClose();};
  host.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();cancel();onClose();}};
  host.querySelector('h2').focus();host.scrollIntoView({block:'start'});
  return cancel;
}

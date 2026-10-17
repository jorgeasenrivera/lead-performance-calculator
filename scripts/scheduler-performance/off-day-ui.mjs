import {validDate} from './shift-intervals.mjs';
import {absenceKind,absenceLabel} from './team-model.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nextDay=(day,n=1)=>new Date(new Date(day+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
export function openOffDayCommand({host,planner,index,from,personId,onClose,onApply,hasPending=()=>false}){
 let review=null,disposed=false,dragging=false;
 const fine=matchMedia('(hover: hover) and (pointer: fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 host.hidden=false;
 host.innerHTML=`<h2 tabindex="-1">Move or copy an off-day</h2><p>Same person, same store. Explicit scheduled off or legacy off only. Vacation and recurring unavailability stay in their own controls.</p><form id="off-day-form"><div class="fields"><label>Source date<input id="off-from" type="date" min="2014-01-01" max="2100-12-31" value="${esc(from)}" required></label><label>Person<select id="off-person" required></select></label><label>Action<select id="off-mode"><option value="move">Move</option><option value="copy">Copy</option></select></label><label>Destination date<input id="off-to" type="date" min="2014-01-01" max="2100-12-31" value="${validDate(nextDay(from))?nextDay(from):''}" required></label></div><p id="off-source-note"></p><button type="button" id="off-drag" aria-describedby="off-drag-help"></button><p id="off-drag-help">Choose a destination below or enter a date. Desktop mouse dragging selects a date for review. Touch dragging is not enabled.</p><div class="off-day-targets" aria-label="Nearby destination dates"></div><p id="off-status" role="status">Nothing has changed. Choose a destination, then review.</p><p id="off-error" role="alert"></p><div class="actions"><button class="primary" id="off-review">Review change</button><button type="button" id="off-cancel">Cancel</button></div></form><section id="off-review-panel" hidden aria-label="Off-day change review"><h3>Review both dates</h3><p id="off-summary"></p><p>Move leaves the source Unknown, not working. Other people, recorded sales and shift times stay unchanged. This is an in-memory preview. Undo is available only until another planner edit.</p><button type="button" class="primary" id="off-apply">Apply move</button></section>`;
 const $=s=>host.querySelector(s),source=$('#off-from'),target=$('#off-to'),person=$('#off-person'),mode=$('#off-mode'),card=$('#off-drag'),status=$('#off-status'),error=$('#off-error'),panel=$('#off-review-panel');
 const invalidate=()=>{review=null;panel.hidden=true;error.textContent='';status.textContent='Nothing has changed. Review the selected dates before applying.';};
 const motion=element=>{if(!reduced.matches)element.animate([{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});};
 const updateCard=()=>{const c=validDate(source.value)?planner.context(index,source.value):null,p=c?.store.people.find(p=>p.id===person.value),kind=absenceKind(c?.record,person.value);card.textContent=p?`${p.name} · ${absenceLabel(kind)} · ${source.value}`:'Choose a date with an explicit off-day';card.disabled=!p;card.draggable=Boolean(p&&fine.matches);$('#off-source-note').textContent=p?`Source: ${c.record.absences?.[p.id]?.source?.file||c.record.absences?.[p.id]?.source?.kind||'Entered off-day'}. Original provenance is kept.`:'No explicit off-days on this date. Recurring unavailability is not an off-day to transfer.';};
 const choose=day=>{target.value=day;invalidate();status.textContent=`Destination selected: ${day}. Review before applying.`;$('#off-review').focus();motion(target);};
 const clearDrag=()=>{dragging=false;host.querySelectorAll('.is-off-drop').forEach(e=>e.classList.remove('is-off-drop'));};
 const refresh=()=>{
  invalidate();const c=validDate(source.value)?planner.context(index,source.value):null;
  const people=c?.store.people.filter(p=>['off','legacy-off'].includes(absenceKind(c.record,p.id)))||[];
  person.innerHTML=people.length?people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''):'<option value="">No explicit off-days</option>';
  if(people.some(p=>p.id===personId))person.value=personId;updateCard();
  const days=c?Array.from({length:7},(_,i)=>nextDay(source.value,i+1)).filter(validDate):[];
  $('.off-day-targets').innerHTML=days.map(day=>`<button type="button" data-off-target="${day}" aria-label="Choose destination ${day}">${day}</button>`).join('');
  for(const button of host.querySelectorAll('[data-off-target]')){
   button.onclick=()=>choose(button.dataset.offTarget);
   button.ondragover=e=>{if(dragging&&fine.matches){e.preventDefault();e.dataTransfer.dropEffect=mode.value;button.classList.add('is-off-drop');}};
   button.ondragleave=()=>button.classList.remove('is-off-drop');
   button.ondrop=e=>{if(!dragging||!fine.matches)return;e.preventDefault();clearDrag();choose(button.dataset.offTarget);};
  }
 };
 card.onclick=()=>target.focus();card.onpointerdown=e=>{card.draggable=e.pointerType==='mouse'&&fine.matches;};
 card.ondragstart=e=>{if(!fine.matches||!card.draggable){e.preventDefault();return;}dragging=true;e.dataTransfer.setData('text/plain','off-day-destination');e.dataTransfer.effectAllowed='copyMove';};card.ondragend=clearDrag;
 source.onchange=refresh;person.onchange=()=>{personId=person.value;invalidate();updateCard();};target.oninput=invalidate;mode.onchange=invalidate;
 $('#off-day-form').onsubmit=e=>{
  e.preventDefault();invalidate();try{
   if(hasPending())throw Error('Apply or cancel pending day and settings choices first.');
   review=planner.reviewOffDay({index,personId:person.value,from:source.value,to:target.value,mode:mode.value});
   const teams=review.unknownMembership?'Unknown team membership retained':review.teamIds.map(id=>planner.context(index,review.to).store.teams.find(t=>t.id===id)?.name||id).join(', ')||'No team';
   $('#off-summary').textContent=`${review.personName}\n${review.from}: ${review.sourceAfter} (${review.sourceState})\n${review.to}: ${absenceLabel(review.kind)} (${review.destinationState})\nDestination membership: ${teams}. Destination hours are not inferred from this off-day.`;
   $('#off-apply').textContent=`Apply ${review.mode}`;$('#off-apply').disabled=false;panel.hidden=false;status.textContent='Ready for your confirmation. Neither date has changed.';panel.scrollIntoView({block:'nearest'});$('#off-apply').focus();motion(panel);
  }catch(e){error.textContent=e.message;}
 };
 $('#off-apply').onclick=()=>{if(disposed||!review)return;try{if(hasPending())throw Error('Apply or cancel pending choices first.');const undo=planner.applyOffDay(review);disposed=true;clearDrag();onApply(undo);}catch(e){invalidate();error.textContent=e.message;$('#off-review').focus();}};
 const dispose=()=>{disposed=true;clearDrag();host.hidden=true;host.replaceChildren();};
 const close=()=>{dispose();onClose();};$('#off-cancel').onclick=close;host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
 refresh();$('h2').focus();host.scrollIntoView({block:'start'});return dispose;
}

// Manual-first review profile. Reuses C113 and the reviewed policy/weekly engine.
import {originalC113 as c113} from '../../api/_scheduler-c113.mjs';
import {assembleSource} from '../scheduler-source-capture/adapter.mjs';
import * as review from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
import {ruleFor,weekday} from '../scheduler-proposal/model.mjs';
import {employmentProblem,shiftProblem} from '../scheduler-performance/shift-intervals.mjs';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function assembleManualSource(raw){
 const copied=c113.plainSnapshot(raw,{maxDepth:24});if(!copied.ok)fail('MANUAL_DRAFT_INVALID');
 raw=copied.value;
 const scope=raw.scope,span=review.reviewSpan(scope.month),supplement=raw.supplement;
 // The historical manual-policy profile deliberately supplied no forecasting
 // history. It cannot establish an empty history for this accepted planner.
 // Reuse the existing captured source-input shape; no new policy writer or SQL.
 if(supplement?.version==='scheduler-manual-policy/1')fail('MANUAL_HISTORY_UNAVAILABLE');
 if(supplement?.version!=='scheduler-source-inputs/1'||!supplement.months)fail('MANUAL_POLICY_UNAVAILABLE');
 const months={};
 for(const month of span.months){
  const rev=raw.heads[month]?.draft_rev;
  const v=raw.versions.find(v=>v.store_id===scope.storeId&&v.month===month&&v.kind==='draft'&&v.rev===rev);
  if(!v)fail('MANUAL_BOUNDARY_DRAFT_REQUIRED');
  const d=c113.deserializeVersion(v.version_text,{...scope,month,kind:'draft',rev});
  if(!d.ok)fail('MANUAL_DRAFT_INVALID');
  if(!Object.hasOwn(supplement.months,month))fail('MANUAL_POLICY_UNAVAILABLE');
  months[month]=d.draft;
 }
 for(const day of span.days){
  const d=months[day.slice(0,7)],rule=ruleFor(d.store.rules,day);
  if(!rule)fail('MANUAL_HOURS_REQUIRED');
  const state=rule.holidays[day]||(rule.closedDays.includes(weekday(day))?'closed':'open');
  if(state==='closed')continue;
  if(state!=='open')fail('MANUAL_HOURS_REQUIRED');
  const record=d.overrides[day];if(!record||Array.isArray(record))fail('MANUAL_EXPLICIT_DAY_REQUIRED');
  const shifted=new Set((record.shifts||[]).map(s=>s.personId));
  if((record.on||[]).some(id=>!shifted.has(id)))fail('MANUAL_EXPLICIT_TIMES_REQUIRED');
  for(const shift of record.shifts||[])if(shiftProblem(shift,{...d.store,id:scope.storeId},day,{strictHours:true}))fail('MANUAL_EXPLICIT_TIMES_REQUIRED');
  for(const p of d.store.people){
   const employment=employmentProblem(p,day);
   if(employment){if(shifted.has(p.id)||(record.on||[]).includes(p.id))fail('MANUAL_EMPLOYMENT_CONFLICT');continue;}
   if(!shifted.has(p.id)&&!(record.off||[]).includes(p.id))fail('MANUAL_EXPLICIT_DAY_REQUIRED');
  }
 }
 const assembled=assembleSource(raw,{explicitManual:true});
 // Every open span day is explicitly stored; inherited attendance is not an input.
 assembled.snapshot.reviewInput.base=Object.fromEntries(span.days.map(day=>[day,null]));
 const checked=review.reviewMonth(assembled.snapshot.reviewInput,{sha256:x=>createHash('sha256').update(x).digest('hex')});
 if(checked.openIssues)fail('MANUAL_REVIEW_ISSUES');
 assembled.snapshot.reviewBinding.inputDigest=checked.inputDigest;
 assembled.review={definition:checked.definition,digest:checked.digest};
 assembled.raw=structuredClone(raw);return assembled;
}

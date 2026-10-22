import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createSchedulerContract } from '../../api/_scheduler-contract.mjs';
import { originalC113 as c113 } from '../../api/_scheduler-c113.mjs';
import * as provider from '../scheduler-delivery-local/provider/scripts/scheduler-performance/month-review-provenance.mjs';
import { personIntervals, stableLocalDate } from '../scheduler-delivery-local/provider/scripts/scheduler-performance/shift-intervals.mjs';
import { validateOwnDays } from '../../api/_scheduler-publication-v2.mjs';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const fail = () => { throw new Error('publication-context-rejected'); };
const contract = createSchedulerContract({ c113, reviewProvider: provider, sha256 });
// Trusted source-capture seam only. No caller-supplied openIssues or projections.
// Snapshot must come from the authoritative relational source/version adapter.
export async function preparePublication({ request, actor, now, snapshot, sourceEpoch }) {
  if (request?.op !== 'publish' || !contract.validateRequest(request) ||
      !Number.isSafeInteger(sourceEpoch) || sourceEpoch < 1) fail();
  const review = provider.reviewMonth(snapshot.reviewInput, { sha256 });
  if (review.openIssues !== 0 || review.digest !== request.input.review.digest) fail();
  const plan = await contract.plan({ request, actor, now, snapshot });
  const people = snapshot.reviewInput.months[request.month].store.people;
  const projection = people.map(person => ({ personId: person.id, days: review.rows.map(row => {
    const record = row.record, shifts = (record?.shifts || []).filter(s => s.personId === person.id);
    const on = (record?.on || []).includes(person.id) || shifts.length > 0;
    const off = (record?.off || []).includes(person.id);
    if (on && off) fail();
    if (on && !stableLocalDate(row.day, 'America/New_York')) fail();
    const intervals = on ? personIntervals(record, person.id, row.rule) : [];
    if (intervals.some(([start,end]) => !Number.isFinite(start) || !Number.isFinite(end) || end <= start)) fail();
    let status;
    if (on) status = 'working';
    else if (off) { status = record?.absences?.[person.id]?.kind || 'off'; if (!['off','vacation','unavailable','unknown'].includes(status)) fail(); }
    else if (record?.unknownNotes?.[person.id]) status = 'unknown';
    else status = row.state === 'closed' ? 'closed' : row.state === 'unknown' ? 'unknown' : 'unentered';
    return { date: row.day, status, intervals, timezone: 'America/New_York' };
  }) }));
  for (const person of projection) validateOwnDays(person.days,request.month);
  const inputText = provider.canonicalJson(snapshot.reviewInput);
  const context = { version:'scheduler-publication-context/2', scope:{storeId:request.storeId,month:request.month},
    sourceEpoch, inputText, inputDigest:sha256(inputText), review:request.input.review,
    binding:snapshot.reviewBinding, expected:{head:snapshot.head,prevAuditHash:snapshot.prevAuditHash,auditRevision:snapshot.auditRevision},
    plan, projection };
  const copy = c113.canonicalize(context); if (!copy.ok) fail();
  return Object.freeze({ context:copy.value, contextText:copy.text, contextId:sha256(copy.text) });
}
export function validatePublicationPlan(plan, context) {
  if (context?.version !== 'scheduler-publication-context/2' || !isDeepStrictEqual(plan,context.plan)) fail();
  for (const op of plan.ops) {
    if (op.op === 'put-version' && !c113.deserializeVersion(op.text,{storeId:op.storeId,month:op.month,kind:op.kind,rev:op.rev}).ok) fail();
  }
  if (!c113.verifyEntry(plan.auditEntry).ok) fail();
  return true;
}

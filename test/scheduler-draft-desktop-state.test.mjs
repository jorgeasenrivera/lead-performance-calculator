import test from 'node:test';
import assert from 'node:assert/strict';
import {draftMonthView, nearbyMonths, pendingDayReview, recoveryBlocked} from '../src/scheduler-draft-desktop-state.mjs';
const month = '2026-11';
const snapshot = (state = {}, entry = {}, editor = {}) => ({active: true, editor: {dirtyMonths: [], pending: false, unresolved: [], ...editor},
  months: [{month, loadAccepted: true, operation: null, awaitingAcknowledgement: false, error: null,
    controller: {status: 'ready', draftRev: 3, error: null, ...state}, ...entry}]});
test('absent, saved, dirty and pending states remain distinct', () => {
  assert.match(draftMonthView(snapshot({draftRev: 0}), month).message, /No saved draft/);
  assert.match(draftMonthView(snapshot(), month).message, /does not publish/);
  assert.equal(draftMonthView(snapshot(), month).canAct, false);
  assert.equal(draftMonthView(snapshot({}, {}, {dirtyMonths: [month]}), month).canAct, true);
  // Pending controls do not reliably emit events on cancel. Clicking save
  // rechecks the binding, so this action must remain available after cancel.
  assert.equal(draftMonthView(snapshot({}, {}, {pending: true}), month).canAct, true);
});
test('uncertain saves expose retry only and block discard across every month', () => {
  const s = snapshot({status: 'uncertain'}, {awaitingAcknowledgement: true});
  const view = draftMonthView(s, month);
  assert.equal(view.action, 'retry'); assert.equal(view.canRead, false); assert.equal(recoveryBlocked(s), true);
  s.months.push({...s.months[0], month: '2026-12'});s.months[0] = snapshot().months[0];
  assert.equal(recoveryBlocked(s), true);
});
test('conflicts and hydration refusals cannot become save actions', () => {
  assert.equal(draftMonthView(snapshot({status: 'conflict'}), month).canAct, false);
  assert.equal(draftMonthView(snapshot({}, {loadAccepted: false, error: 'shared-teams'}), month).canAct, false);
  assert.equal(recoveryBlocked(snapshot({status: 'conflict'})), false);
  // Receipt known but local ack refused: explicit discard/reload is permitted.
  assert.equal(recoveryBlocked(snapshot({status: 'saved'}, {loadAccepted: false, awaitingAcknowledgement: true})), false);
});
test('all in-flight operations block recovery; loading never claims absence', () => {
  for(const operation of ['load','save','retry']) assert.equal(recoveryBlocked(snapshot({}, {operation})), true);
  assert.match(draftMonthView(snapshot({}, {operation:'load'}), month).message, /Loading/);
  assert.equal(draftMonthView({active:false}, month).canAct, false);
});
test('boundary preloads are month-scoped and bounded to published planner dates', () => {
  assert.deepEqual(nearbyMonths('2026-11'), ['2026-11','2026-10','2026-12']);
  assert.deepEqual(nearbyMonths('2014-01'), ['2014-01','2014-02']);
  assert.deepEqual(nearbyMonths('2100-12'), ['2100-12','2100-11']);
  assert.deepEqual(nearbyMonths('invalid'), []);
});

test('pending recovery identifies the actual retained date and refuses stale or invalid targets', () => {
  const s = snapshot({}, {}, {pending: true, pendingDays: ['2026-11-10']});
  assert.deepEqual(pendingDayReview(s), {day: '2026-11-10', label: 'Review November 10 choices'});
  const before = structuredClone(s);
  assert.deepEqual(pendingDayReview(s), pendingDayReview(s));
  assert.deepEqual(s, before);
  assert.equal(pendingDayReview({...s, active: false}), null);
  assert.equal(pendingDayReview(snapshot({}, {}, {pending: false, pendingDays: ['2026-11-10']})), null);
  for (const day of ['2026-02-30', 'invalid', undefined]) {
    assert.equal(pendingDayReview(snapshot({}, {}, {pending: true, pendingDays: [day]})), null);
  }
});

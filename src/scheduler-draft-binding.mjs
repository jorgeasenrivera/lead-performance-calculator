import {createSchedulerDraftController} from './scheduler-draft-state.mjs';
import {copyDraftJson, draftError, revision} from './scheduler-draft-transport.mjs';

// Source-only adapter for the editor handle at b6cd4798d6daa0ab950f6e8e142f6df6479521f4.
// The host forwards onDraftChange and supplies getEditor: () => guardRef.current.
// A binding belongs to one mounted handle, store and principal lifetime. Tokens
// stay in this closure; only exported projections enter the controller/transport.
export function createSchedulerDraftBinding({auth, transport, getEditor, storeId, index = 0, lifetime} = {}) {
  if (!['getSnapshot', 'subscribe'].every(k => typeof auth?.[k] === 'function')
      || !['prepareRead', 'prepareSave', 'send'].every(k => typeof transport?.[k] === 'function')
      || typeof getEditor !== 'function' || typeof storeId !== 'string' || !storeId
      || !Number.isSafeInteger(index) || index < 0 || typeof lifetime !== 'string' || !lifetime) throw draftError('configuration');
  const editor = getEditor(), identity = auth.getSnapshot(), epoch = identity.principalEpoch;
  if (identity.disposed || !revision(epoch) || !['exportMonth', 'acknowledgeMonth', 'hydrateMonth', 'draftStatus', 'hasDraft']
    .every(k => typeof editor?.[k] === 'function')) throw draftError('configuration');
  const entries = new Map(), listeners = new Set();
  let closed = false, reason = null, unsubscribe = () => {};
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch {} } };
  const invalidate = why => {
    if (closed) return;
    closed = true; reason = why;
    for (const e of entries.values()) { e.controller.dispose(); e.submission = null; }
    entries.clear(); unsubscribe(); emit(); listeners.clear();
  };
  const current = () => {
    if (!closed && (auth.getSnapshot().disposed || auth.getSnapshot().principalEpoch !== epoch)) invalidate('principal-changed');
    if (!closed && getEditor() !== editor) invalidate('editor-changed');
    return !closed;
  };
  const guard = () => { if (!current()) throw draftError('inactive'); };
  const status = () => {
    const out = editor.draftStatus(index);
    if (out?.ok !== true || !Array.isArray(out.dirtyMonths) || !Array.isArray(out.unresolved)
        || typeof out.pending !== 'boolean' || out.atomic !== false) throw draftError(out?.reason || 'invalid-editor-status');
    return copyDraftJson(out);
  };
  const exportMonth = month => {
    const out = editor.exportMonth(month, index);
    if (out?.ok !== true) throw draftError(out?.reason || 'export-refused');
    const projection = copyDraftJson(out.projection);
    if (projection?.storeId !== storeId || projection?.month !== month || !out.token || typeof out.token !== 'object') throw draftError('scope');
    return {projection, token: out.token};
  };
  const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const get = month => {
    guard();
    if (entries.has(month)) return entries.get(month);
    const e = {month, accepted: false, error: null, submission: null, operation: null, controller: null};
    // Capture actual successful transport completion, rather than inferring a
    // receipt from a mutable status label (successful saves may remain dirty).
    e.controller = createSchedulerDraftController({auth, transport: {
      prepareRead: scope => transport.prepareRead(scope),
      prepareSave: (scope, baseRev, model) => transport.prepareSave(scope, baseRev, model),
      async send(command, options) {
        const operation = e.operation;
        const result = await transport.send(command, options);
        if (current() && e.operation === operation) operation.response = result;
        return result;
      },
    }});
    try { e.controller.setContext({storeId, month, lifetime}); }
    catch (error) { e.controller.dispose(); throw error; }
    entries.set(month, e);
    return e;
  };
  const reconcile = e => {
    if (!e.accepted || e.operation?.kind === 'load') return;
    const {projection} = exportMonth(e.month);
    if (!equal(projection, e.controller.getSnapshot().draft)) e.controller.edit(projection);
  };
  const snapshot = () => {
    if (!current()) return Object.freeze({active: false, reason, storeId, lifetime, months: Object.freeze([])});
    return Object.freeze({active: true, reason: null, storeId, lifetime,
      // Do not synthesize a global "saved" flag from one month's receipt.
      editor: status(), hasDraft: editor.hasDraft(), months: Object.freeze([...entries.values()].map(e => Object.freeze({
        month: e.month, loadAccepted: e.accepted, error: e.error,
        operation: e.operation?.kind ?? null, awaitingAcknowledgement: e.submission !== null,
        controller: e.controller.getSnapshot(),
      })))});
  };
  const start = (e, kind, invoke, complete) => {
    const operation = {kind, response: null, changed: false, promise: null};
    e.operation = operation; e.error = null;
    // Prepare the controller command synchronously, before notifying listeners.
    // Otherwise a same-turn edit could change the bytes while retaining an old token.
    let action;
    try { guard(); action = invoke(); } catch (error) { action = Promise.reject(error); }
    operation.promise = Promise.resolve().then(async () => {
      try {
        await action;
        if (!current()) return snapshot();
        await complete(operation);
      } catch (error) {
        if (current()) e.error = error?.code || 'binding-failed';
      } finally {
        if (e.operation === operation) e.operation = null;
        if (current()) emit();
      }
      return snapshot();
    });
    emit();
    return operation.promise;
  };
  const busy = (e, kind) => {
    if (!e.operation) return null;
    if (e.operation.kind !== kind) throw draftError('operation-in-progress');
    return e.operation.promise;
  };
  const finishSave = (e, operation) => {
    const s = e.controller.getSnapshot();
    if (!operation.response) {
      e.error = s.error || 'save-failed';
      if (s.status !== 'uncertain') e.submission = null;
      return;
    }
    // Capture edits even if the host has not delivered a draft-change event yet.
    reconcile(e);
    const ack = editor.acknowledgeMonth(e.month, e.submission.token, index);
    if (ack?.ok !== true) {
      e.accepted = false; e.error = ack?.reason || 'acknowledgement-refused';
      return;
    }
    e.submission = null;
    e.error = null;
  };
  unsubscribe = auth.subscribe(() => { current(); });
  if (typeof unsubscribe !== 'function') throw draftError('configuration');
  return Object.freeze({
    getSnapshot: snapshot,
    subscribe(fn) { guard(); listeners.add(fn); return () => listeners.delete(fn); },
    load(month) {
      const e = get(month), running = busy(e, 'load');
      if (running) return running;
      if (e.accepted || e.submission) throw draftError('already-loaded');
      const expectedScope = Object.freeze({storeId, month});
      const before = exportMonth(month).projection, initial = status();
      if (initial.pending || initial.dirtyMonths.includes(month)) throw draftError('unsaved-editor-changes');
      return start(e, 'load', () => e.controller.load(), operation => {
        const s = e.controller.getSnapshot();
        if (!operation.response || !['ready', 'absent'].includes(s.status)) { e.error = s.error || 'load-failed'; return; }
        const latest = status();
        if (operation.changed || latest.pending || latest.dirtyMonths.includes(month)
            || !equal(before, exportMonth(month).projection)) { e.error = 'editor-changed-during-load'; return; }
        if (s.status === 'ready') {
          if (s.draft?.storeId !== expectedScope.storeId || s.draft?.month !== expectedScope.month) { e.error = 'scope'; return; }
          const hydrated = editor.hydrateMonth(s.draft, index, expectedScope);
          if (hydrated?.ok !== true) { e.error = hydrated?.reason || 'hydration-refused'; return; }
          // A verifier which transforms the projection must not silently leave
          // the editor and server baseline representing different models.
          if (!equal(exportMonth(month).projection, s.draft)) { e.error = 'hydration-changed-projection'; return; }
        }
        e.accepted = true;
      });
    },
    save(month) {
      const e = get(month), running = busy(e, 'save');
      if (running) return running;
      if (!e.accepted) throw draftError('load-not-accepted');
      if (e.submission) throw draftError('retry-required');
      if (status().pending) throw draftError('pending-editor-controls');
      if (e.controller.getSnapshot().status === 'conflict') throw draftError('conflict-unresolved');
      const exported = exportMonth(month);
      e.controller.edit(exported.projection);
      e.submission = exported;
      return start(e, 'save', () => {
        try { return e.controller.save(); }
        catch (error) { e.submission = null; throw error; }
      }, operation => finishSave(e, operation));
    },
    retry(month) {
      const e = get(month), running = busy(e, 'retry');
      if (running) return running;
      if (!e.accepted || !e.submission || e.controller.getSnapshot().status !== 'uncertain') throw draftError('nothing-to-retry');
      reconcile(e);
      return start(e, 'retry', () => e.controller.retry(), operation => finishSave(e, operation));
    },
    // The React wrapper forwards onDraftChange here. Pending form changes have
    // no guaranteed event; every operation rechecks draftStatus independently.
    onDraftChange(event) {
      if (!current()) return;
      for (const e of entries.values()) {
        if (event?.months && !event.months.some(m => m.index === index && m.month === e.month)) continue;
        if (e.operation?.kind === 'load') { e.operation.changed = true; continue; }
        try { reconcile(e); } catch (error) { e.accepted = false; e.error = error?.code || 'editor-sync-failed'; }
      }
      emit();
    },
    dispose() { invalidate('disposed'); },
  });
}

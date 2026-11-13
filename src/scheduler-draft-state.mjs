import {copyDraftJson, draftError, revision} from './scheduler-draft-transport.mjs';

// One controller owns one selected month in one principal/lifetime. "saved"
// means only this draft month. It says nothing about other months or publication.
// Auth is the existing reported-auth adapter; token refresh keeps its epoch.
export function createSchedulerDraftController({auth, transport} = {}) {
  if (!['getSnapshot', 'subscribe'].every(k => typeof auth?.[k] === 'function')
      || !['prepareRead', 'prepareSave', 'send'].every(k => typeof transport?.[k] === 'function')) throw draftError('configuration');
  let closed = false, generation = 0, context = null, job = null, pending = null, edits = 0;
  const listeners = new Set();
  let state;
  const publish = patch => {
    state = Object.freeze({...state, ...patch});
    for (const listener of [...listeners]) { try { listener(); } catch {} }
    return state;
  };
  const reset = status => {
    ++generation;
    const old = job; job = null; pending = null; edits = 0;
    old?.abort.abort();
    state = undefined;
    return publish({status, scope: context, principalEpoch: auth.getSnapshot().principalEpoch,
      kind: 'draft', draft: null, draftRev: null, publishedRev: null, dirty: false, error: null});
  };
  reset('idle');
  const guard = () => {
    const identity = auth.getSnapshot();
    if (identity.disposed || identity.principalEpoch !== state.principalEpoch) reset('invalidated');
    if (closed || !context || identity.disposed || !revision(identity.principalEpoch) || state.status === 'invalidated') throw draftError('inactive');
  };
  const run = (command, mode, version) => {
    const entry = {abort: new AbortController(), generation, epoch: state.principalEpoch};
    job = entry;
    const current = () => !closed && job === entry && generation === entry.generation
      && !auth.getSnapshot().disposed && auth.getSnapshot().principalEpoch === entry.epoch;
    // Install the shared promise before notifying subscribers, including those
    // which synchronously invoke save again while observing the status change.
    entry.promise = Promise.resolve().then(async () => {
      try {
        const result = await transport.send(command, {expectedEpoch: entry.epoch, signal: entry.abort.signal});
        if (!current()) return state;
        if (mode === 'read') {
          if (state.draftRev !== null && result.revision < state.draftRev) throw draftError('revision-regressed');
          publish({status: result.revision === 0 ? 'absent' : 'ready', draft: result.draft,
            draftRev: result.revision, dirty: false, error: null});
        } else {
          // Receipts may be older than the latest observation. Never apply their
          // older head or replace newer local edits with the submitted model.
          pending = null;
          const dirty = edits !== version;
          publish({status: dirty ? 'dirty' : 'saved', dirty, error: null,
            draftRev: Math.max(state.draftRev, result.head.draftRev),
            publishedRev: Math.max(state.publishedRev ?? 0, result.head.publishedRev)});
        }
      } catch (error) {
        if (!current()) return state;
        const code = error?.code || 'transport-unavailable';
        const conflict = ['conflict', 'idempotency-conflict'].includes(code);
        const uncertain = mode === 'save' && !conflict && (pending?.uncertain || error?.uncertain !== false);
        // A failed credential lookup or denied retry cannot tell us whether the
        // earlier attempt committed. Preserve that command until resolved.
        if (uncertain) pending.uncertain = true;
        if (mode === 'save' && !uncertain) pending = null;
        publish({status: conflict ? 'conflict' : uncertain ? 'uncertain' : 'unavailable', error: code});
      } finally { if (job === entry) job = null; }
      return state;
    });
    publish({status: mode === 'read' ? 'loading' : 'saving', error: null});
    return entry.promise;
  };
  const unsubscribe = auth.subscribe(() => {
    if (!closed && (auth.getSnapshot().disposed || auth.getSnapshot().principalEpoch !== state.principalEpoch)) reset('invalidated');
  });
  if (typeof unsubscribe !== 'function') throw draftError('configuration');
  return Object.freeze({
    getSnapshot() { if (!closed && (auth.getSnapshot().disposed || auth.getSnapshot().principalEpoch !== state.principalEpoch)) reset('invalidated'); return state; },
    subscribe(listener) { if (closed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    setContext(value) {
      if (closed) throw draftError('inactive');
      // A changed lifetime explicitly opens a new editor, even for the same month.
      if (!value || typeof value.lifetime !== 'string' || !value.lifetime) throw draftError('invalid-context');
      const next = copyDraftJson({storeId: value.storeId, month: value.month, lifetime: value.lifetime});
      transport.prepareRead(next);
      if (context && Object.keys(next).every(k => next[k] === context[k]) && state.principalEpoch === auth.getSnapshot().principalEpoch
          && state.status !== 'invalidated') return state;
      context = next; return reset('idle');
    },
    load() {
      guard();
      if (job) return job.promise;
      if (state.dirty || pending || state.status === 'conflict') throw draftError('unsaved-edits');
      return run(transport.prepareRead(context), 'read');
    },
    edit(model) {
      guard();
      if (state.draftRev === null || job && state.status === 'loading') throw draftError('not-loaded');
      const draft = copyDraftJson(model);
      if (draft === null) throw draftError('unsupported-data');
      ++edits;
      return publish({draft, dirty: true, status: ['saving', 'uncertain', 'conflict'].includes(state.status) ? state.status : 'dirty'});
    },
    save() {
      guard();
      if (job) return job.promise;
      if (pending) throw draftError('retry-required');
      if (state.status === 'conflict') throw draftError('conflict-unresolved');
      if (!state.dirty || state.draftRev === null) throw draftError('nothing-to-save');
      const command = transport.prepareSave(context, state.draftRev, state.draft);
      pending = {command, version: edits};
      return run(command, 'save', edits);
    },
    retry() {
      guard();
      if (job) return job.promise;
      if (!pending || state.status !== 'uncertain') throw draftError('nothing-to-retry');
      return run(pending.command, 'save', pending.version);
    },
    // Conflict resolution is an explicit close/reopen workflow owned by the
    // caller. No read, edit or retry silently rebases the preserved local model.
    dispose() { if (closed) return; closed = true; reset('disposed'); unsubscribe(); listeners.clear(); },
  });
}

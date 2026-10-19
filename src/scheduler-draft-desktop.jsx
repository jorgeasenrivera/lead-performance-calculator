import {useCallback, useEffect, useId, useRef, useState} from 'react';
import SchedulerEditor from './scheduler-editor.jsx';
import {createSchedulerDraftBinding} from './scheduler-draft-binding.mjs';
import {draftMonthView, monthName, nearbyMonths, recoveryBlocked} from './scheduler-draft-desktop-state.mjs';
import './scheduler-draft-desktop.css';

// Opt-in composition only. The caller supplies existing auth and a transport;
// there is no fetch, endpoint installation or application entry-point wiring.
export default function SchedulerDraftDesktop(props) {
  return <DraftSession key={`${props.store?.id}:${props.principalEpoch}:${props.dataEpoch}`} {...props}/>;
}
function DraftSession({auth, transport, draftCodec, onClose, onSummary, onError, confirm, ...editorProps}) {
  const [mount, setMount] = useState(0), [month, setMonth] = useState(null), [snapshot, setSnapshot] = useState(null);
  const [notice, setNotice] = useState(''), [recovering, setRecovering] = useState(false), [authEpoch, setAuthEpoch] = useState(auth.getSnapshot().principalEpoch);
  const guard = useRef(null), session = useRef(null), alive = useRef(true), activeMonth = useRef(null), heading = useRef(null), recoveryButton = useRef(null);
  const id = useId(), callbacks = useRef({onClose, onSummary, onError, confirm});
  callbacks.current = {onClose, onSummary, onError, confirm};
  const eligible = !auth.getSnapshot().disposed && authEpoch === editorProps.principalEpoch && editorProps.dataEpoch === editorProps.principalEpoch;
  const refresh = useCallback(() => {
    if (!alive.current || !session.current) return;
    try { setSnapshot(session.current.binding.getSnapshot()); }
    catch { setNotice('The editor is unavailable. Close it and reopen before continuing.'); }
  }, []);
  const clear = useCallback(() => {
    const old = session.current; session.current = null;
    old?.stop(); old?.binding.dispose();
  }, []);
  useEffect(() => {
    alive.current = true;
    const stop = auth.subscribe(() => { if (alive.current) {setAuthEpoch(auth.getSnapshot().principalEpoch); refresh();} });
    return () => {alive.current = false; stop(); clear();};
  }, [auth, clear, refresh]);
  const report = useCallback(error => {
    if (!alive.current) return;
    const code = error?.code;
    setNotice(code === 'pending-editor-controls' || code === 'unsaved-editor-changes'
      ? 'Apply or cancel pending choices. Existing edits will not be replaced.'
      : code === 'retry-required' ? 'Retry the outstanding save first.'
      : 'This action could not finish. Your edits have been kept.');
    refresh();
  }, [refresh]);
  const attach = useCallback(() => {
    if (!alive.current || !eligible || !guard.current || !activeMonth.current) return;
    try {
      if (session.current?.handle !== guard.current) {
        clear();
        const binding = createSchedulerDraftBinding({auth, transport, getEditor: () => guard.current,
          storeId: editorProps.store.id, lifetime: `desktop-${mount}`, index: 0});
        session.current = {handle: guard.current, binding, attempted: new Set(), stop: binding.subscribe(refresh)};
      }
      // Preload both boundary months before enabling editing. Cross-month edits
      // need their own known server revisions; one successful month is not atomic.
      const current = session.current;
      for (const target of nearbyMonths(activeMonth.current)) {
        if (current.attempted.has(target)) continue;
        current.attempted.add(target);
        try { void current.binding.load(target).then(() => {if (session.current === current) refresh();}, report); }
        catch (error) { report(error); }
      }
      refresh();
    } catch (error) { report(error); }
  }, [auth, transport, eligible, editorProps.store.id, mount, clear, refresh, report]);
  useEffect(() => { attach(); }, [attach]);
  const summary = detail => {
    if (detail.store === editorProps.store.id) {
      activeMonth.current = detail.month; setMonth(detail.month);
      // The mount assigns guardRef after its initial synchronous summary.
      queueMicrotask(attach);
    }
    callbacks.current.onSummary?.(detail);
  };
  const change = event => { session.current?.binding.onDraftChange(event); setNotice(''); refresh(); };
  const act = (target, kind) => {
    const current = session.current;
    if (!current) return;
    setNotice('');
    try { void current.binding[kind](target).then(() => {if (session.current === current) refresh();}, report); }
    catch (error) { report(error); }
  };
  const close = () => {
    if (recoveryBlocked(session.current?.binding.getSnapshot())) {
      setNotice('Resolve outstanding saves before closing this editor.'); return;
    }
    callbacks.current.onClose?.();
  };
  const beginRecovery = () => {
    refresh();
    if (recoveryBlocked(session.current?.binding.getSnapshot())) {setNotice('Resolve outstanding saves before reloading.'); return;}
    setRecovering(true);
    requestAnimationFrame(() => recoveryButton.current?.focus());
  };
  const reload = () => {
    if (!session.current || recoveryBlocked(session.current.binding.getSnapshot())) {
      setNotice('Resolve outstanding saves before reloading.'); return;
    }
    // The explicit confirmation names all months because remount discards the
    // entire planner, not just the currently visible month.
    clear(); setSnapshot(null); setNotice(''); setRecovering(false); setMount(n => n + 1);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const entries = snapshot?.months || [], view = draftMonthView(snapshot, month);
  const nearby = nearbyMonths(month), preparing = !month || nearby.some(m => !entries.some(e => e.month === m) || entries.some(e => e.month === m && e.operation === 'load'));
  const blocked = !eligible || preparing || recovering;
  const boundaryNotReady = nearby.some(m => !entries.find(e => e.month === m)?.loadAccepted);
  const editorBlocked = blocked || boundaryNotReady;
  const changed = snapshot?.editor?.dirtyMonths || [];
  return <section className="scheduler-draft-desktop" aria-labelledby={`${id}-title`}>
    <header className="sdd-toolbar">
      <div><h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Schedule drafts</h2><p>Save each month’s draft separately. Saving does not publish a staff schedule.</p></div>
      <button type="button" onClick={beginRecovery} disabled={!snapshot?.active || recoveryBlocked(snapshot)}>Recovery options</button>
    </header>
    <div className="sdd-status" role="status" aria-live="polite" aria-atomic="true">
      <strong>{monthName(month)}</strong><span>{notice || (preparing ? 'Loading this month and its boundary months…' : boundaryNotReady ? 'A month could not be loaded. Retry it in Month save status before editing.' : view.message)}</span>
    </div>
    {recovering && <section className="sdd-recovery" role="region" aria-labelledby={`${id}-recovery`}>
      <h3 id={`${id}-recovery`}>Discard this editor and reload?</h3>
      <p>This discards all local edits and pending choices in this editor, including {changed.length ? changed.map(monthName).join(', ') : 'any unsaved months'}. Saved drafts are kept. No edits will be merged automatically.</p>
      <div className="sdd-actions"><button ref={recoveryButton} type="button" onClick={() => {setRecovering(false);requestAnimationFrame(() => heading.current?.focus());}}>Keep editing</button>
        <button type="button" onClick={reload}>Discard local edits and reload</button></div>
    </section>}
    <div className="sdd-actions">
      <button type="button" className="sdd-primary" disabled={!view.canAct || blocked} onClick={() => act(month, view.action)}>
        {view.action === 'retry' ? 'Retry same save' : 'Save month draft'}</button>
      {view.canRead && <button type="button" disabled={blocked} onClick={() => act(month, 'load')}>Retry loading draft</button>}
      <span>{changed.length ? `${changed.length} month${changed.length === 1 ? '' : 's'} with unsaved edits` : 'No applied month edits waiting to save'}</span>
    </div>
    {snapshot?.editor?.unresolved.length > 0 && <p className="sdd-warning">A change spans multiple months. Each month must save successfully; these saves are not atomic.</p>}
    {entries.length > 0 && <details className="sdd-months" open={boundaryNotReady || undefined}><summary>Month save status</summary><ul>{entries.map(entry => {
      const row = draftMonthView(snapshot, entry.month);
      return <li key={entry.month}><div><strong>{row.label}</strong><p>{row.message}</p></div>
        {row.canAct && <button type="button" disabled={blocked} onClick={() => act(entry.month, row.action)}>{row.action === 'retry' ? `Retry ${row.label}` : `Save ${row.label}`}</button>}
        {row.canRead && <button type="button" disabled={blocked} onClick={() => act(entry.month, 'load')}>Load {row.label}</button>}</li>;
    })}</ul></details>}
    <div className="sdd-editor" inert={editorBlocked ? '' : undefined} aria-busy={preparing}>
      {eligible && <SchedulerEditor key={mount} {...editorProps} guardRef={guard} draftCodec={draftCodec} draftSaveControls
        onSummary={summary} onDraftChange={change} onClose={close} onError={error => {setNotice('The editor could not open.');callbacks.current.onError?.(error);}}
        confirm={message => callbacks.current.confirm ? callbacks.current.confirm(message) === true : globalThis.confirm(message)}/>}
    </div>
  </section>;
}

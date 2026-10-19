import {useCallback, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {createReportedMonthReader} from './reported-month.mjs';

const empty = Object.freeze([]);
const idle = Object.freeze({status: 'idle', days: empty});
const loading = Object.freeze({status: 'loading', days: empty});
const unavailable = Object.freeze({status: 'unavailable', days: empty});
const dormant = Object.freeze({status: 'idle', days: empty, principalEpoch: null});
const subscribeNothing = () => () => {};
const getDormant = () => dormant;
const sameContext = (a, b) => a?.active === b.active && a.storeId === b.storeId
  && a.loadedStoreId === b.loadedStoreId && a.month === b.month;

// Render is allowed to observe a new selection before its layout effect runs.
// Never let the old controller's ready state cross that boundary for one frame.
export function projectReportedMonthView(scope, lifetime, snapshot) {
  if (!scope.active || scope.disposed || scope.storeId !== scope.loadedStoreId) return idle;
  if (!lifetime || lifetime.closed || lifetime.auth !== scope.auth
      || !sameContext(lifetime.context, scope)) return loading;
  if (lifetime.failed) return unavailable;
  if (!snapshot || snapshot.principalEpoch !== scope.principalEpoch
      || snapshot.storeId !== scope.storeId || snapshot.month !== scope.month) return loading;
  if (!['idle', 'loading', 'ready', 'denied', 'unavailable'].includes(snapshot.status)) return unavailable;
  return {status: snapshot.status, days: snapshot.status === 'ready' ? snapshot.days : empty};
}

// The caller owns this stable auth adapter. Each committed hook lifetime owns
// only its reader. In particular, StrictMode cleanup must not close shared auth.
export function useReportedMonth({auth, storeId, loadedStoreId, month, active},
    {fetchImpl = globalThis.fetch, timeoutMs = 5000, now} = {}) {
  const identity = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const [lifetime, setLifetime] = useState(null);
  const [, renderFailure] = useState(0);
  const snapshot = useSyncExternalStore(lifetime?.reader?.subscribe || subscribeNothing,
    lifetime?.reader?.getSnapshot || getDormant, getDormant);
  const scope = {auth, principalEpoch: identity.principalEpoch, disposed: identity.disposed,
    active: active === true, storeId: storeId ?? null, loadedStoreId: loadedStoreId ?? null, month: month ?? null};

  useLayoutEffect(() => {
    const owned = {auth, fetchImpl, timeoutMs, now, closed: false, context: null, reader: null, failed: false};
    try { owned.reader = createReportedMonthReader({auth, fetchImpl, timeoutMs, ...(now ? {now} : {})}); }
    catch { owned.failed = true; }
    setLifetime(owned);
    return () => {
      owned.closed = true;
      owned.reader?.dispose();
    };
  }, [auth, fetchImpl, timeoutMs, now]);

  useLayoutEffect(() => {
    if (!lifetime || lifetime.closed || lifetime.auth !== auth) return;
    const next = {active: active === true, storeId: storeId ?? null,
      loadedStoreId: loadedStoreId ?? null, month: month ?? null};
    if (sameContext(lifetime.context, next)) return;
    lifetime.context = next;
    lifetime.reader?.setContext(lifetime.context);
    // Constructor failure has no external-store notification to render its
    // context. Publish the owned failure without retaining exception details.
    if (lifetime.failed) renderFailure(value => value + 1);
  }, [lifetime, auth, active, storeId, loadedStoreId, month]);

  const context = lifetime?.context;
  const retry = useCallback(() => {
    if (!lifetime || lifetime.closed || lifetime.auth !== auth || lifetime.context !== context
        || !context?.active || context.storeId !== context.loadedStoreId) return;
    const current = auth.getSnapshot();
    if (current.disposed || current.principalEpoch !== identity.principalEpoch) return;
    lifetime.reader?.retry();
  }, [lifetime, context, auth, identity.principalEpoch]);
  const currentLifetime = lifetime?.fetchImpl === fetchImpl && lifetime?.timeoutMs === timeoutMs
    && lifetime?.now === now ? lifetime : null;
  return {...projectReportedMonthView(scope, currentLifetime, snapshot), retry};
}

// Deterministic, network-free fetch replacement. No persistence, real auth or real store IDs.
// Deliberately does not decide whether a response may update the component.
export function createControlledTransport({ abortMode = 'respect' } = {}) {
  if (!['respect', 'ignore'].includes(abortMode)) throw new Error('Choose respect or ignore for abortMode');
  const requests = [];
  let nextId = 1;
  const snapshot = (r) => ({ id: r.id, storeId: r.storeId, month: r.month, state: r.state, aborted: r.aborted });
  const byId = (id) => {
    const request = requests.find((r) => r.id === id);
    if (!request) throw new Error(`Unknown synthetic request ${id}`);
    return request;
  };
  const finish = (request, state, action) => {
    if (request.state !== 'pending') return false;
    request.state = state;
    request.cleanup?.();
    action();
    return true;
  };
  return {
    fetch(input, init = {}) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, 'https://fixture.invalid');
      const method = init.method || input?.method || 'GET';
      if (url.pathname !== '/api/daily-deliveries' || method !== 'GET'
        || !['fixture.invalid', 'localhost', '127.0.0.1'].includes(url.hostname)
        || url.username || url.password || url.hash) throw new Error('Non-fixture request blocked');
      const storeId = url.searchParams.get('store'), month = url.searchParams.get('month');
      if (!['fictional-a', 'fictional-b'].includes(storeId) || !['2026-09', '2026-10'].includes(month)
        || url.searchParams.getAll('store').length !== 1 || url.searchParams.getAll('month').length !== 1
        || [...url.searchParams.keys()].some((key) => !['store', 'month'].includes(key))) throw new Error('Non-fixture identity blocked');
      const signal = init.signal || input?.signal;
      return new Promise((resolve, reject) => {
        const request = { id: nextId++, storeId, month, state: 'pending', aborted: false, resolve, reject };
        requests.push(request);
        const onAbort = () => {
          request.aborted = true;
          if (abortMode === 'respect') finish(request, 'aborted', () => reject(new DOMException('Synthetic request aborted', 'AbortError')));
        };
        request.cleanup = () => signal?.removeEventListener('abort', onAbort);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    },
    get requests() { return requests.map(snapshot); },
    get pending() { return requests.filter((r) => r.state === 'pending').map(snapshot); },
    settle(id, { status = 200, body, rawBody, headers = {} }) {
      const request = byId(id);
      return finish(request, 'settled', () => request.resolve(new Response(rawBody ?? JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Authorization', ...headers },
      })));
    },
    fail(id, kind = 'network') {
      if (!['network', 'timeout'].includes(kind)) throw new Error('Choose network or timeout');
      const request = byId(id);
      return finish(request, 'rejected', () => request.reject(kind === 'timeout'
        ? new DOMException('Synthetic timeout', 'TimeoutError') : new TypeError('Synthetic network failure')));
    },
  };
}

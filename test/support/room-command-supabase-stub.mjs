// No SDK, no socket: the handler's createClient() returns whatever fake the test installed for this request.
export function createClient() {
  if (!globalThis.__FAKE_DB) throw new Error('no fake db installed');
  return globalThis.__FAKE_DB;
}

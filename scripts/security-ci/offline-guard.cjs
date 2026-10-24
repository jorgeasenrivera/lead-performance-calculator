const net = require('node:net');
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');
const local = h => ['localhost','127.0.0.1','::1','[::1]'].includes(String(h));
const deny = h => { throw new Error('AUDIT_BLOCKED_NONLOCAL_NETWORK: '+String(h)); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const opts = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host = opts && typeof opts === 'object' ? opts.host : (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (opts && typeof opts === 'object' && opts.path) deny('unix-socket');
  if (!local(host || 'localhost')) deny(host);
  return originalConnect.apply(this,args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, opts) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) deny(url.hostname);
  return originalFetch(input, opts);
};
for (const key of ['lookup','resolve','resolve4','resolve6','reverse']) {
  const old = dns[key];
  dns[key] = function(host,...rest) { if (!local(host)) deny(host); return old.call(this,host,...rest); };
}
syncBuiltinESMExports();

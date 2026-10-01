import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createReportedAuthAdapter} from '../src/reported-auth.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject}; };
const session = token => ({data: {session: token === null ? null : {access_token: token, user: {id: 'fictional-account'}}}, error: null});
function fixture(t, read = async () => session('fixture.current.token'), options) {
  let callback, calls = 0, unsubscriptions = 0, insideAuth = false;
  const client = {auth: {
    getSession() { assert.equal(insideAuth, false, 'no SDK call inside its auth callback'); calls++; return read(); },
    onAuthStateChange(fn) { callback=fn; return {data: {subscription: {unsubscribe() {unsubscriptions++;}}}}; },
  }};
  const adapter = createReportedAuthAdapter(client, options);
  t.after(() => adapter.dispose());
  return {adapter, calls: () => calls, unsubscriptions: () => unsubscriptions,
    emit(event = 'SIGNED_IN') { insideAuth=true; try { callback(event, {access_token:'never.persist.this'}); } finally {insideAuth=false;} },
  };
}

test('an opt-in adapter reads the current token per attempt without storing credentials', async t => {
  let token = 'fixture.first.token';
  const f = fixture(t, async () => session(token));
  assert.equal(f.calls(), 0);
  assert.equal(await f.adapter.getAccessToken(), token);
  token = 'fixture.second.token';
  assert.equal(await f.adapter.getAccessToken(), token);
  assert.equal(f.calls(), 2);
  assert.deepEqual(f.adapter.getSnapshot(), {principalEpoch: 0, disposed: false});
  assert.ok(Object.isFrozen(f.adapter.getSnapshot()));
  assert.equal(JSON.stringify(f.adapter.getSnapshot()).includes('token'), false);
});

test('every auth event invalidates same-store and same-account readers with a non-secret epoch', t => {
  const f = fixture(t);
  const first = f.adapter.getSnapshot(); let notifications = 0;
  const stop = f.adapter.subscribe(() => notifications++);
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_OUT']) f.emit(event);
  assert.equal(first.principalEpoch, 0);
  assert.equal(f.adapter.getSnapshot().principalEpoch, 5);
  assert.equal(notifications, 5);
  stop(); f.emit(); assert.equal(notifications, 5);
});

test('a subscriber requesting a token does not reenter the auth SDK callback', async t => {
  const f = fixture(t); let pending;
  f.adapter.subscribe(() => {pending = f.adapter.getAccessToken();});
  f.emit(); assert.equal(f.calls(), 0);
  assert.equal(await pending, 'fixture.current.token');
});

test('abort and epoch mismatch before acquisition make no SDK call', async t => {
  const f = fixture(t), controller = new AbortController();
  controller.abort();
  assert.equal(await f.adapter.getAccessToken({signal: controller.signal}), null);
  f.emit();
  assert.equal(await f.adapter.getAccessToken({expectedEpoch: 0}), null);
  assert.equal(f.calls(), 0);
});

test('account changes during delayed acquisition resolve cancelled and suppress the late token', async t => {
  const wait = deferred(), started = deferred();
  const f = fixture(t, () => {started.resolve(); return wait.promise;});
  const pending = f.adapter.getAccessToken(); await started.promise;
  f.emit('SIGNED_OUT');
  assert.equal(await pending, null);
  wait.resolve(session('fixture.old.token'));
  assert.equal(f.adapter.getSnapshot().principalEpoch, 1);
});

test('abort during a hung acquisition settles without waiting for the SDK', async t => {
  const wait = deferred(), started = deferred(), controller = new AbortController();
  const f = fixture(t, () => {started.resolve(); return wait.promise;});
  const pending = f.adapter.getAccessToken({signal: controller.signal}); await started.promise;
  controller.abort(); assert.equal(await pending, null);
  wait.reject(new Error('fictional private SDK message'));
});

test('a bounded hung acquisition is unavailable, and a later retry remains usable', async t => {
  let hang = true;
  const f = fixture(t, () => hang ? new Promise(() => {}) : session('fixture.retry.token'), {timeoutMs: 20});
  await assert.rejects(f.adapter.getAccessToken(), error => error.code === 'REPORTED_AUTH_UNAVAILABLE' && error.message === 'Reported auth unavailable' && !error.cause);
  hang = false;
  assert.equal(await f.adapter.getAccessToken(), 'fixture.retry.token');
});

test('missing session is null, while SDK faults and malformed credentials remain unavailable', async t => {
  let result = session(null);
  const f = fixture(t, () => result);
  assert.equal(await f.adapter.getAccessToken(), null);
  for (result of [{error: new Error('private diagnostics')}, {}, session(''), session('unsafe\r\nheader'), session('x'.repeat(8193))]) {
    await assert.rejects(f.adapter.getAccessToken(), error => error.message === 'Reported auth unavailable' && !error.cause);
  }
});

test('a late SDK result cannot beat an overdue timer on a blocked event loop', async t => {
  const f = fixture(t, () => {
    const until = Date.now() + 25;
    while (Date.now() < until) { /* Synthetic blocked SDK, no network. */ }
    return session('fixture.late.token');
  }, {timeoutMs: 10});
  await assert.rejects(f.adapter.getAccessToken(), {code: 'REPORTED_AUTH_UNAVAILABLE'});
});

test('one failed view listener cannot break auth invalidation for the remaining readers', t => {
  const f = fixture(t); let observed = 0;
  f.adapter.subscribe(() => {throw new Error('fictional view fault');});
  f.adapter.subscribe(() => observed++);
  assert.doesNotThrow(() => f.emit());
  assert.equal(observed, 1);
  assert.equal(f.adapter.getSnapshot().principalEpoch, 1);
});

test('disposal cancels pending reads and removes the subscription once', async t => {
  const wait = deferred(), started = deferred();
  const f = fixture(t, () => {started.resolve(); return wait.promise;});
  const pending = f.adapter.getAccessToken(); await started.promise;
  f.adapter.dispose(); f.adapter.dispose();
  assert.equal(await pending, null);
  assert.equal(f.unsubscriptions(), 1);
  const final = f.adapter.getSnapshot();
  f.emit(); assert.equal(f.adapter.getSnapshot(), final);
  assert.equal(final.disposed, true);
  assert.equal(await f.adapter.getAccessToken(), null);
  assert.equal(f.calls(), 1);
  wait.resolve(session('fixture.disposed.token'));
});

test('unavailable auth lifecycle is rejected, not a token getter without invalidation', () => {
  assert.throws(() => createReportedAuthAdapter(null), /Reported auth unavailable/);
  assert.throws(() => createReportedAuthAdapter({auth:{getSession(){}}}), /Reported auth unavailable/);
  assert.throws(() => createReportedAuthAdapter({auth:{getSession(){},onAuthStateChange(){return {};}}}), /Reported auth unavailable/);
});

test('application screens and global request helper do not import the preparatory adapter', () => {
  for (const file of ['LeadPerformanceCalculator.jsx', 'Manager.jsx', 'main.jsx']) {
    assert.equal(fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8').includes('reported-auth'), false);
  }
});

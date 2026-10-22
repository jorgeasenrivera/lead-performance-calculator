import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchedulerDraftTransport, copyDraftJson} from '../src/scheduler-draft-transport.mjs';
const scope = {storeId: 'fictional', month: '2026-10'};
const model = {availability: {known: false, source: 'missing'}, provenance: {revision: 7}};
const codec = {encode: v => v, decode: v => v, validateScope: s => s.storeId === scope.storeId && s.month === scope.month};
function setup(payload = {result: {kind: 'draft', revision: 0, schedule: null}}, status = 200, options = {}) {
  const calls = [];
  const auth = {getSnapshot: () => ({principalEpoch: 3}), getAccessToken: async () => 'synthetic.token'};
  const transport = createSchedulerDraftTransport({auth, codec, requestId: () => 'request-1',
    fetchImpl: async (...args) => { calls.push(args); return {status, json: async () => payload}; }, ...options});
  return {transport, calls, auth};
}
const send = (t, command) => t.send(command, {expectedEpoch: 3});
test('read envelope is exact; absent is not unavailable', async () => {
  const {transport: t, calls} = setup();
  assert.deepEqual(await send(t, t.prepareRead(scope)), {kind: 'draft', revision: 0, draft: null});
  assert.deepEqual(JSON.parse(calls[0][1].body), {op: 'read', ...scope, input: {kind: 'draft'}});
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic.token');
  const {transport: dormant} = setup({error: 'storage-not-configured'}, 503);
  await assert.rejects(send(dormant, dormant.prepareRead(scope)), {code: 'storage-not-configured'});
});
test('save freezes body and identity; retry uses refreshed token, never payload auth', async () => {
  let token = 'one', id = 0;
  const {transport: t, calls} = setup({result: {head: {draftRev: 2, publishedRev: 0}}, replayed: true}, 200, {
    requestId: () => `request-${++id}`, auth: {getSnapshot: () => ({principalEpoch: 3}), getAccessToken: async () => token}});
  const editable = structuredClone(model), command = t.prepareSave(scope, 1, editable);
  editable.availability.known = true;
  await send(t, command); token = 'two'; await send(t, command);
  assert.equal(calls[0][1].body, calls[1][1].body);
  assert.deepEqual(JSON.parse(command.body), {op: 'save', ...scope, requestId: 'request-1', input: {baseRev: 1, draft: model}});
  assert.equal(calls[1][1].headers.Authorization, 'Bearer two');
  assert.equal(id, 1);
});
test('codec preserves unknown evidence and rejects lossy conversion', async () => {
  const {transport: t} = setup({result: {kind: 'draft', revision: 4, schedule: model}});
  assert.deepEqual((await send(t, t.prepareRead(scope))).draft, model);
  const {transport: lossy} = setup(undefined, 200, {codec: {...codec, encode: () => ({})}});
  assert.throws(() => lossy.prepareSave(scope, 0, model), {code: 'unsupported-data'});
  const {transport: badRead} = setup({result: {kind: 'draft', revision: 1, schedule: model}}, 200,
    {codec: {...codec, decode: () => ({})}});
  await assert.rejects(send(badRead, badRead.prepareRead(scope)), {code: 'invalid-response'});
});
test('strict JSON copy rejects data JSON would silently lose', () => {
  for (const value of [undefined, NaN, -0, new Date(), {a: undefined}, {a: () => {}}, [,1], Object.assign([], {extra: 1}),
    {[Symbol('x')]: 1}, Object.defineProperty({}, 'hidden', {value: 1}), {get a() { throw Error('getter ran'); }}]) {
    assert.throws(() => copyDraftJson(value), {code: 'unsupported-data'});
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => copyDraftJson(cycle), {code: 'unsupported-data'});
});
test('read rejects published, inconsistent, extra and malformed response fields', async () => {
  for (const payload of [
    {result: {kind: 'published', revision: 1, schedule: model}},
    {result: {kind: 'draft', revision: 0, schedule: model}},
    {result: {kind: 'draft', revision: 1, schedule: null}},
    {result: {kind: 'draft', revision: -1, schedule: null}},
    {result: {kind: 'draft', revision: 0, schedule: null}, replayed: false},
    {result: {kind: 'draft', revision: 0, schedule: null, extra: true}},
  ]) { const {transport: t} = setup(payload); await assert.rejects(send(t, t.prepareRead(scope)), {code: 'invalid-response'}); }
});
test('save validates exact head and replay response', async () => {
  for (const payload of [{result: {head: {draftRev: 1, publishedRev: 0}}},
    {result: {head: {draftRev: 0, publishedRev: 0}}, replayed: false},
    {result: {head: {draftRev: 1, publishedRev: -1}}, replayed: false},
    {result: {head: {draftRev: 1, publishedRev: 0, other: 1}}, replayed: false}]) {
    const {transport: t} = setup(payload); await assert.rejects(send(t, t.prepareSave(scope, 0, model)), {code: 'invalid-response'});
  }
});
test('error code and status must agree; network/malformed saves are uncertain', async () => {
  for (const [code, status] of [['conflict',409], ['idempotency-conflict',409], ['unauthenticated',401], ['forbidden',403], ['contract-rejected',422]]) {
    const {transport: t} = setup({error: code}, status);
    await assert.rejects(send(t, t.prepareSave(scope, 0, model)), e => e.code === code && !e.uncertain);
  }
  const {transport: mismatch} = setup({error: 'conflict'}, 503);
  await assert.rejects(send(mismatch, mismatch.prepareSave(scope, 0, model)), {code: 'invalid-response', uncertain: true});
  const {transport: network} = setup(null, 200, {fetchImpl: async () => { throw Error('network'); }});
  await assert.rejects(send(network, network.prepareSave(scope, 0, model)), {code: 'transport-unavailable', uncertain: true});
});
test('epoch changes during token acquisition prevent sending', async () => {
  let epoch = 3;
  const {transport: t, calls} = setup(null, 200, {auth: {getSnapshot: () => ({principalEpoch: epoch}),
    getAccessToken: async () => { epoch++; return 'token'; }}});
  await assert.rejects(send(t, t.prepareRead(scope)), {code: 'stale'});
  assert.equal(calls.length, 0);
});
test('timeout settles even when fetch ignores abort', async () => {
  const {transport: t} = setup(null, 200, {timeoutMs: 5, fetchImpl: () => new Promise(() => {})});
  await assert.rejects(send(t, t.prepareSave(scope, 0, model)), {code: 'timeout', uncertain: true});
});
test('unsupported post-dispatch response is uncertain even when parsing succeeded', async () => {
  let deep = {}; for (let i = 0; i < 70; i++) deep = {deep};
  const {transport: t} = setup(deep);
  await assert.rejects(send(t, t.prepareSave(scope, 0, model)), {code: 'invalid-response', uncertain: true});
});

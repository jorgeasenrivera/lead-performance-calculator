// Source guards only: native SDK compilation and device behavior require separate validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const swift = fs.readFileSync(new URL('../native/targets/queue/QueueIntents.swift', import.meta.url), 'utf8');
const kotlin = fs.readFileSync(new URL('../native/modules/sage-live/android/src/main/java/com/sageonline/sagelive/QueueActionReceiver.kt', import.meta.url), 'utf8');

test('iOS remote presses skip optimistic state and reread current state before clearing the ring', () => {
  const nudge = swift.split('private func nudgeNow()')[1].split('private struct ServerAcknowledgement')[0];
  assert.match(nudge, /if isLocalOnly \{ apply\(&s\) \}/);
  assert.equal((nudge.match(/apply\(&s\)/g) || []).length, 1);
  assert.match(nudge, /Task\.sleep[\s\S]*s = a\.content\.state[\s\S]*s\.pressed = nil/);
});

test('iOS requires a typed acknowledgment but a valid no-op does not trigger replay', () => {
  assert.match(swift, /struct ServerAcknowledgement: Decodable \{\s*let ok: Bool\s*let changed: Bool\s*\}/);
  const server = swift.split('private func viaServer()')[1].split('private func buzz()')[0];
  assert.match(server, /\(200\.\.<300\)\.contains\(http\.statusCode\)/);
  assert.match(server, /JSONDecoder\(\)\.decode\(ServerAcknowledgement\.self, from: data\)/);
  assert.match(server, /ack\.ok else \{ return \.unconfirmed \}/);
  assert.match(swift, /case \.acknowledged, \.unconfirmed: return \.result\(\)/);
  assert.doesNotMatch(server, /ack\.changed/);
});

test('Android applies local confirmation only and accepts both Boolean changed outcomes', () => {
  assert.equal((kotlin.match(/SageLiveStore\.optimistic/g) || []).length, 1);
  assert.match(kotlin, /if \(action == "ask-done" \|\| action == "keep"\) \{\s*SageLiveStore\.optimistic\(ctx, action\)/);
  assert.match(kotlin, /responseCode !in 200\.\.299/);
  assert.match(kotlin, /ack\.opt\("ok"\) == true && ack\.opt\("changed"\) is Boolean/);
  assert.match(kotlin, /if \(post\(ctx, action\) == ServerOutcome\.UNAVAILABLE\) SageLiveStore\.remember\(ctx, action\)/);
  assert.match(kotlin, /catch \(e: Throwable\) \{ ServerOutcome\.UNCONFIRMED \}/);
});

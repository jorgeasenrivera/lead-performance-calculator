import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryContinuity, RECOVERY_CONTINUITY_KEY as KEY, RECOVERY_INTERRUPTED_NOTICE as NOTICE } from "../src/recovery-continuity.mjs";
import { createRecoveryGuard } from "../src/recovery-session.mjs";

function fixture() {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  let id = 0;
  return { data, storage, create: () => createRecoveryContinuity({ storage, makeId: () => `context-${++id}` }) };
}
const A = "synthetic-a", B = "synthetic-b";

test("reload restores only approved interruption UI, with no credentials or write proof", () => {
  const f = fixture(); const first = f.create(); first.begin(A);
  assert.deepEqual(JSON.parse(f.data.get(KEY)), { version: 1, userId: A, id: "context-1" });
  const next = f.create(); const restored = next.restore(A);
  assert.equal(restored.status, "interrupted"); assert.equal(restored.notice, NOTICE);
  assert.equal(NOTICE, "This reset was interrupted. To choose a new password, request a fresh link.");
  assert.equal(next.succeeded(restored.context), false);
  const guard = createRecoveryGuard(null);
  assert.equal(guard.binding(), null); assert.equal(guard.canSave(A), false);
});

test("reload before or during a PUT produces the same unknown-outcome UI, without calling any writer", async () => {
  for (const dispatched of [false, true]) {
    const f = fixture(); const helper = f.create(); const old = helper.begin(A);
    let writes = 0, finish;
    const pending = dispatched ? new Promise((resolve) => { writes++; finish = resolve; }) : Promise.resolve();
    const restored = helper.restore(A);
    assert.equal(restored.status, "interrupted");
    if (finish) finish(); await pending;
    assert.equal(helper.succeeded(old), false);
    assert.equal(helper.snapshot().status, "interrupted"); assert.equal(writes, Number(dispatched));
    assert.equal(helper.dismiss(restored.context), true);
    assert.equal(helper.snapshot().status, "idle");
  }
});

test("wrong settled identity and logout discard context and prevent later restoration", () => {
  for (const userId of [B, null]) {
    const f = fixture(); const h = f.create(); const old = h.begin(A);
    assert.equal(h.reconcileIdentity(userId).status, "idle");
    assert.equal(f.data.has(KEY), false); assert.equal(h.succeeded(old), false);
    assert.equal(f.create().restore(A).status, "idle");
  }
  const f = fixture(); f.create().begin(A);
  assert.equal(f.create().restore(B).status, "idle"); assert.equal(f.data.has(KEY), false);
});

test("same-user token rotation retains context; success clears it", () => {
  const f = fixture(); const h = f.create(); const context = h.begin(A);
  assert.equal(h.reconcileIdentity(A).context, context);
  assert.equal(h.succeeded(context), true); assert.equal(h.succeeded(context), false);
  assert.equal(f.create().restore(A).status, "idle");
});

test("explicit dismissal cannot discard tracking recovery; existing P1/P2 guard stays unchanged", () => {
  const f = fixture(); const h = f.create(); const context = h.begin(A);
  const guard = createRecoveryGuard(null);
  guard.onAuthEvent("PASSWORD_RECOVERY", { user: { id: A }, access_token: "synthetic-token" });
  assert.equal(h.dismiss(context), false); guard.dismiss();
  assert.equal(guard.canSave(A), true);
  guard.invalidate(); assert.equal(h.failed(context), true);
  assert.equal(h.succeeded(context), false);
  assert.equal(h.dismiss(context), true); guard.dismiss();
  assert.equal(guard.snapshot().status, "idle"); assert.equal(f.data.has(KEY), false);
});

test("late completion, failure and dismissal cannot mutate a newer same-user or different-user context", () => {
  for (const nextUser of [A, B]) {
    const f = fixture(); const h = f.create(); const old = h.begin(A); const current = h.begin(nextUser);
    const raw = f.data.get(KEY);
    for (const method of ["succeeded", "failed", "dismiss"]) assert.equal(h[method](old), false);
    assert.equal(h.succeeded({}), false); assert.equal(f.data.get(KEY), raw);
    assert.equal(h.snapshot().context, current); assert.equal(h.succeeded(current), true);
  }
});

test("older helper instance cannot erase a newer stored context", () => {
  const f = fixture(); const oldHelper = f.create(); const old = oldHelper.begin(A);
  const current = f.create(); current.begin(A); const raw = f.data.get(KEY);
  assert.equal(oldHelper.succeeded(old), false); assert.equal(oldHelper.failed(old), false);
  assert.equal(f.data.get(KEY), raw); assert.equal(current.snapshot().status, "tracking");
});

test("a restored instance rotates context against a surviving pre-reload response", () => {
  const f = fixture(); const before = f.create(); const old = before.begin(A);
  const after = f.create(); const restored = after.restore(A); const raw = f.data.get(KEY);
  assert.equal(restored.status, "interrupted");
  assert.equal(before.succeeded(old), false); assert.equal(before.failed(old), false);
  assert.equal(f.data.get(KEY), raw); assert.equal(after.snapshot().status, "interrupted");
});

test("malformed, oversized, extra-field and altered-version markers are discarded", () => {
  const good = { version: 1, userId: A, id: "context-1" };
  for (const raw of ["broken", "null", "[]", "x".repeat(401), JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, accessToken: "injected" }), JSON.stringify({ ...good, password: "injected" }),
    JSON.stringify({ ...good, userId: "" }), JSON.stringify({ ...good, id: {} })]) {
    const f = fixture(); f.data.set(KEY, raw);
    assert.equal(f.create().restore(A).status, "idle"); assert.equal(f.data.has(KEY), false);
  }
});

test("a well-shaped forged matching marker can show UI only, never prove a recovery", () => {
  const f = fixture(); f.data.set(KEY, JSON.stringify({ version: 1, userId: A, id: "forged" }));
  const h = f.create(); const result = h.restore(A);
  assert.equal(result.status, "interrupted"); assert.equal(h.succeeded(result.context), false);
  assert.equal(h.failed(result.context), false);
  const guard = createRecoveryGuard(null); assert.equal(guard.canSave(A), false); assert.equal(guard.binding(), null);
});

test("Back/Forward conceptual re-entry cannot revive a prior live handle or cleared marker", () => {
  const f = fixture(); const h = f.create(); const old = h.begin(A);
  const back = h.restore(A); assert.equal(h.succeeded(old), false);
  h.dismiss(back.context); assert.equal(h.restore(A).status, "idle");
  assert.equal(h.succeeded(back.context), false);
  // Actual BFCache event wiring must also invalidate the separate recovery guard.
});

test("denied storage and denied identifier generation cost continuity, not safety", () => {
  const denied = () => { throw new Error("denied"); };
  for (const storage of [undefined, { getItem: denied, setItem: denied, removeItem: denied }]) {
    const h = createRecoveryContinuity({ storage, makeId: () => "context" });
    const context = h.begin(A); assert.equal(h.dismiss(context), false);
    assert.equal(h.restore(A).status, "idle"); assert.equal(h.succeeded(context), false);
  }
  const f = fixture(); const h = createRecoveryContinuity({ storage: f.storage, makeId: denied });
  const context = h.begin(A); assert.ok(context); assert.equal(f.data.has(KEY), false);
  assert.equal(h.succeeded(context), false); assert.equal(h.snapshot().status, "idle");
});

test("storage loss, closing a tab and no marker give no continuity guarantee", () => {
  const f = fixture(); f.create().begin(A); f.data.clear();
  assert.equal(f.create().restore(A).status, "idle"); assert.equal(fixture().create().restore(A).status, "idle");
});

test("individual storage operation failures never restore authority or throw", () => {
  for (const operation of ["getItem", "setItem", "removeItem"]) {
    const f = fixture(); const original = f.storage[operation];
    const h = f.create(); const context = h.begin(A);
    f.storage[operation] = () => { throw new Error("denied"); };
    assert.doesNotThrow(() => h.succeeded(context));
    const next = f.create(); const restored = next.restore(A);
    assert.ok(["idle", "interrupted"].includes(restored.status));
    if (restored.context) assert.equal(next.succeeded(restored.context), false);
    f.storage[operation] = original;
    // If deletion was denied, a later document may show a stale notice only.
    const guard = createRecoveryGuard(null); assert.equal(guard.canSave(A), false);
  }
});

test("invalid begin identity does not replace a current context", () => {
  const f = fixture(); const h = f.create(); const context = h.begin(A); const raw = f.data.get(KEY);
  for (const bad of [null, {}, "", "email@example.test", "a".repeat(129)]) assert.equal(h.begin(bad), null);
  assert.equal(h.snapshot().context, context); assert.equal(f.data.get(KEY), raw);
});

test("old success cannot verify ownership after newer begin/restore with throwing read or missing marker", () => {
  for (const transition of ["begin", "restore"]) for (const missing of [false, true]) {
    const f = fixture(); const older = f.create(); const old = older.begin(A);
    const newer = f.create(); newer[transition](A);
    const current = newer.snapshot();
    if (missing) f.data.delete(KEY);
    else f.storage.getItem = () => { throw new Error("read denied"); };
    const raw = f.data.get(KEY);
    assert.equal(older.succeeded(old), false, `${transition}: missing=${missing}`);
    assert.equal(f.data.get(KEY), raw);
    assert.equal(newer.snapshot().context, current.context);
    assert.equal(newer.snapshot().status, current.status);
  }
});

test("tampered, replaced, missing or unreadable markers cannot block explicit interruption exit", () => {
  for (const replacement of ["tampered", "newer", "missing", "denied"]) {
    const f = fixture(); f.create().begin(A);
    const h = f.create(); const interrupted = h.restore(A);
    if (replacement === "tampered") f.data.set(KEY, "untrusted alteration");
    if (replacement === "newer") f.create().begin(A);
    if (replacement === "missing") f.data.delete(KEY);
    if (replacement === "denied") f.storage.getItem = () => { throw new Error("denied"); };
    const raw = f.data.get(KEY);
    assert.equal(h.dismiss({}), false);
    assert.equal(h.dismiss(interrupted.context), true);
    assert.equal(h.snapshot().status, "idle");
    assert.equal(f.data.get(KEY), raw, "do not delete unverifiable or newer persisted context");
  }
});

test("live success acceptance is independent of denied marker bookkeeping", () => {
  const denied = () => { throw new Error("denied"); };
  const h = createRecoveryContinuity({ storage: { getItem: denied, setItem: denied, removeItem: denied } });
  const guard = createRecoveryGuard(null);
  guard.onAuthEvent("PASSWORD_RECOVERY", { user: { id: A }, access_token: "synthetic-token" });
  const context = h.begin(A); const captured = guard.binding();
  // Contract example only: the core owner must wire and verify the real attempt
  // identity and guard check before handling the successful network response.
  assert.equal(guard.canSave(A), true); assert.deepEqual(guard.binding(), captured);
  const cleanupVerified = h.succeeded(context);
  assert.equal(cleanupVerified, false); assert.equal(h.snapshot().status, "idle");
  guard.done(); assert.equal(guard.snapshot().status, "idle");
});

test("a real failed attempt can release local UI even with unavailable persistence", () => {
  const h = createRecoveryContinuity(); const context = h.begin(A);
  assert.equal(h.dismiss(context), false);
  assert.equal(h.failed(context), true); assert.equal(h.dismiss(context), true);
  assert.equal(h.snapshot().status, "idle");
});

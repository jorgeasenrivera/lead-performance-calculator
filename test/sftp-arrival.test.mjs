/* The SFTP server's notices to Sage (C96).
   Who may speak, what may be said, and that the same file twice is one
   arrival. The handler runs against injected storage, as vitals does. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanArrival, secretOk, SECRET_HEADER } from "../api/_sftp-arrival.mjs";
import { handle } from "../api/sftp-arrival.mjs";

const SHA = "a".repeat(64);
const good = { account: "promptpath", filename: "phone-closing-2026-09-24.csv", size: 2048, sha256: SHA };

test("the secret: right one passes, anything else is refused, and unset never opens", () => {
  assert.equal(secretOk("s3cret", "s3cret"), true);
  assert.equal(secretOk("s3cret", "s3creT"), false);
  assert.equal(secretOk("s3cre", "s3cret"), false);
  assert.equal(secretOk("", "s3cret"), false);
  assert.equal(secretOk(undefined, undefined), false, "no secret configured is a refusal, not a pass");
  assert.equal(secretOk("x", ""), false);
});

test("only a plain name, a size, a fingerprint and the account are kept", () => {
  const c = cleanArrival({ ...good, contents: "customer,phone\nA,555" });
  assert.deepEqual(c, { ok: true, row: { filename: good.filename, size_bytes: 2048, sha256: SHA, account: "promptpath" } },
    "anything else sent along is dropped, never stored");
  for (const filename of ["", "../etc/passwd", "a/b.csv", "a\\b.csv", ".", "..", "x\u0000y", "x".repeat(201)]) {
    assert.equal(cleanArrival({ ...good, filename }).ok, false, `refuses ${JSON.stringify(filename)}`);
  }
  assert.equal(cleanArrival({ ...good, size: -1 }).ok, false);
  assert.equal(cleanArrival({ ...good, size: 1.5 }).ok, false);
  assert.equal(cleanArrival({ ...good, sha256: "abc" }).ok, false);
  assert.equal(cleanArrival({ ...good, sha256: SHA.toUpperCase() }).row.sha256, SHA, "case does not matter");
  assert.equal(cleanArrival({ ...good, account: "Root; drop" }).ok, false);
});

function run(method, { body, query, secret = "s3cret" } = {}, store = []) {
  let status = 0, out = null;
  const res = { status(c) { status = c; return this; }, json(o) { out = o; return this; } };
  const deps = {
    secret: "s3cret",
    find: async (sha, name) => store.find((r) => r.sha256 === sha && (!name || r.filename === name)) || null,
    insert: async (row) => { store.push({ ...row, received_at: "2026-09-24T12:00:00Z" }); },
  };
  return handle({ method, headers: secret ? { [SECRET_HEADER]: secret } : {}, body, query }, res, deps).then(() => ({ status, out, store }));
}

test("a notice is recorded once, and the same file again is a duplicate", async () => {
  const store = [];
  const first = await run("POST", { body: good }, store);
  assert.equal(first.status, 201);
  const again = await run("POST", { body: good }, store);
  assert.equal(again.status, 200); assert.equal(again.out.duplicate, true);
  assert.equal(store.length, 1);
});

test("without the secret nothing is read or written", async () => {
  const store = [];
  assert.equal((await run("POST", { body: good, secret: null }, store)).status, 401);
  assert.equal((await run("POST", { body: good, secret: "wrong" }, store)).status, 401);
  assert.equal((await run("GET", { query: { sha256: SHA }, secret: null }, store)).status, 401);
  assert.equal(store.length, 0);
});

test("the check can ask whether a file arrived", async () => {
  const store = [];
  assert.equal((await run("GET", { query: { sha256: SHA } }, store)).status, 404);
  await run("POST", { body: good }, store);
  const found = await run("GET", { query: { sha256: SHA } }, store);
  assert.equal(found.status, 200);
  assert.equal(found.out.arrival.filename, good.filename);
  assert.equal((await run("GET", { query: { sha256: "nope" } }, store)).status, 400);
});

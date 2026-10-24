import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BASE, BRANCH, REPOSITORY, RECEIPT, WORKFLOW, sha256, normalizedWorkflow, verifySnapshot } from './verify.mjs';
// Entirely in-memory fictional Git trees. No application/receipt/worktree fixture reads.
const file = (text, mode = '100644') => ({ bytes: Buffer.from(text), mode });
const oid = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function fixture({ local = false, editManifest } = {}) {
  const before = { 'scripts/$literal.mjs': file('literal filename'), 'api/example.mjs': file('before'), 'src/LeadPerformanceCalculator.jsx': file('core'),
    'scripts/search-runtime.sha256': file('historical'), '.github/workflows/manager-spacing.yml': file('historical workflow') };
  const files = { ...before, 'api/example.mjs': file('reviewed'), 'scripts/security-ci/example.test.mjs': file('fictional test') };
  const workflowTemplate = 'env:\n  SECURITY_RECEIPT_SHA256: "' + '0'.repeat(64) + '"\nsteps: reviewed\n';
  files[WORKFLOW] = file(workflowTemplate);
  const expectedChanges = ['api/example.mjs', 'scripts/security-ci/example.test.mjs', WORKFLOW, RECEIPT];
  const manifest = { version: 1, base: BASE, branch: BRANCH, expectedChanges,
    files: Object.fromEntries(expectedChanges.filter(p => p !== RECEIPT).map(p => [p, { sha256: sha256(files[p].bytes), mode: files[p].mode,
      ...(p === WORKFLOW ? { normalize: 'workflow-receipt-anchor' } : {}) }])), tests: ['scripts/security-ci/example.test.mjs'] };
  editManifest?.(manifest);
  files[RECEIPT] = file(JSON.stringify(manifest)); const anchor = sha256(files[RECEIPT].bytes);
  files[WORKFLOW] = file(workflowTemplate.replace('0'.repeat(64), anchor));
  const snapshot = { head: local ? BASE : 'a'.repeat(40), branch: BRANCH, baseAncestor: true, github: { enabled: false },
    status: local ? [' M api/example.mjs'] : [], staged: [], tracked: Object.keys(files), untracked: [],
    baseEntries: Object.fromEntries(Object.entries(before).map(([p, f]) => [p, { mode: f.mode, oid: oid(f.bytes) }])),
    read: p => { assert.ok(files[p], `missing ${p}`); return files[p]; } };
  return { snapshot, anchor, files, manifest };
}
const verify = f => verifySnapshot(f.snapshot, f.anchor);
test('clean committed descendant qualifies against external receipt', () => assert.equal(verify(fixture()).mode, 'committed'));
test('explicit local base qualifies and remains labeled uncommitted', () => {
  const f = fixture({ local: true }); assert.equal(verifySnapshot(f.snapshot, f.anchor, { local: true }).mode, 'local-uncommitted');
});
for (const [name, edit] of [
  ['base checkout in committed mode', s => { s.head = BASE; }],
  ['wrong local branch', s => { s.branch = 'main'; }],
  ['unrelated ancestry', s => { s.baseAncestor = false; }],
  ['dirty committed checkout', s => { s.status = [' M anything']; }],
  ['staged change', s => { s.staged = ['anything']; }],
  ['extra untracked path', s => { s.untracked = ['extra.js']; }],
  ['missing base file', s => { s.tracked = s.tracked.filter(p => p !== 'api/example.mjs'); }],
  ['duplicate tracked path', s => { s.tracked.push(s.tracked[0]); }],
]) test(`refuses ${name}`, () => { const f = fixture(); edit(f.snapshot); assert.throws(() => verify(f)); });
for (const path of ['api/example.mjs', 'scripts/security-ci/example.test.mjs', 'src/LeadPerformanceCalculator.jsx', 'scripts/search-runtime.sha256', '.github/workflows/manager-spacing.yml']) {
  test(`refuses changed bytes despite clean status: ${path}`, () => { const f = fixture(); f.files[path] = file('unreviewed'); assert.throws(() => verify(f)); });
}
test('refuses mode drift even if Git status hides it', () => { const f = fixture(); f.files['api/example.mjs'].mode = '100755'; assert.throws(() => verify(f)); });
test('refuses receipt drift or absent external anchor', () => {
  const f = fixture(); assert.throws(() => verifySnapshot(f.snapshot)); assert.throws(() => verifySnapshot(f.snapshot, '0'.repeat(64)));
  f.files[RECEIPT] = file('different'); assert.throws(() => verify(f));
});
test('refuses nonregular paths reported by collector', () => {
  const f = fixture(); f.snapshot.read = () => { throw new Error('symlink refused'); }; assert.throws(() => verify(f), /symlink/);
});
for (const [name, edit] of [
  ['wrong identity', m => { m.branch = 'main'; }],
  ['missing receipt path', m => { m.expectedChanges.pop(); }],
  ['extra path without hash', m => { m.expectedChanges.push('extra.js'); }],
  ['duplicate changed path', m => { m.expectedChanges.push(m.expectedChanges[0]); }],
  ['unsafe test path', m => { m.tests = ['test/../evil.test.mjs']; }],
  ['missing selected test', m => { m.tests = ['test/missing.test.mjs']; }],
  ['duplicate tests', m => { m.tests.push(m.tests[0]); }],
  ['empty tests', m => { m.tests = []; }],
  ['unsupported normalization', m => { m.files['api/example.mjs'].normalize = 'anything'; }],
  ['protected base file declaration', m => { m.expectedChanges.push('src/LeadPerformanceCalculator.jsx'); m.files['src/LeadPerformanceCalculator.jsx'] = { sha256: sha256(Buffer.from('core')), mode: '100644' }; }],
]) test(`refuses independently anchored invalid receipt: ${name}`, () => assert.throws(() => verify(fixture({ editManifest: edit }))));
for (const [name, transform] of [
  ['other workflow content', text => text.replace('reviewed', 'unreviewed')],
  ['different workflow anchor', text => text.replace(/[a-f0-9]{64}/, 'f'.repeat(64))],
  ['duplicate workflow anchor', text => text + text],
  ['alternate declaration syntax', text => text.replace('SHA256: "', 'SHA256:  "')],
]) test(`refuses ${name}`, () => { const f = fixture(); f.files[WORKFLOW] = file(transform(f.files[WORKFLOW].bytes.toString())); assert.throws(() => verify(f)); });
test('normalization changes only the dedicated literal hash', () => {
  const anchor = 'e'.repeat(64); const text = `env:\n  SECURITY_RECEIPT_SHA256: "${anchor}"\nother: ${anchor}\n`;
  assert.equal(normalizedWorkflow(Buffer.from(text), anchor).toString(), text.replace(`"${anchor}"`, `"${'0'.repeat(64)}"`));
});
function githubFixture(kind = 'pull_request') {
  const f = fixture(); f.snapshot.branch = '';
  f.snapshot.github = { enabled: true, repository: REPOSITORY, eventName: kind, headRef: BRANCH,
    ref: kind === 'push' ? `refs/heads/${BRANCH}` : 'refs/pull/7/merge', sha: f.snapshot.head,
    event: { number: 7, pull_request: { head: { ref: BRANCH, sha: f.snapshot.head, repo: { full_name: REPOSITORY } }, base: { repo: { full_name: REPOSITORY } } } } };
  return f;
}
test('detached same-repository PR head and push SHA qualify', () => { assert.equal(verify(githubFixture()).verified, true); assert.equal(verify(githubFixture('push')).verified, true); });
for (const [name, edit] of [
  ['foreign event repository', g => { g.repository = 'foreign/repo'; }],
  ['fork PR', g => { g.event.pull_request.head.repo.full_name = 'foreign/repo'; }],
  ['foreign PR base', g => { g.event.pull_request.base.repo.full_name = 'foreign/repo'; }],
  ['PR merge SHA rather than head', g => { g.event.pull_request.head.sha = 'b'.repeat(40); }],
  ['wrong PR branch', g => { g.headRef = 'main'; }],
  ['wrong PR event branch', g => { g.event.pull_request.head.ref = 'main'; }],
  ['wrong PR number', g => { g.event.number = 9; }],
  ['unsupported event', g => { g.eventName = 'pull_request_target'; }],
]) test(`refuses ${name}`, () => { const f = githubFixture(); edit(f.snapshot.github); assert.throws(() => verify(f)); });
test('refuses wrong push SHA', () => { const f = githubFixture('push'); f.snapshot.github.sha = 'b'.repeat(40); assert.throws(() => verify(f)); });
test('local mode is forbidden in CI or on a committed descendant', () => {
  const f = githubFixture(); assert.throws(() => verifySnapshot(f.snapshot, f.anchor, { local: true }));
  const local = fixture(); assert.throws(() => verifySnapshot(local.snapshot, local.anchor, { local: true }));
});

for (const path of ['/absolute.js', 'api/../escape.js', 'api/./relative.js', 'api//empty.js', 'api/evil\\name.js', 'api/control\nname.js', 'C:/absolute.js']) {
  test(`refuses unsafe checkout path ${JSON.stringify(path)}`, () => {
    const f = fixture(); f.snapshot.tracked.push(path); assert.throws(() => verify(f), /checkout paths/);
  });
}

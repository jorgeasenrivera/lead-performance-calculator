/** Exact reviewed tree verification. Trust the independently reviewed checker and receipt anchor. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
export const BASE = '25d821a6d0a8e3c9b4a700cc5845c574e1c9b837';
export const BRANCH = 'codex/security-authorization-ci';
export const REPOSITORY = 'jorgeasenrivera/lead-performance-calculator';
export const RECEIPT = 'scripts/security-ci/receipt.json';
export const WORKFLOW = '.github/workflows/security-authorization.yml';
const fail = (ok, message) => { if (!ok) throw new Error(message); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const safePath = p => typeof p === 'string' && p.length > 0 && !/[\x00-\x1f\x7f\\]/.test(p) && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some(v => !v || v === '.' || v === '..');
const equalPaths = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function normalizedWorkflow(bytes, anchor) {
  const text = bytes.toString('utf8');
  const declaration = /^([ \t]*SECURITY_RECEIPT_SHA256: ")([a-f0-9]{64})("[ \t]*)$/gm;
  const matches = [...text.matchAll(declaration)];
  fail(matches.length === 1 && matches[0][2] === anchor, 'workflow receipt anchor missing, duplicated or different');
  return Buffer.from(text.replace(declaration, (_, before, _hash, after) => before + '0'.repeat(64) + after));
}

function verifyIdentity(s, local) {
  fail(s.baseAncestor, 'reviewed base is not an ancestor');
  if (local) fail(s.head === BASE && !s.github?.enabled, 'local mode requires the uncommitted base outside GitHub Actions');
  const g = s.github;
  if (g?.enabled) {
    fail(!local && g.repository === REPOSITORY, 'wrong GitHub repository or local mode');
    fail(!s.branch || s.branch === BRANCH, 'wrong checked-out branch');
    if (g.eventName === 'push') {
      fail(g.ref === `refs/heads/${BRANCH}` && g.sha === s.head, 'push branch/SHA mismatch');
    } else if (g.eventName === 'pull_request') {
      const p = g.event?.pull_request;
      fail(g.headRef === BRANCH && p?.head?.ref === BRANCH && p.head.sha === s.head,
        'pull-request head branch/SHA mismatch');
      fail(p.head.repo?.full_name === REPOSITORY && p.base?.repo?.full_name === REPOSITORY,
        'fork or foreign pull-request repository');
      fail(Number.isInteger(g.event.number) && [`refs/pull/${g.event.number}/merge`, `refs/pull/${g.event.number}/head`].includes(g.ref), 'pull-request ref mismatch');
    } else fail(false, 'unsupported GitHub event');
  } else fail(s.branch === BRANCH, 'wrong local branch');
  if (!local) fail(s.head !== BASE && s.status.length === 0 && s.untracked.length === 0, 'committed mode requires a clean descendant checkout');
  fail(s.staged.length === 0, 'staged changes require separate review');
}

export function verifySnapshot(s, anchor, { local = false } = {}) {
  fail(/^[a-f0-9]{64}$/.test(anchor || ''), 'external receipt SHA256 required');
  const receiptFile = s.read(RECEIPT);
  fail(receiptFile.mode === '100644' && sha256(receiptFile.bytes) === anchor, 'receipt bytes or mode differ from review anchor');
  const m = JSON.parse(receiptFile.bytes);
  fail(m.version === 1 && m.base === BASE && m.branch === BRANCH, 'wrong receipt identity');
  verifyIdentity(s, local);
  fail(Array.isArray(m.expectedChanges) && m.expectedChanges.every(safePath)
    && new Set(m.expectedChanges).size === m.expectedChanges.length && m.expectedChanges.includes(RECEIPT), 'invalid expected changed paths');
  fail(m.files && typeof m.files === 'object' && !Array.isArray(m.files)
    && equalPaths(Object.keys(m.files), m.expectedChanges.filter(p => p !== RECEIPT)), 'receipt file inventory differs from expected changes');
  fail(!m.expectedChanges.some(p => /^\.env(?:\.|$)/.test(basename(p))), 'environment file not allowed');
  for (const p of ['src/LeadPerformanceCalculator.jsx', 'scripts/search-runtime.sha256', '.github/workflows/manager-spacing.yml']) fail(!m.expectedChanges.includes(p), `protected base file: ${p}`);
  fail(Array.isArray(m.tests) && m.tests.length > 0 && new Set(m.tests).size === m.tests.length
    && m.tests.every(p => safePath(p) && /^(test|scripts)\/.+\.test\.mjs$/.test(p)), 'invalid selected tests');
  const paths = [...s.tracked, ...s.untracked];
  fail(new Set(paths).size === paths.length && paths.every(safePath), 'invalid or duplicate checkout paths');
  const actual = [];
  // Hash all tracked base files, including paths Git might hide using index flags.
  for (const [path, base] of Object.entries(s.baseEntries)) {
    fail(paths.includes(path), `base path removed: ${path}`);
    const current = s.read(path);
    if (current.mode !== base.mode || blobHash(current.bytes) !== base.oid) actual.push(path);
  }
  for (const path of paths) if (!Object.hasOwn(s.baseEntries, path)) actual.push(path);
  fail(equalPaths(actual, m.expectedChanges), 'unrelated, missing or deleted tree change');
  for (const [path, entry] of Object.entries(m.files)) {
    fail(safePath(path) && ['100644', '100755'].includes(entry.mode) && /^[a-f0-9]{64}$/.test(entry.sha256 || ''), `invalid receipt entry: ${path}`);
    const file = s.read(path);
    fail(file.mode === entry.mode, `file mode mismatch: ${path}`);
    let bytes = file.bytes;
    if (entry.normalize !== undefined) {
      fail(path === WORKFLOW && entry.normalize === 'workflow-receipt-anchor', 'unsupported normalization');
      bytes = normalizedWorkflow(bytes, anchor);
    }
    fail(sha256(bytes) === entry.sha256, `file hash mismatch: ${path}`);
  }
  fail(m.files[WORKFLOW]?.normalize === 'workflow-receipt-anchor', 'dedicated workflow normalization required');
  for (const path of m.tests) { fail(paths.includes(path), `selected test missing: ${path}`); s.read(path); }
  return { verified: true, mode: local ? 'local-uncommitted' : 'committed', base: BASE, head: s.head,
    receiptSha256: anchor, changedPaths: actual.length, tests: m.tests,
    scope: 'Reviewed repository tree only. Ignored dependencies/build outputs and runtime authorization are not certified.' };
}

export function collectSnapshot(root, env = process.env) {
  const git = args => execFileSync('git', ['-C', root, '--no-replace-objects', ...args], { maxBuffer: 32 * 1024 * 1024 });
  fail(git(['rev-parse', '--show-object-format']).toString().trim() === 'sha1', 'unsupported Git object format');
  const list = args => git(args).toString().split('\0').filter(Boolean);
  const read = path => {
    fail(safePath(path), 'unsafe path');
    const parts = path.split('/'); let stat;
    for (let i = 1; i <= parts.length; i++) {
      stat = lstatSync(resolve(root, ...parts.slice(0, i)));
      fail(!stat.isSymbolicLink(), `symlink refused: ${path}`);
      fail(i === parts.length ? stat.isFile() : stat.isDirectory(), `not a regular path: ${path}`);
    }
    return { bytes: readFileSync(resolve(root, path)), mode: (stat.mode & 0o111) ? '100755' : '100644' };
  };
  fail(!readdirSync(root).some(n => /^\.env(?:\.|$)/.test(n)), 'root environment file present');
  const tracked = list(['ls-files', '-z']);
  // Do not let global excludes or .git/info/exclude hide new source files.
  // Dependency trees and the repository's build/screenshot outputs are outside this receipt.
  const untracked = list(['ls-files', '--others', '-z']).filter(p =>
    !p.split('/').includes('node_modules') && !/^(dist|dist-harness|shots)(\/|$)/.test(p));
  fail(![...tracked, ...untracked].some(p => /^\.env(?:\.|$)/.test(basename(p))), 'environment file present');
  const baseEntries = Object.fromEntries(list(['ls-tree', '-r', '-z', BASE]).map(line => {
    const tab = line.indexOf('\t'); const [mode, type, oid] = line.slice(0, tab).split(' ');
    fail(type === 'blob' && ['100644', '100755'].includes(mode), 'unsupported base entry');
    return [line.slice(tab + 1), { mode, oid }];
  }));
  let baseAncestor = true;
  try { git(['merge-base', '--is-ancestor', BASE, 'HEAD']); } catch { baseAncestor = false; }
  const enabled = env.GITHUB_ACTIONS === 'true';
  const github = { enabled, repository: env.GITHUB_REPOSITORY, eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF, headRef: env.GITHUB_HEAD_REF, sha: env.GITHUB_SHA };
  if (enabled && github.eventName === 'pull_request') {
    fail(typeof env.GITHUB_EVENT_PATH === 'string' && env.GITHUB_EVENT_PATH.length > 0, 'missing GitHub event evidence');
    github.event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH));
  }
  return { head: git(['rev-parse', 'HEAD']).toString().trim(), branch: git(['branch', '--show-current']).toString().trim(),
    baseAncestor, github, tracked, untracked, baseEntries, read,
    status: list(['status', '--porcelain=v1', '-z', '--untracked-files=all']), staged: list(['diff', '--cached', '--name-only', '-z']) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); const local = args.includes('--local');
    fail(args.length === (local ? 2 : 1) && args.filter(a => a === '--local').length === (local ? 1 : 0), 'usage: verify.mjs [--local] --receipt-sha256=HASH');
    const arg = args.find(a => /^--receipt-sha256=[a-f0-9]{64}$/.test(a));
    fail(Boolean(arg), 'external --receipt-sha256 required');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    console.log(JSON.stringify(verifySnapshot(collectSnapshot(root), arg.slice('--receipt-sha256='.length), { local }), null, 2));
  } catch (error) { console.error(`Security qualification refused: ${error.message}`); process.exitCode = 1; }
}

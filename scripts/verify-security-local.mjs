/** Local snapshot qualification only. This does not replace any historical CI guard. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = '25d821a6d0a8e3c9b4a700cc5845c574e1c9b837';
export const MANIFEST = 'scripts/security-runtime.local-v1.json';
export const TOOLS = [MANIFEST, 'scripts/verify-security-local.mjs', 'scripts/verify-security-local.test.mjs'];
const MANIFEST_HASH = '36281662c5b1190cb22ca73c39c69b2aa9a7753faf97aac9eadfc65d9bc0cd53';
const HISTORICAL = 'scripts/search-runtime.sha256';
const WORKFLOW = '.github/workflows/manager-spacing.yml';
const CORE = 'src/LeadPerformanceCalculator.jsx';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, why) => { if (!condition) throw new Error(why); };

/** Inputs allow negative controls without touching the worktree or invoking an app. */
export const toolingDigest = read => hash(JSON.stringify(TOOLS.map(path => [path, hash(read(path))])));

export function verifySnapshot(snapshot, trustedToolingSha256) {
  const { head, manifest, original, changed, untracked, staged, read, historicalCoreBefore, historicalCoreAfter, baseCore, historicalManifest, workflowAtBase } = snapshot;
  check(/^[a-f0-9]{64}$/.test(trustedToolingSha256 || ''), 'external reviewed tooling hash required');
  check(toolingDigest(read) === trustedToolingSha256, 'tooling differs from external review anchor');
  check(head === BASE, 'checkout is not the reviewed base');
  check(hash(manifest) === MANIFEST_HASH, 'candidate manifest is not the reviewed manifest');
  const m = JSON.parse(manifest);
  check(m.base === BASE && m.version === 1, 'wrong candidate identity');
  check(hash(original) === m.historicalManifestSha256 && original.equals(historicalManifest), 'historical manifest changed');
  const lines = original.toString().trimEnd().split('\n');
  const originalPaths = lines.map(line => {
    check(/^[a-f0-9]{64}  [\w./-]+$/.test(line), 'invalid historical entry');
    return line.slice(66);
  });
  check(lines.length === 106 && new Set(originalPaths).size === 106, 'historical path inventory changed');
  check(JSON.stringify(Object.keys(m.runtime).sort()) === JSON.stringify([...originalPaths].sort()), 'candidate path inventory changed');
  check(hash(historicalCoreBefore) === m.coreProvenance.before, 'core parent provenance mismatch');
  check(hash(historicalCoreAfter) === m.coreProvenance.after && baseCore.equals(historicalCoreAfter), 'core commit provenance mismatch');
  check(read(CORE).equals(baseCore), 'unreviewed core change');
  check(read(WORKFLOW).equals(workflowAtBase), 'historical workflow changed');
  check(staged.length === 0, 'staged changes require separate review');
  const expected = [...Object.keys(m.reviewedFiles), ...TOOLS].sort();
  const actual = [...changed, ...untracked].sort();
  check(new Set(actual).size === actual.length && JSON.stringify(actual) === JSON.stringify(expected), 'unexpected, missing or duplicate changed path');
  for (const [path, expectedHash] of Object.entries(m.runtime)) check(hash(read(path)) === expectedHash, `runtime mismatch: ${path}`);
  for (const [path, expectedHash] of Object.entries(m.reviewedFiles)) check(hash(read(path)) === expectedHash, `reviewed patch mismatch: ${path}`);

  return { qualified: true, base: BASE, runtimePaths: 106, behaviorFiles: 8, toolingSha256: trustedToolingSha256,
    behaviorPatchSha256: m.behaviorPatchSha256, historicalGuardStillFails: [CORE, ...Object.keys(m.reviewedFiles).filter(p => p.startsWith('api/'))],
    scope: 'Exact local snapshot only; no release, Auth, RLS, timing or Node22 certification.' };
}

export function collectSnapshot(root) {
  const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });
  const modes = new Map(git(['ls-tree', '-r', '-z', BASE]).toString().split('\0').filter(Boolean).map(line => {
    const [entry, path] = line.split('\t'); return [path, entry.split(' ')[0]];
  }));
  const read = path => {
    check(!path.split('/').includes('..') && !path.startsWith('/'), 'unsafe path');
    // Refuse symlinked parents as well as symlinked files.
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const s = lstatSync(resolve(root, ...parts.slice(0, i)));
      check(!s.isSymbolicLink(), `symlink refused: ${path}`);
      if (i === parts.length) check(s.isFile() && Boolean(s.mode & 0o111) === (modes.get(path) === '100755'), `unexpected file mode: ${path}`);
    }
    return readFileSync(resolve(root, path));
  };
  check(!readdirSync(root).some(name => name === '.env' || name.startsWith('.env.')), 'environment file present; do not load it');
  const list = args => git(args).toString().split('\0').filter(Boolean);
  const manifest = read(MANIFEST);
  // Do not trust mutable manifest fields to select arbitrary Git objects.
  check(hash(manifest) === MANIFEST_HASH, 'candidate manifest is not the reviewed manifest');
  return {
    head: git(['rev-parse', 'HEAD']).toString().trim(), manifest, original: read(HISTORICAL), read,
    changed: list(['diff', BASE, '--name-only', '-z']), untracked: list(['ls-files', '--others', '--exclude-standard', '-z']),
    staged: list(['diff', '--cached', '--name-only', '-z']),
    historicalManifest: git(['show', `d9320e253b603260f6a7355d4bc1c77a59fefa5b:${HISTORICAL}`]),
    historicalCoreBefore: git(['show', `56b97277b299f780f4b2f9c83496ba5ecff6ad1d^:${CORE}`]),
    historicalCoreAfter: git(['show', `56b97277b299f780f4b2f9c83496ba5ecff6ad1d:${CORE}`]),
    baseCore: git(['show', `${BASE}:${CORE}`]), workflowAtBase: git(['show', `${BASE}:${WORKFLOW}`]),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 1 && /^--tooling-sha256=[a-f0-9]{64}$/.test(args[0]), 'supply the independent review receipt hash as --tooling-sha256=HASH');
    console.log(JSON.stringify(verifySnapshot(collectSnapshot(resolve(dirname(fileURLToPath(import.meta.url)), '..')), args[0].slice('--tooling-sha256='.length)), null, 2));
  }
  catch (error) { console.error(`Local qualification refused: ${error.message}`); process.exitCode = 1; }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = '95ad3f93a906714242fdfd02b9c25f3256558b68';
export const SOURCE_TREE = '3773a6745a798ce5b20375fa1236f94c0b9625b7';
export const BASE = '84930e834c4340c9afcc4fb75e526b871e028c77';
export const BASE_TREE = '798105af258674f9daa8ec7a516ea0f2533e652d';
export const REPOSITORY = 'jorgeasenrivera/lead-performance-calculator';
export const BRANCH = 'codex/scheduler-candidate-current-main';
export const QUALIFICATION = Object.freeze([
  '.github/workflows/manager-spacing.yml',
  'scripts/scheduler-current-runtime/manifest.json',
  'scripts/scheduler-current-runtime/verify.mjs',
  'test/scheduler-current-runtime.test.mjs',
]);
export const HARNESS_CORRECTION = Object.freeze({
  path:'scripts/hero-bars.mjs',
  original:Object.freeze({mode:'100644', blob:'5efcd1b1e4bef3f833dc38ce465cde16bf3a9e68', bytes:6911,
    sha256:'1d6a3dfae95dd348eb98dc09b2e7fe2371f2297b9bf40c92e739f49a7ddb0972'}),
  corrected:Object.freeze({mode:'100644', blob:'100cb0c24865d9c668cea68960d9c4eb506609fc', bytes:10586,
    sha256:'2000a45c32cc7aaac7da0c6617f840ba5086db580bd048455f7d8c3c5dd47041'}),
});
const roots = new Set(['.claude', 'api', 'download', 'fixtures', 'infra', 'native',
  'public', 'scripts', 'src', 'supabase', 'test', 'workers']);
export const BASELINES = Object.freeze({
  '.spacing-baseline': '5bf65105003b3e01227c774ea82e08d5d595bb68',
  '.header-baseline': '2024e009ad40408926907beb8bf0d820bc235031',
  '.dock-baseline': '4d050292aea1904d1b6dc35a07116dc9137e9f4f',
  '.rail-baseline': 'c4d5c032158e573314ca9a12a23a211ec24c7a4c',
  '.composition-baseline': '99644a52fce58ce91ace9b9a5299661ba116a775',
  '.color-baseline': '3573082e31d716c866021eec0f6e87f1f7367ce4',
  '.hero-baseline': '57c381c4e07c8d815819bb5e2feed00d104ba4f8',
  '.freshness-baseline': 'e6d087c203bb88685159efbc272e04ce868e4c89',
});
const flags = ['VITE_SCHEDULER_CALENDAR', 'VITE_SCHEDULER_DRAFT_LOCAL',
  'VITE_SCHEDULER_DRAFT_PILOT', 'SCHEDULER_DRAFT_PILOT_ENABLED'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });
}
const revision = (root, name) => git(root, 'rev-parse', name).toString().trim();
function relevant(path) {
  return !QUALIFICATION.includes(path) && (roots.has(path.split('/')[0]) ||
    (!path.includes('/') && !path.toLowerCase().endsWith('.md')));
}
const recordCache = new Map();
export function sourceRecords(root, commit) {
  if (recordCache.has(commit)) return recordCache.get(commit);
  const entries = git(root, 'ls-tree', '-rz', commit).toString().split('\0').filter(Boolean)
    .map(row => { const [meta, path] = row.split('\t'); const [mode, type, blob] = meta.split(' '); return {path, mode, type, blob}; })
    .filter(row => relevant(row.path));
  const records = [];
  // Batch a few blobs at a time so pinned screenshots do not make verification
  // allocate the entire repository as one synchronous subprocess result.
  for (let start = 0; start < entries.length; start += 16) {
    const batch = entries.slice(start, start + 16);
    const packed = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: batch.map(row => row.blob).join('\n') + '\n', maxBuffer: 32 * 1024 * 1024,
    });
    let offset = 0;
    for (const {path, mode, type, blob} of batch) {
      assert.equal(type, 'blob', 'regular source blob: ' + path);
      assert.ok(['100644', '100755'].includes(mode), 'regular source mode: ' + path);
      const end = packed.indexOf(10, offset), header = packed.subarray(offset, end).toString().split(' ');
      assert.equal(header[0], blob); assert.equal(header[1], 'blob');
      const length = Number(header[2]), bytes = packed.subarray(end + 1, end + 1 + length);
      offset = end + 2 + length;
      records.push(Object.freeze({path, mode, blob, bytes: length, sha256: digest(bytes)}));
    }
  }
  recordCache.set(commit, Object.freeze(records));
  return recordCache.get(commit);
}
function regular(root, path) {
  const file = resolve(root, path), stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'regular runtime file: ' + path);
  return readFileSync(file);
}
function actualPaths(root) {
  const paths = [];
  function walk(path) {
    const stat = lstatSync(resolve(root, path));
    assert.ok(!stat.isSymbolicLink(), 'no runtime symlinks: ' + path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(resolve(root, path)).sort()) walk(path + '/' + entry);
    } else if (relevant(path)) paths.push(path);
  }
  for (const entry of readdirSync(root).sort()) {
    if (roots.has(entry)) walk(entry);
    else if (entry !== '.git' && lstatSync(resolve(root, entry)).isFile() && relevant(entry)) paths.push(entry);
    else if (entry.startsWith('.env') || entry === '.npmrc') throw new Error('unexpected build configuration: ' + entry);
  }
  return paths.sort();
}
function verifyFiles(root, records) {
  assert.deepEqual(actualPaths(root), records.map(row => row.path).sort(), 'exact consumed runtime inventory');
  for (const row of records) {
    const bytes = regular(root, row.path);
    assert.equal(bytes.length, row.bytes, 'runtime size: ' + row.path);
    assert.equal(digest(bytes), row.sha256, 'runtime hash: ' + row.path);
  }
}
function reviewedHarness(root, source, head, records, correction) {
  if (!correction) return {records, evidence:[]};
  assert.equal(correction.path, 'scripts/hero-bars.mjs', 'only the reviewed hero harness correction');
  const original = records.find(row => row.path === correction.path);
  assert.ok(original, 'harness remains in the complete immutable inventory');
  const identity = ({mode, blob, bytes, sha256}) => ({mode, blob, bytes, sha256});
  assert.deepEqual(identity(original), correction.original, 'independent immutable original harness identity');
  const entry = git(root, 'ls-tree', head, '--', correction.path).toString().trim().split('\t');
  assert.equal(entry[1], correction.path, 'exact head harness path');
  const [mode, type, blob] = entry[0].split(' ');
  assert.equal(type, 'blob', 'head harness is a regular blob');
  assert.equal(mode, original.mode, 'head harness mode unchanged');
  const bytes = git(root, 'show', head + ':' + correction.path);
  const corrected = {mode, blob, bytes:bytes.length, sha256:digest(bytes)};
  assert.deepEqual(corrected, correction.corrected, 'independent reviewed corrected harness identity');
  assert.ok(regular(root, correction.path).equals(bytes), 'checkout harness matches exact PR head');
  return {records:records.map(row => row.path === correction.path ? {...row,...corrected} : row),
    evidence:[{path:correction.path, sourceCommit:source, original:identity(original), corrected}]};
}
// Unit fixtures supply their own immutable Git history. The executable below
// always uses verifySource, whose policy is fixed here and has no CLI override.
export function verifyCandidate({root, event, env}, policy) {
  const {sourceCommit: source, sourceTree, baseCommit: base, baseTree, harnessCorrection} = policy;
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request', 'pull-request event only');
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY, 'repository identity');
  assert.equal(event.repository?.full_name, REPOSITORY, 'event repository identity');
  assert.equal(event.number, 512, 'qualified PR identity');
  const pr = event.pull_request;
  assert.equal(pr?.head?.repo?.full_name, REPOSITORY, 'same-repository head');
  assert.equal(pr?.base?.repo?.full_name, REPOSITORY, 'same-repository base');
  assert.equal(pr?.head?.ref, BRANCH, 'guarded head branch');
  assert.equal(pr?.base?.ref, 'main', 'main target only');
  assert.equal(pr?.base?.sha, base, 'nominated immutable base');
  assert.match(pr?.head?.sha || '', /^[a-f0-9]{40}$/, 'full head identity');
  assert.equal(revision(root, source + '^{tree}'), sourceTree, 'immutable source tree');
  assert.equal(revision(root, base + '^{tree}'), baseTree, 'immutable base tree');
  git(root, 'merge-base', '--is-ancestor', source, pr.head.sha);
  const delta = git(root, 'diff', '--name-only', source, pr.head.sha).toString().trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(delta, [...QUALIFICATION, ...(harnessCorrection ? [harnessCorrection.path] : [])].sort(), 'qualification-only head delta');
  const checkout = revision(root, 'HEAD');
  assert.equal(env.GITHUB_SHA, checkout, 'actual checkout matches Actions SHA');
  const parents = git(root, 'show', '-s', '--format=%P', checkout).toString().trim().split(' ');
  if (checkout === pr.head.sha) {
    assert.ok([ 'refs/pull/512/head', 'refs/pull/512/merge', 'refs/heads/' + BRANCH ].includes(env.GITHUB_REF), 'head checkout ref');
  } else {
    assert.equal(env.GITHUB_REF, 'refs/pull/512/merge', 'synthetic merge ref');
    assert.deepEqual(parents, [base, pr.head.sha], 'synthetic merge has exact base and head parents');
  }
  for (const name of flags) assert.ok(env[name] === undefined || env[name] === '' || env[name] === '0', 'scheduler remains OFF: ' + name);
  assert.equal(JSON.parse(regular(root, 'vercel.json')).git?.deploymentEnabled?.[BRANCH], false, 'guarded branch deployment disabled');
  for (const path of QUALIFICATION) assert.ok(regular(root, path).equals(git(root, 'show', pr.head.sha + ':' + path)), 'checkout qualification matches PR head: ' + path);
  const manifest = JSON.parse(regular(root, QUALIFICATION[1]));
  assert.deepEqual({version: manifest.version, sourceCommit: manifest.sourceCommit, sourceTree: manifest.sourceTree, baseCommit: manifest.baseCommit, baseTree: manifest.baseTree},
    {version: 'scheduler-current-runtime/1', sourceCommit: source, sourceTree: sourceTree, baseCommit: base, baseTree: baseTree}, 'fixed qualification identities');
  const records = sourceRecords(root, source);
  assert.deepEqual(manifest.files, records, 'manifest derives from immutable source, never current bytes');
  const harness = reviewedHarness(root, source, pr.head.sha, records, harnessCorrection);
  verifyFiles(root, harness.records);
  return {version: 'scheduler-current-runtime-evidence/1', repository: REPOSITORY, pullRequest: 512,
    sourceCommit: source, sourceTree: sourceTree, baseCommit: base, baseTree: baseTree,
    headCommit: pr.head.sha, headTree: revision(root, pr.head.sha + '^{tree}'),
    checkoutCommit: checkout, checkoutTree: revision(root, 'HEAD^{tree}'), checkoutParents: parents,
    githubRef: env.GITHUB_REF, consumedFiles: records.length, harnessCorrections:harness.evidence, flags: Object.fromEntries(flags.map(name => [name, '0'])),
    historicalManifestSha256: digest(regular(root, 'scripts/search-runtime.sha256'))};
}
export function verifySource(input) {
  return verifyCandidate(input, {sourceCommit: SOURCE, sourceTree: SOURCE_TREE, baseCommit: BASE, baseTree: BASE_TREE,
    harnessCorrection:HARNESS_CORRECTION});
}

export function verifyBaselines(root) {
  return Object.entries(BASELINES).map(([path, commit]) => {
    const dir = resolve(root, path);
    assert.equal(revision(dir, 'HEAD'), commit, 'immutable baseline head: ' + path);
    // Check ignored source additions too, before dependencies or generated builds exist.
    verifyFiles(dir, sourceRecords(dir, commit));
    return {path, commit, tree: revision(dir, 'HEAD^{tree}')};
  });
}
function installedDependencies(root) {
  const lock = JSON.parse(regular(root, 'package-lock.json'));
  const pkg = JSON.parse(regular(root, 'package.json'));
  const versions = {};
  for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
    const actual = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'))).version;
    assert.equal(actual, lock.packages['node_modules/' + name].version, 'locked installed dependency: ' + name);
    versions[name] = actual;
  }
  assert.equal(JSON.parse(readFileSync(resolve(root, 'node_modules/playwright/package.json'))).version, '1.63.0', 'exact browser driver');
  return {...versions, playwright: '1.63.0'};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2];
  assert.ok(['before-install', 'after-install'].includes(stage), 'explicit qualification stage');
  const root = process.cwd();
  const evidence = verifySource({root, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)), env: process.env});
  evidence.baselines = verifyBaselines(root);
  evidence.node = process.version;
  evidence.stage = stage;
  if (stage === 'after-install') evidence.dependencies = installedDependencies(root);
  mkdirSync('manager-runtime-qualification', {recursive: true});
  writeFileSync('manager-runtime-qualification/' + stage + '.json', JSON.stringify(evidence, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'runtime_sha=' + evidence.checkoutCommit + '\ncase_name=current-95ad3f93\n');
  console.log(JSON.stringify(evidence));
}

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2];
if (!['tests', 'build'].includes(mode) || process.argv.length !== 3) throw new Error('Expected tests or build');
if (process.versions.node.split('.')[0] !== '22') throw new Error('Node 22 required');
const receipt = JSON.parse(readFileSync(resolve(root, 'scripts/security-ci/receipt.json')));
const excluded = ['test/schedule-daterows.test.mjs', 'test/ingest-routing.test.mjs', 'test/repair-sticks.test.mjs', 'scripts/verify-security-local.test.mjs'];
if (!Array.isArray(receipt.tests) || !receipt.tests.length || new Set(receipt.tests).size !== receipt.tests.length || receipt.tests.some(p => !/^(test|scripts)\/[\w./-]+\.test\.mjs$/.test(p) || p.split('/').includes('..') || excluded.includes(p))) throw new Error('Invalid test inventory');
const temporary = mkdtempSync(join(tmpdir(), 'sage-security-ci-'));
// No inherited provider credentials, environment files, or executable search path.
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: temporary, CI: '1',
  NODE_OPTIONS: `--require=${resolve(root, 'scripts/security-ci/offline-guard.cjs')}`,
  VITE_SUPABASE_URL: 'http://127.0.0.1:5433', VITE_SUPABASE_ANON_KEY: 'synthetic-anon',
};
const args = mode === 'tests' ? ['--test', '--test-reporter=tap', ...receipt.tests] :
  ['--input-type=module', '-e', `import { build } from 'vite'; await build({envFile:false,build:{outDir:${JSON.stringify(join(temporary, 'dist'))},emptyOutDir:true}});`];
const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

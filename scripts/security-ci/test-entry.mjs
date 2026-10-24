import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function testArguments(localBranch, env = {}, event = {}) {
  const branch = localBranch || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '';
  if (!branch) throw new Error('Detached checkout without branch context: choose the reviewed candidate runner explicitly');
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'pull_request') {
    if (!event.pull_request?.head?.repo?.full_name) throw new Error('Missing pull request repository evidence');
    if (event.pull_request.head.repo.full_name !== env.GITHUB_REPOSITORY) return ['--test'];
  }
  return branch === 'codex/security-authorization-ci' ? ['scripts/security-ci/run.mjs', 'tests'] : ['--test'];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (git.error) throw git.error;
  const event = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'pull_request'
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const args = testArguments(git.status === 0 ? git.stdout.trim() : '', process.env, event);
  // Candidate arguments cannot expand the reviewed inventory. Ordinary Node arguments remain supported.
  if (args[0] === '--test') args.push(...process.argv.slice(2));
  else if (process.argv.length !== 2) throw new Error('Candidate npm test does not accept inventory overrides');
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

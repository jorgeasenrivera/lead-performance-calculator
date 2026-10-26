#!/usr/bin/env node
// Explicitly bounded qualification, not a claim that the excluded suites passed.
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const exclusions = new Map([
  ['test/schedule-daterows.test.mjs', 'known real-derived schedule fixture'],
  ['test/ingest-routing.test.mjs', 'fixture provenance unverified'],
  ['test/repair-sticks.test.mjs', 'fixture provenance unverified'],
]);
function collect(directory) {
  return readdirSync(path.join(root, directory), {withFileTypes: true}).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collect(relative);
    return entry.isFile() && entry.name.endsWith('.test.mjs') ? [relative] : [];
  });
}
const all = [...collect('test'), ...collect('scripts')].sort();
const selected = all.filter(file => !exclusions.has(file));
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--list')) {
  console.error('Usage: node scripts/security-integration-selected-tests.mjs [--list]');
  process.exitCode = 2;
} else if (!selected.length || [...exclusions.keys()].some(file => !all.includes(file))) {
  console.error('Selected-test inventory changed: expected nonempty selection and all three disclosed exclusions. Review the inventory.');
  process.exitCode = 2;
} else {
  if (args[0] === '--list') {
    process.stdout.write(`${selected.join('\n')}\n`);
  } else {
    console.log(`# Selected qualification: ${selected.length} files; ${exclusions.size} excluded files.`);
    for (const [file, reason] of exclusions) console.log(`# EXCLUDED ${file}: ${reason}. Not a pass.`);
    console.log('# Node TAP below retains failing tests, TODO, skipped and cancelled counts.');
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...selected], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) console.error(`Selected test runner failed: ${result.error.message}`);
    if (result.signal) console.error(`Selected test runner terminated by signal ${result.signal}`);
    process.exitCode = result.status ?? 1;
  }
}

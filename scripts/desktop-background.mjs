import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backgroundConfig } from './desktop-background-config.mjs';
export { backgroundConfig } from './desktop-background-config.mjs';

export const PROFILER_SHA = 'ec1ca5308bc8db162d090bf65e7f4d7f228d2bf4';
export const DRIVER_SHA = 'abcc33dc7e9ad97f93f0517b6d0d41104b9fe111';
export const DRIVER_HASH = '6de1f4d49a57e555f0ffcde435578bedbe1147856e2d811d1f83855f10c17f20';
export const SIGNAL_SHA = 'd9320e253b603260f6a7355d4bc1c77a59fefa5b';
export const ORIGINAL_SIGNAL_SHA = '7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5';
export const RELEASE_DRIVER_HASH = '4ed3a90bed436fed5f83c7f25badcdcdd1e58e0ffe8b5b0b239e031d39a86ac0';
// The accepted file remains immutable. Only its explicit expected app identity
// changes in this derived source; its environment assertion and output use it.
export function releaseDriverSource(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), DRIVER_HASH, 'immutable accepted driver changed');
  const declaration = `export const SIGNAL_SOURCE = '${ORIGINAL_SIGNAL_SHA}';`;
  assert.equal(original.split(declaration).length, 2, 'source identity declaration changed');
  const derived = original.replace(declaration, `export const SIGNAL_SOURCE = '${SIGNAL_SHA}';`);
  assert.equal(createHash('sha256').update(derived).digest('hex'), RELEASE_DRIVER_HASH, 'release identity-only driver changed');
  return derived;
}
export function narrowExperiment(source, variant, directory = `desktop-background-evidence/${variant}`) {
  assert.ok(['root', 'backdrop'].includes(variant));
  const cohort = "for (const width of [1440, 1920]) for (const fixture of ['demo', '60-sales']) {";
  assert.equal(source.split(cohort).length, 2, 'experiment cohort anchor changed');
  assert.ok(source.includes("await mkdir('desktop-baseline-evidence'"), 'evidence directory anchor changed');
  return source.replace(cohort, "for (const width of [1920]) for (const fixture of ['60-sales']) {")
    .replaceAll('desktop-baseline-evidence', `${directory}/baseline`);
}
export async function runBackgroundExperiment() {
  const { variant, directory } = backgroundConfig();
  const profilerRoot = path.resolve(process.env.DESKTOP_PROFILER_ROOT || '.desktop-profiler');
  const baselineRoot = path.resolve(process.env.DESKTOP_BASELINE_ROOT || '.desktop-baseline');
  const runner = path.join(baselineRoot, 'scripts/desktop-baseline.mjs');
  const original = (await readFile(runner, 'utf8')).replace(/\r\n/g, '\n');
  const releaseSource = releaseDriverSource(original);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'source-identity.json'), JSON.stringify({
    originalDriverCommit: DRIVER_SHA, originalDriverHash: DRIVER_HASH, originalSignal: ORIGINAL_SIGNAL_SHA,
    releaseDriverHash: RELEASE_DRIVER_HASH, releaseSignal: SIGNAL_SHA,
    transformation: 'Replace only the SIGNAL_SOURCE declaration before existing instrumentation',
  }, null, 2));
  await writeFile(path.join(directory, 'release-driver-source.mjs'), releaseSource);
  const { instrumentBaseline } = await import(pathToFileURL(path.join(profilerRoot, 'scripts/desktop-profile.mjs')).href);
  const { verifyMappedBuild } = await import(pathToFileURL(path.join(profilerRoot, 'scripts/desktop-profile-read.mjs')).href);
  await verifyMappedBuild('.desktop-signal/dist', '.desktop-signal/dist-mapped');
  const instrumented = instrumentBaseline(releaseSource, pathToFileURL(runner).href,
    new URL('./desktop-background-session.mjs', import.meta.url).href);
  const driver = narrowExperiment(instrumented, variant, directory);
  const module = await import('data:text/javascript;base64,' + Buffer.from(driver).toString('base64'));
  await module.runDesktopBaseline();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBackgroundExperiment();

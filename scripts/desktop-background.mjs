import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROFILER_SHA = 'ec1ca5308bc8db162d090bf65e7f4d7f228d2bf4';
export const DRIVER_SHA = 'abcc33dc7e9ad97f93f0517b6d0d41104b9fe111';
export const DRIVER_HASH = '6de1f4d49a57e555f0ffcde435578bedbe1147856e2d811d1f83855f10c17f20';
export const SIGNAL_SHA = '7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5';
export function narrowExperiment(source, variant) {
  assert.ok(['root', 'backdrop'].includes(variant));
  const cohort = "for (const width of [1440, 1920]) for (const fixture of ['demo', '60-sales']) {";
  assert.equal(source.split(cohort).length, 2, 'experiment cohort anchor changed');
  assert.ok(source.includes("await mkdir('desktop-baseline-evidence'"), 'evidence directory anchor changed');
  return source.replace(cohort, "for (const width of [1920]) for (const fixture of ['60-sales']) {")
    .replaceAll('desktop-baseline-evidence', `desktop-background-evidence/${variant}/baseline`);
}
export async function runBackgroundExperiment() {
  const variant = process.env.DESKTOP_BACKGROUND_VARIANT;
  assert.ok(['root', 'backdrop'].includes(variant));
  assert.equal(process.env.FEEL_BROWSER || 'chromium', 'chromium', 'CDP experiment is Chromium only');
  const profilerRoot = path.resolve(process.env.DESKTOP_PROFILER_ROOT || '.desktop-profiler');
  const baselineRoot = path.resolve(process.env.DESKTOP_BASELINE_ROOT || '.desktop-baseline');
  const runner = path.join(baselineRoot, 'scripts/desktop-baseline.mjs');
  const original = (await readFile(runner, 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(original).digest('hex'), DRIVER_HASH, 'immutable accepted driver changed');
  const { instrumentBaseline } = await import(pathToFileURL(path.join(profilerRoot, 'scripts/desktop-profile.mjs')).href);
  const { verifyMappedBuild } = await import(pathToFileURL(path.join(profilerRoot, 'scripts/desktop-profile-read.mjs')).href);
  await verifyMappedBuild('.desktop-signal/dist', '.desktop-signal/dist-mapped');
  const instrumented = instrumentBaseline(original, pathToFileURL(runner).href,
    new URL('./desktop-background-session.mjs', import.meta.url).href);
  const driver = narrowExperiment(instrumented, variant);
  const module = await import('data:text/javascript;base64,' + Buffer.from(driver).toString('base64'));
  await module.runDesktopBaseline();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBackgroundExperiment();

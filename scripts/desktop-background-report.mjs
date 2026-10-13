import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBackgroundSample } from './desktop-background-browser.mjs';
import { PROFILER_SHA, DRIVER_SHA, SIGNAL_SHA } from './desktop-background.mjs';

export function validateCohort(variant, baseline, profiles, background) {
  assert.equal(baseline.source, SIGNAL_SHA); assert.equal(baseline.browser, 'chromium');
  assert.ok(!baseline.failure); assert.equal(baseline.runs.length, 1);
  const run = baseline.runs[0];
  assert.ok(run.width === 1920 && run.fixture === '60-sales' && run.complete && run.seedCount === 10 &&
    run.rowCount === 62 && run.splitValueReads === 45 && !run.errors.length, 'complete isolated dense cohort');
  assert.equal(run.results.length, 30); assert.ok(run.results.every(r => r.summary?.usable));
  assert.equal(profiles.length, 9); assert.equal(background.length, 9);
  assert.deepEqual(profiles.map(r => r.ordinal).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(background.map(r => r.ordinal), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const label of ['Performance', 'associate-open', 'list-scroll']) {
    assert.equal(profiles.filter(r => r.label === label).length, 3);
  }
  for (const row of profiles) {
    assert.ok(row.width === 1920 && row.fixture === '60-sales' && row.status === 'complete' &&
      row.sample?.usable && !row.dropped && !row.failure && row.traceDataLoss === false &&
      row.cpu?.samples.length && row.summary?.mainThread && row.summary?.byType, 'valid complete CPU and trace');
    assert.ok(['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'].every(k =>
      Number.isFinite(row.metrics?.[k]) && row.metrics[k] >= 0), 'required counters unavailable');
    const same = background.find(r => r.ordinal === row.ordinal);
    assert.ok(same?.variant === variant && same.label === row.label && same.sample?.usable && !same.failure);
    const writes = validateBackgroundSample(same.before, same.after);
    assert.deepEqual(writes, same.writes);
    if (row.label === 'list-scroll') assert.ok(writes.calls > 0, 'scroll must exercise parallax writes');
  }
  return profiles;
}
export async function reportBackground(directory = 'desktop-background-evidence') {
  const cohorts = {};
  for (const variant of ['root', 'backdrop']) {
    const dir = path.join(directory, variant);
    const json = async file => JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    const baseline = await json('baseline/results.json'), background = await json('background.json');
    const names = (await readdir(path.join(dir, 'profiles'))).filter(n => /^1920-60-sales-\d+-(Performance|associate-open|list-scroll)\.json$/.test(n));
    const profiles = await Promise.all(names.map(n => json('profiles/' + n)));
    validateCohort(variant, baseline, profiles, background);
    cohorts[variant] = { baseline, background, profiles };
  }
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const rows = ['Performance', 'associate-open', 'list-scroll'].map(label => {
    const counters = variant => Object.fromEntries(['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'].map(k =>
      [k + 'Ms', mean(cohorts[variant].profiles.filter(r => r.label === label).map(r => r.metrics[k])) * 1000]));
    return { label, cyclesPerVariant: 3, root: counters('root'), backdrop: counters('backdrop') };
  });
  const result = { source: SIGNAL_SHA, driver: DRIVER_SHA, profiler: PROFILER_SHA, diagnosticOnly: true,
    cohort: '1920x1080, 60 fictional sales, ordered root then backdrop',
    includesAutomationAndProfiling: true, shippedChange: false, rows };
  await writeFile(path.join(directory, 'comparison.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportBackground();

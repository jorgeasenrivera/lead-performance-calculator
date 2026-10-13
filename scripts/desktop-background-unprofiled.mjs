import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBackgroundSample } from './desktop-background-browser.mjs';
import { SIGNAL_SHA, DRIVER_SHA } from './desktop-background.mjs';

export const INTERACTIONS = ['Daily Activity', 'Live Floor', 'Phone Line', 'Performance', 'Summary', 'Dashboard',
  'associate-open', 'associate-close', 'schedule-hover', 'list-scroll'];
export function validateUnprofiled(variant, browser, baseline, background) {
  assert.equal(baseline.source, SIGNAL_SHA); assert.equal(baseline.browser, browser);
  assert.ok(!baseline.failure); assert.equal(baseline.runs.length, 1);
  const run = baseline.runs[0];
  assert.ok(run.width === 1920 && run.fixture === '60-sales' && run.complete && run.seedCount === 10 &&
    run.rowCount === 62 && run.splitValueReads === 45 && !run.errors.length, 'complete isolated dense cohort');
  assert.equal(run.results.length, 30); assert.equal(background.length, 9);
  for (let cycle = 0; cycle < 3; cycle++) for (let i = 0; i < INTERACTIONS.length; i++) {
    const row = run.results[cycle * 10 + i], sample = row.summary;
    assert.equal(row.cycle, cycle); assert.equal(sample.label, INTERACTIONS[i]);
    assert.ok(sample.usable && sample.status === 'complete' && !sample.hidden && sample.droppedEntries === 0);
    assert.deepEqual(sample.viewport, [1920, 1080]);
    assert.ok(['contentMs', 'settledMs', 'durationMs', 'frameMedianMs', 'frameP95Ms', 'frameMaxMs', 'gapsOver34Ms']
      .every(k => Number.isFinite(sample[k]) && sample[k] >= 0) && sample.frameCount >= 2);
  }
  assert.deepEqual(background.map(r => r.ordinal), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < background.length; i++) {
    const row = background[i], label = ['Performance', 'associate-open', 'list-scroll'][i % 3];
    assert.ok(row.variant === variant && row.recording === 'unprofiled' && !row.failure);
    assert.equal(row.label, label);
    assert.deepEqual(row.sample, run.results[Math.floor(i / 3) * 10 + INTERACTIONS.indexOf(label)].summary);
    const delta = validateBackgroundSample(row.before, row.after); assert.deepEqual(row.writes, delta);
    if (label === 'list-scroll') assert.ok(delta.calls > 0, 'scroll must exercise parallax writes');
  }
  return run.results;
}
export function summarizeUnprofiled(samples) {
  const median = values => {
    const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return INTERACTIONS.map(label => {
    const selected = samples.filter(s => s.summary.label === label).map(s => s.summary);
    assert.equal(selected.length, 6, 'three cycles in each of two orders');
    return { label, samples: selected.length,
      ...Object.fromEntries(['contentMs', 'settledMs', 'frameMedianMs', 'frameP95Ms', 'gapsOver34Ms']
        .map(k => [k, { values: selected.map(s => s[k]), median: median(selected.map(s => s[k])) }])) };
  });
}
export async function reportUnprofiled(browser, directory = 'desktop-background-evidence/unprofiled') {
  assert.ok(['chromium', 'webkit'].includes(browser));
  const variants = {};
  for (const variant of ['root', 'backdrop']) {
    const samples = [];
    for (const order of ['root-first', 'backdrop-first']) {
      const dir = path.join(directory, browser, order, variant);
      const json = async file => JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      samples.push(...validateUnprofiled(variant, browser, await json('baseline/results.json'), await json('background.json')));
    }
    variants[variant] = summarizeUnprofiled(samples);
  }
  const result = { source: SIGNAL_SHA, driver: DRIVER_SHA, browser, recording: 'unprofiled', shippedChange: false,
    includesAutomationAndParityHooks: true, orders: ['root-first', 'backdrop-first'],
    interpretation: 'Main-thread scheduling and lifecycle only, not physical GPU presentation or field latency', variants };
  await writeFile(path.join(directory, browser, 'comparison.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportUnprofiled(process.env.FEEL_BROWSER);

import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateProfiles(rows, runs) {
  assert.equal(rows.length, 36, 'four cases, three cycles, three selected interactions');
  assert.equal(runs.length, 4, 'four baseline cases');
  assert.deepEqual(runs.map(r => `${r.width}/${r.fixture}`).sort(),
    ['1440/60-sales', '1440/demo', '1920/60-sales', '1920/demo'], 'unique expected cases');
  for (const run of runs) {
    assert.ok(run.complete && run.results.length === 30 && run.results.every(r => r.summary?.usable) &&
      run.errors.length === 0 && run.splitValueReads === 45 && run.seedCount === 10 &&
      run.rowCount === (run.fixture === 'demo' ? 10 : 62), 'complete isolated baseline case');
    const selected = rows.filter(r => r.width === run.width && r.fixture === run.fixture);
    assert.equal(selected.length, 9, 'nine profiles per case');
    assert.deepEqual(selected.map(r => r.ordinal).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'unique profile ordinals');
    for (const label of ['Performance', 'associate-open', 'list-scroll']) {
      assert.equal(selected.filter(r => r.label === label).length, 3, 'three cycles per action');
    }
    assert.ok(selected.every(r => r.status === 'complete' && r.sample?.usable && !r.dropped && !r.traceDataLoss &&
      !r.failure && r.cpu?.samples.length > 0 && r.summary?.mainThread && r.summary?.byType), 'valid trace and CPU evidence');
  }
  return rows.map(r => ({ width: r.width, fixture: r.fixture, label: r.label, ordinal: r.ordinal,
    diagnosticOnly: true, metrics: r.metrics, byType: r.summary.byType, hot: r.summary.hot,
    mainThread: r.summary.mainThread, sampleCount: r.summary.sampleCount,
    cpuWeighting: r.summary.cpuWeighting, weightedSampleMs: r.summary.weightedSampleMs, unattributedLeadMs: r.summary.unattributedLeadMs,
    reordered: r.summary.reordered, negativeDeltas: r.summary.negativeDeltas }));
}
export async function reportProfiles(directory = 'desktop-profile-evidence', baseline = 'desktop-baseline-evidence/results.json') {
  const files = (await readdir(directory)).filter(n => /^\d+-(demo|60-sales)-\d+-(Performance|associate-open|list-scroll)\.json$/.test(n));
  const rows = await Promise.all(files.map(async n => JSON.parse(await readFile(path.join(directory, n), 'utf8'))));
  const original = JSON.parse(await readFile(baseline, 'utf8'));
  assert.equal(original.source, '7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5');
  assert.equal(original.browser, 'chromium');
  assert.ok(!original.failure, 'baseline driver must complete');
  const report = { source: original.source, diagnosticOnly: true, rows: validateProfiles(rows, original.runs) };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await reportProfiles();

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { instrumentBaseline, BASELINE_COMMIT, BASELINE_HASH } from '../scripts/desktop-profile.mjs';
import { assetName, projectTrace, sanitizeCpuProfile, cpuFailureEvidence, metricDelta, summarizeProfile, decodeMappings,
  sourceLocation, verifyMappedBuild, CAP } from '../scripts/desktop-profile-read.mjs';
import { createProfileSession } from '../scripts/desktop-profile-session.mjs';
import { validateProfiles } from '../scripts/desktop-profile-report.mjs';

const cpu = () => ({ startTime: 0, endTime: 3000, nodes: [
  { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2] },
  { id: 2, callFrame: { functionName: 'Board', url: 'http://127.0.0.1:49218/assets/Manager-abc.js?secret=never-save', lineNumber: 5, columnNumber: 8 } },
], samples: [2, 2], timeDeltas: [1000, 2000] });
const event = () => ({ ph: 'X', name: 'Layout', ts: 0, dur: 4000, pid: 1, tid: 2,
  args: { url: 'https://secret.test/token', headers: { authorization: 'secret' }, text: 'never retained' } });
const main = { ph: 'M', name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } };
const fixture = ["import { launch } from './probe-kit.mjs';",
  'export async function runDesktopBaseline() {', 'const errors = [], dataReads = [];',
  'try { page = await context.newPage();', 'const measure = async (label) => {',
  'stage = `${width}/${fixture}/${label}`;', 'return { summary, raw };', '};',
  '} finally { await closeDesktopContext(context, mock); }', '}'].join('\n');

test('profiling hooks are bounded to five unique driver anchors and absolute imports', () => {
  const transformed = instrumentBaseline(fixture, 'file:///diagnostic/scripts/desktop-baseline.mjs', 'file:///profile/hooks.mjs');
  assert.match(transformed, /from 'file:\/\/\/diagnostic\/scripts\/probe-kit.mjs'/);
  assert.match(transformed, /await profiler.finish\(raw, summary\)/);
  assert.match(transformed, /await profiler.abort\(\)/);
  assert.match(transformed, /finally \{ await closeDesktopContext\(context, mock\)/);
  assert.match(transformed, /sourceURL=desktop-profile-driver.mjs/);
  assert.throws(() => instrumentBaseline(fixture.replace('page = await context.newPage();', ''), 'file:///a', 'file:///b'), /anchor changed/);
  assert.throws(() => instrumentBaseline(fixture + 'return { summary, raw };', 'file:///a', 'file:///b'), /anchor changed/);
  assert.equal(BASELINE_COMMIT.length, 40); assert.equal(BASELINE_HASH.length, 64);
});
test('CPU and trace projections discard URLs, headers, text and arbitrary fields', () => {
  const clean = sanitizeCpuProfile(cpu());
  assert.equal(clean.nodes[1].frame.asset, 'Manager-abc.js');
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.deepEqual(projectTrace(event()), { ph: 'X', name: 'Layout', ts: 0, dur: 4000, pid: 1, tid: 2 });
  assert.equal(projectTrace({ ...event(), name: 'ResourceSendRequest' }), null);
  assert.equal(projectTrace({ ...event(), dur: NaN }), null);
  assert.equal(assetName('https://real.test/assets/Manager.js'), '[injected or native]');
  assert.equal(assetName('file:///secret.js'), '[injected or native]');
});
test('malformed, missing or oversized CPU evidence is not accepted', () => {
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), timeDeltas: [] }), /cap\/shape/);
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), samples: [999, 2] }), /missing node/);
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), timeDeltas: [1000, -1] }), /negative CPU time delta/);
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), timeDeltas: [1000, NaN] }), /non-finite CPU time delta/);
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), samples: Array(CAP + 1).fill(2), timeDeltas: Array(CAP + 1).fill(1) }), /cap\/shape/);
  assert.throws(() => sanitizeCpuProfile({ ...cpu(), endTime: -1 }), /CPU window/);
});
test('invalid CPU evidence retains only bounded numeric associations, not raw backend fields', () => {
  const record = cpuFailureEvidence({ ...cpu(), samples: [999, 2], timeDeltas: [1000, -1], secret: 'never retain' });
  assert.equal(record.unknownNodeSamples, 1); assert.equal(record.negativeDeltas, 1);
  assert.deepEqual(record.samples, [999, 2]); assert.deepEqual(record.timeDeltas, [1000, -1]);
  assert.ok(!JSON.stringify(record).includes('secret'));
  assert.ok(!JSON.stringify(record).includes('Manager-abc.js'));
  const over = cpuFailureEvidence({ ...cpu(), samples: Array(CAP + 1).fill(2) });
  assert.equal(over.omittedOverCap, true); assert.equal(over.samples, null); assert.equal(over.sampleCount, CAP + 1);
  assert.equal(cpuFailureEvidence(null).samples, null);
});
test('missing or reset performance metrics are null, never zero', () => {
  const delta = metricDelta([{ name: 'LayoutCount', value: 3 }, { name: 'TaskDuration', value: 4 }],
    [{ name: 'LayoutCount', value: 5 }, { name: 'TaskDuration', value: 1 }]);
  assert.equal(delta.LayoutCount, 2); assert.equal(delta.TaskDuration, null); assert.equal(delta.ScriptDuration, null);
});
test('trace durations union per category on the main thread, not all-thread or nested sums', () => {
  const trace = [projectTrace(main), projectTrace(event()), projectTrace({ ...event(), ts: 1000, dur: 5000 }),
    projectTrace({ ...event(), tid: 9, dur: 90000 }), projectTrace({ ...event(), name: 'Paint', dur: 1000 })];
  const summary = summarizeProfile(sanitizeCpuProfile(cpu()), trace);
  assert.equal(summary.hot[0].sampledMs, 3);
  assert.deepEqual(summary.byType.Layout, { count: 2, unionMs: 6 });
  assert.equal(summary.byType.Paint.unionMs, 1);
  assert.equal(summarizeProfile(sanitizeCpuProfile(cpu()), trace.slice(1)).byType, null);
});
test('source maps retain cross-line deltas and use the nearest generated segment', () => {
  const map = { mappings: 'AAAAA,KACCC;AADDC', sources: ['../../src/Manager.jsx'], names: ['Board', 'row', 'card'] };
  const decoded = decodeMappings(map.mappings);
  assert.deepEqual(sourceLocation(map, decoded, { line: 0, column: 5 }), { file: 'Manager.jsx', line: 2, column: 2, name: 'row' });
  assert.equal(sourceLocation(map, decoded, { line: 1, column: 0 }).name, 'card');
  assert.equal(sourceLocation(map, decodeMappings('AAAA,K'), { line: 0, column: 6 }), null);
  assert.throws(() => decodeMappings('!'), /VLQ/); assert.throws(() => decodeMappings('g'), /segment/);
});
test('hidden-map builds must have identical JS, CSS and HTML before profiling', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sage-profile-test-'));
  try {
    for (const sub of ['plain', 'mapped']) {
      await mkdir(path.join(dir, sub, 'assets'), { recursive: true });
      await writeFile(path.join(dir, sub, 'index.html'), '<p>same</p>');
      await writeFile(path.join(dir, sub, 'assets', 'app.js'), 'same');
    }
    await writeFile(path.join(dir, 'mapped', 'assets', 'app.js.map'), '{}');
    await verifyMappedBuild(path.join(dir, 'plain'), path.join(dir, 'mapped'));
    await writeFile(path.join(dir, 'mapped', 'assets', 'app.js'), 'changed');
    await assert.rejects(verifyMappedBuild(path.join(dir, 'plain'), path.join(dir, 'mapped')), /hidden maps changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

class CDP extends EventEmitter {
  calls = []; held = false; lose = false; failCpu = false; profile = cpu();
  async send(method) {
    this.calls.push(method);
    if (method === 'Performance.getMetrics') return { metrics: [{ name: 'LayoutCount', value: this.calls.length }] };
    if (method === 'Profiler.stop') { if (this.failCpu) throw new Error('CPU failed'); return { profile: this.profile }; }
    if (method === 'Tracing.end' && !this.held) queueMicrotask(() => this.emit('Tracing.tracingComplete', { dataLossOccurred: this.lose }));
    return {};
  }
  async detach() { this.calls.push('detach'); }
}
async function session(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sage-profile-cdp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cdp = new CDP(), saved = [];
  const recorder = await createProfileSession(cdp, { width: 1440, fixture: 'demo', directory }, async (_, json) => saved.push(JSON.parse(json)));
  return { cdp, saved, recorder };
}
test('trace terminal delivery is awaited before recording or detaching', async t => {
  const { cdp, saved, recorder } = await session(t);
  cdp.held = true; await recorder.begin('Performance');
  const pending = recorder.finish({}, { usable: true });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(saved.length, 0);
  cdp.emit('Tracing.dataCollected', { value: [main, event()] });
  cdp.emit('Tracing.tracingComplete', {}); await pending;
  assert.equal(saved[0].trace.length, 2); assert.equal(saved[0].status, 'complete');
  await recorder.dispose(); assert.equal(cdp.calls.at(-1), 'detach'); assert.equal(cdp.listenerCount('Tracing.dataCollected'), 0);
});
test('unselected interactions attach no active CPU/trace and do not create evidence', async t => {
  const { cdp, saved, recorder } = await session(t);
  await recorder.begin('Summary'); await recorder.finish({}, { usable: true });
  assert.ok(!cdp.calls.includes('Profiler.start')); assert.equal(saved.length, 0); await recorder.dispose();
});
test('aborted recordings are preserved and never presented as valid completion', async t => {
  const { saved, recorder } = await session(t); await recorder.begin('associate-open'); await recorder.abort();
  assert.equal(saved[0].status, 'aborted'); assert.equal(saved[0].sample, null); await recorder.dispose();
});
test('lost trace data preserves an invalid record and fails the flow', async t => {
  const { cdp, saved, recorder } = await session(t); cdp.lose = true; await recorder.begin('Performance');
  await assert.rejects(recorder.finish({}, { usable: true }), /buffer lost/);
  assert.equal(saved[0].status, 'invalid'); assert.equal(saved[0].traceDataLoss, true); await recorder.dispose();
});
test('a failed CPU recorder still drains tracing and detaches after preserving evidence', async t => {
  const { cdp, saved, recorder } = await session(t); cdp.failCpu = true; await recorder.begin('Performance');
  await assert.rejects(recorder.finish({}, { usable: true }), /CPU failed/);
  assert.ok(cdp.calls.includes('Tracing.end')); assert.equal(saved[0].status, 'invalid'); await recorder.dispose();
  assert.equal(cdp.calls.at(-1), 'detach');
});
test('rejected CPU samples remain invalid and retain their numeric failure evidence', async t => {
  const { cdp, saved, recorder } = await session(t); cdp.profile.timeDeltas = [1000, -1];
  await recorder.begin('Performance');
  await assert.rejects(recorder.finish({}, { usable: true }), /negative CPU time delta/);
  assert.equal(saved[0].status, 'invalid'); assert.equal(saved[0].cpu, null); assert.equal(saved[0].summary, null);
  assert.deepEqual(saved[0].cpuFailure.timeDeltas, [1000, -1]); assert.equal(saved[0].cpuFailure.negativeDeltas, 1);
  assert.ok(cdp.calls.includes('Tracing.end')); await recorder.dispose(); assert.equal(cdp.calls.at(-1), 'detach');
});
test('trace cap and unusable lifecycle retain invalid evidence instead of silent truncation', async t => {
  const { cdp, saved, recorder } = await session(t); await recorder.begin('list-scroll');
  cdp.emit('Tracing.dataCollected', { value: Array(CAP + 1).fill(event()) });
  await assert.rejects(recorder.finish({}, { usable: true }), /cap exceeded/);
  assert.equal(saved[0].dropped, 1); assert.equal(saved[0].trace.length, CAP); await recorder.dispose();
});
test('unusable lifecycle cannot be marked complete in the retained recording', async t => {
  const { saved, recorder } = await session(t); await recorder.begin('Performance');
  await assert.rejects(recorder.finish({}, { usable: false }), /complete lifecycle/);
  assert.equal(saved[0].status, 'invalid'); await recorder.dispose();
});
test('final profile coverage requires every original case and all three selected cycles', () => {
  const runs = [1440, 1920].flatMap(width => ['demo', '60-sales'].map(fixture => ({ width, fixture,
    complete: true, results: Array.from({ length: 30 }, () => ({ summary: { usable: true } })), errors: [],
    splitValueReads: 45, seedCount: 10, rowCount: fixture === 'demo' ? 10 : 62 })));
  const rows = runs.flatMap(run => Array.from({ length: 3 }, (_, cycle) => ['Performance', 'associate-open', 'list-scroll'].map((label, i) => ({
    width: run.width, fixture: run.fixture, label, ordinal: cycle * 3 + i, status: 'complete', sample: { usable: true },
    cpu: { samples: [1] }, summary: { mainThread: {}, byType: { Layout: {} } }, dropped: 0, traceDataLoss: false }))).flat());
  assert.equal(validateProfiles(rows, runs).length, 36);
  assert.throws(() => validateProfiles(rows.slice(1), runs), /selected interactions/);
  assert.throws(() => validateProfiles(rows.map((r, i) => i ? r : { ...r, status: 'aborted' }), runs), /valid trace/);
  assert.throws(() => validateProfiles(rows, runs.map((r, i) => i ? r : { ...r, splitValueReads: 0 })), /isolated baseline/);
  assert.throws(() => validateProfiles(rows, [...runs.slice(0, 3), runs[0]]), /unique expected cases/);
  assert.throws(() => validateProfiles(rows.map((r, i) => i ? r : { ...r, ordinal: 1 }), runs), /unique profile ordinals/);
});
test('workflow pins source and harness without installing or exposing production instrumentation', async () => {
  const flow = await readFile(new URL('../.github/workflows/desktop-profile.yml', import.meta.url), 'utf8');
  assert.ok(flow.includes(BASELINE_COMMIT)); assert.match(flow, /7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5/);
  assert.match(flow, /--sourcemap hidden/); assert.match(flow, /if: always\(\)/);
  assert.ok(!flow.includes('continue-on-error') && !flow.includes('retry'));
});

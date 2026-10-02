import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CAP, projectTrace, sanitizeCpuProfile, cpuFailureEvidence, metricDelta, summarizeProfile, decodeMappings, sourceLocation } from './desktop-profile-read.mjs';

export const PROFILE_LABELS = new Set(['Performance', 'associate-open', 'list-scroll']);
export async function createProfileSession(cdp, { width, fixture, directory = 'desktop-profile-evidence', mapDirectory }, save = writeFile) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  await mkdir(directory, { recursive: true });
  let active = null, ordinal = 0, dropped = 0;
  const maps = new Map();
  const receive = ({ value }) => {
    if (!active) return;
    for (const event of value) {
      const projected = projectTrace(event);
      if (projected) { if (active.trace.length < CAP) active.trace.push(projected); else dropped++; }
    }
  };
  cdp.on('Tracing.dataCollected', receive);
  async function stopTrace() {
    if (!active.tracing) return {};
    // Both the end request and final buffer must finish within one deadline.
    // Waiting for the request first leaves the deadline rejection unhandled
    // when the browser never acknowledges it.
    let timer, listener;
    const complete = new Promise(resolve => {
      listener = result => resolve(result);
      cdp.once('Tracing.tracingComplete', listener);
    });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('trace completion deadline')), 5000);
    });
    try {
      const end = Promise.resolve().then(() => cdp.send('Tracing.end'));
      const [, result] = await Promise.race([Promise.all([end, complete]), deadline]);
      return result;
    }
    finally { clearTimeout(timer); cdp.off('Tracing.tracingComplete', listener); active.tracing = false; }
  }
  async function mapFrames(cpu) {
    if (!mapDirectory) return;
    for (const node of cpu.nodes) {
      const asset = node.frame.asset;
      if (asset === '[injected or native]') continue;
      if (!maps.has(asset)) {
        // Vite's hidden maps are local generated files, never fetched from a service.
        const map = JSON.parse(await readFile(path.join(mapDirectory, 'assets', asset + '.map'), 'utf8'));
        maps.set(asset, { map, decoded: decodeMappings(map.mappings) });
      }
      const { map, decoded } = maps.get(asset);
      node.frame.source = sourceLocation(map, decoded, node.frame);
    }
  }
  async function finish(raw, sample, status = 'complete') {
    if (!active) return;
    let cpu, cpuFailure, metrics, traceComplete, failure;
    try {
      if (active.cpu) {
        const result = await cdp.send('Profiler.stop'); active.cpu = false;
        try { cpu = sanitizeCpuProfile(result.profile); }
        catch (error) { cpuFailure = cpuFailureEvidence(result.profile); throw error; }
      }
    } catch (error) { failure = error; }
    // One failed recorder must not prevent the other from draining its buffer.
    try { traceComplete = await stopTrace(); } catch (error) { failure ||= error; }
    try { metrics = await cdp.send('Performance.getMetrics'); } catch (error) { failure ||= error; }
    try {
      if (cpu) await mapFrames(cpu);
      assert.equal(dropped, 0, 'trace event cap exceeded');
      assert.ok(traceComplete && !traceComplete.dataLossOccurred, 'browser trace buffer lost data or did not drain');
      assert.ok(cpu?.samples.length > 0, 'missing CPU samples');
      if (status === 'complete') assert.ok(raw && sample?.usable, 'profile needs a complete lifecycle sample');
    } catch (error) { failure ||= error; }
    const row = { width, fixture, ordinal: ordinal++, label: active.label, status: failure ? 'invalid' : status,
      diagnosticOnly: true, includesAutomationPreparation: true, dropped, traceDataLoss: traceComplete ? !!traceComplete.dataLossOccurred : null,
      sample: sample || null, cpu: cpu || null, cpuFailure: cpuFailure || null, trace: active.trace,
      metrics: metrics ? metricDelta(active.before.metrics, metrics.metrics) : null,
      summary: cpu ? summarizeProfile(cpu, active.trace) : null, failure: failure?.message || null };
    const file = `${width}-${fixture}-${String(row.ordinal).padStart(2, '0')}-${row.label}.json`;
    await save(path.join(directory, file), JSON.stringify(row, null, 2));
    // Reset only after preserving the completed or invalid diagnostic.
    active = null;
    if (failure) throw failure;
  }
  return {
    async begin(label) {
      if (!PROFILE_LABELS.has(label)) return;
      assert.equal(active, null, 'overlapping profile');
      active = { label, trace: [], before: await cdp.send('Performance.getMetrics'), cpu: false, tracing: false }; dropped = 0;
      await cdp.send('Tracing.start', { categories: '-*,devtools.timeline', transferMode: 'ReportEvents' }); active.tracing = true;
      await cdp.send('Profiler.start'); active.cpu = true;
    },
    finish,
    async abort() { if (active) await finish(null, null, 'aborted'); },
    async dispose() {
      try { if (active) await finish(null, null, 'aborted'); }
      finally { cdp.off('Tracing.dataCollected', receive); await cdp.detach(); }
    },
  };
}
export async function attachDesktopProfile(context, page, options) {
  return createProfileSession(await context.newCDPSession(page), { ...options,
    mapDirectory: process.env.DESKTOP_MAP_BUILD || '.desktop-signal/dist-mapped' });
}

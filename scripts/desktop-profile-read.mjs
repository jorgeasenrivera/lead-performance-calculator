import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const TRACE_NAMES = new Set(['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'CompositeLayers',
  'FunctionCall', 'RunTask', 'EventDispatch', 'FireAnimationFrame', 'TimerFire', 'EvaluateScript',
  'V8.Execute', 'MajorGC', 'MinorGC']);
export const CAP = 20000;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const safeName = s => typeof s === 'string' && /^[\w$()[\] .<>:-]{0,120}$/.test(s) ? s : '[anonymous]';
export function assetName(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' || !/^\/assets\/[\w.-]+\.js$/.test(u.pathname)) return '[injected or native]';
    return path.posix.basename(u.pathname);
  } catch { return '[injected or native]'; }
}
export function projectTrace(event) {
  if (event.ph === 'M' && event.name === 'thread_name' && event.args?.name === 'CrRendererMain') {
    return { name: 'thread_name', ph: 'M', pid: event.pid, tid: event.tid, thread: 'CrRendererMain' };
  }
  if (event.ph !== 'X' || !TRACE_NAMES.has(event.name) || !finite(event.ts) || !finite(event.dur) || event.dur < 0) return null;
  // Trace arguments can carry request URLs, text and headers. Never retain them.
  return { name: event.name, ph: 'X', ts: event.ts, dur: event.dur, pid: event.pid, tid: event.tid };
}
export function sanitizeCpuProfile(profile) {
  assert.ok(finite(profile.startTime) && finite(profile.endTime) && profile.endTime >= profile.startTime, 'invalid CPU window');
  assert.ok(Array.isArray(profile.nodes) && profile.nodes.length <= CAP, 'CPU node cap');
  assert.ok(Array.isArray(profile.samples) && Array.isArray(profile.timeDeltas) &&
    profile.samples.length === profile.timeDeltas.length && profile.samples.length <= CAP, 'CPU sample cap/shape');
  const ids = new Set(profile.nodes.map(n => n.id));
  assert.equal(ids.size, profile.nodes.length, 'duplicate CPU node');
  assert.ok(profile.samples.every(n => ids.has(n)) && profile.timeDeltas.every(n => finite(n) && n >= 0), 'invalid CPU samples');
  return { startTime: profile.startTime, endTime: profile.endTime, samples: profile.samples, timeDeltas: profile.timeDeltas,
    nodes: profile.nodes.map(n => ({ id: n.id, children: (n.children || []).filter(id => ids.has(id)),
      frame: { function: safeName(n.callFrame?.functionName), asset: assetName(n.callFrame?.url),
        line: n.callFrame?.lineNumber ?? -1, column: n.callFrame?.columnNumber ?? -1 } })) };
}
export function metricDelta(before, after) {
  const a = new Map(before.map(m => [m.name, m.value])), b = new Map(after.map(m => [m.name, m.value]));
  return Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
    .map(name => [name, finite(a.get(name)) && finite(b.get(name)) && b.get(name) >= a.get(name) ? b.get(name) - a.get(name) : null]));
}
export function summarizeProfile(cpu, trace) {
  const times = new Map();
  cpu.samples.forEach((id, i) => times.set(id, (times.get(id) || 0) + cpu.timeDeltas[i]));
  const hot = cpu.nodes.map(n => ({ ...n.frame, sampledMs: (times.get(n.id) || 0) / 1000 }))
    .filter(n => n.sampledMs > 0).sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 30);
  const main = trace.find(e => e.thread === 'CrRendererMain');
  const render = main ? trace.filter(e => e.ph === 'X' && e.pid === main.pid && e.tid === main.tid) : null;
  const byType = render && Object.fromEntries([...TRACE_NAMES].map(name => {
    const events = render.filter(e => e.name === name).sort((a, b) => a.ts - b.ts);
    let end = -Infinity, union = 0;
    for (const e of events) { union += Math.max(0, e.ts + e.dur - Math.max(end, e.ts)); end = Math.max(end, e.ts + e.dur); }
    return [name, { count: events.length, unionMs: union / 1000 }];
  }));
  // Categories nest. Their union durations are not additive across categories.
  return { cpuWindowMs: (cpu.endTime - cpu.startTime) / 1000, sampleCount: cpu.samples.length, hot, mainThread: main || null, byType };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function decodeMappings(mappings) {
  let source = 0, line = 0, column = 0, name = 0;
  return mappings.split(';').map(row => {
    let generated = 0;
    return row ? row.split(',').map(segment => {
      const fields = []; let value = 0, shift = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char); assert.ok(digit >= 0 && shift <= 30, 'invalid source-map VLQ');
        value += (digit & 31) * 2 ** shift;
        if (digit & 32) shift += 5;
        else { fields.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
      }
      assert.ok(shift === 0 && [1, 4, 5].includes(fields.length), 'invalid source-map segment');
      generated += fields[0];
      if (fields.length === 1) return { generated };
      source += fields[1]; line += fields[2]; column += fields[3]; if (fields.length === 5) name += fields[4];
      return { generated, source, line, column, ...(fields.length === 5 ? { name } : {}) };
    }) : [];
  });
}
export function sourceLocation(map, decoded, frame) {
  const segments = decoded[frame.line] || [];
  let found;
  for (const segment of segments) { if (segment.generated > frame.column) break; found = segment; }
  if (found?.source == null || !map.sources[found.source]) return null;
  return { file: path.posix.basename(map.sources[found.source].replace(/\\/g, '/')), line: found.line + 1,
    column: found.column + 1, name: safeName(map.names?.[found.name] || '') };
}
export async function verifyMappedBuild(plain, mapped) {
  const list = async dir => (await readdir(path.join(dir, 'assets'))).filter(n => /\.(js|css)$/.test(n)).sort();
  const names = await list(plain); assert.deepEqual(await list(mapped), names, 'hidden maps must not change asset names');
  for (const name of ['index.html', ...names.map(n => 'assets/' + n)]) {
    assert.deepEqual(await readFile(path.join(mapped, name)), await readFile(path.join(plain, name)), `hidden maps changed ${name}`);
  }
  return names;
}

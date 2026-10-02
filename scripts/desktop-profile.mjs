import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyMappedBuild } from './desktop-profile-read.mjs';

export const BASELINE_COMMIT = 'abcc33dc7e9ad97f93f0517b6d0d41104b9fe111';
export const BASELINE_HASH = '6de1f4d49a57e555f0ffcde435578bedbe1147856e2d811d1f83855f10c17f20';
export function instrumentBaseline(source, runnerUrl, hookUrl) {
  const replace = (needle, replacement) => {
    assert.equal(source.split(needle).length, 2, `profile anchor changed: ${needle}`);
    source = source.replace(needle, replacement);
  };
  replace('const errors = [], dataReads = [];', 'let profiler; const errors = [], dataReads = [];');
  replace("page = await context.newPage();", "page = await context.newPage(); profiler = await attachDesktopProfile(context, page, { width, fixture });");
  replace('stage = `${width}/${fixture}/${label}`;', 'stage = `${width}/${fixture}/${label}`; await profiler.begin(label); try {');
  replace('return { summary, raw };', 'await profiler.finish(raw, summary); return { summary, raw }; } catch(error) { await profiler.abort(); throw error; }');
  replace('} finally { await closeDesktopContext(context, mock); }', '} finally { try { await profiler?.dispose(); } finally { await closeDesktopContext(context, mock); } }');
  source = source.replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL(relative, runnerUrl).href}'`);
  return `import { attachDesktopProfile } from ${JSON.stringify(hookUrl)};\n` + source;
}
export async function runDesktopProfile() {
  assert.equal(process.env.FEEL_BROWSER || 'chromium', 'chromium', 'CDP profiling supports Chromium only, not WebKit');
  const baseline = path.resolve(process.env.DESKTOP_BASELINE_ROOT || '.desktop-baseline');
  const runner = path.join(baseline, 'scripts/desktop-baseline.mjs');
  const source = (await readFile(runner, 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), BASELINE_HASH, 'accepted baseline source must remain immutable');
  await verifyMappedBuild(path.resolve(process.env.DESKTOP_PLAIN_BUILD || '.desktop-signal/dist'),
    path.resolve(process.env.DESKTOP_MAP_BUILD || '.desktop-signal/dist-mapped'));
  // Hooks change the diagnostic driver in memory only. App source and all of
  // X21's isolation, data, readiness and error assertions remain unchanged.
  const transformed = instrumentBaseline(source, pathToFileURL(runner).href,
    new URL('./desktop-profile-session.mjs', import.meta.url).href);
  const module = await import('data:text/javascript;base64,' + Buffer.from(transformed).toString('base64'));
  await module.runDesktopBaseline();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopProfile();

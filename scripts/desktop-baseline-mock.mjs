import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function isolatedMockSource(source, seedURL) {
  if (!source.includes('"./demo-seed.mjs"') || !source.includes('.listen(5433,')) throw new Error('Mock source shape changed.');
  return source.replace('"./demo-seed.mjs"', JSON.stringify(seedURL)).replace('.listen(5433,', '.listen(5434,');
}

// The actual manager mirrors room history back into its store. Every browser
// context therefore needs a fresh process, not just a response-only roster.
export async function startIsolatedMock() {
  const origin = 'http://127.0.0.1:5434';
  const source = isolatedMockSource(await fs.readFile('scripts/mock-supabase.mjs', 'utf8'),
    pathToFileURL(path.resolve('scripts/demo-seed.mjs')).href);
  const code = `await import(${JSON.stringify('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))});`;
  const proc = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, SALESPERSON: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '', failure = null;
  for (const stream of [proc.stdout, proc.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-4000); });
  proc.on('error', error => { failure = error; });
  const stop = async () => {
    if (!proc.pid || proc.exitCode != null || proc.signalCode != null) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Isolated mock did not stop within two seconds.')), 2000);
      proc.once('exit', () => { clearTimeout(timeout); resolve(); });
      proc.kill();
    });
  };
  try {
    for (let i = 0; i < 100; i++) {
      if (failure) throw failure;
      if (proc.exitCode != null) throw new Error('Isolated mock failed to start: ' + log);
      // Only the child we just launched may own this port. An unrelated service
      // must not be mistaken for readiness, especially on the work computer.
      if (/EADDRINUSE/.test(log)) throw new Error('Port 5434 is occupied, no existing service was changed.');
      if (log.includes('mock supabase on')) {
        const response = await fetch(origin + '/rest/v1/', { signal: AbortSignal.timeout(1000) }).catch(() => null);
        if (response?.ok) return { origin, stop, log: () => log };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Isolated mock readiness timed out.');
  } catch (error) { await stop(); throw error; }
}

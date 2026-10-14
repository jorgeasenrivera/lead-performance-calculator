import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';

export const RELEASE = 'd9320e253b603260f6a7355d4bc1c77a59fefa5b';
export const SITE = 'http://127.0.0.1:5179';
export function fixtureConfig(config) {
  assert.equal(config.expo.extra.siteUrl, 'https://www.sageonline.io');
  return { ...config, expo: { ...config.expo, extra: { ...config.expo.extra, siteUrl: SITE } } };
}
if (process.argv[2] === 'prepare') {
  const dest = resolve(process.argv[3]);
  assert.ok(!existsSync(dest), 'refuse to overwrite a previous export');
  mkdirSync(dest, { recursive: true });
  const archive = execFileSync('git', ['archive', RELEASE], { maxBuffer: 100 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dest], { input: archive });
  const config = `${dest}/native/app.json`;
  writeFileSync(config, JSON.stringify(fixtureConfig(JSON.parse(readFileSync(config))), null, 2));
  writeFileSync(`${dest}/.env.local`, 'VITE_SUPABASE_URL=http://127.0.0.1:5433\nVITE_SUPABASE_ANON_KEY=mock-anon-key\n');
}
if (process.argv[2] === 'serve') {
  // Restrict the real web bundle before its first script runs. No live APIs,
  // remote fonts, telemetry or workers may escape the fictional fixture.
  http.createServer(async (req, res) => {
    try {
      const upstream = await fetch(`http://127.0.0.1:5178${req.url}`, { redirect: 'error' });
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:5433; worker-src 'none'; frame-src 'none'; object-src 'none'",
        'cache-control': 'no-store',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { res.writeHead(502); res.end('Fixture unavailable'); }
  }).listen(5179, '127.0.0.1');
}

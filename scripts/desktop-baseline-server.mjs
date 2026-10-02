import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetPath } from './manager-performance.mjs';
import { installDesktopProbe } from './desktop-baseline-metrics.mjs';

export async function serveDesktopBaseline(root, port = 49218, clicks = false) {
  root = path.resolve(root);
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  // Serving a production-connected bundle would send demo sign-in and reads to
  // production. Refuse it, even though the probe itself makes no requests.
  const assets = await fs.readdir(path.join(root, 'assets'));
  const scripts = await Promise.all(assets.filter(n => n.endsWith('.js')).map(n => fs.readFile(path.join(root, 'assets', n), 'utf8')));
  if (!scripts.some(s => /http:\/\/127\.0\.0\.1:543[34]/.test(s)) || scripts.some(s => /https:\/\/[^"'\s]+\.supabase\.co/.test(s))) {
    throw new Error('Build against the local mock on 5433 or 5434 before measuring.');
  }
  const injected = html.replace('</body>', `<script>(${installDesktopProbe.toString()})();${clicks ? 'window.__desktopProbe.enableClicks();' : ''}</script></body>`);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const file = assetPath(root, req.url);
      if (!file) { res.writeHead(403).end(); return; }
      const bytes = file === path.join(root, 'index.html') ? injected : await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await serveDesktopBaseline(process.argv[2] || 'dist', Number(process.argv[3] || 49218), process.argv.includes('--clicks'));
  console.log('Desktop baseline server is local only.');
}

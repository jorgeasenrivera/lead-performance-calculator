import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/* Static checks from the October accessibility audit (docs/accessibility-audit.md).
   They read files and run nothing, so they need no browser: they hold two contracts
   that are cheap to break by accident, and say nothing about how a screen behaves. */

const root = new URL('../', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

test('the page lets people zoom, and keeps the rest of its viewport', () => {
  const html = read('index.html');
  const metas = [...html.matchAll(/<meta\s+name="viewport"\s+content="([^"]*)"/g)];
  assert.equal(metas.length, 1, 'exactly one viewport meta');
  const tokens = Object.fromEntries(metas[0][1].split(',').map((t) => t.trim().split('=').map((x) => x.trim())));
  assert.equal(tokens['width'], 'device-width');
  assert.equal(Number(tokens['initial-scale']), 1, 'the first paint is still 1:1');
  assert.equal(tokens['viewport-fit'], 'cover', 'the ground still runs to the screen edges and the safe-area insets still apply');
  for (const lock of ['user-scalable', 'maximum-scale']) assert.ok(!(lock in tokens), `${lock} would stop pinch zoom`);
  assert.ok(!('minimum-scale' in tokens) || Number(tokens['minimum-scale']) < 1, 'nor may a minimum-scale pin it');
});

/* What is checked below is the helper's boundary, not its behaviour (that is
   dialog-focus.test.mjs). While it is not wired in, nothing may depend on it, and it
   may depend on nothing, so that wiring it into one screen is one reviewed change. */
const helperPath = 'src/dialog-focus.mjs';
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');

test('the dialog focus helper imports nothing and reads no global', () => {
  const code = withoutComments(read(helperPath));
  assert.ok(!/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(code), 'no import, dynamic import or require');
  for (const name of ['document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'setTimeout', 'requestAnimationFrame', 'fetch', 'process', 'globalThis']) {
    assert.ok(!new RegExp(`(?<![\\w.$])${name}\\b`).test(code), `${name} is reached only through what the caller passes in`);
  }
  const exported = [...code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ['FOCUSABLE_SELECTOR', 'dialogDepth', 'openDialogFocus'], 'the public surface is these three');
  assert.ok(!/^export\s+default\b|^export\s*\{/m.test(code), 'and nothing is exported another way');
});

function* sources(dir) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'evidence' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:[cm]?js|jsx|tsx?|html|css)$/.test(entry.name)) yield path;
  }
}

test('nothing in the app, the servers, the native shell or the tooling imports the helper yet', () => {
  const files = ['index.html', 'vite.config.js'].filter((f) => existsSync(join(root, f)));
  for (const dir of ['src', 'api', 'scripts', 'native', 'workers', 'public']) if (existsSync(join(root, dir))) files.push(...sources(dir));
  const users = files.filter((f) => f !== helperPath && /dialog-focus/.test(read(f)));
  assert.deepEqual(users, [], 'wiring it into a screen is its own change, with its own review and phone check');
});

test('the files this work added keep the house rule of no em dashes', () => {
  for (const path of [helperPath, 'test/dialog-focus.test.mjs', 'test/audit-static.test.mjs', 'docs/accessibility-audit.md']) {
    assert.ok(existsSync(join(root, path)), `${path} exists`);
    const at = read(path).indexOf('\u2014');
    assert.equal(at, -1, `${relative(root, join(root, path))} has an em dash at character ${at}`);
  }
});

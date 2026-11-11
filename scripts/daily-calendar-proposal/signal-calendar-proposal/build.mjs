import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { transformManager } from './transform-manager.mjs';

export const root = fileURLToPath(new URL('./', import.meta.url));
export const sourceRoot = process.env.SIGNAL_SOURCE_ROOT || fileURLToPath(new URL('../../../.calendar-source/', import.meta.url));
export const dependencyRoot = process.env.PROPOSAL_DEPENDENCIES_ROOT || fileURLToPath(new URL('../../../node_modules/', import.meta.url));
export async function verifySource() {
  const contract = JSON.parse(await readFile(new URL('./source-contract.json', import.meta.url), 'utf8'));
  for (const [file, expected] of Object.entries(contract.files)) {
    const sha = createHash('sha256').update(await readFile(path.join(sourceRoot, file))).digest('hex');
    if (sha !== expected) throw new Error(`Pinned Signal source changed: ${file}`);
  }
  return contract;
}
export async function buildProposal() {
  const contract = await verifySource();
  const original = await readFile(path.join(sourceRoot, 'src/Manager.jsx'), 'utf8');
  const transformed = transformManager(original);
  const sourceHtml = await readFile(path.join(sourceRoot, 'index.html'), 'utf8');
  const fontCSS = [...sourceHtml.matchAll(/@font-face\s*\{[^}]+\}/g)].map((match) => match[0]).join('\n');
  if (!fontCSS.includes('Geist') || !fontCSS.includes('Space Grotesk')) throw new Error('Pinned source font declarations are missing');
  const { buildDemo } = await import(pathToFileURL(path.join(sourceRoot, 'scripts/demo-seed.mjs')).href);
  const originalRandom = Math.random; let random = 0;
  let demo;
  try { Math.random = () => ((++random * 7919) % 100000) / 100000; demo = buildDemo(new Date(contract.displayClock)); }
  finally { Math.random = originalRandom; }
  const rename = new Map();
  for (const [index, person] of demo.storeData.roster.entries()) {
    const name = `Fictional Associate ${String(index + 1).padStart(2, '0')}`;
    rename.set(person.name, name); rename.set(person.name.toLowerCase(), name.toLowerCase());
    rename.set(person.id, `fictional-person-${index + 1}`);
  }
  const sanitize = (value) => typeof value === 'string' ? (rename.get(value) || value)
    : Array.isArray(value) ? value.map(sanitize)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, val]) => [rename.get(key) || key, sanitize(val)])) : value;
  const seed = sanitize({ data: demo.storeData, store: demo.storeConfig });
  seed.store.id = 'fictional-a'; seed.store.name = 'Fictional Store Alpha'; seed.store.icon = null;
  for (const [day, rows] of Object.entries(seed.data.activity)) for (const row of Object.values(rows)) row.uploadedAt = `${day}T16:00:00.000Z`;
  await writeFile(path.join(root, 'seed.json'), JSON.stringify(seed, null, 2) + '\n');
  await mkdir(path.join(root, 'evidence'), { recursive: true });
  await writeFile(path.join(root, 'evidence/transform-manifest.json'), JSON.stringify({ source: contract, operations: transformed.operations,
    sourceUnchanged: true, transformedManagerSha256: createHash('sha256').update(transformed.code).digest('hex') }, null, 2) + '\n');
  const { build } = await import(pathToFileURL(path.join(dependencyRoot, 'vite/dist/node/index.js')).href);
  const packages = Object.keys(JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')).dependencies);
  const aliases = [{ find: '@sage', replacement: path.join(sourceRoot, 'src') }, { find: '@calendar-fixture', replacement: root },
    ...packages.map((name) => ({ find: name, replacement: path.join(dependencyRoot, name) }))];
  await build({ root, configFile: false, envDir: root, publicDir: path.join(sourceRoot, 'public'), cacheDir: path.join(root, '.vite'),
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://fixture.invalid'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fictional-fixture-key'), __APP_VERSION__: JSON.stringify('local-calendar-0f165a2') },
    resolve: { alias: aliases, dedupe: ['react','react-dom'] },
    plugins: [{ name: 'isolated-actual-signal-calendar', enforce: 'pre', transformIndexHtml(html) {
      return html.replace('</head>', `<style data-fixture-fonts>${fontCSS}</style></head>`);
    }, transform(code, id) {
      if (id.split('?')[0] === path.join(sourceRoot, 'src/Manager.jsx')) return transformed.code;
    } }],
    build: { outDir: path.join(root, 'dist'), emptyOutDir: true, target: 'es2022', sourcemap: false },
  });
  await verifySource();
  return transformed;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildProposal(); console.log(`Built local actual-component proposal with ${result.operations.length} bounded fixture transforms; source hashes unchanged.`);
}

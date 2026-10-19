// Generate an observational scratch copy; the release probe is never edited.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), phase = process.env.DIAG_PHASE, drain = process.env.DIAG_DRAIN;
assert(['before', 'after', 'combined'].includes(phase));
const repetition = process.env.DIAG_REPEAT || '1';
assert(['1','2','3'].includes(repetition));
assert(['0', '1'].includes(drain));
const sourceDir = path.join(root, '.source');
const original = readFileSync(path.join(sourceDir, 'scripts/hero-bars.mjs'), 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex');
assert.equal(hash(original), '1d6a3dfae95dd348eb98dc09b2e7fe2371f2297b9bf40c92e739f49a7ddb0972');
const out = path.join(root, 'diagnostic', `${phase}-drain-${drain}-repeat-${repetition}`);
mkdirSync(out, { recursive: true });
const eventsPath = path.join(out, 'events.jsonl');
writeFileSync(eventsPath, '');
let source = original;
function once(from, to) {
  assert.equal(source.split(from).length, 2, `unique diagnostic anchor: ${from.slice(0, 60)}`);
  source = source.replace(from, to);
}
once("import assert from 'node:assert/strict';", `import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { watchFeelReloads } from ${JSON.stringify(pathToFileURL(path.join(sourceDir, 'scripts/feel-navigation.mjs')).href)};
const diagEvents = ${JSON.stringify(eventsPath)};
const diagDrain = ${drain === '1'};
let diagScenario = { phase: ${JSON.stringify(phase)}, stage: 'startup' }, diagSequence = 0;
const diagIds = new WeakMap(), diagStarts = new WeakMap(), diagExternal = [];
const diagEvent = (kind, detail = {}) => { const event = { time: new Date().toISOString(), monotonicMs: performance.now(), kind, scenario: {...diagScenario}, ...detail }; appendFileSync(diagEvents, JSON.stringify(event) + '\\n'); if (['browser','pageerror','requestfailed','all-scenarios-complete'].includes(kind)) console.log('DIAGNOSTIC_EVENT ' + JSON.stringify(event)); };
const diagRequest = request => {
  if (!diagIds.has(request)) { diagIds.set(request, ++diagSequence); diagStarts.set(request, {...diagScenario}); }
  const u = new URL(request.url());
  return { requestId: diagIds.get(request), startedIn: diagStarts.get(request), method: request.method(), url: u.origin + u.pathname + (u.pathname.startsWith('/rest/') ? u.search : ''), headerNames: Object.keys(request.headers()).sort(), navigation: request.isNavigationRequest() };
};`);
once("let fixtureRole='admin', dockFixture=null;", `diagEvent('browser', { version: browser.version(), engine, drain: diagDrain });
await context.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.hostname === '127.0.0.1' && ['5178', '5181', '5433'].includes(u.port)) return route.continue();
  diagExternal.push(u.origin + u.pathname); diagEvent('blocked-external', { url: u.origin + u.pathname }); return route.abort();
});
let fixtureRole='admin', dockFixture=null;`);
once("  const requestUrl=route.request().url(), second=requestUrl.includes('spacing-demo-2');", "  diagEvent('app-data-route-start', diagRequest(route.request()));\n  const requestUrl=route.request().url(), second=requestUrl.includes('spacing-demo-2');");
once("  const response=await route.fetch({url:second ? requestUrl.replaceAll('spacing-demo-2','sage-demo') : requestUrl});", "  const response=await route.fetch({url:second ? requestUrl.replaceAll('spacing-demo-2','sage-demo') : requestUrl});\n  diagEvent('app-data-route-fetched', {...diagRequest(route.request()), status: response.status()});");
once("  await route.fulfill({response,json:Array.isArray(data)?data.map(fixture):fixture(data)});", "  await route.fulfill({response,json:Array.isArray(data)?data.map(fixture):fixture(data)});\n  diagEvent('app-data-route-fulfilled', diagRequest(route.request()));");
once('const page = await context.newPage(), errors = [];', `const page = await context.newPage(), errors = [];
const diagSettle = watchFeelReloads(page);
page.on('request', r => diagEvent('request', diagRequest(r)));
page.on('requestfinished', r => diagEvent('requestfinished', diagRequest(r)));
page.on('requestfailed', r => diagEvent('requestfailed', {...diagRequest(r), failure: r.failure()}));
page.on('response', r => diagEvent('response', {...diagRequest(r.request()), status: r.status()}));
page.on('pageerror', e => diagEvent('pageerror', { message: e.message, stack: e.stack, pageUrl: page.url() }));`);
if (phase !== 'combined') once("for(const phase of ['before','after'])", `for(const phase of [${JSON.stringify(phase)}])`);
else assert(source.includes("for(const phase of ['before','after'])"), 'combined phase order unchanged');
once("   rates=Object.fromEntries(Object.keys(thresholds).map((id,i)=>[id,values[i]]));", `   diagEvent('scenario-transition', { next: {phase,width,name} });
   if (diagDrain) { diagEvent('drain-start'); await diagSettle(); diagEvent('drain-complete'); }
   diagScenario = {phase,width,name}; diagEvent('scenario-start');
   rates=Object.fromEntries(Object.keys(thresholds).map((id,i)=>[id,values[i]]));`);
once(' assert.deepEqual(errors,[]);', " diagEvent('all-scenarios-complete', {results: results.length, errors});\n assert.deepEqual(diagExternal, [], 'synthetic test must not access external services');\n assert.deepEqual(errors,[]);");
// Every existing assertion line must survive verbatim, including error checks.
for (const line of original.split('\n').filter(l => l.includes('assert.'))) assert(source.includes(line), 'original assertion line changed');
const generated = path.join(out, 'hero-bars.observed.mjs');
writeFileSync(generated, source);
const identity = {
  phase, repetition, drain: drain === '1', originalProbeSHA256: hash(original), observedProbeSHA256: hash(source),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: sourceDir, encoding: 'utf8'}).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {cwd: sourceDir, encoding: 'utf8'}).trim(),
  baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: path.join(root,'.baseline'), encoding:'utf8'}).trim(),
  node: process.version, playwright: JSON.parse(readFileSync(path.join(root,'node_modules/playwright/package.json'))).version,
  runnerImage: 'mcr.microsoft.com/playwright:v1.63.0-noble', schedulerFlag: 0,
};
writeFileSync(path.join(out,'identity.json'), JSON.stringify(identity,null,2));
if (process.env.DIAG_PREPARE_ONLY !== '1') {
  const run = spawnSync(process.execPath, [generated], {cwd:out, env:{...process.env, FEEL_BROWSER:'webkit'}, stdio:'inherit'});
  writeFileSync(path.join(out,'outcome.json'),JSON.stringify({status:run.status, signal:run.signal, error:run.error?.message},null,2));
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const errors = events.filter(e => e.kind === 'pageerror');
  const failed = events.filter(e => e.kind === 'requestfailed');
  const summary = {phase, repetition, drain: drain === '1', status: run.status, scenarios: events.filter(e => e.kind === 'scenario-start').length, pageErrors: errors, failedRequests: failed};
  writeFileSync(path.join(out,'summary.json'), JSON.stringify(summary,null,2));
  console.log('DIAGNOSTIC_SUMMARY ' + JSON.stringify(summary));
  process.exitCode = run.status ?? 1;
}

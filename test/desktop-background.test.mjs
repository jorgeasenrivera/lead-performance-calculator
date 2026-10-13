import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installBackgroundScope, validateBackgroundSample } from '../scripts/desktop-background-browser.mjs';
import { narrowExperiment, backgroundConfig, SIGNAL_SHA, DRIVER_SHA, PROFILER_SHA } from '../scripts/desktop-background.mjs';
import { validateCohort } from '../scripts/desktop-background-report.mjs';
import { validateUnprofiled, summarizeUnprofiled, INTERACTIONS } from '../scripts/desktop-background-unprofiled.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function environment(count = 1, hostname = '127.0.0.1') {
  class Style {
    values = {}; writes = [];
    setProperty(...args) { this.writes.push(args); this.values[args[0]] = args[1]; return 'original'; }
    getPropertyValue(name) { return this.values[name] || ''; }
  }
  const root = new Style(), targets = Array.from({ length: count }, () => ({ style: new Style() }));
  const observers = [];
  const env = { location: { hostname }, CSSStyleDeclaration: Style,
    MutationObserver: class {
      constructor(fn) { this.callback = fn; observers.push(this); }
      observe() {} disconnect() {}
    },
    document: { documentElement: { style: root }, querySelectorAll: () => targets },
    getComputedStyle: target => ({ getPropertyValue: name => target.style.getPropertyValue(name) || root.getPropertyValue(name),
      transform: target.style.getPropertyValue('--bgy') || root.getPropertyValue('--bgy') || '0px' }),
    DOMMatrixReadOnly: class {
      constructor(value) {
        for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) this[`m${a}${b}`] = a === b ? 1 : 0;
        this.m42 = parseFloat(value);
      }
    } };
  return { env, root, targets, Style, observers };
}
for (const variant of ['root', 'backdrop']) {
  test(`${variant}: preserve exact parallax and priority, leave other writes alone`, () => {
    const { env, root, targets, Style } = environment();
    installBackgroundScope({ variant }, env);
    const before = env.__desktopBackgroundScope.snapshot();
    assert.equal(root.setProperty('--bgy', '-12.37px', 'important'), 'original');
    const receiver = variant === 'root' ? root : targets[0].style;
    assert.deepEqual(receiver.writes, [['--bgy', '-12.37px', 'important']]);
    const other = new Style(); other.setProperty('--bgy', '4px'); root.setProperty('color', 'red');
    assert.deepEqual(other.writes, [['--bgy', '4px']]);
    const delta = validateBackgroundSample(before, env.__desktopBackgroundScope.inspect());
    assert.equal(delta.calls, 1); assert.equal(delta[variant === 'root' ? 'rootWrites' : 'backdropWrites'], 1);
    assert.throws(() => installBackgroundScope({ variant }, env), /already installed/);
    assert.throws(() => root.setProperty('--bgy', 'calc(1px)'), /unexpected parallax/);
  });
}
test('remote page cannot install override', () => {
  const { env, root } = environment(1, 'www.sageonline.io');
  const original = root.setProperty; installBackgroundScope({ variant: 'backdrop' }, env);
  assert.equal(root.setProperty, original); assert.equal(env.__desktopBackgroundScope, undefined);
});
test('early browser init waits for the HTML root and disconnects before installation', () => {
  const { env, root } = environment(); let callback, observed, disconnected = false;
  env.document.documentElement = null;
  env.MutationObserver = class {
    constructor(fn) { callback = fn; }
    observe(target, options) { observed = { target, options }; }
    disconnect() { disconnected = true; }
  };
  installBackgroundScope({ variant: 'backdrop' }, env);
  assert.equal(env.__desktopBackgroundScope, undefined);
  assert.equal(observed.target, env.document); assert.deepEqual(observed.options, { childList: true });
  callback(); assert.equal(disconnected, false);
  env.document.documentElement = { style: root }; callback();
  assert.equal(disconnected, true);
  const before = env.__desktopBackgroundScope.snapshot(); root.setProperty('--bgy', '-4px');
  assert.equal(validateBackgroundSample(before, env.__desktopBackgroundScope.inspect()).backdropWrites, 1);
});
for (const count of [0, 2]) test(`unexpected ${count} backdrops preserves behavior but rejects evidence`, () => {
  const { env, root } = environment(count); installBackgroundScope({ variant: 'backdrop' }, env);
  const before = env.__desktopBackgroundScope.snapshot(); root.setProperty('--bgy', '-4px');
  assert.equal(root.getPropertyValue('--bgy'), '-4px');
  assert.throws(() => validateBackgroundSample(before, env.__desktopBackgroundScope.snapshot()), /fallback/);
  assert.throws(() => env.__desktopBackgroundScope.inspect(), /exactly one/);
});
test('counter loss, reset, variant drift and transform drift invalidate evidence', () => {
  const { env, root } = environment(); installBackgroundScope({ variant: 'backdrop' }, env);
  const before = env.__desktopBackgroundScope.snapshot(); root.setProperty('--bgy', '-4px');
  const after = env.__desktopBackgroundScope.inspect();
  for (const change of [{ variant: 'root' }, { calls: -1 }, { backdropWrites: 0 }, { fallbackWrites: 1 },
    { effectiveValue: '-3px' }, { identityExceptY: false }, { translateY: -3 }, { translateY: NaN }]) {
    assert.throws(() => validateBackgroundSample(before, { ...after, ...change }));
  }
});
for (const variant of ['root', 'backdrop']) test(`${variant}: replacement shell retains the exact prior value and priority`, () => {
  const { env, root, targets, Style, observers } = environment();
  installBackgroundScope({ variant }, env);
  root.setProperty('--bgy', '-12.37px', 'important');
  const before = env.__desktopBackgroundScope.snapshot();
  targets[0].isConnected = false;
  const replacement = { style: new Style(), isConnected: true }; targets.splice(0, 1, replacement);
  observers[0].callback();
  const delta = validateBackgroundSample(before, env.__desktopBackgroundScope.inspect());
  assert.equal(delta.calls, 0); assert.equal(delta.shellRestores, variant === 'backdrop' ? 1 : 0);
  if (variant === 'backdrop') assert.deepEqual(replacement.style.writes, [['--bgy', '-12.37px', 'important']]);
  observers[0].callback(); assert.equal(env.__desktopBackgroundScope.snapshot().shellRestores, delta.shellRestores);
});
const anchor = "for (const width of [1440, 1920]) for (const fixture of ['demo', '60-sales']) {";
test('narrow only cohort and evidence directory, reject anchor drift', () => {
  const source = `${anchor}\n await mkdir('desktop-baseline-evidence', {});\n unchanged();\n}`;
  const result = narrowExperiment(source, 'backdrop');
  assert.ok(result.includes("[1920]) for (const fixture of ['60-sales'])"));
  assert.ok(result.includes('desktop-background-evidence/backdrop/baseline'));
  assert.ok(result.includes('unchanged();'));
  assert.throws(() => narrowExperiment(source + anchor, 'root'));
  assert.throws(() => narrowExperiment('await mkdir(\'desktop-baseline-evidence\')', 'root'));
  assert.throws(() => narrowExperiment(anchor, 'root'));
});
function cohort(variant = 'backdrop') {
  const labels = Array.from({ length: 3 }, () => ['Performance', 'associate-open', 'list-scroll']).flat();
  const baseline = { source: SIGNAL_SHA, browser: 'chromium', runs: [{ width: 1920, fixture: '60-sales', complete: true,
    seedCount: 10, rowCount: 62, splitValueReads: 45, errors: [], results: Array.from({ length: 30 }, () => ({ summary: { usable: true } })) }] };
  const profiles = labels.map((label, ordinal) => ({ label, ordinal, width: 1920, fixture: '60-sales', status: 'complete',
    sample: { usable: true }, dropped: 0, traceDataLoss: false, cpu: { samples: [1] },
    summary: { mainThread: {}, byType: {} }, metrics: { ScriptDuration: 0.01, RecalcStyleDuration: 0.02, LayoutDuration: 0 } }));
  const background = labels.map((label, ordinal) => {
    const before = { variant, calls: 0, rootWrites: 0, backdropWrites: 0, fallbackWrites: 0, shellRestores: 0, lastValue: null };
    const after = { ...before, calls: 1, [variant === 'root' ? 'rootWrites' : 'backdropWrites']: 1,
      lastValue: '-4px', effectiveValue: '-4px', identityExceptY: true, translateY: -4 };
    return { label, ordinal, variant, before, after, writes: validateBackgroundSample(before, after), sample: { usable: true }, failure: null };
  });
  return { baseline, profiles, background };
}
for (const variant of ['root', 'backdrop']) test(`${variant} complete cohort validates`, () => {
  const { baseline, profiles, background } = cohort(variant);
  assert.equal(validateCohort(variant, baseline, profiles, background), profiles);
});
test('incomplete samples, lost traces, incorrect fixtures and unexercised scroll reject the comparison', () => {
  const changes = [c => c.profiles.pop(), c => c.profiles[0].ordinal = 1, c => c.profiles[0].traceDataLoss = true,
    c => c.profiles[0].metrics.RecalcStyleDuration = null, c => c.background[0].failure = 'failed',
    c => c.baseline.runs[0].splitValueReads = 0, c => c.baseline.source = 'wrong',
    c => c.baseline.runs[0].results[0].summary.usable = false,
    c => { const r = c.background[2]; r.after = { ...r.before }; r.writes = validateBackgroundSample(r.before, r.after); }];
  for (const change of changes) {
    const c = cohort(); change(c); assert.throws(() => validateCohort('backdrop', c.baseline, c.profiles, c.background));
  }
});
test('CI pins accepted driver, repaired recorder and unchanged Signal source', async () => {
  const workflow = await readFile(new URL('../.github/workflows/desktop-background.yml', import.meta.url), 'utf8');
  for (const sha of [SIGNAL_SHA, DRIVER_SHA, PROFILER_SHA]) assert.ok(workflow.includes(`ref: ${sha}`));
  assert.ok(workflow.includes('node --test .desktop-profiler/test/desktop-profile.test.mjs'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(!workflow.includes('continue-on-error'));
  const browser = await readFile(new URL('../scripts/desktop-background-browser.mjs', import.meta.url), 'utf8');
  assert.ok(!browser.includes('requestAnimationFrame('));
  assert.ok(!browser.includes('scrollY'));
});
test('recording configuration separates both browsers and orders from accepted profile paths', () => {
  assert.equal(backgroundConfig({ DESKTOP_BACKGROUND_VARIANT: 'root' }).directory, 'desktop-background-evidence/root');
  for (const browser of ['chromium', 'webkit']) for (const order of ['root-first', 'backdrop-first']) {
    assert.equal(backgroundConfig({ DESKTOP_BACKGROUND_VARIANT: 'backdrop', DESKTOP_BACKGROUND_RECORDING: 'unprofiled',
      FEEL_BROWSER: browser, DESKTOP_BACKGROUND_ORDER: order }).directory,
    `desktop-background-evidence/unprofiled/${browser}/${order}/backdrop`);
  }
  for (const change of [{ FEEL_BROWSER: 'webkit' }, { DESKTOP_BACKGROUND_ORDER: 'backdrop-first' },
    { DESKTOP_BACKGROUND_VARIANT: '../wrong' }, { DESKTOP_BACKGROUND_RECORDING: 'wrong' }]) {
    assert.throws(() => backgroundConfig({ DESKTOP_BACKGROUND_VARIANT: 'root', ...change }));
  }
});
function unprofiledCohort(browser = 'chromium') {
  const c = cohort();
  c.baseline.browser = browser;
  c.baseline.runs[0].results = Array.from({ length: 3 }, (_, cycle) => INTERACTIONS.map(label => ({ cycle,
    summary: { label, usable: true, status: 'complete', hidden: false, droppedEntries: 0, viewport: [1920, 1080],
      contentMs: 10, settledMs: 20, durationMs: 2200, frameCount: 100, frameMedianMs: 16.7,
      frameP95Ms: 20, frameMaxMs: 30, gapsOver34Ms: 0, longTaskOverlapMs: null, longFrames: null } }))).flat();
  for (const row of c.background) {
    row.recording = 'unprofiled';
    row.sample = c.baseline.runs[0].results[Math.floor(row.ordinal / 3) * 10 + INTERACTIONS.indexOf(row.label)].summary;
  }
  return c;
}
for (const browser of ['chromium', 'webkit']) test(`${browser} unprofiled cohort retains unknown API evidence and all 30 interactions`, () => {
  const c = unprofiledCohort(browser);
  const result = validateUnprofiled('backdrop', browser, c.baseline, c.background);
  assert.equal(result.length, 30); assert.equal(result[0].summary.longFrames, null);
});
test('unprofiled comparison rejects order, label, browser, viewport, lifecycle and recording drift', () => {
  const changes = [c => c.baseline.browser = 'webkit', c => c.baseline.runs[0].results.reverse(),
    c => c.baseline.runs[0].results[0].summary.viewport = [1440, 900],
    c => c.baseline.runs[0].results[0].summary.settledMs = null, c => c.background[0].recording = 'profile',
    c => c.background[0].sample = { ...c.background[0].sample, contentMs: 11 },
    c => c.background[0].after.effectiveValue = '', c => c.background.pop()];
  for (const change of changes) {
    const c = unprofiledCohort(); change(c);
    assert.throws(() => validateUnprofiled('backdrop', 'chromium', c.baseline, c.background));
  }
});
test('unprofiled report retains six raw timing values per label, not profiler counters', () => {
  const samples = unprofiledCohort().baseline.runs[0].results;
  const rows = summarizeUnprofiled([...samples, ...samples]);
  assert.equal(rows.length, 10); assert.equal(rows[0].samples, 6);
  assert.deepEqual(rows[0].contentMs.values, [10, 10, 10, 10, 10, 10]);
  assert.equal(rows[0].contentMs.median, 10); assert.equal(rows[0].RecalcStyleDuration, undefined);
  assert.throws(() => summarizeUnprofiled(samples));
});
test('unprofiled session never opens CDP and retains background parity evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'background-no-cdp-'));
  const source = `
    import assert from 'node:assert/strict';
    import { fileURLToPath } from 'node:url';
    // Model a real CLI entry waiting on its dynamically imported driver hook.
    // The hook must not import and auto-start that entry again.
    process.argv[1] = fileURLToPath(${JSON.stringify(new URL('../scripts/desktop-background.mjs', import.meta.url).href)});
    const { attachDesktopProfile } = await import(${JSON.stringify(new URL('../scripts/desktop-background-session.mjs', import.meta.url).href)});
    const before = {variant:'backdrop',calls:0,rootWrites:0,backdropWrites:0,fallbackWrites:0,shellRestores:0,lastValue:null};
    const after = {...before,calls:1,backdropWrites:1,lastValue:'-4px',effectiveValue:'-4px',translateY:-4,identityExceptY:true};
    let reads = 0, installed = false;
    const page = {addInitScript(){installed=true;},evaluate(){return reads++ ? after : before;}};
    const context = {newCDPSession(){throw new Error('CDP must not open');}};
    const session = await attachDesktopProfile(context,page,{width:1920,fixture:'60-sales'});
    await session.begin('list-scroll'); await session.finish({}, {usable:true}); await session.dispose();
    assert.equal(installed,true); assert.equal(reads,2);
  `;
  try {
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', source], {
      cwd: directory, encoding: 'utf8', timeout: 5000, env: { ...process.env, DESKTOP_BACKGROUND_VARIANT: 'backdrop',
        DESKTOP_BACKGROUND_RECORDING: 'unprofiled', FEEL_BROWSER: 'webkit', DESKTOP_BACKGROUND_ORDER: 'backdrop-first' } });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const rows = JSON.parse(await readFile(path.join(directory, 'desktop-background-evidence/unprofiled/webkit/backdrop-first/backdrop/background.json')));
    assert.equal(rows[0].recording, 'unprofiled'); assert.equal(rows[0].writes.calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

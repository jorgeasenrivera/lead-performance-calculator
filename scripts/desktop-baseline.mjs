import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch } from './probe-kit.mjs';
import { summarizeSample } from './desktop-baseline-metrics.mjs';
import { startIsolatedMock } from './desktop-baseline-mock.mjs';

export const SIGNAL_SOURCE = '7fdf5aeac8499d1a25a10e7b57ae8259dfb759d5';
const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
export function denseFixture(value, count = 60) {
  const next = structuredClone(value), sales = next.roster.filter(p => p.roleId === 'sales');
  assert.ok(sales.length, 'stress fixture requires sales associates');
  assert.ok(Number.isInteger(count) && count >= sales.length && count <= 500, 'bounded stress roster');
  const clones = Array.from({ length: count - sales.length }, (_, i) => {
    const name = `Fictional Associate ${String(i + sales.length + 1).padStart(2, '0')}`;
    return { ...sales[i % sales.length], id: `desktop-fiction-${i}`, name, label: name };
  });
  // Keep the original room identities and non-sales metrics. Extra board rows
  // stress rendering without turning the rooms' seeded people into strangers.
  next.roster.push(...clones);
  for (const month of Object.values(next.months || {})) {
    const original = month.stats || {};
    month.stats = { ...original, ...Object.fromEntries(clones.map((p, i) => [norm(p.name), structuredClone(original[norm(sales[i % sales.length].name)] || {})])) };
  }
  for (const day of Object.keys(next.activity || {})) {
    const original = next.activity[day];
    next.activity[day] = { ...original, ...Object.fromEntries(clones.map((p, i) => [norm(p.name), structuredClone(original[norm(sales[i % sales.length].name)] || {})])) };
  }
  return next;
}

export async function runDesktopBaseline() {
  const url = process.env.DESKTOP_URL || 'http://127.0.0.1:49218/';
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1', 'baseline must use local fictional data');
  assert.equal(process.env.DESKTOP_SOURCE_SHA, SIGNAL_SOURCE, 'pin the actual reviewed production Signal source');
  const browser = await launch(), output = { source: SIGNAL_SOURCE, browser: process.env.FEEL_BROWSER || 'chromium',
    mode: 'production build, normal motion, no CPU or network throttle', runs: [] };
  await mkdir('desktop-baseline-evidence', { recursive: true });
  let page, stage = 'launch';
  try {
    for (const width of [1440, 1920]) for (const fixture of ['demo', '60-sales']) {
      stage = `${width}/${fixture} isolated mock`;
      const mock = await startIsolatedMock();
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 1080 },
        reducedMotion: 'no-preference', serviceWorkers: 'block' }).catch(async error => { await mock.stop(); throw error; });
      const errors = []; let fixtureReads = 0;
      try {
        const seedRows = await (await fetch(mock.origin + '/rest/v1/app_data?key=eq.lpc:store:sage-demo:v2',
          { signal: AbortSignal.timeout(1000) })).json();
        const seedCount = seedRows[0]?.value?.roster?.length;
        assert.ok(seedCount > 0 && seedCount < 60, 'every context must start from a fresh normal roster');
        // Every request is bounded to the two local services. A misbuilt app
        // cannot send a demo login, telemetry or data read to a real service.
        await context.route('**/*', async route => {
          const u = new URL(route.request().url());
          if (![target.origin, 'http://127.0.0.1:5433'].includes(u.origin)) { await route.abort(); return; }
          if (u.origin === 'http://127.0.0.1:5433') {
            const response = await route.fetch({ url: mock.origin + u.pathname + u.search });
            if (fixture !== '60-sales' || u.pathname !== '/rest/v1/app_data' || route.request().method() !== 'GET') {
              await route.fulfill({ response }); return;
            }
            const rows = await response.json();
            const patch = r => {
              if (r.key === 'lpc:store:sage-demo:v2') { fixtureReads++; return { ...r, value: denseFixture(r.value) }; }
              return r;
            };
            await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(patch) : patch(rows) }); return;
          }
          await route.continue();
        });
        page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        stage = `${width}/${fixture} sign in`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.locator('input[type="email"], input[autocomplete="username"]').fill('demo@sageonline.app');
        await page.locator('input[type="password"]').fill('x');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.locator('.assoc-card .assoc-name').first().waitFor({ state: 'visible', timeout: 40000 });
        await page.getByRole('button', { name: 'Close the round-up', exact: true }).click();
        await page.getByRole('dialog', { name: 'Your round-up', exact: true }).waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.documentElement.matches('.jump-under,.refresh-hold,.tool-move,.tab-move'));
        await page.evaluate(() => document.fonts.ready);
        const rowCount = await page.locator('.assoc-card').count();
        if (fixture === '60-sales') { assert.ok(fixtureReads > 0); assert.ok(rowCount >= 60, 'dense fixture must actually reach the board'); }
        const measure = async (label, selector, action, absent = false, eventType = 'click', targetSelector = 'button') => {
          stage = `${width}/${fixture}/${label}`;
          const before = await page.evaluate(([label, selector, absent, eventType, targetSelector]) => {
            if (eventType) window.__desktopProbe.arm(label, selector, { absent, windowMs: 2200 }, eventType, targetSelector);
            return window.__desktopProbe.samples.length;
          }, [label, selector, absent, eventType, targetSelector]);
          await action();
          await page.waitForFunction(n => window.__desktopProbe.samples.length > n, before, { timeout: 12000 });
          const raw = await page.evaluate(() => window.__desktopProbe.samples.at(-1));
          const summary = summarizeSample(raw); assert.ok(summary.usable, `${label} is not usable evidence`);
          assert.notEqual(summary.settledMs, null, `${label} must finish its transition within the sample`);
          return { summary, raw };
        };
        const button = name => page.getByRole('button', { name, exact: true });
        const results = [];
        output.runs.push({ width, fixture, seedCount, rowCount, fixtureReads, results, errors, complete: false });
        for (let cycle = 0; cycle < 3; cycle++) {
          for (const [name, marker] of [['Daily Activity', '.da-page'], ['Live Floor', '.mf-floor .fbc'],
            ['Phone Line', '.mf-line .sd-room'], ['Performance', '.board-page'], ['Summary', '.sm-page'], ['Dashboard', '.board-page']]) {
            results.push({ cycle, ...await measure(name, marker, () => button(name).click()) });
          }
          results.push({ cycle, ...await measure('associate-open', '.acard', () => page.locator('.assoc-row .assoc-name').first().click(), false, 'click', '.assoc-row') });
          results.push({ cycle, ...await measure('associate-close', '.acard', () => page.locator('.ac-x').click(), true) });
          results.push({ cycle, ...await measure('schedule-hover', '.sg-schedule-details', () => page.locator('.sg-schedule-trigger').hover(), false, 'pointerover', '.sg-schedule') });
          stage = `${width}/${fixture}/leave-schedule`;
          // No need to auto-scroll to a distant row just to exit a hover. On a
          // dense board that cleanup can fight the sticky header in WebKit.
          await page.mouse.move(2, (width === 1440 ? 900 : 1080) - 5);
          results.push({ cycle, ...await measure('list-scroll', '.board-page', () => page.evaluate(() => new Promise(resolve => {
            window.__desktopProbe.start('list-scroll', '.board-page', { windowMs: 2200 });
            const start = performance.now(), max = document.documentElement.scrollHeight - innerHeight;
            const move = t => { const p = Math.min(1, (t - start) / 800); scrollTo(0, max * p); if (p < 1) requestAnimationFrame(move); else resolve(); };
            requestAnimationFrame(move);
          })), false, null) });
          await page.evaluate(() => scrollTo(0, 0));
        }
        assert.deepEqual(errors, []);
        output.runs.at(-1).complete = true;
        await page.screenshot({ path: `desktop-baseline-evidence/${width}-${fixture}.png` });
      } catch (error) {
        // This must happen while the failed page still exists. The outer catch
        // runs after this context's finally, when screenshots are already lost.
        output.failureEvidence = {
          stage, mockLog: mock.log(), errors,
          probe: page && !page.isClosed() ? await page.evaluate(() => ({
            samples: window.__desktopProbe?.samples || [], active: window.__desktopProbe?.getActive(),
          })).catch(() => null) : null,
        };
        if (page && !page.isClosed()) await page.screenshot({ path: 'desktop-baseline-evidence/failure.png' }).catch(() => {});
        throw error;
      } finally { try { await context.close(); } finally { await mock.stop(); } }
    }
    console.log(JSON.stringify(output.runs.map(r => ({ width: r.width, fixture: r.fixture, rowCount: r.rowCount,
      samples: r.results.map(s => s.summary) })), null, 2));
  } catch (error) {
    output.failure = { stage, message: error.message };
    if (page && !page.isClosed()) await page.screenshot({ path: 'desktop-baseline-evidence/failure.png' }).catch(() => {});
    throw error;
  } finally {
    await writeFile('desktop-baseline-evidence/results.json', JSON.stringify(output, null, 2));
    await browser.close();
  }
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/desktop-baseline.mjs')) await runDesktopBaseline();

import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const PROPOSAL_URL = process.env.CALENDAR_PROPOSAL_URL || 'http://127.0.0.1:49217/';
const widths = [390, 700, 701, 1280];
const pausePaint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const closeRecap = async (page) => {
  const close = page.getByRole('button', { name: 'Close the round-up', exact: true });
  if (await close.isVisible()) await close.click();
};
const monthly = (page, width) => page.locator(width <= 700 ? '.bp-num .dotnum' : '.s2-big .dotnum').first().getAttribute('aria-label');
const detail = (page, width) => page.locator(width <= 700 ? '.fr-pop .rd-detail' : '.sg-schedule-month .rd-detail');
async function openCalendar(page, width) {
  await closeRecap(page);
  if (width <= 700) {
    if (!(await page.locator('.fr-pop').isVisible())) await page.locator('.bp-l2').click();
    await page.getByRole('dialog', { name: 'Reported deliveries', exact: true }).waitFor({ state: 'visible' });
  } else {
    await page.locator('.sg-schedule-trigger').focus();
    await page.locator('.sg-schedule-details').waitFor({ state: 'visible' });
  }
}
async function selectDay(page, width, date) {
  await page.locator(width <= 700 ? `.fr-pop [data-report-date="${date}"]` : `[data-mini-date="${date}"]`).click();
  assert.equal(await detail(page, width).getAttribute('data-reported-detail'), date);
}
async function expectCount(page, width, value) {
  await page.waitForFunction(({ phone, value }) => {
    const el = document.querySelector(phone ? '.fr-pop .rd-detail [data-report-count]' : '.sg-schedule-month .rd-detail [data-report-count]');
    return el?.textContent === String(value);
  }, { phone: width <= 700, value });
}
async function assertDetailVisible(page, width) {
  const boxes = await detail(page, width).evaluate((element) => {
    const panel = element.closest('.sg-schedule-details,.fr-sheet');
    const r = element.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, panelTop: p.top, panelBottom: p.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(boxes.top >= Math.max(0, boxes.panelTop) - 1 && boxes.bottom <= Math.min(boxes.height, boxes.panelBottom) + 1,
    `Selected report detail must be inside both the popup and viewport: ${JSON.stringify(boxes)}`);
  assert.ok(boxes.left >= 0 && boxes.right <= boxes.width, 'Selected report detail must not overflow horizontally');
}
async function newPending(page, action) {
  const before = await page.evaluate(() => __calendarFixture.transport.requests.length);
  await action();
  await page.waitForFunction((before) => __calendarFixture.transport.requests.length > before, before);
  return page.evaluate(() => __calendarFixture.transport.requests.at(-1).id);
}
async function settle(page, id, payload) { await page.evaluate(({ id, payload }) => __calendarFixture.settle(id, payload), { id, payload }); await pausePaint(page); }

export async function verifyCalendarProposal(browser, engine = 'chromium') {
  assert.equal(new globalThis.URL(PROPOSAL_URL).hostname, '127.0.0.1', 'Capture is limited to the local fixture');
  const out = path.join(root, 'evidence', engine); await mkdir(out, { recursive: true });
  const source = JSON.parse(await readFile(path.join(root, 'source-contract.json'), 'utf8'));
  const result = { engine, sourceCommit: source.sourceCommit, managerSha256: source.files['src/Manager.jsx'], screens: [], races: [], browserErrors: [], unexpectedRequests: [], status: 'running' };
  let active;
  const start = async (width, options = {}) => {
    const context = await browser.newContext({ viewport: { width, height: width <= 700 ? 1000 : 1100 }, timezoneId: 'America/Los_Angeles',
      reducedMotion: 'reduce', serviceWorkers: 'block', ...options });
    await context.route('**/*', async (route) => {
      const request = route.request(), target = new globalThis.URL(request.url());
      if (target.origin === new globalThis.URL(PROPOSAL_URL).origin && request.method() === 'GET') return route.continue();
      result.unexpectedRequests.push({ method: request.method(), origin: target.origin, path: target.pathname });
      return route.abort();
    });
    const page = await context.newPage();
    active = { context, page, width };
    page.on('pageerror', (error) => result.browserErrors.push(error.message));
    await page.goto(PROPOSAL_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__calendarFixture);
    await page.waitForFunction(() => document.documentElement.classList.contains('manager-signal'));
    await page.locator(width <= 700 ? '.bp-num .dotnum' : '.s2-big .dotnum').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await closeRecap(page);
    return active = { context, page, width };
  };
  const capture = async (page, width, state) => {
    const name = `${width}-${state}.png`;
    await page.screenshot({ path: path.join(out, name), animations: 'disabled', fullPage: false });
    result.screens.push({ width, state, file: name, fixture: await page.evaluate(() => __calendarFixture.snapshot()) });
  };
  try {
    for (const width of widths) {
      const { context, page } = await start(width);
      await openCalendar(page, width);
      await selectDay(page, width, '2026-09-18'); await expectCount(page, width, 7);
      await assertDetailVisible(page, width);
      assert.match(await detail(page, width).innerText(), /Provisional/);
      assert.match(await detail(page, width).innerText(), /6:00 PM EDT/);
      assert.equal(await monthly(page, width), '61');
      await capture(page, width, 'positive');
      for (const [date, label, count] of [['2026-09-19','zero',0], ['2026-09-20','split-unavailable',5], ['2026-09-21','receipt-only',3]]) {
        await selectDay(page, width, date); await expectCount(page, width, count);
        await assertDetailVisible(page, width);
        const text = await detail(page, width).innerText();
        if (label === 'split-unavailable') assert.match(text, /breakdown unavailable/);
        if (label === 'receipt-only') { assert.match(text, /Report received/); assert.doesNotMatch(text, /Report sent/); }
        await capture(page, width, label);
      }
      for (const [date, label] of [['2026-09-17','missing'], ['2026-09-16','held'], ['2026-09-15','conflict']]) {
        await selectDay(page, width, date); assert.equal(await detail(page, width).locator('[data-report-count]').count(), 0);
        assert.match(await detail(page, width).innerText(), /No report available/); await capture(page, width, label);
      }
      await page.evaluate(() => __calendarFixture.setScenario('loading')); await pausePaint(page);
      assert.equal(await detail(page, width).locator('[data-report-count]').count(), 0); await capture(page, width, 'loading');
      await page.evaluate(() => __calendarFixture.setScenario('503'));
      await detail(page, width).getByRole('button', { name: 'Try again', exact: true }).waitFor();
      await capture(page, width, 'request-error');
      await page.evaluate(() => __calendarFixture.setNextResponse('normal'));
      await detail(page, width).getByRole('button', { name: 'Try again', exact: true }).click();
      await selectDay(page, width, '2026-09-18'); await expectCount(page, width, 7);
      await capture(page, width, 'retry-recovered');
      assert.equal(await monthly(page, width), '61');
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /Best day so far|New sold yesterday|Used sold yesterday|synthetic_private_diagnostic/);
      assert.equal(await page.locator('.ru2-chart,.bp-lg svg,.bp-up,.bp-down,.s2-hd').count(), 0);
      // Keyboard dismissal uses the actual phone popup or actual Signal schedule.
      await page.keyboard.press('Escape');
      await page.locator(width <= 700 ? '.fr-pop' : '.sg-schedule-details').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate((phone) => phone
        ? document.activeElement === document.querySelector('.bp-l2')
        : document.querySelector('.sg-schedule')?.contains(document.activeElement), width <= 700), true,
      'Dismissal must leave keyboard focus on the opener or retained schedule control');
      if (width > 700) {
        await page.locator('.s2-splitwrap').focus();
        const stock = page.locator('.s2-salewin.port');
        await stock.waitFor({ state: 'visible' });
        await stock.locator('[data-report-date="2026-09-19"]').click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.s2-salewin.port')).opacity === '1');
        assert.equal(await stock.locator('[data-report-count]').innerText(), '0');
        await capture(page, width, 'stock-popup-zero');
        await page.locator('.sg-schedule-trigger').focus();
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(await page.evaluate(() => __blockedFixtureRequests), []);
      await context.close();
    }

    // Run adversarial response orders on both real layouts, without relying on abort.
    for (const width of [390, 1280]) {
      const { context, page } = await start(width); await openCalendar(page, width); await selectDay(page, width, '2026-09-18');
      const oldA = await newPending(page, () => page.evaluate(() => __calendarFixture.setScenario('manual')));
      const newB = await newPending(page, () => page.evaluate(() => __calendarFixture.setStore('fictional-b')));
      assert.equal(await detail(page, width).locator('[data-report-count]').count(), 0);
      await settle(page, newB, 'beta-september'); await expectCount(page, width, 11);
      await settle(page, oldA, 'alpha-september'); await expectCount(page, width, 11);
      assert.equal(await monthly(page, width), '83'); await capture(page, width, 'store-race-beta');
      result.races.push({ width, kind: 'store', passed: true });

      const september = await newPending(page, () => page.evaluate(() => __calendarFixture.setStore('fictional-a')));
      const october = await newPending(page, () => page.evaluate(() => __calendarFixture.setMonth('2026-10')));
      await settle(page, october, 'alpha-october'); await settle(page, september, 'alpha-september');
      assert.equal(await detail(page, width).locator('[data-report-count]').count(), 0);
      assert.match(await detail(page, width).getAttribute('data-reported-detail'), /^2026-10-/);
      await capture(page, width, 'month-race-october'); result.races.push({ width, kind: 'month', passed: true });

      await newPending(page, () => page.evaluate(() => __calendarFixture.setMonth('2026-09')));
      const oldGeneration = await newPending(page, () => page.evaluate(() => __calendarFixture.reload()));
      let latest;
      if (width <= 700) {
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        latest = await newPending(page, () => page.locator('.bp-l2').click());
      } else {
        await page.evaluate(() => __calendarFixture.setMounted(false));
        latest = await newPending(page, () => page.evaluate(() => __calendarFixture.setMounted(true)));
        await openCalendar(page, width);
      }
      await settle(page, latest, 'alpha-september-corrected'); await selectDay(page, width, '2026-09-18'); await expectCount(page, width, 6);
      await settle(page, oldGeneration, 'alpha-september'); await expectCount(page, width, 6);
      await capture(page, width, 'same-identity-generation'); result.races.push({ width, kind: width <= 700 ? 'close-reopen' : 'unmount-remount', passed: true });
      await context.close();
    }

    for (const width of [390, 1280]) {
      const { context, page } = await start(width);
      await openCalendar(page, width); await selectDay(page, width, '2026-09-18'); await expectCount(page, width, 7);
      // Source styles contain px values, so a root rem change would not test large text.
      await page.evaluate(() => {
        const text = [...document.querySelectorAll('.fixture-root *, .fr-pop *, .sg-schedule-details *')]
          .filter((el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
        const sizes = text.map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
        for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`;
      });
      await capture(page, width, 'large-text-reduced-motion');
      await detail(page, width).scrollIntoViewIfNeeded();
      await assertDetailVisible(page, width);
      await capture(page, width, 'large-text-detail');
      await page.keyboard.press('Escape');
      await page.locator(width <= 700 ? '.fr-pop' : '.sg-schedule-details').waitFor({ state: 'hidden' });
      await context.close();
    }
    assert.deepEqual(result.browserErrors, []); assert.deepEqual(result.unexpectedRequests, []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    console.error('Calendar capture failure:', JSON.stringify({ error: result.error, browserErrors: result.browserErrors,
      screen: active?.page && !active.page.isClosed() ? await active.page.locator('body').innerText().catch(() => '') : null,
      fixture: active?.page && !active.page.isClosed() ? await active.page.evaluate(() => window.__calendarFixture?.snapshot()).catch(() => null) : null }));
    if (active?.page && !active.page.isClosed()) await active.page.screenshot({ path: path.join(out, 'failure.png'), animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    if (active) await active.context.close().catch(() => {});
    await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const engine = process.env.FEEL_BROWSER || 'chromium';
  const module = process.env.FEEL_PLAYWRIGHT ? pathToFileURL(path.join(process.env.FEEL_PLAYWRIGHT, 'index.mjs')).href : 'playwright';
  const playwright = await import(module);
  const browser = await playwright[engine].launch({ headless: true,
    ...(engine === 'chromium' && process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try { const result = await verifyCalendarProposal(browser, engine); console.log(`${engine}: ${result.screens.length} actual-component screenshots, ${result.races.length} race checks passed`); }
  finally { await browser.close(); }
}

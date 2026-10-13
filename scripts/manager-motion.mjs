import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const url = process.env.FEEL_URL || 'http://127.0.0.1:5178/';
assert.equal(new URL(url).hostname, '127.0.0.1');
const engine = process.env.FEEL_BROWSER || 'chromium';
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 667 },
  isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
const evidence = { engine, cases: [], spacing: [] };
await mkdir('manager-motion', { recursive: true });
await context.route('http://127.0.0.1:5433/rest/v1/profiles?**', async route => {
  const response = await route.fetch();
  const body = await response.json();
  const manager = p => ({ ...p, role: 'manager', wants: 'manager', onboarded: true });
  await route.fulfill({ response, json: Array.isArray(body) ? body.map(manager) : manager(body) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(url);
  await page.locator('input[type="email"],input[autocomplete="username"]').fill('demo@sageonline.app');
  await page.locator('input[type="password"]').fill('x');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.bp-row').first().waitFor({ timeout: 40000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.managerLandingSamples = [];
    const start = performance.now();
    function sample() {
      if (document.documentElement.matches('.manager-signal.sage-assemble')) {
        for (const node of document.querySelectorAll('.sa-radial')) {
          const style = getComputedStyle(node);
          window.managerLandingSamples.push({ transform: style.transform,
            duration: style.animationDuration, delay: style.animationDelay });
        }
      }
      if (performance.now() - start < 20000) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.reload();
  await page.locator('.bp-row').first().waitFor({ timeout: 40000 });
  await page.waitForFunction(() => window.managerLandingSamples.length > 0);
  await page.waitForFunction(() => !document.documentElement.matches('.sage-assemble,.refresh-hold'));
  const landing = await page.evaluate(() => window.managerLandingSamples);
  assert.ok(landing.every(s => s.transform === 'none'), 'reload cards stay in place');
  assert.ok(landing.every(s => s.duration.split(',').every(v => parseFloat(v) <= .18)), 'landing bounded to 180ms');
  assert.ok(landing.every(s => s.delay.split(',').every(v => parseFloat(v) === 0)), 'no stagger');
  evidence.cases.push({ name: 'saved-session landing', frames: landing.length });

  async function inspectMenu(selector, name, reduced) {
    const result = await page.locator(selector).evaluate(el => {
      const animations = el.getAnimations().filter(a => a.effect?.target === el);
      const samples = [];
      for (const animation of animations) {
        animation.pause();
        for (const time of [0, 45, 90, 179]) {
          animation.currentTime = time;
          const s = getComputedStyle(el);
          const icon = el.querySelector('svg');
          const r = icon?.getBoundingClientRect();
          samples.push({ time, transform: s.transform, opacity: s.opacity,
            icon: r ? { x: r.x, y: r.y } : null });
        }
        animation.finish();
      }
      return { samples, duration: getComputedStyle(el).animationDuration,
        animation: getComputedStyle(el).animationName };
    });
    if (reduced) assert.equal(result.animation, 'none', `${name}: reduced motion`);
    else {
      assert.ok(result.samples.length, `${name}: real entrance sampled`);
      assert.ok(result.samples.every(s => s.transform === 'none'), `${name}: no travel or scale`);
      const icons = result.samples.map(s => s.icon).filter(Boolean);
      assert.ok(icons.every(r => Math.abs(r.x-icons[0].x) < .5 && Math.abs(r.y-icons[0].y) < .5), `${name}: icon holds position`);
    }
    evidence.cases.push({ name, reduced, ...result });
    await page.screenshot({ path: `manager-motion/${name}-${reduced ? 'reduce' : 'normal'}.png` });
  }
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const more = page.locator('.botnav').getByRole('button', { name: 'More', exact: true });
    await more.focus();
    await page.keyboard.press('Enter');
    await page.locator('.drawer-root.open').waitFor();
    await inspectMenu('.drawer', 'drawer', reduced);
    await page.keyboard.press('Escape');
    await page.locator('.drawer-root.open').waitFor({ state: 'hidden' });
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Escape releases scroll lock');
    for (let i = 0; i < 3; i++) {
      await more.dispatchEvent('click');
      await page.getByRole('button', { name: 'Close menu', exact: true }).dispatchEvent('click');
    }
    assert.equal(await page.locator('.drawer-root.open').count(), 0, 'interrupted drawer stays closed');
    const picker = page.locator('.botnav button[aria-haspopup]');
    assert.equal(await picker.count(), 1, 'fictional fixture exposes queue menu');
    await picker.focus();
    await page.keyboard.press('Enter');
    await page.locator('.qpick').waitFor();
    await inspectMenu('.qpick', 'queue', reduced);
    await picker.dispatchEvent('click');
    for (let i = 0; i < 3; i++) {
      await picker.dispatchEvent('click');
      await picker.dispatchEvent('click');
    }
    assert.equal(await page.locator('.qpick').count(), 0, 'interrupted picker stays closed');
    await page.locator('.brand-btn').click();
    await page.locator('.brand-menu').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.brand-menu').waitFor({ state: 'hidden' });
    evidence.cases.push({ name: 'keyboard, repeated open/close and interrupted menus', reduced });
  }
  // Diagnostic screenshots only. These do not assert that the reported spacing
  // is fixed, and contain exclusively the repository's fictional mock data.
  for (const width of [320, 360, 375, 390, 393, 414, 430, 700, 760, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 667 });
    await page.screenshot({ path: `manager-motion/spacing-${width}.png`, fullPage: true });
    evidence.spacing.push(await page.evaluate(() => ({ width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      filters: [...document.querySelectorAll('.bp-filt button')].map(n => {
        const r = n.getBoundingClientRect(); return { text: n.textContent, x: r.x, y: r.y, width: r.width, height: r.height };
      }) })));
  }
  assert.deepEqual(errors, [], 'no uncaught errors');
  console.log(JSON.stringify(evidence));
} finally {
  await writeFile('manager-motion/evidence.json', JSON.stringify({ ...evidence, errors }, null, 2));
  await page.screenshot({ path: 'manager-motion/final.png' }).catch(() => {});
  await context.close();
  await browser.close();
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { _android } = await import(pathToFileURL(process.env.ANDROID_PLAYWRIGHT));
const out = 'android-webview-evidence';
await mkdir(out, { recursive: true });
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 15000 }).trim();
const report = { evidence: 'Android emulator, not a physical device', scenarios: [], passed: false };
let device, page, stage = 'attach';
async function until(check, label) {
  for (let n = 0; n < 40; n++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
async function keyboard(shown) {
  await until(() => {
    const dump = adb('shell', 'dumpsys', 'input_method');
    // Fail closed if the selected Android image changes this diagnostic.
    assert.match(dump, /mInputShown=(true|false)/, 'recognized native IME evidence required');
    return dump.includes(`mInputShown=${shown}`);
  }, `native keyboard ${shown ? 'open' : 'closed'}`);
}
async function capture(name, scenario) {
  await device.screenshot({ path: `${out}/${name}.png` });
  const geometry = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const rect = selector => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom,
        font: getComputedStyle(el).fontSize };
    };
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      viewport: { height: visualViewport.height, top: visualViewport.offsetTop },
      insets: Object.fromEntries(['top', 'bottom', 'left', 'right'].map(k => [k, style.getPropertyValue(`--shell-inset-${k}`).trim()])),
      search: rect('.search-input'), done: rect('.assoc-search-done'), trigger: rect('.assoc-search-trigger'),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  scenario.states.push({ name, geometry });
  assert.ok(geometry.overflow <= 1, 'no horizontal document overflow');
  const top = parseFloat(geometry.insets.top), bottom = parseFloat(geometry.insets.bottom);
  assert.ok(Number.isFinite(top) && top > 0 && Number.isFinite(bottom) && bottom > 0,
    'real shell must inject status and navigation insets');
  return geometry;
}
function accessibleControl(box, geometry) {
  assert.ok(box && box.width > 0 && box.height > 0, 'control has area');
  assert.ok(box.x >= 0 && box.x + box.width <= geometry.width + 1, 'control fits width');
  assert.ok(box.y >= parseFloat(geometry.insets.top) - 1, 'control below native status inset');
  assert.ok(box.bottom <= geometry.viewport.top + geometry.viewport.height - 1, 'control above keyboard or native bottom');
}
try {
  const devices = await _android.devices();
  assert.equal(devices.length, 1, 'one isolated emulator required');
  [device] = devices;
  assert.match(device.serial(), /^emulator-/);
  device.setDefaultTimeout(15000);
  report.provider = adb('shell', 'dumpsys', 'webviewupdate');
  assert.match(report.provider, /Current WebView package/);
  report.android = adb('shell', 'getprop', 'ro.build.version.release');
  // Physical display overrides exercise Android configuration changes, not
  // desktop-browser viewport emulation. 2x density gives 320 and 390 dp.
  for (const [width, scale] of [[320, 1], [390, 1], [320, 1.3], [390, 1.3]]) {
    const scenario = { width, scale, states: [], passed: false };
    report.scenarios.push(scenario);
    stage = `${width}dp font ${scale}: launch`;
    adb('shell', 'am', 'force-stop', 'com.sageonline');
    adb('shell', 'wm', 'size', `${width * 2}x1688`);
    adb('shell', 'wm', 'density', '320');
    adb('shell', 'settings', 'put', 'system', 'font_scale', String(scale));
    assert.equal(Number(adb('shell', 'settings', 'get', 'system', 'font_scale')), scale);
    adb('shell', 'am', 'start', '-n', 'com.sageonline/.MainActivity');
    // The unchanged shell asks for location on first launch. Decline it as a
    // user would; never grant permissions or alter the manifest for this test.
    try {
      await device.tap({ res: 'com.android.permissioncontroller:id/permission_deny_button' }, { timeout: 3000 });
      scenario.locationPrompt = 'declined';
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      scenario.locationPrompt = 'not shown within 3 seconds';
    }
    page = await (await device.webView({ pkg: 'com.sageonline' })).page();
    page.setDefaultTimeout(15000);
    await page.waitForURL('http://127.0.0.1:5179/**', { timeout: 60000 });
    await page.context().route('**/*', route => {
      const u = new URL(route.request().url());
      return u.hostname === '127.0.0.1' && ['5179', '5433'].includes(u.port) ? route.continue() : route.abort();
    });
    await page.locator('input[type="email"], .bp-row .bp-nmx').first().waitFor({ state: 'visible', timeout: 40000 });
    if (await page.locator('input[type="email"]').isVisible()) {
      await page.locator('input[type="email"]').fill('demo@sageonline.app');
      await page.locator('input[type="password"]').fill('fictional');
      await page.getByRole('button', { name: 'Sign in', exact: true }).tap();
    }
    const names = page.locator('.bp-row .bp-nmx');
    await names.first().waitFor({ state: 'visible', timeout: 40000 });
    const baseline = await names.allTextContents();
    assert.ok(baseline.length > 1);
    const field = page.getByPlaceholder('Search associates', { exact: true });
    const trigger = page.locator('.assoc-search-trigger');
    stage = `${width}dp font ${scale}: open keyboard`;
    await trigger.tap();
    await field.tap();
    await keyboard(true);
    let g = await capture(`${width}-${scale}-keyboard`, scenario);
    assert.equal(g.width, width, 'Android CSS width matches the scenario');
    accessibleControl(g.search, g); accessibleControl(g.done, g);
    stage = `${width}dp font ${scale}: type and Clear`;
    // Real Android input events, not DOM value assignment, exercise typing.
    adb('shell', 'input', 'text', 'Dev');
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.bp-row .bp-nmx')];
      return rows.length === 1 && rows[0].textContent.includes('Dev');
    });
    assert.equal(await field.inputValue(), 'Dev');
    await capture(`${width}-${scale}-typed`, scenario);
    await page.locator('.search-top .search-clear').tap();
    await page.waitForFunction(count => document.querySelectorAll('.bp-row .bp-nmx').length === count, baseline.length);
    assert.equal(await field.inputValue(), '');
    assert.deepEqual(await names.allTextContents(), baseline);
    // Clear may blur on a platform. Refocus explicitly before the next text.
    await field.tap(); await keyboard(true);
    adb('shell', 'input', 'text', 'Dev');
    await until(async () => await field.inputValue() === 'Dev', 'second query');
    stage = `${width}dp font ${scale}: Done and reopen`;
    await page.locator('.assoc-search-done').tap();
    await field.waitFor({ state: 'hidden' });
    await keyboard(false);
    g = await capture(`${width}-${scale}-done`, scenario);
    accessibleControl(g.trigger, g);
    assert.ok(g.trigger.bottom <= g.height - parseFloat(g.insets.bottom), 'closed search avoids navigation inset');
    await trigger.tap(); await field.tap(); await keyboard(true);
    assert.equal(await field.inputValue(), 'Dev', 'Done retains query on reopening');
    await capture(`${width}-${scale}-reopened`, scenario);
    // Native Back dismisses the IME without substituting a scripted blur.
    adb('shell', 'input', 'keyevent', '4');
    await keyboard(false);
    await capture(`${width}-${scale}-back`, scenario);
    await page.locator('.search-top .search-clear').tap();
    await page.locator('.assoc-search-done').tap();
    await keyboard(false);
    scenario.passed = true;
  }
  report.passed = true;
} catch (error) {
  report.failure = { stage, message: error.message };
  if (device) await device.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/result.json`, JSON.stringify(report, null, 2));
  if (device) {
    adb('shell', 'settings', 'put', 'system', 'font_scale', '1');
    adb('shell', 'wm', 'size', 'reset');
    adb('shell', 'wm', 'density', 'reset');
    await device.close();
  }
}

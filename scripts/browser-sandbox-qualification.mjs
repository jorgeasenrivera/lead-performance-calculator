// This qualifies only the hosted VM and browser, never the Sage application.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = 'sandbox-qualification-evidence';
const evidence = { head: process.env.QUALIFICATION_HEAD_SHA, qualified: false };
let server;
await mkdir(output, { recursive: true });
const deadline = setTimeout(() => {
  console.error('Qualification exceeded its 90 second limit.');
  process.exit(1);
}, 90_000);

function rejectBypass(argv) {
  assert(!argv.some(arg => /^--(?:no-sandbox|disable-.*sandbox|disable-seccomp-filter-sandbox|single-process|no-zygote)(?:=|$)/.test(arg)), 'Sandbox bypass argument present');
}

async function processEvidence(pid) {
  const status = await readFile(`/proc/${pid}/status`, 'utf8');
  const fields = Object.fromEntries(status.trim().split('\n').map(line => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
  const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  rejectBypass(argv);
  return { pid, argv, NoNewPrivs: fields.NoNewPrivs, Seccomp: fields.Seccomp,
    CapEff: fields.CapEff, NSpid: fields.NSpid?.split(/\s+/) };
}

try {
  assert.equal(process.platform, 'linux');
  assert.notEqual(process.getuid(), 0, 'Root is not a qualification host');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run only on the authorized hosted VM');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const driver = process.env.QUALIFICATION_DRIVER;
  assert(driver && path.isAbsolute(driver));
  const require = createRequire(path.join(driver, 'package.json'));
  assert.equal(require('./package.json').version, '1.63.0');
  const { chromium } = require(driver);
  evidence.playwright = '1.63.0';
  evidence.executable = chromium.executablePath();
  // Full Chrome exposes chrome://sandbox; no system-browser fallback is allowed.
  server = await chromium.launchServer({ executablePath: evidence.executable,
    args: ['--enable-automation'],
    headless: true, chromiumSandbox: true, timeout: 30_000 });
  evidence.browserProcess = await processEvidence(server.process().pid);
  const browser = await chromium.connect(server.wsEndpoint());
  evidence.version = browser.version();
  assert.equal(evidence.version, '153.0.8010.12');
  const cdp = await browser.newBrowserCDPSession();
  evidence.cdpArgv = (await cdp.send('Browser.getBrowserCommandLine')).arguments;
  rejectBypass(evidence.cdpArgv);
  // Keep fresh, synthetic-run diagnostics visible without downloading artifacts.
  console.log('Browser argv evidence:', JSON.stringify({
    kernel: evidence.browserProcess.argv, cdp: evidence.cdpArgv }));
  // Chrome 153 reports its startup additions after the unchanged kernel argv.
  // Pin the entire suffix rather than ignoring unknown switches or their order.
  const chrome153Suffix = ['--noerrdialogs', '--ozone-platform=headless',
    '--ozone-override-screen-size=800,600', '--use-angle=swiftshader-webgl',
    '--flag-switches-begin', '--flag-switches-end', '--enable-unsafe-swiftshader'];
  assert.deepEqual(evidence.cdpArgv, [...evidence.browserProcess.argv, ...chrome153Suffix],
    'CDP argv does not match kernel argv plus the pinned Chrome 153 suffix');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // All page network requests are denied. Only browser internals and inline data run.
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto('chrome://sandbox');
  evidence.sandboxText = await page.locator('body').innerText();
  console.log('Sandbox diagnostics:', evidence.sandboxText);
  assert(/^Layer 1 Sandbox\s+Namespace\s*$/m.test(evidence.sandboxText),
    'Layer 1 sandbox is not Namespace');
  for (const label of ['PID namespaces', 'Network namespaces', 'Seccomp-BPF sandbox']) {
    assert(new RegExp(`${label}\\s+Yes`, 'i').test(evidence.sandboxText), `Missing effective ${label}`);
  }
  await page.close();
  const fixture = await context.newPage();
  await fixture.setContent('<!doctype html><html lang="en"><title>Synthetic runner fixture</title><button id="add">Add one</button><output id="count">0</output><script>document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent="1";</script></html>');
  const processes = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  evidence.renderers = [];
  for (const process of processes.filter(item => item.type === 'renderer')) {
    const renderer = await processEvidence(process.id);
    evidence.renderers.push(renderer);
    console.log('Renderer restrictions:', JSON.stringify(renderer));
    assert.equal(renderer.Seccomp, '2', 'Renderer lacks seccomp filtering');
    assert.equal(renderer.NoNewPrivs, '1', 'Renderer can gain privileges');
    assert(/^0+$/.test(renderer.CapEff), 'Renderer has effective capabilities');
    assert(renderer.NSpid.length > evidence.browserProcess.NSpid.length, 'Renderer lacks nested PID namespace');
  }
  assert(evidence.renderers.length > 0, 'No renderer evidence');
  await fixture.getByRole('button', { name: 'Add one' }).click();
  assert.equal(await fixture.locator('#count').textContent(), '1');
  await fixture.screenshot({ path: `${output}/synthetic.png` });
  evidence.qualified = true;
  console.log('PASS: explicit sandbox, actual argv, sandbox diagnostics and kernel renderer restrictions verified; synthetic click passed.');
} catch (error) {
  evidence.error = String(error.stack || error);
  console.error(`FAIL CLOSED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify(evidence, null, 2) + '\n');
  await server?.close();
  clearTimeout(deadline);
}

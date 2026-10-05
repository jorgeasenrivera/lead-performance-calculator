import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBackgroundScope, validateBackgroundSample } from './desktop-background-browser.mjs';
import { backgroundConfig } from './desktop-background.mjs';

export async function attachDesktopProfile(context, page, options) {
  const { variant, recording, directory } = backgroundConfig();
  const root = process.env.DESKTOP_PROFILER_ROOT || '.desktop-profiler';
  const PROFILE_LABELS = new Set(['Performance', 'associate-open', 'list-scroll']);
  await mkdir(directory, { recursive: true });
  await page.addInitScript(installBackgroundScope, { variant });
  // Unprofiled runs never open CDP or start CPU, timeline or counter recording.
  let recorder = { begin() {}, finish() {}, abort() {}, dispose() {} };
  if (recording === 'profile') {
    const { createProfileSession } = await import(pathToFileURL(path.resolve(root, 'scripts/desktop-profile-session.mjs')).href);
    recorder = await createProfileSession(await context.newCDPSession(page), { ...options,
      directory: directory + '/profiles', mapDirectory: '.desktop-signal/dist-mapped' });
  }
  const rows = []; let before, label;
  return {
    async begin(next) {
      label = PROFILE_LABELS.has(next) ? next : null;
      before = label ? await page.evaluate(() => window.__desktopBackgroundScope.snapshot()) : null;
      await recorder.begin(next);
    },
    async finish(raw, sample) {
      await recorder.finish(raw, sample);
      if (!label) return;
      // Read computed style only after profiling and the lifecycle recording
      // finish. Reading it every frame would measure our own layout flushes.
      const row = { label, ordinal: rows.length, variant, recording, before, after: null, sample,
        writes: null, failure: null };
      rows.push(row);
      try {
        row.after = await page.evaluate(() => window.__desktopBackgroundScope.inspect());
        row.writes = validateBackgroundSample(before, row.after);
      }
      catch (error) { row.failure = error.message; throw error; }
      finally { await writeFile(path.join(directory, 'background.json'), JSON.stringify(rows, null, 2)); }
      label = null;
    },
    abort: () => recorder.abort(),
    async dispose() {
      try { await recorder.dispose(); }
      finally { await writeFile(path.join(directory, 'background.json'), JSON.stringify(rows, null, 2)); }
    },
  };
}

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBackgroundScope, validateBackgroundSample } from './desktop-background-browser.mjs';

export async function attachDesktopProfile(context, page, options) {
  const variant = process.env.DESKTOP_BACKGROUND_VARIANT;
  assert.ok(['root', 'backdrop'].includes(variant));
  const root = process.env.DESKTOP_PROFILER_ROOT || '.desktop-profiler';
  const { createProfileSession, PROFILE_LABELS } = await import(pathToFileURL(path.resolve(root, 'scripts/desktop-profile-session.mjs')).href);
  const directory = `desktop-background-evidence/${variant}`;
  await mkdir(directory, { recursive: true });
  await page.addInitScript(installBackgroundScope, { variant });
  const recorder = await createProfileSession(await context.newCDPSession(page), { ...options,
    directory: directory + '/profiles', mapDirectory: '.desktop-signal/dist-mapped' });
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
      const row = { label, ordinal: rows.length, variant, before, after: null, sample,
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

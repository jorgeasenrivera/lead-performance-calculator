import assert from 'node:assert/strict';

// Driver hooks import this inert module, not the CLI entry that awaits them.
export function backgroundConfig(env = process.env) {
  const variant = env.DESKTOP_BACKGROUND_VARIANT;
  const recording = env.DESKTOP_BACKGROUND_RECORDING || 'profile';
  const browser = env.FEEL_BROWSER || 'chromium';
  const order = env.DESKTOP_BACKGROUND_ORDER || 'root-first';
  assert.ok(['root', 'backdrop'].includes(variant));
  assert.ok(['profile', 'unprofiled'].includes(recording));
  assert.ok(['chromium', 'webkit'].includes(browser));
  assert.ok(['root-first', 'backdrop-first'].includes(order));
  if (recording === 'profile') {
    assert.equal(browser, 'chromium', 'CDP experiment is Chromium only');
    assert.equal(order, 'root-first');
  }
  const directory = recording === 'profile' ? `desktop-background-evidence/${variant}`
    : `desktop-background-evidence/unprofiled/${browser}/${order}/${variant}`;
  return { variant, recording, browser, order, directory };
}

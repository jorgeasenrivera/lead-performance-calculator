import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureConfig, SITE } from '../scripts/android-webview/prepare.mjs';
test('Android fixture changes only the disposable site address', () => {
  const original = JSON.parse(readFileSync(new URL('../native/app.json', import.meta.url)));
  const expected = structuredClone(original);
  expected.expo.extra.siteUrl = SITE;
  assert.deepEqual(fixtureConfig(original), expected);
  assert.equal(original.expo.extra.siteUrl, 'https://www.sageonline.io');
  assert.throws(() => fixtureConfig({ expo: { extra: { siteUrl: 'https://unexpected.example' } } }));
});

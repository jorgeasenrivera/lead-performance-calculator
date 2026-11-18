import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('storage candidates remain absent from existing runtime producers and Expo bridge', async () => {
  const paths = [
    '../App.js', '../modules/sage-live/index.js', '../modules/sage-live/ios/SageLiveModule.swift',
    '../modules/sage-live/android/src/main/java/com/sageonline/sagelive/SageLiveModule.kt',
    '../modules/sage-live/android/src/main/java/com/sageonline/sagelive/QueueActionReceiver.kt',
    '../intents/QueueIntents.swift',
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert(!source.includes('SageIntentJournalStore'), `${path}: storage wiring needs a separately reviewed scope`);
    assert(!source.includes('intent-journal.mjs'), `${path}: coordinator must remain inert`);
  }
});

test('platform probes are separate synthetic targets, not proof of native execution', async () => {
  const manifest = await readFile(new URL('../checks/platform-store/android/AndroidManifest.xml', import.meta.url), 'utf8');
  assert(manifest.includes('android:process=":journal_probe"'));
  assert(manifest.includes('android:exported="false"'));
  assert(manifest.includes('android:targetPackage="com.sageonline.journalprobe"'));
  const doc = await readFile(new URL('../checks/platform-store/README.md', import.meta.url), 'utf8');
  assert(doc.includes('Neither platform probe below was compiled or executed.'));
});

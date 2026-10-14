"""Fictional offline APK fixtures; no package downloads, SDK, Android or KVM."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('driver', Path(__file__).with_name('verify-driver.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'package'
        self.cache = Path(self.temp.name) / 'cache'
        for package in ('playwright', 'playwright-core'):
            folder = self.root / 'node_modules' / package
            folder.mkdir(parents=True)
            (folder / 'package.json').write_text(json.dumps({'version': '1.63.0'}))
        self.browsers = self.root / 'node_modules/playwright-core/browsers.json'
        self.browsers.write_text(json.dumps({'browsers': [{'name': 'android', 'revision': '1001'}]}))
        (self.cache / 'android-1001').mkdir(parents=True)
        self.apks = [self.cache / 'android-1001' / name for name in ('android-driver.apk', 'android-driver-target.apk')]
        for apk in self.apks:
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('AndroidManifest.xml', 'fictional manifest, not executable')

    def test_both_apks_verified_in_explicit_cache(self):
        result = driver.verify(self.root, self.cache)
        self.assertEqual([x['name'] for x in result['apks']], [p.name for p in self.apks])
        self.assertEqual(result['cache'], str(self.cache))
        self.assertTrue(all(x['bytes'] > 0 and len(x['sha256']) == 64 for x in result['apks']))

    def test_each_missing_apk_blocks(self):
        for apk in self.apks:
            data = apk.read_bytes()
            apk.unlink()
            with self.assertRaises(FileNotFoundError):
                driver.verify(self.root, self.cache)
            apk.write_bytes(data)

    def test_corrupt_or_empty_apk_blocks(self):
        for data in (b'', b'not an apk', b'PK\x03\x04truncated'):
            self.apks[0].write_bytes(data)
            with self.assertRaises(zipfile.BadZipFile):
                driver.verify(self.root, self.cache)

    def test_manifest_required(self):
        with zipfile.ZipFile(self.apks[0], 'w') as archive:
            archive.writestr('unrelated.txt', 'fiction')
        with self.assertRaises(KeyError):
            driver.verify(self.root, self.cache)

    def test_unreviewed_version_blocks(self):
        for package in ('playwright', 'playwright-core'):
            file = self.root / 'node_modules' / package / 'package.json'
            file.write_text('{"version":"1.64.0"}')
            with self.assertRaisesRegex(ValueError, '1.63.0'):
                driver.verify(self.root, self.cache)
            file.write_text('{"version":"1.63.0"}')

    def test_unknown_revision_or_override_blocks(self):
        for descriptor in ({'name': 'android', 'revision': '1002'},
                           {'name': 'android', 'revision': '1001', 'revisionOverrides': {'linux': '1002'}}):
            self.browsers.write_text(json.dumps({'browsers': [descriptor]}))
            with self.assertRaisesRegex(ValueError, 'Unreviewed'):
                driver.verify(self.root, self.cache)

    def test_symlink_apk_blocks(self):
        self.apks[0].unlink()
        self.apks[0].symlink_to(self.apks[1])
        with self.assertRaisesRegex(ValueError, 'regular'):
            driver.verify(self.root, self.cache)


if __name__ == '__main__':
    unittest.main()

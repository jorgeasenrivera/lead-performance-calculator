"""Verify pinned host-side Android driver assets without running Android or ADB."""
import hashlib
import json
from pathlib import Path
import stat
import sys
import zipfile


def verify(root, cache):
    for package in ('playwright', 'playwright-core'):
        version = json.loads((root / 'node_modules' / package / 'package.json').read_text())['version']
        if version != '1.63.0':
            raise ValueError('Expected ' + package + ' 1.63.0')
    browsers = json.loads((root / 'node_modules/playwright-core/browsers.json').read_text())['browsers']
    android = [entry for entry in browsers if entry['name'] == 'android']
    if len(android) != 1 or android[0].get('revision') != '1001' or android[0].get('revisionOverrides'):
        raise ValueError('Unreviewed Android driver revision')
    result = {'playwright': '1.63.0', 'android_revision': '1001', 'cache': str(cache), 'apks': []}
    for name in ('android-driver.apk', 'android-driver-target.apk'):
        apk = cache / 'android-1001' / name
        if not stat.S_ISREG(apk.lstat().st_mode):
            raise ValueError('Expected regular driver APK: ' + name)
        data = apk.read_bytes()
        with zipfile.ZipFile(apk) as archive:
            if archive.testzip() is not None or not archive.read('AndroidManifest.xml'):
                raise ValueError('Invalid Android driver APK: ' + name)
        result['apks'].append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(verify(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print('BLOCKED: Android driver assets not verified: ' + str(error), file=sys.stderr)
        sys.exit(1)

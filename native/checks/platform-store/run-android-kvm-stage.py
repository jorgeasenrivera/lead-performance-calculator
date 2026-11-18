"""Approved CI-only same-user KVM group stage. No persistent access changes."""
import grp
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

HERE = Path(__file__).resolve().parent
DEVICE = '/dev/kvm'


def device_identity():
    info = os.lstat(DEVICE)
    if not stat.S_ISCHR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o660:
        raise ValueError('unexpected device type or mode')
    if info.st_gid <= 0 or grp.getgrgid(info.st_gid).gr_name != 'kvm':
        raise ValueError('unexpected device group')
    return [info.st_dev, info.st_ino, info.st_rdev, info.st_uid, info.st_gid, info.st_mode]


def validate_identity(expected, uid, inside):
    if uid <= 0 or os.getuid() != uid or os.geteuid() != uid:
        raise ValueError('original non-root UID required')
    if device_identity() != expected:
        raise ValueError('device identity changed')
    if inside and os.getegid() != expected[4]:
        raise ValueError('expected effective group required')


def launch(apk):
    uid = os.getuid()
    expected = device_identity()
    validate_identity(expected, uid, False)
    sdk = Path(os.environ['ANDROID_HOME']).resolve(strict=True)
    temp = Path(tempfile.mkdtemp(prefix='journal-kvm-stage.', dir=os.environ['RUNNER_TEMP'])).resolve()
    avd = Path(os.environ['ANDROID_AVD_HOME']).resolve(strict=True)
    apk = Path(apk).resolve(strict=True)
    # Preserve no credentials, shell startup hooks or loader overrides. The
    # validation stage uses the same UID, so existing synthetic files stay owned.
    env = {
        'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
        'HOME': str(temp), 'TMPDIR': str(temp), 'RUNNER_TEMP': str(temp),
        'ANDROID_HOME': str(sdk), 'ANDROID_SDK_ROOT': str(sdk),
        'ANDROID_AVD_HOME': str(avd), 'ANDROID_USER_HOME': str(temp),
        'ADB_SERVER_SOCKET': 'tcp:localhost:5037',
        'JOURNAL_APK': str(apk),
    }
    for binary in ('/usr/bin/sudo', '/usr/bin/env', '/usr/bin/python3', '/bin/bash'):
        if not os.access(binary, os.X_OK):
            raise ValueError('required executable unavailable')
    args = ['/usr/bin/sudo', '-n', '-u', '#' + str(uid), '-g', '#' + str(expected[4]),
            '--', '/usr/bin/env', '-i', *[k + '=' + v for k, v in env.items()],
            '/usr/bin/python3', str(Path(__file__).resolve()), 'inside', str(uid), json.dumps(expected)]
    # exec lets sudo receive cancellation directly. No policy or access fallback.
    os.execve(args[0], args, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})


def inside(uid, expected):
    validate_identity(expected, uid, True)
    print('ANDROID_STAGE_IDENTITY original_nonroot_uid=true effective_kvm_group=true device_unchanged=true', flush=True)
    # The supervisor first proves lifecycle cleanup with harmless processes,
    # then owns the preflight and synthetic emulator stage and its descendants.
    os.execv('/usr/bin/python3', ['/usr/bin/python3', str(HERE / 'supervise-android-stage.py'),
             '/bin/bash', str(HERE / 'run-android-guarded-probes.sh')])


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'launch' and len(sys.argv) == 3:
            launch(sys.argv[2])
        elif sys.argv[1] == 'inside' and len(sys.argv) == 4:
            inside(int(sys.argv[2]), json.loads(sys.argv[3]))
        else:
            raise ValueError('invalid invocation')
    except (OSError, KeyError, ValueError):
        print('Android scoped stage refused: identity, device, environment or executable prerequisite failed.', file=sys.stderr)
        sys.exit(78)

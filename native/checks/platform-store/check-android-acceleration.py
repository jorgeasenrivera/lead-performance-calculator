"""Read-only runner observations and the emulator's official acceleration check.

No VM creation, device writes, permission changes or raw command output.
CPU flags and nested parameters are observations, not proof of usable acceleration.
"""
import errno
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def errno_name(error):
    return errno.errorcode.get(error.errno, 'OTHER')


def observe():
    result = {}
    try:
        cpu = Path('/proc/cpuinfo').read_text()
        result['cpu_vmx_or_svm_flag'] = bool(re.search(r'\b(?:vmx|svm)\b', cpu))
        result['cpu_hypervisor_flag'] = bool(re.search(r'\bhypervisor\b', cpu))
    except OSError:
        result['cpu_vmx_or_svm_flag'] = 'unavailable'
    for module in ('kvm_intel', 'kvm_amd'):
        try:
            value = Path('/sys/module/' + module + '/parameters/nested').read_text().strip().lower()
            result[module + '_nested_parameter'] = 'enabled' if value in ('y', '1') else 'disabled' if value in ('n', '0') else 'unrecognized'
        except OSError:
            result[module + '_nested_parameter'] = 'unavailable'
    try:
        info = os.stat('/dev/kvm')
        result.update(kvm_character_device=stat.S_ISCHR(info.st_mode),
                      kvm_mode=oct(stat.S_IMODE(info.st_mode)),
                      kvm_owner_matches_user=info.st_uid == os.geteuid(),
                      kvm_group_matches_process=info.st_gid in {os.getegid(), *os.getgroups()},
                      kvm_access_read=os.access('/dev/kvm', os.R_OK),
                      kvm_access_write=os.access('/dev/kvm', os.W_OK))
        if result['kvm_character_device']:
            fd = os.open('/dev/kvm', os.O_RDWR | os.O_CLOEXEC)
            os.close(fd)
            result['kvm_open_read_write'] = 'success'
        else:
            result['kvm_open_read_write'] = 'refused_non_character_device'
    except OSError as error:
        result['kvm_observation_errno'] = errno_name(error)
    return result


def classify(output):
    # Parse only the numeric protocol field and emit fixed labels. Never quote
    # paths, usernames or other arbitrary text from the emulator subprocess.
    match = re.search(r'(?:^|\n)accel:\s*\n(-?\d{1,5})\s*\n', output)
    code = int(match.group(1)) if match else None
    text = output.lower()
    labels = []
    patterns = (
        ('usable', r'kvm(?: \(version \d+\))? is installed and usable'),
        ('access_denied', r"permission denied|access denied|operation not permitted|doesn't have permissions|does not have permissions"),
        ('kvm_missing', r'kvm is not installed|/dev/kvm.{0,80}(?:not found|does not exist)|no such file or directory'),
        ('cpu_virtualization_unavailable', r'(?:vmx|svm|virtualization|virtualisation).{0,100}(?:not supported|disabled|unavailable)|(?:does not support|not support).{0,80}(?:vmx|svm|virtualization)'),
        ('acceleration_unusable', r'kvm.{0,100}(?:not usable|not supported|failed|error)'),
    )
    for label, pattern in patterns:
        if re.search(pattern, text):
            labels.append(label)
    return {'reported_code': code, 'classifications': labels or ['unrecognized_output']}


def main(emulator):
    observations = observe()
    print('ANDROID_ACCEL_OBSERVATIONS ' + json.dumps(observations, sort_keys=True), flush=True)
    try:
        check = subprocess.run([emulator, '-accel-check'], capture_output=True,
                               text=True, errors='replace', timeout=20, check=False)
        evidence = classify((check.stdout + '\n' + check.stderr)[-65536:])
        evidence['exit_code'] = check.returncode
    except subprocess.TimeoutExpired:
        evidence = {'classifications': ['check_timed_out']}
    except OSError as error:
        evidence = {'classifications': ['check_could_not_execute'], 'errno': errno_name(error)}
    print('ANDROID_ACCEL_CHECK ' + json.dumps(evidence, sort_keys=True), flush=True)
    if observations.get('kvm_open_read_write') == 'success' and evidence.get('exit_code') == 0 and evidence.get('reported_code') == 0 and evidence.get('classifications') == ['usable']:
        return 0
    print('Android acceleration prerequisite unavailable or unverified; emulator launch refused.')
    return 78


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))

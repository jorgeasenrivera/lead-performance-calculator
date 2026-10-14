"""One reviewed disposable runner, one fixed device, no general ACL editor."""
import grp
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time

DEVICE = '/dev/kvm'
BASE = ['user::rw-', 'group::rw-', 'other::---']
GRANTED = ['user::rw-', 'user:1001:rw-', 'group::rw-', 'mask::rw-', 'other::---']


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def entries(acl):
    return [line.strip() for line in acl.splitlines() if line.strip() and not line.startswith('#')]


class System:
    def context(self):
        require(os.environ.get('GITHUB_ACTIONS') == 'true' and
                os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
                os.environ.get('RUNNER_OS') == 'Linux' and os.environ.get('RUNNER_ARCH') == 'X64',
                'Only the reviewed disposable GitHub Linux runner is allowed')
        require(os.getuid() == os.geteuid() == 1001, 'Expected current runner UID 1001')
        require(993 not in os.getgroups() + [os.getgid(), os.getegid()], 'Unexpected KVM group membership')
        require(grp.getgrgid(993).gr_name == 'kvm', 'Expected group 993 to be kvm')
        for tool in ['/usr/bin/getfacl', '/usr/bin/setfacl', '/usr/bin/sudo']:
            require(os.access(tool, os.X_OK), f'Missing preinstalled tool: {tool}')

    def metadata(self):
        s = os.lstat(DEVICE)
        require(stat.S_ISCHR(s.st_mode), 'Expected a character device, never a symlink')
        require((s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode), os.major(s.st_rdev), os.minor(s.st_rdev))
                == (0, 993, 0o660, 10, 232), 'Device owner/group/mode/number differs from diagnostic')
        return {key: getattr(s, key) for key in ('st_dev', 'st_ino', 'st_rdev', 'st_uid', 'st_gid', 'st_mode')}

    def observed_metadata(self):
        # Diagnostics must describe unexpected devices too, without following symlinks.
        s = os.lstat(DEVICE)
        return {**{key: getattr(s, key) for key in ('st_dev', 'st_ino', 'st_rdev', 'st_uid', 'st_gid', 'st_mode')},
                'major': os.major(s.st_rdev), 'minor': os.minor(s.st_rdev),
                'is_character': stat.S_ISCHR(s.st_mode), 'is_symlink': stat.S_ISLNK(s.st_mode)}

    def observed_identity(self):
        return {'uid': os.getuid(), 'euid': os.geteuid(), 'gid': os.getgid(),
                'egid': os.getegid(), 'groups': os.getgroups()}

    def acl(self):
        return subprocess.run(['/usr/bin/getfacl', '-p', '-n', DEVICE], check=True,
                              capture_output=True, text=True, timeout=10).stdout

    def accessible(self):
        return [os.access(DEVICE, mode, effective_ids=True) for mode in (os.R_OK, os.W_OK)]

    def grant(self):
        # No automatic mask recalculation can expose previously masked rights.
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/setfacl', '--no-mask',
                        '-m', 'u:1001:rw-,m::rw-', DEVICE], check=True, timeout=10)

    def restore(self, acl):
        # Fixed target; header comments cannot select another file or change owners.
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/setfacl', '--no-mask',
                        '--set-file=-', DEVICE], input=acl, text=True, check=True, timeout=10)


def save(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='sage-kvm-', delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def grant(system, path):
    require(not path.exists(), 'ACL lease already exists; no repeated grant')
    system.context()
    before = system.metadata()
    original = system.acl()
    require(entries(original) == BASE, 'Unexpected original ACL, including named entries or mask')
    require(system.accessible() == [False, False], 'Expected both access checks denied')
    state = {'metadata': before, 'original_acl': original, 'status': 'prepared'}
    # Persist before mutation so cleanup can recover if the setter is interrupted.
    save(path, state)
    require(system.metadata() == before and system.acl() == original, 'Device changed before grant')
    system.grant()
    require(system.metadata() == before, 'Device changed during grant')
    require(entries(system.acl()) == GRANTED, 'Granted ACL differs from the exact scoped grant')
    require(system.accessible() == [True, True], 'Runner still lacks read/write access')
    state['status'] = 'granted'
    save(path, state)
    print('KVM ACL: granted only current UID 1001 rw; original owner/group/other access preserved')


def restore(system, path):
    if not path.exists():
        print('KVM ACL: no saved lease, no mutation attempted')
        return
    system.context()
    state = json.loads(path.read_text())
    require(state['status'] in ('prepared', 'granted', 'restored'), 'Invalid saved lease state')
    require(entries(state['original_acl']) == BASE, 'Invalid original ACL snapshot')
    require(system.metadata() == state['metadata'], 'Device identity changed; refusing restoration to another device')
    current = system.acl()
    require(entries(current) in (BASE, GRANTED), 'Unexpected ACL change; refusing to overwrite third-party access')
    if current != state['original_acl']:
        system.restore(state['original_acl'])
    require(system.metadata() == state['metadata'], 'Restored device metadata differs')
    require(system.acl() == state['original_acl'], 'Restored ACL differs from complete original snapshot')
    require(system.accessible() == [False, False], 'Runner access not revoked')
    state['status'] = 'restored'
    save(path, state)
    print('KVM ACL: complete original ACL and metadata verified; runner access revoked')


def diagnostics(system, path):
    # Independent read-only observations; failures must not hide the other fields.
    def observe(read):
        try:
            return {'value': read()}
        except Exception as error:
            return {'error': type(error).__name__ + ': ' + str(error)}

    def saved():
        state = json.loads(path.read_text())
        return {key: state.get(key) for key in ('status', 'metadata', 'original_acl')}

    return {'timestamp_ns': time.time_ns(), 'device': DEVICE,
            'saved': observe(saved), 'current_acl': observe(system.acl),
            'current_metadata': observe(system.observed_metadata),
            'process_identity': observe(system.observed_identity),
            'effective_read_write': observe(system.accessible)}


def diagnose(system, path):
    report = diagnostics(system, path)
    print('KVM cleanup diagnostics: ' + json.dumps(report), flush=True)
    out = Path('android-webview-evidence')
    out.mkdir(exist_ok=True)
    # Keep both trap and final-cleanup observations. Never update the saved lease.
    with (out / 'kvm-cleanup-diagnostics.jsonl').open('a') as stream:
        stream.write(json.dumps(report) + '\n')


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ('grant', 'restore', 'diagnose'), 'Expected grant, restore or diagnose')
    path = Path(os.environ['RUNNER_TEMP']) / 'sage-kvm-acl.json'
    {'grant': grant, 'restore': restore, 'diagnose': diagnose}[sys.argv[1]](System(), path)

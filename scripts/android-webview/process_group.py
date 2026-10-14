"""Own, stop and reap the Android test's process tree before ACL restoration."""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

TERM_SECONDS = 3
KILL_SECONDS = 3
STOP_SECONDS = 12


def process(pid):
    try:
        text = Path(f'/proc/{pid}/stat').read_text()
    except (FileNotFoundError, ProcessLookupError):
        return None
    fields = text[text.rfind(')') + 2:].split()
    return {'pid': int(pid), 'state': fields[0], 'ppid': int(fields[1]),
            'pgid': int(fields[2]), 'sid': int(fields[3]), 'start': int(fields[19])}


def processes():
    return {p['pid']: p for entry in Path('/proc').iterdir()
            if entry.name.isdecimal() and (p := process(entry.name)) is not None}


def descendants(table, root):
    found = set()
    parents = {root}
    while parents:
        children = {pid for pid, p in table.items() if p['ppid'] in parents} - found
        found |= children
        parents = children
    return found


def same_identity(saved):
    current = process(saved['pid'])
    return current is not None and current['start'] == saved['start']


def save(path, state):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def reap():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                return
        except ChildProcessError:
            return


def owned(supervisor, pgid):
    table = processes()
    ids = descendants(table, supervisor)
    if pgid is not None:
        ids |= {pid for pid, p in table.items() if p['pgid'] == pgid or p['sid'] == pgid}
    return {pid: table[pid] for pid in ids}


def terminate(supervisor, pgid, sig):
    victims = owned(supervisor, pgid)
    if pgid is not None and any(p['pgid'] == pgid for p in victims.values()):
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            pass
    # A subreaper also owns descendants that fork or start a separate session.
    for pid, p in victims.items():
        if same_identity(p):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass


def shutdown(supervisor, pgid):
    for sig, budget in [(signal.SIGTERM, TERM_SECONDS), (signal.SIGKILL, KILL_SECONDS)]:
        terminate(supervisor, pgid, sig)
        deadline = time.monotonic() + budget
        while time.monotonic() < deadline:
            reap()
            if not owned(supervisor, pgid):
                # Check again after reaping; no surviving parent may fork later.
                time.sleep(0.05)
                reap()
                if not owned(supervisor, pgid):
                    return
            if sig == signal.SIGKILL:
                terminate(supervisor, pgid, sig)
            time.sleep(0.05)
        print(f'Android process cleanup: escalating after {sig.name}', flush=True)
    raise RuntimeError('Android descendants remain after bounded TERM/KILL; shutdown unverified')


def run(path):
    if path.exists():
        raise RuntimeError('Process lease already exists; repeated launch refused')
    # Adopt daemonized grandchildren so they remain discoverable and reapable.
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Cannot become child subreaper')
    received = []
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda number, frame: received.append(number))
    supervisor = process(os.getpid())
    state = {'supervisor': supervisor, 'pgid': None, 'status': 'launching'}
    save(path, state)
    pgid = None
    result = 1
    try:
        if not received:
            child = subprocess.Popen(['bash', 'scripts/android-webview/run.sh'], start_new_session=True)
            pgid = child.pid
            state.update(pgid=pgid, status='running')
            save(path, state)
            while not received:
                code = child.poll()
                if code is not None:
                    result = code if code >= 0 else 128 - code
                    break
                time.sleep(0.05)
        if received:
            result = 128 + received[0]
    finally:
        # This runs on normal completion, nonzero child exit, signals and errors.
        shutdown(supervisor['pid'], pgid)
        state.update(pgid=pgid, status='stopped')
        save(path, state)
        print('Android process cleanup: group and adopted descendants stopped and reaped', flush=True)
    return result


def stop(path):
    if not path.exists():
        print('Android process cleanup: no process lease, no launch occurred')
        return
    state = json.loads(path.read_text())
    supervisor = state['supervisor']
    if state['status'] != 'stopped':
        if not same_identity(supervisor):
            raise RuntimeError('Supervisor disappeared without verified shutdown; shutdown unverified')
        os.kill(supervisor['pid'], signal.SIGTERM)
        deadline = time.monotonic() + STOP_SECONDS
        while time.monotonic() < deadline:
            state = json.loads(path.read_text())
            if state['status'] == 'stopped':
                break
            time.sleep(0.05)
        else:
            raise RuntimeError('Timed out waiting for verified descendant shutdown; shutdown unverified')
    table = processes()
    pgid = state['pgid']
    if pgid is not None and any(p['pgid'] == pgid or p['sid'] == pgid for p in table.values()):
        raise RuntimeError('Original process group/session still exists; shutdown unverified')
    if same_identity(supervisor) and descendants(table, supervisor['pid']):
        raise RuntimeError('Supervisor still has descendants; shutdown unverified')
    print('Android process cleanup: shutdown verified before ACL restore')


if __name__ == '__main__':
    path = Path(os.environ['RUNNER_TEMP']) / 'sage-android-processes.json'
    if sys.argv[1:] == ['run']:
        sys.exit(run(path))
    if sys.argv[1:] == ['stop']:
        stop(path)
    else:
        raise RuntimeError('Expected run or stop')

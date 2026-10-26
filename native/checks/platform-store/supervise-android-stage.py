#!/usr/bin/env python3
"""Supervise one CI stage and reap its owned descendants, including daemon forks."""
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

GRACE_SECONDS = 2.0
REAP_SECONDS = 2.0


def enable_subreaper():
    if sys.platform != 'linux':
        raise RuntimeError('Linux subreaper required')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise RuntimeError('Cannot enable child subreaper')


def direct_children():
    # The kernel lists only this supervisor's children, never unrelated processes.
    try:
        text = Path(f'/proc/self/task/{os.getpid()}/children').read_text()
        return [int(pid) for pid in text.split()]
    except FileNotFoundError:
        # Some kernels omit CONFIG_CHECKPOINT_RESTORE's children file. Read only
        # numeric parent metadata, never command lines or process environments.
        children = []
        for entry in Path('/proc').iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
                if int(fields[1]) == os.getpid():
                    children.append(int(entry.name))
            except (FileNotFoundError, ProcessLookupError):
                pass
        return children


def signal_children(signum):
    for pid in direct_children():
        try:
            os.kill(pid, signum)
        except ProcessLookupError:
            pass


def signal_group(group, signum):
    try:
        os.killpg(group, signum)
    except ProcessLookupError:
        pass


def reap_finished():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return True
        if pid == 0:
            return False


def cleanup(process, first_signal):
    signal_group(process.pid, first_signal)
    try:
        process.wait(timeout=GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        signal_group(process.pid, signal.SIGKILL)
        process.wait(timeout=REAP_SECONDS)
    # The direct stage is now reaped. Subreaper adoption exposes escaped daemons.
    deadline = time.monotonic() + GRACE_SECONDS
    while not reap_finished():
        signal_children(signal.SIGTERM)
        if time.monotonic() >= deadline:
            break
        time.sleep(0.02)
    else:
        return
    signal_group(process.pid, signal.SIGKILL)
    deadline = time.monotonic() + REAP_SECONDS
    while not reap_finished():
        signal_children(signal.SIGKILL)
        if time.monotonic() >= deadline:
            raise RuntimeError('Owned descendants did not terminate')
        time.sleep(0.02)


def main(command):
    if not command or not os.path.isabs(command[0]):
        raise RuntimeError('Absolute stage executable required')
    enable_subreaper()
    requested = []

    def interrupted(signum, _frame):
        if not requested:
            requested.append(signum)

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    process = subprocess.Popen(command, start_new_session=True)
    try:
        while process.poll() is None and not requested:
            time.sleep(0.02)
        result = 128 + requested[0] if requested else process.returncode
    finally:
        cleanup(process, requested[0] if requested else signal.SIGTERM)
    if requested:
        result = 128 + requested[0]
    print('Android stage supervision: owned descendants reaped', flush=True)
    return 128 - result if result < 0 else result


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        # Avoid reflecting commands, environment values or arbitrary exception text.
        print('Android stage supervision failed', file=sys.stderr, flush=True)
        sys.exit(125)

"""Harmless local process tests. No Android tooling, network or privilege changes."""
import os
import ctypes
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SUPERVISOR = Path(__file__).with_name('supervise-android-stage.py')
FIXTURE = r'''
import os, pathlib, signal, sys, time
root = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
def interrupted(signum, _frame):
    (root / 'received-signal').write_text(str(signum))
    sys.exit(128 + signum)
signal.signal(signal.SIGINT, interrupted)
signal.signal(signal.SIGTERM, interrupted)
def record(name):
    (root / name).write_text(str(os.getpid()))
record('stage')
if mode in ('success', 'failure'):
    sys.exit(0 if mode == 'success' else 7)
pid = os.fork()
if pid == 0:
    if mode == 'escaped':
        os.setsid()
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    record('child')
    if os.fork() == 0:
        record('grandchild')
    while True:
        time.sleep(1)
while not (root / 'grandchild').exists():
    time.sleep(.01)
if mode in ('leftover', 'escaped'):
    sys.exit(0)
while True:
    time.sleep(1)
'''


@unittest.skipUnless(sys.platform == 'linux', 'Linux subreaper required')
class StageLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Adopt fixture orphans if the supervisor under test fails prematurely.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError('Cannot establish synthetic test cleanup ownership')

    def run_case(self, mode, expected, cancel=None):
        with tempfile.TemporaryDirectory(prefix='journal-stage-lifecycle-') as directory:
            root = Path(directory)
            fixture = root / 'fixture.py'
            fixture.write_text(FIXTURE)
            process = subprocess.Popen(
                [sys.executable, str(SUPERVISOR), sys.executable, str(fixture), str(root), mode],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                if cancel:
                    deadline = time.monotonic() + 5
                    while not (root / 'grandchild').exists():
                        self.assertIsNone(process.poll(), 'Supervisor exited before fixture ready')
                        if time.monotonic() >= deadline:
                            self.fail('Synthetic fixture did not become ready')
                        time.sleep(.01)
                    process.send_signal(cancel)
                stdout, stderr = process.communicate(timeout=12)
                self.assertEqual(process.returncode, expected, stderr)
                self.assertEqual(stderr, '')
                self.assertIn('owned descendants reaped', stdout)
                if cancel:
                    self.assertEqual((root / 'received-signal').read_text(), str(cancel))
                for name in ('stage', 'child', 'grandchild'):
                    if (root / name).exists():
                        pid = int((root / name).read_text())
                        with self.assertRaises(ProcessLookupError, msg=f'{name} survived'):
                            os.kill(pid, 0)
            finally:
                # Failure-only cleanup targets only PIDs created by this fixture.
                if process.poll() is None:
                    process.send_signal(signal.SIGTERM)
                    try:
                        process.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)
                for name in ('stage', 'child', 'grandchild'):
                    if (root / name).exists():
                        try:
                            os.kill(int((root / name).read_text()), signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                process.communicate(timeout=5)
                deadline = time.monotonic() + 2
                while True:
                    try:
                        pid, _ = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        break
                    if not pid:
                        if time.monotonic() >= deadline:
                            self.fail('Synthetic cleanup left an adopted descendant')
                        time.sleep(.01)

    def test_success(self):
        self.run_case('success', 0)

    def test_failure(self):
        self.run_case('failure', 7)

    def test_success_cleans_ignored_term_descendants(self):
        self.run_case('leftover', 0)

    def test_session_escape_is_reaped(self):
        self.run_case('escaped', 0)

    def test_term_cancellation(self):
        self.run_case('cancel', 128 + signal.SIGTERM, signal.SIGTERM)

    def test_int_cancellation(self):
        self.run_case('cancel', 128 + signal.SIGINT, signal.SIGINT)


if __name__ == '__main__':
    unittest.main()

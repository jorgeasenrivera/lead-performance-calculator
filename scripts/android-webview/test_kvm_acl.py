"""Synthetic system and subprocess tests; never touch /dev/kvm or call sudo."""
import importlib.util
import ctypes
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('kvm_acl', Path(__file__).with_name('kvm_acl.py'))
kvm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kvm)
HEADER = '# file: /dev/kvm\n# owner: 0\n# group: 993\n'
ORIGINAL = HEADER + '\n'.join(kvm.BASE) + '\n\n'


class Fake:
    def __init__(self):
        self.value = ORIGINAL
        self.meta = {'st_dev': 1, 'st_ino': 2, 'st_rdev': 256232, 'st_uid': 0, 'st_gid': 993, 'st_mode': 0o20660}
        self.calls = []
        self.fail_grant = False
        self.fail_restore = False
        self.bad_access = False

    def context(self):
        pass

    def metadata(self):
        return dict(self.meta)

    def acl(self):
        return self.value

    def accessible(self):
        return [True, True] if self.bad_access or kvm.entries(self.value) == kvm.GRANTED else [False, False]

    def grant(self):
        self.calls.append('grant')
        self.value = HEADER + '\n'.join(kvm.GRANTED) + '\n\n'
        if self.fail_grant:
            raise RuntimeError('setter interrupted after mutation')

    def restore(self, acl):
        self.calls.append('restore')
        if self.fail_restore:
            raise RuntimeError('restore denied')
        self.value = acl


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'lease.json'
        self.system = Fake()

    def test_success_full_snapshot_restored_and_cleanup_idempotent(self):
        kvm.grant(self.system, self.path)
        self.assertEqual(json.loads(self.path.read_text())['original_acl'], ORIGINAL)
        self.assertEqual(kvm.entries(self.system.value), kvm.GRANTED)
        kvm.restore(self.system, self.path)
        kvm.restore(self.system, self.path)
        self.assertEqual(self.system.value, ORIGINAL)
        self.assertEqual(self.system.calls, ['grant', 'restore'])
        self.assertEqual(json.loads(self.path.read_text())['status'], 'restored')

    def test_failure_after_grant_mutation_recovers_prepared_snapshot(self):
        self.system.fail_grant = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted'):
            kvm.grant(self.system, self.path)
        self.assertEqual(json.loads(self.path.read_text())['status'], 'prepared')
        kvm.restore(self.system, self.path)
        self.assertEqual(self.system.value, ORIGINAL)

    def test_restore_failure_retains_snapshot_for_always_retry(self):
        kvm.grant(self.system, self.path)
        self.system.fail_restore = True
        with self.assertRaisesRegex(RuntimeError, 'denied'):
            kvm.restore(self.system, self.path)
        self.assertEqual(json.loads(self.path.read_text())['status'], 'granted')
        self.system.fail_restore = False
        kvm.restore(self.system, self.path)
        self.assertEqual(self.system.value, ORIGINAL)

    def test_unexpected_acl_or_mask_is_rejected_without_mutation(self):
        for extra in ['user:2000:rw-', 'mask::r--', 'group:2000:rw-']:
            self.system.value = ORIGINAL + extra + '\n'
            with self.assertRaisesRegex(RuntimeError, 'Unexpected original ACL'):
                kvm.grant(self.system, self.path)
            self.assertFalse(self.path.exists())
        self.assertEqual(self.system.calls, [])

    def test_changed_device_is_not_restored(self):
        kvm.grant(self.system, self.path)
        self.system.meta['st_ino'] = 999
        with self.assertRaisesRegex(RuntimeError, 'identity changed'):
            kvm.restore(self.system, self.path)
        self.assertEqual(self.system.calls, ['grant'])

    def test_external_acl_change_is_not_overwritten(self):
        kvm.grant(self.system, self.path)
        self.system.value += 'user:2000:r--\n'
        with self.assertRaisesRegex(RuntimeError, 'third-party'):
            kvm.restore(self.system, self.path)
        self.assertEqual(self.system.calls, ['grant'])

    def test_revocation_verification_failure_is_not_success(self):
        kvm.grant(self.system, self.path)
        self.system.bad_access = True
        with self.assertRaisesRegex(RuntimeError, 'not revoked'):
            kvm.restore(self.system, self.path)
        self.assertEqual(json.loads(self.path.read_text())['status'], 'granted')

    def test_missing_snapshot_is_noop_and_repeated_grant_rejected(self):
        kvm.restore(self.system, self.path)
        self.assertEqual(self.system.calls, [])
        kvm.grant(self.system, self.path)
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            kvm.grant(self.system, self.path)

    def acl_library(self):
        try:
            acl = ctypes.CDLL('libacl.so.1', use_errno=True)
        except OSError:
            self.skipTest('libacl unavailable; synthetic lease and trap tests still run')
        acl.acl_from_text.argtypes = [ctypes.c_char_p]
        acl.acl_from_text.restype = ctypes.c_void_p
        acl.acl_set_file.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p]
        acl.acl_get_file.argtypes = [ctypes.c_char_p, ctypes.c_int]
        acl.acl_get_file.restype = ctypes.c_void_p
        acl.acl_to_any_text.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char, ctypes.c_int]
        acl.acl_to_any_text.restype = ctypes.c_void_p
        acl.acl_free.argtypes = [ctypes.c_void_p]
        return acl

    def numeric_acl_text(self, acl, value):
        # TEXT_NUMERIC_IDS (0x08) matches the controller's getfacl -n.
        # https://man7.org/linux/man-pages/man3/acl_to_any_text.3.html
        text = acl.acl_to_any_text(value, None, b'\n', 0x08)
        try:
            self.assertTrue(text)
            return ctypes.string_at(text).decode()
        finally:
            if text:
                acl.acl_free(text)

    def test_numeric_serialization_does_not_resolve_account_names(self):
        acl = self.acl_library()
        value = acl.acl_from_text(('\n'.join(kvm.GRANTED) + '\n').encode())
        self.assertTrue(value)
        try:
            self.assertEqual(kvm.entries(self.numeric_acl_text(acl, value)), kvm.GRANTED)
        finally:
            acl.acl_free(value)

    def test_real_posix_acl_round_trip_on_owned_temporary_file(self):
        acl = self.acl_library()
        target = Path(self.tmp.name) / 'owned-file'
        target.touch()
        def set_acl(lines, initial=False):
            value = acl.acl_from_text(('\n'.join(lines) + '\n').encode())
            self.assertTrue(value)
            try:
                result = acl.acl_set_file(bytes(target), 0x8000, value)
                if initial and result != 0 and ctypes.get_errno() == 95:
                    self.skipTest('temporary filesystem lacks POSIX ACL support (EOPNOTSUPP)')
                self.assertEqual(result, 0, ctypes.get_errno())
            finally:
                acl.acl_free(value)
        def read_acl():
            value = acl.acl_get_file(bytes(target), 0x8000)
            self.assertTrue(value)
            try:
                return self.numeric_acl_text(acl, value)
            finally:
                acl.acl_free(value)
        set_acl(kvm.BASE, initial=True)
        original = read_acl()
        before = target.stat()
        def round_trip(inject_failure=False):
            try:
                set_acl(kvm.GRANTED)
                self.assertEqual(kvm.entries(read_acl()), kvm.GRANTED)
                self.assertEqual(target.stat().st_mode, before.st_mode)
                if inject_failure:
                    raise AssertionError('deliberate assertion failure after ACL grant')
            finally:
                set_acl(kvm.entries(original))
                self.assertEqual(read_acl(), original)
                self.assertEqual((target.stat().st_uid, target.stat().st_gid, target.stat().st_mode),
                                 (before.st_uid, before.st_gid, before.st_mode))
        round_trip()
        with self.assertRaisesRegex(AssertionError, '^deliberate assertion failure after ACL grant$'):
            round_trip(inject_failure=True)
        self.assertEqual(read_acl(), original)

    def test_exact_privileged_commands_no_mask_recalculation(self):
        system = kvm.System()
        with patch.object(kvm.subprocess, 'run') as run:
            system.grant()
            self.assertEqual(run.call_args.args[0], ['/usr/bin/sudo', '-n', '/usr/bin/setfacl', '--no-mask', '-m', 'u:1001:rw-,m::rw-', '/dev/kvm'])
            system.restore(ORIGINAL)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/sudo', '-n', '/usr/bin/setfacl', '--no-mask', '--set-file=-', '/dev/kvm'])
            self.assertEqual(run.call_args.kwargs['input'], ORIGINAL)

    def test_device_mode_type_owner_and_numbers_fail_closed(self):
        from types import SimpleNamespace
        baseline = dict(st_dev=1, st_ino=2, st_rdev=__import__('os').makedev(10, 232), st_uid=0, st_gid=993, st_mode=0o20660)
        for field, value in [('st_mode', 0o100660), ('st_mode', 0o20666), ('st_uid', 1001), ('st_gid', 1001), ('st_rdev', 0)]:
            with patch.object(kvm.os, 'lstat', return_value=SimpleNamespace(**{**baseline, field: value})):
                with self.assertRaises(RuntimeError):
                    kvm.System().metadata()


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Synthetic identity guard tests, no KVM or sudo invocation."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stage', Path(__file__).with_name('run-android-kvm-stage.py'))
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class IdentityTests(unittest.TestCase):
    def validate(self, real=1001, effective=1001, group=108, expected=None, observed=None):
        expected = expected or [1, 2, 3, 0, 108, 0o20660]
        with patch.object(stage.os, 'getuid', return_value=real), patch.object(stage.os, 'geteuid', return_value=effective), patch.object(stage.os, 'getegid', return_value=group), patch.object(stage, 'device_identity', return_value=observed or expected):
            stage.validate_identity(expected, 1001, True)

    def test_original_uid_group_and_device(self):
        self.validate()

    def test_refuses_root_or_changed_uid(self):
        for fields in ({'real': 0}, {'effective': 0}, {'real': 1002}, {'effective': 1002}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                self.validate(**fields)

    def test_refuses_wrong_group(self):
        with self.assertRaises(ValueError):
            self.validate(group=109)

    def test_refuses_replaced_device(self):
        with self.assertRaises(ValueError):
            self.validate(observed=[1, 9, 3, 0, 108, 0o20660])

    def test_launcher_uses_same_uid_existing_group_and_clean_environment(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            env = {'ANDROID_HOME': directory, 'ANDROID_AVD_HOME': directory,
                   'RUNNER_TEMP': directory, 'PRIVATE_CANARY': 'must-not-forward',
                   'BASH_ENV': '/untrusted/startup', 'LD_PRELOAD': '/untrusted/loader'}
            expected = [1, 2, 3, 0, 108, 0o20660]
            with patch.dict(stage.os.environ, env, clear=True), patch.object(stage.os, 'getuid', return_value=1001), patch.object(stage.os, 'geteuid', return_value=1001), patch.object(stage.os, 'access', return_value=True), patch.object(stage, 'device_identity', return_value=expected), patch.object(stage.os, 'execve') as execute:
                stage.launch(directory)
            executable, argv, inherited = execute.call_args.args
            self.assertEqual(executable, '/usr/bin/sudo')
            self.assertEqual(argv[:9], ['/usr/bin/sudo', '-n', '-u', '#1001', '-g', '#108', '--', '/usr/bin/env', '-i'])
            self.assertEqual(inherited, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
            self.assertFalse(any('PRIVATE_CANARY' in arg or 'BASH_ENV' in arg or 'LD_PRELOAD' in arg or 'must-not-forward' in arg for arg in argv))

    def test_refuses_root_device_group(self):
        from types import SimpleNamespace
        with patch.object(stage.os, 'lstat', return_value=SimpleNamespace(st_mode=0o20660, st_gid=0)), self.assertRaises(ValueError):
            stage.device_identity()

    def test_refuses_symlink_or_broad_mode(self):
        from types import SimpleNamespace
        for mode in (0o120777, 0o20666, 0o100660):
            with self.subTest(mode=mode), patch.object(stage.os, 'lstat', return_value=SimpleNamespace(st_mode=mode)), self.assertRaises(ValueError):
                stage.device_identity()


if __name__ == '__main__':
    unittest.main()

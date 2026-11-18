"""Synthetic tests for preflight refusal and public-output hygiene, not KVM proof."""
import contextlib
import errno
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import importlib.util
spec = importlib.util.spec_from_file_location('acceleration', Path(__file__).with_name('check-android-acceleration.py'))
acceleration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceleration)

GOOD = 'accel:\n0\nKVM (version 12) is installed and usable.\naccel\n'


class AccelerationPreflightTests(unittest.TestCase):
    def run_check(self, output=GOOD, code=0, observation=None, failure=None):
        sink = io.StringIO()
        result = subprocess.CompletedProcess([], code, output, '')
        with patch.object(acceleration, 'observe', return_value=observation or {'kvm_open_read_write': 'success'}), patch.object(acceleration.subprocess, 'run', return_value=result, side_effect=failure) as command, contextlib.redirect_stdout(sink):
            status = acceleration.main('/synthetic/emulator')
        self.assertEqual(command.call_args.args[0], ['/synthetic/emulator', '-accel-check'])
        self.assertEqual(command.call_args.kwargs['timeout'], 20)
        return status, sink.getvalue()

    def test_requires_successful_official_check_and_device_open(self):
        self.assertEqual(self.run_check()[0], 0)
        self.assertEqual(self.run_check(code=1)[0], 78)
        self.assertEqual(self.run_check(output=GOOD.replace('\n0\n', '\n12\n'))[0], 78)
        self.assertEqual(self.run_check(observation={'kvm_observation_errno': 'EACCES'})[0], 78)

    def test_malformed_or_conflicting_output_fails_closed(self):
        for output in ('', 'unrecognized', GOOD.replace('accel:', 'other:'), GOOD + 'Permission denied'):
            self.assertEqual(self.run_check(output=output)[0], 78)

    def test_raw_diagnostic_values_are_not_published(self):
        secret = 'SYNTHETIC_PRIVATE_VALUE'
        status, output = self.run_check(output="accel:\n12\nThis user doesn't have permissions to use KVM\n/home/" + secret + '\nhttps://example.invalid/?token=' + secret)
        self.assertEqual(status, 78)
        self.assertIn('access_denied', output)
        self.assertNotIn(secret, output)
        self.assertNotIn('https://', output)

    def test_timeout_and_missing_tool_refuse_launch(self):
        self.assertIn('check_timed_out', self.run_check(failure=subprocess.TimeoutExpired([], 20))[1])
        status, output = self.run_check(failure=FileNotFoundError(errno.ENOENT, 'SYNTHETIC_PRIVATE_VALUE'))
        self.assertEqual(status, 78)
        self.assertIn('ENOENT', output)
        self.assertNotIn('SYNTHETIC_PRIVATE_VALUE', output)

    def test_device_access_error_is_specific_and_sanitized(self):
        with patch.object(acceleration.Path, 'read_text', return_value='vmx hypervisor'), patch.object(acceleration.os, 'stat', side_effect=PermissionError(errno.EACCES, 'SYNTHETIC_PRIVATE_VALUE')):
            result = acceleration.observe()
        self.assertEqual(result['kvm_observation_errno'], 'EACCES')
        self.assertTrue(result['cpu_vmx_or_svm_flag'])
        self.assertTrue(result['cpu_hypervisor_flag'])
        self.assertNotIn('SYNTHETIC_PRIVATE_VALUE', json.dumps(result))


if __name__ == '__main__':
    unittest.main()

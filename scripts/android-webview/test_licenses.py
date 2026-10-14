"""Offline fictional metadata only; no SDK, acceptance files, network or KVM."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from contextlib import redirect_stdout

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('sdk_licenses', Path(__file__).with_name('licenses.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class LicenseProofTests(unittest.TestCase):
    def setUp(self):
        self.raw = ' Fictional test agreement\nonly.\n\nNo actual license. '
        self.value = 'Fictional test agreement only.\n\nNo actual license.'
        self.marker = hashlib.sha1(self.value.encode()).hexdigest()
        self.xml = ('<repository><license id="fictional-license" type="text">' + self.raw +
                    '</license><license id="unrelated">Unaccepted unrelated fiction</license>'
                    '<remotePackage path="image"><revision><major>2</major></revision>'
                    '<uses-license ref="fictional-license"/><channelRef ref="channel-0"/>'
                    '<dependencies><dependency path="emulator"><min-revision><major>1</major>'
                    '</min-revision></dependency></dependencies></remotePackage>'
                    '<remotePackage path="emulator"><revision><major>1</major></revision>'
                    '<uses-license ref="fictional-license"/><channelRef ref="channel-0"/>'
                    '</remotePackage></repository>').encode()
        self.policy = {'sources': {'test': {'url': 'https://invalid.example/fiction', 'root': 'repository'}},
                       'licenses': {'fictional-license': hashlib.sha256(self.raw.encode()).hexdigest()},
                       'license_values': {'fictional-license': hashlib.sha256(self.value.encode()).hexdigest()},
                       'packages': {}}
        for node in ET.fromstring(self.xml).findall('remotePackage'):
            path = node.get('path')
            self.policy['packages'][path] = {'source': 'test', 'revision': [2 if path == 'image' else 1, 0, 0],
                'dependencies': {'emulator': [1, 0, 0]} if path == 'image' else {},
                'metadata_sha256': hashlib.sha256(ET.tostring(node)).hexdigest()}
        self.reads = []

    def accepted(self, name):
        self.reads.append(name)
        self.assertEqual(name, 'fictional-license')
        return 'old-unrelated-marker\n' + self.marker + '\n'

    def verify(self, xml=None, read=None, policy=None):
        return m.verify_remote(policy or self.policy, {'test': xml or self.xml}, read or self.accepted)

    def test_required_accepted_unrelated_pending(self):
        self.assertEqual(set(self.verify()), {'image', 'emulator'})
        self.assertEqual(self.reads, ['fictional-license', 'fictional-license'])

    def test_android_adapter_normalization(self):
        self.assertEqual(m.license_value(self.raw), self.value)
        self.assertEqual(m.license_value(' \tA \t \nB\n\n C  D\t '), 'A B\n\nC D')
        self.assertEqual(m.license_value('\u00a0A\u00a0'), '\u00a0A\u00a0')

    def test_missing_required_acceptance(self):
        with self.assertRaisesRegex(ValueError, 'acceptance not established'):
            self.verify(read=lambda _: 'some-other-version\n')
        with self.assertRaises(FileNotFoundError):
            self.verify(read=lambda _: (_ for _ in ()).throw(FileNotFoundError()))

    def test_marker_must_be_exact_line(self):
        with self.assertRaises(ValueError):
            self.verify(read=lambda _: ' ' + self.marker + ' ')

    def test_changed_license_even_with_new_marker_accepted(self):
        changed = self.xml.replace(b'No actual license.', b'Changed fictional license.')
        with self.assertRaisesRegex(ValueError, 'changed license text'):
            self.verify(xml=changed, read=lambda _: hashlib.sha1(b'changed').hexdigest())

    def test_unknown_metadata(self):
        for xml in [b'<unknown/>', b'broken XML', self.xml.replace(b'channel-0', b'channel-1'),
                    self.xml.replace(b'path="emulator"', b'path="unknown"'),
                    self.xml.replace(b'<major>2</major>', b'<major>3</major>'),
                    self.xml.replace(b'</remotePackage>', b'<new-field/></remotePackage>'),
                    self.xml.replace(b'fictional-license', b'unknown-license')]:
            with self.subTest(xml=xml[:50]), self.assertRaises((ValueError, ET.ParseError)):
                self.verify(xml=xml)

    def test_missing_and_duplicate_package(self):
        root = ET.fromstring(self.xml)
        root.append(copy.deepcopy(root.find('remotePackage')))
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            self.verify(xml=ET.tostring(root))
        with self.assertRaisesRegex(ValueError, 'missing repository'):
            m.verify_remote(self.policy, {}, self.accepted)

    def test_dependency_closure_fails_closed(self):
        policy = copy.deepcopy(self.policy)
        del policy['packages']['emulator']
        with self.assertRaisesRegex(ValueError, 'unsatisfied dependency'):
            self.verify(policy=policy)

    def test_fetch_command_and_network_failure(self):
        for failure in [subprocess.CalledProcessError(22, 'curl'),
                        subprocess.TimeoutExpired('curl', 25), FileNotFoundError('curl')]:
            with self.subTest(failure=failure), patch.object(m.subprocess, 'run', side_effect=failure), self.assertRaises(type(failure)):
                m.fetch('https://invalid.example/test')
        with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, self.xml)) as run:
            self.assertEqual(m.fetch('https://invalid.example/test'), self.xml)
            self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
            self.assertTrue(run.call_args.kwargs['check'])

    def test_main_failure_never_reports_success(self):
        for failure in [subprocess.CalledProcessError(22, 'curl'), subprocess.TimeoutExpired('curl', 25)]:
            with patch.object(m.Path, 'read_text', return_value=json.dumps(self.policy)), \
                 patch.object(m.sys, 'argv', ['licenses.py', '--sdk', '/fictional', 'image', 'emulator']), \
                 patch.object(m, 'fetch', side_effect=failure), redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(type(failure)):
                    m.main()
                self.assertEqual(output.getvalue(), '')

    def test_requested_package_drift_blocks_before_fetch(self):
        with patch.object(m.Path, 'read_text', return_value=json.dumps(self.policy)), \
             patch.object(m.sys, 'argv', ['licenses.py', '--sdk', '/fictional', 'image']), \
             patch.object(m, 'fetch') as fetch:
            with self.assertRaisesRegex(ValueError, 'package set differs'):
                m.main()
            fetch.assert_not_called()

    def test_cli_command_failure_exits_nonzero(self):
        policy = json.loads(m.POLICY.read_text())
        with tempfile.TemporaryDirectory() as directory:
            curl = Path(directory) / 'curl'
            curl.write_text('#!/bin/sh\nexit 22\n')
            curl.chmod(0o700)
            result = subprocess.run([sys.executable, str(Path(m.__file__)), '--sdk', directory,
                                     *policy['packages']], capture_output=True, text=True,
                                    env={**os.environ, 'PATH': directory}, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertIn('BLOCKED:', result.stderr)
            self.assertEqual(result.stdout, '')
            self.assertEqual(list(Path(directory).iterdir()), [curl])

    def test_installed_proof_and_changed_installed_license(self):
        with tempfile.TemporaryDirectory() as directory:
            sdk = Path(directory)
            root = ET.fromstring(self.xml)
            for node in root.findall('remotePackage'):
                local = ET.Element('{http://schemas.android.com/repository/android/common/02}repository')
                license_node = copy.deepcopy(root.find('license'))
                license_node.text = self.value
                local.append(license_node)
                package = copy.deepcopy(node)
                package.tag = 'localPackage'
                local.append(package)
                folder = sdk / node.get('path')
                folder.mkdir()
                (folder / 'package.xml').write_bytes(ET.tostring(local))
            m.verify_installed(self.policy, sdk, self.accepted)
            file = sdk / 'image/package.xml'
            file.write_text(file.read_text().replace('No actual license.', 'Changed license.'))
            with self.assertRaisesRegex(ValueError, 'changed installed license'):
                m.verify_installed(self.policy, sdk, self.accepted)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Offline integrity, retry, production classification and pending-release regression tests."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock
import zipfile

import dev_publication as dev

PROJECT = dev.ROOT


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='daikin-publication-tests-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ('scripts/idf-version.sh', 'scripts/check-web-installer-plan.py',
                     'scripts/check-dev-manifest-source.sh', '.github/workflows/build.yml',
                     'partitions.csv', 'dependencies.lock'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(PROJECT / name, target)
        (self.root / 'README.md').write_text('fixture\n')
        (self.root / 'main').mkdir()
        (self.root / 'main/hp_poll.cpp').write_text('fixture\n')
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('branch', '-M', 'main')
        self.commit('fixture: source A')
        self.source = self.git('rev-parse', 'HEAD').decode().strip()
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(dev, 'ROOT', self.root).start()
        # Signature cryptography has its own hostile-input selftest. Here assert the production
        # verifier is called with the exact app and pinned identity; no private signing key exists.
        self.signature = mock.patch.object(dev.signing, 'check_image', return_value=[]).start()
        app = b'signed-app-fixture'
        self.document = {
            'version': '1.2.3-dev.1', 'new_install_prompt_erase': True,
            'builds': [{'chipFamily': 'ESP32-S3', 'parts': [
                {'path': 'daikin-altherma-esp32.bin', 'offset': 0x10000}]}],
            'provenance': {'source_sha': self.source, 'idf_version': 'v6.1',
                           'dependencies_lock_sha256': hashlib.sha256((self.root / 'dependencies.lock').read_bytes()).hexdigest(),
                           'app_sha256': hashlib.sha256(app).hexdigest(),
                           'signing_key_sha256': dev.provenance.pinned_signing_digest()},
        }
        self.payloads = {name: b'fixture' for name in dev.readback.REQUIRED_SITE_FILES}
        self.payloads['daikin-altherma-esp32.bin'] = app
        self.update_manifest()
        self.pages = self.make_pages()
        self.run = {'id': 77, 'run_attempt': 1, 'head_sha': self.source, 'head_branch': 'main',
                    'event': 'push', 'status': 'completed', 'conclusion': 'success',
                    'path': dev.WORKFLOW, 'repository': {'full_name': dev.REPOSITORY}}
        self.jobs = {'jobs': [{'name': 'publish', 'status': 'completed', 'conclusion': 'success',
                              'steps': [{'name': name, 'status': 'completed', 'conclusion': 'success'}
                                        for name in ('Verify public feed readback', 'Upload dev publication proof')]}]}
        self.artifacts = {'artifacts': [{'id': 88, 'name': 'dev-publication-proof-1', 'expired': False}]}
        self.proof = {'schema_version': 1, 'repository': dev.REPOSITORY, 'workflow': dev.WORKFLOW,
                      'source_sha': self.source, 'pages_commit': self.pages, 'run_id': 77, 'run_attempt': 1,
                      'manifest_sha256': hashlib.sha256(self.payloads['manifest.json']).hexdigest(),
                      'site_sha256': dev.slice_digest(self.payloads)}

    def git(self, *args, data=None):
        return subprocess.check_output(['git', *args], cwd=self.root, input=data, stderr=subprocess.DEVNULL)

    def commit(self, name, *paths):
        self.git('add', *(paths or ('-A',)))
        self.git('commit', '-qm', name)

    def update_manifest(self):
        self.payloads['manifest.json'] = json.dumps(self.document, separators=(',', ':')).encode()
        self.payloads['artifacts.json'] = json.dumps({
            'schema_version': 1,
            'manifest_sha256': hashlib.sha256(self.payloads['manifest.json']).hexdigest(),
            'artifacts': [{'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}
                          for name, data in sorted(self.payloads.items()) if name.endswith('.bin')],
        }).encode()

    def make_pages(self):
        entries = []
        for name, data in sorted(self.payloads.items()):
            oid = self.git('hash-object', '-w', '--stdin', data=data).decode().strip()
            entries.append(f'100644 blob {oid}\t{name}\n')
        tree = self.git('mktree', data=''.join(entries).encode()).decode().strip()
        root_tree = self.git('mktree', data=f'040000 tree {tree}\tdev\n'.encode()).decode().strip()
        return self.git('commit-tree', root_tree, data=b'fixture: pages\n').decode().strip()

    def validate(self):
        with tempfile.TemporaryDirectory() as raw:
            return dev.validate_feed(self.make_pages(), 'HEAD', Path(raw))

    def api(self, endpoint, *, binary=False):
        if '/workflows/' in endpoint:
            return {'workflow_runs': [copy.deepcopy(self.run)]}
        if '/attempts/' in endpoint:
            self.assertIn('/attempts/1/jobs?', endpoint)
            return copy.deepcopy(self.jobs)
        if '/runs/77/artifacts?' in endpoint:
            return copy.deepcopy(self.artifacts)
        self.assertTrue(endpoint.endswith('/artifacts/88/zip'))
        self.assertTrue(binary)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as zipped:
            zipped.writestr(dev.PROOF_FILE, json.dumps(self.proof))
        return output.getvalue()

    def test_valid_signed_feed_and_same_source(self):
        source, target, payloads = self.validate()
        self.assertEqual((source, target), (self.source, self.source))
        self.signature.assert_called_once_with(payloads['daikin-altherma-esp32.bin'], dev.provenance.pinned_signing_digest())
        dev.completed_publication(source, payloads, self.api)
        with mock.patch.object(dev, 'gh_api', self.api), mock.patch.dict(os.environ, {'GITHUB_RUN_ATTEMPT': '1'}):
            self.assertEqual(dev.resolve(self.pages, 'HEAD'), 3)

    def test_hostile_proof_zip_and_runtime_errors_fail_closed(self):
        original = self.api('fixture/artifacts/88/zip', binary=True)
        for kind in ('unsupported compression', 'encrypted member'):
            archive = bytearray(original)
            central = archive.index(b'PK\x01\x02')
            if kind == 'unsupported compression':
                struct.pack_into('<H', archive, 8, 99)
                struct.pack_into('<H', archive, central + 10, 99)
            else:
                struct.pack_into('<H', archive, 6, 1)
                struct.pack_into('<H', archive, central + 8, 1)
            def api(endpoint, *, binary=False):
                return bytes(archive) if binary else self.api(endpoint)
            with self.subTest(kind=kind), mock.patch.object(dev, 'gh_api', api), \
                    mock.patch.dict(os.environ, {'GITHUB_RUN_ATTEMPT': '1'}), \
                    mock.patch.object(dev.sys, 'argv', ['dev_publication.py', 'resolve', self.pages, 'HEAD']):
                self.assertEqual(dev.main(), 2)
        with mock.patch.object(dev, 'resolve', side_effect=MemoryError('fixture')), \
                mock.patch.object(dev.sys, 'argv', ['dev_publication.py', 'resolve', self.pages, 'HEAD']):
            self.assertEqual(dev.main(), 2)

    def test_wrapper_never_interprets_python_failure_as_same_source(self):
        self.git('init', '-q', '--bare', str(self.root / 'origin.git'))
        self.git('remote', 'add', 'origin', str(self.root / 'origin.git'))
        self.git('push', '-q', 'origin', f'{self.pages}:refs/heads/gh-pages')
        binaries = self.root / 'bin'
        binaries.mkdir()
        executable = binaries / 'python3'
        environment = {**os.environ, 'PATH': f'{binaries}{os.pathsep}{os.environ["PATH"]}'}
        for resolver_status, helper_status in ((1, 2), (2, 2), (42, 2), (3, 1), (0, 0)):
            executable.write_text(f'#!/usr/bin/env bash\nexit {resolver_status}\n')
            executable.chmod(0o755)
            result = subprocess.run(['bash', 'scripts/check-dev-manifest-source.sh'],
                                    cwd=self.root, env=environment, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, helper_status)

    def test_invalid_manifest_shapes_and_provenance(self):
        pristine = copy.deepcopy(self.document)
        for field, value in [('version', 'not-a-version'), ('version', '01.2.3-dev.1'),
                             ('builds', []), ('new_install_prompt_erase', False),
                             ('provenance', {'source_sha': self.source})]:
            with self.subTest(field=field, value=value):
                self.document = copy.deepcopy(pristine)
                self.document[field] = value
                self.update_manifest()
                with self.assertRaises((dev.Unproven, SystemExit)):
                    self.validate()
        for field, value in [('idf_version', 'v0.0.0'), ('dependencies_lock_sha256', '0' * 64),
                             ('app_sha256', '0' * 64), ('signing_key_sha256', '0' * 64)]:
            with self.subTest(provenance=field):
                self.document = copy.deepcopy(pristine)
                self.document['provenance'][field] = value
                self.update_manifest()
                with self.assertRaises(SystemExit):
                    self.validate()

    def test_missing_feed_files_and_corrupt_json(self):
        pristine = copy.deepcopy(self.payloads)
        for name in ('manifest.json', 'artifacts.json', 'daikin-altherma-esp32.bin', 'index.html'):
            with self.subTest(missing=name):
                self.payloads = copy.deepcopy(pristine)
                del self.payloads[name]
                with self.assertRaises(ValueError):
                    self.validate()
        self.payloads = pristine
        self.payloads['manifest.json'] = b'{invalid'
        with self.assertRaises(ValueError):
            self.validate()

    def test_inventory_app_and_signature_tampering(self):
        pristine = copy.deepcopy(self.payloads)
        for name in ('manifest.json', 'daikin-altherma-esp32.bin'):
            with self.subTest(tamper=name):
                self.payloads = copy.deepcopy(pristine)
                self.payloads[name] += b'changed'
                with self.assertRaises(ValueError):
                    self.validate()
        self.payloads = pristine
        self.signature.side_effect = dev.signing.ImageError('signature is invalid')
        with self.assertRaises(dev.signing.ImageError):
            self.validate()

    def test_unknown_and_divergent_source(self):
        self.document['provenance']['source_sha'] = 'a' * 40
        self.update_manifest()
        with self.assertRaises(dev.Unproven):
            self.validate()
        tree = self.git('write-tree').decode().strip()
        unrelated = self.git('commit-tree', tree, data=b'fixture: unrelated\n').decode().strip()
        self.document['provenance']['source_sha'] = unrelated
        self.update_manifest()
        with self.assertRaises(dev.Unproven):
            self.validate()

    def test_latest_failed_run_cannot_use_older_green(self):
        old_green = copy.deepcopy(self.run)
        self.run['conclusion'] = 'failure'
        def api(endpoint, **kwargs):
            if '/workflows/' in endpoint:
                return {'workflow_runs': [self.run, old_green]}
            return self.api(endpoint, **kwargs)
        with self.assertRaises(dev.Unproven):
            dev.completed_publication(self.source, self.payloads, api)

    def test_failed_or_skipped_readback_and_missing_proof(self):
        for conclusion in ('failure', 'skipped', 'cancelled'):
            with self.subTest(readback=conclusion):
                self.jobs['jobs'][0]['steps'][0]['conclusion'] = conclusion
                with self.assertRaises(dev.Unproven):
                    dev.completed_publication(self.source, self.payloads, self.api)
        self.jobs['jobs'][0]['steps'][0]['conclusion'] = 'success'
        for artifacts in ([], [{'id': 88, 'name': 'dev-publication-proof-1', 'expired': True}]):
            self.artifacts['artifacts'] = artifacts
            with self.assertRaises(dev.Unproven):
                dev.completed_publication(self.source, self.payloads, self.api)

    def test_run_and_proof_identity_binding(self):
        original_run = copy.deepcopy(self.run)
        for field, wrong in [('head_sha', 'b' * 40), ('head_branch', 'feature'),
                             ('event', 'pull_request'), ('status', 'in_progress'),
                             ('path', '.github/workflows/other.yml'), ('run_attempt', 0),
                             ('repository', {'full_name': 'other/repository'})]:
            with self.subTest(run_field=field):
                self.run = copy.deepcopy(original_run)
                self.run[field] = wrong
                with self.assertRaises(dev.Unproven):
                    dev.completed_publication(self.source, self.payloads, self.api)
        self.run = original_run
        pristine = copy.deepcopy(self.proof)
        for field in ('source_sha', 'run_id', 'run_attempt', 'repository', 'workflow',
                      'manifest_sha256', 'site_sha256', 'pages_commit'):
            with self.subTest(proof_field=field):
                self.proof = copy.deepcopy(pristine)
                self.proof[field] = 'wrong'
                with self.assertRaises(dev.Unproven):
                    dev.completed_publication(self.source, self.payloads, self.api)

    def test_api_failure_and_full_rerun_build_conservatively(self):
        with mock.patch.object(dev, 'gh_api', side_effect=dev.Unproven('API offline')):
            with self.assertRaises(dev.Unproven):
                dev.completed_publication(self.source, self.payloads)
        with mock.patch.dict(os.environ, {'GITHUB_RUN_ATTEMPT': '2'}), \
                mock.patch.object(dev, 'gh_api') as api:
            with self.assertRaises(dev.Unproven):
                dev.resolve(self.pages, 'HEAD')
            api.assert_not_called()

    def test_proof_binds_whole_slice_after_root_publish(self):
        # A release root can move gh-pages without touching dev; that preserves the proof.
        dev.completed_publication(self.source, self.payloads, self.api)
        changed = copy.deepcopy(self.payloads)
        changed['index.html'] += b'changed'
        with self.assertRaises(dev.Unproven):
            dev.completed_publication(self.source, changed, self.api)

    def test_record_proof(self):
        site = self.root / 'local-site'
        site.mkdir()
        for name, data in self.payloads.items():
            (site / name).write_bytes(data)
        env = {'GITHUB_SHA': self.source, 'GITHUB_REPOSITORY': dev.REPOSITORY,
               'GITHUB_RUN_ID': '77', 'GITHUB_RUN_ATTEMPT': '1'}
        with mock.patch.dict(os.environ, env):
            dev.record(str(site), self.pages, str(self.root / 'proof'))
        recorded = json.loads((self.root / 'proof' / dev.PROOF_FILE).read_bytes())
        self.assertEqual(recorded, self.proof)

    def test_missing_branch_and_unreachable_remote(self):
        self.git('init', '-q', '--bare', str(self.root / 'origin.git'))
        self.git('remote', 'add', 'origin', str(self.root / 'origin.git'))
        for remote in ('origin', 'nonexistent'):
            result = subprocess.run(['bash', 'scripts/check-dev-manifest-source.sh', remote],
                                    cwd=self.root, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 2)

    def test_actual_workflow_classification(self):
        workflow = (PROJECT / '.github/workflows/build.yml').read_text()
        def step_shell(name):
            tail = workflow.split(f'      - name: {name}\n', 1)[1]
            tail = tail.split('        run: |\n', 1)[1]
            lines = []
            for line in tail.splitlines():
                if line and not line.startswith('          '):
                    break
                lines.append(line)
            return textwrap.dedent('\n'.join(lines))
        resolver = step_shell('Resolve completed dev publication')
        shell = step_shell('Detect build-relevant changes')
        # CI jobs have isolated /tmp directories; give this offline fixture the same isolation.
        shell = shell.replace('/tmp/changed-files.txt', str(self.root / 'changed-files.txt'))
        helper = self.root / 'scripts/check-dev-manifest-source.sh'
        output = self.root / 'outputs'
        def classify(rc, baseline):
            helper.write_text(f'#!/usr/bin/env bash\nprintf "%s\\n" "{baseline}"\nexit {rc}\n')
            helper.chmod(0o755)
            target = self.git('rev-parse', 'HEAD').decode().strip()
            code = shell.replace('${{ github.event_name }}', 'push').replace('${{ github.ref }}', 'refs/heads/main').replace('${{ github.sha }}', target)
            output.write_text('')
            env = {**os.environ, 'GITHUB_OUTPUT': str(output)}
            result = subprocess.run(['bash', '-e', '-c', resolver], cwd=self.root,
                                    capture_output=True, env=env, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            values = dict(line.split('=', 1) for line in output.read_text().splitlines())
            env.update(DEV_STATE=values['state'], DEV_SOURCE=values['source'])
            output.write_text('')
            result = subprocess.run(['bash', '-c', code], cwd=self.root, capture_output=True,
                                    env=env, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            return output.read_text().strip()
        self.assertEqual(classify(1, ''), 'firmware=no')
        self.assertEqual(classify(2, ''), 'firmware=yes')
        self.assertEqual(classify(0, 'invalid'), 'firmware=yes')
        self.assertEqual(classify(42, self.source), 'firmware=yes')
        code = shell.replace('${{ github.event_name }}', 'push').replace('${{ github.ref }}', 'refs/heads/main')
        for state, source in (('', ''), ('unexpected', self.source), ('ancestor', 'invalid')):
            output.write_text('')
            result = subprocess.run(['bash', '-c', code], cwd=self.root, capture_output=True,
                                    env={**os.environ, 'GITHUB_OUTPUT': str(output),
                                         'DEV_STATE': state, 'DEV_SOURCE': source}, timeout=10)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(output.read_text().strip(), 'firmware=yes')
        (self.root / 'main/hp_poll.cpp').write_text('changed firmware\n')
        self.commit('fixture: firmware B', 'main/hp_poll.cpp')
        (self.root / 'README.md').write_text('docs C\n')
        self.commit('fixture: docs C', 'README.md')
        self.assertEqual(classify(0, self.source), 'firmware=yes')
        published = self.git('rev-parse', 'HEAD').decode().strip()
        (self.root / 'README.md').write_text('docs D\n')
        self.commit('fixture: docs D', 'README.md')
        self.assertEqual(classify(0, published), 'firmware=no')
        # Includes every helper error: incomplete feed, failed readback and unavailable proof/API.
        self.assertEqual(classify(2, ''), 'firmware=yes')


class SchedulingTests(unittest.TestCase):
    def test_full_rerun_can_replace_its_signed_handoff(self):
        text = (PROJECT / '.github/workflows/build.yml').read_text()
        trusted = text.split('  trusted_build:\n', 1)[1].split('  publish:\n', 1)[0]
        upload = trusted.split('      - name: Upload firmware artifacts\n', 1)[1]
        self.assertIn('overwrite: true', upload)
        self.assertIn('name: daikin-altherma-esp32-${{ steps.stamp.outputs.disp }}', upload)
        publisher = text.split('  publish:\n', 1)[1]
        self.assertIn('ARTIFACT_NAME: daikin-altherma-esp32-${{ needs.trusted_build.outputs.version }}', publisher)
        self.assertIn('gh run download "$GITHUB_RUN_ID"', publisher)
        self.assertIn('SOURCE_SHA: ${{ github.sha }}', publisher)
        self.assertIn('./scripts/check-manifest-provenance.py dist/manifest.json', publisher)

    def test_release_queue_and_whole_chain_lock(self):
        text = (PROJECT / '.github/workflows/build.yml').read_text()
        top = re.search(r'^concurrency:\n((?:  .+\n)+)', text, re.M).group(1)
        self.assertRegex(top, r'queue: max\n')
        self.assertRegex(top, r'cancel-in-progress: false\n')
        self.assertIn('github.ref', top)
        self.assertIn('github.run_id', top)
        self.assertIn("github.event_name == 'pull_request'", top)
        for job in ('mechanical_gates', 'build'):
            block = text.split(f'  {job}:\n', 1)[1].split('    steps:', 1)[0]
            self.assertIn('    concurrency:', block)
            self.assertIn('github.event.pull_request.number', block)
            self.assertIn('cancel-in-progress:', block)
        for job in ('trusted_build', 'publish'):
            block = text.split(f'  {job}:\n', 1)[1].split('    steps:', 1)[0]
            self.assertNotIn('    concurrency:', block)
        self.assertLess(text.index('- name: Verify public feed readback'), text.index('- name: Record dev publication proof'))
        self.assertLess(text.index('- name: Record dev publication proof'), text.index('- name: Upload dev publication proof'))


if __name__ == '__main__':
    unittest.main(verbosity=2)

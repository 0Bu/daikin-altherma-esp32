#!/usr/bin/env python3
"""Offline integrity, retry, classification and PR/release scheduling regression tests."""
import ast
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
                     'scripts/check-publish-version.sh', 'scripts/check-manifest-provenance.py',
                     'scripts/generate-ota-changelog.py', 'tools/version/publish_gate.cpp',
                     'tools/release/ota_signing_key_digest.txt', 'main/logic/version_cmp.hpp',
                     'main/ota_update.cpp', 'partitions.csv', 'dependencies.lock'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(PROJECT / name, target)
            shutil.copymode(PROJECT / name, target)
        (self.root / 'README.md').write_text('fixture\n')
        (self.root / 'main').mkdir(exist_ok=True)
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
            'name': 'daikin-altherma-esp32',
            'version': '1.2.3-dev.1', 'new_install_prompt_erase': True,
            'builds': [{'chipFamily': 'ESP32-S3', 'parts': [
                {'path': 'daikin-altherma-esp32-web-bootloader.bin', 'offset': 0},
                {'path': 'daikin-altherma-esp32-web-partition-table.bin', 'offset': 0x8000},
                {'path': 'daikin-altherma-esp32-web-ota_data_initial.bin', 'offset': 0xf000},
                {'path': 'daikin-altherma-esp32.bin', 'offset': 0x20000}]}],
            'provenance': {'source_sha': self.source, 'idf_version': 'v6.1',
                           'dependencies_lock_sha256': hashlib.sha256((self.root / 'dependencies.lock').read_bytes()).hexdigest(),
                           'app_sha256': hashlib.sha256(app).hexdigest(),
                           'signing_key_sha256': dev.provenance.pinned_signing_digest()},
        }
        self.payloads = {name: b'fixture' for name in dev.readback.REQUIRED_SITE_FILES}
        self.payloads['daikin-altherma-esp32-web-bootloader.bin'] = b'\xe9' * 0x6000
        self.payloads['daikin-altherma-esp32-web-partition-table.bin'] = b'\x50' * 0xc00
        self.payloads['daikin-altherma-esp32-web-ota_data_initial.bin'] = b'\xff' * 0x2000
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
                with self.assertRaises((dev.Unproven, SystemExit)):
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

    def publication_handoff_fixture(self):
        """Execute the production publisher shell; replace download and signature services only."""
        self.git('init', '-q', '--bare', str(self.root / 'origin.git'))
        self.git('remote', 'add', 'origin', str(self.root / 'origin.git'))
        services = self.root / 'fixture-services'
        services.mkdir()
        downloader = services / 'gh'
        downloader.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            import shutil
            import sys
            from pathlib import Path
            assert sys.argv[1:3] == ['run', 'download']
            assert sys.argv[3] == '77' and sys.argv[-2:] == ['--dir', 'dist']
            for path in Path('fixture-handoff').iterdir():
                shutil.copyfile(path, Path('dist') / path.name)
            '''))
        downloader.chmod(0o755)
        verifier = services / 'signature-verifier'
        verifier.write_text(textwrap.dedent('''\
            #!/usr/bin/env python3
            import sys
            from pathlib import Path
            assert sys.argv[1:] == ['dist/daikin-altherma-esp32.bin']
            assert Path(sys.argv[1]).read_bytes()
            Path('fixture-signature-verified').write_text(sys.argv[1])
            '''))
        verifier.chmod(0o755)
        text = (PROJECT / '.github/workflows/build.yml').read_text()
        step = text.split('      - name: Download signed build handoff\n', 1)[1]
        match = re.search(r'        run: \|\n((?:          .*\n|\n)+)', step)
        self.assertIsNotNone(match)
        shell = textwrap.dedent(match.group(1))
        self.assertIn('./scripts/check-signing-key-continuity.py', shell)
        return shell.replace('./scripts/check-signing-key-continuity.py',
                             './fixture-services/signature-verifier')

    def resume_payloads(self, mode):
        self.document['version'] = '1.2.3' if mode == 'release' else '1.2.3-dev.1'
        version = self.document['version']
        notes = 'Original publication' if mode == 'release' else f'v{version} — Original publication'
        self.payloads['changelog.json'] = json.dumps({'version': version, 'changelog': notes},
                                                    ensure_ascii=False).encode()
        self.update_manifest()
        return copy.deepcopy(self.payloads)

    def publish_fixture_handoff(self, mode, payloads, *, nonregular=None):
        entries = []
        for name, data in sorted(payloads.items()):
            oid = self.git('hash-object', '-w', '--stdin', data=data).decode().strip()
            file_mode = '120000' if name == nonregular else '100644'
            entries.append(f'{file_mode} blob {oid}\t{name}\n')
        tree = self.git('mktree', data=''.join(entries).encode()).decode().strip()
        if mode == 'dev':
            tree = self.git('mktree', data=f'040000 tree {tree}\tdev\n'.encode()).decode().strip()
        pages = self.git('commit-tree', tree, data=b'fixture: immutable offered handoff\n').decode().strip()
        self.git('push', '-q', '--force', 'origin', f'{pages}:refs/heads/gh-pages')
        return pages

    def execute_publisher_handoff(self, shell, mode, payloads, *, offered_version=None):
        for name in ('fixture-handoff', 'dist'):
            shutil.rmtree(self.root / name, ignore_errors=True)
        handoff = self.root / 'fixture-handoff'
        handoff.mkdir()
        for name, data in payloads.items():
            (handoff / name).write_bytes(data)
        marker = self.root / 'fixture-outward-mutation'
        marker.unlink(missing_ok=True)
        (self.root / 'fixture-signature-verified').unlink(missing_ok=True)
        version = offered_version or json.loads(payloads['manifest.json'])['version']
        env = {**os.environ, 'PATH': f'{self.root / "fixture-services"}{os.pathsep}{os.environ["PATH"]}',
               'SOURCE_SHA': self.source, 'MODE': mode, 'VERSION': version, 'RUN_ATTEMPT': '2',
               'GH_REPO': 'fixture/repository', 'GITHUB_RUN_ID': '77', 'ARTIFACT_NAME': 'fixture'}
        result = subprocess.run(['bash', '-e', '-c', shell + '\nprintf publication > fixture-outward-mutation\n'],
                                cwd=self.root, env=env, capture_output=True, timeout=30)
        return result, marker.exists()

    def assert_equal_publication_is_immutable(self, shell):
        original_document, original_payloads = copy.deepcopy(self.document), copy.deepcopy(self.payloads)
        try:
            for mode in ('release', 'dev'):
                self.document, self.payloads = copy.deepcopy(original_document), copy.deepcopy(original_payloads)
                original = self.resume_payloads(mode)
                pages = self.publish_fixture_handoff(mode, original)
                result, mutated = self.execute_publisher_handoff(shell, mode, original)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertTrue(mutated, 'identical original handoff could not reach publication')
                self.assertTrue((self.root / 'fixture-signature-verified').exists())
                # A fresh probabilistic signature can change the app bytes while source/version remain
                # unchanged. Rebind all candidate metadata so the new handoff is internally valid.
                self.payloads['daikin-altherma-esp32.bin'] = b'same-source-new-signed-application-fixture'
                self.document['provenance']['app_sha256'] = hashlib.sha256(
                    self.payloads['daikin-altherma-esp32.bin']).hexdigest()
                self.update_manifest()
                result, mutated = self.execute_publisher_handoff(shell, mode, self.payloads)
                self.assertNotEqual(result.returncode, 0, 'same-version different application reached publication')
                self.assertFalse(mutated, 'outward mutation happened before equality rejection')
                self.assertEqual(self.git('ls-remote', '--heads', 'origin', 'gh-pages').decode().split()[0], pages)
        finally:
            self.document, self.payloads = original_document, original_payloads

    def test_actual_publisher_equal_version_requires_identical_offered_bytes(self):
        self.assert_equal_publication_is_immutable(self.publication_handoff_fixture())

    def test_publisher_identity_guard_and_candidate_argument_mutations_are_detected(self):
        shell = self.publication_handoff_fixture()
        guard = './scripts/check-publish-version.sh --candidate-dir dist --source-sha "$SOURCE_SHA" "$check_mode" "$VERSION"'
        self.assertIn(guard, shell)
        for name, mutated in (
            ('removed identity gate', shell.replace(guard, ':')),
            ('removed candidate identity argument', shell.replace('--candidate-dir dist ', '')),
            ('publication uses provisional preflight', shell.replace('--candidate-dir dist ', '--preflight ')),
        ):
            with self.subTest(mutation=name), self.assertRaises(AssertionError):
                self.assert_equal_publication_is_immutable(mutated)

        checker = self.root / 'scripts/check-publish-version.sh'
        original = checker.read_text()
        comparison = 'if (old / name).read_bytes() != (Path(candidate_dir) / name).read_bytes():'
        self.assertIn(comparison, original)
        checker.write_text(original.replace(comparison, 'if False:'))
        try:
            with self.assertRaises(AssertionError):
                self.assert_equal_publication_is_immutable(shell)
        finally:
            checker.write_text(original)

    def test_publisher_rejects_incomplete_or_unbound_old_handoff(self):
        shell = self.publication_handoff_fixture()
        for mode in ('release', 'dev'):
            original = self.resume_payloads(mode)
            cases = {}
            for name in ('manifest.json', 'artifacts.json', 'changelog.json', 'daikin-altherma-esp32.bin'):
                missing = copy.deepcopy(original)
                del missing[name]
                cases[f'missing {name}'] = missing
                corrupt = copy.deepcopy(original)
                corrupt[name] = b'{corrupt'
                cases[f'corrupt {name}'] = corrupt
            manifest = json.loads(original['manifest.json'])
            for name, source in (('missing provenance', None), ('wrong source', 'b' * 40),
                                 ('malformed source', 'short')):
                old = copy.deepcopy(original)
                document = copy.deepcopy(manifest)
                if source is None:
                    del document['provenance']
                else:
                    document['provenance']['source_sha'] = source
                old['manifest.json'] = json.dumps(document).encode()
                cases[name] = old
            for name, old in cases.items():
                with self.subTest(mode=mode, old=name):
                    self.publish_fixture_handoff(mode, old)
                    result, mutated = self.execute_publisher_handoff(shell, mode, original)
                    self.assertNotEqual(result.returncode, 0, result.stdout.decode())
                    self.assertFalse(mutated)
            self.publish_fixture_handoff(mode, original, nonregular='changelog.json')
            result, mutated = self.execute_publisher_handoff(shell, mode, original)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(mutated)

    def test_publisher_rejects_malformed_candidate_source_version_and_channel(self):
        shell = self.publication_handoff_fixture()
        for mode in ('release', 'dev'):
            original = self.resume_payloads(mode)
            version = self.document['version']
            self.publish_fixture_handoff(mode, original)
            cases = {}
            for name in ('artifacts.json', 'changelog.json', 'daikin-altherma-esp32.bin'):
                missing = copy.deepcopy(original)
                del missing[name]
                cases[f'missing {name}'] = missing
                corrupt = copy.deepcopy(original)
                corrupt[name] = b'{corrupt'
                cases[f'corrupt {name}'] = corrupt
            malformed = copy.deepcopy(original)
            malformed['manifest.json'] = b'{malformed'
            cases['corrupt manifest'] = malformed
            for name, field, value in (('wrong source', 'source_sha', 'b' * 40),
                                       ('malformed source', 'source_sha', 'short'),
                                       ('unbound app', 'app_sha256', '0' * 64)):
                payloads = copy.deepcopy(original)
                document = json.loads(payloads['manifest.json'])
                document['provenance'][field] = value
                payloads['manifest.json'] = json.dumps(document).encode()
                cases[name] = payloads
            duplicate = copy.deepcopy(original)
            duplicate['changelog.json'] = ('{"version":"' + version +
                                           '","changelog":"First","changelog":"Second"}').encode()
            cases['duplicate changelog key'] = duplicate
            for name, candidate in cases.items():
                with self.subTest(mode=mode, candidate=name):
                    result, mutated = self.execute_publisher_handoff(shell, mode, candidate,
                                                                      offered_version=version)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(mutated)
            other_mode = 'dev' if mode == 'release' else 'release'
            result, mutated = self.execute_publisher_handoff(shell, other_mode, original)
            self.assertNotEqual(result.returncode, 0, 'candidate channel mismatch was accepted')
            self.assertFalse(mutated)
            result, mutated = self.execute_publisher_handoff(shell, mode, original, offered_version='9.9.9')
            self.assertNotEqual(result.returncode, 0, 'manifest/version mismatch was accepted')
            self.assertFalse(mutated)

    def test_forward_legacy_and_absent_feed_accept_complete_candidate(self):
        shell = self.publication_handoff_fixture()
        for mode in ('release', 'dev'):
            original = self.resume_payloads(mode)
            old_version = '1.2.2' if mode == 'release' else '1.2.3-dev.0'
            self.publish_fixture_handoff(mode, {'manifest.json': json.dumps({'version': old_version}).encode()})
            result, mutated = self.execute_publisher_handoff(shell, mode, original)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertTrue(mutated)
        # An existing root channel is distinct from an absent dev channel, and an absent branch is
        # distinct from a transport failure (covered by the shell entrypoint's unreachable remote).
        original = self.resume_payloads('dev')
        self.publish_fixture_handoff('release', {'manifest.json': b'{"version":"1.2.2"}'})
        result, mutated = self.execute_publisher_handoff(shell, 'dev', original)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertTrue(mutated)
        self.git('push', '-q', 'origin', ':refs/heads/gh-pages')
        result, mutated = self.execute_publisher_handoff(shell, 'dev', original)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertTrue(mutated)

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
    def assert_publication_source_binding(self, workflow):
        trusted = workflow.split('  trusted_build:\n', 1)[1].split('  publish:\n', 1)[0]
        name = '      - name: Bind requested publication source\n'
        guard = trusted.split(name, 1)[1].split('      - name:', 1)[0]
        self.assertIn('EXPECTED_SOURCE_SHA: ${{ inputs.expected_source_sha }}', guard)
        self.assertLess(trusted.index(name), trusted.index('- name: Decide the run mode'))
        shell = re.search(r'        run: \|\n((?:          .*\n|\n)+)', guard).group(1)
        source = 'a' * 40
        for requested, actual, expected in (
                (source, source, 0), ('', source, 0), (source, 'b' * 40, 2),
                ('a' * 39, 'a' * 39, 2), ('A' * 40, 'A' * 40, 2),
                ('g' * 40, 'g' * 40, 2), ('$(exit 0)', '$(exit 0)', 2)):
            result = subprocess.run(['bash', '-c', textwrap.dedent(shell)], capture_output=True,
                                    env={**os.environ, 'EXPECTED_SOURCE_SHA': requested,
                                         'GITHUB_SHA': actual}, timeout=5)
            self.assertEqual(result.returncode, expected, result.stderr.decode())

    def test_dispatch_source_binding_runs_before_publication(self):
        self.assert_publication_source_binding((PROJECT / '.github/workflows/build.yml').read_text())

    def test_dispatch_source_binding_controls_reject_regressions(self):
        workflow = (PROJECT / '.github/workflows/build.yml').read_text()
        name = '      - name: Bind requested publication source\n'
        start = workflow.index(name)
        end = workflow.index('      # This job is structurally restricted', start)
        guard = workflow[start:end]
        moved = workflow[:start] + workflow[end:]
        insertion = moved.index('      - name: Stamp firmware version\n')
        cases = {
            'accepts a moved main': workflow.replace('[ "$EXPECTED_SOURCE_SHA" = "$GITHUB_SHA" ]', 'true', 1),
            'accepts malformed source': workflow.replace('[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]', 'true', 1),
            'checks after versioning admission': moved[:insertion] + guard + moved[insertion:],
        }
        for name, mutated in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual(mutated, workflow)
                with self.assertRaises(AssertionError):
                    self.assert_publication_source_binding(mutated)

    @staticmethod
    def job_header(workflow, name):
        return workflow.split(f'  {name}:\n', 1)[1].split('    steps:', 1)[0]

    def job_runs(self, workflow, name, context, mechanical_result='success'):
        """Evaluate the production job condition's boolean subset, including implicit success()."""
        match = re.search(r'^    if: (.+)$', self.job_header(workflow, name), re.M)
        condition = match.group(1) if match else 'true'
        statuses = re.findall(r'\b(always|success|failure|cancelled)\(\)', condition)
        if name == 'build' and not statuses and mechanical_result != 'success':
            return False
        expression = condition.replace('&&', ' and ').replace('||', ' or ')
        expression = re.sub(r'!(?!=)', ' not ', expression)
        expression = re.sub(r'\btrue\b', 'True', expression)
        expression = re.sub(r'\bfalse\b', 'False', expression)
        for status in statuses:
            value = status == 'always' or mechanical_result == {
                'success': 'success', 'failure': 'failure', 'cancelled': 'cancelled',
            }.get(status)
            expression = expression.replace(f'{status}()', repr(value))
        for key, value in context.items():
            expression = expression.replace(key, repr(value))
        tree = ast.parse(expression.strip(), mode='eval')
        allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq,
                   ast.NotEq, ast.Constant, ast.UnaryOp, ast.Not)
        if any(not isinstance(node, allowed) for node in ast.walk(tree)):
            raise ValueError(f'unsupported workflow condition: {condition}')
        return bool(eval(compile(tree, '<workflow condition>', 'eval'), {'__builtins__': {}}, {}))

    def assert_pr_lifecycle(self, workflow, policy):
        for job in ('mechanical_gates', 'build'):
            self.assertNotIn('    concurrency:', self.job_header(workflow, job))
        for state, merged, expected in (('open', False, True), ('closed', True, False),
                                        ('closed', False, False), ('', False, False)):
            context = {'github.event_name': 'pull_request', 'inputs.release': False,
                       'github.event.pull_request.state': state,
                       'github.event.pull_request.merged': merged}
            self.assertEqual(self.job_runs(workflow, 'mechanical_gates', context), expected)
            # Even a failed/cancelled/skipped prerequisite must produce a blocking open-PR build.
            for result in ('success', 'failure', 'cancelled', 'skipped'):
                self.assertEqual(self.job_runs(workflow, 'build', context, result), expected)
            context['github.event_name'] = 'pull_request_target'
            self.assertEqual(self.job_runs(policy, 'gates', context), expected)
        for event, release, expected in (('push', False, True),
                                          ('workflow_dispatch', False, True),
                                          ('workflow_dispatch', True, False)):
            context = {'github.event_name': event, 'inputs.release': release,
                       'github.event.pull_request.state': ''}
            self.assertEqual(self.job_runs(workflow, 'mechanical_gates', context), expected)
            self.assertFalse(self.job_runs(workflow, 'build', context))

        # Run the actual aggregate assertion, rather than recreating its exit behavior in Python.
        guard = workflow.split('      - name: Require the mechanical gates\n', 1)[1]
        shell = re.search(r'        run: \|\n((?:          .*\n|\n)+)', guard).group(1)
        for result, expected in (('success', 0), ('failure', 2), ('cancelled', 2),
                                 ('skipped', 2), ('', 2)):
            run = subprocess.run(['bash', '-c', textwrap.dedent(shell)], capture_output=True,
                                 env={**os.environ, 'MECHANICAL_RESULT': result}, timeout=5)
            self.assertEqual(run.returncode, expected, run.stderr.decode())

    def test_open_pr_conditions_and_failure_propagation(self):
        self.assert_pr_lifecycle((PROJECT / '.github/workflows/build.yml').read_text(),
                                 (PROJECT / '.github/workflows/pr-policy.yml').read_text())

    def test_pr_lifecycle_controls_reject_regressions(self):
        workflow = (PROJECT / '.github/workflows/build.yml').read_text()
        policy = (PROJECT / '.github/workflows/pr-policy.yml').read_text()
        mechanical_guard = " && (github.event_name != 'pull_request' || github.event.pull_request.state == 'open')"
        build_guard = " && github.event.pull_request.state == 'open'"
        concurrency = '    concurrency:\n      group: fixture-pr\n      cancel-in-progress: true\n'
        cases = {
            'closed mechanical jobs': (workflow.replace(mechanical_guard, '', 1), policy),
            'closed build jobs': (workflow.replace(build_guard, '', 1), policy),
            'closed policy jobs': (workflow, policy.replace("    if: github.event.pull_request.state == 'open'\n", '', 1)),
            'mechanical supersession': (workflow.replace('  mechanical_gates:\n',
                                                        '  mechanical_gates:\n' + concurrency, 1), policy),
            'compile supersession': (workflow.replace('  build:\n', '  build:\n' + concurrency, 1), policy),
            'failure skips required build': (workflow.replace('if: always() &&', 'if: success() &&', 1), policy),
            'cancelled skips required build': (workflow.replace('if: always() &&', 'if: !cancelled() &&', 1), policy),
            'aggregate accepts incomplete tests': (workflow.replace('"$MECHANICAL_RESULT" = success',
                                                                   '"$MECHANICAL_RESULT" != failure', 1), policy),
        }
        for name, (mutated_workflow, mutated_policy) in cases.items():
            with self.subTest(name=name):
                self.assertNotEqual((mutated_workflow, mutated_policy), (workflow, policy),
                                    'mutation changed no production input')
                with self.assertRaises(AssertionError):
                    self.assert_pr_lifecycle(mutated_workflow, mutated_policy)

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
        for job in ('mechanical_gates', 'build', 'trusted_build', 'publish'):
            self.assertNotIn('    concurrency:', self.job_header(text, job))
        self.assertLess(text.index('- name: Verify public feed readback'), text.index('- name: Record dev publication proof'))
        self.assertLess(text.index('- name: Record dev publication proof'), text.index('- name: Upload dev publication proof'))


if __name__ == '__main__':
    unittest.main(verbosity=2)

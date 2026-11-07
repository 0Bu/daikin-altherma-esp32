#!/usr/bin/env python3
"""Offline regressions for single CI execution and complete manifest-first readback."""
import importlib.util
import re
import shutil
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('readback', ROOT / 'scripts/verify-published-artifacts.py')
readback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readback)


class PublicationEfficiencyTests(unittest.TestCase):
    def test_assembler_adds_root_control_without_changing_feed_payloads(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            for name in ('scripts/build-pages.sh', 'docs/index.html', 'docs/serial-port-release.mjs',
                         'docs/web-installer.mjs', 'docs/vendor/esptool-js-0.7.0.bundle.js',
                         'docs/vendor/esptool-js-0.7.0.LICENSE', 'main/www/heat_pump_icon.png',
                         'LICENSE', 'THIRD_PARTY_NOTICES.md', 'tools/web_asset/vendor/LICENSE',
                         'dist/manifest.json', 'dist/artifacts.json', 'dist/changelog.json', 'dist/app.bin'):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                if name == 'scripts/build-pages.sh':
                    shutil.copyfile(ROOT / name, target)
                else:
                    target.write_bytes(name.encode())
            for mode in ([], ['--dev']):
                result = subprocess.run(['bash', 'scripts/build-pages.sh', *mode], cwd=root,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / '_site/.nojekyll').read_bytes(), b'')
            self.assertFalse((root / '_site/dev/.nojekyll').exists())
            for entry in (root / '_site/dev').iterdir():
                self.assertEqual(entry.read_bytes(), (root / '_site' / entry.name).read_bytes())

    def test_stale_manifest_downloads_no_payload_and_current_checks_every_file(self):
        app = b'app'
        document = {'provenance': {'app_sha256': readback.sha256(app)}}
        payloads = {'manifest.json': b'manifest', 'artifacts.json': b'index',
                    'index.html': b'page', 'daikin-altherma-esp32.bin': app}
        fetched = []

        def fetch(url, limit, nonce):
            name = url.rsplit('/', 1)[-1]
            fetched.append(name)
            self.assertEqual(limit, len(payloads[name]))
            self.assertEqual(nonce, 'fixture')
            return payloads[name]

        with patch.object(readback, 'expected_site', return_value=(document, payloads)), \
                patch.object(readback, 'fetch', side_effect=lambda *_: b'old') as stale, \
                patch.object(readback, 'load_signing_checker') as signing:
            with self.assertRaisesRegex(readback.ReadbackError, 'manifest mismatch'):
                readback.verify_once('https://0bu.github.io/daikin-altherma-esp32/dev/', ROOT, 'fixture')
            self.assertEqual(stale.call_count, 1)
            self.assertTrue(stale.call_args.args[0].endswith('/manifest.json'))
            signing.assert_not_called()

        # Exercise the actual whole-inventory verifier with a valid JSON manifest.
        import json
        payloads['manifest.json'] = json.dumps(document).encode()
        with patch.object(readback, 'expected_site', return_value=(document, payloads)), \
                patch.object(readback, 'fetch', side_effect=fetch), \
                patch.object(readback, 'load_signing_checker') as signing:
            _, hashes = readback.verify_once('https://0bu.github.io/daikin-altherma-esp32/dev/', ROOT, 'fixture')
            self.assertEqual(fetched[0], 'manifest.json')
            self.assertCountEqual(fetched, payloads)
            self.assertEqual(set(hashes), set(payloads))
            signing.return_value.assert_called_once_with(app, unittest.mock.ANY)
            for corrupt in ('index.html', 'daikin-altherma-esp32.bin'):
                with self.subTest(corrupt=corrupt), patch.object(
                        readback, 'fetch', side_effect=lambda url, *_: b'wrong'
                        if url.endswith('/' + corrupt) else payloads[url.rsplit('/', 1)[-1]]):
                    with self.assertRaises(readback.ReadbackError):
                        readback.verify_once('https://0bu.github.io/daikin-altherma-esp32/dev/', ROOT, 'fixture')

    def test_empty_marker_remains_part_of_root_file_verification(self):
        with tempfile.TemporaryDirectory() as raw:
            site = Path(raw)
            (site / '.nojekyll').write_bytes(b'')
            (site / 'index.html').write_bytes(b'page')
            with patch.object(readback, 'REQUIRED_SITE_FILES', {'index.html'}), \
                    patch.object(readback, 'expected_artifacts', return_value=({}, {})):
                # Metadata is deliberately tiny but the production filesystem checks are real.
                for name in ('manifest.json', 'artifacts.json'):
                    (site / name).write_bytes(b'{}')
                _, payloads = readback.expected_site(site)
                self.assertEqual(payloads['.nojekyll'], b'')
                (site / '.nojekyll').write_bytes(b'unsafe')
                with self.assertRaises(readback.ReadbackError):
                    readback.expected_site(site)
                (site / '.nojekyll').unlink()
                (site / '.nojekyll').symlink_to(site / 'index.html')
                with self.assertRaises(readback.ReadbackError):
                    readback.expected_site(site)

    def test_ci_owns_each_expensive_selftest_once(self):
        workflow = (ROOT / '.github/workflows/build.yml').read_text()
        suite = (ROOT / 'scripts/run-ci-release-contract-tests.sh').read_text()
        for helper in ('check-manifest-provenance', 'check-signing-key-continuity',
                       'check-stack-budget', 'check-reproducible-build',
                       'verify-published-artifacts', 'production-ota-gate'):
            invocation = f'python3 scripts/{helper}.py --self-test'
            self.assertEqual(suite.count(invocation), 1, helper)
            self.assertNotIn(invocation, workflow, helper)
        for helper in ('check-sdkconfig-defaults', 'report-firmware-size'):
            self.assertEqual(workflow.count(f'python3 scripts/{helper}.py --self-test'), 1)
        publish = workflow.split('  publish:\n', 1)[1]
        for helper in ('check-manifest-provenance.py', 'check-web-installer-plan.py',
                       'generate-ota-changelog.py --validate'):
            self.assertNotIn(helper, publish)
        self.assertIn('check-signing-key-continuity.py dist/daikin-altherma-esp32.bin', publish)
        self.assertIn('check-publish-version.sh --candidate-dir dist --source-sha', publish)

    def test_history_and_trust_boundaries_survive_filtering(self):
        workflow = (ROOT / '.github/workflows/build.yml').read_text()
        for job in ('mechanical_gates', 'build', 'trusted_build', 'publish'):
            block = re.split(r'(?m)^  [a-z][a-z0-9_]*:\n', workflow.split(f'  {job}:\n', 1)[1])[0]
            self.assertIn('fetch-depth: 0', block)
            if job in ('trusted_build', 'publish'):
                self.assertIn('filter: blob:none', block)
            else:
                self.assertNotIn('filter: blob:none', block)
                self.assertIn('persist-credentials: false', block)
            if job == 'trusted_build':
                hydration = block.index('run: python3 scripts/prepare-ci-history.py')
                self.assertLess(hydration, block.index('- name: Provision OTA signing key'))
                self.assertLess(hydration, block.index('- name: Build firmware'))
                self.assertIn('target: esp32s3', block)
                self.assertNotIn('contents: write', block)
            if job == 'publish':
                self.assertNotIn('secrets.', block)
                self.assertIn('--attempts 30', block)
        relevant = re.search(r"relevant='([^']+)'", workflow).group(1)
        self.assertIsNotNone(re.search(relevant, 'scripts/prepare-ci-history.py'))


if __name__ == '__main__':
    unittest.main()

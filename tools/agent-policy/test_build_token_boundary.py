#!/usr/bin/env python3
"""Mutate the actual workflow and execute its production token-boundary canary."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
GUARD = "        if: github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == '0Bu/daikin-altherma-esp32'\n"
TOKEN = '          GH_TOKEN: ${{ github.token }}\n'


class TokenBoundaryTests(unittest.TestCase):
    def test_actual_boundary_rejects_token_exposure_mutations(self):
        workflow = (ROOT / '.github/workflows/build.yml').read_text()
        selftest = (ROOT / 'tools/agent-policy/selftest.sh').read_text()
        checker = selftest.split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
        marker = '      - name: Detect build-relevant changes\n'
        second_token = ('      - name: Unexpected token step\n'
                        '        env:\n' + TOKEN + '        run: true\n\n')
        cases = {
            'pristine': workflow,
            'missing guard': workflow.replace(GUARD, '', 1),
            'OR guard': workflow.replace(GUARD, GUARD.replace(' && ', ' || ', 1), 1),
            'PR event': workflow.replace(GUARD, GUARD.replace("'push'", "'pull_request'"), 1),
            'wrong ref': workflow.replace(GUARD, GUARD.replace('refs/heads/main', 'refs/heads/feature'), 1),
            'wrong repository': workflow.replace(GUARD, GUARD.replace('0Bu/daikin-altherma-esp32', 'example/fork'), 1),
            'job token': workflow.replace('  mechanical_gates:\n',
                '  mechanical_gates:\n    env:\n      GH_TOKEN: ${{ github.token }}\n', 1),
            'second token step': workflow.replace(marker, second_token + marker, 1),
            'duplicate resolver': workflow.replace(marker,
                '      - name: Resolve completed dev publication\n        run: true\n' + marker, 1),
            'secret in resolver': workflow.replace('          set -uo pipefail\n',
                '          echo "${{ secrets.EXAMPLE }}"\n          set -uo pipefail\n', 1),
            'override guard': workflow.replace('          set -uo pipefail\n',
                '        if: always()\n          set -uo pipefail\n', 1),
            'token in changes': workflow.replace(TOKEN, '', 1).replace(
                '          BEFORE: ${{ github.event.before }}\n', TOKEN + '          BEFORE: ${{ github.event.before }}\n', 1),
            'token in PR compile': workflow.replace('  build:\n',
                '  build:\n    env:\n      GH_TOKEN: ${{ github.token }}\n', 1),
        }
        with tempfile.TemporaryDirectory(prefix='daikin-token-canary-') as raw:
            fixture = Path(raw) / 'build.yml'
            for name, text in cases.items():
                with self.subTest(name=name):
                    if name != 'pristine':
                        self.assertNotEqual(text, workflow, 'mutation changed no production input')
                    fixture.write_text(text)
                    result = subprocess.run([sys.executable, '-c', checker,
                        str(ROOT / '.github/renovate.json'),
                        str(ROOT / '.github/workflows/renovate.yaml'), str(fixture),
                        str(ROOT / '.github/workflows/pr-policy.yml')],
                        capture_output=True, text=True, timeout=10)
                    if name == 'pristine':
                        self.assertEqual(result.returncode, 0, result.stderr)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertRegex(result.stderr, r'token|publication resolver')


if __name__ == '__main__':
    unittest.main(verbosity=2)

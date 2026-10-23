#!/usr/bin/env python3
"""Execute production event/path classifiers and inspect their actual folded job conditions.

Git histories and API-free shell fixtures prove deterministic routing. They do not reproduce the
GitHub scheduler, hosted runners, token permissions, publication or firmware/hardware behavior.
"""
import ast
import itertools
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest


PROJECT = Path(__file__).resolve().parents[2]
WORKFLOW = PROJECT / '.github/workflows/build.yml'
SCOPES = {'coredump', 'host_audits', 'agent_hooks', 'agent_config', 'agent_policy', 'domain',
          'absence', 'presenter', 'uigif', 'schematic', 'esp_idf_matrix', 'ota'}


def step_shell(workflow, name):
    tail = workflow.split(f'      - name: {name}\n', 1)[1].split('        run: |\n', 1)[1]
    lines = []
    for line in tail.splitlines():
        if line and not line.startswith('          '):
            break
        lines.append(line)
    return textwrap.dedent('\n'.join(lines))


def condition(workflow, job):
    """Read both single-line and YAML folded conditions, rather than treating >- as an expression."""
    header = workflow.split(f'  {job}:\n', 1)[1].split('    steps:', 1)[0]
    match = re.search(r'^    if: (.+)$', header, re.M)
    if not match:
        return 'true'
    if match.group(1) == '>-':
        folded = re.match(r'\n((?:      [^\n]+\n)+)', header[match.end():])
        if not folded:
            raise ValueError(f'empty folded job condition: {job}')
        return ' '.join(line.strip() for line in folded.group(1).splitlines())
    return match.group(1)


def job_runs(workflow, job, context, dependencies):
    """Evaluate only the boolean subset actually shipped, with implicit prerequisite success()."""
    expression = condition(workflow, job)
    statuses = re.findall(r'\b(always|success|failure|cancelled)\(\)', expression)
    if not statuses and any(state != 'success' for state in dependencies):
        return False
    results = {'always': True, 'success': all(s == 'success' for s in dependencies),
               'failure': 'failure' in dependencies, 'cancelled': 'cancelled' in dependencies}
    for name in statuses:
        expression = expression.replace(f'{name}()', repr(results[name]))
    for key in sorted(context, key=len, reverse=True):
        expression = expression.replace(key, repr(context[key]))
    expression = expression.replace('&&', ' and ').replace('||', ' or ')
    expression = re.sub(r'!(?!=)', ' not ', expression)
    expression = re.sub(r'\btrue\b', 'True', expression)
    expression = re.sub(r'\bfalse\b', 'False', expression)
    tree = ast.parse(expression.strip(), mode='eval')
    allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.NotEq,
               ast.Constant, ast.UnaryOp, ast.Not)
    if any(not isinstance(node, allowed) for node in ast.walk(tree)):
        raise ValueError(f'unsupported workflow condition: {condition(workflow, job)}')
    return bool(eval(compile(tree, '<production workflow condition>', 'eval'), {'__builtins__': {}}, {}))


class CIEventMatrixTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='daikin-ci-events-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.workflow = WORKFLOW.read_text()
        self.environment = {**os.environ, 'BASH_ENV': '', 'GIT_CONFIG_GLOBAL': os.devnull}
        self.git('init', '-q', '--template=')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'core.hooksPath', str(self.root / 'empty-hooks'))
        self.git('branch', '-M', 'main')
        self.write('README.md')
        self.write('main/hp_poll.cpp')
        self.commit()
        self.baseline = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, env=self.environment,
                                       stderr=subprocess.DEVNULL, text=True)

    def write(self, name):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('a') as output:
            output.write('fixture\n')

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'fixture: routing input')

    def execute(self, name, event='pull_request', workflow=None, **environment):
        output = self.root / 'workflow-output'
        output.write_text('')
        source = step_shell(workflow or self.workflow, name)
        source = source.replace('/tmp/changed-files.txt', str(self.root / 'changed-files.txt'))
        source = source.replace('/tmp/meta-changed.txt', str(self.root / 'meta-changed.txt'))
        target = self.git('rev-parse', 'HEAD').strip()
        source = source.replace('${{ github.event_name }}', event)
        source = source.replace('${{ github.ref }}', environment.pop('ref', 'refs/heads/main'))
        source = source.replace('${{ github.sha }}', target)
        run = subprocess.run(['bash', '--noprofile', '--norc', '-c', source], cwd=self.root,
                             env={**self.environment, 'GITHUB_OUTPUT': str(output),
                                  'BEFORE': '', 'DEV_STATE': '', 'DEV_SOURCE': '', **environment},
                             capture_output=True, text=True, timeout=10)
        values = dict(line.split('=', 1) for line in output.read_text().splitlines())
        return run, values

    def classify(self, expected, **context):
        run, values = self.execute('Detect build-relevant changes', **context)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(values, {'firmware': expected})

    def scope(self, expected, **context):
        run, values = self.execute('Scope the mutation self-tests to the tooling this diff touches', **context)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(set(values), SCOPES)
        self.assertEqual({key for key, value in values.items() if value == 'yes'}, set(expected))
        self.assertTrue(all(value in {'yes', 'no'} for value in values.values()))

    def git_diff_fixture(self, fail=False):
        binaries = self.root / 'fixture-bin'
        binaries.mkdir(exist_ok=True)
        executable = binaries / 'git'
        real_git = shutil.which('git')
        executable.write_text(textwrap.dedent(f'''\
            #!/usr/bin/env python3
            import os
            import sys
            if sys.argv[1] == 'diff':
                if {fail!r}:
                    sys.exit(9)
                sys.stdout.write('main/hp_poll.cpp\\n' + ('zz_unrelated/' + 'x' * 180 + '\\n') * 4000)
                sys.exit(0)
            os.execv({real_git!r}, [{real_git!r}, *sys.argv[1:]])
        '''))
        executable.chmod(0o755)
        return f'{binaries}{os.pathsep}{self.environment["PATH"]}'

    def test_actual_pr_merge_parent_and_entire_pr_history(self):
        self.git('checkout', '-qb', 'fixture-docs')
        self.write('docs/ARCHITECTURE.md')
        self.commit()
        self.write('docs/ARCHITECTURE.md')
        self.commit()
        self.git('checkout', '-q', 'main')
        self.write('main/hp_poll.cpp')
        self.commit()
        self.git('merge', '--no-ff', '-qm', 'fixture: docs merge ref', 'fixture-docs')
        self.classify('no')
        self.git('checkout', '-qb', 'fixture-firmware')
        self.write('main/hp_poll.cpp')
        self.commit()
        self.write('docs/ARCHITECTURE.md')
        self.commit()
        self.git('checkout', '-q', 'main')
        self.write('README.md')
        self.commit()
        self.git('merge', '--no-ff', '-qm', 'fixture: firmware merge ref', 'fixture-firmware')
        self.classify('yes')

    def test_actual_build_input_path_matrix(self):
        positives = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'main/hp_poll.cpp', 'main/www/index.html',
                     'CMakeLists.txt', 'sdkconfig.defaults', 'dependencies.lock', 'partitions.csv',
                     'version.txt', 'docs/index.html', 'docs/serial-port-release.mjs',
                     'docs/web-installer.mjs', 'docs/vendor/esptool-js-0.7.0.bundle.js',
                     'docs/vendor/esptool-js-0.7.0.LICENSE', '.github/workflows/build.yml',
                     'scripts/pages-commit-payload.mjs', 'tools/version/fixture.py',
                     'tools/web_asset/fixture.py', 'tools/release/fixture.py', 'tools/stack/fixture.py']
        positives += [f'scripts/{name}.sh' for name in (
            'ci-build-all', 'build-pages', 'next-version', 'publish-pages-branch', 'require-signed',
            'check-publish-version', 'idf-version', 'check-nonflashable-artifacts', 'check-dev-manifest-source')]
        positives += [f'scripts/{name}.py' for name in (
            'generate-ota-changelog', 'check-sdkconfig-defaults', 'report-firmware-size',
            'check-web-installer-plan', 'check-manifest-provenance', 'check-signing-key-continuity',
            'check-stack-budget', 'check-reproducible-build', 'verify-published-artifacts', 'production-ota-gate')]
        negatives = ['README.md', 'docs/ARCHITECTURE.md', 'docs/REGISTERS.md', 'docs/FEATURES.md',
                     '.github/workflows/cleanup-pr-artifacts.yml', '.github/workflows/pr-policy.yml',
                     'test/test_logic.cpp', 'tools/domain/fixture.py', 'mainly/unrelated.cpp',
                     'docs/web-installer.mjs.backup', 'scripts/ci-build-all.sh.backup',
                     'docs/vendor/esptool-js-0.7.0.bundle.js.backup', 'docs/vendor/README.md']
        for name, expected in [(p, 'yes') for p in positives] + [(p, 'no') for p in negatives]:
            with self.subTest(path=name):
                self.write(name)
                self.commit()
                self.classify(expected)

    def test_dispatch_unknown_event_and_nonmain_push_ranges(self):
        self.classify('yes', event='workflow_dispatch')
        self.classify('yes', event='unexpected_event')
        self.write('README.md')
        self.commit()
        self.classify('no', event='push', ref='refs/heads/fixture', BEFORE=self.baseline)
        for before in ('', '0' * 40, 'f' * 40):
            self.classify('yes', event='push', ref='refs/heads/fixture', BEFORE=before)
        self.write('main/hp_poll.cpp')
        self.commit()
        self.classify('yes', event='push', ref='refs/heads/fixture', BEFORE=self.baseline)

    def test_diff_failure_and_large_path_list_cannot_report_no_firmware(self):
        self.write('README.md')
        self.commit()
        self.classify('yes', PATH=self.git_diff_fixture())
        run, values = self.execute('Detect build-relevant changes', PATH=self.git_diff_fixture(fail=True))
        self.assertNotEqual(run.returncode, 0, 'a failed Git diff must stop the classifier')
        self.assertNotEqual(values.get('firmware'), 'no')
        self.scope(SCOPES, PATH=self.git_diff_fixture(fail=True))

    def test_actual_mutation_scope_mapping_and_fallback(self):
        mapping = {
            'scripts/run-decode-coredump-tests.sh': {'coredump'},
            'scripts/run-host-audit-reuse-tests.sh': {'host_audits'},
            '.agents/hooks.json': {'agent_hooks', 'agent_config'},
            'nested/AGENTS.md': {'agent_config'},
            '.github/workflows/pr-policy.yml': {'agent_policy'},
            'docs/REGISTERS.md': {'domain'},
            'tools/fixture/anything.txt': {'absence'},
            'scripts/check-presenter-parity.sh': {'presenter', 'host_audits'},
            'docs/media/fixture.txt': {'uigif'},
            'docs/DESIGN.md': {'schematic'},
            'docs/ESP_IDF_MATRIX.md': {'esp_idf_matrix'},
            'scripts/production-ota-gate.py': {'ota', 'agent_hooks'},
            'main/www/fixture.html': {'absence', 'presenter', 'uigif', 'schematic', 'esp_idf_matrix'},
            'main/logic/ota_fixture.hpp': {'ota', 'domain', 'absence', 'presenter', 'esp_idf_matrix'},
            'main/mqtt_ha.cpp': {'ota', 'absence', 'esp_idf_matrix'},
            'main/CMakeLists.txt': {'ota', 'absence', 'esp_idf_matrix'},
            'tools/stack/fixture.json': {'ota', 'absence'},
            'tools/agent-hooks/agent_hook.py': {'ota', 'agent_hooks', 'absence'},
            'scripts/check-manifest-provenance.py': {'ota'},
            'docs/FEATURES.md': {'ota'},
            'sdkconfig.defaults': {'ota', 'coredump', 'absence', 'esp_idf_matrix'},
            'README.md': {'uigif'},
            'docs/ARCHITECTURE.md': set(),
        }
        for name, expected in mapping.items():
            with self.subTest(path=name):
                self.write(name)
                self.commit()
                self.scope(expected)
        for event in ('push', 'workflow_dispatch', 'unknown'):
            self.scope(SCOPES, event=event)
        self.write('.github/workflows/build.yml')
        self.commit()
        self.scope(SCOPES)

    def test_folded_trusted_build_and_publisher_admission(self):
        results = ('success', 'failure', 'cancelled', 'skipped')
        for event, ref, release, mechanical, firmware in itertools.product(
                ('push', 'workflow_dispatch', 'pull_request', 'pull_request_target'),
                ('refs/heads/main', 'refs/heads/fixture'), (False, True), results, ('yes', 'no', '')):
            context = {'github.event_name': event, 'github.ref': ref, 'inputs.release': release,
                       'needs.mechanical_gates.result': mechanical,
                       'needs.mechanical_gates.outputs.firmware': firmware}
            expected = ref == 'refs/heads/main' and event in {'push', 'workflow_dispatch'} and (
                (event == 'workflow_dispatch' and release) or (mechanical == 'success' and firmware == 'yes'))
            with self.subTest(event=event, ref=ref, release=release, mechanical=mechanical, firmware=firmware):
                self.assertEqual(job_runs(self.workflow, 'trusted_build', context, [mechanical]), expected)
        for trusted, ancestor in itertools.product(results, results):
            context = {'needs.trusted_build.result': trusted}
            with self.subTest(trusted=trusted, transitive_mechanical=ancestor):
                self.assertEqual(job_runs(self.workflow, 'publish', context, [trusted, ancestor]), trusted == 'success')

    def test_controls_reject_wrong_merge_range_path_scope_and_publish_admission(self):
        # The real first-parent classifier must exclude independent firmware changes on main.
        self.git('checkout', '-qb', 'fixture-docs-control')
        self.write('docs/ARCHITECTURE.md')
        self.commit()
        self.git('checkout', '-q', 'main')
        self.write('main/hp_poll.cpp')
        self.commit()
        self.git('merge', '--no-ff', '-qm', 'fixture: mutation merge ref', 'fixture-docs-control')
        mutated = self.workflow.replace('range="HEAD^1 HEAD"', 'range="HEAD^2 HEAD"')
        self.assertNotEqual(mutated, self.workflow)
        with self.assertRaises(AssertionError):
            self.classify('no', workflow=mutated)
        self.write('LICENSE')
        self.commit()
        mutated = self.workflow.replace('^(LICENSE$|', '^(')
        self.assertNotEqual(mutated, self.workflow)
        with self.assertRaises(AssertionError):
            self.classify('yes', workflow=mutated)
        self.write('scripts/production-ota-gate.py')
        self.commit()
        mutated = self.workflow.replace("emit ota '^(", "emit ota '^never-match/(")
        self.assertNotEqual(mutated, self.workflow)
        with self.assertRaises(AssertionError):
            self.scope({'ota', 'agent_hooks'}, workflow=mutated)
        mutated = self.workflow.replace('    if: always() && needs.trusted_build.result',
                                        '    if: needs.trusted_build.result')
        self.assertNotEqual(mutated, self.workflow)
        with self.assertRaises(AssertionError):
            self.assertTrue(job_runs(mutated, 'publish', {'needs.trusted_build.result': 'success'},
                                     ['success', 'skipped']))


if __name__ == '__main__':
    unittest.main(verbosity=2)

// Execute the final production release-tag guard with offline Git failures. No release is created.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Rebind release tag immediately before release mutation\n')[1]
    ?.split('\n      - name:')[0];
assert.ok(step, 'production release-tag guard is present');
const run = step.split('        run: |\n')[1];
assert.ok(run, 'production release-tag guard has an executable body');
const guard = run.split('\n').filter(line => line.startsWith('          '))
    .map(line => line.slice(10)).join('\n') + '\n';
const fixture = mkdtempSync(join(tmpdir(), 'daikin-release-tag-'));
const source = 'a'.repeat(40);

function exercise(body, remoteStatus, tag = source, fetchStatus = 0, resolveStatus = 0) {
  const calls = join(fixture, 'calls');
  const mutation = join(fixture, 'mutation');
  rmSync(calls, {force: true});
  rmSync(mutation, {force: true});
  writeFileSync(join(fixture, 'git'), `#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE_CALLS"
case "$1" in
  ls-remote) exit ${remoteStatus} ;;
  fetch) exit ${fetchStatus} ;;
  rev-parse) printf '%s\\n' '${tag}'; exit ${resolveStatus} ;;
  *) exit 90 ;;
esac
`, {mode: 0o755});
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c',
    body + 'printf admitted > "$FIXTURE_MUTATION"\n'], {
    cwd: fixture,
    env: {PATH: `${fixture}:/usr/bin:/bin`, VERSION: '1.2.3', SOURCE_SHA: source,
      FIXTURE_CALLS: calls, FIXTURE_MUTATION: mutation},
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  const callList = readFileSync(calls, 'utf8').trim().split('\n');
  const admitted = (() => {
    try { return readFileSync(mutation, 'utf8') === 'admitted'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  })();
  return {status: result.status, admitted, callList};
}

try {
  const absent = exercise(guard, 2);
  assert.equal(absent.status, 0, 'a confirmed absent tag may be created');
  assert.equal(absent.admitted, true);
  assert.equal(absent.callList.length, 1, 'an absent tag needs no fetch');
  const bound = exercise(guard, 0);
  assert.equal(bound.status, 0, 'an existing tag bound to this source may resume');
  assert.equal(bound.admitted, true);
  assert.deepEqual(bound.callList, [
    'ls-remote --exit-code --tags origin refs/tags/v1.2.3',
    'fetch --quiet --no-tags --force origin refs/tags/v1.2.3:refs/tags/v1.2.3',
    'rev-parse v1.2.3^{commit}',
  ]);
  for (const status of [1, 3, 128]) {
    const unknown = exercise(guard, status);
    assert.notEqual(unknown.status, 0, `unknown tag lookup (${status}) stops publication`);
    assert.equal(unknown.admitted, false);
    assert.equal(unknown.callList.length, 1, 'unknown lookup never starts a fetch');
  }
  for (const [label, args] of [
    ['wrong source', [0, 'b'.repeat(40)]],
    ['empty source', [0, '']],
    ['fetch failure', [0, source, 9]],
    ['resolve failure', [0, source, 0, 8]],
  ]) {
    const rejected = exercise(guard, ...args);
    assert.notEqual(rejected.status, 0, `${label} stops publication`);
    assert.equal(rejected.admitted, false);
  }
  // Restore the exact old fail-open branch: the transport countercheck must admit mutation.
  const mutant = guard.replace(
      /\nelif \[ "\$tag_lookup_status" -ne 2 \]; then[\s\S]*?\nfi/m, '\nfi');
  assert.notEqual(mutant, guard, 'negative control removes the unknown-lookup refusal');
  const control = exercise(mutant, 128);
  assert.equal(control.status, 0);
  assert.equal(control.admitted, true, 'negative control recreates the original defect');
  console.log('release-tag guard: 9 production cases and the fail-open negative control passed');
} finally {
  rmSync(fixture, {recursive: true, force: true});
}

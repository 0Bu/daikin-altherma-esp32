#!/usr/bin/env python3
"""Bind a dev-build skip to a valid feed and a completed, digest-bound publisher."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "0Bu/daikin-altherma-esp32"
WORKFLOW = ".github/workflows/build.yml"
PROOF_FILE = "dev-publication-proof.json"
SHA = re.compile(r"[0-9a-f]{40}")
DEV_VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-dev\.(?:0|[1-9][0-9]*)")


class Unproven(ValueError):
    """Missing or incompatible evidence must trigger a build, never a skip."""


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


readback = load_script('verify-published-artifacts.py')
provenance = load_script('check-manifest-provenance.py')
signing = load_script('check-signing-key-continuity.py')


def git(*args, limit=32 * 1024 * 1024):
    result = subprocess.run(['git', *args], cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode or len(result.stdout) > limit:
        raise Unproven('Git input is unavailable or exceeds its limit')
    return result.stdout


def positive(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def slice_digest(payloads):
    inventory = {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()}
    return hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def selected_idf(source, directory):
    # Use the canonical pin reader against the original source workflow, not today's toolchain.
    mirror = directory / 'source-pin'
    (mirror / '.github/workflows').mkdir(parents=True)
    (mirror / 'scripts').mkdir()
    (mirror / '.github/workflows/build.yml').write_bytes(git('show', f'{source}:{WORKFLOW}'))
    shutil.copyfile(ROOT / 'scripts/idf-version.sh', mirror / 'scripts/idf-version.sh')
    result = subprocess.run(['bash', str(mirror / 'scripts/idf-version.sh')],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    if result.returncode:
        raise Unproven('original source has no compatible ESP-IDF pin')
    return result.stdout.decode().strip()


def validate_feed(pages, target, directory):
    entries = git('ls-tree', '-z', f'{pages}:dev').split(b'\0')
    entries = [entry for entry in entries if entry]
    if not entries or len(entries) > readback.MAX_SITE_FILES:
        raise Unproven('dev slice has no bounded file inventory')
    site = directory / 'dev'
    site.mkdir()
    total = 0
    for entry in entries:
        metadata, raw_name = entry.split(b'\t', 1)
        mode, kind, oid = metadata.decode('ascii').split()
        name = raw_name.decode('ascii')
        if mode not in ('100644', '100755') or kind != 'blob' or not readback.SITE_NAME_RE.fullmatch(name):
            raise Unproven('dev slice contains a non-regular or unsafe entry')
        size = int(git('cat-file', '-s', oid, limit=100))
        total += size
        if not 0 < size <= readback.MAX_SITE_FILE or total > readback.MAX_SITE_TOTAL:
            raise Unproven('dev slice exceeds its byte limits')
        (site / name).write_bytes(git('cat-file', 'blob', oid, limit=readback.MAX_SITE_FILE))
    document, payloads = readback.expected_site(site)
    source = document.get('provenance', {}).get('source_sha')
    if not isinstance(source, str) or not SHA.fullmatch(source):
        raise Unproven('manifest has no valid source SHA')
    if not isinstance(document.get('version'), str) or not DEV_VERSION.fullmatch(document['version']):
        raise Unproven('manifest has no compatible dev version')
    builds = document.get('builds')
    if not isinstance(builds, list) or len(builds) != 1 or not isinstance(builds[0], dict) \
            or builds[0].get('chipFamily') != 'ESP32-S3':
        raise Unproven('manifest has no compatible ESP32-S3 installer build')
    target_sha = git('rev-parse', '--verify', f'{target}^{{commit}}').decode().strip()
    git('cat-file', '-e', f'{source}^{{commit}}')
    git('merge-base', '--is-ancestor', source, target_sha)
    lock = directory / 'dependencies.lock'
    lock.write_bytes(git('show', f'{source}:dependencies.lock'))
    partitions = directory / 'partitions.csv'
    partitions.write_bytes(git('show', f'{source}:partitions.csv'))
    plan = subprocess.run([sys.executable, str(ROOT / 'scripts/check-web-installer-plan.py'),
                           str(site / 'manifest.json'), str(partitions)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if plan.returncode:
        raise Unproven('manifest has an incompatible or NVS-destructive installer plan')
    with contextlib.redirect_stdout(io.StringIO()):
        provenance.check(site / 'manifest.json', site / 'daikin-altherma-esp32.bin',
                         source, selected_idf(source, directory), lock)
    signing.check_image(payloads['daikin-altherma-esp32.bin'], provenance.pinned_signing_digest())
    return source, target_sha, payloads


def gh_api(endpoint, *, binary=False):
    # The wrapper passes credentials only to its child. Never log the environment or API payloads.
    result = subprocess.run([str(ROOT / 'scripts/gh-with-git-credentials.sh'),
                             'api', '--method', 'GET', endpoint], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode or len(result.stdout) > 1024 * 1024:
        raise Unproven('publication evidence API unavailable or oversized')
    return result.stdout if binary else json.loads(result.stdout)


def completed_publication(source, payloads, api=None):
    api = api or gh_api
    prefix = f'repos/{REPOSITORY}/actions'
    response = api(f'{prefix}/workflows/build.yml/runs?branch=main&event=push&head_sha={source}&per_page=10')
    current = os.environ.get('GITHUB_RUN_ID')
    runs = response.get('workflow_runs') if isinstance(response, dict) else None
    if not isinstance(runs, list):
        raise Unproven('workflow run inventory is invalid')
    # Never fall back to an older green run behind a newer failed publication of the same source.
    candidates = [run for run in runs if str(run.get('id')) != current]
    if not candidates:
        raise Unproven('no completed dev publisher for this source')
    run = candidates[0]
    if (run.get('head_sha') != source or run.get('head_branch') != 'main'
            or run.get('event') != 'push' or run.get('status') != 'completed'
            or run.get('conclusion') != 'success' or run.get('path', '').split('@')[0] != WORKFLOW
            or run.get('repository', {}).get('full_name', '').casefold() != REPOSITORY.casefold()
            or not positive(run.get('id')) or not positive(run.get('run_attempt'))):
        raise Unproven('latest source run is not a completed authoritative publisher')
    run_id, attempt = run['id'], run['run_attempt']
    jobs = api(f'{prefix}/runs/{run_id}/attempts/{attempt}/jobs?per_page=100').get('jobs', [])
    publishers = [job for job in jobs if job.get('name') == 'publish']
    if len(publishers) != 1:
        raise Unproven('publisher job is missing or ambiguous')
    job = publishers[0]
    required = {'Verify public feed readback', 'Upload dev publication proof'}
    passed = {step.get('name') for step in job.get('steps', [])
              if step.get('status') == 'completed' and step.get('conclusion') == 'success'}
    if job.get('status') != 'completed' or job.get('conclusion') != 'success' or not required <= passed:
        raise Unproven('publication/readback/proof did not complete successfully')
    artifacts = api(f'{prefix}/runs/{run_id}/artifacts?per_page=100').get('artifacts', [])
    proofs = [item for item in artifacts if item.get('name') == f'dev-publication-proof-{attempt}']
    if len(proofs) != 1 or proofs[0].get('expired') is not False or not positive(proofs[0].get('id')):
        raise Unproven('publication proof missing, expired or ambiguous')
    archive = api(f'{prefix}/artifacts/{proofs[0]["id"]}/zip', binary=True)
    if len(archive) > 65536:
        raise Unproven('publication proof archive exceeds its limit')
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        if zipped.namelist() != [PROOF_FILE] or zipped.getinfo(PROOF_FILE).file_size > 8192:
            raise Unproven('publication proof archive has an incompatible shape')
        proof = json.loads(zipped.read(PROOF_FILE))
    expected = {'schema_version': 1, 'repository': REPOSITORY, 'workflow': WORKFLOW,
                'source_sha': source, 'run_id': run_id, 'run_attempt': attempt,
                'manifest_sha256': hashlib.sha256(payloads['manifest.json']).hexdigest(),
                'site_sha256': slice_digest(payloads)}
    if not isinstance(proof, dict) or type(proof.get('schema_version')) is not int \
            or not positive(proof.get('run_id')) or not positive(proof.get('run_attempt')) \
            or any(proof.get(key) != value for key, value in expected.items()) \
            or not isinstance(proof.get('pages_commit'), str) or not SHA.fullmatch(proof['pages_commit']):
        raise Unproven('publication proof does not bind this exact dev slice and completed run')


def resolve(pages, target):
    # A complete rerun must execute recovery, including the public readback which may have failed.
    if int(os.environ.get('GITHUB_RUN_ATTEMPT', '1')) > 1:
        raise Unproven('full workflow rerun requires publication recovery')
    with tempfile.TemporaryDirectory(prefix='daikin-dev-feed-') as raw:
        source, target_sha, payloads = validate_feed(pages, target, Path(raw))
        completed_publication(source, payloads)
    if source == target_sha:
        # Private protocol with the shell wrapper: interpreter/import failures normally exit 1.
        return 3
    print(source)
    return 0


def record(site, pages, output):
    if not SHA.fullmatch(pages):
        raise Unproven('proof requires the exact published Pages commit')
    document, payloads = readback.expected_site(Path(site))
    source = os.environ['GITHUB_SHA']
    if document.get('provenance', {}).get('source_sha') != source or not SHA.fullmatch(source):
        raise Unproven('proof source differs from the publisher source')
    if os.environ['GITHUB_REPOSITORY'] != REPOSITORY:
        raise Unproven('proof repository differs from the authoritative repository')
    proof = {'schema_version': 1, 'repository': REPOSITORY, 'workflow': WORKFLOW,
             'source_sha': source, 'pages_commit': pages,
             'run_id': int(os.environ['GITHUB_RUN_ID']),
             'run_attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
             'manifest_sha256': hashlib.sha256(payloads['manifest.json']).hexdigest(),
             'site_sha256': slice_digest(payloads)}
    if not positive(proof['run_id']) or not positive(proof['run_attempt']):
        raise Unproven('proof has an invalid run identity')
    directory = Path(output)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / PROOF_FILE).write_text(json.dumps(proof, sort_keys=True) + '\n')


def main():
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'resolve':
            return resolve(sys.argv[2], sys.argv[3])
        if len(sys.argv) == 5 and sys.argv[1] == 'record':
            record(*sys.argv[2:])
            return 0
        raise Unproven('usage: dev_publication.py resolve PAGES TARGET | record SITE PAGES OUTPUT')
    except (Exception, SystemExit) as error:
        print(f'dev publication unproven: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env bash
# Run the release test suite on a frozen checkout before pushing a maintainer branch.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -ne 3 ]; then
    echo "usage: run-local-release-checks.sh host|browser BASE_SHA HEAD_SHA" >&2
    exit 2
fi
phase="$1"
base="$2"
candidate="$3"
tested="$(git rev-parse --verify HEAD)"
[[ "$base" =~ ^[0-9a-f]{40}$ && "$candidate" =~ ^[0-9a-f]{40}$ ]]
[ "$(git rev-parse --verify HEAD^1)" = "$base" ]
git merge-base --is-ancestor "$candidate" "$tested"

check() {
    printf '\nLocal release check: %s\n' "$*"
    "$@"
}

case "$phase" in
    browser)
        unset DAIKIN_BROWSER_CONTAINER DAIKIN_BROWSER_ALLOW_LOCAL_SKIP DAIKIN_BROWSER_BIN
        unset DAIKIN_BROWSER_IMAGE DAIKIN_BROWSER_ENGINE
        unset DAIKIN_BROWSER_FLAGS DAIKIN_BROWSER_WORKERS
        DAIKIN_BROWSER_PARALLEL=1 DAIKIN_BROWSER_TIMEOUT_MS=900000 BEFORE="$base" \
            check scripts/run-browser-render-tests.sh --if-ui-changed
        exit 0 ;;
    host) export CLANG_FORMAT=clang-format-18 ;;
    *) echo "Unknown local release phase: $phase" >&2; exit 2 ;;
esac

check scripts/run-pr-hygiene-audit.sh --base "$base" --head "$candidate" --event-file ''
check tools/pr_hygiene/selftest.sh
check tools/coverage/selftest.sh
# Reuse the former GitHub coverage profile with Ubuntu's Linux x86-64 compiler.
# The native mock run still supplies the host evidence consumed during OTA.
coverage_recipe=tools/release/Coverage.Dockerfile
coverage_image="daikin-altherma-esp32-release-coverage:$(git hash-object "$coverage_recipe")"
if ! docker image inspect "$coverage_image" >/dev/null 2>&1; then
    docker build --platform linux/amd64 --tag "$coverage_image" - < "$coverage_recipe"
fi
check docker run --rm --platform linux/amd64 --network none \
    --user "$(id -u):$(id -g)" --volume "$PWD:/project" --workdir /project \
    --env GIT_CONFIG_GLOBAL=/dev/null --env GIT_CONFIG_NOSYSTEM=1 --env GIT_NO_LAZY_FETCH=1 \
    --env GITHUB_ACTIONS=true --env RUNNER_OS=Linux --env ImageOS=ubuntu26 \
    "$coverage_image" bash -ec 'test "$(uname -m)" = x86_64
        test "$(g++ -dumpversion)" = 15
        exec scripts/run-mock-tests.sh --coverage'
case "$(uname -s)" in
    Darwin)
        check scripts/idf-docker.sh --with-host-tests env CI=1 CXX=clang++-18 \
            scripts/run-sanitizer-fuzz-tests.sh ;;
    *)
        CI=1 check scripts/run-sanitizer-fuzz-tests.sh ;;
esac
check scripts/run-runtime-integration-tests.sh
check scripts/run-format-check.sh
check tools/format/selftest.sh
check tools/presenter/selftest.sh
check scripts/run-ui-localization-audit.sh
check node tools/ui_localization/selftest.mjs
check scripts/run-ui-use-case-tests.sh
check node tools/ota/selftest.mjs
check node tools/production_ota/selftest.mjs
check tools/absence/selftest.sh
check scripts/run-esp-idf-matrix-audit.sh
check tools/esp_idf_matrix/selftest.sh
check scripts/run-domain-audit.sh
check tools/domain/selftest.sh
check scripts/run-description-audit.sh
check tools/descriptions/selftest.sh
check scripts/run-user-docs-audit.sh
check tools/user_docs/selftest.sh
check scripts/run-diagnostic-evidence-audit.sh
check tools/diagnostic_evidence/selftest.sh
check scripts/run-schematic-audit.sh
check tools/schematic/selftest.sh
check scripts/run-redaction-audit.sh
check tools/redact/selftest.sh
check scripts/run-doc-entity-audit.sh
check tools/docs/selftest.sh
check scripts/run-host-audit-reuse-tests.sh
check scripts/run-ui-gif-audit.sh
check tools/uigif/selftest.sh
check scripts/run-pages-publish-tests.sh
check scripts/run-web-installer-plan-tests.sh
check scripts/run-publish-version-tests.sh
check scripts/run-ci-release-contract-tests.sh
check scripts/run-decode-coredump-tests.sh
check scripts/run-decode-coredump-integration-tests.sh
check python3 scripts/check-sdkconfig-defaults.py --self-test
check python3 scripts/report-firmware-size.py --self-test
check scripts/run-agent-instructions-budget.sh
check scripts/run-skill-audit.sh
check tools/agent-config/selftest.sh
check tools/skill_audit/selftest.sh
check python3 tools/agent-hooks/test_agent_hooks.py
check python3 tools/agent-hooks/test_push_gate.py
check tools/agent-hooks/selftest.sh
check tools/agent-policy/selftest.sh

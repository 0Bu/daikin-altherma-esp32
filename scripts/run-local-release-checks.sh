#!/usr/bin/env bash
# Run the release test suite on a frozen checkout before pushing a maintainer branch.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -ne 2 ]; then
    echo "usage: run-local-release-checks.sh BASE_SHA HEAD_SHA" >&2
    exit 2
fi
base="$1"
candidate="$2"
tested="$(git rev-parse --verify HEAD)"
[[ "$base" =~ ^[0-9a-f]{40}$ && "$candidate" =~ ^[0-9a-f]{40}$ ]]
[ "$(git rev-parse --verify HEAD^1)" = "$base" ]
git merge-base --is-ancestor "$candidate" "$tested"

export CLANG_FORMAT=clang-format-18
unset DAIKIN_BROWSER_CONTAINER DAIKIN_BROWSER_ALLOW_LOCAL_SKIP DAIKIN_BROWSER_BIN
unset DAIKIN_BROWSER_IMAGE DAIKIN_BROWSER_ENGINE
unset DAIKIN_BROWSER_FLAGS DAIKIN_BROWSER_WORKERS
export DAIKIN_BROWSER_TIMEOUT_MS=900000

check() {
    printf '\nLocal release check: %s\n' "$*"
    "$@"
}

check scripts/run-pr-hygiene-audit.sh --base "$base" --head "$candidate" --event-file ''
check tools/pr_hygiene/selftest.sh
check tools/coverage/selftest.sh
CI=1 check scripts/run-sanitizer-fuzz-tests.sh
check scripts/run-runtime-integration-tests.sh
check scripts/run-format-check.sh
check tools/format/selftest.sh
check tools/presenter/selftest.sh
check scripts/run-ui-localization-audit.sh
check node tools/ui_localization/selftest.mjs
check scripts/run-ui-use-case-tests.sh
BEFORE="$base" check scripts/run-browser-render-tests.sh --if-ui-changed
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

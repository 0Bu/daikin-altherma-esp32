#!/usr/bin/env bash
# One runner-neutral PR policy gate for local hooks and authoritative CI.
#
# CI contract:
#   AGENT_POLICY_CI=1
#   AGENT_PR_BODY_FILE=/path/to/body.md
#   AGENT_PR_HEAD_SHA=<7..40 hex>
#   AGENT_CHANGED_FILES_FILE=/path/to/files.txt
# Optional authoritative-CI context for the narrow Renovate Action-pin-line exception:
#   AGENT_PR_METADATA_FILE=/path/to/pr.json
#   AGENT_PR_HEAD_COMMIT_FILE=/path/to/head-commit.json
#   AGENT_PR_HEAD_COMMIT_PAGES_FILE=/path/to/head-commit-pages.json
# Optional local discovery: --pr <number-or-url>, or a merge-tool JSON payload on stdin.
# Exit 0 = pass/not a merge; exit 2 = policy/input/discovery failure.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canonical_root="$(cd "$here/../.." && pwd)"
# shellcheck source=/dev/null
. "$here/pr-gate-lib.sh"

body_file="${AGENT_PR_BODY_FILE:-}"
head_sha="${AGENT_PR_HEAD_SHA:-}"
files_file="${AGENT_CHANGED_FILES_FILE:-}"
pr_metadata_file="${AGENT_PR_METADATA_FILE:-}"
head_commit_file="${AGENT_PR_HEAD_COMMIT_FILE:-}"
head_commit_pages_file="${AGENT_PR_HEAD_COMMIT_PAGES_FILE:-}"
selector="${AGENT_PR_SELECTOR:-}"
requested_root="${AGENT_PROJECT_DIR:-${PROJECT_DIR:-$canonical_root}}"
payload_file=""
force_check="${AGENT_POLICY_CI:-0}"
allow_discovery=1
[ "${AGENT_POLICY_CI:-0}" = "1" ] && allow_discovery=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --body-file) [ "$#" -ge 2 ] || exit 2; body_file="$2"; shift 2 ;;
        --head-sha) [ "$#" -ge 2 ] || exit 2; head_sha="$2"; shift 2 ;;
        --changed-files-file) [ "$#" -ge 2 ] || exit 2; files_file="$2"; shift 2 ;;
        --pr) [ "$#" -ge 2 ] || exit 2; selector="$2"; force_check=1; shift 2 ;;
        --project-dir) [ "$#" -ge 2 ] || exit 2; requested_root="$2"; shift 2 ;;
        --payload-file) [ "$#" -ge 2 ] || exit 2; payload_file="$2"; shift 2 ;;
        --check) force_check=1; shift ;;
        --no-discovery) allow_discovery=0; shift ;;
        *) echo "agent PR gates: unknown argument: $1" >&2; exit 2 ;;
    esac
done

payload=""
payload_expected=0
if [ -n "$payload_file" ]; then
    payload_expected=1
    [ -f "$payload_file" ] && [ -r "$payload_file" ] || { echo "agent PR gates: payload file missing or unreadable: $payload_file" >&2; exit 2; }
    payload="$(cat "$payload_file")" || { echo "agent PR gates: could not read payload file: $payload_file" >&2; exit 2; }
elif [ "$force_check" != "1" ] && [ -z "$body_file$head_sha$files_file" ]; then
    payload_expected=1
    payload="$(cat 2>/dev/null)" || { echo "agent PR gates: could not read hook payload" >&2; exit 2; }
fi
[ "$payload_expected" -eq 0 ] || [ -n "$payload" ] || { echo "agent PR gates: empty hook payload; refusing merge policy bypass" >&2; exit 2; }

action=""; payload_cwd=""; target_repo=""; target_host=""; parse_error=""; expected_head=""
if [ -n "$payload" ]; then
    parsed_payload="$(mktemp)" || exit 2
    if ! printf '%s' "$payload" | agent_gate_parse_payload >"$parsed_payload"; then
        rm -f "$parsed_payload"
        echo "agent PR gates: malformed hook payload; refusing merge policy bypass" >&2
        exit 2
    fi
    fields=(); field_index=0
    while IFS= read -r -d '' field; do
        fields[$field_index]="$field"; field_index=$((field_index + 1))
    done <"$parsed_payload"
    rm -f "$parsed_payload"
    action="${fields[0]:-}"
    parsed_selector="${fields[1]:-}"
    payload_cwd="${fields[2]:-}"
    target_repo="${fields[3]:-}"
    target_host="${fields[4]:-}"
    parse_error="${fields[5]:-}"
    expected_head="${fields[6]:-}"
    [ -n "$action" ] || exit 0
    if [ "$action" = "gh pr create" ]; then
        [ -z "$parse_error" ] \
            || { echo "BLOCKED: PR creation transport could not be bound safely: $parse_error" >&2; exit 2; }
        exit 0
    fi
    if [ -n "$selector" ] && [ "$selector" != "$parsed_selector" ]; then
        echo "BLOCKED: explicit PR selector conflicts with the merge action target." >&2
        exit 2
    fi
    selector="$parsed_selector"
    [ -z "$parse_error" ] || { echo "BLOCKED: merge target could not be bound safely: $parse_error" >&2; exit 2; }
    printf '%s' "$selector" | grep -Eq '^[0-9]+$' \
        || { echo "BLOCKED: merge action must name one explicit numeric pull request." >&2; exit 2; }
    printf '%s' "$expected_head" | grep -Eq '^[0-9a-fA-F]{40}$' \
        || { echo "BLOCKED: merge action must carry a full expected head SHA." >&2; exit 2; }
    force_check=1
fi

[ -n "$body_file$head_sha$files_file$pr_metadata_file$head_commit_file$head_commit_pages_file" ] \
    && force_check=1
[ "$force_check" = "1" ] || exit 0

root="$(agent_gate_project_root "${requested_root:-$payload_cwd}")"
if [ -z "$action" ]; then
    [ -n "$target_repo" ] || target_repo="${GH_REPO:-}"
    [ -n "$target_host" ] || target_host="${GH_HOST:-}"
fi
if [ -n "$action" ]; then
    [ -n "$target_repo" ] \
        || { echo "BLOCKED: merge action must bind an explicit repository target." >&2; exit 2; }
    [ -n "$target_host" ] \
        || { echo "BLOCKED: merge action must bind an explicit repository host." >&2; exit 2; }
    if ! agent_gate_workdir_matches "$root" "$payload_cwd"; then
        echo "BLOCKED: merge execution directory is outside the current project repository." >&2
        exit 2
    fi
    if ! agent_gate_target_matches "$root" "$target_repo" "$target_host"; then
        echo "BLOCKED: merge target ${target_host:+$target_host/}${target_repo:-<current>} is not the current project repository." >&2
        exit 2
    fi
fi
tmp="$(mktemp -d)" || exit 2
trap 'rm -rf "$tmp"' EXIT

if [ -n "$body_file$head_sha$files_file$pr_metadata_file$head_commit_file$head_commit_pages_file" ]; then
    # Any explicit/CI override disables network discovery. Partial input is a policy error.
    [ -n "$body_file" ] && [ -f "$body_file" ] && [ -r "$body_file" ] || { echo "agent PR gates: AGENT_PR_BODY_FILE is missing or unreadable" >&2; exit 2; }
    [ -n "$files_file" ] && [ -f "$files_file" ] && [ -r "$files_file" ] || { echo "agent PR gates: AGENT_CHANGED_FILES_FILE is missing or unreadable" >&2; exit 2; }
    printf '%s' "$head_sha" | grep -Eq '^[0-9a-fA-F]{7,40}$' || { echo "agent PR gates: AGENT_PR_HEAD_SHA must be 7..40 hexadecimal characters" >&2; exit 2; }

    renovate_context_count=0
    [ -z "$pr_metadata_file" ] || renovate_context_count=$((renovate_context_count + 1))
    [ -z "$head_commit_file" ] || renovate_context_count=$((renovate_context_count + 1))
    [ -z "$head_commit_pages_file" ] || renovate_context_count=$((renovate_context_count + 1))
    [ "$renovate_context_count" -eq 0 ] || [ "$renovate_context_count" -eq 3 ] \
        || { echo "agent PR gates: all three authoritative Renovate context files must be provided together" >&2; exit 2; }
    if [ "$renovate_context_count" -eq 3 ]; then
        [ "${AGENT_POLICY_CI:-0}" = "1" ] \
            || { echo "agent PR gates: Renovate context is accepted only in authoritative CI" >&2; exit 2; }
        for context_file in "$pr_metadata_file" "$head_commit_file" "$head_commit_pages_file"; do
            [ -f "$context_file" ] && [ -r "$context_file" ] \
                || { echo "agent PR gates: authoritative Renovate context is missing or unreadable" >&2; exit 2; }
        done
    fi
else
    [ "$allow_discovery" -eq 1 ] || { echo "agent PR gates: inputs absent and discovery disabled" >&2; exit 2; }
    body_file="$tmp/body.md"; files_file="$tmp/files.txt"
    agent_gate_discover_pr "$selector" "$root" "$body_file" "$files_file"
    discovery_rc=$?
    case "$discovery_rc" in
        0) head_sha="$AGENT_DISCOVERED_HEAD" ;;
        1) echo "BLOCKED: no open pull request found for ${selector:-the current branch}." >&2; exit 2 ;;
        *) echo "BLOCKED: could not read the pull request. Configure a github.com Git credential for scripts/gh-with-git-credentials.sh or provide the three AGENT_* CI inputs." >&2; exit 2 ;;
    esac
fi

if [ -n "$action" ] && [ "$(printf '%s' "$expected_head" | tr 'A-F' 'a-f')" != "$(printf '%s' "$head_sha" | tr 'A-F' 'a-f')" ]; then
    echo "BLOCKED: merge action expected head $expected_head does not match reviewed head $head_sha." >&2
    exit 2
fi

failures=""
check_gate() {
    local key="$1" label="$2" relevance="${3:-}" relevance_flag="${4:-}"
    local status state stamped relevant_rc
    if [ -n "$relevance" ]; then
        agent_gate_relevant "$files_file" "$relevance"
        relevant_rc=$?
        if [ "$relevant_rc" -eq 1 ]; then
            [ -z "$relevance_flag" ] || printf -v "$relevance_flag" '%s' 0
            return 0
        elif [ "$relevant_rc" -ne 0 ]; then
            failures="${failures}${key}|${label}|changed-files-unreadable\n"
            return 0
        fi
        [ -z "$relevance_flag" ] || printf -v "$relevance_flag" '%s' 1
    fi
    status="$(agent_gate_checkbox_status "$body_file" "$key")"
    state="${status%% *}"; stamped=""
    [ "$state" = "checked" ] && stamped="$(printf '%s' "$status" | awk '{print $2}')"
    if [ "$state" = "checked" ] && agent_gate_sha_matches "$stamped" "$head_sha"; then
        return 0
    fi
    failures="${failures}${key}|${label}|${status}\n"
}

ui_suite_relevant=0
absence_suite_relevant=0
verified_renovate_actions=0
if [ -z "$action" ] && [ "${renovate_context_count:-0}" -eq 3 ]; then
    renovate_classifier="$root/tools/agent-policy/renovate_action_pr.py"
    repo_slug="$(agent_gate_repo_slug "$root")"
    if [ -n "$repo_slug" ] && [ -f "$renovate_classifier" ] && [ -r "$renovate_classifier" ] \
        && python3 "$renovate_classifier" "$pr_metadata_file" "$head_commit_file" \
            "$head_commit_pages_file" "$repo_slug" "$head_sha" >/dev/null 2>&1; then
        verified_renovate_actions=1
    fi
fi

if [ "$verified_renovate_actions" -eq 0 ]; then
    check_gate "project-review" "project review"
    check_gate "domain-review" "domain correctness review"
    check_gate "heap-safety-review" "independent heap safety review" \
        '^(main/(mqtt_ha|ota_update|weather_forecast|http_status|http_config|hp_poll|heap_guard)\.(cpp|hpp)$|main/logic/(json|mqtt_group|x10a_snapshot|ota_headroom|health_gate|heap_watchdog)\.hpp$|test/test_(x10a_publish_heap_contract|ota_heap_contract|production_ota_gate_contract)\.mjs$|scripts/production-ota-gate\.py$|tools/(ota|production_ota|agent-hooks)/|\.codex/agents/heap-safety-reviewer\.toml$|docs/(ARCHITECTURE|SECURITY|FEATURES)\.md$)'
    check_gate "feature-docs" "feature documentation sync" \
        '^(main/|test/|sdkconfig\.defaults$|partitions\.csv$|\.github/workflows/(build|pr-policy)\.yml$)'
    check_gate "schematic-review" "schematic review" \
        '^(main/www/|docs/DESIGN\.md$|tools/schematic/|\.agents/skills/schematic-review/)'
    check_gate "ui-use-case-review" "complete UI use-case review" \
        '^(main/www/|test/test_ui_|test/test_homehub_discovery_contract\.mjs$|test/test_mcp_dashboard\.mjs$|scripts/run-ui-use-case-tests\.sh$|tools/ui/|\.agents/skills/ui-use-case-review/|tools/agent-hooks/|\.codex/hooks\.json$|\.github/(pull_request_template\.md|workflows/build\.yml)$|docs/DESIGN\.md$)' \
        ui_suite_relevant
    check_gate "absence-review" "source-absence review" \
        '^(main/(http_status|http_config|history|mqtt_ha|hp_modbus|hp_poll|env3|weather_forecast|safe_mode|main)\.cpp$|main/logic/(redact|heating_curve_diagnosis|circulation_source|history|env3)\.hpp$|main/www/js/|test/test_(ui_absence_matrix|source_absence_contract)\.mjs$|tools/absence/|\.agents/skills/absence-review/)' \
        absence_suite_relevant
    check_gate "ui-gif" "dashboard recording review" \
        '^(docs/media/dashboard\.gif$|tools/uigif/gif_stamp\.txt$)'
fi

if [ -n "$failures" ]; then
    echo "BLOCKED: PR policy evidence is missing, unchecked, unstamped, or stale for head $head_sha:" >&2
    printf '%b' "$failures" | while IFS='|' read -r key label status; do
        [ -n "$key" ] || continue
        echo "  - $key ($label): $status" >&2
    done
    echo "Run each named review, tick its PR checkbox, and stamp it with @ $head_sha. Authoritative CI rechecks this record." >&2
    exit 2
fi

# Preserve the historical last-mile merge behavior without repeating PR discovery: only an actual
# local merge action reruns the deterministic suites, and it does so after the aggregate evidence
# check has proved the current head. The UI-GIF audit is unconditional for a merge: a human review
# record must never override the mechanical fact that the recording is stale or unreadable. The
# record itself is conditional above and is required only when the PR carries a new GIF or stamp.
# Authoritative CI supplies its own inputs and has no action; the separate `mechanical_gates` job
# already runs these deterministic checks exactly once.
if [ -n "$action" ]; then
    ui_gif_audit_out="$(agent_gate_run_bounded "${AGENT_GATE_SUITE_TIMEOUT:-120}" \
        "$root/scripts/run-ui-gif-audit.sh" 2>&1)"
    ui_gif_audit_rc=$?
    if [ "$ui_gif_audit_rc" -ne 0 ]; then
        printf '%s\n' "$ui_gif_audit_out" >&2
        echo "BLOCKED: the README dashboard recording is stale or could not be verified." >&2
        echo "Run \$ui-gif to re-record and inspect it; a PR checkbox cannot override a mechanical mismatch." >&2
        exit 2
    fi
fi
if [ -n "$action" ] && [ "$ui_suite_relevant" -eq 1 ]; then
    if ! agent_gate_run_bounded "${AGENT_GATE_SUITE_TIMEOUT:-120}" "$root/scripts/run-ui-use-case-tests.sh"; then
        echo "BLOCKED: complete UI use-case suite failed immediately before merge." >&2
        exit 2
    fi
fi
if [ -n "$action" ] && [ "$absence_suite_relevant" -eq 1 ]; then
    if ! agent_gate_run_bounded "${AGENT_GATE_SUITE_TIMEOUT:-120}" "$root/tools/absence/selftest.sh"; then
        echo "BLOCKED: source-absence mutation suite failed immediately before merge." >&2
        exit 2
    fi
fi

if [ "$verified_renovate_actions" -eq 1 ]; then
    echo "agent PR gates: verified Renovate Action-pin-line-only PR at $head_sha; human review records are not applicable"
else
    echo "agent PR gates: all applicable review records match $head_sha"
fi
exit 0

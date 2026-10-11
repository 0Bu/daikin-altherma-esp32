#!/usr/bin/env bash
# Read-only observer for an update already started by scripts/production-ota-gate.py.
# This helper never checks a manifest, changes configuration or starts an update.
set -euo pipefail

export NO_PROXY="*"
export no_proxy="*"

IP=""
EXPECTED_VERSION=""
EXPECTED_GEN=""
TIMEOUT=300
QUIET=0

usage() {
    echo "Usage: $0 --ip <host> --expected-version <version> --generation <accepted-generation> [--timeout <seconds>] [--quiet]"
    echo "Observe an existing canonical OTA operation using GET only. Start delivery with scripts/production-ota-gate.py."
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ip|--expected-version|--generation|--timeout)
            [ "$#" -ge 2 ] || { echo "error: $1 requires an argument" >&2; exit 2; }
            case "$1" in
                --ip) IP="$2" ;;
                --expected-version) EXPECTED_VERSION="$2" ;;
                --generation) EXPECTED_GEN="$2" ;;
                --timeout) TIMEOUT="$2" ;;
            esac
            shift 2 ;;
        --channel|--allow-downgrade)
            echo "error: $1 is a removed write option; use scripts/production-ota-gate.py for delivery" >&2
            exit 2 ;;
        --quiet) QUIET=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown argument $1" >&2; exit 2 ;;
    esac
done

# Validate before any request or shell arithmetic. Decimal inputs have explicit finite bounds.
if ! [[ "$IP" =~ ^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$ ]]; then
    echo "error: --ip must be a hostname or IP address with an optional port" >&2
    exit 2
fi
if [[ "$IP" =~ :([0-9]+)$ ]]; then
    port=$((10#${BASH_REMATCH[1]}))
    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        echo "error: an explicit --ip port must be from 1 to 65535" >&2
        exit 2
    fi
fi
if ! [[ "$EXPECTED_VERSION" =~ ^[A-Za-z0-9.+_-]{1,31}$ ]]; then
    echo "error: --expected-version is required (1 to 31 version characters)" >&2
    exit 2
fi
if ! [[ "$EXPECTED_GEN" =~ ^[1-9][0-9]{0,9}$ ]] || [ "$EXPECTED_GEN" -gt 4294967295 ]; then
    echo "error: --generation must be the accepted decimal generation (1 to 4294967295)" >&2
    exit 2
fi
if ! [[ "$TIMEOUT" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$TIMEOUT" -gt 86400 ]; then
    echo "error: --timeout must be decimal seconds from 1 to 86400" >&2
    exit 2
fi

log() { if [ "$QUIET" -eq 0 ]; then echo "[trigger-ota-wait] $*"; fi; }
err() { echo "[trigger-ota-wait] ERROR: $*" >&2; }
start_time=$(date +%s)
deadline=$((start_time + TIMEOUT))

get_status() {
    local remaining
    remaining=$((deadline - $(date +%s)))
    [ "$remaining" -gt 0 ] || return 1
    [ "$remaining" -le 3 ] || remaining=3
    curl --fail --silent --show-error --connect-timeout "$remaining" --max-time "$remaining" "http://$IP/$1" 2>/dev/null
}

valid_identity() {
    printf '%s' "$1" | jq -e '
        type == "object" and
        (.version | type == "string" and length > 0) and
        (.app_elf_sha256 | type == "string" and length > 0) and
        (.uptime_s | type == "number" and . >= 0 and . <= 4294967295 and floor == .)
    ' >/dev/null 2>&1
}

# Full /status deliberately returns 503 during the OTA network lease. Start from the compact
# receipt, which remains available, rather than inventing a pre-write uptime baseline.
initial_ota=$(get_status ota/status || true)
if ! printf '%s' "$initial_ota" | jq -e --argjson generation "$EXPECTED_GEN" --arg version "$EXPECTED_VERSION" '
    type == "object" and .generation == $generation and .available == $version and
    (.state == "updating" or .state == "done") and (.busy | type == "boolean") and
    (.current | type == "string" and length > 0)
' >/dev/null 2>&1; then
    err "No existing update matches the expected version and accepted generation; use scripts/production-ota-gate.py"
    exit 1
fi
initial_version=$(printf '%s' "$initial_ota" | jq -r '.current')
if [ "$initial_version" = "$EXPECTED_VERSION" ]; then
    err "Device already runs the expected version; this observer cannot establish a fresh update"
    exit 1
fi
log "Observing accepted generation $EXPECTED_GEN toward $EXPECTED_VERSION (current: $initial_version)"
saw_done=0
if [ "$(printf '%s' "$initial_ota" | jq -r '.state')" = "done" ]; then saw_done=1; fi
last_progress=""

while [ "$(date +%s)" -lt "$deadline" ]; do
    ota=$(get_status ota/status || true)
    if [ -n "$ota" ]; then
        if ! printf '%s' "$ota" | jq -e 'type == "object"' >/dev/null 2>&1; then
            err "Malformed OTA status response"
            exit 1
        fi
        if printf '%s' "$ota" | jq -e --argjson generation "$EXPECTED_GEN" '.generation == $generation' >/dev/null 2>&1; then
            state=$(printf '%s' "$ota" | jq -r '.state // empty')
            if [ "$state" = "error" ]; then
                err "OTA failed on device: $(printf '%s' "$ota" | jq -r '.message // "unspecified error"')"
                exit 1
            fi
            if [ "$state" = "done" ]; then saw_done=1; fi
            progress=$(printf '%s' "$ota" | jq -r '.progress // empty')
            if [ "$progress" != "$last_progress" ]; then
                log "State: $state, progress: ${progress:-unavailable}"
                last_progress="$progress"
            fi
        elif printf '%s' "$ota" | jq -e '.generation == 0' >/dev/null 2>&1; then
            # Firmware starts at generation zero and every new operation skips zero, including
            # wraparound. Observe this boot reset after done; disconnects alone prove nothing.
            if [ "$saw_done" -ne 1 ]; then
                err "Observed a new boot without the selected writer's completed verification"
                exit 1
            fi
            if ! printf '%s' "$ota" | jq -e --arg version "$EXPECTED_VERSION" '.current == $version' >/dev/null 2>&1; then
                err "Rebooted device does not report the expected version"
                exit 1
            fi
            image_state=$(printf '%s' "$ota" | jq -r '.image_state // empty')
            if [ "$image_state" = "aborted" ] || [ "$image_state" = "invalid" ]; then
                err "OTA image was marked '$image_state'"
                exit 1
            fi
            if printf '%s' "$ota" | jq -e '.image_state == "valid" and .rollback_pending == false' >/dev/null 2>&1; then
                status=$(get_status status || true)
                if valid_identity "$status"; then
                    if ! printf '%s' "$status" | jq -e --arg version "$EXPECTED_VERSION" '.version == $version' >/dev/null 2>&1; then
                        err "Full device status disagrees with the expected version after reboot"
                        exit 1
                    fi
                    echo "[trigger-ota-wait] Observed generation $EXPECTED_GEN complete, a boot generation reset into $EXPECTED_VERSION, and valid image status."
                    echo "[trigger-ota-wait] Read-only observation; canonical delivery, signature and stress acceptance remain the gate's responsibility."
                    exit 0
                fi
            fi
        else
            err "Observed foreign or missing generation"
            exit 1
        fi
    fi
    sleep 1
done
err "Timed out observing completed verification, a boot generation reset into the expected version, and valid device status without rollback pending"
exit 1

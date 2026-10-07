#!/usr/bin/env bash
# Verify health of a daikin-altherma-esp32 board over HTTP.
#
# Usage:
#   scripts/verify-device-health.sh --ip <ip-or-host> [options]
#
# Options:
#   --ip <ip>                    Device IP address or hostname (required)
#   --expected-version <ver>     Expected version string (e.g. 1.0.4-dev.13)
#   --expected-elf-sha <sha>     Expected ELF SHA256 prefix
#   --require-hp                 Require hp.connected == true and valid /values
#   --timeout <sec>              Maximum seconds to wait for health (default: 60)
#   --quiet                      Only print errors and final result
#
set -euo pipefail

export NO_PROXY="*"
export no_proxy="*"

IP=""
EXPECTED_VERSION=""
EXPECTED_ELF_SHA=""
REQUIRE_HP=0
TIMEOUT=60
QUIET=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ip) [ "$#" -ge 2 ] || { echo "error: --ip requires an argument" >&2; exit 2; }; IP="$2"; shift 2 ;;
        --expected-version) [ "$#" -ge 2 ] || { echo "error: --expected-version requires an argument" >&2; exit 2; }; EXPECTED_VERSION="$2"; shift 2 ;;
        --expected-elf-sha) [ "$#" -ge 2 ] || { echo "error: --expected-elf-sha requires an argument" >&2; exit 2; }; EXPECTED_ELF_SHA="$2"; shift 2 ;;
        --require-hp) REQUIRE_HP=1; shift ;;
        --timeout) [ "$#" -ge 2 ] || { echo "error: --timeout requires an argument" >&2; exit 2; }; TIMEOUT="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        -h|--help)
            echo "Usage: $0 --ip <ip> [--expected-version <ver>] [--expected-elf-sha <sha>] [--require-hp] [--timeout <sec>]"
            exit 0
            ;;
        *) echo "error: unknown argument $1" >&2; exit 2 ;;
    esac
done

if [ -z "$IP" ]; then
    echo "error: --ip <ip> is required" >&2
    exit 2
fi

log() {
    if [ "$QUIET" -eq 0 ]; then
        echo "[verify-device-health] $*"
    fi
}

err() {
    echo "[verify-device-health] ERROR: $*" >&2
}

warn() {
    echo "[verify-device-health] WARNING: $*" >&2
}

# Keep the transport result separate from the HTTP code: curl can fail after receiving a 200.
read_response() {
    response_body=""
    response_code=""
    response_error=""
    local raw_response curl_exit
    if raw_response=$(curl -sS --max-time 3 -w "\n%{http_code}" "$1" 2>/dev/null); then
        response_code=$(printf '%s' "$raw_response" | tail -n 1)
        response_body=$(printf '%s' "$raw_response" | sed '$d')
    else
        curl_exit=$?
        response_error="curl failed (exit $curl_exit)"
        return 1
    fi
    if [ "$response_code" != "200" ]; then
        response_error="HTTP $response_code (expected 200)"
        return 1
    fi
    return 0
}

start_time=$(date +%s)
deadline=$((start_time + TIMEOUT))

log "Waiting for device at http://$IP/status (timeout: ${TIMEOUT}s)..."

status_json=""
reachable=0

# Always make the first request before consulting the deadline. A guard evaluated first would make
# zero attempts whenever the wall clock crosses a second between start_time and that guard, which
# with --timeout 0 reports a healthy device as unreachable without ever contacting it.
while :; do
    if read_response "http://$IP/status" && [ -n "$response_body" ] && printf '%s' "$response_body" | jq -e '.version' >/dev/null 2>&1; then
        status_json="$response_body"
        reachable=1
        if printf '%s' "$status_json" | jq -e '.mqtt.configured == true and .mqtt.connected == false' >/dev/null 2>&1; then
            if [ "$(date +%s)" -lt "$deadline" ]; then
                sleep 2
                [ "$(date +%s)" -le "$deadline" ] || break
                continue
            fi
        fi
        break
    fi
    sleep 2
    [ "$(date +%s)" -le "$deadline" ] || break
done

if [ "$reachable" -eq 0 ] || [ -z "$status_json" ]; then
    err "Device at http://$IP/status is unreachable or returned invalid JSON within ${TIMEOUT}s"
    exit 1
fi

log "Device responded. Evaluating health criteria..."

failures=0

# 1. Version check
if ! printf '%s' "$status_json" | jq -e 'has("version") and (.version | type == "string" and length > 0)' >/dev/null 2>&1; then
    err "Mandatory field 'version' missing, empty, or not a string"
    failures=$((failures + 1))
    actual_version=""
else
    actual_version=$(printf '%s' "$status_json" | jq -r '.version')
    if [ -n "$EXPECTED_VERSION" ]; then
        if [ "$actual_version" != "$EXPECTED_VERSION" ]; then
            err "Version mismatch: expected '$EXPECTED_VERSION', got '$actual_version'"
            failures=$((failures + 1))
        else
            log "✓ Version: $actual_version (matches expected)"
        fi
    else
        log "✓ Version: $actual_version"
    fi
fi

# 2. ELF SHA check
if ! printf '%s' "$status_json" | jq -e 'has("app_elf_sha256") and (.app_elf_sha256 | type == "string" and length > 0)' >/dev/null 2>&1; then
    err "Mandatory field 'app_elf_sha256' missing, empty, or not a string"
    failures=$((failures + 1))
    actual_elf_sha=""
else
    actual_elf_sha=$(printf '%s' "$status_json" | jq -r '.app_elf_sha256')
    if [ -n "$EXPECTED_ELF_SHA" ]; then
        if [[ "$actual_elf_sha" != "$EXPECTED_ELF_SHA"* ]]; then
            err "ELF SHA mismatch: expected prefix '$EXPECTED_ELF_SHA', got '$actual_elf_sha'"
            failures=$((failures + 1))
        else
            log "✓ ELF SHA: $actual_elf_sha (matches expected)"
        fi
    else
        log "✓ ELF SHA: $actual_elf_sha"
    fi
fi

# 3. Uptime
if ! printf '%s' "$status_json" | jq -e 'has("uptime_s") and (.uptime_s | type == "number" and . >= 0)' >/dev/null 2>&1; then
    err "Mandatory field 'uptime_s' missing or invalid number"
    failures=$((failures + 1))
else
    uptime_s=$(printf '%s' "$status_json" | jq -r '.uptime_s')
    log "✓ Uptime: ${uptime_s}s"
fi

# 4. WiFi / Network
if ! printf '%s' "$status_json" | jq -e '(.wifi.connected == true) or (.net.ip | type == "string" and length > 0)' >/dev/null 2>&1; then
    err "Network not connected (.wifi.connected != true and no valid .net.ip)"
    failures=$((failures + 1))
else
    device_ip=$(printf '%s' "$status_json" | jq -r '.net.ip // empty')
    log "✓ Network: connected (IP: ${device_ip:-unknown})"
fi

# 5. MQTT Broker
if ! printf '%s' "$status_json" | jq -e 'has("mqtt") and (.mqtt | type == "object")' >/dev/null 2>&1; then
    err "Mandatory object 'mqtt' missing from status"
    failures=$((failures + 1))
elif ! printf '%s' "$status_json" | jq -e '.mqtt.configured | type == "boolean"' >/dev/null 2>&1; then
    err "Mandatory field 'mqtt.configured' missing or not a boolean"
    failures=$((failures + 1))
else
    mqtt_configured=$(printf '%s' "$status_json" | jq -r '.mqtt.configured')
    if [ "$mqtt_configured" = "true" ]; then
        if ! printf '%s' "$status_json" | jq -e '(.mqtt.connected | type == "boolean") and .mqtt.connected == true' >/dev/null 2>&1; then
            err "MQTT broker not connected (.mqtt.connected != true)"
            failures=$((failures + 1))
        else
            log "✓ MQTT: connected to broker"
        fi
    else
        log "✓ MQTT: disabled (not configured)"
    fi
fi

# 6. Crash & Fault analysis
if ! printf '%s' "$status_json" | jq -e 'has("last_crash")' >/dev/null 2>&1; then
    err "Mandatory field 'last_crash' missing from status"
    failures=$((failures + 1))
else
    crash_type=$(printf '%s' "$status_json" | jq -r '.last_crash | type')
    if [ "$crash_type" = "null" ]; then
        log "✓ Crash check: clean (last_crash is null)"
    elif [ "$crash_type" = "object" ]; then
        if ! printf '%s' "$status_json" | jq -e '.last_crash.fault | type == "boolean"' >/dev/null 2>&1; then
            err "Field 'last_crash.fault' missing or not a boolean"
            failures=$((failures + 1))
        elif [ "$(printf '%s' "$status_json" | jq -r '.last_crash.fault')" = "true" ]; then
            last_crash_reason=$(printf '%s' "$status_json" | jq -r '.last_crash.reason // empty')
            err "Active crash fault detected! reason='$last_crash_reason'"
            err "Details: $(printf '%s' "$status_json" | jq -c '.last_crash')"
            failures=$((failures + 1))
        else
            last_crash_reason=$(printf '%s' "$status_json" | jq -r '.last_crash.reason // empty')
            last_crash_coredump=$(printf '%s' "$status_json" | jq -r '.last_crash.coredump // false')
            log "✓ Crash check: clean (fault: false, reset_reason: '${last_crash_reason:-normal}')"
            if [ "$last_crash_coredump" = "true" ]; then
                warn "Flash carries an orphan coredump partition from an older boot (fault is false on this boot)"
            fi
        fi
    else
        err "Field 'last_crash' is invalid type ($crash_type, expected null or object)"
        failures=$((failures + 1))
    fi
fi

# 7. Safe mode & Heap health
if ! printf '%s' "$status_json" | jq -e 'has("sys") and (.sys | type == "object")' >/dev/null 2>&1; then
    err "Mandatory object 'sys' missing from status"
    failures=$((failures + 1))
else
    if ! printf '%s' "$status_json" | jq -e '.sys.safe_mode | type == "boolean"' >/dev/null 2>&1; then
        err "Field 'sys.safe_mode' missing or not a boolean"
        failures=$((failures + 1))
    elif [ "$(printf '%s' "$status_json" | jq -r '.sys.safe_mode')" = "true" ]; then
        safe_mode_cause=$(printf '%s' "$status_json" | jq -r '.sys.safe_mode_cause // empty')
        err "Device is in safe mode! Cause: ${safe_mode_cause:-unspecified}"
        failures=$((failures + 1))
    else
        log "✓ Safe mode: off"
    fi

    free_heap=""
    if ! printf '%s' "$status_json" | jq -e '.sys.free_heap | type == "number" and . > 0 and floor == . and . <= 4294967295' >/dev/null 2>&1; then
        err "Mandatory field 'sys.free_heap' missing or not a positive number"
        failures=$((failures + 1))
    else
        free_heap=$(printf '%s' "$status_json" | jq -r '.sys.free_heap')
    fi

    if ! printf '%s' "$status_json" | jq -e '.sys.max_alloc | type == "number" and . >= 0 and floor == . and . <= 4294967295' >/dev/null 2>&1; then
        err "Mandatory field 'sys.max_alloc' missing or not a number"
        failures=$((failures + 1))
    else
        max_alloc=$(printf '%s' "$status_json" | jq -r '.sys.max_alloc')
        if [ "$max_alloc" -lt 10000 ]; then
            err "Largest contiguous heap block ($max_alloc B) is below 10,000 B minimum requirement"
            failures=$((failures + 1))
        else
            log "✓ Heap: ${free_heap:-0} B free, largest contiguous block: ${max_alloc} B"
        fi
    fi
fi

# 8. Heat Pump (X10A) checks
hp_connected=$(printf '%s' "$status_json" | jq -r '.hp.connected // false')
hp_last_ok=$(printf '%s' "$status_json" | jq -r '.hp.last_ok_s // empty')

if [ "$REQUIRE_HP" -eq 1 ]; then
    if ! printf '%s' "$status_json" | jq -e '(.hp.connected | type == "boolean") and .hp.connected == true' >/dev/null 2>&1; then
        err "X10A Heat pump communication not connected (.hp.connected: false)"
        failures=$((failures + 1))
    elif ! printf '%s' "$status_json" | jq -e '.hp.last_ok_s | type == "number" and . >= 0 and . < 15 and floor == . and . <= 4294967295' >/dev/null 2>&1; then
        err "X10A last successful response missing, invalid, or stale (last_ok_s must be 0..14)"
        failures=$((failures + 1))
    else
        log "✓ X10A bus: connected (last_ok_s: ${hp_last_ok:-0}s)"
        # Check /values endpoint
        if ! read_response "http://$IP/values"; then
            err "/values request failed: $response_error"
            failures=$((failures + 1))
        elif ! printf '%s' "$response_body" | jq -e '
            type == "object" and (.values | type == "array") and
            all(.values[];
                type == "object" and has("value") and
                (.label | type == "string") and (.unit | type == "string") and
                (.reg | type == "number" and . >= 0 and . <= 255 and floor == .) and
                (.value == null or (.value | type == "string")) and
                ((has("held") | not) or (.held | type == "boolean")))' >/dev/null 2>&1; then
            err "/values has an invalid X10A values envelope or metric type"
            failures=$((failures + 1))
        else
            values_count=$(printf '%s' "$response_body" | jq -r '.values | length')
            usable_count=$(printf '%s' "$response_body" | jq -r '[.values[] | select(.value != null and (.value | test("\\S")) and .held != true)] | length')
            if [ "$values_count" -le 0 ]; then
                err "/values returned an empty array"
                failures=$((failures + 1))
            elif [ "$usable_count" -le 0 ]; then
                err "/values returned no usable non-null metric values"
                failures=$((failures + 1))
            else
                log "✓ /values: valid payload ($values_count metrics received, $usable_count usable)"
            fi
        fi
    fi
else
    if [ "$hp_connected" = "true" ]; then
        log "✓ X10A bus: connected"
    else
        log "ℹ X10A bus: not connected (permitted for testbench board)"
    fi
fi

if [ "$failures" -gt 0 ]; then
    err "Health verification FAILED with $failures issue(s) on $IP"
    exit 1
fi

echo "[verify-device-health] Device at $IP is HEALTHY (GREEN)."
exit 0

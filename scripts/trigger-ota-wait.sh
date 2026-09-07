#!/usr/bin/env bash
# Trigger and monitor OTA update on a daikin-altherma-esp32 board over HTTP.
#
# Usage:
#   scripts/trigger-ota-wait.sh --ip <ip-or-host> [options]
#
# Options:
#   --ip <ip>                    Device IP address or hostname (required)
#   --channel <dev|release>      OTA channel to check/set (default: dev)
#   --expected-version <ver>     Expected version after update (optional)
#   --allow-downgrade            Allow installing older version (?downgrade=1)
#   --timeout <sec>              Maximum seconds to wait for update and reboot (default: 300)
#   --quiet                      Only print errors and progress
#
set -euo pipefail

IP=""
CHANNEL="dev"
EXPECTED_VERSION=""
ALLOW_DOWNGRADE=0
TIMEOUT=300
QUIET=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ip) [ "$#" -ge 2 ] || { echo "error: --ip requires an argument" >&2; exit 2; }; IP="$2"; shift 2 ;;
        --channel) [ "$#" -ge 2 ] || { echo "error: --channel requires an argument" >&2; exit 2; }; CHANNEL="$2"; shift 2 ;;
        --expected-version) [ "$#" -ge 2 ] || { echo "error: --expected-version requires an argument" >&2; exit 2; }; EXPECTED_VERSION="$2"; shift 2 ;;
        --allow-downgrade) ALLOW_DOWNGRADE=1; shift ;;
        --timeout) [ "$#" -ge 2 ] || { echo "error: --timeout requires an argument" >&2; exit 2; }; TIMEOUT="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        -h|--help)
            echo "Usage: $0 --ip <ip> [--channel <dev|release>] [--expected-version <ver>] [--allow-downgrade] [--timeout <sec>]"
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
        echo "[trigger-ota-wait] $*"
    fi
}

err() {
    echo "[trigger-ota-wait] ERROR: $*" >&2
}

start_time=$(date +%s)
deadline=$((start_time + TIMEOUT))

log "Connecting to device at $IP..."
initial_status=$(curl -sS --max-time 5 "http://$IP/status" 2>/dev/null || true)
if [ -z "$initial_status" ] || ! printf '%s' "$initial_status" | jq -e '.version' >/dev/null 2>&1; then
    err "Device at http://$IP/status is not reachable"
    exit 1
fi

initial_version=$(printf '%s' "$initial_status" | jq -r '.version')
log "Current firmware version on $IP: $initial_version"

# If device already has expected version and no downgrade forced
if [ -n "$EXPECTED_VERSION" ] && [ "$initial_version" = "$EXPECTED_VERSION" ] && [ "$ALLOW_DOWNGRADE" -eq 0 ]; then
    log "Device is ALREADY running expected version $EXPECTED_VERSION. Checking OTA status..."
fi

# Ensure channel is set correctly
ota_status=$(curl -sS --max-time 5 "http://$IP/ota/status" 2>/dev/null || echo "{}")
current_channel=$(printf '%s' "$ota_status" | jq -r '.channel // empty')
if [ "$current_channel" != "$CHANNEL" ]; then
    log "Setting OTA channel to '$CHANNEL'..."
    curl -sS --max-time 5 -X POST -H "Content-Type: application/json" -d "{\"channel\":\"$CHANNEL\"}" "http://$IP/set_ota" >/dev/null 2>&1 || true
    sleep 1
fi

# Trigger /ota/check
now_ms=$(date +%s%3N 2>/dev/null || echo "$(( $(date +%s) * 1000 ))")
log "Triggering /ota/check..."
curl -sS --max-time 5 "http://$IP/ota/check?ms=$now_ms" >/dev/null 2>&1 || true

# Wait for check to finish (busy == false)
log "Waiting for manifest check to complete..."
check_settled=0
while [ "$(date +%s)" -le "$deadline" ]; do
    stat=$(curl -sS --max-time 3 "http://$IP/ota/status" 2>/dev/null || true)
    if [ -n "$stat" ] && printf '%s' "$stat" | jq -e '.channel' >/dev/null 2>&1; then
        busy=$(printf '%s' "$stat" | jq -r '.busy // false')
        if [ "$busy" != "true" ]; then
            ota_status="$stat"
            check_settled=1
            break
        fi
    fi
    sleep 1
done

if [ "$check_settled" -eq 0 ]; then
    err "Timed out waiting for /ota/check to finish"
    exit 1
fi

available_ver=$(printf '%s' "$ota_status" | jq -r '.available // empty')
update_avail=$(printf '%s' "$ota_status" | jq -r '.update_available // false')
is_downgrade=$(printf '%s' "$ota_status" | jq -r '.downgrade // false')

log "OTA status: current='$initial_version', available='$available_ver', update_available=$update_avail, downgrade=$is_downgrade"

if [ -n "$EXPECTED_VERSION" ] && [ "$initial_version" = "$EXPECTED_VERSION" ]; then
    log "Device at $IP is already on target version $EXPECTED_VERSION. No update needed."
    exit 0
fi

if [ "$update_avail" != "true" ] && [ "$is_downgrade" != "true" ]; then
    if [ -n "$EXPECTED_VERSION" ] && [ "$available_ver" != "$EXPECTED_VERSION" ]; then
        err "Manifest does not offer expected version '$EXPECTED_VERSION' (available: '$available_ver'). CI build/publish might still be in progress."
        exit 1
    elif [ "$initial_version" = "$available_ver" ]; then
        log "Device is already on latest available build ($available_ver)."
        exit 0
    else
        err "No update available according to device manifest"
        exit 1
    fi
fi

# Extract checked OTA parameters
check_gen=$(printf '%s' "$ota_status" | jq -r '.generation // empty')
avail_channel=$(printf '%s' "$ota_status" | jq -r '.available_channel // empty')
avail_sha256=$(printf '%s' "$ota_status" | jq -r '.available_sha256 // empty')

if [ -z "$check_gen" ] || [ -z "$avail_channel" ] || [ -z "$available_ver" ] || [ -z "$avail_sha256" ]; then
    err "Incomplete OTA check response: generation='$check_gen', channel='$avail_channel', version='$available_ver', sha256='$avail_sha256'"
    exit 1
fi

# Build POST URL
post_query="?after=$check_gen&channel=$avail_channel&version=$available_ver&sha256=$avail_sha256"
if [ "$is_downgrade" = "true" ] || [ "$ALLOW_DOWNGRADE" -eq 1 ]; then
    post_query="${post_query}&downgrade=1"
    log "Initiating OTA update (with ?downgrade=1)..."
else
    log "Initiating OTA update..."
fi

post_resp=$(curl -sS --max-time 10 -X POST "http://$IP/ota/update$post_query" 2>&1 || true)
if ! printf '%s' "$post_resp" | jq -e '.ok == true' >/dev/null 2>&1; then
    err "OTA update request refused by device: $post_resp"
    exit 1
fi

expected_gen=$(printf '%s' "$post_resp" | jq -r '.generation // empty')
log "OTA update accepted (generation $expected_gen). Downloading and installing update..."

# Monitor progress until reboot
last_progress=-1
device_went_down=0
consecutive_drops=0

while [ "$(date +%s)" -le "$deadline" ]; do
    raw=$(curl -sS --max-time 3 "http://$IP/ota/status" 2>/dev/null || true)
    if [ -z "$raw" ]; then
        if [ "$last_progress" -ge 80 ] || [ "$consecutive_drops" -ge 5 ]; then
            log "Device connection dropped after progress=${last_progress}% (device rebooting)..."
            device_went_down=1
            break
        fi
        consecutive_drops=$((consecutive_drops + 1))
        sleep 1
        continue
    fi
    consecutive_drops=0

    # Check for 503 Service Unavailable (firmware sends this right before reboot)
    if printf '%s' "$raw" | grep -q "update in progress"; then
        log "Device reports final flash stage ('update in progress'). Reboot imminent..."
        device_went_down=1
        break
    fi

    if printf '%s' "$raw" | jq -e '.state' >/dev/null 2>&1; then
        state=$(printf '%s' "$raw" | jq -r '.state // empty')
        progress=$(printf '%s' "$raw" | jq -r '.progress // 0')
        msg=$(printf '%s' "$raw" | jq -r '.message // empty')

        if [ "$progress" != "$last_progress" ]; then
            log "Progress: ${progress}% (state: $state${msg:+ - $msg})"
            last_progress="$progress"
        fi

        if [ "$state" = "error" ]; then
            err "OTA failed on device: $msg"
            exit 1
        fi

        if [ "$state" = "done" ]; then
            log "OTA installation done. Waiting for reboot..."
            device_went_down=1
            break
        fi
    fi
    sleep 1
done

# Wait for device to reboot and return online
log "Waiting for device to finish reboot and come back online..."
sleep 5

reboot_ok=0
new_version=""
while [ "$(date +%s)" -le "$deadline" ]; do
    chk=$(curl -sS --max-time 3 "http://$IP/status" 2>/dev/null || true)
    if [ -n "$chk" ] && printf '%s' "$chk" | jq -e '.version' >/dev/null 2>&1; then
        new_version=$(printf '%s' "$chk" | jq -r '.version')
        new_elf_sha=$(printf '%s' "$chk" | jq -r '.app_elf_sha256 // empty')
        uptime=$(printf '%s' "$chk" | jq -r '.uptime_s // 0')
        log "Device is back online! Version: $new_version ($new_elf_sha), Uptime: ${uptime}s"
        reboot_ok=1
        break
    fi
    sleep 2
done

if [ "$reboot_ok" -eq 0 ]; then
    err "Timed out waiting for device to return online after OTA update"
    exit 1
fi

if [ -n "$EXPECTED_VERSION" ] && [ "$new_version" != "$EXPECTED_VERSION" ]; then
    err "Version mismatch after OTA: expected '$EXPECTED_VERSION', but device runs '$new_version'"
    exit 1
fi

log "Waiting 5 seconds for OTA rollback/health gate to settle..."
sleep 5

ota_final=$(curl -sS --max-time 3 "http://$IP/ota/status" 2>/dev/null || echo "{}")
img_state=$(printf '%s' "$ota_final" | jq -r '.image_state // empty')
rollback_pending=$(printf '%s' "$ota_final" | jq -r '.rollback_pending // false')

log "Image status: state='$img_state', rollback_pending=$rollback_pending"
if [ "$img_state" = "aborted" ] || [ "$img_state" = "invalid" ]; then
    err "OTA image was marked $img_state by health gate!"
    exit 1
fi

echo "[trigger-ota-wait] OTA update to $new_version on $IP completed successfully."
exit 0

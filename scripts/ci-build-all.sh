#!/usr/bin/env bash
# Build every supported target from one source tree, sign each app image with the offline OTA
# key (if present), and stage the artifacts the web installer + OTA consume into dist/:
#   daikin-altherma-esp32<suffix>.bin          signed app image (OTA pulls this)
#   daikin-altherma-esp32<suffix>-merged.bin   full-flash image (web installer flashes this)
#   manifest.json                              esp-web-tools builds[] + OTA version field
#
# Calls idf.py / esptool / espsecure.py DIRECTLY — it assumes an ESP-IDF environment is already
# on PATH. In CI that is provided by espressif/esp-idf-ci-action. LOCALLY, run it wrapped:
#   scripts/idf-docker.sh ./scripts/ci-build-all.sh 1.0.0
#
# Usage: scripts/ci-build-all.sh [version]   (defaults to scripts/next-version.sh)
# OTA_SIGNING_KEY_FILE (a PEM path) enables signing; absent -> unsigned (fork/PR without secret).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(scripts/next-version.sh)}"
TARGETS=(esp32 esp32s3 esp32c3 esp32c6)
DIST=dist; rm -rf "$DIST"; mkdir -p "$DIST"
SIGN_KEY="${OTA_SIGNING_KEY_FILE:-ota_signing_key.pem}"
APP_SIZE_LIMIT=$((0x1e8000))   # slot (0x1f0000) minus 32 KB headroom

suffix()     { case "$1" in esp32) echo "";; esp32s3) echo "-s3";; esp32c3) echo "-c3";; esp32c6) echo "-c6";; esac; }
chipfamily() { case "$1" in esp32) echo "ESP32";; esp32s3) echo "ESP32-S3";; esp32c3) echo "ESP32-C3";; esp32c6) echo "ESP32-C6";; esac; }

builds_json=""
for t in "${TARGETS[@]}"; do
    echo "=== building $t ($VERSION) ==="
    rm -f sdkconfig
    idf.py set-target "$t" build
    sfx="$(suffix "$t")"
    app="build/daikin-altherma-esp32.bin"

    sz="$(stat -f%z "$app" 2>/dev/null || stat -c%s "$app")"
    [ "$sz" -le "$APP_SIZE_LIMIT" ] || { echo "app image for $t too big: $sz > $APP_SIZE_LIMIT" >&2; exit 1; }

    # Sign the app image (RSA-3072, Secure Boot v2 scheme, no hardware Secure Boot).
    if [ -f "$SIGN_KEY" ]; then
        espsecure.py sign_data --version 2 --keyfile "$SIGN_KEY" --output "build/daikin-signed.bin" "$app"
        cp "build/daikin-signed.bin" "$DIST/daikin-altherma-esp32${sfx}.bin"
    else
        echo "WARNING: no OTA_SIGNING_KEY_FILE — shipping UNSIGNED $t (no OTA/preview on main)" >&2
        cp "$app" "$DIST/daikin-altherma-esp32${sfx}.bin"
    fi

    # Full-flash merged image for the browser installer.
    ( cd build && esptool --chip "$t" merge_bin -o "../$DIST/daikin-altherma-esp32${sfx}-merged.bin" @flash_args )

    cf="$(chipfamily "$t")"
    builds_json="${builds_json:+$builds_json,}{\"chipFamily\":\"$cf\",\"parts\":[{\"path\":\"daikin-altherma-esp32${sfx}-merged.bin\",\"offset\":0}]}"
done

# One manifest serves both the installer (builds[]) and OTA (version). esp-web-tools reads
# builds[]/chipFamily; the device OTA reads .version and pulls daikin-altherma-esp32<suffix>.bin.
cat > "$DIST/manifest.json" <<EOF
{
  "name": "daikin-altherma-esp32",
  "version": "$VERSION",
  "new_install_prompt_erase": true,
  "builds": [$builds_json]
}
EOF
echo "staged dist/ for $VERSION"

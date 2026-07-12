#!/usr/bin/env bash
# Boot-hardening guard: refuse to flash an UNSIGNED app image.
#
# This build config requires a Secure Boot v2 signature on the running app
# (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT — sdkconfig.defaults). An unsigned image does NOT
# boot: it aborts in check_signature_on_update_check() BEFORE app_main, so it crash-loops with no
# app-level recovery possible (see docs/SECURITY.md → Boot recovery). A full `@flash_args` flash of
# such an image also wipes otadata + the other OTA slot, so there is no previous firmware left to
# fall back to. The only safe posture is therefore: never let an unsigned image reach the chip.
#
# Run this on a .bin immediately before `esptool write_flash`. It verifies a valid RSA signature
# block is present (via `espsecure signature-info-v2`) and exits non-zero — with the exact signing
# command — if it is missing. The `flash-esp32` skill calls it; CI's ci-build-all.sh signs images so
# a released binary always passes.
#
#   scripts/require-signed.sh build/daikin-altherma-esp32.bin
#
set -euo pipefail

bin="${1:-}"
if [[ -z "$bin" || ! -f "$bin" ]]; then
    echo "require-signed: usage: $0 <app.bin>" >&2
    echo "require-signed: '$bin' is not a file" >&2
    exit 2
fi

# `espsecure` (esptool >= 5) or legacy `espsecure.py`; the subcommand takes a hyphen or underscore.
if command -v espsecure >/dev/null 2>&1; then espsec=espsecure
elif command -v espsecure.py >/dev/null 2>&1; then espsec=espsecure.py
else
    echo "require-signed: espsecure not found (install esptool: brew install esptool)" >&2
    exit 2
fi

info="$("$espsec" signature-info-v2 "$bin" 2>/dev/null || "$espsec" signature_info_v2 "$bin" 2>/dev/null || true)"

# A signed image reports 'Signature block 0 is valid'; an unsigned one 'Signature block 0 absent/invalid'.
if printf '%s' "$info" | grep -q 'Signature block 0 is valid'; then
    echo "require-signed: OK — '$bin' carries a valid Secure Boot v2 signature."
    exit 0
fi

key="${OTA_SIGNING_KEY_FILE:-<path-to>/ota_signing_key.pem}"
cat >&2 <<EOF
require-signed: REFUSING to flash — '$bin' is NOT signed.

An unsigned image crash-loops at boot on this config (aborts before app_main) and cannot be
recovered by the firmware; a full flash of it also destroys the previous firmware on the chip.

Sign it first with the offline RSA-3072 key, then flash the signed image:

    $espsec sign-data --version 2 --keyfile "$key" \\
      --output build/daikin-signed.bin "$bin"
    cp build/daikin-signed.bin "$bin"          # @flash_args flashes this path

No key on hand? Pull a signed build from CI instead of flashing a local unsigned one.
See docs/SECURITY.md → OTA image signing / Boot recovery.
EOF
exit 1

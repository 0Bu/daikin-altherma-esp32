#!/usr/bin/env bash
# Boot-hardening guard: refuse to flash an app that is not signed by the pinned key.
#
# This build config requires a Secure Boot v2 signature on the running app
# (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT — sdkconfig.defaults). An unsigned image does NOT
# boot: it aborts in check_signature_on_update_check() BEFORE app_main, so it crash-loops with no
# app-level recovery possible (see docs/SECURITY.md → Boot recovery). A full `@flash_args` flash
# also blanks otadata, so the bootloader has no rollback record for a previous image. The only safe
# posture is therefore: never let an unsigned image reach the chip.
#
# Run this on a .bin immediately before `esptool write_flash`. It verifies the block CRC, image
# digest, RSA-PSS signature, and embedded public key against the repository-pinned production
# signing identity. It exits non-zero — with the exact signing command — if any check fails. The
# `flash-esp32` skill calls it; CI's ci-build-all.sh signs images so a released binary always passes.
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

if "$(dirname "$0")/check-signing-key-continuity.py" "$bin"; then
    echo "require-signed: OK — '$bin' is signed by the pinned Secure Boot v2 key."
    exit 0
fi

key="${OTA_SIGNING_KEY_FILE:-<path-to>/ota_signing_key.pem}"
cat >&2 <<EOF
require-signed: REFUSING to flash — '$bin' is NOT trusted by the pinned signing identity.

An unsigned, corrupted, or wrong-key image is refused by this firmware before app_main and cannot
be recovered by the firmware; a full flash also removes the bootloader's rollback record.

Sign it first with the offline RSA-3072 key, then flash the signed image:

    espsecure sign-data --version 2 --keyfile "$key" \\
      --output build/daikin-signed.bin "$bin"
    cp build/daikin-signed.bin "$bin"          # @flash_args flashes this path

No key on hand? Pull a signed build from CI instead of flashing a local unsigned one.
See docs/SECURITY.md → OTA image signing / Boot recovery.
EOF
exit 1

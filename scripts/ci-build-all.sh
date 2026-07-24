#!/usr/bin/env bash
# Build every supported target from one source tree, sign each app image with the offline OTA
# key (if present), and stage the artifacts the web installer + OTA consume into dist/:
#   daikin-altherma-esp32<suffix>.bin          signed app image (OTA pulls this)
#   daikin-altherma-esp32<suffix>-merged.bin   full-flash image, signed app embedded at its
#                                              flash_args offset (manual factory-reset flash)
#   daikin-altherma-esp32<suffix>-web-*.bin    sparse Web Serial parts; their erase sectors skip
#                                              NVS unless the user explicitly chooses Erase
#   daikin-altherma-esp32<suffix>.elf          unstripped ELF — decodes a core dump from THIS build
#   daikin-altherma-esp32<suffix>.elf.sha256   integrity checksum of the ELF
#   manifest.json                              esp-web-tools builds[] + OTA version field
#
# Calls idf.py / esptool / espsecure.py DIRECTLY — it assumes an ESP-IDF environment is already
# on PATH. In CI that is provided by espressif/esp-idf-ci-action. LOCALLY, run it wrapped:
#   scripts/idf-docker.sh ./scripts/ci-build-all.sh 1.0.0
#
# The version argument must be the version the build EMBEDS — ESP-IDF takes PROJECT_VER from
# version.txt, and this script verifies the two agree before writing the manifest (see below).
# CI stamps version.txt first and passes the same string; the default here is version.txt for the
# same reason. NOT scripts/next-version.sh: that is the next RELEASE version, which is deliberately
# ahead of the version.txt floor once tags exist, i.e. exactly the drift the check rejects.
#
# Usage: scripts/ci-build-all.sh [version]   (defaults to the version.txt the build embeds)
# OTA_SIGNING_KEY_FILE (a PEM path) enables signing; absent -> unsigned (fork/PR without secret).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(tr -d '[:space:]' < version.txt)}"
TARGETS=(esp32s3)
DIST=dist; rm -rf "$DIST"; mkdir -p "$DIST"
SIGN_KEY="${OTA_SIGNING_KEY_FILE:-ota_signing_key.pem}"
APP_SIZE_LIMIT=$((0x1e8000))   # slot (0x1f0000) minus 32 KB headroom

suffix()     { echo ""; }
chipfamily() { echo "ESP32-S3"; }

builds_json=""
for t in "${TARGETS[@]}"; do
    echo "=== building $t ($VERSION) ==="
    rm -f sdkconfig
    idf.py set-target "$t" build
    sfx="$(suffix "$t")"
    app="build/daikin-altherma-esp32.bin"

    # The version this script stamps into manifest.json and the version the IMAGE embeds must be
    # the same string. The OTA client compares the manifest version against the version the
    # running app reports, so a drift is not cosmetic: every device downloads an "update" that
    # installs the version it already runs, then sees the same manifest again — forever. The two
    # come from different places (this argument vs. PROJECT_VER, which ESP-IDF reads from
    # version.txt), so read it back out of the built image and fail here rather than ship the loop.
    # esp_app_desc_t sits at a fixed 0x20 offset in an app image; its version[32] field at +0x10.
    magic="$(dd if="$app" bs=1 skip=32 count=4 status=none | od -An -tx1 | tr -d ' \n')"
    [ "$magic" = "3254cdab" ] || { echo "$app: no app-descriptor magic at 0x20 (got $magic)" >&2; exit 1; }
    embedded="$(dd if="$app" bs=1 skip=48 count=32 status=none | tr -d '\000')"
    [ "$embedded" = "$VERSION" ] || {
        echo "version drift: manifest would say '$VERSION' but $app embeds '$embedded'" >&2
        echo "PROJECT_VER comes from version.txt — in CI the 'Stamp firmware version' step writes it," >&2
        echo "locally it is the committed floor. Pass that same version to this script." >&2
        exit 1
    }

    # Sign the app image (RSA-3072, Secure Boot v2 scheme, no hardware Secure Boot).
    # The signed image must land back on $app itself: flash_args flashes the app BY PATH
    # ("0x20000 daikin-altherma-esp32.bin"), so merge_bin below embeds whatever is at that path.
    # Leave the raw linker output there and the browser installer ships an app that aborts in
    # esp_secure_boot_init_checks before app_main — a crash-loop with no bootloader rollback record.
    if [ -f "$SIGN_KEY" ]; then
        espsecure.py sign_data --version 2 --keyfile "$SIGN_KEY" --output "build/daikin-signed.bin" "$app"
        cp "build/daikin-signed.bin" "$app"
        cp "$app" "$DIST/daikin-altherma-esp32${sfx}.bin"
    else
        echo "WARNING: no OTA_SIGNING_KEY_FILE — shipping UNSIGNED $t (no OTA/preview on main)" >&2
        echo "WARNING: the browser installer image is UNSIGNED too — it crash-loops before" >&2
        echo "WARNING: app_main on this signature-checking config. Do NOT flash it to a board." >&2
        cp "$app" "$DIST/daikin-altherma-esp32${sfx}.bin"
    fi

    # Size-check the image that actually gets flashed — signing appends a 4 KB signature sector.
    sz="$(stat -f%z "$app" 2>/dev/null || stat -c%s "$app")"
    [ "$sz" -le "$APP_SIZE_LIMIT" ] || { echo "app image for $t too big: $sz > $APP_SIZE_LIMIT" >&2; exit 1; }

    # Canonical full-flash image. Besides remaining useful for an intentional factory-reset flash,
    # merge_bin applies any image-header transformations esp-web-tools cannot do in the browser.
    # The Web Serial manifest does NOT flash this whole file: merge_bin fills every gap with 0xff,
    # including nvs@0x9000, so writing it at offset 0 destroys the configuration even when the user
    # declines the separate whole-chip Erase prompt.
    merged="$DIST/daikin-altherma-esp32${sfx}-merged.bin"
    ( cd build && esptool --chip "$t" merge_bin -o "../$merged" @flash_args )

    # Self-check: CI must never publish an installer image with an unsigned app. Verify the app
    # region of the MERGED artifact — carved back out at the offset flash_args gave it — rather
    # than the file we told merge_bin to read, so the path indirection itself stays covered.
    # Both offsets are 4 KB multiples (an app partition is 64 KB-aligned; signing pads to 4 KB and
    # appends a 4 KB signature sector), so dd can carve it out block-wise — no pipe into `head`,
    # whose early close would SIGPIPE dd into a spurious pipefail once anything follows the app.
    if [ -f "$SIGN_KEY" ]; then
        off="$(awk -v f="$(basename "$app")" '$2 == f { print $1 }' build/flash_args)"
        [ -n "$off" ] || { echo "no app entry for $(basename "$app") in build/flash_args" >&2; exit 1; }
        dd if="$merged" of=build/merged-app.bin bs=4096 skip=$(( off / 4096 )) count=$(( sz / 4096 )) status=none
        scripts/require-signed.sh build/merged-app.bin
    fi

    # Stage only the byte ranges named by flash_args for Web Serial. Carving them from the merged
    # image (rather than copying the inputs) retains merge_bin's header preparation, while separate
    # manifest parts leave NVS and every other gap untouched on a no-Erase update.
    web_parts=""
    web_part_count=0
    while read -r off rel; do
        src="build/$rel"
        [ -f "$src" ] || { echo "flash_args part does not exist: $src" >&2; exit 1; }
        part_size="$(stat -f%z "$src" 2>/dev/null || stat -c%s "$src")"
        part_offset=$((off))
        base="$(basename "$rel")"
        if [ "$base" = "$(basename "$app")" ]; then
            web_name="daikin-altherma-esp32${sfx}.bin"
        else
            web_name="daikin-altherma-esp32${sfx}-web-$base"
        fi
        dd if="$merged" of="$DIST/$web_name" bs=1 skip="$part_offset" count="$part_size" status=none
        web_parts="${web_parts:+$web_parts,}{\"path\":\"$web_name\",\"offset\":$part_offset}"
        web_part_count=$((web_part_count + 1))
    done < <(awk '$1 ~ /^0x[0-9a-fA-F]+$/ { print $1, $2 }' build/flash_args)
    [ "$web_part_count" -gt 0 ] || { echo "no flash parts found in build/flash_args" >&2; exit 1; }

    # The app served to OTA and the app carved for Web Serial are now the exact same bytes. Re-run
    # the signing guard on that final staged file, not only on the pre-merge input.
    if [ -f "$SIGN_KEY" ]; then
        scripts/require-signed.sh "$DIST/daikin-altherma-esp32${sfx}.bin"
    fi

    # Archive the unstripped ELF (+ its checksum) so a core dump from THIS build can be symbolized
    # later (scripts/decode-coredump.sh). The ELF is the ONLY artifact that decodes a dump — the
    # shipped .bin can't — and it's matched to a dump by the app_elf_sha256 the dump embeds. Keep it
    # per build so any version's dumps stay decodable.
    cp "build/daikin-altherma-esp32.elf" "$DIST/daikin-altherma-esp32${sfx}.elf"
    ( cd "$DIST" && sha256sum "daikin-altherma-esp32${sfx}.elf" > "daikin-altherma-esp32${sfx}.elf.sha256" )

    cf="$(chipfamily "$t")"
    builds_json="${builds_json:+$builds_json,}{\"chipFamily\":\"$cf\",\"parts\":[$web_parts]}"
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
scripts/check-web-installer-plan.py "$DIST/manifest.json" partitions.csv
echo "staged dist/ for $VERSION"

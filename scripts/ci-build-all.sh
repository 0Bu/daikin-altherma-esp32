#!/usr/bin/env bash
# Build every supported target from one source tree. The default publishing mode REQUIRES the
# offline OTA key and stages the artifacts the web installer + OTA consume into dist/:
#   daikin-altherma-esp32<suffix>.bin          signed app image (OTA pulls this)
#   daikin-altherma-esp32<suffix>-merged.bin   full-flash image, signed app embedded at its
#                                              flash_args offset (manual factory-reset flash)
#   daikin-altherma-esp32<suffix>-web-*.bin    sparse Web Serial parts; their erase sectors skip
#                                              NVS unless the user explicitly chooses Erase
#   daikin-altherma-esp32<suffix>.elf.xz       unstripped ELF, xz-wrapped — decodes a core dump
#                                              from THIS build (decode-coredump.sh unwraps it)
#   daikin-altherma-esp32<suffix>.elf.sha256   integrity checksum of the ELF *inside* that container
#   daikin-altherma-esp32<suffix>-size.json    ESP-IDF's machine-readable section/region report
#   daikin-altherma-esp32<suffix>-size.md      human-readable app/flash/RAM budget summary
#   manifest.json                              browser-installer builds[] + OTA artifact identity
#   changelog.json                             public, version-bound release/dev build notes
#
# Calls idf.py / esptool / espsecure DIRECTLY — it assumes an ESP-IDF environment is already
# on PATH. In CI that is provided by espressif/esp-idf-ci-action. LOCALLY, after generating the
# version-bound document with generate-ota-changelog.py, run the publishing path wrapped:
#   scripts/idf-docker.sh ./scripts/ci-build-all.sh --source-sha "$(git rev-parse HEAD)" \
#     --changelog-file ota-changelog.json 1.0.0
#
# The version argument must be the version the build EMBEDS — ESP-IDF takes PROJECT_VER from
# version.txt, and this script verifies the two agree before writing the manifest (see below).
# CI stamps version.txt first and passes the same string; the default here is version.txt for the
# same reason. NOT scripts/next-version.sh: that is the next RELEASE version, which is deliberately
# ahead of the version.txt floor once tags exist, i.e. exactly the drift the check rejects.
#
# Usage: scripts/ci-build-all.sh [--compile-only] [--source-sha <40-hex>]
#                                [--changelog-file <json>] [version]
#        (version defaults to the version.txt the build embeds)
#
# Publishing mode requires OTA_SIGNING_KEY_FILE (or ota_signing_key.pem). --compile-only is the
# untrusted-PR path: it builds and size-checks the exact source, but dist/ contains only the ELF and
# size diagnostics. It can never stage an app/merged/Web-Serial binary or installer manifest.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=publish
SOURCE_SHA=""
CHANGELOG_FILE=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --compile-only)
            [ "$MODE" = publish ] || { echo "ci-build-all: --compile-only repeated" >&2; exit 2; }
            MODE=compile-only; shift ;;
        --source-sha)
            [ -z "$SOURCE_SHA" ] || { echo "ci-build-all: --source-sha repeated" >&2; exit 2; }
            [ "$#" -ge 2 ] || { echo "ci-build-all: --source-sha requires 40 hex characters" >&2; exit 2; }
            SOURCE_SHA="$2"; shift 2 ;;
        --changelog-file)
            [ -z "$CHANGELOG_FILE" ] || { echo "ci-build-all: --changelog-file repeated" >&2; exit 2; }
            [ "$#" -ge 2 ] || { echo "ci-build-all: --changelog-file requires a path" >&2; exit 2; }
            CHANGELOG_FILE="$2"; shift 2 ;;
        --) shift; break ;;
        -*) echo "ci-build-all: unknown option '$1'" >&2; exit 2 ;;
        *) break ;;
    esac
done
[ "$#" -le 1 ] || {
    echo "usage: ci-build-all.sh [--compile-only] [--source-sha <40-hex>] [--changelog-file <json>] [version]" >&2
    exit 2
}
if [ -n "$SOURCE_SHA" ] && [[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ci-build-all: --source-sha must be a lowercase 40-character Git SHA" >&2
    exit 2
fi
[ "$MODE" = compile-only ] || [ -n "$SOURCE_SHA" ] || {
    echo "ci-build-all: publishing mode requires --source-sha <40-hex>" >&2
    exit 2
}

# ccache, when the toolchain image has it. `idf.py set-target` below wipes the build directory, so
# every build compiles the whole graph from scratch — in CI that was ~3 minutes of a ~5 minute job,
# repeated per PR push. ESP-IDF wires ccache in itself once IDF_CCACHE_ENABLE is set; the cache
# lives in the WORKSPACE (gitignored) because CI runs this inside the ESP-IDF container and only
# the mounted workspace survives it (.github/workflows/build.yml restores/saves that directory).
#
# Guarded on the binary rather than assumed: without it CMake would launch a compiler that is not
# there and fail the build, and this script must keep working on any IDF image. Locally (via
# scripts/idf-docker.sh) the same cache makes a repeat build cheap too.
if command -v ccache >/dev/null 2>&1; then
    export IDF_CCACHE_ENABLE=1
    export CCACHE_DIR="${CCACHE_DIR:-$PWD/.ccache}"
    export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-400M}"
    # Hash the compiler's CONTENT, not its mtime: a container image re-pulled per CI run has fresh
    # timestamps on identical binaries, which under the default mtime check would miss every time.
    export CCACHE_COMPILERCHECK=content
    echo "ccache: enabled ($CCACHE_DIR, max $CCACHE_MAXSIZE)"
else
    echo "ccache: not installed — building without it"
fi

VERSION="${1:-$(tr -d '[:space:]' < version.txt)}"
TARGETS=(esp32s3)
DIST=dist; rm -rf "$DIST"; mkdir -p "$DIST"
SIGN_KEY="${OTA_SIGNING_KEY_FILE:-ota_signing_key.pem}"
APP_SIZE_LIMIT=$((0x1e8000))   # slot (0x1f0000) minus 32 KB headroom
[ "$MODE" = compile-only ] || [ -f "$SIGN_KEY" ] || {
    echo "ci-build-all: refusing to create flashable artifacts without OTA_SIGNING_KEY_FILE" >&2
    echo "ci-build-all: use --compile-only for an unsigned build that stages diagnostics only" >&2
    exit 1
}
[ "$MODE" = compile-only ] || [ -n "$CHANGELOG_FILE" ] || {
    echo "ci-build-all: publishing mode requires --changelog-file <json>" >&2
    exit 2
}
if [ -n "$CHANGELOG_FILE" ]; then
    [ -f "$CHANGELOG_FILE" ] || { echo "ci-build-all: changelog file not found: $CHANGELOG_FILE" >&2; exit 2; }
    scripts/generate-ota-changelog.py --validate "$CHANGELOG_FILE" --version "$VERSION"
fi
[ -f dependencies.lock ] || {
    echo "dependencies.lock is missing; resolve it with idf.py update-dependencies" >&2
    exit 1
}
LOCK_HASH="$(sha256sum dependencies.lock | cut -d ' ' -f1)"
IDF_VERSION="$(scripts/idf-version.sh)"

suffix()     { echo ""; }
chipfamily() { echo "ESP32-S3"; }

builds_json=""
FINAL_APP_SHA256=""
for t in "${TARGETS[@]}"; do
    echo "=== building $t ($VERSION) ==="
    rm -f sdkconfig
    idf.py set-target "$t"
    [ "$(sha256sum dependencies.lock | cut -d ' ' -f1)" = "$LOCK_HASH" ] || {
        echo "dependencies.lock changed during configuration" >&2
        echo "run idf.py update-dependencies intentionally and commit the resolved lock" >&2
        exit 1
    }
    # Kconfig silently ignores an unknown, renamed or promptless default. Compare every declared
    # assignment with the generated file before compiling so a line that only LOOKS like a build
    # guarantee fails the same build it was meant to control.
    python3 scripts/check-sdkconfig-defaults.py sdkconfig.defaults sdkconfig
    idf.py build
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

    # Sign the app image (RSA-3072, Secure Boot v2 scheme, no hardware Secure Boot). Publishing
    # mode was fail-closed on the key before the build began. Compile-only deliberately leaves the
    # linker output untouched and, crucially, never copies it into dist/.
    # The signed image must land back on $app itself: flash_args flashes the app BY PATH
    # ("0x20000 daikin-altherma-esp32.bin"), so merge-bin below embeds whatever is at that path.
    # Leave the raw linker output there and the browser installer ships an app that aborts in
    # esp_secure_boot_init_checks before app_main — a crash-loop with no bootloader rollback record.
    if [ "$MODE" = publish ]; then
        espsecure sign-data --version 2 --keyfile "$SIGN_KEY" --output "build/daikin-signed.bin" "$app"
        cp "build/daikin-signed.bin" "$app"
        cp "$app" "$DIST/daikin-altherma-esp32${sfx}.bin"
        FINAL_APP_SHA256="$(sha256sum "$app" | cut -d ' ' -f1)"
    else
        echo "compile-only: unsigned $t app remains in build/ and will not be uploaded or published"
    fi

    # Size-check the image that actually gets flashed — signing appends a 4 KB signature sector.
    sz="$(stat -f%z "$app" 2>/dev/null || stat -c%s "$app")"

    # Keep the hard app-slot ceiling, but also retain the whole ELF memory picture. json2 contains
    # the per-region and per-section data needed to compare builds; the Markdown view makes the
    # current Flash/DIRAM/IRAM headroom visible in the Actions summary instead of only on failure.
    size_json="$DIST/daikin-altherma-esp32${sfx}-size.json"
    size_md="$DIST/daikin-altherma-esp32${sfx}-size.md"
    policy_limit="$APP_SIZE_LIMIT"
    # Secure Boot v2 appends a 4 KB signature sector. Reserve it in an unsigned PR build so a PR
    # cannot pass the size gate and then overflow only when the trusted main build signs it.
    [ "$MODE" = publish ] || policy_limit=$((APP_SIZE_LIMIT - 0x1000))
    idf.py size --format json2 --output-file "$size_json"
    python3 scripts/report-firmware-size.py \
        --idf-size "$size_json" \
        --app "$app" \
        --policy-limit "$policy_limit" \
        --target "$t" > "$size_md"
    cat "$size_md"
    [ "$sz" -le "$policy_limit" ] || { echo "app image for $t too big: $sz > $policy_limit" >&2; exit 1; }

    if [ "$MODE" = publish ]; then
        # Canonical full-flash image. Besides remaining useful for an intentional factory-reset
        # flash, merge-bin applies image-header transformations the browser flasher cannot perform.
        # The Web Serial manifest does NOT flash this whole file: merge-bin fills every gap with
        # 0xff, including nvs@0x9000, so writing it at offset 0 destroys the configuration even when
        # the user declines the separate whole-chip Erase prompt.
        merged="$DIST/daikin-altherma-esp32${sfx}-merged.bin"
        ( cd build && esptool --chip "$t" merge-bin -o "../$merged" @flash_args )

        # Self-check: CI must never publish an installer image with an unsigned app. Verify the app
        # region of the MERGED artifact — carved back out at the offset flash_args gave it — rather
        # than the file we told merge-bin to read, so the path indirection itself stays covered.
        # Both offsets are 4 KB multiples (an app partition is 64 KB-aligned; signing pads to 4 KB
        # and appends a 4 KB signature sector), so dd can carve it out block-wise — no pipe into
        # `head`, whose early close would SIGPIPE dd into a spurious pipefail once anything follows.
        off="$(awk -v f="$(basename "$app")" '$2 == f { print $1 }' build/flash_args)"
        [ -n "$off" ] || { echo "no app entry for $(basename "$app") in build/flash_args" >&2; exit 1; }
        dd if="$merged" of=build/merged-app.bin bs=4096 skip=$(( off / 4096 )) count=$(( sz / 4096 )) status=none
        scripts/require-signed.sh build/merged-app.bin

        # Stage only the byte ranges named by flash_args for Web Serial. Carving them from the
        # merged image retains merge-bin's header preparation, while separate manifest parts leave
        # NVS and every other gap untouched on a no-Erase update.
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
            staged_size="$(stat -f%z "$DIST/$web_name" 2>/dev/null || stat -c%s "$DIST/$web_name")"
            [ "$staged_size" -eq "$part_size" ] || {
                echo "short Web Serial part $web_name: $staged_size != $part_size" >&2
                exit 1
            }
            web_parts="${web_parts:+$web_parts,}{\"path\":\"$web_name\",\"offset\":$part_offset}"
            web_part_count=$((web_part_count + 1))
        done < <(awk '$1 ~ /^0x[0-9a-fA-F]+$/ { print $1, $2 }' build/flash_args)
        [ "$web_part_count" -gt 0 ] || { echo "no flash parts found in build/flash_args" >&2; exit 1; }

        # The app served to OTA and the app carved for Web Serial are now the exact same bytes.
        # Re-run the signing guard on that final staged file, not only on the pre-merge input.
        scripts/require-signed.sh "$DIST/daikin-altherma-esp32${sfx}.bin"
    fi

    # Archive the unstripped ELF (+ its checksum) so a core dump from THIS build can be symbolized
    # later (scripts/decode-coredump.sh). The ELF is the ONLY artifact that decodes a dump — the
    # shipped .bin can't — and it's matched to a dump by the app_elf_sha256 the dump embeds. Keep it
    # per build so any version's dumps stay decodable.
    #
    # Stored xz-compressed, because the ELF is ~70% of a ~9 MB build artifact and artifact STORAGE
    # is a metered resource the 90-day archive was overrunning (see build.yml's upload step for the
    # arithmetic). Three things about HOW it is compressed are load-bearing:
    #
    #   - xz is an OUTER CONTAINER. The ELF bytes inside stay exactly what the linker emitted, so
    #     the app_elf_sha256 esp-coredump matches a dump against still matches. That is what rules
    #     out the cheaper-looking `objcopy --compress-debug-sections`: it rewrites the ELF itself,
    #     so every future decode of every archived build would warn "ELF file SHA256 mismatch" —
    #     turning the guard that catches a WRONG elf (decode-coredump.sh) into permanent noise.
    #   - NOT gzip. The artifact zip already applies Deflate, so wrapping in a second Deflate saves
    #     nothing; only a stronger algorithm buys anything, and DWARF is exactly what xz beats
    #     Deflate on.
    #   - The checksum is taken BEFORE compressing and keeps naming the plain `.elf`. It is the
    #     identity of the ELF, not of its container, so it stays comparable to every checksum
    #     published before this change — including the ones already attached to released versions.
    #
    # -T0 (all cores) gives up a little ratio — threaded xz splits the input into per-thread blocks,
    # so matches cannot be found across a block boundary — and buys back far more CI minutes than
    # that is worth; CI time is the other metered resource. Report both sizes: the ratio is the whole
    # justification for the retention window build.yml picks, so it belongs in the run log rather
    # than in anyone's estimate, this comment's included.
    elf="$DIST/daikin-altherma-esp32${sfx}.elf"
    cp "build/daikin-altherma-esp32.elf" "$elf"
    ( cd "$DIST" && sha256sum "daikin-altherma-esp32${sfx}.elf" > "daikin-altherma-esp32${sfx}.elf.sha256" )
    elf_raw="$(stat -f%z "$elf" 2>/dev/null || stat -c%s "$elf")"
    if command -v xz >/dev/null 2>&1; then
        xz -9 -T0 -f "$elf"
    else
        # No xz binary. ESP-IDF always brings a Python and lzma is stdlib, so this is a real
        # fallback — never "leave it uncompressed", which would silently double storage again and
        # look identical in a green log.
        python3 -c 'import lzma, shutil, sys
with open(sys.argv[1], "rb") as f, lzma.open(sys.argv[1] + ".xz", "wb", preset=9) as g:
    shutil.copyfileobj(f, g)' "$elf"
        rm -f "$elf"
    fi
    [ -f "$elf.xz" ] || { echo "ELF compression produced no $elf.xz" >&2; exit 1; }
    elf_comp="$(stat -f%z "$elf.xz" 2>/dev/null || stat -c%s "$elf.xz")"
    awk -v r="$elf_raw" -v c="$elf_comp" 'BEGIN { printf "archived ELF: %.1f MB -> %.1f MB xz (%.1fx)\n", r/1e6, c/1e6, r/c }'

    if [ "$MODE" = publish ]; then
        cf="$(chipfamily "$t")"
        builds_json="${builds_json:+$builds_json,}{\"chipFamily\":\"$cf\",\"parts\":[$web_parts]}"
    fi
done

if [ "$MODE" = compile-only ]; then
    scripts/check-nonflashable-artifacts.sh "$DIST"
    echo "staged non-flashable compile diagnostics in $DIST/ for $VERSION"
    exit 0
fi
[ -n "$FINAL_APP_SHA256" ] || { echo "ci-build-all: final signed app hash is missing" >&2; exit 1; }

# One manifest serves both the installer (builds[]) and OTA (version). The browser installer reads
# builds[]/chipFamily; the device OTA reads .version and pulls daikin-altherma-esp32<suffix>.bin.
cat > "$DIST/manifest.json" <<EOF
{
  "name": "daikin-altherma-esp32",
  "version": "$VERSION",
  "provenance": {
    "source_sha": "$SOURCE_SHA",
    "idf_version": "$IDF_VERSION",
    "dependencies_lock_sha256": "$LOCK_HASH",
    "app_sha256": "$FINAL_APP_SHA256"
  },
  "new_install_prompt_erase": true,
  "builds": [$builds_json]
}
EOF
scripts/check-manifest-provenance.py "$DIST/manifest.json" \
    "$DIST/daikin-altherma-esp32.bin" "$SOURCE_SHA" "$IDF_VERSION" dependencies.lock
scripts/check-web-installer-plan.py "$DIST/manifest.json" partitions.csv
cp "$CHANGELOG_FILE" "$DIST/changelog.json"
echo "staged dist/ for $VERSION"

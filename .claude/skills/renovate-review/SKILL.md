---
name: renovate-review
description: Review and merge a Renovate dependency PR. The two tracked firmware deps (esp-web-tools, espressif/esp-idf) are deliberately never auto-merged because a green build cannot prove either still works — each needs a real hardware test the user must perform. Use when a Renovate PR needs review or merging.
model: sonnet
---

# renovate-review

Most Renovate PRs here self-merge. The two that don't are the point of this skill: a green build
proves the firmware **compiles**, which is not the question either of these bumps raises.

[`.github/renovate.json`](../../../.github/renovate.json) says it plainly — a green build

> does NOT prove the X10A decode path still matches a real heat pump, that WiFi/MQTT behaviour
> survives an ESP-IDF bump, or that the browser installer still flashes (esp-web-tools, which the
> build never exercises).

So for these two, **"CI is green" is not a merge argument**. The evidence has to come from a board.

## 1. Which kind of PR is this?

Read the diff — don't infer from the title:

```bash
gh pr diff <N> --name-only
gh pr checks <N>
```

| Changed | Dependency | What it needs |
|---|---|---|
| `docs/index.html` | `esp-web-tools` | §2 — a real Web Serial flash |
| `.github/workflows/build.yml` (`esp_idf_version:`) | `espressif/esp-idf` | §3 — a real build + a running board |
| action pins in `.github/workflows/*` | GitHub Action digests | nothing — Renovate self-merges these |

The authority is `matchDepNames` in `.github/renovate.json`, not this table. If a bump is listed
there, a human merges it; read the file if a new dep ever joins the list.

## 2. esp-web-tools — the browser installer

One line changes (the CDN pin), every gate passes, and **nothing automated touches the flash path** —
which is exactly what differs between versions. 10.3.0 replaced the DTR/RTS reset with
`esploader.after()` and moved esptool-js to 0.6.0 (`Uint8Array` instead of binary strings). Both only
fail on real hardware, and the reference board is native USB-Serial/JTAG, where reset behaviour is
most fragile.

**There is no PR preview to click.** [`build.yml`](../../../.github/workflows/build.yml) gates the
preview publish on `github.event.repository.private == false`; while the repo is private, local is
the only path.

### 2.1 Check the contract against the dependency's own source

Release notes are a claim, not evidence — verify against the code. The npm tarball ships readable
`src/`:

```bash
for v in <old> <new>; do
  mkdir -p "$v" && curl -sSL "https://registry.npmjs.org/esp-web-tools/-/esp-web-tools-$v.tgz" | tar xz -C "$v"
done
diff -u <old>/package/src/const.ts <new>/package/src/const.ts   # the manifest contract
diff -u <old>/package/src/flash.ts <new>/package/src/flash.ts   # build selection + transport/reset
```

- `const.ts` defines `Manifest` / `Build`. Everything our manifest emits
  ([`scripts/ci-build-all.sh`](../../../scripts/ci-build-all.sh), bottom heredoc) must still be
  accepted: `chipFamily: "ESP32-S3"`, `parts[].path` + `.offset`, `new_install_prompt_erase`.
- `flash.ts` decides **which build gets selected**. This is the sharp edge: 10.3.0 added optional
  `serialType` and picks `serialType === detected` *first*, falling back to
  `serialType === undefined`. Our manifest sets no `serialType`, so it survives only because that
  fallback exists. A future version that drops the fallback would silently render our manifest
  unmatchable — "your board is not supported" — with CI still green.

Don't reason about the selection; **run it**. Extract the real selection expression from the new
`flash.ts` into a scratch `.mjs`, feed it the repo's real manifest, and assert a build comes back for
the detected board, for a UART bridge, for unknown port info, and that a wrong `chipFamily` returns
nothing. The board's identity for the CDC check: VID `0x303A`, PID `0x1001`
("USB JTAG_serial debug unit").

### 2.2 Get a bootable image — pull it from CI, don't build it

Do **not** run `ci-build-all.sh` locally to produce the flash payload. It signs *inside* the ESP-IDF
container, and the offline key must never enter the repo or the container (it is mounted nowhere;
a hook blocks commands that name its path). Unsigned is not a fallback — it crash-loops before
`app_main`.

The PR's own CI run already built and signed the exact image, because same-repo Renovate branches
get the secret:

```bash
gh pr checks <N>                       # grab the run id
gh api repos/0Bu/daikin-altherma-esp32/actions/runs/<run-id>/artifacts \
  --jq '.artifacts[] | "\(.name) expired=\(.expired)"'
gh run download <run-id> -n daikin-altherma-esp32-<version>-PR-<N> -D <dir>
```

Verify before it goes near the board — the signature, and that the app *inside* the merged image is
the signed one (`@flash_args` puts the app at `0x20000`; carve it back out and compare):

```bash
scripts/require-signed.sh <dir>/daikin-altherma-esp32.bin
dd if=<dir>/daikin-altherma-esp32-merged.bin of=build/merged-app.bin bs=4096 \
   skip=$((0x20000/4096)) count=$(($(stat -f%z <dir>/daikin-altherma-esp32.bin)/4096)) status=none
cmp build/merged-app.bin <dir>/daikin-altherma-esp32.bin && echo "merged embeds the signed app"
```

### 2.3 Serve the installer exactly as it ships

Reuse the real scripts so the test subject isn't a hand-built approximation. Write
`dist/manifest.json` in the shape `ci-build-all.sh` emits (copy its heredoc; the `version` must match
what the image embeds), then:

```bash
scripts/build-pages.sh                       # assembles _site/ from dist/ + docs/index.html
python3 -m http.server 8765 --bind 127.0.0.1 # localhost IS a secure context -> Web Serial works
```

Confirm the page itself before involving the user: the script src is the new version, the custom
element upgrades (`install-supported` set, not `install-unsupported`), its shadow root still exposes
`<slot name="activate">` (the slot `docs/index.html` fills), and the console is clean.

### 2.4 The flash needs the user — you cannot do it

`navigator.serial.requestPort()` opens Chrome's **native** port picker. It is not page DOM: the
in-app browser has Web Serial but no host USB (zero ports; the click does nothing), the Chrome
extension cannot click browser-chrome dialogs, and computer-use grants browsers read-only. Don't
burn turns trying.

Set everything up, then hand over a short, specific ask: open the URL in Chrome, click Install, pick
"USB JTAG_serial debug unit", and report back. Tell them what a failure looks like, since that is the
whole point of the test:

| Phase | What a new version tends to change | Symptom |
|---|---|---|
| Connect | the reset sequence | *"Failed to initialize… hold the BOOT button"* |
| Write | the esptool-js data API | write error / abort |
| Reboot | the same reset path | completes but the board doesn't come back |

Their answer is the test result. Nothing else in this section substitutes for it.

## 3. espressif/esp-idf — the toolchain

`scripts/idf-docker.sh` reads the version straight from `build.yml`, so the bumped PR builds against
the new image with no extra setup:

```bash
rm -rf build sdkconfig
scripts/idf-docker.sh idf.py set-target esp32s3 build
scripts/run-mock-tests.sh && scripts/run-domain-audit.sh
```

That is a compile check. It says nothing about the behaviour the renovate.json note warns about
(mbedTLS, component moves, `esp-mqtt` / `esp_https_ota` TLS). On a **major** bump Renovate attaches a
migration-guide reminder to the PR body — follow it.

Then verify on hardware, because a toolchain bump can compile perfectly and break the radio: use
[`flash-esp32`](../flash-esp32/SKILL.md) (build in Docker, sign on the **host** — that path works,
unlike §2.2's, because the key never leaves the host) and then [`device-triage`](../device-triage/SKILL.md)
to confirm WiFi associates, MQTT connects, X10A decodes real values, and the heap headroom on
`/status.sys` hasn't regressed.

## 4. Merging

The gates are unchanged by this being a bot's PR. **Derive which apply** — never trust a list
written down anywhere, including here:

```bash
ls .claude/hooks/require-*.sh          # each names its gate + its relevance filter
```

Run each applicable skill, then tick + SHA-stamp its box in the PR body against the PR head
(`gh pr edit <N> --body-file <file>`; append to Renovate's body, don't replace it). Merge
`--squash` — `main` stays linear and GPG-signed via GitHub's web-flow key.

Record the hardware result in the PR body. It is the only evidence that the thing CI cannot test was
tested, and after the squash it is the sole surviving trace.

## Notes
- **A red flag worth blocking on:** the bump needs a manifest change (a required new field, a dropped
  fallback). That is `ci-build-all.sh`'s heredoc, i.e. firmware-adjacent — treat it as a real change,
  not a version bump, and re-run the full gates on it.
- Renovate's body carries a rebase checkbox; leave it alone, and expect Renovate to rewrite the body
  if it rebases (your stamps go with it — re-stamp after any new head commit).
- Clean up after the test: `dist/` is **not** gitignored (only `/_site/` is), so a local build leaves
  untracked output that can be committed by accident.
- The bench board has no live pump wired, so all-timeout X10A readings there are expected, not a
  regression.

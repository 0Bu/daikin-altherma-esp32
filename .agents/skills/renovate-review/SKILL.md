---
name: renovate-review
description: Review a Renovate dependency PR and merge only when the user explicitly requests it after validation. The two tracked firmware dependencies (esptool-js and espressif/esp-idf) are never auto-merged because a green build cannot prove hardware behavior. Use when a Renovate PR needs review or an explicitly authorized merge.
---

# renovate-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

Most Renovate PRs here self-merge. The two that don't are the point of this skill: a green build
proves the firmware **compiles**, which is not the question either of these bumps raises.

[`.github/renovate.json`](../../../.github/renovate.json) says it plainly — a green build

> does NOT prove the X10A decode path still matches a real heat pump, that WiFi/MQTT behaviour
> survives an ESP-IDF bump, or that the browser installer still flashes (esptool-js, which the
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
| `docs/index.html` | `esptool-js` | §2 — a real Web Serial flash |
| `.github/workflows/build.yml` (`esp_idf_version:`) | `espressif/esp-idf` | §3 — a real build + a running board |
| action pins in `.github/workflows/*` | GitHub Action digests | nothing — Renovate self-merges these |

The authority is `matchDepNames` in `.github/renovate.json`, not this table. If a bump is listed
there, a human merges it; read the file if a new dep ever joins the list.

## 2. esptool-js — the browser installer

One line changes (the CDN pin), every gate passes, and **nothing automated touches the electrical
flash path** — which is exactly what differs between versions. The inline installer depends on
`Transport`, `ESPLoader.main()`, sparse `writeFlash()`, `reportProgress()` and `after("hard_reset")`.
These can all keep their TypeScript shape while changing reset or stream-lock behaviour that only
fails on real hardware. The reference board is native USB-Serial/JTAG, where reset is most fragile.

**There is no PR preview to click.** The per-PR preview installer is retired (each one cost a
`gh-pages` push and the Pages deployment that follows it), so an esptool-js bump cannot be
flashed straight from the PR. Two paths remain, and for this dependency they are the whole test:
build and serve the installer page locally, or **merge to `main` and flash the dev channel**
(`…/dev/`), which republishes on the merge and is what a dev-channel board would receive anyway.

### 2.1 Check the contract against the dependency's own source

Release notes are a claim, not evidence — verify against the code. Compare the official tags and
the npm package's readable `lib/` output:

```bash
for v in <old> <new>; do
  mkdir -p "$v" && curl -sSL "https://registry.npmjs.org/esptool-js/-/esptool-js-$v.tgz" | tar xz -C "$v"
done
diff -ru <old>/package/lib <new>/package/lib
```

- `Transport` still has to open, read, reset and close the same Web Serial port without leaving a
  lock behind for the on-page Serial Monitor.
- `ESPLoader.writeFlash()` must still accept `Uint8Array` parts plus `flashSize`/`flashMode`/
  `flashFreq: "keep"`, `compress: true`, and the three-argument progress callback.
- `ESPLoader.after("hard_reset")` must still restore the running firmware on the native
  USB-JTAG/Serial path.

Run `node --test test/web_installer.test.mjs` against the bump. It gates our manifest selection,
weighted sparse-part progress and no-Erase boundary. Then inspect the changed dependency source for
the methods above; do not infer compatibility from an unchanged exported type alone.

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

Confirm the page itself before involving the user: the pinned `esptool-js` module loads, manifest
version appears, the native chooser is the only dialog, the connection/progress UI stays in-page,
the Serial Monitor tongue opens under the USB card, and the console is clean.

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
| Connect | the reset sequence | *"Connection failed"* / chip never becomes suitable |
| Write | the binary/progress API | write error / abort |
| Reboot | the same reset path | completes but the board doesn't come back |

Their answer is the test result. Nothing else in this section substitutes for it.

## 3. espressif/esp-idf — the toolchain

`scripts/idf-docker.sh` reads the version straight from `build.yml`, so the bumped PR builds against
the new image. The workflow pin and the component graph are two halves of one toolchain update:
regenerate the committed lock with that new image before compiling, and review every version/hash
change rather than accepting an implicit resolver rewrite:

```bash
rm -rf build sdkconfig
scripts/idf-docker.sh idf.py update-dependencies
git diff -- dependencies.lock main/idf_component.yml
scripts/idf-docker.sh idf.py build
scripts/run-mock-tests.sh && scripts/run-domain-audit.sh
```

Commit the regenerated `dependencies.lock` onto the Renovate branch. `ci-build-all.sh` deliberately
fails if configuration rewrites the lock, so an IDF pin cannot merge with a graph resolved by the
old toolchain. If the new IDF falls outside `main/idf_component.yml`'s declared floor/range, update
that manifest in the same commit and re-resolve once more.

That is a compile check. It says nothing about the behaviour the renovate.json note warns about
(mbedTLS, component moves, `esp-mqtt` / `esp_https_ota` TLS). On a **major** bump Renovate attaches a
migration-guide reminder to the PR body — follow it.

Then verify on hardware, because a toolchain bump can compile perfectly and break the radio: use
[`flash-esp32`](../flash-esp32/SKILL.md) (build in Docker, sign on the **host** — that path works,
unlike §2.2's, because the key never leaves the host) and then [`device-triage`](../device-triage/SKILL.md)
to confirm WiFi associates, MQTT connects, X10A decodes real values, and the heap headroom on
`/status.sys` hasn't regressed.

## 4. Merging

The gates are unchanged by this being a bot's PR. **Derive which apply** from the canonical
[`tools/agent-hooks/require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh), never
from a copied list. The only supported merge command is the lease-bound path documented in
[`docs/AGENT_MIGRATION.md`](../../../docs/AGENT_MIGRATION.md):

```bash
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr merge <number> --match-head-commit <full-current-head-sha> --squash
```

Run each applicable skill, then tick + SHA-stamp its box in the PR body against the PR head
(`gh pr edit <N> --body-file <file>`; append to Renovate's body, don't replace it). `main` stays
linear and GPG-signed via GitHub's web-flow key.

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

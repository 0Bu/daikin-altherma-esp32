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
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr diff <N> --name-only
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr checks <N>
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

**There is no PR preview to click.** The per-PR preview installer is retired, and pull-request CI
deliberately publishes no flashable artifact. The source/API and Node checks below remain available,
but there is currently no supported pre-merge browser-flash path that reproduces the production
sparse plan. Merging to `main` and flashing the republished dev channel is post-merge evidence only;
it cannot satisfy pre-merge evidence without an explicit risk decision.

### 2.1 Check the contract against the dependency's own source

Release notes are a claim, not evidence — verify against the code. Compare the official tags and
the npm package's readable `lib/` output:

```bash
review_tmp="$(mktemp -d "${TMPDIR:-/tmp}/daikin-renovate-review.XXXXXX")"
for v in <old> <new>; do
  mkdir -p "$review_tmp/$v"
  curl -sSL "https://registry.npmjs.org/esptool-js/-/esptool-js-$v.tgz" \
    | tar xz -C "$review_tmp/$v"
done
diff -ru "$review_tmp/<old>/package/lib" "$review_tmp/<new>/package/lib"
```

Keep extraction outside the repository. Do not delete or replace an existing workspace directory to
make room for review inputs.

- `Transport` still has to open, read, reset and close the same Web Serial port without leaving a
  lock behind for the on-page Serial Monitor.
- `ESPLoader.writeFlash()` must still accept `Uint8Array` parts plus `flashSize`/`flashMode`/
  `flashFreq: "keep"`, `compress: true`, and the three-argument progress callback.
- `ESPLoader.after("hard_reset")` must still restore the running firmware on the native
  USB-JTAG/Serial path.

Run `node --test test/web_installer.test.mjs` against the bump. It gates our manifest selection,
weighted sparse-part progress and no-Erase boundary. Then inspect the changed dependency source for
the methods above; do not infer compatibility from an unchanged exported type alone.

### 2.2 Establish the pre-merge flash boundary

Pull-request CI is deliberately **compile-only** and publishes only ELF/size diagnostics. It does
not receive the offline signing key and does not produce a flashable application, merged image or
installer manifest. Never request or accept a purported signed PR CI artifact.

Pre-merge USB flashing is therefore available only when the user separately authorizes both the
hardware flash and direct host use of the offline OTA signing key. Use the global
`$daikin-esp32-premerge-hardware` workflow for that exact-head local build/sign/flash chain. The key
must never enter Docker or the repository, and the signing command must remain a direct, unchained
host `espsecure sign-data` invocation. Without that separate authorization and key access, report
pre-merge hardware flashing as unavailable. A later merge plus dev-channel flash is post-merge
evidence and cannot be backdated into this review.

### 2.3 Do not invent a substitute browser-flash plan

A one-part app manifest at fixed `ota_0` offset is not equivalent to production: `otadata` may still
select `ota_1`, and it omits the bootloader/partition/OTA-data parts whose interaction with
esptool-js is part of the real installer. Do not manufacture that shortcut or claim a direct host
flash exercises the browser dependency.

Until the repository has an audited host-side packager or a trusted exact-head signer that can
produce the same validated sparse plan as trusted `main` CI, report pre-merge browser hardware
evidence as unavailable. If that evidence is required, it blocks merge unless the user makes an
explicit risk decision. A separately authorized dev-channel browser flash after merge may validate
the production plan, but remains clearly post-merge evidence.

## 3. espressif/esp-idf — the toolchain

`scripts/idf-docker.sh` reads the version straight from `build.yml`, so the bumped PR builds against
the new image. The workflow pin and the component graph are two halves of one toolchain update.
Regenerating the lock edits the Renovate branch, so create a dedicated clean worktree and run the
following block there only after the user explicitly authorizes branch edits. Otherwise inspect the
existing diff and CI read-only and report a missing new-toolchain lock resolution as a blocker. Do
not delete or reuse an existing `build/` or `sdkconfig` owned by the user:

```bash
scripts/idf-docker.sh idf.py -B build-renovate update-dependencies
git diff -- dependencies.lock main/idf_component.yml
scripts/idf-docker.sh idf.py -B build-renovate build
scripts/run-mock-tests.sh && scripts/run-domain-audit.sh
```

If the user explicitly authorized branch edits, commit the regenerated `dependencies.lock` onto the
Renovate branch. Otherwise report the required lockfile update as a blocking finding and leave the
branch unchanged. `ci-build-all.sh` deliberately fails if configuration rewrites the lock, so an IDF
pin cannot merge with a graph resolved by the old toolchain. An `idf_component.yml` range update and
second resolution likewise require explicit branch-edit authorization.

That is a compile check. It says nothing about the behaviour the renovate.json note warns about
(mbedTLS, component moves, `esp-mqtt` / `esp_https_ota` TLS). On a **major** bump Renovate attaches a
migration-guide reminder to the PR body — follow it.

Hardware validation needs its own explicit user authorization, including separate authorization for
host use of the offline signing key. When granted, use [`flash-esp32`](../flash-esp32/SKILL.md) and
then [`device-triage`](../device-triage/SKILL.md) to confirm WiFi, MQTT, X10A and heap behavior. When
not granted or unavailable, record the missing hardware evidence; do not perform the flash as an
implicit part of review.

## 4. Merging

The gates are unchanged by this being a bot's PR. **Derive which apply** from the canonical
[`tools/agent-hooks/require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh), never
from a copied list. The only supported merge command is the lease-bound path documented in
[`docs/AGENT_MIGRATION.md`](../../../docs/AGENT_MIGRATION.md):

```bash
scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT \
  repos/0Bu/daikin-altherma-esp32/pulls/<number>/merge \
  -f sha=<full-current-head-sha> -f merge_method=squash
```

Run each applicable skill. Editing the PR body requires separate explicit authorization; when it is
not granted, report the completed exact-head reviews without mutating GitHub. When authorized, tick
and SHA-stamp the applicable boxes by appending to Renovate's body through the credential wrapper.
The final REST merge itself is allowed only when the user explicitly requested merge and every
required gate and decision is resolved. `main` stays linear and GPG-signed via GitHub's web-flow key.

When a PR-body edit was separately authorized, record the hardware result there so it survives the
squash. Otherwise return the result locally and state that GitHub was not mutated.

## Notes
- **A red flag worth blocking on:** the bump needs a manifest change (a required new field, a dropped
  fallback). That is `ci-build-all.sh`'s heredoc, i.e. firmware-adjacent — treat it as a real change,
  not a version bump, and re-run the full gates on it.
- Renovate's body carries a rebase checkbox; leave it alone, and expect Renovate to rewrite the body
  if it rebases (your stamps go with it — re-stamp after any new head commit).
- Clean up after the test: `dist/` is **not** gitignored (only `/_site/` is), so a local build leaves
  untracked output that can be committed by accident.
- Record whether the validation board was connected to a live X10A source. All-timeout readings on an
  unconnected board may be expected, but they do not prove X10A compatibility.

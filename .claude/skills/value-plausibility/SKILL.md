---
name: value-plausibility
description: Audit a live daikin-altherma-esp32's published values for plausibility across MQTT and VictoriaMetrics, distinguish idle from broken using history, and flag physically wrong, absent-feature, sentinel-placeholder, duplicate, or missing values. Use when values look wrong or missing in the web UI, Home Assistant, or Grafana, or for periodic catalog verification. Report findings by default; fix or open a PR only when explicitly requested.
model: sonnet
---

# value-plausibility

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope.

Answer one question about a **running** unit: **are the values it publishes physically true,
complete and authentic?** This is the live-data counterpart to `/domain-review` (which audits the
static catalog) and `device-triage` (which audits board health). It reads three surfaces that must
agree — the device `/values`, the MQTT state Home Assistant sees, and the VictoriaMetrics history
Grafana plots — and reports where a published number is impossible, a placeholder dressed as a
reading, or an absent-feature register that no such unit populates.

**Why this is its own gate.** The catalog can be well-formed, compile, pass every host test and the
domain audit — and still publish `-40.4 °C` from a sensor that does not exist, `0.0 bar` on a sealed
refrigerant circuit, or a whole hybrid-boiler page on a non-hybrid unit. Those are only visible
against a **real unit's live and historical data**; a static audit cannot see them (issues #35–#39
were exactly this shape, found by slow manual review). This skill mechanizes that review.

**Read-only** on the device and the observability stack. Repository and GitHub writes happen only
when the user explicitly requests them, and each remains scoped to that request.

## Inputs — discover them, do not hardcode

```bash
H=daikin-altherma-esp32.local                      # or the IP the user gives (mDNS may not resolve)
curl -sS --max-time 5 "http://$H/status" | tee /tmp/vp_status.json | jq '{mqtt,detect:.detect.model,profile}'
BROKER=$(jq -r '.mqtt.broker' /tmp/vp_status.json)  # e.g. 192.168.1.10:1883 — the MQTT host:port
BASE=daikin-altherma-esp32                          # MQTT base topic (fixed by convention)
```

- **MQTT (current)** — no client is installed by default; use Python `paho.mqtt` (present) against
  `$BROKER`. Subscribe `#` for ~10 s and keep the retained `state`/`heartbeat`/`crash` topics.
- **VictoriaMetrics (long-term)** — the `victoria-metrics` MCP (`mcp__victoria-metrics__*`). Series
  are `daikin_altherma_*` (grouped state values) and `daikin_heartbeat_*` (board/link). Telegraf
  ingests **numeric fields only** — every ON/OFF and text-enum value is absent from VM *by design*,
  so a boolean/enum missing from VM is **not** a finding.
- **Device `/values`** — the decoder's own truth, includes null rows the MQTT state omits.

## The plausibility rules

Apply these to every value; each firing is a finding with a **witness** (the value, its source, and
why it is wrong).

1. **Physical envelope.** A °C reading outside `[-60, 200]` is impossible for this machine (matches
   the firmware's own `reading_plausible`). Pressures (`bar`) are `≥ 0` and a sealed R32 circuit is
   never at absolute 0 — at rest it sits at the equalised saturation pressure (~12–15 bar near 20 °C);
   under load high-side ~20–40, low-side ~5–10. Currents/frequencies `≥ 0`; `rps` ≤ ~120.
2. **Sentinel placeholders** (the #35–#39 class — a "no data" code published as a reading). Flag the
   raw-scaled sentinels: `±3276.7/±3276.8` (0x7FFF/0x8000 ×0.1), `12800` (a valve position typed °C),
   `-971.5`, and the field-specific "no sensor" values seen on real hardware — **`-40.4 °C`** (a 2nd
   DHW / absent probe), `576.0`, `231.6`, `-51.2`. In-envelope sentinels (`-40.4`, `0.0`) are the
   dangerous ones: the envelope check misses them, so match them explicitly.
3. **Idle vs. broken — decide with HISTORY, not one sample.** A value that reads `0.0`/`OFF` *now*
   may be a genuine idle state (compressor off in summer) or a dead register. Query the VM series
   over a window that spans real operation (≥ 30 days, or the longest available):
   ```
   max_over_time(daikin_altherma_<group>_<field>[30d])   # ever nonzero?  →  real sensor, just idle
   ```
   - Nonzero at some point in history → **real, currently idle** (not a finding; note it if the UI
     paints it as live, e.g. `0.0 bar` on a refrigerant line — a display bug, not a data bug).
   - **Always** `0`/absent across the whole window → **absent-feature** (a register this unit never
     populates). This is the strongest, most defensible signal and the one a single snapshot cannot
     give you.
4. **Absent-feature clusters.** Whole pages that a given model does not physically have (e.g. the
   `0x64` hybrid/boiler page — Hybrid Op. Mode, Boiler demands, BE_COP, Hybrid/Boiler targets, Mixed
   water, 2nd DHW — on a non-hybrid hydrobox/monobloc). Confirm with rule 3 across the cluster: if the
   whole page is flat-zero over history, it is over-included for this model.
5. **Wrong semantics / unit.** A non-temperature quantity carrying a °C `type` (valve position,
   step). Cross-check the label against `docs/REGISTERS.md`.
6. **Duplicate labels.** Two rows with the **same** label (different reg/offset). In HA their
   discovery `object_id` collides → one entity silently overwrites the other; in `/values` they show
   twice. Report the pair and which register each is.
7. **Cross-source completeness.** Reconcile counts: device `/values` (all, incl. null) ≥ MQTT state
   leaves (null rows omitted) ≥ VM numeric series (enums/booleans absent by design). A **numeric**
   value present in `/values` but missing from the MQTT state, or a state key absent from VM, is a
   real publish/ingest gap — investigate. A missing enum/boolean is expected (rule: VM is numeric-only).

## Steps

1. **Snapshot all three surfaces.** `/status` + `/values` from the device; a ~10 s MQTT capture of
   `$BASE/state`, `$BASE/heartbeat`, `$BASE/crash` and the `homeassistant/…` discovery configs; note
   `detect.model` + `profile.id` and whether `detect.ambiguous`.

2. **Establish the operating context.** Is the compressor running right now
   (`INV frequency (rps) > 0`)? Idle (summer DHW standby) makes most outdoor-unit rows legitimately
   `0.0` — do **not** flag those as broken; that is what rule 3's history query is for.

3. **Run the rules.** For each published value, apply rules 1–7. Use the VM history query (rule 3) to
   split idle from absent-feature — this is the heart of the skill and the part a static audit or a
   single snapshot cannot do.

4. **Classify and witness.** Bucket every finding: `impossible` / `sentinel` / `absent-feature` /
   `wrong-semantics` / `duplicate-label` / `publish-gap`, each with its witness (value + source +
   the history that proves idle-vs-absent). Separate a **data** bug (wrong number published) from a
   **display** bug (a real number the UI/schematic shows misleadingly, e.g. idle `0.0 bar` where the
   `Refrigerant pressure sensor` carries the real at-rest pressure).

5. **Report first.** Lead with the verdict — complete? authentic? — then the buckets, most-severe
   first. State plainly which surface each finding came from and which are device-reported vs.
   verified against history. Recommend a fix layer per finding (see below). **Stop here and let the
   user weigh in before opening a PR** unless they have already said "and open a PR".

6. **Fix + PR (only when warranted and wanted).** Pick the fix at the RIGHT layer — this is where
   naïve fixes go wrong:
   - **Display bug** (idle value shown misleadingly) → the relevant `www/js/` fragment only. No
     decode/catalog change. Verify `node test/test_ui_bundle.mjs`.
   - **Wrong converter / unit / duplicate label** → the catalog. Profiles are **GENERATED**
     (`gen_profiles.py`, external to this repo) — do not blind-edit; change `docs/REGISTERS.md` (the
     in-repo source of truth) **and** the affected profiles consistently, then flag in the PR that the
     external generator must be re-synced. Never `sed`; use exact-string edits with verified counts.
   - **Absent-feature rows** → NOT a simple row deletion. **A profile's detection signature IS the set
     of register pages its rows reference** (`def/signatures.hpp` → `page_mask`), and
     `detect_candidates` picks the profile with **maximal page overlap** (`logic/detect.hpp`). The
     real unit answers the page, so deleting its rows makes the correct profile *lose* to a
     feature-richer wrong one → mis-detection AND the garbage returns via the wrong profile. The
     correct fix keeps the rows for detection but marks them non-publishing (a `no_publish`-style flag
     on `ValueDef` + a skip in the poll/decode path + a host test), or is scoped so *no* consistent
     profile keeps an advantage. Treat this as a design change, not a data edit — surface the options,
     do not guess.
   - Always re-run the gates before committing: `scripts/run-mock-tests.sh`,
     `scripts/run-domain-audit.sh`, `tools/domain/selftest.sh`, and `node --check` for any UI change.

   When the user explicitly requested a PR, open it on a worktree branch against `main` (linear
   history, signed commits — the repo config handles signing). Describe every finding, the fix layer
   chosen, what was verified, and any
   deferred item (with its options) for the user to decide. Note which merge gates apply
   (`project-review` + `domain-review` are unconditional; `feature-docs` if a technical feature landed).

## Notes

- **A number that passes every gate can still be physically false** — that is the whole reason this
  skill exists. The gates check the logic they are handed; only a real unit's live + historical data
  reveals a well-formed lie.
- History beats a snapshot. One retained MQTT message from a running moment is a useful cross-check,
  but `max_over_time(...[30d])` over VictoriaMetrics is the authoritative idle-vs-absent signal.
- Do not "fix" an idle-but-real value by hiding it — hard-hiding a low/zero reading fleet-wide can
  suppress genuine cold/zero data on units that legitimately report it. Prefer fixing detection/the
  profile for the specific model, or the display, over a blanket value filter.
- The skill is read-only on the device and the stack; repository/GitHub mutations require the
  user's explicit request.

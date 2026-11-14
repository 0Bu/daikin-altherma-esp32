#!/usr/bin/env bash
# Does the presenter-parity gate still catch the drift it was built for?
#
# Both sides of that gate are CODE, and the failure mode of any comparison is that it quietly stops
# comparing — a renamed export, an empty vector file, a predicate that no longer runs. A parity check
# that has stopped seeing anything reports the loudest possible success. So each way the two copies
# can diverge is re-seeded into a throwaway tree and the gate must go red.
#
# One `expect_red` per defect, so `grep -c '^expect_red ' tools/presenter/selftest.sh` is the count.
set -euo pipefail

proj="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/main" "$tmp/test" "$tmp/tools" "$tmp/scripts"
cp -R "$proj/main/www" "$tmp/main/www"
cp -R "$proj/main/logic" "$tmp/main/logic"
cp -R "$proj/main/def" "$tmp/main/def"
cp "$proj/test/presenter_golden_dump.cpp" "$tmp/test/"
cp -R "$proj/tools/presenter" "$tmp/tools/presenter"
cp -R "$proj/tools/ui" "$tmp/tools/ui"
cp "$proj/scripts/check-presenter-parity.sh" "$tmp/scripts/"

SCHEM="$tmp/main/www/js/schematic.js"
PRISTINE="$tmp/schematic.pristine.js"
cp "$SCHEM" "$PRISTINE"

# The gate must be GREEN on the real tree first, or every red below proves nothing.
if ! (cd "$tmp" && scripts/check-presenter-parity.sh >/dev/null 2>&1); then
  echo "presenter selftest: the gate is not green on an unmodified tree" >&2
  exit 1
fi
echo "presenter selftest: green on the unmodified tree"
GOLDEN="$tmp/build_mock/presenter_golden.tsv"

# Mutate the browser copy, require the gate to notice, restore.
#   $1 = what was broken   $2 = sed expression against schematic.js
expect_red() {
  local what="$1" expr="$2"
  cp "$PRISTINE" "$SCHEM"
  sed "$expr" "$SCHEM" > "$SCHEM.mutated"
  if cmp -s "$SCHEM" "$SCHEM.mutated"; then
    # A no-op sed would make the case pass by never testing anything — the exact silence this file
    # exists to prevent.
    echo "presenter selftest: mutation for '$what' changed nothing (the pattern has moved)" >&2
    exit 1
  fi
  mv "$SCHEM.mutated" "$SCHEM"
  if (cd "$tmp" && scripts/check-presenter-parity.sh --golden "$GOLDEN" >/dev/null 2>&1); then
    echo "presenter selftest: '$what' escaped the parity gate" >&2
    exit 1
  fi
  echo "presenter selftest: detected — $what"
  cp "$PRISTINE" "$SCHEM"
}

# THE SHIPPED DEFECT: a looser leaving-water pattern that no longer rejects the bizone kit's MIXED
# zone row, so a mixed-circuit reading is fed to ΔT, heat output and COP under the main circuit's
# name — a correct number on the wrong sensor.
expect_red "the mixed-zone row is no longer rejected" \
  's/l.includes("mixed") || //'

# The reject list losing the post-BUH tokens: the R2T sensor downstream of the backup heater then
# wins tier 2 and the heat figure silently credits electric heat to the heat pump.
expect_red "the post-BUH (after BUH) reject token is gone" \
  's/ || l.includes("after buh")//'

# The water list losing "inflow": every ECH2O/HPSU profile spells its outlet that way, so those units
# lose ΔT/heat/COP entirely — a blank rather than a wrong number, but not the rule the C++ states.
expect_red "the inflow water token is gone" \
  's/ || l.includes("inflow")//'

# Tier 1 keyed on a keyword rather than the (R1T) tag — the alternative lwt_select.hpp explicitly
# rejects, because "heat exch" also matches outdoor and refrigerant rows.
expect_red "tier 1 keys on a keyword instead of the (R1T) tag" \
  's/l.includes("r1t");$/l.includes("heat exch");/'

# Tier ordering inverted: any leaving-water measurement now beats the pre-BUH one, so a profile
# carrying both publishes the wrong sensor.
expect_red "tier 2 is consulted before tier 1" \
  's/let r = vals.find((x) => lwtIsPreBuh(low(x)));/let r = vals.find((x) => lwtIsMeasurement(low(x)));/'

# The post-BUH pick forgetting the register page: "(R2T)" also names the compressor's DISCHARGE pipe
# on 0x20, a page the outdoor unit stops refreshing — so a held-over reading enters a heat figure
# presented as current.
expect_red "the post-BUH pick no longer excludes the held-over pages" \
  's/^  !OU_HELD_PAGES.includes(reg) \&\& l.includes("r2t") \&\&/  l.includes("r2t") \&\&/'

# The held-over page set losing the inverter page, so every 0x21 row reads as a live measurement
# while the compressor rests.
expect_red "the inverter page dropped out of OU_HELD_PAGES" \
  's/^const OU_HELD_PAGES = \[0x20, 0x21\];/const OU_HELD_PAGES = [0x20];/'

# A label pattern gaining a second row: the mid-temperature row shares the coil's page, so the one-row
# scan has to find it on the catalog.
expect_red "the outdoor heat exchanger pattern matches a second row" \
  's/|R4T-Deicer temp\\\.)\$\/i;/|R4T-Deicer temp\\.|Heat exchanger mid-temp\\.)$\/i;/'

# The coil pattern losing the spelling a chiller uses for this row, which is how that row went blank.
expect_red "the outdoor heat exchanger pattern loses the chiller spelling" \
  's/|Outdoor heat exchanger temp\\\.|/|/'

# The coil picker losing its page: a sweep without page 0x20 draws the second outdoor unit's coil.
expect_red "the outdoor heat exchanger picker drops its page" \
  's/vFind((x) => x\.reg === 0x20 \&\& OUTDOOR_HX_RE/vFind((x) => OUTDOOR_HX_RE/'

# A pattern that matches no row anywhere, which reads as absent on every profile.
expect_red "a label pattern matches no row on any profile" \
  's/const row = vRow(\/outdoor air\/i);/const row = vRow(\/outdoor airX\/i);/'

# The picker going back to the first row that has a value.
expect_red "vFind falls through to the next matching row with a value" \
  's/^  const r = (S\._values || \[\])\.find(match);/  const r = (S._values || []).find((x) => match(x) \&\& x.value != null);/'

# UNKNOWN treated as OFF for the tank heater. Off is the PERMISSIVE branch, so this is the exact
# direction that ships the collapsed quotient — a plant COP that reads as a failing heat pump.
expect_red "an unknown tank-heater state is treated as off" \
  's/const tankQuiet   = bsh === false;/const tankQuiet   = bsh !== true;/'

# The same mistake on the backup heater would allow a CT quotient while one step is unknown.
expect_red "an unknown backup-heater state is treated as off" \
  's/const heaterQuiet = buh1 === false \&\& buh2 === false;/const heaterQuiet = buh1 !== true \&\& buh2 !== true;/'

# The second BUH step dropped from the collapse: a unit firing step 2 alone reads as quiet.
expect_red "the second backup-heater step drops out of the collapse" \
  's/const heaterQuiet = buh1 === false \&\& buh2 === false;/const heaterQuiet = buh1 === false;/'

# A post-BUH water sensor does not measure either heater's electrical contribution.
expect_red "a post-BUH reading bypasses the tank-heater block" \
  's/if (!tankQuiet)   return/if (!tankQuiet \&\& !pbOk) return/'
expect_red "a post-BUH reading bypasses the backup-heater block" \
  's/if (!heaterQuiet) return/if (!heaterQuiet \&\& !pbOk) return/'

# An independently qualified inverter pair can supply the ratio when CT scope is uncertain.
expect_red "the qualified inverter fallback is lost" \
  's/pelSrc === "INV" || (invPairUsable \&\& !(heaterQuiet \&\& tankQuiet))/pelSrc === "INV"/'

# The compressor-only source paired with a plant scope: the two are different quantities under one
# name, and the inspector titles them differently.
expect_red "the compressor-only source claims a plant scope" \
  's/return { scope: "hp", block: null, postBuh: false };/return { scope: "plant", block: null, postBuh: false };/'

# ── The gate's own failure modes ──────────────────────────────────────────────────────────────
# A renamed or inlined-away rule must exit 2 (unreachable), never pass by comparing nothing.
cp "$PRISTINE" "$SCHEM"
sed 's/^const copPlan = /const copPlanRenamed = /' "$SCHEM" > "$SCHEM.mutated"
mv "$SCHEM.mutated" "$SCHEM"
set +e
(cd "$tmp" && scripts/check-presenter-parity.sh --golden "$GOLDEN" >/dev/null 2>&1)
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
  echo "presenter selftest: a renamed rule exited $rc, expected 2 (unreachable)" >&2
  exit 1
fi
echo "presenter selftest: detected — a renamed rule is unreachable, not 'in parity'"
cp "$PRISTINE" "$SCHEM"

# An empty vector file must exit 2 too: "no vectors" must never read as "the copies agree".
set +e
(cd "$tmp" && : > empty.tsv && node tools/presenter/presenter_parity.mjs empty.tsv >/dev/null 2>&1)
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
  echo "presenter selftest: an empty vector file exited $rc, expected 2" >&2
  exit 1
fi
echo "presenter selftest: detected — an empty vector file is refused"

echo "presenter selftest: all cases detected"

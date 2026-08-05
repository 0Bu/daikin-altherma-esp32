# HomeHub actuation — retired

**Status: there is no write path. This document is a decision record, not a contract.**

The firmware's Modbus TCP link to the Daikin HomeHub (EKRHH) is **read-only**, and that is a property
of the code rather than of a guard around a dormant capability. No source file contains a write entry
point, an actuator contract, an FC06/FC16 request builder, or an issued Modbus write function code.
`test/test_dynamic_lwt_shadow_contract.mjs` walks every file under `main/` and `main/logic/` and fails
if any of them reappears.

## What existed, and what was removed

Issue #300 (PR #309) built a deliberately narrow single-writer actuator for holding register 54, the
main-zone weather-dependent leaving-water offset: a typed fixed-size intent mailbox, a register-54
allowlist, a fresh FC03 baseline before every write, FC06 with request-bound echo validation, an
independent FC03 readback as the only confirmation, a conflict latch that stopped rather than fought
another writer, and baseline restore on disable or orderly stop. It shipped default-off with writer
ownership unresolved on every boot, and it was never commissioned: zero requests and zero write
attempts over its whole deployed life.

It is now deleted, together with `logic/homehub_actuator.hpp`, the `actuation_enabled` configuration
field, the `/status.modbus.actuator` object, the `modbus_actuator_*` heartbeat fields, the versioned
evcc intent envelope, and the FC06/FC16 request builders in `logic/modbus.hpp`.

## Why

The consumer that would have driven it was the dynamic leaving-water-temperature trim of epic #294,
and that epic **retired actuation** on 2026-08-05: `SHADOW` is its terminal state, and the controller
is now a heating-curve *diagnosis* whose proposals are measurements rather than commands. The reasons
belong to the plant, not to this code — the house already regulates every room locally (three-zone
underfloor heating downstairs with its own thermostats, radiator valves upstairs), so a trim would
correct what is already corrected; valves can only throttle, so the trim would add capability only in
the direction that costs energy; and the weather-dependent curve was measured sitting at its 35 °C
installer minimum for every heating hour on record, which makes the efficiency-positive downward half
of a ±2 K trim a no-op. See #294 for the full argument.

With no consumer, keeping the write path would have meant carrying a plant-writing capability whose
only protection was a test asserting nobody called it. Deleting it makes the guarantee structural, and
restores the read-only premise that [`SECURITY.md`](SECURITY.md) relies on when it accepts an
unauthenticated HTTP surface on a trusted LAN.

## What was kept

The **plant gate** — HomeHub input register 53, "Space heating/cooling normal operation" — is an
ordinary FC04 read and stays. It is the one HomeHub fact the shadow controller consumes: it separates
a real space-heating window from a DHW cycle (register 52) or a standstill, so a diagnostic proposal
is only ever formed while the plant is actually heating. It is reported on `/status.modbus` as
`plant_gate_known` / `plant_gate_active`, where `known: false` means the register did not answer or
answered a sentinel — never read that as an inactive plant.

Everything else about the link is unchanged: `docs/MODBUS_PROTOCOL.md` describes the read stack, the
register map lives in `main/def/homehub.hpp`, and the framing core is `main/logic/modbus.hpp`.

## Third-party writers

Register 54 has legitimate writers that are not this firmware, and they are not contested: the Onecta
app and the unit's own MMI (a `−10 K → 0` edit on 2026-07-31 is on record in VictoriaMetrics). evcc
writes the Smart-Grid registers EKRHH 56/57 through its `daikin-homehub` template and has no code path
to 54. Mind the address base when comparing: evcc template addresses are 0-based PDU, the EKRHH data
model is 1-based, so register 54 = PDU 53 and evcc's `address: 55` is EKRHH 56.

## If this is ever revisited

Restoring the capability means restoring the code from git history and re-deciding #294, not relaxing
a flag. The contract test is the tripwire; it should fail loudly, and that failure is the intended
design review.

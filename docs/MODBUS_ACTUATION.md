# HomeHub internal actuator contract (WP3)

This document is the write-safety and operator contract for issue #300. The capability is deliberately
**inactive after install, upgrade, reboot and recovery**: `actuation_enabled` defaults to `false`, blob
v5-v8 placeholder flags migrate to `false`, and writer ownership starts `unresolved` on every boot.
WP3 adds no controller and performs no live-plant commissioning write.

## Ownership and exposed surface

`hp_modbus` remains the only task that owns a HomeHub socket and the only code that can call the
private FC06 primitive. Firmware callers submit a typed `LwtOffsetIntent`; they cannot provide a
Modbus address, function code or raw word. There is no MQTT command subscription, writable Home
Assistant entity, HTTP register route, MCP write tool or Modbus proxy.

The fixed-size mailbox holds one intent. A newer same/higher-priority intent replaces the pending
entry; a replayed/out-of-order source sequence or lower-priority replacement is rejected. The state
machine and mailbox contain no `std::string`, `std::vector` or per-command allocation and are guarded
by a 256-byte compile-time size ceiling.

## Initial writable descriptor

| Property | Value |
|---|---|
| Domain | Main heating weather-dependent leaving-water offset |
| EKRHH holding register | **54** |
| PDU address | **53** (data-model offset minus one) |
| Wire type | signed `Int16`; negative K values use two's-complement encoding |
| Range / step | **-10..+10 K**, step **1 K** |
| Refresh | **OnChange** — no periodic reassertion |
| Restore | restore the fresh pre-write baseline on disable, mode exit, failsafe or orderly stop |

This is the complete allowlist. Holding registers 1-10 and 56-58 remain readback-only. A later
register 56-58 implementation must add an explicit descriptor and use this same mailbox/task; the
fact that FC16 framing exists or a holding row is readable grants no write access.
The domain intent carries an `int16_t`, not a floating-point value, so NaN/infinity cannot cross the
API boundary; a future JSON adapter must reject non-integer/non-finite values before constructing it.

## Transaction contract

An intent is not a write acceptance. It first has to pass enable, live-link, range, TTL, sequence,
priority and explicit `Firmware` ownership gates. Immediately before wire admission the task performs
a dedicated FC03 read of holding 54 and records the baseline. Only then does it:

1. send FC06 on the task-owned socket;
2. bind the reply to transaction id, unit id, PDU address and exact echoed value;
3. perform a separate FC03 readback;
4. mark the value confirmed only when that readback matches.

The descriptor uses OnChange refresh, so a confirmed value is not periodically reasserted. A later
poll value that differs from the firmware-confirmed value enters `CONFLICT`; the firmware stops rather
than fighting another last-writer-wins client. A timeout or lost socket is ambiguous, so the next
available fresh read may prove baseline (nothing to restore), our target (restore baseline), or a
third value (`CONFLICT`).

Requested, accepted, echoed, confirmed and effective are separate facts. “Effective” is available
only when the confirmed register value and HomeHub input 53 (space heating/cooling normal operation)
are both known; an inactive gate reports an effective offset of zero. Neither confirmation nor that
gate proves delivered heat—the X10A/HomeHub plant observations remain the evidence for actual effect.

## Restore boundary

Disabling actuation with the HomeHub still connected, clearing/changing the HomeHub target, or calling
the internal failsafe restore API asks the same socket-owning task to fresh-read and restore its saved
baseline. A target change is not allowed to carry an unresolved transaction to another hub. If the
old socket cannot prove/restore the value, the state latches conflict/unavailable and later writes stop.

This is best effort. A process crash, reset, power loss or network loss cannot guarantee an immediate
restore because the HomeHub supplies no lease or automatic expiry. That boundary is why active
commissioning remains WP4 and why ownership and post-write readback are mandatory.

## Versioned evcc MQTT intent contract

WP3 defines the handoff contract but intentionally does **not** install the subscription. The future
adapter topic is `<base>/intent/v1/evcc`, QoS 1, **non-retained**. A v1 payload is:

```json
{
  "version": 1,
  "source": "evcc",
  "source_time": "2026-08-03T12:34:56.000Z",
  "expires_at": "2026-08-03T12:35:26.000Z",
  "max_age_ms": 30000,
  "sequence": 481,
  "correlation_id": "evcc-481",
  "request": {
    "kind": "smart_grid_mode",
    "value": 2
  }
}
```

`kind` is one of `smart_grid_mode` (integer 0..3), `recommended_power_limit_w` or
`general_power_limit_w` (non-negative whole watts). The firmware stamps a separate monotonic
`arrival_ms`; source time, arrival time, expiry/max-age and correlation id remain separately visible
in the audit status. It rejects a retained message, unsupported version/source/kind, missing
correlation id, invalid/future/inconsistent timestamps, expiry, excess age, out-of-order sequence or
invalid value. A retained value is never treated as current merely because MQTT delivered it now.

The deterministic priority order is:

1. safety/failsafe restore;
2. Daikin operating/protection constraints;
3. room/LWT controller intent;
4. evcc Smart-Grid/power-limit intent.

Lower layers cannot replace a queued higher layer. Registers 56-58 are not writable in WP3; once
implemented they must be translated from the domain request above, never from a raw address/value.

## evcc migration and rollback

Active firmware ownership is blocked until all of these are evidenced:

1. inventory every direct evcc/HomeHub Modbus writer and record the current register 56-58 policy;
2. deploy evcc intent publication in shadow mode and verify version, timestamps, expiry, sequence and
   correlation ids without enabling a firmware write;
3. disable evcc's direct Modbus writes and verify, over an agreed observation window, that no other
   client changes 54 or 56-58;
4. restrict HomeHub plaintext `:502` at the network boundary to the ESP32 where practical;
5. only then let the future WP4 owner call `mb_set_actuation_writer_ownership(Firmware)` and perform
   the separately authorized `+1 K -> confirm -> restore` commissioning procedure.

Rollback order is the reverse safety boundary: disable/failsafe the firmware actuator and verify its
baseline restore, return ownership to `Unresolved`, deploy the previous firmware/config, and only then
re-enable a direct evcc writer if required. Never run both writers during rollback.

## Audit and resource evidence

`/status.modbus.actuator` exposes numeric and named state/reason/ownership, queue depth, source,
sequence, correlation id, timestamps/age, baseline/requested/echoed/confirmed/effective values, plant
gate and all queue/write/echo/readback/refresh/restore/conflict/failure counters. The heartbeat mirrors
the operational fields as flat numeric `modbus_actuator_*` metrics. `task_stack_min_free_words`
captures the HomeHub task high-water mark; ordinary heartbeat heap and largest-block metrics remain
the heap evidence.

Host coverage exercises bounds, signed encoding, coalescing/order, retained/stale evcc rejection,
priority, every gate, echo/readback, reconnect ambiguity, restore and conflict. The explicit ESP-IDF
6.0.2 ESP32-S3 build is required. Runtime high-water/heap deltas under command load belong to the WP4
commissioning run because WP3 is forbidden to write the live plant.

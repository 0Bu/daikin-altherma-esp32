# X10A Service-Port Protocol

Wire-level reference for the **X10A** service connector on Daikin Altherma (and ROTEX / HOVAL
Belaria) heat pumps. This is the transport the firmware speaks in [`hp_comm.cpp`](../main/hp_comm.cpp)
and frames in [`logic/crc.hpp`](../main/logic/crc.hpp); the register payloads it carries are
documented in [`REGISTERS.md`](REGISTERS.md).

Everything here is derived from protocol analysis and cross-checked against live bus captures and
two independent implementations — the numbers are validated, not assumed (see
[§8 Worked example](#8-worked-example)).

---

## 1. Physical layer

| Property | Value |
|----------|-------|
| Signalling | UART, **9600 baud, 8 data bits, Even parity, 1 stop bit** (`9600 8E1`) |
| Logic level | 5 V TTL (idle high) |
| Wiring | `HP-TX → ESP-RX`, `ESP-TX → HP-RX`, common **GND** mandatory |
| Direction | Half-duplex request/response; the host is always the master, the unit only answers |
| Timing | Unit replies within a few ms; a full poll of one register is request + reply |

The link is a single point-to-point serial connection. There is exactly one master (the ESP) and
one bus; only one transaction is in flight at a time. See [`docs/README.md`](README.md#hardware) for
the electrical/wiring details and the 3.3 V ↔ 5 V level-shifter note.

> **Poll only — the unit never pushes.** The host is always the master and the unit answers *only*
> a query; there is no opcode, register or frame for the unit to send values unsolicited. So the
> firmware **must poll** each register on an interval — a "the pump pushes readings to us" (push
> instead of poll) mode does not exist on X10A. The only push in the product is firmware → MQTT
> (the [HA bridge](ARCHITECTURE.md#home-assistant-mqtt-bridge-mqtt_hacpp) publishes on its own
> cadence), which is a separate hop and unrelated to how values leave the heat pump.

---

## 2. Protocol variants: `I` and `S`

The connector exposes two closely related framings. A unit answers on exactly one of them, so the
firmware probes both at start-up (see [§7](#7-unit-detection)).

| Variant | Used by | Request framing | Reply payload starts at |
|---------|---------|-----------------|-------------------------|
| **`I`** ("indoor"/40-command) | Altherma indoor+outdoor, most modern units | `03 40 <reg> <cksum>` | byte 3 (after `40 <reg> <len>`) |
| **`S`** (short/split) | Some split & legacy units | `02 <reg> <cksum>` | byte 1 (after `<len>`) |

The Altherma register catalog in [`REGISTERS.md`](REGISTERS.md) is the **`I`** variant. `S` uses the
same checksum and the same value-definition model but a shorter request header and fixed reply
lengths per register.

---

## 3. Frame format

### Checksum

Every frame — request and reply — ends in a one-byte checksum:

```
cksum = (~(sum of all preceding bytes)) & 0xFF          // 8-bit sum, then bitwise NOT
```

Equivalently, **the 8-bit sum of *all* bytes in a frame, including the checksum, is `0xFF`.** This
is the single validity test for a received frame. Implemented as `daik::crc()` in
[`logic/crc.hpp`](../main/logic/crc.hpp).

```
03 40 00 BC   → 03+40+00+BC = 0xFF ✓
04 40 50 01 6A → 04+40+50+01+6A = 0xFF ✓
```

### Request (Protocol `I`)

```
┌──────┬──────┬───────┬────────┐
│ 0x03 │ 0x40 │  reg  │ cksum  │      4 bytes
└──────┴──────┴───────┴────────┘
  LEN    op    page
```

- **`0x03`** — length: the count of bytes that follow (`40`, `reg`, `cksum`).
- **`0x40`** — the read opcode (all `I` queries use it).
- **`reg`** — the register/page to read (e.g. `0x20`, `0x60`; see [§5](#5-register-pages)). Some
  pages take a sub-index byte, giving a 5-byte request `04 40 <reg> <sub> <cksum>`.
- **`cksum`** — as above.

### Request (Protocol `S`)

```
┌──────┬───────┬────────┐
│ 0x02 │  reg  │ cksum  │           3 bytes
└──────┴───────┴────────┘
```

### Reply (Protocol `I`)

```
┌──────┬───────┬───────┬───────────────────────┬────────┐
│ 0x40 │  reg  │  LEN  │  payload (LEN-2 bytes) │ cksum  │
└──────┴───────┴───────┴───────────────────────┴────────┘
  op     echo    len
```

- The reply echoes `40 <reg>`, then a **`LEN`** byte.
- **`LEN` counts itself + the payload + the checksum.** So `payload_len = LEN − 2`, and the whole
  reply is `2 + LEN` bytes on the wire. The firmware reads 3 bytes, then reads `LEN + 2` total
  (`reply_len_dynamic()` = `buf[2] + 2` in [`logic/crc.hpp`](../main/logic/crc.hpp)).
- The **value payload** starts at byte offset **3** and is what the register/value definitions
  index into (`payload_offset(I) = 3`).

### Reply (Protocol `S`)

`S` replies are `<reg-or-data> …` with a **fixed length per register** rather than a length byte;
the value payload starts at offset **1**. Known fixed lengths: register `0x50` → 6 bytes,
`0x56` → 4 bytes, others → 18 bytes.

---

## 4. Error / negative reply

When the unit does not understand a request (unsupported register, wrong protocol variant, unit
busy) it answers with a two-byte NAK on **both** variants:

```
15 EA          // 0x15 + 0xEA = 0xFF ✓
```

`is_error_reply()` matches `buf[0]==0x15 && buf[1]==0xEA`. Treat it as "this register is not
available on this unit" and move on — it is normal during detection and for registers a given model
does not populate. One bad register must never stall the poll cycle.

---

## 5. Register pages

A register (a.k.a. page or `DataId`) is a small integer selecting a block of related values. One
request returns the whole block; individual values are then sliced out of the reply payload by
`(offset, size)` and decoded by their converter (see [`REGISTERS.md`](REGISTERS.md)).

The Altherma `I` set:

| Page | Contents |
|------|----------|
| `0x00` | Outdoor unit identity — sensor/compressor/fan/valve counts, MPU id, capacity, refrigerant type |
| `0x10` | Outdoor operation state — operation mode, control/protection flags, error, target evap/cond temp |
| `0x11` | Outdoor EEPROM / model-identification digits |
| `0x20` | Outdoor thermistors + high/low refrigerant pressure |
| `0x21` | Inverter currents, fin temperature, compressor-outlet temperature |
| `0x30` | Actuators — INV frequency, fan steps, expansion-valve pulses, valve/heater flags |
| `0xA0` | Outdoor auxiliary sensors/flags + hydronic-side temperatures |
| `0xA1` | Water heat-exchanger in/out temps, unit-type setting flags, target discharge/port temps |
| `0x60` | Indoor/hydronic unit — op mode, setpoints (DHW, leaving water), I/O flags, capacity, sw id |
| `0x61` | Indoor/hydronic thermistors — R1T…R6T leaving/inlet water, DHW tank, ambient |
| `0x62` | Indoor/hydronic state 2 — setpoints, RT, flow (l/min), water pressure, pump signal, power limits |
| `0x63` | Indoor EEPROM digits + CT current sensors (L1/L2/L3), BUH output capacity |
| `0x64` | Hybrid — hybrid op mode, boiler demand/targets, mixed-water temp, delta-T targets |
| `0x65` | Hydro-split / bizone-kit mixed leaving-water temp + mix-valve position |

`0x60`–`0x65` are the hydronic (water-side) pages most relevant to a heating installation; `0x00`–
`0x30` are the refrigerant/outdoor side. Not every model populates every page — probe and skip on
`15 EA`.

---

## 6. Multi-unit addressing

Pages `0x60`+ begin with a **"Data Enable/Disable"** flag and an **"Indoor Unit Address"** byte, so
a system with several indoor/hydronic units returns one block per unit. For a single Altherma the
first (address 0) block is the one to read; the enable flag tells you whether the block is valid.

---

## 7. Unit detection

At start-up the type is unknown, so the host sweeps the variants in order — outdoor multi-unit
(`@`), multi-split (`M`), indoor (`I`), short (`S`) — sending each one's identity query and keeping
the framing that answers instead of `15 EA`. For Altherma the winning framing is `I`, confirmed by a
valid `0x00`/`0x10` reply.

A representative probe/response pair (Protocol `I`, reading identity page `0x00`):

```
→ 03 40 00 BC                                        request page 0x00
← 40 00 0C 0B 02 00 01 03 02 02 04 40 07 53          reply: LEN=0x0C, 10 payload bytes
```

`0x0C = 12 = LEN(1) + payload(10) + cksum(1)`; payload `0B 02 00 01 03 02 02 04 40 07` = the counts
in page `0x00` (sensor qty, compressor qty, …).

---

## 8. Worked example

A real captured exchange, decoded with the register/converter model in
[`REGISTERS.md`](REGISTERS.md). The unit was running in **Heating**.

**Page `0x20` (outdoor thermistors)** — `conv 105` = signed 16-bit little-endian × 0.1 → °C:

```
→ 03 40 20 9C
← 40 20 17 6D 00 4D 00 A5 00 10 02 23 02 A5 FE 67 00 …   LEN=0x17=23, payload=21 bytes
```

| Offset | Bytes (LE) | Raw | ×0.1 | Value |
|-------:|:-----------|----:|-----:|-------|
| 0 | `6D 00` | 0x006D = 109 | **10.9 °C** | Outdoor air temp. |
| 2 | `4D 00` | 0x004D = 77 | **7.7 °C** | O/U heat-exchanger temp. |
| 4 | `A5 00` | 0x00A5 = 165 | **16.5 °C** | Discharge pipe temp. |
| 6 | `10 02` | 0x0210 = 528 | **52.8 °C** | Suction/2nd sensor |

**Page `0x10` (operation state):**

```
← 40 10 12 01 80 00 00 00 00 63 00 B9 01 …             LEN=0x12=18
```

- offset 0 = `01` → `conv 217` operation mode value 1 = **Heating**.
- offset 1 = `0x80` → `conv 307` = bit 7 → **Thermostat ON**.
- offset 8..9 = `B9 01` → `conv 114` = 0x01B9 = 441 × 0.1 = **44.1 °C** target condenser temp.

Every value is self-consistent and every captured frame satisfies the checksum rule, end to end.

---

## 9. Implementation checklist

1. UART at `9600 8E1` on two GPIOs; common ground.
2. Build request `03 40 <reg> <cksum>` (`I`) or `02 <reg> <cksum>` (`S`).
3. Read 3 bytes → for `I`, total reply = `buf[2] + 2`; read the rest.
4. Verify `sum(frame) & 0xFF == 0xFF`; on `15 EA` mark the register unavailable.
5. Slice each value by `(offset, size)` from the payload (offset 3 for `I`, 1 for `S`) and decode
   by its converter id — see [`REGISTERS.md`](REGISTERS.md).
6. Never let one failed register abort the cycle; keep a per-register error count.

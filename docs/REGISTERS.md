# Register & Value Definitions

How raw X10A register payloads (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md)) become typed readings.
This is the reference behind [`logic/value_def.hpp`](../main/logic/value_def.hpp),
[`logic/convert.hpp`](../main/logic/convert.hpp) and the generated `def/*` profiles; it is the
source of truth for the offline value-catalog decode tooling (`gen_profiles.py`) that emits them,
which is maintained outside this repo.

All values, converter formulas and enum tables were recovered by protocol analysis and validated
against live captures and the existing implementation (converter scale/sign/endianness match
`logic/convert.hpp`, which was independently cross-checked).

---

## 1. The value-definition row

Each queryable value is one row:

```
{ reg, offset, conv, size, type, label }
```

matching `daik::ValueDef` in [`logic/value_def.hpp`](../main/logic/value_def.hpp):

| Field | Meaning |
|-------|---------|
| `reg` | Register/page to request (`DataId`), e.g. `0x60` |
| `offset` | Byte offset of the value **within the reply payload** (payload starts at byte 3 for protocol `I`) |
| `conv` | Converter id — how the bytes become a number/enum (see [§3](#3-converter-reference)) |
| `size` | Field width in bytes (1 or 2) |
| `type` | Unit/`device_class` hint: `1`=°C, `2`=bar, `3`=A, `-1`=generic. Independent of `conv` |
| `label` | Human label (English) |

A model profile is just an array of these rows. One register request feeds many rows (all the
values whose `reg` matches), each sliced out by `(offset, size)` and decoded by `conv`.

> **`type` vs `conv`.** `conv` decides the *math* (sign, scale, enum). `type` only decides the HA
> unit/`device_class` shown. Current values often carry `type = -1` and put "(A)" in the label; the
> numeric scale still comes from `conv`.

---

## 2. Reading the raw field

Two-byte fields are **little-endian by default** (`(data[1]<<8) | data[0]`); a one-byte field is
just `data[0]`. Sign is chosen by the converter. This is `read_u16`/`read_s16` in
[`logic/registers.hpp`](../main/logic/registers.hpp).

- Converter ids in the **1xx / 4xx** band read a **signed** 16-bit field.
- Ids in the **15x–16x / 45x–46x** band read an **unsigned** field.
- Within a band the id also selects a fixed-point **scale** and, for a few, byte order.

---

## 3. Converter reference

### 3.1 Numeric converters

`raw` = the field read per [§2](#2-reading-the-raw-field) (signed or unsigned as noted), then:

| Conv | Reads | Formula | Typical use |
|-----:|-------|---------|-------------|
| 101 / 102 | s16 LE / BE | `raw` | signed raw |
| 103 / 104 | s16 LE / BE | `raw ÷ 256` | high-byte-weighted |
| **105 / 106** | s16 LE / BE | `raw × 0.1` | **temperature °C** (105 = LE, the common one) |
| 107 / 108 | s16 LE / BE | `raw × 0.1`, `−3276.8` (0x8000) = no data | optional temperature |
| 109 / 110 | s16 LE / BE | `raw ÷ 256 × 2` | |
| 111 / 112 | s16 | `raw × 0.5` | half-step |
| 113 | s16 | `raw × 0.25` | |
| 115 / 116 | s16 | `raw ÷ 2560` | |
| 117 / 118 | s16 | `raw × 0.01` | e.g. mixed-water temp |
| **151 / 152** | u16 LE / BE | `raw` | **unsigned raw** — counts, pulses, rps (152 also used for 1-byte counts) |
| 153 / 154 | u16 | `raw ÷ 256` | |
| 155 / 156 | u16 | `raw × 0.1` | |
| 157 / 158 | u16 | `raw ÷ 256 × 2` | |
| 159 / 160 / 164 | u16 | `raw` | unsigned raw |
| **161 / 162** | u16 | `raw × 0.5` | **CT current sensor (0.5 A/step)** |
| 163 | u16 | `raw × 0.25` | |
| 401–418 | s16 | same maths as 101–118 | **pressure/current family** — `type` selects display unit |
| **405 / 406** | s16 | `raw × 0.1` (kgf/cm² ≈ bar) | **refrigerant pressure**; where the value is labelled "(T)" it is shown as **saturation temperature** — see below |
| 451–465 | u16 | same maths as 151–165 | pressure family, unsigned |
| 881–885 | s16 | `raw × 0.1` | |

**Base units.** Temperatures are **°C**; pressures are **kgf/cm²** at the wire (0.098 → MPa,
0.981 → bar, 14.223 → psi if a different display unit is wanted). The firmware works in °C and
bar. `114 / 119` are target temperatures with a **"no data" marker** — raw little-endian bytes
`00 80`, i.e. the signed 16-bit value `0x8000` = `-3276.8` (matched on the decoded value in
`logic/convert.hpp`), rendered as `---` — otherwise `raw × 0.1`.

The same raw refrigerant-pressure bytes appear twice in a model: once as the pressure itself
(`conv 105`, `type = 2` → bar) and once as the **saturation temperature** (`conv 405`, `type = 1` →
°C). For the "(T)" saturation form, `conv 405` in [`logic/convert.hpp`](../main/logic/convert.hpp)
takes `raw × 0.1` and applies a per-refrigerant pressure→saturation-temperature polynomial
(R410A / R32 / R22), selected by the refrigerant from page `0x00`. A **0-bar** input (an absent/idle
pressure sensor) is dropped rather than published as its `press2temp(0) ≈ -51 °C` placeholder.

**Publish-time plausibility (`reading_plausible`).** Beyond the per-converter `-3276.8` marker above,
a decoded **°C** reading (`type = 1`) outside a physical envelope (`[-60, 200]`) is dropped at publish
by `hp_format` — an idle outdoor unit's `576 °C` / `231.6 °C` placeholder reaches Home Assistant as
*unavailable*, not a false reading. This is a runtime backstop kept **out** of `convert()` so the
catalog audit still distinguishes the intrinsic converters (`conv 105` vs `114` on the no-data
sentinel); it is keyed on the °C `type`, so the non-temperature rows sharing those converter ids
(kW / COP at `type = -1`) pass through unchanged.

### 3.2 Bit-flag converters (300–307)

A single bit of a one-byte field, published as numeric **1 / 0**:

```
conv (300 + n)  →  (byte & (1 << n)) ? 1 : 0           // n = 0 (LSB) … 7 (MSB)
```

So `conv 307` = bit 7, `conv 300` = bit 0. Multiple rows at the same `offset` with `conv`
300…307 unpack the eight bits of one status byte (e.g. page `0x10` offset 1 → Thermostat / Restart /
Startup / Defrost / … / Low-noise).

### 3.3 Count / nibble converters

| Conv | Formula | Use |
|-----:|---------|-----|
| 310 | `(byte & 0x70) >> 4` | 3-bit protection-retry counter (bits 4–6) |
| 311 | `byte & 0x07` | 3-bit counter / BUH output-capacity step (bits 0–2) |
| 211 | raw numeric byte (`0` = stopped) | fan step |
| 212 / 213 | byte as hex | MPU / option code |
| 214 / 215 | raw byte (no name table) | model/software EEPROM identification digits — 215 a digit pair, 214 a single digit. Exposed as the raw byte; page `0x11` is rendered as space-separated hex for display (`logic/detect.hpp` `eeprom_render`) and used only as an auto-detection hint, never decoded to a model name. |

### 3.4 Enum converters

| Conv | Field | Values |
|-----:|-------|--------|
| **217** | byte | Operation mode — see [§4.1](#41-operation-mode-conv-217) |
| **315** | `(byte & 0xF0) >> 4` (**high nibble**) | Indoor/hydronic operation mode — see [§4.2](#42-indoorhydronic-operation-mode-conv-315) |
| **203** | byte | Error class: `0` Normal, `1` Error, `2` Warning, `3` Caution |
| **204** | byte | Error code — high nibble → first-char table, low nibble → second-char table, see [§4.3](#43-error-code-conv-204) |
| 219 | byte | Indoor-unit capacity class code (maps to nominal kW) |
| 316 | byte | Hybrid op mode: `0` H/P only, `1` Hybrid, `2` Boiler only |
| 314 / 317 | byte | Software/version codes |

### 3.5 Refrigerant type (const)

The refrigerant is a property of the model, encoded as the converter id itself (page `0x00`,
"Refrigerant type"):

| Conv | Refrigerant |
|-----:|-------------|
| 801 | R410A |
| 802 | R32 |
| 803 | R22 |
| 804 | R407C |
| 805 | R134a |

It selects the pressure→saturation-temperature curve for `conv 405/406`.

### 3.6 Layout markers (not data)

`conv 0, 995, 996, 997, 998, 999` are UI/grid layout markers (`Next Grid`, `In/Out`, `Space`,
`0x00 Override`). They carry no measured value and are skipped when building a poll set.

---

## 4. Enum tables

### 4.1 Operation mode (conv 217)

| Val | Mode | Val | Mode |
|----:|------|----:|------|
| 0 | Stop | 6 | Auto Heat |
| 1 | Heating | 7 | Dry |
| 2 | Cooling | 8 | Aux. |
| 3 | Auto | 9 | Cooling Storage |
| 4 | Ventilation | 10 | Heating Storage |
| 5 | Auto Cool | 11–18 | Use-stored-thermostat (cool 1–4 / heat 1–4) |

Indices **0 and 1 are measured**; the rest are the recovered split-air-conditioner vocabulary and are
**unverified on a hydronic unit**. Index 0 read `Fan Only` until #216 — a mode an Altherma does not
have, and the value an idle outdoor unit reports, so it was the entry a user saw most of the day.
Corrected against a live Altherma 3 R W (`1.0.0-dev.211`), page `0x10` captured across the
stopped→running edge by `logic/raw_capture.hpp`:

| Plant state | raw `0x10` | byte 0 | Decodes as |
|-------------|-----------|:------:|------------|
| at rest | `[00 04 00 …]` | `0x00` | **Stop** |
| running (3 captures, one run) | `[01 00 00 …]`, `[01 20 00 …]` ×2 | `0x01` | Heating |

Byte 0 steps `0x00`→`0x01` exactly at the transition, and index 1 was already correct — which is what
makes this a relabel of one entry rather than a table shifted by one. Several remaining entries
(`Ventilation`, `Dry`, the storage modes) cannot occur on a hydronic unit either, but none is
reachable to measure, so they are left as recovered rather than guessed at. Keep this table and
`OP_MODE` in `main/logic/convert.hpp` in step — this section is the domain audit's authority.

### 4.2 Indoor/hydronic operation mode (conv 315)

High nibble of the byte (`(byte & 0xF0) >> 4`):

| Val | Mode |
|----:|------|
| 0 | Stop |
| 1 | Heating |
| 2 | Cooling |
| 4 | Domestic Hot Water |
| 5 | Heating + DHW |
| 6 | Cooling + DHW |

### 4.3 Error code (conv 204)

The fault code is packed into **one byte** as two nibbles: the **high** nibble indexes a
first-character table, the **low** nibble a second-character table. Both are 16 entries, indexed by a
4-bit nibble (`0`–`F`), and are the exact tables in `logic/convert.hpp` (`ERR_C1` / `ERR_C2`):

| Nibble | `0` | `1` | `2` | `3` | `4` | `5` | `6` | `7` | `8` | `9` | `A` | `B` | `C` | `D` | `E` | `F` |
|-------:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **high → char 1** (`ERR_C1`) | _(blank)_ | A | C | E | H | F | J | L | P | U | 9 | 8 | 7 | 6 | 5 | 4 |
| **low → char 2** (`ERR_C2`)  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | A | H | C | J | E | F |

e.g. byte `0x94` → high nibble `9` → `U`, low nibble `4` → `4` → **`U4`**. A high nibble of `0`
yields a blank first character (the code is shown as its single second character). Error *class* comes
from `conv 203` (Normal / Error / Warning / Caution).

`logic/error_codes.hpp` holds an optional code → short-English-description lookup for the subset of
2-char codes a reference service manual documents for one Altherma model family; `hp_convert.cpp`
appends the description to the published value when the table covers the decoded code (e.g. `U4:
Indoor/outdoor unit communication problem`), and otherwise leaves the bare code unchanged. It is a
presentation layer only — it never affects what conv 204 decodes off the wire.

---

## 5. Register catalog (per model)

The full page catalog is in [`X10A_PROTOCOL.md` §5](X10A_PROTOCOL.md#5-register-pages). Which values
a page carries is **model-specific** — every model family ships its own row table. Below is a full,
representative table for a **modern R32 Altherma 3 monobloc** (EBLA/EDLA D, 9–16 kW); other families
share the outdoor pages (`0x00`–`0x30`) almost verbatim and vary mostly in the hydronic pages
(`0x60`–`0x65`).

Across the surveyed catalog the value counts per page are roughly: `0x60` ~58, `0x62` ~69, `0x10`/`0x21`
~45, `0x20` ~39 — i.e. the indoor/hydronic pages are the richest. Pages `0x60`+ are addressed
per indoor unit (see [`X10A_PROTOCOL.md` §6](X10A_PROTOCOL.md#6-multi-unit-addressing)).

`Bit` column = bit index for `conv 300–307`; `Type` = HA unit hint.

#### Register `0x00`

This descriptor is **variable-length** — a smaller unit returns a short reply that ends early and omits
the trailing fields, including the O/U capacity at offset 12 (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md)
§7 for a real 10-byte example). Detection reads the capacity when present and otherwise falls back to
the I/U capacity code (`0x60` offset 6).

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 0 | 802 |  |  | *Refrigerant type |
| 0 | 1 | 152 |  |  | Sensor Data Qty |
| 1 | 1 | 152 |  |  | INV compressor Qty |
| 2 | 1 | 152 |  |  | STD compressor Qty |
| 3 | 1 | 152 |  |  | Fan Data Qty |
| 4 | 1 | 152 |  |  | Expansion Valve Data Qty |
| 5 | 1 | 152 |  |  | 4 Way Valve Data Qty |
| 6 | 1 | 152 |  |  | Crank Case Heater Qty |
| 7 | 1 | 152 |  |  | Solenoid valve Qty |
| 8 | 1 | 152 |  |  | Max. connectable indoor units |
| 9 | 1 | 152 |  |  | Connected Indoor Unit Qty |
| 10 | 1 | 152 |  |  | O/U MPU ID (xx) |
| 11 | 1 | 152 |  |  | O/U MPU ID (yy) |
| 12 | 1 | 105 |  |  | O/U capacity (kW) |

#### Register `0x10`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 217 |  |  | Operation Mode |
| 1 | 1 | 307 | 7 |  | Thermostat ON/OFF |
| 1 | 1 | 306 | 6 |  | Restart standby |
| 1 | 1 | 305 | 5 |  | Startup Control |
| 1 | 1 | 304 | 4 |  | Defrost Operation |
| 1 | 1 | 303 | 3 |  | Oil Return Operation |
| 1 | 1 | 302 | 2 |  | Pressure equalizing operation |
| 1 | 1 | 301 | 1 |  | Demand Signal |
| 1 | 1 | 300 | 0 |  | Low noise control |
| 4 | 1 | 203 |  |  | Error type |
| 5 | 1 | 204 |  |  | Error Code |
| 6 | 2 | 114 |  | °C | Target Evap. Temp. |
| 8 | 2 | 114 |  | °C | Target Cond. Temp. |
| 10 | 1 | 307 | 7 |  | Discharge Temp. Drop |
| 10 | 1 | 310 | s4-6 |  | Discharge Temp. Protection Retry Qty |
| 10 | 1 | 303 | 3 |  | Comp. INV Current Drop |
| 10 | 1 | 311 | s0-2 |  | Comp. INV Current Protection Retry Qty |
| 11 | 1 | 307 | 7 |  | HP Drop Control |
| 11 | 1 | 310 | s4-6 |  | HP Protection Retry Qty |
| 11 | 1 | 303 | 3 |  | LP Drop Control |
| 11 | 1 | 311 | s0-2 |  | LP Protection Retry Qty |
| 12 | 1 | 307 | 7 |  | Fin Temp. Drop Control |
| 12 | 1 | 310 | s4-6 |  | Fin Temp. Protection Retry Qty |
| 12 | 1 | 303 | 3 |  | Other Drop Control |
| 12 | 1 | 311 | s0-2 |  | Not in use |

> **RESOLVED — `Target Evap. Temp.` (offset 6) is encoded `÷128`, not `×0.1`; the row is decoded
> with conv `109`** ([#194](https://github.com/0Bu/daikin-altherma-esp32/issues/194),
> [#209](https://github.com/0Bu/daikin-altherma-esp32/issues/209)). With conv `114` this row read
> **240.6 °C at rest** and **145.9 → 199.6 °C while the compressor runs** — impossible for an
> evaporating temperature, and the run-time values land *inside* `reading_plausible()`'s ±200 °C
> envelope, so nothing masked them. #194 ruled out offset shift, endianness, width and catalog drift
> and stopped at two surviving scales, `×0.01` and `÷128`, calling for run-time wire bytes to decide.
>
> They were decidable without new capture. conv 114 publishes `raw × 0.1` at one decimal, so every
> value this row has ever published carries its 16-bit register **exactly** (`raw = published × 10`)
> — #194's assumption that the published figures were lossily rounded is what kept it open. Taking
> the 46 distinct run-time integers from the stored series together with the 8 distinct at-rest
> integers from the boot-time page dumps gives 54 samples, and **all 54 satisfy
> `raw == floor(128 × T)` for `T` on an exact 0.1 K grid**. The set `{floor(12.8k)}` has density
> 1/12.8 among the integers, so that is p ≈ 1.6 × 10⁻⁶⁰ against any other scale. `×0.01` produces no
> such grid (22.01, 22.14, 22.40, 23.04 …), and the physical argument that favoured it — 24.06 °C at
> rest against "a measured 22.5–23.0 °C ambient" — compared against the X10A outdoor reading, which
> #209 later proved is **held over** while the unit rests (`logic/ou_stale.hpp`). Against the
> independent HomeHub sensor the row does not track ambient at all.
>
> | | conv 114 (`×0.1`) | conv 109 (`÷128`) |
> |---|---|---|
> | compressor running | 133.1 – 199.6 °C | **10.4 – 15.6 °C** |
> | at rest | 220.1 – 243.2 °C | **17.2 – 19.0 °C** |
>
> **The conv in the table above is deliberately still `114`** — it records what the generated `def/`
> tables carry, and those are machine output from an offline generator that lives outside this repo
> (`.claude/CLAUDE.md`: never hand-edit one). The correction is applied by
> `logic/conv_override.hpp`, which maps `(0x10, 6, 114) → 109` at every point a row enters the
> pipeline, carries the evidence beside the rule, and is asserted against all 54 wire integers and
> the whole 45-profile catalog in `test/test_logic.cpp`. conv `114` itself is untouched — it is a
> correct `×0.1` converter and three other rows use it.
>
> Because this table and the generated rows still agree on `114`, the **domain audit sees no
> mismatch and cannot see the adjudication at all** — it compares the tables against this spec, and
> the override sits outside both. That gap is covered deliberately from the other side: the catalog
> test asserts that exactly **44** profiles still carry `(0x10, 6, conv 114)`, so the day
> `gen_profiles.py` emits conv `109` — at which point the override becomes a correct no-op, since it
> is keyed `from: 114` — the count changes and the test fails, forcing this adjudication to be
> re-read rather than left as silent dead code.
>
> The row is **no longer quarantined**: `logic/availability.hpp` had it as
> `AvailabilityPolicy::Unproven` while the scale was unknown, and that verdict is retired. It was
> never unmeasurable — it was pointed at the wrong converter. The label difference in
> `altherma_lt_d7_e_bml` (which calls this same register `Target Discharge Temp.`) changes nothing:
> the correction is keyed on the register, not the name.

> Same page, same converter, separate verdict: `Target Cond. Temp.` (offset 8) publishes a flat
> `0.0 °C` — one distinct value across a full #209 audit window while the
> inverter reached 32 rps and the discharge pipe passed 100 °C, and "reads 0.0 even mid-run" in #194.
> (Both audits ran against the SAME board, which detection has always resolved to
> `altherma_ebla_edla_d_series_4_8kw_monobloc`; the "two families" reading of #209 took the hardware
> identification in its scope section for the running profile.) There, `logic/ou_stale.hpp` already records it as a useless witness for that reason. Raw
> is `0x0000`, which conv 114's `0x8000` no-data marker does not cover. The row is **not**
> quarantined — the field can legitimately be populated — but an exact decoded zero from it is
> adjudicated `AvailabilityPolicy::ZeroMeansAbsent` and withheld. Deliberately per-row: a global
> "0 °C means unavailable" rule would destroy every real thermistor reading that crosses zero.

#### Register `0x11`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 215 |  |  | O/U EEPROM (1st digit) |
| 1 | 1 | 215 |  |  | O/U EEPROM (3rd 4th digit) |
| 2 | 1 | 215 |  |  | O/U EEPROM (5th 6th digit) |
| 3 | 1 | 215 |  |  | O/U EEPROM (7th 8th digit) |
| 4 | 1 | 215 |  |  | O/U EEPROM (10th digit) |
| 5 | 1 | 214 |  |  | O/U EEPROM (11th digit) |

#### Register `0x20`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 2 | 105 |  | °C | R1T-Outdoor air temp. |
| 2 | 2 | 105 |  | °C | O/U Heat Exch. Temp.(R4T) |
| 4 | 2 | 105 |  | °C | Discharge pipe temp.(R2T) |
| 6 | 2 | 105 |  | °C | Suction pipe temp.(R3T) |
| 8 | 2 | 105 |  | °C | Heat exchanger mid-temp.(R5T) |
| 10 | 2 | 105 |  | °C | Liquid pipe temp.(R6T) |
| 12 | 2 | 105 |  | bar | High Pressure |
| 12 | 2 | 405 |  | °C | High Pressure(T) |
| 14 | 2 | 105 |  | bar | Low Pressure |
| 14 | 2 | 405 |  | °C | Low Pressure(T) |

#### Register `0x21`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 2 | 105 |  |  | INV primary current (A) |
| 2 | 2 | 105 |  |  | INV secondary current (A) |
| 4 | 2 | 105 |  | °C | INV fin temp. |
| 6 | 2 | 105 |  | °C | Fan1 Fin temp. |
| 8 | 2 | 105 |  | °C | Fan2 Fin temp. |
| 10 | 2 | 105 |  | °C | Compressor outlet temperature |

#### Register `0x30`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 152 |  |  | INV frequency (rps) |
| 1 | 1 | 211 |  |  | Fan 1 (step) |
| 2 | 1 | 211 |  |  | Fan 2 (step) |
| 3 | 2 | 151 |  |  | Expansion valve 1 (pls) |
| 5 | 2 | 151 |  |  | Expansion valve 2 (pls) |
| 7 | 2 | 151 |  |  | Expansion valve 3 (pls) |
| 9 | 2 | 151 |  |  | Expansion valve 4 (pls) |
| 11 | 1 | 307 | 7 |  | 4 Way Valve |
| 12 | 1 | 307 | 7 |  | Crank case heater |
| 13 | 1 | 307 | 7 |  | Hot gas bypass valve (Y3S) |
| 13 | 1 | 306 | 6 |  | LP bypass valve (Y2S) |
| 13 | 1 | 305 | 5 |  | Y3S |

#### Register `0xA0`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 2 | 119 |  | °C | Suction temp |
| 2 | 2 | 119 |  | °C | Outdoor heat exchanger temp. |
| 4 | 2 | 119 |  | °C | Liquid pipe temp. |
| 6 | 2 | 119 |  | bar | Pressure |
| 8 | 2 | 151 |  |  | Expansion valve 3 (pls) [OU-II] |
| 10 | 1 | 152 |  |  | O/U MPU ID |
| 11 | 1 | 152 |  |  | O/U MPU ID |
| 12 | 1 | 307 | 7 |  | HPS operation |
| 12 | 1 | 306 | 6 |  | Safeguard operation |
| 12 | 1 | 305 | 5 |  | Crank case heater |
| 12 | 1 | 304 | 4 |  | Solenoid Valve 3 |
| 12 | 1 | 303 | 3 |  | Solenoid Valve 2 |
| 12 | 1 | 302 | 2 |  | Solenoid Valve 1 |
| 12 | 1 | 301 | 1 |  | 4 way valve (Y1S) |
| 12 | 1 | 300 | 0 |  | 52C Output |
| 13 | 1 | 303 | 3 |  | Discharge Temp. Drop |
| 13 | 1 | 302 | 2 |  | During emergency operation |
| 13 | 1 | 301 | 1 |  | Indoor unit blowout 50 ° C flag |
| 13 | 1 | 300 | 0 |  | Powerful bit (MT setting bit) |
| 14 | 2 | 105 |  | °C | Compressor port temperature |

#### Register `0xA1`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 2 | 119 |  | °C | (Raw data)Water heat exchanger inlet temp. |
| 2 | 2 | 119 |  | °C | (Raw data)Water heat exchanger outlet temp. |
| 4 | 1 | 302 | 2 |  | Liquid INJ solenoid valve (Y4S) |
| 4 | 1 | 301 | 1 |  | Bottom Plate Heater |
| 4 | 1 | 300 | 0 |  | PHE Heater |
| 5 | 2 | 114 |  | °C | Target Discharge Temp. |
| 7 | 2 | 114 |  | °C | Target port temperature |
| 9 | 1 | 305 | 5 |  | Monobloc setting |
| 9 | 1 | 304 | 4 |  | Minichiller setting |
| 9 | 1 | 303 | 3 |  | MT setting |
| 9 | 1 | 302 | 2 |  | GSHP setting |
| 9 | 1 | 301 | 1 |  | Hydro split setting |
| 9 | 1 | 300 | 0 |  | Alterma LT setting |

#### Register `0x60`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 304 | 4 |  | Data Enable/Disable |
| 1 | 1 | 152 |  |  | Indoor Unit Address |
| 2 | 1 | 315 |  |  | I/U operation mode |
| 2 | 1 | 303 | 3 |  | Thermostat ON/OFF |
| 2 | 1 | 302 | 2 |  | Freeze Protection |
| 2 | 1 | 301 | 1 |  | Silent Mode |
| 2 | 1 | 300 | 0 |  | Freeze Protection for water piping |
| 3 | 1 | 204 |  |  | Error Code |
| 4 | 1 | 152 |  |  | Error detailed code |
| 5 | 1 | 203 |  |  | Error type |
| 6 | 1 | 219 |  |  | I/U capacity code |
| 7 | 2 | 105 |  | °C | DHW setpoint |
| 9 | 2 | 105 |  | °C | LW setpoint (main) |
| 11 | 1 | 307 | 7 |  | Water flow switch |
| 11 | 1 | 306 | 6 |  | Thermal protector (Q1L) BUH |
| 11 | 1 | 305 | 5 |  | Thermal protector BSH |
| 11 | 1 | 304 | 4 |  | Benefit kWh rate power supply |
| 11 | 1 | 303 | 3 |  | Solar input |
| 11 | 1 | 302 | 2 |  | SmartGridContact2 |
| 11 | 1 | 301 | 1 |  | SmartGridContact1 |
| 11 | 1 | 300 | 0 |  | Bivalent Operation |
| 12 | 1 | 307 | 7 |  | 2way valve(On:Heat_Off:Cool) |
| 12 | 1 | 306 | 6 |  | 3way valve(On:DHW_Off:Space) |
| 12 | 1 | 305 | 5 |  | BSH |
| 12 | 1 | 304 | 4 |  | BUH Step1 |
| 12 | 1 | 303 | 3 |  | BUH Step2 |
| 12 | 1 | 302 | 2 |  | Floor loop shut off valve |
| 12 | 1 | 301 | 1 |  | Water pump operation |
| 12 | 1 | 300 | 0 |  | Solar pump operation |
| 13 | 1 | 152 |  |  | Indoor Option Code |
| 15 | 1 | 215 |  |  | I/U Software ID (xx) |
| 14 | 1 | 215 |  |  | I/U Software ID (yy) |
| 16 | 1 | 152 |  |  | I/U EEPROM Ver. |

#### Register `0x61`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 307 | 7 |  | Data Enable/Disable |
| 1 | 1 | 152 |  |  | Indoor Unit Address |
| 2 | 2 | 105 |  | °C | Leaving water temp. before BUH (R1T) |
| 4 | 2 | 105 |  | °C | Leaving water temp. after BUH (R2T) |
| 6 | 2 | 105 |  | °C | Refrig. Temp. liquid side (R3T) |
| 8 | 2 | 105 |  | °C | Inlet water temp.(R4T) |
| 10 | 2 | 105 |  | °C | DHW tank temp. (R5T) |
| 12 | 2 | 105 |  | °C | Indoor ambient temp. (R1T) |
| 14 | 2 | 105 |  | °C | Ext. indoor ambient sensor (R6T) |

#### Register `0x62`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 307 | 7 |  | Data Enable/Disable |
| 1 | 1 | 152 |  |  | Indoor Unit Address |
| 2 | 1 | 307 | 7 |  | Reheat ON/OFF |
| 2 | 1 | 306 | 6 |  | Storage ECO ON/OFF |
| 2 | 1 | 305 | 5 |  | Storage comfort ON/OFF |
| 2 | 1 | 304 | 4 |  | Powerful DHW Operation. ON/OFF |
| 2 | 1 | 303 | 3 |  | Space heating Operation ON/OFF |
| 2 | 1 | 302 | 2 |  | System OFF (ON:System off) |
| 2 | 1 | 301 | 1 |  | Not in use |
| 2 | 1 | 300 | 0 |  | Emergency (indoor) active/not active |
| 3 | 2 | 105 |  | °C | LW setpoint (add) |
| 5 | 2 | 105 |  | °C | RT setpoint |
| 7 | 1 | 307 | 7 |  | Add. Ext. RT Input Cool. |
| 7 | 1 | 306 | 6 |  | Add. Ext. RT Input Heat. |
| 7 | 1 | 305 | 5 |  | Main RT Cooling |
| 7 | 1 | 304 | 4 |  | Main RT Heating |
| 7 | 1 | 303 | 3 |  | Pwr consumption limit 4 |
| 7 | 1 | 302 | 2 |  | Pwr consumption limit 3 |
| 7 | 1 | 301 | 1 |  | Pwr consumption limit 2 |
| 7 | 1 | 300 | 0 |  | Pwr consumption limit 1 |
| 8 | 1 | 307 | 7 |  | None |
| 8 | 1 | 306 | 6 |  | Not in use |
| 8 | 1 | 305 | 5 |  | Not in use |
| 8 | 1 | 304 | 4 |  | PHE Heater |
| 8 | 1 | 303 | 3 |  | Tank preheat ON/OFF |
| 8 | 1 | 302 | 2 |  | Circulation pump operation |
| 8 | 1 | 301 | 1 |  | Alarm output |
| 8 | 1 | 300 | 0 |  | Space H Operation output |
| 9 | 2 | 105 |  |  | Flow sensor (l/min) |
| 11 | 1 | 105 |  | bar | Water pressure |
| 12 | 1 | 152 |  |  | Water pump signal (0:max-100:stop) |
| 13 | 1 | 152 |  |  | [Future] 3 way Valve Mixing 1 |
| 14 | 1 | 152 |  |  | [Future] 3 way Valve Mixing 2 |
| 15 | 2 | 105 |  | bar | Refrigerant pressure sensor |

#### Register `0x63`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 307 | 7 |  | Data Enable/Disable |
| 1 | 1 | 152 |  |  | Indoor Unit Address |
| 2 | 1 | 215 |  |  | I/U EEPROM (3rd digit) |
| 3 | 1 | 215 |  |  | I/U EEPROM (4th 5th digit) |
| 4 | 1 | 215 |  |  | I/U EEPROM (6th 7th digit) |
| 5 | 1 | 215 |  |  | I/U EEPROM (8th 9th digit) |
| 6 | 1 | 215 |  |  | I/U EEPROM (11th digit) |
| 7 | 1 | 215 |  |  | I/U EEPROM (12th digit)(rev.) |
| 8 | 1 | 215 |  |  | Not in use |
| 9 | 1 | 215 |  |  | Not in use |
| 10 | 1 | 215 |  |  | Not in use |
| 11 | 1 | 215 |  |  | Not in use |
| 12 | 1 | 215 |  |  | Not in use |
| 13 | 1 | 311 | s0-2 |  | BUH output capacity |
| 14 | 1 | 161 |  |  | Current measured by CT sensor of L1 |
| 15 | 1 | 161 |  |  | Current measured by CT sensor of L2 |
| 16 | 1 | 307 | 7 |  | HP Forced FG |
| 16 | 1 | 161 |  |  | Current measured by CT sensor of L3 |

#### Register `0x64`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 307 | 7 |  | Data Enable/Disable |
| 1 | 1 | 152 |  |  | Indoor Unit Address |
| 2 | 1 | 316 |  |  | Hybrid Op. Mode |
| 2 | 1 | 303 | 3 |  | Boiler Operation Demand |
| 2 | 1 | 302 | 2 |  | Boiler DHW Demand |
| 2 | 1 | 301 | 1 |  | Bypass Valve Output |
| 3 | 2 | 105 |  |  | BE_COP |
| 5 | 2 | 105 |  | °C | Hybrid Heating Target Temp. |
| 7 | 2 | 105 |  | °C | Boiler Heating Target Temp. |
| 9 | 1 | 302 | 2 |  | Add pump |
| 9 | 1 | 301 | 1 |  | Main pump |
| 10 | 2 | 118 |  | °C | Mixed water temp. |
| 12 | 2 | 105 |  | °C | 2nd Domestic hot water temperature |
| 14 | 1 | 152 |  | °C | Target delta T heating |
| 15 | 1 | 152 |  | °C | Target delta T cooling |

#### Register `0x65`

| Off | Len | Conv | Bit | Type | Value |
|----:|----:|:----:|:---:|:----:|-------|
| 0 | 1 | 307 | 7 |  | Data Enable/Disable |
| 1 | 2 | 152 |  |  | Indoor Unit Address |
| 0 | 2 | 105 |  | °C | Outlet water heat exchanger temp (hydro split model) DLWB2 |
| 0 | 2 | 105 |  | °C | [EKMIK] Bizone kit mixed leaving water temperature R1T |
| 0 | 1 | 101 |  |  | [EKMIK] Bizone kit mix valve position M1S |

---

## 6. Home Assistant mapping

- **Unit / device_class** come from the `type` field: `1 → °C / temperature`, `2 → bar / pressure`,
  `3 → A / current`, else generic. See `unit_for_datatype()` / `device_class_for_datatype()` in
  [`logic/convert.hpp`](../main/logic/convert.hpp).
- **Enum values** (operation mode, indoor mode, error class) are best exposed as text sensors.
- **Bit flags** (`conv 300–307`) map naturally to `binary_sensor`s and publish numeric `1`/`0`.
- A value whose converter is not implemented returns `unimpl` and is simply skipped — never reported
  wrong. Prefer skipping to guessing a scale.

---

## 7. Porting a model

1. Get the model's rows as `{reg, offset, conv, size, type, label}` (one row per value).
2. Feed them to the offline profile generator (`gen_profiles.py`, maintained outside this repo) → an embedded `def/<family>.hpp` table.
3. Wire the profile into `def/registry.hpp` and the `/models` catalog.
4. Ensure every `conv` used is implemented in [`logic/convert.hpp`](../main/logic/convert.hpp); add a
   `CHECK` in [`test/test_logic.cpp`](../test/test_logic.cpp) for any new converter (see the
   `add-logic-test` skill). All converters used by the shipped profiles are implemented — numeric
   (`101–119`, `151–163`, `405`), bit flags (`300–307`), and the enum/label/count converters (`203`
   error class, `204` error code, `211` fan step, `217` operating mode, `219` capacity code, `311`
   BUH output-capacity step, `315` indoor mode, `316` hybrid mode, `801–805` refrigerant). A `conv`
   id with no `case` returns `unimpl` and is skipped, never mis-decoded — but "skipped" is only safe
   for a conv nothing uses. A row pointed at an unimplemented conv publishes nothing, and a row
   pointed at the *wrong implemented* conv publishes a lie: `311` was documented here yet missing
   from `convert.hpp`, so ten profiles read the BUH step with `152` (the whole byte) and published
   `133` for a step of `5` until it was implemented.

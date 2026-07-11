# Register & Value Definitions

How raw X10A register payloads (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md)) become typed readings.
This is the reference behind [`logic/value_def.hpp`](../main/logic/value_def.hpp),
[`logic/convert.hpp`](../main/logic/convert.hpp) and the generated `def/*` profiles; it is the
source of truth for [`tools/gen_defs.py`](../tools/gen_defs.py).

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
| `label` | Human label (language-specific) |

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
bar. `114 / 119` are target temperatures with a **`0x0080` (byte hi = 0x80) "no data" marker → `---`**,
otherwise `raw × 0.1`.

The same raw refrigerant-pressure bytes appear twice in a model: once as the pressure itself
(`conv 105`, `type = 2` → bar) and once as the **saturation temperature** (`conv 405`, `type = 1` →
°C). For the "(T)" saturation form, `conv 405` in [`logic/convert.hpp`](../main/logic/convert.hpp)
takes `raw × 0.1` and applies a per-refrigerant pressure→saturation-temperature polynomial
(R410A / R32 / R22), selected by the refrigerant from page `0x00`.

### 3.2 Bit-flag converters (300–307)

A single bit of a one-byte field, rendered **ON / OFF**:

```
conv (300 + n)  →  (byte & (1 << n)) ? ON : OFF        // n = 0 (LSB) … 7 (MSB)
```

So `conv 307` = bit 7, `conv 300` = bit 0. Multiple rows at the same `offset` with `conv`
300…307 unpack the eight bits of one status byte (e.g. page `0x10` offset 1 → Thermostat / Restart /
Startup / Defrost / … / Low-noise).

### 3.3 Count / nibble converters

| Conv | Formula | Use |
|-----:|---------|-----|
| 310 | `(byte & 0x70) >> 4` | 3-bit protection-retry counter (bits 4–6) |
| 311 | `byte & 0x07` | 3-bit counter / BUH output-capacity step (bits 0–2) |
| 211 | `0 → "OFF"`, else the number | fan step |
| 212 / 213 | byte as hex | MPU / option code |
| 214 / 215 | raw byte (no name table) | model/software EEPROM identification digits — 215 a digit pair, 214 a single digit. Exposed as the raw byte; page `0x11` is rendered as space-separated hex for display (`logic/detect.hpp` `eeprom_render`) and used only as an auto-detection hint, never decoded to a model name. |

### 3.4 Enum converters

| Conv | Field | Values |
|-----:|-------|--------|
| **217** | byte | Operation mode — see [§4.1](#41-operation-mode-conv-217) |
| **315** | `(byte & 0xF0) >> 4` (**high nibble**) | Indoor/hydronic operation mode — see [§4.2](#42-indoorhydronic-operation-mode-conv-315) |
| **203** | byte | Error class: `0` Normal, `1` Error, `2` Warning, `3` Caution |
| **204** | byte | Error code — first character from the map in [§4.3](#43-error-code-conv-204), then digits |
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
| 0 | Fan Only | 6 | Auto Cool |
| 1 | Heating | 7 | Dry |
| 2 | Cooling | 8 | Aux. |
| 3 | Auto | 9 | Cooling Storage |
| 4 | Ventilation | 10 | Heating Storage |
| 5 | Auto Heat | 11–18 | Use-stored-thermostat (cool 1–4 / heat 1–4) |

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

The error byte's high nibble indexes a **first-character** table; the low nibble/next byte gives the
digits. The Daikin first-character map (index 0…):

```
- 1 2 3 4 5 6 7 8 9 A C E F * H J E L U * P P P U 2 A E F * * *
```

e.g. a code decoding to first-char `U` + `4` displays as **`U4`**. Error *class* comes from
`conv 203` (Normal / Error / Warning / Caution).

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
| 8 | 2 | 151 |  |  | Expansion valve 3 (pls) |
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
- **Bit flags** (`conv 300–307`) map naturally to `binary_sensor`s (ON/OFF).
- A value whose converter is not implemented returns `unimpl` and is simply skipped — never reported
  wrong. Prefer skipping to guessing a scale.

---

## 7. Porting a model

1. Get the model's rows as `{reg, offset, conv, size, type, label}` (one row per value).
2. Feed them to [`tools/gen_defs.py`](../tools/gen_defs.py) → an embedded `def/<family>.hpp` table.
3. Wire the profile into `def/registry.hpp` and the `/models` catalog.
4. Ensure every `conv` used is implemented in [`logic/convert.hpp`](../main/logic/convert.hpp); add a
   `CHECK` in [`test/test_logic.cpp`](../test/test_logic.cpp) for any new converter (see the
   `add-logic-test` skill). All converters used by the shipped profiles are implemented — numeric
   (`101–119`, `151–163`, `405`), bit flags (`300–307`), and the enum/label converters (`203` error
   class, `204` error code, `211` fan step, `217` operating mode, `219` capacity code, `315` indoor
   mode, `316` hybrid mode, `801–805` refrigerant). A `conv` id with no `case` returns `unimpl` and
   is skipped, never mis-decoded.

# ESPAltherma ↔ daikin-altherma-esp32 — verified comparison & knowledge base

Purpose: a **fact-checked** reference distilled from the upstream [ESPAltherma](https://github.com/raomin/ESPAltherma)
project (source, docs, 381 issues, 76 PRs) and the [HA community thread](https://community.home-assistant.io/t/daikin-altherma-heat-pump-monitoring/259837),
so future work on this firmware builds on **confirmed** facts and is not led astray by the
oversimplifications and unmerged proposals that circulate upstream.

**Method (2026-07-13).** Multi-agent research collected 164 claims, then adversarially fact-checked
the top 40 against primary sources (35 confirmed, 5 partial, 0 refuted, 0 unverifiable). Every code
defect and doc-drift item below was then re-verified by hand against our tree, the upstream source,
and `doc/DISCREPANCIES.md`. Nothing here rests on an unverified claim. Citations use `upstream:<path>`
for ESPAltherma and bare paths for our repo.

> **Golden rule for porting from upstream:** on the wire, **only the `convid` decides sign / scale /
> endianness**. The def-row `dataType` is a *Home-Assistant presentation hint only* (unit +
> device_class), never a decode type. Label strings are **not** identity keys (`doc/DISCREPANCIES.md`
> lists 72 same-label/different-mapping collisions; "Not in use" is reused across 35 unrelated rows).

---

## 1. Verified X10A protocol knowledge base

All items confirmed against `upstream:include/comm.h`, `upstream:include/converters.h`,
`upstream:doc/Daikin I protocol.md`, `upstream:doc/Daikin S protocol.md`, and cross-checked to our
`logic/crc.hpp` / `logic/convert.hpp` (host-tested in `test/test_logic.cpp`).

| Topic | Fact |
|-------|------|
| **Link layer** | 9600 baud, **8E1** (8 data, even parity, 1 stop), half-duplex, ESP is master, the unit only answers. Identical for protocol I and S. |
| **Checksum** | 8-bit sum of the preceding bytes, then bitwise-NOT (`~`). Equivalently, all frame bytes incl. the checksum sum to `0xFF`. No table/poly/seed. |
| **Request I** | 4 bytes `{0x03, 0x40, reg, cksum}` — `0x03`=len of following, `0x40`=read opcode. |
| **Request S** | 3 bytes `{0x02, reg, cksum}` — **no `0x40` opcode byte**. This is the on-wire I↔S difference. |
| **Reply I** | Dynamic length: `byte0=0x40`, `byte1=reg echo`, `byte2=len after byte2`, payload from byte3, final byte=CRC. Read 3 bytes, then `replyLen = buf[2]+2`. |
| **Payload offset** | Value bytes start at **offset 3** for I, **offset 1** for S. Each value's position = `def.offset + payloadOffset`. |
| **NAK / error** | Two-byte reply `0x15 0xEA` (sums to `0xFF`) = register unavailable / wrong protocol. Normal during detection — skip it. |
| **Protocol scope** | Only **I** (modern Altherma) and **S** (older units / Rotex, ~pre-2010; e.g. EKHBH016BA6WN, RDLQ014AA6V3) are real X10A framings. The broader Daikin `@`/`M` framings are **not** used by Altherma and not implemented. |
| **Numeric convs** | `105/106` signed ×0.1 (105=LE, 106=BE); `103/104` signed Q8.8 (`/256`); `107/108` signed ×0.1 with `0x8000`(=−3276.8) meaning *no-data*; `114/119` signed-LE ×0.1 target temps, same `0x8000` sentinel; `118` signed-BE ×0.01; `151/152` unsigned (152=BE 2-byte); `161` unsigned ×0.5 (CT current, 0.5 A). Within 101–111, even convid = little-endian, odd = big-endian. |
| **Bit-flag convs** | `300+n` → bit `n` (0=LSB) of `data[0]` → ON/OFF. |
| **Refrigerant → curve** | Convid `801`=R410A, `802`=R32 (default), `803`=R22, `804`=R407C, `805`=R134a. A size-0 `*Refrigerant type` row declares the unit's refrigerant, which selects the `conv 405` pressure→saturation-temperature polynomial. Upstream: 802 in ~20 def files, 801 in ~12. |
| **conv 405 scope** | `conv 405` (press→sat-temp) applies **only to refrigerant pressures** — those rows are size-2, labelled with a `…(T)` suffix, and paired with a `105` companion row. A plain `"Water pressure"` (hydronic, size-1, no `(T)`) is **always raw bar (`105`)**; `405` there is a catalog catalog bug (see §3 #2). |
| **O/U capacity** | Register `0x00` offset 12 is `conv 105` (**linear ×0.1 kW**) — *not* a code-table (`212/219`) lookup. Our fingerprint reads it correctly. Offsets 10/11 = O/U MPU ID. |
| **Upstream architecture** | Compile-time model pick (one uncommented `#include "def/<model>.h"` in `setup.h`), **no runtime detection**, read-only over X10A, unsigned push-OTA (ArduinoOTA), hard-coded WiFi/MQTT `#define`s, 8 PlatformIO envs (nodemcuv2/esp32/4×M5/esp32c3/native — no s3/c6/c5). |

---

## 2. Misleading / unverified upstream claims — **do NOT adopt**

These come from upstream **unmerged proposal docs** (`doc/auto_model_detection.md`,
`doc/AS_NUMBER_BYTE_REFERENCE.md`) and loose protocol notes. Each was flagged partial/misleading by
the fact-check. Treat as **quarantined**.

| Claim (upstream) | Why it is wrong / misleading |
|---|---|
| "`0xA0` present ⇒ D-series only" | **False.** The D-series Mini-chiller (EWAA-EWYA) also carries `0xA0`, and the source doc self-contradicts (`FAMILY_CHILLER = "No 0xA0"`). `0xA0` marks a *newer Protocol-I generation*, not a fixed model set. Hard-coding this misclassifies the chiller. |
| "36 defs = exactly 7 families" | The number is unreliable — the same doc's enum lists ~11 family IDs. The *thesis* (register-identical models ⇒ candidate-set is the detection ceiling) is sound and matches our design; the literal **7** is not. |
| "`conv 105` = uint16 ÷10 temperature" | It is **signed** (a negative outdoor temp reads ~6553 if taken unsigned) and it is a **generic** signed-LE ×0.1 converter also used for **currents** — not temperature-only. |
| "`dataType`: −1=unsigned, 1=signed/÷10" | `dataType` is an **HA presentation hint**, not a decode type. Sign/scale/endianness come only from the `convid`. "−1 = unsigned" is fabricated (−1 = "no HA hint"). Porting on this reading mis-decodes. |
| "`conv 152` = one-byte; `300–315` all boolean" | `152` is **2-byte big-endian**. `300–315` is not uniformly boolean: `310/311` numeric bitfields, `312` fractional, `314` a model-code string, `315/316` mode tables. |
| "O/U capacity via code tables `219/212`" | Offset-12 capacity is `conv 105` **linear ×0.1 kW**. Do **not** "reuse 219/212" for it. |
| AS-number (`0x63`) & chassis-bits (`0xA1` off 9) decode | Recent reverse-engineering; the chassis labels ship **commented-out**, and both live only in unmerged proposals. Unvalidated against hardware — do not use for identity yet. |
| "9 PlatformIO envs" | It is **8** (off-by-one in the claim's own enumeration). |

---

## 3. Defects found and fixed (2026-07-13)

All fixed with a host-test `CHECK` in `test/test_logic.cpp`; esp32s3 firmware build + mock tests green.

| # | Sev | Defect | Fix |
|---|-----|--------|-----|
| 1 | High | Refrigerant type never reached `conv 405`, so every saturation temp used the **R32** curve (default `rtype=802`) — wrong by several °C on the 15 profiles that declare **R410A (801)**. | `profile_refrigerant()` in `logic/convert.hpp`; threaded through `hp_format` and `poll_once` (`hp_poll.cpp`). Now matches `docs/REGISTERS.md`, which already promised refrigerant-selected curves. |
| 2 | High | **`{0x62,11,405,1,1,"Water pressure"}` decoded a hydronic water pressure through the refrigerant `press2temp` curve (conv 405) → a bogus temperature.** A catalog catalog quirk on **four** register-identical 4-8kW / E-series profiles — including the **user's own `altherma_erga_e_ehv_ehb_ehvz_e_ej`** (byte-identical to the EBLA-EDLA 4-8kW twin, whose upstream def uses `105`). conv 405 is legitimate **only** for the size-2 refrigerant `…(T)` saturation rows (which pair a `105` companion) — never for a size-1 `"Water pressure"`. | All four rows (+ the `altherma3_r_erga` fixture) → `{0x62,11,105,1,2,…}`; `gen_profiles.py` `correct()` now normalises any size-1 `"Water pressure"` @ `0x62[11]` to raw bar (leaving `…(T)` rows untouched); a **catalog-wide** host guard asserts no profile decodes `0x62[11]` as `405`. |
| 3 | Med | `OP_MODE[5]/[6]` swapped vs upstream `convertTable217` → a unit in mode 5/6 showed **Auto Heat/Auto Cool inverted**. | Swapped to `"Auto Cool","Auto Heat"` in `logic/convert.hpp`. |
| 4 | Med | `conv 161` (×0.5) printed as **integer** (lost the 0.5); `conv 118` (×0.01) got only 1 decimal. | `display_decimals()` in `logic/convert.hpp` (118→2, 161/scaled→1) used by `hp_convert.cpp`. |
| 5 | Low | `/diag` `last_error` was the truncated string `"reg error 0x"` — no register or code. | `snprintf("reg 0x%02X error %d", reg, n)` in `hp_poll.cpp`. |

**Doc drift corrected:** OTA pull-path (check/download/downgrade-gate) marked as TODO stubs, not
implemented (`docs/SECURITY.md`, `ota_update.hpp`); units/device_class provenance corrected from
"converter id" to `dataType` (`docs/HOME_ASSISTANT.md`, `docs/ARCHITECTURE.md`); `@`/`M` framing sweep
corrected to the real I/S sweep and 5-byte sub-index marked unimplemented (`docs/X10A_PROTOCOL.md`);
no-data sentinel clarified as raw `00 80` = `0x8000` = −3276.8 (`docs/REGISTERS.md`).

---

## 4. Genuine gaps not yet closed (optional, low value)

- **Indoor AS-number decode from `0x63`** (offsets 2–7 nibble-pack the Daikin AS number, e.g.
  `AS1709217-30A`). We already probe `0x63` but discard the payload. *Display-only*; does not change
  which register profile is read (candidates are register-equivalent). Costs flash/heap — weigh
  against the tight-heap constraint. If done: pure decoder in `logic/detect.hpp` + a `CHECK` on the
  documented vector, surfaced in `/status`.
- **Chassis-type tie-breaker from `0xA1` offset 9** (bits: Monobloc/Minichiller/MT/GSHP/Hydro-split/LT).
  Only as an **ambiguity tie-breaker** (`detect.ambiguous`), never a primary selector — it is coarse
  and unvalidated against hardware (upstream ships it commented-out).

## 5. Open questions (need real hardware)

- Does **S-protocol register `0x56`** reply with **4 bytes** (`logic/crc.hpp:34`) or **6**
  (`upstream:doc/Daikin S protocol.md`)? They disagree; an S read of `0x56` is unverified.
- Do the `0xA1` chassis bits and `0x63` AS-number nibble decodes match a captured real frame?
- Confirm the `/status` handler's large `std::string`/`std::vector` JSON build is inside the
  OOM→503 try/catch guard the memory-safety rule requires.

## 6. Where we deliberately differ from ESPAltherma

Runtime **auto-detection** of model + pins + protocol (vs their compile-time `#include`); captive-portal
runtime **WiFi/MQTT provisioning** (vs hard-coded `#define`s); **five ESP32 targets from one tree**
(vs 8 per-board PlatformIO envs, no s3/c6/c5); **signed pull-OTA + rollback health gate** (vs unsigned
push); **both X10A protocols auto-swept** (vs a compile-time `PROTOCOL` define); one **grouped-JSON**
MQTT state topic. These are genuine differentiators, all confirmed against upstream source.

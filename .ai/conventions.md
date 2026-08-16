# Coding Conventions & Development Rules

This document defines coding standards, memory constraints, persistence rules, and architectural invariants for `daikin-altherma-esp32`.

---

## 1. Project Identity & Naming

- **Project Name:** Always write the full name `daikin-altherma-esp32` (for hostnames, SoftAP SSIDs, MQTT base topics, and documentation). Never shorten to `daikin-altherma`.
- **Third-Party Credits:** Do not reference other external projects in code or docs. Protocol credits belong strictly in the README "Scope & credits" section.
- **Documentation Drift:** Keep docs and code in strict sync. Changes to component architecture, NVS keys, HTTP endpoints, or config models require updating the respective markdown files.

---

## 2. Code Organization & Logic Separation

- **Pure Logic Placement:** All decoding, formatting, model detection, state evaluation, and validation logic belongs in `main/logic/` as IDF-free, header-only C++ modules.
- **Unit Testing Obligation:** Every change or addition in `main/logic/` MUST have a corresponding `CHECK` in `test/test_logic.cpp`. Never bury pure logic in `.cpp` files where only the physical device can execute it.
- **Generated Catalog Tables (`main/def/`):** The value profiles, signatures, and catalog files in `main/def/` are machine-generated. **NEVER hand-edit generated tables** (regenerate and verify against `docs/REGISTERS.md`).
- **Temporary Overlays:** The only handwritten supplement is `main/def/overlay.hpp`. Labels added here must match byte-for-byte with metric databases (e.g. VictoriaMetrics series).

---

## 3. Memory & Resource Safety (Heap & Stack)

Heap and stack headroom are severely constrained on ESP32-S3 (shared with WiFi, MQTT, TLS, and FreeRTOS tasks).

### Heap Constraints
- **Largest Contiguous Block:** The binding constraint is internal contiguous free DRAM (`MALLOC_CAP_INTERNAL`), not total free heap. PSRAM does not replace internal heap for driver buffers.
- **HTTP Handler OOM Protection:** Every HTTP handler must be guarded against OOM. `http_register()` wraps handlers in the `handle_all` trampoline: uncaught `std::bad_alloc` returns HTTP 503; any other uncaught exception returns HTTP 500. Unhandled throws unwind into C frames, causing `std::terminate` and boot loops.
- **No Large Contiguous Buffers:** Avoid large monolithic `std::string` buffers for payloads. Stream large endpoints (like `/diag`, status dumps, and MQTT discovery) in chunks.
- **JSON Construction:** Build complex JSON structures using incremental concatenation (`+=`), never chained temporary additions (`a + b + c + ...`), which allocate all temporary strings simultaneously on the stack frame.

### Stack Headroom Rules
- **Task Priority Table:** Relative task priorities are declared centrally in `main/task_config.hpp` (`TASK_PRIO_*`). Do not invent ad-hoc priority values.
- **Task Stack Sizing:** Stack sizes live at task creation sites and are justified by worst-case measured frame depth.
- **Stack Monitoring:** Monitor stack headroom via `main/stack_watch.cpp` (`*_stack_min_free_bytes`). Check USED/FREE stack in core dumps; headroom under ~1 KB must be addressed.
- **Compiler Optimization for Builders:** `http_status.cpp` compiles at `-Os` per-source-file (`main/CMakeLists.txt`) to avoid stack frame explosion from string temporaries.

### FreeRTOS Tasks & Concurrency
- **Task Loop Self-Guarding:** Every FreeRTOS task loop that performs allocations must wrap its iteration body in `try { ... } catch (const std::exception&) { ... } catch (...) { ... }`, log the error once via `diag_printf`, skip the iteration, and continue after its normal delay.
- **Never Allocate While Holding a Mutex:** A throw while holding a raw mutex will leak the lock and cause deadlocks. Keep mutex critical sections strictly non-allocating (e.g. stage data in local variables and `swap`/move under lock), or use RAII `daik::SemGuard` (`Lock` from `main/rtos_guard.hpp`).

---

## 4. NVS & Configuration Persistence

- **NVS Partition Stability:** The `nvs` partition at offset `0x9000` (size 24 KB) must remain identical across firmware releases to ensure OTA updates preserve configuration.
- **Atomic Credential Blob:** Credentials and core settings are stored in `daik_cfg` as a single, atomic, CRC-checked blob (`logic/config_store.hpp`).
- **Writers Commit Only Owned Fields:**
  - HTTP handlers (`/set_*`) own service and credential configuration and use whole-struct `config_save`.
  - Polling and model detection tasks use narrow setters (`config_save_link`, `config_set_model`) to avoid overwriting credential changes received during detection sweeps.
- **Error Handling on Writes:** `config_save` returns a boolean indicating success. All callers must check this return value and return `500 {"ok":false,"error":"config write failed"}` upon failure.
- **NVS Setters:** Functions in `nvs_storage.cpp` are marked `[[nodiscard]]` and return `esp_err_t`. Always compare against `ESP_OK`.

---

## 5. Review Gates & Verification Principles

- **Passing Tests != Correct Semantics:** Unit tests verify only logic as specified. They cannot detect a well-formed value that is physically incorrect for the heat pump. Domain correctness audits (`/domain-review`) are mandatory for value changes.
- **Review Gates:**
  - `domain-review`: Ensures register values and physical units match heat pump specifications.
  - `schematic-review`: Verifies that UI SVG schematics and piping diagrams match hardware realities.
  - `absence-review`: Verifies handling of optional or absent sensors and accessories.
  - `ui-use-case-review`: Validates UI interaction workflows and contract endpoints.
- **Audit Exception Ledgers:** Exceptions to automated audits must be explicitly justified in `audit_exceptions.txt` files with documented engineering rationale.
- **Compiler Warnings:** Pinned in `main/CMakeLists.txt` (`-Werror=return-type`, `-Werror=format`, `-Werror=unused-result`).

#pragma once
// Device glue over the pure logic/heap_watchdog.hpp: the one internal-heap sampler the whole
// firmware reports from, the persisted consecutive-restart breadcrumb, and the deliberate restart
// itself. The DECISION is in the header; this file only samples, narrates and acts.
#include <cstddef>
#include <cstdint>

namespace daik {

// The largest contiguous free block of INTERNAL DRAM — the binding OOM limit on this board.
//
// THE ONE sampler. Every reporting site went through heap_caps_get_largest_free_block
// (MALLOC_CAP_DEFAULT), which is the maximum across every heap carrying the cap: on a board with
// CONFIG_SPIRAM enabled (sdkconfig.defaults offers it) that answers from PSRAM, so /status.sys
// .max_alloc, the MQTT heartbeat, the max_alloc trend and /set_mqtt's pre-flight would all report
// megabytes of headroom while internal DRAM — the heap that actually binds — sat at a few hundred
// bytes. Latent today (PSRAM is off by default) and silent when it is not, which is why it is worth
// one shared function rather than five call sites each spelling out a capability mask.
size_t heap_largest_internal_block();

// Call ONCE early in app_main, AFTER safe_mode_begin() (whose classification of this boot it
// applies) and before main.cpp's safe-mode gate. Applies the heap half of that one classification
// (logic/boot_guard.hpp's boot_heap_ladder_step): a crash or heap-watchdog boot HONOURS the stored
// consecutive-restart count — loads it, and comes up minimal at the cap — and leaves it in NVS; a
// clean boot treats it as 0 and clears it. Nothing else ever clears it.
void heap_guard_begin();

// How many consecutive heap-watchdog restarts this boot honours: 0 on a clean boot, and on a crash
// boot the count carried across it. Reported on /status.sys.heap_restarts: the restart is an
// esp_restart(), so its reset reason is the same "sw" a config save produces, and without this a
// self-restarting board would be indistinguishable from one somebody kept saving settings on — the
// "reboot nobody can attribute" that /status.sys exists to prevent.
uint8_t heap_guard_restarts();

// Read AND clear the RAM marker the watchdog leaves immediately before its own esp_restart()
// (logic/boot_guard.hpp's HeapRestartMarker). True when the previous boot ended in that restart —
// as far as the marker can tell; boot_classify() additionally requires reset reason "sw". Called
// exactly once per boot, by safe_mode_begin(); a second call would always answer false.
bool heap_guard_take_restart_marker();

// Feed one sample. Called at the top of every X10A poll cycle (1 Hz), beside
// history_record_board(), because that site is already unconditional within the task and already
// reads the heap.
//
// NOT COVERED IN SAFE MODE, deliberately and worth stating rather than discovering: the poll task
// is one of the things safe mode does not start. Safe mode also shuts down the five largest
// allocators on the board at once — the poll engine, the MQTT bridge, the weather client, the
// HomeHub link and ENV III — so the sustained exhaustion this exists for is far less reachable
// there, and a board in safe mode is already sitting in the reachable, minimal state a restart
// would be trying to produce.
//
// NEVER RESTARTS DURING A FACTORY RESET. While nvs_factory_reset_latched() holds, the recovery
// button is erasing stored data; it restarts the device itself when the erase completes, and
// deliberately not when it fails. A restart in that window would boot a partially erased device
// that looks like a finished reset. The restart is held (nvs_restart_held_by_factory_reset says so
// on /diag, once per boot), and the device keeps running.
void heap_guard_sample();

} // namespace daik

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

// Call ONCE early in app_main, after NVS init. Reads the consecutive-restart breadcrumb this boot
// inherited and clears it, so the count only ever survives a restart THIS guard made.
void heap_guard_begin();

// How many consecutive heap-watchdog restarts preceded this boot (0 on an ordinary one). Reported on
// /status.sys.heap_restarts: the restart is an esp_restart(), so its reset reason is the same "sw" a
// config save produces, and without this a self-restarting board would be indistinguishable from one
// somebody kept saving settings on — the "reboot nobody can attribute" that /status.sys exists to
// prevent.
uint8_t heap_guard_restarts();

// Feed one sample. Called at the top of every X10A poll cycle (1 Hz), beside history_record_board(),
// because that site is already unconditional within the task and already reads the heap.
//
// NOT COVERED IN SAFE MODE, deliberately and worth stating rather than discovering: the poll task is
// one of the things safe mode does not start. Safe mode also shuts down the five largest allocators
// on the board at once — the poll engine, the MQTT bridge, the weather client, the HomeHub link and
// ENV III — so the sustained exhaustion this exists for is far less reachable there, and a board in
// safe mode is already sitting in the reachable, minimal state a restart would be trying to produce.
void heap_guard_sample();

} // namespace daik

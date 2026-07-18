#pragma once
// X10A UART (re)init plan (hp_comm.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// hp_uart_init(rx,tx) used to uart_driver_delete + uart_driver_install on ANY pin change. The
// auto-detect sweep alternates its candidate pins {44,43}<->{43,44} every poll second while the bus
// is silent (hp_detect.cpp), so the same-pins short-circuit never fired and the driver was torn down
// + rebuilt ~2x/second forever — each install allocates a 256 B RX ring + driver struct + sync
// primitives + an ISR record off the heap. That small heterogeneous alloc/free churn fragments the
// heap (a coredump caught free ~26k but largest-contiguous only 6144) until an unrelated allocation
// (poll_once's std::vector<CachedValue>) throws a std::bad_alloc too starved to even unwind ->
// std::terminate -> abort(), BELOW poll_task's try/catch. uart_set_pin re-routes the UART signals
// WITHOUT allocating and is orthogonal to the driver install (ESP-IDF legacy driver/uart.h), so a
// genuine pin change is a register-level Remap, not a reinstall. This header decides
// install / remap / reuse from the pins the driver is already up on.
//
// SCOPE: this removes what STARVES the heap. It does NOT silence the "GPIO 43/44 not usable" warning
// (that comes from the pin routing uart_set_pin still performs), and it is not a defrag — an
// already-churned board needs one reboot to reclaim a clean heap, after which this keeps it clean.
#include <cstdint>

namespace daik {

enum class UartAction : uint8_t {
    Noop,      // driver already up on these EXACT pins — reuse it, allocate nothing
    Install,   // no driver yet — uart_param_config + uart_driver_install + uart_set_pin
    Remap,     // driver up on DIFFERENT pins — uart_set_pin only (register re-route, NO heap, NO delete)
};

// What hp_uart_init must do to serve (new_rx,new_tx) given the driver's current state. Non-allocating,
// constexpr — cannot throw, safe anywhere the UART/config is guarded by a mutex.
inline constexpr UartAction uart_plan(bool inited, int cur_rx, int cur_tx, int new_rx, int new_tx) {
    if (!inited)                              return UartAction::Install;
    if (cur_rx == new_rx && cur_tx == new_tx) return UartAction::Noop;
    return UartAction::Remap;
}

} // namespace daik

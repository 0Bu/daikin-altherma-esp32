#pragma once
// Protocol + model auto-detection glue. Sweeps the X10A protocol variant (I/S), probes the register
// pages, reads the O/U capacity and EEPROM digits, then narrows the model profiles via the pure
// logic/detect.hpp against the derived def/signatures.hpp. Runs from the poll task (it owns UART1)
// when config().profile == "auto". Decisions are pure/host-tested; this file only does the bus I/O.
#include <cstdint>
#include <string>
#include <vector>
#include "logic/crc.hpp"

namespace daik {

struct DetectResult {
    bool        bus_ok    = false;       // the identity page answered on some protocol/pin pair
    Protocol    proto     = Protocol::I; // winning framing
    int         rx        = -1;          // winning RX/TX pins (auto-corrects a swapped wiring)
    int         tx        = -1;
    uint32_t    page_mask = 0;           // pages that answered (logic/detect.hpp page_bit)
    int         kw_tenths = -1;          // O/U capacity in 0.1 kW; -1 = unknown
    std::string eeprom;                  // rendered O/U EEPROM digits ("" if page 0x11 absent)
    std::vector<std::string> candidates; // register-equivalent model ids (empty = none → generic)
    std::string best;                    // single best-fit id to READ with ("" = none → generic)
};

// Run one detection pass on the configured rx/tx pins. UART I/O — call only from the poll task.
DetectResult hp_detect_run();

} // namespace daik

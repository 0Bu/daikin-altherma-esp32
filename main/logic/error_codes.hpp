#pragma once
// English short descriptions for the 2-character Daikin fault code decoded by conv 204
// (ERR_C1/ERR_C2 in convert.hpp — see docs/REGISTERS.md §4.3). This is a LOOKUP, not a decoder:
// it never changes what conv 204 reads off the wire, only how the already-decoded code is
// presented. A code the table doesn't cover (older/newer model, or a nibble-0 single-char code
// the reference material never assigns) degrades to the bare code — enrichment is best-effort,
// not a completeness guarantee.
#include <cstring>
#include <string>

namespace daik {

struct ErrorCodeEntry {
    const char* code;         // 2-char code, e.g. "U4" (as produced by conv 204 / ERR_C1+ERR_C2)
    const char* description;  // short English label
};

// One entry per distinct 2-char prefix; where a model's service manual splits a prefix into
// several numbered sub-codes (e.g. 7H-01/04/05/06), the description covers the shared fault
// class rather than one specific sub-code, since conv 204 only exposes the 2-char prefix.
inline constexpr ErrorCodeEntry ERROR_CODE_TABLE[] = {
    {"7H", "Water flow problem"},
    {"80", "Return water temperature sensor fault"},
    {"81", "Leaving water temperature sensor fault"},
    {"89", "Heat exchanger frost protection activated"},
    {"8F", "Abnormal DHW outlet water temperature rise"},
    {"8H", "Abnormal leaving water temperature rise"},
    {"A1", "Zero-crossing detection failure"},
    {"A5", "High-pressure peak-cut / frost protection problem"},
    {"AA", "Backup heater overheated or not connected"},
    {"AC", "Booster heater overheated"},
    {"AH", "Tank disinfection (anti-legionella) not completed"},
    {"AJ", "DHW heat-up time exceeded"},
    {"C0", "Flow sensor fault"},
    {"C4", "Heat exchanger temperature sensor fault"},
    {"C5", "Heat exchanger sensor fault"},
    {"CJ", "Room temperature sensor fault"},
    {"E1", "Outdoor unit PCB defect"},
    {"E2", "Leakage current detection fault"},
    {"E3", "Outdoor unit high-pressure switch activated"},
    {"E4", "Suction pressure fault"},
    {"E5", "Outdoor unit inverter compressor motor overheat"},
    {"E6", "Outdoor unit compressor startup failure"},
    {"E7", "Outdoor unit fan motor fault"},
    {"E8", "Outdoor unit input overvoltage"},
    {"E9", "Electronic expansion valve fault"},
    {"EA", "Outdoor unit cooling/heating switchover problem"},
    {"EC", "Abnormal tank temperature rise"},
    {"F3", "Outdoor unit discharge pipe temperature fault"},
    {"F6", "Outdoor unit abnormally high pressure during cooling"},
    {"FA", "Outdoor unit abnormally high pressure, high-pressure switch activated"},
    {"H0", "Outdoor unit voltage/current sensor fault"},
    {"H1", "External temperature sensor fault"},
    {"H3", "Outdoor unit high-pressure switch fault"},
    {"H5", "Compressor overload protection fault"},
    {"H6", "Outdoor unit position-detection sensor fault"},
    {"H8", "Outdoor unit compressor input (CT) system fault"},
    {"H9", "Outdoor unit outside air temperature sensor fault"},
    {"HC", "Tank temperature sensor fault"},
    {"HJ", "Water pressure sensor fault"},
    {"J3", "Outdoor unit discharge pipe sensor fault"},
    {"J6", "Outdoor unit heat exchanger sensor fault"},
    {"JA", "Outdoor unit high-pressure sensor fault"},
    {"L1", "Inverter PCB fault"},
    {"L3", "Outdoor unit control box temperature rise fault"},
    {"L4", "Outdoor unit inverter heat sink temperature rise fault"},
    {"L5", "Outdoor unit inverter overcurrent (DC) detected"},
    {"L8", "Inverter PCB thermal protection tripped"},
    {"L9", "Compressor lock protection"},
    {"LC", "Outdoor unit communication system fault"},
    {"P1", "Power supply phase imbalance / open phase"},
    {"P3", "Abnormal DC detected"},
    {"P4", "Outdoor unit heat sink temperature sensor fault"},
    {"PJ", "Capacity setting mismatch"},
    {"U0", "Outdoor unit refrigerant shortage"},
    {"U1", "Reverse phase / open phase malfunction"},
    {"U2", "Outdoor unit mains voltage fault"},
    {"U3", "Underfloor heating screed-drying function not completed correctly"},
    {"U4", "Indoor/outdoor unit communication problem"},
    {"U5", "User interface communication problem"},
    {"U7", "Outdoor unit main CPU / inverter CPU transmission fault"},
    {"U8", "External device (LAN adapter / room thermostat / USB) communication problem"},
    {"UA", "Indoor/outdoor unit combination or compatibility problem"},
    {"UF", "Reversed piping or faulty communication wiring detected"},
};
inline constexpr int ERROR_CODE_TABLE_LEN =
    static_cast<int>(sizeof(ERROR_CODE_TABLE) / sizeof(ERROR_CODE_TABLE[0]));

// Looks up `code` (as produced by conv 204) and returns its description, or "" if the table
// doesn't cover it.
inline const char* error_code_description(const char* code) {
    for (int i = 0; i < ERROR_CODE_TABLE_LEN; i++) {
        if (std::strcmp(ERROR_CODE_TABLE[i].code, code) == 0) return ERROR_CODE_TABLE[i].description;
    }
    return "";
}

// Formats a decoded fault code for publishing: "U4: Indoor/outdoor unit communication problem"
// when the table covers it, else the bare code unchanged (a nibble-0 single-char code, or one
// outside this table's model family, is still a valid, publishable value).
inline std::string format_error_code(const char* code) {
    const char* desc = error_code_description(code);
    if (desc[0] == '\0') return code;
    std::string out = code;
    out += ": ";
    out += desc;
    return out;
}

} // namespace daik

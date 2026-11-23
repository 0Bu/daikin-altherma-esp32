#pragma once
// 24-hour rolling heat-pump working figure (Arbeitszahl = useful heat / electrical input) and
// break-even comparison against a condensing/standard gas boiler. Pure, IDF-free, allocation-free,
// and -fno-exceptions-safe so checkup accumulation, flash persistence and host tests share one
// rule.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "checkup.hpp"
#include "convert.hpp"
#include "cop_scope.hpp"
#include "gas_comparison.hpp"
#include "lwt_select.hpp"
#include "ou_stale.hpp"
#include "rwt_select.hpp"

namespace daik::logic {

inline constexpr uint32_t WORKING_FIGURE_METHOD_VERSION          = 1;
inline constexpr uint32_t WORKING_FIGURE_MIN_OBSERVED_S          = 7200; // 2 h minimum
inline constexpr uint32_t WORKING_FIGURE_MIN_HEAT_WH             = 1000; // 1.0 kWh
inline constexpr uint32_t WORKING_FIGURE_MIN_ELEC_WH             = 200;  // 0.2 kWh
inline constexpr uint8_t  WORKING_FIGURE_FULL_COVERAGE_PCT       = 90;
inline constexpr uint32_t WORKING_FIGURE_FULL_OBSERVED_S         = 77760; // 90% of 86400 s
inline constexpr int32_t  WORKING_FIGURE_CT_UNWIRED_RPS_TENTHS   = 100;   // > 10.0 rps
inline constexpr uint32_t WORKING_FIGURE_CT_UNWIRED_CONFIRM_S    = 30;
inline constexpr int32_t  WORKING_FIGURE_MODBUS_BUH_DELTA_TENTHS = 15; // 1.5 K LWT BUH - PHE rise
inline constexpr double   WORKING_FIGURE_MODBUS_POWER_MAX_W      = 50000.0;

enum class EnergyPelKind : uint8_t {
    None    = 0,
    X10aCt  = 1,
    X10aInv = 2,
    Modbus  = 3,
};

inline constexpr const char* energy_pel_kind_name(EnergyPelKind k) noexcept {
    switch (k) {
    case EnergyPelKind::X10aCt:
        return "x10a_ct";
    case EnergyPelKind::X10aInv:
        return "x10a_inv";
    case EnergyPelKind::Modbus:
        return "modbus";
    case EnergyPelKind::None:
        return "none";
    }
    return "none";
}

enum class CtWireState : uint8_t {
    Unknown = 0,
    Wired   = 1,
    Unwired = 2,
};

enum EnergyFlags : uint8_t {
    ENERGY_F_LIMITED_BUH  = 1u << 0, // compressor-only scope while BUH/BSH ran, or Modbus BUH rise
    ENERGY_F_UNPAIRED_BUH = 1u << 1, // whole-unit scope had active/unknown BUH without R2T
    ENERGY_F_CT_UNWIRED   = 1u << 2, // CT clamps read 0 A while compressor ran > 10 rps for >= 30 s
};

// One hour of energy evidence, packed to exactly 32 bytes with zero implicit padding so flash
// journal CRCs over raw bytes never observe uninitialized padding bits.
struct EnergyBucket {
    int32_t  heat_ws            = 0;
    uint32_t elec_ws            = 0;
    int32_t  outdoor_sum_tenths = 0;
    uint16_t observed_s         = 0;
    uint16_t unpairable_s       = 0;
    uint16_t defrost_s          = 0;
    uint16_t buh_s              = 0;
    uint16_t bsh_excluded_s     = 0;
    uint16_t cooling_excluded_s = 0;
    uint16_t outdoor_samples    = 0;
    int16_t  outdoor_min_tenths = INT16_MAX;
    uint8_t  pel_kind           = 0;
    uint8_t  flags              = 0;
    uint16_t reserved           = 0;
};
static_assert(sizeof(EnergyBucket) == 32, "EnergyBucket must remain 32 bytes");
static_assert(alignof(EnergyBucket) == 4, "EnergyBucket must remain 4-byte aligned");
static_assert(std::has_unique_object_representations_v<EnergyBucket>,
              "EnergyBucket must have zero padding bytes");

// 23 completed hourly buckets; the 24th (open) hour lives in EnergyAccumulator::pending.
struct EnergyRing {
    EnergyBucket buf[CHECKUP_COMPLETED_BUCKETS]{};
    uint8_t      head  = 0;
    uint8_t      count = 0;

    void clear() noexcept {
        for (auto& b : buf) b = EnergyBucket{};
        head  = 0;
        count = 0;
    }

    void reset() noexcept { clear(); }

    void push(const EnergyBucket& b) noexcept {
        buf[head] = b;
        head      = static_cast<uint8_t>((head + 1) % CHECKUP_COMPLETED_BUCKETS);
        if (count < CHECKUP_COMPLETED_BUCKETS) ++count;
    }

    void commit(const EnergyBucket& pending, uint32_t skipped) noexcept {
        push(pending);
        for (uint32_t i = 0; i < skipped && i < CHECKUP_COMPLETED_BUCKETS; ++i)
            push(EnergyBucket{});
    }

    const EnergyBucket* oldest(size_t i) const noexcept {
        if (i >= count || i >= CHECKUP_COMPLETED_BUCKETS) return nullptr;
        const size_t start = count < CHECKUP_COMPLETED_BUCKETS ? 0 : head;
        return &buf[(start + i) % CHECKUP_COMPLETED_BUCKETS];
    }
};

struct EnergyCoverage {
    uint8_t        ct_rows = 0;
    CheckupLocator ct_locs[3]{};
    bool           is_modbus        = false;
    bool           has_modbus_power = false;
    bool           has_inv          = false;
    CheckupLocator inv_loc{};
    bool           has_rps       = false;
    bool           has_flow      = false;
    bool           has_lwt       = false;
    bool           has_rwt       = false;
    bool           has_post_buh  = false;
    bool           has_buh1      = false;
    bool           has_buh2      = false;
    bool           has_bsh       = false;
    bool           has_defrost   = false;
    bool           has_valve_dhw = false;
    bool           has_iu_mode   = false;
    bool           has_outdoor   = false;

    constexpr bool has_buh() const noexcept { return has_buh1 || has_buh2; }
    constexpr bool has_x10a_pel() const noexcept { return ct_rows > 0 || (has_inv && has_rps); }
    constexpr bool supported() const noexcept {
        if (is_modbus) {
            return has_flow && has_rwt && has_lwt && (has_valve_dhw || has_iu_mode) && has_rps &&
                   has_modbus_power;
        }
        return has_flow && has_rwt && (has_lwt || has_post_buh) && (has_valve_dhw || has_iu_mode) &&
               has_x10a_pel();
    }
};

// HomeHub (EKRHH) Modbus carries verified flow, PHE/post-BUH LWT, RWT, BSH, mode, valve and
// electrical power. Altherma 4 remains unsupported until Input 49 flow scaling is verified.
inline constexpr EnergyCoverage energy_modbus_coverage(ModbusProfile profile) noexcept {
    EnergyCoverage c;
    if (profile != ModbusProfile::HomeHub) return c;
    c.is_modbus        = true;
    c.has_rps          = true;
    c.has_flow         = true;
    c.has_lwt          = true;
    c.has_post_buh     = true;
    c.has_rwt          = true;
    c.has_bsh          = true;
    c.has_defrost      = true;
    c.has_valve_dhw    = true;
    c.has_iu_mode      = true;
    c.has_outdoor      = true;
    c.has_modbus_power = true;
    return c;
}

// Fold one publishable, adjudicated X10A profile row into EnergyCoverage.
// CT clamps are matched structurally by (0x63, 14..16, conv 161) so label variants such as
// "CT Sensor (L1)" and "Current measured by CT sensor of L1" both resolve identically.
inline void energy_cover_row(EnergyCoverage& cov, unsigned reg, unsigned off, int conv,
                             const char* label, const char* unit = nullptr) noexcept {
    if (reg == 0x63u && off >= 14u && off <= 16u && conv == 161) {
        bool seen = false;
        for (uint8_t i = 0; i < cov.ct_rows; ++i) {
            if (checkup_row_matches(cov.ct_locs[i], reg, off, conv)) {
                seen = true;
                break;
            }
        }
        if (!seen && cov.ct_rows < 3) {
            cov.ct_locs[cov.ct_rows++] =
                CheckupLocator{static_cast<uint8_t>(reg), static_cast<uint8_t>(off), conv};
        }
    }
    const bool inv_unit_ok = !unit || unit[0] == '\0' || (unit[0] == 'A' && unit[1] == '\0');
    if (reg == 0x21u && off == 0u && inv_unit_ok && !cov.has_inv) {
        cov.has_inv = true;
        cov.inv_loc = CheckupLocator{static_cast<uint8_t>(reg), static_cast<uint8_t>(off), conv};
    }
    if (ou_is_rps_witness(label, reg)) cov.has_rps = true;
    const bool flow_unit_ok = !unit || unit[0] == '\0' || checkup_text_equal(unit, "L/min") ||
                              checkup_text_equal(unit, "l/min");
    if (reg == 0x62u && off == 9u && flow_unit_ok) cov.has_flow = true;
    if (lwt_is_measurement(label)) cov.has_lwt = true;
    if (rwt_is_measurement(label)) cov.has_rwt = true;
    if (cop_is_post_buh(label, reg)) cov.has_post_buh = true;
    if (checkup_row_matches(CHECKUP_LOC_BUH1, reg, off, conv)) cov.has_buh1 = true;
    if (checkup_row_matches(CHECKUP_LOC_BUH2, reg, off, conv)) cov.has_buh2 = true;
    if (checkup_row_matches(CHECKUP_LOC_BSH, reg, off, conv)) cov.has_bsh = true;
    if (checkup_row_matches(CHECKUP_LOC_DEFROST, reg, off, conv)) cov.has_defrost = true;
    if (checkup_row_matches(CHECKUP_LOC_VALVE, reg, off, conv)) cov.has_valve_dhw = true;
    if (checkup_row_matches(CHECKUP_LOC_IU_MODE, reg, off, conv)) cov.has_iu_mode = true;
    if (checkup_row_matches(CHECKUP_LOC_OUTDOOR, reg, off, conv)) cov.has_outdoor = true;
}

inline void energy_cover_row(EnergyCoverage& cov, const ValueDef& row) noexcept {
    energy_cover_row(cov, row.reg, row.offset, row.conv, row.label, unit_for_row(row));
}

struct EnergyAccumulator {
    EnergyBucket pending;
    CtWireState  ct_state                = CtWireState::Unknown;
    uint16_t     ct_zero_run_s           = 0;
    bool         ct_switch_reset_pending = false;
    bool         have_bucket             = false;
    uint32_t     bucket                  = 0;
    int64_t      last_us                 = -1;
    int64_t      first_sample_us         = -1;
    int64_t      latest_sample_us        = -1;

    void reset_continuity() noexcept {
        last_us       = -1;
        ct_zero_run_s = 0;
    }

    void reset() noexcept { *this = EnergyAccumulator{}; }

    void reset_pending() noexcept { pending = EnergyBucket{}; }

    void reset_pending(uint32_t new_bucket, int64_t continuous_now_us) noexcept {
        pending     = EnergyBucket{};
        bucket      = new_bucket;
        have_bucket = true;
        if (continuous_now_us >= 0) last_us = continuous_now_us;
    }

    void clear_all(EnergyRing& ring) noexcept {
        ring.clear();
        reset();
    }

    // Retire only CT buckets accumulated before the unwired switch so restored X10aInv hours from
    // flash survive reboot detection. Returns true if any completed ring bucket was cleared.
    bool acknowledge_ct_unwired_switch(EnergyRing& ring) noexcept {
        bool cleared_ring = false;
        for (size_t i = 0; i < CHECKUP_COMPLETED_BUCKETS; ++i) {
            if (ring.buf[i].pel_kind == static_cast<uint8_t>(EnergyPelKind::X10aCt)) {
                ring.buf[i]  = EnergyBucket{};
                cleared_ring = true;
            }
        }
        pending                 = EnergyBucket{};
        ct_switch_reset_pending = false;
        return cleared_ring;
    }

    int64_t live_span_us() const noexcept {
        return (first_sample_us >= 0 && latest_sample_us >= first_sample_us)
                   ? latest_sample_us - first_sample_us
                   : 0;
    }
};

enum class EnergyIuMode : uint8_t {
    Unknown            = 0,
    HeatingOrDhwOrStop = 1,
    CoolingOnly        = 2,
    CoolingDhw         = 3,
};

constexpr EnergyIuMode energy_parse_iu_mode(const char* text) noexcept {
    if (checkup_text_equal(text, "Heating") || checkup_text_equal(text, "DHW") ||
        checkup_text_equal(text, "Heating + DHW") || checkup_text_equal(text, "Stop"))
        return EnergyIuMode::HeatingOrDhwOrStop;
    if (checkup_text_equal(text, "Cooling")) return EnergyIuMode::CoolingOnly;
    if (checkup_text_equal(text, "Cooling + DHW")) return EnergyIuMode::CoolingDhw;
    return EnergyIuMode::Unknown;
}

struct EnergyStepInput {
    int64_t now_us                    = -1;
    bool    source_ok                 = false;
    bool    modbus_power_known        = false;
    double  modbus_power_w            = 0.0;
    uint8_t ct_valid_count            = 0;
    int32_t ct_sum_tenths             = 0;
    bool    inv_known                 = false;
    int32_t inv_tenths                = 0;
    bool    rps_known                 = false;
    bool    rps_running               = false;
    int32_t rps_tenths                = 0;
    bool    flow_known                = false;
    int32_t flow_tenths               = 0;
    bool    lwt_known                 = false;
    int32_t lwt_tenths                = 0;
    bool    post_buh_known            = false;
    int32_t post_buh_tenths           = 0;
    bool    rwt_known                 = false;
    int32_t rwt_tenths                = 0;
    bool    buh_known                 = false;
    bool    buh_on                    = false;
    bool    bsh_known                 = false;
    bool    bsh_on                    = false;
    bool    defrost_known             = false;
    bool    defrost_on                = false;
    bool    valve_dhw_known           = false;
    bool    valve_dhw_on              = false;
    bool    iu_cooling_only           = false;
    bool    iu_cooling_dhw            = false;
    bool    iu_heating_or_dhw_or_stop = false;
    bool    outdoor_known             = false;
    int32_t outdoor_tenths            = 0;

    void set_iu_mode(EnergyIuMode m) noexcept {
        iu_cooling_only           = (m == EnergyIuMode::CoolingOnly);
        iu_cooling_dhw            = (m == EnergyIuMode::CoolingDhw);
        iu_heating_or_dhw_or_stop = (m == EnergyIuMode::HeatingOrDhwOrStop);
    }

    void set_iu_mode(const char* text) noexcept { set_iu_mode(energy_parse_iu_mode(text)); }
};

inline void working_figure_step(EnergyAccumulator& acc, const EnergyCoverage& cov,
                                const EnergyStepInput& in, EnergyRing* ring = nullptr) noexcept {
    // 1. Source liveness & continuity gate: never bridge across gaps > CHECKUP_MAX_GAP_S or jumps.
    if (!in.source_ok || in.now_us < 0) {
        acc.reset_continuity();
        return;
    }
    if (acc.last_us >= 0 && in.now_us < acc.last_us) {
        acc.reset_continuity();
        acc.last_us = in.now_us;
        return;
    }
    if (acc.first_sample_us < 0) acc.first_sample_us = in.now_us;
    if (acc.latest_sample_us < 0 || in.now_us >= acc.latest_sample_us)
        acc.latest_sample_us = in.now_us;

    uint32_t dt         = 0;
    bool     continuous = false;
    if (acc.last_us >= 0) {
        const int64_t gap_us = in.now_us - acc.last_us;
        if (gap_us <= static_cast<int64_t>(CHECKUP_MAX_GAP_S) * 1000000LL) {
            dt         = static_cast<uint32_t>(in.now_us / 1000000 - acc.last_us / 1000000);
            continuous = true;
        }
    }

    const uint32_t current_bucket = checkup_bucket(in.now_us);
    if (ring != nullptr) {
        if (!acc.have_bucket) {
            acc.bucket      = current_bucket;
            acc.have_bucket = true;
        } else if (current_bucket != acc.bucket) {
            const uint32_t skipped = checkup_skipped(acc.bucket, current_bucket);
            ring->commit(acc.pending, skipped);
            acc.pending = EnergyBucket{};
            acc.bucket  = current_bucket;
            if (continuous) dt = 0;
        }
    }
    acc.last_us = in.now_us;
    if (!continuous) {
        acc.ct_zero_run_s = 0;
        return;
    }

    // 2. Explicit IU_MODE filtering (never reject "DHW" or "Stop").
    if (in.iu_cooling_only) {
        acc.ct_zero_run_s              = 0;
        acc.pending.cooling_excluded_s = checkup_add_u16(acc.pending.cooling_excluded_s, dt);
        return;
    }
    if (in.iu_cooling_dhw) {
        acc.ct_zero_run_s = 0;
        if (!in.valve_dhw_known) {
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        }
        if (!in.valve_dhw_on) {
            acc.pending.cooling_excluded_s = checkup_add_u16(acc.pending.cooling_excluded_s, dt);
            return;
        }
    } else if (cov.has_iu_mode && !in.iu_heating_or_dhw_or_stop) {
        acc.ct_zero_run_s        = 0;
        acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
        return;
    }

    // 3. Electrical source selection & strict no-fallback.
    double        pel_w    = 0.0;
    EnergyPelKind pel_kind = EnergyPelKind::None;
    if (cov.is_modbus) {
        if (!cov.has_modbus_power) return;
        if (!in.modbus_power_known || !std::isfinite(in.modbus_power_w) ||
            in.modbus_power_w < 0.0 || in.modbus_power_w > WORKING_FIGURE_MODBUS_POWER_MAX_W) {
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        }
        pel_w    = in.modbus_power_w;
        pel_kind = EnergyPelKind::Modbus;
    } else if (cov.ct_rows > 0 && acc.ct_state != CtWireState::Unwired) {
        if (in.ct_valid_count < cov.ct_rows || in.ct_sum_tenths < 0) {
            acc.ct_zero_run_s        = 0;
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        }
        if (in.ct_sum_tenths > 0) {
            acc.ct_state      = CtWireState::Wired;
            acc.ct_zero_run_s = 0;
        } else {
            if (in.rps_known && in.rps_tenths > WORKING_FIGURE_CT_UNWIRED_RPS_TENTHS) {
                acc.ct_zero_run_s = checkup_add_u16(acc.ct_zero_run_s, dt);
                if (acc.ct_zero_run_s >= WORKING_FIGURE_CT_UNWIRED_CONFIRM_S) {
                    acc.ct_state = CtWireState::Unwired;
                    acc.pending.flags |= ENERGY_F_CT_UNWIRED;
                    if (cov.has_inv && cov.has_rps) acc.ct_switch_reset_pending = true;
                    acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
                    return;
                }
            } else {
                acc.ct_zero_run_s = 0;
            }
        }
        pel_w    = static_cast<double>(in.ct_sum_tenths) * 23.0;
        pel_kind = EnergyPelKind::X10aCt;
    } else if (cov.has_inv && cov.has_rps) {
        if (!in.rps_known) {
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        }
        if (!in.rps_running) {
            pel_w    = 0.0;
            pel_kind = EnergyPelKind::X10aInv;
        } else if (!in.inv_known || in.inv_tenths < 0) {
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        } else {
            pel_w    = static_cast<double>(in.inv_tenths) * 23.0;
            pel_kind = EnergyPelKind::X10aInv;
        }
    } else {
        return;
    }

    // 4. System boundary & BSH/BUH pairing.
    const bool is_compressor_only  = (pel_kind == EnergyPelKind::X10aInv);
    bool       selected_lwt_known  = false;
    int32_t    selected_lwt_tenths = 0;

    if (cov.is_modbus) {
        if ((cov.has_bsh && !in.bsh_known) || (in.bsh_known && in.bsh_on)) {
            acc.pending.bsh_excluded_s = checkup_add_u16(acc.pending.bsh_excluded_s, dt);
            return;
        }
        if (!in.lwt_known) {
            acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
            return;
        }
        selected_lwt_known  = true;
        selected_lwt_tenths = in.lwt_tenths;
    } else if (!is_compressor_only) {
        if ((cov.has_bsh && !in.bsh_known) || (in.bsh_known && in.bsh_on)) {
            acc.pending.bsh_excluded_s = checkup_add_u16(acc.pending.bsh_excluded_s, dt);
            return;
        }
        if (cov.has_post_buh) {
            if (in.post_buh_known) {
                selected_lwt_known  = true;
                selected_lwt_tenths = in.post_buh_tenths;
            } else if ((in.buh_known && in.buh_on) || (cov.has_buh() && !in.buh_known)) {
                acc.pending.flags |= ENERGY_F_UNPAIRED_BUH;
                acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
                return;
            }
        } else {
            if (in.buh_known && !in.buh_on) {
                selected_lwt_known  = in.lwt_known;
                selected_lwt_tenths = in.lwt_tenths;
            } else {
                if ((in.buh_known && in.buh_on) || (cov.has_buh() && !in.buh_known))
                    acc.pending.flags |= ENERGY_F_UNPAIRED_BUH;
                acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
                return;
            }
        }
    } else {
        selected_lwt_known  = in.lwt_known;
        selected_lwt_tenths = in.lwt_tenths;
    }

    // 5. Thermal standstill gate & signed dT (captures defrost withdrawal & valve transients).
    if (!in.flow_known || !in.rwt_known || !selected_lwt_known) {
        acc.pending.unpairable_s = checkup_add_u16(acc.pending.unpairable_s, dt);
        return;
    }

    // When an X10A profile lacks an RPS witness (e.g., 17 X10A tables with CT metering), pump-only
    // standby can draw ~10-80 W; require >= 150 W (above pump/PCB draw) or active BUH to treat
    // flow as active thermal generation instead of standby drift. Modbus always requires RPS.
    const bool heat_active =
        cov.is_modbus ? (in.rps_known && in.rps_running)
                      : ((cov.has_rps ? (in.rps_known && in.rps_running)
                                      : (in.rps_known ? in.rps_running : (pel_w >= 150.0))) ||
                         (!is_compressor_only && in.buh_known && in.buh_on));

    // 6. Accumulate energy, auxiliary runtime & outdoor context.
    acc.pending.pel_kind   = static_cast<uint8_t>(pel_kind);
    acc.pending.observed_s = checkup_add_u16(acc.pending.observed_s, dt);

    if (is_compressor_only) {
        if (in.buh_known && in.buh_on) acc.pending.flags |= ENERGY_F_LIMITED_BUH;
        if (in.bsh_known && in.bsh_on) acc.pending.flags |= ENERGY_F_LIMITED_BUH;
    }
    if (cov.is_modbus && heat_active && in.flow_tenths > 5 && in.post_buh_known &&
        (in.post_buh_tenths - in.lwt_tenths) > WORKING_FIGURE_MODBUS_BUH_DELTA_TENTHS) {
        acc.pending.flags |= ENERGY_F_LIMITED_BUH;
    }

    if (heat_active && in.flow_tenths > 5 && dt > 0) {
        const int64_t dt_tenths =
            static_cast<int64_t>(selected_lwt_tenths) - static_cast<int64_t>(in.rwt_tenths);
        const int64_t abs_dt = dt_tenths < 0 ? -dt_tenths : dt_tenths;
        const int64_t flow_k =
            static_cast<int64_t>(in.flow_tenths) * 4186LL * static_cast<int64_t>(dt);
        // Guard against signed int64 overflow on malformed/extreme synthetic test inputs.
        int64_t delta_ws = 0;
        if (abs_dt > 0) {
            if (flow_k > (INT64_MAX - 3000LL) / abs_dt) {
                delta_ws = dt_tenths > 0 ? INT32_MAX : INT32_MIN;
            } else {
                const int64_t num = flow_k * dt_tenths;
                delta_ws = (num >= 0) ? ((num + 3000LL) / 6000LL) : ((num - 3000LL) / 6000LL);
            }
        }
        const int64_t sum   = static_cast<int64_t>(acc.pending.heat_ws) + delta_ws;
        acc.pending.heat_ws = static_cast<int32_t>(std::clamp<int64_t>(sum, INT32_MIN, INT32_MAX));
    }

    const double elec_delta_d = pel_w * static_cast<double>(dt);
    if (std::isfinite(elec_delta_d) && elec_delta_d >= 0.0) {
        if (elec_delta_d >= static_cast<double>(UINT32_MAX)) {
            acc.pending.elec_ws = UINT32_MAX;
        } else {
            const uint64_t delta_u64 = static_cast<uint64_t>(elec_delta_d + 0.5);
            if (delta_u64 > 0) {
                const uint64_t sum  = static_cast<uint64_t>(acc.pending.elec_ws) + delta_u64;
                acc.pending.elec_ws = sum > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(sum);
            }
        }
    }

    if (in.defrost_known && in.defrost_on)
        acc.pending.defrost_s = checkup_add_u16(acc.pending.defrost_s, dt);
    if (!cov.is_modbus && in.buh_known && in.buh_on)
        acc.pending.buh_s = checkup_add_u16(acc.pending.buh_s, dt);

    if (dt > 0 && in.rps_known && in.rps_running && in.outdoor_known &&
        in.outdoor_tenths >= -3276 && in.outdoor_tenths <= 3276 &&
        acc.pending.outdoor_samples < UINT16_MAX) {
        const int16_t ot = static_cast<int16_t>(in.outdoor_tenths);
        acc.pending.outdoor_sum_tenths += in.outdoor_tenths;
        acc.pending.outdoor_samples++;
        if (acc.pending.outdoor_samples == 1 || ot < acc.pending.outdoor_min_tenths)
            acc.pending.outdoor_min_tenths = ot;
    }
}

struct WorkingFigureTariffs {
    uint32_t elec_price_tenth_mill = 0; // 1e-4 currency/kWh; 0 = unconfigured
    uint32_t gas_price_tenth_mill  = 0; // 1e-4 currency/kWh; 0 = unconfigured
    char     currency[4]           = "EUR";
};

enum class WorkingFigureState : uint8_t {
    Unsupported   = 0,
    Collecting    = 1,
    Standby       = 2,
    Partial       = 3,
    Limited       = 4,
    Cheaper       = 5,
    Similar       = 6,
    MoreExpensive = 7,
    Measured      = 8,
};

inline constexpr const char* working_figure_state_name(WorkingFigureState s) noexcept {
    switch (s) {
    case WorkingFigureState::Unsupported:
        return "unsupported";
    case WorkingFigureState::Collecting:
        return "collecting";
    case WorkingFigureState::Standby:
        return "standby";
    case WorkingFigureState::Partial:
        return "partial";
    case WorkingFigureState::Limited:
        return "limited";
    case WorkingFigureState::Cheaper:
        return "cheaper";
    case WorkingFigureState::Similar:
        return "similar";
    case WorkingFigureState::MoreExpensive:
        return "more_expensive";
    case WorkingFigureState::Measured:
        return "measured";
    }
    return "unsupported";
}

// `cost_delta` and `cost_delta_pct` use heat-pump minus gas-baseline (`cost_wp - cost_gas`), so
// negative values mean the heat pump cost less than gas and positive values mean more expensive.
struct WorkingFigureReport {
    bool               supported             = false;
    bool               tariffs_configured    = false;
    bool               full_window           = false;
    bool               source_fresh          = false;
    bool               is_estimate           = true;
    bool               is_compressor_only    = false;
    WorkingFigureState state                 = WorkingFigureState::Unsupported;
    EnergyPelKind      pel_kind              = EnergyPelKind::None;
    uint32_t           span_s                = 0;
    uint32_t           observed_s            = 0;
    uint32_t           unpairable_s          = 0;
    uint32_t           defrost_s             = 0;
    uint32_t           buh_s                 = 0;
    uint32_t           bsh_excluded_s        = 0;
    uint32_t           cooling_excluded_s    = 0;
    uint8_t            coverage_pct          = 0;
    uint8_t            neutral_band_pct      = 20;
    uint8_t            gas_efficiency_pct    = GAS_EFFICIENCY_PCT;
    uint32_t           elec_price_tenth_mill = 0;
    uint32_t           gas_price_tenth_mill  = 0;
    char               currency[4]           = "EUR";
    double             heat_kwh              = 0.0;
    double             elec_kwh              = 0.0;
    double             gas_equiv_kwh         = 0.0;
    double             az                    = 0.0;
    double             break_even_az         = 0.0;
    double             cost_wp               = 0.0;
    double             cost_gas              = 0.0;
    double             cost_delta            = 0.0;
    double             cost_delta_pct        = 0.0;
    bool               has_outdoor           = false;
    double             outdoor_mean_c        = 0.0;
    double             outdoor_min_c         = 0.0;
    uint8_t            flags                 = 0;
};

inline uint32_t energy_span_s(const EnergyAccumulator& acc, int64_t carried_span_us,
                              int64_t now_us) noexcept {
    int64_t live_us = acc.live_span_us();
    if (acc.first_sample_us >= 0 && now_us >= acc.first_sample_us &&
        now_us - acc.first_sample_us > live_us)
        live_us = now_us - acc.first_sample_us;
    const int64_t total_s = (live_us + std::max<int64_t>(0, carried_span_us)) / 1000000LL;
    return static_cast<uint32_t>(
        std::min<int64_t>(CHECKUP_WINDOW_S, std::max<int64_t>(0, total_s)));
}

inline WorkingFigureReport
working_figure_evaluate(const EnergyRing& ring, const EnergyAccumulator& acc,
                        const EnergyCoverage& cov, const WorkingFigureTariffs& tariffs,
                        bool source_fresh, uint32_t span_s, const int64_t* slot_expiry_us = nullptr,
                        int64_t now_us = -1) noexcept {
    WorkingFigureReport r;
    const bool          ct_unwired_dead =
        !cov.is_modbus && acc.ct_state == CtWireState::Unwired && !(cov.has_inv && cov.has_rps);
    r.supported    = cov.supported() && !ct_unwired_dead;
    r.source_fresh = source_fresh;
    r.span_s       = std::min<uint32_t>(span_s, CHECKUP_WINDOW_S);

    if (r.supported) {
        if (cov.is_modbus) {
            r.pel_kind = EnergyPelKind::Modbus;
        } else if (cov.ct_rows > 0 && acc.ct_state != CtWireState::Unwired) {
            r.pel_kind = EnergyPelKind::X10aCt;
        } else if (cov.has_inv && cov.has_rps) {
            r.pel_kind = EnergyPelKind::X10aInv;
        }
    }
    r.is_estimate        = true;
    r.is_compressor_only = (r.pel_kind == EnergyPelKind::X10aInv);
    r.neutral_band_pct   = 20;

    int64_t  heat_ws_sum     = 0;
    uint64_t elec_ws_sum     = 0;
    int64_t  outdoor_sum     = 0;
    uint32_t outdoor_samples = 0;
    int16_t  outdoor_min     = INT16_MAX;

    auto fold = [&](const EnergyBucket& b) {
        heat_ws_sum += static_cast<int64_t>(b.heat_ws);
        elec_ws_sum += static_cast<uint64_t>(b.elec_ws);
        r.observed_s += b.observed_s;
        r.unpairable_s += b.unpairable_s;
        r.defrost_s += b.defrost_s;
        r.buh_s += b.buh_s;
        r.bsh_excluded_s += b.bsh_excluded_s;
        r.cooling_excluded_s += b.cooling_excluded_s;
        r.flags = static_cast<uint8_t>(r.flags | b.flags);
        if (b.outdoor_samples > 0) {
            outdoor_sum += static_cast<int64_t>(b.outdoor_sum_tenths);
            outdoor_samples += b.outdoor_samples;
            if (outdoor_min == INT16_MAX || b.outdoor_min_tenths < outdoor_min)
                outdoor_min = b.outdoor_min_tenths;
        }
    };

    const size_t oldest = ring.count < CHECKUP_COMPLETED_BUCKETS ? 0 : ring.head;
    for (size_t i = 0; i < ring.count && i < CHECKUP_COMPLETED_BUCKETS; ++i) {
        const size_t idx = (oldest + i) % CHECKUP_COMPLETED_BUCKETS;
        if (slot_expiry_us) {
            const int64_t exp = slot_expiry_us[idx];
            if (exp < 0 || (exp > 0 && now_us >= 0 && now_us >= exp)) continue;
        }
        fold(ring.buf[idx]);
    }
    fold(acc.pending);
    if (acc.ct_state == CtWireState::Unwired) r.flags |= ENERGY_F_CT_UNWIRED;

    r.coverage_pct = static_cast<uint8_t>(
        std::min<uint64_t>(100ULL, (static_cast<uint64_t>(r.observed_s) * 100ULL) /
                                       static_cast<uint64_t>(CHECKUP_WINDOW_S)));
    r.full_window =
        (r.span_s >= CHECKUP_WINDOW_S && r.observed_s >= WORKING_FIGURE_FULL_OBSERVED_S);

    r.heat_kwh = static_cast<double>(heat_ws_sum) / 3600000.0;
    r.elec_kwh = static_cast<double>(elec_ws_sum) / 3600000.0;
    r.az       = (elec_ws_sum > 0 && heat_ws_sum > 0)
                     ? (static_cast<double>(heat_ws_sum) / static_cast<double>(elec_ws_sum))
                     : 0.0;

    if (outdoor_samples > 0) {
        r.has_outdoor = true;
        r.outdoor_mean_c =
            (static_cast<double>(outdoor_sum) / static_cast<double>(outdoor_samples)) * 0.1;
        r.outdoor_min_c = static_cast<double>(outdoor_min) * 0.1;
    }

    r.elec_price_tenth_mill = tariffs.elec_price_tenth_mill;
    r.gas_price_tenth_mill  = tariffs.gas_price_tenth_mill;
    r.gas_efficiency_pct    = GAS_EFFICIENCY_PCT;
    if (tariff_currency_valid(tariffs.currency)) {
        std::memcpy(r.currency, tariffs.currency, 3);
        r.currency[3] = '\0';
    } else {
        std::memcpy(r.currency, "EUR", 4);
    }

    r.tariffs_configured = (tariffs.elec_price_tenth_mill > 0 && tariffs.gas_price_tenth_mill > 0 &&
                            gas_comparison_config_valid(tariffs.elec_price_tenth_mill,
                                                        tariffs.gas_price_tenth_mill, r.currency));
    if (r.tariffs_configured) {
        const double elec_price        = static_cast<double>(tariffs.elec_price_tenth_mill) * 1e-4;
        const double gas_price         = static_cast<double>(tariffs.gas_price_tenth_mill) * 1e-4;
        const double gas_eff           = static_cast<double>(GAS_EFFICIENCY_PCT) / 100.0;
        const double positive_heat_kwh = r.heat_kwh > 0.0 ? r.heat_kwh : 0.0;
        r.break_even_az                = (elec_price * gas_eff) / gas_price;
        r.gas_equiv_kwh                = positive_heat_kwh / gas_eff;
        r.cost_wp                      = r.elec_kwh * elec_price;
        r.cost_gas                     = r.gas_equiv_kwh * gas_price;
        r.cost_delta                   = r.cost_wp - r.cost_gas;
        r.cost_delta_pct = (r.cost_gas > 0.0) ? (r.cost_delta / r.cost_gas) * 100.0 : 0.0;
    }

    const bool limited =
        (r.bsh_excluded_s > 0) || ((r.flags & (ENERGY_F_LIMITED_BUH | ENERGY_F_UNPAIRED_BUH)) != 0);
    if (!r.supported) {
        r.state = WorkingFigureState::Unsupported;
    } else if (r.observed_s < WORKING_FIGURE_MIN_OBSERVED_S) {
        r.state = WorkingFigureState::Collecting;
    } else if (heat_ws_sum < static_cast<int64_t>(WORKING_FIGURE_MIN_HEAT_WH) * 3600LL ||
               elec_ws_sum < static_cast<uint64_t>(WORKING_FIGURE_MIN_ELEC_WH) * 3600ULL) {
        r.state = WorkingFigureState::Standby;
    } else if (!r.full_window) {
        r.state = WorkingFigureState::Partial;
    } else if (limited) {
        r.state = WorkingFigureState::Limited;
    } else if (!r.tariffs_configured) {
        r.state = WorkingFigureState::Measured;
    } else {
        const double band = 0.20;
        if (r.az > r.break_even_az * (1.0 + band)) {
            r.state = WorkingFigureState::Cheaper;
        } else if (r.az < r.break_even_az * (1.0 - band)) {
            r.state = WorkingFigureState::MoreExpensive;
        } else {
            r.state = WorkingFigureState::Similar;
        }
    }
    return r;
}

} // namespace daik::logic

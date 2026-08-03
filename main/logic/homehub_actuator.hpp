#pragma once
// HomeHub WP3 actuation policy (#300). Pure + IDF-free: the device wrapper owns the socket and
// calls this fixed-size state machine; host tests exercise every safety gate without a heat pump.
//
// The public intent is deliberately DOMAIN-TYPED. It carries an LWT offset, never a Modbus address
// or function code, so MQTT/HTTP/MCP code cannot turn this into a generic register-write proxy.
// The only wire descriptor admitted by this slice is EKRHH holding register 54 (PDU address 53),
// Int16, -10..+10 K. Later descriptors must be added here with their own range and restore policy.
#include <cstdint>
#include <type_traits>

#include "modbus.hpp"

namespace daik::logic {

inline constexpr uint8_t  HOMEHUB_ACTUATION_SCHEMA_VERSION = 1;
inline constexpr uint16_t HOMEHUB_LWT_OFFSET_REGISTER       = 54;  // EKRHH 1-based offset
inline constexpr uint16_t HOMEHUB_LWT_OFFSET_PDU            = 53;  // Modbus 0-based address
inline constexpr int16_t  HOMEHUB_LWT_OFFSET_MIN_K          = -10;
inline constexpr int16_t  HOMEHUB_LWT_OFFSET_MAX_K          = 10;
inline constexpr uint32_t HOMEHUB_INTENT_TTL_MIN_MS         = 1000;
inline constexpr uint32_t HOMEHUB_INTENT_TTL_MAX_MS         = 300000;

enum class ActuatorRefreshPolicy : uint8_t { OnChange = 0 };
enum class ActuatorRestorePolicy : uint8_t { BaselineOnExit = 0 };

struct HomeHubWritableDescriptor {
    uint16_t register_offset;
    uint16_t pdu_address;
    MbFunc   space;
    MbType   type;
    int16_t  minimum;
    int16_t  maximum;
    int16_t  step;
    ActuatorRefreshPolicy refresh;
    ActuatorRestorePolicy restore;
};

inline constexpr HomeHubWritableDescriptor HOMEHUB_LWT_OFFSET_DESCRIPTOR = {
    HOMEHUB_LWT_OFFSET_REGISTER, HOMEHUB_LWT_OFFSET_PDU, MbFunc::ReadHolding,
    MbType::Int16, HOMEHUB_LWT_OFFSET_MIN_K, HOMEHUB_LWT_OFFSET_MAX_K, 1,
    ActuatorRefreshPolicy::OnChange, ActuatorRestorePolicy::BaselineOnExit,
};

inline constexpr bool homehub_actuation_allowlisted(uint16_t register_offset, MbFunc space,
                                                     MbType type) {
    return register_offset == HOMEHUB_LWT_OFFSET_DESCRIPTOR.register_offset &&
           space == HOMEHUB_LWT_OFFSET_DESCRIPTOR.space &&
           type == HOMEHUB_LWT_OFFSET_DESCRIPTOR.type;
}

enum class ActuatorSource : uint8_t {
    InternalController = 1,
    Evcc               = 2,
};

// Larger wins. A source cannot choose its own priority: actuator_source_priority() is the single
// versioned arbitration table. Restore/failsafe is outside this table and always preempts intents.
inline constexpr uint8_t actuator_source_priority(ActuatorSource source) {
    return source == ActuatorSource::InternalController ? 100 :
           source == ActuatorSource::Evcc               ? 50 : 0;
}

inline const char* actuator_source_name(ActuatorSource source) {
    switch (source) {
        case ActuatorSource::InternalController: return "internal_controller";
        case ActuatorSource::Evcc:               return "evcc";
    }
    return "unknown";
}

struct LwtOffsetIntent {
    uint8_t        schema_version = HOMEHUB_ACTUATION_SCHEMA_VERSION;
    ActuatorSource source         = ActuatorSource::InternalController;
    int16_t        offset_k       = 0;
    uint32_t       sequence       = 0;      // source-local, monotonically increasing
    int64_t        issued_ms      = 0;      // monotonic timestamp in the firmware clock domain
    uint32_t       ttl_ms         = 30000;
    uint32_t       correlation_id = 0;      // fixed numeric id; 0 means the producer supplied none
};

// Versioned, fixed-size contract for the future evcc MQTT adapter. WP3 defines and validates it but
// intentionally does not subscribe to a command topic or route it to registers 56-58. `arrival_ms`
// is stamped by the firmware on receipt; source_time/expires_at are producer wall-clock times.
enum class EvccIntentKind : uint8_t {
    SmartGridMode         = 1,
    RecommendedPowerLimit = 2,
    GeneralPowerLimit     = 3,
};

struct EvccIntentEnvelope {
    uint8_t        schema_version = HOMEHUB_ACTUATION_SCHEMA_VERSION;
    ActuatorSource source         = ActuatorSource::Evcc;
    EvccIntentKind kind           = EvccIntentKind::SmartGridMode;
    bool           retained       = false;
    int64_t        source_time_ms = -1;
    int64_t        arrival_ms     = -1;
    int64_t        expires_at_ms  = -1;
    uint32_t       max_age_ms     = 30000;
    uint32_t       sequence       = 0;
    uint32_t       correlation_id = 0;
    int32_t        requested      = 0;  // mode 0..3, or non-negative whole watts
};

enum class EvccIntentVerdict : uint8_t {
    Accept          = 0,
    Retained        = 1,
    InvalidSchema   = 2,
    InvalidSource   = 3,
    InvalidTime     = 4,
    Stale           = 5,
    Expired         = 6,
    InvalidRequest  = 7,
    MissingCorrelation = 8,
};

inline EvccIntentVerdict validate_evcc_intent(const EvccIntentEnvelope& i,
                                               int64_t now_wall_ms) {
    if (i.retained) return EvccIntentVerdict::Retained;
    if (i.schema_version != HOMEHUB_ACTUATION_SCHEMA_VERSION)
        return EvccIntentVerdict::InvalidSchema;
    if (i.source != ActuatorSource::Evcc) return EvccIntentVerdict::InvalidSource;
    if (i.correlation_id == 0) return EvccIntentVerdict::MissingCorrelation;
    if (i.max_age_ms < HOMEHUB_INTENT_TTL_MIN_MS || i.max_age_ms > HOMEHUB_INTENT_TTL_MAX_MS ||
        i.source_time_ms < 0 || i.arrival_ms < 0 || i.expires_at_ms < 0 ||
        now_wall_ms < i.source_time_ms || i.arrival_ms < i.source_time_ms ||
        now_wall_ms < i.arrival_ms || i.expires_at_ms < i.source_time_ms)
        return EvccIntentVerdict::InvalidTime;
    if (static_cast<uint64_t>(now_wall_ms - i.source_time_ms) > i.max_age_ms)
        return EvccIntentVerdict::Stale;
    if (now_wall_ms > i.expires_at_ms) return EvccIntentVerdict::Expired;
    if (i.kind == EvccIntentKind::SmartGridMode)
        return i.requested >= 0 && i.requested <= 3 ? EvccIntentVerdict::Accept
                                                    : EvccIntentVerdict::InvalidRequest;
    if (i.kind == EvccIntentKind::RecommendedPowerLimit ||
        i.kind == EvccIntentKind::GeneralPowerLimit)
        return i.requested >= 0 ? EvccIntentVerdict::Accept : EvccIntentVerdict::InvalidRequest;
    return EvccIntentVerdict::InvalidRequest;
}

enum class ActuatorPriorityLayer : uint8_t {
    EvccEnergyIntent = 50,
    RoomLwtControl   = 100,
    DaikinConstraint = 200,
    SafetyFailsafe   = 255,
};

enum class ActuatorWriterOwnership : uint8_t {
    Unresolved     = 0,  // boot default: no write can leave the device
    Firmware       = 1,  // the hp_modbus task is the one logical writer
    ExternalDirect = 2,  // migration not complete; direct HomeHub writer still exists
};

enum class ActuatorState : uint8_t {
    Off            = 0,
    Idle           = 1,
    Pending        = 2,
    Ready          = 3,
    Writing        = 4,
    Confirmed      = 5,
    RestorePending = 6,
    Restoring      = 7,
    Restored       = 8,
    Blocked        = 9,
    Conflict       = 10,
    Failed         = 11,
};

enum class ActuatorBlock : uint8_t {
    None                = 0,
    Disabled            = 1,
    Disconnected        = 2,
    NotAllowlisted      = 3,
    OutOfRange          = 4,
    StaleIntent         = 5,
    NoFreshRead         = 6,
    OwnershipUnresolved = 7,
    OwnershipExternal   = 8,
    InvalidSchema       = 9,
    InvalidTtl          = 10,
    LowerPriority       = 11,
    SpecialRead         = 12,
    ExternalChange      = 13,
    TransportFailure    = 14,
    EchoMismatch        = 15,
    ReadbackMismatch    = 16,
    RestoreUnavailable  = 17,
    OutOfOrder           = 18,
};

enum class ActuatorOffer : uint8_t {
    Queued    = 0,
    Coalesced = 1,
    Rejected  = 2,
};

enum class ActuatorAction : uint8_t {
    None    = 0,
    Write   = 1,
    Restore = 2,
};

inline const char* actuator_state_name(ActuatorState state) {
    switch (state) {
        case ActuatorState::Off:            return "off";
        case ActuatorState::Idle:           return "idle";
        case ActuatorState::Pending:        return "pending";
        case ActuatorState::Ready:          return "ready";
        case ActuatorState::Writing:        return "writing";
        case ActuatorState::Confirmed:      return "confirmed";
        case ActuatorState::RestorePending: return "restore_pending";
        case ActuatorState::Restoring:      return "restoring";
        case ActuatorState::Restored:       return "restored";
        case ActuatorState::Blocked:        return "blocked";
        case ActuatorState::Conflict:       return "conflict";
        case ActuatorState::Failed:         return "failed";
    }
    return "unknown";
}

inline const char* actuator_block_name(ActuatorBlock reason) {
    switch (reason) {
        case ActuatorBlock::None:                return "none";
        case ActuatorBlock::Disabled:            return "disabled";
        case ActuatorBlock::Disconnected:        return "disconnected";
        case ActuatorBlock::NotAllowlisted:      return "not_allowlisted";
        case ActuatorBlock::OutOfRange:          return "out_of_range";
        case ActuatorBlock::StaleIntent:         return "stale_intent";
        case ActuatorBlock::NoFreshRead:         return "no_fresh_read";
        case ActuatorBlock::OwnershipUnresolved: return "ownership_unresolved";
        case ActuatorBlock::OwnershipExternal:   return "ownership_external";
        case ActuatorBlock::InvalidSchema:       return "invalid_schema";
        case ActuatorBlock::InvalidTtl:          return "invalid_ttl";
        case ActuatorBlock::LowerPriority:       return "lower_priority";
        case ActuatorBlock::SpecialRead:         return "special_read";
        case ActuatorBlock::ExternalChange:      return "external_change";
        case ActuatorBlock::TransportFailure:    return "transport_failure";
        case ActuatorBlock::EchoMismatch:        return "echo_mismatch";
        case ActuatorBlock::ReadbackMismatch:    return "readback_mismatch";
        case ActuatorBlock::RestoreUnavailable:  return "restore_unavailable";
        case ActuatorBlock::OutOfOrder:           return "out_of_order";
    }
    return "unknown";
}

inline const char* actuator_ownership_name(ActuatorWriterOwnership owner) {
    switch (owner) {
        case ActuatorWriterOwnership::Unresolved:     return "unresolved";
        case ActuatorWriterOwnership::Firmware:       return "firmware";
        case ActuatorWriterOwnership::ExternalDirect: return "external_direct";
    }
    return "unknown";
}

struct ActuatorPlan {
    ActuatorAction action     = ActuatorAction::None;
    uint16_t       register_offset = 0;
    uint16_t       pdu_address     = 0;
    uint16_t       target_raw      = 0;
    uint32_t       sequence        = 0;
};

struct ActuatorSnapshot {
    ActuatorState           state     = ActuatorState::Off;
    ActuatorBlock           blocked   = ActuatorBlock::Disabled;
    ActuatorWriterOwnership ownership = ActuatorWriterOwnership::Unresolved;

    bool pending         = false;
    bool restore_pending = false;
    bool conflict        = false;
    bool transaction_active = false;

    bool    baseline_valid  = false;
    int16_t baseline_k      = 0;
    bool    requested_valid = false;
    int16_t requested_k     = 0;
    bool    echoed_valid    = false;
    int16_t echoed_k        = 0;
    bool    confirmed_valid = false;
    int16_t confirmed_k     = 0;
    bool    effective_valid = false;
    int16_t effective_k     = 0;
    bool    plant_gate_known  = false;
    bool    plant_gate_active = false;

    ActuatorSource source = ActuatorSource::InternalController;
    uint32_t sequence = 0;
    uint32_t correlation_id = 0;
    int64_t  source_time_ms = -1;
    int64_t  arrival_ms = -1;
    int64_t  intent_age_ms = -1;
    int64_t  last_decision_ms = -1;
    int64_t  last_attempt_ms = -1;
    int64_t  last_write_ms = -1;
    int64_t  last_readback_ms = -1;
    int64_t  last_restore_ms = -1;

    uint32_t requests       = 0;
    uint32_t queued         = 0;
    uint32_t accepted       = 0;  // passed fresh pre-read and became a wire/no-op plan
    uint32_t rejected       = 0;
    uint32_t coalesced      = 0;
    uint32_t noops          = 0;
    uint32_t write_attempts = 0;
    uint32_t echo_confirmed = 0;
    uint32_t readback_confirmed = 0;
    uint32_t write_failures = 0;
    uint32_t conflicts      = 0;
    uint32_t restore_attempts = 0;
    uint32_t restores         = 0;
    uint32_t restore_failures = 0;
    uint32_t refreshes        = 0;  // OnChange policy: remains zero until a future descriptor says otherwise
};

class HomeHubActuator {
public:
    const ActuatorSnapshot& snapshot() const { return s_; }

    void set_ownership(ActuatorWriterOwnership owner) {
        s_.ownership = owner;
        if (owner == ActuatorWriterOwnership::Firmware && s_.state == ActuatorState::Off) {
            s_.state = ActuatorState::Idle;
            s_.blocked = ActuatorBlock::None;
        }
    }

    void set_enabled(bool enabled) {
        if (enabled) {
            if (s_.state == ActuatorState::Off && !s_.conflict) s_.state = ActuatorState::Idle;
            if (s_.blocked == ActuatorBlock::Disabled) s_.blocked = ActuatorBlock::None;
            return;
        }
        pending_valid_ = false;
        s_.pending = false;
        if (s_.transaction_active || inflight_) request_restore();
        else if (!s_.conflict) {
            s_.state = ActuatorState::Off;
            s_.blocked = ActuatorBlock::Disabled;
        }
    }

    ActuatorOffer offer(const LwtOffsetIntent& intent, bool enabled, bool connected,
                        int64_t now_ms) {
        s_.requests++;
        s_.requested_valid = true;
        s_.requested_k = intent.offset_k;
        s_.source = intent.source;
        s_.sequence = intent.sequence;
        s_.correlation_id = intent.correlation_id;
        s_.source_time_ms = intent.issued_ms;
        s_.arrival_ms = now_ms;
        s_.intent_age_ms = now_ms >= intent.issued_ms ? now_ms - intent.issued_ms : -1;
        s_.last_decision_ms = now_ms;
        ActuatorBlock rejected = ActuatorBlock::None;
        if (intent.schema_version != HOMEHUB_ACTUATION_SCHEMA_VERSION)
            rejected = ActuatorBlock::InvalidSchema;
        else if (actuator_source_priority(intent.source) == 0)
            rejected = ActuatorBlock::InvalidSchema;
        else if (intent.ttl_ms < HOMEHUB_INTENT_TTL_MIN_MS ||
                 intent.ttl_ms > HOMEHUB_INTENT_TTL_MAX_MS)
            rejected = ActuatorBlock::InvalidTtl;
        else if (intent.offset_k < HOMEHUB_LWT_OFFSET_MIN_K ||
                 intent.offset_k > HOMEHUB_LWT_OFFSET_MAX_K)
            rejected = ActuatorBlock::OutOfRange;
        else if (!intent_fresh(intent, now_ms))
            rejected = ActuatorBlock::StaleIntent;
        else if (!enabled)
            rejected = ActuatorBlock::Disabled;
        else if (!connected)
            rejected = ActuatorBlock::Disconnected;
        else if (s_.ownership == ActuatorWriterOwnership::Unresolved)
            rejected = ActuatorBlock::OwnershipUnresolved;
        else if (s_.ownership != ActuatorWriterOwnership::Firmware)
            rejected = ActuatorBlock::OwnershipExternal;
        else if (s_.conflict)
            rejected = ActuatorBlock::ExternalChange;
        else if (pending_valid_ &&
                 actuator_source_priority(intent.source) <
                 actuator_source_priority(pending_.source))
            rejected = ActuatorBlock::LowerPriority;
        else if (!sequence_is_new(intent.source, intent.sequence))
            rejected = ActuatorBlock::OutOfOrder;

        if (rejected != ActuatorBlock::None) {
            block(rejected);
            return ActuatorOffer::Rejected;
        }

        const bool coalesced = pending_valid_;
        pending_ = intent;
        pending_valid_ = true;
        remember_sequence(intent.source, intent.sequence);
        s_.pending = true;
        s_.restore_pending = false;
        s_.state = ActuatorState::Pending;
        s_.blocked = ActuatorBlock::None;
        s_.queued++;
        if (coalesced) s_.coalesced++;
        return coalesced ? ActuatorOffer::Coalesced : ActuatorOffer::Queued;
    }

    // Called immediately after a dedicated FC03 pre-read of holding 54. A cached poll value is not
    // accepted here: fresh_read_ok must describe that request-local baseline read.
    ActuatorPlan prepare_pending(bool enabled, bool connected, int64_t now_ms,
                                 bool fresh_read_ok, uint16_t current_raw) {
        if (!pending_valid_) return ActuatorPlan{};
        s_.last_decision_ms = now_ms;
        s_.intent_age_ms = now_ms >= pending_.issued_ms ? now_ms - pending_.issued_ms : -1;
        if (!enabled) return reject_pending(ActuatorBlock::Disabled);
        if (!connected) return reject_pending(ActuatorBlock::Disconnected);
        if (s_.ownership == ActuatorWriterOwnership::Unresolved)
            return reject_pending(ActuatorBlock::OwnershipUnresolved);
        if (s_.ownership != ActuatorWriterOwnership::Firmware)
            return reject_pending(ActuatorBlock::OwnershipExternal);
        if (!intent_fresh(pending_, now_ms)) return reject_pending(ActuatorBlock::StaleIntent);
        if (!fresh_read_ok) return reject_pending(ActuatorBlock::NoFreshRead);
        if (mb_is_special(current_raw)) return reject_pending(ActuatorBlock::SpecialRead);

        observe_raw(current_raw);
        if (s_.transaction_active && s_.confirmed_valid &&
            current_raw != encode(s_.confirmed_k)) {
            conflict(ActuatorBlock::ExternalChange);
            pending_valid_ = false;
            s_.pending = false;
            return ActuatorPlan{};
        }
        if (!s_.baseline_valid || !s_.transaction_active) {
            s_.baseline_valid = true;
            s_.baseline_k = decode(current_raw);
        }

        const uint16_t target = encode(pending_.offset_k);
        const uint32_t sequence = pending_.sequence;
        pending_valid_ = false;
        s_.pending = false;
        s_.accepted++;
        if (current_raw == target) {
            s_.noops++;
            s_.confirmed_valid = true;
            s_.confirmed_k = decode(current_raw);
            s_.transaction_active = current_raw != encode(s_.baseline_k);
            s_.state = ActuatorState::Confirmed;
            s_.blocked = ActuatorBlock::None;
            return ActuatorPlan{};
        }
        inflight_ = true;
        inflight_action_ = ActuatorAction::Write;
        inflight_target_ = target;
        s_.echoed_valid = false;
        s_.state = ActuatorState::Ready;
        s_.blocked = ActuatorBlock::None;
        return ActuatorPlan{ActuatorAction::Write, HOMEHUB_LWT_OFFSET_REGISTER,
                            HOMEHUB_LWT_OFFSET_PDU, target, sequence};
    }

    void request_restore(int64_t now_ms = -1) {
        pending_valid_ = false;
        s_.pending = false;
        if (!s_.baseline_valid || (!s_.transaction_active && !inflight_)) return;
        s_.restore_pending = true;
        s_.state = ActuatorState::RestorePending;
        if (now_ms >= 0) s_.last_decision_ms = now_ms;
    }

    // The task is about to lose the only socket that could restore this transaction (target change
    // or orderly stop). Preserve the unsafe/unknown fact and prevent later writes to another hub.
    void mark_restore_unavailable() {
        if (!s_.transaction_active && !inflight_ && !s_.restore_pending) return;
        conflict(ActuatorBlock::RestoreUnavailable);
    }

    ActuatorPlan prepare_restore(bool connected, bool fresh_read_ok, uint16_t current_raw,
                                 int64_t now_ms = -1) {
        if (!s_.restore_pending) return ActuatorPlan{};
        if (now_ms >= 0) s_.last_decision_ms = now_ms;
        if (s_.ownership != ActuatorWriterOwnership::Firmware) {
            restore_failed(s_.ownership == ActuatorWriterOwnership::Unresolved
                               ? ActuatorBlock::OwnershipUnresolved
                               : ActuatorBlock::OwnershipExternal);
            return ActuatorPlan{};
        }
        if (!connected) {
            restore_failed(ActuatorBlock::RestoreUnavailable);
            return ActuatorPlan{};
        }
        if (!fresh_read_ok) {
            restore_failed(ActuatorBlock::NoFreshRead);
            return ActuatorPlan{};
        }
        if (mb_is_special(current_raw)) {
            restore_failed(ActuatorBlock::SpecialRead);
            return ActuatorPlan{};
        }
        observe_raw(current_raw);
        const uint16_t baseline = encode(s_.baseline_k);
        if (current_raw == baseline) {
            s_.restore_pending = false;
            s_.transaction_active = false;
            inflight_ = false;
            s_.confirmed_valid = true;
            s_.confirmed_k = s_.baseline_k;
            s_.state = ActuatorState::Restored;
            s_.blocked = ActuatorBlock::None;
            s_.restores++;
            if (now_ms >= 0) s_.last_restore_ms = now_ms;
            return ActuatorPlan{};
        }
        // Restore only a value that this state machine can attribute to its own last attempt. Any
        // third value is an external writer; fighting it would violate the single-writer contract.
        const bool ours = (s_.confirmed_valid && current_raw == encode(s_.confirmed_k)) ||
                          (inflight_ && current_raw == inflight_target_);
        if (!ours) {
            conflict(ActuatorBlock::ExternalChange);
            return ActuatorPlan{};
        }
        inflight_ = true;
        inflight_action_ = ActuatorAction::Restore;
        inflight_target_ = baseline;
        s_.state = ActuatorState::Ready;
        s_.blocked = ActuatorBlock::None;
        return ActuatorPlan{ActuatorAction::Restore, HOMEHUB_LWT_OFFSET_REGISTER,
                            HOMEHUB_LWT_OFFSET_PDU, baseline, 0};
    }

    void note_write_started(const ActuatorPlan& plan, int64_t now_ms = -1) {
        if (!plan_matches(plan)) return;
        s_.write_attempts++;
        if (now_ms >= 0) s_.last_attempt_ms = now_ms;
        if (plan.action == ActuatorAction::Restore) {
            s_.restore_attempts++;
            s_.state = ActuatorState::Restoring;
        } else {
            s_.state = ActuatorState::Writing;
        }
    }

    bool note_echo(const ActuatorPlan& plan, uint16_t echoed_raw) {
        if (!plan_matches(plan) || echoed_raw != plan.target_raw) {
            conflict(ActuatorBlock::EchoMismatch);
            return false;
        }
        s_.echoed_valid = true;
        s_.echoed_k = decode(echoed_raw);
        s_.echo_confirmed++;
        return true;
    }

    void note_transport_failure(const ActuatorPlan& plan) {
        if (!plan_matches(plan)) return;
        s_.write_failures++;
        if (plan.action == ActuatorAction::Restore) s_.restore_failures++;
        s_.restore_pending = s_.baseline_valid;
        s_.state = ActuatorState::Failed;
        s_.blocked = ActuatorBlock::TransportFailure;
        // inflight_ remains true: after reconnect a fresh read may prove either baseline or target.
    }

    bool note_readback(const ActuatorPlan& plan, uint16_t readback_raw, int64_t now_ms = -1) {
        if (!plan_matches(plan) || mb_is_special(readback_raw) ||
            readback_raw != plan.target_raw) {
            conflict(ActuatorBlock::ReadbackMismatch);
            return false;
        }
        observe_raw(readback_raw);
        s_.confirmed_valid = true;
        s_.confirmed_k = decode(readback_raw);
        s_.readback_confirmed++;
        if (now_ms >= 0) s_.last_readback_ms = now_ms;
        s_.blocked = ActuatorBlock::None;
        if (plan.action == ActuatorAction::Restore) {
            s_.restore_pending = false;
            s_.transaction_active = false;
            s_.state = ActuatorState::Restored;
            s_.restores++;
            if (now_ms >= 0) s_.last_restore_ms = now_ms;
            inflight_ = false;
        } else {
            if (now_ms >= 0) s_.last_write_ms = now_ms;
            s_.transaction_active = readback_raw != encode(s_.baseline_k);
            s_.state = ActuatorState::Confirmed;
            inflight_ = false;
        }
        return true;
    }

    // Normal poll observation. It can detect another writer after our confirmed write, but it never
    // creates a baseline: only the request-local pre-read in prepare_pending() may do that.
    void observe_current(bool valid, uint16_t raw) {
        if (!valid || mb_is_special(raw)) return;
        observe_raw(raw);
        if (s_.transaction_active && !s_.restore_pending && s_.confirmed_valid &&
            raw != encode(s_.confirmed_k)) {
            conflict(ActuatorBlock::ExternalChange);
        }
    }

    void observe_plant_gate(bool known, bool active) {
        s_.plant_gate_known = known;
        s_.plant_gate_active = known && active;
        recompute_effective();
    }

private:
    static bool intent_fresh(const LwtOffsetIntent& intent, int64_t now_ms) {
        return intent.issued_ms >= 0 && now_ms >= intent.issued_ms &&
               static_cast<uint64_t>(now_ms - intent.issued_ms) <= intent.ttl_ms;
    }
    static uint16_t encode(int16_t value) { return static_cast<uint16_t>(value); }
    static int16_t decode(uint16_t raw) { return static_cast<int16_t>(raw); }
    bool sequence_is_new(ActuatorSource source, uint32_t sequence) const {
        const bool seen = source == ActuatorSource::InternalController ? have_internal_sequence_
                                                                       : have_evcc_sequence_;
        const uint32_t last = source == ActuatorSource::InternalController ? internal_sequence_
                                                                           : evcc_sequence_;
        if (!seen) return true;
        const uint32_t delta = sequence - last;
        return delta != 0 && delta < 0x80000000u;  // monotonic with ordinary uint32 wrap handling
    }
    void remember_sequence(ActuatorSource source, uint32_t sequence) {
        if (source == ActuatorSource::InternalController) {
            have_internal_sequence_ = true;
            internal_sequence_ = sequence;
        } else {
            have_evcc_sequence_ = true;
            evcc_sequence_ = sequence;
        }
    }

    void recompute_effective() {
        s_.effective_valid = s_.confirmed_valid && s_.plant_gate_known;
        if (s_.effective_valid)
            s_.effective_k = s_.plant_gate_active ? s_.confirmed_k : 0;
    }
    void observe_raw(uint16_t raw) {
        // An observation is not confirmation of a request, so confirmed_* stays untouched here.
        if (!s_.confirmed_valid && !s_.transaction_active) {
            // Expose an idle, known register value without mislabelling it as our confirmed write.
            s_.effective_valid = false;
        }
        (void)raw;
        recompute_effective();
    }
    ActuatorPlan reject_pending(ActuatorBlock reason) {
        pending_valid_ = false;
        s_.pending = false;
        block(reason);
        return ActuatorPlan{};
    }
    void block(ActuatorBlock reason) {
        s_.rejected++;
        s_.blocked = reason;
        if (!s_.transaction_active && !s_.conflict) s_.state = ActuatorState::Blocked;
    }
    void restore_failed(ActuatorBlock reason) {
        s_.restore_failures++;
        s_.blocked = reason;
        s_.state = ActuatorState::Failed;
        // Keep restore_pending true so an orderly caller can retry while the old socket still exists.
    }
    void conflict(ActuatorBlock reason) {
        pending_valid_ = false;
        s_.pending = false;
        s_.restore_pending = false;
        s_.conflict = true;
        s_.blocked = reason;
        s_.state = ActuatorState::Conflict;
        s_.conflicts++;
    }
    bool plan_matches(const ActuatorPlan& plan) const {
        return inflight_ && plan.action == inflight_action_ &&
               plan.register_offset == HOMEHUB_LWT_OFFSET_REGISTER &&
               plan.pdu_address == HOMEHUB_LWT_OFFSET_PDU &&
               plan.target_raw == inflight_target_;
    }

    ActuatorSnapshot s_{};
    LwtOffsetIntent  pending_{};        // the bounded, allocation-free one-slot coalescing mailbox
    bool             pending_valid_  = false;
    bool             inflight_       = false;
    ActuatorAction   inflight_action_ = ActuatorAction::None;
    uint16_t         inflight_target_ = 0;
    bool             have_internal_sequence_ = false;
    bool             have_evcc_sequence_ = false;
    uint32_t         internal_sequence_ = 0;
    uint32_t         evcc_sequence_ = 0;
};

static_assert(sizeof(HomeHubActuator) <= 256,
              "WP3 actuator must remain a fixed small object with no per-command heap growth");
static_assert(std::is_trivially_copyable_v<HomeHubActuator>,
              "WP3 actuator must not acquire owning/dynamic command storage");

}  // namespace daik::logic

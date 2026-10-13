#pragma once

#include "mqtt_cleanup.hpp"

namespace daik {

enum class MqttRetirementOwner : uint8_t {
    None,
    LegacyFixed,
    StaleValues,
    Profile,
    LegacyProbe,
    ModbusProbe,
    WeatherProbe,
    CrashProbe,
    PeriodicDiscovery
};

// One exact-topic retirement at a time. The owner keeps its cursor/topic until matching PUBACK;
// enqueue admission, unrelated events and reconnect alone never complete a broker deletion.
class MqttRetirementDelivery {
public:
    bool can_queue(MqttRetirementOwner owner, uint32_t epoch) const noexcept {
        return owner != MqttRetirementOwner::None && epoch != 0 && msg_id_ < 0 && !confirmed_ &&
               (owner_ == MqttRetirementOwner::None || owner_ == owner);
    }

    bool queued(MqttRetirementOwner owner, uint32_t epoch, int msg_id) noexcept {
        if (msg_id < 0 || !can_queue(owner, epoch)) return false;
        owner_  = owner;
        epoch_  = epoch;
        msg_id_ = msg_id;
        return true;
    }

    bool evidence(MqttCleanupDeliveryEvidence event) noexcept {
        if (msg_id_ < 0 || event.client_epoch != epoch_ || event.msg_id != msg_id_) return false;
        msg_id_    = -1;
        confirmed_ = event.outcome == MqttCleanupDeliveryOutcome::Published;
        return true;
    }

    bool take_confirmed(MqttRetirementOwner owner) noexcept {
        if (owner_ != owner || !confirmed_) return false;
        owner_     = MqttRetirementOwner::None;
        epoch_     = 0;
        confirmed_ = false;
        return true;
    }

    // A proven foreign discovery namespace forbids retrying this deletion. Only its matching,
    // retryable discovery owner may abandon the cursor for an explicit operator migration. This
    // is neither a broker acknowledgement nor deletion evidence; raw-topic probes remain owned.
    // The caller retains the exact discovery cursor while this owner is held; expiry/stop cannot
    // advance it. Each discovery owner has one such cursor and never owns a raw-topic probe.
    bool abandon_discovery_for_operator_migration(MqttRetirementOwner owner) noexcept {
        const bool discovery = owner == MqttRetirementOwner::LegacyFixed ||
                               owner == MqttRetirementOwner::StaleValues ||
                               owner == MqttRetirementOwner::Profile ||
                               owner == MqttRetirementOwner::PeriodicDiscovery;
        if (!discovery || owner_ != owner || msg_id_ >= 0 || confirmed_) return false;
        owner_ = MqttRetirementOwner::None;
        epoch_ = 0;
        return true;
    }

    // Only after the transport producer stopped and its outbox was actually cleared. Preserve
    // the owner/cursor; its same exact topic is requeued on resume or a replacement epoch.
    void outbox_cleared_after_transport_stop() noexcept {
        if (msg_id_ >= 0) {
            msg_id_ = -1;
            epoch_  = 0;
        }
    }

    bool                busy() const noexcept { return owner_ != MqttRetirementOwner::None; }
    bool                in_flight() const noexcept { return msg_id_ >= 0; }
    MqttRetirementOwner owner() const noexcept { return owner_; }
    int                 msg_id() const noexcept { return msg_id_; }

private:
    MqttRetirementOwner owner_     = MqttRetirementOwner::None;
    uint32_t            epoch_     = 0;
    int                 msg_id_    = -1;
    bool                confirmed_ = false;
};

} // namespace daik

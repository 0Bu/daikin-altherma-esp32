#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

namespace daik {

// Source-retirement is deliberately serialized. A reconnect may need 5 Weather, 28 HomeHub and
// 4 ENV III retained deletes, but esp-mqtt must own at most one of those QoS-1 tombstones at a time.
// The broker's PUBACK, not successful local queue admission, advances this state machine.
enum class MqttCleanupSource : uint8_t { None = 0, Weather = 1, Modbus = 2, Env3 = 4 };

enum class MqttCleanupTopic : uint8_t { None, State, RetiredDiscovery, Env3Discovery };

inline constexpr uint8_t MQTT_CLEANUP_ALL_SOURCES =
    static_cast<uint8_t>(MqttCleanupSource::Weather) |
    static_cast<uint8_t>(MqttCleanupSource::Modbus) |
    static_cast<uint8_t>(MqttCleanupSource::Env3);
inline constexpr uint8_t MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT = 4;
inline constexpr uint8_t MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT  = 27;
inline constexpr uint8_t MQTT_ENV3_CLEANUP_DISCOVERY_COUNT    = 3;
inline constexpr uint8_t MQTT_SOURCE_CLEANUP_MAX_STEPS =
    1 + MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT + 1 +
    MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT + 1 + MQTT_ENV3_CLEANUP_DISCOVERY_COUNT;
static_assert(MQTT_SOURCE_CLEANUP_MAX_STEPS == 37);

inline constexpr uint8_t mqtt_cleanup_bit(MqttCleanupSource source) {
    return static_cast<uint8_t>(source);
}

struct MqttCleanupAction {
    MqttCleanupSource source = MqttCleanupSource::None;
    MqttCleanupTopic  topic  = MqttCleanupTopic::None;
    uint8_t           index  = 0;

    constexpr explicit operator bool() const { return source != MqttCleanupSource::None; }
};

struct MqttCleanupCompletion {
    MqttCleanupSource source       = MqttCleanupSource::None;
    bool              env3_enabled = false;

    constexpr explicit operator bool() const { return source != MqttCleanupSource::None; }
};

enum class MqttCleanupDeliveryOutcome : uint8_t { Published, Deleted };

struct MqttCleanupDeliveryEvidence {
    uint32_t client_epoch = 0;
    int      msg_id       = -1;
    MqttCleanupDeliveryOutcome outcome = MqttCleanupDeliveryOutcome::Published;
};

// One event-task producer, one mqtt_task consumer. The ring exists because esp-mqtt may deliver
// MQTT_EVENT_PUBLISHED before esp_mqtt_client_publish() has returned its msg_id to mqtt_task. A
// single "last id" atomic would let an unrelated later PUBACK overwrite that evidence. Overflow is
// reported and fails closed (the scheduler never advances without the matching retained evidence).
template <size_t Capacity>
class MqttCleanupEvidenceQueue {
    public:
    static_assert(Capacity > 1, "cleanup delivery evidence needs a bounded queue");

    bool push(MqttCleanupDeliveryEvidence evidence) noexcept {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t tail = tail_.load(std::memory_order_acquire);
        if (head - tail >= Capacity) {
            dropped_.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        entries_[head % Capacity] = evidence;
        head_.store(head + 1, std::memory_order_release);
        return true;
    }

    bool pop(MqttCleanupDeliveryEvidence& evidence) noexcept {
        const size_t tail = tail_.load(std::memory_order_relaxed);
        const size_t head = head_.load(std::memory_order_acquire);
        if (tail == head) return false;
        evidence = entries_[tail % Capacity];
        tail_.store(tail + 1, std::memory_order_release);
        return true;
    }

    // The consumer may discard stale evidence only after esp-mqtt's producer task has stopped and
    // cleared its outbox. The next transport start then retries the still-active idempotent step.
    void clear_after_producer_stop() noexcept {
        tail_.store(head_.load(std::memory_order_acquire), std::memory_order_release);
    }

    uint32_t dropped() const noexcept { return dropped_.load(std::memory_order_relaxed); }

    private:
    std::array<MqttCleanupDeliveryEvidence, Capacity> entries_{};
    std::atomic<size_t>                              head_{0};
    std::atomic<size_t>                              tail_{0};
    std::atomic<uint32_t>                            dropped_{0};
};

class MqttCleanupScheduler {
    public:
    void begin_cycle() noexcept { completed_this_cycle_ = 0; }

    void request(MqttCleanupSource source) noexcept {
        if (source != MqttCleanupSource::None) pending_ |= mqtt_cleanup_bit(source);
    }

    void request_all() noexcept { pending_ |= MQTT_CLEANUP_ALL_SOURCES; }

    // A clean-session replacement needs a fresh convergence pass. A transport reconnect using the
    // same client retains its esp-mqtt outbox and therefore keeps the in-flight id without queuing a
    // duplicate. The epoch is assigned when a new client handle is built, not on CONNECTED.
    bool reconstruct_for_client(uint32_t client_epoch) noexcept {
        if (client_epoch == 0 || client_epoch == client_epoch_) return false;
        client_epoch_ = client_epoch;
        request_all();
        active_       = MqttCleanupSource::None;
        next_step_    = 0;
        in_flight_id_ = -1;
        completion_   = {};
        return true;
    }

    // Call only after the old transport has stopped successfully. Any partially ACKed source is
    // idempotently restarted by the replacement client's mandatory reconstruction pass.
    void invalidate_client() noexcept {
        request(active_);
        active_       = MqttCleanupSource::None;
        next_step_    = 0;
        in_flight_id_ = -1;
        client_epoch_ = 0;
        completion_   = {};
    }

    MqttCleanupAction next_action(bool connected, bool env3_enabled) noexcept {
        if (!connected || client_epoch_ == 0 || in_flight_id_ >= 0) return {};
        if (active_ == MqttCleanupSource::None) {
            active_ = take_next_pending();
            if (active_ == MqttCleanupSource::None) return {};
            next_step_          = 0;
            active_env3_enabled_ = env3_enabled;
        }

        if (next_step_ == 0) return {active_, MqttCleanupTopic::State, 0};
        if (active_ == MqttCleanupSource::Weather)
            return {active_, MqttCleanupTopic::RetiredDiscovery,
                    static_cast<uint8_t>(next_step_ - 1)};
        if (active_ == MqttCleanupSource::Modbus)
            return {active_, MqttCleanupTopic::RetiredDiscovery,
                    static_cast<uint8_t>(next_step_ - 1)};
        if (active_ == MqttCleanupSource::Env3 && !active_env3_enabled_)
            return {active_, MqttCleanupTopic::Env3Discovery,
                    static_cast<uint8_t>(next_step_ - 1)};
        return {};
    }

    bool publish_queued(uint32_t client_epoch, int msg_id) noexcept {
        if (active_ == MqttCleanupSource::None || in_flight_id_ >= 0 || msg_id < 0 ||
            client_epoch == 0 || client_epoch != client_epoch_)
            return false;
        in_flight_id_ = msg_id;
        return true;
    }

    bool acknowledge(MqttCleanupDeliveryEvidence evidence) noexcept {
        if (evidence.outcome != MqttCleanupDeliveryOutcome::Published || in_flight_id_ < 0 ||
            evidence.client_epoch != client_epoch_ || evidence.msg_id != in_flight_id_)
            return false;
        in_flight_id_ = -1;
        ++next_step_;
        if (next_step_ < active_step_count()) return true;

        completion_ = {active_, active_env3_enabled_};
        completed_this_cycle_ |= mqtt_cleanup_bit(active_);
        active_    = MqttCleanupSource::None;
        next_step_ = 0;
        return true;
    }

    // ESP-MQTT reports an expired outbox item only after deleting it. Retry the same idempotent
    // step; do not advance and do not admit another source until this step is broker-confirmed.
    bool retry_deleted(MqttCleanupDeliveryEvidence evidence) noexcept {
        if (evidence.outcome != MqttCleanupDeliveryOutcome::Deleted || in_flight_id_ < 0 ||
            evidence.client_epoch != client_epoch_ || evidence.msg_id != in_flight_id_)
            return false;
        in_flight_id_ = -1;
        return true;
    }

    // esp_mqtt_client_stop() clears every outbox item without emitting DELETED. It is safe to call
    // this only after the transport task has stopped. Preserve the active step and retry it after
    // resume rather than suppressing the source forever or restarting all 37 cleanup steps.
    bool outbox_cleared_after_transport_stop() noexcept {
        if (in_flight_id_ < 0) return false;
        in_flight_id_ = -1;
        return true;
    }

    MqttCleanupCompletion take_completion() noexcept {
        const MqttCleanupCompletion out = completion_;
        completion_                     = {};
        return out;
    }

    bool suppress(MqttCleanupSource source) const noexcept {
        const uint8_t bit = mqtt_cleanup_bit(source);
        return (pending_ & bit) != 0 || active_ == source ||
               (completed_this_cycle_ & bit) != 0;
    }

    bool in_flight() const noexcept { return in_flight_id_ >= 0; }
    int in_flight_id() const noexcept { return in_flight_id_; }
    uint32_t client_epoch() const noexcept { return client_epoch_; }
    MqttCleanupSource active_source() const noexcept { return active_; }
    uint8_t next_step() const noexcept { return next_step_; }

    private:
    MqttCleanupSource take_next_pending() noexcept {
        for (MqttCleanupSource source : {MqttCleanupSource::Weather, MqttCleanupSource::Modbus,
                                         MqttCleanupSource::Env3}) {
            const uint8_t bit = mqtt_cleanup_bit(source);
            if ((pending_ & bit) != 0) {
                pending_ &= static_cast<uint8_t>(~bit);
                return source;
            }
        }
        return MqttCleanupSource::None;
    }

    uint8_t active_step_count() const noexcept {
        switch (active_) {
        case MqttCleanupSource::Weather:
            return 1 + MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT;
        case MqttCleanupSource::Modbus:
            return 1 + MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT;
        case MqttCleanupSource::Env3:
            return active_env3_enabled_ ? 1 : 1 + MQTT_ENV3_CLEANUP_DISCOVERY_COUNT;
        case MqttCleanupSource::None:
            return 0;
        }
        return 0;
    }

    uint8_t               pending_                 = 0;
    uint8_t               completed_this_cycle_     = 0;
    MqttCleanupSource     active_                   = MqttCleanupSource::None;
    uint8_t               next_step_                = 0;
    bool                  active_env3_enabled_      = false;
    int                   in_flight_id_             = -1;
    uint32_t              client_epoch_             = 0;
    MqttCleanupCompletion completion_;
};

} // namespace daik

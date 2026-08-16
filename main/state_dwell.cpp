// How long each switched row has read what it reads. Policy (the tracked set, the state codes, the
// blind-time accounting, the gap bound and the restore verdict) lives in logic/state_dwell.hpp and
// is host-tested; this file is the static table, one mutex, and the fold from a poll cycle.
#include "state_dwell.hpp"
#include "diag_log.hpp"
#include "logic/checkup_persist.hpp"  // checkup_model_fingerprint — the ONE profile-id identity
#include "logic/crashinfo.hpp"   // crash_reason_slug — one reset vocabulary
#include "logic/state_dwell.hpp"
#include "safe_mode.hpp"         // safe_mode_active — nothing ages the table there

#include "esp_attr.h"            // __NOINIT_ATTR — the whole of the restore rests on this attribute
#include "esp_system.h"          // esp_reset_reason
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rtos_guard.hpp"        // SemGuard — the ONE unwind-safe mutex guard

#include <atomic>

namespace daik {

namespace {

// The table and its seal, in .noinit DRAM (logic/state_dwell.hpp). Not initialised at startup, which
// is the entire mechanism: whatever the previous boot left is what dwell_start() gets to judge.
struct PersistedDwell {
    uint32_t magic;
    uint16_t version;
    uint16_t reserved;
    uint32_t catalog_fp;
    uint32_t model_fp;      // which unit the slots describe (checked at detect, not here)
    uint32_t crc;
    logic::DwellSlot slots[logic::DWELL_MAX_SLOTS];
};

// UNINITIALISED STORAGE, and the UNION is what makes it that. This is the trap #417 cost the checkup
// and it is worth restating rather than assuming the next reader knows: DwellSlot carries non-static
// data member initialisers, so a plain struct definition here would get an implicit default
// constructor that RUNS at startup and re-initialises every slot — while `magic`, `version`,
// `catalog_fp`, `model_fp` and `crc`, being bare scalars with no initialiser, survive untouched.
// The result is the worst possible shape: the header passes the magic, version and catalog checks,
// the slots do not, and the record is rejected as `bad_crc` — a memory-fault verdict for a compiler
// doing exactly what it was told. A union with a user-provided empty constructor emits no
// initialisation at all, which is the standard way to say "these bytes are whatever they were".
union PersistStore {
    PersistedDwell v;
    PersistStore() {}      // deliberately leaves v untouched
    ~PersistStore() {}
};
__NOINIT_ATTR PersistStore s_store;

// One name for the region, so no call site has to know about the union.
inline PersistedDwell& P() { return s_store.v; }

SemaphoreHandle_t s_mtx = nullptr;
int64_t  s_last_us = -1;
uint32_t s_model_fp = 0;
bool     s_adopt_detect_grace = false;
std::atomic<bool> s_reset_requested{false};
logic::DwellRestore s_persist_verdict = logic::DwellRestore::NoRecord;

// Everything in a critical section here is a plain integer copy — nothing allocates — so the
// guard's unwind safety is belt-and-braces rather than the reason it is used.
using Lock = SemGuard;

// WHAT THE SEAL COVERS. Unlike the checkup's ring there is no `pending` to exclude: every live slot
// advances on every cycle, so a seal that skipped the changing part would cover nothing at all. It
// is therefore rewritten after each fold, which costs a CRC32 over 1152 bytes once per second — a
// few tens of microseconds on this chip, against a poll cycle that spends milliseconds on the UART.
// A panic landing mid-fold leaves the slots and the seal disagreeing, and the next boot wipes: the
// safe direction, and the one the verdict already has a name for.
uint32_t persist_crc() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(P().slots), sizeof(P().slots));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().model_fp),
                              sizeof(P().model_fp));
    return config_crc32_final(crc);
}

// The fingerprint is a constant of the BUILD — it walks the converter space and the slot layout, so
// it cannot change while the firmware is running. Computed once rather than on every seal, i.e.
// once a second for the life of the board.
uint32_t catalog_fp() {
    static const uint32_t fp = logic::dwell_catalog_fingerprint();
    return fp;
}

// The ONLY writer of the record's header, so the seal and the bytes it covers cannot drift apart.
void persist_seal() {
    P().magic      = logic::DWELL_PERSIST_MAGIC;
    P().version    = logic::DWELL_PERSIST_VERSION;
    P().reserved   = 0;
    P().catalog_fp = catalog_fp();
    P().model_fp   = s_model_fp;
    P().crc        = persist_crc();
}

void persist_wipe() {
    for (auto& s : P().slots) s = logic::DwellSlot{};
    persist_seal();     // keeps s_model_fp: the identity belongs to what is recorded NEXT
}

bool apply_reset_locked() {
    if (!s_reset_requested.exchange(false)) return false;
    s_last_us = -1;     // the next cycle opens a fresh run rather than booking the reset as elapsed
    persist_wipe();     // clears the slots AND the record, so the next boot cannot re-adopt them
    return true;
}

} // namespace

// Judge what the previous boot left in .noinit. Called from app_main BEFORE any producer task
// exists, so the whole decision is single-threaded and needs no lock — the property checkup_start()
// and history_start() rely on too.
void dwell_start() {
    // Create the lock HERE, not on first use. checkup.cpp carries the note about why, having already
    // removed the lazy version: a mutex allocated by the poll task inside the record path is read by
    // the httpd task through dwell_reading() while another core is writing the handle — an
    // unsynchronized read of the very pointer that synchronizes everything else in this file. It is
    // free to avoid, because app_main calls this before any producer task exists, the same property
    // history_start() and checkup_start() already rely on for the identical creation.
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();
        if (!s_mtx) diag_printf("dwell: mutex alloc failed — state ages disabled this boot\n");
    }
    const uint32_t want_fp = catalog_fp();
    const uint32_t reason  = static_cast<uint32_t>(esp_reset_reason());
    s_persist_verdict = logic::dwell_restore_verdict(reason, P().magic, P().version,
                                                     P().catalog_fp, want_fp,
                                                     P().crc, persist_crc(),
                                                     safe_mode_active());
    if (s_persist_verdict == logic::DwellRestore::Accept) {
        // Adopt in place. What cannot be adopted in place is the claim that the reboot window was
        // watched, so dwell_adopt books it as blind on every live run instead of pretending the gap
        // was observed — the device cannot time its own downtime, and inventing a duration is what
        // logic/timestamp.hpp already refuses to do for an unsynced clock.
        logic::dwell_adopt(P().slots, logic::DWELL_MAX_SLOTS);
        s_model_fp = P().model_fp;
        s_adopt_detect_grace = true;
        persist_seal();
        diag_printf("dwell: state ages kept across a %s reset (RAM survived)\n",
                    crash_reason_slug(reason));
    } else {
        persist_wipe();
        // Not noise: "wrong_catalog" after an update explains durations that reset themselves for a
        // reason nobody could otherwise reconstruct, and "bad_crc" on a board that was never
        // power-cycled is a memory fault worth seeing.
        diag_printf("dwell: state ages start empty (%s)\n",
                    logic::dwell_restore_slug(s_persist_verdict));
    }
}

const char* dwell_persist_state() {
    if (!s_mtx) return logic::dwell_restore_slug(s_persist_verdict);
    Lock lk(s_mtx);
    return logic::dwell_restore_slug(s_persist_verdict);
}

void dwell_reset() {
    // Do not create/take the mutex from the httpd task. The poll task remains its sole creator, and
    // only the record path consumes this request under that mutex; lookups answer "nothing to say"
    // until then, which is the correct answer for a table that is about to be emptied.
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    s_reset_requested.store(true);
}

void dwell_forget() {
    // If mutex allocation failed there is no producer: dwell_record() returns immediately, so the
    // region can be wiped directly. Otherwise serialize with the poll fold and seal the empty state
    // before the factory-reset path is allowed to reboot.
    Lock lk(s_mtx);
    if (s_mtx && !lk.acquired()) return;
    s_reset_requested.store(false);
    s_last_us = -1;
    s_model_fp = 0;
    s_adopt_detect_grace = false;
    s_persist_verdict = logic::DwellRestore::NoRecord;
    persist_wipe();
}

// Detection resolves a profile on EVERY boot — the model is RAM-only by design — so "detection
// resolved" is NOT evidence that the unit changed. checkup.cpp documents what treating it as such
// costs once a feature actually survives a reboot: the table is adopted at boot and thrown away four
// seconds later, on exactly the boards that have a heat pump attached.
void dwell_reset_on_detect(const char* profile_id) {
    // The same "which unit is this" hash the checkup uses, reused rather than copied: a second
    // six-line CRC over the same string is a second thing that can disagree about whether the unit
    // changed, and both features answer that question for the same reason on the same event.
    const uint32_t fp = logic::checkup_model_fingerprint(profile_id);
    if (!s_mtx) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (s_adopt_detect_grace) {
        s_adopt_detect_grace = false;
        if (fp == s_model_fp) return;          // same unit — the restored ages are about this plant
        s_persist_verdict = logic::DwellRestore::ModelChanged;
        diag_printf("dwell: restored state ages were another unit — discarded for %s\n",
                    profile_id ? profile_id : "?");
    }
    s_model_fp = fp;
    s_reset_requested.store(true);
}

void dwell_record(const CachedValue* v, size_t n, uint32_t source_generation) {
    // dwell_start() creates it; absent means its alloc failed -> no state ages this boot. Saying so
    // once, there, rather than from this 1 Hz path: an unlatched line here would put ~86k copies of
    // itself through the 6 KB diag ring every day and evict the boot record, the crash records and
    // every other cause anyone might be looking for.
    if (!s_mtx) return;
    if (!v && n) return;

    // Reduce the cache to the tracked rows BEFORE taking the lock. The observation array is the one
    // thing here sized by the catalog, and it is a POD on the poll task's stack: DWELL_MAX_SLOTS
    // (64) entries of 6 bytes is 384 B of an 8 KB stack — the array is sized by the TABLE, not by
    // the current worst case it will actually hold, so quote the size the code allocates. That stack
    // is the budget which fails silently on this board (AGENTS.md → Memory, concurrency, and HTTP
    // safety). A row that produced no usable state is simply
    // left out — logic/state_dwell.hpp treats absent and undecodable identically, so the caller
    // never has to encode "present but unknown".
    logic::DwellObservation obs[logic::DWELL_MAX_SLOTS];
    size_t obs_n = 0;
    for (size_t i = 0; i < n && obs_n < logic::DWELL_MAX_SLOTS; i++) {
        if (!logic::dwell_row_tracked(v[i].reg, v[i].off, v[i].conv)) continue;
        const uint8_t code = logic::dwell_code(v[i].conv, v[i].value.c_str());
        if (code == logic::DWELL_CODE_NONE) continue;
        obs[obs_n].reg  = v[i].reg;
        obs[obs_n].off  = v[i].off;
        obs[obs_n].conv = static_cast<int16_t>(v[i].conv);
        obs[obs_n].code = code;
        obs_n++;
    }

    // Elapsed seconds from the MONOTONIC clock, so an SNTP jump mid-boot cannot move a dwell. The
    // first cycle of a boot books nothing: there is no previous observation to have been watching
    // between, and counting from an imagined one is how a run comes to claim time nobody observed.
    //
    // QUANTISE THE ABSOLUTE TIMESTAMPS, never the interval — checkup_step()'s rule, and it is here
    // because this file shipped exactly the defect that comment describes. The poll loop sleeps a
    // whole second AFTER a serial sweep, so the real cadence is ~1.2-1.3 s; flooring each interval
    // to 1 s and then restarting the clock from `now` discards that fraction on every cycle, and it
    // never comes back. Measured against a 1.3 s cadence that is 23% slow FOREVER — a state held for
    // three hours would have been published as "2 h 19 min", a wrong number with no tell on it and
    // the exact shape (#35-#39) this feature's own honesty rules exist to prevent. Quantising the
    // absolute instants telescopes the remainder into the next cycle instead, bounding the total
    // error at under one second for the whole run rather than compounding it per cycle.
    const int64_t now_us = esp_timer_get_time();
    // dt_s == 0 is NOT a reason to skip the fold: two calls can land in one wall second, and the
    // observations still have to be applied — a state CHANGE in that cycle must be recorded even
    // though no seconds are booked for it. Returning early here would drop it silently.

    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (!hp_poll_generation_matches(source_generation)) return;
    if (apply_reset_locked()) return;          // discard this sample with the identity it belonged to
    uint32_t dt_s = 0;
    if (s_last_us >= 0 && now_us >= s_last_us)
        dt_s = static_cast<uint32_t>(now_us / 1000000 - s_last_us / 1000000);
    s_last_us = now_us;
    logic::dwell_step(P().slots, logic::DWELL_MAX_SLOTS, obs, obs_n, dt_s);
    persist_seal();
}

logic::DwellReading dwell_reading(uint8_t reg, uint8_t off, int conv) {
    if (!s_mtx) return logic::DwellReading{};   // its alloc failed: no state ages this boot
    // A pending reset is consumed by the RECORD path, so between the request and the next poll
    // cycle the table still holds the previous identity's ages. Answer "nothing to say" rather than
    // serve them: the caller asked for /set_hp or /detect precisely because the unit or the link
    // changed, and a run measured on the old one is not a shorter answer, it is a wrong one.
    // checkup_report() makes the same refusal for the same window.
    if (s_reset_requested.load()) return logic::DwellReading{};
    Lock lk(s_mtx);
    return logic::dwell_lookup(P().slots, logic::DWELL_MAX_SLOTS, reg, off, conv);
}

} // namespace daik

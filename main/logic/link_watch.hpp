#pragma once
// Connectivity-watchdog policy (wifi.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// The watchdog exists for the ONE failure the STA cannot report itself: a "ghost" association. A
// missed deauth leaves the stack believing it is still up — it keeps the IP, fires no
// DISCONNECTED event, so the endless-reconnect handler never runs — while no packet reaches the
// LAN. The only way out is to notice that a gateway which HAS answered ICMP before has gone quiet,
// and force one re-association.
//
// Why the probe result is THREE-valued, not a bool. The original policy folded "I could not take
// the measurement" into "reachable", under a sound rule: never re-associate a healthy link on the
// strength of our own inability to measure. But collapsing it into `true` made a permanently BLIND
// watchdog indistinguishable — and, worse, entirely SILENT — from a permanently healthy one. That
// is not hypothetical: a board wedged in a ghost association (link "up", gateway dead, sendto()
// failing with ENOMEM several times a second) logged nothing at all from the watchdog across many
// 30 s periods, because every probe was returning "healthy" without ever being taken.
//
// So: keep the fail-safe — an Unmeasurable probe is never counted as a failure and never trips the
// fast path — but count and surface it, and treat a SUSTAINED inability to measure while the link
// claims to be up as its own proven fault. It is proven in a way a single miss is not: a healthy
// device does not spend minutes unable to allocate an ICMP session. And the recovery is apt rather
// than incidental — dropping the ghost link makes the STA report itself down, which stops the
// traffic that was exhausting the buffers, which is what made the probe unallocatable to begin
// with. The blind threshold is deliberately an order of magnitude slower than the unreachable one:
// acting on absence of evidence must stay the last resort, not the reflex.
#include <cstdint>

namespace daik {

// What a single gateway probe established.
enum class GwProbe : uint8_t {
    Reachable,      // ≥1 echo reply — the LAN is live
    Unreachable,    // the probe ran and NOTHING replied — proven silence
    Unmeasurable,   // the probe could not be taken (no session, no gateway, not initialised)
};

enum class WdAction : uint8_t { None, Reassociate };

// Consecutive-observation counters. Reset on any evidence of health.
struct LinkWatch {
    int unreachable = 0;   // consecutive PROVEN-silent probes
    int blind       = 0;   // consecutive probes that could not be taken at all
};

// ~60 s at the 30 s cadence: two proven-silent probes are a ghost.
inline constexpr int WD_UNREACHABLE_TO_REASSOC = 2;
// ~5 min at the 30 s cadence. Long on purpose — see the header note.
inline constexpr int WD_BLIND_TO_REASSOC = 10;

// Advance the policy by one watchdog period and say whether to force a re-association.
//
// `link_up`           — the STA believes it is associated (a ghost is link_up by definition; when
//                       the link knows it is down the reconnect handler owns recovery, not us).
// `gw_ever_reachable` — this gateway has answered ICMP at least once since boot. Without that
//                       baseline we have no evidence it answers echo AT ALL, so its silence may
//                       just be a firewall — re-associating on it would churn a healthy link
//                       forever. Gates BOTH paths: the watchdog only ever acts on a link it has
//                       verified before.
inline WdAction link_watch_step(LinkWatch& s, bool link_up, GwProbe probe, bool gw_ever_reachable) {
    if (!link_up) {                       // the handler is already reconnecting — nothing to detect
        s.unreachable = 0;
        s.blind       = 0;
        return WdAction::None;
    }

    switch (probe) {
        case GwProbe::Reachable:          // evidence of health clears everything
            s.unreachable = 0;
            s.blind       = 0;
            return WdAction::None;

        case GwProbe::Unreachable:
            // A probe was actually taken, so blindness is over regardless of the verdict.
            s.blind = 0;
            s.unreachable++;
            if (s.unreachable < WD_UNREACHABLE_TO_REASSOC || !gw_ever_reachable) return WdAction::None;
            s.unreachable = 0;
            return WdAction::Reassociate;

        case GwProbe::Unmeasurable:
            // NOT evidence of failure — never touches `unreachable`, and never trips the fast path.
            // It is not evidence of health either, so `unreachable` is left standing rather than
            // cleared: a blind period must not launder away proven silence we already observed.
            s.blind++;
            if (s.blind < WD_BLIND_TO_REASSOC || !gw_ever_reachable) return WdAction::None;
            s.blind = 0;
            return WdAction::Reassociate;
    }
    return WdAction::None;
}

} // namespace daik

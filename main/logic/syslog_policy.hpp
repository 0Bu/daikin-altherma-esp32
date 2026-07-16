#pragma once
// Send-failure policy for the syslog forwarder (syslog.cpp). Pure, IDF-free, host-tested
// (test/test_logic.cpp).
//
// Why this exists. syslog.cpp re-resolves DNS + re-probes the collector on a 10 s cadence, and the
// send path used to force that check to run IMMEDIATELY on *any* sendto()/socket() failure. On a
// board whose WiFi has ghosted (associated in name only) every send fails, and the diag stream is
// itself several lines a second when a failure mode is chatty — an X10A timeout every ~0.3 s. Each
// failed line therefore triggered a fresh getaddrinfo() plus a 3×1 s blocking ICMP probe: a
// self-sustaining storm, running hardest exactly when the network is least able to carry it. The
// existing throttle comment ("a persistently failing DNS/host must not re-run getaddrinfo()+ping
// every…") was correct in intent; the send path simply bypassed it.
//
// The distinction that fixes it: a send failure says one of two very different things.
//
//   HARD      — the destination or the route is the problem (the network is unreachable, the host
//               is down, our address is gone). Re-resolving and re-probing could plausibly change
//               the outcome, so paying for it is justified.
//   TRANSIENT — the stack momentarily could not take the datagram (out of memory/pbufs, would
//               block, interrupted). The destination is fine; nothing about a fresh getaddrinfo()
//               would help. Keep the resolved destination and let the ordinary cadence handle it.
//
// Defaulting the unknown case to TRANSIENT is deliberate and cheap: clearing the throttle only
// *accelerates* the next resolve — the 10 s cadence still runs regardless — so mis-classifying a
// hard error costs at most one cadence of delay, while mis-classifying a transient one costs the
// storm above. The asymmetry is the whole point.
#include <cerrno>

namespace daik {

// True when `err` (an errno from sendto()/socket()) indicts the destination or the route, so
// re-resolving DNS and re-probing is worth doing now rather than at the next 10 s tick.
inline bool syslog_error_is_hard(int err) {
    switch (err) {
        case ENETUNREACH:     // no route to that network
        case EHOSTUNREACH:    // no route to that host
        case ENETDOWN:        // our interface went down
        case EHOSTDOWN:       // the peer is down
        case EADDRNOTAVAIL:   // our source address is gone (lease lost)
            return true;
        default:
            // ENOMEM / ENOBUFS (no pbufs — the ghost-association case), EAGAIN / EWOULDBLOCK,
            // EINTR, and anything unrecognised: the collector is not implicated. Hold the
            // destination, keep the throttle, let the cadence re-check.
            return false;
    }
}

} // namespace daik

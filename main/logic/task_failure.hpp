#pragma once

namespace daik {

// Keep each failed cycle's counters/state, but log only once until work succeeds again.
struct TaskFailureEpisode {
    bool first_failure() {
        const bool first = !failed;
        failed           = true;
        return first;
    }
    void succeeded() { failed = false; }

private:
    bool failed = false;
};

} // namespace daik

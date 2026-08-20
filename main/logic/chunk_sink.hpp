#pragma once
// A small, IDF-free streaming sink for payloads whose complete representation cannot fit in one
// contiguous heap block. `Emit` is called synchronously with (bytes, final): data calls are never
// larger than `MaxBytes`, and one empty final call terminates a successful stream. The callback must
// consume the view before returning; the backing buffer is reused immediately afterwards.
#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>

namespace daik {

template <typename Emit, size_t MaxBytes>
class BoundedChunkSink {
    static_assert(MaxBytes > 0, "a chunk sink needs a non-zero bound");

public:
    explicit BoundedChunkSink(Emit emit) : emit_(std::move(emit)) { buffer_.reserve(MaxBytes); }

    BoundedChunkSink& operator+=(std::string_view value) {
        append(value);
        return *this;
    }
    BoundedChunkSink& operator+=(const std::string& value) {
        append(std::string_view(value));
        return *this;
    }
    BoundedChunkSink& operator+=(const char* value) {
        append(value ? std::string_view(value) : std::string_view());
        return *this;
    }
    BoundedChunkSink& operator+=(char value) {
        append(std::string_view(&value, 1));
        return *this;
    }

    bool finish() {
        if (finished_) return !failed_;
        flush();
        if (!failed_ && !emit_(std::string_view(), true)) failed_ = true;
        finished_ = true;
        return !failed_;
    }

    bool failed() const { return failed_; }
    // True as soon as the first data emission is attempted. The transport may send status/headers
    // before reporting a later socket error, so even a false result must conservatively close the
    // clean-503 window. A later serializer failure then aborts instead of sending a second response.
    bool emission_started() const { return emission_started_; }
    size_t max_buffered() const { return max_buffered_; }
    static constexpr size_t max_chunk_bytes() { return MaxBytes; }

private:
    void append(std::string_view value) {
        if (failed_ || finished_) return;
        while (!value.empty()) {
            if (buffer_.size() == MaxBytes) flush();
            if (failed_) return;

            const size_t available = MaxBytes - buffer_.size();
            const size_t take = std::min(available, value.size());
            buffer_.append(value.data(), take);
            if (buffer_.size() > max_buffered_) max_buffered_ = buffer_.size();
            value.remove_prefix(take);
        }
    }

    void flush() {
        if (failed_ || buffer_.empty()) return;
        emission_started_ = true;
        if (!emit_(std::string_view(buffer_), false)) {
            failed_ = true;
            return;
        }
        buffer_.clear();
    }

    Emit emit_;
    std::string buffer_;
    size_t max_buffered_ = 0;
    bool failed_ = false;
    bool emission_started_ = false;
    bool finished_ = false;
};

// Serialize and finish a bounded HTTP-style stream without ever letting an exception cross a C
// server frame. Before the first accepted data chunk the caller still owns the response status, so
// rethrow and let its outer OOM/exception guard produce 503/500. After commit the status is already
// on the wire; returning false tells the server to close the incomplete response cleanly.
template <typename Sink, typename Append>
inline bool finish_bounded_stream(Sink& sink, Append&& append) {
    try {
        std::forward<Append>(append)(sink);
        return sink.finish();
    } catch (...) {
        if (!sink.emission_started()) throw;
        return false;
    }
}

} // namespace daik

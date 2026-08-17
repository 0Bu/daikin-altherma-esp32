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
    bool finished_ = false;
};

} // namespace daik

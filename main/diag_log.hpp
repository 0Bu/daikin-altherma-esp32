#pragma once
// In-RAM diagnostic log ring, served by GET /diag (plain text). A static .bss buffer — never a
// growing std::string — so it can't fragment the heap. verbose=1 also captures raw X10A RX
// frames.
#include "logic/diag_tail.hpp"
#include <cstddef>

namespace daik {

void   diag_log_init();
void   diag_printf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
void   diag_set_verbose(bool on);
bool   diag_verbose();
// Copy up to `max` bytes of the ring (oldest→newest) into out; returns bytes written.
size_t           diag_dump(char* out, size_t max);
DiagStreamCursor diag_stream_open(size_t max);
size_t diag_stream_next(DiagStreamCursor& cursor, char* out, size_t max, bool whole_lines);
void   diag_clear();

} // namespace daik

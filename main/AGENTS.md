# Firmware Memory & Concurrency Invariants

1. **HTTP Exception Boundary (503 on OOM)**: Every non-trivial HTTP handler that dynamically allocates memory must catch `std::bad_alloc` and return HTTP 503 (`HTTPD_503_SERVICE_UNAVAILABLE`). Exceptions unwinding through C runtime frames terminate the process.
2. **Allocation & Mutex Safety**: Never allocate dynamically while holding a raw mutex or semaphore. Stage heap structures outside critical sections, or use RAII locks with no-throw swaps/moves.
3. **Streaming over Buffering**: Stream large HTTP responses (such as `/status`, discovery, or diagnostic dumps) chunk-by-chunk using `httpd_resp_send_chunk`. Avoid constructing large temporary `std::string` buffers in contiguous internal heap.
4. **Task Resiliency**: Allocating FreeRTOS task loops must handle transient allocation failures within the loop body: log once, retain last known good state, delay normally, and continue. Never turn transient memory pressure into a reboot loop.
5. **Stack Budget**: Maintain at least ~1 KiB of headroom for any FreeRTOS task calling shared string or JSON formatting routines.

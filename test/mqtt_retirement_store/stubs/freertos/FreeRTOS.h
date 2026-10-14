#pragma once
// Just enough FreeRTOS for main/rtos_guard.hpp; the fixture defines the semaphore calls and records
// whether the store's mutex is held around each NVS and latch access.
#include <cstdint>

using TickType_t                          = uint32_t;
using BaseType_t                          = int;
inline constexpr BaseType_t pdTRUE        = 1;
inline constexpr BaseType_t pdFALSE       = 0;
inline constexpr TickType_t portMAX_DELAY = 0xffffffffu;

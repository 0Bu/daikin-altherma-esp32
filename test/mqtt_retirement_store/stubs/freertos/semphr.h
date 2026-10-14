#pragma once
#include "FreeRTOS.h"

struct StaticSemaphore_t {
    int storage = 0;
};
using SemaphoreHandle_t = StaticSemaphore_t*;

SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* storage);
BaseType_t        xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t ticks);
BaseType_t        xSemaphoreGive(SemaphoreHandle_t semaphore);

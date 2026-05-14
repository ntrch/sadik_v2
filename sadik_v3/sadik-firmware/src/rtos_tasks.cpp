// =============================================================================
// rtos_tasks.cpp — Sprint-5 Wave-2A foundation
// Defines the FreeRTOS primitives declared in rtos_tasks.h and spawns the
// UART + codec tasks. Task bodies are stubs; W2C/W2D will populate them.
// =============================================================================

#include "rtos_tasks.h"

// ── Globals ─────────────────────────────────────────────────────────────────

SemaphoreHandle_t tftMutex        = nullptr;
QueueHandle_t     byteQueue       = nullptr;
QueueHandle_t     eventQueue      = nullptr;
volatile bool     g_abortRequested = false;

// ── Init ────────────────────────────────────────────────────────────────────

void rtos_init() {
    tftMutex   = xSemaphoreCreateMutex();
    byteQueue  = xQueueCreate(8,  sizeof(ByteChunk));
    eventQueue = xQueueCreate(16, sizeof(RtosEvent));

    xTaskCreatePinnedToCore(
        uartTaskEntry,
        "UartTask",
        4096,
        nullptr,
        2,
        nullptr,
        0   // core 0
    );

    xTaskCreatePinnedToCore(
        codecTaskEntry,
        "CodecTask",
        6144,
        nullptr,
        3,
        nullptr,
        1   // core 1
    );
}

// ── Task stubs ──────────────────────────────────────────────────────────────

void uartTaskEntry(void* arg) {
    (void)arg;
    for (;;) {
        // W2D will populate
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void codecTaskEntry(void* arg) {
    (void)arg;
    for (;;) {
        // W2C will populate
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

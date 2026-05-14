// =============================================================================
// rtos_tasks.h — Sprint-5 Wave-2A foundation
// Declares FreeRTOS sync primitives + task entry points for the codec/UART
// task split. Stubs only; W2C/W2D will populate the task bodies.
// =============================================================================

#ifndef RTOS_TASKS_H
#define RTOS_TASKS_H

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

// ── Inter-task message types ────────────────────────────────────────────────

struct ByteChunk {
    uint8_t  data[256];
    uint16_t len;
};

enum RtosEventType {
    EVT_FRAME_READY = 1,
    EVT_STREAM_EOF  = 2,
    EVT_ABORT_DONE  = 3,
    EVT_ASCII_CMD   = 4,
};

struct RtosEvent {
    uint8_t  type;
    uint16_t data;
};

// ── Globals ─────────────────────────────────────────────────────────────────

extern SemaphoreHandle_t tftMutex;       // guards LGFX_Custom (TFT) access
extern QueueHandle_t     byteQueue;      // UART producer → codec consumer (depth 8)
extern QueueHandle_t     eventQueue;     // codec/uart → main loop (depth 16)
extern volatile bool     g_abortRequested;  // set by main, cleared by codec task

// ── API ─────────────────────────────────────────────────────────────────────

void rtos_init();

// Task entry forward decls
void uartTaskEntry(void* arg);
void codecTaskEntry(void* arg);

#endif // RTOS_TASKS_H

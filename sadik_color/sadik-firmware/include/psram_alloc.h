#pragma once

// PSRAM-aware allocator helper for sadik_color firmware.
//
// On ESP32-S3 builds (BOARD_HAS_PSRAM defined), prefers external SPI PSRAM for
// buffers that do NOT require DMA — typically file read buffers, scene caches,
// or future scratch areas. Falls back to internal SRAM if PSRAM is unavailable
// or the requested allocation fails.
//
// On ESP32-WROOM-32 (no PSRAM), allocations land in internal SRAM directly.
//
// IMPORTANT: do NOT use this for DMA-capable buffers. SPI DMA + octal PSRAM has
// platform-specific constraints; allocate DMA buffers explicitly with
// MALLOC_CAP_DMA via heap_caps_malloc().

#include <esp_heap_caps.h>
#include <stddef.h>
#include <stdint.h>

inline void* psram_or_internal_malloc(size_t size, uint32_t fallback_caps = MALLOC_CAP_8BIT) {
#if defined(BOARD_HAS_PSRAM)
    void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (p) return p;
#endif
    return heap_caps_malloc(size, fallback_caps);
}

inline void psram_or_internal_free(void* p) {
    heap_caps_free(p);
}

#pragma once

// ── Hardware pins ─────────────────────────────────────────────────────────────
#define OLED_SDA 21
#define OLED_SCL 22

// ── Display ───────────────────────────────────────────────────────────────────
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64

// ── Serial ────────────────────────────────────────────────────────────────────
#define SERIAL_BAUD         460800
#define SERIAL_BUFFER_SIZE  2112   // must hold FRAME: + 2048 hex chars

// ── WiFi (reserved for future use) ───────────────────────────────────────────
#define WIFI_SERVER_PORT 80

// ── Idle orchestration timings (milliseconds) ─────────────────────────────────
// Blink: fires every 12–30 s; hard cooldown enforced at 10 s
#define BLINK_MIN_INTERVAL_MS   12000UL
#define BLINK_MAX_INTERVAL_MS   30000UL
#define BLINK_COOLDOWN_MS       10000UL

// Variation (look left / look right): fires every 5–8 minutes
#define VARIATION_MIN_INTERVAL_MS  300000UL
#define VARIATION_MAX_INTERVAL_MS  480000UL

// ── Animation ─────────────────────────────────────────────────────────────────
#define DEFAULT_FPS   12
#define FRAME_BYTES  1024   // 128 * 64 / 8

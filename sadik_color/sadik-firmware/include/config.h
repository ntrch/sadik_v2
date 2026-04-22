#pragma once

// ── TFT SPI pins (ST7735S, VSPI) ─────────────────────────────────────────────
#define TFT_CS    5
#define TFT_DC    4
#define TFT_RST  22
#define TFT_MOSI 23   // VSPI MOSI
#define TFT_SCK  18   // VSPI CLK
// BLK/LED is wired to 3.3V permanently — no software control needed.

// ── ST7735S init tab variant ──────────────────────────────────────────────────
// INITR_BLACKTAB is correct for most 160×128 modules.
// If you see colour offset or wrong dimensions on first boot, try
// INITR_GREENTAB or INITR_REDTAB by passing -DTFT_INIT_TAB=INITR_GREENTAB
// in build_flags.
#ifndef TFT_INIT_TAB
#define TFT_INIT_TAB INITR_BLACKTAB
#endif

// ── Physical TFT resolution (landscape) ──────────────────────────────────────
#define DISPLAY_WIDTH  160
#define DISPLAY_HEIGHT 128

// ── Legacy monochrome framebuffer dimensions ──────────────────────────────────
// All existing animation clips are 128×64 1-bit bitmaps.
#define LEGACY_FB_WIDTH   128
#define LEGACY_FB_HEIGHT   64

// Offset to centre the 128×64 content in the 160×128 TFT (landscape).
//   X: (160 - 128) / 2 = 16
//   Y: (128 -  64) / 2 = 32
#define LEGACY_FB_OFFSET_X 16
#define LEGACY_FB_OFFSET_Y 32

// ── SCREEN_WIDTH / SCREEN_HEIGHT aliases used by text layout code ─────────────
// Text rendering uses the legacy FB area as its "screen" so that font sizes
// and centering calculations remain identical to the original OLED code.
#define SCREEN_WIDTH   LEGACY_FB_WIDTH
#define SCREEN_HEIGHT  LEGACY_FB_HEIGHT

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

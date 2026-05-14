#pragma once

// ── SADIK v3 — T-Display-S3 (LILYGO, ESP32-S3 N16R8) ──────────────────────────
// Display: ST7789, 320×170, 8-bit parallel interface
// Sub-1.2: display_manager.h/cpp will implement LGFX parallel panel config using
//          the pin defines below. Do NOT add init logic here.

// ── Device variant identifier ─────────────────────────────────────────────────
#define SADIK_DEVICE_VARIANT "color_v2"

// ── 8-bit parallel data bus (D0–D7) ──────────────────────────────────────────
#define LCD_D0  39
#define LCD_D1  40
#define LCD_D2  41
#define LCD_D3  42
#define LCD_D4  45
#define LCD_D5  46
#define LCD_D6  47
#define LCD_D7  48

// ── Parallel control signals ──────────────────────────────────────────────────
#define LCD_WR   8   // Write strobe
#define LCD_RD   9   // Read strobe
#define LCD_DC   7   // Data/Command select
#define LCD_CS   6   // Chip select
#define LCD_RST  5   // Hardware reset

// ── Backlight & power ─────────────────────────────────────────────────────────
#define LCD_BL   38  // Backlight PWM
#define PWR_EN   15  // LCD power enable (active HIGH on T-Display-S3)

// ── Backlight PWM (ESP32 LEDC) ────────────────────────────────────────────────
#define TFT_PWM_CHANNEL     0
#define TFT_PWM_FREQ        5000   // Hz
#define TFT_PWM_RESOLUTION  8      // bits -> duty 0..255

#ifndef TFT_DEFAULT_BRIGHTNESS
#define TFT_DEFAULT_BRIGHTNESS 100
#endif

// ── Physical TFT resolution (landscape 320x170) ───────────────────────────────
#define DISPLAY_WIDTH  320
#define DISPLAY_HEIGHT 170

// ── SCREEN aliases (used by text/layout code) ─────────────────────────────────
#define SCREEN_WIDTH   DISPLAY_WIDTH
#define SCREEN_HEIGHT  DISPLAY_HEIGHT

// ── Serial ────────────────────────────────────────────────────────────────────
#define SERIAL_BAUD         921600
#define SERIAL_BUFFER_SIZE  65536  // must hold FRAME: + binary payload + \n

// ── WiFi (reserved for future use) ───────────────────────────────────────────
#define WIFI_SERVER_PORT 80

// ── Idle orchestration timings (milliseconds) ─────────────────────────────────
#define BLINK_MIN_INTERVAL_MS   12000UL
#define BLINK_MAX_INTERVAL_MS   30000UL
#define BLINK_COOLDOWN_MS       10000UL

#define VARIATION_MIN_INTERVAL_MS  300000UL
#define VARIATION_MAX_INTERVAL_MS  480000UL

// ── Animation ─────────────────────────────────────────────────────────────────
#define DEFAULT_FPS   12
// 320 * 170 * 2 bytes RGB565 LE
#define FRAME_BYTES  108800

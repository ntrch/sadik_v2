#pragma once

// ── TFT SPI pins (ST7735S, VSPI) ─────────────────────────────────────────────
#define TFT_CS    5
#define TFT_DC    4
#if SADIK_COLOR_S3
// ESP32-S3 N16R8 DevKitC-1: GPIO19/20 (USB), 22-25 yok, 26-32 OPI PSRAM rezerve.
// Default Arduino SPI bus (FSPI) S3'te şu pinleri kullanır → TFT'yi bunlara lehimle.
#define TFT_RST   8   // S3 free GPIO
#define TFT_MOSI 11   // S3 default FSPI MOSI (= TFT SDA)
#define TFT_SCK  12   // S3 default FSPI SCK  (= TFT SCL)
#else
// ESP32-WROOM-32: VSPI default
#define TFT_RST  22
#define TFT_MOSI 23   // VSPI MOSI (= TFT SDA)
#define TFT_SCK  18   // VSPI SCK
#endif
#define TFT_BLK  16   // Backlight PWM (her iki kartta da free)

// ── Backlight PWM (ESP32 LEDC) ────────────────────────────────────────────────
#define TFT_PWM_CHANNEL     0
#define TFT_PWM_FREQ        5000   // Hz — above audible, below PWM resolution limit
#define TFT_PWM_RESOLUTION  8      // bits → duty range 0..255

// Default brightness 0..255. Lower = darker blacks (less backlight bleed),
// but overall screen dimmer. 100 is a good starting point.
#ifndef TFT_DEFAULT_BRIGHTNESS
#define TFT_DEFAULT_BRIGHTNESS 100
#endif

// ── ST7735S init tab variant ──────────────────────────────────────────────────
// INITR_BLACKTAB is correct for most 160×128 modules.
// If you see colour offset or wrong dimensions on first boot, try
// INITR_GREENTAB or INITR_REDTAB by passing -DTFT_INIT_TAB=INITR_GREENTAB
// in build_flags.
#ifndef TFT_INIT_TAB
#define TFT_INIT_TAB INITR_BLACKTAB
#endif

// ── SPI clock speed ──────────────────────────────────────────────────────────
// Adafruit_ST7735 default is ~8–15 MHz. ST7735S safely runs 27 MHz,
// often 40 MHz on short wiring. Higher = faster blit = less tearing.
// Override with -DTFT_SPI_HZ=20000000 in build_flags if you see glitches.
#ifndef TFT_SPI_HZ
#define TFT_SPI_HZ 40000000UL
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
#define SERIAL_BAUD         921600
#define SERIAL_BUFFER_SIZE  65536  // must hold FRAME: + 40960 binary bytes + \n

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
#define FRAME_BYTES  40960  // 160 * 128 * 2 bytes RGB565 LE

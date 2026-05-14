#pragma once

#include <Arduino.h>
#include <LovyanGFX.hpp>
#include "config.h"
#include "rtos_tasks.h"

// =============================================================================
// LGFX_Custom — LovyanGFX config for ST7789 320×170 on T-Display-S3
//
// Pin map (from config.h, v3 branch):
//   D0-D7 = 39,40,41,42,45,46,47,48
//   WR    =  8   (Write strobe)
//   RD    =  9   (Read strobe)
//   DC    =  7   (Data/Command)
//   CS    =  6   (Chip select)
//   RST   =  5   (Hardware reset)
//   BL    = 38   (Backlight PWM)
//   PWR_EN= 15   (LCD power enable, active HIGH)
//
// Bus:   Bus_Parallel8  @ 20 MHz start
// Panel: Panel_ST7789
//
// Panel geometry (portrait-native, rotated to landscape):
//   panel_width  = 170  (short side)
//   panel_height = 320  (long side)
//   offset_x     = 35   (T-Display-S3: 240-wide GRAM, 170-wide panel, column start=35)
//   offset_y     = 0
//   offset_rotation = 0 (portrait native; setRotation(1) applied at runtime)
//
// Color order:
//   invert    = true   (ST7789 IPS panel needs inversion ON)
//   rgb_order = false  (RGB — ST7789 default)
//
// setSwapBytes(true): kanonik byte order — JPEGDEC emits LE host-native;
//   LovyanGFX expects BE over the bus → single global swap toggle (Sprint-8 verified).
// =============================================================================

class LGFX_Custom : public lgfx::LGFX_Device {
    lgfx::Panel_ST7789  _panel;
    lgfx::Bus_Parallel8 _bus;
    lgfx::Light_PWM     _light;
public:
    LGFX_Custom() {
        // ── 8-bit parallel bus config ──────────────────────────────────────────
        {
            auto cfg = _bus.config();
            cfg.freq_write = 20000000;  // 20 MHz start; tune after DIAG:GRADIENT pass
            cfg.pin_wr  = LCD_WR;
            cfg.pin_rd  = LCD_RD;
            cfg.pin_rs  = LCD_DC;       // rs = Data/Command (LovyanGFX naming)
            cfg.pin_d0  = LCD_D0;
            cfg.pin_d1  = LCD_D1;
            cfg.pin_d2  = LCD_D2;
            cfg.pin_d3  = LCD_D3;
            cfg.pin_d4  = LCD_D4;
            cfg.pin_d5  = LCD_D5;
            cfg.pin_d6  = LCD_D6;
            cfg.pin_d7  = LCD_D7;
            _bus.config(cfg);
            _panel.setBus(&_bus);
        }
        // ── Panel config ───────────────────────────────────────────────────────
        {
            auto cfg = _panel.config();
            cfg.pin_cs   = LCD_CS;
            cfg.pin_rst  = LCD_RST;
            cfg.pin_busy = -1;
            // Portrait-native dimensions; setRotation(1) at runtime → 320×170 landscape
            cfg.panel_width      = 170;
            cfg.panel_height     = 320;
            cfg.offset_x         = 35;   // T-Display-S3: GRAM is 240-wide; col start = (240-170)/2 = 35
            cfg.offset_y         = 0;
            cfg.offset_rotation  = 0;
            cfg.dummy_read_pixel = 8;
            cfg.dummy_read_bits  = 1;
            cfg.readable         = false;
            cfg.invert           = true;  // ST7789 IPS: invert ON
            cfg.rgb_order        = false; // RGB (not BGR)
            cfg.dlen_16bit       = false;
            cfg.bus_shared       = false;
            _panel.config(cfg);
        }
        // ── Backlight (LovyanGFX Light_PWM) ───────────────────────────────────
        {
            auto cfg = _light.config();
            cfg.pin_bl      = LCD_BL;
            cfg.invert      = false;
            cfg.freq        = TFT_PWM_FREQ;
            cfg.pwm_channel = TFT_PWM_CHANNEL;
            _light.config(cfg);
            _panel.setLight(&_light);
        }
        setPanel(&_panel);
    }
};

// RAII helper: takes tftMutex on construction, releases on destruction.
// Guards against the early-boot case where rtos_init() has not yet run and
// tftMutex is still nullptr (begin() is called before rtos_init()).
struct TftLock {
    TftLock()  { if (tftMutex) xSemaphoreTake(tftMutex, portMAX_DELAY); }
    ~TftLock() { if (tftMutex) xSemaphoreGive(tftMutex); }
};

// =============================================================================
// DisplayManager — ST7789 320×170 8-bit parallel (T-Display-S3)
//
// Single render path: RGB565 codec frames via pushFrameRgb565() / tile blits.
// Text drawing uses LovyanGFX built-in fonts.
// =============================================================================

// RGB565 colour constants used by the renderer
#define DM_WHITE 0xFFFF
#define DM_BLACK 0x0000

// Legacy framebuffer region aliases — full-screen on 320×170
#define LEGACY_FB_OFFSET_X  0
#define LEGACY_FB_OFFSET_Y  0
#define LEGACY_FB_WIDTH     DISPLAY_WIDTH
#define LEGACY_FB_HEIGHT    DISPLAY_HEIGHT

class DisplayManager {
public:
    DisplayManager()
        : _currentBrightness(TFT_DEFAULT_BRIGHTNESS),
          _sleeping(false)
    {}

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    // Initialise power rail, parallel bus and TFT controller.
    void begin() {
        // PWR_EN must be asserted before any bus activity — panel is dead otherwise.
        pinMode(PWR_EN, OUTPUT);
        digitalWrite(PWR_EN, HIGH);

        TftLock _lock;
        _tft.init();
        // landscape 320×170 (rotation=1 on portrait-native panel)
        _tft.setRotation(1);
        // kanonik byte order: JPEGDEC emits LE host-native; LovyanGFX needs BE
        // on the bus → single global swap handles both. Sprint-8 verified.
        _tft.setSwapBytes(true);
        _tft.fillScreen(DM_BLACK);
        // Bring backlight up after init to avoid flash during panel reset
        _tft.setBrightness(_currentBrightness);

        Serial.print("BOOT:OK display=ST7789 320x170 parallel8 brightness=");
        Serial.println(_currentBrightness);
    }

    // ── Compatibility stubs (text path writes directly to TFT) ────────────────
    void clear() {}       // no-op
    void sendBuffer() {}  // no-op

    // ── Brightness / power ────────────────────────────────────────────────────

    // Backlight brightness 0..255 via LovyanGFX Light_PWM.
    void setBrightness(uint8_t value) {
        _currentBrightness = value;
        if (!_sleeping) {
            _tft.setBrightness(value);
        }
    }

    uint8_t getBrightness() const {
        return _currentBrightness;
    }

    // Sleep: blank the panel and cut backlight.
    void sleepDisplay() {
        if (_sleeping) return;
        _sleeping = true;
        {
            TftLock _lock;
            _tft.fillScreen(DM_BLACK);
        }
        _tft.setBrightness(0);
    }

    // Wake: restore backlight to user-set brightness.
    void wakeDisplay() {
        if (!_sleeping) return;
        _sleeping = false;
        {
            TftLock _lock;
            _tft.fillScreen(DM_BLACK);
        }
        _tft.setBrightness(_currentBrightness);
    }

    bool isSleeping() const {
        return _sleeping;
    }

    // Force-clear the entire physical TFT to black.
    void clearScreen() {
        if (_sleeping) return;
        TftLock _lock;
        _tft.fillScreen(DM_BLACK);
    }

    // ── Text helpers ──────────────────────────────────────────────────────────
    //
    // Text rendering uses LovyanGFX built-in Font0 (6×8 px per char),
    // scaled via setTextSize(). Four sizes:
    //   24 → setTextSize(3)  — 18×24 px
    //   18 → setTextSize(2)  — 12×16 px
    //   12 → setTextSize(2)  — same bucket
    //    8 → setTextSize(1)  —  6×8  px

    struct FontEntry {
        uint8_t size;    // text size multiplier
        uint8_t height;  // approx pixel height (for vertical centering)
    };

    static constexpr int FONT_COUNT = 4;

    const FontEntry* fontTable() const {
        static const FontEntry table[FONT_COUNT] = {
            { 3, 24 },
            { 2, 18 },
            { 2, 12 },
            { 1,  8 },
        };
        return table;
    }

    // Pick the largest text size whose rendered width fits within maxW.
    const FontEntry& pickFont(const char* text, int16_t maxW = SCREEN_WIDTH - 4) {
        const FontEntry* ft = fontTable();
        for (int i = 0; i < FONT_COUNT - 1; i++) {
            int16_t w = static_cast<int16_t>(strlen(text)) * 6 * ft[i].size;
            if (w <= maxW) return ft[i];
        }
        return ft[FONT_COUNT - 1];
    }

    // Draw a single centred line of auto-sized text.
    void drawText(const char* text) {
        TftLock _lock;
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);

        const FontEntry& fe = pickFont(text);
        _tft.setTextSize(fe.size);
        _tft.setTextColor(DM_WHITE, DM_BLACK);
        _tft.setFont(&lgfx::fonts::Font0);

        int16_t charW = 6 * fe.size;
        int16_t charH = 8 * fe.size;
        int16_t w = static_cast<int16_t>(strlen(text)) * charW;
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)     / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH) / 2;

        _tft.setCursor(x, y);
        _tft.print(text);
    }

    // Draw a single centred line where each character gets its own RGB565 colour.
    void drawRainbowText(const char* text, uint8_t size = 3) {
        TftLock _lock;
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);
        _tft.setTextSize(size);
        _tft.setFont(&lgfx::fonts::Font0);

        static const uint16_t palette[] = {
            0xF800, // red
            0xFD20, // orange
            0xFFE0, // yellow
            0x07E0, // green
            0x07FF, // cyan
            0x001F, // blue
            0xF81F, // magenta
        };
        const int paletteLen = sizeof(palette) / sizeof(palette[0]);

        int16_t charW = 6 * size;
        int16_t charH = 8 * size;
        int16_t n = static_cast<int16_t>(strlen(text));
        int16_t w = n * charW;
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)     / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH) / 2;

        for (int16_t i = 0; i < n; i++) {
            _tft.setTextColor(palette[i % paletteLen], DM_BLACK);
            _tft.setCursor(x + i * charW, y);
            _tft.print(text[i]);
        }
    }

    // Draw a single centred line in the largest text size.
    void drawTextLarge(const char* text) {
        TftLock _lock;
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);
        _tft.setTextSize(3);
        _tft.setTextColor(DM_WHITE, DM_BLACK);
        _tft.setFont(&lgfx::fonts::Font0);

        int16_t charW = 6 * 3;
        int16_t charH = 8 * 3;
        int16_t w = static_cast<int16_t>(strlen(text)) * charW;
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)     / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH) / 2;

        _tft.setCursor(x, y);
        _tft.print(text);
    }

    // Draw two centred lines of auto-sized text.
    void drawTwoLineText(const char* line1, const char* line2) {
        TftLock _lock;
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);

        const FontEntry& fe1 = pickFont(line1);
        const FontEntry& fe2 = pickFont(line2);
        const FontEntry* fe = (fe1.height <= fe2.height) ? &fe1 : &fe2;
        const FontEntry* ft = fontTable();
        for (int i = 0; i < FONT_COUNT; i++) {
            if (ft[i].height <= fe->height) {
                int16_t charH = 8 * ft[i].size;
                if (charH * 2 + 6 <= LEGACY_FB_HEIGHT) {
                    fe = &ft[i];
                    break;
                }
            }
        }

        _tft.setTextSize(fe->size);
        _tft.setTextColor(DM_WHITE, DM_BLACK);
        _tft.setFont(&lgfx::fonts::Font0);

        int16_t charW = 6 * fe->size;
        int16_t charH = 8 * fe->size;
        int16_t gap   = 6;
        int16_t totalH = charH * 2 + gap;
        int16_t y1 = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - totalH) / 2;
        int16_t y2 = y1 + charH + gap;

        int16_t w1 = static_cast<int16_t>(strlen(line1)) * charW;
        int16_t w2 = static_cast<int16_t>(strlen(line2)) * charW;

        _tft.setCursor(LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH - w1) / 2, y1);
        _tft.print(line1);
        _tft.setCursor(LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH - w2) / 2, y2);
        _tft.print(line2);
    }

    // Push a 108800-byte RGB565 LE frame (320×170) directly to the TFT.
    // Used by CMD_FRAME_DATA (desktop app streaming raw frames over serial).
    void pushFrameRgb565(const uint8_t* buf) {
        if (_sleeping) return;
        TftLock _lock;
        _tft.pushImage(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT,
                       reinterpret_cast<const uint16_t*>(buf));
    }

    // Alias so any remaining call sites still compile.
    void showRawFrame(const uint8_t* buf) { pushFrameRgb565(buf); }

    // ── Codec decoder access ──────────────────────────────────────────────────
    // Expose raw LCD pointer so mjpeg_player.h can call pushImage directly
    // for partial tile updates.
    LGFX_Custom* tft() { return &_tft; }

private:
    LGFX_Custom _tft;

    uint8_t _currentBrightness;
    bool    _sleeping;
};

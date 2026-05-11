#pragma once

#include <Arduino.h>
#include <LovyanGFX.hpp>
#include "config.h"
#include "rtos_tasks.h"

// =============================================================================
// LGFX_Custom — LovyanGFX config for ST7735S 160×128 on ESP32-S3 N16R8
//
// Pin map (from config.h, S3 branch):
//   SCK  = 12  (FSPI SCK  / TFT SCL)
//   MOSI = 11  (FSPI MOSI / TFT SDA)
//   DC   =  4
//   CS   =  5
//   RST  =  8
//   MISO = -1  (write-only panel)
//
// SPI host:   SPI2_HOST  (FSPI on S3)
// Write freq: 40 MHz     (matches TFT_SPI_HZ)
// Read  freq: 16 MHz     (safe default for ST7735S)
//
// Panel geometry:
//   panel_width  = 128 (short side)
//   panel_height = 160 (long side — physical chip orientation)
//   offset_rotation = 1 → landscape 160 wide × 128 tall
//     (mirrors Adafruit setRotation(1))
//
// Color order:
//   rgb_order = false  → RGB (not BGR)
//   Standard for INITR_BLACKTAB + Adafruit default, verified by
//   writePixels(..., bigEndian=false) path (byte order not R/G/B order).
//
// invert = false  (INITR_BLACKTAB does not set display inversion)
// =============================================================================

class LGFX_Custom : public lgfx::LGFX_Device {
    lgfx::Panel_ST7735S _panel;
    lgfx::Bus_SPI       _bus;
public:
    LGFX_Custom() {
        // ── SPI bus config ─────────────────────────────────────────────────
        {
            auto cfg = _bus.config();
            cfg.spi_host    = SPI2_HOST;
            cfg.spi_mode    = 0;
            cfg.freq_write  = 40000000;   // TFT_SPI_HZ
            cfg.freq_read   = 16000000;
            cfg.pin_sclk    = TFT_SCK;    // 12
            cfg.pin_mosi    = TFT_MOSI;   // 11
            cfg.pin_miso    = -1;
            cfg.pin_dc      = TFT_DC;     // 4
            cfg.use_lock    = true;
            cfg.dma_channel = SPI_DMA_CH_AUTO;
            _bus.config(cfg);
            _panel.setBus(&_bus);
        }
        // ── Panel config ───────────────────────────────────────────────────
        {
            auto cfg = _panel.config();
            cfg.pin_cs          = TFT_CS;    // 5
            cfg.pin_rst         = TFT_RST;   // 8
            cfg.pin_busy        = -1;
            cfg.panel_width     = 128;
            cfg.panel_height    = 160;
            cfg.offset_x        = 0;
            cfg.offset_y        = 0;
            cfg.offset_rotation = 1;   // landscape 160×128 — matches Adafruit setRotation(1)
            cfg.dummy_read_pixel = 8;
            cfg.dummy_read_bits  = 1;
            cfg.readable        = false;
            cfg.invert          = false;
            cfg.rgb_order       = false;  // RGB (not BGR) — matches INITR_BLACKTAB
            cfg.dlen_16bit      = false;
            cfg.bus_shared      = false;
            _panel.config(cfg);
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

// ─────────────────────────────────────────────────────────────────────────────
// DisplayManager — Color Sprint-8: ST7735S SPI TFT (160×128 landscape)
//
// Single render path: RGB565 codec frames via pushFrameRgb565() / tile blits.
// Text drawing uses LovyanGFX built-in fonts.
// ─────────────────────────────────────────────────────────────────────────────

// RGB565 colour constants used by the renderer
#define DM_WHITE 0xFFFF
#define DM_BLACK 0x0000

class DisplayManager {
public:
    DisplayManager()
        : _currentBrightness(TFT_DEFAULT_BRIGHTNESS),
          _sleeping(false)
    {}

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    // Initialise SPI bus and TFT controller.
    void begin() {
        TftLock _lock;
        // Backlight PWM setup BEFORE TFT init so the panel never flashes at full
        // brightness during boot.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcAttach(TFT_BLK, TFT_PWM_FREQ, TFT_PWM_RESOLUTION);
#else
        ledcSetup(TFT_PWM_CHANNEL, TFT_PWM_FREQ, TFT_PWM_RESOLUTION);
        ledcAttachPin(TFT_BLK, TFT_PWM_CHANNEL);
#endif
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(TFT_BLK, _currentBrightness);
#else
        ledcWrite(TFT_PWM_CHANNEL, _currentBrightness);
#endif

        _tft.init();
        _tft.fillScreen(DM_BLACK);

        Serial.print("BOOT:OK display=ST7735S 160x128 lgfx spi=");
        Serial.print(TFT_SPI_HZ);
        Serial.print(" brightness=");
        Serial.println(_currentBrightness);
    }

    // ── Compatibility stubs (used by TextRenderer; no-ops now that the 1-bit
    //    framebuffer is removed — text methods write directly to TFT) ───────────
    void clear() {}       // safe no-op for text path
    void sendBuffer() {}  // text draws direct to TFT

    // ── Brightness / power ────────────────────────────────────────────────────

    // Backlight brightness 0..255 via PWM on TFT_BLK pin.
    void setBrightness(uint8_t value) {
        _currentBrightness = value;
        if (!_sleeping) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
            ledcWrite(TFT_BLK, value);
#else
            ledcWrite(TFT_PWM_CHANNEL, value);
#endif
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
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(TFT_BLK, 0);
#else
        ledcWrite(TFT_PWM_CHANNEL, 0);
#endif
    }

    // Wake: restore backlight to user-set brightness.
    void wakeDisplay() {
        if (!_sleeping) return;
        _sleeping = false;
        {
            TftLock _lock;
            _tft.fillScreen(DM_BLACK);
        }
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(TFT_BLK, _currentBrightness);
#else
        ledcWrite(TFT_PWM_CHANNEL, _currentBrightness);
#endif
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

    // ── Text helpers ─────────────────────────────────────────────────────────
    //
    // Text rendering uses LovyanGFX built-in Font0 (6×8 px per char),
    // scaled via setTextSize(). Font0 matches the old Adafruit GFX default font.
    // Four sizes:
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
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)      / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH)  / 2;

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
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)      / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH)  / 2;

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

    // Push a 40960-byte RGB565 LE frame (160×128) directly to the TFT.
    // Used by CMD_FRAME_DATA (desktop app streaming raw frames over serial).
    void pushFrameRgb565(const uint8_t* buf) {
        if (_sleeping) return;
        TftLock _lock;
        // LovyanGFX pushImage accepts RGB565 LE (uint16_t*) directly.
        // No byte-swap needed — pushImage handles endianness internally.
        _tft.pushImage(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT,
                       reinterpret_cast<const uint16_t*>(buf));
    }

    // Alias so any remaining call sites still compile.
    void showRawFrame(const uint8_t* buf) { pushFrameRgb565(buf); }

    // ── Codec decoder access ───────────────────────────────────────────────
    // Expose raw LCD pointer so mjpeg_player.h can call pushImage directly
    // for partial tile updates.
    LGFX_Custom* tft() { return &_tft; }

private:
    LGFX_Custom _tft;

    uint8_t _currentBrightness;
    bool    _sleeping;
};

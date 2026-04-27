#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include "config.h"
#include "rtos_tasks.h"

// RAII helper: takes tftMutex on construction, releases on destruction.
// Guards against the early-boot case where rtos_init() has not yet run and
// tftMutex is still nullptr (begin() is called before rtos_init()).
struct TftLock {
    TftLock()  { if (tftMutex) xSemaphoreTake(tftMutex, portMAX_DELAY); }
    ~TftLock() { if (tftMutex) xSemaphoreGive(tftMutex); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DisplayManager — Faz 1: ST7735S SPI TFT (160×128 landscape)
//
// Public API is identical to the original U8g2/OLED version so that
// ClipPlayer, TextRenderer, IdleOrchestrator and SerialCommander compile
// without any modification.
//
// Internal changes:
//   • U8g2 replaced by Adafruit_ST7735
//   • 128×64 monochrome framebuffer kept in RAM (1024 bytes)
//   • drawFrame / drawXBM / drawPixel write to the internal buffer
//   • sendBuffer() converts the 1-bit buffer to RGB565 and pushes it to
//     the TFT, centred at offset (LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y)
//   • Text drawing uses Adafruit_GFX built-in fonts, mapping the same
//     height-based font selection used by the OLED code
// ─────────────────────────────────────────────────────────────────────────────

// RGB565 colour constants used by the renderer
#define DM_WHITE 0xFFFF
#define DM_BLACK 0x0000

class DisplayManager {
public:
    DisplayManager()
        // SPI bus: WROOM-32 uses VSPI (SPI3), S3 uses FSPI (SPI2). GPIO18/23 are valid on both — default Arduino SPI object handles the mapping.
        : _tft(TFT_CS, TFT_DC, TFT_RST),   // 3-arg = hardware SPI (VSPI)
          _currentBrightness(TFT_DEFAULT_BRIGHTNESS),
          _sleeping(false),
          _fbDirty(false)
    {
        memset(_fb, 0, sizeof(_fb));
    }

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

        _tft.initR(TFT_INIT_TAB);
        _tft.setSPISpeed(TFT_SPI_HZ);
        _tft.setRotation(1);          // landscape: 160 wide × 128 tall
        _tft.fillScreen(DM_BLACK);

        Serial.print("BOOT:OK display=ST7735S 160x128 tab=BLACK spi=");
        Serial.print(TFT_SPI_HZ);
        Serial.print(" brightness=");
        Serial.println(_currentBrightness);
    }

    // ── Buffer operations ─────────────────────────────────────────────────────

    // Clear the internal 1-bit framebuffer and reset the dirty flag.
    void clear() {
        memset(_fb, 0, sizeof(_fb));
        _fbDirty = false;
    }

    // Render a 1024-byte PROGMEM bitmap into the internal framebuffer.
    // Format: horizontal byte order, MSB = leftmost pixel.
    //   byteIndex = row * 16 + col / 8
    //   bit       = 7 - (col % 8)
    //   pixel on  = (byte >> bit) & 1
    void drawFrame(const uint8_t* frameData) {
        memset(_fb, 0, sizeof(_fb));
        for (uint8_t row = 0; row < LEGACY_FB_HEIGHT; row++) {
            for (uint8_t col = 0; col < LEGACY_FB_WIDTH; col++) {
                uint16_t byteIndex = (uint16_t)row * 16 + col / 8;
                uint8_t  bitIndex  = 7 - (col & 0x07);
                uint8_t  byteVal   = pgm_read_byte(&frameData[byteIndex]);
                if ((byteVal >> bitIndex) & 1) {
                    _setPixelFB(col, row);
                }
            }
        }
        _fbDirty = true;
    }

    // Push the internal framebuffer to the physical TFT.
    // Only executes if drawFrame() set the dirty flag; text-draw methods do NOT
    // set the flag, so a sendBuffer() call after drawText/drawTwoLineText is a
    // safe no-op (the text is already on the TFT from those methods directly).
    //
    // Implementation: keep the SPI transaction open for the entire frame
    // (one startWrite / endWrite pair) and push pixels in 128-pixel row bursts
    // via writePixels().  This avoids 8192 individual CS-toggle transactions
    // that pushColor() would cause, which garbled the display.
    void sendBuffer() {
        if (_sleeping || !_fbDirty) return;
        _fbDirty = false;
        TftLock _lock;

        // Full 128×64 RGB565 framebuffer (16 KB, static BSS — one-time alloc)
        static uint16_t _rgbFrame[LEGACY_FB_WIDTH * LEGACY_FB_HEIGHT];

        // Expand 1-bit → 16-bit in RAM first (tight CPU loop, ~100 µs on ESP32)
        uint16_t* out = _rgbFrame;
        for (uint16_t row = 0; row < LEGACY_FB_HEIGHT; row++) {
            const uint8_t* rowPtr = _fb + row * 16;
            for (uint16_t col = 0; col < LEGACY_FB_WIDTH; col++) {
                uint8_t bitIndex = 7 - (col & 0x07);
                *out++ = ((rowPtr[col >> 3] >> bitIndex) & 1) ? DM_WHITE : DM_BLACK;
            }
        }

        // Single big SPI burst — one setAddrWindow, one writePixels, no gaps
        static bool _blitTimingLogged = false;
        uint32_t t0 = _blitTimingLogged ? 0 : micros();

        _tft.startWrite();
        _tft.setAddrWindow(
            LEGACY_FB_OFFSET_X,
            LEGACY_FB_OFFSET_Y,
            LEGACY_FB_WIDTH,
            LEGACY_FB_HEIGHT
        );
        _tft.writePixels(_rgbFrame, LEGACY_FB_WIDTH * LEGACY_FB_HEIGHT);
        _tft.endWrite();

        if (!_blitTimingLogged) {
            uint32_t elapsed = micros() - t0;
            Serial.print("DIAG:BLIT us=");
            Serial.println(elapsed);
            _blitTimingLogged = true;
        }
    }

    // ── Brightness / power ────────────────────────────────────────────────────

    // Backlight brightness 0..255 via PWM on TFT_BLK pin.
    // 0   = backlight off (panel dark)
    // 255 = max brightness (may wash out blacks)
    // Recommended range: 60..140 for good black levels.
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

    // Sleep: fade backlight to zero and blank the panel.
    // This is a true "screen off" — with PWM at 0 the panel goes fully dark.
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

    // Wake: restore backlight to user-set brightness; next sendBuffer() repaints.
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

    // Force-clear the entire physical TFT to black. Used to wipe lingering
    // pixels from the codec full-screen path before legacy ClipPlayer (which
    // only paints a 128×64 sub-region) takes over.
    void clearScreen() {
        if (_sleeping) return;
        TftLock _lock;
        _tft.fillScreen(DM_BLACK);
        _fbDirty = false;
    }

    // ── Text helpers (used by TextRenderer) ──────────────────────────────────
    //
    // Text rendering uses Adafruit_GFX built-in fonts mapped to four sizes.
    // The original OLED code had four U8g2 helvetica-bold fonts at heights
    // 8 / 12 / 18 / 24.  We map these to the closest Adafruit GFX sizes:
    //   24 → setTextSize(3)  — each char 18×24 px (6×8 base × 3)
    //   18 → setTextSize(2)  — each char 12×16 px
    //   12 → setTextSize(2)  — same bucket (no intermediate size)
    //    8 → setTextSize(1)  — each char  6×8 px
    //
    // All text is drawn directly to the TFT (not through the 1-bit FB) because
    // the GFX library has no off-screen buffer mode.  This matches behaviour:
    // TextRenderer always calls clear()+draw*()+sendBuffer() in sequence, so
    // nothing is lost.

    struct FontEntry {
        uint8_t size;    // Adafruit GFX text size multiplier
        uint8_t height;  // approx pixel height (used for vertical centering)
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
    // Returns a reference to the chosen FontEntry.
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
        // Clear the legacy FB area on the TFT
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);

        const FontEntry& fe = pickFont(text);
        _tft.setTextSize(fe.size);
        _tft.setTextColor(DM_WHITE, DM_BLACK);

        int16_t charW = 6 * fe.size;
        int16_t charH = 8 * fe.size;
        int16_t w = static_cast<int16_t>(strlen(text)) * charW;
        int16_t x = LEGACY_FB_OFFSET_X + (LEGACY_FB_WIDTH  - w)      / 2;
        int16_t y = LEGACY_FB_OFFSET_Y + (LEGACY_FB_HEIGHT - charH)  / 2;

        _tft.setCursor(x, y);
        _tft.print(text);
    }

    // Draw a single centred line where each character gets its own RGB565 colour.
    // Used for the COLOR boot splash so the operator can confirm at a glance
    // that the renk-supporting firmware is flashed.
    void drawRainbowText(const char* text, uint8_t size = 3) {
        TftLock _lock;
        _tft.fillRect(LEGACY_FB_OFFSET_X, LEGACY_FB_OFFSET_Y,
                      LEGACY_FB_WIDTH, LEGACY_FB_HEIGHT, DM_BLACK);
        _tft.setTextSize(size);

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
        // Pick the smaller of the two so both fit
        const FontEntry* fe = (fe1.height <= fe2.height) ? &fe1 : &fe2;
        // Ensure two rows fit in LEGACY_FB_HEIGHT
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
        _tft.startWrite();
        _tft.setAddrWindow(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
        // buf is RGB565 little-endian; writePixels with bigEndian=false swaps each
        // uint16 from LE to the SPI big-endian order the panel expects.
        _tft.writePixels(reinterpret_cast<uint16_t*>(const_cast<uint8_t*>(buf)),
                         DISPLAY_WIDTH * DISPLAY_HEIGHT, /*bigEndian=*/false);
        _tft.endWrite();
    }

    // Kept as alias so any remaining call sites still compile.
    void showRawFrame(const uint8_t* buf) { pushFrameRgb565(buf); }

    // ── Codec decoder access ───────────────────────────────────────────────
    // Expose raw TFT pointer so codec_decode.cpp can call setAddrWindow /
    // writePixels directly for partial tile updates (Sprint-2 F3.3).
    Adafruit_ST7735* tft() { return &_tft; }

private:
    Adafruit_ST7735 _tft;

    // 1-bit framebuffer: 128 × 64 / 8 = 1024 bytes.
    // Byte layout: byteIndex = row * 16 + col / 8; bit = 7 - (col % 8).
    uint8_t _fb[LEGACY_FB_WIDTH * LEGACY_FB_HEIGHT / 8];

    uint8_t _currentBrightness;
    bool    _sleeping;
    bool    _fbDirty;   // true after drawFrame(); sendBuffer() is a no-op otherwise

    // Set a single pixel in the internal framebuffer.
    inline void _setPixelFB(uint8_t col, uint8_t row) {
        uint16_t byteIndex = (uint16_t)row * 16 + col / 8;
        uint8_t  bitIndex  = 7 - (col & 0x07);
        _fb[byteIndex] |= (1 << bitIndex);
    }
};

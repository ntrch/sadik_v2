#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include "config.h"

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
        : _tft(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCK, TFT_RST),
          _currentBrightness(127),
          _sleeping(false),
          _fbDirty(false)
    {
        memset(_fb, 0, sizeof(_fb));
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    // Initialise SPI bus and TFT controller.
    void begin() {
        _tft.initR(TFT_INIT_TAB);
        _tft.setRotation(1);          // landscape: 160 wide × 128 tall
        _tft.fillScreen(DM_BLACK);

        // Report to serial so the user can confirm the tab variant
        Serial.println("BOOT:OK display=ST7735S 160x128 tab=BLACK");
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

        static uint16_t _lineBuf[LEGACY_FB_WIDTH];

        _tft.startWrite();
        _tft.setAddrWindow(
            LEGACY_FB_OFFSET_X,
            LEGACY_FB_OFFSET_Y,
            LEGACY_FB_WIDTH,
            LEGACY_FB_HEIGHT
        );

        for (uint8_t row = 0; row < LEGACY_FB_HEIGHT; row++) {
            const uint8_t* rowPtr = _fb + (uint16_t)row * 16;
            for (uint8_t col = 0; col < LEGACY_FB_WIDTH; col++) {
                uint8_t bitIndex = 7 - (col & 0x07);
                _lineBuf[col] = ((rowPtr[col >> 3] >> bitIndex) & 1) ? DM_WHITE : DM_BLACK;
            }
            _tft.writePixels(_lineBuf, LEGACY_FB_WIDTH);
        }

        _tft.endWrite();
    }

    // ── Brightness / power ────────────────────────────────────────────────────

    // Brightness is stored for STATUS reporting. The ST7735S has no software
    // contrast register accessible via Adafruit_ST7735, so this is a no-op on
    // hardware (BLK pin is wired to 3.3V permanently).
    void setBrightness(uint8_t value) {
        _currentBrightness = value;
    }

    uint8_t getBrightness() const {
        return _currentBrightness;
    }

    // Sleep: blank the TFT and set the sleeping flag.
    // The ST7735S does not have a hardware display-off command in the
    // Adafruit library, so we blank to black to visually darken the panel.
    void sleepDisplay() {
        if (_sleeping) return;
        _sleeping = true;
        _tft.fillScreen(DM_BLACK);
    }

    // Wake: restore a blank frame; the next sendBuffer() will repaint.
    void wakeDisplay() {
        if (!_sleeping) return;
        _sleeping = false;
        _tft.fillScreen(DM_BLACK);
        // Repaint the borders (the 16-px left/right and 32-px top/bottom bars)
        // that frame the legacy FB area — they are always black, so fillScreen
        // already handles this.
    }

    bool isSleeping() const {
        return _sleeping;
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

    // Draw a single centred line in the largest text size.
    void drawTextLarge(const char* text) {
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

    // Decode a 1024-byte RAM frame and push it directly to the TFT.
    // Used by CMD_FRAME_DATA (desktop app streaming raw frames over serial).
    void showRawFrame(const uint8_t* data) {
        if (_sleeping) return;

        _tft.setAddrWindow(
            LEGACY_FB_OFFSET_X,
            LEGACY_FB_OFFSET_Y,
            LEGACY_FB_WIDTH,
            LEGACY_FB_HEIGHT
        );

        for (uint8_t row = 0; row < LEGACY_FB_HEIGHT; row++) {
            for (uint8_t col = 0; col < LEGACY_FB_WIDTH; col++) {
                uint16_t byteIndex = (uint16_t)row * 16 + col / 8;
                uint8_t  bitIndex  = 7 - (col & 0x07);
                uint16_t colour = ((data[byteIndex] >> bitIndex) & 1) ? DM_WHITE : DM_BLACK;
                _tft.pushColor(colour);
            }
        }
    }

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

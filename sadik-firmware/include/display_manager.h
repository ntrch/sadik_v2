#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "config.h"

// ─────────────────────────────────────────────────────────────────────────────
// DisplayManager
//
// Thin wrapper around U8g2 for the SH1106 128×64 I2C OLED.
// All public methods clear/compose the internal buffer; call sendBuffer() once
// per frame to push the buffer to the physical display.
// ─────────────────────────────────────────────────────────────────────────────

class DisplayManager {
public:
    DisplayManager()
        : _u8g2(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA),
          _currentBrightness(127),
          _sleeping(false) {}    // 127 = U8g2 SH1106 power-on default

    // Initialize I2C bus and display controller.
    void begin() {
        Wire.begin(OLED_SDA, OLED_SCL);
        _u8g2.begin();
    }

    // Clear the internal buffer (pixels go dark after the next sendBuffer()).
    void clear() {
        _u8g2.clearBuffer();
    }

    // Render a 1024-byte PROGMEM bitmap into the internal buffer.
    // Frame format: horizontal byte order, MSB = leftmost pixel.
    //   byteIndex = row * 16 + col / 8
    //   bit       = 7 - (col % 8)
    //   pixel on  = (byte >> bit) & 1
    void drawFrame(const uint8_t* frameData) {
        _u8g2.clearBuffer();
        for (uint8_t row = 0; row < SCREEN_HEIGHT; row++) {
            for (uint8_t col = 0; col < SCREEN_WIDTH; col++) {
                uint16_t byteIndex = (uint16_t)row * 16 + col / 8;
                uint8_t  bitIndex  = 7 - (col & 0x07);
                uint8_t  byteVal   = pgm_read_byte(&frameData[byteIndex]);
                if ((byteVal >> bitIndex) & 1) {
                    _u8g2.drawPixel(col, row);
                }
            }
        }
    }

    // Draw a single line of text centered on the display (small font).
    void drawText(const char* text) {
        _u8g2.clearBuffer();
        _u8g2.setFont(u8g2_font_6x10_tr);
        int16_t strWidth = _u8g2.getStrWidth(text);
        int16_t x = (SCREEN_WIDTH  - strWidth) / 2;
        int16_t y = SCREEN_HEIGHT / 2 + 4;   // baseline ≈ vertical center
        _u8g2.drawStr(x, y, text);
    }

    // Draw a single line of text centered on the display (large font).
    void drawTextLarge(const char* text) {
        _u8g2.clearBuffer();
        _u8g2.setFont(u8g2_font_10x20_tr);
        int16_t strWidth = _u8g2.getStrWidth(text);
        int16_t x = (SCREEN_WIDTH  - strWidth) / 2;
        int16_t y = SCREEN_HEIGHT / 2 + 8;
        _u8g2.drawStr(x, y, text);
    }

    // Draw two lines of text, each centered horizontally.
    // line1 baseline ≈ y=24, line2 baseline ≈ y=48.
    void drawTwoLineText(const char* line1, const char* line2) {
        _u8g2.clearBuffer();
        _u8g2.setFont(u8g2_font_6x10_tr);
        int16_t w1 = _u8g2.getStrWidth(line1);
        int16_t w2 = _u8g2.getStrWidth(line2);
        _u8g2.drawStr((SCREEN_WIDTH - w1) / 2, 24, line1);
        _u8g2.drawStr((SCREEN_WIDTH - w2) / 2, 48, line2);
    }

    // Push the internal buffer to the physical display.
    void sendBuffer() {
        _u8g2.sendBuffer();
    }

    // Set OLED contrast/brightness (0 = darkest, 255 = maximum).
    // SH1106 maps this value directly to the contrast register.
    void setBrightness(uint8_t value) {
        _currentBrightness = value;
        _u8g2.setContrast(value);
    }

    // Return the last brightness value set via setBrightness().
    // Reflects the boot default (127) until setBrightness() is called.
    uint8_t getBrightness() const {
        return _currentBrightness;
    }

    // Put the OLED panel into sleep mode.
    //
    // Two-stage sequence for reliable visual blanking on SH1106/SSD1306 clones:
    //   1. Zero the internal buffer and push it to panel RAM via sendBuffer().
    //      This writes 0x00 to every pixel so the screen is physically dark even
    //      on panels whose 0xAE (display-off) command does not fully extinguish
    //      the charge pump.
    //   2. Issue setPowerSave(1) which sends 0xAE — the hardware display-off
    //      command — to cut the panel's internal VCC/charge pump.
    //
    // Drawing can continue while sleeping; the pipeline resumes on wake.
    void sleepDisplay() {
        if (_sleeping) return;
        _sleeping = true;
        // Blank every pixel in panel RAM first.
        _u8g2.clearBuffer();
        _u8g2.sendBuffer();
        // Then issue the hardware display-off command (0xAE).
        _u8g2.setPowerSave(1);
    }

    // Restore the OLED from sleep mode.
    //
    //   1. Issue setPowerSave(0) which sends 0xAF — hardware display-on.
    //   2. Restore contrast to the saved level; some panels reset the contrast
    //      register during a power-save cycle.
    //   3. Push a clean blank frame so the first rendered frame after wake
    //      has no stale artefacts.  The animation pipeline overwrites this
    //      on the very next clipPlayer.update() tick.
    void wakeDisplay() {
        if (!_sleeping) return;
        _sleeping = false;
        // Hardware display-on (0xAF).
        _u8g2.setPowerSave(0);
        // Restore contrast in case the panel reset it during power-save.
        _u8g2.setContrast(_currentBrightness);
        // Send a blank frame so the display comes up in a defined clean state.
        _u8g2.clearBuffer();
        _u8g2.sendBuffer();
    }

    // True while the display is in power-save (sleep) mode.
    bool isSleeping() const {
        return _sleeping;
    }

private:
    U8G2_SH1106_128X64_NONAME_F_HW_I2C _u8g2;
    uint8_t _currentBrightness;
    bool    _sleeping;
};

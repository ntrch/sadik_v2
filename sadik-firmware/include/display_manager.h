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
        : _u8g2(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA) {}

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

private:
    U8G2_SH1106_128X64_NONAME_F_HW_I2C _u8g2;
};

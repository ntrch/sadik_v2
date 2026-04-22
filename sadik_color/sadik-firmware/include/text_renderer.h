#pragma once

#include <Arduino.h>
#include "display_manager.h"

// ─────────────────────────────────────────────────────────────────────────────
// TextRenderer
//
// Shows static text or timer strings on the OLED.
// Automatically detects a '\n' in the input and splits into two lines.
// ─────────────────────────────────────────────────────────────────────────────

class TextRenderer {
public:
    explicit TextRenderer(DisplayManager& display)
        : _display(display), _active(false) {
        _text[0] = '\0';
    }

    // Display arbitrary text.  If text contains '\n', the string is split and
    // rendered on two centered lines; otherwise centered on one line.
    void showText(const char* text) {
        strncpy(_text, text, sizeof(_text) - 1);
        _text[sizeof(_text) - 1] = '\0';

        _display.clear();

        char* newline = strchr(_text, '\n');
        if (newline) {
            *newline = '\0';                    // split in place
            _display.drawTwoLineText(_text, newline + 1);
            *newline = '\n';                    // restore (keeps _text intact)
        } else {
            _display.drawText(_text);
        }

        _display.sendBuffer();
        _active = true;
    }

    // Display a timer string (e.g. "25:00") in the large font.
    void showTimer(const char* timeStr) {
        strncpy(_text, timeStr, sizeof(_text) - 1);
        _text[sizeof(_text) - 1] = '\0';

        _display.clear();
        _display.drawTextLarge(_text);
        _display.sendBuffer();
        _active = true;
    }

    // Mark renderer as inactive (does not clear the display).
    void clear() {
        _active = false;
    }

    bool isActive() const { return _active; }

private:
    DisplayManager& _display;
    bool            _active;
    char            _text[256];
};

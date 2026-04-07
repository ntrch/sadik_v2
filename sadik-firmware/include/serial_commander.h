#pragma once

#include <Arduino.h>
#include "config.h"

// ─────────────────────────────────────────────────────────────────────────────
// Command types recognised by the firmware
// ─────────────────────────────────────────────────────────────────────────────

enum CommandType {
    CMD_NONE,
    CMD_PLAY_CLIP,        // PLAY_CLIP:<name>
    CMD_STOP_CLIP,        // STOP_CLIP
    CMD_SHOW_TEXT,        // SHOW_TEXT:<text>
    CMD_RETURN_TO_IDLE,   // RETURN_TO_IDLE
    CMD_PING,             // PING  → firmware replies "PONG"
    CMD_STATUS,           // STATUS → firmware replies with state summary
    CMD_SET_BRIGHTNESS,       // SET_BRIGHTNESS:<0-255>
    CMD_SET_SLEEP_TIMEOUT,    // SET_SLEEP_TIMEOUT_MS:<milliseconds>  (0 = disabled)
    CMD_FORCE_SLEEP,          // FORCE_SLEEP → immediately enter power-save (debug aid)
    CMD_APP_CONNECTED,        // APP_CONNECTED   → app becomes animation authority
    CMD_APP_DISCONNECTED,     // APP_DISCONNECTED → firmware resumes autonomous idle
    CMD_UNKNOWN
};

struct ParsedCommand {
    CommandType type;
    char        argument[128];
};

// ─────────────────────────────────────────────────────────────────────────────
// SerialCommander
//
// Non-blocking, line-oriented serial command parser.
// Characters are accumulated in an internal ring buffer; a complete command is
// ready when '\n' or '\r' is received.  Call hasCommand() every loop(), then
// getCommand() to consume the parsed result.
// ─────────────────────────────────────────────────────────────────────────────

class SerialCommander {
public:
    SerialCommander() : _head(0), _ready(false) {
        _buf[0]              = '\0';
        _parsed.type         = CMD_NONE;
        _parsed.argument[0]  = '\0';
    }

    void begin() {
        Serial.begin(SERIAL_BAUD);
        _reset();
    }

    // Read available bytes from the serial buffer (non-blocking).
    // Returns true when a complete line has been received and parsed.
    bool hasCommand() {
        if (_ready) return true;    // previous command not yet consumed

        while (Serial.available()) {
            char c = static_cast<char>(Serial.read());

            if (c == '\n' || c == '\r') {
                if (_head > 0) {
                    _buf[_head] = '\0';
                    _parse();
                    _head  = 0;
                    _ready = true;
                    return true;
                }
                // Ignore empty lines / bare CR+LF pairs
                continue;
            }

            if (_head < SERIAL_BUFFER_SIZE - 1) {
                _buf[_head++] = c;
            }
            // If buffer is full, silently discard the overflow byte.
        }

        return false;
    }

    // Consume the parsed command.  Must only be called after hasCommand()
    // returned true.
    ParsedCommand getCommand() {
        ParsedCommand result = _parsed;
        _parsed.type         = CMD_NONE;
        _parsed.argument[0]  = '\0';
        _ready               = false;
        return result;
    }

    // Send a response line back to the host.
    void sendResponse(const char* response) {
        Serial.println(response);
    }

private:
    char         _buf[SERIAL_BUFFER_SIZE];
    int          _head;
    bool         _ready;
    ParsedCommand _parsed;

    void _reset() {
        _head              = 0;
        _ready             = false;
        _parsed.type       = CMD_NONE;
        _parsed.argument[0] = '\0';
    }

    void _parse() {
        // Trim trailing whitespace
        int len = strlen(_buf);
        while (len > 0 && (_buf[len - 1] == ' ' || _buf[len - 1] == '\r')) {
            _buf[--len] = '\0';
        }

        _parsed.argument[0] = '\0';

        if (strncmp(_buf, "PLAY_CLIP:", 10) == 0) {
            _parsed.type = CMD_PLAY_CLIP;
            strncpy(_parsed.argument, _buf + 10, sizeof(_parsed.argument) - 1);
            _parsed.argument[sizeof(_parsed.argument) - 1] = '\0';

        } else if (strcmp(_buf, "STOP_CLIP") == 0) {
            _parsed.type = CMD_STOP_CLIP;

        } else if (strncmp(_buf, "SHOW_TEXT:", 10) == 0) {
            _parsed.type = CMD_SHOW_TEXT;
            strncpy(_parsed.argument, _buf + 10, sizeof(_parsed.argument) - 1);
            _parsed.argument[sizeof(_parsed.argument) - 1] = '\0';

        } else if (strcmp(_buf, "RETURN_TO_IDLE") == 0) {
            _parsed.type = CMD_RETURN_TO_IDLE;

        } else if (strcmp(_buf, "PING") == 0) {
            _parsed.type = CMD_PING;

        } else if (strcmp(_buf, "STATUS") == 0) {
            _parsed.type = CMD_STATUS;

        } else if (strncmp(_buf, "SET_BRIGHTNESS:", 15) == 0) {
            _parsed.type = CMD_SET_BRIGHTNESS;
            strncpy(_parsed.argument, _buf + 15, sizeof(_parsed.argument) - 1);
            _parsed.argument[sizeof(_parsed.argument) - 1] = '\0';

        } else if (strncmp(_buf, "SET_SLEEP_TIMEOUT_MS:", 21) == 0) {
            _parsed.type = CMD_SET_SLEEP_TIMEOUT;
            strncpy(_parsed.argument, _buf + 21, sizeof(_parsed.argument) - 1);
            _parsed.argument[sizeof(_parsed.argument) - 1] = '\0';

        } else if (strcmp(_buf, "FORCE_SLEEP") == 0) {
            _parsed.type = CMD_FORCE_SLEEP;

        } else if (strcmp(_buf, "APP_CONNECTED") == 0) {
            _parsed.type = CMD_APP_CONNECTED;

        } else if (strcmp(_buf, "APP_DISCONNECTED") == 0) {
            _parsed.type = CMD_APP_DISCONNECTED;

        } else {
            _parsed.type = CMD_UNKNOWN;
        }
    }
};

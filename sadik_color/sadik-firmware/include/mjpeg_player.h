#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <Adafruit_ST7735.h>
#include <TJpg_Decoder.h>
#include "psram_alloc.h"

// JPEG SOI marker = FF D8, EOI marker = FF D9.
// Read whole file once into PSRAM, then walk SOI→EOI segments per frame.

class MjpegPlayer {
public:
    void begin(Adafruit_ST7735* tft) {
        _tft = tft;
        if (!LittleFS.begin(false)) {
            Serial.println("LITTLEFS:MOUNT_FAIL");
            _ready = false;
            return;
        }
        // TJpgDec render callback: write decoded MCU into TFT
        TJpgDec.setJpgScale(1);
        TJpgDec.setSwapBytes(true);
        TJpgDec.setCallback(_tjpg_cb);
        _ready = true;
    }
    bool isReady()   const { return _ready; }
    bool isPlaying() const { return _isPlaying; }
    bool hasFinished() const { return _isFinished; }
    const char* currentClipName() const { return _isPlaying ? _clipName : nullptr; }

    bool play(const char* name, bool loop = false) {
        if (!_ready) return false;
        if (_buf) { psram_or_internal_free(_buf); _buf = nullptr; }
        char path[80];
        snprintf(path, sizeof(path), "/clips/%s.mjpeg", name);
        File f = LittleFS.open(path, "r");
        if (!f) {
            Serial.printf("MJPEG:NOT_FOUND name=%s\n", name);
            return false;
        }
        _bufLen = f.size();
        _buf = (uint8_t*)psram_or_internal_malloc(_bufLen, MALLOC_CAP_8BIT);
        if (!_buf) { f.close(); return false; }
        f.read(_buf, _bufLen);
        f.close();
        strncpy(_clipName, name, sizeof(_clipName)-1);
        _clipName[sizeof(_clipName)-1] = '\0';
        _loop       = loop;
        _isPlaying  = true;
        _isFinished = false;
        _pos        = 0;
        _frameIdx   = 0;
        _playStartMs = millis();
        Serial.printf("MJPEG:START name=%s bytes=%u\n", _clipName, (unsigned)_bufLen);
        return true;
    }

    void stop() {
        if (_buf) { psram_or_internal_free(_buf); _buf = nullptr; }
        _isPlaying  = false;
        _isFinished = false;
        _clipName[0] = '\0';
        Serial.println("MJPEG:STOP");
    }

    // Called every loop tick. Decodes 1 frame per FRAME_INTERVAL_MS, blits to TFT.
    void update() {
        if (!_isPlaying || !_buf) return;
        const uint32_t FRAME_INTERVAL_MS = 1000 / 24;
        uint32_t now = millis();
        uint32_t elapsed = now - _playStartMs;
        uint32_t expectedFrame = elapsed / FRAME_INTERVAL_MS;
        if (_frameIdx >= expectedFrame) return;  // wait for wall-clock

        // Find next SOI (FF D8)
        size_t soi = _find_marker(0xD8, _pos);
        if (soi == SIZE_MAX) { _on_eof(); return; }
        size_t eoi = _find_marker(0xD9, soi + 2);
        if (eoi == SIZE_MAX) { _on_eof(); return; }
        size_t frame_len = (eoi + 2) - soi;

        // Decode + blit
        s_active_tft = _tft;
        JRESULT rc = TJpgDec.drawJpg(0, 0, _buf + soi, frame_len);
        if (rc != JDR_OK && _frameIdx < 3) {
            // Log first few failures only (avoid spam on streaming corruption)
            Serial.printf("MJPEG:DECODE_FAIL frame=%lu rc=%d soi=%u len=%u\n",
                          (unsigned long)_frameIdx, (int)rc,
                          (unsigned)soi, (unsigned)frame_len);
        }
        _frameIdx++;
        _pos = eoi + 2;
    }

private:
    static Adafruit_ST7735* s_active_tft;
    static bool _tjpg_cb(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t* bitmap) {
        if (!s_active_tft) return false;
        if (y >= 128) return true;
        s_active_tft->drawRGBBitmap(x, y, bitmap, w, h);
        return true;
    }

    size_t _find_marker(uint8_t mk, size_t from) {
        // Scan for FF mk
        for (size_t i = from; i + 1 < _bufLen; i++) {
            if (_buf[i] == 0xFF && _buf[i+1] == mk) return i;
        }
        return SIZE_MAX;
    }

    void _on_eof() {
        if (_loop) {
            _pos        = 0;
            _frameIdx   = 0;
            _playStartMs = millis();
            return;
        }
        Serial.printf("[clip] done name=%s total_frames=%lu elapsed_ms=%lu\n",
                      _clipName, (unsigned long)_frameIdx,
                      (unsigned long)(millis() - _playStartMs));
        Serial.printf("MJPEG:DONE name=%s\n", _clipName);
        if (_buf) { psram_or_internal_free(_buf); _buf = nullptr; }
        _isPlaying  = false;
        _isFinished = true;
    }

    Adafruit_ST7735* _tft      = nullptr;
    bool     _ready            = false;
    bool     _isPlaying        = false;
    bool     _isFinished       = false;
    bool     _loop             = false;
    uint8_t* _buf              = nullptr;
    size_t   _bufLen           = 0;
    size_t   _pos              = 0;
    uint32_t _frameIdx         = 0;
    uint32_t _playStartMs      = 0;
    char     _clipName[64];
};

// Out-of-line static
inline Adafruit_ST7735* MjpegPlayer::s_active_tft = nullptr;

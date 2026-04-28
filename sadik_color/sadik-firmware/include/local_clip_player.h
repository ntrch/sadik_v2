#pragma once

#include <Arduino.h>
#include <LittleFS.h>
#include "psram_alloc.h"
#include "codec_decode.h"

// ─────────────────────────────────────────────────────────────────────────────
// LocalClipPlayer
//
// Reads a .bin codec file from LittleFS (/clips/<name>.bin) and pumps its
// bytes into codec_feed() every loop tick.  Reuses the existing codec decode
// pipeline — only the byte source differs from the UART streaming path.
//
// LittleFS mount failure is non-fatal: isReady() returns false and play()
// prints LOCAL_CLIP:NOT_READY.  On WROOM-32 builds with no LittleFS partition,
// begin() simply fails gracefully.
// ─────────────────────────────────────────────────────────────────────────────

static const size_t LOCAL_CLIP_READ_BUF_BYTES = 4096;

class LocalClipPlayer {
public:
    LocalClipPlayer()
        : _ready(false), _isPlaying(false), _isFinished(false), _loop(false),
          _readBuf(nullptr), _fileSize(0), _loopCount(0), _lastLoggedFrame(0),
          _clipStartMs(0), _framesAtStart(0) {
        _clipName[0] = '\0';
    }

    // Mount LittleFS; set _ready = mount success.
    // Allocates read buffer via psram_or_internal_malloc.
    inline void begin() {
        _readBuf = psram_or_internal_malloc(LOCAL_CLIP_READ_BUF_BYTES, MALLOC_CAP_8BIT);
        if (!_readBuf) {
            Serial.println("LOCAL_CLIP:BUF_ALLOC_FAIL");
        }

        if (!LittleFS.begin(/*formatOnFail=*/false)) {
            Serial.println("LITTLEFS:MOUNT_FAIL");
            _ready = false;
            return;
        }
        _ready = true;
    }

    // Returns true iff LittleFS mounted successfully.
    inline bool isReady() const {
        return _ready;
    }

    // Open /clips/<name>.bin and begin playback.
    // Returns false if not ready or file not found.
    inline bool play(const char* name, bool loop = false) {
        if (!_ready) {
            Serial.println("LOCAL_CLIP:NOT_READY");
            return false;
        }

        // Close any previously open file.
        if (_file) {
            _file.close();
        }
        _isPlaying  = false;
        _isFinished = false;

        // Build path — bound name to 48 chars to fit in 64-byte stack buffer:
        // "/clips/" (7) + name (48) + ".bin" (4) + '\0' (1) = 60 bytes max.
        char path[64];
        char safeName[49];
        strncpy(safeName, name, 48);
        safeName[48] = '\0';
        snprintf(path, sizeof(path), "/clips/%s.bin", safeName);

        _file = LittleFS.open(path, "r");
        if (!_file) {
            Serial.print("LOCAL_CLIP:NOT_FOUND name=");
            Serial.println(name);
            return false;
        }

        _fileSize = _file.size();
        strncpy(_clipName, safeName, sizeof(_clipName) - 1);
        _clipName[sizeof(_clipName) - 1] = '\0';
        _loop                = loop;
        _isPlaying           = true;
        _isFinished          = false;
        _clipStartMs         = millis();
        _playStartMs         = _clipStartMs;
        _framesAtStart       = codec_frames_applied();
        _loopCount           = 0;
        _lastLoggedFrame     = 0;

        Serial.print("LOCAL_CLIP:START name=");
        Serial.print(_clipName);
        Serial.print(" bytes=");
        Serial.println(_fileSize);

        return true;
    }

    // Close the file and clear flags (explicit stop, does NOT set _isFinished).
    inline void stop() {
        if (_file) {
            _file.close();
        }
        _isPlaying  = false;
        _isFinished = false;
        _loop       = false;
        _clipName[0] = '\0';
        Serial.println("LOCAL_CLIP:STOP");
    }

    // Pump bytes into codec_feed(); called every loop tick.
    //
    // FPS gate strategy (pending-frame, 24 fps hard):
    //   codec_feed() is called unconditionally every tick — the parser state
    //   machine must never be gated mid-packet (causes CRC failures).
    //   Gate is applied at the TFT-push layer only:
    //     1. codec_feed() decodes a complete frame → sets render-pending flag
    //        inside codec_decode (no TFT write yet).
    //     2. update() checks deadline each tick.  When deadline arrives,
    //        codec_flush_pending() pushes the frame to the TFT.
    //   This ensures the parser always drains the LittleFS buffer cleanly.
    //   Catch-up: if we are 3+ frames behind, clamp _clipStartMs so we don't
    //   burst forever after a stall.
    inline void update() {
        if (!_isPlaying || !_file) return;
        if (!_readBuf) return;

        const uint32_t TARGET_FPS        = 24;
        const uint32_t FRAME_INTERVAL_MS = 1000u / TARGET_FPS; // 41 ms

        uint32_t now           = millis();
        uint32_t elapsed       = now - _playStartMs;
        uint32_t framesEmitted = codec_frames_applied() - _framesAtStart;

        // Progress log every 10 frames (only for non-looping clips to avoid spam).
        if (!_loop && framesEmitted > 0 && (framesEmitted % 10) == 0 && framesEmitted != _lastLoggedFrame) {
            _lastLoggedFrame = framesEmitted;
            char buf[80];
            snprintf(buf, sizeof(buf), "[clip] progress name=%s frames=%lu elapsed_ms=%lu",
                     _clipName, (unsigned long)framesEmitted, (unsigned long)elapsed);
            Serial.println(buf);
        }

        // ── Step 1: flush pending frame if deadline has arrived ───────────────
        if (codec_has_pending()) {
            // Absolute target: when should the (framesEmitted+1)-th frame appear?
            uint32_t targetMs = _clipStartMs + (framesEmitted * 1000u / TARGET_FPS);

            // Catch-up guard: if we are 3+ frames behind, clamp start reference.
            int32_t behindMs = (int32_t)(now - targetMs);
            if (behindMs > (int32_t)(3 * FRAME_INTERVAL_MS)) {
                _clipStartMs = now - (framesEmitted * 1000u / TARGET_FPS);
                targetMs     = now;
            }

            if ((int32_t)(now - targetMs) >= 0) {
                // Deadline met — push frame to TFT.
                codec_flush_pending();
                // framesEmitted is stale after flush; re-read on next tick.
                return;
            }
            // Deadline not yet met — don't feed more data either (parser already
            // has a decoded frame; feeding would start the next packet but we
            // can't render it until this one is flushed first).
            return;
        }

        // ── Step 2: no pending frame — feed more bytes from LittleFS ─────────
        size_t n = _file.read(static_cast<uint8_t*>(_readBuf), LOCAL_CLIP_READ_BUF_BYTES);

        if (n > 0) {
            codec_feed(static_cast<const uint8_t*>(_readBuf), n);
        }

        if (n < LOCAL_CLIP_READ_BUF_BYTES) {
            // EOF reached (short read).
            if (_loop) {
                _file.seek(0);
                _loopCount++;
                // Re-anchor clip start for the new loop iteration so the gate
                // stays accurate across loop boundaries.
                _framesAtStart = codec_frames_applied();
                _clipStartMs   = millis();
                // Continue on next tick; nothing else to do here.
            } else {
                _file.close();
                _isPlaying  = false;
                _isFinished = true;
                char buf[80];
                snprintf(buf, sizeof(buf), "[clip] done name=%s total_frames=%lu elapsed_ms=%lu",
                         _clipName, (unsigned long)framesEmitted,
                         (unsigned long)(millis() - _playStartMs));
                Serial.println(buf);
                Serial.print("LOCAL_CLIP:DONE name=");
                Serial.println(_clipName);
            }
        }
    }

    // True while a clip is actively playing.
    inline bool isPlaying() const {
        return _isPlaying;
    }

    // True once after EOF reached (one-shot flag; cleared by stop() or play()).
    inline bool hasFinished() const {
        return _isFinished;
    }

    // Returns the clip name while playing, nullptr otherwise.
    inline const char* currentClipName() const {
        return _isPlaying ? _clipName : nullptr;
    }

private:
    bool     _ready;
    bool     _isPlaying;
    bool     _isFinished;
    bool     _loop;
    void*    _readBuf;
    File     _file;
    size_t   _fileSize;
    char     _clipName[64];
    uint32_t _playStartMs        = 0;
    uint32_t _clipStartMs        = 0;  // millis() anchor for absolute-deadline gate
    uint32_t _framesAtStart      = 0;
    uint32_t _loopCount          = 0;
    uint32_t _lastLoggedFrame    = 0;
};

#pragma once

#include <Arduino.h>
#include <LittleFS.h>
#include <esp_heap_caps.h>
#include "psram_alloc.h"
#include "codec_decode.h"
#include "rtos_tasks.h"   // TftLock / tftMutex

// ─────────────────────────────────────────────────────────────────────────────
// LocalClipPlayer
//
// Reads a .bin codec file from LittleFS (/clips/<name>.bin) and pumps its
// bytes into codec_feed() every loop tick.  Reuses the existing codec decode
// pipeline — only the byte source differs from the UART streaming path.
//
// Double-buffer architecture (PSRAM back/front):
//   _fbBack  — codec writes decoded frames here (via codec_set_back_buffer).
//   _fbFront — swapped in at deadline; blitted to TFT.
//   _renderPending — set by codec inside _apply_iframe/_apply_pframe; checked
//                    in update() to gate TFT push at 24fps deadlines.
//
// LittleFS mount failure is non-fatal: isReady() returns false and play()
// prints LOCAL_CLIP:NOT_READY.  On WROOM-32 builds with no LittleFS partition,
// begin() simply fails gracefully.
// ─────────────────────────────────────────────────────────────────────────────

static const size_t LOCAL_CLIP_READ_BUF_BYTES = 4096;
static const size_t LOCAL_CLIP_FB_BYTES       = CODEC_WIDTH * CODEC_HEIGHT * 2; // 40960

namespace {
// Reuse TftLock from codec_decode.cpp namespace — forward-declare tftMutex
// (defined in rtos_tasks.cpp) to keep the same mutex discipline.
struct ClipTftLock {
    ClipTftLock()  { if (tftMutex) xSemaphoreTake(tftMutex, portMAX_DELAY); }
    ~ClipTftLock() { if (tftMutex) xSemaphoreGive(tftMutex); }
};
} // anonymous namespace

class LocalClipPlayer {
public:
    LocalClipPlayer()
        : _ready(false), _isPlaying(false), _isFinished(false), _loop(false),
          _readBuf(nullptr), _fbBack(nullptr), _fbFront(nullptr),
          _fileSize(0), _loopCount(0), _lastLoggedFrame(0),
          _clipStartMs(0), _framesDecoded(0), _framesEmitted(0) {
        _clipName[0] = '\0';
    }

    // Mount LittleFS; set _ready = mount success.
    // Allocates read buffer and PSRAM double-framebuffers.
    inline void begin() {
        _readBuf = psram_or_internal_malloc(LOCAL_CLIP_READ_BUF_BYTES, MALLOC_CAP_8BIT);
        if (!_readBuf) {
            Serial.println("LOCAL_CLIP:BUF_ALLOC_FAIL");
        }

        // Allocate back and front framebuffers in PSRAM (40960 bytes each, 80KB total).
        _fbBack  = (uint16_t*)heap_caps_malloc(LOCAL_CLIP_FB_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        _fbFront = (uint16_t*)heap_caps_malloc(LOCAL_CLIP_FB_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (!_fbBack || !_fbFront) {
            Serial.println("LOCAL_CLIP:PSRAM_FB_ALLOC_FAIL");
            // Abort: cannot operate without both buffers.
            if (_fbBack)  { heap_caps_free(_fbBack);  _fbBack  = nullptr; }
            if (_fbFront) { heap_caps_free(_fbFront); _fbFront = nullptr; }
        } else {
            memset(_fbBack,  0, LOCAL_CLIP_FB_BYTES);
            memset(_fbFront, 0, LOCAL_CLIP_FB_BYTES);
            Serial.printf("LOCAL_CLIP:PSRAM_FB_OK back=%p front=%p\n",
                          (void*)_fbBack, (void*)_fbFront);
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
        _loop          = loop;
        _isPlaying     = true;
        _isFinished    = false;
        _loopCount     = 0;
        _lastLoggedFrame = 0;

        // Double-buffer reset — anchor clip clock to now.
        _clipStartMs   = millis();
        _framesDecoded = 0;
        _framesEmitted = 0;

        // Register back buffer with codec so _apply_* writes there, not TFT.
        if (_fbBack && _fbFront) {
            codec_set_back_buffer(_fbBack);
        }

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
        // Deregister back buffer so codec reverts to direct-blit mode.
        codec_set_back_buffer(nullptr);
        Serial.println("LOCAL_CLIP:STOP");
    }

    // Pump bytes into codec_feed(); called every loop tick.
    //
    // Double-buffer + pending-flag architecture (24fps):
    //
    //   STEP 1 — Emit pending frame if deadline has arrived.
    //     If codec_is_render_pending() && millis() >= targetDeadline:
    //       swap back↔front pointers, blit front to TFT, framesEmitted++,
    //       re-anchor codec back buffer to new back pointer,
    //       clear pending flag.
    //
    //   STEP 2 — Feed codec only when safe.
    //     If !codec_is_render_pending() && codec_is_idle():
    //       read 4KB from file → codec_feed().
    //       (Back buffer is free; new decode won't clobber a pending frame.)
    //     If codec is mid-parse (!codec_is_idle()):
    //       read 4KB → codec_feed() to complete in-flight packet.
    //       (Parser resumes; callback writes to back buffer when done.)
    //     If codec_is_render_pending() && codec_is_idle():
    //       SKIP read — pending frame sits in back buffer; do NOT decode next
    //       frame into it until it has been emitted.
    //
    //   Catch-up: if target deadline is >3 frames behind now, re-anchor
    //   _clipStartMs so we don't burst-emit stale frames.
    inline void update() {
        if (!_isPlaying || !_file) return;
        if (!_readBuf) return;

        const uint32_t TARGET_FPS        = 24;
        const uint32_t FRAME_INTERVAL_MS = 1000 / TARGET_FPS; // ~41 ms

        uint32_t now = millis();

        // ── STEP 1: Emit pending frame if deadline reached ────────────────────
        if (codec_is_render_pending()) {
            // Compute target deadline for the next frame to emit.
            uint32_t targetMs = _clipStartMs + (_framesEmitted + 1) * 1000 / TARGET_FPS;

            if ((int32_t)(now - targetMs) >= 0) {
                // Deadline arrived — swap back↔front and blit front to TFT.
                uint16_t* tmp = _fbFront;
                _fbFront      = _fbBack;
                _fbBack       = tmp;

                // Re-register the new back pointer with the codec.
                codec_set_back_buffer(_fbBack);

                // Blit front buffer to TFT under mutex.
                if (_tft) {
                    ClipTftLock _lock;
                    _tft->startWrite();
                    _tft->setAddrWindow(0, 0, CODEC_WIDTH, CODEC_HEIGHT);
                    _tft->writePixels(_fbFront, CODEC_WIDTH * CODEC_HEIGHT);
                    _tft->endWrite();
                }

                _framesEmitted++;
                codec_clear_render_pending();

                // Progress log every 10 frames (non-looping only).
                if (!_loop && _framesEmitted > 0 &&
                    (_framesEmitted % 10) == 0 &&
                    _framesEmitted != _lastLoggedFrame) {
                    _lastLoggedFrame = _framesEmitted;
                    uint32_t elapsed = now - _clipStartMs;
                    char buf[80];
                    snprintf(buf, sizeof(buf),
                             "[clip] progress name=%s frames=%lu elapsed_ms=%lu",
                             _clipName, (unsigned long)_framesEmitted,
                             (unsigned long)elapsed);
                    Serial.println(buf);
                }
            }
            // Pending frame not yet due — do not feed codec (back buffer occupied).
            return;
        }

        // ── Catch-up guard: if we are >3 frames behind, re-anchor clock ───────
        {
            uint32_t expectedMs = _clipStartMs + (_framesEmitted + 1) * 1000 / TARGET_FPS;
            if ((int32_t)(now - expectedMs) > (int32_t)(3 * FRAME_INTERVAL_MS)) {
                // Re-anchor so we emit at natural cadence from here.
                _clipStartMs = now - _framesEmitted * 1000 / TARGET_FPS;
            }
        }

        // ── STEP 2: Feed codec only when back buffer is free ──────────────────
        // If mid-parse: keep feeding to complete the in-flight packet.
        // If idle: only read if no pending frame (no pending here; checked above).
        size_t n = _file.read(static_cast<uint8_t*>(_readBuf), LOCAL_CLIP_READ_BUF_BYTES);

        if (n > 0) {
            codec_feed(static_cast<const uint8_t*>(_readBuf), n);
        }

        if (n < LOCAL_CLIP_READ_BUF_BYTES) {
            // EOF reached (short read).
            if (_loop) {
                _file.seek(0);
                _loopCount++;
                // Re-anchor clip clock on loop restart so framesEmitted stays in sync.
                _clipStartMs   = millis();
                _framesDecoded = 0;
                _framesEmitted = 0;
                codec_clear_render_pending();
                // Continue on next tick.
            } else {
                _file.close();
                _isPlaying  = false;
                _isFinished = true;
                // Deregister back buffer — revert codec to direct-blit mode.
                codec_set_back_buffer(nullptr);
                char buf[80];
                snprintf(buf, sizeof(buf), "[clip] done name=%s total_frames=%lu elapsed_ms=%lu",
                         _clipName, (unsigned long)_framesEmitted,
                         (unsigned long)(millis() - _clipStartMs));
                Serial.println(buf);
                Serial.print("LOCAL_CLIP:DONE name=");
                Serial.println(_clipName);
            }
        }
    }

    // Inject TFT pointer so update() can blit front buffer.
    // Called once after codec_init() in main setup().
    inline void setTft(Adafruit_ST7735* tft) {
        _tft = tft;
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
    bool              _ready;
    bool              _isPlaying;
    bool              _isFinished;
    bool              _loop;
    void*             _readBuf;
    uint16_t*         _fbBack;          // PSRAM back buffer (codec writes here)
    uint16_t*         _fbFront;         // PSRAM front buffer (blitted to TFT)
    Adafruit_ST7735*  _tft = nullptr;   // TFT handle for front-buffer blit
    File              _file;
    size_t            _fileSize;
    char              _clipName[64];
    uint32_t          _clipStartMs     = 0;  // millis() at clip/loop start
    uint32_t          _framesDecoded   = 0;  // frames decoded into back buffer
    uint32_t          _framesEmitted   = 0;  // frames blitted to TFT
    uint32_t          _loopCount       = 0;
    uint32_t          _lastLoggedFrame = 0;
};

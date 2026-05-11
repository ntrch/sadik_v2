#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <JPEGDEC.h>
#include "display_manager.h"
#include "psram_alloc.h"

// JPEG SOI marker = FF D8, EOI marker = FF D9.
// Read whole file once into PSRAM, then walk SOI→EOI segments per frame.

// Per-clip ring buffer size for percentile stats (max frames per clip).
// 120 frames @ 2 bytes each = 240 bytes per active clip — well within DRAM.
static const uint16_t MJPEG_STATS_MAX_FRAMES = 240;

// Target frame interval in microseconds (24 fps).
static const uint32_t MJPEG_TARGET_FRAME_US = 41667UL; // 1000000 / 24

// Full-frame PSRAM backbuffer size: 160 × 128 × 2 bytes = 40960 bytes.
// JPEGDEC tile callback writes MCU blocks here; decode() completion triggers
// one single pushImage() to eliminate mid-scanout partial-frame tearing.
static const size_t MJPEG_FB_SIZE = DISPLAY_WIDTH * DISPLAY_HEIGHT * 2;  // 40960

class MjpegPlayer {
public:
    void begin(LGFX_Custom* lcd) {
        _lcd = lcd;
        if (!LittleFS.begin(false)) {
            Serial.println("LITTLEFS:MOUNT_FAIL");
            _ready = false;
            return;
        }
        // JPEGDEC: pixel type RGB565 little-endian (host-native uint16_t).
        // LovyanGFX setSwapBytes(true) in DisplayManager::begin() handles the
        // LE→BE swap on push so SPI wire gets MSB-first as ST7735S expects.
        // This is the standard Bitbank2 + LovyanGFX integration pattern.
        _jpeg.setPixelType(RGB565_LITTLE_ENDIAN);

        // Allocate full-frame PSRAM backbuffer (once, lifetime of process).
        // MCU tiles are blitted here; frame is pushed atomically after decode().
        // This eliminates the horizontal tearing band caused by partial TFT
        // scanout during per-tile pushImage() calls (no TE pin wired).
        if (!s_framebuf) {
            s_framebuf = (uint16_t*)psram_or_internal_malloc(MJPEG_FB_SIZE, MALLOC_CAP_8BIT);
            if (s_framebuf) {
                Serial.println("MJPEG:FRAMEBUF_ALLOC ok psram");
            } else {
                Serial.println("MJPEG:FRAMEBUF_ALLOC fail — falling back to direct tile push");
            }
        }

        _ready = true;
        // Runtime stat toggles (default: per-frame OFF, summary ON)
        _statsFrameOn   = false;
        _statsSummaryOn = true;
    }
    bool isReady()    const { return _ready; }
    bool isPlaying()  const { return _isPlaying; }
    bool hasFinished() const { return _isFinished; }
    const char* currentClipName() const { return _isPlaying ? _clipName : nullptr; }

    // DIAG-S8c: expose backbuffer pointer for solid-fill diagnostics
    static uint16_t* framebuf() { return s_framebuf; }

    // ── Runtime stat toggle handlers ─────────────────────────────────────────
    void setStatsFrame(bool on)   { _statsFrameOn   = on; }
    void setStatsSummary(bool on) { _statsSummaryOn = on; }
    bool statsFrameOn()   const   { return _statsFrameOn; }
    bool statsSummaryOn() const   { return _statsSummaryOn; }

    // DIAG-S8c: decode first frame of <name>.mjpeg into s_framebuf, then push.
    // enableCbLog=true → log first 12 JPEGDEC callbacks (for DIAG:JPEGLOG).
    // Returns true on success.
    bool diagDecodeOneFrame(const char* name, bool enableCbLog) {
        if (!_ready || !s_framebuf) {
            Serial.println("DIAG:ERR no framebuf");
            return false;
        }
        // Stop any active playback so we own the buffer
        if (_isPlaying) stop();

        char path[80];
        snprintf(path, sizeof(path), "/clips/%s.mjpeg", name);
        File f = LittleFS.open(path, "r");
        if (!f) {
            Serial.printf("DIAG:ERR clip_not_found name=%s\n", name);
            return false;
        }
        size_t flen = f.size();
        uint8_t* fbuf = (uint8_t*)psram_or_internal_malloc(flen, MALLOC_CAP_8BIT);
        if (!fbuf) { f.close(); Serial.println("DIAG:ERR malloc_fail"); return false; }
        f.read(fbuf, flen);
        f.close();

        // Find first SOI→EOI
        size_t soi = SIZE_MAX;
        for (size_t i = 0; i + 1 < flen; i++) {
            if (fbuf[i] == 0xFF && fbuf[i+1] == 0xD8) { soi = i; break; }
        }
        size_t eoi = SIZE_MAX;
        if (soi != SIZE_MAX) {
            for (size_t i = soi + 2; i + 1 < flen; i++) {
                if (fbuf[i] == 0xFF && fbuf[i+1] == 0xD9) { eoi = i; break; }
            }
        }
        if (soi == SIZE_MAX || eoi == SIZE_MAX) {
            psram_or_internal_free(fbuf);
            Serial.println("DIAG:ERR no_soi_eoi");
            return false;
        }

        s_active_lcd    = _lcd;
        s_diag_cb_log   = enableCbLog;
        s_diag_cb_count = 0;

        int open_ok = _jpeg.openRAM(fbuf + soi, (int)((eoi + 2) - soi), _jpegdec_cb);
        int dec_ok  = 0;
        if (open_ok) dec_ok = _jpeg.decode(0, 0, 0);

        Serial.printf("DIAG:ONEFRAME clip=%s soi=%u frame_len=%u open=%d dec=%d\n",
                      name, (unsigned)soi, (unsigned)((eoi + 2) - soi), open_ok, dec_ok);

        s_diag_cb_log = false;
        psram_or_internal_free(fbuf);

        if (open_ok && dec_ok == 1) {
            _lcd->pushImage(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, s_framebuf);
            return true;
        }
        return false;
    }

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

        // t_read: measure LittleFS read time
        uint32_t t_read_start = micros();
        f.read(_buf, _bufLen);
        _lastReadUs = micros() - t_read_start;

        f.close();
        strncpy(_clipName, name, sizeof(_clipName)-1);
        _clipName[sizeof(_clipName)-1] = '\0';
        _loop       = loop;
        _isPlaying  = true;
        _isFinished = false;
        _pos        = 0;
        _frameIdx   = 0;
        _playStartMs = millis();

        // Reset per-clip stats
        _clipFrameCount  = 0;
        _clipOkFail      = 0;
        _clipJitterMaxUs = 0;
        _clipDecSumUs    = 0;
        _clipPrevFrameEndUs = 0;
        memset(_clipDecBuf, 0, sizeof(_clipDecBuf));

        Serial.printf("MJPEG:START name=%s bytes=%u\n", _clipName, (unsigned)_bufLen);
        return true;
    }

    void stop() {
        if (_isPlaying && _statsSummaryOn && _clipFrameCount > 0) {
            _printSummary();
        }
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

        // t_blit is EMBEDDED inside _jpegdec_cb (pushImage calls).
        // t_dec = total decode+blit wall time.

        uint32_t t_dec_start = micros();
        s_active_lcd = _lcd;

        // JPEGDEC: openRAM accepts PSRAM pointer, decode drives _jpegdec_cb
        int open_ok = _jpeg.openRAM(_buf + soi, (int)frame_len, _jpegdec_cb);
        int decode_result = 0;
        if (open_ok) {
            decode_result = _jpeg.decode(0, 0, 0);  // 1 = success, 0 = error
        }

        uint32_t t_dec_us = micros() - t_dec_start;

        // ── Atomic full-frame push (backbuffer path) ──────────────────────────
        // If the PSRAM backbuffer was used (s_framebuf != nullptr), the decode
        // callback populated it tile-by-tile. Push the whole frame in one SPI
        // transaction now so the panel scanout sees a complete image, not partial
        // MCU blocks — this is the tearing fix.
        if (s_framebuf && open_ok && decode_result == 1) {
            _lcd->pushImage(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, s_framebuf);
        }

        // DIAG: log decode result + first 64 bytes for frame[0] only
        if (_frameIdx == 0) {
            int last_err = _jpeg.getLastError();
            Serial.printf("MJPEG:DIAG clip=%s open=%d decode=%d last_err=%d soi=%u frame_len=%u\n",
                          _clipName, open_ok, decode_result, last_err,
                          (unsigned)soi, (unsigned)frame_len);
            Serial.print("MJPEG:DIAG hex=");
            size_t dump_n = frame_len < 64 ? frame_len : 64;
            for (size_t i = 0; i < dump_n; i++) {
                Serial.printf("%02x", _buf[soi + i]);
            }
            Serial.println();
            Serial.print("MJPEG:DIAG tail=");
            size_t tail_start = frame_len >= 8 ? frame_len - 8 : 0;
            for (size_t i = tail_start; i < frame_len; i++) {
                Serial.printf("%02x", _buf[soi + i]);
            }
            Serial.println();
        }

        // ok=1 means JPEGDEC returned 1 (success) from decode()
        bool ok = (open_ok && decode_result == 1);
        if (!ok) _clipOkFail++;

        uint32_t t_total_us = t_dec_us;
        int32_t  jitter_us  = (int32_t)t_total_us - (int32_t)MJPEG_TARGET_FRAME_US;

        // Per-frame log (only when STATS:ON)
        if (_statsFrameOn) {
            Serial.printf(
                "MJPEG:STATS clip=%s seq=%lu t_read=0 t_dec=%lu t_blit=0 t_total=%lu jitter=%ld ok=%d\n",
                _clipName,
                (unsigned long)_frameIdx,
                (unsigned long)t_dec_us,
                (unsigned long)t_total_us,
                (long)jitter_us,
                (int)ok
            );
        }

        // DBG log (first 3 frames, always — kept for continuity)
        if (_frameIdx < 3) {
            Serial.printf("MJPEG:DBG frame=%lu ok=%d soi=%u len=%u lcd=%d\n",
                          (unsigned long)_frameIdx, (int)ok,
                          (unsigned)soi, (unsigned)frame_len, _lcd ? 1 : 0);
        }

        // Accumulate per-clip stats
        if (_clipFrameCount < MJPEG_STATS_MAX_FRAMES) {
            _clipDecBuf[_clipFrameCount] = (uint16_t)(t_dec_us > 65535 ? 65535 : t_dec_us);
        }
        _clipFrameCount++;
        _clipDecSumUs += t_dec_us;
        if ((uint32_t)(jitter_us < 0 ? -jitter_us : jitter_us) > _clipJitterMaxUs) {
            _clipJitterMaxUs = (uint32_t)(jitter_us < 0 ? -jitter_us : jitter_us);
        }

        _frameIdx++;
        _pos = eoi + 2;
    }

private:
    static LGFX_Custom* s_active_lcd;
    static JPEGDEC      _jpeg;
    // Full-frame PSRAM backbuffer shared across all MjpegPlayer instances.
    // Allocated once in begin(). nullptr = backbuffer unavailable; fall back
    // to direct tile push (old path) so the device always functions.
    static uint16_t*    s_framebuf;
    // DIAG-S8c: callback-log control (used by diagDecodeOneFrame)
    static bool         s_diag_cb_log;
    static int          s_diag_cb_count;

    // JPEGDEC tile callback: receives decoded MCU tile.
    // pDraw->pPixels is RGB565 LE (matches setPixelType(RGB565_LITTLE_ENDIAN)).
    //
    // When s_framebuf is available: copy the MCU block into the correct region
    // of the PSRAM backbuffer. No TFT push happens here — the caller does one
    // atomic pushImage() after decode() completes, eliminating tearing.
    //
    // Fallback (s_framebuf == nullptr): push tiles directly to TFT (old path).
    // Byte order is unchanged in both paths — JPEGDEC LE + setSwapBytes(true).
    static int _jpegdec_cb(JPEGDRAW* pDraw) {
        if (!s_active_lcd) return 0;  // 0 = abort

        int16_t x = (int16_t)pDraw->x;
        int16_t y = (int16_t)pDraw->y;
        int16_t w = (int16_t)pDraw->iWidth;
        int16_t h = (int16_t)pDraw->iHeight;
        uint16_t* pixels = pDraw->pPixels;

        // DIAG-S8c: log first 12 callback invocations when requested
        if (s_diag_cb_log && s_diag_cb_count < 12) {
            Serial.printf("DIAG:CB call=%d x=%d y=%d w=%d h=%d\n",
                          s_diag_cb_count, (int)x, (int)y, (int)w, (int)h);
            s_diag_cb_count++;
        }

        // Clip to display bounds (160×128 landscape)
        if (x >= DISPLAY_WIDTH || y >= DISPLAY_HEIGHT) return 1;
        int16_t cx = x, cy = y;
        int16_t cw = w, ch = h;
        if (cx < 0) { cw += cx; pixels -= cx; cx = 0; }
        if (cy < 0) { ch += cy; pixels -= cy * w; cy = 0; }
        if (cx + cw > DISPLAY_WIDTH)  cw = DISPLAY_WIDTH  - cx;
        if (cy + ch > DISPLAY_HEIGHT) ch = DISPLAY_HEIGHT - cy;
        if (cw <= 0 || ch <= 0) return 1;

        if (s_framebuf) {
            // ── Backbuffer path: copy tile into PSRAM framebuffer ───────────
            // Each row of the (clipped) tile is memcpy'd into the correct
            // scanline of the 160-wide buffer. uint16_t is RGB565 LE — same
            // byte order as what pushImage will later receive. No byte swap.
            const uint16_t* src_base = pixels + (cy - y) * w + (cx - x);
            for (int16_t row = 0; row < ch; row++) {
                uint16_t* dst = s_framebuf + (cy + row) * DISPLAY_WIDTH + cx;
                const uint16_t* src = src_base + row * w;
                memcpy(dst, src, (size_t)cw * 2);
            }
        } else {
            // ── Fallback: direct tile push (original path, no framebuffer) ──
            if (cw == w) {
                s_active_lcd->pushImage(cx, cy, cw, ch,
                                        pixels + (cy - y) * w);
            } else {
                for (int16_t row = 0; row < ch; row++) {
                    s_active_lcd->pushImage(cx, cy + row, cw, 1,
                                            pixels + (cy - y + row) * w + (cx - x));
                }
            }
        }
        return 1;  // 1 = continue decoding
    }

    // ── Per-clip summary ──────────────────────────────────────────────────────
    void _printSummary() {
        uint32_t elapsed_ms = millis() - _playStartMs;
        float avg_fps = (elapsed_ms > 0)
            ? (_clipFrameCount * 1000.0f / elapsed_ms)
            : 0.0f;

        uint16_t N = (_clipFrameCount < MJPEG_STATS_MAX_FRAMES)
            ? (uint16_t)_clipFrameCount
            : MJPEG_STATS_MAX_FRAMES;

        uint16_t tmp[MJPEG_STATS_MAX_FRAMES];
        memcpy(tmp, _clipDecBuf, N * sizeof(uint16_t));
        for (uint16_t i = 1; i < N; i++) {
            uint16_t key = tmp[i];
            int16_t j = (int16_t)i - 1;
            while (j >= 0 && tmp[j] > key) {
                tmp[j + 1] = tmp[j];
                j--;
            }
            tmp[j + 1] = key;
        }

        uint32_t p50 = (N > 0) ? tmp[(N - 1) * 50 / 100] : 0;
        uint32_t p95 = (N > 0) ? tmp[(N - 1) * 95 / 100] : 0;
        uint32_t p99 = (N > 0) ? tmp[(N - 1) * 99 / 100] : 0;

        Serial.printf(
            "MJPEG:SUMMARY clip=%s frames=%lu avg_fps=%.1f t_dec_p50=%lu t_dec_p95=%lu t_dec_p99=%lu jitter_max=%lu ok_fail=%lu\n",
            _clipName,
            (unsigned long)_clipFrameCount,
            avg_fps,
            (unsigned long)p50,
            (unsigned long)p95,
            (unsigned long)p99,
            (unsigned long)_clipJitterMaxUs,
            (unsigned long)_clipOkFail
        );
    }

    size_t _find_marker(uint8_t mk, size_t from) {
        for (size_t i = from; i + 1 < _bufLen; i++) {
            if (_buf[i] == 0xFF && _buf[i+1] == mk) return i;
        }
        return SIZE_MAX;
    }

    void _on_eof() {
        if (_statsSummaryOn && _clipFrameCount > 0) {
            _printSummary();
        }
        if (_loop) {
            _pos         = 0;
            _frameIdx    = 0;
            _playStartMs = millis();
            _clipFrameCount  = 0;
            _clipOkFail      = 0;
            _clipJitterMaxUs = 0;
            _clipDecSumUs    = 0;
            memset(_clipDecBuf, 0, sizeof(_clipDecBuf));
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

    LGFX_Custom* _lcd      = nullptr;
    bool     _ready            = false;
    bool     _isPlaying        = false;
    bool     _isFinished       = false;
    bool     _loop             = false;
    bool     _statsFrameOn     = false;
    bool     _statsSummaryOn   = true;
    uint8_t* _buf              = nullptr;
    size_t   _bufLen           = 0;
    size_t   _pos              = 0;
    uint32_t _frameIdx         = 0;
    uint32_t _playStartMs      = 0;
    uint32_t _lastReadUs       = 0;
    char     _clipName[64];

    // Per-clip stat accumulators
    uint32_t _clipFrameCount   = 0;
    uint32_t _clipOkFail       = 0;
    uint32_t _clipJitterMaxUs  = 0;
    uint32_t _clipDecSumUs     = 0;
    uint32_t _clipPrevFrameEndUs = 0;
    uint16_t _clipDecBuf[MJPEG_STATS_MAX_FRAMES];
};

// Out-of-line statics
inline LGFX_Custom* MjpegPlayer::s_active_lcd   = nullptr;
inline JPEGDEC      MjpegPlayer::_jpeg;
inline uint16_t*    MjpegPlayer::s_framebuf     = nullptr;
// DIAG-S8c: callback-log statics
inline bool         MjpegPlayer::s_diag_cb_log   = false;
inline int          MjpegPlayer::s_diag_cb_count  = 0;

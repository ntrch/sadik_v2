#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <Adafruit_ST7735.h>
#include <JPEGDEC.h>
#include "psram_alloc.h"

// JPEG SOI marker = FF D8, EOI marker = FF D9.
// Read whole file once into PSRAM, then walk SOI→EOI segments per frame.

// Switched to JPEGDEC (Bitbank2) due to TJpgDec workspace limit on complex
// Huffman; see commit hist.

// Per-clip ring buffer size for percentile stats (max frames per clip).
// 120 frames @ 2 bytes each = 240 bytes per active clip — well within DRAM.
static const uint16_t MJPEG_STATS_MAX_FRAMES = 240;

// Target frame interval in microseconds (24 fps).
static const uint32_t MJPEG_TARGET_FRAME_US = 41667UL; // 1000000 / 24

class MjpegPlayer {
public:
    void begin(Adafruit_ST7735* tft) {
        _tft = tft;
        if (!LittleFS.begin(false)) {
            Serial.println("LITTLEFS:MOUNT_FAIL");
            _ready = false;
            return;
        }
        _ready = true;
        // Runtime stat toggles (default: per-frame OFF, summary ON)
        _statsFrameOn   = false;
        _statsSummaryOn = true;
    }
    bool isReady()   const { return _ready; }
    bool isPlaying() const { return _isPlaying; }
    bool hasFinished() const { return _isFinished; }
    const char* currentClipName() const { return _isPlaying ? _clipName : nullptr; }

    // ── Runtime stat toggle handlers ─────────────────────────────────────────
    // Call from processCommand() when STATS:* serial commands are received.
    void setStatsFrame(bool on)   { _statsFrameOn   = on; }
    void setStatsSummary(bool on) { _statsSummaryOn = on; }
    bool statsFrameOn()   const   { return _statsFrameOn; }
    bool statsSummaryOn() const   { return _statsSummaryOn; }

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

        // ── Per-frame timing ──────────────────────────────────────────────────
        // t_read for subsequent frames: marker scan time (negligible but consistent).
        // The dominant t_read was measured in play() for the initial bulk read.
        // For per-frame we report the bulk-read amortized cost (0 here; first frame
        // already captured in _lastReadUs). This is intentional: on-device MJPEG
        // is loaded fully into PSRAM at play() time — there is no per-frame I/O.
        // t_blit is EMBEDDED inside JPEGDEC draw callback (_draw_cb writePixels calls).
        // Separating blit from decode would require TFT-call instrumentation inside
        // _draw_cb. For now t_blit=0 and t_dec includes blit cost.
        // NOTE: t_blit=0 intentionally — blit is gated inside _draw_cb which is
        //   called from jpg.decode(); there is no clean boundary to split them without
        //   modifying render logic. t_dec = total decode wall time (decode+blit).

        uint32_t t_dec_start = micros();
        s_active_tft = _tft;
        uint32_t cb_before = s_cb_count;

        // JPEGDEC: openRAM → setPixelType → decode → close per frame.
        // RGB565_LITTLE_ENDIAN: JPEGDEC outputs pixels with low byte first in memory.
        // Adafruit writePixels(bigEndian=false) byte-swaps during SPI transmission,
        // which matches what the ST7735 panel expects (big-endian on wire). This is
        // symmetric with the original TJpgDec setSwapBytes(false) path that was
        // visually confirmed correct in C1. Keeping bigEndian=false in writePixels.
        JPEGDEC jpg;
        int decode_rc = 0;
        int last_err  = 0;
        if (jpg.openRAM(_buf + soi, (int)frame_len, _draw_cb)) {
            jpg.setPixelType(RGB565_LITTLE_ENDIAN);
            decode_rc = jpg.decode(0, 0, 0);
            last_err  = jpg.getLastError();
            jpg.close();
        } else {
            last_err = jpg.getLastError();
        }

        uint32_t t_dec_us = micros() - t_dec_start;
        uint32_t cb_calls = s_cb_count - cb_before;

        // DIAG: log decode result + first 64 bytes for frame[0] only
        if (_frameIdx == 0) {
            Serial.printf("MJPEG:DIAG clip=%s decode_rc=%d last_err=%d soi=%u frame_len=%u\n",
                          _clipName, decode_rc, last_err, (unsigned)soi, (unsigned)frame_len);
            // First 64 bytes of what's passed to openRAM
            Serial.print("MJPEG:DIAG hex=");
            size_t dump_n = frame_len < 64 ? frame_len : 64;
            for (size_t i = 0; i < dump_n; i++) {
                Serial.printf("%02x", _buf[soi + i]);
            }
            Serial.println();
            // Last 8 bytes to confirm EOI marker position
            Serial.print("MJPEG:DIAG tail=");
            size_t tail_start = frame_len >= 8 ? frame_len - 8 : 0;
            for (size_t i = tail_start; i < frame_len; i++) {
                Serial.printf("%02x", _buf[soi + i]);
            }
            Serial.println();
        }

        // ok=1 means decode returned 1 (success). JPEGDEC returns 1=OK, 0=fail.
        bool ok = (decode_rc == 1);
        if (!ok) _clipOkFail++;

        uint32_t t_total_us = t_dec_us; // t_read=0 (PSRAM), t_blit=0 (in t_dec)
        int32_t  jitter_us  = (int32_t)t_total_us - (int32_t)MJPEG_TARGET_FRAME_US;

        // Per-frame log (only when STATS:ON)
        if (_statsFrameOn) {
            Serial.printf(
                "MJPEG:STATS clip=%s seq=%lu t_read=0 t_dec=%lu t_blit=0 t_total=%lu jitter=%ld ok=%d cb=%lu\n",
                _clipName,
                (unsigned long)_frameIdx,
                (unsigned long)t_dec_us,
                (unsigned long)t_total_us,
                (long)jitter_us,
                (int)ok,
                (unsigned long)cb_calls
            );
        }

        // Old DBG log (first 3 frames, always — kept for continuity with C1 logs)
        if (_frameIdx < 3) {
            Serial.printf("MJPEG:DBG frame=%lu ok=%d cb_calls=%lu soi=%u len=%u tft=%d\n",
                          (unsigned long)_frameIdx, (int)ok, (unsigned long)cb_calls,
                          (unsigned)soi, (unsigned)frame_len, _tft ? 1 : 0);
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
    static Adafruit_ST7735* s_active_tft;
    static uint32_t s_cb_count;

    // JPEGDEC draw callback. Signature required by JPEGDEC library.
    // pDraw->pPixels is RGB565 little-endian (per setPixelType(RGB565_LITTLE_ENDIAN)).
    // writePixels(bigEndian=false) byte-swaps on the wire — matches ST7735 expectation.
    static int _draw_cb(JPEGDRAW *pDraw) {
        s_cb_count++;
        if (!s_active_tft) return 0; // abort
        int16_t x = pDraw->x;
        int16_t y = pDraw->y;
        uint16_t w = pDraw->iWidth;
        uint16_t h = pDraw->iHeight;
        uint16_t* bitmap = pDraw->pPixels;

        // Clip to display bounds (160×128 landscape).
        if (x >= DISPLAY_WIDTH || y >= DISPLAY_HEIGHT) return 1;
        int16_t cx = x, cy = y;
        uint16_t cw = w, ch = h;
        if (cx < 0) { cw += cx; bitmap -= cx; cx = 0; }          // left clip
        if (cy < 0) { ch += cy; bitmap -= cy * w; cy = 0; }       // top clip (rare)
        if (cx + (int16_t)cw > DISPLAY_WIDTH)  cw = DISPLAY_WIDTH  - cx;
        if (cy + (int16_t)ch > DISPLAY_HEIGHT) ch = DISPLAY_HEIGHT - cy;
        if (cw == 0 || ch == 0) return 1;

        s_active_tft->startWrite();
        s_active_tft->setAddrWindow(cx, cy, cw, ch);
        if (cw == w) {
            s_active_tft->writePixels(bitmap + (cy - y) * w, cw * ch,
                                       /*block=*/true, /*bigEndian=*/false);
        } else {
            for (uint16_t row = 0; row < ch; row++) {
                s_active_tft->writePixels(bitmap + (cy - y + row) * w + (cx - x),
                                           cw, /*block=*/true, /*bigEndian=*/false);
            }
        }
        s_active_tft->endWrite();
        return 1; // 1=continue, 0=abort
    }

    // ── Per-clip summary ──────────────────────────────────────────────────────
    void _printSummary() {
        // avg_fps
        uint32_t elapsed_ms = millis() - _playStartMs;
        float avg_fps = (elapsed_ms > 0)
            ? (_clipFrameCount * 1000.0f / elapsed_ms)
            : 0.0f;

        // Percentiles: sort a working copy of _clipDecBuf[0..N-1]
        uint16_t N = (_clipFrameCount < MJPEG_STATS_MAX_FRAMES)
            ? (uint16_t)_clipFrameCount
            : MJPEG_STATS_MAX_FRAMES;

        // Insertion sort (N ≤ 240; cheap on stack)
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
        // Scan for FF mk
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
            // Reset per-clip stats for next loop iteration
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

    Adafruit_ST7735* _tft      = nullptr;
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
    uint16_t _clipDecBuf[MJPEG_STATS_MAX_FRAMES]; // t_dec per frame in us (capped at 65535)
};

// Out-of-line static
inline Adafruit_ST7735* MjpegPlayer::s_active_tft = nullptr;
inline uint32_t MjpegPlayer::s_cb_count = 0;

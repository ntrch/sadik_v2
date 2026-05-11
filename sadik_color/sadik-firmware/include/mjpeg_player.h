#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include <Adafruit_ST7735.h>
#include <TJpg_Decoder.h>
#include "psram_alloc.h"

// JPEG SOI marker = FF D8, EOI marker = FF D9.
// Read whole file once into PSRAM, then walk SOI→EOI segments per frame.

// =============================================================================
// TJPGDEC_OK_NOTE: Why drawJpg() returns JRESULT=JDR_INTR (1) not JDR_OK (0)
//                 even when render is visually correct and cb_calls == 80.
//
// Root cause: JRESULT is an enum, not a bool. JDR_OK == 0.
//   bool ok = TJpgDec.drawJpg(...) → assigns (JRESULT != 0) as bool.
//   When decode+blit succeeds, JRESULT = JDR_OK = 0, so ok = false (!!).
//
// Complete JRESULT table (tjpgd.h):
//   JDR_OK   = 0  — success            → bool ok = false ← BUG (cosmetic)
//   JDR_INTR = 1  — callback returned 0 (abort)
//   JDR_INP  = 2  — input stream error
//   JDR_MEM1 = 3  — workspace too small
//   JDR_MEM2 = 4  — stream buffer too small
//   JDR_PAR  = 5  — parameter error
//   JDR_FMT1 = 6  — broken data
//   JDR_FMT2 = 7  — unsupported format
//   JDR_FMT3 = 8  — unsupported JPEG standard
//
// Diagnosis: cb_calls == 80 with a 160×128 image at scale=1 means all
//   10×8 MCU blocks (16×16 px each) were decoded and passed to _tjpg_cb.
//   _tjpg_cb returns `true` (= 1) for all blocks. jd_output propagates this
//   as the outfunc return value to jd_decomp. jd_decomp returns JDR_OK=0.
//   drawJpg(array) returns that JDR_OK=0. Assigning to `bool ok` → ok=false.
//
// Fix (not applied — Opus to decide): change `bool ok` to `JRESULT jresult`
//   and log ok=(jresult==JDR_OK). Or cast: ok=(TJpgDec.drawJpg(...)==JDR_OK).
//
// The per-frame STATS log below uses `ok=(jresult==JDR_OK)` so ok=1 is correct.
// The old DBG log (first 3 frames) preserved but ok field now reflects truth.
// =============================================================================

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
        // TJpgDec render callback: write decoded MCU into TFT
        TJpgDec.setJpgScale(1);
        TJpgDec.setSwapBytes(false);
        TJpgDec.setCallback(_tjpg_cb);
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
        // t_blit is EMBEDDED inside TJpgDec callback (_tjpg_cb writePixels calls).
        // Separating blit from decode would require TFT-call instrumentation inside
        // _tjpg_cb. For now t_blit=0 and t_dec includes blit cost. See note below.
        // NOTE: t_blit=0 intentionally — blit is gated inside _tjpg_cb which is
        //   called from jd_decomp; there is no clean boundary to split them without
        //   modifying render logic. t_dec = total drawJpg wall time (decode+blit).

        uint32_t t_dec_start = micros();
        s_active_tft = _tft;
        uint32_t cb_before = s_cb_count;
        JRESULT jresult = TJpgDec.drawJpg(0, 0, _buf + soi, frame_len);
        uint32_t t_dec_us = micros() - t_dec_start;
        uint32_t cb_calls = s_cb_count - cb_before;

        // ok=1 means JDR_OK (decode success). See TJPGDEC_OK_NOTE above.
        bool ok = (jresult == JDR_OK);
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
    static bool _tjpg_cb(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t* bitmap) {
        s_cb_count++;
        if (!s_active_tft) return false;
        // Clip to display bounds (160×128 landscape).
        if (x >= DISPLAY_WIDTH || y >= DISPLAY_HEIGHT) return true;
        int16_t cx = x, cy = y;
        uint16_t cw = w, ch = h;
        if (cx < 0) { cw += cx; bitmap -= cx; cx = 0; }  // left clip
        if (cy < 0) { ch += cy; bitmap -= cy * w; cy = 0; } // top clip (rare)
        if (cx + (int16_t)cw > DISPLAY_WIDTH)  cw = DISPLAY_WIDTH  - cx;
        if (cy + (int16_t)ch > DISPLAY_HEIGHT) ch = DISPLAY_HEIGHT - cy;
        if (cw == 0 || ch == 0) return true;

        // TJpgDec with setSwapBytes(false) (default) outputs RGB565 in host
        // little-endian order (low byte first in memory). ST7735 panels expect
        // big-endian on the wire (high byte first). Adafruit writePixels with
        // bigEndian=false performs the byte swap during transmission, matching
        // what pushFrameRgb565() does for raw PC-streamed frames. Symmetric.
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
        return true;
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

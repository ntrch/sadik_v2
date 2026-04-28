// =============================================================================
// codec_decode.cpp — SADIK Color Sprint-2 F3.3
// Streaming packet decoder — state machine + frame applicator.
// =============================================================================

#include "codec_decode.h"
#include "rtos_tasks.h"
#include <string.h>
#include <esp_heap_caps.h>

namespace {
struct TftLock {
    TftLock()  { if (tftMutex) xSemaphoreTake(tftMutex, portMAX_DELAY); }
    ~TftLock() { if (tftMutex) xSemaphoreGive(tftMutex); }
};
}

// ---------------------------------------------------------------------------
// CRC16-CCITT (matches Python encoder in tools/codec/encode.py)
// ---------------------------------------------------------------------------
static uint16_t crc16_ccitt(const uint8_t* data, size_t len) {
    uint16_t crc = CODEC_CRC_INIT;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++) {
            if (crc & 0x8000u)
                crc = (uint16_t)((crc << 1) ^ CODEC_CRC_POLY);
            else
                crc = (uint16_t)(crc << 1);
        }
    }
    return crc;
}

// ---------------------------------------------------------------------------
// State machine states
// ---------------------------------------------------------------------------
enum DecodeState {
    STATE_HUNT_MAGIC,   // waiting for 0xC5 magic byte
    STATE_HEADER,       // accumulating 7 remaining header bytes (total 8)
    STATE_PAYLOAD,      // accumulating payload bytes
    STATE_APPLY,        // packet complete; verify CRC + apply (no data needed)
};

// ---------------------------------------------------------------------------
// Module-level state (single decoder instance)
// ---------------------------------------------------------------------------
static Adafruit_ST7735* _tft            = nullptr;
static CodecFrameReadyCb _cb            = nullptr;

static DecodeState  _state              = STATE_HUNT_MAGIC;

// Header buffer: 8 bytes [magic type seq_lo seq_hi len_lo len_hi crc_lo crc_hi]
static uint8_t      _hdr[CODEC_HEADER_SIZE];
static uint8_t      _hdr_pos            = 0;

// Payload buffer: heap-allocated in codec_init (DRAM too tight for both static)
static uint8_t*     _payload            = nullptr;
static uint32_t     _payload_len        = 0;   // expected bytes for current packet
static uint32_t     _payload_pos        = 0;

// Decoded header fields (valid after STATE_HEADER completes)
static uint8_t      _pkt_type           = 0;
static uint16_t     _pkt_seq            = 0;
static uint16_t     _pkt_crc            = 0;

// Framebuffer: 160×128×2 = 40960 bytes — static (.bss) to avoid heap collision
// with UART RX ring buffer (the known crash cause).
static uint16_t     _fb_storage[CODEC_WIDTH * CODEC_HEIGHT];
static uint16_t*    _fb                 = _fb_storage;

// Last accepted seq
static uint16_t     _last_seq           = 0;

// millis() of the most recently consumed byte while a packet is in flight.
// Used by codec_tick() to detect stalled mid-packet parsers.
static uint32_t     _last_byte_ms       = 0;

// Stall threshold (ms). A well-formed codec packet is fully transmitted in
// ~100 ms at 921600 baud even for a 40 KB IFRAME, so 150 ms is tight enough
// to recover quickly on clip switch (host's ABORT_STREAM timeout is 200 ms)
// without firing on merely slow streams.
static const uint32_t CODEC_STALL_MS    = 150;

// Gate for binary ACK + RESYNC emission. Disabled during local clip playback.
static bool _ack_enabled = true;

// Monotonic counter of frames successfully applied since boot.
static uint32_t s_framesApplied = 0;

// Double-buffer support: when non-null, apply functions write here instead of
// _fb and skip TFT push.  Set via codec_set_back_buffer().
static uint16_t* _fb_back        = nullptr;
static bool      _renderPending  = false;

// Small ASCII sniff buffer used inside STATE_HUNT_MAGIC. While the host is
// appConnected, the main loop cannot safely call SerialCommander (racing the
// UART driver semaphore crashes the system). The parser instead watches the
// byte stream for newline-terminated ASCII commands that matter mid-stream
// (currently only ABORT_STREAM) and handles them inline. The buffer is reset
// on newline and whenever a magic byte is seen, so it never interferes with
// real codec packets.
#define CODEC_ASCII_MAX 32
static char     _ascii_buf[CODEC_ASCII_MAX + 1];
static uint8_t  _ascii_len = 0;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
static void _reset_parser();
static void _ascii_try_handle();
static void _emit_ack(uint16_t seq);
static void _emit_resync();
static void _apply_iframe();
static void _apply_pframe();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void codec_init(Adafruit_ST7735* tft) {
    _tft = tft;

    memset(_fb_storage, 0, sizeof(_fb_storage));

    if (_payload == nullptr) {
        // Force DMA-capable internal SRAM — different heap region from
        // non-DMA allocations like the UART RX ring buffer. This avoids the
        // cross-allocation corruption observed with plain malloc.
        // On S3, MALLOC_CAP_DMA lands in internal SRAM (not PSRAM). Keep this allocation internal — DMA SPI requires it. PSRAM (BOARD_HAS_PSRAM) reserved for future framebuffer/cache moves.
        _payload = (uint8_t*)heap_caps_malloc(
            CODEC_FRAME_BYTES, MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
    }
    Serial.printf("CODEC:INIT fb_static=%p payload_dma=%p heap_free=%u\n",
                  (void*)_fb_storage, (void*)_payload,
                  (unsigned)ESP.getFreeHeap());

    _reset_parser();
}

void codec_on_frame_ready(CodecFrameReadyCb cb) {
    _cb = cb;
}

uint16_t codec_last_seq() {
    return _last_seq;
}

void codec_feed(const uint8_t* bytes, size_t n) {
    if (!_fb || !_payload) return;  // not initialised
    if (n > 0) _last_byte_ms = millis();

    for (size_t i = 0; i < n; i++) {
        uint8_t byte = bytes[i];

        switch (_state) {

            // ── Hunt for magic 0xC5 ────────────────────────────────────────
            case STATE_HUNT_MAGIC:
                if (byte == CODEC_MAGIC) {
                    _hdr[0]    = byte;
                    _hdr_pos   = 1;
                    _ascii_len = 0;   // discard any partial ASCII sniff
                    _state     = STATE_HEADER;
                } else if (byte == '\n' || byte == '\r') {
                    if (_ascii_len > 0) _ascii_try_handle();
                } else if (byte >= 0x20 && byte < 0x7F && _ascii_len < CODEC_ASCII_MAX) {
                    _ascii_buf[_ascii_len++] = (char)byte;
                } else {
                    // non-printable non-newline byte → not an ASCII command
                    _ascii_len = 0;
                }
                break;

            // ── Accumulate remaining 7 header bytes ────────────────────────
            case STATE_HEADER:
                _hdr[_hdr_pos++] = byte;
                if (_hdr_pos == CODEC_HEADER_SIZE) {
                    // Parse header fields (little-endian)
                    _pkt_type    = _hdr[1];
                    _pkt_seq     = (uint16_t)(_hdr[2] | ((uint16_t)_hdr[3] << 8));
                    _payload_len = (uint32_t)(_hdr[4] | ((uint32_t)_hdr[5] << 8));
                    _pkt_crc     = (uint16_t)(_hdr[6] | ((uint16_t)_hdr[7] << 8));

                    // Sanity-check payload length
                    if (_payload_len > CODEC_FRAME_BYTES) {
                        Serial.printf("CODEC:ERR oversized payload=%lu type=0x%02X seq=%u\n",
                                      _payload_len, _pkt_type, _pkt_seq);
                        _reset_parser();
                        break;
                    }

                    _payload_pos = 0;

                    if (_payload_len == 0) {
                        // No payload — go straight to APPLY
                        _state = STATE_APPLY;
                        // Re-use the loop iteration: fall-through via goto or
                        // by breaking and handling APPLY on the next byte?
                        // We handle it inline:
                        goto do_apply;
                    } else {
                        _state = STATE_PAYLOAD;
                    }
                }
                break;

            // ── Accumulate payload bytes ────────────────────────────────────
            case STATE_PAYLOAD:
                _payload[_payload_pos++] = byte;
                if (_payload_pos >= _payload_len) {
                    _state = STATE_APPLY;
                    goto do_apply;
                }
                break;

            // ── Apply (should not normally appear here; handled via goto) ───
            case STATE_APPLY:
            do_apply:
            {
                // Verify CRC over [header_no_crc (6 bytes)] + [payload]
                // Header without CRC field = bytes 0..5
                uint16_t crc_calc = crc16_ccitt(_hdr, 6);  // bytes 0-5 (magic..len)
                // continue CRC over payload
                // We need a combined-pass helper; do it in two passes with
                // state carry. Simpler: build a temp buffer — but that's
                // another 40 KB alloc. Instead, implement two-segment CRC.
                {
                    uint16_t crc = CODEC_CRC_INIT;
                    // Segment 1: header bytes 0..5
                    const uint8_t* seg1 = _hdr;
                    size_t seg1_len = 6;
                    for (size_t k = 0; k < seg1_len; k++) {
                        crc ^= (uint16_t)seg1[k] << 8;
                        for (int b = 0; b < 8; b++) {
                            crc = (crc & 0x8000u) ? (uint16_t)((crc << 1) ^ CODEC_CRC_POLY)
                                                   : (uint16_t)(crc << 1);
                        }
                    }
                    // Segment 2: payload
                    for (uint32_t k = 0; k < _payload_len; k++) {
                        crc ^= (uint16_t)_payload[k] << 8;
                        for (int b = 0; b < 8; b++) {
                            crc = (crc & 0x8000u) ? (uint16_t)((crc << 1) ^ CODEC_CRC_POLY)
                                                   : (uint16_t)(crc << 1);
                        }
                    }
                    crc_calc = crc;
                }

                if (crc_calc != _pkt_crc) {
                    Serial.printf("CODEC:CRC_FAIL seq=%u expected=0x%04X got=0x%04X\n",
                                  _pkt_seq, _pkt_crc, crc_calc);
                    _emit_resync();
                    _reset_parser();
                    break;
                }

                // CRC OK — apply packet
                switch (_pkt_type) {
                    case CODEC_TYPE_IFRAME:
                        _apply_iframe();
                        break;
                    case CODEC_TYPE_PFRAME:
                        _apply_pframe();
                        break;
                    case CODEC_TYPE_ACK:
                    case CODEC_TYPE_RESYNC:
                        // Host → device: these should not normally arrive,
                        // but silently accept and ignore.
                        break;
                    default:
                        Serial.printf("CODEC:UNKNOWN_TYPE 0x%02X seq=%u\n",
                                      _pkt_type, _pkt_seq);
                        break;
                }

                _last_seq = _pkt_seq;
                _emit_ack(_pkt_seq);

                if (_cb) _cb(_pkt_seq, _pkt_type);

                _reset_parser();
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

static void _reset_parser() {
    _state       = STATE_HUNT_MAGIC;
    _hdr_pos     = 0;
    _payload_pos = 0;
    _payload_len = 0;
    _pkt_type    = 0;
    _pkt_seq     = 0;
    _pkt_crc     = 0;
    _ascii_len   = 0;
}

// ---------------------------------------------------------------------------
// Public API — codec_abort
// ---------------------------------------------------------------------------

void codec_abort() {
    _reset_parser();
}

void codec_set_ack_enabled(bool enabled) {
    _ack_enabled = enabled;
}

void codec_set_back_buffer(uint16_t* back) {
    _fb_back       = back;
    _renderPending = false;
}

bool codec_is_render_pending() {
    return _renderPending;
}

void codec_clear_render_pending() {
    _renderPending = false;
}

uint16_t* codec_get_back_buffer() {
    return _fb_back;
}

static void _ascii_try_handle() {
    _ascii_buf[_ascii_len] = '\0';
    if (strcmp(_ascii_buf, "ABORT_STREAM") == 0) {
        _reset_parser();
        Serial.println("OK:ABORTED");
    }
    _ascii_len = 0;
}

bool codec_is_idle() {
    return _state == STATE_HUNT_MAGIC;
}

uint32_t codec_frames_applied() {
    return s_framesApplied;
}

void codec_tick() {
    if (_state == STATE_HUNT_MAGIC) return;
    uint32_t now = millis();
    if ((now - _last_byte_ms) >= CODEC_STALL_MS) {
        Serial.printf("CODEC:STALL_RESET state=%d hdr_pos=%u payload_pos=%lu/%lu\n",
                      (int)_state, (unsigned)_hdr_pos,
                      (unsigned long)_payload_pos, (unsigned long)_payload_len);
        _reset_parser();
    }
}

// ACK packet: [0xC5][0x03][seq_lo][seq_hi][0x00][0x00][crc_lo][crc_hi]
// Payload length = 0, so CRC covers only the 6 header bytes (bytes 0-5).
static void _emit_ack(uint16_t seq) {
    uint8_t hdr[8];
    hdr[0] = CODEC_MAGIC;
    hdr[1] = CODEC_TYPE_ACK;
    hdr[2] = (uint8_t)(seq & 0xFF);
    hdr[3] = (uint8_t)(seq >> 8);
    hdr[4] = 0x00;   // payload_len lo
    hdr[5] = 0x00;   // payload_len hi
    uint16_t crc = crc16_ccitt(hdr, 6);
    hdr[6] = (uint8_t)(crc & 0xFF);
    hdr[7] = (uint8_t)(crc >> 8);
    if (_ack_enabled) Serial.write(hdr, 8);
}

// RESYNC packet: [0xC5][0x04][0x00][0x00][0x00][0x00][crc_lo][crc_hi]
static void _emit_resync() {
    uint8_t hdr[8];
    hdr[0] = CODEC_MAGIC;
    hdr[1] = CODEC_TYPE_RESYNC;
    hdr[2] = 0x00;
    hdr[3] = 0x00;
    hdr[4] = 0x00;
    hdr[5] = 0x00;
    uint16_t crc = crc16_ccitt(hdr, 6);
    hdr[6] = (uint8_t)(crc & 0xFF);
    hdr[7] = (uint8_t)(crc >> 8);
    if (_ack_enabled) {
        Serial.write(hdr, 8);
        Serial.println("CODEC:RESYNC_SENT");
    }
}

// IFRAME: payload is 40960 bytes of raw RGB565 LE. Copy into framebuffer and blit.
// In double-buffer mode (_fb_back != nullptr): write to back buffer, set pending.
// In single-buffer mode: write to _fb and blit to TFT immediately (legacy path).
static void _apply_iframe() {
    if (_payload_len != CODEC_FRAME_BYTES) return;

    if (_fb_back) {
        // Double-buffer path: decode into back buffer, defer TFT push to clip player.
        memcpy(_fb_back, _payload, CODEC_FRAME_BYTES);
        _renderPending = true;
        s_framesApplied++;
        return;
    }

    // Single-buffer legacy path (UART streaming / no back buffer set).
    memcpy(_fb, _payload, CODEC_FRAME_BYTES);
    if (!_tft) return;
    TftLock _lock;
    _tft->startWrite();
    _tft->setAddrWindow(0, 0, CODEC_WIDTH, CODEC_HEIGHT);
    _tft->writePixels(_fb, CODEC_WIDTH * CODEC_HEIGHT);
    _tft->endWrite();
    s_framesApplied++;
}

// PFRAME: 40-byte dirty-tile bitmap + per-dirty-tile RLE chunks.
// For each dirty tile: decode RLE into a local 8×8 tile buffer, patch the
// framebuffer, then push only that tile via setAddrWindow (partial update).
// In double-buffer mode (_fb_back != nullptr): patch back buffer, defer TFT push.
// In single-buffer mode: patch _fb and push tiles to TFT immediately (legacy).
static void _apply_pframe() {
    if (_payload_len < CODEC_DIRTY_BITMAP_BYTES) {
        Serial.printf("CODEC:PFRAME too_short=%lu\n", _payload_len);
        return;
    }

    const uint8_t* dirty   = _payload;
    const uint8_t* rle     = _payload + CODEC_DIRTY_BITMAP_BYTES;
    const uint8_t* rle_end = _payload + _payload_len;

    // Select target framebuffer: back buffer (double-buffer mode) or _fb (legacy).
    uint16_t* target_fb = _fb_back ? _fb_back : _fb;

    // Only acquire TFT + call startWrite in single-buffer (immediate blit) mode.
    const bool immediate = (_fb_back == nullptr) && (_tft != nullptr);
    TftLock _lock;  // acquires mutex unconditionally; harmless in double-buffer mode

    // Tile scratch buffer (64 pixels = 128 bytes)
    uint16_t tile_buf[CODEC_PIXELS_PER_TILE];

    // Hoist startWrite() outside the tile loop: one CS assert/deassert per
    // P-frame instead of one per dirty tile.  Each tile only calls
    // setAddrWindow+writePixels (no SPI CS toggle overhead between tiles).
    if (immediate) _tft->startWrite();

    for (uint16_t tile_idx = 0; tile_idx < CODEC_TILE_COUNT; tile_idx++) {
        // Check dirty bit: MSB-first within each byte
        uint16_t byte_idx = tile_idx / 8;
        uint8_t  bit_idx  = 7 - (tile_idx % 8);
        if (!((dirty[byte_idx] >> bit_idx) & 1)) continue;

        // Decode RLE for this tile
        if (rle >= rle_end) {
            Serial.println("CODEC:PFRAME rle_overrun");
            if (immediate) _tft->endWrite();
            return;
        }

        uint8_t run_count = *rle++;
        uint16_t pixel_idx = 0;

        for (uint8_t r = 0; r < run_count; r++) {
            if (rle + 3 > rle_end) {
                Serial.println("CODEC:PFRAME rle_data_overrun");
                if (immediate) _tft->endWrite();
                return;
            }
            uint8_t  run_len = *rle++;
            uint16_t pixel   = (uint16_t)(*rle) | ((uint16_t)(*(rle + 1)) << 8);
            rle += 2;

            for (uint8_t p = 0; p < run_len; p++) {
                if (pixel_idx < CODEC_PIXELS_PER_TILE)
                    tile_buf[pixel_idx++] = pixel;
            }
        }

        // Compute tile screen position
        uint16_t tx = (tile_idx % CODEC_TILES_X) * CODEC_TILE_W;
        uint16_t ty = (tile_idx / CODEC_TILES_X) * CODEC_TILE_H;

        // Patch target framebuffer (8 rows × 8 cols)
        for (uint8_t row = 0; row < CODEC_TILE_H; row++) {
            for (uint8_t col = 0; col < CODEC_TILE_W; col++) {
                target_fb[(ty + row) * CODEC_WIDTH + (tx + col)] = tile_buf[row * CODEC_TILE_W + col];
            }
        }

        // Single-buffer: partial push — draw only this 8×8 tile
        if (immediate) {
            _tft->setAddrWindow(tx, ty, CODEC_TILE_W, CODEC_TILE_H);
            _tft->writePixels(tile_buf, CODEC_PIXELS_PER_TILE);
        }
    }

    if (immediate) _tft->endWrite();

    if (_fb_back) {
        // Double-buffer path: mark pending so clip player blits front at deadline.
        _renderPending = true;
    }

    s_framesApplied++;
}

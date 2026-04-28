#pragma once

// =============================================================================
// codec_decode.h — SADIK Color Sprint-2 F3.3
// Streaming packet decoder for the SADIK codec format.
//
// Packet layout (little-endian):
//   [u8 magic=0xC5][u8 type][u16 seq][u16 payload_len][u16 crc16][payload…]
//
// Types:
//   0x01 IFRAME  — 40960 bytes raw RGB565 LE (full frame)
//   0x02 PFRAME  — 40-byte dirty-tile bitmap + per-dirty-tile RLE
//   0x03 ACK     — sent by firmware back to host (not decoded here)
//   0x04 RESYNC  — sent by firmware to request IFRAME resync
//
// Usage (in main.cpp / loop):
//   codec_init();
//   codec_on_frame_ready(myCallback);
//   // In serial-data handler:
//   codec_feed(bytes, n);
//   // ACK is emitted automatically over Serial after each accepted packet.
// =============================================================================

#include <Arduino.h>
#include <Adafruit_ST7735.h>
#include "codec_format.h"  // CODEC_* constants (shared with host tools)

// ---------------------------------------------------------------------------
// Callback type
// ---------------------------------------------------------------------------
// Called after each successfully decoded & applied packet.
// seq  — packet sequence number
// type — CODEC_TYPE_IFRAME or CODEC_TYPE_PFRAME
typedef void (*CodecFrameReadyCb)(uint16_t seq, uint8_t type);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Allocate the 40 KB heap framebuffer and reset the parser state machine.
// Must be called once before codec_feed().
// Pass the Adafruit_ST7735 instance the decoder should blit into.
void codec_init(Adafruit_ST7735* tft);

// Register the callback that fires after each complete frame is applied.
// Optional — pass nullptr to disable.
void codec_on_frame_ready(CodecFrameReadyCb cb);

// Feed raw serial bytes into the streaming parser.
// May be called with any chunk size (1 byte to many KB).
// Internally drives a state machine:
//   HUNT_MAGIC → HEADER → PAYLOAD → VERIFY → APPLY
// On CRC failure: emits RESYNC packet, drops the bad packet, resets.
// On success:     applies the frame, emits ACK, fires on_frame_ready cb.
void codec_feed(const uint8_t* bytes, size_t n);

// Return the seq number of the last accepted packet (for manual ACK if needed).
uint16_t codec_last_seq();

// Reset the streaming parser to STATE_HUNT_MAGIC (keep framebuffer intact).
// Call this after the host sends ABORT_STREAM so that a half-parsed packet
// from the previous clip does not corrupt the next stream's IFRAME.
void codec_abort();

// True when the parser is waiting for a magic byte (no packet in flight).
// Main loop uses this to decide whether raw bytes belong to the codec or
// should be handed to SerialCommander for ASCII command parsing.
bool codec_is_idle();

// Monotonic counter of frames successfully applied since boot. Used by
// LocalClipPlayer for progress logging (real render count).
uint32_t codec_frames_applied();

// Monotonic counter of frames attempted (success + CRC fail) since boot.
// Used by LocalClipPlayer for 24fps deadline gating: even a CRC-failed packet
// consumed wall-clock time and must advance the deadline, otherwise a cascade
// of CRC failures locks the gate open and pumps data at full speed.
uint32_t codec_frames_attempted();

// Enable/disable binary ACK + RESYNC emission over Serial. Default: enabled.
// Disable during LittleFS local clip playback (no host listening for ACKs;
// emitted bytes pollute USB-CDC monitor and cause backpressure).
void codec_set_ack_enabled(bool enabled);

// Call from the main loop. If a packet has been in flight (i.e. not idle) for
// longer than the stall threshold, reset the parser so a truncated stream
// (host crash, cable unplug mid-packet, stray 0xC5 in ASCII) cannot swallow
// the UART forever. Framebuffer is preserved.
void codec_tick();

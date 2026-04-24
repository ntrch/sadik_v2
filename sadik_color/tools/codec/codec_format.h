#pragma once
#include <stdint.h>

/* ─── SADIK Color Codec Format ─────────────────────────────────────────────
 * Packet layout (little-endian):
 *   [u8 magic=0xC5] [u8 type] [u16 seq] [u16 payload_len] [u16 crc16-ccitt]
 *   [payload...]
 *
 * Stream: header-less concatenated packets; first packet always IFRAME.
 * ────────────────────────────────────────────────────────────────────────── */

/* Magic byte */
#define CODEC_MAGIC           0xC5u

/* Packet types */
#define CODEC_TYPE_IFRAME     0x01u   /* Raw RGB565, 40960 bytes */
#define CODEC_TYPE_PFRAME     0x02u   /* Delta + tile-RLE        */
#define CODEC_TYPE_ACK        0x03u   /* Acknowledgement         */
#define CODEC_TYPE_RESYNC     0x04u   /* Request IFRAME resync   */

/* Display geometry */
#define CODEC_WIDTH           160u
#define CODEC_HEIGHT          128u
#define CODEC_FRAME_BYTES     (CODEC_WIDTH * CODEC_HEIGHT * 2u)  /* 40960 */

/* Tile grid (8×8 pixel tiles) */
#define CODEC_TILE_W          8u
#define CODEC_TILE_H          8u
#define CODEC_TILES_X         (CODEC_WIDTH  / CODEC_TILE_W)  /* 20 */
#define CODEC_TILES_Y         (CODEC_HEIGHT / CODEC_TILE_H)  /* 16 */
#define CODEC_TILE_COUNT      (CODEC_TILES_X * CODEC_TILES_Y) /* 320 */
#define CODEC_DIRTY_BITMAP_BYTES  ((CODEC_TILE_COUNT + 7u) / 8u) /* 40 */
#define CODEC_PIXELS_PER_TILE (CODEC_TILE_W * CODEC_TILE_H)  /* 64 */

/* Packet header size */
#define CODEC_HEADER_SIZE     8u   /* magic(1)+type(1)+seq(2)+len(2)+crc(2) */

/* Default keyframe interval */
#define CODEC_KEYFRAME_INTERVAL 48u  /* 2 seconds at 24fps */

/* CRC16-CCITT poly (covers header fields before crc, then payload) */
#define CODEC_CRC_POLY        0x1021u
#define CODEC_CRC_INIT        0xFFFFu

// SADIK Color Codec Format — TypeScript constants
// Mirrors codec_format.h for host-side preview parity.

export const CODEC_MAGIC           = 0xC5;

// Packet types
export const CODEC_TYPE_IFRAME     = 0x01;
export const CODEC_TYPE_PFRAME     = 0x02;
export const CODEC_TYPE_ACK        = 0x03;
export const CODEC_TYPE_RESYNC     = 0x04;

// Display geometry
export const CODEC_WIDTH           = 160;
export const CODEC_HEIGHT          = 128;
export const CODEC_FRAME_BYTES     = CODEC_WIDTH * CODEC_HEIGHT * 2; // 40960

// Tile grid
export const CODEC_TILE_W          = 8;
export const CODEC_TILE_H          = 8;
export const CODEC_TILES_X         = CODEC_WIDTH  / CODEC_TILE_W;  // 20
export const CODEC_TILES_Y         = CODEC_HEIGHT / CODEC_TILE_H;  // 16
export const CODEC_TILE_COUNT      = CODEC_TILES_X * CODEC_TILES_Y; // 320
export const CODEC_DIRTY_BITMAP_BYTES = Math.ceil(CODEC_TILE_COUNT / 8); // 40
export const CODEC_PIXELS_PER_TILE = CODEC_TILE_W * CODEC_TILE_H;  // 64

// Packet header size
export const CODEC_HEADER_SIZE     = 8; // magic+type+seq(2)+len(2)+crc(2)

// Default keyframe interval
export const CODEC_KEYFRAME_INTERVAL = 48; // 2 seconds at 24fps

// Packet header layout helper
export interface PacketHeader {
  magic:      number; // 0xC5
  type:       number;
  seq:        number; // u16
  payloadLen: number; // u16
  crc16:      number; // u16
}

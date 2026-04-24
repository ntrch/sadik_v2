/**
 * SADIK Color — Codec Preview Flag
 *
 * When true, AnimationEngine loads clips from .bin (codec path) instead of
 * decoding mp4 via the video element. The canvas preview (OledPreview) renders
 * bit-exact frames matching what the device will show.
 *
 * To revert to mp4 preview in 10 seconds:
 *   set USE_CODEC_PREVIEW = false
 *
 * Device / backend / serial paths are NOT affected by this flag — they always
 * use the codec pipeline regardless of this setting.
 */
export const USE_CODEC_PREVIEW = true;

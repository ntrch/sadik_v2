/**
 * SADIK Color — Codec flags
 *
 * USE_CODEC_PREVIEW (default true):
 *   AnimationEngine loads clips from .bin instead of mp4.  The canvas preview
 *   renders bit-exact frames matching what the device will show.
 *   Set to false to revert to the mp4 video-element path.
 *
 * USE_CODEC_DEVICE (default false):
 *   When true, AnimationEngine stops sending raw RGB565 frames over the wire.
 *   Instead it calls POST /api/device/play-clip so the backend streams the
 *   .bin file directly to ESP32 using the sliding-window codec protocol.
 *
 *   Prerequisites:
 *     - USE_CODEC_PREVIEW must also be true (same decoded clip is active in engine).
 *     - Device must be connected (serial).
 *     - Firmware must have Sprint-2 F3.3 codec decoder (commit c8ec612).
 *
 *   Flip to true → the raw /api/device/frame pump is bypassed; the device
 *   receives codec packets instead.  Set back to false to restore old path.
 *   Step 6 removes the old path entirely once parity is validated on hardware.
 */
export const USE_CODEC_PREVIEW = true;

/**
 * When true, AnimationEngine calls device.playClip() instead of streaming
 * raw RGB565 frames via device.sendFrame().  Default false — flip to test
 * on hardware.  See class comment above for prerequisites.
 */
export const USE_CODEC_DEVICE = true;

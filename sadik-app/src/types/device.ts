// =============================================================================
// DeviceProfile — Multi-device Sprint-1 handshake types + parser
// =============================================================================
//
// Firmware emits a single DEVICE: line at boot (before MANIFEST: / SADIK:READY):
//   DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.6.0 caps=local_clips
//   DEVICE:variant=mini  hw=esp32-wroom32  display=128x64_mono    fw=2.0.0 caps=raw_frame_stream,progmem_clips
//
// Format: space-separated KEY=VALUE pairs after the "DEVICE:" prefix.
// =============================================================================

export type DeviceVariant = 'mini' | 'color';

export interface DeviceProfile {
  variant: DeviceVariant;
  display: string;
  capabilities: string[];
  fwVersion: string;
  hw: string;
}

/**
 * Parse a raw "DEVICE:..." firmware line into a DeviceProfile.
 * Returns null if the line is missing, malformed, or has an unknown variant.
 */
export function parseDeviceLine(line: string): DeviceProfile | null {
  if (!line || !line.startsWith('DEVICE:')) return null;

  const payload = line.slice('DEVICE:'.length).trim();
  if (!payload) return null;

  const pairs: Record<string, string> = {};
  for (const token of payload.split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq < 1) continue;
    pairs[token.slice(0, eq)] = token.slice(eq + 1);
  }

  const variant = pairs['variant'];
  if (variant !== 'mini' && variant !== 'color') return null;

  return {
    variant,
    display:      pairs['display']  ?? '',
    capabilities: (pairs['caps']    ?? '').split(',').filter(Boolean),
    fwVersion:    pairs['fw']       ?? '',
    hw:           pairs['hw']       ?? '',
  };
}

/** Fallback profile used when no DEVICE: line is seen within the handshake window. */
export const FALLBACK_DEVICE_PROFILE: DeviceProfile = {
  variant:      'mini',
  display:      '128x64_mono',
  capabilities: ['raw_frame_stream', 'progmem_clips'],
  fwVersion:    '2.0.0',
  hw:           'esp32-wroom32',
};

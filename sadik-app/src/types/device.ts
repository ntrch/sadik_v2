// =============================================================================
// DeviceProfile — T-Display S3 (color_v2) handshake types + parser
// =============================================================================
//
// Firmware emits a single DEVICE: line at boot (before MANIFEST: / SADIK:READY):
//   DEVICE:variant=color_v2 hw=esp32-s3-n16r8 display=320x170_rgb565  fw=0.7.0 caps=local_clips
//
// Format: space-separated KEY=VALUE pairs after the "DEVICE:" prefix.
// =============================================================================

export type DeviceVariant = 'color_v2';

/** Native display dimensions for each variant (pixels). */
export const DEVICE_DIMENSIONS: Record<DeviceVariant, { w: number; h: number }> = {
  color_v2: { w: 320, h: 170 },
};

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
  if (variant !== 'color_v2') return null;

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
  variant:      'color_v2',
  display:      '320x170_rgb565',
  capabilities: ['local_clips'],
  fwVersion:    '0.7.0',
  hw:           'esp32-s3-n16r8',
};

import { useEffect, useRef, useState, useCallback } from 'react';
import { getAnimationEngine } from '../engine/AnimationEngine';
import { EngineState, AnimationEventType } from '../engine/types';
import { deviceApi } from '../api/device';
import { COLOR_CLIP_DURATION_MS, COLOR_CLIP_FALLBACK_MS } from '../assets/colorClipManifest';

// ── Color variant clip name mapping ──────────────────────────────────────────
// Mini clip names (from eventMapping.ts / AnimationEngine) → color LittleFS names.
// Color manifest.json clip names must match exactly what LittleFS has on device.
const COLOR_CLIP_MAP: Record<string, string> = {
  // Engine clip name      : Color LittleFS name (must match /clips/<name>.bin)
  listening               : 'listening',
  thinking                : 'thinking',
  talking                 : 'talking',
  idle                    : 'idle',
  blink                   : 'blink',
  // Engine emits idle_alt_look_{left,right,down}; LittleFS uses idle_alt_{left,right}_look / idle_alt_look_down
  idle_alt_look_left      : 'idle_alt_left_look',
  idle_alt_look_right     : 'idle_alt_right_look',
  idle_alt_look_down      : 'idle_alt_look_down',
  return_to_idle          : 'return_to_idle',
  confirming              : 'confirming',
  understanding           : 'understanding',
  didnt_hear              : 'didnthear',
  waking                  : 'wakeword',
  mod_break               : 'mode_break',
  mod_break_text          : 'break_text',
  mod_working             : 'mode_working',
  mod_working_text        : 'mode_working_text',
  mod_gaming              : 'mode_gaming',
  mod_gaming_text         : 'mode_gaming_text',
  mod_meeting_text        : 'mode_meeting_text',
};

/** Translate a mini/engine clip name to the color LittleFS clip name. Returns null if no mapping. */
function toColorClipName(miniName: string | null): string | null {
  if (!miniName) return null;
  return COLOR_CLIP_MAP[miniName] ?? miniName; // fall back to same name if not in map
}

/** Map sadik_position setting → clip direction for focus-look. */
function positionToClipDirection(pos: 'left' | 'right' | 'top'): 'left' | 'right' | 'down' {
  if (pos === 'left')  return 'right'; // Sadık is left  → looks right (toward user)
  if (pos === 'right') return 'left';  // Sadık is right → looks left  (toward user)
  return 'down';                        // Sadık is top   → looks down  (toward user)
}

const defaultEngineState: EngineState = {
  playbackMode: 'text',
  currentClipName: null,
  currentFrameIndex: 0,
  totalFrames: 0,
  isPlaying: false,
  idleSubState: 'idle_loop',
  textContent: 'SADIK',
  fps: 12,
};

export function useAnimationEngine(
  deviceConnected: boolean,
  sadikPosition: 'left' | 'right' | 'top' = 'left',
  personaSlug: string = 'sadik',
  deviceVariant: 'mini' | 'color' | null = null,
) {
  const engine = getAnimationEngine();
  const rafRef = useRef<number | null>(null);
  const bufferRef = useRef<Uint8Array>(new Uint8Array(1024));
  const [engineState, setEngineState] = useState<EngineState>(defaultEngineState);
  // frameVersion increments to signal canvas needs a repaint
  const [frameVersion, setFrameVersion] = useState(0);

  // Track frame streaming state with refs to avoid stale closures
  const deviceConnectedRef = useRef(deviceConnected);
  const deviceVariantRef = useRef(deviceVariant);
  // Last color clip name sent — avoid re-sending duplicate PLAY_LOCAL commands
  const lastColorClipSentRef = useRef<string | null>(null);
  // Timestamp of last PLAY_LOCAL send — used for min-gap enforcement
  const lastColorClipSentAtRef = useRef<number>(0);
  // Pending clip to send after min-gap expires (latest wins)
  const pendingColorClipRef = useRef<string | null>(null);
  const pendingColorClipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clips that bypass the min-gap (high-priority interrupts)
  const COLOR_CLIP_FORCE_SET = new Set(['wakeword']);

  /** Return the min-gap for a given color clip name (its actual playback duration). */
  const getClipGapMs = (colorClip: string): number =>
    COLOR_CLIP_DURATION_MS[colorClip] ?? COLOR_CLIP_FALLBACK_MS;

  // Keep refs in sync
  useEffect(() => {
    deviceConnectedRef.current = deviceConnected;
    if (!deviceConnected) {
      // Reset last clip so next connection sends a fresh PLAY_LOCAL command
      lastColorClipSentRef.current = null;
      lastColorClipSentAtRef.current = 0;
      if (pendingColorClipTimerRef.current) {
        clearTimeout(pendingColorClipTimerRef.current);
        pendingColorClipTimerRef.current = null;
      }
      pendingColorClipRef.current = null;
    }
  }, [deviceConnected]);

  useEffect(() => {
    deviceVariantRef.current = deviceVariant;
    // When variant changes to non-color, reset last clip tracking
    if (deviceVariant !== 'color') {
      lastColorClipSentRef.current = null;
      lastColorClipSentAtRef.current = 0;
      if (pendingColorClipTimerRef.current) {
        clearTimeout(pendingColorClipTimerRef.current);
        pendingColorClipTimerRef.current = null;
      }
      pendingColorClipRef.current = null;
    }
  }, [deviceVariant]);

  useEffect(() => {
    // Register device command handler (control commands only: APP_CONNECTED, APP_DISCONNECTED, SET_BRIGHTNESS, SLEEP, WAKE)
    engine.onDeviceCommand(async (cmd: string) => {
      if (!deviceConnectedRef.current) return;
      try {
        await deviceApi.sendCommand(cmd);
      } catch (e) {
        console.warn('[AnimationEngine] device command failed:', cmd, e);
      }
    });

    // Two-consumer design with rate matching:
    //   • onFrameReady stages the LATEST buffer snapshot only.
    //   • Background pump takes the latest, sends to OLED, and on ACK bumps
    //     the preview — so screen preview visually matches the OLED refresh
    //     rate exactly. When disconnected, preview repaints immediately on
    //     each engine emit (OLED path skipped entirely).
    const latestPendingBuffer: { current: Uint8Array | null } = { current: null };
    let frameCount = 0;

    engine.onFrameReady((buffer: Uint8Array) => {
      const snapshot = new Uint8Array(buffer);
      latestPendingBuffer.current = snapshot;
      if (!deviceConnectedRef.current) {
        bufferRef.current = snapshot;
        setFrameVersion((v) => v + 1);
      }
    });

    let pumpAlive = true;
    const pump = async () => {
      while (pumpAlive) {
        // Frame streaming is ONLY active when variant is confirmed 'mini'.
        // 'color' → firmware handles LittleFS clips via PLAY_LOCAL, no frames needed.
        // null/'unknown' → variant not yet resolved; hold off to avoid sending frames
        //   to a color device before the device_profile WS arrives (race condition fix).
        if (deviceVariantRef.current !== 'mini') {
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        const buf = latestPendingBuffer.current;
        if (!buf || !deviceConnectedRef.current) {
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        frameCount++;
        if (frameCount <= 5 || frameCount % 60 === 0) {
          console.log(`[FrameStream] sending frame #${frameCount}`);
        }
        let delivered = false;
        try {
          const res = await deviceApi.sendFrame(buf);
          delivered = !!res.success;
          if (!delivered) console.warn('[FrameStream] drop');
        } catch (e) {
          console.warn('[FrameStream] send failed:', e);
        }
        if (delivered) {
          // Preview mirrors OLED refresh cadence — only bump on successful ACK.
          bufferRef.current = buf;
          setFrameVersion((v) => v + 1);
          // Clear staged buffer only if no newer frame arrived during the send.
          if (latestPendingBuffer.current === buf) latestPendingBuffer.current = null;
        }
        // On drop: leave buf staged so next pump iteration retries the same
        // frame. This rescues the held last-frame of non-looping clips (e.g.
        // 'confirming' freeze) — the engine stops emitting new frames in that
        // state, so if we cleared the buffer a drop would freeze both sides.
        // Newer frames from onFrameReady naturally overwrite during retry.
        // No sleep — device_manager's 250 ms serial ACK timeout is the natural
        // rate limit, and retries must be tight to keep OLED/preview in sync.
      }
    };
    pump();

    // Helper: actually send a PLAY_LOCAL command and update tracking state.
    const sendColorClip = (colorClip: string) => {
      lastColorClipSentRef.current = colorClip;
      lastColorClipSentAtRef.current = Date.now();
      deviceApi.sendCommand(`PLAY_LOCAL:${colorClip}`).catch(() => {});
      console.log(`[ColorClip] PLAY_LOCAL:${colorClip}`);
    };

    // Register state change listener — also drives color PLAY_LOCAL dispatch.
    engine.onStateChange((state) => {
      setEngineState(state);
      // Color variant: translate clip changes to PLAY_LOCAL:<name> ASCII commands.
      // The firmware (color) manages its own LittleFS playback; we just tell it which clip.
      if (deviceVariantRef.current === 'color' && deviceConnectedRef.current) {
        const colorClip = toColorClipName(state.currentClipName);
        if (colorClip) {
          // Dedupe: same clip already playing — skip
          if (colorClip === lastColorClipSentRef.current) return;

          const now = Date.now();
          const elapsed = now - lastColorClipSentAtRef.current;
          const isForce = COLOR_CLIP_FORCE_SET.has(colorClip);
          // Use actual duration of the previously sent clip as the min-gap.
          // This prevents a new clip from interrupting a clip that is still playing.
          const minGapMs = getClipGapMs(lastColorClipSentRef.current ?? '');

          if (isForce || elapsed >= minGapMs) {
            // Cancel any pending deferred send — this takes priority
            if (pendingColorClipTimerRef.current) {
              clearTimeout(pendingColorClipTimerRef.current);
              pendingColorClipTimerRef.current = null;
            }
            pendingColorClipRef.current = null;
            sendColorClip(colorClip);
          } else {
            // Within min-gap: defer; latest clip wins
            pendingColorClipRef.current = colorClip;
            if (!pendingColorClipTimerRef.current) {
              const delay = minGapMs - elapsed;
              pendingColorClipTimerRef.current = setTimeout(() => {
                pendingColorClipTimerRef.current = null;
                const next = pendingColorClipRef.current;
                pendingColorClipRef.current = null;
                if (next && next !== lastColorClipSentRef.current && deviceConnectedRef.current) {
                  sendColorClip(next);
                }
              }, delay);
            }
          }
        } else if (!state.currentClipName && state.playbackMode === 'idle') {
          // Returning to idle — firmware resumes its own idle orchestration
          if (lastColorClipSentRef.current !== '__idle__') {
            lastColorClipSentRef.current = '__idle__';
            lastColorClipSentAtRef.current = Date.now();
            deviceApi.sendCommand('RETURN_TO_IDLE').catch(() => {});
            console.log('[ColorClip] RETURN_TO_IDLE');
          }
        }
      }
    });

    // Load clips on mount (per active persona)
    engine.loadClips(personaSlug);

    // rAF loop — drives the engine clock only. Preview repaint and OLED send
    // both happen inside onFrameReady, so they share the same cadence.
    const loop = (timestamp: number) => {
      engine.update(timestamp);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pumpAlive = false;
      if (pendingColorClipTimerRef.current) {
        clearTimeout(pendingColorClipTimerRef.current);
        pendingColorClipTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: APP_CONNECTED is intentionally NOT sent here.
  // It is sent by AppContext after connectedDevice (and therefore the variant) has
  // been confirmed via the device_profile WebSocket handshake.  Sending it here
  // would race the handshake — deviceVariant is still 'mini' (default) when
  // deviceConnected first becomes true, causing APP_CONNECTED to reach a color
  // device before the variant guard can fire.  AppContext owns the timing now.

  // ── Focus-look wiring ────────────────────────────────────────────────────────
  // Tracks window focus state via Electron IPC when available, falling back to
  // document visibility / window focus events for web/dev builds.
  const windowFocusedRef = useRef(false);

  // Re-apply focus-look whenever sadikPosition changes while window is focused.
  useEffect(() => {
    if (!windowFocusedRef.current) return;
    engine.setFocusLook(positionToClipDirection(sadikPosition));
  }, [sadikPosition]);

  useEffect(() => {
    const applyFocus = (focused: boolean) => {
      windowFocusedRef.current = focused;
      if (focused) {
        engine.setFocusLook(positionToClipDirection(sadikPosition));
      } else {
        engine.setFocusLook(null);
      }
    };

    const electronAPI = (window as any).electronAPI;

    // Always register DOM-level focus/blur/visibility listeners. Even on the
    // Electron path these act as a redundant signal — BrowserWindow 'blur'
    // doesn't always fire on Windows when another app goes fullscreen
    // (e.g. Chrome F11), which would leave focus-look stuck. The DOM events
    // fire reliably in that case, so combining both sources keeps idle
    // recovery correct.
    const onFocus    = () => applyFocus(true);
    const onBlur     = () => applyFocus(false);
    const onVisibility = () => {
      // Only react to becoming hidden — becoming visible doesn't necessarily
      // mean we regained focus (could just be unminimized behind another app).
      if (document.visibilityState !== 'visible') applyFocus(false);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur',  onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    if (electronAPI?.onAppFocusChanged && electronAPI?.getFocusState) {
      // Electron path: subscribe to IPC events + query initial state
      electronAPI.onAppFocusChanged(applyFocus);
      electronAPI.getFocusState().then((focused: boolean) => applyFocus(focused)).catch(() => {});
    } else {
      // Web / no Electron preload — apply initial state from DOM only
      applyFocus(document.hasFocus() && !document.hidden);
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur',  onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerEvent = useCallback(
    (event: AnimationEventType, payload?: { text?: string }) => {
      engine.triggerEvent(event, payload);
    },
    []
  );

  const showText = useCallback((text: string) => {
    engine.showText(text);
  }, []);

  const returnToIdle = useCallback(() => {
    engine.triggerEvent('return_to_idle');
  }, []);

  const playClipDirect = useCallback((name: string) => {
    engine.playClipDirect(name);
  }, []);

  const playModClip = useCallback((name: string) => {
    engine.playModClip(name);
  }, []);

  const playModSequence = useCallback((intro: string, loop: string) => {
    engine.playModSequence(intro, loop);
  }, []);

  const playModSequenceWithCallback = useCallback(
    (intro: string, loop: string, onIntroFinish?: () => void) => {
      engine.playModSequenceWithCallback(intro, loop, onIntroFinish);
    },
    [],
  );

  const playModIntroOnce = useCallback(
    (intro: string, onFinish?: () => void) => {
      engine.playModIntroOnce(intro, onFinish);
    },
    [],
  );

  const getLoadedClipNames = useCallback(() => engine.getLoadedClipNames(), []);

  return {
    engineState,
    frameBuffer: bufferRef.current,
    frameVersion,
    triggerEvent,
    showText,
    returnToIdle,
    playClipDirect,
    playModClip,
    playModSequence,
    playModSequenceWithCallback,
    playModIntroOnce,
    getLoadedClipNames,
  };
}

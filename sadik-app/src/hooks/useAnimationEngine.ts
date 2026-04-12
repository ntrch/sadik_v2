import { useEffect, useRef, useState, useCallback } from 'react';
import { getAnimationEngine } from '../engine/AnimationEngine';
import { EngineState, AnimationEventType } from '../engine/types';
import { deviceApi } from '../api/device';

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

export function useAnimationEngine(deviceConnected: boolean) {
  const engine = getAnimationEngine();
  const rafRef = useRef<number | null>(null);
  const bufferRef = useRef<Uint8Array>(new Uint8Array(1024));
  const lastRenderRef = useRef<number>(0);
  const lastStateUpdateRef = useRef<number>(0);
  const [engineState, setEngineState] = useState<EngineState>(defaultEngineState);
  // frameVersion increments to signal canvas needs a repaint
  const [frameVersion, setFrameVersion] = useState(0);

  // Track frame streaming state with refs to avoid stale closures
  const deviceConnectedRef = useRef(deviceConnected);
  const lastFrameSendRef = useRef<number>(0);
  const frameSendInFlightRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    deviceConnectedRef.current = deviceConnected;
  }, [deviceConnected]);

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

    // Register frame-ready callback — streams frame data to device at ~12fps
    let frameCount = 0;
    engine.onFrameReady((buffer: Uint8Array) => {
      if (!deviceConnectedRef.current) return;

      const now = performance.now();
      // Throttle to ~12fps (83ms) and skip if a send is already in flight
      if (now - lastFrameSendRef.current < 83 || frameSendInFlightRef.current) return;

      lastFrameSendRef.current = now;
      frameSendInFlightRef.current = true;
      frameCount++;
      if (frameCount <= 5 || frameCount % 60 === 0) {
        console.log(`[FrameStream] sending frame #${frameCount}, buffer[0..3]=${buffer[0]},${buffer[1]},${buffer[2]},${buffer[3]}`);
      }
      deviceApi.sendFrame(buffer)
        .catch((e: unknown) => console.warn('[FrameStream] send failed:', e))
        .finally(() => { frameSendInFlightRef.current = false; });
    });

    // Register state change listener (throttled in the RAF loop instead)
    engine.onStateChange((state) => {
      setEngineState(state);
    });

    // Load clips on mount
    engine.loadClips();

    // rAF loop
    const loop = (timestamp: number) => {
      const buf = engine.update(timestamp);

      // Only signal repaint at ~60fps (every frame is fine for canvas)
      bufferRef.current = buf;

      // Throttle React state updates to ~15fps
      if (timestamp - lastStateUpdateRef.current >= 66) {
        lastStateUpdateRef.current = timestamp;
        setFrameVersion((v) => v + 1);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify firmware of app authority changes so it can suppress or restore
  // its autonomous idle orchestration (blink / look timers) accordingly.
  useEffect(() => {
    if (deviceConnected) {
      deviceApi.sendCommand('APP_CONNECTED').catch(() => {});
    }
    // APP_DISCONNECTED is sent by the backend disconnect endpoint before closing
    // the serial port, so the firmware receives it while the link is still open.
  }, [deviceConnected]);

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
    getLoadedClipNames,
  };
}

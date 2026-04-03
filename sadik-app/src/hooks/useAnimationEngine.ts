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

  useEffect(() => {
    // Register device command handler
    engine.onDeviceCommand(async (cmd: string) => {
      if (!deviceConnected) return;
      try {
        await deviceApi.sendCommand(cmd);
      } catch (e) {
        console.warn('[AnimationEngine] device command failed:', cmd, e);
      }
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

  // Update device command handler when connection status changes
  useEffect(() => {
    engine.onDeviceCommand(async (cmd: string) => {
      if (!deviceConnected) return;
      try {
        await deviceApi.sendCommand(cmd);
      } catch (e) {
        console.warn('[AnimationEngine] device command failed:', cmd, e);
      }
    });
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

  const getLoadedClipNames = useCallback(() => engine.getLoadedClipNames(), []);

  return {
    engineState,
    frameBuffer: bufferRef.current,
    frameVersion,
    triggerEvent,
    showText,
    returnToIdle,
    playClipDirect,
    getLoadedClipNames,
  };
}

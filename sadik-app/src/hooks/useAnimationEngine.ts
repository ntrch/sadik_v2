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
  const [engineState, setEngineState] = useState<EngineState>(defaultEngineState);
  // frameVersion increments to signal canvas needs a repaint
  const [frameVersion, setFrameVersion] = useState(0);

  // Track frame streaming state with refs to avoid stale closures
  const deviceConnectedRef = useRef(deviceConnected);
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

    // Single frame clock — preview AND OLED stream advance from the same
    // callback so they stay frame-perfect in sync. The engine already paces
    // frame production at clip.fps (~12fps) and only emits in text mode when
    // the buffer changes, so no time-based throttle is needed here.
    let frameCount = 0;
    engine.onFrameReady((buffer: Uint8Array) => {
      // Snapshot the buffer for the preview canvas. The actual repaint
      // (frameVersion bump) is deferred until the OLED has received this
      // frame, so the preview never runs ahead of the physical display.
      bufferRef.current = buffer;

      // No device link → preview is the only consumer; repaint immediately.
      if (!deviceConnectedRef.current) {
        setFrameVersion((v) => v + 1);
        return;
      }
      // Back-pressure: drop this frame if the previous send is still in
      // flight. Dropping here also skips the preview repaint, keeping the
      // two views frame-aligned.
      if (frameSendInFlightRef.current) return;

      frameSendInFlightRef.current = true;
      frameCount++;
      if (frameCount <= 5 || frameCount % 60 === 0) {
        console.log(`[FrameStream] sending frame #${frameCount}, buffer[0..3]=${buffer[0]},${buffer[1]},${buffer[2]},${buffer[3]}`);
      }
      deviceApi.sendFrame(buffer)
        .then((res: { success: boolean; error?: string }) => {
          if (res.success) {
            // Firmware ACK received → OLED has rendered this frame. Repaint
            // preview in the same instant so the two views stay atomic.
            setFrameVersion((v) => v + 1);
          } else {
            // ACK timeout or serial failure — OLED did NOT render this
            // frame. Do NOT bump preview (would desync). Ask the engine to
            // re-emit the current buffer on the next tick so transient
            // drops eventually recover (matters most for static text).
            console.warn('[FrameStream] drop:', res.error);
            engine.markBufferDirty();
          }
        })
        .catch((e: unknown) => {
          console.warn('[FrameStream] send failed:', e);
          engine.markBufferDirty();
        })
        .finally(() => { frameSendInFlightRef.current = false; });
    });

    // Register state change listener (throttled in the RAF loop instead)
    engine.onStateChange((state) => {
      setEngineState(state);
    });

    // Load clips on mount
    engine.loadClips();

    // rAF loop — drives the engine clock only. Preview repaint and OLED send
    // both happen inside onFrameReady, so they share the same cadence.
    const loop = (timestamp: number) => {
      engine.update(timestamp);
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

  const playModSequence = useCallback((intro: string, loop: string) => {
    engine.playModSequence(intro, loop);
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
    playModSequence,
    getLoadedClipNames,
  };
}

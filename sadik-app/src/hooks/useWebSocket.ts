import { useEffect, useRef, useCallback } from 'react';

const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY = 3000;

export type WSMessage = {
  type: string;
  data: Record<string, unknown>;
};

export function useWebSocket(onMessage: (msg: WSMessage) => void, onOpen?: () => void) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const connect = useCallback(() => {
    try {
      const socket = new WebSocket(WS_URL);
      ws.current = socket;

      socket.onopen = () => {
        console.log('WebSocket connected');
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        try {
          onOpenRef.current?.();
        } catch (e) {
          console.error('WS onopen handler error', e);
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          onMessageRef.current(msg);
        } catch (e) {
          console.error('WS parse error', e);
        }
      };

      socket.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      socket.onerror = (err) => {
        console.error('WebSocket error', err);
        socket.close();
      };
    } catch (e) {
      console.error('WS connect error', e);
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);
}

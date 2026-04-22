// Wake-word algılama tamamen backend (Python sounddevice) tarafında.
// Bu servis sadece WebSocket dinleyicisidir — mic yakalama kodu KALDIRILDI.

const COOLDOWN_MS       = 10000;
const WS_URL            = 'ws://127.0.0.1:8000/api/wake/ws';
const RECONNECT_DELAY_MS = 3000;   // unexpected disconnect sonrası yeniden bağlanma süresi
const MAX_RECONNECT_ATTEMPTS = 5;  // arka arkaya max yeniden bağlanma denemesi

type DetectedCb  = () => void;
type ErrorCb     = (msg: string) => void;
type ListeningCb = (active: boolean) => void;

export class WakeWordService {
  private ws:          WebSocket | null = null;
  private active       = false;
  private inCooldown   = false;
  private paused       = false;   // set during a voice turn; WS stays open
  private _starting    = false;
  private _stopped     = false;   // true after explicit stop() — suppresses reconnect

  // Reconnect state
  private _reconnectTimer:    ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts  = 0;

  private onDetected:  DetectedCb  | null = null;
  private onError:     ErrorCb     | null = null;
  private onListening: ListeningCb | null = null;

  setAccessKey(_key: string): void {}

  setSensitivity(_level: string): void {}

  // Şimdilik no-op: cihaz seçimi backend tarafında yapılacak
  setInputDeviceId(_deviceId: string): void {}

  /** Returns true if the service is connected, starting, or waiting to reconnect. */
  isActive(): boolean {
    return this.active || this._starting || this._reconnectTimer !== null;
  }

  async start(
    onDetected:   DetectedCb,
    onError?:     ErrorCb,
    onListening?: ListeningCb,
  ): Promise<void> {
    if (this.active || this._starting || this._reconnectTimer !== null) return;
    this._starting   = true;
    this._stopped    = false;
    this._reconnectAttempts = 0;
    this.onDetected  = onDetected;
    this.onError     = onError  ?? null;
    this.onListening = onListening ?? null;

    await this._connect();
  }

  stop(): void {
    if (!this.active && !this.ws && !this._starting && !this._reconnectTimer) return;
    this._stopped   = true;
    this.active     = false;
    this.inCooldown = false;
    this.paused     = false;
    this._cancelReconnect();
    this._cleanup();
    this.onListening?.(false);
    console.warn('[WakeWord] Durduruldu');
  }

  /** Temporarily suppress detections without tearing down the WS. */
  pause(): void {
    if (!this.active) return;
    this.paused = true;
    this.onListening?.(false);
  }

  /** Re-enable detections. Also clears any cooldown from the turn that just ended. */
  resume(): void {
    if (!this.active) return;
    this.paused     = false;
    this.inCooldown = false;
    this.onListening?.(true);
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async _connect(): Promise<void> {
    try {
      this.ws = new WebSocket(WS_URL);

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WebSocket bağlantı zaman aşımı')), 5000);
        this.ws!.onopen  = () => { clearTimeout(t); resolve(); };
        this.ws!.onerror = () => { clearTimeout(t); reject(new Error('WebSocket bağlantı hatası')); };
      });

      // Reset reconnect counter on successful open.
      this._reconnectAttempts = 0;

      this.ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type: string };
          if (msg.type === 'wake') this._handleDetection();
        } catch { /* ignore */ }
      };

      this.ws.onclose = () => {
        if (this._stopped) return;  // explicit stop — do not reconnect
        console.warn('[WakeWord] WS kapandı — yeniden bağlanılacak');
        this.active = false;
        this.onListening?.(false);
        this._scheduleReconnect();
      };

      this._starting = false;
      this.active    = true;
      this.onListening?.(true);
      console.log('[WakeWord] Backend wake-word dinleme başlatıldı');
    } catch (err: unknown) {
      this._starting = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WakeWord] Başlatma hatası:', msg);
      this._cleanup();
      if (this._stopped) return;
      // First failure: notify the user once, then retry silently.
      if (this._reconnectAttempts === 0) {
        this.onError?.(msg);
      }
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    if (this._stopped) return;
    this._reconnectAttempts++;
    if (this._reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('[WakeWord] Max yeniden bağlanma denemesi aşıldı — servis durduruldu');
      this._stopped = true;
      this.onListening?.(false);
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(this._reconnectAttempts, 3);
    console.log(`[WakeWord] ${delay}ms sonra yeniden bağlanılacak (deneme ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._stopped) return;
      await this._connect();
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _cleanup(): void {
    try {
      if (this.ws) {
        // Detach onclose BEFORE calling close() so our reconnect handler doesn't
        // fire in response to our own explicit teardown.
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
      }
    } catch { /* ignore */ }
    this.ws = null;
  }

  private _handleDetection(): void {
    if (!this.active || this.inCooldown || this.paused) return;
    this.inCooldown = true;
    this.onListening?.(false);
    this.onDetected?.();

    setTimeout(() => {
      this.inCooldown = false;
      if (this.active && !this.paused) this.onListening?.(true);
    }, COOLDOWN_MS);
  }
}

export const wakeWordService = new WakeWordService();

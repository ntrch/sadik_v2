# Kullanım:
#   pip install sounddevice websockets numpy
#   python tools/voice_v2_test_client.py
#   python tools/voice_v2_test_client.py --seconds 8
#   python tools/voice_v2_test_client.py --host localhost --port 8000 --seconds 5
#   python tools/voice_v2_test_client.py --voice Charon
#   python tools/voice_v2_test_client.py --voice Fenrir
#   python tools/voice_v2_test_client.py --voice Orus
#   python tools/voice_v2_test_client.py --rms-threshold 300   # daha sıkı sessizlik filtresi
#   python tools/voice_v2_test_client.py --rms-threshold 0     # RMS gate devre dışı
#
# Geçerli ses seçenekleri: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr

"""
SADIK v2 — Faz 2 gerçek konuşma test istemcisi.

Wire protokol (voice.py ile tam uyumlu):
  Client → Server: audio | end_of_turn | wake_ts | ping
  Server → Client: ready | audio | turn_complete | error | latency

Ses formatları:
  Mikrofon → server : 16 kHz, mono, int16 PCM, base64
  Server → hoparlör : 24 kHz, mono, int16 PCM, base64
"""

import argparse
import asyncio
import base64
import json
import sys
import time
import traceback
from collections import deque

import numpy as np

try:
    import sounddevice as sd
except ImportError:
    print("[HATA] sounddevice bulunamadı. Kur: pip install sounddevice", file=sys.stderr)
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("[HATA] websockets bulunamadı. Kur: pip install websockets", file=sys.stderr)
    sys.exit(1)

# ── Sabitler ───────────────────────────────────────────────────────────────────

MIC_RATE      = 16_000   # Hz — Gemini Live input formatı
OUTPUT_RATE   = 24_000   # Hz — Gemini Live output formatı
CHANNELS      = 1
DTYPE         = "int16"
CHUNK_FRAMES  = 1600     # 100 ms @ 16 kHz

# RMS gate (T9.5.3): mic chunk'larını RMS < threshold ise Gemini'ye gönderme.
# int16 PCM için tipik sessizlik RMS < 200, konuşma RMS > 800.
# Default 0 (KAPALI): mikrofon gain'i cihaza göre çok değişken (Fuxi-H3 USB
# mikrofonunda 150 bile %96 chunk'ı kestiği görüldü). Production'da silero VAD
# (T9.5.5) bunu replace edecek. Şimdilik opt-in.
RMS_THRESHOLD = 0

# ── Latency telemetri ──────────────────────────────────────────────────────────

class Telemetry:
    def __init__(self):
        self.t_connect:            float | None = None  # WS bağlantısı kuruldu
        self.t_ready:              float | None = None  # "ready" mesajı alındı
        self.t_wake_sent:          float | None = None  # wake_ts gönderildi
        self.t_end_of_turn:        float | None = None  # end_of_turn gönderildi (kullanıcı konuşmayı bitirdi)
        self.t_first_audio:        float | None = None  # ilk audio frame alındı
        self.t_turn_complete:      float | None = None  # turn_complete alındı

    def print_table(self):
        print()
        print("=" * 50)
        print("  LATENCY TELEMETRY")
        print("=" * 50)

        def ms(a, b):
            if a is None or b is None:
                return "  N/A"
            return f"{(b - a) * 1000:7.0f} ms"

        print(f"  open          → ready          : {ms(self.t_connect, self.t_ready)}")
        print(f"  end_of_turn   → first_audio    : {ms(self.t_end_of_turn, self.t_first_audio)}  ← KRİTİK (gerçek roundtrip)")
        print(f"  end_of_turn   → turn_complete  : {ms(self.t_end_of_turn, self.t_turn_complete)}")
        print(f"  wake          → first_audio    : {ms(self.t_wake_sent, self.t_first_audio)}  (kayıt süresi dahil)")
        print(f"  wake          → turn_complete  : {ms(self.t_wake_sent, self.t_turn_complete)}  (kayıt süresi dahil)")
        print("=" * 50)
        print()
        print("  Yorum:")
        if self.t_end_of_turn and self.t_first_audio:
            d = (self.t_first_audio - self.t_end_of_turn) * 1000
            if d < 1000:
                print(f"  end_of_turn→first_audio = {d:.0f}ms  ✓  Mükemmel, kullanıcı 'anlık' algılar.")
            elif d < 2500:
                print(f"  end_of_turn→first_audio = {d:.0f}ms  ~ Kabul edilebilir (router LLM bekliyor, normal).")
            else:
                print(f"  end_of_turn→first_audio = {d:.0f}ms  ✗  Yüksek gecikme — router LLM yavaş veya ağ sorunu.")
        else:
            print("  first_audio alınamadı — sunucu yanıt vermedi ya da hata oluştu.")
        print("=" * 50)
        print()


# ── Ana istemci ────────────────────────────────────────────────────────────────

async def run(host: str, port: int, seconds: int, voice: str = "Charon", rms_threshold: int = RMS_THRESHOLD):
    uri = f"ws://{host}:{port}/api/voice/live?voice={voice}"
    tel = Telemetry()

    # Hoparlör için PCM tampon kuyruğu (thread-safe deque)
    audio_queue: deque[bytes] = deque()
    playback_done = asyncio.Event()
    turn_complete_flag = asyncio.Event()

    print(f"[INFO] Bağlanılıyor: {uri}  (ses: {voice})")
    try:
        ws = await websockets.connect(uri, ping_interval=20, ping_timeout=30)
    except Exception as e:
        print(f"[HATA] WebSocket bağlantısı kurulamadı: {e}")
        traceback.print_exc()
        return

    tel.t_connect = time.monotonic()
    print(f"[INFO] WS bağlandı ({tel.t_connect:.3f}s monotonic)")

    # ── "ready" bekle ─────────────────────────────────────────────────────────
    print("[INFO] Sunucudan 'ready' bekleniyor...")
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=15)
    except asyncio.TimeoutError:
        print("[HATA] 'ready' mesajı 15s içinde gelmedi. Backend ayakta mı? voice_v2_enabled=true mi?")
        await ws.close()
        tel.print_table()
        return

    msg = json.loads(raw)
    if msg.get("type") == "error":
        print(f"[HATA] Sunucu hatası: {msg.get('detail', '?')}")
        await ws.close()
        tel.print_table()
        return
    if msg.get("type") != "ready":
        print(f"[HATA] Beklenmeyen mesaj: {msg}")
        await ws.close()
        tel.print_table()
        return

    tel.t_ready = time.monotonic()
    print(f"[INFO] Sunucu hazır (open→ready={(tel.t_ready-tel.t_connect)*1000:.0f}ms)")

    # ── wake_ts gönder ────────────────────────────────────────────────────────
    wake_ts_val = time.monotonic() * 1000  # ms cinsinden monotonic
    await ws.send(json.dumps({"type": "wake_ts", "ts": time.monotonic()}))
    tel.t_wake_sent = time.monotonic()
    print(f"[INFO] wake_ts gönderildi")

    # ── Hoparlör çalma goroutine ───────────────────────────────────────────────
    async def playback_loop():
        """audio_queue'den PCM al, sounddevice OutputStream ile çal."""
        loop = asyncio.get_event_loop()

        output_stream = sd.OutputStream(
            samplerate=OUTPUT_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
        )
        output_stream.start()
        print("[INFO] Hoparlör akışı açıldı (24 kHz)")

        try:
            while not (turn_complete_flag.is_set() and len(audio_queue) == 0):
                if audio_queue:
                    chunk = audio_queue.popleft()
                    pcm = np.frombuffer(chunk, dtype=np.int16)
                    output_stream.write(pcm)
                else:
                    # Bekleme — CPU yakma, kısa uyku
                    await asyncio.sleep(0.005)
        finally:
            # Kalan veriyi flush et
            while audio_queue:
                chunk = audio_queue.popleft()
                pcm = np.frombuffer(chunk, dtype=np.int16)
                output_stream.write(pcm)
            output_stream.stop()
            output_stream.close()
            print("[INFO] Hoparlör akışı kapatıldı")
            playback_done.set()

    # ── Sunucudan mesaj alma goroutine ────────────────────────────────────────
    async def receive_loop():
        nonlocal tel
        try:
            async for raw in ws:
                msg = json.loads(raw)
                mtype = msg.get("type", "")

                if mtype == "audio":
                    pcm_bytes = base64.b64decode(msg["data"])
                    if tel.t_first_audio is None:
                        tel.t_first_audio = time.monotonic()
                        latency_ms = (tel.t_first_audio - tel.t_wake_sent) * 1000
                        print(f"[INFO] İlk audio frame alındı (wake→first={latency_ms:.0f}ms)")
                    audio_queue.append(pcm_bytes)

                elif mtype == "transcript":
                    # T9.5.2 — kullanıcı konuşma transkripsiyonu
                    text     = msg.get("text", "")
                    finished = msg.get("finished", False)
                    if finished:
                        print(f"[TRANSCRIPT] (FINAL) {text}")
                    else:
                        print(f"[TRANSCRIPT] (incr)  {text}")

                elif mtype == "turn_complete":
                    tel.t_turn_complete = time.monotonic()
                    tc_ms = (tel.t_turn_complete - tel.t_wake_sent) * 1000
                    print(f"[INFO] turn_complete alındı (wake→complete={tc_ms:.0f}ms)")
                    # Don't set the flag yet — a tool_result may immediately follow.
                    # If no tool_result arrives within 5s, treat as chat turn (A-path only).
                    asyncio.get_event_loop().call_later(5.0, turn_complete_flag.set)

                elif mtype == "tool_result":
                    # T9.5.2 Adım 3 — B-path tool execution result
                    tool_name = msg.get("tool_name", "?")
                    status    = msg.get("status", "?")
                    data      = msg.get("data", {})
                    error     = msg.get("error")
                    if status == "ok":
                        result_text = (data or {}).get("result", "")
                        print(f"[TOOL] OK  {tool_name}")
                        if result_text:
                            print(f"       {result_text[:200]}")
                    else:
                        print(f"[TOOL] ERR {tool_name} — {error}")
                    # After tool_result the turn is fully done
                    turn_complete_flag.set()
                    break

                elif mtype == "error":
                    print(f"[HATA] Sunucu hatası: {msg.get('detail', '?')}")
                    turn_complete_flag.set()
                    break

                elif mtype == "latency":
                    print(f"[TELEMETRY] Sunucu latency: {msg}")

                else:
                    print(f"[WARN] Bilinmeyen mesaj tipi: {mtype}")

        except websockets.exceptions.ConnectionClosed as e:
            print(f"[WARN] WS bağlantısı kapandı: {e}")
            turn_complete_flag.set()
        except Exception as e:
            print(f"[HATA] receive_loop: {e}")
            traceback.print_exc()
            turn_complete_flag.set()

    # ── Mikrofon kaydı ve gönderme ────────────────────────────────────────────
    async def record_and_send():
        print(f"\n[MIC] {seconds}s kayıt başlıyor — konuşun!")
        print(f"      RMS gate threshold: {rms_threshold} (int16 RMS)")
        print("      (Kayıt biterken Gemini yanıtını bekleyin...)\n")

        loop = asyncio.get_event_loop()
        mic_queue: asyncio.Queue[np.ndarray] = asyncio.Queue()

        def mic_callback(indata, frames, time_info, status):
            if status:
                print(f"[WARN] Mic status: {status}", file=sys.stderr)
            # indata kopyasını kuyruğa ekle
            loop.call_soon_threadsafe(mic_queue.put_nowait, indata.copy())

        stream = sd.InputStream(
            samplerate=MIC_RATE,
            channels=CHANNELS,
            dtype=DTYPE,
            blocksize=CHUNK_FRAMES,
            callback=mic_callback,
        )

        chunks_sent = 0
        chunks_gated = 0
        try:
            with stream:
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    try:
                        chunk = await asyncio.wait_for(mic_queue.get(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue

                    # ── RMS gate (T9.5.3) ─────────────────────────────────────
                    # Compute RMS of the int16 PCM chunk.  Cast to float32 to
                    # avoid integer overflow when squaring int16 values.
                    pcm_int16 = chunk.flatten().astype(np.float32)
                    rms = float(np.sqrt(np.mean(pcm_int16 ** 2)))
                    if rms < rms_threshold:
                        chunks_gated += 1
                        continue  # silence — don't send to Gemini

                    pcm_bytes = chunk.tobytes()
                    b64 = base64.b64encode(pcm_bytes).decode("ascii")
                    await ws.send(json.dumps({"type": "audio", "data": b64}))
                    chunks_sent += 1
        except sd.PortAudioError as e:
            print(f"[HATA] Mikrofon erişimi başarısız: {e}")
            traceback.print_exc()
            return
        except Exception as e:
            print(f"[HATA] Kayıt sırasında hata: {e}")
            traceback.print_exc()
            return

        total_chunks = chunks_sent + chunks_gated
        gate_pct = (chunks_gated / total_chunks * 100) if total_chunks > 0 else 0
        print(
            f"[MIC] Kayıt bitti | sent={chunks_sent} gated={chunks_gated}/{total_chunks} "
            f"({gate_pct:.0f}% sessizlik). end_of_turn gönderiliyor..."
        )
        await ws.send(json.dumps({"type": "end_of_turn"}))
        tel.t_end_of_turn = time.monotonic()

    # ── Goroutine'leri başlat ─────────────────────────────────────────────────
    playback_task = asyncio.create_task(playback_loop())
    receive_task  = asyncio.create_task(receive_loop())

    # Kayıt + gönderme (bloklar, seconds kadar sürer)
    await record_and_send()

    # turn_complete veya hata gelene kadar bekle (max 30s ekstra)
    print("[INFO] Gemini yanıtı bekleniyor (max 30s)...")
    try:
        await asyncio.wait_for(turn_complete_flag.wait(), timeout=30)
    except asyncio.TimeoutError:
        print("[WARN] 30s timeout — turn_complete gelmedi, devam ediliyor.")
        turn_complete_flag.set()

    # Playback bitmesini bekle
    try:
        await asyncio.wait_for(playback_done.wait(), timeout=30)
    except asyncio.TimeoutError:
        print("[WARN] Playback timeout.")

    # Temizlik
    receive_task.cancel()
    try:
        await receive_task
    except (asyncio.CancelledError, Exception):
        pass

    try:
        await ws.close()
    except Exception:
        pass

    tel.print_table()


# ── Giriş noktası ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="SADIK v2 — Faz 2 gerçek konuşma test istemcisi"
    )
    parser.add_argument("--host",    default="localhost", help="Backend host (default: localhost)")
    parser.add_argument("--port",    default=8000, type=int, help="Backend port (default: 8000)")
    parser.add_argument("--seconds", default=5, type=int, help="Kayıt süresi saniye (default: 5)")
    parser.add_argument(
        "--voice",
        default="Charon",
        help="Gemini prebuilt ses adı (default: Charon). Seçenekler: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr",
    )
    parser.add_argument(
        "--rms-threshold",
        default=RMS_THRESHOLD,
        type=int,
        help=f"RMS gate eşiği (int16 PCM, default: {RMS_THRESHOLD}). "
             "Bu değerin altındaki chunk'lar sessizlik sayılır ve Gemini'ye gönderilmez.",
    )
    args = parser.parse_args()

    print(f"\nSADIK v2 — Voice V2 Test İstemcisi")
    print(f"Host: {args.host}:{args.port}  |  Süre: {args.seconds}s  |  Ses: {args.voice}  |  RMS gate: {args.rms_threshold}")
    print(f"Mikrofon: 16kHz mono int16  |  Çıkış: 24kHz mono int16\n")

    # Ses cihazlarını listele (debug için)
    try:
        default_in  = sd.query_devices(kind="input")
        default_out = sd.query_devices(kind="output")
        print(f"[DEVICE] Mikrofon : {default_in['name']}")
        print(f"[DEVICE] Hoparlör : {default_out['name']}\n")
    except Exception as e:
        print(f"[WARN] Ses cihazı sorgulanamadı: {e}\n")

    try:
        asyncio.run(run(args.host, args.port, args.seconds, args.voice, args.rms_threshold))
    except KeyboardInterrupt:
        print("\n[INFO] Kullanıcı tarafından durduruldu.")
    except Exception as e:
        print(f"\n[HATA] Beklenmeyen hata: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

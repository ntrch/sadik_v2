import asyncio
import collections
import os
import threading
import logging
import numpy as np

logger = logging.getLogger(__name__)

SAMPLE_RATE        = 16000
DEFAULT_THRESHOLD  = 0.35   # custom model için düşürüldü (önceki 0.7 idi)
DEFAULT_INPUT_GAIN = 1.5    # pre-inference amplification (1.0 = kapalı)
CHUNK_SAMPLES      = 1280   # 80 ms @ 16 kHz — openWakeWord beklentisi
# sounddevice'in native rate'i genellikle 48000; basit decimation ile 16k'ya indiriyoruz.
NATIVE_RATE   = 48000
DECIMATE      = NATIVE_RATE // SAMPLE_RATE   # 3

# Diagnostic buffer — son 100 frame'in (rms, score) çiftleri
_DIAG_MAXLEN = 100
_diag_buffer: collections.deque = collections.deque(maxlen=_DIAG_MAXLEN)


class WakeWordDetector:
    def __init__(self):
        self._model    = None
        self._thread: threading.Thread | None = None
        self._stop_evt = threading.Event()
        self._callback = None          # çağrılacak fonksiyon: callback() — thread-safe değil, loop üzerinden çağrılır
        self._loop: asyncio.AbstractEventLoop | None = None
        self._pending  = np.empty(0, dtype=np.int16)
        self._score_key = "hey_jarvis"
        # Runtime-tunable params (hot-reload via set_threshold / set_gain)
        self._threshold  = DEFAULT_THRESHOLD
        self._input_gain = DEFAULT_INPUT_GAIN

    # ------------------------------------------------------------------
    # Model yükleme (uygulama başlangıcında çağrılır)
    # ------------------------------------------------------------------
    def load(self, model_path: str | None = None) -> None:
        """Load a wake model. If `model_path` is a valid file, use it;
        otherwise fall back to the pretrained `hey_jarvis` model."""
        from openwakeword.model import Model
        if model_path and os.path.isfile(model_path):
            self._model = Model(wakeword_models=[model_path], inference_framework="onnx")
            # openWakeWord keys predictions by the model's internal name; for
            # custom ONNX files that's the filename without extension.
            self._score_key = os.path.splitext(os.path.basename(model_path))[0]
            logger.info("[WakeWord] openWakeWord modeli yüklendi (%s, key=%s)", model_path, self._score_key)
        else:
            self._model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
            self._score_key = "hey_jarvis"
            if model_path:
                logger.warning("[WakeWord] %s bulunamadı — hey_jarvis'e geri dönüldü", model_path)
            else:
                logger.info("[WakeWord] openWakeWord modeli yüklendi (hey_jarvis)")

    # ------------------------------------------------------------------
    # Hot-reload param setters (backend restart gerekmez)
    # ------------------------------------------------------------------
    def set_threshold(self, value: float) -> None:
        self._threshold = float(value)
        logger.info("[WakeWord] threshold güncellendi: %.3f", self._threshold)

    def set_input_gain(self, value: float) -> None:
        self._input_gain = float(value)
        logger.info("[WakeWord] input_gain güncellendi: %.2f", self._input_gain)

    # ------------------------------------------------------------------
    # Eski feed() API'si — artık kullanılmıyor ama import bozulmasın diye kalsın
    # ------------------------------------------------------------------
    def feed(self, pcm_bytes: bytes) -> bool:
        if self._model is None:
            return False
        audio = np.frombuffer(pcm_bytes, dtype=np.int16)
        predictions = self._model.predict(audio)
        score = predictions.get("hey_jarvis", 0.0)
        if isinstance(score, (list, np.ndarray)):
            score = float(np.max(score))
        else:
            score = float(score)
        return score >= self._threshold

    # ------------------------------------------------------------------
    # Backend-taraflı mikrofon dinleme
    # ------------------------------------------------------------------
    def start_listening(self, callback, loop: asyncio.AbstractEventLoop) -> None:
        """sounddevice ile mikrofonu açar, wake-word algılandığında callback()'i çağırır."""
        # Always update callback + loop so a reconnected WS gets detections even
        # if the mic thread is already running from a previous connection.
        self._callback = callback
        self._loop     = loop
        if self._thread and self._thread.is_alive():
            logger.info("[WakeWord] Mic thread zaten çalışıyor — callback güncellendi")
            return
        self._stop_evt.clear()
        self._pending  = np.empty(0, dtype=np.int16)
        # Warmup: ignore first ~1.2 s of chunks. Freshly opened mic + empty
        # model history produce spurious high scores that would auto-trigger
        # listening as soon as the wake toggle is turned on.
        self._warmup_remaining = 15   # 15 chunks × 80 ms ≈ 1.2 s
        self._debug_counter    = 0
        self._keys_logged      = False
        # Clear model history so prior-session audio doesn't leak into the
        # first fresh prediction and cause a false positive.
        try:
            if self._model is not None and hasattr(self._model, "reset"):
                self._model.reset()
        except Exception:
            pass
        self._thread   = threading.Thread(target=self._record_loop, daemon=True, name="wake-mic")
        self._thread.start()
        logger.info("[WakeWord] Mikrofon dinleme başlatıldı (threshold=%.3f, gain=%.2f)",
                    self._threshold, self._input_gain)

    def stop_listening(self) -> None:
        self._stop_evt.set()
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        logger.info("[WakeWord] Mikrofon dinleme durduruldu")

    # ------------------------------------------------------------------
    # Dahili kayıt döngüsü (ayrı thread)
    # ------------------------------------------------------------------
    def _record_loop(self) -> None:
        try:
            import sounddevice as sd
        except ImportError:
            logger.error("[WakeWord] sounddevice yüklü değil. `pip install sounddevice` çalıştırın.")
            return

        def _sd_callback(indata, frames, time_info, status):
            if self._stop_evt.is_set():
                return
            # indata: (frames, 1) float32, NATIVE_RATE
            mono = indata[:, 0]
            # Basit decimation: her DECIMATE örnekte bir tane al
            decimated = mono[::DECIMATE]
            # float32 → int16
            samples = (np.clip(decimated, -1.0, 1.0) * 32767).astype(np.int16)
            # Ring buffer'a ekle
            combined = np.concatenate([self._pending, samples])
            # Her CHUNK_SAMPLES'lık blok için modeli çalıştır
            offset = 0
            while offset + CHUNK_SAMPLES <= len(combined):
                chunk = combined[offset: offset + CHUNK_SAMPLES]
                offset += CHUNK_SAMPLES
                if self._detect(chunk):
                    # asyncio loop'una güvenli push
                    if self._loop and self._callback:
                        self._loop.call_soon_threadsafe(self._callback)
            self._pending = combined[offset:]

        blocksize = NATIVE_RATE // 12  # ~83ms @ 48kHz ≈ 4000 sample
        try:
            with sd.InputStream(
                samplerate=NATIVE_RATE,
                channels=1,
                dtype="float32",
                blocksize=blocksize,
                callback=_sd_callback,
            ):
                logger.info("[WakeWord] sounddevice InputStream açık")
                self._stop_evt.wait()   # stop_listening() çağrılana kadar bekle
        except Exception as e:
            logger.error("[WakeWord] sounddevice hatası: %s", e)

    _debug_counter = 0

    def _detect(self, chunk: np.ndarray) -> bool:
        if self._model is None:
            self._debug_counter += 1
            if self._debug_counter % 50 == 1:
                logger.error("[WakeWord] Model YÜKLÜ DEĞİL — detect atlanıyor")
            return False
        # Warmup: feed the model so history fills, but never return True.
        if self._warmup_remaining > 0:
            self._warmup_remaining -= 1
            try:
                self._model.predict(chunk)
            except Exception:
                pass
            if self._warmup_remaining == 0:
                logger.info("[WakeWord] Warmup tamamlandı — algılama aktif")
            return False

        # --- Input gain (opt-in amplification) ---
        gain = self._input_gain
        if gain != 1.0:
            # int16 → float → amplify → clip → int16
            f = chunk.astype(np.float32) / 32767.0
            f = np.clip(f * gain, -1.0, 1.0)
            chunk = (f * 32767).astype(np.int16)

        # --- RMS log (her 50 frame'de bir DEBUG, daima hesapla) ---
        rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) / 32767.0

        predictions = self._model.predict(chunk)
        # Log available prediction keys once after warmup so score_key mismatches are obvious.
        if not getattr(self, "_keys_logged", False):
            self._keys_logged = True
            logger.info("[WakeWord] predictions keys=%s (using key=%s)",
                        list(predictions.keys()), self._score_key)
        raw = predictions.get(self._score_key, None)
        if raw is None:
            # Fallback: take the highest-scoring key so a mismatched filename
            # doesn't silently suppress detection.
            if predictions:
                best_key = max(predictions.keys(), key=lambda k: float(np.max(predictions[k]))
                               if isinstance(predictions[k], (list, np.ndarray))
                               else float(predictions[k]))
                raw = predictions[best_key]
            else:
                raw = 0.0
        if isinstance(raw, (list, np.ndarray)):
            score = float(np.max(raw))
        else:
            score = float(raw)

        # Diagnostic buffer'a ekle
        _diag_buffer.append((rms, score))

        # Her ~1 sn'de bir en yüksek skoru logla (~12 chunk/sn)
        self._debug_counter += 1
        if self._debug_counter % 50 == 0:
            logger.debug("[WakeWord] RMS=%.4f score=%.3f (gain=%.2f threshold=%.3f)",
                         rms, score, self._input_gain, self._threshold)
        if score > 0.1 or self._debug_counter % 25 == 0:
            logger.info("[WakeWord] score=%.3f rms=%.4f", score, rms)
        return score >= self._threshold


detector = WakeWordDetector()

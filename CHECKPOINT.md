# SADIK v2 — Project Checkpoint

> **Son guncelleme:** 2026-04-12
> **Checkpoint versiyonu:** v12.0
> **Proje sahibi:** Eren (ntrch)

---

## LLM Governance Model

```
KARAR VERICI  :  Claude Opus 4.6  (Product Manager + Lead Developer)
UYGULAYICI    :  Claude Sonnet 4.6 (Sub-agent, aksiyon alici)
KURAL         :  Opus karar verir, Sonnet execute eder. Token-efficient calisma.
```

**Isleyis protokolu:**
1. Eren bir task/istek belirtir.
2. Opus 4.6 taski analiz eder, approach'u belirler, dosya/satir/degisiklik detayini cikarir.
3. Opus, Sonnet 4.6 sub-agent'a net ve spesifik bir prompt ile aksiyon aldirir.
4. Sonnet sadece verilen talimati uygular; mimari karar almaz, scope genisletmez.
5. Opus sonucu dogrular, gerekiyorsa iterasyon yapar.

**Sonnet icin kurallar:**
- Sadece verilen dosya/satir/degisiklik uzerinde calis.
- Ek feature, refactor, docstring ekleme.
- Hata durumunda Opus'a raporla, kendi basina cozum uretme.
- Her degisiklik icin minimum diff uret.

**Opus icin kurallar:**
- Tum mimari kararlar senin.
- Task onceliklendirme senin.
- Her task icin Sonnet'e verecegin prompt: dosya yolu, satir numarasi, ne degisecek, neden degisecek.
- Bu dokumani her major checkpoint'te guncelle.

---

## Proje Nedir?

SADIK (Sesli Asistan & Dijital Icerik Koordinatoru) — Eren'in kisisel masaustu asistani.

**3 katman:**
```
sadik-app/       Electron + React + TypeScript (masaustu UI)
sadik-backend/   Python FastAPI (API, LLM, TTS/STT, device management)
sadik-firmware/  ESP32 + PlatformIO (SH1106 128x64 OLED fiziksel cihaz)
```

**Temel yetenekler:**
- Sesli konusma (wake word → STT → LLM → TTS → speaker)
- Metin tabanli sohbet (ChatGPT API uzerinden)
- Gorev yonetimi (Kanban board: todo/in_progress/done)
- Pomodoro zamanlayici
- Mod takibi (calisma/kod/mola/toplanti)
- OLED animasyon motoru (idle blink/look, event-driven clip'ler)
- Uygulama kullanim istatistikleri
- Proaktif oneriler (kullanim pattern'lerine gore)

---

## Mimari Ozet

### Frontend (sadik-app/)

| Dosya/Dizin | Rol |
|---|---|
| `src/App.tsx` | Router: Dashboard, Tasks (+ Focus tab), Chat (+ Voice tab), Insights (Kullanim), Settings |
| `src/context/AppContext.tsx` | Global state: mode, device, pomodoro, wake word, animation engine, audio devices |
| `src/hooks/useAnimationEngine.ts` | Animation engine hook: frame streaming pipeline, throttled frame send to device |
| `src/components/layout/HeaderBar.tsx` | Header: clock, date, greeting, OLED preview (centered), connection status, brightness, mic, settings |
| `src/components/layout/BottomNav.tsx` | Floating glass navbar: 4 items (Ana Sayfa, Gorevler, Sohbet, Kullanim), per-icon active colors |
| `src/components/voice/VoiceAssistant.tsx` | Ses pipeline: VAD → STT → LLM → TTS → playback. Conversation bubble UI |
| `src/services/wakeWordService.ts` | Wake word detection: 2s chunk → Whisper STT → Turkish text matching |
| `src/engine/AnimationEngine.ts` | OLED animation engine: clip playback, idle orchestration, text rendering |
| `src/engine/types.ts` | AnimationEventType, PlaybackMode, EngineState type definitions |
| `src/engine/eventMapping.ts` | Event → clip mapping tablosu |
| `src/pages/DashboardPage.tsx` | Mode selector, stat cards, app usage, activity chart, animation debug panel |
| `src/pages/FocusPage.tsx` | Pomodoro timer + task selector (embedded in Tasks page as tab) |
| `src/pages/SettingsPage.tsx` | API keys, TTS provider, device config, wake word, proactive suggestions |
| `src/components/chat/ChatWindow.tsx` | Metin sohbet penceresi (chat sayfasi & voice overlay) |

**Tech stack:** React 18, TypeScript, Tailwind CSS, Webpack, Electron 28, axios, recharts, @ricky0123/vad-web

### Backend (sadik-backend/)

| Dosya | Rol |
|---|---|
| `app/main.py` | FastAPI app, CORS, lifespan (DB init, auto-connect, shutdown) |
| `app/routers/voice.py` | `/api/voice/stt` (Whisper), `/api/voice/tts` (ElevenLabs/OpenAI/Edge-TTS) |
| `app/routers/chat.py` | `/api/chat/message`, `/api/chat/history` — LLM sohbet |
| `app/routers/tasks.py` | CRUD task management |
| `app/routers/modes.py` | Mode set/get |
| `app/routers/pomodoro.py` | Timer start/stop/pause/resume |
| `app/routers/device.py` | Serial/WiFi device connect/disconnect |
| `app/routers/stats.py` | Daily mode stats, app usage stats, proactive insights |
| `app/routers/ws.py` | WebSocket for real-time device↔app sync |
| `app/services/chat_service.py` | OpenAI chat completion, system prompt, local context injection |
| `app/services/voice_service.py` | STT (Whisper API), TTS (ElevenLabs → OpenAI → Edge-TTS fallback chain) |
| `app/services/device_manager.py` | Serial port management, command send/receive |
| `app/services/serial_service.py` | Low-level serial communication |
| `app/services/wifi_device_service.py` | WiFi device communication |
| `app/services/pomodoro_service.py` | Timer logic, session tracking |
| `app/services/mode_tracker.py` | Mode duration tracking |
| `app/services/ws_manager.py` | WebSocket connection manager |

**Tech stack:** Python, FastAPI, SQLAlchemy (async, SQLite), OpenAI API, ElevenLabs API, edge-tts, pyserial

### Firmware (sadik-firmware/)

| Dosya | Rol |
|---|---|
| `src/main.cpp` | ESP32 main loop: serial command parser, OLED display, clip player, idle orchestrator |
| `src/mic_poc.cpp` | INMP441 microphone proof-of-concept |

**Tech stack:** PlatformIO, ESP32-WROOM-32, U8g2 (SH1106 128x64 OLED), C++

**Firmware playback modes:** `MODE_BOOT`, `MODE_IDLE`, `MODE_EXPLICIT_CLIP`, `MODE_TEXT`, `MODE_FRAME_STREAM`
**Serial protocol:** Text commands (e.g., `PLAY:clip_name`, `TEXT:message`, `BRIGHTNESS:70`, `FRAME:<2048 hex>`)
**Baud rate:** 460800 (upgraded from 115200 for frame streaming bandwidth)
**Serial RX buffer:** 4096 bytes (ESP32, set before Serial.begin)

---

## Ses Pipeline Detay

```
[Wake Word Detection]
  wakeWordService.ts → 2s audio chunk → MediaRecorder
  → POST /api/voice/stt (Whisper) → containsWakeWord() → Turkish normalization
  → Detection: navigate to /chat with state { tab: 'voice' }, trigger VoiceAssistant

[Voice Conversation]
  VoiceAssistant.tsx:
  1. VAD (Voice Activity Detection) → @ricky0123/vad-web
  2. User speech → blob → POST /api/voice/stt → user text
  3. User text → POST /api/chat/message (voice_mode=true) → assistant text
  4. Assistant text → prepareTtsText() → POST /api/voice/tts → audio stream
  5. Audio playback → conversation bubble UI update
  6. isConversationEnding() check → auto-stop or continue listening
```

**Wake word variants:** sadik, sagdik, saddik, sadiq, sadick, sadikcigim + phrase forms (hey sadik, merhaba sadik, selam sadik, etc.)

**TTS fallback chain:** ElevenLabs → OpenAI tts-1-hd → Edge-TTS (tr-TR-EmelNeural)

**Hallucination filter:** Backend filters Whisper noise (subtitle text, YouTube phrases, gratitude hallucinations, repetitive patterns)

**Critical design decisions:**
- AudioContext/OfflineAudioContext energy gating DISABLED — crashes Windows WASAPI renderer
- Blob size guard (< 1500 bytes = empty) replaces energy gating
- 350ms arm delay after mic acquisition for WASAPI audio chain settling
- Generation counter prevents stale callback interference on start/stop cycles
- `_starting` mutex prevents concurrent getUserMedia calls (React StrictMode)

---

## OLED Animation Engine

```
AnimationEngine (TypeScript, runs in renderer)
  ├── Clip loading: .cpp frame arrays → JSON → ClipData
  ├── Idle orchestration: idle_loop + random blink + random look (left/right)
  ├── Event-driven clips: AnimationEventType → clip mapping
  ├── Text rendering: bitmap font → 128x64 frame buffer
  └── Device sync: frame buffer → serial command → ESP32 → OLED
```

**Event types:** wake_word_detected, user_speaking, processing, assistant_speaking, confirmation_success, understanding_resolved, didnt_hear, soft_error, ambiguity, conversation_finished, return_to_idle, show_text, show_timer

---

## Dummy Terminal Architecture (Frame Streaming)

v12.0 ile ESP32 "dummy terminal" mimarisine gecildi. Uygulama bagli olduğunda (APP_CONNECTED), tum OLED frame'leri uygulama tarafindan uretilir ve serial uzerinden gonderilir. Cihaz sadece gelen frame'leri ekrana basar.

```
APP CONNECTED (app authority):
  AnimationEngine (TS) → onFrameReady callback
    → 83ms throttle (12fps) + in-flight guard
    → deviceApi.sendFrame(Uint8Array)
    → POST /api/device/frame
    → Serial: "FRAME:<2048 hex chars>"
    → ESP32: display.showRawFrame()
    → SH1106 OLED

APP DISCONNECTED (firmware authority):
  ESP32 idle orchestrator runs locally
  Clips play from PROGMEM
  Text rendered on device
```

**Frame buffer format:** 128×64 monochrome bitmap, horizontal MSB-first, 1024 bytes (2048 hex chars)

**Tasarim kararlari:**
- Frame response YOK — TX buffer deadlock'u onlemek icin firmware FRAME komutuna response gondermez
- `Serial.setRxBufferSize(4096)` — `Serial.begin()` oncesinde cagrilmali, yoksa 256-byte default buffer overflow olur
- Baud rate 460800 — 115200 frame streaming icin yetersiz (2055 byte/frame × 12fps = 24.6 KB/s)
- Clip registry 16 → 4 clip'e dusuruldu (idle, blink, look_left, look_right) — geri kalan clip'ler app tarafinda

---

## Tamamlanan Isler (Commit Gecmisi)

### Phase 1 — MVP (commit c0dbe9d)
- [x] FastAPI backend with SQLite
- [x] Task CRUD (Kanban: todo/in_progress/done)
- [x] Mode tracking with duration logging
- [x] Pomodoro timer with session tracking
- [x] Serial device communication (ESP32)
- [x] React + Electron desktop app scaffold
- [x] Chat integration (OpenAI API)
- [x] Basic TTS/STT pipeline
- [x] OLED text display via serial

### Phase 2 — Desktop Stabilization (commit 525e5ac, v10.0)
- [x] Wake word detection (Whisper-based, Turkish normalization)
- [x] OLED animation engine (idle blink/look, event-driven clips)
- [x] OLED brightness & sleep timeout controls
- [x] Device auto-connect on startup
- [x] WebSocket real-time sync
- [x] App usage tracking (foreground window monitoring)
- [x] Activity chart (recharts)
- [x] Proactive suggestions system (usage-based insights)
- [x] ElevenLabs TTS integration
- [x] Audio device selection (input/output)
- [x] Continuous conversation mode
- [x] Greeting style customization
- [x] Close-to-tray support
- [x] Turkish text normalization for wake word matching
- [x] Hallucination filter for Whisper outputs

### Phase 3 — Voice Pipeline Hardening (commit 1889eb7, 158ee35)
- [x] Voice pipeline bugfixes (VAD timing, STT error handling)
- [x] Dashboard polling for app usage stats
- [x] Firmware disconnect fix
- [x] Wake word hardening (word boundary matching, phrase variants)
- [x] MIME-type fallback chain for MediaRecorder
- [x] Blob size guard replacing AudioContext energy gating
- [x] Generation counter for stale callback prevention
- [x] WASAPI crash prevention (no AudioContext during capture)
- [x] Arm delay (350ms) for audio chain settling
- [x] Concurrent getUserMedia mutex (_starting flag)
- [x] Conversation ending detection (auto-stop)
- [x] TTS text preprocessing (Sadik → Sagdik for natural pronunciation)

### Phase 4 — Dummy Terminal + UI Overhaul (v12.0)

#### Frame Streaming Pipeline
- [x] Dummy terminal architecture: app streams raw 1024-byte frames via serial
- [x] Baud rate 115200 → 460800 for frame streaming bandwidth
- [x] ESP32 Serial RX buffer 256 → 4096 bytes
- [x] AnimationEngine onFrameReady callback with 83ms throttle
- [x] POST /api/device/frame endpoint
- [x] Firmware FRAME: command parser with hex decode
- [x] MODE_FRAME_STREAM playback mode
- [x] display.showRawFrame() for RAM-based frame display
- [x] No-response design for FRAME commands (TX deadlock prevention)
- [x] Text mode: always emit frameReadyCallback (not just when bufferDirty)
- [x] Clip registry reduced from 16 to 4 (idle, blink, look_left, look_right)

#### UI Overhaul
- [x] Page merges: Focus → Tasks tab, Voice → Chat tab
- [x] Routes reduced: 7 → 5 (/, /tasks, /chat, /insights, /settings)
- [x] Navbar: floating glass pill, 4 items, per-icon active colors, no black background strip
- [x] Header: CSS Grid layout, bigger clock (2xl), date, userName greeting, centered OLED preview
- [x] Header: connection status with round cancel button (red on hover)
- [x] Header: Moon icon for night (yellow, not blue star)
- [x] Darker theme: bg-main #1e1e1e → #121212
- [x] Glass/liquid iOS 26 effect on cards, buttons, rows (backdrop-blur + saturate)
- [x] Rounder button corners: 10px → 14px
- [x] Dashboard: colorful stat cards with tinted backgrounds
- [x] Dashboard: mode buttons bigger with icons, active mode in its own color
- [x] Dashboard: mode durations and app usage as accordions (default closed)
- [x] Dashboard: mode durations sorted descending by minutes
- [x] Task columns: colored transparent glass backgrounds per status
- [x] Insights page renamed: Icgoruler → Kullanim
- [x] WakeWordNavigator updated: navigates to /chat with state { tab: 'voice' }

---

## Mevcut Uncommitted Degisiklikler

> v12.0 checkpoint'i ile tum degisiklikler commit edilmistir.

---

## Aktif Task Listesi

> Asagidaki taskler oncelik sirasina gore listelidir.
> Eren "task listesini sirala" dediginde bu listeyi sun.
> Bir sonraki task'e Opus 4.6 karar verir.

### Oncelik: YUKSEK

1. **[VOICE] Silence Auto-Stop Implementasyonu**
   - Durum: BASLANMADI (checkpoint 1889eb7'de "before implementation" notu var)
   - Tanim: Kullanici konusmayi biraktiginda belirli bir sessizlik suresi sonrasi voice session'i otomatik sonlandir
   - Etkilenen dosyalar: `VoiceAssistant.tsx`
   - Neden: Kullanici "hey sadik" deyip konusup biraktiktan sonra asistan dinlemeye devam ediyor, kullanici elle kapatmak zorunda

2. **[VOICE] VAD Sensitivity Tuning**
   - Durum: BASLANMADI
   - Tanim: VAD (Voice Activity Detection) hassasiyetini ortam gurulutu seviyesine gore ayarlanabilir yap
   - Etkilened dosyalar: `VoiceAssistant.tsx`, `SettingsPage.tsx`
   - Neden: Gurultulu ortamlarda VAD cok hassas, sessiz ortamlarda yeterince hassas degil

3. **[FIRMWARE] INMP441 Mikrofon Entegrasyonu (Phase 3.5A)**
   - Durum: POC MEVCUT (`mic_poc.cpp`)
   - Tanim: ESP32 uzerinde INMP441 I2S mikrofon ile dogrudan ses yakalama
   - Etkilenen dosyalar: `sadik-firmware/src/`
   - Neden: Wake word detection'i cihaz uzerinde yaparak latency azaltma

4. **[FIRMWARE/APP] Frame Streaming Dogrulama**
   - Durum: DOGRULAMA BEKLIYOR
   - Tanim: Dummy terminal frame streaming pipeline'inin end-to-end dogrulamasi (text, clip, idle)
   - Etkilenen dosyalar: firmware + app pipeline
   - Neden: Pipeline implement edildi ancak kullanici henuz end-to-end testi tamamlamadi

### Oncelik: ORTA

5. **[UI] Task Modal Iyilestirmeleri**
   - Durum: KISMEN TAMAMLANDI
   - Tanim: Task olusturma/duzenleme modal'inda UX iyilestirmeleri
   - Etkilenen dosyalar: `TaskModal.tsx`

6. **[BACKEND] Chat Context Window Yonetimi**
   - Durum: BASLANMADI
   - Tanim: Chat history 100 mesaj limiti var, token sayisina gore akilli truncation
   - Etkilenen dosyalar: `chat_service.py`

7. **[UI] Insights Page Zenginlestirme**
   - Durum: BASLANMADI
   - Tanim: Haftalik/aylik trend grafikleri, karsilastirmali istatistikler
   - Etkilenen dosyalar: `InsightsPage.tsx`, `stats.py`

### Oncelik: DUSUK

8. **[FIRMWARE] WiFi OTA Update**
   - Durum: BASLANMADI
   - Tanim: ESP32 firmware'ini WiFi uzerinden guncelleyebilme
   - Etkilenen dosyalar: `sadik-firmware/`

9. **[UI] Dark/Light Theme Toggle**
   - Durum: BASLANMADI
   - Tanim: Tema degistirme (su an sadece dark)
   - Etkilenen dosyalar: `tailwind.config.js`, tum component'ler

10. **[BACKEND] Multi-language Support**
    - Durum: BASLANMADI
    - Tanim: Ingilizce destek (su an sadece Turkce)

---

## Teknik Notlar (LLM'ler Icin)

### Bilinen Kisitlamalar
- **WASAPI crash:** Windows'ta AudioContext veya OfflineAudioContext, MediaRecorder capture session'i sirasinda veya hemen sonrasinda kullanildiginda renderer crash oluyor (STATUS_ACCESS_VIOLATION / 0xC0000005). Bu yuzden energy gating blob size ile yapiliyor.
- **Wake word false positives:** Whisper sessiz audio'dan hallucination uretiyor. Backend'de `_HALLUCINATION_PATTERNS` listesi ve `_is_hallucination()` filtresi var. Frontend'de `containsWakeWord()` word boundary regex ile false positive azaltiliyor.
- **TTS pronunciation:** "Sadik" kelimesi TTS'te yanlis okunuyor. `prepareTtsText()` ile "Sagdik" olarak degistiriliyor.
- **Electron + WASAPI:** `getUserMedia` alias device ID'leri (default, communications) `exact` constraint ile hang yapabiliyor. `_isAliasDevice()` guard'i var.
- **Frame streaming latency:** 83ms throttle + HTTP POST overhead. ~12fps effective. Direct serial could be faster but HTTP allows cross-platform compatibility.
- **Tailwind dynamic classes:** Template literal classes like `bg-accent-${name}/20` are purged at build time. Must use explicit full class strings in maps.

### Port/URL'ler
- Backend: `http://localhost:8000`
- Frontend dev: `http://localhost:3000`
- WebSocket: `ws://localhost:8000/ws`
- Database: `sadik-backend/sadik.db` (SQLite)
- Serial baud rate: 460800

### Calistirma
```bash
# Backend
cd sadik-backend && pip install -r requirements.txt && python run.py

# Frontend (dev)
cd sadik-app && npm install && npm run dev

# Electron
cd sadik-app && npm run dev:electron

# Firmware
cd sadik-firmware && pio run --target upload
```

---

## Bu Dokumani Kullanma Protokolu

1. **Yeni konusmaya basladiginda** bu dokumani oku, projeye hakim ol.
2. **Eren "task listesini sirala" dediginde** Aktif Task Listesi bolumunu sun.
3. **Bir sonraki task icin** Opus 4.6 oncelik ve bagimlilik analizi yapar, en uygun task'i secer.
4. **Task baslatildiginda** Opus yaklanimi belirler, Sonnet'e spesifik prompt verir.
5. **Task tamamlandiginda** bu dokumandaki ilgili task'i [x] ile isaretle, tamamlanan isler bolumune ozet ekle.
6. **Major checkpoint'lerde** versiyon numarasini artir, tarihi guncelle.

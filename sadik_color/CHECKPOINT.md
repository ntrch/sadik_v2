# SADIK v2 — Project Checkpoint

> ⚠️ **OUTDATED (2026-04-15, v14.0).** Voice pipeline tamamen değişti (Sprint 9.5):
> V1 Whisper STT + ElevenLabs/OpenAI/edge-tts hattı **söküldü**, Voice V2 Gemini Live
> audio↔audio (B-first router) aktif. Bu dokümandaki `/api/voice/stt`,
> `/api/voice/tts`, `_HALLUCINATION_PATTERNS` referansları geçersiz.
> Güncel proje özeti: **`summary.md`**. Source of truth roadmap: **`BETA_ROADMAP.md`**.
> Full refresh post-beta.

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
- Hafiza / dusunce notu sistemi (Dusunceler sayfasi)

---

## Mimari Ozet

### Frontend (sadik-app/)

| Dosya/Dizin | Rol |
|---|---|
| `src/App.tsx` | Router: Dashboard, Tasks (+ Focus tab), Chat (+ Voice tab), Insights (Kullanim), Memory (Dusunceler), Settings. VoiceAssistant kalici mount (rota degisiminde kesilmez). ChatTabs App seviyesinde. |
| `src/context/AppContext.tsx` | Global state: mode, device, pomodoro, wake word, animation engine, audio devices |
| `src/hooks/useAnimationEngine.ts` | Animation engine hook: frame streaming pipeline, throttled frame send to device |
| `src/components/layout/HeaderBar.tsx` | Header: clock, date, greeting, OLED preview (centered), connection status, brightness, mic, settings. "Sesli Asistan Aktif" pulse gostergesi. |
| `src/components/layout/BottomNav.tsx` | Floating glass navbar: 5 items (Ana Sayfa, Gorevler, Sohbet, Hafiza/Dusunceler, Kullanim), per-icon active colors. /memory = Lightbulb+yellow, /insights = green. |
| `src/components/layout/Sidebar.tsx` | Sidebar layout component |
| `src/components/voice/VoiceAssistant.tsx` | Ses pipeline: VAD → STT → LLM → TTS → playback. Kalici mount: rota degisiminde unmount edilmez, tray/arka planda calisir. Zorla navigasyon yok. |
| `src/services/wakeWordService.ts` | Wake word detection: 2s chunk → Whisper STT → Turkish text matching |
| `src/engine/AnimationEngine.ts` | OLED animation engine: clip playback, idle orchestration, text rendering |
| `src/engine/types.ts` | AnimationEventType, PlaybackMode, EngineState type definitions |
| `src/engine/eventMapping.ts` | Event → clip mapping tablosu |
| `src/pages/DashboardPage.tsx` | Mode selector (ModeChip component + portaled color picker), stat cards, app usage heatmap (kirmizi→yesil HSL), activity chart (useModeColors) |
| `src/pages/FocusPage.tsx` | Pomodoro timer + task selector (embedded in Tasks page as tab) |
| `src/pages/InsightsPage.tsx` | Yeniden tasarlandi: BarChart2 yesil header, birlesmis period tabs (Bugün/7/14/30), DailyBarChart + ranked top-apps progress bars, yesil barlar, collapsible "Nasil Kullaniyor" bolumu, max-w-4xl |
| `src/pages/MemoryPage.tsx` | "Dusunceler" sayfasi: Hafiza (kirmizi tab) + Beyin Firtinasi (pembe tab + kontroller). Lightbulb ikonu, sari tema. |
| `src/pages/SettingsPage.tsx` | API keys, TTS provider, device config, wake word, proactive suggestions |
| `src/utils/modeColors.ts` | Modul-seviyesi pub/sub store + `useModeColors()` hook. Her mod (preset+custom) icin benzersiz RGB-pickable renk. Custom default `#fb923c`. settingsApi ile kalici (`preset_mode_colors`, `custom_modes`). |
| `src/api/memory.ts` | Memory API client |
| `src/api/tasks.ts` | Task API client |
| `src/components/stats/ActivityChart.tsx` | `useModeColors()` hookunu kullanir |
| `src/components/tasks/TaskCard.tsx` | `in_progress` durumu icin turuncu arka plan |
| `src/components/tasks/TaskColumn.tsx` | `in_progress` kolon: turuncu border/bg (#fb923c) |
| `src/components/tasks/TaskModal.tsx` | Task olusturma/duzenleme modal'i |
| `src/components/chat/ChatWindow.tsx` | Metin sohbet penceresi (chat sayfasi & voice overlay) |
| `src/pages/WorkspacePage.tsx` | Calisma Alani: custom icon/color workspace'ler, launch_app+window_snap birlestirilmis aksiyonlar, Start Menu .lnk app listesi, 24 Lucide ikon + custom upload, SADIK ayarlari system_setting toggle'lari, responsive grid, trash ust sagda |
| `src/api/workspaces.ts` | Workspace API client |
| `src/api/pomodoro.ts` | `startBreak(minutes?)` body ile override destekli |
| `electron/main.js` | IPC: `set-dnd`, `app-focus-changed`, `workspace:execute`, `workspace:list-apps`, `workspace:pick-exe`. Windows DND in-app only; macOS `shortcuts run`. `backgroundThrottling:true` default (disabled on hide). Clipboard poll 800ms → 3000ms. Frame logs downgraded to DEBUG. |

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
| `app/routers/memory.py` | Hafiza/dusunce CRUD endpoint'leri |
| `app/routers/ws.py` | WebSocket for real-time device↔app sync |
| `app/services/chat_service.py` | OpenAI chat completion, system prompt, local context injection |
| `app/services/voice_service.py` | STT (Whisper API), TTS (ElevenLabs → OpenAI → Edge-TTS fallback chain) |
| `app/services/device_manager.py` | Serial port management, command send/receive |
| `app/services/serial_service.py` | Low-level serial communication |
| `app/services/wifi_device_service.py` | WiFi device communication |
| `app/services/pomodoro_service.py` | Timer logic, session tracking |
| `app/services/mode_tracker.py` | Mode duration tracking |
| `app/services/ws_manager.py` | WebSocket connection manager |
| `app/models/memory.py` | Memory SQLAlchemy model |
| `app/schemas/memory.py` | Memory Pydantic schema |
| `app/routers/workspace.py` | Workspace CRUD + execute |
| `app/models/workspace.py` | Workspace SQLAlchemy model |
| `app/schemas/workspace.py` | Workspace Pydantic schema (Optional created_at/updated_at) |

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
  → Detection: VoiceAssistant'i aktif et (rota degistirmeden, kalici mount)

[Voice Conversation]
  VoiceAssistant.tsx (App.tsx'te kalici mount, hicbir rotada unmount edilmez):
  1. VAD (Voice Activity Detection) → @ricky0123/vad-web
  2. User speech → blob → POST /api/voice/stt → user text
  3. User text → POST /api/chat/message (voice_mode=true) → assistant text
  4. Assistant text → prepareTtsText() → POST /api/voice/tts → audio stream
  5. Audio playback → conversation bubble UI update
  6. isConversationEnding() check → auto-stop or continue listening
```

**Kalici mount mimarisi (v13.0):**
- `VoiceAssistant` App.tsx'in en ust seviyesinde mount edilir, router outlet'in disinda.
- Rota degisimi TTS/STT pipeline'ini kesmez; kullanici baska sayfaya gecse bile ses devam eder.
- Wake word algilandiginda zorla /chat navigasyonu yapilmaz; asistan tray modunda calisabilir.
- HeaderBar: `isVoiceActive` prop'u ile "Sesli Asistan Aktif" pulse gostergesi gosterilir.
- ChatTabs state'i App.tsx'e tasindi (lifted), VoiceAssistant ve ChatPage arasindan paylasiliyor.

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

### Phase 5 — Voice Persistence + UI Polish + Memory (v13.0)

#### Voice Persistence
- [x] VoiceAssistant kalici mount: App.tsx router outlet disinda, hicbir rotada unmount edilmez
- [x] TTS/STT rota degisiminde kesilmiyor; ses arka planda devam ediyor
- [x] Wake word algilandiginda zorla /chat navigasyonu kaldirildi
- [x] ChatTabs state App.tsx seviyesine tasinidi (lifted state)
- [x] HeaderBar: `isVoiceActive` prop + "Sesli Asistan Aktif" pulse gostergesi

#### Mod Renk Sistemi
- [x] `src/utils/modeColors.ts`: modul-seviyesi pub/sub store + `useModeColors()` hook
- [x] Her mod (preset + custom) icin benzersiz, kullanici tarafindan secilen RGB renk
- [x] Custom modlar default `#fb923c` (turuncu); preset modlar ayri renkler
- [x] settingsApi ile kalici: `preset_mode_colors` ve `custom_modes` key'leri
- [x] ActivityChart, DashboardPage ModeChip renkleri `useModeColors` hookunu kullaniyor

#### Dashboard Gelistirmeleri
- [x] `ModeChip` component: aktif mod gostergesi, renk picker entegrasyonu
- [x] Portaled color picker: `createPortal` + `getBoundingClientRect` fixed positioning (z-index sorunu cozuldu)
- [x] App Usage kartlari: kirmizi→yesil HSL heatmap interpolasyonu

#### Gorev Yonetimi Renkleri
- [x] TaskCard: `in_progress` durumu turuncu arka plan
- [x] TaskColumn: `in_progress` kolon turuncu border + bg (#fb923c)

#### Memory / Dusunceler Sayfasi
- [x] `src/pages/MemoryPage.tsx`: "Dusunceler" sayfasi (Lightbulb ikonu, sari tema)
- [x] Hafiza tab (kirmizi) + Beyin Firtinasi tab (pembe + kontroller)
- [x] `src/api/memory.ts`: Memory API client
- [x] Backend: `app/models/memory.py`, `app/routers/memory.py`, `app/schemas/memory.py`
- [x] BottomNav: /memory = Lightbulb + sari renk, 5. item olarak eklendi

#### InsightsPage Yeniden Tasarimi
- [x] BarChart2 yesil header
- [x] Birlesmis period tabs: Bugun | 7 | 14 | 30
- [x] Unified card: DailyBarChart + ranked top-apps listesi + progress bar'lar
- [x] Yesil barlar (ActivityChart'la tutarli)
- [x] "Sadik Bu Bilgileri Nasil Kullaniyor?" varsayilan kapali collapsible
- [x] max-w-4xl layout

#### Tailwind / Animasyon
- [x] `tailwind.config.js`: `accent.pink = '#f472b6'` eklendi
- [x] Yeni animasyon clip'leri: `idle_alt_look_down`, `break_text`, `working_text` (raw CPP + JSON)

### Phase 6 — Workspace, DND, Focus-look, Voice Streaming, Break Flow (v14.0)

#### Rahatsiz Etmeyin (DND)
- [x] HeaderBar'da brightness yanina DND toggle butonu (tam isim "Rahatsiz Etmeyin", kisaltma degil)
- [x] Mod bazinda DND ayari: her preset/custom mod kendi DND tercihini tutar (`preset_mode_settings` JSON)
- [x] Electron IPC `set-dnd`: Windows in-app only (Focus Assist WNF state trust-gated), macOS `shortcuts run "Turn On/Off Do Not Disturb"`
- [x] Aktif DND durumunda TTS, toast ve OLED proaktif bildirimler suppresslenir
- [x] Popup'larda click-outside-to-close davranisi

#### Focus-look (Sadik'in Konumu)
- [x] Settings: "Sadik'in Konumu" ayari (Sol/Sag/Ust, default Sol)
- [x] Uygulama focus oldugunda `idle_alt_look_right/left/down` clip'i oynatilir, son frame'de donar
- [x] Window blur'unda focus-look disengage, idle orchestration devam eder
- [x] `idle_alt_look_down.json` clip eklendi
- [x] Electron IPC: `app-focus-changed`, `getFocusState` fallback (web'de `focus`/`blur`/`visibilitychange`)

#### Calisma Alani (Workspace)
- [x] Full-stack CRUD: backend router/model/schema + frontend sayfa + API client
- [x] Aksiyonlar: `launch_app` (Start Menu .lnk scan + custom exe), `open_url`, `system_setting`, `window_snap` — hepsi tek "Run" butonu ile sirali execute
- [x] `launch_app` ve `window_snap` birlestirildi: uygulamayi ac + pencere snap'i (sol/sag/full) tek aksiyon
- [x] 24 Lucide ikon kutuphanesi + custom upload (base64 embed)
- [x] Her workspace icin renk atama
- [x] SADIK app settings `system_setting` toggle'i olarak erisilebilir (wake word, DND, vb.)
- [x] Mod sync: workspace run edilince secilen preset/custom moda otomatik gecis
- [x] UI: responsive grid, trash butonu ust sagda
- [x] Electron IPC: `workspace:execute` (sequential actions), `workspace:list-apps` (Start Menu .lnk scan), `workspace:pick-exe`
- [x] `launch_app` path bosluklari: `shell:true` kaldirildi, `.lnk` icin `shell.openPath`, aksi halde `spawn(path, args, {detached:true, stdio:'ignore'})`
- [x] BottomNav: LayoutGrid ikonu + pembe renk, 6. item

#### Proaktif Oneri Sesli Accept/Deny
- [x] Oneri verildiginde tona gore TTS: nazik → "Kucuk bir oneri: ...", guclu → "Dikkat! ..."
- [x] TTS bittikten sonra 8 saniyelik STT penceresi acilir, ACCEPT/REJECT keywordleri dinlenir
- [x] Accept keywords: evet, tamam, olur, kabul, mola ver, baslat
- [x] Reject keywords: hayir, yok, reddet, istemiyorum, sonra, gec
- [x] Wake word mic contention fix: STT window acilmadan once wakeWordService.stop() + 200ms OS release delay
- [x] Dedup: `_sttArmedForKeyRef` — ayni insight icin ikinci kez STT armalamaz
- [x] Reject cooldown: `rejectedCooldownMapRef` — key bazli `proactiveCooldownMinutes` suresi skip (Rule G processInsight)
- [x] `voiceAssistantActiveRef` aktif iken STT window skip edilir, sadece buton ile accept/deny

#### Voice Pipeline Optimizasyonu
- [x] LLM response streaming → per-sentence TTS (`stream_voice_response` in chat_service.py)
- [x] Sentence boundary: `.`, `!`, `?`, `\n` veya 80 char
- [x] `/api/voice/voice-chat-stream` endpoint: length-prefixed binary frame format (0x01 MP3, 0x00 meta)
- [x] Wake word: `_requestInFlight` guard, `STT_TIMEOUT_MS=20000`, `?fast=1` query parameter (max_retries=0)
- [x] `VoiceAssistant.startListening` re-entrancy guard (`_listeningInProgress`) — iki MediaRecorder spawn'ini engeller
- [x] `gpt-4o` → `gpt-4o-mini` voice flow icin
- [x] `_FrameFilter` logging: `/api/device/frame` access loglari suppress edilir

#### Mola Akisi (Break Flow) — Tamamlanmis Nihai Hali
- [x] Voice accept VE buton accept tek path: `acceptInsight` → `setMode('break')` → `playModIntroOnce('mod_break', startTimer)` → intro biter → `pomodoroApi.startBreak(breakMinutes)` → timer_tick MM:SS OLED'de
- [x] Sure: guclu oneri = 15 dakika, nazik oneri = 5 dakika (`insight.level === 'strong' ? 15 : 5`)
- [x] `playModIntroOnce(intro, onFinish)` engine metodu: intro tamamini oynat, son frame'i tut, callback'i fire et
- [x] `mod_break_text` loop'u ARTIK SADECE manuel mola modu secimi icin (Dashboard mod button) — insight-accept flow'da kullanilmaz
- [x] `pomodoro_completed` WS handler: work bitince otomatik `setMode('break')`, `playModIntroOnce('mod_break', clearSuppress)`, `suppressBreakTimerDisplayRef` ile intro sirasinda timer_tick showText bastirilir
- [x] `suppressBreakTimerDisplayRef` — intro oynarken MM:SS OLED'e basilmaz, intro bitince acilir
- [x] Work phase'de (pomodoro start) timer_tick showText SUPPRESSLENIR — sadece break/long_break phase'de MM:SS gosterilir
- [x] Backend `_on_phase_complete` break branch: her zaman idle'a doner, yeni work phase ZINCIRLENMEZ (eski `_start_work_phase` cagrisi kaldirildi)
- [x] `standalone_break` flag: insight-accept ile baslatilan break'ler icin (geriye uyumluluk, artik tum break'ler terminal)
- [x] `pomodoro_service.stop()` artik final `timer_tick` broadcast ediyor (`remaining=0, phase=idle`) — manuel durdurmada Focus panel Pomodoro karti donmaz, sifirlanir
- [x] `break_completed` WS: TTS "Mola bitti. Hazirsan devam edelim.", toast, `return_to_idle`, `modesApi.endCurrent()`
- [x] Manuel break mode cikis (Dashboard): `handleEndMode`/`handleSetMode` break phase'de iken `pomodoroApi.stop()` cagrilir, `triggerEvent('confirmation_success')` → confirming clip → idle
- [x] Manuel pomodoro Bitir buton watcher: `prevBreakRunningRef` ile is_running false transition yakalanir, `currentMode==='break'` ise endCurrent + confirming
- [x] Natural completion skip flag: `skipNextBreakStopWatcherRef` ile break_completed handler, watcher'i bir kez skip eder (double-fire engellenir)
- [x] `DashboardPage` `initialModClipStarted` effect: artik MOUNT-ONLY calisir (deps `[]`), currentMode degisimlerine reaktif degil — acceptInsight'in playModIntroOnce cagrisini override etmemesi icin
- [x] `stopProactiveSpeech()` helper: TTS calarken butondan accept/deny basilirsa audio pause + URL revoke + ref clear + `onended`/`onerror` null; akis TTS susup devam eder
- [x] `currentProactiveAudioRef` — aktif audio element + URL tutulur, stopProactiveSpeech tarafindan kullanilir
- [x] Pomodoro start (Tasks/Focus Play): `triggerEvent('confirmation_success')` eklendi — confirming clip oynatilir, work phase'de OLED timer gosterilmez

#### Cesitli Polish
- [x] Dashboard: "Toplam Calisma" → "Toplam Aktiflik", "Proaktif Oneriler" kart en ustte, app usage border neutral
- [x] Task `created_at` timezone fix (Turkiye saati)
- [x] Task description textarea auto-resize
- [x] Navbar chat icon kirmizi (accent-red)
- [x] Tray animation donma fix
- [x] Workspace save 404 fix: Pydantic schema `Optional[str] = None` + `model_config = ConfigDict(from_attributes=True)`
- [x] http.ts default timeout 10s → 30s
- [x] Proactive poll 60s → 5dk, clipboard poll 800ms → 3000ms (voice latency dusuruldu)
- [x] `backgroundThrottling:true` default (sadece tray'e hide edildiginde disable)

---

## Mevcut Uncommitted Degisiklikler

### Uygulama (sadik-app/)
- M `electron/main.js` — DND IPC, workspace IPC, backgroundThrottling, clipboard poll
- M `electron/preload.js` — IPC expose: set-dnd, app-focus-changed, workspace handlers
- M `public/animations/clips-manifest.json` — idle_alt_look_down eklendi
- M `src/App.tsx` — WorkspacePage route, kalici VoiceAssistant mount guncellemeleri
- M `src/api/http.ts` — default timeout 10s → 30s
- M `src/api/pomodoro.ts` — startBreak(minutes?) override destegi
- M `src/api/voice.ts` — voice-chat-stream endpoint
- M `src/components/layout/BottomNav.tsx` — LayoutGrid (Workspace) 6. item, pembe renk
- M `src/components/layout/HeaderBar.tsx` — DND toggle butonu, focus-look entegrasyonu
- M `src/components/voice/VoiceAssistant.tsx` — streaming pipeline, re-entrancy guard, proaktif STT accept/deny
- M `src/context/AppContext.tsx` — break flow, suppressBreakTimerDisplayRef, stopProactiveSpeech, proactive STT accept/deny, focus-look
- M `src/engine/AnimationEngine.ts` — playModIntroOnce, focus-look clip support
- M `src/engine/types.ts` — yeni event/type tanimlari
- M `src/hooks/useAnimationEngine.ts` — playModIntroOnce hook entegrasyonu
- M `src/pages/DashboardPage.tsx` — "Toplam Aktiflik", Proaktif Oneriler ustte, mount-only effect
- M `src/pages/SettingsPage.tsx` — "Sadik'in Konumu" ayari, DND mod entegrasyonu
- M `src/services/wakeWordService.ts` — _requestInFlight guard, STT_TIMEOUT_MS, fast param
- ?? `public/animations/idle_variations/idle_alt_look_down.json` — yeni animasyon clip'i
- ?? `src/api/workspaces.ts` — Workspace API client
- ?? `src/pages/WorkspacePage.tsx` — Calisma Alani sayfasi

### Backend (sadik-backend/)
- M `app/main.py` — workspace router kaydi, lifespan guncellemeleri
- M `app/models/__init__.py` — workspace model import
- M `app/routers/device.py` — frame log suppress (_FrameFilter)
- M `app/routers/pomodoro.py` — startBreak body override
- M `app/routers/voice.py` — /api/voice/voice-chat-stream endpoint
- M `app/services/chat_service.py` — stream_voice_response, per-sentence TTS, gpt-4o-mini
- M `app/services/pomodoro_service.py` — standalone_break, break always terminal, stop() final broadcast
- M `app/services/voice_service.py` — streaming TTS entegrasyonu
- ?? `app/models/workspace.py` — Workspace SQLAlchemy model
- ?? `app/routers/workspace.py` — Workspace CRUD + execute
- ?? `app/schemas/workspace.py` — Workspace Pydantic schema

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

7. **[UI] Memory/Dusunceler Sayfasi Gelistirme**
   - Durum: TEMEL IMPLEMENT EDILDI
   - Tanim: Beyin Firtinasi tab'inda daha zengin kontroller, hafiza arama, etiket sistemi
   - Etkilenen dosyalar: `MemoryPage.tsx`, `memory.py`

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
- **Portaled color picker z-index:** DashboardPage'de color picker `createPortal` + `getBoundingClientRect` fixed positioning ile render ediliyor, aksi halde card overflow:hidden clip ediyor.

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

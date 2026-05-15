# SADIK v2 — Proje Özeti

Tarih: 2026-05-14
Durum: Beta hazırlık, Sprint 9 cihaz tarafı tamam, Sprint 9.5 (Voice V2) başlamak üzere.

---

## 1. Vizyon & Konsept

SADIK; masaüstü uygulaması + fiziksel karakter cihazından oluşan kişisel asistandır. Kullanıcı wakeword ("Sadık") ile çağırır, sesle konuşur, görev/alışkanlık/pomodoro/takvim yönetir. Cihaz ekranında yaşayan bir karakter (idle/blink/listening/thinking/talking/confirming) gerçek zamanlı duygu durumunu yansıtır.

İki variant:
- **Mini (v2):** ESP32 + SSD1306 128×64 monokrom OLED, JSON frame animasyon.
- **Color (v3):** ESP32-S3 N16R8 + ST7789 320×170 (T-Display-S3), MJPEG playback, LittleFS.

Proje hattı artık **tek app + color variant**'a odaklı; mini kod dondurulmuş durumda.

---

## 2. Sistem Mimarisi

- **sadik-app/** — Electron + React + TypeScript + Tailwind + Webpack + HashRouter. Masaüstü app.
- **sadik-backend/** — FastAPI async + SQLAlchemy + SQLite (tek dosya, migration yok). PyInstaller binary; Electron `main.js` spawn ediyor.
- **sadik-firmware/** — ESP32 mini OLED firmware (v2, dondurulmuş).
- **sadik_color/** — ESP32-S3 + ST7735S 160×128 renkli prototip (geçiş arası).
- **sadik_v3/** — T-Display-S3 320×170 (yeni hedef cihaz, scaffold + display_manager + MJPEG backbuffer hazır).
- **landing/**, **ui_dream/**, **tools/**, **skills/** — site, tasarım referansı, yardımcı araçlar.

İletişim hatları:
- App ↔ Backend: WebSocket (voice events, tool_status, animation cue).
- App ↔ Device: Serial (USB), animasyon trigger + state sync.
- Asset hattı: `public/animations/{core_character,idle_variations,mods,personas}` + `clips-manifest.json`.

---

## 3. Voice Pipeline — V1 (Mevcut)

```
wakeword (openWakeWord, local) → RMS gate (0.005) → Whisper STT → OpenAI LLM (gpt-4o-mini + 12 tool) → ElevenLabs/OpenAI/edge-tts → speaker
```

- Tamamı backend'de. Wakeword backend prosesinde local mic dinler, WebSocket ile `{type:"wake"}` atar.
- VAD yok; sadece RMS threshold.
- API key'leri SQLite `settings` tablosunda key-value olarak saklanıyor; cihazda key yok.
- **End-to-end latency ~28s**, beta için "kabul" olarak işaretlenmiş.

---

## 4. Voice Pipeline — V2 (Sprint 9.5, karar verildi)

```
wakeword → RMS gate → B-first router
                       │
                       ├─ B) Tool: Whisper STT → LLM(tools) → execute → color MJPEG done/error klip (ses YOK)
                       └─ A) Conversation (B'de tool yoksa): Gemini Live audio↔audio → speaker + talking anim
```

Kararlar:
- **Router:** B önce dene, tool yoksa A'ya düş. Tool path güvenli; conversation +1s ek latency kabul.
- **TTS hattı tamamen kaldırılacak.** ElevenLabs + OpenAI TTS + edge-tts silinir. Ölü kod yok.
- **Session lifecycle:** 8s sessizlik → kapat. 30s/turn audio cap. Backend FastAPI proxy.
- **API key:** settings'e `gemini_api_key` field eklenir.
- **Hedef latency:** A'da <1s ilk ses, B'de ~3-5s (TTS yok).
- Yeni servis: `sadik-backend/app/services/gemini_live_service.py`.

---

## 5. Tool System

12 tool, registry pattern (`voice_tools.py`). Backend SQLAlchemy üzerinden mevcut servisleri reuse eder; frontend yalnız `tool_status` frame alır.

- `list_tasks`, `delete_task`
- `list_habits`, `delete_habit`
- `start_pomodoro`
- `get_today_agenda`, `get_weather`, `get_app_usage_summary`
- `start_workspace`, `delete_workspace`
- `delete_event`, `delete_memory_note`

V2 sonrası tool path = B hattı (sessiz, görsel-only sonuç).

---

## 6. Animasyon Asset Hattı

- **Mini (v2):** JSON frame dizileri, 128×64 monokrom OLED. Sessiz.
- **Color (v3):** MJPEG, 320×170, LittleFS playback. Sessiz.
- Manifest: `public/animations/clips-manifest.json`.
- Klip aileleri: `core_character` (boot, wakeup, listening, thinking, talking, confirming, confused, didnt_hear, error_soft, goodbye_to_idle, return_to_idle), `idle_variations`, `mods`, `personas`.
- Done/error feedback = MJPEG klip trigger (yeni ses asset'i gerekmiyor).

---

## 7. Sprint Geçmişi (özet)

- **S1-S5:** App temeli, backend, voice V1, OAuth taslağı, color prototip başlangıcı.
- **S6:** OAuth Desktop+PKCE (Google Calendar + Notion) tamamlandı.
- **S7:** Privacy 3-tier preset (Full/Hybrid/Local-only), multi-device tek-app yön.
- **S8 (color):** LittleFS + partial render + FreeRTOS foundation + TFT mutex. Bitbank2 stack (JPEGDEC + LovyanGFX). LGFX rowstart fix.
- **S9 (cihaz, biten):** T-Display-S3 scaffold, ST7789 320×170 parallel8 display_manager, MJPEG backbuffer 320×170, color_v2 variant (320×170 + parseDeviceLine + OledPreview), wakeword duration fix 45375→1000ms. Recent commits: `1bed2fb → 2082e80 → 82655da → 9392b0a → c5c6b83`.
- **S9.5 (yeni, başlıyor):** Voice V2 — Gemini Live + dual-pipeline.
- **S9 (T9.1, post-beta):** Hosted backend migration, billing açılışı.

---

## 8. Önemli Teknik Kararlar (alındı)

- OAuth Desktop+PKCE (per-user creds yerine).
- Privacy = preset mode (Full/Hybrid/Local-only), per-toggle değil.
- Multi-device tek app; color-only feature'lar variant guard ile.
- MJPEG codec Q=95+ algısal lossless; on-device LittleFS playback; live stream yok.
- ESP32-S3 N16R8: `qio_opi + flash_mode=qio` doğrulandı (opi_opi boot loop verdi).
- LGFX: `panel_width≠memory_width` → `cfg.offset_x` ile rowstart cancel; `DIAG:GRADIENT` testi zorunlu.
- WiFi transport deferred (mic/amp/speaker cihaza taşınırsa tekrar değerlendirilecek).
- WROOM-32 (`esp32dev`) bırakıldı, hedef artık yalnız S3 N16R8.
- Voice V2 = Gemini Live + B-first router + TTS sökülür. (BU SPRINT)

---

## 9. Yaşanan Sorunlar & Çözümler

- **JDR_MEM1 crash (color klip decode):** Bitbank2 stack'e geçiş (JPEGDEC LE + `LovyanGFX setSwapBytes(true)` kanonik byte order).
- **Boot-loop / UART crash / debounce sorunları (Sprint-3):** `e33028f` commit'te toplu fix.
- **LGFX gizli rowstart shift:** Panel ve memory width farkı → `cfg.offset_x` ile cancel. Uniform renk maskeliyor; gradient testi şart.
- **Wakeword duration yanlış (45375ms):** 24f@24fps = 1000ms olarak düzeltildi (`c5c6b83`).
- **N16R8 boot loop:** `opi_opi` denemesinde; `qio_opi` ile stabil.
- **Voice latency 28s:** T9.5.1 spike ile çözüldü — Gemini Live `end_of_turn→first_audio` ortalama **789ms** (6 test, 718-813 aralık). open→ready ~1.1s tek seferlik session açılış maliyeti.
- **Gemini Live TR telafuz/vurgu zayıflığı:** Bilinen kısıt (preview model). Charon sesi karakter olarak uygun bulundu; telafuz hataları beta'da kabul. Post-beta alternatif değerlendirme: Cartesia Sonic-TR, ElevenLabs TR ses, ya da yeni Gemini Live versiyonu.

---

## 10. Mevcut Durum

**Yapabiliyor:**
- Wakeword + 12 tool ile sesli komut.
- Google Calendar + Notion OAuth entegrasyonları.
- Color MJPEG playback (T-Display-S3, 320×170, LittleFS).
- Multi-device app (mini + color variant aynı binary).
- Karakter animasyon hattı: idle, blink, listening, thinking, talking, confirming, error_soft, didnt_hear.
- Privacy 3-tier preset.
- Pomodoro, agenda, weather, app usage özetleri.

**Yapamıyor / Eksik:**
- Düşük latency conversation (V2 ile gelecek).
- Hosted backend / billing (T9.1, post-beta).
- Pro feature matrix + onboarding (Pro net olmadan deferred; şimdilik toast).
- WiFi transport (deferred).
- Proaktif öneri sesi: Live ile sunulacak (karar verildi). Sprint 9.6 "Proactive Agent" planlanıyor — bkz. §13.
- Production billing arch (beta'da kapalı).

---

## 11. Sıradaki Adımlar — Sprint 9.5 Task Kırılımı

- **T9.5.1 — Live spike:** auth, audio I/O, wakeword→ilk ses latency ölçümü, backend proxy iskelet.
- **T9.5.2 — Pipeline split:** A/B hatları, B-first intent router, Live mute mekanizması.
- **T9.5.3 — Cost gating:** RMS+silero gate, session lifecycle (8s sessizlik, 30s/turn cap), telemetry.
- **T9.5.4 — TTS sökme:** ElevenLabs+OpenAI TTS+edge-tts kaldır; done/error MJPEG trigger'ları B hattına bağla; settings'ten provider field'larını temizle.
- **T9.5.5 — Cleanup:** dead code, `gemini_api_key` settings field, integration tests, latency telemetry, BETA_ROADMAP.md güncelleme.

Tamamlama hedefi (taslak): T9.5.1-T9.5.5 sırayla, paralelde T9.1 hosted backend çalışması ayrı session.

---

## 12. Açık Sorular & Risk

- **Proaktif öneri sesi:** Karar = Live ile konuşsun. Detaylı vizyon §13'te.
- **Gemini Live function calling güvenilirliği:** B-first router by-pass ediyor ama edge case'ler (Live spontan tool önerirse ne olacak?) test edilmeli.
- **Beta freeze tarihi:** S9.5 + T9.1 paralel ilerlerken release-cut zamanlaması.
- **Session çakışması:** Paralel hesap kuralı gereği T9.1 ile T9.5 farklı session'larda, commit prefix ayrımı zorunlu.

---

## 13. Sprint 9.6 — Proactive Agent (vizyon, henüz scope edilmedi)

Hedef: SADIK reaktif (wakeword tetikli) değil, **proaktif** asistana evrilsin. Kullanıcı adına gerçekten düşünen bir katman.

Mimari taslak (öneri):

```
Signal Sources                Reasoner                    Delivery
─────────────                 ────────                    ────────
- Takvim (Calendar)      ┐                              ┌─ Live audio konuş
- Alışkanlık streak'leri ├─→ Proactive Reasoner ──→ Decide ─┤  (kullanıcı uygunsa)
- App usage / focus      │   (LLM, periodic +              │
- Pomodoro/break state   │    event-triggered)             ├─ Visual-only: MJPEG
- Hava durumu            │                                 │  + app notification
- Task deadline'ları     │                                 │
- Notion/email özetleri  │                                 └─ Sessiz log (etkileşim
- Saat/zaman bağlamı     │                                    yok ama önemli not)
- "Quiet hours" /        │
   privacy tier          ┘
```

Bileşenler:
- **Signal aggregator:** Mevcut servisler (tasks, habits, agenda, app_usage, weather) zaten var → periyodik snapshot + event hook.
- **Proactive reasoner:** LLM tabanlı karar katmanı. Girdiler: snapshot + son N saatlik etkileşim + kullanıcı profili/tercihler. Çıktı: `{action, urgency, delivery_mode, message}`. Karar: konuşmalı mı, sessiz görsel mi, hiç sunulmamalı mı.
- **Delivery router:**
  - **Konuşmalı (Live):** kullanıcı müsait (focus/dnd/quiet hours kontrolü) ve urgency yüksekse — Live session aç, mesajı söylet, gerekirse kısa diyalog için açık tut.
  - **Görsel-only:** sessiz MJPEG karakter klibi (örn. "düşünüyor" → "öneri var" balonu) + app notification.
  - **Sessiz log:** sadece dahili kayıt; bir sonraki etkileşimde context olarak kullan.
- **Quiet rules:** privacy tier (Local-only'de proaktif kapalı?), kullanıcı tanımlı sessiz saatler, frekans cap (saatte en fazla N).
- **Feedback loop:** kullanıcı "yine söyleme / faydalıydı / şu saatlerde sorma" → reasoner profiline yazılır.

**Kararlar:**
- **Beta hattı:** S9.6a beta'ya yetişecek. S9.6b (LLM reasoner) post-beta.
- **Privacy tier davranışı:**
  - **Full / Hybrid:** S9.6a kural-tabanlı + (sonra) S9.6b reasoner. Üç katmanlı teslim: Live sesli + native OS bildirim + app içi toast.
  - **Local-only:** Live KAPALI, ama native OS bildirim + app içi toast AÇIK. LLM yok, "düşünen" katman yok; mevcut behavioral_patterns/habits/integration scheduler'lar zaten Local-only'de çalışıyor, korunur.
- **Mevcut "güçlü ve nazik hatırlatma" logic'i** (behavioral_patterns, habits_service, integration sync) TÜM tier'larda korunur. S9.6a yeni katman olarak yalnız sesli teslim ekler, eski reaktif/sessiz hatırlatmalar dokunulmaz.
- **Sıra:** S9.5 tamamlanır → S9.6a başlar (sıralı, paralel session yok). S9.5'in Live altyapısı S9.6 için temel.

**S9.6a scope (beta için yetişecek):**
- Signal aggregator: takvim, pomodoro state, alışkanlık streak, task deadline.
- Sabit kurallar (örn. "takvim event'i N dk sonra + user idle → konuş", "pomodoro break başladı → 'mola zamanı' söyle").
- Delivery router: privacy tier check + quiet hours + frekans cap → Live audio (full/hybrid) veya görsel-only (local-only).
- Feedback: "şu saatlerde sorma / yine söyleme" kullanıcı tercihleri.

**S9.6b scope (post-beta):**
- LLM reasoner: periyodik snapshot + son N saatlik bağlam + kullanıcı profili → karar.
- Daha akıllı timing, daha az "creepy".

Risk: maliyet (Live proaktif çağrı + LLM reasoner periyodik), creepy faktör (çok sık konuşma), kullanıcı kontrolü (kapatma + tercih ayarları kritik).

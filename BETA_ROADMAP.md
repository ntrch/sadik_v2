# SADIK v2 — Beta Roadmap & Session Handoff

> **Bu doküman**, iki paralel Claude Code oturumu (iki Pro hesap) arasında geçerken, sıfır context'li bir session'ın bile okuyup işe devam edebilmesi için yazılmıştır. Her session başında **önce bunu oku**, sonra aksiyona geç.

---

## 0. Bu doküman nasıl kullanılır

**Her session başında:**
1. `git pull origin main` — diğer hesabın merge'lediği değişiklikleri al
2. Bu dosyayı oku (özellikle "Şu an neredeyiz" + "Aktif sprint" + "Kilitler")
3. `memory/MEMORY.md` + `CHECKPOINT.md` — mimari bilgi
4. Aktif sprint'in "Next actionable task"ına bak
5. Task'ı al, Sonnet 4.6 sub-agent'a delege et (Opus planlar, Sonnet kod yazar)
6. Task biter → bu dosyayı güncelle (bölüm: "Şu an neredeyiz" + ilgili sprint'in task listesi) → commit + push

**Paralel çalışma kuralı:**
- İki hesap aynı anda çalışıyorsa **farklı sprint'lerden task alsın** (kilit çakışması için aşağıda "Concurrency zones" bölümü var)
- Commit mesajına her zaman `[session-A]` veya `[session-B]` prefix koy, pull öncesi kontrol et
- Aynı dosyaya iki hesap aynı anda yazmasın — sprint bölümlerinde `concurrency_zone` etiketi var

**Altın kural:**
- Opus (bu session) = karar, plan, sprint ilerletme, dokümant güncelleme, small surgical fix
- Sonnet sub-agent = çok-dosyalı analiz + implementation + büyük refactor + regression test

---

## 1. Proje özeti (sıfır context için)

**SADIK**: TR kullanıcılara yönelik, yapay zekalı masaüstü companion. Electron+React (`sadik-app/`) + FastAPI async backend (`sadik-backend/`) + ESP32 OLED device (serial). Local-first mimari, voice-first etkileşim, wake-word ("Sadık"), proaktif öneri sistemi.

**Temel özellikler (mevcut):** Tasks, Pomodoro, Habits, Mode switch (working/coding/meeting/break/custom), Workspace, Voice Assistant, Wake-word, Proactive insights, Google Calendar entegrasyonu, DND, OLED animasyonları + live preview.

**Teknoloji kararları:**
- Frontend state: React Context (`AppContext.tsx` — büyük, tüm cross-cutting state burada)
- Backend: FastAPI async + SQLAlchemy async + SQLite (Base.metadata.create_all, migration yok)
- LLM: şu an chat_service'te entegre (provider henüz kilitlenmedi)
- Voice: Whisper STT + edge-TTS + streaming LLM per-sentence TTS
- Wake-word: openWakeWord, custom `sadik.onnx`
- Device: serial, dummy terminal protokol + frame streaming pipeline

---

## 2. Vizyon (beta için olmazsa olmaz)

1. **LLM tüm izin verilen verilere erişir** (tool use) — voice veya text ile kullanıcı her şeyi yapabilir
2. **Sadık ile sesli etkileşim** = task listele/sil, habit listele, pomodoro başlat, mode değiştir, memory ara, break başlat/iptal, agenda sorgula. **Task CREATE sesli olmayacak**, sadece silme + sorgulama + öneri dinleme.
3. **Davranış öğrenme** (opt-in): app usage pattern'leri cluster'lanır, kullanıcı profili çıkarılır, LLM system prompt'una enjekte edilir. "Normalde pazartesi sabahları kod yazardın" diyebilsin.
4. **Free vs Paid** — free'de de ölü değil companion. Limit voice turn, limited LLM. Pro = tool use full, proactive, learning, premium model, integrations. Subscription altyapısı **shadow ready**, hard-gate beta sonrası user data'ya göre.
5. **Native macOS + Windows** — electron-builder signed + notarized. Auto-update.
6. **TR-only beta** (şimdilik)
7. **Herkese hitap** — dev-only jargon temizlensin, mode presetleri genişlesin (Yazarlık, Öğrenme, Tasarım, Okuma, Oyun), onboarding persona seçimi.

---

## 3. Privacy mimarisi (kilitlendi)

**3 katman:**

| Katman | Ne | Cloud'a gider mi | Default |
|---|---|---|---|
| **Always local** | Raw app usage (dakika), voice recording (STT sonrası silinir), memory content, activity timeline | **Asla** | — |
| **Derived summary** | Task titles, habit names, mode patterns, weekly cluster summary cümlesi | Opt-in, sadece **agregat/özet**, ham değil | **Kapalı** |
| **Anlık query** | Voice/text prompt + o an gereken context (task list gibi) | Anlık, user consent (prompt yazma eylemi zaten consent) | — |

**Kurallar:**
- LLM'e giden her request'te Settings'te canlı preview panel: "şu an şu veriler cloud'a gidiyor"
- Redaction middleware: email/phone/IBAN/API key pattern'ı mask
- Provider zero-retention mode (enterprise tier gerektirebilir, not al)
- Settings → Gizlilik:
  - [ ] Davranış öğrenme (default KAPALI)
  - [ ] Takvim entegrasyonu (title/time)
  - [ ] Notion entegrasyonu (page title/content)
  - [ ] Voice conversation memory
  - Her toggle: "ne gidiyor / neden / kapatırsan ne kaybedersin"
- KVKK: aydınlatma metni + açık rıza + "verilerimi sil" + JSON export

---

## 4. Şu an neredeyiz (GÜNCEL DURUM)

**Tarih:** 2026-04-20
**Son commit:** Sprint 2.5 hotfix
**Branch:** main

### Yakın geçmişteki kazanımlar (tamamlandı, regression için test gerekli):
- Proaktif sistem full state machine + queue + priority + habits integration (AppContext.tsx)
- Wake-word: custom model, tuning slider'ları, hot-reload, WS reconnect, global pipeline (sayfa bağımsız)
- Windows native notification (setAppUserModelId)
- Google Calendar entegrasyonu + Agenda sayfası + near-real-time sync
- Mode system (unified popup, 130+ icon, DND per-mode)
- Sprint 2.5 tamamlandı: privacy flag enforcement + voice delete expansion + confirm gate

### Bilinen sorunlar / verify bekleyen:
- Proaktif 7 senaryo gerçek kullanımda test edilmedi
- Wake-word 48h uptime testi yapılmadı
- Long-session memory leak bilinmiyor
- Voice pipeline gecikmesi (~28s end-to-end "Nasılsın?" testinde) — kod tarafında 2.5-5s daha sıkıştırılabilir ama OpenAI ham latansı (whisper-1 ~14s + chat ~14s) kod ile düzeltilemez. **Beta için mevcut hâl kabul edildi**; kullanım datası sonrası (T7.2) Cartesia/Deepgram (C planı) veya Realtime API (D planı) kararı verilecek. ElevenLabs kredi yenilenince algı kalitesi düzelir.

### Yeni biten (2026-05-01) — voice/stability/settings sprint batch (commit 7ae475e):
- **Voice prompt persona** — SADIK kimliği pekiştirildi, proaktif kapatma teklifi yasaklandı, robotik cevap kalıpları yasaklandı, selamlaşmada tool-gating
- **OpenAI client retry/timeout** — chat: max_retries=0/timeout=20s; STT: max_retries=2/timeout=30s; STT exception → 500 yerine empty text (handleDidntHear recovery)
- **Streaming tool path** — `run_tool_loop_stream` async generator, voice path artık tool kullansa bile cümle delta'sını streaming yolluyor
- **TTS chunk overlap fix** — schedulePoll race kaldırıldı, isPlayingRef re-entry guard, end-conv double-fire fix (endHandledRef)
- **Wake word default** — DEFAULT_INPUT_GAIN 1.5→1.9; seed wake_threshold=0.35, wake_input_gain=1.9
- **DTR/RTS hold low before serial open** — Windows CP210x/CH340 üzerinde focus regain'de ESP32 boot screen flash'ı düzeltildi
- **Idempotent connect chain** — frontend autoConnect + backend connect/auto_connect; aynı target tekrar bağlamayı no-op yapar
- **Late WS device profile recovery** — `/api/device/status` artık `device_line` döner; useWebSocket onOpen callback ile AppContext WS reconnect'te status fetch + variant parse yapar (frame pump dondurma fix)
- **AnimationEngine clock** — `requestAnimationFrame` → `setInterval(60ms)`; pencere blur olunca Chromium rAF throttle'ı OLED/preview'i donduruyordu (backgroundThrottling=false yetmiyor)
- **handleDidntHear** — 3. attempt idle'a dönmeden önce `clearWakeWordPending()` (idle effect'in stale wake trigger ile listening'e zıplamasını engeller)
- **Pomodoro/break native notifications** — `pomodoro_completed` + `break_completed` Electron native notification
- **Settings draft-state refactor** — 17 draft mirror, dirty flag, Save zorunlu, unsaved-exit dialog (document-level click capture), beforeunload, tüm live-apply helper'ları kaldırıldı, handleSave merkezi sequential API call
- Faz 0.5 OAuth refactor (Desktop+PKCE) ship-blocker

### Aktif epic: **T-UI — Radikal UI Refresh (dream dili)**

> **Source**: `ui_dream/` (5 png — dashboard, habits, screentime, think, workspace). Esinlenilen projenin tasarım dili tatbik edilir; logic dokunulmaz, çalışan hiçbir şey bozulmaz, zero-error hedefi. Navbar ikonları + sıralaması + HeaderBar content **korunur**; sadece container/spacing/tipografi kalibre edilir. Bizde olup dream'de olmayan tüm yüzeyler aynı tasarım gramerinde yeniden çizilir.
>
> **Workflow**: her sprint Sonnet sub-agent'a delege; commit `feat(ui-S{n}): … [session-master]`; her sprint sonu `npm run typecheck` + `npm run build` zero-error.

| ID | Sprint | Durum |
|---|---|---|
| T-UI.S0 | Design tokens (slate palette, rounded scale, typography, accent-cyan) | ✅ tokens: slate palette + accent-primary cyan + radius bump (card 18px, pill) + border.focus cyan |
| T-UI.S1 | Shell — BottomNav floating capsule + HeaderBar kalibre | ✅ BottomNav pill capsule (rounded-full, gap-0.5, p-2.5, icon 20) + HeaderBar flat slate (bg-bg-main/80 backdrop-blur-xl, tracking-tight clock, muted date, compact buttons p-2, accent-primary pill & popover) |
| T-UI.S2 | DashboardPage — timeline + 2 stat + schedule | ✅ greeting H1 + flat stat cards + schedule stripes + accent-primary tümünü gör |
| T-UI.S3 | HabitsPage — due-now hero + week grid | ✅ habits — H1 + cyan pill CTA + flat card dili (due-now/grid backend yok, scope-out) |
| T-UI.S3.5 | Habits feature delivery — logs + Did it/Snooze/Skip/Reschedule + week grid + per-habit color/icon + interval (sub-daily) habit type | ✅ HabitLog model + habit_logs table + 4 new endpoints (log, snooze, due, logs) + interval scheduler + silent WS broadcast + frontend HabitModal (color/icon/target_days/freqType) + DueHabitCard + WeekGrid + streak derive |
| T-UI.S4 | WorkspacePage — H1 + flat card + cyan run pill + modal dream dili | ✅ workspace — flat card (sol kenar accent şeridi) + cyan run pill + modal/ActionRow dream gramerinde (chip-tabs/hero/items-grid scope-out: tek-WS yapısı + action-as-modal feature paterni korunur) + S4b: dream layered (selector + hero + items grid + inline delete + + Add Item) + S4c: polish (Aksiyonlar başlığı, last-used, ayar adı, kısa şerit) + S4d: last-used pill + Uygulama tag + kısa şerit + H1 büyüt + open_file/folder action |
| T-UI.S5 | InsightsPage — hero metric + activity timeline | ✅ insights — H1 + segmented pill + hero flat card (kısa accent şerit + büyük rakam + uygulama pill) + EN ÇOK KULLANILAN/GÜNLÜK TOPLAM section başlıkları + privacy korunur (timeline raw events backend yok, scope-out) + S5b: timeline (today only — task_completed + habit_logged + app_used events derived from existing endpoints) + S5c: timeline app_used events (yeni /stats/app-usage/events endpoint, raw event listesi, accent-blue dot) |
| T-UI.S6 | MemoryPage — filter chips + list + composer | ⏸ |
| T-UI.S7 | Tasks/Agenda/Chat/Settings dream dili tatbiki | ⏸ |
| T-UI.S8 | Özgün yüzeyler (Voice, GlobalInsight, Feedback, OledPreview, DeviceStatus, Onboarding, UpdateBanner, TelemetryConsent) | ⏸ |
| T-UI.S9 | Polish + regression sweep | ⏸ |

---

### Aktif sprint: **Sprint 3 — Behavioral learning (opt-in)**

**İlerleme:**
- ✅ T1.1 voice tool-use backend (12 tool, registry, debug endpoint)
- ✅ T1.2 backend frame protocol (tool_status frame + tool_calls_used metadata)
- ✅ T1.3 frontend tool indicator (TR label, animate-pulse)
- ✅ T1.4 proaktif regression — 1 bug fix + 4 telemetry log
- ⏸️ T1.5 wake-word 48h monitoring — gerçek kullanıma ertelendi (beta'da gözlemlenir)
- ⏸️ T1.6 memory leak testi — gerçek kullanıma ertelendi
- **Sprint 2 + ara bug'lar tamamlandı ✅**
  - Ara fix: STT halüsinasyon (RMS gate 0.005 + temperature=0 + 21 TR blacklist)
  - Ara fix: Text input focus (VoiceAssistant wakeWordPending/Escape handler'lara `isInputFocused()` guard)
- **Sprint 2.5 tamamlandı ✅**
- **Sprint 2.7 tamamlandı ✅ — 3-tier privacy preset (Full/Hybrid/Local) + advanced override**
- **Sprint 2.8 tamamlandı ✅ — Notion-benzeri TaskDetailDrawer (rich-text `notes`, TipTap, sağdan slide)**
- **Sprint 3 tamamlandı ✅**
- **Sprint 6 T6.1 tamamlandı ✅ — OAuth Desktop+PKCE refactor (e2e test geçti)**
- **Sprint 4 T4.1 tamamlandı ✅ — Notion provider (OAuth + DB select + page→task sync, 5dk scheduler)**
  - ⚠️ Notion public integration credential gerekiyor: `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` env. Env boşsa `/notion/start` 500 döner — T4.3'te card disabled göstermeli.
- **Sprint 4 T4.3 (Notion kısmı) tamamlandı ✅ — SettingsPage Entegrasyonlar'da Notion kartı (bağlan/DB seç/disconnect)**
- [DONE: session-A] Sprint 4 ara-iş — Task icon sistemi + Notion/GCal brand logoları (TaskCard + Agenda)
- **Sprint 4 T4.2 tamamlandı ✅ — Google Meet active-conference detection (scope + poll + state + endpoint)**
  - ⚠️ Mevcut Google Calendar kullanıcıları Meet scope için reconnect gerektirir (scope_granted=false dönecek)
- **Sprint 4 T4.3b + T4.4 tamamlandı ✅ — Meet scope uyarısı + in_meeting synthetic insight handler**
- **Sprint 4 TAMAMLANDI ✅**
- **Sprint 5 tamamlandı ✅** — T5.1 (preset kataloğu), T5.2 (jargon temizliği), T5.3 (onboarding persona), T5.4 (empty states + first-day tutorial)
  - **Native distribution audit (beta blocker):** electron-builder config, code-sign (Windows + macOS), notarize (macOS), auto-update channel, node_modules native deps (openWakeWord onnxruntime platform-specific binary'ler) — Faz 0.5 OAuth ile aynı ship-gate'te ele alınacak
- **Sprint 6 T6.2 + T6.5 tamamlandı ✅** — electron-builder config + PyInstaller embedded backend + spawn lifecycle
  - Build sırası: `cd sadik-backend && .\build\build.ps1` (PyInstaller onedir → `sadik-backend/dist/sadik-backend/`) → `cd sadik-app && npm install && npm run build && npm run package:dir` (unsigned dev paket, NSIS sonra)
  - Test akışı: backend.exe standalone OK → SADIK.exe paket sıçraması (~5s) → UI/animations/wakeword/voice ✅ → Tray-Çıkış'ta backend kapanıyor ✅
  - **End-to-end fixes (paket build sırasında çıkan)**:
    - `launch.py`: `app.main` static import (uvicorn string-load PyInstaller analyze edemiyordu)
    - `sadik-backend.spec`: `collect_submodules("app")` eklendi
    - `app/main.py`: per-table create_all + try/except — bundle SQLite inspector quirk'ini idempotent yapar
    - `electron/main.js`: `app.isPackaged` ise `loadFile(dist/index.html)`, dev'de loadURL
    - `webpack.config.js`: prod'da `publicPath: './'` (file:// resolve), `public/animations` copy plugin'e eklendi
    - `App.tsx`: `BrowserRouter` → `HashRouter` (file:// pathname routing fix)
    - `AnimationEngine.ts`: `/animations/...` → `./animations/...` (relative path)
  - Code-signing cert kullanıcı tarafından alınacak (Windows EV/OV + macOS Developer ID); cert geldiğinde `package.json` `build.win.signtoolOptions` + `build.mac.notarize=true` env-driven enable edilir
  - **Bilinen ufak iş** (ship-blocker değil): Workspace launcher'da Windows Terminal (UWP/wt.exe) snap+anlık-açılma sorunu — UWP wrapper PID problemi, klasik .exe'ler (Steam/Chrome/cmd.exe/powershell.exe) sorunsuz. Beta sonrası fix listesi.

### Distribution stratejisi (2026-04-27 kararı)

**Bütçe + donanım kısıtı**: Eren'in Mac'i yok, code-signing cert bütçesi yok. Beta tester'lar arkadaşları (3-5 kişi). Mac için arkadaşının M2'sine geçici erişim var.

**Plan**:
1. **Windows beta — yakın hedef**: Unsigned NSIS installer kabul (`SADIK-Setup.exe`). SmartScreen "bilinmeyen yayıncı" uyarısı çıkacak; arkadaşları "yine de çalıştır"a basıp geçecek. Cert sonra (gelir gelirse).
2. **Mac one-shot**: Arkadaşının M2'sinde tek seferlik build, unsigned `.dmg`. Arkadaş Sistem Ayarları → Güvenlik → "yine de aç" ile çalıştırır. Apple Developer hesabı + notarize alınmıyor (99$/yıl bütçe yok). Tek tester için yeterli.
3. **Sıralama**: T6.3 auto-update → Windows NSIS test → T8 closed beta (Drive linki) → Mac one-shot Mac erişimi olunca → T6.1b (Notion PKCE) bug'a göre.

**Halka açık release ertelendi**: Cert + Apple Developer alınana kadar herkese açık değil; sadece arkadaş çevresi beta.

### Color Sprint-6 KAPANDI ✅ (2026-04-27)
- W1 ✅ AnimationEngine + idle/blink/variation in-firmware (görsel smoke geçti)
- W2 ✅ Legacy söküm + log spam fix (`1574937`): ClipPlayer/PROGMEM/1-bit framebuffer kaldırıldı, ACK gating + pacing fix → temiz ASCII log, Flash −56 KB / RAM −17 KB, MANIFEST publish
- Donanım smoke: idle→blink→idle döngüsü temiz, garbage yok, STALL_RESET yok ✅
- [session-A] ✅ Clip atlaması fix: app-side 300ms state-stable hold + diagnostic logs (`[ColorClip] dispatch …`); firmware P-frame SPI tighten (startWrite/endWrite tile loop dışına alındı, SPI 40MHz zaten OK)

**Sırada: Multi-device Sprint-1** (handshake `DEVICE:variant=color ...` + app-side `DeviceProfile`).

### Color Sprint-7: 24fps gating CRC-fail kaskadı fix (2026-04-28) — DONE

- [x] **Root cause**: `LocalClipPlayer::update()` deadline sadece `codec_frames_applied()` artınca ilerletiyordu. CRC fail → applied counter sabit → gate açık kalıyor → full-speed pump → daha fazla CRC fail kaskadı.
- [x] **24fps gating CRC-fail kaskadı**: `codec_frames_attempted()` sayacı eklendi (`success + crc_fail`). Player gating bu sayaca bağlandı; progress log gerçek render sayısını göstermeye devam ediyor. Build SUCCESS, compile error yok.
- [x] **read buffer 4KB→512 anti-burst**: 1 read = mid-packet for typical PFRAME, burst ortadan kalkar
- [x] **encode.py target_fps=24 downsample + asset re-encode**: `--target-fps` CLI arg eklendi; 22 clip 60fps→24fps downsampled, wakeword fallback (fps=0 WARN). Build SUCCESS.
- [x] **[session-B] debug log temizliği + clamp 10→3 restore**: `[gate]` diagnostic loglar kaldırıldı, clamp eşiği 3'e döndürüldü.

Aşağıdaki sprint 6'ya kadar sıralı planlandı. Her sprint tamamlandığında bu bölümü güncelle.

---

## 5. Sprint planı (sıralı, kilit gibi)

> **Not:** Süre vermiyorum. "Bir sonraki bitince diğeri başlar." Paralel çalışma için zone etiketleri var.

### Sprint 1: Stabilizasyon + Voice Tool-Use Foundation
**Amaç:** Mevcut tüm özellikler sessiz çalışsın; voice ile mevcut tüm feature'lar tetiklenebilsin.

**Concurrency zone A (backend + voice pipeline):**
- [x] **T1.1** Voice tool-use backend altyapısı ✅
  - NEW `sadik-backend/app/services/voice_tools.py` — 12 tool registry + `run_tool_loop` (max 3 round)
  - MOD `chat_service.py` (+87 satır) — `use_tools=True` path, sentence-split wrapper
  - MOD `routers/voice.py` — `voice_chat_stream` tool loop entegre, `POST /api/voice/tools/debug`, `GET /api/voice/tools/list`
  - Provider: OpenAI function-calling format (Anthropic eklenebilir)
  - Debug endpoint ile her tool manuel test edilebilir
  - **Limit:** tool loop non-streaming (kullanıcı tool execute ederken bekler) — T1.2'de iyileştirme hedefi
- [x] **T1.2** Voice pipeline tool-use UX polish ✅
  - Backend frame protocol: yeni `0x02` frame type (`tool_status`), `on_tool_event` callback, `tool_calls_used` metadata
  - `run_tool_loop` her tool için `executing`/`completed` emit ediyor
  - Final metadata frame'de `tool_calls_used: [{name, args_summary}]`
  - Not: tool bitmeden sentence yield edilmediği için `executing` ve `completed` frame'ler yakın geliyor — tek tur için kabul
- [x] **T1.3** Frontend tool indicator ✅
  - `voice.ts`: `onToolEvent` callback + `0x02` frame parse
  - `VoiceAssistant.tsx`: `TOOL_LABELS` (12 tool TR), `activeTools` state, status label altında animate-pulse indicator

**Concurrency zone B (frontend stabilizasyon):**
- [x] **T1.4** Proaktif 7 senaryo regression ✅
  - 1 gerçek bug bulundu + fixlendi: `setActiveInsight` Rule A/F/B/C'den önce çağrılıyordu → DND/quiet hours aktifken dashboard kart görünüyordu (AppContext.tsx:1154→1175)
  - 4 telemetry log eklendi: poll entry, sweep non-empty, accept/deny, break start/cancel/complete
  - 7 senaryonun tamamı call-chain ile trace edildi, hepsi ✅ logical test pass
  - Manual test prosedürü rapor içinde detaylı
- [DEFERRED-REAL-USE] **T1.5** Wake-word 48h monitoring — gerçek kullanım gerektirir, beta sürecinde gözlemlenir
- [DEFERRED-REAL-USE] **T1.6** Long-session memory leak testi — gerçek kullanım gerektirir, beta sürecinde gözlemlenir

**Exit criteria:** Voice ile "bugün teslim edeceğim task'lar ne?" soruldu → TTS cevap verdi + listing doğru. Proaktif 7 senaryo ✅.

---

### Sprint 2: Privacy layer + Settings panel
**Amaç:** LLM'e cloud push'u user control'e al, KVKK uyumlu aydınlatma+rıza akışı.

**Concurrency zone A (backend):**
- [x] **T2.1** Settings tablosuna privacy flag'leri ✅
  - `privacy_behavioral_learning`, `privacy_calendar_push`, `privacy_notion_push`, `privacy_voice_memory`
  - Hepsi default `false`
  - Değişen: `sadik-backend/app/main.py` DEFAULT_SETTINGS dict'ine 4 key eklendi
  - Key-value tablosu → migration gerekmedi; lifespan startup'ta auto-seed eder
  - Generic GET/PUT endpoint'leri zaten çalışıyor
- [x] **T2.2** Redaction middleware (backend) ✅
  - Email/phone/IBAN/API key/credit card regex mask'le
  - LLM'e giden her prompt bundan geçsin
  - Yeni: `sadik-backend/app/services/redaction.py` (`redact`, `redact_messages`)
  - Entegrasyon: chat_service (send_message + stream_voice_response) + voice_tools (run_tool_loop iki create noktası)
  - Test edildi: saat "09:30" bozulmuyor, e-mail/phone/IBAN/API key mask'leniyor
- [x] **T2.3** "Veri export" + "veri sil" endpoint'leri ✅
  - `GET /api/privacy/export` — 13 tablo full JSON dump
  - `POST /api/privacy/purge/request` — 60s geçerli confirm token
  - `DELETE /api/privacy/purge?token=...` — Option A: tüm tabloları FK-aware sırayla sil + DEFAULT_SETTINGS re-seed
  - Yeni: `sadik-backend/app/routers/privacy.py`; main.py'ye register edildi

**Concurrency zone B (frontend):**
- [x] **T2.4** Settings → Gizlilik sekmesi ✅
  - 4 toggle (davranış öğrenme/calendar/notion/voice memory) + canlı preview
  - "Verimi İndir" → blob download
  - "Tüm Verimi Sil" → 2-adımlı token-confirm modal + 60s countdown + reload
  - Yeni: `sadik-app/src/api/privacy.ts`; SettingsPage.tsx'e Shield section eklendi
- [x] **T2.5** Onboarding consent flow (yeni user) ✅
  - 3-adımlı full-screen modal: aydınlatma → 4 toggle (opt-in, default kapalı) → açık rıza
  - Backend: DEFAULT_SETTINGS'e `onboarding_completed=false` eklendi
  - Yeni: `sadik-app/src/pages/OnboardingPage.tsx`; App.tsx AppShell'de gating
  - KVKK metni linki placeholder (T2.6'da dolacak)
- [x] **T2.6** KVKK aydınlatma metni dosyası (statik) ✅
  - Yeni: `sadik-app/src/content/kvkkNotice.ts` (9 bölüm TR KVKK metni)
  - Settings + Onboarding modal'larındaki placeholder → gerçek scrollable metin
  - Versiyon tarihi: 2026-04-20

**Exit criteria:** Tüm toggle'lar çalışır, redaction middleware testte LLM prompt'undan email mask'liyor.

---

### Sprint 2.5 (hotfix): Privacy enforcement + Voice delete expansion
**Amaç:** Beta feedback'ine göre privacy toggle'ları fonksiyonel yap + sesli silme kapsamını genişlet.

**Concurrency zone A (backend):**
- [x] **T2.5.1** Privacy flag helper + tool-level enforcement
  - Yeni: `sadik-backend/app/services/privacy_flags.py` — `get_privacy_flags(session)` helper, 4 flag, bool normalisation
  - `voice_tools.py` `_get_today_agenda` — `privacy_flags` parametresi; `privacy_calendar_push=false` iken ExternalEvent sorgusu atlanır
  - `execute_tool` + `run_tool_loop` — `privacy_flags` kwarg eklendi (opsiyonel, geriye uyumlu)
- [x] **T2.5.2** Voice delete tool expansion (5 yeni + confirm gate)
  - `delete_task` — `confirmed: bool` required eklendi; `confirmed=false` → erken dön
  - Yeni tools: `delete_habit`, `delete_event`, `delete_workspace`, `delete_memory_note`, `delete_clipboard_item`
  - Tüm yeni delete tool'ları `confirmed` required; gate mesajı: "Silme işlemi için önce onay gerekli."
  - Tool description'larında Türkçe onay akışı talimatı
- [x] **T2.5.3** Conversation history gate (privacy_voice_memory)
  - `voice.py` `voice_chat_stream` — `privacy_voice_memory=false` iken `db_history=[]`, user+assistant mesajları DB'ye yazılmaz
  - `chat_service.py` `send_message` + `stream_voice_response` — `privacy_flags` kwarg, `run_tool_loop`'a iletilir

**Exit criteria:** `privacy_calendar_push=false` → "bugün ajandamda ne var?" testi Google Calendar verisi dönmez. `delete_habit` vb. tool'lar `confirmed=false` iken execute etmez. `privacy_voice_memory=false` → LLM prompt'una önceki mesajlar eklenmez, DB'ye yazılmaz.

---

### Sprint 2.7 (refactor): 3-tier privacy preset
**Amaç:** 4 ayrı toggle yerine tek "AI Deneyim Modu" seçimi (Full / Hybrid / Local). Kullanıcının zihinsel modeli "LLM'e ne kadar güveniyorum" tek sorusu olsun.

**Concurrency zone A (backend):**
- [x] **T2.7a** Tier → flag mapping + tool schema filtresi
  - `privacy_flags.py`: `TIER_FLAG_MAP`, `get_privacy_tier`, `apply_tier_to_flags`
  - `voice_tools.py`: `get_tool_schemas(provider, tier)` — local → `[]`, hybrid → 2 tool hariç (`get_app_usage_summary`, `search_memory`), full → hepsi
  - `run_tool_loop(tier="full")` — tools=[] iken `tool_choice` gönderilmez
- [x] **T2.7b** `chat_service.send_message` + `stream_voice_response` — `tier` kwarg, `run_tool_loop`'a forward
- [x] **T2.7c** `/api/privacy/tier` — GET (tier+flags) + PUT (apply_tier_to_flags)
- [x] **T2.7d** `SettingsPage` Gizlilik — 3 preset kart + "Gelişmiş Ayarlar" accordion (mevcut 4 toggle advanced'a taşındı); tek toggle değişince `privacy_tier=custom` flag'lenir
- [x] **T2.7e** `OnboardingPage` 2. adım — 4 toggle yerine 3 tier seçim kartı (active bullet detayları); `privacyApi.setTier()` ile kaydedilir

**Exit criteria:** Local modda voice chat tool kullanmaz, sadece generic TR chat döner. Hybrid modda `get_app_usage_summary` tetiklenmez. Full modda davranış: Sprint 2.5 ile aynı.

---

### Sprint 3: Behavioral learning (opt-in)
**Amaç:** Sadık "normalde bu saatte kod yazardın" diyebilsin.

**Concurrency zone A (backend):**
- [x] **T3.1 tamam [session-A]** App usage pattern mining job ✅
  - NEW `services/behavioral_patterns.py` — `compute_weekly_patterns` (14 gün ModeLog, 7 gün × 8 blok × 3h grid), 6h scheduler
  - ModeLog kaynak (explicit mode tracking), hour-by-hour split + overlap
  - JSON v1: `{version, generated_at, days_analyzed, weekly[dow][blocks], summary_tr}`
  - Insufficient data (<3 session) → dominant_mode=null
  - Setting: `user_profile_patterns` (empty string default)
- [x] **T3.2 tamam [session-A]** Pattern summary generator + LLM injection ✅
  - `summary_tr`: top-3 blok by duration ("Pazartesi 09-12 kod yazma; Salı 13-15 toplantı; ...")
  - `chat_service._build_messages` — `behavioral_summary` kwarg → system prompt'a eklenir
  - Gate: `privacy_flags["privacy_behavioral_learning"]=True` (default sadece Full tier'da)
- [x] **T3.3 tamam [session-A]** Behavioral insight proactive category ✅
  - Yeni: `sadik-backend/app/services/behavioral_insight.py` — `evaluate_behavioral_insight(session)` + `mark_behavioral_insight_fired(session)`
  - `sadik-backend/app/routers/stats.py` — `/app-usage/insights` endpoint'i behavioral kategorisini app-usage ile birlikte evaluate ediyor; behavioral-only path dict döner, app-usage path `behavioral` alt-alanı ekler
  - Gate: `privacy_behavioral_learning` false iken ilk satırda return None + debug log
  - Trigger: dow+block'ta `dominant_mode` var & `session_count >= 3` & current_mode ≠ dominant_mode & açık task var (önce <24h due, fallback any open)
  - Level: due <= now+2h ise `strong`, aksi halde `gentle`
  - Anti-spam: Setting key `proactive_behavioral_last_fired_at` ISO timestamp, 24h cooldown
  - Action: `{"type": "switch_mode", "mode": dominant_mode}` — frontend wiring T3.5 scope

**Concurrency zone B (frontend):**
- [x] **T3.4 tamam [session-B]** Dashboard'da "Profil" kartı (opt-in toggle açıksa) ✅
  - Yeni: `sadik-app/src/components/dashboard/WeeklyProfileCard.tsx` — 7×24 heatmap + hover tooltip + legend + summary_tr
  - Privacy gate: `privacy_behavioral_learning !== 'true'` iken kart hiç render olmuyor
  - Veri yoksa: "Henüz yeterli veri yok" placeholder
  - DashboardPage.tsx ActivityChart üstüne wire edildi
- [x] **T3.5 tamam [session-A]** Proactive suggestion'da "workspace öner" aksiyonu ✅
  - `api/stats.ts`: `AppInsight` type'ına `action: InsightAction` + `source: 'behavioral'` + nested `behavioral` alanı eklendi
  - `behavioral_insight.py`: `dominant_mode`'a bağlı workspace varsa action = `open_workspace`, yoksa `switch_mode` (düşmeyen graceful fallback)
  - `AppContext.acceptInsight`: action type'a göre branch — switch_mode, open_workspace (workspacesApi.get + electronAPI.executeWorkspace), veya legacy break
  - Bug fix: behavioral-only insight'lar `source: 'app_usage'` olarak overwrite ediliyordu, artık backend source'u korunuyor
  - Bug fix: app-usage + behavioral kombinasyonda behavioral nested dict'i eligible list'e de ekleniyor
  - **Sprint 3 tamamlandı ✅**

**Exit criteria:** 14 gün simulated usage data ile pattern job çalışır, anlamlı summary üretir, LLM responseda yansır.

---

### Sprint 4: Integrations tamamlama
**Amaç:** Notion + meeting detect.

**Önkoşul:** T6.1 OAuth Desktop+PKCE refactor tamamlanmış olmalı — Meet yeni auth sisteminin üstüne kurulur.

**Concurrency zone A (backend):**
- [x] **T4.1 tamam [session-A]** Notion provider (Faz 3) ✅
  - Google Calendar pattern'inin birebir üstüne
  - `providers/notion.py` — OAuth, database select, page → task sync
  - Sync job (integration_service scheduler, 60s interval, PROVIDERS registry)
- [x] **T4.2 tamam [session-A]** Google Meet meeting detection (Zoom yerine) ✅
  - `google_calendar.py` SCOPES → `meetings.space.readonly` eklendi (mevcut kullanıcı reconnect gerektirir)
  - Yeni: `services/providers/google_meet.py` — `poll_active_meeting()` her 60s calendar sync sonunda çağrılıyor
  - **[latency fix]** Ayrıca `_meeting_poll_loop()` 20s interval'de bağımsız task olarak çalışıyor (`integration_service.py`) — calendar full sync 60s'de kalıyor, sadece Meet detection hızlandı (maks gecikme 60s → 20s)
  - ExternalEvent'ten `meeting_url` dolu + [now-5m, now+15m] penceresindeki event'ler için `GET meet.googleapis.com/v2/spaces/{code}` → `activeConference` varsa o conference'ın `participants.list`'ine sorulur
  - **Kullanıcı doğrulaması:** OAuth callback'te yakalanan `google_account_sub` (userinfo.sub), participant `signedinUser.user` ile eşleşiyor + `latestEndTime` boş ise "kullanıcı içeride". Takvimde event olması tek başına tetiklemez. Sub yoksa lazy userinfo fetch.
  - State Setting key: `google_meet_state` (in_meeting, event_id, event_title, meeting_code, meeting_url, starts_at, ends_at, detected_at)
  - Router: `GET /api/integrations/google_meet/state` → `{scope_granted, state}`
  - Privacy gate: `privacy_calendar_push=false` iken poll skip
  - Graceful: scope yok/reconnect gerek → sessizce skip, calendar sync bozulmaz
  - Disconnect'te `google_account_sub` + `google_meet_state` temizlenir
- [ ] ~~Zoom Presence API~~ **[DEFERRED]** — Meet ile başlıyoruz, Zoom talep gelirse sonra

**Concurrency zone B (frontend):**
- [x] **T4.3 tamam [session-A]** Settings → Entegrasyonlar Notion kartı (Meet scope dışı)
- [x] **T4.3b tamam [session-A]** Google Calendar kartında Meet scope uyarısı + "Tekrar bağlan" butonu (scope yoksa inline notice)
- [x] **T4.4 tamam [session-A]** Meeting detect handler — AppContext 60s meet state polling; false→true transition + currentMode≠meeting + meeting_code daha önce önerilmedi → synthetic AppInsight (source='meeting', action={type:'switch_mode', mode:'meeting'}) activeInsight'a yazılır → mevcut proactive UI üzerinden kabul/ret

**Exit criteria:** Notion task sync çalışır, Meet toplantısı başlayınca "Meeting moduna geç?" toast görünür.

---

### Sprint 5: Persona genişletme + onboarding + jargon
**Amaç:** Herkese hitap.

**Concurrency zone A (content):**
- [x] **T5.1 tamam [session-A]** Mode preset kataloğu genişletme ✅
  - 5 yeni preset: `writing` (Yazarlık, DND=true), `learning` (Öğrenme, DND=true), `design` (Tasarım, DND=false), `reading` (Okuma, DND=true), `gaming` (Oyun, DND=false)
  - Renk paletinden çakışmasız seçildi; ikonlar: pencil / graduationcap / palette / bookopen / gamepad2
  - `modeColors.ts` DEFAULT_PRESET_COLORS + DEFAULT_PRESET_DND, `modeIcons.ts` DEFAULT_PRESET_ICONS, `DashboardPage.tsx` PRESET_MODES + MODE_LABELS + MODE_ICON_MAP, `ActivityChart.tsx` MODE_LABELS, `voice_tools.py` switch_mode description
  - Dashboard "toplam çalışma" hesabı writing/learning/design/reading'i de dahil eder (gaming hariç — leisure)
- [x] **T5.2 tamam [session-A+B]** Jargon temizliği ✅
  - Senkronize/senkron → eşitle/eşitleme (TaskCard, AgendaPage, SettingsPage GCal + Notion kartları)
  - API Anahtarı → Erişim Anahtarı (OpenAI/OpenWeatherMap/ElevenLabs)
  - LLM/tool/context/header/OAuth bekleniyor/onboarding → yapay zeka/araç/bağlam-veri/üst çubuk/Bağlanıyor/kurulum ekranı (OnboardingPage, SettingsPage, InsightsPage)
  - openWakeWord açıklaması sadeleştirildi ("Yerel ses algılama")
  - "Timer başlatılamadı" → "Oturum başlatılamadı" (FocusPage)
  - "DND modunda" → "Rahatsız Etmeyin modunda" (HabitsPage alt metni)
  - "Pomodoro Ayarları" section'a "Odaklanma seansı süreleri" alt başlığı eklendi (SettingsPage)

**Concurrency zone B (onboarding):**
- [x] **T5.3 tamam [session-A]** İlk açılış onboarding persona seçimi ✅
  - Onboarding 4 adıma çıktı: KVKK → **Persona** → Tier → Consent (PERSONAS: developer/writer/student/designer/general)
  - Backend: `user_persona` setting + `_PERSONA_HINTS` + `_get_user_persona()` helper, `_build_messages(persona=...)` ile system prompt'a "KULLANICI ROLÜ" bloğu enjekte
  - `send_message` + `stream_voice_response` her iki path'te de persona threadli
  - SettingsPage "Rol" section — sonradan değiştirilebilir
- [x] **T5.4 tamam [session-A]** Empty state'ler + ilk-gün tutorial ✅
  - YENİ: `components/common/EmptyState.tsx` (icon + title + desc + CTA + Mic ikonlu voiceHint)
  - YENİ: `components/onboarding/FirstDayTutorial.tsx` — 4-step spotlight overlay (voice-btn → mode-selector → nav-tasks → nav-settings), Atla/İleri/Tamam, complete'te `settingsApi.update({tutorial_completed:'true'})`
  - Empty state replacements: TaskBoard (tüm tasks==0), HabitsPage, MemoryPage (clipboard+notes), WorkspacePage, AgendaPage (selectedItems==0)
  - data-tutorial attrs: HeaderBar voice-btn + nav-settings (gear), DashboardPage mode-selector, BottomNav `/tasks` nav-tasks
  - Backend: `DEFAULT_SETTINGS["tutorial_completed"]="false"` (lifespan auto-seed)
  - AppShell gate: onboarding done + tutorial pending → mount FirstDayTutorial
  - Fix (master): Sonnet'in dead-code Sidebar'a eklediği data-tutorial revert edildi; nav-tasks BottomNav'a, nav-settings HeaderBar gear'a taşındı
  - **Sprint 5 tamamlandı ✅**

**Exit criteria:** Fresh install → onboarding akışı tamam → kullanıcı ilk task'ını voice ile sorabiliyor.

---

### Sprint 6: Ship altyapısı
**Amaç:** Imzalı, auto-updating, dağıtılabilir binary.

**Concurrency zone A (OAuth refactor - ship-blocker):**
- [x] **T6.1 tamam [session-A]** OAuth Desktop+PKCE refactor (Faz 0.5) ✅
  - `config.py` — `google_client_id` + `google_client_secret` embedded (Desktop app, env-overridable)
  - `google_calendar.py` — PKCE (`code_challenge/verifier`) + embedded secret; refresh aynı kimlikle
  - `integrations.py` — `_pkce_pair()`, `start_oauth` PKCE üretir, callback verifier+secret ile exchange; `/config` GET+PUT kaldırıldı
  - Frontend: client_id/secret formu + gear kaldırıldı → direkt "Bağlan"
  - E2E verified: "Bağlan" → tarayıcı onayı → "Bağlandı ✓" → event'ler Ajanda'ya düştü
  - **Not:** Google Desktop OAuth client_secret'ı hâlâ token exchange için zorunlu tutar (native app için "confidential değil" kabul edilir, embed edilebilir). PKCE defense-in-depth olarak çalışır.

- [~] **T6.1b** OAuth consent screen — **Eren-only manuel adım, kod değişikliği YOK** (2026-05-02 atlandı)
  - Eren tester email'lerini topladıkça Google Cloud Console → OAuth consent screen → Test users'a ekleyecek
  - Ship öncesi (T6.x) Google verification submit — Eren manuel
  - PKCE refactor T6.1 ile zaten land oldu; provider'lar embedded secret kullanıyor

**Concurrency zone B (build + release):**
- [x] **T6.2 tamam [session-A]** electron-builder config + embedded backend spawn ✅
  - `sadik-app/package.json` → `build` block (appId `com.sadik.app`, NSIS Win, DMG mac, hardenedRuntime, entitlements, extraResources `../sadik-backend/dist/sadik-backend → backend`); scripts `package`/`package:dir`/`package:win`/`package:mac`; `electron-builder ^24.13.3` devDep
  - `sadik-app/build/entitlements.mac.plist` (mic, audio-input, JIT, network, apple-events)
  - `sadik-app/electron/backend-launcher.js` (yeni) — `app.isPackaged` guard'lı spawn, `/api/health` 30s polling, SIGTERM→3s→SIGKILL teardown, log → `app.getPath('logs')/backend.log`, fail dialog + app.quit
  - `sadik-app/electron/main.js` — `whenReady` async + `await startBackend()`, `before-quit`'e `stopBackend()` eklendi (dev'de no-op, regression yok)
  - Code signing cert henüz yok → signing default off, env-driven (cert geldiğinde aktive)
- [x] **T6.5 tamam [session-A]** Backend embedded (PyInstaller onedir, Option A) ✅
  - `sadik-backend/launch.py` (yeni) — uvicorn entry, frozen `_MEIPASS` sys.path fix
  - `sadik-backend/build/sadik-backend.spec` — onedir, openwakeword/onnxruntime/sounddevice data + custom `app/wake_models/sadik.onnx`, geniş hidden imports (uvicorn/fastapi/sqlalchemy submodules + 14 SADIK service modülü), UPX off (onnxruntime DLL koruma)
  - `sadik-backend/build/build.ps1` + `build.sh` — venv kontrol + pyinstaller install + build
  - `sadik-backend/app/main.py` — `GET /api/health` endpoint
  - `sadik-backend/app/config.py` — `_default_db_path()`: frozen → `%APPDATA%/sadik/sadik.db` (Win) / `~/sadik/sadik.db`; dev davranışı aynen korundu (`getattr(sys,"frozen",False)` False branch)
  - `.gitignore` (sadik-backend + root) — `dist/`, `release/`, `build/__pycache__/`
- [x] **T6.6 tamam [session-A]** CP210x driver installer'a gömüldü
  - `sadik-app/build/drivers/cp210x/{silabser.inf,silabser.cat,silabser.sys}` (Universal Windows Driver, x64)
  - `sadik-app/build/installer.nsh` (NEW) — `customInstall` macro: `pnputil /add-driver ... /install`
  - `sadik-app/package.json` — `extraResources` driver klasörü, `win.requestedExecutionLevel: asInvoker`, `nsis.perMachine: true`, `nsis.include: build/installer.nsh`; perMachine:true → installer UAC bir kez prompt eder, kurulu app normal user olarak açılır
  - **Sebep:** ESP32-WROOM-32 CP210x USB-UART bridge kullanıyor; Windows'ta default driver yok → temiz makinede cihaz COM port almıyordu.
- [x] **T6.3 tamam [session-A]** Auto-update (electron-updater + GitHub Releases)
  - `sadik-app/package.json` — `electron-updater ^6.8.3` dep, `build.publish` GitHub provider (`ntrch/sadik-releases`), `"release": "electron-builder --publish always"` script
  - `sadik-app/electron/main.js` — `autoUpdater` import; `checkForUpdatesAndNotify()` on ready (packaged-only); `update-available` / `update-downloaded` / `error` event handlers; `updater:quit-and-install` ipcMain handler
  - `sadik-app/electron/preload.js` — `onUpdateAvailable`, `onUpdateDownloaded`, `quitAndInstall` exposed on `electronAPI`
  - `sadik-app/src/components/updater/UpdateBanner.tsx` (NEW) — fixed bottom banner: "indiriliyor" state → "hazır + Yeniden başlat" buton; `App.tsx`'e mount edildi
  - **Manuel gerekli:** `gh repo create ntrch/sadik-releases --public --description "SADIK release artifacts"` ile repo aç; release publish için `GH_TOKEN` env ile `npm run release` çalıştır
- [x] **T6.4 tamamlandı [session-A]** Basit landing page (statik tek dosya)
  - `landing/index.html` — inline CSS, koyu tema, hero + 4 özellik kartı + 3-tier gizlilik + cihaz bölümü + changelog link + footer
  - `landing/icon.png` — `sadik-app/build/icon.png` kopyalandı
  - **Canlı (2026-05-02):** https://ntrch.github.io/sadik-releases/ (GitHub Pages, `sadik-releases` repo `gh-pages` branch)
  - Future update: `landing/` master'da edit → `gh-pages` branch'e push (subtree veya manuel kopya)
- [x] **T6.5 KARAR + IMPLEMENTATION** — Option A (PyInstaller embedded) ✅ yukarıda detay

**Exit criteria:** Temiz Windows + macOS makinede `.exe` / `.dmg` çift tıkla → app çalışır.

---

### Sprint 7: Subscription shadow + telemetry
**Amaç:** Shadow olarak Pro altyapısı hazır, hard-gate yok.

**Concurrency zone A (backend):**
- [x] **T7.1 tamam [session-A]** User tier model (Free/Pro)
  - Settings: `user_tier` (default free), `pro_expires_at`
  - Her AI call backend'de tier check → free limit'te throttle/mesaj, hard-block YOK (beta için)
  - MOD `sadik-backend/app/main.py` — `user_tier` + `pro_expires_at` DEFAULT_SETTINGS keys
  - NEW `sadik-backend/app/services/tier_guard.py` — `get_effective_tier()` + `get_tier_status()` (soft warn, never raises)
  - MOD `sadik-backend/app/routers/chat.py` — `tier_status` opt-in field in POST /api/chat/message response
  - MOD `sadik-backend/app/services/chat_service.py` — `event: tier_status` SSE frame at stream start (voice)
- [x] **T7.2 tamam [session-B]** Usage tracking (commit 65cdb45)
  - Voice turn count, LLM token count, tool call count
  - `/api/usage/me` endpoint — analiz için
  - Settings'te UsageStatsCard
- [x] **T7.3 tamam [session-A]** Stripe shadow billing (checkout + webhook + portal)
  - [x] **T7.3b tamam [session-A]** Checkout completion UX
    - NEW endpoints: GET /api/billing/checkout-complete + /checkout-cancel (self-closing HTML)
    - `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL` default güncellendi
    - SettingsPage: 3sn polling (5dk timeout) + free→pro flip detection + success toast
  - MOD `sadik-backend/requirements.txt` — `stripe>=8.0.0,<10.0.0` eklendi
  - MOD `sadik-backend/app/config.py` — `stripe_secret_key`, `stripe_webhook_secret`, `stripe_price_id`, `stripe_success_url`, `stripe_cancel_url` env fields
  - MOD `sadik-backend/app/main.py` — `stripe_customer_id`, `stripe_subscription_id`, `billing_enabled` DEFAULT_SETTINGS + billing router register
  - NEW `sadik-backend/app/services/billing_stripe.py` — lazy stripe import, `create_checkout_session`, `create_portal_session`, `handle_webhook_event` (idempotent webhook handler)
  - NEW `sadik-backend/app/routers/billing.py` — `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/billing/webhook` (raw body + signature verify)
  - NEW `sadik-app/src/api/billing.ts` — `getBillingStatus`, `createCheckout`, `openPortal` API client
  - MOD `sadik-app/src/pages/SettingsPage.tsx` — Abonelik section (feature flag: only rendered when `billing_enabled=true`)
  - **Eren TODO (Stripe aktivasyonu):**
    1. Stripe dashboard → Ürün oluştur → Aylık fiyat ekle → Price ID'yi kopyala → `.env`'e `STRIPE_PRICE_ID=price_...`
    2. `.env`'e `STRIPE_SECRET_KEY=sk_test_...` (test mode) ekle
    3. Webhook endpoint ekle: `https://<domain>/api/billing/webhook`
       - Lokal test: `stripe listen --forward-to localhost:8000/api/billing/webhook` → CLI signing secret'ı `STRIPE_WEBHOOK_SECRET` olarak ekle
    4. Backend'i restart et
    5. Settings'te `PUT /api/settings {"billing_enabled":"true"}` → Abonelik section görünür
    6. Test card: `4242 4242 4242 4242`, herhangi CVV/tarih

**Concurrency zone B (telemetry):**
- [x] **T7.4 tamam [session-B]** Crash telemetry endpoint + admin panel
  - NEW `sadik-backend/app/models/crash_report.py` — `crash_reports` tablosu
  - NEW `sadik-backend/app/services/telemetry_redactor.py` — file path/API key/email/env var redaction
  - NEW `sadik-backend/app/routers/telemetry.py` — `POST /api/telemetry/crash`, `GET/POST /api/settings/telemetry-consent`, `GET /api/admin/telemetry`, `POST /api/admin/telemetry/{kind}/{id}/resolve`
  - MOD `app/main.py` — `CrashReport` model import + `telemetry_router` register + `telemetry_consent`/`telemetry_consent_asked` DEFAULT_SETTINGS
  - NEW `sadik-app/src/api/telemetry.ts` — frontend API client
  - NEW `sadik-app/src/services/crashReporter.ts` — renderer window.error + unhandledrejection hooks
  - MOD `electron/main.js` — `process.on('uncaughtException'/'unhandledRejection')` + `ipcMain.handle('telemetry:crash')` + `_refreshTelemetryConsent` at startup
  - MOD `electron/preload.js` — `electronAPI.reportCrash` exposed
  - MOD `src/index.tsx` — `initCrashReporter()` called at startup
  - NEW `src/components/telemetry/TelemetryConsentBanner.tsx` — one-time first-launch banner
  - MOD `src/pages/SettingsPage.tsx` — "Gizlilik & Telemetri" section + toggle
  - NEW `src/pages/AdminTelemetryPage.tsx` — `/admin/telemetry` route, tabs, filter chips, table, detail drawer, resolve button
  - MOD `src/App.tsx` — `TelemetryConsentBanner` + `/admin/telemetry` route
- [x] **T7.5 tamam [session-B]** Beta feedback widget (commit c4b7ecd)
  - Shift+F → feedback modal → backend'e
  - Settings FAB + screenshot capture
- [x] **T7.6 tamam [session-B]** App branding (commit 4967665)
  - `BrowserWindow title: 'SADIK'` + `src/index.html <title>SADIK</title>` (zaten vardı)
  - `build/icon.png` (1024×1024, opaque) electron-builder'a entegre
  - `package.json`: `productName: "SADIK"`, `appId: "com.sadik.app"`, win+mac `icon: "build/icon.png"` ✓

**Exit criteria:** Usage tracking çalışır, crash raporu gönderilir, feedback modal çalışır.

---

### Sprint 8: Closed beta launch
**Amaç:** 3 arkadaşa + sonra 10-20 tester'a dağıt.

- [ ] **T8.1** Final regression pass (tüm kritik flow'lar)
- [ ] **T8.2** Installer test 3 temiz makinede
- [ ] **T8.3** İlk tester grubu (3 kişi, senin arkadaşlar)
- [ ] **T8.4** 1 hafta feedback topla
- [ ] **T8.5** Hotfix pass
- [ ] **T8.6** Genişletilmiş beta (10-20 tester)
- [ ] **T8.7** Telemetry analiz → pricing kararı için data

**Exit criteria:** 3 arkadaş 1 hafta kullanmış, crash report'lar analiz edilmiş, feedback listesi hotfix'e dönmüş.

**Not (2026-05-02):** Beta süresince **billing kapalı** (`billing_enabled=false`). T7.3 + T7.3b kod path'i devrede ama UI gizli. Pro tier gerekirse Eren manuel `PUT /api/settings {"user_tier":"pro"}` ile set eder. Sebep: mevcut Stripe akışı dev-only — webhook localhost'a ulaşamaz, secret key client'ta. Production billing T9.1 ile gelecek.

---

### Sprint 9 (post-beta): Hosted billing migration
**Amaç:** Production-grade billing — Stripe secret server'da, webhook public URL'de, kullanıcı hesap sistemi.

- [ ] **T9.1** Hosted billing backend
  - Domain (ör. `api.sadik.app`) + minimal FastAPI deploy (Railway/Fly.io ~$5/ay)
  - Stripe secret + webhook secret hosted backend'de durur, desktop app görmez
  - Kullanıcı hesabı: email-only magic link auth (Stripe Customer ↔ user_id eşlemesi)
  - Mevcut `app/services/billing_stripe.py` + `app/routers/billing.py` mantığı hosted tarafa taşınır
  - Desktop app → hosted backend (`api.sadik.app/checkout`, `/status`, `/portal`) → Stripe
  - `billing_enabled=true` ancak T9.1 prod'a çıkınca

**Exit criteria:** Yeni kullanıcı email ile kayıt → checkout → ödeme → desktop app'inde tier=pro otomatik aktif. Stripe secret hiçbir client'ta yok.

---

## Color Sprint-4: ESP32-S3 N16R8 donanım geçişi

**Durum:** WIP — donanım siparişte, firmware S3-ready hale getiriliyor. WROOM-32 build path korunuyor (paralel env).

Hazırlık (donanım gelmeden):
- [x] PlatformIO `[env:esp32-s3-n16r8]` env eklendi (USB-CDC, PSRAM-OPI, 16MB flash)
- [x] `partitions_s3_n16r8.csv` eklendi (6MB app + 10MB FAT, ileride embedded codec clip için)
- [x] `ledcSetup`/`ledcAttachPin`/`ledcWrite` Arduino core 3.x shim'i (S3 default toolchain)
- [x] SPI bus / DMA varsayım yorumları (kod davranışı değişmedi)
- [x] BETA_ROADMAP entry

Donanım gelince (TODO):
- [ ] S3 board pinout doğrulama + gerekirse `config.h` pin düzenleme
- [ ] İlk boot + TFT init smoke test (boot splash görünmeli)
- [ ] USB-CDC üzerinden APP_CONNECTED handshake
- [ ] Codec stream throughput ölçümü (hedef: 40KB IFRAME ~40-60ms, clip switch <500ms)
- [ ] Backend `serial_service.py` keyword scoring — S3 USB VID/PID için bias (gerekirse)
- [ ] `CODEC_STALL_MS` fine-tune (USB CDC latency profile farklı olabilir)

Opsiyonel optimizasyonlar (Sprint-5):
- [ ] Framebuffer'ı PSRAM'e taşı (`heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`)
- [ ] Tüm codec clip set'i FAT partition'a embed → host streaming bypass; `PLAY_CLIP:name` flash'tan okur
- [ ] Double-buffering / dual-task render

---

## Color Sprint-5: standalone stability (donanım öncesi)

**Durum:** Wave-1 ✅ — Wave-2 partial ✅ (foundation + TFT mutex landed); task body wiring donanım sonrasına ertelendi.

**Amaç:** S3 elinize gelmeden firmware'i sorunsuz/stabil hale getirmek. Donanım gelince smoke-test → onay → ana projeye merge.

Wave-1 (tamamlandı 2026-04-26):
- [x] LittleFS local clip playback path: `PLAY_LOCAL:<name>` opcode → LittleFS'ten okunur → mevcut codec_feed pipeline'a pump edilir (yeni decoder yok). Host streaming pipeline (appConnected) hiç dokunulmadı.
- [x] `LocalClipPlayer` modülü (`local_clip_player.h`): mount-on-boot (non-fatal fail), 4 KB read buffer, MODE_LOCAL_CLIP state machine entegrasyonu, STATUS + sleep-guard support.
- [x] LittleFS partition: `partitions_s3_n16r8.csv` subtype `ffat/fat` → `spiffs/spiffs` (Arduino LittleFS slot). `board_build.filesystem = littlefs` eklendi.
- [x] Tooling: `tools/build-clip-image.mjs` (Node 18+ ESM) → `assets/codec/*.bin` + master manifest → `sadik-firmware/data/clips/` + `data/manifest.json`. Workflow: `node sadik_color/tools/build-clip-image.mjs` → `pio run -e esp32-s3-n16r8 -t uploadfs`.
- [x] `psram_alloc.h` helper: PSRAM-aware allocator (S3 PSRAM, WROOM internal fallback). DMA buffer'lara DOKUNMAZ.

Wave-2 (kısmen tamamlandı 2026-04-26):
- [x] **W2A foundation**: `rtos_tasks.h/.cpp` — `tftMutex`, `byteQueue` (depth 8, ByteChunk[256]), `eventQueue` (depth 16, RtosEvent), `g_abortRequested` flag. `xTaskCreatePinnedToCore` UartTask (core 0, prio 2, 4 KB) + CodecTask (core 1, prio 3, 6 KB) — body stub. `rtos_init()` setup() sonunda çağrılıyor. `build_src_filter` her iki env'de güncellendi.
- [x] **W2B display_manager TFT mutex**: `TftLock` RAII helper (`if (tftMutex) xSemaphoreTake/Give` — early-boot mutex=null guard'lı). begin/sendBuffer/sleepDisplay/wakeDisplay/drawText (4 variant)/pushFrameRgb565 sarmalandı. setBrightness ledc-only, dokunulmadı.
- [x] **W2C codec_decode TFT mutex**: `_apply_iframe` ve `_apply_pframe` içinde `TftLock` (anonim namespace). PFRAME tek lock per-frame (per-tile değil), atomicity korunur.
- [x] **W2-fix local clip pacing**: codec_frames_applied() counter + 24fps gate + 256B chunk → fast-playback/last-frame-stuck/tearing fixed.
- [x] **W2-fix burst-stall frame intervals**: buffer 256B→4KB + millis()-deadline gating (per-frame slot, mid-packet feed unrestricted, clamp on stall) → uniform ~41ms/frame hedefi.
- [x] **W2-fix LOCAL_CLIP→idle artifact**: clearScreen() on done; codec full-frame residue → cleared.
- [ ] **W2D task body wiring** (ertelendi → donanım sonrası): UartTask serial drain + ASCII parse + byte producer; CodecTask byteQueue/file dual-source consumer + frame ready event; LocalClipPlayer ownership transfer; main loop event-consumer'a indirgeme. **Sebep**: serial-stream timing, SPI thread starvation, queue overflow donanımsız doğrulanamaz; smoke-test öncesi land etmek regression riski yüksek.
- [ ] (opsiyonel) `CODEC_STALL_MS` ve sliding window pacing review — task split sonrası latency profili değişir.

Kapsam dışı (donanım sonrasına ertelendi):
- `_fb_storage` PSRAM migration: S3'te DMA-from-PSRAM OPI behaviour donanım test gerektirir; psram_alloc helper additive olarak eklendi, future buffer'lar PSRAM kullanır ama framebuffer iç SRAM'de kalır.

Donanım gelince (Sprint-4 checklist'i aynen geçerli):
- Boot + TFT smoke test → USB-CDC handshake → `node tools/build-clip-image.mjs` → `pio run -e esp32-s3-n16r8 -t uploadfs` → `PLAY_LOCAL:wakeword\n` ile local playback validation → throughput ölçümü → `CODEC_STALL_MS` fine-tune.

Bu sprint geçince: **Color Sprint-6** (legacy söküm) → **Multi-device Sprint-1..3** (ortak app) → **RGB LED Sprint**.

---

## Color Sprint-6: legacy clip mimarisi sökümü (color firmware tek render path)

**Durum:** Wave-1 ✅ DONE — Wave-2 ✅ DONE (2026-04-27).

**Amaç:** Color firmware'inde iki paralel render path'i (legacy 1-bit `ClipPlayer` 128×64 sub-region + codec full 160×128 RGB565) tek path'e indirgemek. Tüm clip'ler LittleFS'ten codec format ile oynar; idle/blink/variation timing in-firmware `AnimationEngine`'ine devredilir. Backend bağlıyken tek otorite app, değilken tek otorite firmware.

**Why:** Çift path bug yüzeyini büyütüyor (LOCAL_CLIP→idle artifact bug'ı buradan çıktı). Color iki render mimarisini sürdürmenin uzun vadeli maliyeti yok — color sadece codec format kullanmalı. Flash + RAM kazancı bonus.

**Wave-1 — yeni AnimationEngine, legacy yan yana** ✅ DONE (2026-04-27)
- [x] `animation_engine.h` modülü (color firmware): `AE_IDLE/AE_PLAYING_ONESHOT/AE_PLAYING_BLINK/AE_PLAYING_VARIATION/AE_STOPPED` state machine. LocalClipPlayer altında kullanır. `idle_orchestrator` mantığı port edilir; blink 12-30s, variation 5-8dk (orijinal config.h değerleri korundu). Variation: `idle_alt_left_look`, `idle_alt_look_down`, `idle_alt_right_look` (manifest isimlerinden).
- [x] main.cpp'de compile-time flag (`USE_NEW_ANIMATION_ENGINE=1 default`) — `#if` guard'ları ile A/B test edilebilir; legacy path tamamen korundu.
- [x] Smoke test (görsel): donanım upload sonrası ekranda doğru renkli idle + blink doğrulandı (2026-04-27). ⚠️ Serial log spam tespit edildi (CODEC:STALL_RESET döngüsü + binary garbage) — W2 kapsamında çözülecek.

**Wave-2 — legacy söküm + log spam fix** ✅ DONE (2026-04-27)
- [x] Legacy `ClipPlayer`, `IdleOrchestrator`, `clip_player.h`, `clip_registry.h`, `idle_orchestrator.h`, `include/clips/` (PROGMEM mono frame'ler) silindi. `USE_NEW_ANIMATION_ENGINE` flag kaldırıldı.
- [x] DisplayManager 1-bit framebuffer (`_fb`, `drawFrame`, `sendBuffer` 16KB `_rgbFrame`, `_fbDirty`) silindi. TextRenderer için `clear()/sendBuffer()` no-op stub korundu.
- [x] UART byte streaming korundu (appConnected). Standalone modda `animationEngine.begin()/resume()/_returnToIdle()` `codec_set_ack_enabled(false)` çağırıyor; `APP_CONNECTED` handler `true` restore ediyor.
- [x] **Log spam fix**: Kök neden: `_emit_ack()` binary ACK paketleri (`\x03 + LE counter + 3 byte = 8 byte`) idle.bin frame'lerinden sonra basılıyordu. Fix: AnimationEngine tüm idle geçişlerinde `codec_set_ack_enabled(false)` çağırıyor. STALL_RESET fix: pacing yalnızca `codec_is_idle()` true iken rate-limit yapıyor (mid-packet byte starvation önlendi).
- [x] Manifest publish: boot'ta `MANIFEST:blink,idle,...` (21 clip) Serial'e basılıyor; LittleFS manifest.json parse, fallback static liste.
- [x] Flash: 393 KB → 337 KB (-56 KB); RAM: 120 KB → 103 KB (-17 KB)

**Bu sprint geçince color tek başına stable, tek render path. Sonra Multi-device.**

---

## Multi-device Sprint-1: handshake protokolü + DeviceProfile (app)

**Durum:** ✅ DONE (2026-04-27) — post-ship bug fixes: ✅ DONE (2026-04-27)

- [x] Color firmware boot'ta publish: `DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.6.0 caps=local_clips`
- [x] Mini firmware'e aynı satır: `DEVICE:variant=mini hw=esp32-wroom32 display=128x64_mono fw=2.0.0 caps=raw_frame_stream,progmem_clips` (backwards-compatible — eski app ignore eder)
- [x] App connection handshake: backend `serial_service.py` DEVICE: satırını handshake penceresinde yakalar; `device_profile` WS eventi yayar. App 3s içinde event gelmezse `variant=mini` fallback uygular.
- [x] App'te `DeviceProfile` katmanı (TS types `sadik-app/src/types/device.ts`): `{ variant, display, capabilities, fwVersion, hw }`. Connection drop'ta null'lanır. `parseDeviceLine()` parser + `FALLBACK_DEVICE_PROFILE` sabiti.
- [x] **Dashboard preview RGB badge**: `variant === 'color'` iken `OledPreview` sağ üst köşede şeffaf çerçeve + R→G→B lineer gradient text "RGB".
- [x] **Bug fix — mini frame stream regression** (`fix(backend): mini frame stream regression — handshake reader kept blocking writer`): `send_and_read` artık `DEVICE:` ve `MANIFEST:` satırlarını `DEBUG:`/`EVENT:` gibi skip ediyor (mid-session firmware reset'te 250ms frame timeout'u yemesin). `open()` metoduna 0.2s settle + `reset_input_buffer()` eklendi (boot-time buffer noise frame writer'a sızmıyor). `_try_open_and_verify_sync` PING verify + DEVICE? query iki ayrı aşama olarak yeniden yazıldı.
- [x] **Bug fix — DEVICE? query for deterministic detection** (`feat(handshake): DEVICE? query for deterministic device detection`): Backend port açtıktan ~200ms sonra `DEVICE?\n` gönderir, firmware DEVICE: satırını re-emit eder. Hem mini hem color `serial_commander.h`'a `CMD_DEVICE_QUERY` + `processCommand` handler eklendi. `open()` (manual connect) da aynı query akışını kullanır → device_profile WS broadcast her iki connect path'te çalışır.
- [x] **Bug 3 fix — USB disconnect detection** (`fix(backend+app): USB disconnect detection [session-A]`): Backend `main.py`'a `_usb_disconnect_monitor` background task eklendi (2s poll; `in_waiting` probe ile `SerialException`/`OSError` yakalar; `device_status` + `device_profile` WS broadcast). App zaten `device_status.connected=false` → `connectedDevice=null` path'ini işliyordu.
- [x] **Bug 4 fix — Color variant frame/clip routing** (`feat(routing): variant-based frame/clip dispatch (color uses LittleFS clips) [session-A]`): `useAnimationEngine.ts` `deviceVariant` param eklendi. Color modunda: (1) frame pump skip, (2) `APP_CONNECTED` gönderilmez (color firmware ASCII cmd path için gerekli), (3) engine state change'de `PLAY_LOCAL:<colorClipName>` gönderilir. `COLOR_CLIP_MAP` mini→color isim çevirisi. `OledPreview.tsx` color modunda 160×128 RGB simüle panel + aktif clip adı gösterir. `AppContext.tsx` `deviceVariant` state (connectedDevice'dan sync) `useAnimationEngine`'e pass edilir.
- [x] **Bug 5 fix — APP_CONNECTED race (color cihaza gidiyordu)** (`fix(multi-device): APP_CONNECTED variant guard + PLAY_LOCAL logging + disconnect crash [session-A]`): Kök neden: `useAnimationEngine` `APP_CONNECTED` effect'i `deviceConnected=true` olduğunda `deviceVariant` henüz `'mini'` default'ta (handshake WS mesajı gelmedi, `connectedDevice` null). `AppContext`'te `connectedDevice` set edildiğinde (`variant` confirmed) `APP_CONNECTED` mini'ye gönderilir. `useAnimationEngine`'den kaldırıldı.
- [x] **Bug 6 fix — PLAY_LOCAL log eksikti** (`fix(multi-device): APP_CONNECTED variant guard + PLAY_LOCAL logging + disconnect crash [session-A]`): `device.py` `/api/device/command` router'ına `logger.info(f"Device command: {body.command}")` eklendi. Frontend `useAnimationEngine` PLAY_LOCAL dispatch path'i doğrulandı — `onStateChange` callback'te `deviceVariant='color'` ve `deviceConnected=true` ise `PLAY_LOCAL:<clip>` gönderiliyor (mevcut kod doğru, log eksikti).
- [x] **Bug 7 fix — Disconnect monitor crash** (`fix(multi-device): APP_CONNECTED variant guard + PLAY_LOCAL logging + disconnect crash [session-A]`): `serial_service.py` `_exchange()` inner function'da `TypeError`/`AttributeError` da yakalanıyor (Windows pyserial `byref()` NULL handle hatası). Null/closed guard her readline öncesi. Hata sonrası `self._serial=None` cleanup garantilendi. `main.py` disconnect monitor `_probe()` exception listesine `TypeError, AttributeError` eklendi.
- [x] **Bug 8 fix — APP_CONNECTED hard guard + serial write backoff** (`fix(multi-device): hard guard APP_CONNECTED + serial write backoff [session-A]`): Kök neden: `AppContext` useEffect'te `connectedDevice?.variant ?? 'mini'` fallback, `connectedDevice` null iken (handshake henüz gelmedi) `variant='mini'` sanılıp `APP_CONNECTED` gönderiliyordu. Fix: `?? null` ile pozitif guard — sadece `variant === 'mini'` ise gönder. Backend `device.py` router'da defansif guard: `APP_CONNECTED` + `last_device_line` içinde `variant=color` → BLOCK + WARNING. `serial_service.py` `send()` metoduna write backoff eklendi: her hata sonrası 500ms bekleme, 5 ardışık fail → port kapat + auto-reconnect path'e bırak. `send_and_read` `_exchange()` iç write'ına `PermissionError` (WinError 13) yakalama + port cleanup eklendi.
- [x] **Bug 9-11 fix — variant gating + reconnect guard** (`fix(backend/app): variant race + reconnect guard [session-A]`): (1) Backend `device.py` `APP_CONNECTED` guard genişletildi: `last_device_line` null/boş iken BLOCK, `variant=mini` olmayan her satır BLOCK — reconnect DEVICE? window'unda geçici null kabul edilmez. (2) `AppContext.tsx` handshake fallback timer (`FALLBACK_DEVICE_PROFILE/mini`) kaldırıldı — backend zaten her connect/reconnect'te DEVICE? yapıyor, 3 s timeout mini race yaratıyordu. `connectedDevice` null iken APP_CONNECTED hiç gönderilmez. (3) `useAnimationEngine.ts` frame pump pozitif guard'a geçirildi: `deviceVariantRef.current !== 'color'` → `!== 'mini'` — variant confirmed 'mini' olmadığı sürece (null/unknown/color) frame streaming başlamaz.
- [x] **Bug 10 fix — variant default null (frame pump race)**: `AppContext` `deviceVariant` state default'u `'mini'` → `null`; `setDeviceVariant(variant ?? 'mini')` → `setDeviceVariant(variant)`; `useAnimationEngine` param type `'mini'|'color'|null`. Pump guard `!== 'mini'` zaten `null`'ı blokluyor — device_profile WS gelmeden pump başlamıyor.
- ⚠️ **LittleFS upload gerekli**: `sadik_color/sadik-firmware/data/clips/*.bin` + `manifest.json` cihaza yüklenmeli. Komut: `pio run -e esp32-s3-n16r8 -t uploadfs` (sadik_color/sadik-firmware dizininde).

---

## Multi-device Sprint-2: AnimationEngine adapter pattern (app)

**Durum:** WIP — variant-based serial dispatch ✅ (2026-04-28): variant-based serial dispatch — color codec_feed kapalı, PLAY_LOCAL ASCII parse ediliyor; `mod_gaming_text` + `mod_meeting_text` COLOR_CLIP_MAP'e eklendi.

- [ ] App'te `AnimationEngine` interface'i: `onEvent(event)`, `onIdle()`, `destroy()`.
- [ ] `MiniAnimationEngine` — mevcut SADIK_mini animation kodu bu sınıfa kapsüllensin.
- [ ] `ColorAnimationEngine` — yeni, sadece `PLAY_LOCAL:<name>` ASCII komutu yollar; firmware kendi AnimationEngine'iyle (Color Sprint-6 W1) idle/blink yönetir.
- [ ] Connection açıldığında `deviceProfile.variant`'a göre doğru engine instantiate edilir.
- [ ] Backend variant-aware OLMASIN — semantik event üretsin, app çevirsin.
- [x] **Color clip dedupe + min-gap** (`fix(app): color clip dedupe + min-gap to prevent TFT flash [session-A]`): `useAnimationEngine.ts` — aynı clip tekrar gönderilmez (`lastColorClipSentRef`); farklı clip gönderildikten sonra 700ms içinde yeni clip gelirse `pendingColorClipRef`'e yazılır, timer dolunca son istek gönderilir; `wakeword` force-bypass ile min-gap'i atlar. Mini variant'a dokunulmadı.
- [x] **Manifest-driven clip gap** (`fix(app): manifest-driven clip gap + clip name reconciliation [session-A]`): `useAnimationEngine.ts` sabit 700ms gap → clip-spesifik duration'a geçirildi. `sadik-app/src/assets/colorClipManifest.ts` oluşturuldu: her LittleFS clip için .bin packet parse'dan türetilen gerçek frame count / 24fps = duration_ms map. `getClipGapMs(lastClip)` helper — gönderilen önceki clip'in gerçek süresi kadar bekler, bilinmiyorsa 1500ms fallback. Force-interrupt (wakeword) davranışı korundu. `mode_meeting` intro clip'i manifest + LittleFS'te yok — sadece `mode_meeting_text` mevcut; asset üretimi Eren kararına bırakıldı.
- [x] **Firmware: loop clip fix + playback debug logs** (`fix(color-firmware): loop clips played with loop=false via playEvent — mode_working_text/gaming_text/meeting_text never looped [session-A]`): `AnimationEngine::playEvent()` loop param eklendi; `CMD_PLAY_LOCAL` handler'ında LOOP_CLIPS[] lookup ile `loop=true` geçiliyor. `LocalClipPlayer::update()` her 10 frame'de `[clip] progress name=X frames=Y elapsed_ms=Z` log'u, done'da `[clip] done ...` log'u. `[clip] PLAY_LOCAL name=X loop=Y ae_state=Z` dispatch log'u. Build: SUCCESS 337KB flash.

---

## Multi-device Sprint-3: dashboard preview adapter + asset pipeline

**Durum:** WIP başlamadı.

- [ ] Dashboard preview component'ı `MiniPreview` (128×64 mono canvas) ve `ColorPreview` (160×128 RGB canvas) olarak ikiye bölünsün.
- [ ] `app/assets/devices/mini/...` ve `app/assets/devices/color/...` ayrı asset klasörleri.
- [ ] Asset build pipeline: tek source animasyondan iki target üretme (mono PROGMEM + color codec bin). Manuel adım kabul.
- [ ] CI: iki firmware build (mini + color), app tarafında mock-profile ile iki UI render testi.

---

## RGB LED Sprint (Color-only, Multi-device sonrası)

**Durum:** WIP başlamadı.

**Donanım:** ESP32-S3-DevKitC-1 N16R8 onboard WS2812 (muhtemel GPIO 48 — sprint başında doğrula).

**Firmware (color):**
- [ ] `Adafruit_NeoPixel` lib_deps eklensin.
- [ ] `rgb_led.h`: `setOff()` / `setStatic(r,g,b)` / `setEventColor(name)` / `update()` (fade ~150ms).
- [ ] State: `LED_MODE_OFF` / `LED_MODE_STATIC` / `LED_MODE_DYNAMIC`.
- [ ] ASCII komutlar: `LED:OFF`, `LED:STATIC:RRGGBB`, `LED:DYNAMIC`, `LED:EVENT:<name>`.
- [ ] NVS persist: ilk turda atla — app her bağlantıda yeniden gönderir.

**App (settings, color-only):**
- [ ] Settings → Personalization → **RGB LED** kartı, `variant === 'color'` guard'lı.
- [ ] Üç seçenek: Kapalı / Sabit (color picker) / Dinamik.
- [ ] Dinamik: preset mod kart renkleriyle hardcoded eşleştirme; custom mod seçilen renge göre. Edit ettirme YOK (sonraki iterasyon).
- [ ] App event geçişlerinde `LED:EVENT:<name>` yollar.

---

## 6. Concurrency zones (iki hesap paralel çalışma)

Her sprint içinde **zone A** ve **zone B** ayrıldı. Aynı anda iki hesap:
- Hesap 1 → zone A task'ı al
- Hesap 2 → zone B task'ı al

**Dosya çakışması risk matrix:**

| Sık çakışan dosya | Yalnız bir hesap aynı anda dokunsun |
|---|---|
| `sadik-app/src/context/AppContext.tsx` | Evet — büyük, merge conflict kolay |
| `sadik-app/src/pages/SettingsPage.tsx` | Evet |
| `sadik-backend/app/main.py` | Evet |
| `sadik-backend/app/services/voice_service.py` + `chat_service.py` | Evet |
| `CHECKPOINT.md` + `BETA_ROADMAP.md` | Evet |
| Yeni dosyalar (provider, page, router) | Hayır — yeni file çakışmaz |

**Workflow:**
1. Session başında `git pull`
2. Task aldığında bu dokümanda o task'ın yanına `[WIP: session-A start HH:MM]` yaz, commit+push (kısa "wip marker" commit'i)
3. Task bitince `[DONE: session-A HH:MM]`, kodu commit+push
4. Session değiştirirken bu doküman üzerinden kontrol et, diğer session nerede kalmış

---

## 7. Kritik mimari kararlar (zero-context için kilit)

1. **Local-first korunur**: Ham veri asla cloud'a gitmez. Sadece opt-in summary + anlık query.
2. **LLM provider kilitsiz**: Beta'da maliyet verisi toplanacak, sonra karar.
3. **Voice tool-use**: Task CREATE yok (hallucination riski). Sadece read + delete + state change.
4. **Subscription shadow mode**: Hard paywall beta'da yok. Data toplandıktan sonra.
5. **TR-only**: İlk beta Türkçe. i18n altyapısı kurulmayacak (gereksiz iş).
6. **Backend embedded (öneri)**: PyInstaller ile tek binary, user friction sıfır. Sonnet'e delege edildiğinde bunu net brief'le.
7. **ESP32 WiFi şimdilik yok**: Serial yeter (bkz `memory/project_wifi_transport_deferred.md`).
8. **Color 24fps gating**: vTaskDelay/double-buffer yaklaşımları revert edildi (ce7cfd2, 1ec14f7, c8378f6, 4464053). CRC-fail kaskadı fix: `codec_frames_attempted()` sayacı ile deadline CRC fail durumunda da ilerler — async/double-buffer refactor gerekmeden tek-buffer path korundu (session-B). ✅ DONE

---

## 8. Subagent prompt şablonu (copy-paste)

İki hesapta da aynı kural: Opus planlar, **Sonnet 4.6 subagent** implement eder. Her delege şöyle olsun:

```
SADIK v2: C:\Users\eren_\OneDrive\Masaüstü\sadik_v2
Electron+React frontend (sadik-app/), FastAPI async backend (sadik-backend/).

TASK: [Sprint X - TX.Y] <task özeti>

ÖNCE OKU:
- BETA_ROADMAP.md (bu doküman, özellikle Sprint X bölümü)
- memory/MEMORY.md + referans dosyalar
- CHECKPOINT.md (varsa ilgili bölüm)
- <ilgili source dosyaları>

YAP:
1. Discovery: mevcut durum, gap analizi (kısa)
2. Implementation: minimum değişiklik, maximum kesinlik
3. Logical test: kodu okuyarak doğrula
4. Rapor (≤500 kelime): kök neden (varsa), değişiklikler file:line, test adımları

YAPMA:
- Dokümantasyon dosyası yazma (README, MD)
- Gereksiz refactor
- Spec dışı feature
- Karar isteme — kararlar BETA_ROADMAP.md'de

EXIT CRITERIA: <sprint exit criteria'sından ilgili kısım>
```

---

## 9. Memory referansları

`C:\Users\eren_\.claude\projects\C--Users-eren--OneDrive-Masa-st--sadik-v2\memory\`:
- `MEMORY.md` — index
- `feedback_workflow.md` — Opus karar, Sonnet aksiyon
- `feedback_autonomy.md` — delege edince step-by-step sormadan tamamla
- `user_role.md` — Eren profili
- `project_oauth_ship_refactor.md` — Sprint 6 T6.1 için
- `project_wifi_transport_deferred.md` — kararsız bir şey sorulursa

---

## 10. Değişiklik kuralı

**Bu dokümanı güncelleme zamanı:**
- Sprint task'ı tamamlandığında `[ ]` → `[x]` yap + `# 4. Şu an neredeyiz` bölümünü güncelle
- Yeni kritik karar alınırsa `# 7. Kritik mimari kararlar`a ekle
- Kilit değişirse `# 6. Concurrency zones`u güncelle
- Vizyon veya scope değişirse `# 2. Vizyon`u güncelle

**Her önemli değişiklikte commit:**
```
docs: BETA_ROADMAP update — <ne değişti>
```

Sonra push. Diğer session pull'da görür.

---

**Şu andan itibaren aktif: Sprint 1 — T1.1 ile başla.**

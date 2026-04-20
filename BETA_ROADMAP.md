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
- Faz 0.5 OAuth refactor (Desktop+PKCE) ship-blocker

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
- **Sprint 2.7 tamamlandı ✅ — 3-tier privacy preset (Full/Hybrid/Local) + advanced override — sıradaki: Sprint 3 (behavioral learning)**

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
- [ ] **T3.3** Behavioral insight proactive category
  - Mevcut proactive sistemin üstüne yeni kategori
  - Logic: beklenen mode aktif değil + yetişecek task var + düşük usage → öneri

**Concurrency zone B (frontend):**
- [x] **T3.4 tamam [session-B]** Dashboard'da "Profil" kartı (opt-in toggle açıksa) ✅
  - Yeni: `sadik-app/src/components/dashboard/WeeklyProfileCard.tsx` — 7×24 heatmap + hover tooltip + legend + summary_tr
  - Privacy gate: `privacy_behavioral_learning !== 'true'` iken kart hiç render olmuyor
  - Veri yoksa: "Henüz yeterli veri yok" placeholder
  - DashboardPage.tsx ActivityChart üstüne wire edildi
- [ ] **T3.5** Proactive suggestion'da "workspace öner" aksiyonu
  - Accept → ilgili workspace başlar

**Exit criteria:** 14 gün simulated usage data ile pattern job çalışır, anlamlı summary üretir, LLM responseda yansır.

---

### Sprint 4: Integrations tamamlama
**Amaç:** Notion + meeting detect.

**Concurrency zone A (backend):**
- [ ] **T4.1** Notion provider (Faz 3)
  - Google Calendar pattern'inin birebir üstüne
  - `providers/notion.py` — OAuth, database select, page → task sync
  - Sync job (her 5 dk)
- [ ] **T4.2** Zoom Presence API (Faz 2 başlangıç)
  - `providers/zoom.py` — OAuth + `/users/me/presence` polling (60s)
  - `In_Meeting` state → proactive meeting mode suggestion

**Concurrency zone B (frontend):**
- [ ] **T4.3** Settings → Entegrasyonlar Notion + Zoom card'ları
- [ ] **T4.4** Meeting detect handler — Zoom `In_Meeting` → mode switch önerisi (toast)

**Exit criteria:** Notion task sync çalışır, Zoom meeting başlayınca "Meeting moduna geç?" toast görünür.

---

### Sprint 5: Persona genişletme + onboarding + jargon
**Amaç:** Herkese hitap.

**Concurrency zone A (content):**
- [ ] **T5.1** Mode preset kataloğu genişletme
  - Yeni default modes: "Yazarlık" (text-heavy, sessiz), "Öğrenme" (ders alma), "Tasarım" (figma/photoshop), "Okuma", "Oyun"
  - Her mod: icon, renk, DND default, proactive davranış
- [ ] **T5.2** Jargon temizliği (global find+replace review)
  - "Pomodoro" kalsın ama alt başlık "Odaklanma seansı"
  - Developer-specific stringleri revize
  - Sonnet'e delege: tüm user-facing TR stringleri tara, raporla

**Concurrency zone B (onboarding):**
- [ ] **T5.3** İlk açılış onboarding flow
  - 4 adım: welcome → persona seçimi (yazar/öğrenci/tasarımcı/geliştirici/diğer) → consent → device pair
  - Persona seçimine göre default mod presetleri yükle
- [ ] **T5.4** Empty state'ler + ilk-gün tutorial

**Exit criteria:** Fresh install → onboarding akışı tamam → kullanıcı ilk task'ını voice ile sorabiliyor.

---

### Sprint 6: Ship altyapısı
**Amaç:** Imzalı, auto-updating, dağıtılabilir binary.

**Concurrency zone A (OAuth refactor - ship-blocker):**
- [ ] **T6.1** OAuth Desktop+PKCE refactor (Faz 0.5)
  - `memory/project_oauth_ship_refactor.md` oku, uygula
  - `providers/google_calendar.py` + Zoom + Notion PKCE'ye geçir
  - Kullanıcı OAuth client create etmek zorunda kalmasın

**Concurrency zone B (build + release):**
- [ ] **T6.2** electron-builder config
  - `package.json` → `build.appId: "com.sadik.app"`, macOS entitlements (mic, notifications, accessibility), Windows signing
  - Code signing cert (macOS Developer ID, Windows EV/OV)
  - Notarization pipeline
- [ ] **T6.3** Auto-update (electron-updater)
  - Publish target: GitHub Releases (private repo OK) veya S3
  - Frontend update notification UI
- [ ] **T6.4** Basit landing page (markdown'dan statik)
  - Download links, changelog, support email
- [ ] **T6.5** Backend dağıtım stratejisi
  - Option A: Python backend embedded (PyInstaller) — kolay dağıtım, tek binary
  - Option B: Python backend local process (user install etsin) — esnek ama setup zor
  - **Karar gerekli** — Opus A'yı öneriyor (user friction sıfır)

**Exit criteria:** Temiz Windows + macOS makinede `.exe` / `.dmg` çift tıkla → app çalışır.

---

### Sprint 7: Subscription shadow + telemetry
**Amaç:** Shadow olarak Pro altyapısı hazır, hard-gate yok.

**Concurrency zone A (backend):**
- [ ] **T7.1** User tier model (Free/Pro)
  - Settings: `user_tier` (default free), `pro_expires_at`
  - Her AI call backend'de tier check → free limit'te throttle/mesaj, hard-block YOK (beta için)
- [ ] **T7.2** Usage tracking (beta data collection)
  - Voice turn count, LLM token count, tool call count
  - `/api/usage/me` endpoint — analiz için
- [ ] **T7.3** Paddle sandbox entegrasyonu (shadow)
  - Checkout flow hazır ama buton gizli (feature flag)
  - Webhook: `subscription.created` → `user_tier=pro`

**Concurrency zone B (telemetry):**
- [ ] **T7.4** Crash telemetry endpoint (self-hosted, opt-in consent)
  - `POST /api/telemetry/crash` — stack trace + redacted context
  - Electron uncaught handlers wire'lı
- [ ] **T7.5** Beta feedback widget (in-app)
  - Shift+F → feedback modal → backend'e + Discord webhook

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

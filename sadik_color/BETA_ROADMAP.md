# SADIK Color — Prototype Roadmap

> **Bu doküman**, SADIK ana projesinin (sadik-v2, monokrom OLED) **paralel** renkli ekran fork'udur. v2'den izole çalışır; ortak hiçbir dosya yok. v2 ana dizinde, color burada (`sadik_color/`) gelişir.

---

## 0. İlişki ve kapsam

- **Parent repo**: `C:\Users\eren_\OneDrive\Masaüstü\sadik_v2` (aynı git, color burada bir alt-tree olarak gelişir)
- **Donanım**: ESP32-WROOM-32 + 1.8" SPI TFT, ST7735S, 160×128 yatay
- **Asset formatı**: mp4/mov → host-side decode → RGB565 frame stream
- **Engine otoritesi**: app, v2 ile aynı mantık — ESP32 dummy terminal
- **v2 dokunulmaz**: bu prototip beklendiği gibi çalışmazsa v2 OLED ile beta'ya çıkılır

---

## 1. Üç fazlı plan

### Faz 1 — Hardware bring-up (mevcut .cpp'lerle) ✅ TAMAMLANDI

- [x] **F1.1** PlatformIO `platformio.ini` — Adafruit ST7735 + GFX eklendi, U8g2 kaldırıldı
- [x] **F1.2** `display_manager` — `Adafruit_ST7735(CS, DC, RST)` **hardware SPI (VSPI)** instance, pin map: CS=5, DC=4, RST=22, MOSI=23, SCK=18, BLK=GPIO 16 PWM
- [x] **F1.3** Monokrom → RGB565 shim — 128×64 framebuffer 160×128 ekrana (offset 16,32) ortalı; tek SPI transaction (startWrite/writePixels full-frame burst)
- [x] **F1.4** Tab varyantı `INITR_BLACKTAB` onaylandı; build flag ile override edilebilir
- [x] **F1.5** Boot → idle + blink + transitions doğrulandı, animasyonlar ekranın ortasında siyah-beyaz çalışıyor
- [x] **F1.5b** [extra] HW SPI 40 MHz — software SPI (138ms/frame) → hardware VSPI (4.2ms/frame, 33× hızlanma); tearing görünmez
- [x] **F1.5c** [extra] PWM backlight — GPIO 16, ledc ch 0, 5kHz/8-bit; siyah kalitesi iyileşti (default 100/255); sleepDisplay gerçek OFF
- [x] **F1.5d** [extra] Full-stack entegrasyon — backend + Electron app + ESP32 akışı doğrulandı
- [x] **F1.5e** [extra] Fresh-install bug fix — Task.notion_page_id + NotionSyncedPage.database_id duplicate Index (v2'de de mevcut, port gerekli)
- [DEFERRED → Faz 3] **F1.6** Baudrate stress test — sentetik test yerine Faz 3 codec implementation'da gerçek delta+RLE stream ile ölçülecek. Sadık firmware @ 460800 kesin çalışıyor (baseline). Hedef 921600-1.5M, gerçek testte kilitlenecek.

**Exit criteria karşılandı**: 17 klip yeni ekranda oynar, hardware+SPI+PWM doğrulandı.

### Faz 2 — Asset üretimi (Eren paralel) — AKTİF

- [x] **F2.1** Animator tarafı — mevcut klibin renkli mp4 versiyonları (22 klip `assets/mp4/`'de)
- [x] **F2.2** Naming convention `clips-manifest.json` ile uyumlu (Sprint-1 migration)
- [ ] **F2.3** Çözünürlük 160×128 native, FPS 24 hedef (wire budget hâlâ ~2 fps, Faz 3 codec ile çözülecek)

### Sprint-1 — mp4 pipeline bring-up ✅ (commit 618f47f, 2026-04-23)
- [x] App-side mp4 decode (HTMLVideoElement + OffscreenCanvas → RGB565 LE 40960B/frame)
- [x] Manifest .json → mp4 source migration (21 clip); yeni: `done`, `mood_gaming`, `mood_gaming_text`
- [x] Mode map: `gaming` preset eklendi; `mod_*` → `mood_*` rename
- [x] Event: `confirmation_done` + task→done drag-drop trigger
- [x] Wire protocol: `/api/device/frame` binary body (40960B); FRAME: binary parser; baud 921600
- [x] Firmware: `pushFrameRgb565` full 160×128 writePixels (mono shim drop)
- [x] Preview: RGB565 decode, 160×128 canvas
- [ ] **HW test**: gerçek ekranda renk + endian + serial throughput doğrulama (Eren'de)
- [ ] Not: `mood_working.mp4` intro asset yok — geçici olarak `mood_working_text.mp4` intro olarak kullanılıyor; animator verince manifest'te değiştir

**Exit criteria**: Tüm hedef klipler `.mp4` formatında hazır, manifest'e mapping yapılmış.

### Sprint-1 stabilizasyon (2026-04-24)
- [x] Baud hardwire: backend `main.py` + `routers/device.py` — 921600 sabitlendi, DB `serial_baudrate` ayarı yok sayılıyor (color firmware her zaman 921600)
- [x] Firmware stack-overflow fix: `serial_commander.h` — `ParsedCommand` içindeki 40960B alan stack'te kopyalanıyordu (ESP32 loop task 8KB), pointer-to-owned-buffer pattern'e geçildi; reset döngüsü kapandı
- [x] Preview buffer fix: `useAnimationEngine.ts` — buffer init 1024→40960B; preview güncellemesi ACK pump'tan ayrıldı, `onFrameReady` içine taşındı; serial düştüğünde preview donmuyor
- [x] Manifest fps: `clips-manifest.json` — 21 klip için `fps: 24` (kullanıcı 24fps'de üretmiş)
- [x] SADIK-text flash fix: `AnimationEngine.ts` + `types.ts` — engine `'black'` modunda başlıyor, sıfır-frame emit ediyor; `loadClips()` idle bekliyor, idle hazır olunca başlıyor, diğer klipler arka planda decode ediliyor
- [x] Auto-connect retry: `serial_service.py` + `device_manager.py` + `main.py` — startup 3× retry (2s aralık); outer timeout 10→20s; ESP32 boot gecikmesi karşılandı; manual connect unchanged (retries=1)
- [x] mp4 kaynak asset'ler `sadik_color/assets/` dizinine eklendi
- [ ] **Bilinen sorun (deferred)**: Tamam yazısı görünüyor; animasyon logic revisit sprint-2 sonrası yapılacak

### Faz 3 — Renkli streaming mimarisi (Faz 2 ile paralel tasarım)

- [x] **F3.1** Build-time: ffmpeg ile mp4 → RGB565 raw frames → delta+RLE sıkıştır → `.bin` paket — DONE (commit Sprint-2, roundtrip bit-exact, 29x compression on blink/idle)
- [x] **F3.2** Host streaming: `tools/codec/stream_to_device.py` standalone streamer — window-2 sliding ACK, 1500ms timeout/resend, SADIK:READY+APP_CONNECTED handshake, self-test CRC verify
- [x] **F3.3** ESP32 firmware: `codec_decode.h/.cpp` streaming state machine — IFRAME/PFRAME apply, partial tile blit, CRC fail→RESYNC, ACK emit; validated on hardware (idle.mp4 renders, 62/62 ACK, ~50 fps wire rate, exceeds 24 fps target). Fixes: static `_fb_storage`, SerialCommander guarded while `appConnected`, router drains all bytes to codec_feed.
- [ ] **F3.4** Flow control / backpressure — ACK veya pacing
- [ ] **F3.5** Baud rate ramp — 460800 → 921600 → 1.5M ramp test gerçek stream üstünde
- [x] **F3.6** Preview parity — React canvas aynı stream'i decode etsin (host-side decode servisi her ikisini besler)
  - [x] Step 1 — TS decoder (`sadik-app/src/codec/SadikDecoder.ts`) + Node round-trip test (`tools/codec/test_roundtrip_ts.mjs`): bit-exact 62-frame pass on idle.bin (29.88x compression)
  - [x] Step 2 — Build script (`tools/build-codec-assets.mjs`), `npm run build:codec` in sadik-app/package.json; manifest `codecSource` field added (additive, mp4 path kept); 15/21 clips encoded (6 mood_* skipped — mp4s renamed to mode_* in assets, manifest not yet updated)
  - [x] Step 2.5 — Manifest source paths fixed (mood_*.mp4 → mode_*.mp4); 6 remaining clips encoded; all 21 entries have codecSource; mood_* mp4s git-renamed to mode_*
  - [x] Step 3 — AnimationEngine codec preview path (flag-gated): `USE_CODEC_PREVIEW` in `src/engine/codecConfig.ts` (default true); `loadCodecClip()` fetches .bin, decodes via SadikDecoder, reinterprets Uint16Array→Uint8Array (same bytes); webpack CopyPlugin serves codec/*.bin under same base URL as mp4s; mp4 path preserved as fallback; device/backend path untouched
  - [x] Step 4 — Backend codec streamer + serial mutex: `SerialService` refactored to single port owner with `asyncio.Lock`; `send()` queues commands when stream is active (clip-end flush policy); `streamCodec(bin_path, loop)` sliding-window ACK streamer (ported from stream_to_device.py); `DeviceManager.play_clip/stop_clip` + clip registry (`assets/codec/<name>.bin`); HTTP endpoints `POST /api/device/play-clip` + `/stop-clip`; `USE_CODEC_DEVICE` flag in `codecConfig.ts` (default false); `useAnimationEngine` gates raw-frame pump on flag; old frame path preserved for Step 6 removal
  - [x] Step 4.5 — F3.6 bug fixes: (1) `USE_CODEC_DEVICE` flipped to `true` (was left false); (2) duplicate `onStateChange` listener bug fixed — codec+UI state merged into single handler so playClip dispatch is not overwritten; (3) `streamCodec` now sends `APP_CONNECTED\n` + waits for `OK:APP_CONNECTED` before streaming (matches stream_to_device.py handshake — firmware requires this to arm codec decoder)
  - [ ] Step 5 — Preview canvas wired to codec frames (already done via OledPreview frameBuffer; Step 3 completes this)
  - [ ] Step 6 — mp4 pipeline removal (after parity validated)
- [ ] **F3.7** Fallback: flash'a 1 idle klip preload — disconnect durumunda standalone yaşar
- [ ] **F3.8** Performance: 24fps sustained, frame drop telemetry

**Exit criteria**: Tüm renkli klipler 24fps'de akar, preview ile ESP32 senkron, baudrate budget içinde.

---

## 2. Bilinen kararlar (kilit)

| # | Karar | Gerekçe |
|---|---|---|
| 1 | Driver IC ST7735S | Kullanıcının elindeki modül |
| 2 | 160×128 yatay (landscape) | Kullanıcı tercihi |
| 3 | mp4/mov asset, host decode | Animator workflow kazanımı |
| 4 | Pure streaming, SD kart yok | Ek donanım maliyeti yok |
| 5 | Delta + RLE custom codec | 2 Mbps budget içinde 24fps fizibıl |
| 6 | ESP32-WROOM-32 (mevcut) | Hardware respin yok |
| 7 | Faz sıralama: hardware → asset → mimari | Risk aşamalı kapanır, paralel iş mümkün |
| 8 | Pin mapping: CS=5, DC=4, RST=22, MOSI=23, SCK=18, BLK=16 PWM | Boot-strap free |
| 9 | Hardware SPI 40 MHz | 3-arg Adafruit_ST7735 constructor (VSPI) |
| 10 | Default brightness 100/255 | Siyah kalitesi vs görünürlük balance |

---

## 3. Riskler

- **Baudrate locking**: 460800 teyitli, 921600-1.5M Faz 3'te doğrulanacak
- **`.env` credentials**: sadik_color/sadik-backend/.env v2'den kopyalandı. Color için ayrı OAuth karar gerekir
- **Fresh-install duplicate index bug**: v2'de de var (beta tester shipping blocker) — Sprint 8 öncesi v2'ye port
- **Beta gecikmesi**: Faz 2 süresi animator hızına bağlı. v2 fallback açık

---

## 4. Şu an neredeyiz

**Tarih**: 2026-04-22
**Durum**: **Faz 1 TAMAMLANDI ✅**. ST7735S hardware SPI 40 MHz, PWM backlight, 17 klip oynuyor, full-stack akış doğrulandı. **Sıradaki**: Faz 2 — Eren animator olarak mp4/mov renkli klipler üretmeye başlar. Opus paralel olarak Faz 3 codec tasarımına girebilir.

**Faz 3 önkoşulu**: Gerçek streaming testi ile baud rate kilitlenecek (460800 baseline, 921600-1.5M hedef).

---

## 5. Workflow

- Opus karar, Sonnet implement (v2 ile aynı kural)
- Commit prefix: `[color]`
- Color tarafındaki commit'ler v2 source'una hiç dokunmaz
- Bu doküman güncellemesi her faz tamamlanınca + her karar değiştiğinde

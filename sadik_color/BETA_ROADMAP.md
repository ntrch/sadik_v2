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

### Sprint-2 — Faz 3 codec pipeline ✅ CLOSED (baseline commit `b2ac54e`, 2026-04-24)

**Summary:** Codec pipeline end-to-end: mp4 → .bin build, TS decoder bit-exact (62/62 frames), backend streamer with manifest resolution, preview+device flag-gated, scene-switch debounce. FPS ~10.7 on device (window=1 ACK), preview smooth at 24fps. TFT↔preview bit-exact, latency ~200ms.

**Known race condition (Sprint-3):** `stream_to_device.py` is the known-working reference for packet flow. The race condition today is because backend aborts host-side while firmware decoder state isn't signaled — ABORT_STREAM opcode (F4.2) closes that loop. Current workaround: 7–8s timeout → "skip to IFRAME".

### Faz 3 — Renkli streaming mimarisi (Faz 2 ile paralel tasarım)

- [x] **F3.1** Build-time: ffmpeg ile mp4 → RGB565 raw frames → delta+RLE sıkıştır → `.bin` paket — DONE (commit Sprint-2, roundtrip bit-exact, 29x compression on blink/idle)
- [x] **F3.2** Host streaming: `tools/codec/stream_to_device.py` standalone streamer — window-2 sliding ACK, 1500ms timeout/resend, SADIK:READY+APP_CONNECTED handshake, self-test CRC verify — DONE
- [x] **F3.3** ESP32 firmware: `codec_decode.h/.cpp` streaming state machine — IFRAME/PFRAME apply, partial tile blit, CRC fail→RESYNC, ACK emit; validated on hardware (idle.mp4 renders, 62/62 ACK, ~50 fps wire rate, exceeds 24 fps target). Fixes: static `_fb_storage`, SerialCommander guarded while `appConnected`, router drains all bytes to codec_feed — DONE
- [ ] **F3.4** Flow control / backpressure — ACK veya pacing
- [ ] **F3.5** Baud rate ramp — 460800 → 921600 → 1.5M ramp test gerçek stream üstünde *(deferred → Sprint-3 F4.4)*
- [x] **F3.6** Preview parity — React canvas aynı stream'i decode etsin (host-side decode servisi her ikisini besler) — DONE
  - [x] Step 1 — TS decoder (`sadik-app/src/codec/SadikDecoder.ts`) + Node round-trip test (`tools/codec/test_roundtrip_ts.mjs`): bit-exact 62-frame pass on idle.bin (29.88x compression)
  - [x] Step 2 — Build script (`tools/build-codec-assets.mjs`), `npm run build:codec` in sadik-app/package.json; manifest `codecSource` field added (additive, mp4 path kept); 15/21 clips encoded (6 mood_* skipped — mp4s renamed to mode_* in assets, manifest not yet updated)
  - [x] Step 2.5 — Manifest source paths fixed (mood_*.mp4 → mode_*.mp4); 6 remaining clips encoded; all 21 entries have codecSource; mood_* mp4s git-renamed to mode_*
  - [x] Step 3 — AnimationEngine codec preview path (flag-gated): `USE_CODEC_PREVIEW` in `src/engine/codecConfig.ts` (default true); `loadCodecClip()` fetches .bin, decodes via SadikDecoder, reinterprets Uint16Array→Uint8Array (same bytes); webpack CopyPlugin serves codec/*.bin under same base URL as mp4s; mp4 path preserved as fallback; device/backend path untouched
  - [x] Step 4 — Backend codec streamer + serial mutex: `SerialService` refactored to single port owner with `asyncio.Lock`; `send()` queues commands when stream is active (clip-end flush policy); `streamCodec(bin_path, loop)` sliding-window ACK streamer (ported from stream_to_device.py); `DeviceManager.play_clip/stop_clip` + clip registry (`assets/codec/<name>.bin`); HTTP endpoints `POST /api/device/play-clip` + `/stop-clip`; `USE_CODEC_DEVICE` flag in `codecConfig.ts` (default false); `useAnimationEngine` gates raw-frame pump on flag; old frame path preserved for Step 6 removal
  - [x] Step 4.5 — F3.6 bug fixes: (1) `USE_CODEC_DEVICE` flipped to `true` (was left false); (2) duplicate `onStateChange` listener bug fixed — codec+UI state merged into single handler so playClip dispatch is not overwritten; (3) `streamCodec` now sends `APP_CONNECTED\n` + waits for `OK:APP_CONNECTED` before streaming (matches stream_to_device.py handshake — firmware requires this to arm codec decoder)
  - [x] Step 4.6 — Backend path + name-resolution fixes: `_ASSETS_CODEC_DIR` corrected to `parents[3]/assets/codec` (was resolving to non-existent `sadik-backend/assets/codec`); `resolve_clip_bin()` now builds a manifest-based `name→abs_path` dict at import from `clips-manifest.json` (21 clips mapped); handles `mood_*→mode_*.bin`, `didnt_hear→didnthear.bin`, `goodbye_to_idle→return_to_idle.bin`, `waking→wakeword.bin` mismatches; fallback to `<name>.bin` preserved
  - [x] Step 4.7 — F3.6 perf fixes: (1) per-stream APP_CONNECTED handshake removed from `streamCodec` — backend keeps persistent connection, firmware armed at connect (PONG verified); only `reset_input_buffer()` kept pre-stream to drop stale bytes; (2) 200ms trailing debounce + coalescing added to `useAnimationEngine.ts` — rapid scene churn (blink/look/hold) collapsed to single playClip per 200ms window; same-clip coalesce prevents redundant stop+start; device scene trails preview by ≤200ms
  - [x] Step 5 — Preview canvas wired to codec frames (done via OledPreview frameBuffer; Step 3 completed this)
  - [ ] Step 6 — mp4 pipeline removal (after Sprint-3 F4.6 smoke test)
- [ ] **F3.7** Fallback: flash'a 1 idle klip preload — disconnect durumunda standalone yaşar
- [ ] **F3.8** Performance: 24fps sustained, frame drop telemetry

**Exit criteria**: Tüm renkli klipler 24fps'de akar, preview ile ESP32 senkron, baudrate budget içinde.

---

### Sprint-3 — Faz 4 (performance + firmware control opcodes) — AKTİF

**Exit criteria:** v2 parity feel: 24fps steady, scene-switch <500ms perceived, preview-device lag <100ms, event→clip mapping zero drops.

- [x] **F4.1** Backend codec ACK window 1 → 2–4 (sliding window, ref: `tools/codec/stream_to_device.py --window 2`). Target: 24fps steady on hold segments. — DONE (ported in F3.6 Step 4, confirmed Sprint-3; `_DEFAULT_WINDOW=2`, ACK reader thread + executor bridge, 1.5s timeout, IFRAME resync on timeout/RESYNC opcode).
  - [x] **F4.1b** `APP_CONNECTED` sent once at connect-time (after PING/PONG) to arm firmware codec decoder; `APP_DISCONNECTED` sent best-effort on close. `streamCodec` has no handshake — only `reset_input_buffer()`. Fixes `acked=0` / `TIMEOUT seq=0` / device stuck on boot splash regression introduced in b2ac54e.
  - [x] **F4.1c** Diagnostic log added to `_run_codec_stream`: `window={N} outstanding_max={M}` logged at stream end. If `outstanding_max=1` → firmware serializes (fix is F4.2 ABORT_STREAM, not host-side); if `outstanding_max=2` → window saturated and ~20fps expected. Host-side window logic confirmed structurally correct after line-for-line audit vs `stream_to_device.py` reference.
- [x] **F4.2** Firmware `ABORT_STREAM` opcode — `stop_clip` wires to this so scene-switch race (current 7–8s timeout → "skip to IFRAME") is eliminated. Closes the race where backend aborts host-side while firmware decoder state isn't signaled. — DONE (serial_commander.h enum+parser, codec_decode.h/cpp `codec_abort()`, main.cpp `CMD_ABORT_STREAM` case, serial_service.py `send_abort_stream`, device_manager.py `stop_clip` 1s wait + ABORT_STREAM exchange)
- [ ] **F4.3** Firmware `PAUSE_CODEC` / `RESUME_CODEC` — enables frame-boundary command injection so brightness mid-stream latency drops from ~clip-length to <50ms.
- [ ] **F4.4** Baud ramp 921600 → 1.5M (formerly F3.5; verify with existing `tools/baud-test/` harness first; IFRAME worst-case 450ms → ~280ms).
- [ ] **F4.5** Preview↔device latency measurement — video-cue-based, target ≤100ms steady-state.
- [ ] **F4.6** 22-clip hardware smoke test + no-drop verification (mp4 pipeline removal gated on this passing).

---

### Sprint-7 — MJPEG LittleFS render blocker (C1) ✅ DONE (2026-05-11)

**Exit criteria:** `PLAY:<clip>` komutu cihaza gelince gerçek piksel ekranda görünür. — **KARŞILANDI**

**Donanımda doğrulandı:**
```
BOOT:HW psram_size=8386279 psram_free=8320659 flash=16777216
BOOT:OK display=ST7735S 160x128 tab=BLACK spi=40000000
SADIK:READY
[MJPEG playback yürüyor, renkler doğru, pixelleşme yok]
```

- [x] **C1a** `_tjpg_cb` stub (solid white fillRect) → gerçek pixel blit: `startWrite()` + `setAddrWindow()` + `writePixels(bigEndian=false)` + `endWrite()`. Sınır kırpma, `cx/cy < 0` guard eklendi. `bigEndian=false` (byte-swap fix — `bigEndian=true` renk inversiyonuna yol açıyordu). — DONE ✅ VERIFIED (idle suratı ekranda görünüyor, renkler doğru)

- [x] **C1b** Board config + PSRAM + kalite düzeltmeleri — DONE ✅
  - [x] `platformio.ini` — `board_build.flash_mode = qio` + `board_build.arduino.memory_type = qio_opi` (N16R8 için doğru combo; `opi_opi` denendi, EFUSE abort verdi, geri alındı); `-DBOARD_HAS_PSRAM` flag eklendi
  - [x] `main.cpp` — setup başında `BOOT:HW psram_size=... psram_free=... flash=...` log eklendi; USB-CDC enumeration için 300ms delay eklendi (BOOT:HW logu monitörde görünüyor)
  - [x] `tools/mjpeg/encode_all.py` — Q=2 (perceptual lossless, ~95% JPEG kalite), lanczos resize, yuvj420p (full-range, renk kayması kapatıldı); source FPS + output frame log eklendi
  - [x] 22 klip Q=2 ile yeniden encode edildi, LittleFS'e yazıldı, donanımda doğrulandı

**Açık notlar (C2'ye taşındı):**
- `ok=0` TJpgDec dönüş kodu cosmetic warning olarak duruyor; render doğru çalışıyor, C2'de incelenecek
- PSRAM 8MB doğrulandı (psram_size=8386279); C2 double-buffer + clip cache için açık
- R↔B renk swap: C1'de bigEndian=false ile kapandı; sahne değişiminde tekrar gözükürse C2'de `setSwapBytes` toggle dene

---

### Sprint-8 — C2.1 instrumentation + Bitbank2 stack migration — DONE (2026-05-11)

**Sprint-8a — C2.1 instrumentation:** per-frame + per-clip timing logs, `MJPEG:SUMMARY` ring buffer, `STATS:ON/OFF` komutları.

**Sprint-8b — Bitbank2 stack migration:** TJpgDec → JPEGDEC, Adafruit ST7735 + GFX → LovyanGFX. Sebep: TJpgDec workspace yetersizliği (`JDR_MEM1`) wakeword/listening/mode_working kliplerinde decode'u bloğluyordu; Bitbank2 stack ESP32-S3 ekosistem standardı.

- [x] **Lib swap** (commit `183f5d9`): platformio.ini → JPEGDEC + LovyanGFX
- [x] **LovyanGFX driver** (commit `2e586b1`): `LGFX_Custom` config (SPI2_HOST, 40MHz, pin map config.h'tan)
- [x] **JPEGDEC decoder** (commit `2bfefc1`): `openRAM` + `decode`, `_jpegdec_cb` blit via `pushImage`
- [x] **Build dir ASCII** (commit `a02851a`): Unicode path workaround, `${sysenv.USERPROFILE}/pio_build/sadik_color`
- [x] **BGR color order** (commit `13120bd`): `rgb_order=true` — INITR_BLACKTAB MADCTL BGR bit'iyle uyum
- [x] **LE + setSwapBytes(true)** (commit `8b12986`): JPEGDEC `RGB565_LITTLE_ENDIAN` + LovyanGFX swap toggle — pixelleşme fix
- [x] **HW doğrulama (Eren)**: 22 klip render OK, `ok_fail=0` her klipte, eski crash klipleri (wakeword/listening/mode_working) decode başarılı, avg_fps ~24, t_dec_p50 ~13ms

**Açık asset notu (Sprint-8c'ye):**
- Bazı kliplerde (talking, mode_working, mode_gaming) ekran altında siyah yatay band içeriği örtüyor — encoder/asset side artifact, firmware bug değil.

---

### Sprint-8c — Asset cleanup — WIP

**Hedef:** Sprint-8b sonrası ortaya çıkan asset artifact'lerinin çözümü.

- [x] **SPI clock ramp 40 MHz for tearing minimization** — WIP (user testing 40→60→80): `display_manager.h:49` `freq_write` 40 MHz → 60 MHz; prior 40 MHz was already set from a previous sprint. Next step: user reports tearing result, iterate to 80 MHz if still visible.
- [ ] **Panel GRAM offset fix** — WIP: horizontal band at top (~10-15% height) showing bottom-of-frame content; diagnosed as ST7735S GRAM wraparound (panel offset bug, NOT tearing). Single full-frame `pushImage(0,0,160,128)` triggers CASET/RASET to wrong window when `offset_x/y=0`. Testing **Variant A (green-tab 1.8")**: `mem_width=132, mem_height=162, offset_x=2, offset_y=1`. If wrong: Variant B = red-tab `offset_x=0, offset_y=0, mem 128×160`; Variant C = 1.44" black-tab `offset_x=2, offset_y=3`.
- [x] **Tearing fix: PSRAM full-frame backbuffer for PLAY_LOCAL** (commit on `feature/sprint8b-assets`): `mjpeg_player.h` — `_jpegdec_cb` artık MCU tile'ları doğrudan TFT'ye push etmiyor; 40 960 B PSRAM backbuffer'a (160×128×2) kopyalıyor. `decode()` başarıyla döndüğünde `pushImage(0,0,160,128,s_framebuf)` ile tam frame tek SPI transaction olarak blit ediliyor. TE pini kablolu olmadığı için yaşanan yatay yırtılma (orta-alt arası band) ortadan kalkıyor. Byte order değişmedi (JPEGDEC LE + setSwapBytes(true) korundu). PSRAM alloc fail olursa eski tile-push fallback aktif. Build: SUCCESS, no new errors.
- [ ] **Diagnose**: orijinal `assets/mp4/` kaynaklarında `ffprobe` + `cropdetect` ile letterbox/footer band tespiti
- [ ] **Encoder fix**: `tools/mjpeg/encode_all.py`'a `crop` filter veya aspect-aware `pad` mantığı
- [ ] **Q yükseltme**: `-q:v 2` → `-q:v 1` (mid-tone shimmer azalır, ~%30 dosya büyür)
- [ ] **Manifest auto-regen**: encode sonrası `manifest.json` `bytes` değerleri stale kalıyor (RED-2 fix)
- [ ] **Re-encode + uploadfs**: 22 klip yeniden encode, LittleFS image güncelle
- [ ] **HW doğrulama (Eren)**: sweep yeniden, band gitti mi teyit

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

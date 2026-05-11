# COLOR_INTEGRATION_PLAN.md
# SADIK Color — C-Sprint Master Plan
> **Hedef kitle:** Yeni Opus session'ı. Bu dosyayı + memory'yi + BETA_ROADMAP.md'yi oku; sonra C2'den Sonnet'e delege et.
> **Son güncelleme:** 2026-05-11 (C1 DONE commit `2cd6a7c` sonrası)

---

## 1. Final Hedef (Sözleşme)

- Tek `sadik-app` Electron app, **mini (OLED)** + **color (TFT)** variant'larıyla kusursuz çalışır.
- Color cihazda mp4 kaynaklı MJPEG animasyonları **frame-drop yok**, donanımın izin verdiği maksimum FPS'te oynar.
- Kalite **algısal lossless**: renk bozulması / pixelleşme yok. Bit-exact değil — Eren onayı 2026-05-11 verildi (Q=2 encode doğrulanmış).
- Geniş FPS desteği: mp4'ler şu an 24fps, encoder per-clip FPS; manifest'ten okunur.
- `sadik_color/` izole tree'si **geçici**. Final'de:
  - Color firmware → ana `sadik-firmware/` altında env olarak
  - Encoder araçları → ana `sadik-app/tools/` altına
  - `sadik_color/` deprecate edilir
- **Mini stack regresyon-free**: color işi mini'ye dokunmaz. T8.1 regression pass color entegrasyonundan önce yapılır.

---

## 2. Donanım & Teknik Gerçeklik

| Parametre | Değer | Kaynak |
|-----------|-------|--------|
| MCU | ESP32-S3 N16R8 | donanım — `BOOT:HW` log |
| CPU | 240 MHz dual-core | ESP32-S3 datasheet |
| SRAM | 320 KB internal | ESP32-S3 datasheet |
| PSRAM | **8 MB doğrulandı** — `psram_size=8386279` | `BOOT:HW psram_size=8386279` log |
| Flash | 16 MB — `flash=16777216` | `BOOT:HW flash=16777216` log |
| Display | ST7735S 1.8" 160×128 SPI | donanım |
| SPI hızı | 40 MHz HW SPI, ~4.2ms/frame blit | F1.5b ölçümü |
| LittleFS toplam | ~9.74 MB kullanılabilir (0x9F0000 raw) | `partitions_s3_n16r8.csv` |
| LittleFS kullanım | 22 clip = **4.41 MB** (dancing dahil) | `data/clips/` dizin içeriği |
| LittleFS headroom | ~5.3 MB | hesaplanan |
| Transport | UART 921600 baud (`COM8`) | `platformio.ini` |
| Codec | MJPEG (JPEG concat), TJpgDec decoder | `mjpeg_player.h` |
| Encode | ffmpeg `fps=24,scale=160:128:flags=lanczos,format=yuvj420p` Q=2 | `encode_all.py` |
| PlatformIO env | `esp32-s3-n16r8` (aktif); `esp32dev` WROOM-32 (eski, inaktif) | `platformio.ini` |

**Kritik PlatformIO build flags (dokunma):**
```ini
board_build.flash_mode = qio
board_build.arduino.memory_type = qio_opi
-DBOARD_HAS_PSRAM
-DARDUINO_USB_CDC_ON_BOOT=1
-DARDUINO_USB_MODE=1
```
`opi_opi` denendi → EFUSE abort + boot loop → geri alındı. `qio_opi` doğru combo.

---

## 3. Mimari Kararlar (Kanıtlanmış — Dokunma)

### 3.1 On-device MJPEG Playback (Streaming YOK)
- Clip'ler LittleFS'te `/clips/<name>.mjpeg` olarak saklı.
- App `PLAY_LOCAL:<name>` komutuyla tetikler.
- Firmware PSRAM'a yükler → `MjpegPlayer::update()` her loop tick'inde 1 frame decode+blit.
- **Live RGB stream kesinlikle yok.** S1/S3'te streaming control plane patlamıştı: race/CRC/window karmaşası. Flash playback (S5+S6+C1) kanıtlanmış tek yol.

### 3.2 PC-Side Preprocess
- `tools/mjpeg/encode_all.py` → ffmpeg pipeline: `fps=24,scale=160:128:flags=lanczos,format=yuvj420p` → Q=2 MJPEG.
- RGB565 dönüşüm panel-side (TJpgDec); runtime'da color convert yok.
- `bigEndian=false` → `writePixels` byte swap doğru. `bigEndian=true` renk inversiyonuna yol açar (C1'de kapandı).

### 3.3 Variant Dispatch
- App'te `deviceVariant === 'color'` guard.
- Mini path: raw frame `FRAME:` binary, 460800 baud.
- Color path: ASCII `PLAY_LOCAL:` + `STOP_CLIP` + `RETURN_TO_IDLE`, 921600 baud.
- Handshake: boot'ta `DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.7.0 caps=local_clips,mjpeg` serial publish + `MANIFEST:<clip list>`.

### 3.4 AnimationEngine Kalır App'te
- State machine, clip mapping, event→clip resolution hepsi app'te.
- Firmware sadece "render backend" — `PLAY_LOCAL` → MjpegPlayer → TJpgDec → TFT.
- `AnimationEngine` app-side (TS/React) color için `COLOR_CLIP_MAP` ile genişler.

### 3.5 Firmware Komut Seti (Mevcut, Çalışan)
```
PLAY_LOCAL:<name>    → clip başlat (loop flag manifest'ten)
STOP_CLIP           → dur, idle'a dön
RETURN_TO_IDLE      → idle'a geç
SHOW_TEXT:<text>    → metin göster (timer format desteği var)
SET_BRIGHTNESS:<0-255>
SET_SLEEP_TIMEOUT_MS:<ms>
FORCE_SLEEP
APP_CONNECTED / APP_DISCONNECTED
PING → PONG
STATUS
DEVICE?
ABORT_STREAM        → no-op (protocol compat, streaming yok)
```

---

## 4. Geçmiş — Neler Çalıştı, Neler Patladı

| Sprint | Sonuç | Sebep |
|--------|-------|-------|
| S1: Live RGB565 stream | FAIL — ~2 fps | Wire bandwidth tavanı (40KB/frame × 24fps = ~960 KB/s, 921600 baud = ~115 KB/s) |
| S2: Delta+RLE custom codec | OK — 62/62 bit-exact, 29× compression, 10.7 fps | Lossless, frame-by-frame ACK |
| S3: ACK window/ABORT/gating | FAIL — CRC race cascade, boot loop, çoklu revert | Streaming control plane karmaşıklığı; codec değil sorun |
| S5: LittleFS + LocalClipPlayer | OK — stabil | Streaming'i tamamen elimine etti |
| S6: AnimationEngine in-firmware | OK — idle/blink standalone | Aynı prensip |
| S7: MJPEG (TJpgDec) stub | Yarım — `_tjpg_cb` stub'ta kaldı | C1'e taşındı |
| **C1 (2026-05-11)** | **OK — DONE** | MJPEG render + byte swap + PSRAM + Q=2 encoder |

**Çıkarım:** Streaming = bug source. Codec ≠ streaming. Flash playback kanıtlanmış yol.

---

## 5. C1 Done — Ne Yapıldı (commit `2cd6a7c`)

- `mjpeg_player.h::_tjpg_cb` stub → gerçek `writePixels` blit:
  - `startWrite()` + `setAddrWindow()` + `writePixels(bigEndian=false)` + `endWrite()`
  - Sınır kırpma: `cx/cy < 0` guard, `cw/ch` clip
  - `setSwapBytes(false)` + `bigEndian=false` → byte swap simetrik ve doğru
- `platformio.ini` S3 env: `qio_opi + flash_mode=qio + -DBOARD_HAS_PSRAM` (EFUSE abort olmadan PSRAM 8MB aktif)
- `main.cpp` setup: `Serial.begin` sonrası 300ms delay → USB-CDC enumeration'da `BOOT:HW` logu kaçmıyor
- `encode_all.py`: Q=2 + lanczos + yuvj420p; source FPS + output frame log eklendi
- 22 clip Q=2 ile yeniden encode edildi (+ `dancing.mjpeg` ekstra clip)
- **Doğrulama logu:**
  ```
  BOOT:HW psram_size=8386279 psram_free=8320659 flash=16777216
  BOOT:OK display=ST7735S 160x128 tab=BLACK spi=40000000
  SADIK:READY
  [MJPEG playback yürüyor, renkler doğru, pixelleşme yok]
  ```

**Açık (cosmetic):** `MJPEG:DBG ok=0` her frame'de (sadece ilk 3 frame loglanıyor). TJpgDec `drawJpg` bool dönüş değeri `0` veriyor ama `cb_calls=80` (tüm MCU tile render edildi). Görsel etkisi yok. C2.5'te incelenecek.

---

## 6. Kalan Sprint Planı (C2 → C8)

### C2 — Performance & RTOS Pipeline

**Hedef:** Donanımda max stabil FPS ölçüm + jitter <5ms; RTOS task body'leri aktif.

**Kapsam:**
- C2.1: FPS baseline — her clip için decode+blit ms/frame, jitter histogram. `MJPEG:STATS` log format: `frame_ms, jitter_ms, fps_actual`. Tüm 22 clip üzerinde çalıştır.
- C2.2: RTOS task body — Core0 IO + LittleFS read (`uartTaskEntry`), Core1 decode + TFT blit (`codecTaskEntry`). `byteQueue` (depth 8) + `eventQueue` (depth 16) + `tftMutex` iskeleti mevcut (`rtos_tasks.cpp`), body stub. **Şu an her ikisi de `vTaskDelay(10ms)` stub.**
- C2.3: PSRAM double-buffer — 2× 40KB frame buffer (PSRAM kapasiteli), swap-on-blit. `psram_or_internal_malloc` helper mevcut (`psram_alloc.h`).
- C2.4: DMA SPI kararı — Adafruit `writePixels` sync mı async mı? C2.1 ölçümünde blit süresi >4ms seyrediyorsa **LovyanGFX migration değerlendirmesi**. (belirsiz / C2.1 ölçümünden sonra karar)
- C2.5: `ok=0` TJpgDec mystery — `drawJpg` false dönüyor ama render doğru. TJpgDec source incele; JPEGDEC kütüphanesiyle swap değerlendirmesi. (belirsiz / C2.5'te ölçülecek)
- C2.6: Wide-FPS manifest — encoder per-clip target FPS; firmware wall-clock gating manifest'ten okur (şu an hardcoded `1000/24`).

**Başarı kriteri:** 24 fps stabil tüm 22 clip; jitter <5ms; `MJPEG:STATS` serial log doğrulanmış. 30 fps stretch goal ölçülmüş.

**Risk:** LovyanGFX migration scope creep (TFT init + font helper + tab variant yeniden ayarlanması gerekir). Sadece C2.1 metrikleri bunu zorunlu kılıyorsa gir.

**Bağımlılık:** C1 DONE (karşılandı).

---

### C3 — Native USB CDC Transport (Clip Sync)

**Hedef:** App ↔ cihaz arası clip senkronizasyonu UART yerine USB CDC bulk transfer.

**Kapsam:**
- TinyUSB CDC data path (boot'ta zaten aktif via `ARDUINO_USB_CDC_ON_BOOT=1`, sadece transport olarak ayır)
- Host tarafında pyserial CDC test (`/dev/tty.usbmodem*` / `COM*` CDC port)
- LittleFS clip push protocol: chunk (4KB önerilen) + CRC32 + commit; manifest hash karşılaştırma
- `MANIFEST?` query → cihaz `/manifest.json` hash döner
- UART vs CDC latency karşılaştırması (ölçüm hedefi: 22 clip set <30s)
- UART ASCII komut path fallback olarak çalışmaya devam eder

**Başarı kriteri:** 22 clip set'i CDC ile <30s push; UART fallback sağlam.

**Not:** Runtime frame stream YOK. CDC sadece offline clip sync için.

**Bağımlılık:** C2 stabil.

**Risk:** CDC + UART aynı anda aktifse port çakışması. Clip push sırasında mutex veya lock gerekir.

---

### C4 — Ana App Entegrasyonu (Variant-Agnostic)

**Hedef:** `sadik_color/` izole tree'sinden ana `sadik-app/` + `sadik-firmware/`'a taşıma.

**Kapsam:**
- `device_manager.py` variant-aware: `mini→460800/FRAME`, `color→921600/PLAY_LOCAL`
- `useAnimationEngine.ts` `COLOR_CLIP_MAP` — her event için color clip adı zorunlu; eksik mapping fail-loud (silent fallback yok)
- `eventMapping.ts` her event için mini+color clip karşılığı zorunlu
- `OledPreview.tsx` variant-gated: mono canvas (mini) vs RGB565 canvas (color); color preview backend MJPEG decode (PC-side TJpgDec eşdeğeri)
- `DEVICE:variant=color` handshake → app 3s timeout pipeline
- Color firmware ana `sadik-firmware/` altında env olarak; `sadik_color/sadik-firmware/` deprecate

**Başarı kriteri:** Tek `sadik-app build` her iki cihaz variant'ını destekler; mini T8.1 regression clean.

**Risk:** AppContext monolith; refactor yüzeyi büyük. Variant dispatch eklendikçe state yönetimi karmaşıklaşabilir.

**Bağımlılık:** C2, C3.

---

### C5 — MP4 → MJPEG Asset Pipeline (App-Side)

**Hedef:** `tools/mjpeg/encode_all.py`'yi app build-time pipeline'ına bağla.

**Kapsam:**
- Source: `sadik-app/assets/raw_mp4/color/*.mp4`
- Output: `data/clips/*.mjpeg` + `clips-manifest.json` (FPS, frame count, byte size, CRC)
- LittleFS budget hard fail (>9.2 MB)
- CI hook: encoder hash invalidate (source mp4 değişince re-encode tetiklenir)
- `npm run build:color-clips` veya Makefile target

**Not:** Eren PNG → 24fps MP4 direct export yapacak (60fps ara katmanı atla). `wakeword.mjpeg` source `ffprobe` `1000fps` raporluyor (variable rate); output sağlam ama metadata C5'te netleşmeli. (belirsiz / C5'te incelenecek)

**Başarı kriteri:** Yeni MP4 eklenince tek komutla manifest + clip set güncellenir; LittleFS budget check geçer.

**Bağımlılık:** C4.

---

### C6 — Clip Sync Runtime Protocol

**Hedef:** App boot'ta cihazın manifest hash'ini sorar; mismatch varsa delta-sync.

**Kapsam:**
- `MANIFEST?` query → cihaz `/manifest.json` CRC32 hash döner
- Hash mismatch → CDC bulk delta push (sadece değişen clip'ler)
- Progress UI app'te
- ACK + verify (her clip push sonrası)

**Bağımlılık:** C3 (CDC transport), C5 (manifest pipeline).

---

### C7 — Multi-Device Beta Regression

**Hedef:** Mini + color aynı anda app'e bağlı; ikisi de stabil.

**Kapsam:**
- Authority state machine her variant için izole (mini port = 460800, color port = 921600)
- Sleep/wake/return_to_idle/heartbeat her iki variant pass
- T8.1 checklist'in color-extended versiyonu
- 1 saat smoke test, ikisi eş zamanlı

**Başarı kriteri:** Multi-device 1 saat smoke clean; log'da çapraz komut yok.

---

### C8 — Hardening

**Hedef:** Production-ready stabilite.

**Kapsam:**
- Brightness mid-stream latency fix (eski F4.3 `PAUSE_CODEC`/`RESUME_CODEC` konsepti — MJPEG eşdeğeri gerekiyor)
- Boot loop / WDT senaryoları (PSRAM init hatası, LittleFS mount fail recovery)
- CDC re-enumeration recovery (USB disconnect → reconnect without firmware reset)
- 48h soak test

**Başarı kriteri:** 48h kesintisiz çalışır; hiç WDT reset yok.

---

## 7. Mevcut Dosya Yapısı (Referans)

```
sadik_v2/
├── sadik-app/               # Ana Electron app (mini hedef)
├── sadik-firmware/          # Ana mini firmware
├── sadik_color/             # COLOR — geçici izole tree
│   ├── BETA_ROADMAP.md      # Sprint status (Sprint-7 = C1 DONE)
│   ├── assets/mp4/          # Source mp4'ler (22 clip)
│   ├── tools/mjpeg/encode_all.py  # Encoder pipeline
│   └── sadik-firmware/      # Color firmware (aktif)
│       ├── platformio.ini   # env: esp32-s3-n16r8 (aktif), esp32dev (eski)
│       ├── include/
│       │   ├── mjpeg_player.h      # MJPEG player (C1 DONE)
│       │   ├── animation_engine.h  # Idle orchestration
│       │   ├── rtos_tasks.h        # FreeRTOS primitives (stubs)
│       │   ├── display_manager.h
│       │   ├── serial_commander.h
│       │   ├── text_renderer.h
│       │   └── psram_alloc.h
│       ├── src/
│       │   ├── main.cpp            # Command dispatch + loop
│       │   └── rtos_tasks.cpp      # Task stubs (W2D body bekliyor)
│       └── data/
│           ├── manifest.json        # 21 clip entry (dancing manifest'te yok)
│           └── clips/               # 22 .mjpeg dosyası (dancing dahil)
└── COLOR_INTEGRATION_PLAN.md  # Bu dosya
```

**Clip sayısı notu:** `data/clips/` dizininde 22 `.mjpeg` var (`dancing.mjpeg` dahil). `manifest.json`'da 21 entry var (dancing yok — C5'te eklenmeli). Şimdiki LittleFS kullanımı ~4.41 MB.

---

## 8. Kanonik Kaynaklar (Yeni Opus — Bu Sırayla Oku)

1. **Bu dosya** — strateji + sprint planı
2. **`C:\Users\eren_\.claude\projects\...\memory\MEMORY.md`** — Eren feedback'leri, ship discipline, sözleşmeler
3. **`sadik_color/BETA_ROADMAP.md`** — Sprint status (Sprint-7 = C1 DONE)
4. **`sadik_color/sadik-firmware/include/mjpeg_player.h`** — C1 render core
5. **`sadik_color/sadik-firmware/src/main.cpp`** — Command dispatch, loop logic
6. **`sadik_color/sadik-firmware/platformio.ini`** — Build config (dokunma)
7. **`sadik_color/tools/mjpeg/encode_all.py`** — Encoder pipeline
8. **`sadik-app/`** + **`sadik-firmware/`** — Mini codebase (C4 entegrasyon hedefi)

---

## 9. Açık Riskler / Unresolved

| Risk | Durum | Plan |
|------|-------|------|
| `ok=0` TJpgDec warning | Cosmetic — render doğru, `cb_calls` tam | C2.5'te TJpgDec source incele; gerekirse JPEGDEC swap |
| LovyanGFX migration | (belirsiz) | C2.1 blit süresi >4ms ise değerlendir; scope creep riski var |
| `wakeword.mjpeg` metadata | Source `ffprobe` `1000fps` raporluyor (variable rate) | C5'te normalize et; output şu an sağlam |
| `dancing.mjpeg` manifest'te yok | `data/clips/`'te var, `manifest.json`'da entry yok | C5'te ekle |
| Mini T8.1 regression | Color işi sırasında mini dokunulmadı — ama test edilmedi | C4 öncesinde T8.1 pass zorunlu |
| CDC re-enumeration | USB-OTG CDC boot'ta aktif; transport olarak test edilmedi | C3'te ölçülecek |

---

## 10. Yeni Opus İçin Açılış Prompt

Eren yeni session'da şunu yazabilir:

> "Sen Opus, master developer + product manager. `COLOR_INTEGRATION_PLAN.md` dosyasını oku, memory'yi çek, BETA_ROADMAP'in durumunu doğrula. C1 done (commit `2cd6a7c`) — şimdi C2'den başlayalım. İlk adım: C2.1 FPS baseline ölçüm sprint'ini Sonnet'e delege et."

---

*Spekülasyon yok. Belirsizlikler "(belirsiz / C2'de ölçülecek)" etiketiyle işaretlendi. Tüm teknik detaylar kaynak kod + commit log + donanım log'undan doğrulandı.*

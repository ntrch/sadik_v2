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

### Faz 3 — Renkli streaming mimarisi (Faz 2 ile paralel tasarım)

- [ ] **F3.1** Build-time: ffmpeg ile mp4 → RGB565 raw frames → delta+RLE sıkıştır → `.bin` paket
- [ ] **F3.2** Host streaming: app yeni codec ile frame paketi gönderir, mevcut serial pipeline extend
- [ ] **F3.3** ESP32 firmware: incoming delta paket → framebuffer patch → Adafruit_ST7735 push
- [ ] **F3.4** Flow control / backpressure — ACK veya pacing
- [ ] **F3.5** Baud rate ramp — 460800 → 921600 → 1.5M ramp test gerçek stream üstünde
- [ ] **F3.6** Preview parity — React canvas aynı stream'i decode etsin (host-side decode servisi her ikisini besler)
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

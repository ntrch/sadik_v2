# INMP441 Mikrofon Bağlantı ve Test Rehberi

## Durum Özeti

Kod tarafı **tamamen hazır** ve doğrulandı:
- ✅ `platformio.ini` → `[env:mic_poc]` environment eklendi
- ✅ `mic_poc.cpp` → standalone POC firmware yazıldı
- ✅ Production firmware (`[env:esp32dev]`) hiç etkilenmedi
- ⏳ **Fiziksel bağlantılar henüz yapılmadı**

---

## Pin Bağlantı Tablosu

| INMP441 Pin | → | ESP32 GPIO | Açıklama |
|-------------|---|-----------|----------|
| **VDD** | → | **3V3** | Güç (3.3V) |
| **GND** | → | **GND** | Toprak |
| **SCK** (Clock) | → | **GPIO 26** | I2S Bit Clock (BCLK) |
| **WS** (Word Select) | → | **GPIO 25** | I2S Left/Right Clock (LRCLK) |
| **SD** (Data) | → | **GPIO 34** | I2S Data In — *input-only pin* |
| **L/R** | → | **GND** | Sol kanal seçimi |

> **ÖNEMLİ:** GPIO 34 sadece giriş (input-only) pinidir, bu yüzden mikrofon verisi için idealdir.
> Dahili pull-up/down direnci yoktur ama INMP441 kendi çıkışını sürdüğü için sorun oluşturmaz.

---

## Mevcut Bağlantılarla Çakışma Kontrolü

| Kullanılan Pin | Kullanım | Çakışma? |
|---------------|----------|----------|
| GPIO 21 | OLED SDA | ❌ Çakışma yok |
| GPIO 22 | OLED SCL | ❌ Çakışma yok |
| GPIO 26 | I2S BCLK (**yeni**) | ✅ Boş — production firmware kullanmıyor |
| GPIO 25 | I2S WS (**yeni**) | ✅ Boş — production firmware kullanmıyor |
| GPIO 34 | I2S SD (**yeni**) | ✅ Boş — production firmware kullanmıyor |

**Sonuç:** Hiçbir pin çakışması yok.

---

## Bağlantı Adımları

### Gerekli Malzemeler
- INMP441 modül
- Breadboard jumper kablolar (6 adet) veya lehim + kablo
- Breadboard (lehimsiz test için önerilir)

### Adım Adım

**1. ESP32'yi USB'den çıkar** (güvenlik)

**2. INMP441 modülünü breadboard'a yerleştir** (pin header lehimliyse)

**3. Bağlantıları yap:**

```
INMP441          ESP32 DevKit
────────         ──────────────
 VDD ──────────→ 3V3
 GND ──────────→ GND
 SCK ──────────→ GPIO 26
 WS  ──────────→ GPIO 25
 SD  ──────────→ GPIO 34
 L/R ──────────→ GND (aynı GND hattına)
```

> **İPUCU:** L/R pini sol kanal seçimi için GND'ye bağlanmalı. Havada bırakma — tanımsız davranış üretir.

**4. Bağlantıları kontrol et:**
- VDD → 3V3 (5V DEĞİL! INMP441 3.3V modüldür)
- İki ayrı GND bağlantısı: modül GND + L/R → GND
- Kablo temaslarını kontrol et, kısa devre yok

---

## Test Sırası

### Adım 1: Upload
```powershell
cd C:\Users\eren_\OneDrive\Masaüstü\sadik_v2\sadik-firmware
pio run -e mic_poc -t upload
```

### Adım 2: Serial Monitor
```powershell
pio device monitor -e mic_poc
```

### Beklenen Çıktı (başarılı):
```
MIC:BOOT
MIC:OLED_OK
MIC:I2S_OK
MIC:CONFIG BCLK=26 WS=25 SD=34 SR=16000
MIC:LEVEL=0.00312
MIC:PEAK=0.01847
MIC:CLIP=0
MIC:LEVEL=0.00283
MIC:PEAK=0.01502
MIC:CLIP=0
```

### Beklenen OLED Görünümü:
- Üst satır: **MIC TEST** (ortalanmış)
- Alt satır: **LVL:0.003** + görsel bar

---

## Başarı Kriterleri

| Test | Beklenen |
|------|----------|
| Sessiz ortam | `LEVEL` ≈ 0.001–0.01, bar küçük |
| Konuşma / parmak şıklatma | `LEVEL` belirgin artış (0.05+), bar büyür |
| Yüksek ses | `LEVEL` > 0.1, `PEAK` yükselir |
| Çok yüksek ses | `CLIP=1` görülebilir |

---

## Hata Durumları

| Belirti | Olası Sebep |
|---------|-------------|
| `MIC:I2S_FAIL` | SCK/WS/SD pin bağlantısı yanlış veya INMP441 güç almıyor |
| OLED'de "I2S ERR" | Aynı — I2S driver başlatılamadı |
| `LEVEL` sürekli 0 | SD (data) pini bağlı değil veya L/R pini havada |
| `LEVEL` sürekli çok yüksek | GND bağlantısı eksik veya kısa devre |
| OLED açılmıyor | SDA/SCL (21/22) bağlantısı kopmuş |

---

## Production'a Geri Dönüş

Mic testinden sonra production firmware'e dönmek için:

```powershell
pio run -e esp32dev -t upload
```

Bu komut `main.cpp` ile normal SADIK firmware'ini yükler, `mic_poc.cpp` derlenmez.

---

## Sonraki Adımlar (Bağlantılar yapıldıktan sonra)

1. ✅ Upload + serial monitor ile temel çalışma doğrulaması
2. 📊 Sessiz/konuşma/yüksek ses ortamlarında RMS değerlerini kaydet
3. 🎯 Silence vs. speech threshold belirle
4. ⏭️ Threshold bulunursa → `EVENT:MIC_ACTIVE` / `EVENT:MIC_SILENT` serial event tasarımı
5. ⏭️ Non-invasive firmware integration (production build'e ekleme)

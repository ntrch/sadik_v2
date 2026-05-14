// =============================================================================
// mic_poc.cpp — INMP441 microphone discovery scaffold (Phase 3.5A)
//
// Standalone proof-of-concept firmware. NOT part of the production build.
// Build with:   pio run -e mic_poc -t upload
// Monitor with: pio device monitor -e mic_poc
//
// Hardware assumptions:
//   OLED  SDA -> GPIO21   (shared with production)
//   OLED  SCL -> GPIO22   (shared with production)
//   I2S  BCLK -> GPIO26
//   I2S    WS -> GPIO25
//   I2S    SD -> GPIO34   (input only — no pull needed)
//   INMP441 L/R -> GND    (selects left channel)
//   INMP441 VDD -> 3.3 V
//
// Serial output (parseable):
//   MIC:LEVEL=<float>
//   MIC:PEAK=<float>
//   MIC:CLIP=<0|1>        (1 when raw sample saturates the 18-bit range)
// =============================================================================

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <driver/i2s.h>
#include <math.h>

// ── Pin definitions ───────────────────────────────────────────────────────────

static constexpr uint8_t  OLED_SDA_PIN  = 21;
static constexpr uint8_t  OLED_SCL_PIN  = 22;

static constexpr gpio_num_t I2S_BCLK_PIN = GPIO_NUM_26;
static constexpr gpio_num_t I2S_WS_PIN   = GPIO_NUM_25;
static constexpr gpio_num_t I2S_SD_PIN   = GPIO_NUM_34;

// ── I2S parameters ────────────────────────────────────────────────────────────

static constexpr i2s_port_t I2S_PORT      = I2S_NUM_0;
static constexpr int        SAMPLE_RATE   = 16000;   // Hz
static constexpr int        DMA_BUF_COUNT = 4;
static constexpr int        DMA_BUF_LEN   = 128;     // samples per DMA buffer

// Read buffer: one DMA buffer worth of 32-bit samples (INMP441 uses 32-bit frames)
static constexpr int SAMPLES_PER_READ = DMA_BUF_LEN;
static int32_t sampleBuf[SAMPLES_PER_READ];

// INMP441 data occupies bits [31:14] of the 32-bit word (18-bit effective).
// Right-shift by 14 to get a signed 18-bit integer in the int32 range [-131072, +131071].
static constexpr int    INMP441_SHIFT    = 14;
static constexpr float  INMP441_MAX      = 131072.0f;  // 2^17

// ── OLED ──────────────────────────────────────────────────────────────────────

// SH1106 128x64 I2C — same panel as production firmware.
static U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE,
                                                 OLED_SCL_PIN, OLED_SDA_PIN);

// ── Timing ────────────────────────────────────────────────────────────────────

static constexpr unsigned long REPORT_INTERVAL_MS = 200;   // serial report rate
static constexpr unsigned long OLED_UPDATE_MS      = 500;   // OLED refresh rate

static unsigned long lastReportMs = 0;
static unsigned long lastOledMs   = 0;

// ── Accumulated metrics (reset each report period) ────────────────────────────

static float    gAccumRmsSum  = 0.0f;   // sum of per-read RMS values
static float    gPeak         = 0.0f;   // peak (0–1) since last report
static uint32_t gReadCount    = 0;      // number of reads accumulated
static bool     gClip         = false;  // any sample saturated?

// =============================================================================
// i2s_init
// =============================================================================

static bool i2s_init() {
    i2s_config_t cfg = {};
    cfg.mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
    cfg.sample_rate          = SAMPLE_RATE;
    cfg.bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT;
    cfg.channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT;  // L/R = GND
    cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    cfg.intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1;
    cfg.dma_buf_count        = DMA_BUF_COUNT;
    cfg.dma_buf_len          = DMA_BUF_LEN;
    cfg.use_apll             = false;
    cfg.tx_desc_auto_clear   = false;
    cfg.fixed_mclk           = 0;

    esp_err_t err = i2s_driver_install(I2S_PORT, &cfg, 0, nullptr);
    if (err != ESP_OK) {
        Serial.printf("MIC:ERR i2s_driver_install=%d\n", (int)err);
        return false;
    }

    i2s_pin_config_t pins = {};
    pins.bck_io_num   = I2S_BCLK_PIN;
    pins.ws_io_num    = I2S_WS_PIN;
    pins.data_out_num = I2S_PIN_NO_CHANGE;
    pins.data_in_num  = I2S_SD_PIN;

    err = i2s_set_pin(I2S_PORT, &pins);
    if (err != ESP_OK) {
        Serial.printf("MIC:ERR i2s_set_pin=%d\n", (int)err);
        i2s_driver_uninstall(I2S_PORT);
        return false;
    }

    i2s_zero_dma_buffer(I2S_PORT);
    return true;
}

// =============================================================================
// oled_show_status
// Two-line display: top = "MIC TEST", bottom = level bar or error string.
// =============================================================================

static void oled_show_status(float rms, bool error) {
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tr);

    // Line 1: fixed label
    const char* label = "MIC TEST";
    int16_t lw = (int16_t)u8g2.getStrWidth(label);
    u8g2.drawStr((128 - lw) / 2, 16, label);

    if (error) {
        const char* errMsg = "I2S ERR";
        int16_t ew = (int16_t)u8g2.getStrWidth(errMsg);
        u8g2.drawStr((128 - ew) / 2, 42, errMsg);
    } else {
        // Line 2: "LVL: <bar>"
        // Draw a bar proportional to rms (0–1), clamped, 100px wide at 14px tall
        char lvlBuf[16];
        snprintf(lvlBuf, sizeof(lvlBuf), "LVL:%.3f", rms);
        int16_t tw = (int16_t)u8g2.getStrWidth(lvlBuf);
        u8g2.drawStr((128 - tw) / 2, 36, lvlBuf);

        // Visual bar
        float clamped  = rms < 0.0f ? 0.0f : (rms > 1.0f ? 1.0f : rms);
        int   barWidth = (int)(clamped * 100.0f);
        u8g2.drawFrame(14, 46, 100, 10);   // border
        if (barWidth > 0) {
            u8g2.drawBox(14, 46, barWidth, 10);
        }
    }

    u8g2.sendBuffer();
}

// =============================================================================
// setup
// =============================================================================

void setup() {
    Serial.begin(115200);
    delay(200);   // let the serial port settle

    Serial.println("MIC:BOOT");

    // ── OLED ──────────────────────────────────────────────────────────────────
    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
    u8g2.begin();
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x10_tr);

    const char* bootMsg = "MIC TEST";
    int16_t bw = (int16_t)u8g2.getStrWidth(bootMsg);
    u8g2.drawStr((128 - bw) / 2, 32, bootMsg);
    u8g2.sendBuffer();

    Serial.println("MIC:OLED_OK");

    // ── I2S ───────────────────────────────────────────────────────────────────
    if (!i2s_init()) {
        Serial.println("MIC:I2S_FAIL");
        oled_show_status(0.0f, /*error=*/true);
        // Halt here — nothing more to do without the mic
        while (true) { delay(1000); }
    }

    Serial.println("MIC:I2S_OK");
    Serial.printf("MIC:CONFIG BCLK=%d WS=%d SD=%d SR=%d\n",
                  (int)I2S_BCLK_PIN, (int)I2S_WS_PIN,
                  (int)I2S_SD_PIN, SAMPLE_RATE);

    lastReportMs = millis();
    lastOledMs   = millis();
}

// =============================================================================
// loop
// =============================================================================

void loop() {
    // ── Read one DMA buffer of audio ──────────────────────────────────────────
    size_t bytesRead = 0;
    esp_err_t err = i2s_read(I2S_PORT,
                              sampleBuf,
                              sizeof(sampleBuf),
                              &bytesRead,
                              pdMS_TO_TICKS(50));   // 50 ms timeout

    if (err == ESP_OK && bytesRead > 0) {
        int numSamples = (int)(bytesRead / sizeof(int32_t));

        // Compute RMS and peak for this buffer
        float sumSq  = 0.0f;
        float bufPeak = 0.0f;

        for (int i = 0; i < numSamples; i++) {
            // INMP441 data is in upper 18 bits; shift to get signed value
            int32_t raw    = sampleBuf[i] >> INMP441_SHIFT;
            float   sample = (float)raw / INMP441_MAX;  // normalise to ±1.0

            sumSq += sample * sample;

            float absSample = fabsf(sample);
            if (absSample > bufPeak) bufPeak = absSample;

            // Check for ADC saturation (18-bit: ±131071)
            if (raw >= 131071 || raw <= -131072) gClip = true;
        }

        float bufRms = sqrtf(sumSq / (float)numSamples);

        gAccumRmsSum += bufRms;
        gReadCount++;
        if (bufPeak > gPeak) gPeak = bufPeak;
    }

    // ── Serial report ─────────────────────────────────────────────────────────
    unsigned long now = millis();
    if (now - lastReportMs >= REPORT_INTERVAL_MS) {
        float reportRms = (gReadCount > 0)
                          ? (gAccumRmsSum / (float)gReadCount)
                          : 0.0f;

        Serial.printf("MIC:LEVEL=%.5f\n", reportRms);
        Serial.printf("MIC:PEAK=%.5f\n",  gPeak);
        Serial.printf("MIC:CLIP=%d\n",    gClip ? 1 : 0);

        // Reset accumulators
        gAccumRmsSum = 0.0f;
        gPeak        = 0.0f;
        gReadCount   = 0;
        gClip        = false;
        lastReportMs = now;
    }

    // ── OLED refresh ──────────────────────────────────────────────────────────
    if (now - lastOledMs >= OLED_UPDATE_MS) {
        float displayRms = (gReadCount > 0)
                           ? (gAccumRmsSum / (float)gReadCount)
                           : 0.0f;
        oled_show_status(displayRms, /*error=*/false);
        lastOledMs = now;
    }
}

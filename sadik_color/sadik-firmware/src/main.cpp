// =============================================================================
// SADIK Firmware — main.cpp
// ESP32-S3 N16R8 + ST7735S 160×128 SPI TFT (Color, MJPEG playback)
// =============================================================================
//
// Color Sprint-8: Bitbank2 stack migration (JPEGDEC + LovyanGFX).
// Single render path: AnimationEngine → MjpegPlayer → JPEGDEC → LovyanGFX → TFT.
// Clips stored on LittleFS as /clips/<name>.mjpeg (MJPEG container).
// =============================================================================

#include "config.h"
#include "display_manager.h"
#include "serial_commander.h"
#include "text_renderer.h"
#include "mjpeg_player.h"       // MJPEG playback (replaces codec + local_clip_player)
#include "rtos_tasks.h"         // Sprint-5 W2A: FreeRTOS task split foundation
#include "animation_engine.h"   // Color S6-W1: idle orchestration engine

// ── Playback mode ─────────────────────────────────────────────────────────────

enum PlaybackMode {
    MODE_BOOT,
    MODE_IDLE,
    MODE_EXPLICIT_CLIP,    // kept for CMD_PLAY_CLIP legacy command (routes to PLAY_LOCAL)
    MODE_LOCAL_CLIP,       // playing a clip from LittleFS via MjpegPlayer
    MODE_TEXT,
    MODE_FRAME_STREAM,     // app is streaming raw frames via FRAME: command
};

// ── Global singletons (construction order matters) ────────────────────────────

DisplayManager   display;
SerialCommander  serialCmd;
TextRenderer     textRenderer(display);   // needs display
MjpegPlayer      mjpegPlayer;             // LittleFS MJPEG playback
PlaybackMode     currentMode = MODE_BOOT;
AnimationEngine  animationEngine(mjpegPlayer);  // idle orchestration

// ── Sleep state ───────────────────────────────────────────────────────────────
// sleepTimeoutMs: inactivity duration (ms) before the display is powered off.
//   0 = disabled — the display never sleeps automatically.
// lastActivityMs: millis() timestamp of the last meaningful visual command.
// sleepPausedIdle: true when idle was paused to enter sleep, so ensureAwake()
//   resumes the engine on wake.

unsigned long sleepTimeoutMs  = 600000UL;  // 10 minutes default; 0 = disabled
unsigned long lastActivityMs  = 0;
bool          sleepPausedIdle = false;

// ── App-connection authority flag ─────────────────────────────────────────────
// appConnected: true while the desktop app is connected and acting as the sole
//   animation authority.  Firmware autonomous idle orchestration is suppressed;
//   the app drives every clip change via serial commands.
// Cleared on reboot so the device always starts in standalone autonomous mode.

bool appConnected = false;

// ── Forward declarations ──────────────────────────────────────────────────────

void processCommand(ParsedCommand& cmd);
void markActivity(const char* reason);
void ensureAwake(const char* reason);

// =============================================================================
// markActivity
// =============================================================================

void markActivity(const char* reason) {
    lastActivityMs = millis();
    char buf[80];
    snprintf(buf, sizeof(buf), "DEBUG:ACTIVITY reason=%s", reason);
    Serial.println(buf);
}

// =============================================================================
// ensureAwake
// =============================================================================

void ensureAwake(const char* reason) {
    if (!display.isSleeping()) return;

    char buf[80];
    snprintf(buf, sizeof(buf), "DEBUG:SLEEP_WAKE reason=%s", reason);
    Serial.println(buf);

    display.wakeDisplay();

    if (sleepPausedIdle) {
        sleepPausedIdle = false;
        if (currentMode == MODE_IDLE) {
            animationEngine.resume();
        }
    }
}

// =============================================================================
// setup
// =============================================================================

void setup() {
    serialCmd.begin();   // Serial.begin(SERIAL_BAUD) + reset parser state

    // USB-CDC host re-enumerates after EN/RST; any println in the first ~150-300ms
    // is dropped before the monitor reattaches. Wait so BOOT:HW lands in the log.
    delay(300);

    // ── Hardware identity log — verify PSRAM + flash on every boot ───────────
    // Expected on N16R8: psram_size=8388608 (8MB), flash=16777216 (16MB).
    // If psram_size=0 → memory_type wrong; try opi_opi in platformio.ini.
    {
        uint32_t psramSize  = ESP.getPsramSize();
        uint32_t psramFree  = ESP.getFreePsram();
        uint32_t flashSize  = ESP.getFlashChipSize();
        char hwBuf[96];
        snprintf(hwBuf, sizeof(hwBuf),
                 "BOOT:HW psram_size=%u psram_free=%u flash=%u",
                 psramSize, psramFree, flashSize);
        Serial.println(hwBuf);
        Serial.flush();
    }

    display.begin();     // SPI init + TFT controller init (prints BOOT:OK to serial)

    // ── MJPEG player init ─────────────────────────────────────────────────────
    mjpegPlayer.begin(display.tft());   // mounts LittleFS, inits JPEGDEC

    // ── Boot splash ───────────────────────────────────────────────────────────
    display.drawRainbowText("COLOR");
    delay(2000);

    display.drawText("Hazir");
    delay(1000);

    // ── Seed random number generator ──────────────────────────────────────────
    randomSeed(static_cast<unsigned long>(analogRead(0)) + millis());

    // ── Enter idle mode ───────────────────────────────────────────────────────
    currentMode = MODE_IDLE;
    // AnimationEngine drives idle/blink/variation via MjpegPlayer.
    animationEngine.begin();

    // ── Device profile publish (Multi-device Sprint-1 handshake) ────────────
    // App-side parser reads the first N serial lines and extracts DeviceProfile.
    Serial.println("DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.7.0 caps=local_clips,mjpeg");

    // ── Manifest publish ─────────────────────────────────────────────────────
    // Boot'ta available clip listesini publish et; app parse edecek.
    {
        bool published = false;
        if (mjpegPlayer.isReady()) {
            File mf = LittleFS.open("/manifest.json", "r");
            if (mf) {
                // Simple JSON name extraction — find all "name":"..." pairs.
                String json = mf.readString();
                mf.close();
                Serial.print("MANIFEST:");
                bool first = true;
                int pos = 0;
                while (true) {
                    int ni = json.indexOf("\"name\":", pos);
                    if (ni < 0) break;
                    ni += 7; // skip "name":
                    // skip whitespace + opening quote
                    while (ni < (int)json.length() && (json[ni] == ' ' || json[ni] == '"')) ni++;
                    int ne = json.indexOf('"', ni);
                    if (ne < 0) break;
                    String name = json.substring(ni, ne);
                    if (!first) Serial.print(',');
                    Serial.print(name);
                    first = false;
                    pos = ne + 1;
                }
                Serial.println();
                published = true;
            }
        }
        if (!published) {
            // Fallback static list (matches manifest.json clip set)
            Serial.println("MANIFEST:blink,break_text,confirming,didnthear,done,idle,"
                           "idle_alt_left_look,idle_alt_look_down,idle_alt_right_look,"
                           "listening,mode_break,mode_gaming,mode_gaming_text,"
                           "mode_meeting_text,mode_working,mode_working_text,"
                           "return_to_idle,talking,thinking,understanding,wakeword");
        }
    }

    // ── Sprint-5 W2A: spawn FreeRTOS task scaffolding (stubs) ────────────────
    rtos_init();

    markActivity("BOOT");

    Serial.println("SADIK:READY");
}

// =============================================================================
// processCommand
// =============================================================================

void processCommand(ParsedCommand& cmd) {
    char resp[256];

    switch (cmd.type) {

        // ── PLAY_CLIP:<name> ──────────────────────────────────────────────────
        // Legacy command — routes to PLAY_LOCAL logic.
        case CMD_PLAY_CLIP: {
            ensureAwake("PLAY_CLIP");
            markActivity("PLAY_CLIP");
            animationEngine.playEvent(cmd.argument);
            currentMode = MODE_LOCAL_CLIP;
            snprintf(resp, sizeof(resp), "OK:PLAYING:%s", cmd.argument);
            Serial.println(resp);
            break;
        }

        // ── PLAY_LOCAL:<name> ─────────────────────────────────────────────────
        case CMD_PLAY_LOCAL: {
            // Clips known to be looping (loop:true in manifest.json).
            static const char* LOOP_CLIPS[] = {
                "idle", "break_text",
                "mode_working_text", "mode_gaming_text", "mode_meeting_text",
            };
            static const uint8_t LOOP_CLIPS_COUNT = 5;
            bool loopClip = false;
            for (uint8_t i = 0; i < LOOP_CLIPS_COUNT; i++) {
                if (strcmp(cmd.argument, LOOP_CLIPS[i]) == 0) {
                    loopClip = true;
                    break;
                }
            }

            {
                char dbg[80];
                snprintf(dbg, sizeof(dbg), "[clip] PLAY_LOCAL name=%s loop=%d ae_state=%d",
                         cmd.argument, (int)loopClip, (int)animationEngine.state());
                Serial.println(dbg);
            }

            animationEngine.playEvent(cmd.argument, loopClip);
            currentMode = MODE_LOCAL_CLIP;
            markActivity("PLAY_LOCAL");
            break;
        }

        // ── STOP_CLIP ─────────────────────────────────────────────────────────
        case CMD_STOP_CLIP: {
            ensureAwake("STOP_CLIP");
            markActivity("STOP_CLIP");

            if (currentMode == MODE_EXPLICIT_CLIP || currentMode == MODE_LOCAL_CLIP) {
                currentMode = MODE_IDLE;
                if (appConnected) {
                    animationEngine.stop();
                } else {
                    animationEngine.resume();
                }
            }
            Serial.println("OK:STOPPED");
            break;
        }

        // ── SHOW_TEXT:<text> ──────────────────────────────────────────────────
        case CMD_SHOW_TEXT: {
            ensureAwake("SHOW_TEXT");
            markActivity("SHOW_TEXT");

            animationEngine.stop();
            currentMode = MODE_TEXT;

            size_t argLen     = strlen(cmd.argument);
            bool   isTimerStr = (argLen <= 5 && strchr(cmd.argument, ':') != nullptr);

            if (isTimerStr) {
                textRenderer.showTimer(cmd.argument);
            } else {
                textRenderer.showText(cmd.argument);
            }

            snprintf(resp, sizeof(resp), "OK:TEXT:%s", cmd.argument);
            Serial.println(resp);
            break;
        }

        // ── RETURN_TO_IDLE ────────────────────────────────────────────────────
        case CMD_RETURN_TO_IDLE: {
            ensureAwake("RETURN_TO_IDLE");
            markActivity("RETURN_TO_IDLE");

            textRenderer.clear();
            currentMode = MODE_IDLE;
            if (appConnected) {
                animationEngine.stop();
            } else {
                animationEngine.resume();
            }
            Serial.println("OK:IDLE");
            break;
        }

        // ── PING ──────────────────────────────────────────────────────────────
        case CMD_PING: {
            Serial.println("PONG");
            break;
        }

        // ── DEVICE? ───────────────────────────────────────────────────────────
        case CMD_DEVICE_QUERY: {
            Serial.println("DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.7.0 caps=local_clips,mjpeg");
            break;
        }

        // ── STATUS ────────────────────────────────────────────────────────────
        case CMD_STATUS: {
            uint8_t       brightness   = display.getBrightness();
            uint8_t       sleeping     = display.isSleeping() ? 1 : 0;
            unsigned long stMs         = sleepTimeoutMs;
            unsigned long inactivityMs = millis() - lastActivityMs;

            const char* modeStr;
            const char* clipName = nullptr;
            switch (currentMode) {
                case MODE_BOOT:          modeStr = "BOOT";         break;
                case MODE_IDLE:          modeStr = "IDLE";         break;
                case MODE_EXPLICIT_CLIP:
                case MODE_LOCAL_CLIP:
                    modeStr  = "LOCAL_CLIP";
                    clipName = animationEngine.currentClipName();
                    break;
                case MODE_TEXT:          modeStr = "TEXT";         break;
                case MODE_FRAME_STREAM:  modeStr = "FRAME_STREAM"; break;
                default:                 modeStr = "UNKNOWN";      break;
            }

            const char* appStr = appConnected ? "CONNECTED" : "DISCONNECTED";
            if (clipName) {
                snprintf(resp, sizeof(resp),
                         "STATUS:MODE=%s:%s,APP=%s,SLEEPING=%u,SLEEP_TIMEOUT_MS=%lu,BRIGHTNESS=%u,INACTIVITY_MS=%lu",
                         modeStr, clipName, appStr, sleeping, stMs, brightness, inactivityMs);
            } else {
                snprintf(resp, sizeof(resp),
                         "STATUS:MODE=%s,APP=%s,SLEEPING=%u,SLEEP_TIMEOUT_MS=%lu,BRIGHTNESS=%u,INACTIVITY_MS=%lu",
                         modeStr, appStr, sleeping, stMs, brightness, inactivityMs);
            }
            Serial.println(resp);
            break;
        }

        // ── SET_BRIGHTNESS:<value> ────────────────────────────────────────────
        case CMD_SET_BRIGHTNESS: {
            if (cmd.argument[0] == '\0') {
                Serial.println("ERR:INVALID_BRIGHTNESS");
                break;
            }
            long val = atol(cmd.argument);
            if (val < 0)   val = 0;
            if (val > 255) val = 255;

            ensureAwake("SET_BRIGHTNESS");
            markActivity("SET_BRIGHTNESS");

            display.setBrightness(static_cast<uint8_t>(val));
            snprintf(resp, sizeof(resp), "OK:BRIGHTNESS:%ld", val);
            Serial.println(resp);
            break;
        }

        // ── SET_SLEEP_TIMEOUT_MS:<milliseconds> ───────────────────────────────
        case CMD_SET_SLEEP_TIMEOUT: {
            if (cmd.argument[0] == '\0') {
                Serial.println("ERR:INVALID_SLEEP_TIMEOUT");
                break;
            }
            long val = atol(cmd.argument);
            if (val < 0) {
                Serial.println("ERR:INVALID_SLEEP_TIMEOUT");
                break;
            }
            sleepTimeoutMs = (unsigned long)val;
            markActivity("SET_SLEEP_TIMEOUT");
            snprintf(resp, sizeof(resp), "OK:SLEEP_TIMEOUT:%lu", sleepTimeoutMs);
            Serial.println(resp);
            break;
        }

        // ── FORCE_SLEEP ───────────────────────────────────────────────────────
        case CMD_FORCE_SLEEP: {
            if (display.isSleeping()) {
                Serial.println("OK:FORCE_SLEEP already_sleeping");
                break;
            }
            if (currentMode == MODE_IDLE) {
                animationEngine.stop();
                sleepPausedIdle = true;
            }
            Serial.println("DEBUG:SLEEP_TRIGGER elapsed=forced timeout=0 mode=FORCED");
            display.sleepDisplay();
            Serial.println("DEBUG:SLEEP_ENTER");
            Serial.println("OK:FORCE_SLEEP");
            break;
        }

        // ── APP_CONNECTED ─────────────────────────────────────────────────────
        case CMD_APP_CONNECTED: {
            appConnected = true;
            if (currentMode == MODE_IDLE) {
                // Stop engine; app will drive clips directly via PLAY_LOCAL.
                animationEngine.stop();
            }
            Serial.println("OK:APP_CONNECTED");
            break;
        }

        // ── ABORT_STREAM ──────────────────────────────────────────────────────
        // No-op in MJPEG mode (no codec stream), kept for protocol compat.
        case CMD_ABORT_STREAM: {
            Serial.println("OK:ABORTED");
            break;
        }

        // ── APP_DISCONNECTED ──────────────────────────────────────────────────
        case CMD_APP_DISCONNECTED: {
            appConnected = false;
            textRenderer.clear();
            currentMode = MODE_IDLE;
            animationEngine.resume();
            Serial.println("OK:APP_DISCONNECTED");
            break;
        }

        // ── FRAME:<binary data> ───────────────────────────────────────────────
        case CMD_FRAME_DATA: {
            if (!appConnected) {
                Serial.println("ERR:APP_NOT_CONNECTED");
                break;
            }

            ensureAwake("FRAME");
            markActivity("FRAME");

            if (currentMode != MODE_FRAME_STREAM) {
                animationEngine.stop();
                textRenderer.clear();
                currentMode = MODE_FRAME_STREAM;
            }

            display.pushFrameRgb565(cmd.frameData);
            Serial.println("OK:FRAME");
            break;
        }

        // ── STATS:ON / STATS:OFF ──────────────────────────────────────────────
        // Per-frame MJPEG timing log (default OFF to avoid serial spam).
        case CMD_STATS_ON: {
            mjpegPlayer.setStatsFrame(true);
            Serial.println("OK:STATS:ON");
            break;
        }
        case CMD_STATS_OFF: {
            mjpegPlayer.setStatsFrame(false);
            Serial.println("OK:STATS:OFF");
            break;
        }

        // ── STATS:SUMMARY:ON / STATS:SUMMARY:OFF ─────────────────────────────
        // Per-clip summary log (default ON).
        case CMD_STATS_SUMMARY_ON: {
            mjpegPlayer.setStatsSummary(true);
            Serial.println("OK:STATS:SUMMARY:ON");
            break;
        }
        case CMD_STATS_SUMMARY_OFF: {
            mjpegPlayer.setStatsSummary(false);
            Serial.println("OK:STATS:SUMMARY:OFF");
            break;
        }

        // ── Unknown / unhandled ───────────────────────────────────────────────
        case CMD_UNKNOWN:
        case CMD_NONE:
        default:
            Serial.println("ERR:UNKNOWN_COMMAND");
            break;
    }
}

// =============================================================================
// loop
// =============================================================================

void loop() {
    // 0. Serial dispatch — SADIK_COLOR: always ASCII commands, no codec stream.
    if (serialCmd.hasCommand()) {
        ParsedCommand cmd = serialCmd.getCommand();
        processCommand(cmd);
    }

    // 1. Advance MJPEG playback (LittleFS → JPEGDEC → LovyanGFX → TFT).
    //    Runs in MODE_IDLE and MODE_LOCAL_CLIP.
    if ((currentMode == MODE_IDLE || currentMode == MODE_LOCAL_CLIP) && !display.isSleeping()) {
        mjpegPlayer.update();
        // hasFinished() only matters for explicit one-shot clips (MODE_LOCAL_CLIP).
        // In MODE_IDLE, AnimationEngine.update() handles transitions internally.
        if (currentMode == MODE_LOCAL_CLIP && mjpegPlayer.hasFinished()) {
            currentMode = MODE_IDLE;
            display.clearScreen();
            markActivity("LOCAL_CLIP_DONE");
            Serial.println("EVENT:LOCAL_CLIP_FINISHED");
        }
    }

    // 2. Drive idle orchestration (AnimationEngine state machine).
    //    Ticks during MODE_LOCAL_CLIP so engine catches hasFinished() and
    //    auto-returns to idle after a PLAY_LOCAL one-shot completes.
    if ((currentMode == MODE_IDLE || currentMode == MODE_LOCAL_CLIP) &&
        !display.isSleeping() && !appConnected) {
        animationEngine.update();
    }

    // 3. OLED sleep check.
    if (sleepTimeoutMs > 0 &&
        !display.isSleeping() &&
        currentMode != MODE_EXPLICIT_CLIP &&
        currentMode != MODE_LOCAL_CLIP &&
        currentMode != MODE_FRAME_STREAM &&
        currentMode != MODE_BOOT) {

        unsigned long elapsed = millis() - lastActivityMs;
        if (elapsed >= sleepTimeoutMs) {
            const char* modeStr =
                (currentMode == MODE_IDLE) ? "IDLE" :
                (currentMode == MODE_TEXT) ? "TEXT" : "UNKNOWN";
            char trigBuf[96];
            snprintf(trigBuf, sizeof(trigBuf),
                     "DEBUG:SLEEP_TRIGGER elapsed=%lu timeout=%lu mode=%s",
                     elapsed, sleepTimeoutMs, modeStr);
            Serial.println(trigBuf);

            if (currentMode == MODE_IDLE) {
                animationEngine.stop();
                sleepPausedIdle = true;
            }
            display.sleepDisplay();
            Serial.println("DEBUG:SLEEP_ENTER");
        }
    }

    // 4. Yield to the ESP32 RTOS scheduler and reset the watchdog timer.
    yield();
}

// =============================================================================
// SADIK Firmware — main.cpp
// ESP32-S3 N16R8 + ST7735S 160×128 SPI TFT (Color, single render path)
// =============================================================================
//
// Color Sprint-6 Wave-2: legacy ClipPlayer/IdleOrchestrator path removed.
// Single render path: AnimationEngine → LocalClipPlayer → codec_feed → TFT.
// =============================================================================

#include "config.h"
#include "display_manager.h"
#include "serial_commander.h"
#include "text_renderer.h"
#include "codec_decode.h"        // streaming codec decoder
#include "local_clip_player.h"   // LittleFS local clip playback
#include "rtos_tasks.h"          // Sprint-5 W2A: FreeRTOS task split foundation
#include "animation_engine.h"    // Color S6-W1: codec/LittleFS idle engine

// ── Playback mode ─────────────────────────────────────────────────────────────

enum PlaybackMode {
    MODE_BOOT,
    MODE_IDLE,
    MODE_EXPLICIT_CLIP,    // kept for CMD_PLAY_CLIP legacy command (no-op path)
    MODE_LOCAL_CLIP,       // playing a clip from LittleFS via LocalClipPlayer
    MODE_TEXT,
    MODE_FRAME_STREAM,     // app is streaming raw frames via FRAME: command
};

// ── Global singletons (construction order matters) ────────────────────────────

DisplayManager   display;
SerialCommander  serialCmd;
TextRenderer     textRenderer(display);     // needs display
LocalClipPlayer  localClipPlayer;           // LittleFS local clip playback
PlaybackMode     currentMode = MODE_BOOT;
AnimationEngine  animationEngine(localClipPlayer); // Color S6-W1: codec idle engine

// ── OLED sleep state ──────────────────────────────────────────────────────────
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
//   animation authority.  Firmware autonomous idle orchestration (blink / look
//   timers) is suppressed; the app drives every clip change via serial commands.
// Cleared on reboot so the device always starts in standalone autonomous mode.

bool appConnected = false;

// ── Forward declarations ──────────────────────────────────────────────────────

void processCommand(ParsedCommand& cmd);
void markActivity(const char* reason);
void ensureAwake(const char* reason);
void onCodecFrameReady(uint16_t seq, uint8_t type);

// ── Codec byte-routing ────────────────────────────────────────────────────────
// When 0xC5 magic byte arrives, route raw bytes to codec_feed() instead of
// SerialCommander.  Both paths are active simultaneously; codec_feed() hunts
// for 0xC5 itself, so we simply drain all available bytes into it when a
// codec stream is in flight (appConnected must be true).
// Scratch buffer for batched Serial.readBytes() → codec_feed() calls.
static uint8_t _codecScratch[256];

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
    serialCmd.begin();      // Serial.begin(SERIAL_BAUD) + reset parser state
    display.begin();        // SPI init + TFT controller init (prints BOOT:OK to serial)

    // ── Codec decoder init ────────────────────────────────────────────────────
    codec_init(display.tft());
    codec_on_frame_ready(onCodecFrameReady);

    localClipPlayer.begin();     // mount LittleFS

    // ── Boot splash ───────────────────────────────────────────────────────────
    display.drawRainbowText("COLOR");
    delay(2000);

    display.drawText("Hazir");
    delay(1000);

    // ── Seed random number generator ──────────────────────────────────────────
    randomSeed(static_cast<unsigned long>(analogRead(0)) + millis());

    // ── Enter idle mode ───────────────────────────────────────────────────────
    currentMode = MODE_IDLE;
    // AnimationEngine drives idle/blink/variation via codec/LittleFS path.
    // Standalone mode: ACKs disabled (no host). begin() sets ack_enabled=false.
    animationEngine.begin();

    // ── Device profile publish (Multi-device Sprint-1 handshake) ────────────
    // App-side parser reads the first N serial lines and extracts DeviceProfile.
    // Must come before MANIFEST: and SADIK:READY so the parser sees it early.
    Serial.println("DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.6.0 caps=local_clips");

    // ── Manifest publish (Multi-device Sprint-1 handshake) ───────────────────
    // Boot'ta available clip listesini publish et; app parse edecek.
    {
        // LittleFS manifest.json'dan clip isimlerini oku ve virgüllü liste bas.
        // Fallback: sabit liste (LittleFS mount fail durumunda).
        bool published = false;
        if (localClipPlayer.isReady()) {
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
            // Fallback static list (matches current manifest.json clip set)
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
        // Legacy command kept for backwards-compat. Routes to PLAY_LOCAL.
        case CMD_PLAY_CLIP: {
            ensureAwake("PLAY_CLIP");
            markActivity("PLAY_CLIP");
            codec_set_ack_enabled(false);
            animationEngine.playEvent(cmd.argument);
            currentMode = MODE_LOCAL_CLIP;
            snprintf(resp, sizeof(resp), "OK:PLAYING:%s", cmd.argument);
            Serial.println(resp);
            break;
        }

        // ── PLAY_LOCAL:<name> ─────────────────────────────────────────────────
        case CMD_PLAY_LOCAL: {
            codec_set_ack_enabled(false);

            // Clips known to be looping (loop:true in manifest.json).
            // These must be played with loop=true so they keep running until
            // the app sends STOP_CLIP or the next PLAY_LOCAL.
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
                    // App is authority — will send next PLAY_LOCAL itself.
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

            size_t argLen       = strlen(cmd.argument);
            bool   isTimerStr   = (argLen <= 5 && strchr(cmd.argument, ':') != nullptr);

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
                // App is authority — will send next PLAY_LOCAL itself.
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
        // Host queries device profile at any time (e.g. after reset or when the
        // boot-time DEVICE: line was missed).  Re-emit the same line so the
        // backend can capture it and broadcast device_profile to the app.
        // Bug 2 fix: deterministic handshake independent of connection timing.
        case CMD_DEVICE_QUERY: {
            Serial.println("DEVICE:variant=color hw=esp32-s3-n16r8 display=160x128_rgb565 fw=0.6.0 caps=local_clips");
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

        // ── FORCE_SLEEP (debug aid) ───────────────────────────────────────────
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
            // App streaming path uses binary ACK packets — re-enable them.
            codec_set_ack_enabled(true);
            if (currentMode == MODE_IDLE) {
                // Stop engine; app will drive clips directly via PLAY_LOCAL.
                animationEngine.stop();
            }
            Serial.println("OK:APP_CONNECTED");
            break;
        }

        // ── ABORT_STREAM ──────────────────────────────────────────────────────
        case CMD_ABORT_STREAM: {
            codec_abort();
            Serial.println("OK:ABORTED");
            break;
        }

        // ── APP_DISCONNECTED ──────────────────────────────────────────────────
        case CMD_APP_DISCONNECTED: {
            appConnected = false;
            textRenderer.clear();
            currentMode = MODE_IDLE;
            animationEngine.resume();  // also calls codec_set_ack_enabled(false)
            Serial.println("OK:APP_DISCONNECTED");
            break;
        }

        // ── FRAME:<hex data> ─────────────────────────────────────────────────
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

        // ── Unknown / unhandled ───────────────────────────────────────────────
        case CMD_UNKNOWN:
        case CMD_NONE:
        default:
            Serial.println("ERR:UNKNOWN_COMMAND");
            break;
    }
}

// =============================================================================
// onCodecFrameReady
// Called by codec_decode after each successfully applied frame packet.
// =============================================================================

void onCodecFrameReady(uint16_t seq, uint8_t type) {
    ensureAwake("CODEC_FRAME");
    lastActivityMs = millis();

    // LOCAL_CLIP and IDLE modes both use localClipPlayer as byte source.
    // Do NOT clobber mode to FRAME_STREAM for those paths.
    if (currentMode != MODE_FRAME_STREAM &&
        currentMode != MODE_LOCAL_CLIP  &&
        currentMode != MODE_IDLE) {
        animationEngine.stop();
        textRenderer.clear();
        currentMode = MODE_FRAME_STREAM;
    }
    (void)seq; (void)type;
}

// =============================================================================
// loop
// =============================================================================

void loop() {
    // 0. Serial dispatch — variant-aware.
    //
    // SADIK_COLOR: firmware plays LittleFS clips; no codec stream expected from
    //   the host.  SerialCommander handles ALL ASCII commands (PLAY_LOCAL,
    //   ABORT_STREAM, handshake, etc.) regardless of appConnected state.
    //
    // Mini (else): when appConnected, route all bytes to codec_feed() for binary
    //   frame streaming.  SerialCommander is gated on !appConnected to avoid a
    //   UART semaphore race under high codec streaming rates.
#ifdef SADIK_COLOR
    codec_tick();
    // Always process ASCII commands on color variant — no codec byte stream.
    if (serialCmd.hasCommand()) {
        ParsedCommand cmd = serialCmd.getCommand();
        processCommand(cmd);
    }
#else
    codec_tick();
    if (appConnected && Serial.available() > 0) {
        size_t avail = (size_t)Serial.available();
        while (avail > 0) {
            size_t chunk = (avail < sizeof(_codecScratch)) ? avail : sizeof(_codecScratch);
            size_t got   = Serial.readBytes(_codecScratch, chunk);
            if (got == 0) break;
            codec_feed(_codecScratch, got);
            avail = (size_t)Serial.available();
        }
        return;
    }

    // 1. Non-blocking serial command check (mini, not connected).
    if (!appConnected && serialCmd.hasCommand()) {
        ParsedCommand cmd = serialCmd.getCommand();
        processCommand(cmd);
    }
#endif

    // 2. Advance local clip playback (LittleFS → codec_feed).
    //    Runs in MODE_IDLE (idle.bin looping via AnimationEngine) and
    //    MODE_LOCAL_CLIP (explicit one-shot event clips).
    if ((currentMode == MODE_IDLE || currentMode == MODE_LOCAL_CLIP) && !display.isSleeping()) {
        localClipPlayer.update();
        // hasFinished() only matters for explicit one-shot clips (MODE_LOCAL_CLIP).
        // In MODE_IDLE, AnimationEngine.update() handles transitions internally.
        if (currentMode == MODE_LOCAL_CLIP && localClipPlayer.hasFinished()) {
            currentMode = MODE_IDLE;
            display.clearScreen();   // wipe codec's last full-screen frame
            // AnimationEngine handles its own state transition to idle internally
            // via update() — no explicit resume() needed here.
            markActivity("LOCAL_CLIP_DONE");
            Serial.println("EVENT:LOCAL_CLIP_FINISHED");
        }
    }

    // 3. Drive idle orchestration (AnimationEngine state machine).
    //    Ticks during MODE_LOCAL_CLIP so engine catches hasFinished() and
    //    auto-returns to idle after a PLAY_LOCAL one-shot completes.
    if ((currentMode == MODE_IDLE || currentMode == MODE_LOCAL_CLIP) &&
        !display.isSleeping() && !appConnected) {
        animationEngine.update();
    }

    // 4. OLED sleep check.
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

    // 5. Yield to the ESP32 RTOS scheduler and reset the watchdog timer.
    yield();
}

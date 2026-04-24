// =============================================================================
// SADIK Firmware — main.cpp
// ESP32-WROOM-32 + ST7735S 160×128 SPI TFT (Faz 1 colour swap)
// =============================================================================

#include "config.h"
#include "display_manager.h"
#include "clip_player.h"
#include "clip_registry.h"       // ClipDefinition instances + findClipByName
#include "idle_orchestrator.h"   // also pulls in clip_registry.h (guarded)
#include "serial_commander.h"
#include "text_renderer.h"
#include "codec_decode.h"        // Sprint-2 F3.3: streaming codec decoder

// ── Playback mode ─────────────────────────────────────────────────────────────

enum PlaybackMode {
    MODE_BOOT,
    MODE_IDLE,
    MODE_EXPLICIT_CLIP,
    MODE_TEXT,
    MODE_FRAME_STREAM,     // app is streaming raw frames via FRAME: command
};

// ── Global singletons (construction order matters) ────────────────────────────

DisplayManager   display;                   // owns the U8g2 instance
ClipPlayer       clipPlayer(display);       // needs display
IdleOrchestrator idleOrchestrator(clipPlayer); // needs clipPlayer
SerialCommander  serialCmd;
TextRenderer     textRenderer(display);     // needs display
PlaybackMode     currentMode = MODE_BOOT;

// ── OLED sleep state ──────────────────────────────────────────────────────────
// sleepTimeoutMs: inactivity duration (ms) before the display is powered off.
//   0 = disabled — the display never sleeps automatically.
// lastActivityMs: millis() timestamp of the last meaningful visual command.
// sleepPausedIdle: true when the idle orchestrator was paused specifically to
//   enter sleep, so ensureAwake() knows to resume it on wake.

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
// Record that a meaningful visual command has just been processed.
// Resets the inactivity countdown and logs the reason so serial monitor shows
// exactly which command is keeping the display alive.
// =============================================================================

void markActivity(const char* reason) {
    lastActivityMs = millis();
    char buf[80];
    snprintf(buf, sizeof(buf), "DEBUG:ACTIVITY reason=%s", reason);
    Serial.println(buf);
}

// =============================================================================
// ensureAwake
// If the display is currently sleeping, power it back on and restart any
// animation that was suspended to save work while asleep.
// Call this at the top of every command handler that produces visible output.
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
            idleOrchestrator.resume();
        }
    }
}

// =============================================================================
// setup
// =============================================================================

void setup() {
    serialCmd.begin();      // Serial.begin(SERIAL_BAUD) + reset parser state
    display.begin();        // SPI init + TFT controller init (prints BOOT:OK to serial)

    // ── Codec decoder init (Sprint-2 F3.3) ───────────────────────────────────
    // Allocates 40 KB heap framebuffer; must come after display.begin() so
    // we know the TFT object is fully initialised.
    {
        // DisplayManager wraps Adafruit_ST7735 privately; we access the TFT
        // directly by exposing it via the codec path.  The decoder needs the
        // raw Adafruit_ST7735 pointer, which DisplayManager holds privately.
        // Work-around: pass nullptr here and let codec_decode call
        // display.pushFrameRgb565() / pushTileRgb565() via the callback.
        // Actual blit is handled in onCodecFrameReady — see below.
        codec_init(display.tft());   // pass raw ST7735 pointer for tile blits
        codec_on_frame_ready(onCodecFrameReady);
    }

    // ── Boot splash ───────────────────────────────────────────────────────────
    // drawTwoLineText writes to TFT directly; sendBuffer is a no-op for text paths.
    display.drawTwoLineText("SADIK", "v2.0");
    delay(2000);

    display.drawText("Hazir");
    // Note: sendBuffer() is not called here — text methods write directly to TFT.
    delay(1000);

    // ── Seed random number generator ──────────────────────────────────────────
    // Combine floating ADC noise with elapsed time for decent entropy.
    randomSeed(static_cast<unsigned long>(analogRead(0)) + millis());

    // ── Enter idle mode ───────────────────────────────────────────────────────
    currentMode = MODE_IDLE;
    idleOrchestrator.start();   // plays idle loop + arms blink/variation timers

    // Seed the inactivity timer from the moment we enter idle so the first
    // sleep fires exactly sleepTimeoutMs after boot, not from time 0.
    markActivity("BOOT");

    Serial.println("SADIK:READY");
}

// =============================================================================
// processCommand
// =============================================================================

void processCommand(ParsedCommand& cmd) {
    // Scratch buffer for formatted response strings.  Large enough for the
    // longest possible response (STATUS with all extended fields).
    char resp[256];

    switch (cmd.type) {

        // ── PLAY_CLIP:<name> ──────────────────────────────────────────────────
        case CMD_PLAY_CLIP: {
            const ClipDefinition* clip = findClipByName(cmd.argument);

            if (!clip) {
                snprintf(resp, sizeof(resp), "ERR:CLIP_NOT_FOUND:%s", cmd.argument);
                Serial.println(resp);
                break;
            }

            ensureAwake("PLAY_CLIP");
            markActivity("PLAY_CLIP");

            // Suspend idle before touching the player.
            idleOrchestrator.pause();
            textRenderer.clear();
            currentMode = MODE_EXPLICIT_CLIP;

            // Use the clip's own loop flag.  The idle clip loops; blink and
            // look variations do not.
            clipPlayer.play(clip, clip->loop);

            snprintf(resp, sizeof(resp), "OK:PLAYING:%s", cmd.argument);
            Serial.println(resp);
            break;
        }

        // ── STOP_CLIP ─────────────────────────────────────────────────────────
        case CMD_STOP_CLIP: {
            ensureAwake("STOP_CLIP");
            markActivity("STOP_CLIP");

            clipPlayer.stop();
            if (currentMode == MODE_EXPLICIT_CLIP) {
                currentMode = MODE_IDLE;
                if (appConnected) {
                    // App is authority — restart idle loop; do not arm firmware timers.
                    clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
                } else {
                    idleOrchestrator.resume();
                }
            }
            Serial.println("OK:STOPPED");
            break;
        }

        // ── SHOW_TEXT:<text> ──────────────────────────────────────────────────
        case CMD_SHOW_TEXT: {
            ensureAwake("SHOW_TEXT");
            markActivity("SHOW_TEXT");

            idleOrchestrator.pause();
            clipPlayer.stop();
            currentMode = MODE_TEXT;

            // Heuristic: strings of 5 chars or fewer that contain ':' are
            // treated as MM:SS timers ("25:00", "5:30") and shown in the
            // large font.  Anything longer is shown as regular text.
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

            clipPlayer.stop();
            textRenderer.clear();
            currentMode = MODE_IDLE;
            if (appConnected) {
                // App is authority — restart idle loop without arming firmware timers.
                clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
            } else {
                idleOrchestrator.resume();
            }
            Serial.println("OK:IDLE");
            break;
        }

        // ── PING ──────────────────────────────────────────────────────────────
        case CMD_PING: {
            Serial.println("PONG");
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
                case MODE_BOOT:         modeStr = "BOOT";    break;
                case MODE_IDLE:         modeStr = "IDLE";    break;
                case MODE_EXPLICIT_CLIP:
                    modeStr  = "CLIP";
                    clipName = clipPlayer.currentClipName();
                    break;
                case MODE_TEXT:          modeStr = "TEXT";          break;
                case MODE_FRAME_STREAM: modeStr = "FRAME_STREAM"; break;
                default:                modeStr = "UNKNOWN";       break;
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
            // Clamp to valid contrast register range
            if (val < 0)   val = 0;
            if (val > 255) val = 255;

            // Brightness changes are visible — wake the display.
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
            // Reset the inactivity timer so the new timeout starts from now.
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
                idleOrchestrator.pause();
                sleepPausedIdle = true;
            }
            Serial.println("DEBUG:SLEEP_TRIGGER elapsed=forced timeout=0 mode=FORCED");
            display.sleepDisplay();
            Serial.println("DEBUG:SLEEP_ENTER");
            Serial.println("OK:FORCE_SLEEP");
            break;
        }

        // ── APP_CONNECTED ─────────────────────────────────────────────────────
        // The desktop app is now the sole animation authority.
        // Suppress firmware autonomous idle timers; keep the idle clip looping
        // so the display stays alive while waiting for app-driven commands.
        case CMD_APP_CONNECTED: {
            appConnected = true;
            if (currentMode == MODE_IDLE) {
                idleOrchestrator.pause();
                // Restart idle loop under direct clip-player control (no timers).
                clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
            }
            Serial.println("OK:APP_CONNECTED");
            break;
        }

        // ── APP_DISCONNECTED ──────────────────────────────────────────────────
        // The desktop app has disconnected.  Hand animation authority back to
        // the firmware autonomous idle orchestrator.
        case CMD_APP_DISCONNECTED: {
            appConnected = false;
            // Always return to idle orchestra on disconnect, regardless of current mode.
            // Without this, a TEXT mode (e.g. "TOPLANTI") stays frozen on screen.
            clipPlayer.stop();
            textRenderer.clear();
            currentMode = MODE_IDLE;
            idleOrchestrator.resume();
            Serial.println("OK:APP_DISCONNECTED");
            break;
        }

        // ── FRAME:<hex data> ─────────────────────────────────────────────────
        // Raw 1024-byte frame streamed by the desktop app.  The firmware acts
        // as a dumb display terminal: decode, render, acknowledge.
        case CMD_FRAME_DATA: {
            if (!appConnected) {
                Serial.println("ERR:APP_NOT_CONNECTED");
                break;
            }

            ensureAwake("FRAME");
            markActivity("FRAME");

            // Stop any playing clip / text on first frame
            if (currentMode != MODE_FRAME_STREAM) {
                idleOrchestrator.pause();
                clipPlayer.stop();
                textRenderer.clear();
                currentMode = MODE_FRAME_STREAM;
            }

            display.pushFrameRgb565(cmd.frameData);
            // ACK after the OLED has actually been refreshed. The host uses
            // this to pace frame transmission (one frame in flight at a time)
            // and to keep its on-screen preview in lock-step with the OLED.
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
// onCodecFrameReady — Sprint-2 F3.3
// Called by codec_decode after each successfully applied frame packet.
// Used to update firmware state (wake, activity, mode).
// NOTE: actual blitting is done inside codec_decode.cpp (it holds the TFT ptr).
// =============================================================================

void onCodecFrameReady(uint16_t seq, uint8_t type) {
    ensureAwake("CODEC_FRAME");
    markActivity("CODEC_FRAME");

    if (currentMode != MODE_FRAME_STREAM) {
        idleOrchestrator.pause();
        clipPlayer.stop();
        textRenderer.clear();
        currentMode = MODE_FRAME_STREAM;
    }
    // ACK is emitted by codec_decode directly over Serial (binary packet).
    (void)seq; (void)type;
}

// =============================================================================
// loop
// =============================================================================

void loop() {
    // 0. Codec byte router — Sprint-2 F3.3
    //    When appConnected: peek at the serial buffer. If the first byte is the
    //    codec magic (0xC5), drain all available bytes into codec_feed() in
    //    chunks.  codec_feed() is a state machine that hunts for magic itself,
    //    so passing arbitrary chunks is safe.
    //    The SerialCommander path (step 1) handles non-codec text commands.
    //    Both can coexist because SerialCommander only activates on '\n'-
    //    terminated lines; a codec stream never emits '\n'.
    // When app is connected, route ALL incoming bytes to codec_feed regardless
    // of the first byte.  codec_feed's state machine hunts for the 0xC5 magic
    // itself, so non-magic bytes mid-stream (PFRAME payload contains arbitrary
    // RGB565 data that rarely starts with 0xC5) are still handled correctly.
    // Without this, a peek()!=0xC5 mid-packet would fall through to
    // SerialCommander, which would consume bytes meant for the codec.
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

    // 1. Non-blocking serial command check — parse at most one command per tick.
    //    Skip while app is connected: codec stream owns the UART, and calling
    //    Serial.available() from SerialCommander concurrently with the codec
    //    drain path crashed the UART driver's queue semaphore (observed
    //    consistently during Sprint-2 bring-up).
    if (!appConnected && serialCmd.hasCommand()) {
        ParsedCommand cmd = serialCmd.getCommand();
        processCommand(cmd);
    }

    // 2. Advance animation playback.  ClipPlayer renders a new frame only when
    //    the per-frame interval has elapsed, so this is cheap on most ticks.
    //    Skip while asleep to avoid wasted I2C traffic.
    //    Skip while app is connected — app owns the display (codec stream or
    //    raw frame data). ClipPlayer writing to TFT concurrently with codec
    //    SPI pushes causes bus corruption and crashes.
    if (!display.isSleeping() && !appConnected) {
        clipPlayer.update();
    }

    // 3. Detect when a non-looping explicit clip has played to its end and
    //    automatically return to idle without needing a host command.
    if (currentMode == MODE_EXPLICIT_CLIP && clipPlayer.hasFinished()) {
        currentMode = MODE_IDLE;
        if (appConnected) {
            // App is authority — restart idle loop; do not arm firmware timers.
            // The app will send the next blink/variation/RETURN_TO_IDLE itself.
            clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
        } else {
            idleOrchestrator.resume();
        }
        markActivity("CLIP_FINISHED");   // clip ending is activity; reset the sleep countdown
        Serial.println("EVENT:CLIP_FINISHED");
    }

    // 4. Drive idle orchestration (blink timer, variation timer, state machine).
    //    Only runs while the firmware is in idle mode, the display is awake,
    //    AND the app is not connected (app-connected mode suppresses autonomous idle).
    if (currentMode == MODE_IDLE && !display.isSleeping() && !appConnected) {
        idleOrchestrator.update();
    }

    // 5. OLED sleep check — only when:
    //    • a non-zero timeout is configured
    //    • the display is currently awake
    //    • no explicit clip is playing (do not interrupt mid-animation)
    //    • the inactivity threshold has been reached
    if (sleepTimeoutMs > 0 &&
        !display.isSleeping() &&
        currentMode != MODE_EXPLICIT_CLIP &&
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

            // Pause idle animations before sleeping to stop unnecessary work.
            if (currentMode == MODE_IDLE) {
                idleOrchestrator.pause();
                sleepPausedIdle = true;
            }
            display.sleepDisplay();
            Serial.println("DEBUG:SLEEP_ENTER");
        }
    }

    // 6. Yield to the ESP32 RTOS scheduler and reset the watchdog timer.
    yield();
}

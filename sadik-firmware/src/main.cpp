// =============================================================================
// SADIK Firmware — main.cpp
// ESP32-WROOM-32 + SH1106 128×64 I2C OLED
// =============================================================================

#include "config.h"
#include "display_manager.h"
#include "clip_player.h"
#include "clip_registry.h"       // ClipDefinition instances + findClipByName
#include "idle_orchestrator.h"   // also pulls in clip_registry.h (guarded)
#include "serial_commander.h"
#include "text_renderer.h"

// ── Playback mode ─────────────────────────────────────────────────────────────

enum PlaybackMode {
    MODE_BOOT,
    MODE_IDLE,
    MODE_EXPLICIT_CLIP,
    MODE_TEXT,
    MODE_FRAME_STREAM,     // app is streaming raw frames via FRAME: command
};

// ── Authority ─────────────────────────────────────────────────────────────────
// APP  = desktop app connected and sending PINGs; it drives all animations.
// LOCAL = no app; firmware runs autonomous idle + sleep cycle independently.

enum Authority {
    AUTHORITY_APP,
    AUTHORITY_LOCAL,
};

// ── Global singletons (construction order matters) ────────────────────────────

DisplayManager   display;                   // owns the U8g2 instance
ClipPlayer       clipPlayer(display);       // needs display
IdleOrchestrator idleOrchestrator(clipPlayer); // needs clipPlayer
SerialCommander  serialCmd;
TextRenderer     textRenderer(display);     // needs display
PlaybackMode     currentMode = MODE_BOOT;
Authority        currentAuthority = AUTHORITY_LOCAL;

// ── OLED sleep state ──────────────────────────────────────────────────────────
// sleepTimeoutMs: inactivity duration (ms) before the display is powered off.
//   0 = disabled — the display never sleeps automatically.
// lastActivityMs: millis() timestamp of the last meaningful visual command.
// sleepPausedIdle: true when the idle orchestrator was paused specifically to
//   enter sleep, so ensureAwake() knows to resume it on wake.

unsigned long sleepTimeoutMs  = 300000UL;  // 5 minutes default; 0 = disabled
unsigned long lastActivityMs  = 0;
bool          sleepPausedIdle = false;

// ── Heartbeat (PING) tracking ──────────────────────────────────────────────────
// App sends PING every 1 s.  If no PING is received for HEARTBEAT_TIMEOUT_MS
// while authority is APP, firmware transitions to LOCAL authority.

unsigned long lastPingMs = 0;    // millis() of the last received PING
bool          pingEverReceived = false;  // guard: don't time-out before first PING

// ── LOCAL authority sleep cycle ───────────────────────────────────────────────
// When in LOCAL authority and the display has been sleeping for LOCAL_WAKE_CYCLE_MS,
// the firmware wakes the display with the wakeup animation, stays awake for
// LOCAL_WAKE_ACTIVE_MS, then sleeps again if app hasn't reconnected.

unsigned long localSleepEnteredMs = 0;  // millis() when display was slept in LOCAL mode
bool          localSleepCycleActive = false;  // true when in the sleep-cycle wake window
unsigned long localWakeActiveUntilMs = 0;  // millis() deadline for the wake window

// ── Forward declarations ──────────────────────────────────────────────────────

void processCommand(ParsedCommand& cmd);
void markActivity(const char* reason);
void ensureAwake(const char* reason);
void enterLocalAuthority(const char* reason);
void enterAppAuthority();

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

    // Cancel any active LOCAL sleep-cycle wake window — display is waking for a
    // real reason; reset to fresh activity.
    localSleepCycleActive = false;
}

// =============================================================================
// enterLocalAuthority
// Transition to LOCAL authority: resume idle orchestrator and reset sleep timer.
// =============================================================================

void enterLocalAuthority(const char* reason) {
    if (currentAuthority == AUTHORITY_LOCAL) return;

    currentAuthority = AUTHORITY_LOCAL;

    char buf[96];
    snprintf(buf, sizeof(buf), "DEBUG:AUTHORITY LOCAL reason=%s", reason);
    Serial.println(buf);

    // Reset animation: stop whatever was playing and return to idle loop.
    clipPlayer.stop();
    textRenderer.clear();
    currentMode = MODE_IDLE;

    // Ensure display is awake before starting idle.
    if (display.isSleeping()) {
        display.wakeDisplay();
        sleepPausedIdle = false;
    }

    idleOrchestrator.resume();
    markActivity("LOCAL_AUTHORITY");

    // Reset the LOCAL sleep cycle tracking.
    localSleepCycleActive = false;
}

// =============================================================================
// enterAppAuthority
// Transition to APP authority: suppress autonomous idle timers.
// =============================================================================

void enterAppAuthority() {
    currentAuthority = AUTHORITY_APP;
    pingEverReceived = true;
    lastPingMs = millis();
    Serial.println("DEBUG:AUTHORITY APP");

    // Cancel any LOCAL sleep-cycle wake window.
    localSleepCycleActive = false;

    if (currentMode == MODE_IDLE) {
        idleOrchestrator.pause();
        // Restart idle loop under direct clip-player control (no timers).
        clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
    }
}

// =============================================================================
// setup
// =============================================================================

void setup() {
    serialCmd.begin();      // Serial.begin(SERIAL_BAUD) + reset parser state
    display.begin();        // Wire.begin(SDA, SCL) + u8g2.begin()

    // ── Seed random number generator ──────────────────────────────────────────
    // Combine floating ADC noise with elapsed time for decent entropy.
    randomSeed(static_cast<unsigned long>(analogRead(0)) + millis());

    // ── Boot animation (blocking, non-interruptible) ──────────────────────────
    // Play the 60-frame boot clip at 12fps (≈ 5 s) before entering idle.
    // No text splash — the animation IS the boot screen.
    currentMode = MODE_BOOT;
    {
        const unsigned long frameDurationMs = 1000UL / BOOT_FPS;  // ~83 ms / frame
        for (uint16_t fi = 0; fi < BOOT_FRAME_COUNT; fi++) {
            const uint8_t* framePtr =
                reinterpret_cast<const uint8_t*>(
                    pgm_read_ptr(&boot_frames[fi]));
            display.drawFrame(framePtr);
            display.sendBuffer();
            delay(frameDurationMs);
        }
    }

    // ── Device profile publish ─────────────────────────────────────────────────
    // Must be sent before SADIK:READY so the backend can parse variant on connect.
    Serial.println("DEVICE:variant=mini hw=esp32-wroom32 display=128x64_mono fw=2.0.0 caps=raw_frame_stream,progmem_clips");

    Serial.println("SADIK:READY");

    // ── Enter idle mode ───────────────────────────────────────────────────────
    currentMode = MODE_IDLE;
    idleOrchestrator.start();   // plays idle loop + arms blink/variation timers

    // Seed the inactivity timer from the moment we enter idle so the first
    // sleep fires exactly sleepTimeoutMs after boot, not from time 0.
    markActivity("BOOT");
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
                if (currentAuthority == AUTHORITY_APP) {
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
            if (currentAuthority == AUTHORITY_APP) {
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
            lastPingMs = millis();
            pingEverReceived = true;
            // If we are in LOCAL authority (cable was re-plugged without APP_CONNECTED),
            // stay LOCAL until an explicit APP_CONNECTED arrives.
            Serial.println("PONG");
            break;
        }

        // ── DEVICE? ───────────────────────────────────────────────────────────
        // Host queries device profile at any time (e.g. after reset or when the
        // boot-time DEVICE: line was missed).  Re-emit the same line so the
        // backend can capture it and broadcast device_profile to the app.
        // Bug 2 fix: deterministic handshake independent of connection timing.
        case CMD_DEVICE_QUERY: {
            Serial.println("DEVICE:variant=mini hw=esp32-wroom32 display=128x64_mono fw=2.0.0 caps=raw_frame_stream,progmem_clips");
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

            const char* authStr = (currentAuthority == AUTHORITY_APP) ? "APP" : "LOCAL";
            if (clipName) {
                snprintf(resp, sizeof(resp),
                         "STATUS:MODE=%s:%s,AUTH=%s,SLEEPING=%u,SLEEP_TIMEOUT_MS=%lu,BRIGHTNESS=%u,INACTIVITY_MS=%lu",
                         modeStr, clipName, authStr, sleeping, stMs, brightness, inactivityMs);
            } else {
                snprintf(resp, sizeof(resp),
                         "STATUS:MODE=%s,AUTH=%s,SLEEPING=%u,SLEEP_TIMEOUT_MS=%lu,BRIGHTNESS=%u,INACTIVITY_MS=%lu",
                         modeStr, authStr, sleeping, stMs, brightness, inactivityMs);
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

        // ── SCREEN_SLEEP ──────────────────────────────────────────────────────
        // App-side inactivity timeout (default 5 min) → play return_to_idle
        // animation then power the display off.  Non-interruptible: if a clip is
        // already playing we go straight to sleep without the animation.
        case CMD_SCREEN_SLEEP: {
            if (display.isSleeping()) {
                Serial.println("OK:SCREEN_SLEEP already_sleeping");
                break;
            }

            Serial.println("DEBUG:SCREEN_SLEEP begin");

            // Play return_to_idle animation then sleep.
            // Guard: only if not mid-explicit clip (avoid interrupting user-visible clip).
            if (currentMode != MODE_EXPLICIT_CLIP && currentMode != MODE_FRAME_STREAM) {
                idleOrchestrator.pause();
                clipPlayer.stop();
                textRenderer.clear();
                currentMode = MODE_EXPLICIT_CLIP;

                // Play return_to_idle blocking (frame-by-frame loop)
                const unsigned long frameDurationMs = 1000UL / RETURN_TO_IDLE_FPS;
                for (uint16_t fi = 0; fi < RETURN_TO_IDLE_FRAME_COUNT; fi++) {
                    const uint8_t* framePtr =
                        reinterpret_cast<const uint8_t*>(
                            pgm_read_ptr(&return_to_idle_frames[fi]));
                    display.drawFrame(framePtr);
                    display.sendBuffer();
                    delay(frameDurationMs);
                }
                clipPlayer.stop();
            } else {
                // Mid-clip: still pause idle, will sleep immediately.
                idleOrchestrator.pause();
            }

            sleepPausedIdle = false;  // idle was paused above, not for sleep
            display.sleepDisplay();
            currentMode = MODE_IDLE;  // return mode to idle so wake resumes cleanly
            Serial.println("DEBUG:SLEEP_ENTER");
            Serial.println("OK:SCREEN_SLEEP");

            // Record sleep entry time for the LOCAL wake-cycle (used if we fall
            // through to LOCAL authority later, e.g. cable pull after sleep).
            localSleepEnteredMs = millis();
            break;
        }

        // ── APP_CONNECTED ─────────────────────────────────────────────────────
        // The desktop app is now the sole animation authority.
        // Suppress firmware autonomous idle timers; keep the idle clip looping
        // so the display stays alive while waiting for app-driven commands.
        case CMD_APP_CONNECTED: {
            enterAppAuthority();
            Serial.println("OK:APP_CONNECTED");
            break;
        }

        // ── APP_DISCONNECTED ──────────────────────────────────────────────────
        // The desktop app has disconnected.  Hand animation authority back to
        // the firmware autonomous idle orchestrator.
        case CMD_APP_DISCONNECTED: {
            enterLocalAuthority("APP_DISCONNECTED_CMD");
            Serial.println("OK:APP_DISCONNECTED");
            break;
        }

        // ── FRAME:<hex data> ─────────────────────────────────────────────────
        // Raw 1024-byte frame streamed by the desktop app.  The firmware acts
        // as a dumb display terminal: decode, render, acknowledge.
        case CMD_FRAME_DATA: {
            if (currentAuthority != AUTHORITY_APP) {
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

            display.showRawFrame(cmd.frameData);
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
// loop
// =============================================================================

void loop() {
    // 1. Non-blocking serial command check — parse at most one command per tick.
    if (serialCmd.hasCommand()) {
        ParsedCommand cmd = serialCmd.getCommand();
        processCommand(cmd);
    }

    // 2. Heartbeat watch: if authority is APP and we haven't seen a PING within
    //    HEARTBEAT_TIMEOUT_MS, fall back to LOCAL authority (cable-pull detect).
    if (currentAuthority == AUTHORITY_APP && pingEverReceived) {
        if (millis() - lastPingMs >= HEARTBEAT_TIMEOUT_MS) {
            Serial.println("DEBUG:HEARTBEAT_TIMEOUT");
            enterLocalAuthority("HEARTBEAT_TIMEOUT");
        }
    }

    // 3. Advance animation playback.  ClipPlayer renders a new frame only when
    //    the per-frame interval has elapsed, so this is cheap on most ticks.
    //    Skip while asleep to avoid wasted I2C traffic.
    if (!display.isSleeping()) {
        clipPlayer.update();
    }

    // 4. Detect when a non-looping explicit clip has played to its end and
    //    automatically return to idle without needing a host command.
    if (currentMode == MODE_EXPLICIT_CLIP && clipPlayer.hasFinished()) {
        currentMode = MODE_IDLE;
        if (currentAuthority == AUTHORITY_APP) {
            // App is authority — restart idle loop; do not arm firmware timers.
            // The app will send the next blink/variation/RETURN_TO_IDLE itself.
            clipPlayer.play(&CLIP_IDLE, /*forceLoop=*/true);
        } else {
            idleOrchestrator.resume();
        }
        markActivity("CLIP_FINISHED");   // clip ending is activity; reset the sleep countdown
        Serial.println("EVENT:CLIP_FINISHED");
    }

    // 5. Drive idle orchestration (blink timer, variation timer, state machine).
    //    Only runs while LOCAL authority, display is awake, and in idle mode.
    if (currentMode == MODE_IDLE && !display.isSleeping() && currentAuthority == AUTHORITY_LOCAL) {
        idleOrchestrator.update();
    }

    // 6. Sleep check (APP authority) ─────────────────────────────────────────
    //    The app sends SCREEN_SLEEP explicitly; firmware sleep check is disabled
    //    when APP is authority so the two don't race.  But keep a safety net:
    //    if the app sent SET_SLEEP_TIMEOUT_MS:0 to disable, honour it.
    //    (Practically: APP authority sleep is driven entirely by app's command.)
    //
    // 7. Sleep check (LOCAL authority) ────────────────────────────────────────
    //    10-min inactivity → sleep display.
    if (currentAuthority == AUTHORITY_LOCAL &&
        sleepTimeoutMs > 0 &&
        !display.isSleeping() &&
        currentMode != MODE_EXPLICIT_CLIP &&
        currentMode != MODE_FRAME_STREAM &&
        currentMode != MODE_BOOT) {

        unsigned long elapsed = millis() - lastActivityMs;
        if (elapsed >= LOCAL_SLEEP_TIMEOUT_MS) {
            const char* modeStr =
                (currentMode == MODE_IDLE) ? "IDLE" :
                (currentMode == MODE_TEXT) ? "TEXT" : "UNKNOWN";
            char trigBuf[96];
            snprintf(trigBuf, sizeof(trigBuf),
                     "DEBUG:SLEEP_TRIGGER elapsed=%lu timeout=%lu mode=%s auth=LOCAL",
                     elapsed, LOCAL_SLEEP_TIMEOUT_MS, modeStr);
            Serial.println(trigBuf);

            // Play return_to_idle animation before sleeping (blocking).
            if (currentMode == MODE_IDLE && !display.isSleeping()) {
                idleOrchestrator.pause();
                clipPlayer.stop();
                const unsigned long frameDurationMs = 1000UL / RETURN_TO_IDLE_FPS;
                for (uint16_t fi = 0; fi < RETURN_TO_IDLE_FRAME_COUNT; fi++) {
                    const uint8_t* framePtr =
                        reinterpret_cast<const uint8_t*>(
                            pgm_read_ptr(&return_to_idle_frames[fi]));
                    display.drawFrame(framePtr);
                    display.sendBuffer();
                    delay(frameDurationMs);
                }
                clipPlayer.stop();
            } else if (currentMode == MODE_IDLE) {
                idleOrchestrator.pause();
            }

            sleepPausedIdle = false;
            display.sleepDisplay();
            currentMode = MODE_IDLE;
            localSleepEnteredMs = millis();
            localSleepCycleActive = false;
            Serial.println("DEBUG:SLEEP_ENTER");
        }
    }

    // 8. LOCAL authority wake-cycle: after LOCAL_WAKE_CYCLE_MS of sleep, play
    //    wakeup animation and stay awake for LOCAL_WAKE_ACTIVE_MS.
    //    If app connects during the active window, LOCAL→APP handover happens
    //    naturally via APP_CONNECTED command.
    if (currentAuthority == AUTHORITY_LOCAL && display.isSleeping() && !localSleepCycleActive) {
        if (millis() - localSleepEnteredMs >= LOCAL_WAKE_CYCLE_MS) {
            // Wake up: play wakeup animation (blocking).
            Serial.println("DEBUG:LOCAL_WAKE_CYCLE wakeup_start");
            display.wakeDisplay();
            sleepPausedIdle = false;

            const unsigned long frameDurationMs = 1000UL / WAKEUP_FPS;
            for (uint16_t fi = 0; fi < WAKEUP_FRAME_COUNT; fi++) {
                const uint8_t* framePtr =
                    reinterpret_cast<const uint8_t*>(
                        pgm_read_ptr(&wakeup_frames[fi]));
                display.drawFrame(framePtr);
                display.sendBuffer();
                delay(frameDurationMs);
            }

            // Enter idle and start LOCAL_WAKE_ACTIVE_MS window.
            currentMode = MODE_IDLE;
            idleOrchestrator.resume();
            markActivity("LOCAL_WAKE_CYCLE");
            localSleepCycleActive = true;
            localWakeActiveUntilMs = millis() + LOCAL_WAKE_ACTIVE_MS;
            Serial.println("DEBUG:LOCAL_WAKE_CYCLE active_window_start");
        }
    }

    // 9. LOCAL wake-cycle active window expired: go back to sleep.
    if (currentAuthority == AUTHORITY_LOCAL && localSleepCycleActive && !display.isSleeping()) {
        if (millis() >= localWakeActiveUntilMs) {
            Serial.println("DEBUG:LOCAL_WAKE_CYCLE window_expired sleep_again");
            idleOrchestrator.pause();
            clipPlayer.stop();

            // Play return_to_idle before sleeping.
            const unsigned long frameDurationMs = 1000UL / RETURN_TO_IDLE_FPS;
            for (uint16_t fi = 0; fi < RETURN_TO_IDLE_FRAME_COUNT; fi++) {
                const uint8_t* framePtr =
                    reinterpret_cast<const uint8_t*>(
                        pgm_read_ptr(&return_to_idle_frames[fi]));
                display.drawFrame(framePtr);
                display.sendBuffer();
                delay(frameDurationMs);
            }
            clipPlayer.stop();

            display.sleepDisplay();
            currentMode = MODE_IDLE;
            localSleepEnteredMs = millis();
            localSleepCycleActive = false;
            Serial.println("DEBUG:SLEEP_ENTER");
        }
    }

    // 10. Yield to the ESP32 RTOS scheduler and reset the watchdog timer.
    yield();
}

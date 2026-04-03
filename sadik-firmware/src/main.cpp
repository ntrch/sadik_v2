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
};

// ── Global singletons (construction order matters) ────────────────────────────

DisplayManager   display;                   // owns the U8g2 instance
ClipPlayer       clipPlayer(display);       // needs display
IdleOrchestrator idleOrchestrator(clipPlayer); // needs clipPlayer
SerialCommander  serialCmd;
TextRenderer     textRenderer(display);     // needs display
PlaybackMode     currentMode = MODE_BOOT;

// ── Forward declaration ───────────────────────────────────────────────────────

void processCommand(ParsedCommand& cmd);

// =============================================================================
// setup
// =============================================================================

void setup() {
    serialCmd.begin();      // Serial.begin(SERIAL_BAUD) + reset parser state
    display.begin();        // Wire.begin(SDA, SCL) + u8g2.begin()

    // ── Boot splash ───────────────────────────────────────────────────────────
    // drawTwoLineText composes the buffer; sendBuffer pushes it to the panel.
    display.drawTwoLineText("SADIK", "v2.0");
    display.sendBuffer();
    delay(2000);

    display.drawText("Hazir");
    display.sendBuffer();
    delay(1000);

    // ── Seed random number generator ──────────────────────────────────────────
    // Combine floating ADC noise with elapsed time for decent entropy.
    randomSeed(static_cast<unsigned long>(analogRead(0)) + millis());

    // ── Enter idle mode ───────────────────────────────────────────────────────
    currentMode = MODE_IDLE;
    idleOrchestrator.start();   // plays idle loop + arms blink/variation timers

    Serial.println("SADIK:READY");
}

// =============================================================================
// processCommand
// =============================================================================

void processCommand(ParsedCommand& cmd) {
    // Scratch buffer for formatted response strings.  Large enough for the
    // longest possible response (STATUS:CLIP:<name> or OK:TEXT:<text>).
    char resp[160];

    switch (cmd.type) {

        // ── PLAY_CLIP:<name> ──────────────────────────────────────────────────
        case CMD_PLAY_CLIP: {
            const ClipDefinition* clip = findClipByName(cmd.argument);

            if (!clip) {
                snprintf(resp, sizeof(resp), "ERR:CLIP_NOT_FOUND:%s", cmd.argument);
                Serial.println(resp);
                break;
            }

            // Suspend idle before touching the player.
            idleOrchestrator.pause();
            textRenderer.clear();
            currentMode = MODE_EXPLICIT_CLIP;

            // listening, thinking, and talking are indefinitely looping clips.
            // Their ClipDefinition already has loop=true; forceLoop is a belt-
            // and-suspenders guarantee that they never stop on their own.
            bool shouldLoop = (strcmp(cmd.argument, "listening") == 0 ||
                               strcmp(cmd.argument, "thinking")  == 0 ||
                               strcmp(cmd.argument, "talking")   == 0);

            clipPlayer.play(clip, shouldLoop);

            snprintf(resp, sizeof(resp), "OK:PLAYING:%s", cmd.argument);
            Serial.println(resp);
            break;
        }

        // ── STOP_CLIP ─────────────────────────────────────────────────────────
        case CMD_STOP_CLIP: {
            clipPlayer.stop();
            if (currentMode == MODE_EXPLICIT_CLIP) {
                currentMode = MODE_IDLE;
                idleOrchestrator.resume();
            }
            Serial.println("OK:STOPPED");
            break;
        }

        // ── SHOW_TEXT:<text> ──────────────────────────────────────────────────
        case CMD_SHOW_TEXT: {
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
            clipPlayer.stop();
            textRenderer.clear();
            currentMode = MODE_IDLE;
            idleOrchestrator.resume();
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
            switch (currentMode) {
                case MODE_BOOT:
                    Serial.println("STATUS:BOOT");
                    break;

                case MODE_IDLE:
                    Serial.println("STATUS:IDLE");
                    break;

                case MODE_EXPLICIT_CLIP: {
                    const char* name = clipPlayer.currentClipName();
                    snprintf(resp, sizeof(resp), "STATUS:CLIP:%s",
                             name ? name : "unknown");
                    Serial.println(resp);
                    break;
                }

                case MODE_TEXT:
                    Serial.println("STATUS:TEXT");
                    break;

                default:
                    Serial.println("STATUS:UNKNOWN");
                    break;
            }
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

    // 2. Advance animation playback.  ClipPlayer renders a new frame only when
    //    the per-frame interval has elapsed, so this is cheap on most ticks.
    clipPlayer.update();

    // 3. Detect when a non-looping explicit clip has played to its end and
    //    automatically return to idle without needing a host command.
    if (currentMode == MODE_EXPLICIT_CLIP && clipPlayer.hasFinished()) {
        currentMode = MODE_IDLE;
        idleOrchestrator.resume();
        Serial.println("EVENT:CLIP_FINISHED");
    }

    // 4. Drive idle orchestration (blink timer, variation timer, state machine).
    //    Only runs while the firmware is in idle mode.
    if (currentMode == MODE_IDLE) {
        idleOrchestrator.update();
    }

    // 5. Yield to the ESP32 RTOS scheduler and reset the watchdog timer.
    yield();
}

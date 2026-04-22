#pragma once

#include <Arduino.h>
#include "config.h"
#include "clip_player.h"
#include "clip_registry.h"   // CLIP_IDLE, CLIP_BLINK, CLIP_LOOK_LEFT, CLIP_LOOK_RIGHT

// ─────────────────────────────────────────────────────────────────────────────
// IdleOrchestrator
//
// Manages autonomous idle behaviour via two completely independent timers:
//
//   Timer 1 — Blink
//     Fires every 12–30 s (BLINK_MIN/MAX_INTERVAL_MS, fresh random each cycle).
//     Plays the 'blink' clip once, then resumes the looping idle clip.
//     A new random interval is picked after each blink.
//
//   Timer 2 — Variation (look left / look right)
//     Fires every 5–8 min (VARIATION_MIN/MAX_INTERVAL_MS, fresh random each cycle).
//     Picks a look direction, never repeating the same one consecutively.
//     Plays the look clip once, then resumes the looping idle clip.
//
// Collision rules (timers may fire while the other clip is playing):
//   • Blink fires while variation is playing  → skip this blink, schedule next.
//   • Variation fires while blink is playing  → play variation immediately after
//     the blink finishes (_variationPending flag).
//
// The orchestrator does NOT call player.update() — the main loop is responsible
// for that so explicit-clip commands also get rendered correctly.
// ─────────────────────────────────────────────────────────────────────────────

class IdleOrchestrator {
public:
    explicit IdleOrchestrator(ClipPlayer& player)
        : _player(player),
          _active(false),
          _nextBlinkTime(0),
          _nextVariationTime(0),
          _blinkPlaying(false),
          _variationPlaying(false),
          _variationPending(false),
          _lastVariation(0),
          _idlePlaying(false) {}

    // Start idle orchestration: play the idle loop and arm both timers.
    void start() {
        _active           = true;
        _blinkPlaying     = false;
        _variationPlaying = false;
        _variationPending = false;
        _idlePlaying      = true;

        _player.play(&CLIP_IDLE, /*forceLoop=*/true);
        _scheduleNextBlink();
        _scheduleNextVariation();
    }

    // Suspend orchestration (e.g. while an explicit clip plays).
    // Does not stop the player; the caller is responsible for that.
    void pause() {
        _active           = false;
        _blinkPlaying     = false;
        _variationPlaying = false;
        _idlePlaying      = false;
    }

    // Resume after pause: restart idle loop and re-arm timers with fresh intervals.
    void resume() {
        _active           = true;
        _blinkPlaying     = false;
        _variationPlaying = false;
        _variationPending = false;
        _idlePlaying      = true;

        _player.play(&CLIP_IDLE, /*forceLoop=*/true);
        _scheduleNextBlink();
        _scheduleNextVariation();
    }

    // Call every loop() iteration.  Drives the state machine; does NOT call
    // player.update() — that is the caller's responsibility.
    void update() {
        if (!_active) return;

        // ── Handle clip completions ───────────────────────────────────────────

        if (_blinkPlaying && _player.hasFinished()) {
            _blinkPlaying = false;
            _idlePlaying  = true;
            _player.play(&CLIP_IDLE, /*forceLoop=*/true);
            _scheduleNextBlink();

            // A variation was deferred while blink played — fire it now.
            if (_variationPending) {
                _variationPending = false;
                _playVariation();
            }
            return;
        }

        if (_variationPlaying && _player.hasFinished()) {
            _variationPlaying = false;
            _idlePlaying      = true;
            _player.play(&CLIP_IDLE, /*forceLoop=*/true);
            _scheduleNextVariation();
            return;
        }

        // ── Timer checks (only when no transition clip is playing) ────────────

        if (!_blinkPlaying && !_variationPlaying) {

            if (millis() >= _nextBlinkTime) {
                // Collision: variation is playing — skip this blink entirely.
                // (Handled above: _variationPlaying would be true, so we never
                // reach this branch during a variation.  Guard kept for safety.)
                _idlePlaying  = false;
                _blinkPlaying = true;
                _player.play(&CLIP_BLINK);
                return;
            }

            if (millis() >= _nextVariationTime) {
                // Collision: blink is currently playing — defer variation.
                // (Same note: _blinkPlaying == true would prevent reaching here;
                // kept for robustness.)
                if (_blinkPlaying) {
                    _variationPending = true;
                    _scheduleNextVariation();   // arm a fresh timer for next cycle
                    return;
                }
                _playVariation();
                return;
            }

            // Ensure idle loop is running if nothing else is.
            if (!_idlePlaying) {
                _idlePlaying = true;
                _player.play(&CLIP_IDLE, /*forceLoop=*/true);
            }
        }
    }

private:
    ClipPlayer&   _player;
    bool          _active;
    unsigned long _nextBlinkTime;
    unsigned long _nextVariationTime;
    bool          _blinkPlaying;
    bool          _variationPlaying;
    bool          _variationPending;
    char          _lastVariation;   // 'L', 'R', or 0 (never played)
    bool          _idlePlaying;

    // ── Timer helpers ─────────────────────────────────────────────────────────

    void _scheduleNextBlink() {
        unsigned long interval =
            BLINK_MIN_INTERVAL_MS +
            (unsigned long)random(BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS + 1);
        _nextBlinkTime = millis() + interval;
    }

    void _scheduleNextVariation() {
        unsigned long interval =
            VARIATION_MIN_INTERVAL_MS +
            (unsigned long)random(VARIATION_MAX_INTERVAL_MS - VARIATION_MIN_INTERVAL_MS + 1);
        _nextVariationTime = millis() + interval;
    }

    // ── Variation logic ───────────────────────────────────────────────────────

    void _playVariation() {
        // Alternate direction; if first time, choose randomly.
        char dir;
        if (_lastVariation == 'L') {
            dir = 'R';
        } else if (_lastVariation == 'R') {
            dir = 'L';
        } else {
            dir = (random(2) == 0) ? 'L' : 'R';
        }

        const ClipDefinition* clip = (dir == 'L') ? &CLIP_LOOK_LEFT : &CLIP_LOOK_RIGHT;

        _lastVariation    = dir;
        _idlePlaying      = false;
        _variationPlaying = true;
        _player.play(clip);
    }
};

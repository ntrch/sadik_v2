#pragma once

#include <Arduino.h>
#include "local_clip_player.h"

// ─────────────────────────────────────────────────────────────────────────────
// AnimationEngine — Color Sprint-6 Wave-1
//
// Ports IdleOrchestrator behaviour to the codec/LittleFS render path.
// Drives idle.bin (loop), blink, and idle_alt_* variation scheduling via
// LocalClipPlayer.  Legacy ClipPlayer + IdleOrchestrator remain untouched
// (Wave-2 will remove them).  Activated with USE_NEW_ANIMATION_ENGINE=1.
// ─────────────────────────────────────────────────────────────────────────────

enum AnimationEngineState {
    AE_STOPPED,
    AE_IDLE,
    AE_PLAYING_ONESHOT,
    AE_PLAYING_BLINK,
    AE_PLAYING_VARIATION,
};

// LittleFS clip names (must match manifest.json / /clips/*.bin)
static const char* AE_CLIP_IDLE              = "idle";
static const char* AE_CLIP_BLINK             = "blink";

// Variation clips — names from manifest.json (note: different from PROGMEM registry names)
static const char* AE_VARIATION_CLIPS[]      = {
    "idle_alt_left_look",
    "idle_alt_look_down",
    "idle_alt_right_look",
};
static const uint8_t AE_VARIATION_CLIP_COUNT = 3;

// Timing: ported from IdleOrchestrator / config.h
// Blink: 12–30 s; Variation: 5–8 min (300–480 s)
static const unsigned long AE_BLINK_MIN_MS      = 12000UL;
static const unsigned long AE_BLINK_MAX_MS      = 30000UL;
static const unsigned long AE_VARIATION_MIN_MS  = 300000UL;
static const unsigned long AE_VARIATION_MAX_MS  = 480000UL;

class AnimationEngine {
public:
    explicit AnimationEngine(LocalClipPlayer& player)
        : _player(player),
          _state(AE_STOPPED),
          _lastBlinkAtMs(0),
          _nextBlinkInMs(AE_BLINK_MIN_MS),
          _lastVariationAtMs(0),
          _nextVariationInMs(AE_VARIATION_MIN_MS),
          _lastVariationIdx(255),
          _variationPending(false) {}

    // Start idle.bin loop; arm blink + variation timers.
    void begin() {
        _state = AE_IDLE;
        _variationPending = false;
        _player.play(AE_CLIP_IDLE, /*loop=*/true);
        _scheduleNextBlink();
        _scheduleNextVariation();
    }

    // Play a one-shot event clip (e.g. "listening", "thinking").
    // Engine returns to idle automatically when clip finishes.
    void playEvent(const char* clipName) {
        _state = AE_PLAYING_ONESHOT;
        _player.play(clipName, /*loop=*/false);
    }

    // Stop all playback; engine will NOT auto-return to idle.
    // Call when app takes authority.
    void stop() {
        _player.stop();
        _state = AE_STOPPED;
    }

    // Resume idle mode; re-arm timers.
    // Call when app disconnects and firmware reclaims authority.
    void resume() {
        _variationPending = false;
        _player.play(AE_CLIP_IDLE, /*loop=*/true);
        _state = AE_IDLE;
        _scheduleNextBlink();
        _scheduleNextVariation();
    }

    // Call every loop() tick.  Advances the state machine.
    // NOTE: _player.update() is called by main loop separately — do NOT call here.
    void update() {
        if (_state == AE_STOPPED) return;

        // ── Handle clip completions ───────────────────────────────────────────

        if (_state == AE_PLAYING_BLINK && _player.hasFinished()) {
            // Return to idle; fire any deferred variation.
            _player.play(AE_CLIP_IDLE, /*loop=*/true);
            _state = AE_IDLE;
            _scheduleNextBlink();
            if (_variationPending) {
                _variationPending = false;
                _playVariation();
            }
            return;
        }

        if (_state == AE_PLAYING_VARIATION && _player.hasFinished()) {
            _player.play(AE_CLIP_IDLE, /*loop=*/true);
            _state = AE_IDLE;
            _scheduleNextVariation();
            return;
        }

        if (_state == AE_PLAYING_ONESHOT && _player.hasFinished()) {
            _returnToIdle();
            return;
        }

        // ── Timer checks (only while idle) ───────────────────────────────────

        if (_state != AE_IDLE) return;

        unsigned long now = millis();

        if (now - _lastBlinkAtMs >= _nextBlinkInMs) {
            _lastBlinkAtMs  = now;
            _state          = AE_PLAYING_BLINK;
            _player.play(AE_CLIP_BLINK, /*loop=*/false);
            return;
        }

        if (now - _lastVariationAtMs >= _nextVariationInMs) {
            if (_state == AE_PLAYING_BLINK) {
                // Defer variation until blink finishes.
                _variationPending = true;
                _scheduleNextVariation();
                return;
            }
            _playVariation();
            return;
        }
    }

    bool isIdle() const { return _state == AE_IDLE; }

    const char* currentClipName() const { return _player.currentClipName(); }

    AnimationEngineState state() const { return _state; }

private:
    LocalClipPlayer&     _player;
    AnimationEngineState _state;
    unsigned long        _lastBlinkAtMs;
    unsigned long        _nextBlinkInMs;
    unsigned long        _lastVariationAtMs;
    unsigned long        _nextVariationInMs;
    uint8_t              _lastVariationIdx;   // 255 = never played
    bool                 _variationPending;

    void _returnToIdle() {
        _player.play(AE_CLIP_IDLE, /*loop=*/true);
        _state = AE_IDLE;
        _scheduleNextBlink();
        _scheduleNextVariation();
    }

    void _scheduleNextBlink() {
        _lastBlinkAtMs  = millis();
        _nextBlinkInMs  = AE_BLINK_MIN_MS +
                          (unsigned long)random((long)(AE_BLINK_MAX_MS - AE_BLINK_MIN_MS + 1));
    }

    void _scheduleNextVariation() {
        _lastVariationAtMs = millis();
        _nextVariationInMs = AE_VARIATION_MIN_MS +
                             (unsigned long)random((long)(AE_VARIATION_MAX_MS - AE_VARIATION_MIN_MS + 1));
    }

    void _playVariation() {
        // Pick a variation index different from the last one.
        uint8_t idx;
        if (AE_VARIATION_CLIP_COUNT == 1) {
            idx = 0;
        } else {
            do {
                idx = (uint8_t)random(AE_VARIATION_CLIP_COUNT);
            } while (idx == _lastVariationIdx);
        }
        _lastVariationIdx = idx;
        _lastVariationAtMs = millis();
        _state = AE_PLAYING_VARIATION;
        _player.play(AE_VARIATION_CLIPS[idx], /*loop=*/false);
    }
};

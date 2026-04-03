#pragma once

#include <Arduino.h>
#include "config.h"
#include "display_manager.h"

// ─────────────────────────────────────────────────────────────────────────────
// ClipDefinition
//
// Describes an animation clip stored in PROGMEM.
//   frames     — pointer to a PROGMEM array of PROGMEM frame pointers
//   frameCount — total number of frames in the clip
//   fps        — target playback rate (frames per second)
//   loop       — whether the clip loops continuously by default
// ─────────────────────────────────────────────────────────────────────────────

struct ClipDefinition {
    const char*            name;
    const uint8_t* const*  frames;     // PROGMEM array of PROGMEM frame pointers
    uint16_t               frameCount;
    uint8_t                fps;
    bool                   loop;
};

// ─────────────────────────────────────────────────────────────────────────────
// ClipPlayer
//
// Frame-by-frame playback engine.  Call play() to start a clip, then call
// update() every loop() iteration to advance frames and render to the display.
// ─────────────────────────────────────────────────────────────────────────────

class ClipPlayer {
public:
    explicit ClipPlayer(DisplayManager& display)
        : _display(display),
          _clip(nullptr),
          _frameIndex(0),
          _frameDuration(1000 / DEFAULT_FPS),
          _lastFrameTime(0),
          _isPlaying(false),
          _isFinished(false),
          _forceLoop(false) {}

    // Start playing a clip from frame 0.
    // forceLoop overrides the clip's own loop flag (useful for idle which must
    // loop even if the ClipDefinition already sets loop=true).
    void play(const ClipDefinition* clip, bool forceLoop = false) {
        if (!clip || clip->frameCount == 0) return;

        _clip        = clip;
        _frameIndex  = 0;
        _forceLoop   = forceLoop;
        _isFinished  = false;
        _isPlaying   = true;
        _frameDuration = (clip->fps > 0) ? (1000 / clip->fps) : (1000 / DEFAULT_FPS);
        _lastFrameTime = millis();

        // Render first frame immediately so the display changes at once.
        _renderCurrentFrame();
    }

    // Stop playback and release the clip reference.
    void stop() {
        _isPlaying  = false;
        _isFinished = false;
        _clip       = nullptr;
    }

    // Advance animation by one frame if enough time has elapsed.
    // Renders the new frame to the display when it advances.
    // Call this every loop() iteration.
    void update() {
        if (!_isPlaying || !_clip) return;

        unsigned long now = millis();
        if (now - _lastFrameTime < _frameDuration) return;

        _lastFrameTime = now;
        _frameIndex++;

        if (_frameIndex >= _clip->frameCount) {
            if (_clip->loop || _forceLoop) {
                _frameIndex = 0;            // seamless loop
            } else {
                _frameIndex = _clip->frameCount - 1;   // hold last frame
                _isPlaying  = false;
                _isFinished = true;
                return;                     // do not re-render a stopped clip
            }
        }

        _renderCurrentFrame();
    }

    bool        isPlaying()       const { return _isPlaying; }
    bool        hasFinished()     const { return _isFinished; }
    const char* currentClipName() const { return _clip ? _clip->name : nullptr; }

private:
    DisplayManager&       _display;
    const ClipDefinition* _clip;
    uint16_t              _frameIndex;
    unsigned long         _frameDuration;   // ms per frame
    unsigned long         _lastFrameTime;
    bool                  _isPlaying;
    bool                  _isFinished;
    bool                  _forceLoop;

    void _renderCurrentFrame() {
        // Read the frame pointer from PROGMEM, then pass to drawFrame which
        // also reads each pixel byte via pgm_read_byte.
        const uint8_t* framePtr =
            reinterpret_cast<const uint8_t*>(
                pgm_read_ptr(&_clip->frames[_frameIndex]));
        _display.drawFrame(framePtr);
        _display.sendBuffer();
    }
};

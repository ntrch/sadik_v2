#pragma once

#include <Arduino.h>
#include "clip_player.h"   // ClipDefinition

// ── All clip frame data (PROGMEM) ─────────────────────────────────────────────
// Only idle-mode clips are stored on-device.  All other animations are streamed
// as raw frames by the desktop app via the FRAME: command.
#include "clips/idle_clip.h"
#include "clips/blink_clip.h"
#include "clips/idle_alt_look_left_clip.h"
#include "clips/idle_alt_look_right_clip.h"

// ─────────────────────────────────────────────────────────────────────────────
// ClipDefinition instances
//
// Declared static so each translation unit gets its own copy; this is safe
// for a single-TU Arduino project and prevents ODR issues if the header is
// ever pulled into more than one .cpp file.
// ─────────────────────────────────────────────────────────────────────────────

static const ClipDefinition CLIP_IDLE = {
    "idle",
    idle_frames,
    IDLE_FRAME_COUNT,
    IDLE_FPS,
    true    // loops
};

static const ClipDefinition CLIP_BLINK = {
    "blink",
    blink_frames,
    BLINK_FRAME_COUNT,
    BLINK_FPS,
    false
};

static const ClipDefinition CLIP_LOOK_LEFT = {
    "idle_alt_look_left",
    idle_alt_look_left_frames,
    IDLE_ALT_LOOK_LEFT_FRAME_COUNT,
    IDLE_ALT_LOOK_LEFT_FPS,
    false
};

static const ClipDefinition CLIP_LOOK_RIGHT = {
    "idle_alt_look_right",
    idle_alt_look_right_frames,
    IDLE_ALT_LOOK_RIGHT_FRAME_COUNT,
    IDLE_ALT_LOOK_RIGHT_FPS,
    false
};

// ── Registry table ────────────────────────────────────────────────────────────

static const uint8_t ALL_CLIPS_COUNT = 4;

static const ClipDefinition* const ALL_CLIPS[ALL_CLIPS_COUNT] = {
    &CLIP_IDLE,
    &CLIP_BLINK,
    &CLIP_LOOK_LEFT,
    &CLIP_LOOK_RIGHT,
};

// Returns a pointer to the ClipDefinition whose name matches, or nullptr.
inline const ClipDefinition* findClipByName(const char* name) {
    for (uint8_t i = 0; i < ALL_CLIPS_COUNT; i++) {
        if (strcmp(ALL_CLIPS[i]->name, name) == 0) {
            return ALL_CLIPS[i];
        }
    }
    return nullptr;
}

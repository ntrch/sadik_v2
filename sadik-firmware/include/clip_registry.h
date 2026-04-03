#pragma once

#include <Arduino.h>
#include "clip_player.h"   // ClipDefinition

// ── All clip frame data (PROGMEM) ─────────────────────────────────────────────
#include "clips/idle_clip.h"
#include "clips/blink_clip.h"
#include "clips/idle_alt_look_left_clip.h"
#include "clips/idle_alt_look_right_clip.h"
#include "clips/waking_clip.h"
#include "clips/listening_clip.h"
#include "clips/thinking_clip.h"
#include "clips/talking_clip.h"
#include "clips/confirming_clip.h"
#include "clips/understanding_clip.h"
#include "clips/confused_clip.h"
#include "clips/didnt_hear_clip.h"
#include "clips/error_soft_clip.h"
#include "clips/goodbye_to_idle_clip.h"

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

static const ClipDefinition CLIP_WAKING = {
    "waking",
    waking_frames,
    WAKING_FRAME_COUNT,
    WAKING_FPS,
    false
};

static const ClipDefinition CLIP_LISTENING = {
    "listening",
    listening_frames,
    LISTENING_FRAME_COUNT,
    LISTENING_FPS,
    true
};

static const ClipDefinition CLIP_THINKING = {
    "thinking",
    thinking_frames,
    THINKING_FRAME_COUNT,
    THINKING_FPS,
    true
};

static const ClipDefinition CLIP_TALKING = {
    "talking",
    talking_frames,
    TALKING_FRAME_COUNT,
    TALKING_FPS,
    true
};

static const ClipDefinition CLIP_CONFIRMING = {
    "confirming",
    confirming_frames,
    CONFIRMING_FRAME_COUNT,
    CONFIRMING_FPS,
    false
};

static const ClipDefinition CLIP_UNDERSTANDING = {
    "understanding",
    understanding_frames,
    UNDERSTANDING_FRAME_COUNT,
    UNDERSTANDING_FPS,
    false
};

static const ClipDefinition CLIP_CONFUSED = {
    "confused",
    confused_frames,
    CONFUSED_FRAME_COUNT,
    CONFUSED_FPS,
    false
};

static const ClipDefinition CLIP_DIDNT_HEAR = {
    "didnt_hear",
    didnt_hear_frames,
    DIDNT_HEAR_FRAME_COUNT,
    DIDNT_HEAR_FPS,
    false
};

static const ClipDefinition CLIP_ERROR_SOFT = {
    "error_soft",
    error_soft_frames,
    ERROR_SOFT_FRAME_COUNT,
    ERROR_SOFT_FPS,
    false
};

static const ClipDefinition CLIP_GOODBYE = {
    "goodbye_to_idle",
    goodbye_to_idle_frames,
    GOODBYE_TO_IDLE_FRAME_COUNT,
    GOODBYE_TO_IDLE_FPS,
    false
};

// ── Registry table ────────────────────────────────────────────────────────────

static const uint8_t ALL_CLIPS_COUNT = 14;

static const ClipDefinition* const ALL_CLIPS[ALL_CLIPS_COUNT] = {
    &CLIP_IDLE,
    &CLIP_BLINK,
    &CLIP_LOOK_LEFT,
    &CLIP_LOOK_RIGHT,
    &CLIP_WAKING,
    &CLIP_LISTENING,
    &CLIP_THINKING,
    &CLIP_TALKING,
    &CLIP_CONFIRMING,
    &CLIP_UNDERSTANDING,
    &CLIP_CONFUSED,
    &CLIP_DIDNT_HEAR,
    &CLIP_ERROR_SOFT,
    &CLIP_GOODBYE,
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

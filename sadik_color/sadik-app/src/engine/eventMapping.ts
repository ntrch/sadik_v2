// Maps app events to clip names
export const EVENT_TO_CLIP: Record<string, string> = {
  wake_word_detected: 'waking',
  user_speaking: 'listening',
  processing: 'thinking',
  assistant_speaking: 'talking',
  confirmation_success: 'confirming',
  understanding_resolved: 'understanding',
  didnt_hear: 'didnt_hear',
  soft_error: 'error_soft',
  ambiguity: 'confused',
  conversation_finished: 'goodbye_to_idle',
};

// Clips that loop while the event is active
export const LOOPING_EVENT_CLIPS: Set<string> = new Set([
  'listening',
  'thinking',
  'talking',
]);

// After these clips finish (non-looping), auto-return to idle
export const AUTO_RETURN_CLIPS: Set<string> = new Set([
  'confirming',
  'understanding',
  'didnt_hear',
  'error_soft',
  'confused',
  'goodbye_to_idle',
  'waking',
]);

// Fallback display text when a clip is not loaded
export const EVENT_DISPLAY_TEXT: Record<string, string> = {
  wake_word_detected: 'UYANMA',
  user_speaking: 'DİNLİYOR',
  processing: 'DÜŞÜNÜYOR',
  assistant_speaking: 'KONUŞUYOR',
  confirmation_success: 'TAMAM',
  understanding_resolved: 'ANLADIM',
  didnt_hear: 'NE DEDİN?',
  soft_error: 'HATA',
  ambiguity: 'KARIŞTI',
  conversation_finished: 'GÖRÜŞÜRÜZ',
};

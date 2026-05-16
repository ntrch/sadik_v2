// Maps app events to clip names (legacy fallback — new events use eventClipMap.json)
export const EVENT_TO_CLIP: Record<string, string> = {};

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
  'didnthear',
  'wakeword',
  'done',
  'return_to_idle',
]);

// Fallback display text when a clip is not loaded
export const EVENT_DISPLAY_TEXT: Record<string, string> = {
  'voice.wake_word_detected': 'UYANMA',
  'voice.user_speaking': 'DİNLİYOR',
  'voice.processing': 'DÜŞÜNÜYOR',
  'voice.assistant_speaking': 'KONUŞUYOR',
  'voice.understanding_resolved': 'ANLADIM',
  'voice.didnt_hear': 'NE DEDİN?',
  'voice.soft_error': 'HATA',
  'voice.conversation_finished': 'GÖRÜŞÜRÜZ',
  'task.completed': 'TAMAM',
  'tasks.action.success': 'TAMAM',
  'chat.confirmed': 'TAMAM',
  'settings.saved': 'KAYDEDİLDİ',
  'workspace.action.success': 'TAMAM',
  'dashboard.action.success': 'TAMAM',
  'focus.action.success': 'TAMAM',
  'pomodoro.session.completed': 'TAMAM',
  'generic.success': 'TAMAM',
};

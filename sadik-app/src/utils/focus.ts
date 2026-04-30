/**
 * Returns true when a text-input element currently has focus.
 * Used as a guard before processing global keyboard shortcuts so we
 * don't intercept keystrokes while the user is typing.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

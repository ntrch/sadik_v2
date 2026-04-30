import React from 'react';
import { MessageSquare } from 'lucide-react';

interface Props {
  onClick: () => void;
}

/**
 * Floating action button rendered in the Settings page (bottom-right, fixed).
 * Clicking it opens the global FeedbackModal.
 */
export default function FeedbackButton({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title="Geri Bildirim Gönder (veya Shift+F)"
      className="fixed bottom-24 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-card font-semibold text-sm text-white bg-gradient-to-br from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 active:scale-95 transition-all"
    >
      <MessageSquare size={16} />
      Geri Bildirim
    </button>
  );
}

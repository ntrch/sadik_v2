import React from 'react';
import { LucideIcon, Mic } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
  voiceHint?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  onCta,
  voiceHint,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 border border-dashed border-border rounded-card bg-bg-card/40">
      <div className="mb-4 p-3 rounded-2xl bg-bg-input border border-border">
        <Icon size={36} className="text-text-muted opacity-50" />
      </div>
      <p className="text-base font-semibold text-text-primary mb-1">{title}</p>
      {description && (
        <p className="text-sm text-text-muted max-w-xs mb-4">{description}</p>
      )}
      {ctaLabel && onCta && (
        <button
          onClick={onCta}
          className="mt-1 px-4 py-2 rounded-btn text-sm font-medium bg-accent-purple hover:bg-accent-purple-hover text-white transition-colors"
        >
          {ctaLabel}
        </button>
      )}
      {voiceHint && (
        <p className="flex items-center gap-1.5 mt-4 text-xs text-text-muted italic">
          <Mic size={12} className="flex-shrink-0 opacity-60" />
          &ldquo;{voiceHint}&rdquo;
        </p>
      )}
    </div>
  );
}

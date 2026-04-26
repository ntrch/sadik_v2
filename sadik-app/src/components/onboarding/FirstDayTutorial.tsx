import React, { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { settingsApi } from '../../api/settings';

interface Step {
  targetAttr: string;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    targetAttr: 'voice-btn',
    title: 'Sadık ile konuş',
    description:
      'Mikrofon butonu veya "Sadık" wake-word ile başla. Görev sor, alışkanlık kontrol et, mod değiştir.',
  },
  {
    targetAttr: 'mode-selector',
    title: 'Modunu seç',
    description:
      'Çalışma, kodlama, mola, yazarlık... Modlar bildirimleri ve davranışı şekillendirir.',
  },
  {
    targetAttr: 'nav-tasks',
    title: 'Görevlerin',
    description: 'Görev ekle, takip et, Notion/Takvim bağla.',
  },
  {
    targetAttr: 'nav-settings',
    title: 'Gizlilik & Roller',
    description: 'Veri akışını ve rolünü buradan yönet.',
  },
];

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

function getRect(attr: string): SpotlightRect | null {
  const el = document.querySelector(`[data-tutorial="${attr}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

interface TooltipPos {
  top: number;
  left: number;
}

function getTooltipPos(rect: SpotlightRect, tooltipW = 300, tooltipH = 140): TooltipPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer below target
  let top = rect.top + rect.height + 12;
  let left = rect.left;
  // Clamp right
  if (left + tooltipW > vw - 12) left = vw - tooltipW - 12;
  if (left < 12) left = 12;
  // If no room below, go above
  if (top + tooltipH > vh - 12) {
    top = rect.top - tooltipH - 12;
  }
  if (top < 12) top = 12;
  return { top, left };
}

interface Props {
  onDone: () => void;
}

export default function FirstDayTutorial({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const currentStep = STEPS[step];

  const computeRect = useCallback(() => {
    setRect(getRect(currentStep.targetAttr));
  }, [currentStep.targetAttr]);

  useEffect(() => {
    computeRect();
    window.addEventListener('resize', computeRect);
    return () => window.removeEventListener('resize', computeRect);
  }, [computeRect]);

  const complete = async () => {
    try {
      await settingsApi.update({ tutorial_completed: 'true' });
    } catch {
      // best-effort; gate will re-evaluate on next load
    }
    onDone();
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      complete();
    }
  };

  const handleSkip = () => {
    complete();
  };

  const tooltip = rect ? getTooltipPos(rect) : { top: window.innerHeight / 2 - 70, left: window.innerWidth / 2 - 150 };

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/60 pointer-events-auto" onClick={handleSkip} />

      {/* Spotlight cutout via box-shadow */}
      {rect && (
        <div
          className="absolute rounded-xl pointer-events-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
            zIndex: 1,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="absolute pointer-events-auto z-[2] w-[300px] bg-bg-card border border-border rounded-card shadow-card p-4 animate-fade-in"
        style={{ top: tooltip.top, left: tooltip.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step counter + skip */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-text-muted">
            {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={handleSkip}
            title="Atla"
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-sm font-semibold text-text-primary mb-1">{currentStep.title}</p>
        <p className="text-xs text-text-muted mb-4">{currentStep.description}</p>

        {/* Step dots */}
        <div className="flex items-center gap-1 mb-3">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`inline-block h-1.5 rounded-full transition-all ${
                i === step ? 'w-4 bg-accent-purple' : 'w-1.5 bg-border'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleSkip}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Atla
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-1.5 rounded-btn text-xs font-semibold bg-accent-purple hover:bg-accent-purple-hover text-white transition-colors"
          >
            {step < STEPS.length - 1 ? 'İleri' : 'Tamam'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * GlobalInsightCard — floating overlay, visible on every route.
 *
 * Renders only when activeInsight has has_insight=true so it doesn't
 * pollute other pages with an empty-state placeholder.
 */
import React, { useContext } from 'react';
import { Lightbulb, Check, X as XIcon } from 'lucide-react';
import { AppContext } from '../../context/AppContext';
import { AppInsight } from '../../api/stats';
import { habitsApi } from '../../api/habits';

const LEVEL_LABEL: Record<string, string> = {
  gentle: 'Nazik öneri',
  strong: 'Güçlü öneri',
};

const SOURCE_LABEL: Record<string, string> = {
  habit: 'Alışkanlık',
  task:  'Görev',
};

const LEVEL_COLORS: Record<string, { card: string; badge: string; icon: string; text: string }> = {
  gentle: {
    card:  'border-accent-yellow/40 bg-bg-elevated',
    badge: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20',
    icon:  'text-accent-yellow',
    text:  'text-accent-yellow',
  },
  strong: {
    card:  'border-accent-orange/40 bg-bg-elevated',
    badge: 'bg-accent-orange/10 text-accent-orange border-accent-orange/20',
    icon:  'text-accent-orange',
    text:  'text-accent-orange',
  },
};

function InsightCardContent({
  insight,
  onAccept,
  onDeny,
  onHabitDone,
}: {
  insight: AppInsight;
  onAccept: () => void;
  onDeny: () => void;
  onHabitDone: () => void;
}) {
  const level     = insight.level ?? 'gentle';
  const colors    = LEVEL_COLORS[level] ?? LEVEL_COLORS.gentle;
  const isMeeting = insight.source === 'meeting';
  const label     = (insight.source && SOURCE_LABEL[insight.source]) ?? LEVEL_LABEL[level] ?? 'Öneri';

  return (
    <div className={`border rounded-card p-4 shadow-card shadow-lg ${colors.card}`}>
      <div className="flex items-start gap-3">
        <Lightbulb size={18} className={`flex-shrink-0 mt-0.5 ${colors.icon}`} />
        <div className="flex-1 min-w-0">
          {!isMeeting && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>
                {label}
              </span>
            </div>
          )}
          <p className={`text-sm leading-relaxed font-medium ${colors.text}`}>{insight.message}</p>
          <div className="flex items-center gap-2 mt-3">
            {insight.source === 'habit' ? (
              <>
                <button
                  onClick={onHabitDone}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25 transition-colors"
                >
                  <Check size={12} /> Yaptım
                </button>
                <button
                  onClick={onDeny}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <XIcon size={12} /> Şimdi değil
                </button>
              </>
            ) : insight.source === 'task' ? (
              <button
                onClick={onDeny}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <Check size={12} /> Tamam
              </button>
            ) : isMeeting ? (
              <>
                <button
                  onClick={onAccept}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25 transition-colors"
                >
                  <Check size={12} /> Kabul Et
                </button>
                <button
                  onClick={onDeny}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <XIcon size={12} /> Reddet
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onAccept}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25 transition-colors"
                >
                  <Check size={12} /> Molaya Geç
                </button>
                <button
                  onClick={onDeny}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-btn bg-bg-input text-text-muted border border-border hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <XIcon size={12} /> Reddet
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Global floating insight overlay. Mount once in AppShell, outside of Routes.
 * Visible on all pages whenever there is an active insight.
 */
export default function GlobalInsightCard() {
  const { activeInsight, acceptInsight, denyInsight } = useContext(AppContext);

  if (!activeInsight?.has_insight) return null;

  const handleHabitDone = async () => {
    if (activeInsight?.habit_id) {
      try {
        await habitsApi.log(activeInsight.habit_id, { status: 'done' });
      } catch (e) {
        console.error('[habits] log failed', e);
      }
    }
    denyInsight();
  };

  return (
    <div
      style={{ zIndex: 9000 }}
      className="fixed top-16 right-4 w-[min(400px,calc(100vw-2rem))] pointer-events-auto"
    >
      <InsightCardContent
        insight={activeInsight}
        onAccept={acceptInsight}
        onDeny={denyInsight}
        onHabitDone={handleHabitDone}
      />
    </div>
  );
}

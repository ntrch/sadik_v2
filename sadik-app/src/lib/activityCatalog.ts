export type ActivityId =
  | 'code'
  | 'writing'
  | 'design'
  | 'meeting'
  | 'learning'
  | 'data'
  | 'creative'
  | 'office'
  | 'gaming';

import type { LucideIcon } from 'lucide-react';
import { Code2, PenTool, Palette, Users, BookOpen, BarChart3, Film, Mail, Gamepad2 } from 'lucide-react';

export const ACTIVITIES: {
  id: ActivityId;
  label: string;
  emoji: string;
  icon: LucideIcon;
  description: string;
}[] = [
  { id: 'code',     label: 'Kod yazma',           emoji: '💻', icon: Code2,     description: 'Yazılım geliştirme, debug, code review' },
  { id: 'writing',  label: 'Yazı / içerik',       emoji: '✍️', icon: PenTool,   description: 'Makale, blog, döküman, not' },
  { id: 'design',   label: 'Tasarım',             emoji: '🎨', icon: Palette,   description: 'UI, görsel, mockup, eskiz' },
  { id: 'meeting',  label: 'Toplantı / iletişim', emoji: '💬', icon: Users,     description: 'Online görüşme, async iletişim' },
  { id: 'learning', label: 'Ders / araştırma',    emoji: '📚', icon: BookOpen,  description: 'Öğrenme, araştırma, okuma' },
  { id: 'data',     label: 'Veri / tablo',        emoji: '📊', icon: BarChart3, description: 'Analiz, hesap tablosu, raporlama' },
  { id: 'creative', label: 'Yaratıcı medya',      emoji: '🎬', icon: Film,      description: 'Müzik, video, podcast, edit' },
  { id: 'office',   label: 'Ofis / email',        emoji: '📧', icon: Mail,      description: 'Email, döküman, idari işler' },
  { id: 'gaming',   label: 'Oyun / eğlence',      emoji: '🎮', icon: Gamepad2,  description: 'Oyun, video izleme, mola' },
];

export interface PresetModeDef {
  key: string;
  label: string;
  oledText: string;
  activities: ActivityId[] | 'all'; // 'all' = her aktivitede uygundur
  weight?: number;                   // base öncelik
}

export const PRESET_MODE_POOL: PresetModeDef[] = [
  { key: 'coding',      label: 'Derin Kod',       oledText: 'KOD YAZIYOR', activities: ['code'] },
  { key: 'code_review', label: 'Code Review',     oledText: 'CODE REVIEW', activities: ['code'] },
  { key: 'writing',     label: 'Yazma Akışı',     oledText: 'YAZMA',       activities: ['writing', 'learning'] },
  { key: 'editing',     label: 'Düzenleme',       oledText: 'DUZENLEME',   activities: ['writing'] },
  { key: 'design',      label: 'Tasarım',         oledText: 'TASARIM',     activities: ['design'] },
  { key: 'sketch',      label: 'Eskiz',           oledText: 'ESKIZ',       activities: ['design', 'creative'] },
  { key: 'meeting',     label: 'Toplantı',        oledText: 'TOPLANTI',    activities: ['meeting'] },
  { key: 'async_comm',  label: 'Async İletişim',  oledText: 'ILETISIM',    activities: ['meeting', 'office'] },
  { key: 'learning',    label: 'Çalışma',         oledText: 'OGRENME',     activities: ['learning'] },
  { key: 'research',    label: 'Araştırma',       oledText: 'ARASTIRMA',   activities: ['learning', 'code', 'writing'] },
  { key: 'data',        label: 'Veri Analizi',    oledText: 'VERI',        activities: ['data'] },
  { key: 'creative',    label: 'Yaratıcı Akış',   oledText: 'YARATIM',     activities: ['creative', 'design'] },
  { key: 'working',     label: 'Genel Çalışma',   oledText: 'CALISIYOR',   activities: 'all', weight: 0.5 },
  { key: 'email',       label: 'Email / Admin',   oledText: 'EMAIL',       activities: ['office'] },
  { key: 'reading',     label: 'Okuma',           oledText: 'OKUMA',       activities: 'all', weight: 0.4 },
  { key: 'break',       label: 'Mola',            oledText: 'MOLA',        activities: 'all', weight: 1 }, // her zaman ZORUNLU
  { key: 'gaming',      label: 'Oyun',            oledText: 'OYUN',        activities: ['gaming'] },
];

export function recommendModes(activities: ActivityId[]): string[] {
  // Skor: aktivite kesişim sayısı + base weight
  const scored = PRESET_MODE_POOL.map((p) => {
    if (p.activities === 'all') return { key: p.key, score: p.weight ?? 0.3 };
    const intersect = (p.activities as ActivityId[]).filter((a) => activities.includes(a)).length;
    return { key: p.key, score: intersect + (p.weight ?? 0) };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  // 'break' ZORUNLU dahil
  const top = scored.slice(0, 4).map((s) => s.key);
  if (!top.includes('break')) {
    top.pop();
    top.push('break');
  }
  return top;
}

export function deriveDominantPersona(activities: ActivityId[]): string {
  // Activity → eski persona map (LLM persona hint için)
  if (activities.includes('code')) return 'developer';
  if (activities.includes('writing')) return 'writer';
  if (activities.includes('learning')) return 'student';
  if (activities.includes('design') || activities.includes('creative')) return 'designer';
  return 'general';
}

export const MODE_LABEL_FROM_POOL: Record<string, string> = Object.fromEntries(
  PRESET_MODE_POOL.map((p) => [p.key, p.label])
);

/** Aktivite ID → Türkçe label */
export const ACTIVITY_LABELS: Record<ActivityId, string> = Object.fromEntries(
  ACTIVITIES.map((a) => [a.id, a.label])
) as Record<ActivityId, string>;

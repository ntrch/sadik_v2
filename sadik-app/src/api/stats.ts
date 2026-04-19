import http from './http';

export interface ModeStat {
  mode: string;
  total_seconds: number;
}

export interface DayStat {
  date: string;
  modes: ModeStat[];
}

export interface AppUsageStat {
  app_name: string;
  duration_seconds: number;
}

export interface AppInsightItem {
  app_name: string;
  level: 'gentle' | 'strong';
  message: string;
}

export interface AppInsight {
  has_insight: boolean;
  app_name?: string;
  /** "gentle" = 60-min rule, "strong" = 120-min rule */
  level?: 'gentle' | 'strong';
  message?: string;
  /** All apps exceeding thresholds */
  insights?: AppInsightItem[];
  /** Source of the insight: app usage, task deadline, or habit reminder */
  source?: 'app_usage' | 'task' | 'habit';
}

export interface AppUsageDailyTotal {
  date: string;
  duration_seconds: number;
}

export interface AppUsageRangeSummary {
  days: number;
  top_apps: AppUsageStat[];
  daily_totals: AppUsageDailyTotal[];
}

export const statsApi = {
  daily: (date?: string) =>
    http.get<ModeStat[]>('/api/stats/daily', { params: date ? { date } : {} }).then((r) => r.data),
  range: (days: 7 | 14 | 30) =>
    http.get<DayStat[]>('/api/stats/range', { params: { days } }).then((r) => r.data),
  appUsageDaily: (date?: string) =>
    http
      .get<AppUsageStat[]>('/api/stats/app-usage/daily', { params: date ? { date } : {} })
      .then((r) => r.data),
  appUsageRange: (days = 7) =>
    http
      .get<AppUsageRangeSummary>('/api/stats/app-usage/range', { params: { days } })
      .then((r) => r.data),
  appInsights: () =>
    http.get<AppInsight>('/api/stats/app-usage/insights').then((r) => r.data),
};

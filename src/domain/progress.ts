import { PLAN_RULES } from "./planner";
import type { StudyTask } from "./schema";

export interface TodayStats {
  todayTotal: number;
  todayDone: number;
  /** 今日任務全部完成（今天沒有任務時為 false，代表休息日） */
  todayAchieved: boolean;
  /** 今天以前、至少一項任務未完成的讀書日數 */
  behindDays: number;
  /** 今天以前未完成的任務 */
  overdue: StudyTask[];
  overdueMinutes: number;
  /**
   * 連續達標天數：從最近的讀書日往前數「當天任務全部完成」的天數。
   * 休息日（沒有任務的日子）不計入也不中斷；今天尚未完成時不算中斷，從昨天往前數。
   */
  streak: number;
  /** 今天起（含今天）還有任務的讀書日數 */
  remainingStudyDays: number;
}

function groupByDate(tasks: readonly StudyTask[]): Map<string, StudyTask[]> {
  const map = new Map<string, StudyTask[]>();
  for (const t of tasks) map.set(t.date, [...(map.get(t.date) ?? []), t]);
  return map;
}

const allDone = (tasks: readonly StudyTask[]) => tasks.every((t) => t.completed_at !== null);

export function computeTodayStats(tasks: readonly StudyTask[], today: string): TodayStats {
  const byDate = groupByDate(tasks);
  const todays = byDate.get(today) ?? [];
  const todayDone = todays.filter((t) => t.completed_at !== null).length;
  const todayAchieved = todays.length > 0 && todayDone === todays.length;

  const pastDates = [...byDate.keys()].filter((d) => d < today).sort();
  const overdue = tasks.filter((t) => t.date < today && t.completed_at === null);
  const behindDays = pastDates.filter((d) => !allDone(byDate.get(d)!)).length;

  let streak = todayAchieved ? 1 : 0;
  for (const date of [...pastDates].reverse()) {
    if (!allDone(byDate.get(date)!)) break;
    streak += 1;
  }

  return {
    todayTotal: todays.length,
    todayDone,
    todayAchieved,
    behindDays,
    overdue,
    overdueMinutes: overdue.reduce((s, t) => s + t.minutes, 0),
    streak,
    remainingStudyDays: [...byDate.keys()].filter((d) => d >= today).length,
  };
}

/** 落後時的追進度建議；沒有落後時回傳 null。 */
export function catchUpSuggestion(stats: TodayStats): string | null {
  if (stats.behindDays === 0) return null;
  const head = `落後 ${stats.behindDays} 個讀書日，共 ${stats.overdueMinutes} 分鐘未完成。`;
  if (stats.remainingStudyDays === 0) {
    return `${head}考前已沒有排定的讀書日，建議優先完成模擬考與錯題複習。`;
  }
  const spread = Math.min(7, stats.remainingStudyDays);
  const unit = PLAN_RULES.minuteUnit;
  const extra = Math.ceil(stats.overdueMinutes / spread / unit) * unit;
  return `${head}建議接下來 ${spread} 個讀書日每天多讀約 ${extra} 分鐘補上；若時間不夠，可到「計畫」重新排程，從今天起重排（已完成的任務會保留）。`;
}

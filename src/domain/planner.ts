import { addDays, daysBetween, weekdayOf } from "./dates";
import {
  READING_PARTS,
  type Phase,
  type ReadingPart,
  type SettingsInput,
  type StudyPlan,
  type StudyTask,
} from "./schema";

/**
 * 規則式讀書計畫（不使用 AI）。以下常數是本專案的設計預設，可依需求調整。
 */
export const PLAN_RULES = {
  /** 基礎／強化／考前複習的比例 */
  phaseRatio: { foundation: 0.4, intensive: 0.4, review: 0.2 },
  /** 讀書日少於此數：合併為強化＋複習 */
  mergeFoundationBelow: 14,
  /** 讀書日少於此數：全部為考前複習 */
  reviewOnlyBelow: 7,
  /** 強化與複習階段中，每 N 個讀書日排一天模擬考 */
  mockEvery: 5,
  /** 時間分配單位（分鐘） */
  minuteUnit: 5,
  /** 每日分鐘少於此數時，整天只排最弱的一個單元 */
  splitMinMinutes: 15,
} as const;

export const PHASE_LABELS: Record<Phase, string> = {
  foundation: "基礎",
  intensive: "強化",
  review: "考前複習",
};

const TASK_TITLES: Record<Phase, Record<ReadingPart, string>> = {
  foundation: {
    5: "Part 5 文法與詞彙基礎",
    6: "Part 6 段落填空基礎（連接詞、時態、指代）",
    7: "Part 7 閱讀策略（主旨題、細節題）",
  },
  intensive: {
    5: "Part 5 限時練習",
    6: "Part 6 限時練習（含句子插入）",
    7: "Part 7 限時練習（單篇與多篇文章）",
  },
  review: {
    5: "Part 5 錯題複習與弱點加強",
    6: "Part 6 錯題複習與弱點加強",
    7: "Part 7 錯題複習與限時閱讀",
  },
};

export const MOCK_TASK_TITLE = "模擬考（Part 5–7）";

export interface PlannedTask {
  date: string;
  /** null = 模擬考（涵蓋多個 Part） */
  part: ReadingPart | null;
  title: string;
  minutes: number;
  phase: Phase;
}

export type PlanError = "no_weekdays" | "exam_passed" | "no_study_days";

export const PLAN_ERROR_MESSAGES: Record<PlanError, string> = {
  no_weekdays: "設定裡沒有勾選任何可讀書的星期",
  exam_passed: "考試日期已過，請先到設定更新考試日期",
  no_study_days: "從今天到考試前一天，沒有任何勾選的讀書日",
};

export type PlanResult =
  | { ok: true; tasks: PlannedTask[]; studyDates: string[]; phases: Phase[] }
  | { ok: false; error: PlanError };

/** 從 startDate 到考試前一天，篩出勾選星期的日期。考試當天不排任務。 */
export function listStudyDates(startDate: string, examDate: string, weekdays: readonly number[]): string[] {
  const dates: string[] = [];
  const total = daysBetween(startDate, examDate);
  for (let i = 0; i < total; i++) {
    const date = addDays(startDate, i);
    if (weekdays.includes(weekdayOf(date))) dates.push(date);
  }
  return dates;
}

export function assignPhases(studyDays: number): Phase[] {
  const n = studyDays;
  if (n === 0) return [];
  let foundation = 0;
  let review: number;
  if (n < PLAN_RULES.reviewOnlyBelow) {
    review = n;
  } else if (n < PLAN_RULES.mergeFoundationBelow) {
    review = Math.max(1, Math.round(n * PLAN_RULES.phaseRatio.review));
  } else {
    foundation = Math.round(n * PLAN_RULES.phaseRatio.foundation);
    review = Math.max(1, Math.round(n * PLAN_RULES.phaseRatio.review));
  }
  const intensive = n - foundation - review;
  return [
    ...Array<Phase>(foundation).fill("foundation"),
    ...Array<Phase>(intensive).fill("intensive"),
    ...Array<Phase>(review).fill("review"),
  ];
}

/**
 * 依自評分配每日分鐘：權重 = 6 − 自評（越弱越多），以 5 分鐘為單位做最大餘數分配。
 * 回傳總和一定 ≤ dailyMinutes；分到 0 的單元當天不排。
 */
export function allocateMinutes(
  dailyMinutes: number,
  ratings: SettingsInput["self_ratings"],
): { part: ReadingPart; minutes: number }[] {
  const weighted = READING_PARTS.map((part) => ({ part, weight: 6 - ratings[part] }));
  // 權重高者優先；同權重時 Part 編號小者優先
  weighted.sort((a, b) => b.weight - a.weight || a.part - b.part);

  if (dailyMinutes < PLAN_RULES.splitMinMinutes) {
    return [{ part: weighted[0].part, minutes: dailyMinutes }];
  }

  const unit = PLAN_RULES.minuteUnit;
  const units = Math.floor(dailyMinutes / unit);
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const shares = weighted.map((w) => {
    const exact = (units * w.weight) / totalWeight;
    return { ...w, units: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = units - shares.reduce((s, x) => s + x.units, 0);
  for (const s of [...shares].sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.part - b.part)) {
    if (left === 0) break;
    s.units += 1;
    left -= 1;
  }
  return shares
    .filter((s) => s.units > 0)
    .sort((a, b) => a.part - b.part)
    .map((s) => ({ part: s.part, minutes: s.units * unit }));
}

export function generatePlanTasks(settings: SettingsInput, startDate: string): PlanResult {
  if (settings.available_weekdays.length === 0) return { ok: false, error: "no_weekdays" };
  if (settings.exam_date < startDate) return { ok: false, error: "exam_passed" };

  const studyDates = listStudyDates(startDate, settings.exam_date, settings.available_weekdays);
  if (studyDates.length === 0) return { ok: false, error: "no_study_days" };

  const phases = assignPhases(studyDates.length);
  const allocation = allocateMinutes(settings.daily_minutes, settings.self_ratings);
  const tasks: PlannedTask[] = [];
  let practiceDayIndex = 0;

  studyDates.forEach((date, i) => {
    const phase = phases[i];
    if (phase !== "foundation") {
      practiceDayIndex += 1;
      if (practiceDayIndex % PLAN_RULES.mockEvery === 0) {
        tasks.push({ date, part: null, title: MOCK_TASK_TITLE, minutes: settings.daily_minutes, phase });
        return;
      }
    }
    for (const { part, minutes } of allocation) {
      tasks.push({ date, part, title: TASK_TITLES[phase][part], minutes, phase });
    }
  });

  return { ok: true, tasks, studyDates, phases };
}

// ---------- 重新排程 ----------

export interface ReschedulePreview {
  /** 舊計畫中已完成的任務：全部保留並移到新計畫 */
  kept: StudyTask[];
  /** 新計畫要新增的任務（已排除與保留任務同日同單元者） */
  added: PlannedTask[];
  /** 今天以前未完成的任務：不帶進新計畫（舊計畫仍保留在資料庫） */
  droppedPast: StudyTask[];
  /** 今天起未完成的任務：由新排程取代 */
  replacedFuture: StudyTask[];
  /** 今天起內容有變動的日期 */
  changedDates: { date: string; before: string[]; after: string[] }[];
}

type Slot = { date: string; part: number | null };
const sameSlot = (a: Slot, b: Slot) => a.date === b.date && a.part === b.part;

export function previewReschedule(
  oldTasks: readonly StudyTask[],
  newTasks: readonly PlannedTask[],
  today: string,
): ReschedulePreview {
  const kept = oldTasks.filter((t) => t.completed_at !== null);
  const added = newTasks.filter((n) => !kept.some((k) => sameSlot(k, n)));
  const pending = oldTasks.filter((t) => t.completed_at === null);
  const droppedPast = pending.filter((t) => t.date < today);
  const replacedFuture = pending.filter((t) => t.date >= today);

  // 同一天依 Part 排序後再比較，避免資料庫讀出的順序不同被誤判為變動
  type Row = { date: string; part: number | null; title: string; minutes: number };
  const byDay = (rows: Row[]) => {
    const map = new Map<string, string[]>();
    const sorted = rows.filter((t) => t.date >= today).sort((x, y) => (x.part ?? 0) - (y.part ?? 0));
    for (const t of sorted) map.set(t.date, [...(map.get(t.date) ?? []), `${t.title}｜${t.minutes} 分`]);
    return map;
  };
  const before = byDay([...oldTasks]);
  const after = byDay([...kept, ...added]);
  const dates = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changedDates = dates
    .map((date) => ({ date, before: before.get(date) ?? [], after: after.get(date) ?? [] }))
    .filter((d) => d.before.join("\n") !== d.after.join("\n"));

  return { kept, added, droppedPast, replacedFuture, changedDates };
}

// ---------- 建立紀錄 ----------

export interface PlanRecordsInput {
  settings: SettingsInput;
  startDate: string;
  tasks: readonly PlannedTask[];
  version: number;
  now: string;
  newId: () => string;
}

export function buildPlanRecords({ settings, startDate, tasks, version, now, newId }: PlanRecordsInput): {
  plan: StudyPlan;
  tasks: StudyTask[];
} {
  const plan: StudyPlan = {
    id: newId(),
    created_at: now,
    updated_at: now,
    version,
    start_date: startDate,
    exam_date: settings.exam_date,
    settings_snapshot: settings,
    status: "active",
  };
  return {
    plan,
    tasks: tasks.map((t) => ({
      id: newId(),
      created_at: now,
      updated_at: now,
      plan_id: plan.id,
      date: t.date,
      part: t.part,
      title: t.title,
      minutes: t.minutes,
      phase: t.phase,
      completed_at: null,
    })),
  };
}

/** 設定中影響排程的欄位是否與計畫建立時不同。 */
export function settingsChangedSincePlan(plan: StudyPlan, settings: SettingsInput): boolean {
  const pick = (s: SettingsInput) =>
    JSON.stringify([s.exam_date, s.daily_minutes, [...s.available_weekdays].sort(), s.self_ratings]);
  return pick(plan.settings_snapshot) !== pick(settings);
}

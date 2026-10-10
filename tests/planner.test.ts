import { describe, expect, it } from "vitest";
import {
  allocateMinutes,
  assignPhases,
  buildPlanRecords,
  generatePlanTasks,
  listStudyDates,
  MOCK_TASK_TITLE,
  PLAN_RULES,
  previewReschedule,
  settingsChangedSincePlan,
} from "@/domain/planner";
import { addDays, weekdayOf } from "@/domain/dates";
import type { SettingsInput, StudyTask } from "@/domain/schema";

const base: SettingsInput = {
  exam_date: "2026-12-13", // 週日
  target_score: 800,
  current_score: null,
  daily_minutes: 60,
  available_weekdays: [1, 2, 3, 4, 5],
  self_ratings: { 5: 3, 6: 2, 7: 4 },
  bank_csv_url: null,
};
const START = "2026-10-12"; // 週一

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, "0")}`;

function records(settings: SettingsInput, start: string) {
  const r = generatePlanTasks(settings, start);
  if (!r.ok) throw new Error(r.error);
  return buildPlanRecords({ settings, startDate: start, tasks: r.tasks, version: 1, now: "2026-10-12T00:00:00.000Z", newId });
}

describe("listStudyDates", () => {
  it("只排勾選的星期，且不含考試當天", () => {
    const dates = listStudyDates("2026-12-07", "2026-12-13", [0, 1, 3]);
    expect(dates).toEqual(["2026-12-07", "2026-12-09"]); // 12/13 是週日也是考試日，不排
  });
  it("考試前最後一天有勾選時會排入", () => {
    const dates = listStudyDates("2026-12-07", "2026-12-13", [6]);
    expect(dates).toEqual(["2026-12-12"]);
  });
});

describe("generatePlanTasks", () => {
  it("未選星期回傳 no_weekdays", () => {
    expect(generatePlanTasks({ ...base, available_weekdays: [] }, START)).toEqual({ ok: false, error: "no_weekdays" });
  });

  it("考試日期已過回傳 exam_passed", () => {
    expect(generatePlanTasks({ ...base, exam_date: "2026-10-01" }, START)).toEqual({ ok: false, error: "exam_passed" });
  });

  it("考試就是今天，或範圍內沒有勾選的星期，回傳 no_study_days", () => {
    expect(generatePlanTasks({ ...base, exam_date: START }, START)).toEqual({ ok: false, error: "no_study_days" });
    // 10/12 週一 → 10/14 週三考試，只勾週六
    expect(generatePlanTasks({ ...base, exam_date: "2026-10-14", available_weekdays: [6] }, START)).toEqual({
      ok: false,
      error: "no_study_days",
    });
  });

  it("任務只落在勾選星期，且全部早於考試日", () => {
    const r = generatePlanTasks(base, START);
    if (!r.ok) throw new Error();
    for (const t of r.tasks) {
      expect(base.available_weekdays).toContain(weekdayOf(t.date));
      expect(t.date < base.exam_date).toBe(true);
    }
  });

  it.each([5, 14, 17, 30, 45, 60, 73, 90, 120, 240])("每日總分鐘不超過設定（%i 分）", (daily) => {
    for (const ratings of [
      { 5: 1, 6: 1, 7: 1 },
      { 5: 5, 6: 1, 7: 3 },
      { 5: 2, 6: 4, 7: 5 },
    ] as const) {
      const r = generatePlanTasks({ ...base, daily_minutes: daily, self_ratings: ratings }, START);
      if (!r.ok) throw new Error();
      const perDay = new Map<string, number>();
      for (const t of r.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
      for (const total of perDay.values()) expect(total).toBeLessThanOrEqual(daily);
      expect(r.tasks.every((t) => t.minutes > 0)).toBe(true);
    }
  });

  it("最後一個讀書日屬於考前複習階段", () => {
    const r = generatePlanTasks(base, START);
    if (!r.ok) throw new Error();
    const last = r.tasks[r.tasks.length - 1];
    expect(last.date).toBe("2026-12-11"); // 考試前最後一個週五
    expect(last.phase).toBe("review");
  });

  it("基礎階段不排模擬考；強化與複習階段每 5 個讀書日一次", () => {
    const r = generatePlanTasks(base, START);
    if (!r.ok) throw new Error();
    const mocks = r.tasks.filter((t) => t.part === null);
    expect(mocks.every((t) => t.phase !== "foundation" && t.title === MOCK_TASK_TITLE)).toBe(true);
    const practiceDays = r.phases.filter((p) => p !== "foundation").length;
    expect(mocks.length).toBe(Math.floor(practiceDays / PLAN_RULES.mockEvery));
    // 模擬考日當天只有一項任務
    for (const m of mocks) expect(r.tasks.filter((t) => t.date === m.date)).toHaveLength(1);
  });
});

describe("assignPhases", () => {
  it("一般長度依 40/40/20 分配，順序為基礎→強化→複習", () => {
    const p = assignPhases(50);
    expect(p.filter((x) => x === "foundation")).toHaveLength(20);
    expect(p.filter((x) => x === "intensive")).toHaveLength(20);
    expect(p.filter((x) => x === "review")).toHaveLength(10);
    expect(p.indexOf("intensive")).toBe(20);
  });
  it("短期計畫合併階段", () => {
    expect(assignPhases(10).includes("foundation")).toBe(false);
    expect(assignPhases(10).at(-1)).toBe("review");
    expect(new Set(assignPhases(5))).toEqual(new Set(["review"]));
  });
});

describe("allocateMinutes", () => {
  it("自評越弱分到越多時間", () => {
    const a = allocateMinutes(60, { 5: 4, 6: 1, 7: 3 });
    const m = Object.fromEntries(a.map((x) => [x.part, x.minutes]));
    expect(m[6]).toBeGreaterThan(m[7]);
    expect(m[7]).toBeGreaterThan(m[5]);
    expect(a.reduce((s, x) => s + x.minutes, 0)).toBe(60);
  });
  it("時間太少時只排最弱的單元", () => {
    expect(allocateMinutes(10, { 5: 4, 6: 2, 7: 2 })).toEqual([{ part: 6, minutes: 10 }]);
  });
});

describe("previewReschedule", () => {
  it("保留所有已完成任務，新任務避開同日同單元，未完成的分成過去與未來", () => {
    const old = records(base, START);
    const tasks: StudyTask[] = old.tasks.map((t) => ({ ...t }));
    const today = "2026-10-20";
    // 過去：10/12 完成、10/13 未完成；今天：10/20 完成其中一項
    const done = (t: StudyTask) => ({ ...t, completed_at: "2026-10-12T10:00:00.000Z" });
    tasks.forEach((t, i) => {
      if (t.date === "2026-10-12" || (t.date === today && t.part === 6)) tasks[i] = done(t);
    });

    const regenerated = generatePlanTasks({ ...base, daily_minutes: 90 }, today);
    if (!regenerated.ok) throw new Error();
    const preview = previewReschedule(tasks, regenerated.tasks, today);

    const completed = tasks.filter((t) => t.completed_at);
    expect(preview.kept.map((t) => t.id).sort()).toEqual(completed.map((t) => t.id).sort());
    expect(preview.added.some((t) => t.date === today && t.part === 6)).toBe(false);
    expect(preview.added.some((t) => t.date === today && t.part === 5)).toBe(true);
    expect(preview.droppedPast.every((t) => t.date < today && !t.completed_at)).toBe(true);
    expect(preview.droppedPast.some((t) => t.date === "2026-10-13")).toBe(true);
    expect(preview.replacedFuture.every((t) => t.date >= today && !t.completed_at)).toBe(true);
    expect(preview.changedDates.length).toBeGreaterThan(0);
    expect(preview.changedDates.every((d) => d.date >= today)).toBe(true);
  });

  it("設定沒變時重排今天起的內容不變", () => {
    const old = records(base, START);
    const regenerated = generatePlanTasks(base, START);
    if (!regenerated.ok) throw new Error();
    expect(previewReschedule(old.tasks, regenerated.tasks, START).changedDates).toEqual([]);
  });

  it("資料庫讀出的任務順序不同，不會被誤判為變動", () => {
    const old = records(base, START);
    const shuffled = [...old.tasks].reverse();
    const regenerated = generatePlanTasks(base, START);
    if (!regenerated.ok) throw new Error();
    expect(previewReschedule(shuffled, regenerated.tasks, START).changedDates).toEqual([]);
  });
});

describe("settingsChangedSincePlan", () => {
  it("只比較影響排程的欄位", () => {
    const { plan } = records(base, START);
    expect(settingsChangedSincePlan(plan, { ...base, target_score: 900 })).toBe(false);
    expect(settingsChangedSincePlan(plan, { ...base, available_weekdays: [5, 4, 3, 2, 1] })).toBe(false);
    expect(settingsChangedSincePlan(plan, { ...base, daily_minutes: 45 })).toBe(true);
    expect(settingsChangedSincePlan(plan, { ...base, exam_date: addDays(base.exam_date, 7) })).toBe(true);
  });
});

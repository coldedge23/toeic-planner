import { describe, expect, it } from "vitest";
import { catchUpSuggestion, computeTodayStats } from "@/domain/progress";
import { todayInTaipei } from "@/domain/dates";
import type { StudyTask } from "@/domain/schema";

let seq = 0;
function task(date: string, done: boolean, minutes = 30): StudyTask {
  const id = `00000000-0000-4000-8000-${(++seq).toString().padStart(12, "0")}`;
  return {
    id,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    plan_id: "00000000-0000-4000-8000-999999999999",
    date,
    part: 5,
    title: "Part 5 練習",
    minutes,
    phase: "foundation",
    completed_at: done ? "2026-10-01T12:00:00.000Z" : null,
  };
}

const TODAY = "2026-10-15"; // 週四

describe("computeTodayStats", () => {
  it("今日完成數與達標", () => {
    const s = computeTodayStats([task(TODAY, true), task(TODAY, false)], TODAY);
    expect([s.todayDone, s.todayTotal, s.todayAchieved]).toEqual([1, 2, false]);
    expect(computeTodayStats([task(TODAY, true)], TODAY).todayAchieved).toBe(true);
  });

  it("今天沒有任務（休息日）不算達標", () => {
    const s = computeTodayStats([task("2026-10-14", true)], TODAY);
    expect(s.todayTotal).toBe(0);
    expect(s.todayAchieved).toBe(false);
  });

  it("落後天數＝過去至少一項未完成的讀書日數", () => {
    const s = computeTodayStats(
      [
        task("2026-10-12", true),
        task("2026-10-12", false, 20),
        task("2026-10-13", true),
        task("2026-10-14", false, 25),
        task(TODAY, false),
        task("2026-10-16", false),
      ],
      TODAY,
    );
    expect(s.behindDays).toBe(2);
    expect(s.overdueMinutes).toBe(45);
    expect(s.overdue).toHaveLength(2);
  });

  it("休息日不中斷也不增加連續達標", () => {
    // 10/10、10/11 是週末休息日（沒有任務）
    const tasks = [task("2026-10-08", false), task("2026-10-09", true), task("2026-10-12", true), task("2026-10-14", true)];
    expect(computeTodayStats(tasks, TODAY).streak).toBe(3);
  });

  it("今天尚未完成時不中斷，從昨天往前數；今天完成則加一", () => {
    const past = [task("2026-10-13", true), task("2026-10-14", true)];
    expect(computeTodayStats([...past, task(TODAY, false)], TODAY).streak).toBe(2);
    expect(computeTodayStats([...past, task(TODAY, true)], TODAY).streak).toBe(3);
  });

  it("過去有未完成的讀書日會中斷連續達標", () => {
    const tasks = [task("2026-10-12", true), task("2026-10-13", false), task("2026-10-14", true)];
    expect(computeTodayStats(tasks, TODAY).streak).toBe(1);
  });

  it("跨日以台北時間判斷：UTC 15:59 與 16:00 分屬不同天", () => {
    expect(todayInTaipei(new Date("2026-10-14T15:59:59Z"))).toBe("2026-10-14");
    expect(todayInTaipei(new Date("2026-10-14T16:00:00Z"))).toBe("2026-10-15");
    const tasks = [task("2026-10-14", false)];
    expect(computeTodayStats(tasks, todayInTaipei(new Date("2026-10-14T15:59:59Z"))).behindDays).toBe(0);
    expect(computeTodayStats(tasks, todayInTaipei(new Date("2026-10-14T16:00:00Z"))).behindDays).toBe(1);
  });
});

describe("catchUpSuggestion", () => {
  it("沒有落後時不給建議", () => {
    expect(catchUpSuggestion(computeTodayStats([task(TODAY, false)], TODAY))).toBeNull();
  });

  it("把落後分鐘平均分到接下來最多 7 個讀書日，以 5 分鐘為單位進位", () => {
    const future = ["2026-10-15", "2026-10-16", "2026-10-19"].map((d) => task(d, false));
    const s = computeTodayStats([task("2026-10-14", false, 40), ...future], TODAY);
    expect(catchUpSuggestion(s)).toContain("接下來 3 個讀書日每天多讀約 15 分鐘");
  });

  it("考前已沒有讀書日時改給優先順序建議", () => {
    const s = computeTodayStats([task("2026-10-14", false)], TODAY);
    expect(catchUpSuggestion(s)).toContain("考前已沒有排定的讀書日");
  });
});

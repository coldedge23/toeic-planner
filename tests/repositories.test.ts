import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";
import { defaultSettingsInput } from "@/domain/settings";
import { BackupSchema } from "@/domain/schema";
import { demoQuestions } from "@/fixtures/demo-bank";
import { buildPlanRecords, generatePlanTasks, previewReschedule } from "@/domain/planner";

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;

beforeEach(() => {
  db = new ToeicDB(`test-${crypto.randomUUID()}`);
  repos = createDexieRepositories(db);
});
afterEach(async () => {
  await db.delete();
});

describe("SettingsRepository", () => {
  it("尚未儲存時回傳 null", async () => {
    expect(await repos.settings.get()).toBeNull();
  });

  it("儲存後重新開啟資料庫仍讀得到（模擬重新整理）", async () => {
    const saved = await repos.settings.save({ ...defaultSettingsInput(), target_score: 850 });
    db.close();
    const reopened = new ToeicDB(db.name);
    const loaded = await createDexieRepositories(reopened).settings.get();
    expect(loaded).toEqual(saved);
    expect(loaded?.timezone).toBe("Asia/Taipei");
    reopened.close();
    await db.open();
  });

  it("再次儲存更新同一筆，保留 id 與 created_at", async () => {
    const first = await repos.settings.save(defaultSettingsInput());
    const second = await repos.settings.save({ ...defaultSettingsInput(), daily_minutes: 90 });
    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    expect(second.daily_minutes).toBe(90);
    expect(await db.settings.count()).toBe(1);
  });

  it("不合法的設定不會寫入", async () => {
    await expect(repos.settings.save({ ...defaultSettingsInput(), daily_minutes: 0 })).rejects.toThrow();
    expect(await db.settings.count()).toBe(0);
  });
});

describe("BankRepository", () => {
  it("seedDemo 重複呼叫不會重複新增", async () => {
    await repos.bank.seedDemo();
    await repos.bank.seedDemo();
    expect(await db.questions.count()).toBe(demoQuestions.length);
  });

  it("stats 只統計已審核題目，並依 Part 分組", async () => {
    await repos.bank.seedDemo();
    await db.questions.update(demoQuestions[0].id, { status: "draft" });
    const stats = await repos.bank.stats();
    expect(stats.total).toBe(demoQuestions.length - 1);
    expect(stats.byPart[5]).toBe(demoQuestions.filter((q) => q.part === 5).length - 1);
  });

  it("listApproved 依 Part 篩選", async () => {
    await repos.bank.seedDemo();
    const p7 = await repos.bank.listApproved([7]);
    expect(p7.length).toBe(demoQuestions.filter((q) => q.part === 7).length);
    expect(p7.every((q) => q.part === 7)).toBe(true);
  });
});

describe("PlansRepository", () => {
  const settings = { ...defaultSettingsInput(), exam_date: "2026-12-13" };
  const build = (start: string, version: number, s = settings) => {
    const r = generatePlanTasks(s, start);
    if (!r.ok) throw new Error(r.error);
    return buildPlanRecords({
      settings: s,
      startDate: start,
      tasks: r.tasks,
      version,
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  };

  it("建立計畫後可讀回；已有計畫時不可重複建立", async () => {
    const { plan, tasks } = build("2026-10-12", 1);
    await repos.plans.createPlan(plan, tasks);
    expect((await repos.plans.getActivePlan())?.id).toBe(plan.id);
    expect(await repos.plans.listTasks(plan.id)).toHaveLength(tasks.length);
    const again = build("2026-10-12", 1);
    await expect(repos.plans.createPlan(again.plan, again.tasks)).rejects.toThrow();
    expect(await db.study_plans.count()).toBe(1);
  });

  it("勾選與取消勾選", async () => {
    const { plan, tasks } = build("2026-10-12", 1);
    await repos.plans.createPlan(plan, tasks);
    await repos.plans.setTaskCompleted(tasks[0].id, true);
    expect((await db.study_tasks.get(tasks[0].id))?.completed_at).not.toBeNull();
    await repos.plans.setTaskCompleted(tasks[0].id, false);
    expect((await db.study_tasks.get(tasks[0].id))?.completed_at).toBeNull();
  });

  it("重新排程：保留已完成任務、舊計畫標為 superseded 且未完成任務不刪", async () => {
    const first = build("2026-10-12", 1);
    await repos.plans.createPlan(first.plan, first.tasks);
    const doneTask = first.tasks[0];
    await repos.plans.setTaskCompleted(doneTask.id, true);

    const today = "2026-10-20";
    const oldTasks = await repos.plans.listTasks(first.plan.id);
    const regenerated = generatePlanTasks({ ...settings, daily_minutes: 90 }, today);
    if (!regenerated.ok) throw new Error();
    const preview = previewReschedule(oldTasks, regenerated.tasks, today);
    const next = buildPlanRecords({
      settings: { ...settings, daily_minutes: 90 },
      startDate: today,
      tasks: preview.added,
      version: 2,
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
    await repos.plans.applyReschedule({
      oldPlanId: first.plan.id,
      newPlan: next.plan,
      newTasks: next.tasks,
      keptTaskIds: preview.kept.map((t) => t.id),
    });

    const active = await repos.plans.getActivePlan();
    expect(active?.id).toBe(next.plan.id);
    expect(active?.version).toBe(2);
    expect((await db.study_plans.get(first.plan.id))?.status).toBe("superseded");
    const activeTasks = await repos.plans.listTasks(next.plan.id);
    expect(activeTasks.find((t) => t.id === doneTask.id)?.completed_at).not.toBeNull();
    expect(activeTasks).toHaveLength(next.tasks.length + 1);
    expect(await repos.plans.listTasks(first.plan.id)).toHaveLength(first.tasks.length - 1);
  });

  it("重新排程失敗時資料完全不變", async () => {
    const first = build("2026-10-12", 1);
    await repos.plans.createPlan(first.plan, first.tasks);
    const next = build("2026-10-20", 2);
    await expect(
      repos.plans.applyReschedule({
        oldPlanId: first.plan.id,
        newPlan: next.plan,
        newTasks: next.tasks,
        keptTaskIds: [first.tasks[0].id], // 尚未完成，不能被保留
      }),
    ).rejects.toThrow();
    expect((await repos.plans.getActivePlan())?.id).toBe(first.plan.id);
    expect(await db.study_plans.count()).toBe(1);
    expect(await db.study_tasks.count()).toBe(first.tasks.length);
  });
});

describe("BackupsRepository", () => {
  it("匯出內容通過 BackupSchema，且標示未包含媒體檔", async () => {
    await repos.bank.seedDemo();
    await repos.settings.save(defaultSettingsInput());
    const backup = await repos.backups.exportAll();
    expect(BackupSchema.safeParse(backup).success).toBe(true);
    expect(backup.media_binaries_included).toBe(false);
    expect(backup.questions.length).toBe(demoQuestions.length);
  });
});

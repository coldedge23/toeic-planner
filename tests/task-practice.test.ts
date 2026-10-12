import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recommendTaskPractice } from "@/domain/task-practice";
import { buildSession } from "@/domain/exam-engine";
import { buildPlanRecords, generatePlanTasks } from "@/domain/planner";
import { defaultSettingsInput } from "@/domain/settings";
import { parseBackup } from "@/domain/backup-migrations";
import { demoQuestions } from "@/fixtures/demo-bank";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";

let db: ToeicDB;
let repos: ReturnType<typeof createDexieRepositories>;
const now = new Date("2026-10-12T02:00:00Z");
const settings = { ...defaultSettingsInput(), exam_date: "2026-12-31", available_weekdays: [1, 2, 3, 4, 5, 6, 0] };
const draft = generatePlanTasks(settings, "2026-10-12");
if (!draft.ok) throw new Error();
const records = () => buildPlanRecords({ settings, startDate: "2026-10-12", tasks: draft.tasks, version: 1, now: now.toISOString(), newId: () => crypto.randomUUID() });
beforeEach(async () => {
  db = new ToeicDB(`test-${crypto.randomUUID()}`);
  repos = createDexieRepositories(db);
  await repos.bank.seedDemo();
});
afterEach(async () => { await db.delete(); });

describe("任務練習", () => {
  it("依分鐘估算、保留題組，題庫不足與空題庫都有提示", () => {
    const task = records().tasks.find((t) => t.part === 6)!;
    const rec = recommendTaskPractice(task, demoQuestions);
    expect(rec.parts).toEqual([6]);
    expect(rec.count).toBe(4);
    expect(rec.notice).toContain("目前只有");
    const short = recommendTaskPractice({ ...task, minutes: 1 }, demoQuestions);
    expect(short.count).toBe(4);
    expect(short.notice).toContain("完整文章題組");
    expect(recommendTaskPractice(task, []).count).toBe(0);
    expect(recommendTaskPractice(task, []).notice).toContain("沒有可用");
    const mixed = recommendTaskPractice({ ...task, part: null }, demoQuestions.filter((q) => q.part === 5));
    expect(mixed.notice).toContain("缺少 Part 6、7");
  });

  it("交卷不自動完成，關聯在重開後仍保留，明確確認才完成且可手動取消", async () => {
    const r = records();
    await repos.plans.createPlan(r.plan, r.tasks);
    const task = r.tasks.find((t) => t.part === 5)!;
    const q = demoQuestions.find((q) => q.part === 5)!;
    const s = buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null, studyTaskId: task.id }, [{ question: q, group: null }], now, () => crypto.randomUUID());
    await repos.sessions.create(s);
    await expect(repos.plans.completeFromSession(s.id)).rejects.toThrow("尚未交卷");
    db.close();
    await db.open();
    expect((await repos.sessions.get(s.id))?.study_task_id).toBe(task.id);
    await repos.sessions.submit(s.id, now);
    expect((await repos.plans.getTask(task.id))?.completed_at).toBeNull();
    await repos.plans.completeFromSession(s.id);
    const completed = (await repos.plans.getTask(task.id))?.completed_at;
    expect(completed).not.toBeNull();
    await repos.plans.completeFromSession(s.id);
    expect((await repos.plans.getTask(task.id))?.completed_at).toBe(completed);
    await repos.plans.setTaskCompleted(task.id, false);
    expect((await repos.plans.getTask(task.id))?.completed_at).toBeNull();
    const backup = await repos.backups.exportAll();
    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true);
    expect(parseBackup(JSON.stringify({ ...backup, study_tasks: [] })).ok).toBe(false);
    await repos.backups.importAll(backup);
    expect((await repos.sessions.get(s.id))?.study_task_id).toBe(task.id);
  });

  it("不同Part與失效任務不可關聯，重排後不會完成新任務", async () => {
    const r = records();
    await repos.plans.createPlan(r.plan, r.tasks);
    const task = r.tasks.find((t) => t.part === 6)!;
    const q = demoQuestions.find((q) => q.part === 5)!;
    const s = buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null, studyTaskId: task.id }, [{ question: q, group: null }], now, () => crypto.randomUUID());
    await expect(repos.sessions.create(s)).rejects.toThrow("單元與任務不一致");
    s.study_task_id = r.tasks.find((t) => t.part === 5)!.id;
    await repos.sessions.create(s);
    await repos.sessions.submit(s.id, now);
    const next = records();
    await repos.plans.applyReschedule({ oldPlanId: r.plan.id, newPlan: next.plan, newTasks: next.tasks, keptTaskIds: [] });
    await expect(repos.plans.completeFromSession(s.id)).rejects.toThrow("重新排程");
    expect((await repos.plans.listTasks(next.plan.id)).every((t) => t.completed_at === null)).toBe(true);
    await expect(repos.sessions.create({ ...s, id: crypto.randomUUID() })).rejects.toThrow("重新排程");
  });

  it("v2備份遷移成v3，不將舊測驗猜測關聯到任務", async () => {
    const q = demoQuestions[0];
    await repos.sessions.create(buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null }, [{ question: q, group: null }], now, () => crypto.randomUUID()));
    const backup = await repos.backups.exportAll();
    const old = { ...backup, schema_version: 2, sessions: backup.sessions.map(({ study_task_id: _, ...s }) => s) };
    const result = parseBackup(JSON.stringify(old));
    expect(result.ok && result.migratedFrom).toBe(2);
    expect(result.ok && result.backup.sessions[0].study_task_id).toBeNull();
  });

  it("IndexedDB v2升級保留測驗、答案並補上空任務關聯", async () => {
    const name = `legacy-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    // 以實際v2的所有store建立舊資料庫，讓新版本upgrade走真正的資料遷移。
    legacy.version(2).stores(Object.fromEntries(db.tables.map((t) => [t.name, t.schema.primKey.src + (t.schema.indexes.length ? ',' + t.schema.indexes.filter((i) => i.name !== 'study_task_id').map((i) => i.src).join(',') : '')])));
    const q = demoQuestions[0];
    const session = buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null }, [{ question: q, group: null }], now, () => crypto.randomUUID());
    const { study_task_id: _, ...old } = session;
    await legacy.table("sessions").add(old);
    const answer = { id: crypto.randomUUID(), session_id: session.id, question_id: q.id,
      created_at: now.toISOString(), updated_at: now.toISOString(), selected_key: q.correct_key,
      answered_at: now.toISOString(), elapsed_ms: 1000 };
    await legacy.table("answers").add(answer);
    legacy.close();
    const upgraded = new ToeicDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.sessions.get(session.id)).toEqual({ ...old, study_task_id: null });
      expect(await upgraded.answers.get(answer.id)).toEqual(answer);
    } finally { await upgraded.delete(); }
  });
});

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAttempts, clearItems, MASTERY_STREAK, restoreItem } from "@/domain/mistake-policy";
import { backupFileName, parseBackup } from "@/domain/backup-migrations";
import { buildSession, selectQuestions } from "@/domain/exam-engine";
import { buildPlanRecords, generatePlanTasks } from "@/domain/planner";
import { defaultSettingsInput } from "@/domain/settings";
import { SCHEMA_VERSION, type Attempt, type MistakeItem, type Question } from "@/domain/schema";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";

const Q = demoQuestions[0];
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, "0")}`;
const attempt = (isCorrect: boolean, questionId = Q.id): Attempt => ({
  id: newId(),
  created_at: "2026-10-10T00:00:00.000Z",
  updated_at: "2026-10-10T00:00:00.000Z",
  session_id: newId(),
  question_id: questionId,
  question_version: 1,
  selected_key: isCorrect ? "B" : "A",
  is_correct: isCorrect,
  submitted_at: "2026-10-10T00:00:00.000Z",
});

/** 依序套用多次交卷，回傳該題最後的錯題狀態 */
function run(...results: boolean[]): MistakeItem | undefined {
  let map = new Map<string, MistakeItem>();
  results.forEach((r, i) => {
    const updates = applyAttempts(map, [attempt(r)], `2026-10-1${i}T00:00:00.000Z`, newId);
    map = new Map([...map, ...updates.map((u) => [u.question_id, u] as const)]);
  });
  return map.get(Q.id);
}

describe("mistake-policy", () => {
  it("答對且不在錯題本：不建立錯題", () => {
    expect(run(true)).toBeUndefined();
  });

  it("錯→對→對：連續答對 2 次後封存", () => {
    expect(MASTERY_STREAK).toBe(2);
    const afterOne = run(false, true);
    expect(afterOne).toMatchObject({ state: "active", correct_streak: 1, wrong_count: 1 });
    expect(run(false, true, true)).toMatchObject({ state: "archived", archive_reason: "mastered", correct_streak: 2 });
  });

  it("錯→對→錯：連續答對歸零，答錯次數累加", () => {
    expect(run(false, true, false)).toMatchObject({ state: "active", correct_streak: 0, wrong_count: 2 });
  });

  it("復原：熟練封存者連續答對歸零；清空者保留進度", () => {
    const mastered = run(false, true, true)!;
    expect(restoreItem(mastered, "2026-10-20T00:00:00.000Z")).toMatchObject({ state: "active", correct_streak: 0 });
    const [cleared] = clearItems([run(false, true)!], "2026-10-20T00:00:00.000Z");
    expect(cleared).toMatchObject({ state: "archived", archive_reason: "cleared" });
    expect(restoreItem(cleared, "2026-10-21T00:00:00.000Z")).toMatchObject({ state: "active", correct_streak: 1 });
  });

  it("封存後再答錯會重新放回錯題本", () => {
    expect(run(false, true, true, false)).toMatchObject({
      state: "active",
      correct_streak: 0,
      wrong_count: 2,
      archived_at: null,
      archive_reason: null,
    });
  });
});

describe("parseBackup", () => {
  it("損壞的舊版 sessions 不會讓解析拋出例外", () => {
    expect(parseBackup(JSON.stringify({ schema_version: 1, sessions: {} })).ok).toBe(false);
  });
  it("損壞的 JSON", () => {
    expect(parseBackup("{not json")).toEqual({ ok: false, error: "檔案不是有效的 JSON，可能已損壞" });
    expect(parseBackup("[]").ok).toBe(false);
    expect(parseBackup('{"hello":1}').ok).toBe(false);
  });

  it("來自較新版本的備份會被拒絕", () => {
    const r = parseBackup(JSON.stringify({ schema_version: SCHEMA_VERSION + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("較新版本");
  });

  it("欄位格式錯誤時指出位置", () => {
    const r = parseBackup(JSON.stringify({ schema_version: SCHEMA_VERSION, exported_at: "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("備份內容格式錯誤");
  });

  it("檔名符合 YYYYMMDD_主題_vN", () => {
    expect(backupFileName("2026-10-10")).toBe(`20261010_TOEIC備考備份_v${SCHEMA_VERSION}.json`);
  });
});

describe("Dexie：錯題與備份", () => {
  let db: ToeicDB;
  let repos: ReturnType<typeof createDexieRepositories>;
  const T0 = new Date("2026-10-10T02:00:00.000Z");

  beforeEach(async () => {
    db = new ToeicDB(`test-${crypto.randomUUID()}`);
    repos = createDexieRepositories(db);
    await repos.bank.seedDemo();
  });
  afterEach(async () => {
    await db.delete();
  });

  /** 建立一場只含指定題目的測驗並交卷；answers: questionId → 是否答對 */
  async function takeSession(questions: Question[], correct: (q: Question) => boolean, source: "bank" | "mistakes" = "bank") {
    const items = questions.map((question) => ({
      question,
      group: demoGroups.find((g) => g.id === question.group_id) ?? null,
    }));
    const s = buildSession({ source, parts: [5, 6, 7], count: items.length, secondsPerQuestion: null }, items, T0, () =>
      crypto.randomUUID(),
    );
    await repos.sessions.create(s);
    for (const q of questions) {
      const wrongKey = q.correct_key === "A" ? "B" : "A";
      await repos.sessions.saveAnswer({
        sessionId: s.id,
        questionId: q.id,
        selectedKey: correct(q) ? q.correct_key : wrongKey,
        elapsedMs: 0,
      });
    }
    return repos.sessions.submit(s.id, T0);
  }

  it("交卷自動收錄答錯與未作答的題目；重送不重複計算", async () => {
    const [a, b, c] = demoQuestions.filter((q) => q.part === 5);
    const r = await takeSession([a, b, c], (q) => q.id === a.id);
    expect(await repos.mistakes.countActive()).toBe(2);
    await repos.sessions.submit(r.session.id, T0); // 重送
    const active = await repos.mistakes.listActive();
    expect(active).toHaveLength(2);
    expect(active.every((e) => e.item.wrong_count === 1)).toBe(true);
    expect(active.every((e) => e.question !== null)).toBe(true);
  });

  it("錯題附上文章、題組內順序與最後一次答錯的作答", async () => {
    const p6 = demoQuestions.filter((q) => q.part === 6).sort((a, b) => a.source_id.localeCompare(b.source_id));
    const target = p6[1];
    const wrongKey = target.correct_key === "A" ? "B" : "A";
    await takeSession([target], () => false);
    // 之後答對一次：最後答錯的紀錄仍是前一次
    await takeSession([target], () => true, "mistakes");
    const [entry] = await repos.mistakes.listActive();
    expect(entry.question?.id).toBe(target.id);
    expect(entry.group?.id).toBe(target.group_id);
    expect(entry.positionInGroup).toBe(1);
    expect(entry.lastWrong).toEqual({ selected_key: wrongKey, submitted_at: T0.toISOString() });
    expect(entry.item.correct_streak).toBe(1);
  });

  it("錯題本出題：錯→對→對後封存；清空可以復原", async () => {
    const [a, b] = demoQuestions.filter((q) => q.part === 5);
    await takeSession([a, b], () => false);
    const mq = await repos.mistakes.activeQuestions();
    expect(mq.map((q) => q.id).sort()).toEqual([a.id, b.id].sort());

    await takeSession([a], () => true, "mistakes");
    await takeSession([a], () => true, "mistakes");
    expect((await repos.mistakes.listArchived()).map((e) => e.item.question_id)).toEqual([a.id]);
    expect(await repos.mistakes.countActive()).toBe(1);

    const clearedAt = await repos.mistakes.clearAll(new Date("2026-10-11T00:00:00.000Z"));
    expect(clearedAt).not.toBeNull();
    expect(await repos.mistakes.countActive()).toBe(0);
    expect(await repos.mistakes.restoreCleared(clearedAt!)).toBe(1);
    // 只復原被清空的那筆，熟練封存的不受影響
    const active = await repos.mistakes.listActive();
    expect(active.map((e) => e.item.question_id)).toEqual([b.id]);

    const archived = await repos.mistakes.listArchived();
    await repos.mistakes.restore(archived[0].item.id);
    expect(await repos.mistakes.countActive()).toBe(2);
  });

  it("錯題本只出錯題：同題組其他題不會跟著出，但會附上文章", () => {
    const p7 = demoQuestions.filter((q) => q.part === 7);
    const r = selectQuestions([p7[0], p7[2]], demoGroups, {
      source: "mistakes",
      parts: [5, 6, 7],
      count: 2,
      secondsPerQuestion: null,
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.items.map((i) => i.question.id)).toEqual([p7[0].id, p7[2].id]);
    expect(r.items.every((i) => i.group?.id === p7[0].group_id)).toBe(true);
  });

  it("完整往返：匯出 → 匯入新資料庫 → 再匯出，資料一致", async () => {
    const settings = { ...defaultSettingsInput(), exam_date: "2026-12-13" };
    await repos.settings.save(settings);
    const plan = generatePlanTasks(settings, "2026-10-12");
    if (!plan.ok) throw new Error();
    const rec = buildPlanRecords({
      settings,
      startDate: "2026-10-12",
      tasks: plan.tasks,
      version: 1,
      now: T0.toISOString(),
      newId: () => crypto.randomUUID(),
    });
    await repos.plans.createPlan(rec.plan, rec.tasks);
    await repos.plans.setTaskCompleted(rec.tasks[0].id, true);
    await takeSession(demoQuestions.filter((q) => q.part === 5), () => false);

    const backup = await repos.backups.exportAll();
    const text = JSON.stringify(backup);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.migratedFrom).toBeNull();

    const db2 = new ToeicDB(`test-${crypto.randomUUID()}`);
    const repos2 = createDexieRepositories(db2);
    await repos2.settings.save(defaultSettingsInput()); // 匯入前已有資料，應被取代
    await repos2.backups.importAll(parsed.backup);
    const again = await repos2.backups.exportAll();
    const strip = (b: typeof backup) => ({ ...b, exported_at: "" });
    const sortAll = (b: typeof backup) =>
      Object.fromEntries(
        Object.entries(strip(b)).map(([k, v]) => [
          k,
          Array.isArray(v) ? [...v].sort((x, y) => String(x.id).localeCompare(String(y.id))) : v,
        ]),
      );
    expect(sortAll(again)).toEqual(sortAll(backup));
    expect(await repos2.mistakes.countActive()).toBe(6);
    await db2.delete();
  });

  it("關聯損壞的備份不可還原，原資料保留", async () => {
    await takeSession(demoQuestions.slice(0, 1), () => false);
    const backup = await repos.backups.exportAll();
    const broken = { ...backup, sessions: [] };
    expect(parseBackup(JSON.stringify(broken)).ok).toBe(false);
    await expect(repos.backups.importAll(broken)).rejects.toThrow();
    expect(await db.sessions.count()).toBe(1);
  });

  it("跨連線交卷發生在匯出期間，備份仍是交卷前的一致快照", async () => {
    const q = demoQuestions[0];
    const session = buildSession({ source: "bank", parts: [5], count: 1, secondsPerQuestion: null },
      [{ question: q, group: null }], T0, () => crypto.randomUUID());
    await repos.sessions.create(session);
    const other = new ToeicDB(db.name);
    await other.open();
    let write: Promise<unknown> | undefined;
    const original = db.sessions.toArray.bind(db.sessions);
    const spy = vi.spyOn(db.sessions, "toArray").mockImplementation(() => original().then((result) => {
      Dexie.ignoreTransaction(() => { write = createDexieRepositories(other).sessions.submit(session.id, T0); });
      return result;
    }));
    try {
      const backup = await repos.backups.exportAll();
      expect(backup.sessions[0].status).toBe("in_progress");
      expect(backup.attempts).toEqual([]);
      expect(backup.mistake_items).toEqual([]);
      await write;
      expect((await repos.sessions.get(session.id))?.status).toBe("submitted");
    } finally {
      spy.mockRestore();
      other.close();
    }
  });

  it("交卷紀錄缺題與錯誤評分都不可還原", async () => {
    await takeSession(demoQuestions.slice(0, 2), () => false);
    const backup = await repos.backups.exportAll();
    expect(parseBackup(JSON.stringify({ ...backup, attempts: backup.attempts.slice(1) })).ok).toBe(false);
    const wrongGrade = { ...backup, attempts: backup.attempts.map((a) => ({ ...a, is_correct: true })) };
    await expect(repos.backups.importAll(wrongGrade)).rejects.toThrow();
    expect(await db.attempts.count()).toBe(2);
    const differentAnswers = { ...backup, answers: backup.answers.map((a) => ({ ...a, selected_key: null })) };
    expect(parseBackup(JSON.stringify(differentAnswers)).ok).toBe(false);
  });

  it("全組測驗的結果只重考第二個空格，仍沿用原編號", () => {
    const p6 = demoQuestions.filter((q) => q.part === 6).map((q) => ({ ...q, stem: "" }));
    const session = buildSession({ source: "bank", parts: [6], count: p6.length, secondsPerQuestion: null },
      p6.map((question) => ({ question, group: demoGroups.find((g) => g.id === question.group_id)! })), T0, newId);
    expect(session.question_snapshot[1].question.stem).toBe("[2]");
    const item = session.question_snapshot[1];
    const picked = selectQuestions([item.question], [item.group!], { source: "mistakes", parts: [6], count: 1, secondsPerQuestion: null });
    expect(picked.ok && picked.items[0].question.stem).toBe("[2]");
    expect(p6[1].stem).toBe("");
  });

  it("Part 6 留白題幹只重考第二題時，快照仍保留空格 [2]", async () => {
    const p6 = demoQuestions.filter((q) => q.part === 6);
    await db.questions.bulkPut(p6.map((q) => ({ ...q, stem: "" })));
    await takeSession(p6, (q) => q.id !== p6[1].id);
    const questions = await repos.mistakes.activeQuestions();
    expect(questions).toHaveLength(1);
    expect(questions[0].stem).toBe("[2]");
    const picked = selectQuestions(questions, demoGroups, { source: "mistakes", parts: [6], count: 1, secondsPerQuestion: null });
    expect(picked.ok && picked.items[0].question.stem).toBe("[2]");
  });

  it("舊版（v1）備份會自動遷移後匯入", async () => {
    await takeSession(demoQuestions.filter((q) => q.part === 5).slice(0, 2), () => false);
    const current = await repos.backups.exportAll();
    const v1 = {
      ...current,
      schema_version: 1,
      sessions: current.sessions.map(({ paused_at: _p, paused_ms: _m, ...rest }) => rest),
    };
    const parsed = parseBackup(JSON.stringify(v1));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.migratedFrom).toBe(1);
    expect(parsed.backup.sessions[0]).toMatchObject({ paused_at: null, paused_ms: 0 });
  });

  it("匯入失敗時原資料完全不變", async () => {
    await repos.settings.save({ ...defaultSettingsInput(), target_score: 900 });
    const backup = await repos.backups.exportAll();
    // 兩筆相同 id 的題目 → bulkAdd 失敗
    const broken = { ...backup, settings: [], questions: [...backup.questions, backup.questions[0]] };
    await expect(repos.backups.importAll(broken)).rejects.toThrow();
    expect((await repos.settings.get())?.target_score).toBe(900);
    expect(await db.questions.count()).toBe(demoQuestions.length);
  });
});

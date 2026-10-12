import "fake-indexeddb/auto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { ToeicDB } from "@/storage/dexie/db";
import { createDexieRepositories } from "@/storage/dexie/DexieRepositories";
import { defaultSettingsInput } from "@/domain/settings";
import { buildPlanRecords, generatePlanTasks } from "@/domain/planner";
import { buildSession } from "@/domain/exam-engine";
import { parseBackup } from "@/domain/backup-migrations";

it("v1/v2舊備份還原後保留歷史評分、未交卷答案與計畫，再開始任務練習", async () => {
  const source = new ToeicDB(`release-source-${crypto.randomUUID()}`);
  const target = new ToeicDB(`release-target-${crypto.randomUUID()}`);
  const repos = createDexieRepositories(source);
  const restored = createDexieRepositories(target);
  const now = new Date("2026-10-12T02:00:00Z");
  try {
    await repos.bank.seedDemo();
    const settings = { ...defaultSettingsInput(), exam_date: "2026-11-12", available_weekdays: [0, 1, 2, 3, 4, 5, 6], daily_minutes: 30 };
    await repos.settings.save(settings);
    const draft = generatePlanTasks(settings, "2026-10-12");
    if (!draft.ok) throw new Error(draft.error);
    const records = buildPlanRecords({ settings, startDate: "2026-10-12", tasks: draft.tasks, version: 1, now: now.toISOString(), newId: () => crypto.randomUUID() });
    await repos.plans.createPlan(records.plan, records.tasks);
    const p6 = await repos.bank.listApproved([6]);
    const groups = await repos.bank.getGroups(p6.flatMap((q) => q.group_id ?? []));
    const history = buildSession({ source: "bank", parts: [6], count: p6.length, secondsPerQuestion: null }, p6.map((question) => ({ question, group: groups.find((g) => g.id === question.group_id)! })), now, () => crypto.randomUUID());
    await repos.sessions.create(history);
    for (const [index, q] of p6.entries()) {
      await repos.sessions.saveAnswer({ sessionId: history.id, questionId: q.id, selectedKey: index === 1 ? (q.correct_key === "A" ? "B" : "A") : q.correct_key, elapsedMs: 1000 });
    }
    await repos.sessions.submit(history.id, now);
    const p5 = (await repos.bank.listApproved([5])).slice(0, 2);
    const ongoing = buildSession({ source: "bank", parts: [5], count: 2, secondsPerQuestion: null }, p5.map((question) => ({ question, group: null })), now, () => crypto.randomUUID());
    await repos.sessions.create(ongoing);
    await repos.sessions.saveAnswer({ sessionId: ongoing.id, questionId: p5[0].id, selectedKey: p5[0].correct_key, elapsedMs: 1000 });
    const current = await repos.backups.exportAll();
    for (const version of [1, 2]) {
      const legacy = { ...current, schema_version: version, sessions: current.sessions.map(({ study_task_id: _, ...s }) => {
        if (version === 2) return s;
        const { paused_at: _p, paused_ms: _m, ...v1 } = s;
        return v1;
      }) };
      const parsed = parseBackup(JSON.stringify(legacy));
      if (!parsed.ok) throw new Error(parsed.error);
      await restored.backups.importAll(parsed.backup);
      expect((await restored.sessions.getInProgress())?.id).toBe(ongoing.id);
      expect((await restored.sessions.getAnswers(ongoing.id))[0].selected_key).toBe(p5[0].correct_key);
      expect((await restored.sessions.listAttempts(history.id)).filter((a) => a.is_correct)).toHaveLength(3);
      expect((await restored.sessions.get(history.id))?.study_task_id).toBeNull();
      expect(await restored.mistakes.countActive()).toBe(1);
      await restored.sessions.submit(ongoing.id, now);
      const task = records.tasks.find((t) => t.part === 6)!;
      const linked = { ...history, id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(), study_task_id: task.id };
      await restored.sessions.create(linked);
      await restored.sessions.submit(linked.id, now);
      expect((await restored.plans.getTask(task.id))?.completed_at).toBeNull();
      await restored.plans.completeFromSession(linked.id);
      expect((await restored.plans.getTask(task.id))?.completed_at).not.toBeNull();
      if (process.env.RELEASE_FIXTURE_DIR) {
        const dir = resolve(process.env.RELEASE_FIXTURE_DIR);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, `legacy-v${version}.json`), JSON.stringify(legacy, null, 2));
        writeFileSync(resolve(dir, "fixture-ids.json"), JSON.stringify({ history: history.id, ongoing: ongoing.id, task: task.id }));
      }
    }
  } finally {
    await source.delete();
    await target.delete();
  }
});

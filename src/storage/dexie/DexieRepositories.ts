import {
  AnswerSchema,
  AttemptSchema,
  BackupSchema,
  ContentGroupSchema,
  ImportBatchSchema,
  MistakeItemSchema,
  QuestionSchema,
  SessionSchema,
  SCHEMA_VERSION,
  SettingsInputSchema,
  SettingsSchema,
  StudyPlanSchema,
  StudyTaskSchema,
  TIMEZONE,
  type MistakeItem,
  type Part,
  type Settings,
  type SettingsInput,
} from "@/domain/schema";
import { nowIso } from "@/domain/dates";
import { gradeSession, pauseSession, resumeSession } from "@/domain/exam-engine";
import { applyAttempts, clearItems, restoreItem } from "@/domain/mistake-policy";
import { planImport } from "@/domain/import-validator";
import { numberPart6Questions } from "@/domain/blank-numbers";
import { validateBackup } from "@/domain/backup-integrity";
import { sessionMatchesTask } from "@/domain/task-practice";
import { demoGroups, demoQuestions } from "@/fixtures/demo-bank";
import type { BankStats, MistakeEntry, Repositories } from "../Repository";
import type { ToeicDB } from "./db";
import { createVocabularyRepository } from "./VocabularyRepository";

export function createDexieRepositories(db: ToeicDB): Repositories {
  const withQuestions = async (items: MistakeItem[]): Promise<MistakeEntry[]> => {
    const questionIds = items.map((i) => i.question_id);
    const questions = await db.questions.bulkGet(questionIds);
    const groupIds = [...new Set(questions.flatMap((q) => (q?.group_id ? [q.group_id] : [])))];
    const [groups, siblings, attempts] = await Promise.all([
      db.content_groups.bulkGet(groupIds),
      groupIds.length ? db.questions.where("group_id").anyOf(groupIds).toArray() : [],
      questionIds.length ? db.attempts.where("question_id").anyOf(questionIds).toArray() : [],
    ]);
    const groupById = new Map(groups.flatMap((g) => (g ? [[g.id, g] as const] : [])));
    const lastWrong = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) {
      if (a.is_correct) continue;
      const prev = lastWrong.get(a.question_id);
      if (!prev || a.submitted_at > prev.submitted_at) lastWrong.set(a.question_id, a);
    }
    return items
      .map((item, i) => {
        const question = questions[i] ?? null;
        const group = question?.group_id ? (groupById.get(question.group_id) ?? null) : null;
        const order = group
          ? siblings
              .filter((q) => q.group_id === group.id)
              .sort((a, b) => a.source_id.localeCompare(b.source_id))
              .map((q) => q.id)
          : [];
        const wrong = lastWrong.get(item.question_id);
        return {
          item,
          question,
          group,
          positionInGroup: Math.max(0, order.indexOf(item.question_id)),
          lastWrong: wrong ? { selected_key: wrong.selected_key, submitted_at: wrong.submitted_at } : null,
        };
      })
      .sort((a, b) => b.item.updated_at.localeCompare(a.item.updated_at));
  };

  return {
    vocabulary: createVocabularyRepository(db),
    settings: {
      async get() {
        return (await db.settings.toCollection().first()) ?? null;
      },
      async save(input: SettingsInput) {
        const value = SettingsInputSchema.parse(input);
        return db.transaction("rw", db.settings, async () => {
          const existing = await db.settings.toCollection().first();
          const now = nowIso();
          const record: Settings = SettingsSchema.parse({
            ...value,
            id: existing?.id ?? crypto.randomUUID(),
            created_at: existing?.created_at ?? now,
            updated_at: now,
            timezone: TIMEZONE,
          });
          await db.settings.put(record);
          return record;
        });
      },
    },

    plans: {
      async getTask(taskId) {
        return (await db.study_tasks.get(taskId)) ?? null;
      },
      async completeFromSession(sessionId) {
        await db.transaction("rw", db.sessions, db.study_tasks, db.study_plans, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session || session.status !== "submitted" || !session.study_task_id) throw new Error("這場測驗尚未交卷或沒有關聯任務");
          const task = await db.study_tasks.get(session.study_task_id);
          if (!task || (await db.study_plans.get(task.plan_id))?.status !== "active") throw new Error("任務已重新排程，請回今日頁確認目前任務");
          if (!sessionMatchesTask(session, task)) throw new Error("測驗單元與任務不一致，請回今日頁確認");
          if (task.completed_at !== null) return;
          const now = nowIso();
          await db.study_tasks.update(task.id, { completed_at: now, updated_at: now });
        });
      },
      async getActivePlan() {
        return (await db.study_plans.where("status").equals("active").first()) ?? null;
      },
      async listTasks(planId) {
        return db.study_tasks.where("plan_id").equals(planId).sortBy("date");
      },
      async createPlan(plan, tasks) {
        const validPlan = StudyPlanSchema.parse(plan);
        const validTasks = tasks.map((t) => StudyTaskSchema.parse(t));
        await db.transaction("rw", db.study_plans, db.study_tasks, async () => {
          if ((await db.study_plans.where("status").equals("active").count()) > 0) {
            throw new Error("已有生效中的計畫，請改用重新排程");
          }
          await db.study_plans.add(validPlan);
          await db.study_tasks.bulkAdd(validTasks);
        });
      },
      async applyReschedule({ oldPlanId, newPlan, newTasks, keptTaskIds }) {
        const validPlan = StudyPlanSchema.parse(newPlan);
        const validTasks = newTasks.map((t) => StudyTaskSchema.parse(t));
        await db.transaction("rw", db.study_plans, db.study_tasks, async () => {
          const old = await db.study_plans.get(oldPlanId);
          if (!old || old.status !== "active") throw new Error("原計畫已不是生效中的版本，請重新整理後再試");
          const now = nowIso();
          await db.study_plans.update(oldPlanId, { status: "superseded", updated_at: now });
          await db.study_plans.add(validPlan);
          for (const id of keptTaskIds) {
            const task = await db.study_tasks.get(id);
            if (!task || task.plan_id !== oldPlanId || task.completed_at === null) {
              throw new Error("保留的任務狀態已變更，請重新預覽");
            }
            await db.study_tasks.update(id, { plan_id: validPlan.id, updated_at: now });
          }
          await db.study_tasks.bulkAdd(validTasks);
        });
      },
      async setTaskCompleted(taskId, completed) {
        const now = nowIso();
        const updated = await db.study_tasks.update(taskId, {
          completed_at: completed ? now : null,
          updated_at: now,
        });
        if (updated === 0) throw new Error("找不到這項任務");
      },
    },

    bank: {
      async listAll() {
        return { questions: await db.questions.toArray(), groups: await db.content_groups.toArray() };
      },
      async commitImport({ rows, source, checksum }) {
        return db.transaction("rw", [db.questions, db.content_groups, db.import_batches], async () => {
          const now = nowIso();
          const plan = planImport(
            rows,
            await db.questions.toArray(),
            await db.content_groups.toArray(),
            now,
            () => crypto.randomUUID(),
          );
          await db.content_groups.bulkPut(plan.groups.map((g) => ContentGroupSchema.parse(g)));
          await db.questions.bulkPut(plan.questions.map((q) => QuestionSchema.parse(q)));
          const batch = ImportBatchSchema.parse({
            id: crypto.randomUUID(),
            created_at: now,
            updated_at: now,
            source,
            checksum,
            status: "committed",
            valid_count: rows.filter((r) => r.status === "approved").length,
            errors: plan.notices,
            committed_at: now,
          });
          await db.import_batches.add(batch);
          return { batch, summary: plan.summary, notices: plan.notices };
        });
      },
      async listImportBatches(limit) {
        const all = await db.import_batches.toArray();
        return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
      },
      async seedDemo() {
        await db.transaction("rw", db.content_groups, db.questions, async () => {
          const groups = await db.content_groups.bulkGet(demoGroups.map((g) => g.id));
          const questions = await db.questions.toArray();
          const ids = new Set(questions.map((q) => q.id));
          const sources = new Set(questions.map((q) => q.source_id));
          await db.content_groups.bulkAdd(demoGroups.filter((_, i) => !groups[i]));
          await db.questions.bulkAdd(demoQuestions.filter((q) => !ids.has(q.id) && !sources.has(q.source_id)));
        });
      },
      async stats() {
        const approved = await db.questions.where("status").equals("approved").toArray();
        const byPart: BankStats["byPart"] = {};
        for (const q of approved) byPart[q.part] = (byPart[q.part] ?? 0) + 1;
        return { total: approved.length, byPart };
      },
      async listApproved(parts?: readonly Part[]) {
        const all = await db.questions.toArray();
        return numberPart6Questions(all.filter((q) => q.status === "approved" && (!parts || parts.includes(q.part))), all);
      },
      async getGroups(ids) {
        const groups = await db.content_groups.bulkGet([...ids]);
        return groups.filter((g) => g !== undefined);
      },
    },

    sessions: {
      async create(session) {
        const valid = SessionSchema.parse(session);
        await db.transaction("rw", db.sessions, db.study_tasks, db.study_plans, async () => {
          if (valid.study_task_id) {
            const task = await db.study_tasks.get(valid.study_task_id);
            if (!task || (await db.study_plans.get(task.plan_id))?.status !== "active") throw new Error("任務已重新排程，請回今日頁重新開始");
            if (task.completed_at !== null) throw new Error("這項任務已完成，可從模擬考開始自由練習");
            if (!sessionMatchesTask(valid, task)) throw new Error("練習單元與任務不一致");
          }
          if ((await db.sessions.where("status").equals("in_progress").count()) > 0) {
            throw new Error("還有一場測驗沒有交卷，請先完成或交卷");
          }
          await db.sessions.add(valid);
        });
      },
      async get(id) {
        return (await db.sessions.get(id)) ?? null;
      },
      async getInProgress() {
        return (await db.sessions.where("status").equals("in_progress").first()) ?? null;
      },
      async listSubmitted() {
        const list = await db.sessions.where("status").equals("submitted").toArray();
        return list.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
      },
      async getAnswers(sessionId) {
        return db.answers.where("session_id").equals(sessionId).toArray();
      },
      async listAttempts(sessionId) {
        return db.attempts.where("session_id").equals(sessionId).toArray();
      },
      async saveAnswer({ sessionId, questionId, selectedKey, elapsedMs }) {
        await db.transaction("rw", db.sessions, db.answers, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          if (session.status !== "in_progress") throw new Error("已交卷，無法再修改答案");
          if (!session.question_snapshot.some((it) => it.question.id === questionId)) {
            throw new Error("這題不在本次測驗中");
          }
          const now = nowIso();
          const existing = await db.answers.where("[session_id+question_id]").equals([sessionId, questionId]).first();
          await db.answers.put(
            AnswerSchema.parse({
              id: existing?.id ?? crypto.randomUUID(),
              created_at: existing?.created_at ?? now,
              updated_at: now,
              session_id: sessionId,
              question_id: questionId,
              selected_key: selectedKey,
              answered_at: selectedKey === null ? null : now,
              elapsed_ms: Math.max(0, Math.round(elapsedMs)),
            }),
          );
        });
      },
      async pause(sessionId, now) {
        await db.transaction("rw", db.sessions, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          await db.sessions.update(sessionId, pauseSession(session, now));
        });
      },
      async resume(sessionId, now) {
        await db.transaction("rw", db.sessions, async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          await db.sessions.update(sessionId, resumeSession(session, now));
        });
      },
      async submit(sessionId, now) {
        return db.transaction("rw", [db.sessions, db.answers, db.attempts, db.mistake_items], async () => {
          const session = await db.sessions.get(sessionId);
          if (!session) throw new Error("找不到這場測驗");
          if (session.status === "submitted") {
            return {
              session,
              attempts: await db.attempts.where("session_id").equals(sessionId).toArray(),
              alreadySubmitted: true,
            };
          }
          // 暫停中交卷：暫停時間不計入作答時間
          const resumed = { ...session, ...resumeSession(session, now) };
          // 超過截止時間才交卷（例如關閉頁面後回來）：交卷時間記為截止時間
          const deadline = resumed.deadline_at ? Date.parse(resumed.deadline_at) : null;
          const at = deadline !== null && now.getTime() > deadline ? new Date(deadline) : now;
          const iso = at.toISOString();
          const submitted = SessionSchema.parse({ ...resumed, status: "submitted", submitted_at: iso, updated_at: iso });
          const graded = gradeSession(submitted, await db.answers.where("session_id").equals(sessionId).toArray());
          const attempts = graded.items.map((it) =>
            AttemptSchema.parse({
              id: crypto.randomUUID(),
              created_at: iso,
              updated_at: iso,
              session_id: sessionId,
              question_id: it.question.id,
              question_version: it.question.version,
              selected_key: it.selected,
              is_correct: it.isCorrect,
              submitted_at: iso,
            }),
          );
          await db.sessions.put(submitted);
          await db.attempts.bulkAdd(attempts);
          // 錯題本與交卷在同一交易：同一場交卷只會處理一次
          const ids = attempts.map((a) => a.question_id);
          const existing = await db.mistake_items.where("question_id").anyOf(ids).toArray();
          const updates = applyAttempts(
            new Map(existing.map((m) => [m.question_id, m])),
            attempts,
            iso,
            () => crypto.randomUUID(),
          );
          await db.mistake_items.bulkPut(updates.map((m) => MistakeItemSchema.parse(m)));
          return { session: submitted, attempts, alreadySubmitted: false };
        });
      },
    },

    mistakes: {
      async countActive() {
        return db.mistake_items.where("state").equals("active").count();
      },
      async listActive() {
        return withQuestions(await db.mistake_items.where("state").equals("active").toArray());
      },
      async listArchived() {
        return withQuestions(await db.mistake_items.where("state").equals("archived").toArray());
      },
      async activeQuestions() {
        const items = await db.mistake_items.where("state").equals("active").toArray();
        const ids = new Set(items.map((i) => i.question_id));
        const all = await db.questions.toArray();
        return numberPart6Questions(all.filter((q) => ids.has(q.id) && q.status === "approved"), all);
      },
      async clearAll(now) {
        const iso = now.toISOString();
        return db.transaction("rw", db.mistake_items, async () => {
          const active = await db.mistake_items.where("state").equals("active").toArray();
          if (active.length === 0) return null;
          await db.mistake_items.bulkPut(clearItems(active, iso));
          return iso;
        });
      },
      async restoreCleared(clearedAt) {
        const now = nowIso();
        return db.transaction("rw", db.mistake_items, async () => {
          const items = (await db.mistake_items.where("state").equals("archived").toArray()).filter(
            (i) => i.archive_reason === "cleared" && i.archived_at === clearedAt,
          );
          await db.mistake_items.bulkPut(items.map((i) => restoreItem(i, now)));
          return items.length;
        });
      },
      async restore(itemId) {
        await db.transaction("rw", db.mistake_items, async () => {
          const item = await db.mistake_items.get(itemId);
          if (!item) throw new Error("找不到這筆錯題");
          if (item.state === "active") return;
          await db.mistake_items.put(restoreItem(item, nowIso()));
        });
      },
    },

    backups: {
      async exportAll() {
        return db.transaction("r", db.tables, async () => BackupSchema.parse({
          schema_version: SCHEMA_VERSION,
          exported_at: nowIso(),
          media_binaries_included: false,
          settings: await db.settings.toArray(),
          study_plans: await db.study_plans.toArray(),
          study_tasks: await db.study_tasks.toArray(),
          content_groups: await db.content_groups.toArray(),
          questions: await db.questions.toArray(),
          media_assets: await db.media_assets.toArray(),
          sessions: await db.sessions.toArray(),
          answers: await db.answers.toArray(),
          attempts: await db.attempts.toArray(),
          mistake_items: await db.mistake_items.toArray(),
          import_batches: await db.import_batches.toArray(),
          generation_jobs: await db.generation_jobs.toArray(),
          vocabulary_words: await db.vocabulary_words.toArray(),
          vocabulary_reviews: await db.vocabulary_reviews.toArray(),
          vocabulary_settings: await db.vocabulary_settings.toArray(),
        }));
      },
      async importAll(backup) {
        const valid = validateBackup(backup);
        const tables = [
          db.settings,
          db.study_plans,
          db.study_tasks,
          db.content_groups,
          db.questions,
          db.media_assets,
          db.sessions,
          db.answers,
          db.attempts,
          db.mistake_items,
          db.import_batches,
          db.generation_jobs,
          db.vocabulary_words, db.vocabulary_reviews, db.vocabulary_settings,
        ];
        await db.transaction("rw", tables, async () => {
          for (const t of tables) await t.clear();
          await db.settings.bulkAdd(valid.settings);
          await db.study_plans.bulkAdd(valid.study_plans);
          await db.study_tasks.bulkAdd(valid.study_tasks);
          await db.content_groups.bulkAdd(valid.content_groups);
          await db.questions.bulkAdd(valid.questions);
          await db.media_assets.bulkAdd(valid.media_assets);
          await db.sessions.bulkAdd(valid.sessions);
          await db.answers.bulkAdd(valid.answers);
          await db.attempts.bulkAdd(valid.attempts);
          await db.mistake_items.bulkAdd(valid.mistake_items);
          await db.import_batches.bulkAdd(valid.import_batches);
          await db.generation_jobs.bulkAdd(valid.generation_jobs);
          await db.vocabulary_words.bulkAdd(valid.vocabulary_words);
          await db.vocabulary_reviews.bulkAdd(valid.vocabulary_reviews);
          await db.vocabulary_settings.bulkAdd(valid.vocabulary_settings);
        });
      },
    },
  };
}
